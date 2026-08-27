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

/**
 * The two lengths `src/lib/ink.ts` puts between a visual's ink and the rectangle
 * it is printed as, in CENTIMETRES.
 *
 * RESTATED HERE AND NOT IMPORTED, because this file has no imports at all and
 * must not gain any: it is type-checked twice, once under the app's tsconfig and
 * once under the Worker's, and `ink.ts` reaches a canvas. The copy is held to
 * the original by a test (`designDoc.test.ts`), which is the same arrangement
 * `Margin.php` uses for the Bible's formula.
 *
 *   TRIM_BLEED_IN = 0,02 in, added on all four sides by `clampInkToArea`.
 *   MIN_EXTENT_IN = 0,08 in, the floor a hairline is GROWN to by `atLeastMin`.
 */
const PIECE_BLEED_CM = 0.0508
const PIECE_MIN_EXTENT_CM = 0.2032

/**
 * The step `sidePiecesCm` rounds every dimension to, centimetres.
 *
 * It is subtracted as well, and that is not caution: rounding a transfer's
 * width UP by half a step makes the ink behind it look wider than it is, and a
 * bound that can be pushed past the truth by rounding is not a bound. Written
 * off both the threshold and the subtraction, the floor is sound for any
 * rounding of this size. On a real chest print it costs 0,01 cm of a 28,5 cm
 * rectangle, which is nothing; on a hairline it is the difference between a
 * derived floor and a wrong refusal.
 */
const PIECE_ROUND_CM = 0.01

export const MAX_LAYERS = 200
export const MAX_ASSETS = 32
export const MAX_GARMENT_ID_LEN = 40

/**
 * One transfer's footprint on the film, cm, and where on the side it goes.
 *
 * The last two are OPTIONAL and travel as one block with the side's
 * `area_*_cm` (see `readPlacement`): a document written before the proof
 * existed carries none of them, and it must keep its film geometry rather than
 * lose it to a field it predates.
 */
