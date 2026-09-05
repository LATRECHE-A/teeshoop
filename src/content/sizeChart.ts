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

// ---------------------------------------------------------------------------
// Une série de demi-poitrines venue d'ailleurs
// ---------------------------------------------------------------------------

/**
 * Une demi-poitrine à plat crédible, en centimètres.
 *
 * Bornes mesurées sur les dix séries de fabricants importées dans la boutique
 * le 5 septembre 2026 : la plus petite valeur est 45,72 cm (Gildan Heavy Cotton
 * en S) et la plus grande 86,36 cm (Gildan Heavy Blend en 5XL). Hors de [25, 95]
 * ce n'est plus une demi-poitrine : c'est une fiche PDF mal lue, un tableau en
 * pouces, ou un document fabriqué.
 */
const HALF_CHEST_MIN_CM = 25
const HALF_CHEST_MAX_CM = 95

/**
 * Le plus grand rapport de gradation qu'une vraie série produit, plus de la marge.
 *
 * Mesuré sur les mêmes dix séries, restreintes aux six tailles que le studio
 * dessine : le rapport 3XL/S va de 1,16 à 1,556 (le maximum est le Gildan Heavy
 * Cotton 18009, 71,12 / 45,72). Deux est donc trente pour cent au-dessus du pire
 * vêtement réel, ce qui laisse passer toute série honnête et refuse un rapport
 * qui ferait imprimer un marquage au double de sa taille.
 */
const MAX_GRADING_RATIO = 2

/**
 * Lire une série de demi-poitrines, ou refuser.
 *
 * POURQUOI CE CONTRÔLE EXISTE, ET POURQUOI ICI. Cette série décide de la taille
 * PHYSIQUE d'un marquage : `printScaleK` en fait un facteur d'échelle qui est
 * appliqué au film. Elle voyage sur le document de création, et le document est
 * envoyé par le navigateur du client sur une route ouverte, qui ne peut pas
 * demander d'identité (`worker/design.ts`). Une série fabriquée qui passerait
 * ici ferait couper un transfert à une taille que personne n'a commandée, et il
 * serait imprimé : le nid refuse une pièce trop grande pour le film, mais un
 * facteur de 1,5 tient sur la feuille et ressemble à du travail normal.
 *
 * Une seule maison pour cette règle, appelée par la passerelle en entrée
 * (`src/lib/teeshoop/bridge.ts`) et par le gradient en lecture
 * (`src/lib/printScale.ts`), parce que la première est contournable et que la
 * seconde est le dernier point avant le film.
 *
 * Trois refus, tous constatés sur de vraies fiches par `scripts/zones-mesurer.mjs` :
 * une valeur hors plage (fiche en pouces), une série qui ne monte pas (colonnes
 * décalées à la lecture du PDF), un écart entre extrêmes qui n'est pas une
 * gradation. Le refus est TOTAL : une série à demi crédible n'est pas à moitié
 * utilisable, et grader trois tailles sur six ferait varier le marquage d'une
 * taille à l'autre sans raison lisible.
 *
 * Rend un objet vide quand il n'y a rien à lire, ce qui n'est pas un refus :
 * « la boutique n'a rien dit » laisse le gradient sur la charte du studio.
 */
export function readHalfChestSeries(raw: unknown): Partial<Record<SizeId, number>> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Partial<Record<SizeId, number>> = {}
  for (const size of SIZE_IDS) {
    const cm = Number((raw as Record<string, unknown>)[size])
    if (!Number.isFinite(cm)) continue
    if (cm < HALF_CHEST_MIN_CM || cm > HALF_CHEST_MAX_CM) return {}
    out[size] = cm
  }
  const present = SIZE_IDS.filter((s) => out[s] !== undefined)
  // Une seule taille ne grade rien : il faut deux points pour faire un rapport.
  if (present.length < 2) return {}
  for (let i = 1; i < present.length; i++) {
    if ((out[present[i]] as number) <= (out[present[i - 1]] as number)) return {}
  }
  const lo = out[present[0]] as number
  const hi = out[present[present.length - 1]] as number
  if (hi / lo > MAX_GRADING_RATIO) return {}
  return out
}
