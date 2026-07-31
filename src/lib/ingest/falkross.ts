/**
 * FALK&ROSS — supplier catalogue adapter (falk-ross.eu), LIVE webservice.
 *
 * The counterpart of src/lib/ingest/imbretex.ts, and deliberately its mirror
 * image: same shape, same typed errors, same ingest pipeline, so the catalogue
 * UI treats a live API and a committed snapshot as two sources of one thing.
 *
 * ============================================================================
 * THE CLIENT NEVER TALKS TO FALK&ROSS.
 * ----------------------------------------------------------------------------
 * Every call here goes to `/api/fr/*` on our own Worker (worker/falkross.ts),
 * because the supplier's endpoints need HTTP Basic credentials that must not
 * ship to a browser, send no CORS headers at all, and serve photos that would
 * taint the ingest canvas. The Worker holds the secrets, parses the XML and
 * answers in compact JSON; photos come back through `/api/fr/img/*`, same
 * origin, so `normalizeGarmentPhoto` can read pixels back.
 * ============================================================================
 *
 * ============================================================================
 * SIZES ARE ESTIMATED, AND SAYING SO IS PART OF THE FEATURE.
 * ----------------------------------------------------------------------------
 * Falk&Ross publishes NO garment measurements. Not a partial table, not a
 * different unit — the webservice carries size LABELS (`sku_size_name`,
 * `sku_size_order`) and nothing else. But ProductDef needs real cm per size,
 * because the print area, the 3D body and the DTF output are all computed from
 * halfChestCm.
 *
 * So the table is DERIVED from the studio's own reference blanks
 * (src/content/sizeChart.ts — Stanley/Stella Creator for tees, Cruiser for
 * hoodies/sweats), picked by the supplier's category and sleeve filter groups,
 * and stamped `sizeSource: 'reference-chart'`. That is an estimate of a
 * comparable garment, NOT a measurement of this one, and:
 *   - the catalogue shows the table before import, marked as an estimate;
 *   - the admin can override it, which re-stamps it `'manual'`;
 *   - `falkrossSizespecPdf` surfaces the maker's own size-spec PDF (the one
 *     document F&R does publish, and unreadable by machine) so a human can
 *     check the numbers against the source.
 * Nothing in this file may present a reference-chart figure as a supplier one.
 * ============================================================================
 *
 * Other mapping notes:
 *  - PRICES here are `your_price` = OUR PURCHASE COST. The opposite of
 *    Imbretex's `rrpEur`, which is a recommended RETAIL price. Never conflate
 *    them: one is what we pay, the other is what a customer might.
 *  - F&R size runs go XS…5XL; the studio's SizeId union covers S…3XL. Sizes
 *    outside it are dropped, never approximated onto a neighbour.
 *  - Colour has no hex/RGB anywhere in this feed (`sku_cc_list` is a
 *    R000-012 field and the live data is R000-011), only a swatch JPG. So
 *    swatches render as images and back-reconstruction samples the garment
 *    colour from the photo instead of being told it.
 */
import {
  backSourceOf,
  type BackSource,
  type ProductDef,
  type ProductSideDef,
  type SizeSource,
} from './types'
import { autoPrintArea, generateBackSide, normalizeGarmentPhoto } from './pipeline'
import { getCustomSideInfo } from '@/lib/custom'
import { cmToIn } from '@/lib/units'
import {
  DEFAULT_SIZE,
  SIZE_CHARTS,
  SIZE_IDS,
  type SizeId,
  type SizeSpecCm,
} from '@/content/sizeChart'

// ---------------------------------------------------------------------------
// Worker payload shapes (mirror worker/falkross.ts 1:1)
// ---------------------------------------------------------------------------

export type FalkRossKind = 'tee' | 'polo' | 'sweat' | 'shirt' | 'other'
export type FalkRossSleeve = 'short' | 'long' | 'sleeveless' | 'unknown'

/** Grid row — what `/api/fr/styles` returns per style. */
export interface FalkRossCard {
  styleNr: string
  brand: string
  supplierRef: string
  name: string
  kind: FalkRossKind
  sleeve: FalkRossSleeve
  /** Proxied photo URL, or '' when the style has no usable picture. */
  thumb: string
  hasBack: boolean
  colourCount: number
  /** Supplier size labels, in supplier order (may include XS / 4XL / 5XL). */
  sizes: string[]
}

