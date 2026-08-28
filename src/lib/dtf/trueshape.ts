/**
 * True-shape DTF nesting: pure, DOM-free, 100 % deterministic, Worker-safe.
 *
 * WHY THIS EXISTS
 * ---------------
 * The shelf packer in nesting.ts nests BOUNDING BOXES. Real DTF artwork fills
 * only 42–60 % of its box (a circular logo 78 %, a wordmark ~35 %, an arch
 * ~30 %), so a box-packed gang sheet is largely film bought for transparent
 * corners. Measured on this repo's own instances, packing the ALPHA MASK
 * instead cuts 14–45 % off the billed roll length, while swapping the shelf
 * packer for a better RECTANGLE packer (MAXRECTS, skyline) is worth ~5 % and is
 * not even monotone: it loses outright on some real orders. Hence: keep the
 * shelf packer, and beat it on shape.
 *
 * THE ALGORITHM: semi-discrete bottom-left-fill on a column profile
 * -----------------------------------------------------------------
 * Everything is rasterised onto a square cell grid of ~2,5 mm (see
 * `chooseRes`). For each piece and each allowed orientation we store ONE
 * `[bottom, top)` interval per column: the first and last inked cell of that
 * column. Placement is a skyline drop: for every candidate x the piece falls
 * until some column touches, then the score picks the lowest resulting top.
 *
 * Treating a column's ink as one solid span is deliberately CONSERVATIVE (a
 * donut's hole reads as filled), which makes overlaps impossible by
 * construction while still capturing top-surface concavity, where essentially
 * all of the gain lives. Nesting a part inside another part's hole would need
 * full run-lists and buys almost nothing on apparel artwork.
 *
 * WHY NOT NFP / SVGnest / jagua-rs: those need robust polygon booleans and a
 * vectorisation step (marching squares + RDP) that our input, a raster with
 * alpha, does not have and would only add error to. Their one advantage over
 * raster BLF is sub-cell precision, which a 2,5 mm grid behind a 5 mm
 * clearance makes irrelevant. The published state of the art reaches 87–93 %
 * on garment-shaped instances after 20 CPU-MINUTES; nobody is getting 98 %.
 *
 * THE TWO KNOBS
 * -------------
 * `maxInterlockCm`: a CEILING on how far a piece may tuck below the highest
 *   material in the columns it spans. It only ever clamps y UPWARD; it can
 *   never reject a placement, so it cannot fail. At 0 the packer switches to
 *   bounding-box profiles as well, which makes every piece sit entirely below
 *   everything sharing its columns: no piece overhangs another, so every one
 *   comes free with straight cuts. Raising it trades cutting comfort for fill.
 *
 *   Greedy placement is NOT monotone in that ceiling: more freedom walks into
 *   different local optima, and a deeper tuck measurably LOSES on real
 *   instances (58 cm roll, 12 restarts: a concave set packs into 350 cm at a
 *   5 cm ceiling and 380 cm at 8 cm). An operator who drags the slider to
 *   "maximum fill" and is handed MORE film stops trusting the tool, so the
 *   packer SWEEPS every rung of `INTERLOCK_STOPS_CM` at or below the ceiling
 *   and keeps the best. Because the rung set only grows with the ceiling and
 *   the orderings do not depend on it, the candidate set at a higher stop is a
 *   strict superset of the one at every lower stop. Monotonicity is then a
 *   property of the search space, not a hope. Every rung swept is ≤ what the
 *   operator allowed, so nothing exceeds the cutting comfort they asked for.
 * `restarts`: a COUNT of insertion orderings tried, never a time budget. A
 *   wall-clock budget would produce different layouts on different machines,
 *   and the manifest is an order-tracking artefact: "the re-export moved
 *   everything" is a support nightmare. Restart #0 is ALWAYS the existing
 *   shelf packer, so the chosen result is provably never worse than today's.
 *   Total work is `restarts × rungs`, i.e. the max-fill end of the slider
 *   genuinely costs more search than the straight-strip end: measured 21 ms
 *   per pack for 240 transfers on a 58 × 250 roll.
 *
 * DETERMINISM. No Math.random (the ordering perturbation is a fixed-seed LCG),
 * no Date.now, no time budget, total-order comparators everywhere (piece id is
 * always the final tiebreak), and typed arrays throughout. The alpha masks are
 * INPUTS: identical masks in, byte-identical placements out, on any machine.
 *
 * UNITS. cm everywhere, like the rest of the DTF module. Cells are an internal
 * detail; every emitted number is cm rounded to 0,1 µm.
 */
