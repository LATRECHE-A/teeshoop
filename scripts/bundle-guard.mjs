#!/usr/bin/env node
/**
 * BUNDLE GUARD — proves the customer bundle carries no shop-internal material.
 *
 * WHY. The studio ships two entries built from one tree (src/app/adminSlots.tsx):
 * index.html is the customer studio, admin.html the workshop tools. The tools
 * carry our purchase cost per SKU, our film cost per linear metre and a
 * WooCommerce credential form. Keeping them out of the customer's JavaScript is
 * a build-time property, and build-time properties rot silently — one careless
 * `import` and it is back, with nothing to notice. This script is the notice.
 *
 * WHAT IT CHECKS. Every emitted file is classified by which entry can reach it:
 *   CUSTOMER  reachable from index.html — a forbidden marker here is the bug
 *             this script exists to catch.
 *   ADMIN     reachable only from admin.html — markers are EXPECTED here.
 *   ORPHAN    reachable from neither, yet still uploaded and still fetchable by
 *             URL. Markers here fail too: a content-hashed name is not
 *             authentication.
 *
 * TWO TRAPS THIS AVOIDS, both measured rather than assumed:
 *  - grep is unusable. A chunk can contain a NUL byte (esbuild emits the cache
 *    key separator from src/lib/ingest/frCache.ts as one), after which ugrep
 *    skips the file entirely and GNU grep suppresses output — a silent pass.
 *    So: node, readFileSync('utf8'), String.includes.
 *  - Symbol names are worthless needles. esbuild renames locals and exports and
 *    strips comments, so `your_price`, `DEFAULT_SUPPLIERS` and
 *    `loadWooCredentials` are absent from the bundle even when their code is in
 *    it. Only STRING LITERALS survive byte-for-byte.
 *
 * IT NEVER PRINTS WHAT IT FOUND. CI logs can be public; a guard that fails by
 * echoing "Prix d'achat 4,37 €" has published the number it exists to protect.
 * Needle name plus byte offset is enough to find it locally.
 *
 * Run: npm run verify:bundle   (after npm run build)
 * Exit: 0 clean · 1 forbidden markers · 2 self-test failed (the scan is lying)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// `--dist <path>` points the scan at another build. Its one real use is proving
// this guard is NOT VACUOUS: run it against a pre-split build and it must FAIL.
// A gate nobody has seen fail is a gate nobody knows works.
const argv = process.argv.slice(2)
const distArg = argv.indexOf('--dist')
const DIST = distArg >= 0 ? argv[distArg + 1] : join(ROOT, 'dist')
// Pre-split builds have no admin entry; then every reachable file is customer.
const ALLOW_NO_ADMIN = argv.includes('--allow-missing-admin')

/**
 * Tier A — string literals. These are reproduced byte-for-byte by the minifier.
 *
 * NOTE the two different apostrophes: catalogI18n.ts uses U+2019 (’) and
 * worker/falkross.ts uses U+0027 ('). They are DIFFERENT needles; a copy-edit
 * that normalises quotes would otherwise silently disarm one.
 */
const FORBIDDEN = [
  // Our purchase cost, and the strings that explain it is ours.
  { s: "Prix d'achat", cat: 'cost' },
  { s: 'Prix d’achat', cat: 'cost' },
  { s: 'NOS PRIX D’ACHAT', cat: 'cost' },
  { s: 'catalog.fr.cost', cat: 'cost' },
  { s: 'FR_WS_USER', cat: 'cost' },
  { s: 'FR_WS_PASS', cat: 'cost' },
  { s: 'wrangler secret put', cat: 'cost' },

  // The admin-only supplier API surface.
  { s: '/api/fr/', cat: 'supplier-api' },
  { s: 'tshop:fr:', cat: 'supplier-api' },

  // WooCommerce credentials.
  { s: '/wp-json/wc/v3/products', cat: 'woo' },
  { s: 'tshop:woo:cred', cat: 'woo' },
  { s: 'X-WP-TotalPages', cat: 'woo' },

  // Our film cost model: supplier names and €/linear-metre economics.
  { s: 'tshop:dtf:suppliers', cat: 'dtf-film-cost' },
  { s: 'DTF Plus', cat: 'dtf-film-cost' },
  { s: 'Impression-DTF', cat: 'dtf-film-cost' },
  { s: 'OhMyDTF', cat: 'dtf-film-cost' },
  { s: 'Royal DTF', cat: 'dtf-film-cost' },
  { s: '€/lm', cat: 'dtf-film-cost' },

  // The admin entry itself.
  { s: 'admin.menu', cat: 'admin-entry' },
  { s: 'admin.dtf', cat: 'admin-entry' },
  { s: 'admin.products', cat: 'admin-entry' },

  // Tier B — property names. These survive only because vite/esbuild does not
  // mangle properties (no `mangleProps` is configured). If that ever changes
  // these go quiet, which is why every sensitive module above is ALSO covered
  // by a Tier A literal.
  { s: 'eurPerLm', cat: 'dtf-film-cost', tier: 'B' },
  { s: 'consumerSecret', cat: 'woo', tier: 'B' },
]

// Deliberately NOT needles, and why:
//   `rrpEur`      — Imbretex's published RECOMMENDED RETAIL price, not our cost.
//                   It is in the committed catalogue snapshot and is public.
//   `wc/v3`       — subsumed by the full path above.
//   symbol names  — renamed by the minifier (see the header).

/** Must be PRESENT, or the scanner is not reading the real bundle. */
const CANARY = [
  ['Konva', 'konva'],
  ['WebGLRenderer', 'three-'],
]

