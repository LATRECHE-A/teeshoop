/**
 * Order basket — the multi-product / multi-size order the DTF gang sheet is
 * nested for. The studio designs ONE garment at a time; a real order is
 * several designs, in several sizes and quantities, and the margin lives in
 * nesting the WHOLE order onto the same transfer roll.
 *
 * A line carries a DEEP SNAPSHOT of the design taken at add time — editing the
 * live design afterwards must never mutate what is already in the basket.
 * Snapshots reference uploads BY ASSET ID (blobs are never duplicated), so a
 * line only renders while its assets still exist in the asset store: purging
 * an upload (see purgeAsset) leaves older basket lines pointing at a missing
 * image, exactly like a saved design does.
 *
 * Persisted in IndexedDB under `tshop:basket`. Every mutation goes through
 * mutateBasket() so the stored array is read-modify-written inside ONE
 * transaction — a listAll-then-write pair silently loses a concurrent
 * writer's line (that race was a real bug in the asset index).
 */
import { get, update } from 'idb-keyval'
import { nanoid } from 'nanoid'
import type { Design, Side } from '@/lib/types'
import { isSizeId, type SizeId } from '@/content/sizeChart'
import { GARMENT_COLORS } from '@/content/palettes'
import { sideLayers } from '@/lib/renderDesign'
import { getLang } from '@/i18n/lang'
import { messages } from '@/i18n/messages'

export const BASKET_KEY = 'tshop:basket'

export interface BasketLine {
  id: string
  /** Deep snapshot of the design as it was when added. */
  design: Design
  /** Design name shown in the UI. */
  label: string
  /** Product name, e.g. "T-shirt classique" (frozen at add time). */
  garmentLabel: string
  colorHex: string
  size: SizeId
  qty: number
  addedAt: number
}

export const BASKET_SIDES: Side[] = ['front', 'back', 'sleeve']

const MAX_QTY = 999
/** Custom garments carry no dye colour — the swatch falls back to this. */
const FALLBACK_HEX = '#FFFFFF'

export function clampQty(n: number): number {
  if (!Number.isFinite(n)) return 1
  return Math.max(1, Math.min(MAX_QTY, Math.round(n)))
}

/**
 * Product name in the CURRENT language, frozen into the line at add time
 * (a later language switch relabels the studio, not past order lines).
 * Resolved straight from the catalog rather than through `@/i18n`, which
 * imports the store — and the store imports this module.
 */
export function garmentLabelFor(design: Design): string {
  const key = `garment.${design.garmentId}`
  return messages[getLang()]?.[key] ?? messages.fr[key] ?? design.garmentId
}

export function garmentColorHex(design: Design): string {
  return GARMENT_COLORS.find((c) => c.id === design.colorId)?.hex ?? FALLBACK_HEX
}

/** Sides of a snapshot that actually carry artwork (= transfers to print). */
export function linePrintedSides(design: Design): Side[] {
  return BASKET_SIDES.filter((s) => sideLayers(design, s).length > 0)
}

/** Snapshot the live design — deep, so later edits can't reach into the line. */
export function makeBasketLine(design: Design, size: SizeId, qty = 1): BasketLine {
  return {
    id: nanoid(8),
    design: structuredClone(design),
    label: design.name,
    garmentLabel: garmentLabelFor(design),
    colorHex: garmentColorHex(design),
    size,
    qty: clampQty(qty),
    addedAt: Date.now(),
  }
}

/**
 * The display fields a line derives from its design. Frozen at add time, so
 * they must be RE-derived whenever the snapshot is rewritten — board mode lets
 * the user rename, recolour or re-garment a line in place, and a stale label is
 * how an order line ends up describing a product nobody ordered.
 */
export function lineFieldsFor(
  design: Design,
  size: SizeId,
): Pick<BasketLine, 'design' | 'size' | 'label' | 'garmentLabel' | 'colorHex'> {
  return {
    design,
    size,
    label: design.name,
    garmentLabel: garmentLabelFor(design),
    colorHex: garmentColorHex(design),
  }
}

/**
 * Pure line patch — the transformation `applyBasket` replays against memory and
 * against storage, so it must not build anything with a fresh id or timestamp.
 */
export function updateLine(
  lines: BasketLine[],
  id: string,
  patch: Partial<BasketLine>,
): BasketLine[] {
  return lines.map((l) => (l.id === id ? { ...l, ...patch } : l))
}

export interface BasketTotals {
  lines: number
  /** Garments to buy (quantity-weighted). */
  garments: number
  /** Transfers to print per side (quantity-weighted). */
  prints: Record<Side, number>
  printsTotal: number
}

export function basketTotals(lines: BasketLine[]): BasketTotals {
  const prints: Record<Side, number> = { front: 0, back: 0, sleeve: 0 }
  let garments = 0
  for (const l of lines) {
    garments += l.qty
    for (const s of linePrintedSides(l.design)) prints[s] += l.qty
  }
  return {
    lines: lines.length,
    garments,
    prints,
    printsTotal: prints.front + prints.back + prints.sleeve,
  }
}

// --- persistence ----------------------------------------------------------

/** Drop rows an older/corrupt build could have left behind. */
function sanitize(raw: unknown): BasketLine[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (l): l is BasketLine =>
        !!l && typeof l.id === 'string' && Array.isArray(l.design?.layers),
    )
    .map((l) => ({
      ...l,
      size: isSizeId(l.size) ? l.size : 'M',
      qty: clampQty(l.qty),
    }))
}

export async function loadBasket(): Promise<BasketLine[]> {
  try {
    return sanitize(await get(BASKET_KEY))
  } catch {
    return []
  }
}

/**
 * Apply `fn` to the STORED basket inside a single idb transaction and return
 * the result. `fn` must be pure (it runs on whatever is persisted, which may
 * already include another tab's line) — build new lines before calling.
 */
export async function mutateBasket(
  fn: (lines: BasketLine[]) => BasketLine[],
): Promise<BasketLine[]> {
  let next: BasketLine[] = []
  try {
    await update<BasketLine[]>(BASKET_KEY, (stored) => {
      next = fn(sanitize(stored))
      return next
    })
  } catch {
    /* private mode / storage full — the basket simply won't survive a reload */
  }
  return next
}