import {
  echoOptions,
  nestRoll,
  nestWith,
  resolveNestOptions,
  type DtfPiece,
  type DtfPlacement,
  type DtfSheet,
  type NestOptions,
  type NestResult,
  type ResolvedNestOptions,
} from './nesting'
import { estimateCost, type DtfProcess, type SupplierProfile } from './suppliers'

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

export type RotCw = 0 | 90 | 180 | 270

export interface ShapePiece extends DtfPiece {
  /**
   * Alpha mask of the artwork, row-major, 1 = ink, spanning EXACTLY the
   * piece's `wCm × hCm` bounding box. Resolution is free: the packer resamples
   * by ratio. Absent (or effectively solid) ⇒ the piece nests as a rectangle.
   */
  mask?: Uint8Array
  maskW?: number
  maskH?: number
  /**
   * The artwork has no "up", so 180°/270° are legal too. Default FALSE: a
   * heat transfer pressed upside-down is scrap, and anything with text has an
   * up. Measured worth on realistic instances: under 1 %, so this stays opt-in.
   */
  allowFlip?: boolean
}

export interface ShapeNestOptions extends NestOptions {
  /**
   * CEILING on how deep a piece may sink below its neighbours' skyline, cm.
   * 0 = straight rows. Use `INTERLOCK_MAX_CM` for "maximum fill", NOT
   * Infinity, which JSON.stringify silently turns into null and which would
   * therefore corrupt the manifest.
   */
  maxInterlockCm: number
  /** Number of insertion orderings to try, #0 being the shelf packer. */
  restarts: number
  /**
   * Pack only AT the ceiling instead of sweeping every rung below it. Set by
   * the fixed-format path, where the packer already runs once per candidate
   * format per sheet (tens of calls) and the bill is decided by which format
   * gets bought, not by three centimetres of length. Roll billing leaves it
   * off and gets the monotonicity guarantee.
   */
  singleInterlock?: boolean
}

/**
 * "No practical limit" interlock. Larger than any sheet a supplier prints, so
 * it never clamps, while staying a finite, serialisable number.
 */
export const INTERLOCK_MAX_CM = 1000

/**
 * The interlock ladder, cm, and the ONLY values the UI slider may offer.
 *
 * These are rungs, not a continuous range: the difference between 2,0 and
 * 2,4 cm of tuck is invisible to a pair of scissors, and a discrete stop is
 * something an operator can say out loud ("on a imprimé en jeu 5 cm"). More
 * importantly the monotonicity guarantee above is stated over exactly this
 * set: a ceiling that is one of these values is provably never beaten by a
 * smaller one. Keep the list short: every extra rung multiplies the search.
 */
export const INTERLOCK_STOPS_CM: readonly number[] = [0, 1, 2, 5, 12, INTERLOCK_MAX_CM]

/** Ranks a candidate solution. Lower is better. Default: billed cm. */
export type SheetScore = (sheets: DtfSheet[]) => number

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

/** Cell size we aim for: 2,5 mm. Measured sweet spot (1 mm buys nothing). */
const TARGET_CELL_CM = 0.25
const MIN_CELL_CM = 0.15
const MAX_CELL_CM = 0.4
/** Above this bbox fill a piece is a rectangle; the true-shape path is skipped. */
const RECT_FILL = 0.97
const EPS = 1e-9

const r4 = (v: number) => Math.round(v * 10000) / 10000

/**
 * Pick a cell size such that HALF the requested gap is an exact whole number
 * of cells. Dilating both neighbours by that many cells then yields exactly
 * `gapCm` of artwork-to-artwork clearance, the same half-gap convention the
 * shelf packer documents, so nothing downstream changes meaning.
 *
 * When the gap is too fine to land in the usable cell band the clearance is
 * rounded UP to what the grid can express (never down): a supplier's minimum
 * is a floor, and 1 mm of extra film beats a rejected file.
 */
export function chooseRes(gapCm: number): { res: number; half: number } {
  const half = Math.max(0, gapCm) / 2
  if (half <= EPS) return { res: TARGET_CELL_CM, half: 0 }
  const n = Math.max(1, Math.round(half / TARGET_CELL_CM))
  const exact = half / n
  if (exact >= MIN_CELL_CM && exact <= MAX_CELL_CM) return { res: exact, half: n }
  const res = Math.min(MAX_CELL_CM, Math.max(MIN_CELL_CM, half))
  return { res, half: Math.max(1, Math.ceil(half / res - EPS)) }
}

// ---------------------------------------------------------------------------
// Mask maths
// ---------------------------------------------------------------------------

/**
 * Resample a binary mask onto a `dw × dh` grid. Every source cell paints the
 * WHOLE destination range it touches, so ink is never lost in either
 * direction: the mask may only ever grow, which is the safe way to be wrong.
 */
