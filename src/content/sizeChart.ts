/**
 * Real garment dimensions per size, the single dimensional source of truth
 * that makes the 2D editor, 3D preview, AR and admin print automation agree.
 *
 * Values are OFFICIAL manufacturer flat measurements in CENTIMETRES:
 *   - tee    → Stanley/Stella Creator STTU755 (EU reference blank, native cm)
 *   - hoodie → Stanley/Stella Cruiser STSU822
 * halfChestCm is the laid-flat pit-to-pit width (measured 2.5 cm below the
 * armhole; ×2 = chest circumference); bodyLengthCm is high-point-shoulder to
 * hem; sleeveLengthCm is shoulder seam to cuff.
 *
 * The engine stays inch-based (see src/lib/types.ts); this module is the ONLY
 * place where cm → inches happens for catalog garments. The 800px garment art
 * (src/garments) is drawn at the `nominal` size; other sizes render by scaling
 * the art about the collar anchor (see garmentDrawTransform in
 * src/lib/renderDesign.ts) because professional print placement is measured
 * from the collar seam and is size-invariant.
 */
import type { CatalogGarmentId, SizeId } from '@/lib/types'
import { cmToIn } from '@/lib/units'

// SizeId is declared in @/lib/types (the base layer, which Garment3DProps also
// needs) and re-exported here so this module stays the one import for sizing.
export type { SizeId }

export const SIZE_IDS = ['S', 'M', 'L', 'XL', '2XL', '3XL'] as const satisfies readonly SizeId[]

/** Default preview size: M is the most-ordered adult size. */
export const DEFAULT_SIZE: SizeId = 'M'

export function isSizeId(v: unknown): v is SizeId {
  return typeof v === 'string' && (SIZE_IDS as readonly string[]).includes(v)
}

export interface SizeSpecCm {
  /** Laid-flat pit-to-pit width, cm (×2 = chest circumference). */
  halfChestCm: number
  /** High-point-shoulder to hem, cm. */
  bodyLengthCm: number
  /** Shoulder seam to cuff, cm (short sleeve for tee, long for hoodie). */
  sleeveLengthCm: number
}

export interface GarmentSizeChart {
  /** Manufacturer + style the numbers come from (shown to users/admin). */
  brandRef: string
  /** The size the 800px garment art + 3D calibration were authored at. */
  nominal: SizeId
  sizes: Record<SizeId, SizeSpecCm>
}

export const SIZE_CHARTS: Record<CatalogGarmentId, GarmentSizeChart> = {
  tee: {
    brandRef: 'Stanley/Stella Creator STTU755',
    nominal: 'L',
    sizes: {
      S: { halfChestCm: 49, bodyLengthCm: 69, sleeveLengthCm: 20.5 },
      M: { halfChestCm: 52, bodyLengthCm: 72, sleeveLengthCm: 21.5 },
      L: { halfChestCm: 55, bodyLengthCm: 74, sleeveLengthCm: 22.5 },
      XL: { halfChestCm: 58, bodyLengthCm: 76, sleeveLengthCm: 22.5 },
      '2XL': { halfChestCm: 61, bodyLengthCm: 78, sleeveLengthCm: 23.5 },
      '3XL': { halfChestCm: 64, bodyLengthCm: 80, sleeveLengthCm: 24.5 },
    },
  },
  hoodie: {
    brandRef: 'Stanley/Stella Cruiser STSU822',
    nominal: 'L',
    sizes: {
      S: { halfChestCm: 51.5, bodyLengthCm: 68, sleeveLengthCm: 64 },
      M: { halfChestCm: 54, bodyLengthCm: 72, sleeveLengthCm: 65.5 },
      L: { halfChestCm: 57, bodyLengthCm: 74, sleeveLengthCm: 67 },
      XL: { halfChestCm: 60, bodyLengthCm: 76, sleeveLengthCm: 68.5 },
      '2XL': { halfChestCm: 63, bodyLengthCm: 78, sleeveLengthCm: 70 },
      '3XL': { halfChestCm: 66, bodyLengthCm: 80, sleeveLengthCm: 70 },
    },
  },
}

export function sizeSpecCm(garment: CatalogGarmentId, size: SizeId): SizeSpecCm {
  return SIZE_CHARTS[garment].sizes[size]
}

/** Laid-flat garment width in inches for the engine (chart cm → in). */
export function garmentWidthInFor(garment: CatalogGarmentId, size: SizeId): number {
  return cmToIn(sizeSpecCm(garment, size).halfChestCm)
}

export interface SizeScale {
  /** Horizontal art scale vs the nominal drawing (chest ratio). */
  sx: number
  /** Vertical art scale vs the nominal drawing (body-length ratio). */
  sy: number
  /** Sleeve art scale vs nominal (sleeve-length ratio). */
  sleeve: number
}

/** Art scale factors for rendering `size` with the nominal-size drawing. */
export function sizeScale(garment: CatalogGarmentId, size: SizeId): SizeScale {
  const chart = SIZE_CHARTS[garment]
  const n = chart.sizes[chart.nominal]
  const s = chart.sizes[size]
  return {
    sx: s.halfChestCm / n.halfChestCm,
    sy: s.bodyLengthCm / n.bodyLengthCm,
    sleeve: s.sleeveLengthCm / n.sleeveLengthCm,
  }
}
