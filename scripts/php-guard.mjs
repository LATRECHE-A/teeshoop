#!/usr/bin/env node
/**
 * PHP GUARD: proves the WordPress plugin carries no shop-internal material.
 *
 * WHY. `scripts/bundle-guard.mjs` keeps our purchase costs, our film economics
 * and our supplier identities out of the JavaScript a customer downloads. The
 * plugin is the other half of the same boundary and had no equivalent: PHP is
 * not minified, it renders directly into a page, and `templates/` is exactly
 * where a well-meaning "show the margin so the shop can see it" would land.
 *
 * WHAT IT SCANS. Every `.php`, `.js` and `.css` under `wp-plugins/`, plus the
 * generated `data/garments.json`. Both the code and the markup, because on this
 * side there is no build step to separate them.
 *
 * WHAT IT LOOKS FOR. The same string needles as the bundle guard, plus the
 * supplier names, plus the vocabulary of our own cost model. Symbol names work
 * here (unlike in a minified bundle) and are used, because a PHP template that
 * printed `$cost_ht` would be caught by the word before it was caught by a
 * rendered figure.
 *
 * IT NEVER PRINTS WHAT IT FOUND, for the same reason the bundle guard does not:
 * CI logs can be public, and a guard that fails by echoing the number it
 * protects has published it. File, line and needle name are enough.
 *
 * Exit: 0 clean · 1 forbidden material · 2 the scan is not trustworthy
 *       (nothing scanned, or the self-test did not fire).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCAN_ROOT = join(ROOT, 'wp-plugins')

/**
 * Needles, in three groups.
 *
 * Group 1 is copied from scripts/bundle-guard.mjs deliberately, not imported:
 * the two guards protect different artefacts and one must not be able to
 * silently narrow the other. When a needle is added there it should be added
 * here, and `--self-test` proves this scanner still fires.
 *
 * NOTE the two apostrophes on "Prix d'achat". U+0027 and U+2019 are different
 * needles; a copy-edit that normalised quotes would otherwise disarm one.
 */