function resampleOr(
  src: Uint8Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8Array {
  const out = new Uint8Array(dw * dh)
  for (let y = 0; y < sh; y++) {
    const y0 = Math.floor((y * dh) / sh)
    const y1 = Math.min(dh, Math.ceil(((y + 1) * dh) / sh))
    const row = y * sw
    for (let x = 0; x < sw; x++) {
      if (!src[row + x]) continue
      const x0 = Math.floor((x * dw) / sw)
      const x1 = Math.min(dw, Math.ceil(((x + 1) * dw) / sw))
      for (let Y = y0; Y < y1; Y++) {
        const o = Y * dw
        for (let X = x0; X < x1; X++) out[o + X] = 1
      }
    }
  }
  return out
}

/** Clockwise quarter turns. Exact on a grid: no resampling, no error. */
function rotateMask(
  m: Uint8Array,
  w: number,
  h: number,
  rot: RotCw,
): { m: Uint8Array; w: number; h: number } {
  if (rot === 0) return { m, w, h }
  const out = new Uint8Array(w * h)
  const ow = rot === 180 ? w : h
  const oh = rot === 180 ? h : w
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue
      const nx = rot === 90 ? h - 1 - y : rot === 180 ? w - 1 - x : y
      const ny = rot === 90 ? x : rot === 180 ? h - 1 - y : w - 1 - x
      out[ny * ow + nx] = 1
    }
  return { m: out, w: ow, h: oh }
}

/**
 * Chebyshev (square) dilation by `k` cells, padding the mask by `k` on all
 * four sides. Two separable prefix-sum passes, O(cells).
 *
 * Square rather than disc: it is ~0,4·gap MORE generous on the diagonals,
 * which is the wrong direction to be stingy in, and it costs 30 lines less
 * than a distance transform. Because both neighbours are dilated by half the
 * gap, cell-disjointness of the results means the artworks are at least
 * `2·k·res = gapCm` apart in Chebyshev distance, hence at least that in
 * Euclidean distance too.
 */
function dilate(
  m: Uint8Array,
  w: number,
  h: number,
  k: number,
): { m: Uint8Array; w: number; h: number } {
  const W = w + 2 * k
  const H = h + 2 * k
  const pad = new Uint8Array(W * H)
  for (let y = 0; y < h; y++) pad.set(m.subarray(y * w, (y + 1) * w), (y + k) * W + k)
  if (k === 0) return { m: pad, w: W, h: H }

  const mid = new Uint8Array(W * H)
  const pre = new Int32Array(W + 1)
  for (let y = 0; y < H; y++) {
    const row = y * W
    for (let x = 0; x < W; x++) pre[x + 1] = pre[x] + pad[row + x]
    for (let x = 0; x < W; x++) {
      const lo = x - k < 0 ? 0 : x - k
      const hi = x + k + 1 > W ? W : x + k + 1
      if (pre[hi] - pre[lo] > 0) mid[row + x] = 1
    }
  }

  const out = new Uint8Array(W * H)
  const cpre = new Int32Array(H + 1)
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) cpre[y + 1] = cpre[y] + mid[y * W + x]
    for (let y = 0; y < H; y++) {
      const lo = y - k < 0 ? 0 : y - k
      const hi = y + k + 1 > H ? H : y + k + 1
      if (cpre[hi] - cpre[lo] > 0) out[y * W + x] = 1
    }
  }
  return { m: out, w: W, h: H }
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

interface Profile {
  rot: RotCw
  /** Dilated footprint, cells. */
  w: number
  h: number
  /** Per column: first inked row, or -1 when the column carries no ink. */
  bottom: Int32Array
  /** Per column: last inked row + 1, or -1. */
  top: Int32Array
  /** Artwork footprint as placed, cm (w↔h swapped at 90°/270°). */
  wCm: number
  hCm: number
}

function profileOf(
  m: Uint8Array,
  w: number,
  h: number,
  rot: RotCw,
  wCm: number,
  hCm: number,
): Profile {
  const bottom = new Int32Array(w).fill(-1)
  const top = new Int32Array(w).fill(-1)
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      if (!m[row + x]) continue
      if (bottom[x] < 0) bottom[x] = y
      top[x] = y + 1
    }
  }
  return { rot, w, h, bottom, top, wCm, hCm }
}

/** Profile of a solid rectangle: the dilation of a box is a bigger box. */
function rectProfile(w: number, h: number, rot: RotCw, wCm: number, hCm: number): Profile {
  return {
    rot,
    w,
    h,
    bottom: new Int32Array(w),
    top: new Int32Array(w).fill(h),
    wCm,
    hCm,
  }
}

