/**
 * Pricing: module A5.
 *
 * Per-garment base price + a flat surcharge for every printed side beyond the
 * first, with quantity discounts at the QTY_BREAKS thresholds. `custom` = the
 * customer ships their own garment (decoration only).
 *
 * AREA-AWARE TIERS (opt-in per garment via `areaTiers`): a print up to A4 is the
 * affordable standard (+$0); larger prints (up to A3, then oversize) cost more.
 * Tiers only affect the quote when the caller passes per-side artwork areas AND
 * the rule defines `areaTiers`; otherwise pricing is flat. Remove `areaTiers`
 * from a rule to make that garment flat again, no other code changes needed.
 */
import type { GarmentId } from '@/lib/types'

export interface AreaTier {
  /** Upper bound of printed-artwork area, square CENTIMETRES (inclusive). */
  maxSqCm: number
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

/**
 * A4 (the standard) is free; A3 and oversize cost more.
 *
 * THE BOUNDS ARE THE SERVER'S, TO THE UNIT. `Pricing::area_tier` in
 * wp-plugins/teeshoop-core is the authority and works in cm²; this table used
 * to hold 97 in² and 193 in², which are 625,81 cm² and 1245,16 cm², close
 * enough to look identical and wrong enough to matter, because a design landing
 * in either gap was quoted one price here and charged another at checkout. They
 * are now the same two numbers written in the same unit, so the two engines can
 * only ever disagree by someone editing one of them.
 */
const AREA_TIERS: AreaTier[] = [
  { maxSqCm: 625, addUsd: 0, labelKey: 'price.tier_std' },
  { maxSqCm: 1250, addUsd: 4, labelKey: 'price.tier_large' },
  { maxSqCm: Infinity, addUsd: 9, labelKey: 'price.tier_xl' },
]

/**
 * THE SHOP IS THE AUTHORITY; this table is what the standalone studio shows.
 *
 * `Pricing::default_config()` in wp-plugins/teeshoop-core computes every price
 * a customer can pay, and `scripts/hypotheses-guard.mjs` fails when the two
 * disagree, by RUNNING both rather than by comparing text (H-Q06-TARIF-TEE and
 * its siblings). So these are not independent figures: they are this table's
 * copy of the server's, and they move when it moves.
 *
 * 4 September 2026: the tee went from 14,50 to 23,00 and the hoodie from 32,00
 * to 49,00, because `tests/integration-grille.php` measured 102 of the 219
 * published columns selling under their cost floor, and then 34 more once it
 * stopped costing every order at size M. The derivation is in the comment above
 * `garments` in Pricing.php.
 */
export const PRICING: Record<'tee' | 'hoodie' | 'custom', PricingRule> = {
  tee: { baseUsd: 23, perExtraSideUsd: 7, areaTiers: AREA_TIERS },
  hoodie: { baseUsd: 49, perExtraSideUsd: 7, areaTiers: AREA_TIERS },
  custom: { baseUsd: 12, perExtraSideUsd: 7, areaTiers: AREA_TIERS },
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
export function areaTier(garment: GarmentId, sqCm: number): AreaTier | null {
  const tiers = PRICING[garment].areaTiers
  if (!tiers) return null
  return tiers.find((t) => sqCm <= t.maxSqCm) ?? tiers[tiers.length - 1]
}

/**
 * Quote a run. `sides` is the number of printed sides (values < 1 price as a
 * single side); `qty` is clamped to at least 1 whole unit.
 *
 * Pass `sideAreasSqCm` (printed-artwork area per printed side, square
 * centimetres) to price by size: when it is present AND the garment defines
 * `areaTiers`, each side adds its tier surcharge and the side count comes from
 * the array. A side measuring 0 is not a printed side: there is nothing on it
 * to press. Omit the array (or leave a rule without `areaTiers`) for the flat
 * price, byte-identical to before.
 */
export function quote(
  garment: GarmentId,
  sides: number,
  qty: number,
  sideAreasSqCm?: number[],
): { unitUsd: number; totalUsd: number; discount: number } {
  const rule = PRICING[garment]
  const q = Math.max(1, Math.floor(qty) || 1)
  const discount = [...QTY_BREAKS].reverse().find((b) => q >= b.minQty)?.discount ?? 0

  let subtotal: number
  if (rule.areaTiers && sideAreasSqCm && sideAreasSqCm.length) {
    const areas = sideAreasSqCm.filter((a) => a > 0)
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
