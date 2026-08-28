/**
 * TEMPLATE DEPTH TRANSPLANT: give an uploaded garment photo the depth field of
 * a real garment instead of a balloon.
 *
 * WHY, IN ONE PARAGRAPH
 * ---------------------
 * `poissonInflate` (silhouette.ts) solves ∇²h = −4 inside the silhouette. That
 * is the principled answer to "inflate this curve" (Baran & Lehtinen 2009) and
 * it is provably the wrong shape for cloth: its solution peaks on the medial
 * axis and is dome-symmetric, so a t-shirt comes out as a pillow with a crease
 * down the middle: fullest at the navel, thickest where the fabric is loosest,
 * no shoulder roll, no collar dip, no sleeve tubes. No tuning of a Poisson
 * field fixes that, because the information simply is not in the outline. It IS
 * in the two garment meshes this app already ships, so we take it from them:
 * warp a template's orthographic depth field onto the photo's silhouette and
 * substitute it for √(h/hMax).
 *
 * WHAT IS AND IS NOT DEFORMED
 * ---------------------------
 * Only Z. The sheets' X/Y vertex positions and UVs are untouched, exactly as
 * silhouette.ts's header promises, so print inch accuracy and decal crispness
 * are preserved BY CONSTRUCTION and need no re-proving. Replacing the mesh with
 * the warped template would buy a true grazing-angle silhouette and a hood you
 * can see behind, and would put that guarantee back in play; it is the right
 * v2, not the right v1.
 *
 * THE WARP, IN TWO STAGES
 * -----------------------
 * Stage A: GRADING. A separable, monotone global map: rows are matched by
 * CUMULATIVE AREA QUANTILE (the template's 40 %-of-cloth row lands on the
 * photo's 40 %-of-cloth row) and columns through five knots built from the
 * torso width and the widest row. Landmark-free by design: every "find the
 * shoulder line" rule we tried worked on a flat-lay photo and broke on the
 * A-pose mesh, whose shoulders merge into its arms. Area quantile has no such
 * failure mode: it is monotone by construction and reads the same thing on
 * both sides. This stage is what the IoU gate measures, because it is the stage
 * that can be WRONG: it asks "once graded, is this photo shaped like this class
 * of garment at all?".
 *
 * Stage B: STRUCTURAL SNAP. Per row, the photo's (leftmost run, body run,
 * rightmost run) spans are mapped onto the template's. This is what makes an
 * A-pose donor legal: torso maps to torso and sleeve to sleeve regardless of
 * arm angle. Where the photo's arm touches its body and the template's does not,
 * the map JUMPS across the template's arm/body gap. The jump is invisible
 * because both of its endpoints are template silhouette rims, where the depth
 * field is ~0: the value is continuous even though the map is not.
 *
 * Stage B matches the outline exactly per row, so it cannot supply an honest
 * confidence; that is precisely why the gate lives on Stage A.
 *
 * DETERMINISM: base64 decode, prefix sums, piecewise-linear maps and bilinear
 * sampling. No randomness, no time, no async: this runs inside the synchronous
 * shell build that the AR bake and the 3D preview both call, which is what makes
 * those two produce byte-identical geometry.
 */
import type { MaskProfile } from '@/lib/garmentShape'
import { profileMask } from '@/lib/garmentShape'
import { TEMPLATE_DEPTH, type TemplateId } from '@/lib/templateDepthData'

export interface DepthField {
  /** Front-surface profile 0..1 on the padded working grid ((W+2)×(H+2)). */
  front: Float32Array
  /** Back-surface profile 0..1, same grid, same orientation (1 = deepest). */
  back: Float32Array
  /** Stage-A silhouette agreement between the graded template and the photo. */
  iou: number
  template: TemplateId
  /** Local vertical stretch the row map applies, min/max over the garment. */
  yScaleMin: number
  yScaleMax: number
}

