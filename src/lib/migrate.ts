/**
 * Design schema migrations — pure, store-free, run at every ingress
 * (hydrate / saved-design load / import / share-link) so older persisted
 * documents upgrade in exactly one place instead of ad-hoc guards.
 */
import type { Design, Layer } from '@/lib/types'
import { DEFAULT_SIZE } from '@/content/sizeChart'
import { DEFAULT_PRINT_SCALE_MODE } from '@/lib/printScale'

/**
 * Upgrade a persisted design to the current schema.
 *
 * 1. `stashedLayers` — older documents stored a single shared `layers` array
 *    used by every garment, which leaked default-tee edits onto an uploaded
 *    custom garment. We now keep the active garment's artwork in `layers` and
 *    the other context's in `stashedLayers`. For a legacy document we seed the
 *    stash with a *clone* of the current layers, so the design is preserved on
 *    both sides and only diverges on future edits (no artwork is ever lost).
 *
 * 2. `printScale` — stamp the grading policy explicitly rather than leaving it
 *    to a runtime default, so a document's behaviour is pinned to what is
 *    stored. Legacy geometry was authored against the default size with no
 *    grading, which is exactly `baseSize: DEFAULT_SIZE` — so the design renders
 *    identically at its base size and only gains graded output at other sizes.
 */
export function migrateDesign(design: Design): Design {
  const d = design as Design & { stashedLayers?: Layer[] }
  let out = design
  if (!Array.isArray(d.stashedLayers))
    out = { ...out, stashedLayers: design.layers.map((l) => ({ ...l }) as Layer) }
  if (!out.printScale)
    out = { ...out, printScale: { mode: DEFAULT_PRINT_SCALE_MODE, baseSize: DEFAULT_SIZE } }
  return out
}