export interface DesignDocPiece {
  w_cm: number
  h_cm: number
  /** Top edge of the transfer below the top edge of the print area, cm. */
  top_cm?: number
  /** Its centre, signed, from the print area's centre line, cm. + is to the right. */
  center_dx_cm?: number
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
  /**
   * The print area those placements are measured inside, cm, and the collar
   * seam to its centre.
   *
   * OPTIONAL FOR THE SAME REASON `pieces` IS, and dropped by the same
   * all-or-nothing rule. They are what a bon a tirer states and a press is set
   * up from; they are not a price input and not a film input, so a document
   * that lacks them is still a sale, and the proof says the placement was not
   * measured rather than printing a number nobody took.
   *
   * `drop_cm` is absent for a garment the customer ships themselves: there is
   * no collar seam in our data for it, and a plausible number would read on the
   * proof exactly like a measured one.
   */
  area_w_cm?: number
  area_h_cm?: number
  drop_cm?: number
  /**
   * Whether the marking scales with the garment (`printScale.mode`).
   *
   * On the proof and nowhere else. It is not a price input and not a film
   * input; it decides which sentence the customer reads about the sizes they
   * did not order, and a document that gets it wrong promises something that
   * will not be pressed.
   */
  graded?: boolean
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
    const capped = Math.min(area, MAX_SIDE_SQ_CM)
    const read = readPieces(side.pieces, capped)
    /*
     * AND THE OTHER DIRECTION, which was the open half of this gate.
     *
     * `readPieces` refuses rectangles too SMALL to hold the ink they claim,
     * because that understates the film. Nothing refused an ink area too small
     * for the rectangles, and that understates THE PRICE, which is worse: the
     * area tier is what a printed side is charged at (`Pricing::area_tier`), so
     * a document carrying the real full-coverage geometry with
     * `area_sq_cm: 1` bought a full front at the cheapest tier. The route is
     * open and takes no credentials, so the only thing between that document
     * and the till is this line.
     *
     * The bound is derived, not chosen. See `smallestInkSqCm`.
     */
    if (read.minInkSqCm !== undefined && capped < Math.min(read.minInkSqCm, MAX_SIDE_SQ_CM) * 0.99) {
      return null
    }
    sides.push({ id, area_sq_cm: capped, ...readPlacement(side, read.pieces) })
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
function readPieces(raw: unknown, areaSqCm: number): { pieces?: DesignDocPiece[]; minInkSqCm?: number } {
  if (!Array.isArray(raw)) return {}
  if (raw.length === 0 || raw.length > MAX_SIDE_PIECES) return {}
  const pieces: DesignDocPiece[] = []
  let boxed = 0
  let minInk = 0
  for (const p of raw) {
    if (!p || typeof p !== 'object') return {}
    const piece = p as Record<string, unknown>
    const w = typeof piece.w_cm === 'number' ? piece.w_cm : NaN
    const h = typeof piece.h_cm === 'number' ? piece.h_cm : NaN
    if (!Number.isFinite(w) || !Number.isFinite(h)) return {}
    if (w <= 0 || h <= 0 || w > MAX_PIECE_CM || h > MAX_PIECE_CM) return {}
    boxed += w * h
    minInk = Math.max(minInk, smallestInkSqCm(w, h))
    // Carried through unvalidated; `readPlacement` is what decides whether they
    // are kept, because the check is per SIDE and this loop sees one rectangle.
    const kept: DesignDocPiece = { w_cm: w, h_cm: h }
    if (typeof piece.top_cm === 'number') kept.top_cm = piece.top_cm
    if (typeof piece.center_dx_cm === 'number') kept.center_dx_cm = piece.center_dx_cm
    pieces.push(kept)
  }

  /*
   * THE RECTANGLES MUST BE BIG ENOUGH TO HOLD THE INK THEY CLAIM TO CARRY, and
   * this route is OPEN, so that check is the only thing standing between a
   * buyer and our floor price.
   *
   * It is a derived invariant, not a tolerance we chose. `sideArtworkSqCm`
   * unions the CLUSTER boxes; `sidePiecesCm` returns those same boxes grown by
   * the trim bleed on all four sides. Σ(w × h) is therefore always at least the
   * declared area, and strictly more in practice. A document that declares
   * 2 000 cm² of ink and eight 0,5 × 0,5 cm transfers is describing two
   * different garments.
   *
   * What it costs when it is missing, measured with the shipped packer: fifty
   * garments with a real 28,4 × 34,1 cm chest print nest to 14,5 m of roll and
   * 273,83 EUR of film; declared as 0,5 × 0,5 cm they nest to 0,1 m, bill the
   * 1 m supplier minimum and cost 32,85 EUR. 240,98 EUR off the direct cost,
   * and every euro of it comes back off the floor price the shop refuses to
   * sell under.
   *
   * The 1 % slack absorbs the 0,01 cm rounding both numbers carry and nothing
   * else. Failing it drops the geometry rather than the order: the buyer still
   * buys, and the shop reports the film as unknown instead of as cheap.
   */
  if (boxed < areaSqCm * 0.99) return { minInkSqCm: minInk }

  return { pieces, minInkSqCm: minInk }
}

/**
 * The least ink a transfer of these dimensions can be carrying, cm2.
 *
 * WHY THIS IS A DERIVED BOUND AND NOT A TOLERANCE. A transfer is one cluster's
 * ink box grown by `TRIM_BLEED_IN` on all four sides and then clamped to the
 * print area (`clampInkToArea` in src/lib/ink.ts). Clamping only ever makes it
 * smaller, so in every case
 *
 *     cluster box side >= transfer side - 2 x bleed
 *
 * and the ink area the shop is handed is the UNION of those cluster boxes,
 * which is at least the largest single one. So the largest rectangle in the
 * list, shrunk by the bleed, is a floor under the declared area that no
 * honest document can fall below.
 *
 * THE UNION IS WHY IT IS THE LARGEST AND NOT THE SUM. Cluster hulls may overlap
 * (an L-shaped lockup with a mark tucked in its corner is two visuals whose
 * boxes cross) and `sideArtworkSqCm` counts that overlap once, deliberately, so
 * a buyer is not charged twice for the same square centimetres. Summing here
 * would therefore refuse a legitimate design. The largest piece is the strongest
 * bound that survives the overlap.
 *
 * A DIMENSION AT THE MINIMUM EXTENT CONTRIBUTES NOTHING. `atLeastMin` GROWS a
 * span thinner than `MIN_EXTENT_IN` up to it, so a 0,4 mm hairline arrives as a
 * 2 mm transfer and the subtraction above would claim ink that is not there.
 * Such a dimension is treated as unknown rather than as evidence, which is the
 * conservative direction: it can only ever fail to catch a forgery, never refuse
 * a real design.
 */
function smallestInkSqCm(wCm: number, hCm: number): number {
  const shrink = (v: number) =>
    v > PIECE_MIN_EXTENT_CM + PIECE_ROUND_CM
      ? Math.max(0, v - 2 * PIECE_BLEED_CM - PIECE_ROUND_CM)
      : 0
  return shrink(wCm) * shrink(hCm)
}

/**
 * How far a placement may sit outside the print area it declares, cm.
 *
 * NOT a tolerance we chose, and not a margin for artwork that overflows: the
 * producer clamps every transfer to the area exactly (`clampInkToArea` in
 * src/lib/ink.ts bounds both spans to [0, limit]), so the true answer is zero.
 * What is left is the rounding: six numbers are each rounded to 0,01 cm before
 * they are written, so a comparison of sums can be off by a few hundredths.
 * 0,05 cm is above that and far below anything a press could act on.
 */
const PLACEMENT_SLACK_CM = 0.05

/**
 * The side's placement: the print area, the drop below the collar, and each
 * transfer's position inside the area.
 *
 * ALL OR NOTHING PER SIDE, and separate from the film geometry above, which is
 * the whole point of it being its own function. These numbers are what a bon a
 * tirer states and what a press is set up from; they are not a price input and
 * not a film input. So a placement that cannot be read drops the PLACEMENT and
 * keeps the rectangles: the order still costs what it costs, and the proof says
 * the position was not measured instead of printing one nobody took.
 *
 * The fit check is what an OPEN route needs. `top_cm` and `center_dx_cm` are
 * the numbers an operator puts a ruler to, and unlike the area and the pieces
 * nothing downstream would ever notice them being wrong: a document claiming a
 * 30 cm drop inside a 40 cm area is a print half off the shoulder, and the
 * first thing that would catch it today is a customer opening a parcel.
 *
 * `drop_cm` is bounded but not derived from anything here: the shop has no
 * collar geometry to check it against (`data/garments.json` publishes print
 * areas and body measurements, not seam positions). The bound is a sanity one,
 * a metre, which no garment we sell can reach.
 */
function readPlacement(
  side: Record<string, unknown>,
  pieces?: DesignDocPiece[],
): {
  pieces?: DesignDocPiece[]
  area_w_cm?: number
  area_h_cm?: number
  drop_cm?: number
  graded?: boolean
} {
  /*
   * REFUSING A PLACEMENT MEANS NOT STORING IT. `readPieces` carries the two raw
   * numbers through so this function can see them; every path that declines
   * them has to strip them again, or the document keeps the very numbers the
   * fit check just rejected and the proof prints them as measured.
   */
  const bare = pieces ? { pieces: pieces.map((p) => ({ w_cm: p.w_cm, h_cm: p.h_cm })) } : {}
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : NaN)

