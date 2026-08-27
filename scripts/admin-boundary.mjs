/**
 * WHICH SOURCE FILES ARE THE SHOP'S AND NOT THE CUSTOMER'S. One list, three readers.
 *
 * It used to live inside `src/app/adminBoundary.test.ts` alone. Session 13 gave
 * it two more readers and moved it here rather than copying it, because the
 * three would have drifted and the drift would be silent in the direction that
 * matters: a module added to the test's list and not to the bundler's would be
 * forbidden from the customer graph and still emitted into the OPEN asset
 * directory.
 *
 *   src/app/adminBoundary.test.ts   proves nothing here is reachable from the
 *                                   customer entry, by walking the source graph.
 *   vite.config.ts                  emits chunks made only of these into
 *                                   `admin-assets/`, which the Worker gates.
 *   scripts/bundle-guard.mjs        proves the built output really landed that
 *                                   way, and that no customer file did.
 *
 * Plain .mjs and not .ts on purpose: two of the three readers are node scripts
 * with no TypeScript pipeline, and a build config that needs a compiler to read
 * its own security boundary is a boundary with a moving part in it.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

/**
 * Modules that must never be reachable from the customer entry, and whose
 * chunks must never be served without the admin gate.
 *
 * A trailing slash means the whole directory.
 */
export const ADMIN_ONLY = [
  'src/admin/',
  'src/app/modals/CatalogModal.tsx',
  'src/app/modals/DtfModal.tsx',
  'src/app/modals/AdminIngestModal.tsx',
  'src/app/modals/catalogI18n.ts',
  'src/app/modals/dtfI18n.ts',
  'src/lib/admin/',
  'src/lib/dtf/',
  'src/lib/ingest/store.ts',
  'src/lib/ingest/apply.ts',
  'src/lib/ingest/imbretex.ts',
  'src/lib/ingest/falkross.ts',
  'src/lib/ingest/woo.ts',
  'src/lib/ingest/frCache.ts',
]

/**
 * Modules that MUST stay reachable from the customer entry. Without these, an
 * over-zealous cleanup could "fix" a boundary violation by deleting a real
 * customer feature and the test would still pass.
 */
export const MUST_REACH = [
  'src/lib/ingest/pipeline.ts', // ship-your-own garment photo normalisation
  'src/state/basket.ts', // the customer's multi-product order
  'src/app/modals/BasketModal.tsx',
  'src/app/modals/CustomSetupModal.tsx',
  'src/app/backOriginI18n.ts',
  // The route from a design to a WooCommerce basket. Nothing here is
  // shop-internal, and all of it must ship to the customer or the studio cannot
  // sell anything.
  'src/lib/teeshoop/bridge.ts',
  'src/lib/teeshoop/upload.ts',
  'src/lib/teeshoop/designDoc.ts',
  'src/app/modals/CartModal.tsx',
  'src/app/modals/cartI18n.ts',
]

/** The directory admin-only chunks are emitted into, and the Worker gates. */
export const ADMIN_ASSET_DIR = 'admin-assets'

/** Is this repository-relative path (POSIX separators) admin-only? */
export function isAdminOnly(relPath) {
  const p = relPath.replace(/\\/g, '/')
  return ADMIN_ONLY.some((a) => (a.endsWith('/') ? p.startsWith(a) : p === a))
}

// ---------------------------------------------------------------------------
// The source graph, walked. Moved here from src/app/adminBoundary.test.ts so
// that the bundler and the test decide "admin-only" from ONE walk. The bundler
// needs the graph and not the list above: a chunk made of DtfModal also carries
// shared helpers like src/lib/units.ts, which are not admin-only by path and
// are admin-only by reachability. Deciding on the path alone left six of the
// seven admin chunks in the open directory, which was measured before this
// paragraph was written.
// ---------------------------------------------------------------------------


const EXTS = ['.ts', '.tsx', '.d.ts']

