import { describe, expect, it } from 'vitest'
import { DEFAULT_SUPPLIERS, estimateCost, rollTier, thresholdTip } from './suppliers'
import type { SupplierProfile } from './suppliers'

/*
 * COU-15. The displayed roll cost and the threshold advisor read the same price
 * ladder with two rules: the cost took the last row reached, the advisor the
 * cheapest. A ladder that mixes a prepaid package into it is legal to type in
 * the DTF screen, and there the two disagreed.
 */
function prepaid(): SupplierProfile {
  const base = structuredClone(DEFAULT_SUPPLIERS[0])
  base.shippingEur = 0
  base.freeShipAtLm = null
  base.freeShipAtEur = null
  base.minOrderEur = 0
  base.processes = [
    {
      ...base.processes[0],
      minOrderLm: 1,
      priceTiers: [
        { minLm: 1, eurPerLm: 8 },
        { minLm: 5, eurPerLm: 9 },
      ],
    },
  ]
  return base
}

describe('the roll price ladder', () => {
  it('bills the cheapest row the length qualifies for, on the cost and on the advice alike', () => {
    const p = prepaid()
    const cost = estimateCost(p, 6)
    expect(cost.ratePerLm).toBe(8)
    expect(cost.printEur).toBe(48)
    expect(rollTier(p.processes[0].priceTiers, 6).tier.eurPerLm).toBe(8)
  })

  it('still climbs a monotonic ladder row by row', () => {
    const tiers = DEFAULT_SUPPLIERS[0].processes[0].priceTiers
    expect(rollTier(tiers, 4.9).tier.eurPerLm).toBe(8)
    expect(rollTier(tiers, 5).tier.eurPerLm).toBe(7)
    expect(rollTier(tiers, 20).tier.eurPerLm).toBe(6)
    expect(rollTier(tiers, 20).next?.minLm).toBe(50)
  })

  it('keeps the advisor and the cost on one number', () => {
    // DTF Plus: 19,9 lm then 20 lm, where the tier and free carriage meet.
    const p = DEFAULT_SUPPLIERS[0]
    const at20 = estimateCost(p, 20)
    const tip = thresholdTip(p, p.processes[0], 19.9)
    expect(tip?.lm).toBe(20)
    expect(tip?.totalEur).toBe(at20.totalEur)
  })
})
