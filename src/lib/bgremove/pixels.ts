/**
 * Pure raster math for background removal: no DOM, no canvas, no ort.
 * Runs identically inside the Web Worker and in the main-thread fallback.
 */

/** U²-Net fixed input size (px). */
export const MODEL_SIZE = 320

/** ImageNet normalization used when U²-Net was trained. */
const MEAN = [0.485, 0.456, 0.406] as const
const STD = [0.229, 0.224, 0.225] as const

/** Where the letterboxed content sits inside the MODEL_SIZE square. */
export interface LetterboxLayout {
  /** Content top-left inside the square, px. */
  dx: number
  dy: number
  /** Content size inside the square, px (aspect preserved, never stretched). */
  contentW: number
  contentH: number
}

/** Fit `w × h` inside `maxEdge` preserving aspect (no-op when already small). */
export function fitWithin(w: number, h: number, maxEdge: number): [number, number] {
  const edge = Math.max(w, h)
  if (edge <= maxEdge) return [w, h]
  const s = maxEdge / edge
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))]
}

/** Aspect-preserving pad-to-square layout for the model input. */
export function computeLetterbox(srcW: number, srcH: number): LetterboxLayout {
  const s = MODEL_SIZE / Math.max(srcW, srcH)
  const contentW = Math.max(1, Math.round(srcW * s))
  const contentH = Math.max(1, Math.round(srcH * s))
  return {
    dx: Math.floor((MODEL_SIZE - contentW) / 2),
    dy: Math.floor((MODEL_SIZE - contentH) / 2),
    contentW,
    contentH,
  }
}

/** RGBA pixels of the MODEL_SIZE square → normalized float32 CHW tensor data. */
export function toModelTensor(rgba: Uint8ClampedArray): Float32Array {
  const n = MODEL_SIZE * MODEL_SIZE
  const out = new Float32Array(3 * n)
  for (let i = 0; i < n; i++) {
    const j = i * 4
    out[i] = (rgba[j] / 255 - MEAN[0]) / STD[0]
    out[n + i] = (rgba[j + 1] / 255 - MEAN[1]) / STD[1]
    out[2 * n + i] = (rgba[j + 2] / 255 - MEAN[2]) / STD[2]
  }
  return out
}

/**
 * Per-image min–max normalization of the raw d0 mask, in place → 0..1.
 * Statistics are computed over the letterbox content region only, so the
 * padding cannot skew them. U²-Net outputs benefit measurably from this.
 */
export function minMaxNormalize(mask: Float32Array, box: LetterboxLayout): void {
  let lo = Infinity
  let hi = -Infinity
  for (let y = box.dy; y < box.dy + box.contentH; y++) {
    const row = y * MODEL_SIZE
    for (let x = box.dx; x < box.dx + box.contentW; x++) {
      const v = mask[row + x]
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  const range = hi - lo
  if (!(range > 1e-6)) {
    mask.fill(hi >= 0.5 ? 1 : 0)
    return
  }
  for (let i = 0; i < mask.length; i++) mask[i] = (mask[i] - lo) / range
}

/**
 * Map the 320×320 mask back through the letterbox onto source pixels
 * (bilinear), then smoothstep it, for rows y0..y1 (exclusive) of the source.
 * Sample coordinates are clamped to the content region so padding never
 * bleeds into edge pixels.
 */
export function upsampleMaskRows(
  mask: Float32Array,
  box: LetterboxLayout,
  srcW: number,
  srcH: number,
  out: Float32Array,
  y0: number,
  y1: number,
  lo = 0.05,
  hi = 0.95,
): void {
  const sx = box.contentW / srcW
  const sy = box.contentH / srcH
  const minX = box.dx
  const maxX = box.dx + box.contentW - 1
  const minY = box.dy
  const maxY = box.dy + box.contentH - 1
  const span = hi - lo
  for (let y = y0; y < y1; y++) {
    const my = box.dy + (y + 0.5) * sy - 0.5
    const iy = Math.floor(my)
    const fy = my - iy
    const cy0 = iy < minY ? minY : iy > maxY ? maxY : iy
    const cy1 = iy + 1 < minY ? minY : iy + 1 > maxY ? maxY : iy + 1
    const r0 = cy0 * MODEL_SIZE
    const r1 = cy1 * MODEL_SIZE
    const rowOut = y * srcW
    for (let x = 0; x < srcW; x++) {
      const mx = box.dx + (x + 0.5) * sx - 0.5
      const ix = Math.floor(mx)
      const fx = mx - ix
      const cx0 = ix < minX ? minX : ix > maxX ? maxX : ix
      const cx1 = ix + 1 < minX ? minX : ix + 1 > maxX ? maxX : ix + 1
      const a = mask[r0 + cx0]
      const b = mask[r0 + cx1]
      const c = mask[r1 + cx0]
      const d = mask[r1 + cx1]
      const top = a + (b - a) * fx
      const bot = c + (d - c) * fx
      let v = top + (bot - top) * fy
      v = (v - lo) / span
      v = v < 0 ? 0 : v > 1 ? 1 : v
      out[rowOut + x] = v * v * (3 - 2 * v) // smoothstep
    }
  }
}

/** Horizontal pass of a 1-2-1 binomial blur (~1px feather), rows y0..y1. */
export function blurRowsH(
  src: Float32Array,
  dst: Float32Array,
  w: number,
  y0: number,
  y1: number,
): void {
  for (let y = y0; y < y1; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      const l = src[row + (x > 0 ? x - 1 : 0)]
      const c = src[row + x]
      const r = src[row + (x < w - 1 ? x + 1 : w - 1)]
      dst[row + x] = (l + c + c + r) * 0.25
    }
  }
}

/** Vertical pass of the 1-2-1 binomial blur, rows y0..y1. */
export function blurRowsV(
  src: Float32Array,
  dst: Float32Array,
  w: number,
  h: number,
  y0: number,
  y1: number,
): void {
  for (let y = y0; y < y1; y++) {
    const up = (y > 0 ? y - 1 : 0) * w
    const row = y * w
    const dn = (y < h - 1 ? y + 1 : h - 1) * w
    for (let x = 0; x < w; x++) {
      dst[row + x] = (src[up + x] + src[row + x] + src[row + x] + src[dn + x]) * 0.25
    }
  }
}

/** Multiply the mask into the alpha channel of RGBA pixels, rows y0..y1. */
export function applyAlphaRows(
  rgba: Uint8ClampedArray,
  alpha: Float32Array,
  w: number,
  y0: number,
  y1: number,
): void {
  let i = y0 * w
  let j = i * 4 + 3
  const end = y1 * w
  for (; i < end; i++, j += 4) {
    rgba[j] = Math.round(rgba[j] * alpha[i])
  }
}

/**
 * Tight bounding box of pixels with alpha > `threshold` (default 10).
 * Returns null when the image has no transparency at all (fully opaque) or
 * when no pixel clears the threshold.
 */
export function computeAlphaBBox(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  threshold = 10,
): { x: number; y: number; w: number; h: number } | null {
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  let hasTransparency = false
  let j = 3
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++, j += 4) {
      const a = rgba[j]
      if (a < 255) hasTransparency = true
      if (a > threshold) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (!hasTransparency || maxX < 0) return null
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}
