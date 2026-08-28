#!/usr/bin/env node
/**
 * Every page type loaded under the real policy, with every violation collected.
 *
 *   node scripts/csp-verify.mjs                 the mirror and a local worker
 *   node scripts/csp-verify.mjs --self-test     proves it can see a violation
 *
 * A Content Security Policy is the one security header whose failure looks like
 * a broken feature rather than an error: a blocked script does not throw where
 * anybody catches it, it simply does not run. So the only way to know a policy
 * is survivable is to load every page under it in a real browser and read what
 * the browser refused.
 *
 * `securitypolicyviolation` fires for a Report-Only policy exactly as it does
 * for an enforcing one, which is what makes a staged rollout measurable instead
 * of hopeful: the shop ships Report-Only (it cannot be exercised against a real
 * Stripe payment here, see includes/Csp.php) and this reads what an enforcing
 * policy WOULD have blocked.
 *
 * THE HEADER IS CHECKED TWICE PER PAGE, and that is not belt and braces. The
 * shop's policy is emitted from PHP, and a page served from the LiteSpeed cache
 * on o2switch does not run PHP. A header that is present on the first request
 * and gone on the second is the exact shape of that failure, and it would
 * otherwise be discovered in production by nobody.
 *
 * Exit: 0 no violation - 1 a violation or a missing header - 2 nothing was
 * measured, which is never a pass.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit === undefined ? d : hit.slice(n.length + 3)
}
const SHOP = arg('shop', 'http://localhost:8080').replace(/\/$/, '')
const STUDIO = arg('studio', 'http://127.0.0.1:8788').replace(/\/$/, '')
const SELF_TEST = process.argv.includes('--self-test')
const COMPOSE = ['compose', '-f', 'wp-local/docker-compose.yml', 'run', '--rm', '-T', 'wpcli']

let pass = 0
let fail = 0
const ok = (what, cond, detail = '') => {
  if (cond) {
    pass++
    console.log(`  ✓ ${what}${detail ? `   ${detail}` : ''}`)
  } else {
    fail++
    console.log(`  ✗ ${what}${detail ? `   ${detail}` : ''}`)
  }
}
const bail = (m) => {
  console.error(`\ncsp-verify: ${m}`)
  process.exit(2)
}

/** Records every refusal the browser makes, from before the document exists. */
const COLLECTOR = `
window.__csp = [];
document.addEventListener('securitypolicyviolation', (e) => {
  window.__csp.push({
    directive: e.effectiveDirective || e.violatedDirective,
    blocked: String(e.blockedURI || '').slice(0, 160),
    disposition: e.disposition,
    sample: String(e.sample || '').slice(0, 80),
    line: e.lineNumber,
  });
});
`

/*
 * THE PAGES. The buying path plus everything the Worker serves as a document.
 * `cart` and `checkout` need a basket, or they render their empty state and the
 * two pages with the most JavaScript in the shop are never tested.
 */
const SHOP_PAGES = [
  { key: 'accueil', path: '/' },
  { key: 'categorie', path: '/categorie/manches-courtes/' },
  { key: 'produit', path: '/produit/bc-e150-women-t-shirt/' },
  { key: 'produit-studio', path: '/produit/teeshoop-e2e-tee/' },
  { key: 'mentions', path: '/mentions-legales/' },
  { key: 'panier', path: '/cart/', cart: true },
  { key: 'commander', path: '/checkout/', cart: true },
]
const WORKER_PAGES = [
  { key: 'studio', path: '/' },
  { key: 'viewer', path: '/v/aaaaaaaaaa' },
]

const cspOf = (headers) =>
  headers['content-security-policy'] || headers['content-security-policy-report-only'] || ''

/**
 * The policy on two consecutive requests.
 *
 * COMPARED WITH THE NONCE REMOVED, which is a correction: the first version
 * compared the two header strings directly and reported every page as failing,
 * because a nonce that did NOT change between requests would be the bug. What
 * has to be identical is the policy; what has to differ is the nonce, and they
 * are asserted separately.
 */
