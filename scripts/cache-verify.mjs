#!/usr/bin/env node
/**
 * The two caches, and the one thing they must never do.
 *
 *   node scripts/cache-verify.mjs                          the mirror
 *   node scripts/cache-verify.mjs --host=https://…         a LiteSpeed host
 *
 * A shop has two caches and they fail in the same way: by showing one visitor
 * something that belonged to another.
 *
 *   THE OBJECT CACHE is Redis, and it is shared by every request on the account.
 *   WooCommerce keeps a cart per session and a session is a cookie; if the cart
 *   were cached in a group the drop-in treats as global, two visitors would share
 *   one basket. Part A puts two real browsers side by side and checks.
 *
 *   THE PAGE CACHE is LiteSpeed's, at the server, on o2switch. It is the one that
 *   can serve a whole rendered cart to the next person who asks for /panier/.
 *   Part B reads what a host actually says about each URL rather than trusting a
 *   plugin's defaults, because the defaults are a list somebody else maintains
 *   and this is the failure that costs a customer their address.
 *
 * PART B CANNOT RUN AGAINST THE MIRROR AND SAYS SO. The mirror is Apache; o2switch
 * is LiteSpeed. Given no --host it reports that the page cache was not examined,
 * which is a result and not a pass. Given one, it exercises the policy below.
 *
 * Exit: 0 everything asserted held - 1 an assertion failed - 2 nothing was
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
const MIRROR = arg('mirror', 'http://localhost:8080').replace(/\/$/, '')
const HOST = arg('host', '')
/*
 * --self-test GIVES THE TWO VISITORS ONE COOKIE JAR, which is the shape of the
 * failure this suite exists to catch: one basket serving two people. The
 * assertions must go RED, and the run exits 0 only if they do. Without it, four
 * ticks about isolation could be four ticks about a shop where nothing was added
 * at all, and this repository has shipped a harness that printed nine of those.
 */
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
const bail = (msg) => {
  console.error(`\ncache-verify: ${msg}`)
  process.exit(2)
}

/**
 * WHAT MAY BE CACHED WHOLE, AND WHAT MAY NEVER BE.
 *
 * One list, here, so the answer has a home instead of living in a plugin's
 * settings screen where nobody can review it or diff it. Every entry says why,
 * because "the plugin excludes it by default" is not a reason anybody can check
 * in eighteen months.
 *
 * The rule underneath all of them: a page is cacheable when it is the same for
 * every visitor who is not logged in. The moment a page can contain a name, an
 * address, a basket, a price that depends on who is asking, or a nonce, it is
 * not.
 */
const POLICY = [
  { path: '/', cacheable: true, why: 'the same page for everyone, no cart fragment in the markup' },
  { path: '/categorie/manches-courtes/', cacheable: true, why: 'a listing, identical for every visitor' },
  { path: '/produit/bc-e150-women-t-shirt/', cacheable: true, why: 'the product page itself; the studio is an iframe on another origin and is not cached with it' },
  { path: '/cart/', cacheable: false, why: 'it IS the basket' },
  { path: '/checkout/', cacheable: false, why: 'name, address, the order total, and the payment nonce' },
  { path: '/my-account/', cacheable: false, why: 'the customer’s own order history' },
  { path: '/mentions-legales/', cacheable: true, why: 'a legal text, the same for everyone' },
  { path: '/wp-json/teeshoop/v1/quote', cacheable: false, why: 'a price computed from what the caller asked for; caching it would quote one buyer another buyer’s figure' },
]

