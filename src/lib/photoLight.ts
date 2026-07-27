/**
 * Luminance fields and DE-LIGHTING for garment photos.
 *
 * WHY THIS EXISTS
 * ---------------
 * A supplier or customer garment photo was shot in a lightbox: it already
 * carries a full lighting solution baked into its pixels — a bright top-centre,
 * darker flanks, shadowed folds. The 3D preview then lights it AGAIN. The two
 * multiply, so the flanks go twice as dark as they should, and — far worse — the
 * baked highlight does not MOVE when the camera orbits. A highlight that stays
 * put while the surface turns is the single strongest cue the brain has that it
 * is looking at a printed picture rather than an object, and it is a large part
 * of why an uploaded garment reads flat next to the catalog meshes (whose
 * albedo is a flat colour and whose every highlight is real).
 *
 * So before the photo becomes an albedo map we divide out its low-frequency
 * shading and let the scene's lights be the only lights. This is the classical
 * Retinex split — shading is low-frequency, albedo is high-frequency — and it is
 * deliberately PARTIAL (γ < 1, gain clamped): a garment photo's midtone gradient
 * also encodes real form, and removing all of it flattens a black garment into a
 * grey rectangle. What remains is handed to the geometry and the normal map,
 * which already split the same signal by frequency (silhouette.ts: mid band →
 * Z displacement, high-pass → normal map). The blur this needs is the blur those
 * two already compute, so the whole correction costs one extra pass.
 *
 * THE PRINT IS DE-LIT TOO, AND THAT IS CORRECT. The canvas that arrives here is
 * the composite — garment photo with the customer's artwork already drawn on it.
 * The artwork is physically ON that cloth and was, in the mockup, lit by the
 * same lightbox; re-lighting it with the fabric is what keeps a chest logo from
 * floating. The 2D mockup, the poster and every DTF/print output are produced by
 * a different path (renderDesign / dtf) and are NOT touched by any of this — no
 * colour a customer receives on cloth is changed here.
 *
 * DETERMINISM: box blurs and per-pixel arithmetic on the input pixels only.
 */

/** Long working edge for luminance analysis (blurs are O(n), radius-free). */
export const PHOTO = 768

export interface LumField {
  W: number
  H: number
  lum: Float32Array // 0..255
  a: Float32Array // 0..1
  /** Source RGBA at the working resolution — kept so de-lighting can reuse it. */
  rgba: Uint8ClampedArray
}

/**
 * Downscale a canvas to the analysis resolution and split it into luminance +
 * alpha. `mirrorX` pre-mirrors the photo so a derived map stays correct on
 * sheets that sample u mirrored (the back sheet uses 1−u).
 */
export function readLumAlpha(canvas: HTMLCanvasElement, mirrorX: boolean): LumField | null {
  if (!canvas.width || !canvas.height) return null
  const scale = Math.min(1, PHOTO / Math.max(canvas.width, canvas.height))
  const W = Math.max(4, Math.round(canvas.width * scale))
  const H = Math.max(4, Math.round(canvas.height * scale))
  const off = document.createElement('canvas')
  off.width = W
  off.height = H
  const ctx = off.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.imageSmoothingEnabled = true
  if (mirrorX) {
    ctx.translate(W, 0)
    ctx.scale(-1, 1)
  }
  ctx.drawImage(canvas, 0, 0, W, H)
  const data = ctx.getImageData(0, 0, W, H).data
  const lum = new Float32Array(W * H)
  const a = new Float32Array(W * H)
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    lum[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]
    a[i] = data[p + 3] / 255
  }
  return { W, H, lum, a, rgba: data }
}

