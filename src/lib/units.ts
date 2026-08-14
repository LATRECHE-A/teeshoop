/**
 * Units, and the one place a dimension becomes a string a person reads.
 *
 * THE ENGINE IS INCHES AND THE CUSTOMER IS CENTIMETRES. Layer geometry, print
 * areas and font sizes are stored in inches because that is what the renderer,
 * the DTF pieces and the AR export all agree on. Nothing above this line ever
 * shows one: a French buyer measures their logo with a tape measure in
 * centimetres, and CLAUDE.md is explicit that cm is the customer-facing unit,
 * never inches, anywhere a customer can see, including print sizes and print
 * areas.
 *
 * The studio used to print both, as `30.5 cm (12.0″)`, in seven places
 * including the print-area label on the canvas itself. Two units side by side
 * is how a 12 becomes a 12: the second number is not a reassurance, it is a
 * second chance to read the wrong one. There is no inch formatter here any
 * more, so there is nothing to reach for.
 *
 * The decimal separator follows the interface language rather than being fixed.
 * `toFixed` writes a point, so French read "30.5 cm" while every price beside
 * it read "14,50 €", and mixed separators on one screen read as machine output.
 */
import { getLang } from '@/i18n/lang'
import type { RectIn, RectPx } from './types'

export const EDITOR_VIEW = 800

export const inToPx = (v: number, ppi: number) => v * ppi
export const pxToIn = (v: number, ppi: number) => v / ppi

export const CM_PER_IN = 2.54
export const inToCm = (v: number) => v * CM_PER_IN
export const cmToIn = (v: number) => v / CM_PER_IN

export const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v))

/**
 * One decimal, with the separator the reading language uses.
 *
 * `Intl` rather than `toFixed`, because `toFixed` always writes a point: the
 * canvas said "30.5 cm" beside a panel saying "14,50 €". `getLang()` is the
 * decoupled accessor, so this stays callable from offscreen renderers and store
 * actions, not only from React.
 */
const numberFormats = new Map<string, Intl.NumberFormat>()

export const fmtNum = (v: number, decimals = 1) => {
  // Cached per language and precision: `Intl.NumberFormat` is not cheap to
  // construct, and this runs on every tick of a slider drag (the font-size and
  // stroke-width controls format their label as the customer drags).
  const key = `${getLang()}:${decimals}`
  let fmt = numberFormats.get(key)
  if (!fmt) {
    fmt = new Intl.NumberFormat(getLang(), {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
    numberFormats.set(key, fmt)
  }
  return fmt.format(v)
}

/** Centimetre value → `31,1 cm` in French, `31.1 cm` in English. */
export const fmtCm = (v: number) => `${fmtNum(v)}\u00A0cm`

/** Inches → `31,1 cm`. The conversion happens here so no caller does it twice. */
export const fmtInAsCm = (vIn: number) => fmtCm(inToCm(vIn))

/** Inches → `30,5 × 40,6 cm`. */
export const fmtSizeCm = (wIn: number, hIn: number) =>
  `${fmtNum(inToCm(wIn))} × ${fmtCm(inToCm(hIn))}`

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
