/**
 * Garment anatomy — deterministic measurements read off a garment PHOTO.
 *
 * WHY THIS EXISTS
 * ---------------
 * A customer-shipped (or supplier-ingested) garment has no CAD template: all
 * we own is a laid-flat photo plus ONE real number, the laid-flat width. But
 * the professional placement rules (src/content/zones.ts) are expressed in
 * centimetres FROM THE COLLAR SEAM and FROM THE BODY CENTRE LINE, and a print
 * sitting 3 cm off centre is visibly wrong on the finished garment. Asking the
 * customer to eyeball a rectangle over a photo cannot produce that. So the
 * placer needs the same three landmarks a print shop measures by hand: the
 * centre line, the bottom of the neck opening, and the body's side edges.
 *
 * We recover them from the photo's ALPHA MASK (the background-removal cutout),
 * never from colour: colour is prints, logos, folds and shadows; alpha is the
 * garment's actual outline. When there is no usable alpha (photo shot on white
 * without removal, or bg-removal unsupported) the mask is one solid rectangle —
 * `opaque` says so and every consumer must fall back to proportional guides.
 *
 * COORDINATES
 * -----------
 * Everything is INCHES relative to the alpha bounding box top-left — exactly
 * the space `CustomSideSetup.printArea` lives in (see getCustomSideInfo in
 * src/lib/custom.ts), where the bbox WIDTH equals the garment's laid-flat
 * width. Anatomy is DERIVED, never persisted: the stored data shape stays
 * `RectIn` and re-analysing a photo can only improve the guides, never
 * invalidate a saved design.
 *
 * DETERMINISM: a pure function of the pixels — no Math.random, no Date.now,
 * no reliance on iteration order. Same photo ⇒ same numbers, always.
 *
 * MEMOISATION: the scan is cached per (assetId, variant) in UNIT space
 * (widthIn = 1, i.e. fractions of the garment width) and multiplied by the
 * caller's `widthIn` on the way out. Every field is linear in widthIn, so the
 * setup modal's width slider can move at 60 fps without re-reading a pixel,
 * and the cache can never go stale with respect to the width.
 *
 * GUARDS: every step degrades to a proportional fallback instead of throwing.
 * A wrong landmark is worse than no landmark, so each detector must clear an
 * explicit plausibility gate (documented at its call site) before it is
 * believed.
 */
import { getCustomSideInfo } from '@/lib/custom'
import type { CustomSideSetup } from '@/lib/types'

export interface GarmentAnatomy {
  /** Vertical mirror axis of the garment, inches from the bbox left edge. */
  axisXIn: number
  /** Confidence 0..1 of the axis (mirror-correlation score). Low ⇒ UI shows it as a hint, not a hard snap. */
  axisConfidence: number
  /** Bottom of the neck opening (where a collar-anchored placement measures from), inches from the bbox top. Null when undetectable. */
  collarYIn: number | null
  /** Width of the neck opening at its widest, inches. Null when undetectable. */
  collarWIn: number | null
  /** Shoulder line: first row (from the top) at which the garment reaches ~88% of its maximum width. */
  shoulderYIn: number
  /** Hem: bottom of the alpha content. */
  hemYIn: number
  /** Torso side edges at mid-body, excluding sleeves — inches from the bbox left. */
  torsoLeftXIn: number
  torsoRightXIn: number
  /** Per-row width profile (inches), sampled on the analysis grid — lets the UI draw a body outline. */
  rowWidthIn: Float32Array
  /** true when the mask is essentially a full rectangle (no cutout was done) — the UI must then fall back to proportional guides. */
  opaque: boolean
}

/** Long edge of the analysis grid. */
const SCAN = 256
/** Alpha threshold — the same one `scanAlphaBBox` uses, so the mask this
 *  module measures is exactly the mask that defined the bbox. */
const ALPHA_T = 16
/** Mirror search half-window, as a fraction of the garment width. */
const AXIS_SEARCH = 0.12
/** How far a "deliberately bad" axis sits, for the confidence denominator. */
const AXIS_NULL_SHIFT = 0.15
/** Mirror comparison reach either side of a candidate axis. Fixed (not
 *  axis-dependent) so scores of different candidates stay comparable. */
const AXIS_REACH = 0.42
/** A neck opening is between these fractions of the garment width. */
const COLLAR_MIN_W = 0.08
const COLLAR_MAX_W = 0.45
/** Rows below this fraction of the height cannot be a collar. */
const COLLAR_BAND = 0.35
/** A neck opening spans at least this fraction of the garment height… */
const COLLAR_MIN_DEPTH = 0.04
/** …and its bottom sits at least this far below the garment's top edge.
 *  (Measured: a real flat-lay tee lands near 14%; the decoy gaps that fooled
 *  earlier tuning — a tank's strap notch, a polo's collar-wing V — sit at 5%.) */