const withoutNonce = (p) => p.replace(/'nonce-[^']+'/g, "'nonce-X'")

async function headerTwice(url) {
  const seen = []
  for (let i = 0; i < 2; i++) {
    const res = await fetch(url, { redirect: 'manual' })
    const h = Object.fromEntries([...res.headers].map(([k, v]) => [k.toLowerCase(), v]))
    seen.push(cspOf(h))
  }
  return seen
}

async function drive(browser, url, { storageState, injectViolation } = {}) {
  const context = await browser.newContext({ storageState })
  await context.addInitScript(COLLECTOR)
  const page = await context.newPage()
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 120000 })
    if (injectViolation) {
      /*
       * The self-test. A page that loads an image from an origin no policy
       * allows must produce a violation; if it does not, this harness is not
       * reading anything and every tick above it is decoration.
       */
      await page.evaluate(() => {
        const img = new Image()
        img.src = 'https://csp-self-test.invalid/pixel.png'
        document.body.appendChild(img)
      })
    }
    await page.waitForTimeout(injectViolation ? 2500 : 3500)
    const violations = await page.evaluate(() => window.__csp || [])
    return violations
  } finally {
    await context.close()
  }
}

async function cartState(browser) {
  const raw = execFileSync(
    'docker',
    [
      ...COMPOSE,
      'eval',
      "global $wpdb; echo (int) $wpdb->get_var(\"SELECT p.ID FROM {$wpdb->posts} p JOIN {$wpdb->prefix}wc_product_meta_lookup l ON l.product_id=p.ID WHERE p.post_type='product' AND p.post_status='publish' AND l.min_price>0 AND NOT EXISTS (SELECT 1 FROM {$wpdb->postmeta} m WHERE m.post_id=p.ID AND m.meta_key='_teeshoop_garment' AND m.meta_value<>'') LIMIT 1\");",
    ],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const id = Number((raw.match(/(\d+)\s*$/) || [])[1])
  if (!id) return undefined
  const ctx = await browser.newContext()
  const p = await ctx.newPage()
  await p.goto(`${SHOP}/?add-to-cart=${id}&quantity=2`, { waitUntil: 'load', timeout: 120000 })
  const state = await ctx.storageState()
  await ctx.close()
  return state
}

/**
 * REFUSALS THAT ARE KNOWN, WITH THE REASON AND WHAT IT WOULD TAKE TO REMOVE THEM.
 *
 * A harness people expect to fail is a harness people stop reading. Anything on
 * this list is reported and does not fail the run; anything NOT on it does, so a
 * new refusal is still an error. Each entry is narrow on purpose: the page, the
 * directive and a bound on how many, so a different violation of the same
 * directive on the same page is not silently absorbed.
 */
const KNOWN = [
  {
    page: 'produit',
    directive: 'script-src-attr',
    max: 2,
    why:
      'WooCommerce puts onload="this.width = this.naturalWidth; …" on the two product gallery ' +
      'images (wc_get_gallery_image_html), to size them for flexslider. It is their code and it ' +
      'is a layout fix, so removing it through woocommerce_gallery_image_html_attachment_image_params ' +
      'needs a gallery test this session did not build. Enforcing the policy means either that, or ' +
      "relaxing script-src-attr to 'unsafe-inline', which is the weaker of the two.",
  },
]

function report(where, violations) {
  const real = violations.filter((v) => v.blocked !== 'about:blank')
  if (real.length === 0) {
    ok(`${where} loads with nothing refused`, true)
    return
  }
  const grouped = new Map()
  for (const v of real) {
    const k = `${v.directive} <- ${v.blocked || v.sample || 'inline'}`
    grouped.set(k, (grouped.get(k) || 0) + 1)
  }
  const unexpected = real.filter(
    (v) => !KNOWN.some((k) => k.page === where && k.directive === v.directive),
  )
  const overCount = KNOWN.filter(
    (k) => k.page === where && real.filter((v) => v.directive === k.directive).length > k.max,
  )

  if (unexpected.length === 0 && overCount.length === 0) {
    ok(`${where} refuses only what is on the known list`, true, `${real.length} connu(s)`)
    for (const k of KNOWN.filter((k) => k.page === where)) console.log(`      connu : ${k.directive}, ${k.why.slice(0, 110)}…`)
    return
  }
  ok(`${where} loads with nothing unexpected refused`, false, `${unexpected.length} inattendu(s)`)
  for (const [k, n] of grouped) console.log(`      ${n}x  ${k}`)
  for (const k of overCount) console.log(`      plus de refus que les ${k.max} attendus pour ${k.directive}`)
}

async function main() {
  console.log(`csp-verify\n  boutique : ${SHOP}\n  studio   : ${STUDIO}\n`)

  const browser = await chromium.launch()
  try {
    if (SELF_TEST) {
      console.log('Autotest : une image depuis une origine qu’aucune politique n’autorise\n')
      const v = await drive(browser, `${STUDIO}/`, { injectViolation: true })
      const saw = v.some((x) => String(x.blocked).includes('csp-self-test.invalid') || x.directive.includes('img'))
      ok('the harness sees a deliberate violation', saw, JSON.stringify(v.slice(0, 2)))
      if (!saw) {
        console.error('\ncsp-verify --self-test : le collecteur ne voit rien, tout le reste ne prouve rien.')
        process.exit(1)
      }
      console.log('\ncsp-verify --self-test : le collecteur voit bien un refus.')
      return
    }

    // ------------------------------------------------------------ la boutique
    console.log('A. La boutique WordPress')
    let state
    try {
      state = await cartState(browser)
    } catch (e) {
      console.log(`  (le panier n’a pas pu être rempli : ${String(e.message).slice(0, 90)})`)
    }
    for (const p of SHOP_PAGES) {
      const url = SHOP + p.path
      const [first, second] = await headerTwice(url)
      ok(`${p.key} sends a policy`, first !== '', first ? `${first.length} caractères` : 'aucun en-tête')
      ok(
        `${p.key} still sends it on a second request`,
        first !== '' && withoutNonce(second) === withoutNonce(first),
        withoutNonce(second) === withoutNonce(first)
          ? 'identique'
          : 'DIFFÉRENTE ou absente : un cache sert la page sans PHP',
      )
      report(p.key, await drive(browser, url, { storageState: p.cart ? state : undefined }))
    }

    // --------------------------------------------------------------- le worker
    console.log('\nB. Ce que le Worker sert')
    for (const p of WORKER_PAGES) {
      const url = STUDIO + p.path
      const [first, second] = await headerTwice(url)
      ok(`${p.key} sends a policy`, first !== '', first ? `${first.length} caractères` : 'aucun en-tête')
      ok(`${p.key} still sends it on a second request`, first !== '' && withoutNonce(second) === withoutNonce(first))
      /*
       * The nonce must differ between two requests, or it is not a nonce. A
       * constant "nonce" is `'unsafe-inline'` spelled at greater length.
       */
      if (p.key === 'studio') {
        const a = (first.match(/'nonce-([^']+)'/) || [])[1]
        const b = (second.match(/'nonce-([^']+)'/) || [])[1]
        ok('and a different nonce each time', Boolean(a && b && a !== b), `${a?.slice(0, 8)} / ${b?.slice(0, 8)}`)
      }
      report(p.key, await drive(browser, url))
    }
  } finally {
    await browser.close()
  }

  console.log('')
  if (pass + fail === 0) bail('rien n’a été vérifié, ce qui n’est pas un succès.')
  if (fail > 0) {
    console.error(`csp-verify : ${fail} échec(s), ${pass} succès.`)
    process.exit(1)
  }
  console.log(`csp-verify : ${pass} vérifications passées.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