const wpcli = (args) =>
  execFileSync('docker', [...COMPOSE, ...args], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

async function objectCache() {
  console.log('A. Le cache objet (Redis), sur le miroir\n')

  /*
   * IS IT EVEN ON. Everything below is worthless if it is not: two carts would
   * stay separate because nothing is being cached at all, and the suite would
   * print a row of ticks for a shop with no object cache.
   */
  let dropin = ''
  try {
    dropin = wpcli([
      'eval',
      'echo json_encode(array("dropin"=>file_exists(WP_CONTENT_DIR."/object-cache.php"),"class"=>get_class($GLOBALS["wp_object_cache"]),"redis"=>(bool)(function_exists("wp_cache_get_stats")||class_exists("Redis")),"hits"=>(int)($GLOBALS["wp_object_cache"]->cache_hits ?? 0)));',
    ])
  } catch (e) {
    bail(`could not reach the mirror through WP-CLI (${String(e.message).split('\n')[0]}). Try: npm run wp:up`)
  }
  const state = JSON.parse(dropin.slice(dropin.indexOf('{')))
  ok('the drop-in is installed', state.dropin === true, 'wp-content/object-cache.php')
  if (state.dropin !== true) {
    bail(
      'there is no object cache, so nothing below would prove anything. Enable it:\n' +
        '  npm run wp:cli plugin install redis-cache --activate\n' +
        '  npm run wp:cli redis enable',
    )
  }

  /*
   * A PREFIX, AND THIS ONE IS ABOUT PRODUCTION. o2switch gives the ACCOUNT one
   * Redis, not the site. Two WordPress installs on the same account with no
   * prefix share a keyspace: the second one's `alloptions` overwrites the
   * first's, and both shops start answering with each other's settings. The
   * mirror sets one so that the thing being tested is the thing that ships.
   */
  const prefix = wpcli(['eval', 'echo defined("WP_REDIS_PREFIX") ? WP_REDIS_PREFIX : "";']).trim()
  ok('the keyspace is prefixed', prefix.length > 0, prefix || 'WP_REDIS_PREFIX is not defined')

  /*
   * TWO PRODUCTS OF ITS OWN, created here and deleted at the end.
   *
   * The first version picked the first two purchasable products it found, and
   * both attempts hit a mirror full of other sessions' fixtures: one declared a
   * garment, so `ProductPage::refuse_plain_add` correctly refused a plain add,
   * and the next was a leftover called « Repro tee » that silently accepted the
   * request and put nothing in the basket. Neither is a bug in the cache, and
   * neither should decide whether this suite runs. A verifier that depends on
   * what happens to be lying around in a development database is a verifier that
   * goes red for reasons that are not the code, which this repository has already
   * paid for once (docs/seance-12-a-reprendre.md section 4.1).
   */
  const NAMES = ['Cache-verify A', 'Cache-verify B']
  const made = JSON.parse(
    wpcli([
      'eval',
      `$out = array();
       foreach ( array( ${NAMES.map((n) => `'${n}'`).join(', ')} ) as $i => $name ) {
         $p = new WC_Product_Simple();
         $p->set_name( $name );
         $p->set_regular_price( (string) ( 11 + $i ) );
         $p->set_catalog_visibility( 'hidden' );
         $p->set_status( 'publish' );
         $id = (int) $p->save();
         $out[] = array( 'ID' => $id, 'post_title' => $name );
       }
       echo json_encode( $out );`,
    ]).match(/\[.*\]/s)[0],
  )
  const products = made
  const cleanup = () => {
    try {
      wpcli(['eval', `foreach ( array( ${products.map((p) => p.ID).join(', ')} ) as $id ) { wp_delete_post( (int) $id, true ); }`])
    } catch {
      console.log('  (les deux produits de test n’ont pas pu être supprimés)')
    }
  }
  if (products.length < 2) bail('could not create the two throwaway products.')

  const browser = await chromium.launch()
  try {
    /*
     * TWO VISITORS, TWO BROWSERS, ONE SHOP. Not two tabs and not two fetches
     * with different cookie jars: separate contexts, because what is being
     * tested is the whole session mechanism and a shortcut here would test a
     * shortcut.
     */
    const one = await browser.newContext()
    const two = SELF_TEST ? one : await browser.newContext()
    const three = await browser.newContext()
    const [p1, p2, p3] = [await one.newPage(), await two.newPage(), await three.newPage()]

    await p1.goto(`${MIRROR}/?add-to-cart=${products[0].ID}&quantity=3`, { waitUntil: 'load', timeout: 90000 })
    await p2.goto(`${MIRROR}/?add-to-cart=${products[1].ID}&quantity=1`, { waitUntil: 'load', timeout: 90000 })
    await p3.goto(`${MIRROR}/`, { waitUntil: 'load', timeout: 90000 })

    /*
     * THE ORACLE IS THE STORE API, NOT THE CART PAGE'S MARKUP.
     *
     * /cart/ is the BLOCK cart: the line items are fetched from
     * /wp-json/wc/store/v1/cart and rendered by JavaScript, so scraping the HTML
     * measures hydration timing as much as it measures the basket, and the first
     * version of this suite reported a line missing that was really just not
     * painted yet. The Store API answer IS the basket, it is what the block reads,
     * and it carries the session cookie of whichever context asks. Each request
     * goes through `page.request`, which shares that context's cookie jar.
     */
    const basketOf = async (page) => {
      const res = await page.request.get(`${MIRROR}/wp-json/wc/store/v1/cart`)
      if (!res.ok()) return { error: `${res.status()}` }
      const body = await res.json()
      return { names: (body.items || []).map((i) => i.name), count: body.items_count ?? 0 }
    }
    const [b1, b2, b3] = [await basketOf(p1), await basketOf(p2), await basketOf(p3)]

    /*
     * THE ADDS MUST HAVE WORKED. Without this the four assertions below all pass
     * for a shop that refused both lines: two empty baskets are perfectly
     * isolated from one another and prove nothing at all.
     */
    ok(
      'both baskets actually received a line',
      b1.names?.includes(products[0].post_title) && b2.names?.includes(products[1].post_title),
      `visiteur 1 ${JSON.stringify(b1)} | visiteur 2 ${JSON.stringify(b2)}`,
    )
    ok('the first visitor sees only their own line', b1.names?.length === 1 && b1.names[0] === products[0].post_title, JSON.stringify(b1))
    ok('the second visitor sees only their own line', b2.names?.length === 1 && b2.names[0] === products[1].post_title, JSON.stringify(b2))
    ok('and their quantities did not cross either', b1.count === 3 && b2.count === 1, `${b1.count} / ${b2.count}`)
    ok('a third visitor who added nothing has an empty basket', b3.names?.length === 0, JSON.stringify(b3))

    /*
     * AND THE CACHE WAS ACTUALLY WORKING WHILE THAT HAPPENED, which is the
     * assertion that stops the ones above passing for the wrong reason. Redis
     * having served nothing would make cart isolation trivially true.
     */
    const stats = wpcli([
      'eval',
      'wp_cache_get("cache-verify-probe","teeshoop"); echo (int) ($GLOBALS["wp_object_cache"]->cache_hits ?? 0);',
    ])
    ok('the object cache served something during the run', Number(stats.trim()) > 0, `${stats.trim()} hits in one CLI request`)

    await Promise.all([one.close(), SELF_TEST ? Promise.resolve() : two.close(), three.close()])
  } finally {
    await browser.close()
    cleanup()
  }
}

async function pageCache() {
  console.log('\nB. Le cache de page')
  if (!HOST) {
    console.log(
      '  Non examiné : le miroir est sous Apache, la production sous LiteSpeed.\n' +
        '  Relancer avec --host=https://… contre un hôte o2switch pour l’éprouver.\n' +
        `  La politique compte ${POLICY.length} entrées, dont ${POLICY.filter((p) => !p.cacheable).length} qui ne doivent jamais être mises en cache.`,
    )
    return
  }
  const base = HOST.replace(/\/$/, '')
  for (const entry of POLICY) {
    let res
    try {
      res = await fetch(base + entry.path, { redirect: 'manual', headers: { 'user-agent': 'teeshoop-cache-verify' } })
    } catch (e) {
      ok(`${entry.path} answered`, false, String(e.message).slice(0, 80))
      continue
    }
    const h = Object.fromEntries([...res.headers].map(([k, v]) => [k.toLowerCase(), v]))
    const ls = h['x-litespeed-cache'] || h['x-litespeed-cache-control'] || ''
    const cc = h['cache-control'] || ''
    const cached = /hit/i.test(ls) || (h.age !== undefined && Number(h.age) > 0)
    const declaredPrivate = /no-store|no-cache|private/i.test(cc)

    if (entry.cacheable) {
      ok(`${entry.path} may be cached`, true, `${res.status} ${ls || cc || 'aucun en-tête de cache'}`)
    } else {
      ok(
        `${entry.path} is never cached whole (${entry.why})`,
        !cached && (declaredPrivate || ls === '' || /no-cache/i.test(ls)),
        `${res.status} litespeed="${ls}" cache-control="${cc}"`,
      )
    }
  }
}

async function main() {
  console.log(`cache-verify\n  miroir : ${MIRROR}${HOST ? `\n  hôte   : ${HOST}` : ''}\n`)
  await objectCache()
  await pageCache()

  console.log('')
  if (pass + fail === 0) {
    console.error('cache-verify : rien n’a été vérifié, ce qui n’est pas un succès.')
    process.exit(2)
  }
  if (SELF_TEST) {
    if (fail === 0) {
      console.error(
        'cache-verify --self-test : les deux visiteurs partageaient un seul pot de cookies\n' +
          'et aucune assertion n’a bronché. Le contrôle d’isolement ne contrôle rien.',
      )
      process.exit(1)
    }
    console.log(`cache-verify --self-test : ${fail} assertion(s) ont bien viré au rouge sur un panier partagé.`)
    return
  }
  if (fail > 0) {
    console.error(`cache-verify : ${fail} échec(s), ${pass} succès.`)
    process.exit(1)
  }
  console.log(`cache-verify : ${pass} vérifications passées.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