export interface FalkRossColourway {
  code: string
  name: string
  /** Colour chip URL — a JPG. This feed publishes no hex/RGB (see header). */
  swatch: string
  /** Per-colour laid-flat FRONT photo. Present for every colourway. */
  photo: string
  /** Size label → 9-digit SKU, for price, stock and ordering. */
  skus: Record<string, string>
}

export interface FalkRossSku {
  sku: string
  colourCode: string
  sizeName: string
  sizeOrder: number
  ean: string
  weightKg: number | null
  coo: string
  closeout: boolean
  isNew: boolean
}

export interface FalkRossStyle {
  styleNr: string
  brand: string
  supplierRef: string
  name: string
  nameEn: string
  description: string
  categories: string[]
  kind: FalkRossKind
  sleeve: FalkRossSleeve
  gender: string
  neckline: string
  fabric: string[]
  certificates: string[]
  /** Maker's size-spec PDF — the only measurements F&R publishes, unmachine-readable. */
  sizespecPdf: string
  front: string
  back: string
  hasBack: boolean
  frontColour: string | null
  /** Colour the back was shot in — only ONE colourway has a back. See header. */
  backColour: string | null
  colourways: FalkRossColourway[]
  sizes: string[]
  skus: FalkRossSku[]
  exportedAt: string
}

export interface FalkRossPage {
  total: number
  offset: number
  /** Resume point for "load more"; null when the catalogue is exhausted. */
  nextOffset: number | null
  scanned: number
  items: FalkRossCard[]
  exportedAt: string
}

/** SKU → { cost, list }. `cost` is OUR PURCHASE PRICE — never a retail price. */
export interface FalkRossPrices {
  currency: string
  prices: Record<string, { cost: number; list: number }>
}

export interface FalkRossStock {
  at: string
  /** SKU → [green, yellow, blue] quantities. */
  stock: Record<string, [number, number, number]>
}

/** Whether the webservice account is rehearsing or buying. */
export interface FalkRossWsState {
  mode: 'test' | 'live' | 'unknown'
  modeCode: string
  modeName: string
  at: string
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type FalkRossErrorCode =
  | 'unavailable'
  | 'auth'
  | 'config'
  | 'parse'
  | 'not_found'
  | 'unsupported_sizes'
  | 'photo'
  | 'order'

/** Typed failure so the modal can explain exactly what went wrong. */
export class FalkRossError extends Error {
  readonly code: FalkRossErrorCode
  constructor(code: FalkRossErrorCode, message?: string) {
    super(message ?? `Falk&Ross: ${code}`)
    this.name = 'FalkRossError'
    this.code = code
  }
}

/** Worker error bodies are `{ error, message }` — map them onto our codes. */
function errorCodeOf(status: number, body: unknown): FalkRossErrorCode {
  const code = (body as { error?: string } | null)?.error
  if (code === 'auth') return 'auth'
  if (code === 'config') return 'config'
  if (code === 'parse') return 'parse'
  if (code === 'not_found' || status === 404) return 'not_found'
  return 'unavailable'
}

async function getJson<T>(path: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, { headers: { accept: 'application/json' } })
  } catch {
    throw new FalkRossError('unavailable')
  }
  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new FalkRossError(res.ok ? 'parse' : 'unavailable')
  }
  if (!res.ok) {
    throw new FalkRossError(
      errorCodeOf(res.status, body),
      (body as { message?: string } | null)?.message,
    )
  }
  return body as T
}

// ---------------------------------------------------------------------------
// Catalogue reads
// ---------------------------------------------------------------------------

export interface FalkRossBrowseOptions {
  /** Free text over name, brand, supplier reference and style number. */
  q?: string
  /** `'printable'` (default) keeps tees, polos and sweats; `'all'` keeps everything. */
  kind?: 'printable' | 'all' | FalkRossKind
  offset?: number
  limit?: number
  signal?: AbortSignal
}

/**
 * One page of the supplier catalogue, filtered and paginated SERVER-SIDE.
 *
 * The style list is ~2350 entries and each style detail is a separate upstream
 * document, so the Worker walks the list under a budget and returns
 * `nextOffset` — treat a short page with a non-null `nextOffset` as "more to
 * scan", not as "no more results" (see `falkrossHasMore`).
 *
 * @throws FalkRossError('unavailable') network/Worker down · ('auth') bad or
 *   missing credentials · ('config') credentials not configured
 */
