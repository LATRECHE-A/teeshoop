/**
 * INGEST — product auto-ingest type contracts.
 *
 * A ProductDef is an admin-authored garment: two photos (front required, back
 * `real | generated | missing` — see BackSource) + a per-size cm table. It
 * converts into the studio's
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
 * Where a side's image came from. `'generated'` means it was RECONSTRUCTED
 * from the other side (src/lib/ingest/pipeline.ts) because no real photo
 * exists — a preview, never a contractual representation of the product.
 *
 * The field is OPTIONAL and absent means `'photo'`: every side stored before
 * provenance existed was a real supplier/customer photo, so no persisted
 * record has to be rewritten to be correct.
 */
export type SidePhotoOrigin = 'photo' | 'generated'

/** Provenance of a generated side — kept for QA, support and the UI badge. */
export interface GeneratedSideInfo {
  method: 'front-mirror-flood'
  /**
   * 1 = mirrored silhouette + low-pass shading. 2 = the same, plus centred-
   * placket suppression (a polo back must not show a button placket — see
   * pipeline.ts). Records stamped 1 stay 1 and stay TRUE: the added pass is a
   * no-op on any garment without a contrast band down the centre, so their
   * pixels are already what 2 produces.
   */
  v: 1 | 2
  /** sRGB hex flooded into the mirrored silhouette. */
  colorHex: string
  colorSource: 'supplier-swatch' | 'sampled'
  /** From v2: a centred vertical band was found and flattened out. */
  placketSuppressed?: boolean
  /**
   * Mirror-symmetry of the source SILHOUETTE (IoU against its own mirror),
   * 1 = perfectly symmetric. Below ~0.93 the outline is asymmetric and the
   * mirror puts a detail on the wrong side, so the admin UI escalates from
   * "generated" to "generated — review this". It says nothing about features
   * inside the outline (a chest pocket): see the blind-spot note in
   * pipeline.ts, which is why the visible marking is not optional.
   */
  symmetry: number
  /** Generation timestamp, passed in by the caller (this module stays pure). */
  at: number
}

/**
 * One side of the product. Structurally compatible with CustomSideSetup on
 * purpose (assetId/useCutout/printArea/origin) so side defs flow into the
 * custom pipeline without translation.
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
  /** Absent ⇒ 'photo'. See SidePhotoOrigin. */
  origin?: SidePhotoOrigin
  /** Present only when origin === 'generated'. */
  generatedFrom?: GeneratedSideInfo
}

/**
 * Denormalised answer to "does this product have a back, and is it real?".
 * A boolean cannot carry it: `missing` and `generated` are different products
 * commercially, and the difference has to reach whoever chooses what to sell.
 */
export type BackSource = 'real' | 'generated' | 'missing'

/**
 * Where the cm size table came from — the same provenance discipline
 * `SidePhotoOrigin` applies to photos, applied to measurements.
 *
 *  - `'supplier'`  the manufacturer's own published flat measurements.
 *  - `'reference-chart'` ESTIMATED from the studio's reference blanks
 *    (src/content/sizeChart.ts) because the supplier publishes none. Falk&Ross
 *    is the case that forced this: their webservice carries size LABELS
 *    (`sku_size_name`/`sku_size_order`) and nothing else — no chest, no length,
 *    no sleeve, anywhere in the API. An estimate is useful (a tee is a tee) but
 *    it is not a measurement of THIS garment, and print placement is computed
 *    from it, so it must never be displayed as if the supplier said it.
 *  - `'manual'`    typed or pasted in by an admin, who owns the numbers.
 *
 * OPTIONAL, and absence means `'supplier'`: every record written before this
 * field existed came from a supplier table (Imbretex publishes real A/B
 * measurements), so no persisted product has to be rewritten to stay true.
 */
export type SizeSource = 'supplier' | 'reference-chart' | 'manual'

const SIZE_SOURCES = new Set<string>(['supplier', 'reference-chart', 'manual'])

export function backSourceOf(p: Pick<ProductDef, 'back'>): BackSource {
  if (!p.back) return 'missing'
  return p.back.origin === 'generated' ? 'generated' : 'real'
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
  /** Provenance of `sizes`. Absent ⇒ `'supplier'`. See SizeSource. */
  sizeSource?: SizeSource
  /**
   * Size the photos + printArea were authored at (must exist in `sizes`).
   * Also the size "Use in studio" applies by default.
   */
  defaultSize: SizeId
  front: ProductSideDef
  /**
   * Deliberately still nullable: ship-your-own uploads legitimately arrive
   * front-only, and making this required would break every persisted product
   * for a guarantee that only holds on the catalogue path. The guarantee is
   * expressed by `backSource` + the ingest gate instead.
   */
  back: ProductSideDef | null
  /** Denormalised `backSourceOf(product)` for the library index. */
  backSource?: BackSource
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
  /** Back coverage, so the library list can flag it without loading records. */
  backSource: BackSource
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

const ORIGINS = new Set<string>(['photo', 'generated'])

function isSideDef(v: unknown): v is ProductSideDef {
  if (typeof v !== 'object' || v === null) return false
  const s = v as Record<string, unknown>
  return (
    typeof s.assetId === 'string' &&
    typeof s.useCutout === 'boolean' &&
    isRectIn(s.printArea) &&
    // Absent is the legacy (and correct) value; a hand-edited file must not be
    // able to smuggle in an origin the UI would then fail to badge.
    (s.origin === undefined || (typeof s.origin === 'string' && ORIGINS.has(s.origin)))
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
    // Absent is the legacy (and correct) value — see SizeSource. A hand-edited
    // file must not be able to smuggle in a provenance the UI cannot badge,
    // which for measurements would mean an estimate passing as a supplier spec.
    (p.sizeSource !== undefined &&
      (typeof p.sizeSource !== 'string' || !SIZE_SOURCES.has(p.sizeSource))) ||
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