/** Separable box blur (edge-clamped) via per-line prefix sums; O(n), radius-free. */
export function boxBlur(src: Float32Array, W: number, H: number, r: number): Float32Array {
  const tmp = new Float32Array(W * H)
  const out = new Float32Array(W * H)
  const pre = new Float64Array(Math.max(W, H) + 1)
  for (let y = 0; y < H; y++) {
    const o = y * W
    pre[0] = 0
    for (let x = 0; x < W; x++) pre[x + 1] = pre[x] + src[o + x]
    for (let x = 0; x < W; x++) {
      const s = Math.max(0, x - r)
      const e = Math.min(W, x + r + 1)
      tmp[o + x] = (pre[e] - pre[s]) / (e - s)
    }
  }
  for (let x = 0; x < W; x++) {
    pre[0] = 0
    for (let y = 0; y < H; y++) pre[y + 1] = pre[y] + tmp[y * W + x]
    for (let y = 0; y < H; y++) {
      const s = Math.max(0, y - r)
      const e = Math.min(H, y + r + 1)
      out[y * W + x] = (pre[e] - pre[s]) / (e - s)
    }
  }
  return out
}

/** Alpha-weighted (normalised) box blur — transparent surroundings don't darken
 *  the garment edge the way a plain blur would. */
export function blurNorm(f: LumField, r: number): Float32Array {
  const { W, H, lum, a } = f
  const wl = new Float32Array(W * H)
  for (let i = 0; i < wl.length; i++) wl[i] = lum[i] * a[i]
  const bl = boxBlur(wl, W, H, r)
  const ba = boxBlur(a, W, H, r)
  const out = new Float32Array(W * H)
  for (let i = 0; i < out.length; i++) out[i] = bl[i] / Math.max(ba[i], 1e-4)
  return out
}

// ------------------------------------------------------------------ delighting

/**
 * How much of the baked shading survives. γ = 1 divides it out completely and
 * looks synthetic (real cloth is never uniformly lit, and an unlit photo of a
 * dark garment loses the form the mid-frequency geometry cannot carry); 0.8
 * removes about four fifths of it, which is where the highlight stops sliding
 * with the camera while the garment still reads as cloth.
 */
const GAMMA = 0.8
/**
 * Gain clamps. A lightbox gradient lives inside roughly ±25 %, so [0.72, 1.42]
 * passes every real correction untouched and only bites on pathological input —
 * a photo shot half in shadow, where an unclamped gain would blow the lit half
 * to white while lifting the dark half to grey mud.
 */
const G_MIN = 0.72
const G_MAX = 1.42
/**
 * Folds lose saturation because a shadow adds a neutral; restoring a fraction of
 * the chroma alongside the luminance keeps a de-lit navy from drifting grey.
 * Deliberately small — over-restoring turns fold shadows blue.
 */
const CHROMA_RESTORE = 0.15
/**
 * Below this relative spread of the shading field the photo is already flat
 * (a cutout re-flooded with a solid colour, a synthetic mockup) and the
 * correction would only amplify JPEG noise. Skip it and say so.
 */
const FLAT_SPREAD = 0.02
/**
 * ...and above this the low-frequency field is not lighting at all.
 *
 * The shading estimate is a very wide blur (shadeRadius = 8.5 % of the long
 * edge), which is only a lighting estimate while nothing in the picture is
 * bigger than that. A LARGE DARK CHEST PRINT is bigger than that, so it enters
 * the estimate as if it were a shadow and the correction sets about brightening
 * the customer's own ink and darkening the cloth around it. Measured over the
 * supplier catalogue the real spread runs 0.014 … 0.091; the same garment under
 * a print covering half its chest reads 0.598. 0.25 therefore leaves ×2.7 of
 * headroom above the most strongly lit real photo in the set and still refuses
 * artwork by ×2.4.
 *
 * Refusing means the photo is its own albedo, which is what shipped before any
 * of this existed and is never worse than the photo. That asymmetry is the
 * whole argument: an over-eager correction damages colours a customer chose,
 * and a skipped one only leaves a highlight that does not move.
 */
const CONTENT_SPREAD = 0.25

