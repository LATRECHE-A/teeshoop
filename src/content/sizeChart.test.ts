/**
 * The size chart is the one dimensional source of truth: 2D placement, the 3D
 * body, the AR figure and the DTF piece sizes all derive from it. A transposed
 * digit in a hand-entered manufacturer table is silent on screen and arrives at
 * a heat press.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SIZE,
  garmentWidthInFor,
  isSizeId,
  SIZE_CHARTS,
  SIZE_IDS,
  sizeScale,
  sizeSpecCm,
} from './sizeChart'

const GARMENTS = Object.keys(SIZE_CHARTS) as (keyof typeof SIZE_CHARTS)[]

describe('coverage', () => {
  it('every garment has a finite, positive spec for every size', () => {
    for (const g of GARMENTS)
      for (const s of SIZE_IDS) {
        const spec = sizeSpecCm(g, s)
        for (const key of ['halfChestCm', 'bodyLengthCm', 'sleeveLengthCm'] as const) {
          expect(Number.isFinite(spec[key]), `${g}/${s}.${key}`).toBe(true)
          expect(spec[key], `${g}/${s}.${key}`).toBeGreaterThan(0)
        }
      }
  })

  it('the default size is a real size', () => {
    expect(isSizeId(DEFAULT_SIZE)).toBe(true)
    expect(SIZE_IDS).toContain(DEFAULT_SIZE)
  })

  it('isSizeId is a real guard, not a cast', () => {
    for (const s of SIZE_IDS) expect(isSizeId(s)).toBe(true)
    for (const bad of ['XXL', 'm', '', '4XL', null, undefined, 0, {}])
      expect(isSizeId(bad)).toBe(false)
  })
})

describe('ordering', () => {
  it('chest and body length increase strictly with size', () => {
    for (const g of GARMENTS)
      for (let i = 1; i < SIZE_IDS.length; i++) {
        const prev = sizeSpecCm(g, SIZE_IDS[i - 1])
        const cur = sizeSpecCm(g, SIZE_IDS[i])
        expect(cur.halfChestCm, `${g} ${SIZE_IDS[i]} chest`).toBeGreaterThan(prev.halfChestCm)
        expect(cur.bodyLengthCm, `${g} ${SIZE_IDS[i]} length`).toBeGreaterThan(prev.bodyLengthCm)
      }
  })

  it('sleeve length never decreases (real charts repeat it between sizes)', () => {
    for (const g of GARMENTS)
      for (let i = 1; i < SIZE_IDS.length; i++)
        expect(
          sizeSpecCm(g, SIZE_IDS[i]).sleeveLengthCm,
          `${g} ${SIZE_IDS[i]} sleeve`,
        ).toBeGreaterThanOrEqual(sizeSpecCm(g, SIZE_IDS[i - 1]).sleeveLengthCm)
  })
})

describe('derivations', () => {
  it('the nominal size is exactly unscaled — the art is authored there', () => {
    for (const g of GARMENTS) {
      const scale = sizeScale(g, SIZE_CHARTS[g].nominal)
      expect(scale.sx).toBe(1)
      expect(scale.sy).toBe(1)
      expect(scale.sleeve).toBe(1)
    }
  })

  it('inches come from cm by the one conversion, never a second table', () => {
    for (const g of GARMENTS)
      for (const s of SIZE_IDS)
        expect(garmentWidthInFor(g, s) * 2.54).toBeCloseTo(sizeSpecCm(g, s).halfChestCm, 12)
  })
})
