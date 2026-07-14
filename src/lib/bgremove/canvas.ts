/**
 * Canvas-2D utilities that work in both window and worker contexts.
 * OffscreenCanvas is preferred; an HTMLCanvasElement is used on the main
 * thread when OffscreenCanvas is unavailable.
 */

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas
export type Any2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export interface Raster {
  canvas: AnyCanvas
  ctx: Any2D
}

export interface DecodedImage {
  source: ImageBitmap | HTMLImageElement
  width: number
  height: number
  close: () => void
}

let offscreenProbe: boolean | null = null

/** True when OffscreenCanvas with a 2D context AND PNG export is usable. */
export function hasOffscreen2d(): boolean {
  if (offscreenProbe === null) {
    try {
      offscreenProbe =
        typeof OffscreenCanvas !== 'undefined' &&
        typeof OffscreenCanvas.prototype.convertToBlob === 'function' &&
        new OffscreenCanvas(1, 1).getContext('2d') !== null
    } catch {
      offscreenProbe = false
    }
  }
  return offscreenProbe
}

/** True when some 2D raster surface exists in this context. */
export function canRasterize(): boolean {
  if (hasOffscreen2d()) return true
  try {
    if (typeof document === 'undefined') return false
    return document.createElement('canvas').getContext('2d') !== null
  } catch {
    return false
  }
}

/** True when blobs can be decoded into drawable images in this context. */
export function canDecodeImages(): boolean {
  return typeof createImageBitmap === 'function' || typeof Image !== 'undefined'
}

/** Create a canvas + 2D context (read-optimized), whichever kind exists. */
export function createRaster(w: number, h: number): Raster {
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const canvas = new OffscreenCanvas(w, h)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (ctx) return { canvas, ctx }
    } catch {
      /* fall through to DOM canvas */
    }
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (ctx) return { canvas, ctx }
  }
  throw new Error('Canvas 2D is unavailable in this context')
}

/** Decode an image blob. Uses createImageBitmap (worker-safe) when present. */
export async function decodeBlob(blob: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(blob)
    return {
      source: bmp,
      width: bmp.width,
      height: bmp.height,
      close: () => bmp.close(),
    }
  }
  if (typeof Image !== 'undefined') {
    const url = URL.createObjectURL(blob)
    try {
      const img = new Image()
      img.decoding = 'async'
      img.src = url
      await img.decode()
      return {
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        close: () => {
          img.src = ''
        },
      }
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  throw new Error('No image decoder available in this context')
}

/**
 * Draw `src` (srcW × srcH) into a new canvas of dstW × dstH with high-quality
 * smoothing. Large downscales go through progressive halving so the result
 * stays crisp (single-step drawImage aliases badly beyond ~2×).
 */
export function scaleToCanvas(
  src: CanvasImageSource,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Raster {
  let cur = src
  let cw = srcW
  let ch = srcH
  while (cw >= dstW * 2 && ch >= dstH * 2) {
    const nw = Math.max(dstW, Math.round(cw / 2))
    const nh = Math.max(dstH, Math.round(ch / 2))
    const step = createRaster(nw, nh)
    step.ctx.imageSmoothingEnabled = true
    step.ctx.imageSmoothingQuality = 'high'
    step.ctx.drawImage(cur, 0, 0, cw, ch, 0, 0, nw, nh)
    cur = step.canvas
    cw = nw
    ch = nh
  }
  const out = createRaster(dstW, dstH)
  out.ctx.imageSmoothingEnabled = true
  out.ctx.imageSmoothingQuality = 'high'
  out.ctx.drawImage(cur, 0, 0, cw, ch, 0, 0, dstW, dstH)
  return out
}

/** Encode a canvas to a PNG blob in either canvas flavor. */
export function toPngBlob(canvas: AnyCanvas): Promise<Blob> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type: 'image/png' })
  }
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))),
      'image/png',
    )
  })
}
