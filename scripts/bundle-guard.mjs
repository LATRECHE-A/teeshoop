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
import { join, relative, basename, sep } from 'node:path'
import { ADMIN_ASSET_DIR } from './admin-boundary.mjs'
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
  /*
   * WHAT COUNTS AS A MENTION, and this is a correction with a measured cost.
   *
   * The rule used to be `txt.includes(basename(f))` for every emitted file. That
   * is safe for a hashed chunk, whose basename is unique by construction, and
   * unsafe for anything else: `dist/.vite/manifest.json` has the basename
   * `manifest.json`, and `DtfModal-<hash>.js` contains that literal because it
   * reads a DESIGN manifest out of R2. So the Vite manifest was pulled into the
   * ADMIN closure by an accidental substring, and because it lists the name of
   * every emitted file, everything else followed it in.
   *
   * Measured on 27/08/2026, before the manifest stopped being emitted: 39 files,
   * 28 customer, 11 ADMIN, 0 orphan. The 11 were 9 real admin files, the
   * manifest, and the AR viewer's entry chunk. An ADMIN file is EXCUSED from the
   * forbidden-marker scan below, so for as long as that held, a genuinely
   * orphaned chunk carrying a purchase price would have been classified ADMIN
   * and never read. The guard was green and half blind.
   *
   * A hashed name is matched as a substring, because that is how it appears
   * inside a chunk. Everything else is matched on its dist-relative PATH, which
   * is how the code that fetches it actually writes it.
   */
  const HASHED = /-[A-Za-z0-9_-]{6,}\.(?:js|mjs|css)$/
  /*
   * An unhashed file is matched on its dist-relative path OR on its directory,
   * because a URL is often assembled rather than written whole:
   * `src/lib/ingest/imbretex.ts:175` holds `IMBRETEX_ROOT = '/catalog/imbretex/'`
   * and appends `products.json` to it, so the full path is in no chunk and the
   * snapshot read as an orphan. A directory is still specific enough to mean
   * something; a bare basename was not, which is the mistake above.
   */
  const mentions = (txt, f) => {
    const b = basename(f)
    if (HASHED.test(b)) return txt.includes(b)
    const rel = relative(DIST, f).split(sep).join('/')
    const dir = rel.slice(0, rel.lastIndexOf('/') + 1)
    return txt.includes(rel) || (dir !== '' && txt.includes(dir) && txt.includes(b))
  }
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
    for (const path of allFiles) {
      if (!seen.has(path) && mentions(txt, path)) queue.push(path)
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
/*
 * AND THE AR VIEWER, which is a third entry and is PUBLIC: it is the page a QR
 * code opens on a customer's phone, served by the Worker with no gate at all.
 * It was missing from this walk, so its entry chunk was an ORPHAN by
 * construction, and before the manifest stopped being emitted it was swept into
 * ADMIN instead, which excused it from the marker scan.
 */
const viewer = reachableFrom(join(DIST, 'v.html'), files)

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

if (!viewer) {
  console.error(
    '\nBUNDLE GUARD FAILED — dist/v.html is missing.\n' +
      'It is the page /v/{id} serves to a scanned QR code. Without it the Worker\n' +
      'falls through to the SPA and a customer opening their own AR link gets the\n' +
      'studio instead.\n',
  )
  process.exit(1)
}

const adminSet = admin ?? new Set()
/*
 * CUSTOMER and VIEWER are both public and are treated identically everywhere
 * below; they are counted apart only so the summary line says which entry pulled
 * what.
 */
const classify = (f) =>
  customer.has(f) ? 'CUSTOMER' : viewer.has(f) ? 'VIEWER' : adminSet.has(f) ? 'ADMIN' : 'ORPHAN'

/*
 * The one kind of ADMIN file that must NOT move, with the reason.
 *
 * `public/catalog/imbretex/products.json` is a committed snapshot of a supplier's
 * PUBLISHED catalogue. Its price field is `rrpEur`, the recommended retail price
 * the supplier prints in its own brochure, and the file says so in its own text:
 * "(prix conseillé de revente), not buying prices". It carries no purchase price
 * and no margin. It is classified ADMIN only because the ingest tools are the
 * only thing that reads it, and its URL is baked into that code and into the
 * committed HTML, so moving it would break a fetch to protect nothing.
 *
 * The exemption is from the LAYOUT rule only. Everything on this list is put
 * BACK into the marker scan below, which every other ADMIN file is excused from:
 * a file that may stay in the open must be the one file we check hardest.
 */
const PUBLIC_ADMIN = new Set(['catalog/imbretex/products.json'])
const relOf = (f) => relative(DIST, f).split(sep).join('/')


const violations = []
for (const f of files) {
  const zone = classify(f)
  // Markers belong in an ADMIN file, which is gated. The exception is a file
  // excused from the layout rule: it stays in the open, so it gets scanned.
  if (zone === 'ADMIN' && !PUBLIC_ADMIN.has(relOf(f))) continue
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

/*
 * AND THE LAYOUT, which is the half the marker scan cannot express.
 *
 * The scan above ALLOWS shop-internal markers in a file classified ADMIN, on the
 * grounds that only the workshop loads it. That was true of the page and false
 * of its JavaScript: measured on 27/08/2026 against a real Worker,
 * `GET /admin.html` answered 401 and `GET /assets/DtfModal-<hash>.js` answered
 * 200 with the whole film cost model, to a request with no credentials. The
 * content hash is not a secret either: `GET /.vite/manifest.json` answered 200
 * and named every chunk.
 *
 * So an ADMIN file must now live where the Worker gates it, and this is what
 * says so. Both directions matter: an admin chunk left in `assets/` is the leak,
 * and a customer chunk that lands in `admin-assets/` is a studio that 401s for
 * every visitor. The HTML entries are exempt, they are gated by path.
 */
const misplaced = []
for (const f of files) {
  const rel = relOf(f)
  const zone = classify(f)
  const gated = rel.startsWith(ADMIN_ASSET_DIR + '/')
  if (zone === 'ADMIN' && !gated && !PUBLIC_ADMIN.has(rel)) misplaced.push({ rel, zone, want: 'admin-assets/' })
  if (zone !== 'ADMIN' && gated) misplaced.push({ rel, zone, want: 'assets/' })
}
if (misplaced.length) {
  console.error('\nBUNDLE GUARD FAILED — an emitted file is in the wrong directory for its zone.\n')
  for (const m of misplaced) console.error(`  ${m.rel}  [${m.zone}]  should be under ${m.want}`)
  console.error(
    '\nADMIN files must be under admin-assets/, which worker/index.ts refuses without\n' +
      'the admin credentials; everything else must not be, or the customer studio 401s.\n' +
      'The split is decided in vite.config.ts from the source graph in\n' +
      'scripts/admin-boundary.mjs.\n',
  )
  process.exit(1)
}

/*
 * NOTHING GATED IS NOT A PASS EITHER. If the admin entry ever stops producing
 * admin-only chunks the check above becomes vacuously true, and this repository
 * has already shipped one gate whose failure branch was unreachable.
 */
if (admin && ![...files].some((f) => relative(DIST, f).split(sep).join('/').startsWith(ADMIN_ASSET_DIR + '/'))) {
  console.error(
    '\nBUNDLE GUARD FAILED — nothing was emitted into admin-assets/.\n' +
      'The admin entry exists, so at least its own chunk must be there. An empty\n' +
      'gated directory means the split in vite.config.ts stopped working and every\n' +
      'admin chunk is being served openly again.\n',
  )
  process.exit(1)
}

const counts = { CUSTOMER: 0, VIEWER: 0, ADMIN: 0, ORPHAN: 0 }
for (const f of files) counts[classify(f)]++

/*
 * ORPHANS ARE NAMED, not just counted. An orphan is a file no entry asks for and
 * that is uploaded and fetchable anyway; the number alone has never once been
 * enough to know whether that is fine. Printing them costs one line and is what
 * makes the count reviewable.
 */
const orphans = files.filter((f) => classify(f) === 'ORPHAN').map(relOf)
if (orphans.length) {
  console.log(`bundle-guard: ${orphans.length} orphan file(s), reachable from no entry and served anyway:`)
  for (const o of orphans) console.log(`  ${o}`)
}
console.log(
  `bundle-guard: ${files.length} files scanned ` +
    `(${counts.CUSTOMER} customer / ${counts.VIEWER} viewer / ${counts.ADMIN} admin / ${counts.ORPHAN} orphan), ` +
    `0 forbidden markers across ${FORBIDDEN.length} needles, ` +
    `every admin file under ${ADMIN_ASSET_DIR}/.`,
)
