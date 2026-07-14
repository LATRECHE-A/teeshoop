/**
 * Pricing — module A5.
 *
 * Flat per-garment base price + a flat surcharge for every printed side
 * beyond the first, with quantity discounts at the QTY_BREAKS thresholds.
 * `custom` = the customer ships their own garment (decoration only).
 */
import type { GarmentId } from '@/lib/types'

export interface PricingRule {
  baseUsd: number
  perExtraSideUsd: number
}

export const PRICING: Record<'tee' | 'hoodie' | 'custom', PricingRule> = {
  tee: { baseUsd: 14.5, perExtraSideUsd: 6 },
  hoodie: { baseUsd: 32, perExtraSideUsd: 6 },
  custom: { baseUsd: 12, perExtraSideUsd: 6 },
}

/** Quantity discounts; the highest reached threshold wins. */
export const QTY_BREAKS: { minQty: number; discount: number }[] = [
  { minQty: 10, discount: 0.15 },
  { minQty: 25, discount: 0.25 },
  { minQty: 50, discount: 0.35 },
]

export const SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL'] as const

const toCents = (usd: number): number => Math.round(usd * 100) / 100

/**
 * Quote a run. `sides` is the number of printed sides (values < 1 price as a
 * single side); `qty` is clamped to at least 1 whole unit. Both `unitUsd` and
 * `totalUsd` are rounded to cents, with `totalUsd = unitUsd × qty` exactly
 * (line-item math, the way a print shop invoices).
 */
export function quote(
  garment: GarmentId,
  sides: number,
  qty: number,
): { unitUsd: number; totalUsd: number; discount: number } {
  const rule = PRICING[garment]
  const q = Math.max(1, Math.floor(qty) || 1)
  const extraSides = Math.max(0, Math.floor(sides) - 1)
  const discount =
    [...QTY_BREAKS].reverse().find((b) => q >= b.minQty)?.discount ?? 0
  const unitUsd = toCents(
    (rule.baseUsd + extraSides * rule.perExtraSideUsd) * (1 - discount),
  )
  return { unitUsd, totalUsd: toCents(unitUsd * q), discount }
}