const COLLAR_MIN_DROP = 0.06
/** …and a collar deeper than this is a scan artefact, not a neckline. */
const COLLAR_MAX_DROP = 0.3
/** Shoulder line = first row reaching this fraction of the max row width. */
const SHOULDER_FRAC = 0.88
/** Mid-body band used for the torso edges: below the sleeves, above the hem taper. */
const TORSO_BAND = [0.55, 0.75] as const
/** Coverage above which the mask is "a full rectangle" (mirrors the gate in
 *  src/lib/silhouette.ts canvasToSilhouette; the bbox-fills-the-frame half of
 *  that gate is implicit here because we analyse the bbox crop itself). */
const OPAQUE_COVERAGE = 0.97

// ---------------------------------------------------------------------------
// Mask
// ---------------------------------------------------------------------------

interface Mask {
  w: number
  h: number
  inside: Uint8Array
  /** First / last inside column per row (−1 when the row is empty). */
  rowL: Int16Array
  rowR: Int16Array
  /** First inside row per column (−1 when the column is empty). */
  colT: Int16Array
  /** Fraction of the crop that is inside the garment. */
  coverage: number
}

/** Downscaled binary alpha mask of the bbox crop (the garment, nothing else). */
function buildMask(
  img: CanvasImageSource,
  bbox: { x: number; y: number; w: number; h: number },
): Mask | null {
  if (!(bbox.w > 0) || !(bbox.h > 0)) return null
  const scale = Math.min(1, SCAN / Math.max(bbox.w, bbox.h))
  const w = Math.max(8, Math.round(bbox.w * scale))
  const h = Math.max(8, Math.round(bbox.h * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, bbox.x, bbox.y, bbox.w, bbox.h, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data

  const inside = new Uint8Array(w * h)
  const rowL = new Int16Array(h).fill(-1)
  const rowR = new Int16Array(h).fill(-1)
  const colT = new Int16Array(w).fill(-1)
  let count = 0
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      if (data[(row + x) * 4 + 3] > ALPHA_T) {
        inside[row + x] = 1
        count++
        if (rowL[y] < 0) rowL[y] = x
        rowR[y] = x
        if (colT[x] < 0) colT[x] = y
      }
    }
  }
  if (count === 0) return null
  return { w, h, inside, rowL, rowR, colT, coverage: count / (w * h) }
}

// ---------------------------------------------------------------------------
// Landmarks
// ---------------------------------------------------------------------------

/**
 * Symmetry axis by mirror correlation: for every candidate column near the
 * centre, sum the mask disagreements between the pixel dx to its left and dx
 * to its right. A laid-flat garment is close to bilaterally symmetric, so the
 * true centre line is the score minimum; sleeves, a crooked lay or an
 * asymmetric print raise the floor but rarely move the minimum.
 *
 * Confidence compares the winner against a deliberately WRONG axis (shifted
 * 15% of the width): on a symmetric garment the wrong axis scores far worse,
 * on a shapeless blob both score the same and confidence collapses to 0 — the
 * UI then shows the axis as a faint hint instead of snapping to it.
 */
function findAxis(m: Mask): { axisPx: number; confidence: number } {
  const reach = Math.max(4, Math.round(m.w * AXIS_REACH))
  const score = (axis: number): number => {
    let s = 0
    for (let y = 0; y < m.h; y++) {
      const row = y * m.w
      for (let dx = 1; dx <= reach; dx++) {
        const l = axis - dx
        const r = axis + dx
        const a = l >= 0 && l < m.w ? m.inside[row + l] : 0
        const b = r >= 0 && r < m.w ? m.inside[row + r] : 0
        if (a !== b) s++
      }
    }
    return s
  }

  const centre = (m.w - 1) / 2
  const lo = Math.max(1, Math.round(centre - m.w * AXIS_SEARCH))
  const hi = Math.min(m.w - 2, Math.round(centre + m.w * AXIS_SEARCH))
  const scores = new Map<number, number>()
  const at = (c: number): number => {
    let v = scores.get(c)
    if (v === undefined) {
      v = score(c)
      scores.set(c, v)
    }
    return v
  }

  let best = Math.round(centre)
  let bestScore = Infinity
  for (let c = lo; c <= hi; c++) {
    const s = at(c)
    if (s < bestScore) {
      bestScore = s
      best = c
    }
  }

  // Sub-pixel: fit a parabola through the winner and its two neighbours. The
  // mask is quantised to ~256 columns, so half a pixel of the garment width is
  // ~0.04 in on a 20 in tee — worth recovering for a centred print.
  const sm = at(Math.max(0, best - 1))
  const s0 = bestScore
  const sp = at(Math.min(m.w - 1, best + 1))
  const denom = sm - 2 * s0 + sp
  const delta = denom > 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (sm - sp)) / denom)) : 0

  const shift = Math.round(m.w * AXIS_NULL_SHIFT)
  const nullScore =
    (at(Math.max(0, best - shift)) + at(Math.min(m.w - 1, best + shift))) / 2
  const confidence =
    nullScore > 0 ? Math.max(0, Math.min(1, 1 - bestScore / nullScore)) : 0

  // +0.5: column index `best` compares its own left/right neighbours, so the
  // mirror plane sits at that column's CENTRE in edge coordinates.
  return { axisPx: best + 0.5 + delta, confidence }
}

