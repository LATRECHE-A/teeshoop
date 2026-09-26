#!/usr/bin/env node
/**
 * The site, driven and photographed, and asserted while it is open.
 *
 *   node scripts/site-shots.mjs [base] [outDir]
 *
 * Seven pages at three widths, which is the evidence the session brief asks for.
 * It also ASSERTS, because a screenshot proves a page rendered and nothing else,
 * and because two of the things this session added cannot be checked any other
 * way:
 *
 *   THE FACET COUNTS ARE NOT DECORATIVE. Every number beside a checkbox claims
 *   "this many references remain if you tick me". The suite ticks one and counts
 *   what comes back. A count computed with the facet's own selection applied,
 *   which is the obvious and wrong way to write it, fails here.
 *
 *   THE FILTERS WORK WITHOUT JAVASCRIPT. The whole panel is a GET form on
 *   purpose. One pass runs with scripting disabled and submits it.
 *
 * Plus the things that are cheap to check and expensive to discover late: no
 * horizontal scroll at 375 px, one `h1` per page, an alt on every image, no
 * console error, no placeholder text left behind, and the headline price on the
 * homepage equal to the one the REST grid publishes.
 *
 * Exit: 0 all assertions passed - 1 an assertion failed - 2 nothing was asserted.
 */
import { chromium } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const BASE = (process.argv[2] || 'http://localhost:8080').replace(/\/$/, '')
const OUT = process.argv[3] || 'docs/screens/session09'
const WIDTHS = [375, 768, 1440]

const PAGES = [
  ['accueil', '/'],
  ['catalogue', '/shop/'],
  ['categorie', '/categorie/t-shirts/'],
  ['produit', '/produit/bc-e150-t-shirt-a-personnaliser-01542/'],
  ['studio', '/produit/bc-e150-t-shirt-a-personnaliser-01542/?personnaliser=1'],
  /*
   * DEUX FICHES, PARCE QU'IL Y A DEUX SORTES DE FICHES.
   *
   * Celle du dessus est une OFFRE de marquage : simple, achetable, au tarif du
   * studio, elle déclare le textile nu sur lequel elle est imprimée. Celle du
   * dessous est une fiche de CATALOGUE : variable, consultable et pas
   * achetable, avec ses déclinaisons, ses coloris et sa grille de tailles.
   * Elles ne rendent pas le même gabarit et une preuve qui n'en regarde qu'une
   * ne prouve rien sur l'autre.
   *
   * Le 4 septembre 2026 la fiche du dessus était `teeshoop-demo-tee`, un
   * montage sans photographie ni marque. Elle est sortie de la vente avec les
   * huit autres montages ; ce que le harnais ouvre maintenant est un produit
   * que le client peut vraiment acheter.
   */
  ['produit-catalogue', '/produit/russell-pure-organic-mens-pure-organic-tee/'],
  ['devis', '/devis/'],
  ['entreprises', '/entreprises/'],
  /*
   * The pages session 11 added. They are here rather than in a suite of their
   * own because every assertion below applies to them and to nothing else in
   * this file: one h1, no sideways scroll at 375 px, an alt on every image, no
   * placeholder text. A landing page is where placeholder text survives longest,
   * because nobody opens it twice.
   */
  ['associations', '/associations/'],
  ['clubs', '/clubs-sportifs/'],
  ['evenementiel', '/evenementiel/'],
  ['restauration', '/restauration/'],
  ['petites-series', '/petites-series/'],
  ['fichiers', '/fichiers-impression/'],
]

/* Words that must never survive into a shipped page. */
const PLACEHOLDERS = [/lorem ipsum/i, /\bTODO\b/, /\bFIXME\b/, /Sample Page/i, /\bplaceholder\b/i]

mkdirSync(OUT, { recursive: true })

/*
 * IS THE EDITOR'S OWN ORIGIN UP?
 *
 * The studio is served cross-origin by the Cloudflare Worker. This gate drives
 * the SHOP; it does not start a Worker, and `npm run verify:wp-e2e` is the one
 * that does, with a real browser, a real upload and a real cart. When the Worker
 * is not running the frame simply fails to connect, and the parent page logs the
 * failure. Failing the console assertion on that would be this gate reporting
 * that another gate's dependency is not running, which is noise, so it is stated
 * instead: what was not checked is printed, and only for that page.
 */
const shopAnswers = await (async () => {
  try {
    const res = await fetch(`${BASE}/wp-json/`, { cache: 'no-store' })
    if (!res.ok) return null
  } catch {
    return null
  }
  return true
})()
if (!shopAnswers) {
  console.error(`site-shots: ${BASE} does not answer. Start the mirror with npm run wp:up.`)
  process.exit(2)
}

