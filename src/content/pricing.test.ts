/**
 * Pricing. Every case here is a BOUNDARY case, because that is where money
 * bugs live: an off-by-one at a quantity break or an area tier is a real
 * margin error on a real invoice, and nothing on screen would look wrong.
 *
 * NOTE FOR R2: these lock in the CURRENT behaviour of a placeholder engine —
 * the numbers are demo values in USD with no VAT concept. When the real
 * cost/margin/floor engine lands (in PHP, server-side), this file documents
 * exactly which boundary semantics have to be reproduced.
 */
import { describe, expect, it } from 'vitest'
import { areaTier, PRICING, QTY_BREAKS, quote } from './pricing'

describe('quantity breaks', () => {
  it('applies at the threshold, not one unit late', () => {
    const table: [number, number][] = [
      [1, 0],
      [9, 0],
      [10, 0.15],
      [11, 0.15],
      [24, 0.15],
      [25, 0.25],
      [26, 0.25],
      [49, 0.25],
      [50, 0.35],
      [51, 0.35],
    ]
    for (const [qty, discount] of table) expect(quote('tee', 1, qty).discount).toBe(discount)
  })

  it('the ladder is sorted and strictly increasing (the lookup assumes it)', () => {
    for (let i = 1; i < QTY_BREAKS.length; i++) {
      expect(QTY_BREAKS[i].minQty).toBeGreaterThan(QTY_BREAKS[i - 1].minQty)
      expect(QTY_BREAKS[i].discount).toBeGreaterThan(QTY_BREAKS[i - 1].discount)
    }
  })

  it('floors the quantity before looking up the break', () => {
    expect(quote('tee', 1, 0).discount).toBe(0)
    expect(quote('tee', 1, -5).discount).toBe(0)
    expect(quote('tee', 1, 0.4).discount).toBe(0)
    expect(quote('tee', 1, 10.9).discount).toBe(0.15)
    // qty < 1 still prices one unit rather than zero.
    expect(quote('tee', 1, 0).totalUsd).toBe(quote('tee', 1, 1).totalUsd)
  })
})

describe('area tiers', () => {
  it('A4 and under is the standard price — at the boundary exactly', () => {
    expect(areaTier('tee', 96.99)?.addUsd).toBe(0)
    expect(areaTier('tee', 97)?.addUsd).toBe(0)
    expect(areaTier('tee', 97.01)?.addUsd).toBe(4)
    expect(areaTier('tee', 193)?.addUsd).toBe(4)
    expect(areaTier('tee', 193.01)?.addUsd).toBe(9)
  })

  it('the tier ladder is sorted ascending (find() takes the first match)', () => {
    const tiers = PRICING.tee.areaTiers!
    for (let i = 1; i < tiers.length; i++)
      expect(tiers[i].maxSqIn).toBeGreaterThan(tiers[i - 1].maxSqIn)
  })
})

describe('quote()', () => {
  it('the areas array decides the side count, overriding `sides`', () => {
    // two areas → two sides, whatever `sides` says
    expect(quote('tee', 1, 1, [50, 50]).unitUsd).toBe(14.5 + 6)
    // zero areas are filtered out → one side, despite sides = 3
    expect(quote('tee', 3, 1, [50, 0, 0]).unitUsd).toBe(14.5)
  })

  it('the flat path (no areas) is unchanged', () => {
    expect(quote('tee', 2, 1).unitUsd).toBe(20.5)
    expect(quote('hoodie', 1, 1).unitUsd).toBe(32)
    expect(quote('custom', 1, 1).unitUsd).toBe(12)
  })

  it('rounds to whole cents at BOTH the unit and the total', () => {
    // 14.5 * 0.85 = 12.325 → 12.33
    const q = quote('tee', 1, 10)
    expect(q.unitUsd).toBe(12.33)
    expect(q.totalUsd).toBe(123.3)

    for (const g of ['tee', 'hoodie', 'custom'] as const)
      for (const qty of [1, 7, 10, 25, 33, 50, 99]) {
        const r = quote(g, 2, qty)
        expect(Number.isInteger(Math.round(r.unitUsd * 100))).toBe(true)
        expect(Math.abs(r.unitUsd * 100 - Math.round(r.unitUsd * 100))).toBeLessThan(1e-9)
        expect(Math.abs(r.totalUsd * 100 - Math.round(r.totalUsd * 100))).toBeLessThan(1e-9)
      }
  })

  it('is monotonic: more sides never costs less, more quantity never costs less in total', () => {
    for (const g of ['tee', 'hoodie', 'custom'] as const) {
      expect(quote(g, 2, 1).unitUsd).toBeGreaterThan(quote(g, 1, 1).unitUsd)
      let prev = 0
      for (const qty of [1, 5, 10, 25, 50, 100]) {
        const total = quote(g, 1, qty).totalUsd
        expect(total).toBeGreaterThanOrEqual(prev)
        prev = total
      }
    }
  })
})