function resolveSpecifier(spec, fromFile, srcDir) {
  if (!spec.startsWith('.') && !spec.startsWith('@/')) return null // bare package
  const base = spec.startsWith('@/') ? join(srcDir, spec.slice(2)) : resolve(dirname(fromFile), spec)
  for (const e of EXTS) if (existsSync(base + e)) return base + e
  for (const e of EXTS) if (existsSync(join(base, 'index' + e))) return join(base, 'index' + e)
  if (existsSync(base) && /\.[tj]sx?$/.test(base)) return base
  return null
}

/**
 * Every value-level specifier in a file. `import type` is skipped: TypeScript
 * erases it, so no edge survives into the bundle. A dynamic `import()` is NOT
 * skipped, because a lazy chunk still ships and is still fetchable.
 */
export function specifiersOf(src) {
  const out = []
  for (const m of src.matchAll(/^\s*(?:import|export)\s+([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/gm)) {
    if (/^type[\s{]/.test(m[1].trim())) continue
    out.push(m[2])
  }
  for (const m of src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) out.push(m[1])
  for (const m of src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1])
  /*
   * AND A WEB WORKER, which is an edge no import parser sees.
   *
   *     new Worker(new URL('./nestWorker.ts', import.meta.url), { type: 'module' })
   *
   * is how src/lib/dtf/nestClient.ts starts the gang-sheet packer, and until
   * session 13 the walk stopped there. Two things followed. The bundler emitted
   * `nestWorker-<hash>.js`, which IS the film economics, into the open asset
   * directory, because the module was not known to be admin-only. And the
   * boundary test could not have seen a customer module reaching admin code the
   * same way, which is the more dangerous half: a leak it exists to catch.
   *
   * scripts/bundle-guard.mjs already knew: its own reachability closure covers
   * bare asset-name mentions "because `new Worker(new URL(…))` … no import
   * parser sees" them. The source walk now sees them too.
   *
   * `resolveSpecifier` only resolves .ts/.tsx, so the same construct used for a
   * wasm binary or an image resolves to nothing and is ignored.
   */
  for (const m of src.matchAll(/new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g))
    out.push(m[1])
  return out
}

/** Transitive closure from an entry: repo-relative path to the file that pulled it in. */
export function closureFrom(entry, repoRoot) {
  const srcDir = join(repoRoot, 'src')
  const reached = new Map([[entry, '(entry)']])
  const queue = [entry]
  while (queue.length) {
    const file = queue.pop()
    let src
    try {
      src = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const spec of specifiersOf(src)) {
      const target = resolveSpecifier(spec, file, srcDir)
      if (!target || reached.has(target)) continue
      reached.set(target, file)
      queue.push(target)
    }
  }
  return new Map([...reached].map(([f, by]) => [relative(repoRoot, f), relative(repoRoot, by)]))
}

/**
 * Absolute paths of every module the ADMIN entry reaches and neither of the two
 * public entries does. This is what decides where a chunk is emitted.
 *
 * The viewer counts as public: it is the page a QR code opens on a customer's
 * phone, and it is served without any gate at all.
 */
export function adminOnlyModules(repoRoot) {
  const src = join(repoRoot, 'src')
  const publicSet = new Set([
    ...closureFrom(join(src, 'main.tsx'), repoRoot).keys(),
    ...closureFrom(join(src, 'viewer', 'main.ts'), repoRoot).keys(),
  ])
  const admin = closureFrom(join(src, 'admin', 'main.tsx'), repoRoot)
  const out = new Set()
  for (const rel of admin.keys()) if (!publicSet.has(rel)) out.add(join(repoRoot, rel))
  /*
   * And the HTML entry itself, which rollup counts as a module of the entry
   * chunk. Without it that chunk has one module the walk never saw, `every`
   * fails, and the file that imports all the others is the one left in the open
   * directory. index.html and v.html are deliberately absent: they are public.
   */
  out.add(join(repoRoot, 'admin.html'))
  return out
}
