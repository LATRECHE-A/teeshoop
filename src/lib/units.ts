import type { RectIn, RectPx } from './types'

export const EDITOR_VIEW = 800

export const inToPx = (v: number, ppi: number) => v * ppi
export const pxToIn = (v: number, ppi: number) => v / ppi

export const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v))

/** 12.25 → `12.3″` */
export const fmtIn = (v: number) => `${(Math.round(v * 10) / 10).toFixed(1)}″`

export const rectInToPx = (r: RectIn, ppi: number): RectPx => ({
  x: r.xIn * ppi,
  y: r.yIn * ppi,
  w: r.wIn * ppi,
  h: r.hIn * ppi,
})

export const degToRad = (d: number) => (d * Math.PI) / 180

export function fitWithin(
  w: number,
  h: number,
  maxW: number,
  maxH: number,
): { w: number; h: number; scale: number } {
  const scale = Math.min(maxW / w, maxH / h)
  return { w: w * scale, h: h * scale, scale }
}
