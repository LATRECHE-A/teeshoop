/**
 * Print grading: the promise that a design reads the same on every size.
 *
 * This is a thing the business actually sells and a customer can measure with
 * a ruler, so the invariants here are worth more than their line count.
 */
import { describe, expect, it } from 'vitest'
import {
  chestChartFrom,
  gradableSizes,
  isGraded,
  printScaleK,
  scaleAreaIn,
  scaleLayer,
  scaleLayers,
} from './printScale'
import { SIZE_CHARTS, SIZE_IDS } from '@/content/sizeChart'
import type { Design, ImageLayer, TextLayer } from './types'

const baseDesign = (over: Partial<Design> = {}): Design =>
  ({
    id: 'd',
    name: 'test',
    garmentId: 'tee',
    colorId: 'white',
    custom: null,
    layers: [],
    stashedLayers: [],
    printScale: { mode: 'scaled', baseSize: 'M' },
    updatedAt: 0,
    ...over,
  }) as Design

const imageLayer = (): ImageLayer => ({
  id: 'l1',
  type: 'image',
  side: 'front',
  name: 'logo',
  assetId: 'a1',
  xIn: 1.5,
  yIn: -2,
  wIn: 6,
  hIn: 4,
  flipX: false,
  useCutout: false,
  rotation: 0,
  opacity: 1,
})

const textLayer = (): TextLayer => ({
  id: 'l2',
  type: 'text',
  side: 'front',
  name: 'slogan',
  text: 'TEESHOOP',
  fontFamily: 'Anton',
  fontSizeIn: 1.2,
  fill: '#111111',
  stroke: null,
  strokeWidthIn: 0.05,
  letterSpacingEm: 0,
  curve: 0,
  align: 'center',
  xIn: 0.5,
  yIn: -1,
  rotation: 0,
  opacity: 1,
})

describe('printScaleK', () => {
  it('is exactly 1 at the base size, and 1 in fixed mode on every size', () => {
    const d = baseDesign()
    expect(printScaleK(d, 'M')).toBe(1)

    const fixed = baseDesign({ printScale: { mode: 'fixed', baseSize: 'M' } })
    for (const s of SIZE_IDS) expect(printScaleK(fixed, s)).toBe(1)
  })

  it('is the half-chest ratio, taken straight from the chart', () => {
    const d = baseDesign()
    const chart = SIZE_CHARTS.tee.sizes
    for (const s of SIZE_IDS)
      expect(printScaleK(d, s)).toBeCloseTo(chart[s].halfChestCm / chart.M.halfChestCm, 12)
  })

  it('NEVER guesses a ratio it cannot derive', () => {
    // A ship-your-own garment with no chart at all.
    const noChart = baseDesign({ garmentId: 'custom', custom: {} as never })
    for (const s of SIZE_IDS) expect(printScaleK(noChart, s)).toBe(1)
    expect(isGraded(noChart)).toBe(false)

    // Only the base size known, still nothing to interpolate from.
    const oneSize = baseDesign({
      garmentId: 'custom',
      custom: { halfChestCmBySize: { M: 52 } } as never,
    })
    for (const s of SIZE_IDS) expect(printScaleK(oneSize, s)).toBe(1)
    expect(gradableSizes(oneSize)).toEqual(['M'])
  })
})

