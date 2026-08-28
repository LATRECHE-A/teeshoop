/**
 * Print grading: the promise that a design reads the same on every size.
 *
 * This is a thing the business actually sells and a customer can measure with
 * a ruler, so the invariants here are worth more than their line count.
 */
import { describe, expect, it } from 'vitest'
import {
  chestChartFrom,
  gradableSizes,
  isGraded,
  printScaleK,
  scaleAreaIn,
  scaleLayer,
  scaleLayers,
} from './printScale'
import { SIZE_CHARTS, SIZE_IDS } from '@/content/sizeChart'
import type { Design, ImageLayer, TextLayer } from './types'

const baseDesign = (over: Partial<Design> = {}): Design =>
  ({
    id: 'd',
    name: 'test',
    garmentId: 'tee',
    colorId: 'white',
    custom: null,
    layers: [],
    stashedLayers: [],
    printScale: { mode: 'scaled', baseSize: 'M' },
    updatedAt: 0,
    ...over,
  }) as Design

const imageLayer = (): ImageLayer => ({
  id: 'l1',
  type: 'image',
  side: 'front',
  name: 'logo',
  assetId: 'a1',
  xIn: 1.5,
  yIn: -2,
  wIn: 6,
  hIn: 4,
  flipX: false,
  useCutout: false,
  rotation: 0,
  opacity: 1,
})

const textLayer = (): TextLayer => ({
  id: 'l2',
  type: 'text',
  side: 'front',
  name: 'slogan',
  text: 'TEESHOOP',
  fontFamily: 'Anton',
  fontSizeIn: 1.2,
  fill: '#111111',
  stroke: null,
  strokeWidthIn: 0.05,
  letterSpacingEm: 0,
  curve: 0,
  align: 'center',
  xIn: 0.5,
  yIn: -1,
  rotation: 0,
  opacity: 1,
})

describe('printScaleK', () => {
  it('is exactly 1 at the base size, and 1 in fixed mode on every size', () => {
    const d = baseDesign()
    expect(printScaleK(d, 'M')).toBe(1)

    const fixed = baseDesign({ printScale: { mode: 'fixed', baseSize: 'M' } })
    for (const s of SIZE_IDS) expect(printScaleK(fixed, s)).toBe(1)
  })

  it('is the half-chest ratio, taken straight from the chart', () => {
    const d = baseDesign()
    const chart = SIZE_CHARTS.tee.sizes
    for (const s of SIZE_IDS)
      expect(printScaleK(d, s)).toBeCloseTo(chart[s].halfChestCm / chart.M.halfChestCm, 12)
  })

  it('NEVER guesses a ratio it cannot derive', () => {
    // A ship-your-own garment with no chart at all.
    const noChart = baseDesign({ garmentId: 'custom', custom: {} as never })
    for (const s of SIZE_IDS) expect(printScaleK(noChart, s)).toBe(1)
    expect(isGraded(noChart)).toBe(false)

    // Only the base size known, still nothing to interpolate from.
    const oneSize = baseDesign({
      garmentId: 'custom',
      custom: { halfChestCmBySize: { M: 52 } } as never,
    })
    for (const s of SIZE_IDS) expect(printScaleK(oneSize, s)).toBe(1)
    expect(gradableSizes(oneSize)).toEqual(['M'])
  })
})

describe('grading geometry', () => {
  it('THE CORE INVARIANT: artwork occupies the same fraction of the print area on every size', () => {
    const d = baseDesign()
    const layer = imageLayer()
    const area = { wIn: 12, hIn: 16 }

    const base = {
      w: layer.wIn / area.wIn,
      h: layer.hIn / area.hIn,
      x: layer.xIn / area.wIn,
      y: layer.yIn / area.hIn,
    }

    for (const size of SIZE_IDS) {
      const k = printScaleK(d, size)
      const l = scaleLayer(layer, k)
      const a = scaleAreaIn(area, k)
      expect(l.wIn / a.wIn).toBeCloseTo(base.w, 12)
      expect(l.hIn / a.hIn).toBeCloseTo(base.h, 12)
      expect(l.xIn / a.wIn).toBeCloseTo(base.x, 12)
      expect(l.yIn / a.hIn).toBeCloseTo(base.y, 12)
    }
  })

  it('k === 1 returns the SAME REFERENCE: render memoisation depends on it', () => {
    const layer = imageLayer()
    const layers = [layer, textLayer()]
    expect(scaleLayer(layer, 1)).toBe(layer)
    expect(scaleLayers(layers, 1)).toBe(layers)
  })

  it('grading composes multiplicatively, for text (which also scales type) and images', () => {
    const a = 1.1
    const b = 1.3
    for (const l of [imageLayer(), textLayer()]) {
      const twice = scaleLayer(scaleLayer(l, a), b)
      const once = scaleLayer(l, a * b)
      for (const key of Object.keys(once) as (keyof typeof once)[]) {
        const v = once[key]
        if (typeof v === 'number') expect(twice[key] as number).toBeCloseTo(v, 10)
        else expect(twice[key]).toEqual(v)
      }
    }
  })

  it('a text layer grades its font size and stroke, not just its box', () => {
    const t = textLayer()
    const scaled = scaleLayer(t, 2)
    expect(scaled.fontSizeIn).toBeCloseTo(t.fontSizeIn * 2, 12)
    expect(scaled.strokeWidthIn).toBeCloseTo(t.strokeWidthIn * 2, 12)
    // Non-geometric properties must survive untouched.
    expect(scaled.text).toBe(t.text)
    expect(scaled.rotation).toBe(t.rotation)
    expect(scaled.opacity).toBe(t.opacity)
  })
})

describe('chestChartFrom', () => {
  it('drops non-positive measurements rather than storing a broken chart', () => {
    expect(chestChartFrom({ S: { halfChestCm: 0 }, M: { halfChestCm: 52 } } as never)).toEqual({
      M: 52,
    })
  })
})
