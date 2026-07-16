/**
 * Pricing — module A5.
 *
 * Per-garment base price + a flat surcharge for every printed side beyond the
 * first, with quantity discounts at the QTY_BREAKS thresholds. `custom` = the
 * customer ships their own garment (decoration only).
 *
 * AREA-AWARE TIERS (opt-in per garment via `areaTiers`): a print up to A4 is the
 * affordable standard (+$0); larger prints (up to A3, then oversize) cost more.
 * Tiers only affect the quote when the caller passes per-side artwork areas AND
 * the rule defines `areaTiers`; otherwise pricing is flat. Remove `areaTiers`
 * from a rule to make that garment flat again — no other code changes needed.
 */
import type { GarmentId } from '@/lib/types'

export interface AreaTier {
  /** Upper bound of printed-artwork area, square inches (inclusive). */
  maxSqIn: number
  /** Added to the per-side price for a print in this tier. */
  addUsd: number
  /** i18n key for the tier's display name. */
  labelKey: string
}

export interface PricingRule {
  baseUsd: number
  perExtraSideUsd: number
  /** Optional size tiers; absent ⇒ flat price regardless of print size. */
  areaTiers?: AreaTier[]
}

// ISO paper areas: A5 ≈ 48, A4 ≈ 97, A3 ≈ 193 in². A4 (the standard) is free.
const AREA_TIERS: AreaTier[] = [
  { maxSqIn: 97, addUsd: 0, labelKey: 'price.tier_std' },
  { maxSqIn: 193, addUsd: 4, labelKey: 'price.tier_large' },
  { maxSqIn: Infinity, addUsd: 9, labelKey: 'price.tier_xl' },
]

export const PRICING: Record<'tee' | 'hoodie' | 'custom', PricingRule> = {
  tee: { baseUsd: 14.5, perExtraSideUsd: 6, areaTiers: AREA_TIERS },
  hoodie: { baseUsd: 32, perExtraSideUsd: 6, areaTiers: AREA_TIERS },
  custom: { baseUsd: 12, perExtraSideUsd: 6, areaTiers: AREA_TIERS },
}

/** Quantity discounts; the highest reached threshold wins. */
export const QTY_BREAKS: { minQty: number; discount: number }[] = [
  { minQty: 10, discount: 0.15 },
  { minQty: 25, discount: 0.25 },
  { minQty: 50, discount: 0.35 },
]

export const SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL'] as const

const toCents = (usd: number): number => Math.round(usd * 100) / 100

/** The tier a printed area falls in, or null when the garment prices flat. */
export function areaTier(garment: GarmentId, sqIn: number): AreaTier | null {
  const tiers = PRICING[garment].areaTiers
  if (!tiers) return null
  return tiers.find((t) => sqIn <= t.maxSqIn) ?? tiers[tiers.length - 1]
}

/**
 * Quote a run. `sides` is the number of printed sides (values < 1 price as a
 * single side); `qty` is clamped to at least 1 whole unit.
 *
 * Pass `sideAreasSqIn` (printed-artwork area per printed side) to price by size:
 * when it is present AND the garment defines `areaTiers`, each side adds its
 * tier surcharge and the side count comes from the array. Omit it (or leave a
 * rule without `areaTiers`) for the flat price — byte-identical to before.
 */
export function quote(
  garment: GarmentId,
  sides: number,
  qty: number,
  sideAreasSqIn?: number[],
): { unitUsd: number; totalUsd: number; discount: number } {
  const rule = PRICING[garment]
  const q = Math.max(1, Math.floor(qty) || 1)
  const discount = [...QTY_BREAKS].reverse().find((b) => q >= b.minQty)?.discount ?? 0

  let subtotal: number
  if (rule.areaTiers && sideAreasSqIn && sideAreasSqIn.length) {
    const areas = sideAreasSqIn.filter((a) => a > 0)
    const extraSides = Math.max(0, areas.length - 1)
    const tierAdd = areas.reduce((sum, a) => sum + (areaTier(garment, a)?.addUsd ?? 0), 0)
    subtotal = rule.baseUsd + extraSides * rule.perExtraSideUsd + tierAdd
  } else {
    const extraSides = Math.max(0, Math.floor(sides) - 1)
    subtotal = rule.baseUsd + extraSides * rule.perExtraSideUsd
  }

  const unitUsd = toCents(subtotal * (1 - discount))
  return { unitUsd, totalUsd: toCents(unitUsd * q), discount }
}