/**
 * Neck opening, attempt 1 — the hole.
 *
 * On a properly cut-out flat-lay the neck is a HOLE inside the silhouette (the
 * background shows through it), so rows crossing it split into ≥2 runs with a
 * central gap straddling the symmetry axis. The collar line is the LAST row of
 * that hole: below it the neck rib closes and the chest is solid.
 *
 * The hole is taken as the TALLEST run of such rows, not the first one found.
 * Measured on real supplier photos, the top of a garment routinely produces a
 * 2–4 row decoy gap — the notch between a polo's collar wings, a hood's fold,
 * a hanging label — and anchoring 7 cm below THAT would print a chest logo up
 * on the shoulders. A real neck opening is a tall hole (≥ COLLAR_MIN_DEPTH of
 * the garment height) that ends well below the garment's top edge; anything
 * else is refused so the UI falls back to honest proportional guides.
 *
 * Returns null when no plausible hole exists (opaque neck rib, garment shot
 * stuffed/worn with the collar at the very top, hood covering the opening…).
 */
function collarFromHole(m: Mask, axisPx: number): { yPx: number; wPx: number } | null {
  const maxRow = Math.floor(m.h * COLLAR_BAND)
  const minGap = m.w * COLLAR_MIN_W
  const maxGap = m.w * COLLAR_MAX_W
  // Tallest contiguous run of collar rows seen so far, and the one in progress.
  let bestEnd = -1
  let bestLen = 0
  let bestWide = 0
  let runStart = -1
  let runWide = 0
  for (let y = 0; y < maxRow; y++) {
    const row = y * m.w
    // Walk the row's inside-runs, looking for the gap that contains the axis.
    let gap = 0
    let prevEnd = -1
    let inRun = false
    let runs = 0
    for (let x = 0; x <= m.w; x++) {
      const on = x < m.w && m.inside[row + x] === 1
      if (on && !inRun) {
        inRun = true
        runs++
        if (prevEnd >= 0) {
          const gStart = prevEnd + 1
          const gEnd = x - 1
          if (gStart <= axisPx && axisPx <= gEnd + 1) gap = gEnd - gStart + 1
        }
      } else if (!on && inRun) {
        inRun = false
        prevEnd = x - 1
      }
    }
    const isCollar = runs >= 2 && gap >= minGap && gap <= maxGap
    if (isCollar) {
      if (runStart < 0) {
        runStart = y
        runWide = 0
      }
      if (gap > runWide) runWide = gap
      const len = y - runStart + 1
      if (len > bestLen) {
        bestLen = len
        bestEnd = y
        bestWide = runWide
      }
    } else {
      runStart = -1
    }
  }
  // Too shallow to be a neckline (the caller applies the shared depth gates).
  if (bestEnd < 1) return null
  if (bestLen < m.h * COLLAR_MIN_DEPTH) return null
  return { yPx: bestEnd + 1, wPx: bestWide }
}

/**
 * Neck opening, attempt 2 — the top-edge concavity.
 *
 * With no hole (opaque rib, or a photo whose neckline merges with the body)
 * the neckline still shows as a DIP in the garment's top boundary: the
 * shoulders are the highest points, the middle sags. We take the deepest top
 * boundary near the axis and require it to be meaningfully below the shoulder
 * line, then measure the opening at half that depth.
 */
