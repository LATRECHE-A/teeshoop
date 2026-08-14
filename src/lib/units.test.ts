/**
 * The conversions every printed millimetre depends on. A swapped multiply and
 * divide here is invisible on screen and only shows up on a pressed garment.
 */
import { describe, expect, it } from 'vitest'
import {
  CM_PER_IN,
  cmToIn,
  fitWithin,
  fmtCm,
  fmtInAsCm,
  fmtSizeCm,
  inToCm,
  inToPx,
  pxToIn,
  rectInToPx,
} from './units'
import { setCurrentLang } from '@/i18n/lang'

const PPIS = [72, 96, 150, 300, 1200]
const VALUES = [0, 0.05, 1, 12, 16.75]

describe('units', () => {
  it('inch ↔ pixel round-trips at every DPI we render at', () => {
    for (const ppi of PPIS)
      for (const v of VALUES) expect(pxToIn(inToPx(v, ppi), ppi)).toBeCloseTo(v, 12)
  })

  it('inch ↔ cm round-trips, and one inch is exactly 2.54 cm', () => {
    expect(CM_PER_IN).toBe(2.54)
    expect(inToCm(1)).toBe(2.54)
    for (const v of VALUES) expect(cmToIn(inToCm(v))).toBeCloseTo(v, 12)
  })

  it('rectInToPx converts all four fields, not just the size', () => {
    const ppi = 300
    const r = { xIn: -2.5, yIn: 1.25, wIn: 6, hIn: 4 }
    const px = rectInToPx(r, ppi)
    expect(px.x / ppi).toBeCloseTo(r.xIn, 12)
    expect(px.y / ppi).toBeCloseTo(r.yIn, 12)
    expect(px.w / ppi).toBeCloseTo(r.wIn, 12)
    expect(px.h / ppi).toBeCloseTo(r.hIn, 12)
  })

  it('fitWithin preserves aspect ratio and fits tightly against one bound', () => {
    const cases = [
      { w: 100, h: 50, maxW: 40, maxH: 40 }, // width-bound
      { w: 50, h: 100, maxW: 40, maxH: 40 }, // height-bound
      { w: 30, h: 30, maxW: 100, maxH: 100 }, // upscale
      { w: 16, h: 9, maxW: 800, maxH: 200 },
    ]
    for (const c of cases) {
      const out = fitWithin(c.w, c.h, c.maxW, c.maxH)
      expect(out.w).toBeLessThanOrEqual(c.maxW + 1e-9)
      expect(out.h).toBeLessThanOrEqual(c.maxH + 1e-9)
      expect(out.w / out.h).toBeCloseTo(c.w / c.h, 12)
      // Tight, not merely safe: one dimension must touch its bound.
      const touches =
        Math.abs(out.w - c.maxW) < 1e-9 || Math.abs(out.h - c.maxH) < 1e-9
      expect(touches).toBe(true)
    }
  })

  /*
   * THE UNIT A CUSTOMER READS.
   *
   * There is no inch formatter any more. The studio printed `30.5 cm (12.0″)`
   * on the canvas print-area label and in six panels, and CLAUDE.md is explicit
   * that cm is the customer-facing unit, never inches, anywhere a customer can
   * see. Two units on one label is a second chance to read the wrong one.
   */
  it('shows centimetres, never inches', () => {
    setCurrentLang('fr')
    expect(fmtInAsCm(12)).not.toContain('″')
    expect(fmtSizeCm(12, 16)).not.toContain('″')
    expect(fmtSizeCm(12, 16)).toBe('30,5 × 40,6\u00A0cm')
  })

  it('writes the decimal the way the reading language does', () => {
    // toFixed always writes a point, so French read "30.5 cm" beside a price
    // reading "14,50 €". Mixed separators on one screen read as machine output.
    setCurrentLang('fr')
    expect(fmtCm(30.48)).toBe('30,5\u00A0cm')
    setCurrentLang('en')
    expect(fmtCm(30.48)).toBe('30.5\u00A0cm')
    setCurrentLang('fr')
  })

  it('keeps the unit on the same line as the number', () => {
    // A non-breaking space, spelled out rather than typed, because the two are
    // indistinguishable in a diff: an expectation written with a plain space
    // failed against a value that looked identical in the failure report.
    expect(fmtCm(31.14)).toContain('\u00A0')
    expect(fmtCm(31.14)).not.toContain(' cm')
  })

  it('rounds to one decimal and always shows it', () => {
    setCurrentLang('fr')
    expect(fmtCm(31.14)).toBe('31,1\u00A0cm')
    expect(fmtCm(31)).toBe('31,0\u00A0cm')
    expect(fmtCm(0.04)).toBe('0,0\u00A0cm')
  })
})
