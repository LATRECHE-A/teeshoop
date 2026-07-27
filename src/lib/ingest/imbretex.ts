/**
 * IMBRETEX — supplier catalogue adapter (imbretex.fr).
 *
 * ============================================================================
 * ONLY `fetchImbretexCatalog` CHANGES WHEN THE OFFICIAL API LANDS.
 * ----------------------------------------------------------------------------
 * Imbretex has promised an API but has not delivered it yet, so the studio
 * reads a SNAPSHOT of their public catalogue committed under
 * `public/catalog/imbretex/` (JSON + jpg photos). Everything downstream —
 * `imbretexToProductDef`, `ingestImbretexProduct`, the modal — talks the
 * `ImbretexProduct` shape below. When the API arrives, swap the body of
 * `fetchImbretexCatalog` for the real endpoint (and map its payload into
 * `ImbretexProduct`); nothing else in the app has to move.
 * ============================================================================
 *
 * Mapping notes:
 *  - Imbretex publishes exactly two flat measurements per size: A = half chest
 *    (largeur) and B = body length (longueur). There is NO published sleeve
 *    length, so `sleeveLengthCm` is DERIVED here (see SLEEVE_RATIO) — clearly
 *    an estimate, never a supplier figure.
 *  - Their size runs go XXS…5XL; the studio's SizeId union only covers S…3XL
 *    (src/content/sizeChart.ts). Sizes outside it are dropped, not invented —
 *    a product whose whole run falls outside (kids' 3/4/5…14) maps to zero
 *    sizes and is rejected with `unsupported_sizes`.
 *  - `rrpEur` is the supplier's RECOMMENDED RETAIL price (prix de vente
 *    conseillé). It is NOT our purchase cost and must never be presented as
 *    one; no margin maths anywhere in the app may read it.
 */
import {
  backSourceOf,
  type BackSource,
  type GeneratedSideInfo,
  type ProductDef,
  type ProductSideDef,
  type SidePhotoOrigin,
} from './types'
import {
  adoptGeneratedBack,
  autoPrintArea,
  generateBackSide,
  normalizeGarmentPhoto,
} from './pipeline'
import { getCustomSideInfo } from '@/lib/custom'
import { cmToIn } from '@/lib/units'
import {
  DEFAULT_SIZE,
  SIZE_IDS,
  type SizeId,
  type SizeSpecCm,
} from '@/content/sizeChart'

// ---------------------------------------------------------------------------
// Snapshot shape (mirrors public/catalog/imbretex/products.json 1:1)
// ---------------------------------------------------------------------------

export interface ImbretexColour {
  id: string
  name: string
  /** Supplier swatch, 0-255 triplet. */
  rgb: [number, number, number]
  cmyk?: [number, number, number, number] | null
  pantone?: string | null
  visualsUrl?: string | null
}

export interface ImbretexView {
  /** Path relative to the snapshot root, e.g. "img/190608-front.jpg". */
  file: string
  bytes?: number
  /**
   * Absent ⇒ a supplier PHOTOGRAPH (see SidePhotoOrigin). `'generated'` marks a
   * reconstruction committed by scripts/generate-missing-backs.mjs for a
   * reference the supplier publishes no back for — a preview, never a photo of
   * the product, and the whole app is told so through `generatedFrom`.
   */
  origin?: SidePhotoOrigin
  /** Present only when `origin === 'generated'`. */
  generatedFrom?: GeneratedSideInfo
}

