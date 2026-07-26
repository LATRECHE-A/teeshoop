import type { RectIn, RectPx } from './types'

export const EDITOR_VIEW = 800

export const inToPx = (v: number, ppi: number) => v * ppi
export const pxToIn = (v: number, ppi: number) => v / ppi

export const CM_PER_IN = 2.54
export const inToCm = (v: number) => v * CM_PER_IN
export const cmToIn = (v: number) => v / CM_PER_IN

export const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v))

/** 12.25 → `12.3″` */
export const fmtIn = (v: number) => `${(Math.round(v * 10) / 10).toFixed(1)}″`

/** Centimetre value → `31.1 cm` (one decimal, like fmtIn). */
export const fmtCm = (v: number) => `${(Math.round(v * 10) / 10).toFixed(1)} cm`

/** Inches → `31.1 cm` (converted display; cm is the customer-facing unit). */
export const fmtInAsCm = (vIn: number) => fmtCm(inToCm(vIn))

/** Inches → dual-unit label `30.5 × 40.6 cm (12.0″ × 16.0″)`. */
export const fmtSizeDual = (wIn: number, hIn: number) =>
  `${(Math.round(inToCm(wIn) * 10) / 10).toFixed(1)} × ${(Math.round(inToCm(hIn) * 10) / 10).toFixed(1)} cm (${fmtIn(wIn)} × ${fmtIn(hIn)})`

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
