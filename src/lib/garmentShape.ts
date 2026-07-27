/**
 * What SHAPE of garment is this photo, and where are its landmarks?
 *
 * WHY THIS EXISTS
 * ---------------
 * The custom-garment shell used to inflate an uploaded silhouette with a
 * Poisson balloon (∇²h = −4). That is the right answer to "make this outline
 * bulge" and the wrong answer to "make this look like a garment": a Poisson
 * solution peaks on the medial axis and is dome-symmetric, so it can only ever
 * produce a pillow. A real tee is fullest just under the shoulders, rolls off
 * over them, dips at the collar and tapers down two sleeve tubes — a shape that
 * is not derivable from the outline at all. It has to come from a garment.
 *
 * We own two garments: public/models/{tee,hoodie}.glb, the meshes the catalog
 * preview already renders. So the shell borrows their depth field
 * (src/lib/templateDepth.ts) and this module answers the two questions that
 * makes possible: WHICH template, and HOW do the photo and the template line up?
 *
 * ONE PROFILE FUNCTION, TWO CALLERS. `profileMask` runs on the uploaded photo's
 * alpha mask and on the template's own rasterised coverage, and everything
 * downstream is expressed as a correspondence between two of its outputs. That
 * is not a convenience — it is the correctness argument. Any landmark defined
 * by a different rule on the two sides would align things that are not the same
 * thing, and no amount of tuning recovers from that.
 *
 * THE ROW SCHEMA (L, B, R) is the load-bearing idea. Per row we keep three
 * spans: the leftmost run, the run containing the garment's centroid column
 * (the BODY), and the rightmost run. On a flat-lay tee all three are the same
 * run; on an A-pose hoodie mesh they are arm / torso / arm. Matching them
 * positionally maps torso to torso and sleeve to sleeve WHATEVER the arm angle,
 * which is why an A-pose template can dress an arms-down photo without anyone
 * re-posing a mesh in Blender.
 *
 * DETERMINISM: pure integer/float arithmetic over the mask. No randomness, no
 * time, no iteration-order dependence.
 */

/**
 * Garment families the studio can shape. Polo is deliberately NOT its own
 * geometry: a placket and a collar are a few tenths of an inch of relief that
 * live in the photo, and the depth field of a polo body is a tee's.
 */
export type GarmentShape = 'tee' | 'polo' | 'tank' | 'longsleeve' | 'sweatshirt' | 'hoodie'

export const GARMENT_SHAPES: readonly GarmentShape[] = [
  'tee',
  'polo',
  'tank',
  'longsleeve',
  'sweatshirt',
  'hoodie',
] as const

/**
 * Which template mesh lends its depth to which family. The hoodie mesh is the
 * long-sleeve donor as well as the hooded one — its sleeves reach the hem,
 * which is what a long-sleeve photo needs and what the tee mesh (sleeves
 * ending at 43 % of its height) cannot supply.
 */
export const SHAPE_TEMPLATE: Record<GarmentShape, 'tee' | 'hoodie'> = {
  tee: 'tee',
  polo: 'tee',
  tank: 'tee',
  longsleeve: 'hoodie',
  sweatshirt: 'hoodie',
  hoodie: 'hoodie',
}

// ---------------------------------------------------------------------- profile

export interface MaskProfile {
  w: number
  h: number
  /** First / last row carrying garment. */
  top: number
  bottom: number
  /** Per-row spans in EDGE coordinates (a run over cells i..j is [i, j+1]).
   *  L = leftmost run, B = body run (contains the centroid column), R =
   *  rightmost run. Rows with one run have L = B = R. Smoothed along y. */
  l0: Float32Array
  l1: Float32Array
  b0: Float32Array
  b1: Float32Array
  r0: Float32Array
  r1: Float32Array
  /** Runs per row (0 for empty rows). */
  runs: Uint8Array
  /** Cells per row, UNSMOOTHED — how much cloth a row really carries, which is
   *  not its outer extent whenever the row is a strap, a handle or two sleeves
   *  with air between them. */
  rowArea: Float32Array
  /** Topmost garment row per column (−1 for empty columns). The silhouette's
   *  upper edge: flat on a box, sloped on a shoulder, domed on a cap. */
  topEdge: Float32Array
  /** Cumulative garment area up to and including each row, normalised to 1. */
  cum: Float32Array
  /** Garment cells. */
  area: number
  /** Centroid column, edge coordinates. */
  cx: number
  /** Widest row (outer extent) and median torso width, in cells. */
  maxW: number
  bodyW: number
}