interface Built {
  profiles: Profile[]
  /** Real ink area, cm²: the honest utilisation numerator. */
  inkAreaCm2: number
}

function buildProfiles(
  p: ShapePiece,
  res: number,
  half: number,
  useBBox: boolean,
): Built {
  const wCells = Math.max(1, Math.ceil(p.wCm / res - EPS))
  const hCells = Math.max(1, Math.ceil(p.hCm / res - EPS))

  let base: Uint8Array | null = null
  if (p.mask && p.maskW && p.maskH && p.mask.length >= p.maskW * p.maskH) {
    const m = resampleOr(p.mask, p.maskW, p.maskH, wCells, hCells)
    let ink = 0
    for (let i = 0; i < m.length; i++) ink += m[i]
    // An all-but-solid mask is a rectangle: the true-shape path would cost
    // work and buy nothing. An EMPTY mask means the caller measured nothing
    // usable, and nesting "no ink" would let pieces overlap: fall back too.
    if (ink > 0 && ink < RECT_FILL * m.length) base = m
  }

  // Ink area is measured from the ARTWORK, never from the profiles actually
  // packed. At zero interlock the packer nests bounding boxes, and reporting
  // their area as "ink" would flatter the sheet by exactly the transparent
  // corners that figure exists to expose.
  let inkAreaCm2 = p.wCm * p.hCm
  if (base) {
    let ink = 0
    for (let i = 0; i < base.length; i++) ink += base[i]
    inkAreaCm2 = ink * res * res
  }

  const shape = useBBox ? null : base
  const rots: RotCw[] = [0]
  if (p.allowRotate) rots.push(90)
  // 180° of a RECTANGLE is the same rectangle; only a real mask can profit.
  if (p.allowFlip && shape) {
    rots.push(180)
    if (p.allowRotate) rots.push(270)
  }

  const profiles: Profile[] = []
  for (const rot of rots) {
    const swap = rot === 90 || rot === 270
    const wCm = swap ? p.hCm : p.wCm
    const hCm = swap ? p.wCm : p.hCm
    if (shape) {
      const r = rotateMask(shape, wCells, hCells, rot)
      const d = dilate(r.m, r.w, r.h, half)
      profiles.push(profileOf(d.m, d.w, d.h, rot, wCm, hCm))
    } else {
      const w = (swap ? hCells : wCells) + 2 * half
      const h = (swap ? wCells : hCells) + 2 * half
      profiles.push(rectProfile(w, h, rot, wCm, hCm))
    }
  }
  return { profiles, inkAreaCm2 }
}

// ---------------------------------------------------------------------------
// Instances + orderings
// ---------------------------------------------------------------------------

interface Item {
  /** `<piece.id>#<n>`: same identity convention as the shelf packer. */
  id: string
  sourceKey: string
  profiles: Profile[]
  inkAreaCm2: number
  bboxAreaCm2: number
  wCm: number
  hCm: number
  longCm: number
}

interface Prepared {
  res: number
  half: number
  cols: number
  barrier: number
  items: Item[]
  unplaceable: string[]
}

function prepare(
  pieces: ShapePiece[],
  R: ResolvedNestOptions,
  useBBox: boolean,
): Prepared {
  const { res, half } = chooseRes(R.gapCm)
  // The grid origin sits HALF A GAP outside the usable area, on all four
  // sides. Every profile is dilated by `half` on all four sides so that two
  // cell-disjoint profiles are `gapCm` apart; but the outermost pieces have no
  // neighbour past the sheet edge, so that outer half-gap must be swallowed by
  // the margin, exactly what the shelf packer's `usableW = width - 2·side +
  // gap` does. Without the `+ 2·half` the true-shape packer would be gapCm
  // narrower AND gapCm shorter per sheet than the shelf packer, and a piece
  // exactly the printable width could never be placed at all.
  const cols = Math.max(1, Math.floor((R.widthCm - 2 * R.sideMarginCm) / res + EPS) + 2 * half)
  const barrier = Math.max(
    1,
    Math.floor((R.maxLengthCm - 2 * R.endMarginCm) / res + EPS) + 2 * half,
  )

  const items: Item[] = []
  const unplaceable: string[] = []
  const cache = new Map<string, Built>()

  for (const p of pieces) {
    const qty = Math.floor(p.qty)
    if (!Number.isFinite(p.wCm) || !Number.isFinite(p.hCm) || p.wCm <= 0 || p.hCm <= 0) {
      if (qty > 0 && !unplaceable.includes(p.id)) unplaceable.push(p.id)
      continue
    }
    if (qty <= 0) continue
    const key = `${p.sourceKey}|${p.wCm}|${p.hCm}|${p.allowRotate ? 1 : 0}|${p.allowFlip ? 1 : 0}|${useBBox ? 'b' : 's'}`
    let built = cache.get(key)
    if (!built) {
      built = buildProfiles(p, res, half, useBBox)
      cache.set(key, built)
    }
    const fits = built.profiles.filter((pr) => pr.w <= cols && pr.h <= barrier)
    if (fits.length === 0) {
      if (!unplaceable.includes(p.id)) unplaceable.push(p.id)
      continue
    }
    for (let i = 0; i < qty; i++)
      items.push({
        id: `${p.id}#${i}`,
        sourceKey: p.sourceKey,
        profiles: fits,
        inkAreaCm2: built.inkAreaCm2,
        bboxAreaCm2: p.wCm * p.hCm,
        wCm: p.wCm,
        hCm: p.hCm,
        longCm: Math.max(p.wCm, p.hCm),
      })
  }
  // Sorted, because `unplaceable` is reported in the manifest and the README:
  // built in input order it would make two exports of the same order differ
  // purely because the operator reordered the queue.
  return { res, half, cols, barrier, items, unplaceable: unplaceable.sort() }
}