/**
 * Stage-A IoU below which we do not believe the template.
 *
 * THIS IS NOT THE "IS IT A GARMENT" TEST, and trying to make it one is how the
 * first version of this gate let a tote bag through at 0.935, a better score
 * than five of the seven garments then under test. The grading map is free to
 * rescale the torso span and the sleeve span independently, which is exactly
 * what lets one tee mesh dress a slim polo and an oversize tee, and equally
 * what lets it squash into a box. No threshold separates those populations
 * because the feature does not distinguish them; `garmentStructure`
 * (src/lib/garmentShape.ts) does that, and it runs first.
 *
 * What is left for this number is the narrower question it can actually answer:
 * given that the upload IS a garment, could this donor be graded onto it? The
 * measured distribution over 17 real supplier garments (every family the
 * catalogue sells, printed by scripts/inflate-verify.mjs on every run) is
 * 0.840 … 0.970, the low end being a racerback vest whose armholes the tee mesh
 * has no counterpart for. 0.78 therefore clears every garment we have seen by
 * ×1.08 and still refuses a donor that simply cannot be made to cover the
 * outline, and refusing means falling back to the Poisson balloon, i.e. to
 * today's behaviour. Nothing gets worse than the status quo.
 */
const IOU_MIN = 0.78
/**
 * A row map that has to stretch the template past ×2.6 or squash it below ×0.4
 * is not grading a garment, it is being asked to fit something else. Same
 * consequence: fall back.
 */
const Y_SCALE_MIN = 0.4
const Y_SCALE_MAX = 2.6
/** Passes of nearest-neighbour fill over the template's uncovered cells. */
const FILL_PASSES = 14
/**
 * Vertical smoothing of the WARPED field, as a fraction of the garment's own
 * height, and how many box passes approximate the Gaussian.
 *
 * WHY THE WARP NEEDS FILTERING AND THE TEMPLATE DOES NOT. The baked field is a
 * rasterised mesh: smooth by construction. Everything rough in the warped copy
 * was put there by the warp, and there are two sources. The donor's own OUTLINE
 * steps (the tee mesh sheds a fifth of its width in five of its 107 rows where
 * its sleeves hem out, the hoodie mesh's body run loses 19 of 96 columns in ONE
 * row where its arms leave the torso), and Stage B, which matches the outline
 * per row, faithfully transplants those steps onto a photo whose own silhouette
 * does not step at the matched row. The row map can also compress locally.
 *
 * A step between two adjacent rows is not a small error, because the sheet's
 * normals are computed FROM this field: it ships as a hard black crease drawn
 * across the chest, which is worse than the balloon it replaced. Measured
 * (scripts/inflate-verify.mjs prints maxSlope per case) the unfiltered
 * transplant ran 3–10× rougher than the Poisson shell of the SAME photo, which
 * carries the same folds and wrinkles, so the excess was all warp.
 *
 * 1.8 % of the garment's height over three box passes is ≈ a Gaussian of σ ≈
 * 2.5 %, an order of magnitude finer than the features the transplant exists
 * for (the collar dip and the shoulder roll each span 10–20 % of the height),
 * and wide enough that a one-row cliff arrives as a fold instead of a gash.
 * Y ONLY: the artefact is row-to-row, and the per-row map is already as smooth
 * in x as the donor's own profile.
 */
const SMOOTH_Y_FRAC = 0.018
const SMOOTH_PASSES = 3

/**
 * Why the last fit was accepted or refused. A diagnostic for the dev harness
 * and scripts/inflate-verify.mjs, never read by rendering code, because a
 * module-level mutable would then make two identical inputs disagree.
 */
export interface TemplateFit {
  template: TemplateId
  iou: number
  yScaleMin: number
  yScaleMax: number
  reason: 'ok' | 'no-template' | 'y-scale' | 'iou' | 'empty' | 'non-finite'
}
let lastFit: TemplateFit | null = null
export function getLastTemplateFit(): TemplateFit | null {
  return lastFit
}

// --------------------------------------------------------------- decode + cache

interface Template {
  w: number
  h: number
  cov: Uint8Array
  /** Front/back profiles, hole-filled so bilinear sampling is always defined. */
  front: Float32Array
  back: Float32Array
  profile: MaskProfile
}

const CACHE = new Map<TemplateId, Template | null>()

function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Spread the depth field outward over uncovered cells so a sample that lands in
 * the template's collar hole or in an A-pose arm/body gap reads the neighbouring
 * cloth rather than zero (which would punch a crater into the shell). Runs once
 * per template, on 96 columns: a few tenths of a millisecond.
 */