export interface ImbretexProduct {
  id: string
  url: string
  name: string
  brand: string
  /** Manufacturer style code, e.g. "JT150". */
  supplierRef: string
  /** Human size run as published, e.g. "de XS à 5XL". */
  sizesRange: string | null
  weightGsm: number | null
  material: string | null
  gender: string | null
  origin: string | null
  /** Decoration processes the supplier certifies, e.g. ["DTF","Broderie"]. */
  markingTypes: string[]
  labelType?: string | null
  /** RECOMMENDED RETAIL price, € — never our cost. */
  rrpEur: number | null
  colours: ImbretexColour[]
  /**
   * Colourways the supplier page listed, before the scraper's own 40-entry cap
   * on `colours`. Larger than `colours.length` ⇒ some were never even seen, and
   * `backProbe` counts them as unprobed. Absent on older snapshots.
   */
  colourTotal?: number
  /** Size labels as published (XS…5XL, or kids' 3…14). */
  sizes: string[]
  /** Measurement A — laid-flat half chest, cm, aligned with `sizes`. */
  halfChestCm: number[]
  /** Measurement B — body length, cm, aligned with `sizes`. */
  bodyLengthCm: number[]
  extraMeasureC?: number[] | null
  imageUrl?: string | null
  /** Colour the catalogue photos were shot in (all views share it). */
  photoColour: { id: string; name: string; rgb: [number, number, number] } | null
  views: { front?: ImbretexView; back?: ImbretexView }
  /**
   * How hard the scraper looked for a back, present ONLY on products where it
   * found none — the evidence behind `backMissing`. `probed < colourways`
   * means the claim was never made (the id goes to `backUnknown` instead), and
   * a product whose scrape ABORTED records `probed: 0` because a probe count
   * that was interrupted mid-product proves nothing. Absent on snapshots taken
   * before the field existed — and absence is treated as no evidence, never as
   * "nothing left to probe".
   */
  backProbe?: { colourways: number; probed: number }
  /** Supplier taxonomy slug, e.g. "tee-shirt_185" / "sweat-shirt_168". */
  category: string
}

export interface ImbretexCatalog {
  source: string
  /** ISO date the snapshot was taken — shown as provenance in the UI. */
  scrapedAt: string
  measurementLegend?: Record<string, string>
  count: number
  /**
   * Ids for which the supplier publishes NO back view in any colourway — the
   * scraper probes EVERY colourway with a visuals endpoint before saying so
   * (see each product's `backProbe`), which makes this a statement about the
   * supplier and not about the scrape. Their `views.back` is a reconstruction
   * carrying `origin: 'generated'`, never a photograph.
   */
  backMissing?: string[]
  /**
   * Ids with no back AND an incomplete probe: back-less as far as we looked,
   * which is a weaker claim than `backMissing` and is kept separate so nobody
   * reads one as the other.
   */
  backUnknown?: string[]
  products: ImbretexProduct[]
}

export type ImbretexErrorCode =
  | 'unavailable'
  | 'parse'
  | 'unsupported_sizes'
  | 'photo'

/** Typed failure so the modal can explain exactly what went wrong. */
export class ImbretexError extends Error {
  readonly code: ImbretexErrorCode
  constructor(code: ImbretexErrorCode) {
    super(`Imbretex catalogue: ${code}`)
    this.name = 'ImbretexError'
    this.code = code
  }
}

// ---------------------------------------------------------------------------
// Snapshot fetch (THE seam — replace with the API call when it ships)
// ---------------------------------------------------------------------------

/** Snapshot root; photo `file` paths are relative to it. */
export const IMBRETEX_ROOT = '/catalog/imbretex/'
const SNAPSHOT_URL = `${IMBRETEX_ROOT}products.json`

export interface ImbretexSnapshotMeta {
  source: string
  scrapedAt: string
  /** See ImbretexCatalog.backMissing. */
  backMissing: string[]
}

let cache: ImbretexProduct[] | null = null
let meta: ImbretexSnapshotMeta | null = null
/** In-flight request, shared so a StrictMode double-mount fetches once. */
let pending: Promise<ImbretexProduct[]> | null = null

/**
 * One entry per colour id, keeping the richest (CMYK + Pantone + swatch beats a
 * bare name). Defensive: the snapshot is already deduped, but the future API
 * payload is not ours to trust and duplicate ids break React keys.
 */