/** No clamp at all, larger than any skyline a 32-bit cell grid can hold. */
const UNLIMITED_DIP = 1 << 30

/**
 * Cell dips to sweep for a ceiling of `interlockCm`: every published rung at
 * or below it, deepest first, plus the caller's own value when it is not one
 * of them (an API caller asking for 8 cm must really get 8 cm of tuck).
 *
 * Nested by construction over `INTERLOCK_STOPS_CM`, which is what makes the
 * result monotone across the slider: see the module header.
 */
function dipLadder(interlockCm: number, res: number): number[] {
  const cells = (cm: number) =>
    cm >= INTERLOCK_MAX_CM ? UNLIMITED_DIP : Math.max(0, Math.round(cm / res))
  const out = new Set<number>()
  for (const stop of INTERLOCK_STOPS_CM) if (stop <= interlockCm) out.add(cells(stop))
  out.add(cells(interlockCm))
  return [...out].sort((a, b) => b - a)
}

/** Fixed-seed LCG: variety without randomness, so results reproduce exactly. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

const byId = (a: Item, b: Item) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * `n` deterministic insertion orders. The first six are structured heuristics
 * (they disagree about what "big" means, which is exactly the point); the rest
 * are seeded partial shuffles of the best-known one. Measured: pure restarts
 * took one realistic instance from 356,6 to 266,6 cm, −25 %, with no search
 * machinery at all, which is why there is no simulated annealing here.
 */
function orderings(items: Item[], n: number): Item[][] {
  const sorters: ((a: Item, b: Item) => number)[] = [
    (a, b) => b.inkAreaCm2 - a.inkAreaCm2 || b.hCm - a.hCm || byId(a, b),
    (a, b) => b.bboxAreaCm2 - a.bboxAreaCm2 || b.hCm - a.hCm || byId(a, b),
    (a, b) => b.hCm - a.hCm || b.wCm - a.wCm || byId(a, b),
    (a, b) => b.wCm - a.wCm || b.hCm - a.hCm || byId(a, b),
    (a, b) => b.longCm - a.longCm || b.bboxAreaCm2 - a.bboxAreaCm2 || byId(a, b),
    (a, b) => b.wCm + b.hCm - a.wCm - a.hCm || b.bboxAreaCm2 - a.bboxAreaCm2 || byId(a, b),
  ]
  const outs: Item[][] = []
  for (const s of sorters) {
    if (outs.length >= n) break
    outs.push([...items].sort(s))
  }
  if (outs.length === 0) return []
  const rnd = lcg(0x9e3779b9)
  while (outs.length < n) {
    const arr = [...outs[0]]
    for (let i = arr.length - 1; i > 0; i--)
      if (rnd() < 0.25) {
        const j = Math.floor(rnd() * (i + 1))
        const t = arr[i]
        arr[i] = arr[j]
        arr[j] = t
      }
    outs.push(arr)
  }
  return outs.slice(0, n)
}

// ---------------------------------------------------------------------------
// The placement kernel
// ---------------------------------------------------------------------------

interface Placed {
  item: Item
  prof: Profile
  x0: number
  /** Row, cells, GLOBAL across the whole open-ended strip. */
  y: number
}