export interface DelightResult {
  /** The corrected albedo, or null when the photo needed no correction. */
  canvas: HTMLCanvasElement | null
  /** Relative std-dev of the shading field over the garment — how lit the photo was.
   *  Reported even when no correction was applied, so "we skipped it" is a
   *  measurement rather than a silent null: below FLAT_SPREAD the photo is
   *  genuinely flat (a white garment on a white sweep) and dividing its own
   *  noise out of it would only add grain; above CONTENT_SPREAD what the blur
   *  found is artwork, not light. */
  spread: number
  /** Extreme gains actually applied (before clamping is reported as saturation). */
  gMin: number
  gMax: number
}

/**
 * Divide the photo's own low-frequency shading out of a garment composite.
 *
 * `shading` is `blurNorm(f, bigRadius)` — the same field silhouette.ts already
 * builds for its mid-frequency wrinkle band, passed in so it is computed once.
 * The gain is estimated at the analysis resolution (it is low-frequency by
 * construction, so nothing is lost) and applied at the SOURCE resolution, which
 * is what keeps the customer's artwork as crisp as it was.
 *
 * Returns null when the photo cannot be measured at all, and a result with a
 * null `canvas` when it can but needs no correction — callers then keep the
 * original canvas, which is always a valid albedo.
 */
export function delight(
  source: HTMLCanvasElement,
  f: LumField,
  shading: Float32Array,
): DelightResult | null {
  const { W, H, a } = f
  // Alpha-weighted mean of the shading over the garment.
  let sum = 0
  let wsum = 0
  for (let i = 0; i < shading.length; i++) {
    if (a[i] < 0.5) continue
    sum += shading[i]
    wsum++
  }
  if (wsum < 64) return null
  const mean = sum / wsum
  if (!(mean > 1)) return null
  let varSum = 0
  for (let i = 0; i < shading.length; i++) {
    if (a[i] < 0.5) continue
    const d = shading[i] - mean
    varSum += d * d
  }
  const spread = Math.sqrt(varSum / wsum) / mean
  if (spread < FLAT_SPREAD || spread > CONTENT_SPREAD)
    return { canvas: null, spread, gMin: 1, gMax: 1 }

  // Gain field at analysis resolution.
  const gain = new Float32Array(W * H)
  let gMin = Infinity
  let gMax = -Infinity
  for (let i = 0; i < gain.length; i++) {
    const g = Math.pow(mean / Math.max(shading[i], 1), GAMMA)
    const c = g < G_MIN ? G_MIN : g > G_MAX ? G_MAX : g
    gain[i] = c
    if (a[i] >= 0.5) {
      if (c < gMin) gMin = c
      if (c > gMax) gMax = c
    }
  }
  if (!Number.isFinite(gMin)) return null

  const out = document.createElement('canvas')
  out.width = source.width
  out.height = source.height
  const ctx = out.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(source, 0, 0)
  let img: ImageData
  try {
    img = ctx.getImageData(0, 0, out.width, out.height)
  } catch {
    return null
  }
  const px = img.data
  // Nearest lookup into the (very smooth) gain field: at 768 px the field's own
  // features are ~65 px across, so resampling artefacts are far below one LSB.
  const colOf = new Int32Array(out.width)
  for (let x = 0; x < out.width; x++)
    colOf[x] = Math.min(W - 1, Math.floor(((x + 0.5) * W) / out.width))
  for (let y = 0; y < out.height; y++) {
    const gy = Math.min(H - 1, Math.floor(((y + 0.5) * H) / out.height))
    const grow = gy * W
    const prow = y * out.width * 4
    for (let x = 0; x < out.width; x++) {
      const p = prow + x * 4
      if (px[p + 3] === 0) continue
      const g = gain[grow + colOf[x]]
      const r0 = px[p]
      const g0 = px[p + 1]
      const b0 = px[p + 2]
      const l1 = (0.299 * r0 + 0.587 * g0 + 0.114 * b0) * g
      const k = 1 + CHROMA_RESTORE * (g - 1)
      px[p] = l1 + (r0 * g - l1) * k
      px[p + 1] = l1 + (g0 * g - l1) * k
      px[p + 2] = l1 + (b0 * g - l1) * k
    }
  }
  ctx.putImageData(img, 0, 0)
  return { canvas: out, spread, gMin, gMax }
}
