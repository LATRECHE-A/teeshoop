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
 */
const ALLOWED = new Map([
  ['wp-plugins/teeshoop-core/includes/Margin.php', 'the cost and floor-price engine; server-only, never rendered'],
  ['wp-plugins/teeshoop-core/tests/test-margin.php', 'the tests for it'],
  ['scripts/php-guard.mjs', 'this file lists the needles'],
])

/**
 * Directories whose contents reach a browser directly, where a needle is worse
 * than elsewhere. Reported separately so a failure says how bad it is.
 */
const RENDERED = ['wp-plugins/teeshoop-core/templates/', 'wp-plugins/teeshoop-core/assets/']

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
    if (ALLOWED.has(rel)) continue

    // readFileSync + includes, never grep: a file with a NUL byte makes GNU
    // grep suppress output entirely, which reads as a pass. Measured in
    // scripts/bundle-guard.mjs.
    const rendered = RENDERED.some((d) => rel.startsWith(d))
    const text = readFileSync(file, 'utf8')
    for (const needle of [...FORBIDDEN, ...extra]) {
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