export async function fetchFalkRossStyles(
  opts: FalkRossBrowseOptions = {},
): Promise<FalkRossPage> {
  const params = new URLSearchParams()
  if (opts.q) params.set('q', opts.q)
  params.set('kind', opts.kind ?? 'printable')
  params.set('offset', String(opts.offset ?? 0))
  params.set('limit', String(opts.limit ?? 24))
  return getJson<FalkRossPage>(`/api/fr/styles?${params.toString()}`)
}

/** True while the catalogue has unscanned styles left. */
export const falkrossHasMore = (page: FalkRossPage | null): boolean =>
  !!page && page.nextOffset !== null

/** One style in full — colourways, sizes, SKUs, photos. */
export async function fetchFalkRossStyle(styleNr: string): Promise<FalkRossStyle> {
  return getJson<FalkRossStyle>(`/api/fr/style/${encodeURIComponent(styleNr)}`)
}

/** Our PURCHASE prices for a style, per SKU. Not a retail price (see header). */
export async function fetchFalkRossPrices(styleNr: string): Promise<FalkRossPrices> {
  return getJson<FalkRossPrices>(`/api/fr/price/${encodeURIComponent(styleNr)}`)
}

/** Live stock per SKU. */
export async function fetchFalkRossStock(styleNr: string): Promise<FalkRossStock> {
  return getJson<FalkRossStock>(`/api/fr/stock/${encodeURIComponent(styleNr)}`)
}

/**
 * Webservice mode. `'test'` means orders are simulated; `'live'` means an order
 * is a real purchase. Read it before showing anything that can place one.
 */
export async function fetchFalkRossState(): Promise<FalkRossWsState> {
  return getJson<FalkRossWsState>('/api/fr/state')
}

/** The maker's size-spec PDF, if this style has one ('' otherwise). */
export const falkrossSizespecPdf = (s: FalkRossStyle): string => s.sizespecPdf

// ---------------------------------------------------------------------------
// Size mapping — reference-chart estimates (see the module header)
// ---------------------------------------------------------------------------

/**
 * Supplier size label → studio SizeId. Labels the studio does not cover (XS,
 * 4XL, 5XL, "One Size", kids' runs) are absent on purpose: dropped, never
 * approximated onto a neighbouring size.
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

/** Which reference blank a supplier style is measured against. */
export type FalkRossProfile = 'tee' | 'hoodie'

/**
 * Pick the reference blank whose proportions this style resembles, from the
 * supplier's OWN classification (category + sleeve filter groups) rather than
 * from a guess at the name.
 *
 * A sweat/hoodie is cut fuller and longer-sleeved than a tee, so getting this
 * wrong would put the print area on the wrong body — it is the one decision
 * the estimate really rests on.
 */
export function falkrossProfile(style: {
  kind: FalkRossKind
  sleeve: FalkRossSleeve
}): FalkRossProfile {
  if (style.kind === 'sweat') return 'hoodie'
  // A long-sleeved knit that is neither a tee nor a polo (crew, zip-neck…)
  // sits closer to the sweat block than to a t-shirt.
  if (style.sleeve === 'long' && style.kind !== 'tee' && style.kind !== 'polo') return 'hoodie'
  return 'tee'
}

export interface FalkRossSizeTable {
  sizes: Partial<Record<SizeId, SizeSpecCm>>
  profile: FalkRossProfile
  /** Always `'reference-chart'` here — F&R publishes no measurements. */
  sizeSource: SizeSource
  /** Supplier labels the studio cannot carry (XS, 4XL, "One Size"…). */
  dropped: string[]
}

/**
 * Build the ESTIMATED cm table for a style: the reference chart for its
 * profile, restricted to the sizes the supplier actually sells.
 *
 * Restricting matters — offering 3XL on a style that stops at XL would invent
 * a product. The numbers are an estimate; the size RUN is the supplier's fact.
 */
export function falkrossSizes(style: {
  kind: FalkRossKind
  sleeve: FalkRossSleeve
  sizes: string[]
}): FalkRossSizeTable {
  const profile = falkrossProfile(style)
  const chart = SIZE_CHARTS[profile].sizes
  const sizes: Partial<Record<SizeId, SizeSpecCm>> = {}
  const dropped: string[] = []
  for (const label of style.sizes) {
    const id = SIZE_LABELS[String(label).trim().toUpperCase()]
    if (!id) {
      dropped.push(label)
      continue
    }
    const spec = chart[id]
    sizes[id] = {
      ...spec,
      // A sleeveless blank has no sleeve to estimate, and reporting the
      // reference tee's 21 cm for one would be a fabrication rather than an
      // approximation.
      sleeveLengthCm: style.sleeve === 'sleeveless' ? 0 : spec.sleeveLengthCm,
    }
  }
  return { sizes, profile, sizeSource: 'reference-chart', dropped }
}