function collarFromDip(m: Mask, axisPx: number): { yPx: number; wPx: number } | null {
  const near = Math.max(2, Math.round(m.w * 0.22))
  const x0 = Math.max(0, Math.round(axisPx - near))
  const x1 = Math.min(m.w - 1, Math.round(axisPx + near))
  let shoulderTop = m.h
  for (let x = 0; x < m.w; x++) {
    const t = m.colT[x]
    if (t >= 0 && t < shoulderTop) shoulderTop = t
  }
  let dip = -1
  let dipX = -1
  for (let x = x0; x <= x1; x++) {
    const t = m.colT[x]
    if (t >= 0 && t > dip) {
      dip = t
      dipX = x
    }
  }
  if (dip < 0 || shoulderTop >= m.h) return null
  const depth = dip - shoulderTop
  // A real neckline drops at least ~2% of the garment height below the
  // shoulders and its deepest point sits near the centre line.
  if (depth < Math.max(2, m.h * 0.02)) return null
  if (Math.abs(dipX - axisPx) > m.w * 0.14) return null
  const half = shoulderTop + depth * 0.5
  let wPx = 0
  for (let x = x0; x <= x1; x++) if (m.colT[x] >= half) wPx++
  if (wPx < m.w * COLLAR_MIN_W || wPx > m.w * COLLAR_MAX_W) return null
  return { yPx: dip + 1, wPx }
}

/** Median of a numeric sample (copy-sorted; the caller's array is untouched). */
function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = values.slice().sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Proportional anatomy — the honest "we could not measure this" answer.
 * Numbers are the conservative fractions the placer used before measurement
 * existed, so the UI behaves exactly as it always did on unusable photos.
 */
export function proportionalAnatomy(widthIn: number, heightIn: number): GarmentAnatomy {
  return {
    axisXIn: widthIn / 2,
    axisConfidence: 0,
    collarYIn: null,
    collarWIn: null,
    shoulderYIn: heightIn * 0.12,
    hemYIn: heightIn,
    torsoLeftXIn: widthIn * 0.08,
    torsoRightXIn: widthIn * 0.92,
    rowWidthIn: new Float32Array(0),
    opaque: false,
  }
}

/** Multiply every inch-valued field by `k` (see the memo note in the header). */
function scaleAnatomy(a: GarmentAnatomy, k: number): GarmentAnatomy {
  const rows = new Float32Array(a.rowWidthIn.length)
  for (let i = 0; i < rows.length; i++) rows[i] = a.rowWidthIn[i] * k
  return {
    axisXIn: a.axisXIn * k,
    axisConfidence: a.axisConfidence,
    collarYIn: a.collarYIn === null ? null : a.collarYIn * k,
    collarWIn: a.collarWIn === null ? null : a.collarWIn * k,
    shoulderYIn: a.shoulderYIn * k,
    hemYIn: a.hemYIn * k,
    torsoLeftXIn: a.torsoLeftXIn * k,
    torsoRightXIn: a.torsoRightXIn * k,
    rowWidthIn: rows,
    opaque: a.opaque,
  }
}

/** The whole analysis, in UNIT space: widthIn = 1 ⇒ every field is a fraction
 *  of the garment's laid-flat width. Cached; scaled on the way out. */
