/**
 * THE ADMIN BOUNDARY, enforced.
 *
 * Walks the real import graph from the CUSTOMER entry (src/main.tsx) and fails
 * if it can reach anything that carries shop-internal data: our purchase costs,
 * our film cost model, or the WooCommerce credential form.
 *
 * WHY A GRAPH WALK AND NOT A LINT RULE. The thing that must not happen is an
 * admin module being REACHABLE, however indirectly — through an i18n side-file,
 * a barrel, a helper. That is a property of the whole graph, not of any one
 * file, so only a graph walk can state it.
 *
 * DYNAMIC IMPORTS COUNT AS EDGES. `lazy(() => import('./DtfModal'))` still
 * emits a chunk, that chunk still uploads, and `GET /assets/<hash>.js` still
 * returns it to anyone. Lazy is a load-time optimisation, never a boundary.
 * This is exactly the mistake the code made before 2026-08-12.
 *
 * `import type` does NOT count: TypeScript erases it, so no edge survives into
 * the bundle. That is what lets pipeline.ts keep its type-only reference to
 * ingest/types.ts without dragging the supplier adapters in.
 *
 * This test proves the SOURCE graph. scripts/bundle-guard.mjs proves the same
 * property against the built output, from the other direction. Keep both: this
 * one localises the offending import, that one cannot be fooled by a clever
 * re-export.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('..', import.meta.url))
const REPO = resolve(SRC, '..')

/** Modules that must never be reachable from the customer entry. */
const ADMIN_ONLY = [
  'src/admin/',
  'src/app/modals/CatalogModal.tsx',
  'src/app/modals/DtfModal.tsx',
  'src/app/modals/AdminIngestModal.tsx',
  'src/app/modals/catalogI18n.ts',
  'src/app/modals/dtfI18n.ts',
  'src/lib/dtf/',
  'src/lib/ingest/store.ts',
  'src/lib/ingest/apply.ts',
  'src/lib/ingest/imbretex.ts',
  'src/lib/ingest/falkross.ts',
  'src/lib/ingest/woo.ts',
  'src/lib/ingest/frCache.ts',
]

/**
 * Modules that MUST stay reachable. Without these, an over-zealous cleanup
 * could "fix" a boundary violation by deleting a real customer feature and the
 * test above would still pass.
 */
const MUST_REACH = [
  'src/lib/ingest/pipeline.ts', // ship-your-own garment photo normalisation
  'src/state/basket.ts', // the customer's multi-product order
  'src/app/modals/BasketModal.tsx',
  'src/app/modals/CustomSetupModal.tsx',
  'src/app/backOriginI18n.ts',
]

const EXTS = ['.ts', '.tsx', '.d.ts']

function resolveSpecifier(spec: string, fromFile: string): string | null {
  if (!spec.startsWith('.') && !spec.startsWith('@/')) return null // bare package
  const base = spec.startsWith('@/')
    ? join(SRC, spec.slice(2))
    : resolve(dirname(fromFile), spec)
  for (const e of EXTS) if (existsSync(base + e)) return base + e
  for (const e of EXTS) if (existsSync(join(base, 'index' + e))) return join(base, 'index' + e)
  if (existsSync(base) && /\.[tj]sx?$/.test(base)) return base
  return null
}

/** Every value-level specifier in a file. Type-only imports are skipped. */
function specifiersOf(src: string): string[] {
  const out: string[] = []
  // static `import ... from 'x'` and `export ... from 'x'`, minus `import type`
  for (const m of src.matchAll(/^\s*(?:import|export)\s+([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/gm)) {
    if (/^type[\s{]/.test(m[1].trim())) continue
    out.push(m[2])
  }
  // bare side-effect import
  for (const m of src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) out.push(m[1])
  // dynamic import() — an edge, see the header
  for (const m of src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1])
  return out
}

/** The transitive closure from an entry, as repo-relative paths → importer. */
function closureFrom(entry: string): Map<string, string> {
  const reached = new Map<string, string>([[entry, '(entry)']])
  const queue = [entry]
  while (queue.length) {
    const file = queue.pop()!
    let src: string
    try {
      src = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const spec of specifiersOf(src)) {
      const target = resolveSpecifier(spec, file)
      if (!target || reached.has(target)) continue
      reached.set(target, file)
      queue.push(target)
    }
  }
  return new Map([...reached].map(([f, by]) => [relative(REPO, f), relative(REPO, by)]))
}

describe('admin/customer bundle boundary', () => {
  const customer = closureFrom(join(SRC, 'main.tsx'))

  it('the customer entry reaches a real graph (guards against a broken walk)', () => {
    expect(customer.size).toBeGreaterThan(80)
    expect([...customer.keys()]).toContain('src/app/App.tsx')
  })

  it('the customer entry reaches NO admin-only module', () => {
    const leaks = [...customer.entries()]
      .filter(([f]) => ADMIN_ONLY.some((deny) => f.startsWith(deny) || f === deny))
      .map(([f, by]) => `${f}  ←  imported by ${by}`)

    expect(
      leaks,
      leaks.length
        ? `\nAdmin-only modules are reachable from src/main.tsx:\n  ${leaks.join('\n  ')}\n\n` +
            'These carry our purchase costs / film economics / Woo credentials.\n' +
            'Render them through useAdminSlots() instead (src/app/adminSlots.tsx),\n' +
            'or split the customer-safe part into its own module.\n'
        : '',
    ).toEqual([])
  })

  it('the customer entry still reaches every customer feature', () => {
    for (const must of MUST_REACH) expect([...customer.keys()]).toContain(must)
  })

  it('the ADMIN entry does reach the admin tools (proves the walk can see them)', () => {
    const admin = closureFrom(join(SRC, 'admin', 'main.tsx'))
    expect([...admin.keys()]).toContain('src/app/modals/DtfModal.tsx')
    expect([...admin.keys()]).toContain('src/app/modals/CatalogModal.tsx')
    expect([...admin.keys()]).toContain('src/app/modals/AdminIngestModal.tsx')
  })
})