  const aw = num(side.area_w_cm)
  const ah = num(side.area_h_cm)
  if (!(aw > 0) || !(ah > 0) || aw > MAX_PIECE_CM || ah > MAX_PIECE_CM) return bare
  if (!pieces || pieces.length === 0) return bare

  const placed: DesignDocPiece[] = []
  for (const p of pieces) {
    const top = num(p.top_cm)
    const dx = num(p.center_dx_cm)
    if (Number.isNaN(top) || Number.isNaN(dx)) return bare
    if (top < -PLACEMENT_SLACK_CM || top + p.h_cm > ah + PLACEMENT_SLACK_CM) return bare
    if (Math.abs(dx) + p.w_cm / 2 > aw / 2 + PLACEMENT_SLACK_CM) return bare
    placed.push({ w_cm: p.w_cm, h_cm: p.h_cm, top_cm: top, center_dx_cm: dx })
  }

  const drop = num(side.drop_cm)
  const out: {
    pieces: DesignDocPiece[]
    area_w_cm: number
    area_h_cm: number
    drop_cm?: number
    graded?: boolean
  } = {
    pieces: placed,
    area_w_cm: aw,
    area_h_cm: ah,
  }
  if (drop > 0 && drop <= 100) out.drop_cm = drop
  if (typeof side.graded === 'boolean') out.graded = side.graded
  return out
}