const FORBIDDEN = [
  // Our purchase cost.
  { s: "Prix d'achat", cat: 'purchase-cost' },
  { s: 'Prix d’achat', cat: 'purchase-cost' },
  { s: 'NOS PRIX D’ACHAT', cat: 'purchase-cost' },
  { s: 'catalog.fr.cost', cat: 'purchase-cost' },
  { s: 'FR_WS_USER', cat: 'purchase-cost' },
  { s: 'FR_WS_PASS', cat: 'purchase-cost' },
  { s: 'wrangler secret put', cat: 'purchase-cost' },
  { s: 'purchase_cost', cat: 'purchase-cost' },
  { s: 'cost_ht', cat: 'purchase-cost' },
  { s: 'prix_achat', cat: 'purchase-cost' },

  // Supplier identity. A customer page names a BRAND (Stanley/Stella, JUST
  // COOL); it never names who we buy from.
  { s: 'Imbretex', cat: 'supplier' },
  { s: 'imbretex', cat: 'supplier' },
  { s: 'Falk & Ross', cat: 'supplier' },
  { s: 'Falk&Ross', cat: 'supplier' },
  { s: 'falkross', cat: 'supplier' },
  { s: 'Mid Ocean', cat: 'supplier' },
  { s: '/api/fr/', cat: 'supplier' },
  { s: 'tshop:fr:', cat: 'supplier' },

  // Film economics.
  { s: 'DTF Plus', cat: 'film-cost' },
  { s: 'Impression-DTF', cat: 'film-cost' },
  { s: 'OhMyDTF', cat: 'film-cost' },
  { s: 'Royal DTF', cat: 'film-cost' },
  { s: '€/lm', cat: 'film-cost' },
  { s: 'eurPerLm', cat: 'film-cost' },
  { s: 'eur_per_lm', cat: 'film-cost' },
  { s: 'tshop:dtf:suppliers', cat: 'film-cost' },

  /*
   * Our own cost model: the margin, the floor price and the commission.
   *
   * The Bible lists "commercial et commission estimée" among a devis's
   * mandatory contents, which read literally puts our margin on a document a
   * customer receives.
   *
   * The last four are `rendered`-only, and that scope is the whole point. These
   * are ordinary French words, and the files that explain WHY a commission must
   * never reach a customer necessarily contain the word: scanning every file
   * for them flagged six docblocks that exist to state the rule. In a template
   * or a stylesheet there is no such excuse, because that is output.
   * `Margin::` is a call, not a word, so it is global.
   */
  { s: 'Margin::', cat: 'margin' },
  { s: 'commission', cat: 'margin', scope: 'rendered' },
  { s: 'prix plancher', cat: 'margin', scope: 'rendered' },
  { s: 'floor_price', cat: 'margin', scope: 'rendered' },
  { s: 'marge contributive', cat: 'margin', scope: 'rendered' },

  /*
   * The cost engine session 05 added. Same shape as `Margin::` above and for
   * the same reason: a call is not a word, so it is global, and the three
   * French phrases beside it are ordinary enough that only a file which is
   * OUTPUT has no excuse for containing them.
   *
   * NOTE ON SUBSTRINGS. These needles match anywhere, so a class named
   * `OrderCost` would carry `Cost::` into every file that called it and each
   * of those would need an exemption for a name that means nothing. The
   * classes are therefore named so that no needle is a prefix of another:
   * `Costing`, `CostScreen`, `Nest`.
   */
  { s: 'Cost::', cat: 'margin' },
  { s: 'Commission::', cat: 'margin' },
  { s: 'Costing::', cat: 'margin' },
  { s: 'PriceRule::', cat: 'margin' },
  { s: 'taux horaire', cat: 'margin', scope: 'rendered' },
  { s: 'coût direct', cat: 'margin', scope: 'rendered' },
  { s: 'marge Teeshoop', cat: 'margin', scope: 'rendered' },

  // WooCommerce API credentials.
  { s: 'consumerSecret', cat: 'woo-credentials' },
  { s: 'consumer_secret', cat: 'woo-credentials' },
  { s: 'tshop:woo:cred', cat: 'woo-credentials' },
]

/**
 * Files that are allowed to name these things, and why.
 *
 * `Margin.php` is the cost and floor-price engine. It is server-only, it is
 * never rendered to anyone, and naming its inputs is its job. It is listed here
 * rather than excluded by a pattern so that adding a second exemption is a
 * visible decision.
 *
 * EXEMPTIONS NAME THE NEEDLE, not the category, and `null` means the whole file.
 * The scoping was added with the catalogue importer (session 03), because a
 * blanket exemption is a hole shaped like a file rather than like a reason.
 * NEEDLE-level and not category-level for the same argument taken one step
 * further: `supplier` is eight needles, `Supply.php` needs exactly one of them,
 * and the seven others are precisely what would make it able to name who we buy
 * from. The two original entries stay unscoped because they legitimately touch
 * several categories at once.
 */
