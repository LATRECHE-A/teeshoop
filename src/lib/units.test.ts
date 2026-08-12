/**
 * The conversions every printed millimetre depends on. A swapped multiply and
 * divide here is invisible on screen and only shows up on a pressed garment.
 */
import { describe, expect, it } from 'vitest'
import { CM_PER_IN, cmToIn, fitWithin, fmtIn, inToCm, inToPx, pxToIn, rectInToPx } from './units'

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

  it('fmtIn rounds to one decimal and always shows it', () => {
    expect(fmtIn(12.25)).toBe('12.3″')
    expect(fmtIn(12)).toBe('12.0″')
    expect(fmtIn(0.04)).toBe('0.0″')
  })
})
