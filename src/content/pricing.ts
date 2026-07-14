/**
 * STUB — module A5 replaces this file entirely (see docs/CONTRACTS.md §A5).
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

export const QTY_BREAKS: { minQty: number; discount: number }[] = [
  { minQty: 10, discount: 0.15 },
  { minQty: 25, discount: 0.25 },
  { minQty: 50, discount: 0.35 },
]

export const SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL'] as const

export function quote(
  garment: GarmentId,
  sides: number,
  qty: number,
): { unitUsd: number; totalUsd: number; discount: number } {
  const rule = PRICING[garment]
  const discount =
    [...QTY_BREAKS].reverse().find((b) => qty >= b.minQty)?.discount ?? 0
  const unit =
    (rule.baseUsd + Math.max(0, sides - 1) * rule.perExtraSideUsd) *
    (1 - discount)
  return {
    unitUsd: Math.round(unit * 100) / 100,
    totalUsd: Math.round(unit * qty * 100) / 100,
    discount,
  }
}