const ALLOWED = new Map([
  ['wp-plugins/teeshoop-core/includes/Margin.php', { why: 'the cost and floor-price engine; server-only, never rendered', needles: null }],
  ['wp-plugins/teeshoop-core/tests/test-margin.php', { why: 'the tests for it', needles: null }],
  ['scripts/php-guard.mjs', { why: 'this file lists the needles', needles: null }],
  [
    'wp-plugins/teeshoop-core/includes/Supply.php',
    { why: 'holds the one catalogue route path; server-only HTTP client, renders nothing', needles: ['/api/fr/'] },
  ],
  [
    'wp-plugins/teeshoop-core/includes/Importer.php',
    { why: 'asks the cost engine for a selling price; server-only, renders nothing', needles: ['Margin::'] },
  ],
  [
    'wp-plugins/teeshoop-core/includes/Commission.php',
    { why: 'what a salesperson earns; server-only, never rendered, and it reads the cost confidences', needles: ['Cost::'] },
  ],
  [
    'wp-plugins/teeshoop-core/includes/PriceRule.php',
    { why: 'the scoped floor rules; pure, server-only, never rendered, and naming its own methods is its job', needles: ['PriceRule::', 'Margin::', 'Costing::'] },
  ],
  [
    'wp-plugins/teeshoop-core/tests/test-pricerule.php',
    { why: 'the tests for the scoped floors', needles: ['PriceRule::', 'Margin::', 'Costing::'] },
  ],
  [
    'wp-plugins/teeshoop-core/includes/Costing.php',
    {
      why: 'the order-facing cost, floor and commission report; admin-only screens and order meta, never a customer surface',
      needles: ['Cost::', 'Commission::', 'Costing::', 'Margin::', 'PriceRule::'],
    },
  ],
  [
    'wp-plugins/teeshoop-core/includes/CostAdmin.php',
    {
      why: 'the admin screens for the cost model; manage_woocommerce only, and question 39 keeps the commission off every customer document',
      /*
       * `Prix d’achat` is in the list because it is the LABEL of the field an
       * operator types a purchase price into. It has to say that, in French, on
       * this page and nowhere else. The needle is named rather than the
       * category, so this file is still checked for supplier names, for film
       * tariffs per linear metre and for the seven other purchase-cost strings.
       */
      needles: ['Cost::', 'Commission::', 'Costing::', 'Margin::', 'CostAdmin::', 'PriceRule::', 'Prix d’achat'],
    },
  ],
  [
    'wp-plugins/teeshoop-core/includes/Lifecycle.php',
    {
      /*
       * ONE CONSTANT, AND IT IS A META KEY. `Costing::META_DELIVERED` is
       * `_teeshoop_livree_le`, the date an order was delivered, which is a
       * lifecycle fact that the costing happens to read (a commission cannot
       * become definitive without it). This file writes that key and reads no
       * cost, no floor and no commission; naming the needle alone leaves it
       * checked for everything else.
       */
      why: 'writes the delivery date the commission waits on, by its constant; reads no cost of any kind',
      needles: ['Costing::'],
    },
  ],
  [
    'wp-plugins/teeshoop-core/includes/Quote.php',
    {
      /*
       * The devis costing, which is chapter 1's `POST /pricing/quotes/calculate`
       * and is deliberately NOT a public route: what it returns is our purchase
       * cost, our film economics and our floor price. It is reachable from the
       * devis admin screen with `manage_woocommerce` and from nowhere else, and
       * the customer-facing half of this file (the form, the notification) names
       * none of it. The needle is listed alone so the file is still checked for
       * supplier names, film tariffs and the seven other purchase-cost strings.
       */
      why: 'the devis costing calls the ONE cost engine rather than growing a second one; admin-only, and no customer surface in this file touches it',
      needles: ['Costing::'],
    },
  ],
  [
    'wp-plugins/teeshoop-core/includes/Cli.php',
    {
      why: '`wp teeshoop marge` prints an order’s costing to a terminal an operator already had to log in to; WP-CLI renders to no browser',
      needles: ['Cost::', 'Costing::'],
    },
  ],
  [
    'wp-plugins/teeshoop-core/teeshoop-core.php',
    { why: 'the bootstrap names the classes it loads and starts', needles: ['Costing::', 'CostAdmin::'] },
  ],
  [
    'wp-plugins/teeshoop-core/tests/test-cost.php',
    { why: 'the tests for the direct-cost model', needles: ['Cost::', 'Margin::'] },
  ],
  [
    'wp-plugins/teeshoop-core/tests/demo-order.php',
    { why: 'builds the worked order the session report quotes; wp-cli only, guarded on PHP_SAPI, renders nothing', needles: ['Costing::'] },
  ],
  [
    'wp-plugins/teeshoop-core/tests/integration-margin.php',
    { why: 'the WooCommerce test for the costing; runs under wp-cli, renders to nobody', needles: ['Cost::', 'Commission::', 'Costing::', 'Margin::', 'PriceRule::'] },
  ],
  [
    'wp-plugins/teeshoop-core/tests/integration-lifecycle.php',
    {
      why: 'the WooCommerce tests for the devis costing and for the delivery date a commission waits on; run under wp-cli, render to nobody',
      needles: ['Costing::', 'Commission::'],
    },
  ],
  [
    'wp-plugins/teeshoop-core/tests/test-commission.php',
    { why: 'the tests for the commission', needles: ['Cost::', 'Commission::', 'Margin::'] },
  ],
])