const SCAN_EXT = new Set(['.js', '.mjs', '.css', '.json'])

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (SCAN_EXT.has(p.slice(p.lastIndexOf('.')))) out.push(p)
  }
  return out
}

/**
 * Files reachable from one HTML entry.
 *
 * Closes over BOTH import specifiers and bare asset-name mentions. The second
 * rule is not belt-and-braces: `nestWorker-*.js` and the onnxruntime worker are
 * referenced only as `new Worker(new URL('/assets/<hash>.js', import.meta.url))`,
 * which no import parser sees, and they do ship.
 */
function reachableFrom(htmlPath, allFiles) {
  let html
  try {
    html = readFileSync(htmlPath, 'utf8')
  } catch {
    return null // entry missing — the caller decides whether that is fatal
  }
  const byBase = new Map(allFiles.map((f) => [basename(f), f]))
  const seen = new Set()
  const queue = []

  for (const m of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)) {
    const f = byBase.get(basename(m[1]))
    if (f) queue.push(f)
  }

  while (queue.length) {
    const f = queue.pop()
    if (seen.has(f)) continue
    seen.add(f)
    let txt
    try {
      txt = readFileSync(f, 'utf8')
    } catch {
      continue
    }
    for (const [base, path] of byBase) {
      if (!seen.has(path) && txt.includes(base)) queue.push(path)
    }
  }
  return seen
}

// ---------------------------------------------------------------------------

const files = walk(DIST)
const jsFiles = files.filter((f) => f.endsWith('.js') || f.endsWith('.mjs'))

if (jsFiles.length < 10) {
  console.error(
    `\nBUNDLE GUARD SELF-TEST FAILED — only ${jsFiles.length} JS file(s) under dist/.\n` +
      `It is not looking at a real build; a PASS here would mean nothing.\n` +
      `Did \`npm run build\` run, or did build.outDir move?\n`,
  )
  process.exit(2)
}

for (const [needle, hint] of CANARY) {
  const found = jsFiles.some((f) => basename(f).includes(hint) && readFileSync(f, 'utf8').includes(needle))
  if (!found) {
    console.error(
      `\nBUNDLE GUARD SELF-TEST FAILED — scanned ${jsFiles.length} JS files and could not\n` +
        `find canary "${needle}" in any chunk named like "${hint}".\n` +
        `The scanner is not reading the real bundle; its PASS means nothing.\n`,
    )
    process.exit(2)
  }
}

const customer = reachableFrom(join(DIST, 'index.html'), files)
const admin = reachableFrom(join(DIST, 'admin.html'), files)

if (!customer) {
  console.error('\nBUNDLE GUARD SELF-TEST FAILED — dist/index.html is missing.\n')
  process.exit(2)
}
if (!admin && !ALLOW_NO_ADMIN) {
  console.error(
    '\nBUNDLE GUARD FAILED — dist/admin.html is missing.\n' +
      'The admin entry must be built, or /admin silently falls through to the\n' +
      "SPA fallback and serves the CUSTOMER app under the admin URL.\n",
  )
  process.exit(1)
}

const adminSet = admin ?? new Set()
const classify = (f) => (customer.has(f) ? 'CUSTOMER' : adminSet.has(f) ? 'ADMIN' : 'ORPHAN')

const violations = []
for (const f of files) {
  const zone = classify(f)
  if (zone === 'ADMIN') continue // markers belong here
  const txt = readFileSync(f, 'utf8')
  for (const n of FORBIDDEN) {
    let i = txt.indexOf(n.s)
    if (i < 0) continue
    let hits = 0
    const at = i
    while (i >= 0) {
      hits++
      i = txt.indexOf(n.s, i + n.s.length)
    }
    violations.push({ file: relative(ROOT, f), zone, needle: n.s, cat: n.cat, hits, at })
  }
}

if (violations.length) {
  console.error('\nBUNDLE GUARD FAILED — shop-internal material is in a customer-served file.\n')
  const byFile = new Map()
  for (const v of violations) (byFile.get(v.file) ?? byFile.set(v.file, []).get(v.file)).push(v)
  for (const [file, vs] of byFile) {
    console.error(`  ${file}  [${vs[0].zone}]`)
    for (const v of vs) {
      console.error(
        `    [${v.cat}] "${v.needle}"  ${v.hits} hit${v.hits > 1 ? 's' : ''}  @byte ${v.at}`,
      )
    }
    console.error('')
  }
  console.error(
    `${violations.length} forbidden marker(s) across ${byFile.size} file(s).\n\n` +
      'CUSTOMER = reachable from index.html. ORPHAN = reachable from neither entry,\n' +
      'yet still uploaded: wrangler.jsonc serves all of dist/, so GET /assets/<name>.js\n' +
      'returns it to anyone. "Lazily loaded" is not protection.\n\n' +
      'The customer build must not CONTAIN this code. Move it behind the admin entry\n' +
      '(src/admin/AdminSlots.tsx) or delete it. Values are never printed here — use the\n' +
      'byte offset locally.\n',
  )
  process.exit(1)
}

const counts = { CUSTOMER: 0, ADMIN: 0, ORPHAN: 0 }
for (const f of files) counts[classify(f)]++
console.log(
  `bundle-guard: ${files.length} files scanned ` +
    `(${counts.CUSTOMER} customer / ${counts.ADMIN} admin / ${counts.ORPHAN} orphan), ` +
    `0 forbidden markers across ${FORBIDDEN.length} needles.`,
)