function dedupeColours(p: ImbretexProduct): ImbretexProduct {
  const score = (c: ImbretexColour) => (c.cmyk ? 2 : 0) + (c.pantone ? 1 : 0) + (c.rgb ? 1 : 0)
  const byId = new Map<string, ImbretexColour>()
  for (const c of p.colours) {
    const cur = byId.get(c.id)
    if (!cur || score(c) > score(cur)) byId.set(c.id, c)
  }
  return byId.size === p.colours.length ? p : { ...p, colours: [...byId.values()] }
}

function isProduct(v: unknown): v is ImbretexProduct {
  if (typeof v !== 'object' || v === null) return false
  const p = v as Record<string, unknown>
  return (
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    Array.isArray(p.sizes) &&
    Array.isArray(p.halfChestCm) &&
    Array.isArray(p.bodyLengthCm) &&
    typeof p.views === 'object' &&
    p.views !== null &&
    typeof (p.views as { front?: ImbretexView }).front?.file === 'string'
  )
}

/**
 * Load the supplier catalogue. Cached in-module for the session.
 *
 * ⇢ WHEN THE API LANDS: call it here, map the payload into ImbretexProduct[],
 *   keep the same cache + typed errors. Callers stay untouched.
 *
 * @throws ImbretexError('unavailable') network/404 · ('parse') bad payload
 */
export async function fetchImbretexCatalog(): Promise<ImbretexProduct[]> {
  if (cache) return cache
  if (pending) return pending
  pending = (async () => {
    let res: Response
    try {
      res = await fetch(SNAPSHOT_URL, { cache: 'no-cache' })
    } catch {
      throw new ImbretexError('unavailable')
    }
    if (!res.ok) throw new ImbretexError('unavailable')
    let json: ImbretexCatalog
    try {
      json = (await res.json()) as ImbretexCatalog
    } catch {
      throw new ImbretexError('parse')
    }
    if (!Array.isArray(json?.products)) throw new ImbretexError('parse')
    // Drop malformed rows rather than failing the whole catalogue, and force
    // colour ids to be unique: the source page lists every colour twice (the
    // duplicate carries no CMYK/Pantone), and the ids are used as React keys.
    const products = json.products.filter(isProduct).map(dedupeColours)
    if (products.length === 0) throw new ImbretexError('parse')
    meta = {
      source: json.source ?? 'imbretex.fr',
      scrapedAt: json.scrapedAt ?? '',
      // An older snapshot has no list; the products with no REAL back are then
      // the only evidence available, which is the same conclusion. A generated
      // back counts as missing here — the list is about the supplier.
      backMissing: Array.isArray(json.backMissing)
        ? json.backMissing
        : products.filter((p) => imbretexBackSource(p) !== 'real').map((p) => p.id),
    }
    cache = products
    return products
  })().finally(() => {
    pending = null
  })
  return pending
}

/** Snapshot provenance (source, scrape date, back gaps) — null before fetch. */
export function imbretexSnapshotMeta(): ImbretexSnapshotMeta | null {
  return meta
}

/** Absolute URL of a catalogue photo ('' when that view was not scraped). */
export function imbretexPhotoUrl(p: ImbretexProduct, side: 'front' | 'back'): string {
  const file = p.views?.[side]?.file
  return file ? IMBRETEX_ROOT + file : ''
}

/** Where a catalogue entry's back view comes from — the same three states the
 *  product library uses (src/lib/ingest/types.ts), one snapshot step earlier so
 *  the browse UI can badge a reconstruction BEFORE anyone imports it. */
export function imbretexBackSource(p: ImbretexProduct): BackSource {
  if (!p.views?.back?.file) return 'missing'
  return p.views.back.origin === 'generated' ? 'generated' : 'real'
}

/** True when the supplier certifies a transfer process we actually run. */
export function imbretexSupportsDtf(p: ImbretexProduct): boolean {
  return p.markingTypes.some((m) => /dtf|transfert/i.test(m))
}

