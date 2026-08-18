/**
 * What a DTF supplier profile IS, as types and nothing else.
 *
 * Split out of `suppliers.ts` so that `nesting.ts` can name `BillingModel`,
 * `DtfProcess` and `SheetFormat` without dragging the profile TABLE behind it.
 *
 * It is not a tidiness split. `suppliers.ts` persists operator edits in
 * `localStorage`, and `worker/nest.ts` imports the packer so the shop's cost
 * engine can ask one packer rather than growing a second one in PHP. The Worker
 * runtime has no DOM, so a type-only import that still pulled `suppliers.ts`
 * into the program failed to compile on seven references to `localStorage` that
 * the Worker will never execute. Types have no runtime and no platform; this
 * file is only types.
 */
export type BillingModel = 'roll' | 'fixed'
export type ProcessId = 'dtf' | 'uvdtf'

export interface PriceTier {
  /** Tier applies from this many linear metres (inclusive). */
  minLm: number
  eurPerLm: number
}

/** One purchasable sheet format (fixed billing). */
export interface SheetFormat {
  id: string
  label: string
  wCm: number
  hCm: number
  /** Price of ONE sheet of this format, in the supplier's vatBasis. */
  priceEur: number
}

/**
 * Where a spacing figure comes from. Nesting burns real money at the edges, so
 * the UI has to be able to say whether a margin is a supplier RULE, a
 * consequence of the supplier quoting a *printable* width (in which case the
 * honest margin is 0), or a house floor we invented because nobody published
 * anything. Guessing silently is how the current 1 cm margin got there.
 */
export type SpacingSource = 'published' | 'printable-width' | 'house' | 'inferred'

/** Machine-checkable prepress rules — the input of preflight.ts. */
export interface DtfGuidelines {
  minDpi: number
  /** Thinnest printable stroke, mm (colour artwork). */
  minLineMmColour: number
  /** Thinnest printable stroke, mm (white layer). */
  minLineMmWhite: number
  /** Smallest legible text, pt at final size. */
  minTextPt: number
  /**
   * Clear space at the two LONG edges (the laize limit), cm. Legitimately 0
   * when the supplier quotes a printable width — that width IS the safe area.
   */
  marginCm: number
  /**
   * Clear space at the two SHORT edges, cm. On a roll these are a scissor cut,
   * not a printer edge, so 0 is normal; a fixed format may want a real value.
   */
  marginEndCm?: number
  /** Recommended artwork-to-artwork spacing, cm. */
  gapCm: number
  /** Provenance of `marginCm` / `marginEndCm`, surfaced in the admin UI. */
  marginSource?: SpacingSource
  /** Provenance of `gapCm`. */
  gapSource?: SpacingSource
  /** Hard cap on a SINGLE design (cm); null = only the process geometry caps it. */
  maxDesignWCm: number | null
  maxDesignHCm: number | null
  /** Accepted upload extensions, lowercase, no dot. */
  fileFormats: string[]
  colourMode: string
  transparency: string
  whiteUnderbase: string
  cutting: string
}

export interface DtfProcess {
  id: ProcessId
  label: string
  billing: BillingModel
  /**
   * Width usable for artwork in one print file (cm) — the supplier's MAXIMUM.
   * The operator may nest onto a narrower sheet, never a wider one.
   */
  printableWidthCm: number
  rollWidthCm: number
  /** Max length of one print file / sheet (cm) — again the supplier maximum. */
  maxLengthCm: number
  /**
   * Billing granularity in cm. 10 = 0.1 lm, which is what most roll suppliers
   * invoice; a supplier that bills whole metres (100) makes every packing gain
   * below one metre worth exactly nothing, so this is not a detail.
   */
  billingStepCm?: number
  /** Roll billing only — sorted by minLm ascending. */
  priceTiers: PriceTier[]
  /** Fixed billing only — the purchasable catalogue. */
  formats: SheetFormat[]
  guidelines: DtfGuidelines
  /**
   * Per-process minimum billed length (lm). Optional: falls back to the
   * supplier-level `minOrderLm` (DTF+ bills 1 lm on DTF but 0,5 lm on UV-DTF).
   */
  minOrderLm?: number
}

export interface SupplierProfile {
  id: string
  name: string
  url: string
  /** Where the transfers are actually printed (drives lead time honesty). */
  printsFrom: string
  /** Whether the encoded prices are excl. (HT) or incl. (TTC) French VAT. */
  vatBasis: 'HT' | 'TTC'
  processes: DtfProcess[]
  /** Flat shipping to France (EUR); 0 = included / unknown. */
  shippingEur: number
  /** Free shipping from this print-cost value in EUR (null = none). */
  freeShipAtEur: number | null
  /** Free shipping from this many linear metres (null = no lm threshold). */
  freeShipAtLm: number | null
  /** Minimum billed linear metres per order (roll billing). */
  minOrderLm: number
  /** Minimum order value in EUR applied to the print cost (0 = none). */
  minOrderEur: number
  daysToParis: string
  notes: string
}
