/**
 * INGEST — product auto-ingest type contracts.
 *
 * A ProductDef is an admin-authored garment: two photos (front required,
 * back optional) + a per-size cm table. It converts into the studio's
 * existing CustomGarment (src/lib/types.ts) via src/lib/ingest/apply.ts, so
 * ingested products ride the whole 2D/3D/AR custom-garment pipeline with
 * real dimensions.
 *
 * Dimensional model (identical to CustomSideSetup — see src/lib/types.ts):
 * `printArea` is in INCHES, relative to the photo's alpha-bounding-box
 * top-left, where the bbox WIDTH equals the garment's laid-flat width
 * (halfChestCm of the size the area was authored at — always `defaultSize`).
 * apply.ts re-centers horizontally for other sizes; vertical placement is
 * collar-relative and size-invariant (same convention as sizeChart.ts).
 *
 * Future API sources map into this schema without changes:
 *  - Printful catalog (GET /products/{id}/sizes): `size_tables[].measurements`
 *    rows "Chest width"→halfChestCm (halve if the table is full-chest
 *    circumference), "Length"→bodyLengthCm, "Sleeve length"→sleeveLengthCm;
 *    `type: 'measure_yourself'` tables are body measurements — skip those and
 *    use the `product_measure` table. Sizes S..3XL → SizeId 1:1 ("XXL"→'2XL').
 *  - Stanley/Stella Sizes API: `halfChest`, `bodyLength`, `sleeveLength`
 *    fields are already flat cm — direct 1:1 mapping; `styleCode` → brandRef.
 *  - WooCommerce (src/lib/ingest/woo.ts): images[].src → photos through the
 *    pipeline; name/attributes → name/notes; cm tables are entered/pasted by
 *    the admin (Woo has no canonical size-table field).
 */
import type { SizeId, SizeSpecCm } from '@/content/sizeChart'
import { SIZE_IDS, isSizeId } from '@/content/sizeChart'
import type { RectIn } from '@/lib/types'

/**
 * One side of the product. Structurally compatible with CustomSideSetup on
 * purpose (assetId/useCutout/printArea) so side defs flow into the custom
 * pipeline without translation.
 */
export interface ProductSideDef {
  /** Photo of this garment side, stored in the shared asset library. */
  assetId: string
  /** Render/measure against the background-removed cutout (recommended). */
  useCutout: boolean
  /**
   * Print area in inches, relative to the photo's alpha-bbox top-left;
   * bbox width = halfChestCm(defaultSize) in inches. See module header.
   */
  printArea: RectIn
}

export interface ProductDef {
  id: string
  name: string
  /** Manufacturer + style reference, e.g. "Stanley/Stella Creator STTU755". */
  brandRef: string
  createdAt: number
  /**
   * Flat cm measurements per size — reuses the catalog SizeSpecCm shape
   * (src/content/sizeChart.ts). At least ONE size must be present; keys are
   * canonical SizeIds.
   */
  sizes: Partial<Record<SizeId, SizeSpecCm>>
  /**
   * Size the photos + printArea were authored at (must exist in `sizes`).
   * Also the size "Use in studio" applies by default.
   */
  defaultSize: SizeId
  front: ProductSideDef
  back: ProductSideDef | null
  notes?: string
}

/** Lightweight index row for the product library (list view + cards). */
export interface ProductMeta {
  id: string
  name: string
  brandRef: string
  /** Sizes covered, ordered per SIZE_IDS. */
  sizeIds: SizeId[]
  /** Small front-photo data-url thumbnail. */
  thumb: string
  createdAt: number
}

function isRectIn(v: unknown): v is RectIn {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    typeof r.xIn === 'number' &&
    typeof r.yIn === 'number' &&
    typeof r.wIn === 'number' &&
    typeof r.hIn === 'number'
  )
}

function isSideDef(v: unknown): v is ProductSideDef {
  if (typeof v !== 'object' || v === null) return false
  const s = v as Record<string, unknown>
  return (
    typeof s.assetId === 'string' &&
    typeof s.useCutout === 'boolean' &&
    isRectIn(s.printArea)
  )
}

function isSpecCm(v: unknown): v is SizeSpecCm {
  if (typeof v !== 'object' || v === null) return false
  const s = v as Record<string, unknown>
  return (
    typeof s.halfChestCm === 'number' &&
    s.halfChestCm > 0 &&
    typeof s.bodyLengthCm === 'number' &&
    s.bodyLengthCm > 0 &&
    typeof s.sleeveLengthCm === 'number' &&
    s.sleeveLengthCm >= 0
  )
}

/** Structural guard used by the JSON product-file import. */
export function isProductDef(v: unknown): v is ProductDef {
  if (typeof v !== 'object' || v === null) return false
  const p = v as Record<string, unknown>
  if (
    typeof p.id !== 'string' ||
    typeof p.name !== 'string' ||
    typeof p.brandRef !== 'string' ||
    typeof p.createdAt !== 'number' ||
    !isSizeId(p.defaultSize) ||
    !isSideDef(p.front) ||
    (p.back !== null && !isSideDef(p.back)) ||
    typeof p.sizes !== 'object' ||
    p.sizes === null
  ) {
    return false
  }
  const entries = Object.entries(p.sizes as Record<string, unknown>)
  const valid = entries.filter(([k, spec]) => isSizeId(k) && isSpecCm(spec))
  if (valid.length === 0) return false
  return valid.some(([k]) => k === p.defaultSize)
}

/**
 * Drop non-canonical / malformed size rows — isProductDef only requires ONE
 * valid row, and an entry with a 0 or missing halfChestCm would still be
 * selectable as the reference size and collapse the print area (NaN ppi).
 */
export function sanitizeSizes(
  sizes: Partial<Record<SizeId, SizeSpecCm>>,
): Partial<Record<SizeId, SizeSpecCm>> {
  const out: Partial<Record<SizeId, SizeSpecCm>> = {}
  for (const [k, spec] of Object.entries(sizes)) {
    if (isSizeId(k) && isSpecCm(spec)) out[k] = spec
  }
  return out
}

/** Sizes present on the product, in canonical SIZE_IDS order. */
export function productSizeIds(product: ProductDef): SizeId[] {
  return SIZE_IDS.filter((id) => product.sizes[id] !== undefined)
}
