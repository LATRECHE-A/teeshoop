/**
 * Design schema migrations — pure, store-free, run at every ingress
 * (hydrate / saved-design load / import / share-link) so older persisted
 * documents upgrade in exactly one place instead of ad-hoc guards.
 */
import type { Design, Layer } from '@/lib/types'

/**
 * Ensure a design carries the per-context `stashedLayers` bucket.
 *
 * Older documents stored a single shared `layers` array used by every garment,
 * which leaked default-tee edits onto an uploaded custom garment. We now keep
 * the active garment's artwork in `layers` and the other context's in
 * `stashedLayers`. For a legacy document we seed the stash with a *clone* of
 * the current layers, so the design is preserved on both sides and only
 * diverges on future edits (no artwork is ever lost on upgrade).
 */
export function migrateDesign(design: Design): Design {
  const d = design as Design & { stashedLayers?: Layer[] }
  if (Array.isArray(d.stashedLayers)) return design
  return { ...design, stashedLayers: design.layers.map((l) => ({ ...l }) as Layer) }
}
