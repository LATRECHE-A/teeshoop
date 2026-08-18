/**
 * What a stored design document IS, stated once, for both ends of the upload.
 *
 * The studio decides which rasters to send; the Worker decides which rasters it
 * will accept, and refuses the upload when the two sets differ in either
 * direction (`worker/design.ts`). Both directions are deliberate: a design
 * referencing artwork that did not arrive is an order the workshop cannot fill,
 * and artwork the design never mentions is R2 as a dead drop.
 *
 * Which means the two ends must agree EXACTLY on what "referenced" means. Two
 * copies of that answer would eventually disagree, and the day they did the
 * symptom would be a 422 at the last click of a purchase, or worse, a custom
 * garment order whose photo silently never reached the workshop. So there is
 * one copy, and it is this file: `worker/design.ts` imports it, and
 * `src/lib/teeshoop/upload.ts` imports it.
 *
 * PURE ON PURPOSE. No DOM, no Workers runtime, no imports at all. It is
 * type-checked twice, once under the app's tsconfig and once under the Worker's
 * (`lib: ES2022`, no DOM), and anything platform-specific would break one of
 * them. That constraint is a feature: a gate that can only read plain data
 * cannot grow a dependency on where it happens to be running.
 *
 * IT IS A GATE, NOT A PARSER. The document is stored verbatim and every field
 * here is read again by the studio when the design is reopened. What this
 * exists to stop is an arbitrary blob being written to R2 under a name that
 * makes it look like an order.
 */

/** Asset ids come from nanoid(10) in the studio; keep the R2 key path boring. */
export const ASSET_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/** Side ids come from the studio's own `Side` union. */
export const SIDE_ID_RE = /^[a-z_]{1,16}$/

/** A garment has four printable faces plus room to grow. */
export const MAX_SIDES = 8

/** Past a square metre it is a data error, and it must not drive the price. */
export const MAX_SIDE_SQ_CM = 10000

/**
 * How many transfers one side may declare, and how large each may be, cm.
 *
 * A side splits into at most one visual per layer and a garment's print area is
 * around 40 cm across, so both bounds are far above anything real. They are here
 * because these numbers leave the browser and are then packed onto a roll by the
 * Worker (`POST /api/nest`) and costed by the shop: a document claiming three
 * hundred two-metre transfers would buy a large nesting computation and an
 * absurd film cost, and neither is a thing an unauthenticated upload gets to do.
 *
 * 200 cm and not 56: a piece WIDER than the roll is legitimate (it gets cut into
 * strips), and refusing it here would silently drop the biggest transfer in the
 * order from the cost.
 */
export const MAX_SIDE_PIECES = 32
export const MAX_PIECE_CM = 200

export const MAX_LAYERS = 200
export const MAX_ASSETS = 32
export const MAX_GARMENT_ID_LEN = 40

/** One transfer's footprint on the film, cm. */
export interface DesignDocPiece {
  w_cm: number
  h_cm: number
}

/** One printed side, as the price engine and the workshop both need it. */
export interface DesignDocSide {
  id: string
  area_sq_cm: number
  /**
   * The transfers this side prints as. OPTIONAL, and the optionality is the
   * decision: a document without them is still a perfectly printable order, so
   * refusing it would turn a costing gap into a lost sale. What it is not is
   * costable, and the shop says exactly that rather than dividing the area by
   * the roll width and calling the answer a length.
   */
  pieces?: DesignDocPiece[]
}

export interface DesignDocSummary {
  garment: string
  color: string
  sides: DesignDocSide[]
  /** Every raster the document references, in first-seen order. */
  assetIds: string[]
}

/**
 * Read the parts of a design document that the manifest and the upload gate
 * need, or null when the thing handed in is not a design.
 */