// ---------------------------------------------------------------------------
// Size mapping
// ---------------------------------------------------------------------------

/**
 * Supplier size label → studio SizeId. Labels the studio does not cover
 * (XXS, XS, 4XL, 5XL, kids' numeric runs) are absent on purpose: they are
 * dropped, never approximated onto a neighbouring size.
 */
const SIZE_LABELS: Record<string, SizeId> = {
  S: 'S',
  M: 'M',
  L: 'L',
  XL: 'XL',
  XXL: '2XL',
  '2XL': '2XL',
  XXXL: '3XL',
  '3XL': '3XL',
}

/**
 * Sleeve length as a fraction of body length — DERIVED, NOT PUBLISHED.
 * Imbretex ships A (half chest) and B (body length) only, while SizeSpecCm
 * wants a sleeve. The ratios are read off the reference charts in
 * src/content/sizeChart.ts (Stanley/Stella tee 20.5-24.5 cm sleeve for 69-80 cm
 * bodies ≈ 0.30; Cruiser hoodie 64-70 cm for 68-80 cm ≈ 0.90) and are only ever
 * used for display/spec — the print pipeline measures from half chest.
 */
const SLEEVE_RATIO = { none: 0, short: 0.3, long: 0.9 } as const

/** Sleeve class from the supplier's category + style name. */
function sleeveClass(p: ImbretexProduct): keyof typeof SLEEVE_RATIO {
  const name = p.name.toUpperCase()
  if (/\b(VEST|TANK|DEBARDEUR|DÉBARDEUR|SLEEVELESS)\b/.test(name)) return 'none'
  if (/LONG SLEEVE|MANCHES? LONGUES?|\bLS\b/.test(name)) return 'long'
  if (/^sweat|hood/i.test(p.category)) return 'long'
  return 'short'
}

/**
 * Supplier size table → studio size specs, keyed by canonical SizeId.
 * Rows with an unmappable label or a missing/zero measurement are dropped.
 */
export function imbretexSizes(p: ImbretexProduct): Partial<Record<SizeId, SizeSpecCm>> {
  const ratio = SLEEVE_RATIO[sleeveClass(p)]
  const out: Partial<Record<SizeId, SizeSpecCm>> = {}
  p.sizes.forEach((label, i) => {
    const id = SIZE_LABELS[String(label).trim().toUpperCase()]
    const halfChestCm = p.halfChestCm[i]
    const bodyLengthCm = p.bodyLengthCm[i]
    if (!id || !(halfChestCm > 0) || !(bodyLengthCm > 0)) return
    out[id] = {
      halfChestCm,
      bodyLengthCm,
      // Derived — see SLEEVE_RATIO.
      sleeveLengthCm: Math.round(bodyLengthCm * ratio * 2) / 2,
    }
  })
  return out
}

/** Studio-covered sizes of a supplier product, in canonical order. */
export function imbretexSizeIds(p: ImbretexProduct): SizeId[] {
  const sizes = imbretexSizes(p)
  return SIZE_IDS.filter((id) => sizes[id] !== undefined)
}

/** Published size labels the studio cannot carry (XS, 4XL, kids' 3…14…). */
export function imbretexDroppedSizes(p: ImbretexProduct): string[] {
  return p.sizes.filter((label) => !SIZE_LABELS[String(label).trim().toUpperCase()])
}

/** Reference size: the caller's pick, else M, else the smallest covered one. */
function pickDefaultSize(
  sizes: Partial<Record<SizeId, SizeSpecCm>>,
  wanted?: SizeId,
): SizeId | null {
  if (wanted && sizes[wanted]) return wanted
  if (sizes[DEFAULT_SIZE]) return DEFAULT_SIZE
  return SIZE_IDS.find((id) => sizes[id]) ?? null
}