function analyzeUnit(
  img: CanvasImageSource,
  bbox: { x: number; y: number; w: number; h: number },
): GarmentAnatomy {
  const aspect = bbox.w > 0 ? bbox.h / bbox.w : 1.2
  let m: Mask | null = null
  try {
    m = buildMask(img, bbox)
  } catch {
    m = null
  }
  if (!m) return proportionalAnatomy(1, aspect)

  const inPerPx = 1 / m.w
  const heightIn = m.h * inPerPx
  const out = proportionalAnatomy(1, heightIn)

  // Row width profile (outer extent per row — a neck hole must not shrink the
  // shoulder line, and the profile is what the UI draws as a body outline).
  const rowWidthIn = new Float32Array(m.h)
  let maxRowPx = 0
  let lastRow = -1
  for (let y = 0; y < m.h; y++) {
    const px = m.rowL[y] < 0 ? 0 : m.rowR[y] - m.rowL[y] + 1
    rowWidthIn[y] = px * inPerPx
    if (px > maxRowPx) maxRowPx = px
    if (px > 0) lastRow = y
  }
  out.rowWidthIn = rowWidthIn
  if (lastRow >= 0) out.hemYIn = (lastRow + 1) * inPerPx

  // No cutout was done: the "mask" is the photo's rectangle. Everything below
  // would measure the FRAME, not the garment — bail to proportional guides.
  if (m.coverage > OPAQUE_COVERAGE) {
    out.opaque = true
    return out
  }
  // A mask that never reaches half the bbox width is not a laid-flat garment
  // (bad matte, a hanger shot, a fragment) — same conservative answer. The row
  // profile goes with it: the UI mirrors it on the axis, and mirroring a real
  // profile on a GUESSED axis draws a confident outline of something that is
  // not the garment.
  if (maxRowPx < m.w * 0.5) {
    out.rowWidthIn = new Float32Array(0)
    return out
  }

  const { axisPx, confidence } = findAxis(m)
  out.axisXIn = axisPx * inPerPx
  out.axisConfidence = confidence

  // Shared plausibility window for BOTH detectors: a neckline you can anchor
  // "7 cm below" sits well under the garment's top edge (measured: ~14% of the
  // height on a flat-lay tee) and nowhere near the chest. Outside that window
  // the detection is a decoy — a strap notch, a collar-wing V, a scan artefact
  // — and null (proportional guides) is the honest answer.
  const collar = collarFromHole(m, axisPx) ?? collarFromDip(m, axisPx)
  const collarY = collar ? collar.yPx * inPerPx : 0
  if (collar && collarY >= heightIn * COLLAR_MIN_DROP && collarY <= heightIn * COLLAR_MAX_DROP) {
    out.collarYIn = collarY
    out.collarWIn = collar.wPx * inPerPx
  }

  const shoulderTarget = maxRowPx * SHOULDER_FRAC
  for (let y = 0; y < m.h; y++) {
    const px = m.rowL[y] < 0 ? 0 : m.rowR[y] - m.rowL[y] + 1
    if (px >= shoulderTarget) {
      out.shoulderYIn = (y + 0.5) * inPerPx
      break
    }
  }

  // Torso: the sleeves make the upper rows wider and the hem tapers, so the
  // BODY width is the median of the mid-band. Centring it on the mirror axis
  // (rather than using the raw left/right extents) keeps the two margins
  // meaningful even when the garment was laid down slightly crooked.
  const band: number[] = []
  const yA = Math.floor(m.h * TORSO_BAND[0])
  const yB = Math.min(m.h - 1, Math.ceil(m.h * TORSO_BAND[1]))
  for (let y = yA; y <= yB; y++) {
    const px = m.rowL[y] < 0 ? 0 : m.rowR[y] - m.rowL[y] + 1
    if (px > 0) band.push(px)
  }
  const torsoPx = median(band)
  if (torsoPx > m.w * 0.25) {
    out.torsoLeftXIn = Math.max(0, out.axisXIn - (torsoPx / 2) * inPerPx)
    out.torsoRightXIn = Math.min(1, out.axisXIn + (torsoPx / 2) * inPerPx)
  }

  return out
}

/**
 * Analyse a decoded garment photo. `bbox` is the alpha bounding box in SOURCE
 * pixels (from getCustomSideInfo), `widthIn` the garment's laid-flat width.
 * Never throws: an unreadable canvas yields proportional guides.
 */
export function analyzeGarment(
  img: HTMLImageElement,
  bbox: { x: number; y: number; w: number; h: number },
  widthIn: number,
): GarmentAnatomy {
  const w = widthIn > 0 ? widthIn : 1
  return scaleAnatomy(analyzeUnit(img, bbox), w)
}

/** Unit-space analyses, keyed like the bbox cache in src/lib/custom.ts. */
const cache = new Map<string, GarmentAnatomy>()

/**
 * Memoised anatomy for one side of a custom garment — mirrors
 * `getCustomSideInfo`, and shares its image + bbox caches.
 */
export async function getGarmentAnatomy(
  setup: CustomSideSetup,
  widthIn: number,
): Promise<GarmentAnatomy> {
  const w = widthIn > 0 ? widthIn : 1
  const key = `${setup.assetId}:${setup.useCutout ? 'cutout' : 'original'}`
  let unit = cache.get(key)
  if (!unit) {
    // widthIn = 1 on purpose: the info we need (image + bbox) is
    // width-independent and the analysis is stored in unit space.
    const info = await getCustomSideInfo(setup, 1)
    unit = analyzeUnit(info.img, info.bbox)
    cache.set(key, unit)
  }
  return scaleAnatomy(unit, w)
}

/** Drop cached anatomy for an asset (call wherever `invalidateCustomBBox` is —
 *  a new cutout is a new garment outline). */
export function invalidateGarmentAnatomy(assetId: string) {
  cache.delete(`${assetId}:original`)
  cache.delete(`${assetId}:cutout`)
}