describe('grading geometry', () => {
  it('THE CORE INVARIANT: artwork occupies the same fraction of the print area on every size', () => {
    const d = baseDesign()
    const layer = imageLayer()
    const area = { wIn: 12, hIn: 16 }

    const base = {
      w: layer.wIn / area.wIn,
      h: layer.hIn / area.hIn,
      x: layer.xIn / area.wIn,
      y: layer.yIn / area.hIn,
    }

    for (const size of SIZE_IDS) {
      const k = printScaleK(d, size)
      const l = scaleLayer(layer, k)
      const a = scaleAreaIn(area, k)
      expect(l.wIn / a.wIn).toBeCloseTo(base.w, 12)
      expect(l.hIn / a.hIn).toBeCloseTo(base.h, 12)
      expect(l.xIn / a.wIn).toBeCloseTo(base.x, 12)
      expect(l.yIn / a.hIn).toBeCloseTo(base.y, 12)
    }
  })

  it('k === 1 returns the SAME REFERENCE: render memoisation depends on it', () => {
    const layer = imageLayer()
    const layers = [layer, textLayer()]
    expect(scaleLayer(layer, 1)).toBe(layer)
    expect(scaleLayers(layers, 1)).toBe(layers)
  })

  it('grading composes multiplicatively, for text (which also scales type) and images', () => {
    const a = 1.1
    const b = 1.3
    for (const l of [imageLayer(), textLayer()]) {
      const twice = scaleLayer(scaleLayer(l, a), b)
      const once = scaleLayer(l, a * b)
      for (const key of Object.keys(once) as (keyof typeof once)[]) {
        const v = once[key]
        if (typeof v === 'number') expect(twice[key] as number).toBeCloseTo(v, 10)
        else expect(twice[key]).toEqual(v)
      }
    }
  })

  it('a text layer grades its font size and stroke, not just its box', () => {
    const t = textLayer()
    const scaled = scaleLayer(t, 2)
    expect(scaled.fontSizeIn).toBeCloseTo(t.fontSizeIn * 2, 12)
    expect(scaled.strokeWidthIn).toBeCloseTo(t.strokeWidthIn * 2, 12)
    // Non-geometric properties must survive untouched.
    expect(scaled.text).toBe(t.text)
    expect(scaled.rotation).toBe(t.rotation)
    expect(scaled.opacity).toBe(t.opacity)
  })
})

describe('chestChartFrom', () => {
  it('drops non-positive measurements rather than storing a broken chart', () => {
    expect(chestChartFrom({ S: { halfChestCm: 0 }, M: { halfChestCm: 52 } } as never)).toEqual({
      M: 52,
    })
  })
})

/**
 * La charte du vêtement RÉELLEMENT VENDU.
 *
 * Le défaut que ces tests tiennent : la boutique vend des Gildan et des Fruit of
 * the Loom, et le gradient les gradait tous par la série du Stanley/Stella, seul
 * vêtement que `sizeChart.ts` connaisse. Mesuré sur le catalogue importé, le
 * rapport 3XL/S vaut 1,5556 sur le Gildan Heavy Cotton contre 1,3061 sur le
 * Stanley/Stella : un marquage calé sur le M sortait 19 % trop petit en 3XL.
 */
