/**
 * INGEST — apply a ProductDef to the studio.
 *
 * The studio renders ingested products through the EXISTING custom-garment
 * pipeline (2D/3D/AR): productToCustomGarment maps a product at a chosen
 * size onto CustomGarment, so no renderer changes are needed and dimensions
 * stay real (widthIn = halfChestCm of that size, in inches).
 *
 * GRADING: the resulting CustomGarment also carries the product's whole
 * half-chest table (`halfChestCmBySize`), which is what lets print grading
 * (src/lib/printScale.ts) work for supplier/ship-your-own garments — without
 * it `printScaleK` has no chart to read and silently returns 1 for every size.
 * The garment's geometry (widthIn + retargeted print areas) is authored at ONE
 * reference size, `productBaseSize(product, size)`; that size IS the design's
 * `printScale.baseSize` and the caller must keep the two in step.
 */
import type { CustomGarment, CustomSideSetup, RectIn } from '@/lib/types'
import { clamp, cmToIn } from '@/lib/units'
import { chestChartFrom } from '@/lib/printScale'
import type { SizeId } from '@/content/sizeChart'
import type { ProductDef, ProductSideDef } from './types'
import { productSizeIds } from './types'

export { productSizeIds }

/**
 * The size a request for `size` actually resolves to: `size` when the product
 * covers it, else defaultSize, else the smallest covered size. This is the
 * size the built garment's inch geometry is authored at — see
 * `productBaseSize`.
 */
function resolveSize(product: ProductDef, size: SizeId): SizeId {
  if (product.sizes[size]) return size
  if (product.sizes[product.defaultSize]) return product.defaultSize
  return productSizeIds(product)[0] ?? product.defaultSize
}

/** Spec for `size`, falling back defaultSize → first covered size. */
function specFor(product: ProductDef, size: SizeId) {
  return product.sizes[resolveSize(product, size)]!
}

/**
 * The reference size a `productToCustomGarment(product, size)` result is
 * authored at — `size` itself unless the product does not cover it, in which
 * case the same defaultSize → smallest fallback the geometry took.
 *
 * The design's `printScale.baseSize` MUST be set to this value when the
 * garment is applied: the stored print areas (and widthIn) are this size's
 * physical inches, and grading derives every other size from them. Applying a
 * product without also stamping the base size silently mis-scales every
 * render whenever this differs from the design's current base size.
 */
export function productBaseSize(product: ProductDef, size: SizeId): SizeId {
  return resolveSize(product, size)
}

/**
 * Re-target a print area authored at `authoredWidthIn` onto a garment of
 * `widthIn`: physical print size and collar-relative top stay identical
 * (professional placement is measured from the collar and size-invariant —
 * see src/content/sizeChart.ts), while the horizontal centre offset is
 * preserved relative to the garment's centre line.
 */
function retargetArea(area: RectIn, authoredWidthIn: number, widthIn: number): RectIn {
  const wIn = Math.min(area.wIn, widthIn)
  const centerOffset = area.xIn + area.wIn / 2 - authoredWidthIn / 2
  return {
    wIn,
    hIn: area.hIn,
    xIn: clamp(widthIn / 2 + centerOffset - wIn / 2, 0, widthIn - wIn),
    yIn: Math.max(0, area.yIn),
  }
}

function toSide(
  side: ProductSideDef | null,
  authoredWidthIn: number,
  widthIn: number,
): CustomSideSetup | null {
  if (!side) return null
  return {
    assetId: side.assetId,
    useCutout: side.useCutout,
    printArea: retargetArea(side.printArea, authoredWidthIn, widthIn),
  }
}

/**
 * Build the CustomGarment the studio should render for `product` at `size`.
 * Unknown/uncovered sizes fall back to the product's defaultSize spec.
 *
 * `size` is the BASE size of the result: widthIn and the print areas are that
 * size's real inches, and `halfChestCmBySize` carries the supplier's whole
 * chart so grading can derive every other size from it (a product covering a
 * single size simply never grades — `isGraded` needs two entries). Pair this
 * with `productBaseSize(product, size)` on the design's printScale.
 */
export function productToCustomGarment(
  product: ProductDef,
  size: SizeId,
): CustomGarment {
  const widthIn = cmToIn(specFor(product, size).halfChestCm)
  // printArea semantics: authored at defaultSize (see src/lib/ingest/types.ts).
  const authoredWidthIn = cmToIn(specFor(product, product.defaultSize).halfChestCm)
  return {
    widthIn,
    front: toSide(product.front, authoredWidthIn, widthIn),
    back: toSide(product.back, authoredWidthIn, widthIn),
    // Supplier chart → grading factors. Sizes the product does not cover are
    // absent, so previewing one of them yields k = 1 rather than a guess.
    halfChestCmBySize: chestChartFrom(product.sizes),
  }
}
