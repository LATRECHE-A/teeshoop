#!/usr/bin/env node
/**
 * CONSENT GATE: what a real browser writes to a real visitor's machine, and when.
 *
 *   node scripts/consent-verify.mjs [base]
 *
 * WHY THIS DRIVES A BROWSER, which is the opposite of `scripts/seo-verify.mjs`
 * two files over, and the reason is a defect that gate could not see.
 *
 * seo-verify asserts « une première visite ne dépose aucun traceur » by listing
 * `Set-Cookie` response headers on a raw fetch. That is the right instrument for
 * everything else it checks, and it is structurally blind to the thing that
 * actually happens on this shop: WooCommerce 11's order attribution enqueues
 * sourcebuster on every front-end page and writes seven cookies from
 * `document.cookie`. No header, no assertion, 459 green ticks, and a French shop
 * writing a visitor's User-Agent to their machine before asking them anything.
 * Measured in Chromium on 26/08/2026; the fix is in `Consent.php` and this file
 * is what keeps it fixed.
 *
 * Article 82 of the loi Informatique et Libertés covers anything READ FROM or
 * WRITTEN TO a terminal, so this looks at cookies, localStorage, sessionStorage
 * AND IndexedDB, not at cookies alone.
 *
 * WHAT IT REFUSES TO LET PASS
 *
 *   ANYTHING WRITTEN BEFORE A CHOICE. Not "written but unused": not written. The
 *   only exemption is a cookie WooCommerce sets to carry a basket the visitor
 *   has expressly asked for, and those are checked separately, after an
 *   add-to-cart, and named one by one rather than matched by prefix.
 *
 *   A REFUSAL THAT CHANGES NOTHING. The refuse button must leave the machine as
 *   clean as it was, on the page after it, not only on the redirect. And a
 *   visitor arriving with somebody else's trackers already on their machine must
 *   leave without them.
 *
 *   A CONSENT THAT GATES NOTHING. Accepting must actually turn the collection
 *   ON. A gate whose "yes" branch is never exercised is a gate that could be
 *   refusing everything for the wrong reason, and it would pass every assertion
 *   above.
 *
 *   A REFUSE BUTTON THAT IS NOT AS EASY AS THE ACCEPT ONE. Same element, same
 *   class, same size, one click. The CNIL's grievance against the sites it has
 *   fined is not that refusing was impossible.
 *
 * THE TWO SELF-TESTS RUN EVERY TIME AND ARE NOT BEHIND A FLAG, because a
 * `--self-test` whose green only means "the harness can record a failure" gets
 * quoted as if it meant the shop passed. Each one breaks the real page in the
 * browser and requires the real rule to report it. If either stays silent the
 * scan is not trustworthy and the exit code says so.
 *
 * Exit: 0 all assertions passed - 1 an assertion failed - 2 nothing was asserted
 *       (the shop was unreachable, or a self-test did not fire).
 */
import { chromium } from 'playwright'

const BASE = (process.argv.find((a) => a.startsWith('http')) || 'http://localhost:8080').replace(/\/$/, '')

/* ---------------------------------------------------------------- harness */

const results = []
const ok = (name, pass, extra = '') => {
  results.push({ name, pass, extra })
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'} ${name}${extra ? `  (${extra})` : ''}\n`)
  return pass
}

const die = (why) => {
  process.stdout.write(`\nconsent-verify: ${why}\n`)
  process.exit(2)
}

/**
 * The cookies WooCommerce sets to carry a basket, named one by one.
 *
 * Article 82's exemption is for storage strictly necessary to a service the
 * user expressly requested, and a basket is that. It is a LIST and not a
 * prefix on purpose: `woocommerce_` would also exempt a tracker somebody named
 * `woocommerce_analytics_`, and the whole point of this file is that nothing
 * gets in by looking like something else.
 */
const CART_COOKIES = ['woocommerce_items_in_cart', 'woocommerce_cart_hash']
const CART_COOKIE_PREFIXES = ['wp_woocommerce_session_']

const isCartCookie = (name) =>
  CART_COOKIES.includes(name) || CART_COOKIE_PREFIXES.some((p) => name.startsWith(p))

/**
 * What the block cart and the block checkout write, and why each is allowed.
 *
 * The block cart is React and keeps its state in localStorage rather than in a
 * cookie. Two of the three keys are the cart itself and the token that protects
 * it, on a page the visitor navigated to in order to see their cart, which is
 * the article 82 exemption almost word for word.
 *
 * THE THIRD ONE IS NOT OURS AND WE CANNOT REMOVE IT.
 * `wc-blocks_dismissed_incompatible_extensions_notices` is WooCommerce's own
 * record of which SHOP-ADMIN notice has been dismissed, written on the front end
 * for anonymous visitors too. It holds no identifier, nothing of ours reads it,
 * and it goes nowhere. It is listed BY NAME rather than covered by a prefix so
 * that a fourth key appearing on those two pages fails this gate instead of
 * joining a pattern, and it is written into the tracker register rather than
 * quietly tolerated.
 */
