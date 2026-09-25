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
import { dirname, join, relative, resolve, sep } from 'node:path'

/*
 * The three readers of this module (the boundary test, vite.config.ts,
 * bundle-guard.mjs) all write their lists with POSIX separators, per the
 * contract documented on `isAdminOnly` below. `relative()` returns the native
 * separator, which is `\` on Windows, so every path this module hands back
 * is normalised to `/` here, once, rather than in each caller.
 */
const toPosix = (p) => p.split(sep).join('/')

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
]

/*
 * WHAT LEFT THIS LIST ON 5 SEPTEMBER 2026, AND WHY IT IS NOT A REGRESSION.
 *
 * It carried `src/lib/teeshoop/bridge.ts`, `CartModal.tsx` and `cartI18n.ts`
 * under the note "the route from a design to a WooCommerce basket … all of it
 * must ship to the customer or the studio cannot sell anything". That route is
 * gone: the customer's customiser is `src/native/`, served by WordPress in the
 * product page, and the postMessage bridge it needed was deleted at both ends.
 * The three files are deleted too, so listing them here would fail the boundary
 * test for a feature that no longer exists.
 *
 * `upload.ts` and `designDoc.ts` are NOT listed any more either, and that is
 * deliberate rather than an oversight: they are no longer reachable from
 * `src/main.tsx` (nothing in the studio uploads a design now), and what holds
 * them is `OBLIGATOIRES` in `scripts/editeur-guard.mjs`, which walks from the
 * editor's entry. The guarantee moved with the feature.
 */

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
export function specifiersOf(source, { dynamic = true } = {}) {
  const out = []
  /*
   * LES COMMENTAIRES SONT RETIRÉS D'ABORD, ET CE N'EST PAS DE LA COSMÉTIQUE.
   *
   * Mesuré le 5 septembre 2026 : `src/editor/EditorEngine.ts` a cessé
   * d'importer `@/i18n` et le parcours a continué de le voir, parce que le
   * commentaire qui EXPLIQUE la suppression cite l'ancienne ligne entre
   * apostrophes inverses. Un marcheur de graphe qui lit la prose invente des
   * arêtes, et sur ce fichier-là les arêtes décident où un morceau est émis et
   * ce qu'un client a le droit de télécharger.
   *
   * Le remplacement garde les sauts de ligne pour que le drapeau `m` des
   * expressions régulières ci-dessous continue d'ancrer sur les vrais débuts de
   * ligne. Une apostrophe dans un commentaire (« l'import ») ne gêne pas : ce
   * qui est retiré l'est avant qu'on cherche quoi que ce soit.
   */
  const src = source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^([ \t]*)\/\/.*$/gm, '$1')
  for (const m of src.matchAll(/^\s*(?:import|export)\s+([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/gm)) {
    if (/^type[\s{]/.test(m[1].trim())) continue
    out.push(m[2])
  }
  for (const m of src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) out.push(m[1])
  /*
   * `dynamic: false` LEAVES `import()` OUT, and there is exactly one caller.
   *
   * For the ADMIN boundary a lazy chunk is still an edge: it ships, it uploads,
   * and `GET /assets/<hash>.js` still returns it to anyone. For the SHOP
   * editor's first load the question is the opposite one, what a customer
   * downloads before clicking anything, and there a chunk that is only fetched
   * on demand is precisely what the split exists to produce. Two questions, one
   * walk, and the difference is named rather than reimplemented.
   */
  if (dynamic) for (const m of src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1])
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
export function closureFrom(entry, repoRoot, opts = {}) {
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
    for (const spec of specifiersOf(src, opts)) {
      const target = resolveSpecifier(spec, file, srcDir)
      if (!target || reached.has(target)) continue
      reached.set(target, file)
      queue.push(target)
    }
  }
  return new Map(
    [...reached].map(([f, by]) => [toPosix(relative(repoRoot, f)), toPosix(relative(repoRoot, by))]),
  )
}

/**
 * Absolute paths (POSIX separators) of every module the ADMIN entry reaches
 * and neither of the two public entries does. This is what decides where a
 * chunk is emitted.
 *
 * The viewer counts as public: it is the page a QR code opens on a customer's
 * phone, and it is served without any gate at all.
 *
 * POSIX separators, even in the absolute paths, because the one caller
 * (vite.config.ts) tests membership against Rollup's own module ids, and
 * Rollup writes those with `/` on every platform, Windows included.
 */
export function adminOnlyModules(repoRoot) {
  const src = join(repoRoot, 'src')
  const publicSet = new Set([
    ...closureFrom(join(src, 'main.tsx'), repoRoot).keys(),
    ...closureFrom(join(src, 'viewer', 'main.ts'), repoRoot).keys(),
  ])
  const admin = closureFrom(join(src, 'admin', 'main.tsx'), repoRoot)
  const out = new Set()
  for (const rel of admin.keys()) if (!publicSet.has(rel)) out.add(toPosix(join(repoRoot, rel)))
  /*
   * And the HTML entry itself, which rollup counts as a module of the entry
   * chunk. Without it that chunk has one module the walk never saw, `every`
   * fails, and the file that imports all the others is the one left in the open
   * directory. index.html and v.html are deliberately absent: they are public.
   */
  out.add(toPosix(join(repoRoot, 'admin.html')))
  return out
}