/** Studio-covered sizes of a supplier style, in canonical order. */
export function falkrossSizeIds(style: {
  kind: FalkRossKind
  sleeve: FalkRossSleeve
  sizes: string[]
}): SizeId[] {
  const { sizes } = falkrossSizes(style)
  return SIZE_IDS.filter((id) => sizes[id] !== undefined)
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
// Photos
// ---------------------------------------------------------------------------

/**
 * The front photo for a colourway.
 *
 * Every colourway carries its own laid-flat front (`sku_color_picture_url`),
 * so the front is ALWAYS colour-correct — prefer it over the style-level
 * picture, which is whatever colour the catalogue shoot used.
 */
export function falkrossFrontUrl(style: FalkRossStyle, colourCode?: string): string {
  const cw = colourCode ? style.colourways.find((c) => c.code === colourCode) : undefined
  return cw?.photo || style.front || ''
}

/**
 * Where a colourway's BACK would come from, decided BEFORE importing so the
 * catalogue can badge it.
 *
 * Falk&Ross photographs exactly one colourway from behind. For that colour the
 * back is a real photograph; for every other colour the only real back on offer
 * is a picture of a DIFFERENT-COLOURED garment — a navy tee with a white back
 * is not a better answer than an honest reconstruction, it is a wrong one. So
 * anything else reconstructs from the (colour-correct) front and says so.
 */
export function falkrossBackSource(style: FalkRossStyle, colourCode?: string): BackSource {
  if (!style.hasBack) return 'generated'
  if (!colourCode || !style.backColour) return style.hasBack ? 'real' : 'generated'
  return style.backColour === colourCode ? 'real' : 'generated'
}

async function fetchPhoto(url: string): Promise<Blob> {
  if (!url) throw new FalkRossError('photo')
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    throw new FalkRossError('photo')
  }
  if (!res.ok) throw new FalkRossError('photo')
  return res.blob()
}

/** Ingest one supplier view through the shared pipeline (cutout + area). */
async function ingestSide(
  url: string,
  side: 'front' | 'back',
  halfChestCm: number,
  label: string,
): Promise<ProductSideDef> {
  const blob = await fetchPhoto(url)
  const photo = await normalizeGarmentPhoto(blob, { name: label })
  const probe = { assetId: photo.assetId, useCutout: photo.hasCutout }
  const info = await getCustomSideInfo(
    { ...probe, printArea: { xIn: 0, yIn: 0, wIn: 1, hIn: 1 } },
    cmToIn(halfChestCm),
  )
  return { ...probe, printArea: autoPrintArea(info.img, info.bbox, halfChestCm, side) }
}

// ---------------------------------------------------------------------------
// FalkRossStyle → ProductDef
// ---------------------------------------------------------------------------

export interface FalkRossMapOptions {
  front: ProductSideDef
  back?: ProductSideDef | null
  colourCode?: string
  defaultSize?: SizeId
  /** Override table (admin-corrected); flips `sizeSource` to `'manual'`. */
  sizes?: Partial<Record<SizeId, SizeSpecCm>>
  sizeSource?: SizeSource
  /** Our purchase cost for the chosen colour/size, € — recorded in the notes. */
  costEur?: number | null
}

/** Compact provenance line stored on the ProductDef (admin-facing). */
function buildNotes(
  style: FalkRossStyle,
  colour: FalkRossColourway | null,
  sizeSource: SizeSource,
  costEur?: number | null,
): string {
  const bits = [`Falk&Ross ${style.styleNr}`]
  if (colour) {
    bits.push(`Coloris ${colour.name} (${colour.code})`)
    const sku = Object.values(colour.skus)[0]
    if (sku) bits.push(`SKU ${sku}`)
  }
  if (style.fabric.length > 0) bits.push(style.fabric.join(', '))
  if (style.gender) bits.push(style.gender)
  const coo = style.skus.find((s) => s.colourCode === colour?.code)?.coo
  if (coo) bits.push(`Origine ${coo}`)
  // OUR PURCHASE COST — see the module header; never a retail price.
  if (costEur) bits.push(`Prix d'achat ${costEur.toFixed(2)} €`)
  // The measurements are the thing most likely to be trusted blindly later, so
  // the record itself carries the caveat, not just the UI that created it.
  if (sizeSource === 'reference-chart') {
    bits.push('Mesures estimées (gabarit de référence) — non publiées par Falk&Ross')
  } else if (sizeSource === 'manual') {
    bits.push('Mesures saisies manuellement')
  }
  return bits.join(' · ')
}