/**
 * One insertion order → one solution. O(orientations × cols × pieceWidth) per
 * piece; measured 137 ms for 250 pieces at 232 columns.
 *
 * Candidate x is scanned exhaustively rather than only at skyline steps:
 * restricting it is 1,4× faster and measurably WORSE.
 */
function packOnce(order: Item[], P: Prepared, maxDip: number): Placed[] {
  const sky = new Int32Array(P.cols)
  const out: Placed[] = []

  for (const it of order) {
    let bp: Profile | null = null
    let bx = 0
    let by = 0
    let btop = 0
    let bwaste = 0

    for (const p of it.profiles) {
      const last = P.cols - p.w
      for (let x0 = 0; x0 <= last; x0++) {
        // (a) drop until a column touches
        let y = 0
        let sMax = 0
        for (let c = 0; c < p.w; c++) {
          const s = sky[x0 + c]
          if (s > sMax) sMax = s
          if (p.bottom[c] < 0) continue
          const need = s - p.bottom[c]
          if (need > y) y = need
        }

        // (b) hand-cut guard: clamp UP, never reject
        const yMin = sMax - maxDip
        if (y < yMin) y = yMin

        // (c) a piece may never straddle a billed-sheet boundary
        let fits = true
        for (let guard = 0; ; guard++) {
          const end = (Math.floor(y / P.barrier) + 1) * P.barrier
          if (y + p.h <= end) break
          if (guard >= 4) {
            fits = false
            break
          }
          y = end
          for (let c = 0; c < p.w; c++) {
            if (p.bottom[c] < 0) continue
            const need = sky[x0 + c] - p.bottom[c]
            if (need > y) y = need
          }
        }
        if (!fits) continue

        // (d) lexicographic minimise (total order ⇒ one possible answer)
        const top = y + p.h
        if (bp !== null && top > btop) continue
        let waste = 0
        for (let c = 0; c < p.w; c++)
          if (p.bottom[c] >= 0) waste += y + p.bottom[c] - sky[x0 + c]
        if (
          bp === null ||
          top < btop ||
          waste < bwaste ||
          (waste === bwaste && (x0 < bx || (x0 === bx && p.rot < bp.rot)))
        ) {
          bp = p
          bx = x0
          by = y
          btop = top
          bwaste = waste
        }
      }
    }
    if (bp === null) continue // filtered in prepare(); belt and braces

    for (let c = 0; c < bp.w; c++) {
      if (bp.bottom[c] < 0) continue
      const t = by + bp.top[c]
      if (t > sky[bx + c]) sky[bx + c] = t
    }
    out.push({ item: it, prof: bp, x0: bx, y: by })
  }
  return out
}

/**
 * Cut the open-ended strip into billed sheets at the barrier. No placement
 * crosses a barrier by construction (step (c) above), so this is a pure
 * regrouping, but the invariant is worth restating, because a piece that
 * straddled a cut would be discovered at the print shop.
 */