function fillOutward(field: Float32Array, cov: Uint8Array, w: number, h: number): void {
  const known = Uint8Array.from(cov)
  for (let pass = 0; pass < FILL_PASSES; pass++) {
    const added: number[] = []
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (known[i]) continue
        let sum = 0
        let n = 0
        if (x > 0 && known[i - 1]) { sum += field[i - 1]; n++ }
        if (x < w - 1 && known[i + 1]) { sum += field[i + 1]; n++ }
        if (y > 0 && known[i - w]) { sum += field[i - w]; n++ }
        if (y < h - 1 && known[i + w]) { sum += field[i + w]; n++ }
        if (n === 0) continue
        field[i] = sum / n
        added.push(i)
      }
    }
    if (!added.length) break
    for (const i of added) known[i] = 1
  }
}

function getTemplate(id: TemplateId): Template | null {
  const hit = CACHE.get(id)
  if (hit !== undefined) return hit
  let built: Template | null = null
  try {
    const blob = TEMPLATE_DEPTH[id]
    const fb = b64ToBytes(blob.front)
    const bb = b64ToBytes(blob.back)
    const n = blob.w * blob.h
    if (fb.length === n && bb.length === n) {
      const cov = new Uint8Array(n)
      const front = new Float32Array(n)
      const back = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        if (fb[i] === 0) continue
        cov[i] = 1
        front[i] = (fb[i] - 1) / 254
        back[i] = (bb[i] - 1) / 254
      }
      const profile = profileMask(cov, blob.w, blob.h, blob.w, 0)
      if (profile) {
        fillOutward(front, cov, blob.w, blob.h)
        fillOutward(back, cov, blob.w, blob.h)
        built = { w: blob.w, h: blob.h, cov, front, back, profile }
      }
    }
  } catch {
    built = null
  }
  CACHE.set(id, built)
  return built
}

// ------------------------------------------------------------------- the maps

/** Piecewise-linear map through matched, strictly increasing knots; linear
 *  extrapolation past the ends. `n` is how many knot pairs are live. */
function pwl(x: number, from: Float32Array, to: Float32Array, n: number): number {
  if (n < 2) return to[0]
  if (x <= from[0]) {
    const s = (to[1] - to[0]) / Math.max(1e-6, from[1] - from[0])
    return to[0] + (x - from[0]) * s
  }
  if (x >= from[n - 1]) {
    const s = (to[n - 1] - to[n - 2]) / Math.max(1e-6, from[n - 1] - from[n - 2])
    return to[n - 1] + (x - from[n - 1]) * s
  }
  let i = 0
  while (i < n - 2 && x > from[i + 1]) i++
  const d = from[i + 1] - from[i]
  const t = d > 1e-6 ? (x - from[i]) / d : 0
  return to[i] + (to[i + 1] - to[i]) * t
}

/**
 * Box-blur a strided grid along Y ONLY, in place, over the rectangle
 * [rowLo, rowHi] × [colLo, colHi]. Edge-clamped INSIDE that window, so rows the
 * garment does not occupy (which hold zero) can never bleed into it.
 *
 * Three passes of a box are the standard cheap Gaussian; prefix sums make each
 * pass O(n) and independent of the radius. Deterministic: fixed radius, fixed
 * pass count, pure arithmetic.
 */
function blurY(
  field: Float32Array,
  stride: number,
  rowLo: number,
  rowHi: number,
  colLo: number,
  colHi: number,
  r: number,
): void {
  const n = rowHi - rowLo + 1
  if (r < 1 || n < 3) return
  const col = new Float32Array(n)
  const pre = new Float64Array(n + 1)
  for (let x = colLo; x <= colHi; x++) {
    for (let j = 0; j < n; j++) col[j] = field[(rowLo + j) * stride + x]
    for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
      pre[0] = 0
      for (let j = 0; j < n; j++) pre[j + 1] = pre[j] + col[j]
      for (let j = 0; j < n; j++) {
        const s = j - r < 0 ? 0 : j - r
        const e = j + r + 1 > n ? n : j + r + 1
        col[j] = (pre[e] - pre[s]) / (e - s)
      }
    }
    for (let j = 0; j < n; j++) field[(rowLo + j) * stride + x] = col[j]
  }
}