describe('shopSizeChart, la série du fabricant portée par le document', () => {
  // Gildan Heavy Cotton 18009, lue sur la fiche du fournisseur et importée
  // dans la boutique. Les valeurs sont en cm (la fiche est en pouces).
  const GILDAN = { S: 45.72, M: 50.8, L: 55.88, XL: 60.96, '2XL': 66.04, '3XL': 71.12 }

  it('grade par la série du fabricant, pas par celle du studio', () => {
    const studio = baseDesign()
    const gildan = baseDesign({ shopSizeChart: { garmentId: 'tee', productId: 1, halfChestCm: GILDAN } })
    // Le contrôle : la charte du studio donne 64/52, celle du Gildan 71,12/50,8.
    expect(printScaleK(studio, '3XL')).toBeCloseTo(64 / 52, 6)
    expect(printScaleK(gildan, '3XL')).toBeCloseTo(71.12 / 50.8, 6)
    // Et l'écart est celui qui a motivé le correctif, pas un epsilon.
    expect(printScaleK(gildan, '3XL') / printScaleK(studio, '3XL')).toBeGreaterThan(1.13)
  })

  it("ignore une série qui décrit un AUTRE vêtement que celui de la création", () => {
    // Un client ouvre l'éditeur sur un t-shirt Gildan puis bascule sur le sweat :
    // sans ce contrôle, la capuche serait gradée par la poitrine du t-shirt.
    const d = baseDesign({
      garmentId: 'hoodie',
      shopSizeChart: { garmentId: 'tee', productId: 1, halfChestCm: GILDAN },
    })
    expect(printScaleK(d, '3XL')).toBeCloseTo(
      SIZE_CHARTS.hoodie.sizes['3XL'].halfChestCm / SIZE_CHARTS.hoodie.sizes.M.halfChestCm,
      6,
    )
  })

  describe('elle est la seule source, ou elle n’est pas une source', () => {
    /*
     * Trouvé par la passe adversariale du 5 septembre 2026, et c'était un vrai
     * défaut : `halfChestCm` retombait taille par taille sur la charte du
     * studio, donc un rapport pouvait mélanger DEUX vêtements. La borne de
     * vraisemblance ne le voyait pas, parce que le rapport tordu n'est pas dans
     * la série, il est entre la série et la charte.
     */
    it('ne mélange pas une série courte avec la charte du studio', () => {
      // Le Fruit of the Loom Classic Hooded s'arrête au 2XL. Avant le correctif,
      // k(3XL) valait 64 / 50,8 = 1,2598 : le 3XL du Stanley/Stella divisé par
      // le M du Fruit of the Loom.
      const court = { S: 45.72, M: 50.8, L: 55.88, XL: 60.96, '2XL': 66.04 }
      const d = baseDesign({ shopSizeChart: { garmentId: 'tee', productId: 1, halfChestCm: court } })
      expect(printScaleK(d, '3XL')).toBe(1)
      expect(printScaleK(d, '2XL')).toBeCloseTo(66.04 / 50.8, 6)
    })

    it('refuse un rapport fabriqué entre la série et la charte', () => {
      // Chaque valeur est crédible, leur rapport aussi (1,04). Sur un document
      // calé en S, le 3XL venait de la charte du studio : k valait 2,56, un
      // transfert à deux fois et demie sa taille, découpé dans le film.
      const d = baseDesign({
        printScale: { mode: 'scaled', baseSize: 'S' },
        shopSizeChart: { garmentId: 'tee', productId: 1, halfChestCm: { S: 25, M: 26 } },
      })
      expect(printScaleK(d, '3XL')).toBe(1)
      expect(printScaleK(d, 'M')).toBeCloseTo(26 / 25, 6)
    })
  })

  it("ne grade pas une taille que la série du fabricant ne porte pas", () => {
    // Le Fruit of the Loom Classic Hooded s'arrête au 2XL. Grader un 3XL
    // ferait retomber k sur 1 en silence : un marquage de M sur un 3XL.
    const short = { S: 46, M: 51, L: 56, XL: 61, '2XL': 66 }
    const d = baseDesign({ shopSizeChart: { garmentId: 'tee', productId: 1, halfChestCm: short } })
    expect(gradableSizes(d)).toEqual(['S', 'M', 'L', 'XL', '2XL'])
    expect(gradableSizes(d)).not.toContain('3XL')
  })

  describe('refuse une série qui ne peut pas être une série', () => {
    const refused = (chart: Record<string, number>): boolean => {
      const d = baseDesign({ shopSizeChart: { garmentId: 'tee', productId: 1, halfChestCm: chart } })
      // Refusée veut dire : on retombe sur la charte du studio, à l'identique.
      return printScaleK(d, '3XL') === printScaleK(baseDesign(), '3XL')
    }

    it('une fiche laissée en pouces', () => {
      expect(refused({ S: 18, M: 20, L: 22, XL: 24, '2XL': 26, '3XL': 28 })).toBe(true)
    })

    it('des colonnes décalées à la lecture du PDF (la série ne monte pas)', () => {
      expect(refused({ S: 46, M: 51, L: 49, XL: 61, '2XL': 66, '3XL': 71 })).toBe(true)
    })

    it("un écart entre extrêmes qui n'est pas une gradation", () => {
      // Chaque valeur est plausible prise seule ; le rapport 3,3 ne l'est pas.
      expect(refused({ S: 27, M: 40, L: 55, XL: 70, '2XL': 80, '3XL': 90 })).toBe(true)
    })

    it('une seule taille, qui ne fait pas un rapport', () => {
      expect(refused({ M: 52 })).toBe(true)
    })

    it('et le refus est TOTAL, pas taille par taille', () => {
      // Le 3XL est hors plage ; les cinq autres sont bonnes. Grader cinq tailles
      // sur six ferait varier le marquage sans raison lisible.
      const d = baseDesign({
        shopSizeChart: { garmentId: 'tee', productId: 1, halfChestCm: { S: 46, M: 51, L: 56, XL: 61, '2XL': 66, '3XL': 210 },
        },
      })
      expect(printScaleK(d, 'L')).toBeCloseTo(printScaleK(baseDesign(), 'L'), 6)
      expect(gradableSizes(d)).toEqual([...SIZE_IDS])
    })
  })
})