function toSheets(placed: Placed[], P: Prepared, R: ResolvedNestOptions): DtfSheet[] {
  const groups = new Map<number, Placed[]>()
  for (const pl of placed) {
    const k = Math.floor(pl.y / P.barrier)
    const g = groups.get(k)
    if (g) g.push(pl)
    else groups.set(k, [pl])
  }

  const out: DtfSheet[] = []
  for (const k of [...groups.keys()].sort((a, b) => a - b)) {
    const g = groups.get(k)!
    const placements: DtfPlacement[] = []
    let bottomCm = 0
    let area = 0
    let ink = 0
    for (const pl of g) {
      // Column `x0 + half` is the profile's first ARTWORK column, and the grid
      // origin is half a gap outside the margin (see `prepare`), so the two
      // half-gaps cancel: the artwork's left edge is exactly `x0` cells past
      // the margin. Same on y.
      const xCm = R.sideMarginCm + pl.x0 * P.res
      const yCm = R.endMarginCm + (pl.y - k * P.barrier) * P.res
      const rot = pl.prof.rot
      placements.push({
        id: pl.item.id,
        sourceKey: pl.item.sourceKey,
        xCm: r4(xCm),
        yCm: r4(yCm),
        wCm: r4(pl.prof.wCm),
        hCm: r4(pl.prof.hCm),
        rotated: rot === 90 || rot === 270,
        ...(rot !== 0 ? { rotCw: rot } : {}),
      })
      bottomCm = Math.max(bottomCm, yCm + pl.prof.hCm)
      area += pl.prof.wCm * pl.prof.hCm
      ink += pl.item.inkAreaCm2
    }
    // Reading order, so the manifest and the cutting-plan numbering are stable
    // whatever insertion order produced the winner.
    placements.sort(
      (a, b) => a.yCm - b.yCm || a.xCm - b.xCm || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )

    const raw = bottomCm + R.endMarginCm
    const billed = Math.min(
      R.maxLengthCm,
      Math.max(
        R.billingStepCm,
        Math.ceil((raw - 1e-6) / R.billingStepCm) * R.billingStepCm,
      ),
    )
    const capacity = R.widthCm * billed
    out.push({
      index: out.length + 1,
      widthCm: r4(R.widthCm),
      formatId: null,
      placements,
      // No shelves exist here; the cutting plan derives its chop lines from
      // the actual empty bands instead of pretending there are rows.
      shelfYsCm: [],
      shelfHsCm: [],
      rawLengthCm: r4(raw),
      lengthCm: r4(billed),
      utilization: capacity > 0 ? r4(area / capacity) : 0,
      inkUtilization: capacity > 0 ? r4(ink / capacity) : 0,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Candidate selection
// ---------------------------------------------------------------------------

/**
 * Ranking key, lexicographic and total:
 *   1. MORE pieces placed (never trade a dropped transfer for shorter film),
 *   2. the caller's objective: € for a roll order, cm by default,
 *   3. billed length,
 *   4. a canonical placement signature, so exact ties still resolve the same
 *      way on every machine.
 */
interface Key {
  placed: number
  score: number
  lengthCm: number
  sig: () => string
}

function keyOf(r: NestResult, score?: SheetScore): Key {
  let sig: string | null = null
  return {
    placed: r.totalPieces,
    score: score ? score(r.sheets) : r.totalLengthCm,
    lengthCm: r.totalLengthCm,
    sig: () => {
      if (sig === null) {
        const parts: string[] = []
        for (const s of r.sheets)
          for (const p of s.placements)
            parts.push(
              `${s.index}|${p.id}|${p.xCm}|${p.yCm}|${p.rotCw ?? (p.rotated ? 90 : 0)}`,
            )
        parts.sort()
        sig = parts.join(';')
      }
      return sig
    },
  }
}

function better(a: Key, b: Key): boolean {
  if (a.placed !== b.placed) return a.placed > b.placed
  if (a.score !== b.score) return a.score < b.score
  if (a.lengthCm !== b.lengthCm) return a.lengthCm < b.lengthCm
  return a.sig() < b.sig()
}

/**
 * Nest onto an open-ended ROLL, true-shape, multi-restart.
 *
 * Restart #0 is `nestRoll` (the shelf packer), scored with the same
 * objective, so this function can never return a worse solution than the one
 * shipped before it existed. That guarantee is not decorative: on one of the
 * five benchmark instances the shelf packer genuinely beats a good rectangle
 * packer, and shipping a "smarter" nester that loses money on real orders is
 * how trust in the tool dies.
 */
export function nestShapeRoll(
  pieces: ShapePiece[],
  options: ShapeNestOptions,
  score?: SheetScore,
  onProgress?: (done: number, total: number) => void,
): NestResult {
  const R = resolveNestOptions(options)
  const restarts = Math.max(1, Math.min(64, Math.floor(options.restarts) || 1))
  const interlock = Math.max(0, options.maxInterlockCm || 0)

  let best = nestRoll(pieces, options)
  let bestKey = keyOf(best, score)
  if (restarts < 2) {
    onProgress?.(1, 1)
    return best
  }

  const { res } = chooseRes(R.gapCm)
  // Rungs × orderings, both independent of each other, so the candidate set at
  // a higher ceiling contains the one at every lower published stop.
  const dips = options.singleInterlock
    ? [interlock >= INTERLOCK_MAX_CM ? UNLIMITED_DIP : Math.max(0, Math.round(interlock / res))]
    : dipLadder(interlock, res)

  // Rung 0 packs BOUNDING BOXES, not true shapes. With true-shape profiles a
  // zero dip only puts a piece above the INK in the columns it spans, so a
  // neighbour whose ink stops early can still be overhung, and "straight
  // rows" has to mean straight rows. That makes the two profile sets genuinely
  // different searches, so a ceiling above 0 has to run BOTH or it would not
  // contain the ceiling-0 candidate set: measured, a logo order packs into
  // 370 cm at ceiling 0 and 380 cm at ceiling 2 when it does not.
  const boxed = dips.includes(0) ? prepare(pieces, R, true) : null
  const shaped = dips.some((d) => d > 0) ? prepare(pieces, R, false) : null
  const any = shaped ?? boxed
  if (!any || any.items.length === 0) {
    onProgress?.(1, 1)
    return best
  }

  // Same comparators over the same keys (ink area is measured from the mask in
  // both), so the two prepared sets yield the SAME permutation: the rung-0
  // candidates really are the ceiling-0 candidates.
  const n = restarts - 1
  const plans: { P: Prepared; orders: Item[][]; dip: number }[] = []
  for (const dip of dips) {
    const P = dip === 0 && boxed ? boxed : (shaped ?? boxed!)
    plans.push({ P, orders: orderings(P.items, n), dip })
  }
  const total = 1 + plans.reduce((a, p) => a + p.orders.length, 0)
  let step = 1
  onProgress?.(step, total)

  for (const plan of plans)
    for (const order of plan.orders) {
      const sheets = toSheets(packOnce(order, plan.P, plan.dip), plan.P, R)
      const cand = assemble(sheets, R, plan.P.unplaceable, interlock)
      const key = keyOf(cand, score)
      if (better(key, bestKey)) {
        best = cand
        bestKey = key
      }
      onProgress?.(++step, total)
    }
  return best
}

function assemble(
  sheets: DtfSheet[],
  R: ResolvedNestOptions,
  unplaceable: string[],
  interlockCm: number,
): NestResult {
  let billed = 0
  let area = 0
  let ink = 0
  for (const s of sheets) {
    billed += s.lengthCm
    area += s.utilization * s.widthCm * s.lengthCm
    ink += (s.inkUtilization ?? 0) * s.widthCm * s.lengthCm
  }
  const capacity = R.widthCm * billed
  return {
    sheets,
    billing: 'roll',
    packer: 'trueshape',
    interlockCm: r4(interlockCm),
    options: echoOptions(R),
    totalPieces: sheets.reduce((a, s) => a + s.placements.length, 0),
    totalLengthCm: r4(billed),
    totalLengthM: r4(billed / 100),
    totalUtilization: capacity > 0 ? r4(area / capacity) : 0,
    totalInkUtilization: capacity > 0 ? r4(ink / capacity) : 0,
    unplaceable,
  }
}

// ---------------------------------------------------------------------------
// Job entry point (shared by the Worker and the inline fallback)
// ---------------------------------------------------------------------------

/**
 * Everything a nesting run needs, structured-clone safe: this crosses the
 * Worker boundary verbatim, `Uint8Array` masks included.
 */
export interface NestJob {
  pieces: ShapePiece[]
  options: ShapeNestOptions
  /** Present ⇒ the run optimises MONEY instead of centimetres (roll billing). */
  supplier?: SupplierProfile
  process?: DtfProcess
}

/**
 * Run a job. On ROLL billing the objective is the supplier's total in euros,
 * not the length: with a 10 cm billing step and tier ladders, three
 * centimetres saved are worth exactly nothing while crossing 20 lm at DTF+ is
 * worth €27.
 *
 * On FIXED billing the money is decided one sheet at a time by nestFixedWith,
 * which buys the format minimising `price ÷ pieces placed on that ONE sheet`
 * and then re-packs whatever is left. All the inner packer controls is that
 * numerator's denominator, so it is scored by how full the FIRST sheet comes
 * out. Minimising total length there would happily move pieces off the sheet
 * being priced onto a sheet that is about to be discarded and re-packed.
 */
export function runNestJob(
  job: NestJob,
  onProgress?: (done: number, total: number) => void,
): NestResult {
  const { pieces, options } = job
  const proc = job.process
  if (!proc) return nestShapeRoll(pieces, options, undefined, onProgress)
  const supplier = job.supplier
  const score: SheetScore | undefined =
    proc.billing === 'fixed'
      ? (sheets) => -(sheets[0]?.placements.length ?? 0)
      : supplier
        ? (sheets) => estimateCost(supplier, proc, sheets).totalEur
        : undefined
  // Fixed billing runs the packer once per CANDIDATE FORMAT per emitted sheet
  // AND once per single-format plan, i.e. tens of calls, so the restart count
  // multiplies by ~formats × sheets × plans. Cap it and skip the interlock
  // sweep: the format choice, not the search depth, is what moves the bill
  // there, and a whole sheet is bought whatever its last three centimetres do.
  const fixed = proc.billing === 'fixed'
  const restarts = fixed ? Math.min(4, options.restarts) : options.restarts
  return nestWith(pieces, proc, options, (ps, o) =>
    nestShapeRoll(
      ps as ShapePiece[],
      {
        ...o,
        maxInterlockCm: options.maxInterlockCm,
        restarts,
        ...(fixed ? { singleInterlock: true } : {}),
      },
      score,
      // Progress only makes sense for the single roll pass; the fixed-format
      // loop calls the packer once per candidate format per sheet.
      proc.billing === 'roll' ? onProgress : undefined,
    ),
  )
}