/** Bilinear sample of a template grid, clamped to its bounds. */
function sampleT(field: Float32Array, w: number, h: number, x: number, y: number): number {
  const fx = x < 0 ? 0 : x > w - 1.001 ? w - 1.001 : x
  const fy = y < 0 ? 0 : y > h - 1.001 ? h - 1.001 : y
  const x0 = fx | 0
  const y0 = fy | 0
  const tx = fx - x0
  const ty = fy - y0
  const r0 = y0 * w + x0
  const r1 = r0 + w
  return (
    (field[r0] * (1 - tx) + field[r0 + 1] * tx) * (1 - ty) +
    (field[r1] * (1 - tx) + field[r1 + 1] * tx) * ty
  )
}

/**
 * Row correspondence by cumulative-area quantile: the row that has half the
 * garment's cloth above it in the photo maps to the row that has half of it
 * above in the template. Monotone by construction (a cumulative sum is), needs
 * no landmark detection, and reads identically on a flat-lay photo and on an
 * A-pose mesh.
 */
function rowMap(photo: MaskProfile, tpl: MaskProfile): Float32Array {
  const map = new Float32Array(photo.h)
  // Invert the template's cumulative curve with a forward walk (both are
  // monotone, so one pass suffices).
  let t = tpl.top
  for (let y = 0; y < photo.h; y++) {
    const yy = y < photo.top ? photo.top : y > photo.bottom ? photo.bottom : y
    const before = yy > 0 ? photo.cum[yy - 1] : 0
    const q = (before + photo.cum[yy]) / 2
    while (t < tpl.bottom && tpl.cum[t] < q) t++
    const cHi = tpl.cum[t]
    const cLo = t > tpl.top ? tpl.cum[t - 1] : 0
    const d = cHi - cLo
    map[y] = d > 1e-9 ? t - 1 + (q - cLo) / d + 0.5 : t + 0.5
    if (map[y] < tpl.top) map[y] = tpl.top
    if (map[y] > tpl.bottom) map[y] = tpl.bottom
  }
  return map
}

/** Stage-A global column knots: torso edges and the widest reach, per side. */
function globalKnots(p: MaskProfile, out: Float32Array): void {
  const half = p.maxW / 2
  const body = p.bodyW / 2
  out[0] = p.cx - half
  out[1] = p.cx - body
  out[2] = p.cx
  out[3] = p.cx + body
  out[4] = p.cx + half
  // Strictly increasing (a tank's widest row IS its torso).
  for (let i = 1; i < 5; i++) if (out[i] <= out[i - 1]) out[i] = out[i - 1] + 1e-3
}

// ------------------------------------------------------------------- the build

/**
 * Warp a template's depth field onto the photo mask and return it on the padded
 * working grid silhouette.ts samples (`field[(y+1) * (W+2) + (x+1)]`).
 *
 * `templates` is a PREFERENCE ORDER, not a set: the classified (or customer-
 * chosen) family's donor is tried first and the other one is a rescue. A donor
 * is an implementation detail of "how deep is this garment", not a claim about
 * what the customer uploaded, so when the preferred one fails its gates a
 * garment-shaped depth from the other mesh still beats a balloon. When the
 * preference fits, which is the normal case, the alternate is never evaluated
 * and costs nothing.
 *
 * `mask` must be the HOLE-FILLED photo mask, the same domain the Poisson solve
 * runs on, and the same topology the template's own coverage has (a rasterised
 * mesh has no collar hole). The texture's alpha cuts the real openings later.
 *
 * Returns null when every donor's gates refuse; the caller then keeps the
 * Poisson inflation.
 */
export function buildTemplateDepth(
  mask: Uint8Array,
  W: number,
  H: number,
  photo: MaskProfile,
  templates: readonly TemplateId[],
): DepthField | null {
  let last: TemplateFit | null = null
  for (const id of templates) {
    const d = fitTemplate(mask, W, H, photo, id)
    if (d) return d
    last = lastFit
  }
  lastFit = last
  return null
}