export function readDesignDoc(raw: unknown): DesignDocSummary | null {
  if (!raw || typeof raw !== 'object') return null
  const doc = raw as Record<string, unknown>
  const garment = typeof doc.garmentId === 'string' ? doc.garmentId : ''
  if (!garment || garment.length > MAX_GARMENT_ID_LEN) return null
  const layers = Array.isArray(doc.layers) ? doc.layers : null
  if (!layers || layers.length > MAX_LAYERS) return null

  const assetIds: string[] = []
  const reference = (id: unknown): boolean => {
    if (typeof id !== 'string' || !ASSET_ID_RE.test(id)) return false
    if (!assetIds.includes(id)) assetIds.push(id)
    return true
  }

  for (const l of layers) {
    if (!l || typeof l !== 'object') return null
    const layer = l as Record<string, unknown>
    if (typeof layer.type !== 'string' || typeof layer.side !== 'string') return null
    if (layer.type === 'image' && !reference(layer.assetId)) return null
  }

  /*
   * The customer's own garment photos, when the garment IS theirs.
   *
   * These are NOT layers, and leaving them out is what made an early version of
   * this gate refuse a legitimate ship-your-own order: the studio uploaded the
   * photo the document names, the Worker did not consider it referenced, and
   * the whole purchase died on "asset X is not referenced by the design". They
   * are as unrecoverable as any other upload, and they are what tells the
   * operator where on the customer's garment the transfer goes.
   */
  const custom = doc.custom
  if (custom && typeof custom === 'object') {
    for (const key of ['front', 'back']) {
      const setup = (custom as Record<string, unknown>)[key]
      if (!setup || typeof setup !== 'object') continue
      if (!reference((setup as Record<string, unknown>).assetId)) return null
    }
  }

  if (assetIds.length > MAX_ASSETS) return null

  // Sides come from the studio's own area measurement (src/lib/ink.ts), in cm²,
  // the same unit and the same number the PHP price authority is handed. They
  // are recorded so an order can be re-priced from the design alone.
  const sides: DesignDocSide[] = []
  const rawSides = Array.isArray(doc.sides) ? doc.sides : []
  for (const s of rawSides) {
    if (!s || typeof s !== 'object') continue
    const side = s as Record<string, unknown>
    const id = typeof side.id === 'string' ? side.id : ''
    const area = typeof side.area_sq_cm === 'number' ? side.area_sq_cm : NaN
    if (!id || !SIDE_ID_RE.test(id)) continue
    if (!Number.isFinite(area) || area <= 0) continue
    sides.push({
      id,
      area_sq_cm: Math.min(area, MAX_SIDE_SQ_CM),
      ...readPieces(side.pieces),
    })
    if (sides.length >= MAX_SIDES) break
  }

  /*
   * A DESIGN WITH NOTHING TO PRINT IS NOT A DESIGN, and refusing it here is a
   * money gate, not tidiness.
   *
   * `sides` is what the price is computed from. A document that simply omits
   * the key parsed fine, stored fine, verified fine, and then priced as an
   * unprinted blank: measured on the shipped config, a tee run of 50 fell from
   * 926,50 EUR to 308,50 EUR HT, and a `custom` garment (whose blank is free,
   * because the customer ships it) came to 0,00 EUR while the stored document
   * still carried the full artwork the workshop would press. The studio cannot
   * produce such a document (`measureOrder` throws `no_printable_side` first),
   * so nothing legitimate is being refused.
   */
  if (sides.length === 0) return null

  return {
    garment,
    color: typeof doc.colorId === 'string' && doc.colorId.length <= MAX_GARMENT_ID_LEN ? doc.colorId : '',
    sides,
    assetIds,
  }
}

/**
 * The transfers of one side, bounded, or nothing.
 *
 * ALL OR NOTHING per side, deliberately. A partly-read list would cost the film
 * of the pieces that happened to parse and silently omit the rest, which is a
 * film cost that is too LOW, which is a floor price that is too low, which
 * authorises a sale that destroys value. A side whose pieces cannot all be read
 * has no pieces, and the shop reports its film cost as unknown.
 */
function readPieces(raw: unknown): { pieces?: DesignDocPiece[] } {
  if (!Array.isArray(raw)) return {}
  if (raw.length === 0 || raw.length > MAX_SIDE_PIECES) return {}
  const pieces: DesignDocPiece[] = []
  for (const p of raw) {
    if (!p || typeof p !== 'object') return {}
    const piece = p as Record<string, unknown>
    const w = typeof piece.w_cm === 'number' ? piece.w_cm : NaN
    const h = typeof piece.h_cm === 'number' ? piece.h_cm : NaN
    if (!Number.isFinite(w) || !Number.isFinite(h)) return {}
    if (w <= 0 || h <= 0 || w > MAX_PIECE_CM || h > MAX_PIECE_CM) return {}
    pieces.push({ w_cm: w, h_cm: h })
  }
  return { pieces }
}
