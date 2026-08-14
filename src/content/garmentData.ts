/**
 * The garment facts a WordPress product page needs, in centimetres.
 *
 * WHY THIS FILE EXISTS. The studio owns what it can print: the print areas
 * (src/garments/*.ts), the grading rule (src/lib/printScale.ts) and the
 * official flat measurements (src/content/sizeChart.ts). A PHP template on the
 * shop needs the same numbers, and PHP cannot import TypeScript.
 *
 * The answer is NOT to retype them into PHP. A print size typed twice is a
 * print size that diverges, and the divergence surfaces as a customer who
 * measured their logo against the product page and had it cropped by the
 * workshop. So this module derives a plain JSON document from the shipped
 * definitions, `scripts/gen-garment-data.mjs` writes it to
 * `wp-plugins/teeshoop-core/data/garments.json`, and `garmentData.test.ts`
 * fails when the committed file and this function disagree. There is one
 * source; the JSON is a build product that happens to be committed so the
 * plugin needs no build step of its own.
 *
 * EVERYTHING IS DERIVED, NOTHING IS TYPED. The per-size areas come from the
 * real `printScaleK`, not from a copy of its formula, so a change to the
 * grading rule changes this file's output and the test says so.
 *
 * UNITS. Inches are the engine's internal unit and they stop here: every
 * number leaving this module is centimetres, because cm is what a French
 * customer reads (src/lib/units.ts). Values are rounded to one decimal, which
 * is what `fmtCm` shows and what a tape measure resolves.
 */
import type { Design, Side } from '@/lib/types'
import { GARMENTS } from '@/garments'
import {
  DEFAULT_SIZE,
  SIZE_CHARTS,
  SIZE_IDS,
  sizeSpecCm,
  type SizeId,
} from '@/content/sizeChart'
import { printScaleK, scaleAreaIn } from '@/lib/printScale'
import { GARMENT_COLORS } from '@/content/palettes'
import { inToCm } from '@/lib/units'
import { messages } from '@/i18n/messages'

/** Sides in the order a buyer thinks about them, not in object order. */
const SIDES: Side[] = ['front', 'back', 'sleeve']

export interface GarmentAreaCm {
  side: Side
  /** Print-area width and height at each size, cm, one decimal. */
  bySize: Record<SizeId, { wCm: number; hCm: number }>
}

export interface GarmentSizeRowCm {
  size: SizeId
  halfChestCm: number
  bodyLengthCm: number
  sleeveLengthCm: number
}

export interface GarmentPresentation {
  id: string
  /** Manufacturer and style the measurements are taken from. */
  brandRef: string
  /** The size every published area and every priced area is measured at. */
  pricedSize: SizeId
  areas: GarmentAreaCm[]
  sizes: GarmentSizeRowCm[]
}

export interface GarmentDataFile {
  /**
   * Bumped by hand when the SHAPE changes, so a plugin reading an older or
   * newer file refuses rather than rendering half of it.
   */
  schema: number
  generatedFrom: string
  garments: Record<string, GarmentPresentation>
  colors: { id: string; name: string; hex: string }[]
}

/** One decimal, the resolution `fmtCm` publishes and a tape measure resolves. */
const round1 = (v: number): number => Math.round(v * 10) / 10

/**
 * A document that exists only to be asked "how big is the print area".
 *
 * `printScaleK` reads three fields and nothing else, so this is enough, and
 * asking the real function is the point: the grading rule is not restated
 * here, it is called.
 */
const probe = (id: 'tee' | 'hoodie'): Design =>
  ({
    garmentId: id,
    printScale: { mode: 'scaled', baseSize: DEFAULT_SIZE },
  }) as unknown as Design

function areasOf(id: 'tee' | 'hoodie'): GarmentAreaCm[] {
  const design = probe(id)
  return SIDES.map((side) => {
    const base = GARMENTS[id].printAreasIn[side]
    const bySize = {} as Record<SizeId, { wCm: number; hCm: number }>
    for (const size of SIZE_IDS) {
      const graded = scaleAreaIn(base, printScaleK(design, size))
      bySize[size] = {
        wCm: round1(inToCm(graded.wIn)),
        hCm: round1(inToCm(graded.hIn)),
      }
    }
    return { side, bySize }
  })
}

export function buildGarmentData(): GarmentDataFile {
  const garments: Record<string, GarmentPresentation> = {}

  for (const id of ['tee', 'hoodie'] as const) {
    garments[id] = {
      id,
      brandRef: SIZE_CHARTS[id].brandRef,
      pricedSize: DEFAULT_SIZE,
      areas: areasOf(id),
      sizes: SIZE_IDS.map((size) => {
        const spec = sizeSpecCm(id, size)
        return {
          size,
          halfChestCm: spec.halfChestCm,
          bodyLengthCm: spec.bodyLengthCm,
          sleeveLengthCm: spec.sleeveLengthCm,
        }
      }),
    }
  }

  /*
   * `custom` is absent on purpose, and its absence is the honest answer.
   *
   * With `custom` the customer ships their own garment, so its print area is
   * their photo's (src/lib/renderDesign.ts getAreaSizeIn) and its measurements
   * are whatever they bought. Publishing a table for it would be publishing a
   * guess about somebody else's shirt.
   */

  return {
    schema: 1,
    generatedFrom: 'src/content/garmentData.ts',
    garments,
    colors: GARMENT_COLORS.map((c) => ({
      id: c.id,
      // The shop is French. `GARMENT_COLORS.name` is the English swatch name
      // the editor was authored with; the customer-facing one is the catalogue.
      name: messages.fr[`color.${c.id}`] ?? c.name,
      hex: c.hex,
    })),
  }
}