/** One donor's attempt: grade it onto the photo and gate the result. */
function fitTemplate(
  mask: Uint8Array,
  W: number,
  H: number,
  photo: MaskProfile,
  template: TemplateId,
): DepthField | null {
  lastFit = { template, iou: 0, yScaleMin: 0, yScaleMax: 0, reason: 'no-template' }
  const tpl = getTemplate(template)
  if (!tpl) return null
  const W2 = W + 2
  const T = tpl.profile

  const rows = rowMap(photo, T)
  // Vertical stretch of the row map, measured over 20 equal BANDS rather than
  // per row: at the very top and bottom of a garment the rows carry almost no
  // cloth, so a per-row derivative of an area-quantile map is dominated by the
  // tips and would trip the gate on perfectly good fits.
  let yScaleMin = Infinity
  let yScaleMax = 0
  const pH = photo.bottom - photo.top + 1
  const tH = T.bottom - T.top + 1
  const BANDS = 20
  for (let k = 0; k < BANDS; k++) {
    const y0 = photo.top + Math.floor((k * pH) / BANDS)
    const y1 = photo.top + Math.floor(((k + 1) * pH) / BANDS)
    if (y1 <= y0) continue
    // (template rows spanned) / (photo rows spanned), against a uniform fit.
    const d = (rows[Math.min(photo.bottom, y1)] - rows[y0]) / (y1 - y0)
    const s = d > 1e-6 ? tH / pH / d : Y_SCALE_MAX * 2
    if (s < yScaleMin) yScaleMin = s
    if (s > yScaleMax) yScaleMax = s
  }
  lastFit = { template, iou: 0, yScaleMin, yScaleMax, reason: 'y-scale' }
  if (!Number.isFinite(yScaleMin) || !Number.isFinite(yScaleMax)) return null
  if (yScaleMin < Y_SCALE_MIN || yScaleMax > Y_SCALE_MAX) return null

  // ---- Stage A: global grading, and the honest confidence it supports.
  const gp = new Float32Array(5)
  const gt = new Float32Array(5)
  globalKnots(photo, gp)
  globalKnots(T, gt)
  let inter = 0
  let union = 0
  for (let y = photo.top; y <= photo.bottom; y++) {
    const ty = rows[y]
    const base = (y + 1) * W2 + 1
    for (let x = 0; x < W; x++) {
      const tx = pwl(x + 0.5, gp, gt, 5)
      const hit =
        tx >= 0 && tx < tpl.w && ty >= 0 && ty < tpl.h && tpl.cov[(ty | 0) * tpl.w + (tx | 0)] === 1
      const real = mask[base + x] === 1
      if (hit && real) inter++
      if (hit || real) union++
    }
  }
  const iou = union > 0 ? inter / union : 0
  lastFit = { template, iou, yScaleMin, yScaleMax, reason: 'iou' }
  if (iou < IOU_MIN) return null

  // ---- Stage B: per-row structural snap, and the sampling it drives.
  const front = new Float32Array(W2 * (H + 2))
  const back = new Float32Array(W2 * (H + 2))
  const kp = new Float32Array(7)
  const kt = new Float32Array(7)
  const at = (a: Float32Array, y: number): number => {
    const y0 = y | 0
    const f = y - y0
    const y1 = Math.min(T.bottom, y0 + 1)
    return a[y0] * (1 - f) + a[y1] * f
  }
  const sp = new Float32Array(7)
  const st = new Float32Array(7)
  for (let y = photo.top; y <= photo.bottom; y++) {
    const ty = Math.max(T.top, Math.min(T.bottom, rows[y]))
    // Photo and template spans, in the same L / body / R schema.
    sp[0] = photo.l0[y]
    sp[1] = photo.l1[y]
    sp[2] = photo.b0[y]
    sp[4] = photo.b1[y]
    sp[3] = (sp[2] + sp[4]) / 2
    sp[5] = photo.r0[y]
    sp[6] = photo.r1[y]
    st[0] = at(T.l0, ty)
    st[1] = at(T.l1, ty)
    st[2] = at(T.b0, ty)
    st[4] = at(T.b1, ty)
    st[3] = (st[2] + st[4]) / 2
    st[5] = at(T.r0, ty)
    st[6] = at(T.r1, ty)
    // Drop degenerate knots (a single-run row collapses L and R onto the body)
    // and force the photo side strictly increasing so the map stays invertible.
    //
    // WHICH TEMPLATE X A COLLAPSED KNOT KEEPS IS NOT A FREE CHOICE. A
    // ghost-mannequin photo has its sleeves merged into its body, so
    // `profileMask` reports l0 = l1 = b0 and b1 = r0 = r1: one column wearing
    // three names. The donor can still have three runs at the matched row (the
    // hoodie mesh's arms are clear of its torso for eighteen of its sixty
    // rows), so the collapse has to pick a template column, and Stage B's
    // contract is that the OUTLINE maps to the outline. Keeping whichever knot
    // came first in index order, which is what a plain dedup does, keeps st[0]
    // on the left (the donor's sleeve tip, right) and st[4] on the right (the
    // donor's TORSO edge, wrong): the photo's right half is then squeezed onto
    // the middle of the donor while its left half is not. On the hoodie mesh at
    // row 48 that is x ≤ 63 of 96, a third of the garment's width of pure
    // asymmetry, which shades as a dark band down one side only. So a collapsed
    // group keeps its OUTERMOST template knot, on both sides.
    let n = 0
    for (let i = 0; i < 7; i++) {
      if (n > 0 && sp[i] <= kp[n - 1] + 1e-4) {
        if (i > 3) kt[n - 1] = st[i] // right-hand group: the outer knot wins
        continue
      }
      kp[n] = sp[i]
      kt[n] = st[i]
      n++
    }
    if (n < 2) continue
    const base = (y + 1) * W2 + 1
    for (let x = 0; x < W; x++) {
      const tx = pwl(x + 0.5, kp, kt, n)
      const fv = sampleT(tpl.front, tpl.w, tpl.h, tx, ty)
      const bv = sampleT(tpl.back, tpl.w, tpl.h, tx, ty)
      front[base + x] = fv
      back[base + x] = bv
    }
  }

  // Filter the warped field in Y (see SMOOTH_Y_FRAC) before anything reads it.
  // The window is exactly the garment's own rows, so the zeros above and below
  // it, which are outside the garment and would pull the hem and the shoulder
  // line down, never enter the average.
  const rBlur = Math.max(1, Math.round(SMOOTH_Y_FRAC * (photo.bottom - photo.top + 1)))
  blurY(front, W2, photo.top + 1, photo.bottom + 1, 1, W, rBlur)
  blurY(back, W2, photo.top + 1, photo.bottom + 1, 1, W, rBlur)

  // Peak depth AFTER filtering, not before: the normalisation spends the whole
  // depth budget on the deepest point of the field that is actually used, so a
  // spike the filter removed cannot leave the garment permanently shallow.
  let fMax = 0
  let bMax = 0
  for (let y = photo.top; y <= photo.bottom; y++) {
    const base = (y + 1) * W2 + 1
    for (let x = 0; x < W; x++) {
      if (!mask[base + x]) continue
      if (front[base + x] > fMax) fMax = front[base + x]
      if (back[base + x] > bMax) bMax = back[base + x]
    }
  }
  lastFit = { template, iou, yScaleMin, yScaleMax, reason: 'empty' }
  if (!(fMax > 1e-3) || !(bMax > 1e-3)) return null

  // Normalise so the deepest point of the garment spends the whole depth budget
  // (buildInflatedShell multiplies these by `bulge` / `bulgeBack`).
  const fs = 1 / fMax
  const bs = 1 / bMax
  for (let i = 0; i < front.length; i++) {
    const f = front[i] * fs
    const b = back[i] * bs
    if (!Number.isFinite(f) || !Number.isFinite(b)) {
      lastFit = { template, iou, yScaleMin, yScaleMax, reason: 'non-finite' }
      return null
    }
    front[i] = f > 1 ? 1 : f
    back[i] = b > 1 ? 1 : b
  }

  lastFit = { template, iou, yScaleMin, yScaleMax, reason: 'ok' }
  return { front, back, iou, template, yScaleMin, yScaleMax }
}
