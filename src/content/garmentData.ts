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
  /** Manufacturer and style the measurements are taken from. '' when unknown. */
  brandRef: string
  /** The size every published area and every priced area is measured at. */
  pricedSize: SizeId
  /**
   * The faces this garment can be printed on, whether or not we hold a
   * measurement for them.
   *
   * SEPARATE FROM `areas` on purpose. The shop used to count `areas` to decide
   * how many faces to offer, which conflated "we have no measurements" with
   * "one face": a `custom` garment, whose measurements are the customer's own
   * shirt and are therefore absent by design, was offered a one-face price
   * while `Pricing` was perfectly willing to charge for two. The product page
   * hid the control, the grid published one row, and the cart billed 12,00 EUR
   * of second-side marking the page never mentioned.
   */
  printableSides: Side[]
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
      printableSides: SIDES,
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
   * `custom` gets a record with no measurements at all, and that is the honest
   * shape rather than no record.
   *
   * With `custom` the customer ships their own garment, so its print area is
   * their own photo's (src/lib/renderDesign.ts getAreaSizeIn) and its
   * measurements are whatever they bought: publishing a table for it would be
   * publishing a guess about somebody else's shirt, so `areas` and `sizes` are
   * empty and the page renders nothing where they would go.
   *
   * But how many faces it prints on is NOT a measurement, it is a fact, and the
   * shop needs it to price. Front and back only: `getAreaSizeIn` returns
   * {0, 0} for a custom sleeve, deliberately, because there is nothing to
   * derive a sleeve area from and a fabricated print size is worse than no
   * print. Leaving `custom` out of this file entirely made the shop count zero
   * areas and offer exactly one face.
   */
  garments.custom = {
    id: 'custom',
    brandRef: '',
    pricedSize: DEFAULT_SIZE,
    printableSides: ['front', 'back'],
    areas: [],
    sizes: [],
  }


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

// ---------------------------------------------------------------------------
// The illustration
// ---------------------------------------------------------------------------

/**
 * One side of one garment, drawn, with the rectangle we may print inside it.
 *
 * `body` is the flat product illustration authored in `src/garments/*.ts`,
 * carrying the literal `__COLOR__` where the cloth fill goes. The shop
 * substitutes a colour into it exactly as `src/app/panels/ProductPanel.tsx`
 * already does, so there is one drawing of a t-shirt in this project and not
 * two.
 */
export interface GarmentSideArtFile {
  side: Side
  /** SVG document, `viewBox="0 0 800 800"`, with `__COLOR__` for the cloth. */
  body: string
  /** The printable rectangle in that same viewBox, so the two cannot drift. */
  printAreaPx: { x: number; y: number; w: number; h: number }
}

export interface GarmentArtFile {
  schema: number
  generatedFrom: string
  garments: Record<
    string,
    {
      id: string
      /** viewBox px per real inch. The bridge between the drawing and the cm. */
      pxPerInch: number
      /** Real laid-flat width, inches. */
      widthIn: number
      sides: GarmentSideArtFile[]
    }
  >
}

/**
 * The drawings, for a page that has to SHOW a garment rather than measure one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS A SECOND FILE AND NOT MORE KEYS IN `garments.json`
 *
 * `garments.json` is read by `Garments::all()` on every product page, and it is
 * read to answer "how many centimetres". These drawings are 48 kB of SVG and
 * are wanted by one page. Folding them in would make every product page in the
 * shop decode 48 kB of path data to print "30,5 × 40,6 cm". Two files, one
 * generator, one guard.
 *
 * WHY THE SHADING LAYER IS LEFT OUT. `GarmentSideArt.shade` exists to be
 * multiplied over a customer's artwork so the print takes the garment's own
 * folds. Nothing on the shop composites artwork, the studio does that in the
 * browser from this same module, so shipping it to WordPress would be bytes
 * for a job nobody does there.
 *
 * THE PRINT RECTANGLE TRAVELS WITH THE DRAWING, in the drawing's own
 * coordinates. That is the whole point of deriving this rather than drawing a
 * garment by hand in a stylesheet: `printAreaPx` is the same rectangle the
 * press is set to, so a homepage that draws it on the garment cannot advertise
 * a print area the workshop does not print. `pxPerInch` is what turns it back
 * into the centimetres `buildGarmentData()` publishes beside it.
 */
export function buildGarmentArt(): GarmentArtFile {
  const garments: GarmentArtFile['garments'] = {}

  for (const id of ['tee', 'hoodie'] as const) {
    const art = GARMENTS[id]
    garments[id] = {
      id,
      pxPerInch: art.pxPerInch,
      widthIn: art.widthIn,
      sides: SIDES.map((side) => ({
        side,
        body: art.sides[side].body,
        printAreaPx: art.sides[side].printAreaPx,
      })),
    }
  }

  /*
   * `custom` gets no drawing, for the same reason it gets no measurements: the
   * garment is the customer's own photograph. An illustration of OUR t-shirt
   * standing in for the shirt they are about to ship us would be a picture of
   * the wrong object.
   */

  return {
    schema: 1,
    generatedFrom: 'src/content/garmentData.ts',
    garments,
  }
}
