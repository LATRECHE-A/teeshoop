/**
 * Print grading: how artwork responds to garment size.
 *
 * THE MODEL
 * ---------
 * A design's layer geometry is stored ONCE, in inches, at `printScale.baseSize`.
 * Rendering it at any other size multiplies every inch-valued quantity (layer
 * offsets, widths, heights, font sizes, stroke widths AND the print area itself)
 * by one uniform factor `k`. Because the artwork and the area scale together,
 * the design occupies exactly the same fraction of the print area on every size:
 * an S and a 3XL are visually identical, just at different physical scales.
 *
 * `k` is the CHEST ratio (halfChest(size) / halfChest(baseSize)), and it is
 * deliberately UNIFORM: grading x and y by different amounts (chest vs body
 * length) would distort the artwork, which is never acceptable. Chest is the
 * right reference because prints are width-constrained.
 *
 * In `fixed` mode k is always 1: one physical print for every size, positioned a
 * size-invariant distance below the collar. That is the classic single-transfer
 * convention and it is the cheaper one. See the cost note below.
 *
 * WHY THIS SHAPE
 * --------------
 * Storing one canonical geometry + a derived factor (rather than per-size
 * geometry) keeps the project's core invariant intact (geometry is inches
 * relative to the print-area centre) and means every existing editor gesture
 * keeps writing base-space inches with no change: the editor scales the area
 * rect by k and its pixels-per-inch by k, so the two cancel on write-back.
 *
 * COST
 * ----
 * Grading is not free. In `fixed` mode an order of 6 sizes needs ONE printed
 * transfer; in `scaled` mode it needs six different ones, so the DTF gang sheet
 * carries a distinct piece per (design, side, size) and uses more film. The DTF
 * modal surfaces this: it is a real trade-off, not an implementation detail.
 */
import type { CustomGarment, Design, Layer, SizeIn, PrintScale, PrintScaleMode } from './types'
import { DEFAULT_SIZE, SIZE_IDS, sizeSpecCm, type SizeId } from '@/content/sizeChart'

/** New designs grade with the garment; override per design in the UI. */
export const DEFAULT_PRINT_SCALE_MODE: PrintScaleMode = 'scaled'

/** Grading policy for a design, with defaults for pre-grading documents. */
export function printScaleOf(design: Design): PrintScale {
  const ps = design.printScale
  return {
    mode: ps?.mode === 'fixed' || ps?.mode === 'scaled' ? ps.mode : DEFAULT_PRINT_SCALE_MODE,
    baseSize: ps?.baseSize ?? DEFAULT_SIZE,
  }
}

/** The size a design's stored inch geometry is authored at. */
export function printBaseSize(design: Design): SizeId {
  return printScaleOf(design).baseSize
}

/** Half-chest in cm for a garment size, or null when it is not knowable. */
function halfChestCm(design: Design, size: SizeId): number | null {
  if (design.garmentId === 'custom') {
    const chart = design.custom?.halfChestCmBySize
    const v = chart?.[size]
    return typeof v === 'number' && v > 0 ? v : null
  }
  return sizeSpecCm(design.garmentId, size).halfChestCm
}

/**
 * Uniform grading factor for `size`, relative to the design's base size.
 *
 * Returns exactly 1 (no grading) when the mode is `fixed`, when no size is
 * given, when the size IS the base size, or when the garment publishes no chart
 * for either size (an ingested product whose supplier chart we never captured).
 * Never guesses a ratio it cannot derive.
 */
export function printScaleK(design: Design, size?: SizeId | null): number {
  const { mode, baseSize } = printScaleOf(design)
  if (mode === 'fixed' || !size || size === baseSize) return 1
  const a = halfChestCm(design, size)
  const b = halfChestCm(design, baseSize)
  if (a === null || b === null || b <= 0) return 1
  return a / b
}

/** True when this design grades AND the garment can actually be graded. */
export function isGraded(design: Design): boolean {
  if (printScaleOf(design).mode !== 'scaled') return false
  if (design.garmentId !== 'custom') return true
  const chart = design.custom?.halfChestCmBySize
  return !!chart && Object.keys(chart).length > 1
}

/** Sizes this design can be graded to, in chart order. */
export function gradableSizes(design: Design): SizeId[] {
  if (design.garmentId !== 'custom') return [...SIZE_IDS]
  const chart = design.custom?.halfChestCmBySize ?? {}
  return SIZE_IDS.filter((s) => (chart[s] ?? 0) > 0)
}

/**
 * Scale one layer's inch-valued geometry. Rotation, opacity, curve and
 * letter-spacing are scale-invariant (letterSpacingEm is relative to the font
 * size, which is itself scaled). Returns the SAME reference when k === 1 so
 * render paths can keep their identity-based memoisation.
 */
export function scaleLayer<T extends Layer>(layer: T, k: number): T {
  if (k === 1) return layer
  const base = { ...layer, xIn: layer.xIn * k, yIn: layer.yIn * k }
  if (base.type === 'text')
    return { ...base, fontSizeIn: base.fontSizeIn * k, strokeWidthIn: base.strokeWidthIn * k }
  return { ...base, wIn: base.wIn * k, hIn: base.hIn * k }
}

/** Scale a whole side's layers (identity when k === 1). */
export function scaleLayers(layers: Layer[], k: number): Layer[] {
  return k === 1 ? layers : layers.map((l) => scaleLayer(l, k))
}

/** Scale a print-area size. */
export function scaleAreaIn(area: SizeIn, k: number): SizeIn {
  return k === 1 ? area : { wIn: area.wIn * k, hIn: area.hIn * k }
}

/**
 * Half-chest chart to stash on a custom garment so ingested products grade too.
 * Drops non-positive entries rather than storing a zero that would read as
 * "chart present but broken".
 */
export function chestChartFrom(
  sizes: Partial<Record<SizeId, { halfChestCm: number }>>,
): CustomGarment['halfChestCmBySize'] {
  const out: Partial<Record<SizeId, number>> = {}
  for (const [size, spec] of Object.entries(sizes) as [SizeId, { halfChestCm: number }][])
    if (spec && spec.halfChestCm > 0) out[size] = spec.halfChestCm
  return out
}