/**
 * Directories whose contents reach a browser directly, where a needle is worse
 * than elsewhere. Reported separately so a failure says how bad it is.
 *
 * `data/` joined the list when `Hypotheses::screen()` started printing
 * `data/hypotheses.php` into an admin page. The four `rendered`-scoped needles
 * are ordinary French words a docblock may legitimately use; a file that is
 * echoed to a browser has no such excuse, and that one now is.
 */
const RENDERED = [
  'wp-plugins/teeshoop-core/templates/',
  'wp-plugins/teeshoop-core/assets/',
  'wp-plugins/teeshoop-core/data/',
  // A file and not a directory, because this one IS output: `BatPage` renders a
  // whole HTML document to a customer from `admin-post.php`, without a template
  // and without the theme. It lives in `includes/` because it is a class, which
  // is exactly why the directory rule would have missed it.
  'wp-plugins/teeshoop-core/includes/BatPage.php',
]

const SCAN_EXT = new Set(['.php', '.js', '.css', '.json', '.html'])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else if (SCAN_EXT.has(p.slice(p.lastIndexOf('.')))) out.push(p)
  }
  return out
}

function scan(files, extra = []) {
  const hits = []
  for (const file of files) {
    const rel = relative(ROOT, file).split('\\').join('/')
    const exempt = ALLOWED.get(rel)
    // `needles: null` is a whole-file pass; a list exempts only those exact
    // strings, so every other needle still fires in that file.
    if (exempt && exempt.needles === null) continue

    // readFileSync + includes, never grep: a file with a NUL byte makes GNU
    // grep suppress output entirely, which reads as a pass. Measured in
    // scripts/bundle-guard.mjs.
    const rendered = RENDERED.some((d) => rel.startsWith(d))
    const text = readFileSync(file, 'utf8')
    for (const needle of [...FORBIDDEN, ...extra]) {
      if (exempt && exempt.needles.includes(needle.s)) continue
      if (needle.scope === 'rendered' && !rendered) continue
      let at = text.indexOf(needle.s)
      while (at !== -1) {
        const line = text.slice(0, at).split('\n').length
        hits.push({ rel, line, cat: needle.cat, rendered })
        at = text.indexOf(needle.s, at + needle.s.length)
      }
    }
  }
  return hits
}

const files = walk(SCAN_ROOT)

if (files.length === 0) {
  // "Nothing found" and "nothing looked" are different results.
  console.error('php-guard: scanned no files at all. The path is wrong, and a pass here would mean nothing.')
  process.exit(2)
}

/*
 * SELF-TEST: prove the scanner can actually fire.
 *
 * A needle that matches nothing on a clean tree is indistinguishable from a
 * scanner that reads nothing. So one run is made with a needle that IS present,
 * and the guard refuses to report success unless that run found it.
 */
const canary = scan(files, [{ s: 'Teeshoop', cat: 'self-test' }])
if (canary.length === 0) {
  console.error('php-guard: the self-test needle matched nothing. The scan is not reading these files.')
  process.exit(2)
}

const hits = scan(files)

if (hits.length > 0) {
  const rendered = hits.filter((h) => h.rendered)
  console.error(`php-guard: ${hits.length} forbidden reference(s) in the plugin.`)
  if (rendered.length > 0) {
    console.error(`  ${rendered.length} of them are in a file that renders to a browser.`)
  }
  for (const hit of hits) {
    console.error(`  ${hit.rel}:${hit.line}  [${hit.cat}]${hit.rendered ? '  RENDERED' : ''}`)
  }
  console.error('\nPurchase costs, supplier names and film rates never reach a customer surface.')
  console.error('If one of these is legitimate and server-only, add it to ALLOWED with a reason.')
  process.exit(1)
}

console.log(
  `php-guard: ${files.length} files scanned, ${FORBIDDEN.length} needles, ${ALLOWED.size} documented exemptions. Clean.`,
)