// ---------------------------------------------------------------------------
// ImbretexProduct → ProductDef
// ---------------------------------------------------------------------------

export interface ImbretexMapOptions {
  /** Ingested front photo (from `normalizeGarmentPhoto` + `autoPrintArea`). */
  front: ProductSideDef
  back?: ProductSideDef | null
  /** Colour chosen by the user (ImbretexColour.id) — recorded in the notes. */
  colourId?: string
  /** Reference size for the photos/print area; falls back to M then smallest. */
  defaultSize?: SizeId
}

/** Compact provenance line stored on the ProductDef (admin-facing). */
function buildNotes(p: ImbretexProduct, colour: ImbretexColour | null): string {
  const bits = [`Imbretex ${p.id}`]
  if (p.weightGsm) bits.push(`${p.weightGsm} g/m²`)
  if (p.material) bits.push(p.material.replace(/\.$/, ''))
  if (colour)
    bits.push(
      `Coloris ${colour.name}${colour.pantone ? ` (Pantone ${colour.pantone})` : ''}`,
    )
  if (p.photoColour && p.photoColour.id !== colour?.id)
    bits.push(`Photos ${p.photoColour.name}`)
  // Recommended RETAIL price — not our purchase cost.
  if (p.rrpEur) bits.push(`PVC conseillé ${p.rrpEur.toFixed(2)} €`)
  if (p.origin) bits.push(p.origin)
  return bits.join(' · ')
}

/**
 * Map a supplier product (plus its already-ingested photos) onto the studio's
 * ProductDef, so it rides the existing custom-garment pipeline (2D/3D/AR).
 *
 * The product id embeds the colour: two colourways of the same blank are two
 * library entries, and re-loading the same colourway overwrites in place.
 *
 * @throws ImbretexError('unsupported_sizes') when no published size maps onto
 *   the studio's SizeId union (kids' numeric runs, XS-only products…).
 */
export function imbretexToProductDef(
  p: ImbretexProduct,
  opts: ImbretexMapOptions,
): ProductDef {
  const sizes = imbretexSizes(p)
  const defaultSize = pickDefaultSize(sizes, opts.defaultSize)
  if (!defaultSize) throw new ImbretexError('unsupported_sizes')
  const colour = opts.colourId
    ? (p.colours.find((c) => c.id === opts.colourId) ?? null)
    : null
  return {
    id: `imbretex-${p.id}${colour ? `-${colour.id}` : ''}`,
    name: colour ? `${p.name} — ${colour.name}` : p.name,
    brandRef: [p.brand, p.supplierRef].filter(Boolean).join(' ').trim(),
    createdAt: Date.now(),
    sizes,
    defaultSize,
    front: opts.front,
    back: opts.back ?? null,
    backSource: backSourceOf({ back: opts.back ?? null }),
    notes: buildNotes(p, colour),
  }
}

// ---------------------------------------------------------------------------
// Full load: catalogue photos → ingest pipeline → ProductDef
// ---------------------------------------------------------------------------

async function fetchPhoto(url: string): Promise<Blob> {
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    throw new ImbretexError('photo')
  }
  if (!res.ok) throw new ImbretexError('photo')
  return res.blob()
}

/** Ingest one catalogue view through the shared pipeline (cutout + area). */
async function ingestSide(
  p: ImbretexProduct,
  side: 'front' | 'back',
  halfChestCm: number,
  label: string,
): Promise<ProductSideDef> {
  const blob = await fetchPhoto(imbretexPhotoUrl(p, side))
  const photo = await normalizeGarmentPhoto(blob, { name: label })
  const probe = { assetId: photo.assetId, useCutout: photo.hasCutout }
  const info = await getCustomSideInfo(
    { ...probe, printArea: { xIn: 0, yIn: 0, wIn: 1, hIn: 1 } },
    cmToIn(halfChestCm),
  )
  return { ...probe, printArea: autoPrintArea(info.img, info.bbox, halfChestCm, side) }
}

