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

export const MAX_LAYERS = 200
export const MAX_ASSETS = 32
export const MAX_GARMENT_ID_LEN = 40

/** One printed side, as the price engine and the workshop both need it. */
export interface DesignDocSide {
  id: string
  area_sq_cm: number
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
    sides.push({ id, area_sq_cm: Math.min(area, MAX_SIDE_SQ_CM) })
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