const BODY_BAND = [0.55, 0.9] as const

function median(v: number[]): number {
  if (!v.length) return 0
  const s = v.slice().sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** 5-tap binomial smoothing along y, restricted to the [top, bottom] window. */
function smoothRows(a: Float32Array, top: number, bottom: number): void {
  const n = bottom - top + 1
  if (n < 5) return
  const src = a.slice(top, bottom + 1)
  const at = (i: number) => src[Math.max(0, Math.min(n - 1, i))]
  for (let i = 0; i < n; i++) {
    a[top + i] = (at(i - 2) + 4 * at(i - 1) + 6 * at(i) + 4 * at(i + 1) + at(i + 2)) / 16
  }
}

/**
 * Measure a binary mask. `index(x, y) = offset + y * stride + x` so the padded
 * working mask of silhouette.ts and the tightly packed template coverage grid
 * can both be read without copying.
 *
 * Returns null for a mask that is empty or too thin to describe (the caller
 * then keeps whatever it would have done without a profile).
 */
export function profileMask(
  mask: Uint8Array,
  w: number,
  h: number,
  stride: number,
  offset: number,
): MaskProfile | null {
  if (w < 4 || h < 4) return null
  const l0 = new Float32Array(h)
  const l1 = new Float32Array(h)
  const b0 = new Float32Array(h)
  const b1 = new Float32Array(h)
  const r0 = new Float32Array(h)
  const r1 = new Float32Array(h)
  const runs = new Uint8Array(h)
  const cum = new Float32Array(h)
  const rowArea = new Float32Array(h)
  const topEdge = new Float32Array(w).fill(-1)

  let top = -1
  let bottom = -1
  let area = 0
  let sumX = 0
  // Pass 1: extents + centroid column (the body run needs it).
  for (let y = 0; y < h; y++) {
    const base = offset + y * stride
    let n = 0
    let first = -1
    let last = -1
    for (let x = 0; x < w; x++) {
      if (!mask[base + x]) continue
      if (first < 0) first = x
      last = x
      n++
      sumX += x + 0.5
      if (topEdge[x] < 0) topEdge[x] = y
    }
    rowArea[y] = n
    area += n
    if (n > 0) {
      if (top < 0) top = y
      bottom = y
      l0[y] = first
      r1[y] = last + 1
    }
  }
  if (top < 0 || area < 16 || bottom - top < 4) return null
  const cx = sumX / area

  // Pass 2: the three structural runs per row.
  const cxCell = Math.max(0, Math.min(w - 1, Math.floor(cx)))
  for (let y = top; y <= bottom; y++) {
    const base = offset + y * stride
    let count = 0
    let bestB0 = -1
    let bestB1 = -1
    let firstStart = -1
    let firstEnd = -1
    let lastStart = -1
    let lastEnd = -1
    let bodyDist = Infinity
    let x = 0
    while (x < w) {
      if (!mask[base + x]) {
        x++
        continue
      }
      const s = x
      while (x < w && mask[base + x]) x++
      const e = x // exclusive
      count++
      if (firstStart < 0) {
        firstStart = s
        firstEnd = e
      }
      lastStart = s
      lastEnd = e
      // The body run is the one containing the centroid column; when no run
      // does (a garment whose centre line falls in the neck hole of an
      // un-filled mask) take the nearest one, which is the same run for every
      // reasonable input.
      const d = cxCell < s ? s - cxCell : cxCell >= e ? cxCell - e + 1 : 0
      if (d < bodyDist) {
        bodyDist = d
        bestB0 = s
        bestB1 = e
      }
    }
    if (count === 0) continue
    runs[y] = Math.min(255, count)
    l0[y] = firstStart
    l1[y] = firstEnd
    b0[y] = bestB0
    b1[y] = bestB1
    r0[y] = lastStart
    r1[y] = lastEnd
    // Collapse: when the outer run IS the body run the schema degenerates to a
    // single span, which is what a flat-lay garment gives on most rows.
    if (bestB0 === firstStart) {
      l0[y] = bestB0
      l1[y] = bestB0
    }
    if (bestB1 === lastEnd) {
      r0[y] = bestB1
      r1[y] = bestB1
    }
  }
  // Empty rows inside the window (a mask split by a scan artefact): hold the
  // previous row's spans so the maps stay defined and monotone.
  for (let y = top + 1; y <= bottom; y++) {
    if (runs[y]) continue
    l0[y] = l0[y - 1]
    l1[y] = l1[y - 1]
    b0[y] = b0[y - 1]
    b1[y] = b1[y - 1]
    r0[y] = r0[y - 1]
    r1[y] = r1[y - 1]
  }
  for (const arr of [l0, l1, b0, b1, r0, r1]) smoothRows(arr, top, bottom)

  let run = 0
  for (let y = 0; y < h; y++) {
    if (y >= top && y <= bottom) run += rowArea[y]
    cum[y] = run / area
  }

  const H = bottom - top + 1
  let maxW = 0
  for (let y = top; y <= bottom; y++) {
    const wRow = r1[y] - l0[y]
    if (wRow > maxW) maxW = wRow
  }
  const band: number[] = []
  const yA = top + Math.floor(H * BODY_BAND[0])
  const yB = Math.min(bottom, top + Math.ceil(H * BODY_BAND[1]))
  for (let y = yA; y <= yB; y++) band.push(b1[y] - b0[y])
  const bodyW = median(band) || maxW

  return {
    w,
    h,
    top,
    bottom,
    l0,
    l1,
    b0,
    b1,
    r0,
    r1,
    runs,
    rowArea,
    topEdge,
    cum,
    area,
    cx,
    maxW,
    bodyW,
  }
}

// ------------------------------------------------------- is it a garment at all?

/**
 * Structural evidence that a silhouette is a GARMENT rather than some other
 * printable object.
 *
 * WHY A SEPARATE TEST FROM THE TEMPLATE FIT. Outline overlap cannot answer this
 * question, and it is worth being precise about why rather than just raising the
 * threshold. The template is graded onto the photo by a map that is free to
 * rescale the torso span and the sleeve span independently (templateDepth.ts,
 * Stage A) — that freedom is exactly what lets one tee mesh dress a slim polo
 * and an oversize tee, and it is also what lets it squash the same mesh into a
 * tote bag. A measured tote scored IoU 0.935 against the tee template, HIGHER
 * than five of the seven real garments. There is no threshold that separates
 * those two populations, because the feature does not distinguish them.
 *
 * So ask about STRUCTURE instead, on the photo alone, before any template is
 * involved. Four tells, each a thing every garment physically has and the
 * other printable objects do not, and ALL FOUR are required — a majority vote
 * over weak tells is how a mug gets called a tank.
 *
 *  COLLAR — the outline WIDENS from its own top edge. A garment starts at a
 *           neck opening, which is narrower than the shoulders by construction:
 *           it has to be, or the garment would fall off. A poster, a banner, a
 *           tea towel and the body of a mug all start at full width.
 *  CLOTH  — the top band is solid cloth, not thin loops. A tote's handles and a
 *           vest's straps are both openings high and off the centre line, and
 *           an opening cannot tell you how much material is around it; what
 *           separates them is that a handle carries almost none. Measured on the
 *           UN-FILLED mask, because hole-filling is precisely what turns those
 *           handles into shoulder lobes and makes a tote outline-match a tank.
 *  SHOULDER — full width arrives near the TOP. A garment is widest across the
 *           shoulders, the sleeves or the chest; a cap, a funnel, a lampshade
 *           flare toward the bottom.
 *  NECK   — on its way to full width the outline never gives width BACK. This
 *           one is not about objects at all: it is about a PERSON. A photo of
 *           someone wearing the garment passes the other three (a head is
 *           narrower than the shoulders it sits on, it is solid, and the
 *           shoulders arrive high) and it is far and away the likeliest wrong
 *           upload. What a body has and a garment has not is the pinch between
 *           the two — head, neck, shoulders.
 *
 * MEASURED SEPARATION (scripts/inflate-verify.mjs prints all four per case on
 * every run; the populations are every garment family the catalogue sells, plus
 * a synthetic flat-lay tee, a tee still on its HANGER and a tee under a huge
 * dark print, against a tote, a mug, a poster, a cap and a person):
 *
 *   collarRise   garments ≥ 0.216   poster 0.000  mug 0.019   → cut 0.12
 *   topSolidity  garments ≥ 0.669   tote   0.381              → cut 0.50
 *   fullWidthAt  garments ≤ 0.355   cap    0.720              → cut 0.45
 *   neckDip      garments ≤ …       person 0.22               → cut 0.12
 *
 * Each negative is refused by a DIFFERENT tell, which is the point: a gate that
 * one hand-picked case fails is not a gate, and the verifier asserts it (all
 * four must be exercised). The worst case on the garment side is the synthetic
 * flat-lay tee, whose punched collar hole is huge relative to its shoulder span
 * (solidity 0.669) — a real ghost-mannequin photo sits at 0.98–1.00.
 *
 * WHICH WAY TO BE WRONG. A false accept gives the customer a garment shaped
 * like something they did not upload — visible, and worse than what shipped
 * before. A false refusal gives them the Poisson balloon, which IS what shipped
 * before. So every threshold above is set on the refusing side of the midpoint,
 * and the customer can always overrule the whole test by naming the garment in
 * the setup modal.
 *
 * All three are ratios, so nothing here depends on the photo's resolution or on
 * the garment's real size.
 */
export interface GarmentStructure {
  /** Each score is the measurement over its threshold: ≥ 1 means the tell passed. */
  collar: number
  cloth: number
  shoulder: number
  neck: number
  /** Does this read as a garment at all? */
  isGarment: boolean
}

/** COLLAR: the outer width must rise this much, relative to the widest row,
 *  across the top band. */
const COLLAR_RISE = 0.12
/** CLOTH: fraction of the top band's outer span that is actually cloth. */
const TOP_SOLID = 0.5
/** SHOULDER: how far down full width may first arrive, as a fraction of height. */
const FULL_WIDTH_AT = 0.45
/** NECK: how much width the outline may give BACK on its way to full width,
 *  as a fraction of the widest row. */
const NECK_DIP = 0.12
/** "Full width" for the shoulder tell — 0.92 rather than 1 so a single ragged
 *  cutout row at the hem cannot define where the garment got wide. */
const FULL_WIDTH = 0.92
/** The top band, as a fraction of the garment's own height. */
const TOP_BAND_H = 0.14

/**
 * Measure the three structural tells.
 *
 * `filled` is the hole-filled profile (the domain the depth field lives on) and
 * `raw` the same mask before filling — not redundant, see CLOTH above. Returns
 * the scores alongside the verdict so the dev harness, and the setup modal, can
 * show WHY rather than just refusing.
 */
export function garmentStructure(filled: MaskProfile, raw: MaskProfile): GarmentStructure {
  const p = filled
  const rows = p.bottom - p.top + 1
  const maxW = Math.max(1, p.maxW)

  // COLLAR — the top band's own rise. Reading a band rather than "top row vs
  // shoulder row" is what lets a hood (narrow at the crown, widening late) and
  // a crew collar (widening at once) both register as the same thing.
  const yBand = p.top + Math.round(TOP_BAND_H * (rows - 1))
  let wMin = Infinity
  let wMax = 0
  for (let y = p.top; y <= yBand; y++) {
    const wRow = p.r1[y] - p.l0[y]
    if (wRow < wMin) wMin = wRow
    if (wRow > wMax) wMax = wRow
  }
  const collar = Number.isFinite(wMin) ? (wMax - wMin) / maxW / COLLAR_RISE : 0

  // CLOTH — solidity of the top band on the UN-FILLED mask: cells of cloth over
  // outer span. A row of two thin handles spans wide and carries nothing.
  const rRows = raw.bottom - raw.top + 1
  const rBand = raw.top + Math.max(0, Math.round(TOP_BAND_H * rRows) - 1)
  let cloth$ = 0
  let span$ = 0
  for (let y = raw.top; y <= Math.min(raw.bottom, rBand); y++) {
    cloth$ += raw.rowArea[y]
    span$ += raw.r1[y] - raw.l0[y]
  }
  const cloth = span$ > 0 ? cloth$ / span$ / TOP_SOLID : 0

  // SHOULDER — where full width FIRST arrives. First, not "where the widest row
  // is": a vest that keeps flaring gently to its hem is widest at 90 % of its
  // height and is still a garment, because it was already near full width at
  // the armhole.
  let yFull = p.top
  while (yFull < p.bottom && p.r1[yFull] - p.l0[yFull] < FULL_WIDTH * maxW) yFull++
  const fullAt = (yFull - p.top) / Math.max(1, rows - 1)
  // Inverted so that, like the other two, ≥ 1 means the tell passed. Capped
  // because a shape already at full width on its first row (a poster) divides
  // by zero, and "infinitely shouldered" is not a number worth printing.
  const shoulder = Math.min(99, FULL_WIDTH_AT / Math.max(1e-4, fullAt))

  // NECK — on its way to full width a garment's outline only WIDENS. It starts
  // at a neck opening and ends at the shoulders, and there is nothing in
  // between for it to give width back to. A BODY gives it back: the outline
  // rises to the head, pinches at the neck, and rises again to the shoulders.
  //
  // That pinch is the whole reason this fourth tell exists. The other three are
  // each a thing a garment has and a mug, a poster, a tote or a cap does not —
  // and a photograph of a person WEARING the garment has all three of them: a
  // head is narrower than the shoulders it sits on (COLLAR), it is solid
  // (CLOTH), and the shoulders arrive high (SHOULDER). Measured, a person
  // scored 2.23 / 2.01 / 1.80 and sailed through, which makes it the one wrong
  // upload a customer is actually likely to make and the only one the first
  // three tells cannot see. Reading the dip rather than "is there a head" keeps
  // it a pure outline measurement with no notion of anatomy in it.
  let peak = 0
  let drop = 0
  for (let y = p.top; y <= yFull; y++) {
    const wRow = p.r1[y] - p.l0[y]
    if (wRow > peak) peak = wRow
    else if (peak - wRow > drop) drop = peak - wRow
  }
  const neck = Math.min(99, NECK_DIP / Math.max(1e-4, drop / maxW))

  return {
    collar,
    cloth,
    shoulder,
    neck,
    isGarment: collar >= 1 && cloth >= 1 && shoulder >= 1 && neck >= 1,
  }
}

// ------------------------------------------------------------------- classify

export interface ShapeGuess {
  shape: GarmentShape
  /** Distance from the deciding threshold, normalised — 0 means "a coin flip". */
  margin: number
  /** The raw features, for the harness and for reporting. */
  hemRatio: number
  hoodDrop: number
  shoulderNarrow: number
  topRatio: number
  armholes: number
}

/**
 * THE THRESHOLDS ARE MEASURED, NOT GUESSED. Every number below was read off the
 * real supplier catalogue through the app's own cutout — the profile dump in
 * scripts/inflate-verify.mjs prints all four features per garment, and the
 * separations quoted here are what it printed. That mattered: the first version
 * of this classifier was calibrated against imagined LAID-FLAT silhouettes and
 * called five of seven real garments a vest, because product photos are shot on
 * an invisible mannequin with the sleeves hanging DOWN, merged with the torso.
 * On such a photo "how far past the torso does the widest row reach" is zero for
 * every long-sleeved garment, which is the opposite of what a flat-lay says.
 */

/**
 * SLEEVE LENGTH. Width at the hem relative to the widest row. A short sleeve
 * ends around mid-torso, so the hem is torso-only and much narrower than the
 * shoulder-and-sleeve span; a long sleeve puts a cuff beside the hem, so the two
 * are the same width. Measured: 0.64 / 0.66 / 0.72 short, 0.98…1.00 long — the
 * widest gap in the whole feature set, so this carries the decision that
 * actually matters (which of the two donor meshes lends its depth).
 */
const HEM_SHORT = 0.85
/** Rows counted as "the hem" — above the roll/rib, below the last taper. */
const HEM_BAND = [0.8, 0.94] as const
/**
 * HOOD. How far down the garment has to go before it reaches (near) full width.
 * A hood is a lobe sitting on top of the shoulders, so full width arrives late;
 * a crew collar is a notch in an otherwise full-width shoulder line. Measured
 * among long-sleeved garments: 0.083 / 0.092 crew, 0.152 / 0.184 hooded.
 * NOT applied to short-sleeved garments, whose sleeve flare puts the widest row
 * far below the shoulders and pushes this feature into the hooded range — and
 * which need no hood test anyway, since tee, polo and tank share one donor.
 */
const HOOD_DROP = 0.12
/** "Near full width" for the hood test. */
const HOOD_FULL = 0.8
/**
 * SLEEVELESS. The band just under the shoulder, relative to the chest. A sleeve
 * fills that band; an armhole scoops it out. Measured 0.761 on the vest against
 * 0.850…0.961 for every sleeved garment. Paired with `topRatio` (a strap spans
 * nearly the whole body width, a collar or a hood does not) so that two
 * independent measurements of "there is no sleeve here" have to agree — the
 * deep-hood case is the one that can push `shoulderNarrow` alone down.
 */
const TANK_SHOULDER = 0.81
const TANK_TOP = 0.7
const SHOULDER_BAND = [0.2, 0.35] as const
const CHEST_BAND = [0.35, 0.62] as const
/** Fraction of the height the top band spans. */
const TOP_BAND = 0.08

/** Outer extent of a row, in cells. */
const outerAt = (p: MaskProfile, y: number): number => p.r1[y] - p.l0[y]

/** Outer widths over a band given as fractions of the garment's own height. */
function bandWidths(p: MaskProfile, a: number, b: number): number[] {
  const H = Math.max(1, p.bottom - p.top)
  const y0 = p.top + Math.round(a * H)
  const y1 = Math.min(p.bottom, p.top + Math.round(b * H))
  const v: number[] = []
  for (let y = y0; y <= y1; y++) v.push(outerAt(p, y))
  return v.length ? v : [outerAt(p, p.top)]
}

/**
 * Classify a garment photo from its silhouette alone.
 *
 * Order matters and is not arbitrary: sleeveless first (an armhole is a hard
 * structural tell that survives any pose), then sleeve LENGTH (the one decision
 * that changes which mesh donates its depth), then — only within the long-sleeve
 * family, where it is unambiguous — the hood.
 *
 * Two labels are never produced automatically and exist only as customer
 * overrides: 'polo' (a collar and a placket are a few tenths of an inch of
 * relief that live in the photo, not in the depth field) and 'sweatshirt' (a
 * crew sweat and a long-sleeve tee are the same geometry). Both share a donor
 * with the label the classifier does return, so nothing is lost by the silence.
 */
export function classifyShape(p: MaskProfile, armholes: number): ShapeGuess {
  const H = Math.max(1, p.bottom - p.top)
  const maxW = Math.max(1, p.maxW)
  const hemRatio = median(bandWidths(p, HEM_BAND[0], HEM_BAND[1])) / maxW
  let hoodDrop = 0
  for (let y = p.top; y <= p.bottom; y++) {
    if (outerAt(p, y) >= HOOD_FULL * maxW) {
      hoodDrop = (y - p.top) / H
      break
    }
  }
  const shoulderNarrow =
    Math.min(...bandWidths(p, SHOULDER_BAND[0], SHOULDER_BAND[1])) /
    Math.max(1, Math.max(...bandWidths(p, CHEST_BAND[0], CHEST_BAND[1])))
  const topRatio = median(bandWidths(p, 0, TOP_BAND)) / Math.max(1, p.bodyW)
  const feat = { hemRatio, hoodDrop, shoulderNarrow, topRatio, armholes }
  const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

  if (armholes >= 2)
    return { shape: 'tank', margin: 1, ...feat }
  if (shoulderNarrow < TANK_SHOULDER && topRatio > TANK_TOP)
    return { shape: 'tank', margin: clamp01((TANK_SHOULDER - shoulderNarrow) / 0.06), ...feat }
  if (hemRatio < HEM_SHORT)
    return { shape: 'tee', margin: clamp01((HEM_SHORT - hemRatio) / 0.1), ...feat }
  if (hoodDrop > HOOD_DROP)
    return { shape: 'hoodie', margin: clamp01((hoodDrop - HOOD_DROP) / 0.04), ...feat }
  return { shape: 'longsleeve', margin: clamp01((HOOD_DROP - hoodDrop) / 0.04), ...feat }
}

// -------------------------------------------------------------- user override

/**
 * The customer's explicit choice, when they made one.
 *
 * ONE SLOT, ON PURPOSE. A design carries exactly one custom garment, and the
 * setup modal is the only place one is ever defined — so a single stored value
 * is enough, and it is the only design that keeps the 3D preview and the AR
 * bake in lockstep. The preview is handed a composited canvas and nothing else
 * (no asset id reaches it), so any per-asset keying would be readable by the AR
 * path and not by the preview, and the two would disagree about the shape of
 * the same garment. The modal clears the slot whenever a new photo is uploaded,
 * which is the moment the previous answer stops being about this garment.
 *
 * Persisted so the choice survives a reload; a storage failure (private mode,
 * quota) degrades to automatic detection rather than throwing.
 */
const STORE_KEY = 'tshop.customShape'
let overrideCache: GarmentShape | null | undefined

function readOverride(): GarmentShape | null {
  if (overrideCache !== undefined) return overrideCache
  let v: string | null = null
  try {
    v = globalThis.localStorage?.getItem(STORE_KEY) ?? null
  } catch {
    v = null
  }
  overrideCache = (GARMENT_SHAPES as readonly string[]).includes(v ?? '') ? (v as GarmentShape) : null
  return overrideCache
}

export function getShapeOverride(): GarmentShape | null {
  return readOverride()
}

/** Set (or clear, with null) the customer's explicit garment shape. */
export function setShapeOverride(shape: GarmentShape | null): void {
  overrideCache = shape
  try {
    if (shape) globalThis.localStorage?.setItem(STORE_KEY, shape)
    else globalThis.localStorage?.removeItem(STORE_KEY)
  } catch {
    /* detection still works without persistence */
  }
}

/** Last automatic classification — a UI hint and a harness probe, never logic. */
let lastGuess: ShapeGuess | null = null
export function getDetectedShape(): GarmentShape | null {
  return lastGuess?.shape ?? null
}
export function getLastShapeGuess(): ShapeGuess | null {
  return lastGuess
}

export interface ResolvedShape extends ShapeGuess {
  /** Where the answer came from. */
  source: 'user' | 'auto'
}

/** The shape to build with: the customer's choice if they made one, else the
 *  classifier's. Both callers (3D preview, AR bake) go through here, so they
 *  cannot disagree. */
export function resolveShape(p: MaskProfile, armholes: number): ResolvedShape {
  const guess = classifyShape(p, armholes)
  lastGuess = guess
  const chosen = readOverride()
  return chosen ? { ...guess, shape: chosen, source: 'user' } : { ...guess, source: 'auto' }
}