export interface ImbretexIngestOptions {
  colourId?: string
  defaultSize?: SizeId
  /** Progress ticks for the modal ('generate' fires when a back is rebuilt). */
  onProgress?: (stage: 'front' | 'back' | 'generate') => void
  /**
   * Reconstruct a back when the supplier publishes none (default: yes). Set
   * false to keep the product honestly back-less instead.
   */
  generateBack?: boolean
  /** Generation timestamp — a parameter so the pipeline stays clock-free. */
  now?: number
}

/**
 * Turn a catalogue entry into a studio-ready ProductDef: the two supplier
 * photos go through the SAME ingest pipeline as an admin upload (background
 * cutout + automatic print-area suggestion), then `imbretexToProductDef`
 * attaches the real cm size table.
 *
 * BACK GUARANTEE: four references in the snapshot have no public back view in
 * ANY colourway (see ImbretexCatalog.backMissing). Rather than shipping a
 * product whose 3D back is a slab and whose AR model is bare from behind, the
 * snapshot carries a RECONSTRUCTION for them, generated once by
 * scripts/generate-missing-backs.mjs from the same pipeline this would call —
 * so it is adopted here, not re-derived, and arrives stamped
 * `origin: 'generated'` with the provenance the snapshot recorded.
 *
 * A back that fails to ingest, or a supplier who publishes none for a product
 * nobody has generated yet, leaves the same hole: reconstruct on the spot
 * instead. Only a FRONT failure aborts.
 *
 * @throws ImbretexError · IngestPhotoError (see pipeline.ts)
 */
export async function ingestImbretexProduct(
  p: ImbretexProduct,
  opts: ImbretexIngestOptions = {},
): Promise<ProductDef> {
  const sizes = imbretexSizes(p)
  const defaultSize = pickDefaultSize(sizes, opts.defaultSize)
  if (!defaultSize) throw new ImbretexError('unsupported_sizes')
  // Photos are laid-flat shots: the reference size's half chest IS the width
  // of the garment in the frame (same convention as src/lib/ingest/types.ts).
  const halfChestCm = sizes[defaultSize]!.halfChestCm

  opts.onProgress?.('front')
  const front = await ingestSide(p, 'front', halfChestCm, `${p.name} — face`)

  // A reconstruction is only adoptable WITH its provenance: an `origin:
  // 'generated'` view whose `generatedFrom` is missing (hand-edited snapshot)
  // is deliberately not ingested as anything — it falls through to being
  // rebuilt below, where the provenance is true because we made it.
  const snapBack = p.views?.back
  const provenance = snapBack?.origin === 'generated' ? snapBack.generatedFrom : undefined

  let back: ProductSideDef | null = null
  if (provenance) {
    // Adopt the committed pixels AND the recorded provenance. The print area is
    // derived from the front's, never re-detected — the collar contrast
    // autoPrintArea needs is exactly what the low-pass removed (pipeline.ts).
    opts.onProgress?.('generate')
    back = await adoptGeneratedBack(
      front,
      await fetchPhoto(imbretexPhotoUrl(p, 'back')),
      halfChestCm,
      provenance,
      { name: `${p.name} — dos (reconstitué)` },
    ).catch(() => null)
  } else if (snapBack?.file && snapBack.origin !== 'generated') {
    opts.onProgress?.('back')
    back = await ingestSide(p, 'back', halfChestCm, `${p.name} — dos`).catch(
      () => null,
    )
  }
  if (!back && opts.generateBack !== false) {
    opts.onProgress?.('generate')
    back = await generateBackSide(front, halfChestCm, {
      name: `${p.name} — dos (reconstitué)`,
      at: opts.now ?? 0,
      colorRgb: p.photoColour?.rgb ?? null,
    }).catch(() => null)
  }
  return imbretexToProductDef(p, {
    front,
    back,
    colourId: opts.colourId,
    defaultSize,
  })
}