const CART_STORAGE = [
  'storeApiNonce',
  'storeApiCartData',
  'wc-blocks_dismissed_incompatible_extensions_notices',
]

/**
 * Load a page and wait until the document is really finished.
 *
 * NOT `networkidle`, AND THE FIRST VERSION OF THIS FILE USED IT. Playwright
 * resolves `networkidle` after 500 ms with no connections, and on `/cart/` the
 * block bundle leaves gaps that long WHILE THE PARSER IS STILL WORKING. Measured
 * by polling `document.readyState` every 400 ms: the consent banner, which is
 * the last element in the body, only exists from about 1 200 ms, and three
 * consecutive `networkidle` loads snapshotted a DOM without it. Every storage
 * assertion here would have been read off a half-built document, which is a gate
 * that passes because it looked too early.
 */
const load = async (page, url) => {
  const res = await page.goto(url, { waitUntil: 'load', timeout: 45000 })
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 45000 })
  return res
}

/** Everything on the machine, whatever API wrote it. */
const terminal = async (page, context) => {
  const cookies = (await context.cookies()).map((c) => c.name)
  const web = await page.evaluate(async () => {
    const dbs = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : []
    return {
      ls: Object.keys(localStorage),
      ss: Object.keys(sessionStorage),
      idb: dbs.map((d) => d.name).filter(Boolean),
    }
  })
  return { cookies, ...web }
}

