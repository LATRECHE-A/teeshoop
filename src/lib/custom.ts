/**
 * Custom-garment helpers: map the customer's garment photo to real-world
 * inches via its (alpha-aware) bounding box.
 */
import type { CustomSideSetup } from '@/lib/types'
import { ensureAssetImage, getCachedAssetImage } from '@/state/assets'

export interface CustomSideInfo {
  img: HTMLImageElement
  /** Garment bounding box in source-image pixels. */
  bbox: { x: number; y: number; w: number; h: number }
  /** Source-image pixels per real inch (bbox.w / widthIn). */
  pxPerInch: number
}

const bboxCache = new Map<string, { x: number; y: number; w: number; h: number }>()

function scanAlphaBBox(img: HTMLImageElement): {
  x: number
  y: number
  w: number
  h: number
} {
  const SCAN = 256
  const scale = Math.min(1, SCAN / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data
  let minX = w,
    minY = h,
    maxX = -1,
    maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 16) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight }
  const inv = 1 / scale
  return {
    x: Math.floor(minX * inv),
    y: Math.floor(minY * inv),
    w: Math.ceil((maxX - minX + 1) * inv),
    h: Math.ceil((maxY - minY + 1) * inv),
  }
}

export async function getCustomSideInfo(
  setup: CustomSideSetup,
  widthIn: number,
): Promise<CustomSideInfo> {
  const variant = setup.useCutout ? 'cutout' : 'original'
  const img = await ensureAssetImage(setup.assetId, variant)
  const key = `${setup.assetId}:${variant}`
  let bbox = bboxCache.get(key)
  if (!bbox) {
    bbox = setup.useCutout
      ? scanAlphaBBox(img)
      : { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight }
    bboxCache.set(key, bbox)
  }
  return { img, bbox, pxPerInch: bbox.w / widthIn }
}

export function getCachedCustomImage(
  setup: CustomSideSetup,
): HTMLImageElement | null {
  return getCachedAssetImage(setup.assetId, setup.useCutout ? 'cutout' : 'original')
}

export function invalidateCustomBBox(assetId: string) {
  bboxCache.delete(`${assetId}:original`)
  bboxCache.delete(`${assetId}:cutout`)
}

/** Default print area for a garment of the given size: centered 12×16 (clamped). */
export function defaultCustomPrintArea(widthIn: number, heightIn: number) {
  const wIn = Math.min(12, widthIn * 0.62)
  const hIn = Math.min(16, heightIn * 0.55)
  return {
    xIn: (widthIn - wIn) / 2,
    yIn: heightIn * 0.24,
    wIn,
    hIn,
  }
}