/**
 * Map a supplier style (plus its already-ingested photos) onto the studio's
 * ProductDef, so it rides the existing custom-garment pipeline (2D/3D/AR).
 *
 * The product id embeds the colour: two colourways of the same blank are two
 * library entries, and re-loading the same colourway overwrites in place.
 *
 * @throws FalkRossError('unsupported_sizes') when no supplier size maps onto
 *   the studio's SizeId union (One Size accessories, kids' runs, XS-only…).
 */
export function falkrossToProductDef(
  style: FalkRossStyle,
  opts: FalkRossMapOptions,
): ProductDef {
  const derived = falkrossSizes(style)
  const sizes = opts.sizes ?? derived.sizes
  const sizeSource = opts.sizeSource ?? (opts.sizes ? 'manual' : derived.sizeSource)
  const defaultSize = pickDefaultSize(sizes, opts.defaultSize)
  if (!defaultSize) throw new FalkRossError('unsupported_sizes')
  const colour = opts.colourCode
    ? (style.colourways.find((c) => c.code === opts.colourCode) ?? null)
    : null
  return {
    id: `falkross-${style.styleNr}${colour ? `-${colour.code}` : ''}`,
    name: colour ? `${style.name} — ${colour.name}` : style.name,
    brandRef: [style.brand, style.supplierRef].filter(Boolean).join(' ').trim(),
    createdAt: Date.now(),
    sizes,
    sizeSource,
    defaultSize,
    front: opts.front,
    back: opts.back ?? null,
    backSource: backSourceOf({ back: opts.back ?? null }),
    notes: buildNotes(style, colour, sizeSource, opts.costEur),
  }
}

// ---------------------------------------------------------------------------
// Full load: supplier photos → ingest pipeline → ProductDef
// ---------------------------------------------------------------------------

export interface FalkRossIngestOptions {
  colourCode?: string
  defaultSize?: SizeId
  /** Admin-corrected size table; flips `sizeSource` to `'manual'`. */
  sizes?: Partial<Record<SizeId, SizeSpecCm>>
  costEur?: number | null
  /** Progress ticks for the modal ('generate' fires when a back is rebuilt). */
  onProgress?: (stage: 'front' | 'back' | 'generate') => void
  /** Reconstruct a back when none is usable (default: yes). */
  generateBack?: boolean
  /** Generation timestamp — a parameter so the pipeline stays clock-free. */
  now?: number
}

/**
 * Turn a supplier style into a studio-ready ProductDef: the photos go through
 * the SAME ingest pipeline as an admin upload (background cutout + automatic
 * print-area suggestion), then `falkrossToProductDef` attaches the size table.
 *
 * BACK POLICY: a real back photo is used only when it is a photo of the colour
 * being imported (see `falkrossBackSource`). Otherwise — wrong colour, or no
 * back published at all — the back is RECONSTRUCTED from the colour-correct
 * front by the shared `generateBackSide`, arriving stamped `origin:
 * 'generated'` so the studio, AR and mockups all badge it as a preview.
 *
 * The reconstruction is given no colour to flood with, on purpose: this feed
 * carries no RGB (only a swatch JPG), and the pipeline's own sampling of the
 * front photo is the better source anyway — the customer is looking at the
 * photo, not at a catalogue chip.
 *
 * Only a FRONT failure aborts.
 *
 * @throws FalkRossError · IngestPhotoError (see pipeline.ts)
 */