const describe = (t) =>
  [
    t.cookies.length ? `cookies: ${t.cookies.join(', ')}` : '',
    t.ls.length ? `localStorage: ${t.ls.join(', ')}` : '',
    t.ss.length ? `sessionStorage: ${t.ss.join(', ')}` : '',
    t.idb.length ? `indexedDB: ${t.idb.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' - ')

/**
 * Everything written that no exemption covers.
 *
 * `allow` is the set of cookie names a given moment is entitled to. localStorage,
 * sessionStorage and IndexedDB are never entitled to anything on the WordPress
 * origin: nothing this shop serves needs them, so a name appearing there is a
 * finding whatever it is called.
 */
const unexpected = (t, allow = [], allowStorage = []) => [
  ...t.cookies.filter((n) => !allow.includes(n)),
  ...t.ls.filter((k) => !allowStorage.includes(k)).map((k) => `localStorage:${k}`),
  ...t.ss.filter((k) => !allowStorage.includes(k)).map((k) => `sessionStorage:${k}`),
  ...t.idb.map((k) => `indexedDB:${k}`),
]

/* ------------------------------------------------------------------- pages */

/**
 * The buying path, and the front door with a campaign on it.
 *
 * The campaign arguments are there because sourcebuster only writes its
 * interesting fields when it has a source to record: a bare `/` produced a
 * thinner cookie set and would have made this gate weaker than the traffic the
 * shop actually pays for.
 */
const PAGES = [
  ['/?utm_source=google&utm_medium=cpc&utm_campaign=controle', 'arrivée depuis une campagne'],
  ['/shop/', 'la boutique'],
  ['/categorie/t-shirts/', 'une catégorie'],
  ['/devis/', 'la page devis'],
  ['/cart/', 'le panier vide', CART_STORAGE],
]

const main = async () => {
  const browser = await chromium.launch()

  /* ------------------------------------------------- nothing before a choice */

  {
    const context = await browser.newContext()
    const page = await context.newPage()
    for (const [path, label, allowStorage = []] of PAGES) {
      let reached = false
      try {
        reached = !!(await load(page, BASE + path))
      } catch {
        reached = false
      }
      if (!reached) {
        ok(`${label} répond`, false, `${BASE}${path} injoignable`)
        continue
      }
      const t = await terminal(page, context)
      ok(
        `avant tout choix, ${label} n'écrit rien sur la machine`,
        unexpected(t, [], allowStorage).length === 0,
        describe(t)
      )
    }

    const banner = await page.evaluate(() => {
      const box = document.querySelector('#ts-consent')
      if (!box) return null
      const btns = [...box.querySelectorAll('button[type=submit]')]
      const of = (n) => btns.find((b) => b.getAttribute('name') === n)
      const rect = (b) => (b ? b.getBoundingClientRect() : null)
      const refuse = of('rien')
      const accept = of('tout')
      return {
        refuseFirst: refuse && accept ? btns.indexOf(refuse) < btns.indexOf(accept) : false,
        sameClass: refuse && accept ? refuse.className === accept.className : false,
        refuse: rect(refuse),
        accept: rect(accept),
        refuseText: refuse ? refuse.textContent.trim() : '',
        acceptText: accept ? accept.textContent.trim() : '',
      }
    })
    if (banner) {
      ok('le bandeau propose refuser et accepter', !!banner.refuseText && !!banner.acceptText, `${banner.refuseText} / ${banner.acceptText}`)
      ok('refuser est écrit avant accepter', banner.refuseFirst)
      ok('refuser et accepter portent la même classe', banner.sameClass)
      const near = (a, b) => a && b && Math.abs(a.height - b.height) <= 1 && Math.abs(a.width - b.width) <= 24
      ok(
        'refuser et accepter font la même taille',
        near(banner.refuse, banner.accept),
        banner.refuse && banner.accept
          ? `${Math.round(banner.refuse.width)}x${Math.round(banner.refuse.height)} contre ${Math.round(banner.accept.width)}x${Math.round(banner.accept.height)}`
          : 'un des deux boutons manque'
      )
    } else {
      ok('le bandeau de consentement est rendu', false, 'aucun #ts-consent sur la page')
    }
    await context.close()
  }

  /* --------------------------------------------------- refusing changes nothing */

  {
    const context = await browser.newContext()
    const page = await context.newPage()
    await load(page, BASE + PAGES[0][0])
    await page.click('#ts-consent button[name="rien"]')
    await page.waitForLoadState('load')
    await load(page, BASE + '/categorie/t-shirts/')

    const t = await terminal(page, context)
    const choice = (await context.cookies()).find((c) => c.name === 'teeshoop_choix')
    ok('refuser enregistre le refus', !!choice && /^v\d+:\d{4}-\d{2}-\d{2}:$/.test(decodeURIComponent(choice.value)), choice ? decodeURIComponent(choice.value) : 'aucun cookie de choix')
    ok(
      'après un refus, plus rien d\'autre n\'est écrit, page suivante comprise',
      unexpected(t, ['teeshoop_choix']).length === 0,
      describe(t)
    )
    ok('le bandeau ne revient pas après un refus', !(await page.locator('#ts-consent').count()))
    await context.close()
  }

  /* ----------------------------------------- changing one's mind ends somewhere */

  {
    /*
     * DON-04. The footer control opens the panel on `?cookies=1`, and that URL
     * was the return address: every save sent the visitor back to the open
     * panel, so a withdrawal looked like it had not been taken.
     */
    const context = await browser.newContext()
    const page = await context.newPage()
    await load(page, BASE + '/?cookies=1')
    ok('le lien du pied de page ouvre le panneau', (await page.locator('#ts-consent').count()) > 0)
    await page.click('#ts-consent button[name="rien"]')
    await page.waitForLoadState('load')
    ok('après le retrait, le retour ne porte plus le drapeau', !new URL(page.url()).searchParams.has('cookies'), page.url())
    ok('et le panneau ne se rouvre pas', !(await page.locator('#ts-consent').count()))
    await context.close()
  }

  /* ------------------------------------------- a visitor who already carries them */

  {
    const context = await browser.newContext()
    /*
     * A VISITOR WHO ARRIVES ALREADY TRACKED. Not a hypothetical: every machine
     * that met this shop before the gate existed carries these, host-only and
     * path `/`, exactly as sourcebuster wrote them. Refusing has to remove them,
     * and the removal has to be server side, because the script that would have
     * removed them is the one we no longer load.
     */
    await context.addCookies([
      { name: 'sbjs_udata', value: 'vst=1|||uip=(none)|||uag=controle', url: BASE },
      { name: 'sbjs_session', value: 'pgs=4|||cpg=' + BASE + '/', url: BASE },
    ])
    const page = await context.newPage()
    await load(page, BASE + '/categorie/t-shirts/')
    const t = await terminal(page, context)
    ok(
      'les traceurs déjà présents sont retirés à la visite suivante',
      !t.cookies.some((n) => n.startsWith('sbjs_')),
      describe(t)
    )
    await context.close()
  }

  /* --------------------------------------------------------- accepting turns it on */

  {
    const context = await browser.newContext()
    const page = await context.newPage()
    await load(page, BASE + PAGES[0][0])
    await page.click('#ts-consent button[name="tout"]')
    await page.waitForLoadState('load')
    await load(page, BASE + '/categorie/t-shirts/')

    const names = (await context.cookies()).map((c) => c.name)
    ok('accepter écrit notre propre cookie de provenance', names.includes('teeshoop_src'), names.join(', '))
    ok(
      'accepter rend à WooCommerce sa mesure de provenance',
      names.some((n) => n.startsWith('sbjs_')),
      names.filter((n) => n.startsWith('sbjs_')).join(', ') || 'aucun sbjs_'
    )
    await context.close()
  }

  /* ------------------------------------------------ the basket, which is exempt */

  {
    const context = await browser.newContext()
    const page = await context.newPage()
    await load(page, BASE + '/')
    await page.click('#ts-consent button[name="rien"]')
    await page.waitForLoadState('load')

    const before = (await context.cookies()).map((c) => c.name)
    ok(
      'aucun cookie de panier avant qu\'il y ait un panier',
      !before.some(isCartCookie),
      before.filter(isCartCookie).join(', ')
    )

    /*
     * The one product that can be added by URL. `ProductPage::refuse_plain_add`
     * blocks `?add-to-cart=` for anything declaring a Teeshoop garment, which is
     * correct and means this gate cannot use a personalisable reference to make
     * a basket exist.
     */
    const id = await page.evaluate(async (base) => {
      const res = await fetch(base + '/wp-json/wp/v2/product?per_page=1&_fields=id', { credentials: 'omit' })
      if (!res.ok) return 0
      const rows = await res.json()
      return Array.isArray(rows) && rows[0] ? rows[0].id : 0
    }, BASE)

    if (id) {
      await load(page, `${BASE}/?add-to-cart=${id}`)
      const after = (await context.cookies()).map((c) => c.name)
      const cart = after.filter(isCartCookie)
      if (cart.length === 0) {
        /*
         * NOT AN ASSERTION, because a shop whose only reachable product refuses a
         * plain add-to-cart is the shop behaving correctly, and failing here
         * would make this gate red for a reason that is not a defect. Said out
         * loud rather than passed over: "nothing found" and "nothing looked" are
         * different results.
         */
        process.stdout.write(`     (aucun panier n'a pu être créé avec le produit ${id}, la règle d'exemption n'a donc pas été mise à l'épreuve)\n`)
      } else {
        ok(
          'le panier n\'écrit que ses propres cookies',
          unexpected(await terminal(page, context), [...cart, 'teeshoop_choix'], CART_STORAGE).length === 0,
          cart.join(', ')
        )
      }
    } else {
      process.stdout.write('     (aucun produit lisible par l\'API, la règle d\'exemption n\'a pas été mise à l\'épreuve)\n')
    }
    await context.close()
  }

  /* ------------------------------------------------------------- the self-tests */

  const fired = []

  {
    /*
     * SELF-TEST 1: put a tracker back and require the rule to see it. This is
     * the exact defect the file exists for, reproduced on the real page in the
     * real browser: a cookie written by `document.cookie` after load, with no
     * `Set-Cookie` header anywhere, which is what made it invisible to the gate
     * that already existed.
     */
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.addInitScript(() => {
      document.cookie = 'sbjs_udata=vst=1|||uag=autotest; path=/'
    })
    await load(page, BASE + '/')
    const t = await terminal(page, context)
    const saw = unexpected(t).length > 0
    fired.push(['un traceur écrit en JavaScript est vu', saw])
    await context.close()
  }

  {
    /*
     * SELF-TEST 2: shrink the refuse button and require the size rule to report
     * it. The CNIL's fines are about exactly this asymmetry, so the check for it
     * has to be one that fires.
     */
    const context = await browser.newContext()
    const page = await context.newPage()
    await load(page, BASE + '/')
    const asym = await page.evaluate(() => {
      const box = document.querySelector('#ts-consent')
      if (!box) return null
      const refuse = box.querySelector('button[name="rien"]')
      const accept = box.querySelector('button[name="tout"]')
      if (!refuse || !accept) return null
      refuse.style.fontSize = '9px'
      refuse.style.padding = '1px'
      const r = refuse.getBoundingClientRect()
      const a = accept.getBoundingClientRect()
      return Math.abs(r.height - a.height) <= 1 && Math.abs(r.width - a.width) <= 24
    })
    fired.push(['un bouton refuser rapetissé est vu', asym === false])
    await context.close()
  }

  await browser.close()

  /* ------------------------------------------------------------------ verdict */

  const silent = fired.filter(([, f]) => !f)
  if (silent.length > 0) {
    for (const [name] of silent) process.stdout.write(`  autotest MUET: ${name}\n`)
    die('un autotest n\'a pas tiré, le contrôle ne prouve rien')
  }

  if (results.length === 0) {
    die('rien n\'a été vérifié')
  }

  const failed = results.filter((r) => !r.pass)
  process.stdout.write(
    `\nconsent-verify: ${results.length - failed.length}/${results.length} assertions passées ` +
      `(autotests tirés : ${fired.map(([n]) => n).join(' ; ')}).\n`
  )
  for (const f of failed) process.stdout.write(`  ${f.name}${f.extra ? `  (${f.extra})` : ''}\n`)
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch((err) => die(`la vérification s'est interrompue : ${err && err.message ? err.message : err}`))