const results = []
const skipped = []
const skip = (name, why) => {
  skipped.push({ name, why })
  console.log(`SKIP ${name}  ${why}`)
}
const ok = (name, pass, extra = '') => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`)
  return pass
}

/*
 * A VISITOR WHO HAS ALREADY DECIDED, for every pass that CLICKS something.
 *
 * The consent strip is pinned to the bottom of the viewport until a choice is
 * made, which is exactly what it is for, and it therefore sits over whatever is
 * at the bottom of the page. Playwright found it honestly: clicking a facet chip
 * timed out with « ts-consent subtree intercepts pointer events ». A real buyer
 * meets that strip once and then never again, so the interaction passes below
 * drive the shop as that buyer, with a recorded refusal. The SCREENSHOT pass
 * deliberately does not, because the banner is part of what the page looks like
 * on a first visit and has to be photographed.
 *
 * THE COOKIE IS EARNED AND NOT TYPED, and that is a fix. It used to be written
 * here as `v1:<date>:`, a hand-built copy of a format `Consent` owns. Session 12
 * bumped `Consent::VERSION` to 2, which is the manoeuvre that file documents for
 * when a purpose changes meaning, and from that moment the cookie was rejected as
 * no choice at all: every interaction below drove a page with the banner still
 * up, and the assertions that pass while it is there stopped meaning what their
 * names say. Nothing went red, which is the whole problem with a fixture that
 * copies a format.
 *
 * So the refusal is made once, by pressing the button a visitor presses, and the
 * cookie the shop wrote is reused. It cannot drift, and if the button ever stops
 * producing a cookie this harness stops rather than photographing a lie.
 */
let refusalCookie = null

const earnRefusal = async (browser) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(BASE + '/', { waitUntil: 'load' })
  await page.waitForFunction(() => document.readyState === 'complete')
  await page.click('#ts-consent button[name="rien"]')
  await page.waitForLoadState('load')
  const found = (await context.cookies()).find((c) => c.name === 'teeshoop_choix')
  await context.close()
  return found ? { name: found.name, value: found.value, url: BASE } : null
}

const decided = (context) => (refusalCookie ? context.addCookies([refusalCookie]) : Promise.resolve())

const browser = await chromium.launch()

refusalCookie = await earnRefusal(browser)
if (!refusalCookie) {
  process.stdout.write('site-shots: « Tout refuser » n\'a produit aucun cookie de choix, les passes « visiteur décidé » seraient fausses.\n')
  await browser.close()
  process.exit(2)
}

/* ------------------------------------------------------- the six pages -- */

for (const [name, path] of PAGES) {
  for (const width of WIDTHS) {
    const context = await browser.newContext({
      viewport: { width, height: width < 500 ? 900 : 1000 },
      deviceScaleFactor: 2,
      locale: 'fr-FR',
    })
    const page = await context.newPage()
    const noise = []
    page.on('pageerror', (e) => noise.push(`script: ${e.message.slice(0, 160)}`))
    page.on('console', (m) => {
      if (m.type() === 'error') noise.push(`console: ${m.text().slice(0, 160)}`)
    })

    const res = await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 60000 })
    ok(`[${width}] ${name} answers 200`, res && res.status() === 200, String(res && res.status()))

    /*
     * EVERY IMAGE PAINTED BEFORE THE PICTURE IS TAKEN (IMG-06). `networkidle`
     * does not wait for `loading="lazy"` images below the fold, so the 1440 px
     * home page shot showed an empty grey box where its photograph goes, and a
     * shot that shows a defect the page does not have would equally hide one it
     * does. Scroll to the bottom, wait for each image, and fail on one that
     * never loads: that makes the grey box a test.
     */
    await page.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += window.innerHeight / 2) {
        window.scrollTo(0, y)
        await new Promise((r) => setTimeout(r, 60))
      }
      window.scrollTo(0, 0)
    })
    const unpainted = await page
      .waitForFunction(
        () => [...document.images].filter((i) => i.getClientRects().length > 0).every((i) => i.complete),
        null,
        { timeout: 20000 },
      )
      .then(() =>
        page.evaluate(() =>
          [...document.images]
            .filter((i) => i.getClientRects().length > 0 && i.complete && i.naturalWidth === 0)
            .map((i) => i.currentSrc || i.src),
        ),
      )
      .catch(() => ['(des images ne finissent pas de charger)'])
    ok(`[${width}] ${name} paints every image it shows`, unpainted.length === 0, unpainted.slice(0, 2).join(' | '))

    await page.screenshot({ path: `${OUT}/${name}-${width}.png`, fullPage: true })

    /*
     * NO HORIZONTAL SCROLL. Mobile first is a claim and this is the number
     * behind it. The masthead broke this on every page at 375 px before it was
     * measured: 457 px of bar in a 375 px viewport.
     */
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth)
    ok(`[${width}] ${name} does not scroll sideways`, scrollW <= width, `${scrollW} px`)

    const h1s = await page.locator('main h1').count()
    ok(`[${width}] ${name} has exactly one h1`, h1s === 1, String(h1s))

    const noAlt = await page.evaluate(
      () => [...document.images].filter((i) => !i.hasAttribute('alt')).map((i) => i.currentSrc).slice(0, 3),
    )
    ok(`[${width}] ${name} gives every image an alt`, noAlt.length === 0, noAlt.join(' '))

    const text = await page.evaluate(() => document.body.innerText)
    const found = PLACEHOLDERS.filter((re) => re.test(text)).map(String)
    ok(`[${width}] ${name} ships no placeholder text`, found.length === 0, found.join(' '))

    /*
     * A ZERO IS NOT A SMALL NUMBER, IT IS AN ABSENT ONE.
     *
     * Question 01's answer of 1 September 2026 removed the 50,00 EUR HT order
     * floor and kept the five pieces. The plugin's copy was rewritten; four
     * templates in the theme were not, and went on printing the amount, so the
     * footer of every page of this site published « Commande minimum : 5 pièces
     * et 0,00 € » until 2 September. Every test passed the whole time, the
     * screenshots were taken, and nobody reading them saw it.
     *
     * So it is asserted rather than looked at. Any amount that renders as zero
     * on a page a customer reads is a setting that was emptied under a sentence
     * nobody moved. `0 %` is excluded on purpose: a discount tier that starts at
     * nothing is a real and meaningful zero.
     */
    const zeroes = [...text.matchAll(/(?:^|[^0-9,.])0(?:,00)?\s*(?:€|EUR\b)/g)].map((m) => m[0].trim())
    ok(`[${width}] ${name} publishes no amount that is zero`, zeroes.length === 0, zeroes.join(' | '))

    /*
     * `ERR_NETWORK_CHANGED` is Chromium saying the machine's network interface
     * moved under it, not the page saying anything. It is dropped by name,
     * here, rather than by widening the filter to "errors that mention a URL".
     */
    const ours = noise.filter((n) => !n.includes('ERR_NETWORK_CHANGED'))
    if ('studio' === name && ours.length > 0 && ours.every((n) => /Failed to load resource/.test(n))) {
      skip(
        `[${width}] ${name} logs nothing to the console`,
        'the editor is served by the Worker, which this gate does not start; npm run verify:wp-e2e drives it',
      )
    } else {
      ok(`[${width}] ${name} logs nothing to the console`, ours.length === 0, ours.slice(0, 2).join(' | '))
    }

    await context.close()
  }
}

/* ------------------------------------------ the numbers, against their source -- */

{
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'fr-FR' })
  await decided(context)
  const page = await context.newPage()

  /*
   * THE HOMEPAGE PRICE IS THE SHOP'S PRICE.
   *
   * `Pricing::grid()` is the authority; the REST route publishes it; the
   * homepage reads `Pricing::headline()`, which takes its anchors out of that
   * same grid. If a template ever formats a price itself, these two stop
   * agreeing here rather than on an invoice.
   */
  const grid = await (await fetch(`${BASE}/wp-json/teeshoop/v1/grid?garment=tee`)).json()
  const cells = (grid.rows || []).flatMap((r) => r.cells || [])
  const best = cells.filter((c) => !c.needs_quote).sort((a, b) => a.unit_ht - b.unit_ht)[0]

  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  const fact = (await page.locator('.ts-facts__value').first().innerText()).replace(/\s/g, ' ')
  const expected = (best.unit_ht / 100).toFixed(2).replace('.', ',')
  ok('the homepage price is the one the grid publishes', fact.includes(expected), `${fact.trim()} vs ${expected}`)

  /*
   * THE PRINT ZONE ON THE HOMEPAGE IS THE ONE THE STUDIO GENERATED.
   *
   * `data/garments.json` is generated from the studio's own definitions and
   * `npm run verify:garments` fails when they diverge. This checks the third
   * copy, the one a customer reads.
   */
  /*
   * READ IT, DO NOT ASSUME IT ANSWERS. This fetched and parsed in one expression
   * and threw an unhandled SyntaxError on 1 September 2026, after all 235 page
   * checks had passed: the mirror answers 403 for that directory now, so
   * `JSON.parse` was handed an Apache error page. A harness that dies on a
   * stack trace has not failed, it has stopped, and the difference matters
   * because everything after this point went unchecked without a word.
   */
  /*
   * READ FROM DISK, NOT OVER HTTP, and the difference is not convenience.
   *
   * This fetched `${BASE}/wp-content/plugins/.../data/garments.json` and parsed
   * it in one expression, and on 1 September 2026 it threw an unhandled
   * SyntaxError after all 235 page checks had passed: the mirror answers 403 for
   * that directory, so `JSON.parse` was handed an Apache error page and
   * everything below went unchecked without a word.
   *
   * A 403 there is the server being RIGHT, incidentally: nothing needs that file
   * to be public. What this check wants is the generated geometry, and the file
   * on disk is that geometry, so it reads it where it lives. Unreadable is still
   * a failure and never a skip.
   */
  const garmentsPath = join(ROOT, 'wp-plugins/teeshoop-core/data/garments.json')
  let garments = null
  try {
    garments = JSON.parse(readFileSync(garmentsPath, 'utf8'))
  } catch (e) {
    ok(
      'la géométrie générée du studio est lisible',
      false,
      `${garmentsPath} : ${e.message}. Les contrôles de zone d'impression n'ont PAS eu lieu.`,
    )
  }
  if (garments) {
    const tee = garments.garments.tee
    const priced = tee.pricedSize
    const front = tee.areas.find((a) => a.side === 'front').bySize[priced]
    const zoneText = await page.locator('.ts-zone').innerText()
    const w = String(front.wCm).replace('.', ',')
    const h = String(front.hCm).replace('.', ',')
    ok(
      'the printed zone on the homepage is the generated one',
      zoneText.includes(w) && zoneText.includes(h),
      `${w} x ${h} cm`,
    )
  }

  /* The quote path is one click from every page. */
  const devisHref = await page.locator('.ts-mast__quote').getAttribute('href')
  ok('the quote page is one click from the masthead', /\/devis\/?$/.test(devisHref || ''), devisHref || '')

  /*
   * THE FACET COUNTS ARE HONEST.
   *
   * Read the number beside the first checkbox of the brand facet, tick it,
   * submit, and count what the listing shows. They have to be the same number.
   */
  await page.goto(BASE + '/categorie/t-shirts/', { waitUntil: 'networkidle' })
  const chip = page.locator('.ts-facet:has(legend:text-is("Marque")) .ts-chip').first()
  const claimed = Number((await chip.locator('.ts-chip__n').innerText()).replace(/\D/g, ''))
  await chip.click()
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }),
    page.locator('.ts-filters .ts-cta').click(),
  ])
  /*
   * Compared against the LISTING'S OWN TOTAL, not against the number of `li`
   * elements on screen. Counting the cards works only while the result fits on
   * one page: the day a facet returns more than `loop_shop_per_page` the
   * assertion would fail on pagination and say nothing about the count.
   */
  const shown = Number(((await page.locator('.ts-shop__count').innerText()) || '').replace(/\D/g, ''))
  const cards = await page.locator('ul.products li.product').count()
  ok(
    'a facet count is what the facet actually returns',
    claimed === shown,
    `annoncé ${claimed}, obtenu ${shown} (${cards} sur cette page)`,
  )

  const applied = await page.locator('.ts-applied__item').count()
  ok('the applied filter says so and can be removed', applied === 1, `${applied} chip(s)`)

  /* A filtered listing is not a page to index. */
  const robots = await page.locator('meta[name="robots"]').getAttribute('content')
  ok('a filtered listing is noindex', /noindex/.test(robots || ''), robots || '(aucune)')

  await context.close()
}

/* --------------------------------------------------- the colour facet -- */

/*
 * FOUR HUNDRED AND FORTY-TWO NAMES, ELEVEN FAMILIES, AND NOT ONE INVENTED
 * COLOUR.
 *
 * The swatches are measured (`Swatch` in the plugin, `docs/couleurs.json` for
 * the record). What is checked here is the chain from that measurement to the
 * pixel a buyer sees, and the two ways it could lie: a swatch that is not the
 * colour that was measured, and a swatch drawn for a colour nothing could be
 * measured for.
 */
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await decided(context)
  const page = await context.newPage()
  await page.goto(BASE + '/shop/', { waitUntil: 'networkidle' })

  const groups = await page.locator('.ts-fam__group').count()
  ok('the colour facet is grouped rather than one long list', groups >= 2, `${groups} groupe(s)`)

  /*
   * WCAG 1.4.1: colour is never the only signal. Every swatch has the maker's
   * own name beside it, which is also what the checkbox is labelled with.
   */
  const nameless = await page.evaluate(() =>
    [...document.querySelectorAll('.ts-chip__swatch')].filter((sw) => {
      const label = sw.parentElement?.querySelector('.ts-chip__label')
      return !label || !label.textContent.trim()
    }).length,
  )
  ok('every swatch carries the maker’s name beside it', nameless === 0, `${nameless} sans nom`)

  /*
   * THE GROUP THAT MUST HAVE NO COLOURS IN IT. A colour nothing could be
   * measured for is shown, because dropping it would put its references out of
   * reach, and it is shown WITHOUT a swatch, because we do not invent one.
   */
  const unmeasured = page.locator('.ts-fam__group', { hasText: 'Non mesurés' }).first()
  if (await unmeasured.count()) {
    const invented = await unmeasured.locator('.ts-chip__swatch').count()
    ok('an unmeasured colour is shown and gets no swatch', invented === 0, `${invented} inventée(s)`)
  } else {
    skipped.push({ name: 'an unmeasured colour gets no swatch', why: 'every colour was measured' })
  }

  /*
   * THE SWATCH ON SCREEN IS THE VALUE THAT WAS MEASURED. Read what the browser
   * actually computed for one chip and compare it with the committed record,
   * which is the whole chain: photograph, Swatch, term meta, template, CSS.
   */
  /*
   * A HARNESS THAT CANNOT LOOK SAYS SO AND CARRIES ON. The record is generated,
   * not built here, so on a fresh clone it may not exist yet. Reading it bare
   * threw out of the module and took the keyboard and no-script gates below
   * down with it, while the run still ended on the exit code of what HAD
   * passed.
   */
  let ledger = null
  try {
    ledger = JSON.parse(readFileSync(join(ROOT, 'docs/couleurs.json'), 'utf8'))
  } catch (e) {
    skipped.push({
      name: 'the swatch drawn is the colour that was measured',
      why: `docs/couleurs.json unreadable (${e.code ?? e.message}); run npm run couleurs:relever`,
    })
  }
  const known = new Map((ledger?.couleurs ?? []).filter((r) => r.pastille).map((r) => [r.nom, r.pastille]))
  const drawn = await page.evaluate(() =>
    [...document.querySelectorAll('.ts-chip__swatch')].slice(0, 40).map((sw) => ({
      name: sw.parentElement?.querySelector('.ts-chip__label')?.textContent.trim() ?? '',
      bg: getComputedStyle(sw).backgroundColor,
      // A two-tone swatch is a linear-gradient, which is a background IMAGE:
      // its backgroundColor is transparent and reading only that compared nine
      // real raglans against the wrong property and called them wrong.
      image: getComputedStyle(sw).backgroundImage,
      border: getComputedStyle(sw).borderTopColor,
    })),
  )
  const rgbOf = (hex) => {
    const n = parseInt(hex.slice(1), 16)
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
  }
  const compared = drawn.filter((d) => known.has(d.name))
  const wrong = compared.filter((d) => {
    const stops = known.get(d.name)
    if (stops.length === 1) return d.bg !== rgbOf(stops[0])
    // Both halves have to be in the gradient, in the order the record gives.
    const a = d.image.indexOf(rgbOf(stops[0]))
    const b = d.image.indexOf(rgbOf(stops[1]))
    return a < 0 || b < 0 || a > b
  })
  const twoTone = compared.filter((d) => known.get(d.name).length > 1).length
  if (ledger) {
    ok(
      'the swatch drawn is the colour that was measured',
      compared.length > 0 && wrong.length === 0,
      `${compared.length} comparée(s) dont ${twoTone} bicolore(s), ${wrong.length} fausse(s)` +
        (wrong.length ? `: ${wrong[0].name} ${wrong[0].bg} ${wrong[0].image}` : ''),
    )
  }

  /*
   * WCAG 1.4.11 asks 3:1 for the boundary of a control. « White » and « Off
   * White » are real articles and their swatches are invisible on the panel
   * without one.
   */
  const lum = (rgb) => {
    const [r, g, b] = rgb.match(/\d+/g).map(Number).map((v) => {
      const c = v / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const panel = await page.evaluate(() => getComputedStyle(document.querySelector('.ts-fam__list')).backgroundColor)
  const edges = compared.map((d) => {
    const a = lum(d.border)
    const b = lum(panel)
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  })
  const worst = edges.length ? Math.min(...edges) : 0
  ok('every swatch has an edge a person can see', worst >= 3, `${worst.toFixed(2)}:1 au pire`)

  /*
   * AN OPEN FAMILY IS STILL SURVIVABLE ON A PHONE. « Bleus » holds ninety-six
   * names; without a cap on the open group the buyer swipes past all of them to
   * reach the next facet, which is the failure the flat list had.
   */
  const openTall = await page.evaluate(() => {
    /*
     * OPEN THE BIGGEST GROUP FIRST. A shut `<details>` has a zero-height list,
     * so measuring whatever is there measures nothing and the check passes on
     * every page whatever the CSS says: a gate that cannot fail.
     */
    const groups = [...document.querySelectorAll('.ts-fam__group')]
    if (!groups.length) return null
    const biggest = groups.reduce((a, b) =>
      b.querySelectorAll('.ts-fam__list > li').length > a.querySelectorAll('.ts-fam__list > li').length ? b : a,
    )
    biggest.open = true
    const el = biggest.querySelector('.ts-fam__list')
    return {
      names: el.querySelectorAll('li').length,
      h: el.getBoundingClientRect().height,
      view: window.innerHeight,
      scrolls: el.scrollHeight > el.clientHeight + 1,
    }
  })
  if (openTall) {
    ok(
      'an open colour family is bounded rather than endless',
      openTall.names > 12 && openTall.h > 0 && openTall.h <= openTall.view,
      `${openTall.names} coloris, ${Math.round(openTall.h)} px pour ${openTall.view} px de fenêtre${openTall.scrolls ? ', défile' : ''}`,
    )
  }

  /*
   * THE FAMILY IS A REAL FILTER, not a heading. Tick « Tous les bleus » and
   * the listing has to return the number the chip promised.
   */
  const family = page.locator('.ts-chip--all').first()
  if (await family.count()) {
    /*
     * OPEN THE GROUP BEFORE READING IT. `innerText` returns '' for anything
     * inside a shut `<details>`, so the claimed count came back as 0 and the
     * check only passed while the listing also returned 0.
     */
    await family.locator('..').locator('..').locator('..').locator('summary').click().catch(() => {})
    const label = (await family.locator('.ts-chip__label').innerText()).trim()
    const claimed = Number((await family.locator('.ts-chip__n').innerText()).replace(/\D/g, ''))
    await family.click()
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }),
      page.locator('.ts-filters .ts-cta').click(),
    ])
    const shown = Number(((await page.locator('.ts-shop__count').innerText()) || '').replace(/\D/g, ''))
    ok(
      'a colour family filters, and returns what it promised',
      /f_famille/.test(page.url()) && claimed === shown,
      `${label}: annoncé ${claimed}, obtenu ${shown}`,
    )

    /*
     * A SHARED URL DOES NOT HIDE ITS OWN CRITERIA. The group holding what is
     * selected arrives open, whatever a script does afterwards.
     */
    const open = await page.locator('.ts-fam__group[open]').count()
    ok('the chosen family arrives open', open >= 1, `${open} ouvert(s)`)
  } else {
    skipped.push({ name: 'a colour family filters', why: 'no family has references in this shop' })
  }

  await context.close()
}

/* ------------------------------------------------ keyboard, and the names -- */

/*
 * WHAT A PERSON WITHOUT A MOUSE CAN DO.
 *
 * Session 12 audits accessibility, and the session brief is explicit that
 * retrofitting focus is the one thing that cannot be done cheaply later. These
 * five are the load-bearing ones, and they are asserted rather than checked
 * once, because a checked-once claim decays on the next stylesheet.
 */
{
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'fr-FR' })
  await decided(context)
  const page = await context.newPage()
  await page.goto(BASE + '/categorie/t-shirts/', { waitUntil: 'networkidle' })

  await page.keyboard.press('Tab')
  const first = await page.evaluate(() => {
    const el = document.activeElement
    const cs = getComputedStyle(el)
    return {
      cls: (el.className || '').toString(),
      onScreen: el.getBoundingClientRect().left >= 0,
      ring: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0,
    }
  })
  ok('the first tab stop is the skip link', first.cls.includes('ts-skip'), first.cls)
  ok('and it becomes visible, with a focus ring', first.onScreen && first.ring, JSON.stringify(first))

  await page.evaluate(() => document.activeElement.blur())

  /*
   * FOCUS IS MOVED INTO THE MENU FIRST, or the assertion is vacuous.
   *
   * Clicking the button leaves focus on the button, so "focus is on the button
   * after Escape" is true whether or not anything hands it back. Checked by
   * deleting `burger.focus()` from site.js: the first version of this assertion
   * still passed. A person who opens the menu is inside it by the time they give
   * up on it, and that is the state that has to be tested.
   */
  await page.locator('.ts-burger').click()
  const opened = await page.locator('#ts-nav').evaluate((e) => e.classList.contains('is-open'))
  await page.locator('#ts-nav a').first().focus()
  const inside = await page.evaluate(() => !!document.activeElement.closest('#ts-nav'))
  await page.keyboard.press('Escape')
  const closed = await page.evaluate(() => ({
    open: document.getElementById('ts-nav').classList.contains('is-open'),
    onBurger: document.activeElement.classList.contains('ts-burger'),
  }))
  ok(
    'escape closes the menu and hands focus back',
    opened && inside && !closed.open && closed.onBurger,
    JSON.stringify({ opened, inside, ...closed }),
  )

  await page.locator('.ts-filters__toggle').focus()
  await page.keyboard.press('Enter')
  ok(
    'the filter panel opens from the keyboard',
    await page.locator('#ts-filters-body').evaluate((e) => e.classList.contains('is-open')),
  )

  /*
   * A control with no accessible name is a control a screen reader announces as
   * "button". The chips hide their checkbox visually and must never hide it from
   * the accessibility tree, which is why they are a `<label>` and not a `<div>`.
   */
  const nameless = await page.evaluate(() =>
    [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea')]
      .filter((el) => {
        /*
         * THE ALT OF A NESTED IMAGE IS A NAME, and leaving it out was a false
         * positive rather than a strictness.
         *
         * « Name from content » in the accname algorithm walks the subtree, and
         * an `img` contributes its `alt`. A logo link, which is the canonical
         * shape `<a><img alt="Teeshoop"></a>`, has the accessible name
         * « Teeshoop » and is announced « Teeshoop, lien ». This check reported
         * it as nameless the night the logo was put in, on a link that was
         * correct, and the only ways to satisfy it would have been to add a
         * redundant `aria-label` (which a reader would then announce INSTEAD of
         * the alt) or visible text beside the mark.
         *
         * A check that is wrong in the safe direction is still wrong: it teaches
         * whoever hits it to work around it, and the workaround is worse markup.
         */
        const fromImages = [...el.querySelectorAll('img[alt]')].map((i) => i.getAttribute('alt')).join(' ')
        const name =
          el.getAttribute('aria-label') ||
          el.textContent ||
          fromImages ||
          el.getAttribute('title') ||
          (el.labels && el.labels[0] && el.labels[0].textContent) ||
          el.getAttribute('placeholder') ||
          ''
        return name.trim() === ''
      })
      .map((el) => el.tagName.toLowerCase() + '.' + (el.className || '').toString().slice(0, 40))
      .slice(0, 5),
  )
  ok('every control has an accessible name', nameless.length === 0, nameless.join(' '))

  await context.close()
}

/* --------------------------------------------------- and without a script -- */

{
  const context = await browser.newContext({
    viewport: { width: 375, height: 900 },
    locale: 'fr-FR',
    javaScriptEnabled: false,
  })
  await decided(context)
  const page = await context.newPage()
  await page.goto(BASE + '/categorie/t-shirts/', { waitUntil: 'domcontentloaded' })

  const navVisible = await page.locator('#ts-nav a').first().isVisible()
  ok('the navigation is reachable with no script', navVisible)

  const panelVisible = await page.locator('.ts-filters__body').isVisible()
  ok('the filter panel is open with no script', panelVisible)

  /*
   * Clicked through the LABEL, the way a person does. The checkbox itself is
   * visually replaced by the chip (never removed from the accessibility tree),
   * so a direct `.check()` on the input is not a real interaction and Playwright
   * says so: "span.ts-chip__label intercepts pointer events".
   */
  const chip = page.locator('.ts-facet:has(legend:text-is("Marque")) .ts-chip').first()
  await chip.click()
  const checked = await chip.locator('input').isChecked()
  ok('a facet chip toggles its checkbox with no script', checked)
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }),
    page.locator('.ts-filters .ts-cta').click(),
  ])
  ok('the filters submit with no script', /f_marque/.test(page.url()), page.url())

  await context.close()
}

/* --------------------------------------------- la démonstration du vêtement -- */

/*
 * LE VÊTEMENT DE L'ACCUEIL CHANGE VRAIMENT DE COULEUR, ET SANS SCRIPT.
 *
 * ── CE QUI EST EN JEU ────────────────────────────────────────────────────────
 *
 * Le bandeau d'accueil dessine le gabarit du studio et le peint avec la
 * pastille MESURÉE du coloris, avec un nuancier de dix-sept boutons. Trois
 * pannes sont possibles et aucune ne se voit sur une capture d'écran :
 *
 *   1. le jeton `__COLOR__` disparaît du dessin engendré, et les dix-sept
 *      boutons repeignent tous la même couleur ;
 *   2. la règle `:has()` n'est pas écrite, et le nuancier ne marche que si le
 *      script tourne, sur un site dont c'est justement la règle qu'il ne le
 *      faut pas ;
 *   3. la cote imprimée sous le rectangle cesse d'être celle que le studio
 *      publie, et un acheteur dimensionne son logo sur un chiffre faux.
 *
 * Les trois sont mesurées ici. La deuxième l'est EN PIXELS, dans un contexte
 * sans JavaScript : il n'y a pas d'`evaluate()` sans script, donc la seule
 * preuve possible que le vêtement a changé est que l'image a changé.
 *
 * UNE BOUTIQUE SANS NUANCIER N'EST PAS UNE PANNE. `demo_source()` refuse de
 * dessiner quand le premier produit personnalisable n'a pas de palette mesurée,
 * et le bandeau retombe sur la photographie. C'est un SKIP nommé et jamais un
 * succès silencieux.
 */
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'fr-FR' })
  await decided(context)
  const page = await context.newPage()
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })

  const present = (await page.locator('[data-teeshoop="demo-accueil"]').count()) > 0

  if (!present) {
    skip(
      'le vêtement de l’accueil change de couleur',
      'aucune démonstration sur cette boutique : le premier produit personnalisable n’a ni dessin ni nuancier mesuré, et le bandeau montre la photographie',
    )
  } else {
    // 380 ms de transition, plus une marge : lue trop tôt, une propriété
    // personnalisée enregistrée en <color> rend une teinte intermédiaire.
    const settle = () => page.waitForTimeout(650)

    const swatches = await page.evaluate(() =>
      [...document.querySelectorAll('.ts-demo__radio')].map((r) => ({ id: r.id, tint: r.dataset.tint, checked: r.checked })),
    )
    ok('le nuancier propose plus d’un coloris, sinon ce n’est pas un choix', swatches.length > 1, `${swatches.length}`)
    ok(
      'chaque pastille porte un hexadécimal et pas un nom',
      swatches.every((s) => /^#[0-9a-fA-F]{6}$/.test(s.tint || '')),
      swatches.map((s) => s.tint).join(' '),
    )

    /*
     * LA COULEUR PEINTE EST CELLE DU BOUTON COCHÉ. On lit le `fill` calculé de
     * l'élément qui porte la variable, pas la variable : c'est ce qu'un visiteur
     * a sous les yeux, et c'est la seule lecture qui attrape un dessin dont le
     * jeton a disparu.
     */
    const clothFill = () =>
      page.evaluate(() => {
        const cloth = document.querySelector('.ts-demo__svg [fill*="--ts-demo-tint"]')
        return cloth ? getComputedStyle(cloth).fill : ''
      })
    const asRgb = (hex) =>
      `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`

    await settle()
    const opening = swatches.find((s) => s.checked)
    ok('un coloris est coché à l’ouverture', Boolean(opening), JSON.stringify(opening ?? null))
    if (opening) {
      ok('le tissu est peint de la teinte du bouton coché', (await clothFill()) === asRgb(opening.tint), await clothFill())
    }

    /*
     * DEUX BOUTONS DIFFÉRENTS DONNENT DEUX COULEURS DIFFÉRENTES. C'est la
     * panne n° 1 : un dessin qui a perdu son jeton passe tout le reste.
     */
    const others = swatches.filter((s) => !s.checked)
    if (others.length > 0) {
      const target = others[others.length - 1]
      await page.locator(`label[for="${target.id}"]`).click()
      await settle()
      ok(
        'choisir un autre coloris repeint le vêtement de CETTE teinte',
        (await clothFill()) === asRgb(target.tint),
        `${target.id} attendu ${asRgb(target.tint)}, obtenu ${await clothFill()}`,
      )
    }

    /*
     * LA COTE EST CELLE QUE LE STUDIO PUBLIE. Le rectangle vient de
     * `garment-art.json` et la légende de `garments.json` : deux fichiers, une
     * seule vérité, et c'est ici qu'on le vérifie sur ce qu'un client lit.
     */
    const garments = JSON.parse(readFileSync(join(ROOT, 'wp-plugins/teeshoop-core/data/garments.json'), 'utf8'))
    const tee = garments.garments?.tee
    const front = (tee?.areas ?? []).find((a) => a.side === 'front')
    const priced = front?.bySize?.[tee?.pricedSize]
    if (priced) {
      const cote = (await page.locator('.ts-demo__dim').innerText()).replace(/\s/g, ' ')
      const attendu = [priced.wCm, priced.hCm].map((v) => String(v).replace('.', ','))
      ok(
        'la cote dessinée sur le vêtement est celle que le studio publie',
        attendu.every((v) => cote.includes(v)),
        `« ${cote.trim()} » doit contenir ${attendu.join(' et ')}`,
      )
    } else {
      skip('la cote dessinée est celle du studio', 'garments.json ne publie pas la taille tarifée du tee')
    }

    await context.close()

    /*
     * ET MAINTENANT SANS SCRIPT. Contexte neuf, `javaScriptEnabled: false`.
     * La preuve est photographique parce qu'elle ne peut pas être autre chose.
     */
    const muet = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'fr-FR', javaScriptEnabled: false })
    const sansJs = await muet.newPage()
    await sansJs.goto(BASE + '/', { waitUntil: 'load' })

    const cible = swatches.filter((s) => !s.checked)
    if (cible.length > 0) {
      const stage = sansJs.locator('.ts-demo__stage')
      const avant = await stage.screenshot()
      await sansJs.locator(`label[for="${cible[0].id}"]`).click()
      ok('une étiquette coche son bouton sans script', await sansJs.locator(`#${cible[0].id}`).isChecked())
      const apres = await stage.screenshot()
      ok(
        'et le vêtement se repeint vraiment sans une ligne de script',
        !avant.equals(apres),
        `${avant.length} puis ${apres.length} octets`,
      )
    }
    await muet.close()
  }
}

await browser.close()

const failed = results.filter((r) => !r.pass)
if (results.length === 0) {
  console.error('site-shots: nothing was asserted, which is not the same as everything passing.')
  process.exit(2)
}
console.log(
  `\nsite-shots ${failed.length ? 'FAIL' : 'PASS'}: ${results.length - failed.length}/${results.length} assertions` +
    (skipped.length ? `, ${skipped.length} skipped and said so` : '') +
    `, ${PAGES.length * WIDTHS.length} shots in ${OUT}`,
)
for (const s of skipped) console.log(`  not checked: ${s.name} - ${s.why}`)
process.exit(failed.length ? 1 : 0)