export async function ingestFalkRossProduct(
  style: FalkRossStyle,
  opts: FalkRossIngestOptions = {},
): Promise<ProductDef> {
  const derived = falkrossSizes(style)
  const sizes = opts.sizes ?? derived.sizes
  const defaultSize = pickDefaultSize(sizes, opts.defaultSize)
  if (!defaultSize) throw new FalkRossError('unsupported_sizes')
  // Photos are laid-flat shots: the reference size's half chest IS the width
  // of the garment in the frame (same convention as src/lib/ingest/types.ts).
  const halfChestCm = sizes[defaultSize]!.halfChestCm

  opts.onProgress?.('front')
  const front = await ingestSide(
    falkrossFrontUrl(style, opts.colourCode),
    'front',
    halfChestCm,
    `${style.name} — face`,
  )

  let back: ProductSideDef | null = null
  if (falkrossBackSource(style, opts.colourCode) === 'real' && style.back) {
    opts.onProgress?.('back')
    back = await ingestSide(style.back, 'back', halfChestCm, `${style.name} — dos`).catch(
      () => null,
    )
  }
  if (!back && opts.generateBack !== false) {
    opts.onProgress?.('generate')
    back = await generateBackSide(front, halfChestCm, {
      name: `${style.name} — dos (reconstitué)`,
      at: opts.now ?? 0,
      colorRgb: null,
    }).catch(() => null)
  }

  return falkrossToProductDef(style, {
    front,
    back,
    colourCode: opts.colourCode,
    defaultSize,
    sizes: opts.sizes,
    costEur: opts.costEur,
  })
}

// ---------------------------------------------------------------------------
// Ordering (no UI — exported and documented, deliberately not wired up)
// ---------------------------------------------------------------------------

export interface FalkRossOrderLine {
  /** 9-digit Falk&Ross SKU (colour × size) — see FalkRossColourway.skus. */
  sku: string
  qty: number
  /** Your own per-line reference, max 32 characters. */
  lineRef?: string
}

export interface FalkRossOrderAddress {
  lastname?: string
  firstname?: string
  company?: string
  street?: string
  city?: string
  postcode?: string
  /** ISO-2, e.g. "FR". */
  countryCode?: string
}

export interface FalkRossOrderInput {
  /** "Your reference" on the supplier's side — truncated to 32 characters. */
  reference: string
  note?: string
  partialShipment?: boolean
  lines: FalkRossOrderLine[]
  /** Omit to ship to the account's registered address. */
  deliveryAddress?: FalkRossOrderAddress
  /** Overrides FR_CUSTOMER_NR on the Worker. */
  customerNumber?: string
}

export interface FalkRossOrderResult {
  ok: boolean
  /** Supplier order id. `'0'` means REJECTED — read `errorCode`/`message`. */
  orderId: string
  /** 0 none · 10 general · 2x invalid data · 30 not found · 4x access/blocked. */
  errorCode: string
  message: string
  /** Per-line failures, e.g. an unknown SKU (code 30). */
  lines: { sku: string; errorCode: string; message: string }[]
  /** ALWAYS check this: `'live'` means real money. */
  mode: FalkRossWsState
  customerNumber: string
  customerNumberSource: 'env' | 'request' | 'derived-from-user'
}

/**
 * Place a purchase order with Falk&Ross.
 *
 * NOT WIRED INTO THE UI ON PURPOSE. It is exported so the basket can grow an
 * ordering step deliberately, with a human confirmation in front of it — not
 * because a button happened to exist.
 *
 * Read `result.mode` before believing anything: the account ships in TEST mode,
 * where orders are simulated and `orders_id` is returned but nothing is
 * dispatched. In `'live'` mode a successful call is a real purchase order.
 * The mode is returned with every attempt precisely so nobody can place a live
 * order thinking it was a rehearsal.
 *
 * Note the result is a REJECTION REPORT, not an exception: a call that reaches
 * the supplier and is refused resolves with `ok: false` and the supplier's own
 * error codes. Only transport/config failures throw.
 *
 * @throws FalkRossError('order') malformed request · ('auth') bad credentials
 *   · ('config') no customer number configured · ('unavailable') transport
 */
export async function placeFalkRossOrder(
  input: FalkRossOrderInput,
): Promise<FalkRossOrderResult> {
  let res: Response
  try {
    res = await fetch('/api/fr/order', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
  } catch {
    throw new FalkRossError('unavailable')
  }
  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new FalkRossError('parse')
  }
  if (!res.ok) {
    const code = errorCodeOf(res.status, body)
    throw new FalkRossError(
      code === 'unavailable' ? 'order' : code,
      (body as { message?: string } | null)?.message,
    )
  }
  return body as FalkRossOrderResult
}
