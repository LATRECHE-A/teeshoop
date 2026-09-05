/**
 * The size chart is the one dimensional source of truth: 2D placement, the 3D
 * body, the AR figure and the DTF piece sizes all derive from it. A transposed
 * digit in a hand-entered manufacturer table is silent on screen and arrives at
 * a heat press.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SIZE,
  garmentWidthInFor,
  isSizeId,
  readHalfChestSeries,
  SIZE_CHARTS,
  SIZE_IDS,
  sizeScale,
  sizeSpecCm,
} from './sizeChart'

const GARMENTS = Object.keys(SIZE_CHARTS) as (keyof typeof SIZE_CHARTS)[]

describe('coverage', () => {
  it('every garment has a finite, positive spec for every size', () => {
    for (const g of GARMENTS)
      for (const s of SIZE_IDS) {
        const spec = sizeSpecCm(g, s)
        for (const key of ['halfChestCm', 'bodyLengthCm', 'sleeveLengthCm'] as const) {
          expect(Number.isFinite(spec[key]), `${g}/${s}.${key}`).toBe(true)
          expect(spec[key], `${g}/${s}.${key}`).toBeGreaterThan(0)
        }
      }
  })

  it('the default size is a real size', () => {
    expect(isSizeId(DEFAULT_SIZE)).toBe(true)
    expect(SIZE_IDS).toContain(DEFAULT_SIZE)
  })

  it('isSizeId is a real guard, not a cast', () => {
    for (const s of SIZE_IDS) expect(isSizeId(s)).toBe(true)
    for (const bad of ['XXL', 'm', '', '4XL', null, undefined, 0, {}])
      expect(isSizeId(bad)).toBe(false)
  })
})

describe('ordering', () => {
  it('chest and body length increase strictly with size', () => {
    for (const g of GARMENTS)
      for (let i = 1; i < SIZE_IDS.length; i++) {
        const prev = sizeSpecCm(g, SIZE_IDS[i - 1])
        const cur = sizeSpecCm(g, SIZE_IDS[i])
        expect(cur.halfChestCm, `${g} ${SIZE_IDS[i]} chest`).toBeGreaterThan(prev.halfChestCm)
        expect(cur.bodyLengthCm, `${g} ${SIZE_IDS[i]} length`).toBeGreaterThan(prev.bodyLengthCm)
      }
  })

  it('sleeve length never decreases (real charts repeat it between sizes)', () => {
    for (const g of GARMENTS)
      for (let i = 1; i < SIZE_IDS.length; i++)
        expect(
          sizeSpecCm(g, SIZE_IDS[i]).sleeveLengthCm,
          `${g} ${SIZE_IDS[i]} sleeve`,
        ).toBeGreaterThanOrEqual(sizeSpecCm(g, SIZE_IDS[i - 1]).sleeveLengthCm)
  })
})

describe('derivations', () => {
  it('the nominal size is exactly unscaled: the art is authored there', () => {
    for (const g of GARMENTS) {
      const scale = sizeScale(g, SIZE_CHARTS[g].nominal)
      expect(scale.sx).toBe(1)
      expect(scale.sy).toBe(1)
      expect(scale.sleeve).toBe(1)
    }
  })

  it('inches come from cm by the one conversion, never a second table', () => {
    for (const g of GARMENTS)
      for (const s of SIZE_IDS)
        expect(garmentWidthInFor(g, s) * 2.54).toBeCloseTo(sizeSpecCm(g, s).halfChestCm, 12)
  })
})


/**
 * La lecture d'une série venue d'ailleurs.
 *
 * Ce nombre décide de la taille physique d'un marquage : `printScaleK` en fait
 * un facteur d'échelle appliqué au film. Il arrive de la fiche d'un fabricant,
 * lue par un script, transportée par la passerelle, puis stockée dans un
 * document que le navigateur du client dépose sur une route ouverte. Trois
 * occasions de recevoir autre chose qu'une série.
 */
describe('readHalfChestSeries', () => {
  const GILDAN = { S: 45.72, M: 50.8, L: 55.88, XL: 60.96, '2XL': 66.04, '3XL': 71.12 }

  it('rend une vraie série intacte', () => {
    expect(readHalfChestSeries(GILDAN)).toEqual(GILDAN)
  })

  it('laisse tomber les tailles que le studio ne dessine pas', () => {
    // Les fiches fournisseur portent du XS au 5XL ; l'éditeur va du S au 3XL.
    expect(readHalfChestSeries({ ...GILDAN, XS: 40.64, '5XL': 86.36 })).toEqual(GILDAN)
  })

  it('accepte une série plus courte que celle du studio', () => {
    // Le Fruit of the Loom Classic Hooded s'arrête au 2XL, et c'est un vêtement
    // réel : le refuser retirerait la gradation d'une vraie référence.
    const courte = { S: 46, M: 51, L: 56, XL: 61, '2XL': 66 }
    expect(readHalfChestSeries(courte)).toEqual(courte)
  })

  it('refuse en bloc, jamais taille par taille', () => {
    // Cinq valeurs bonnes et une hors plage : grader cinq tailles sur six ferait
    // varier le marquage d'une taille à l'autre sans raison lisible.
    expect(readHalfChestSeries({ ...GILDAN, '3XL': 210 })).toEqual({})
  })

  it('refuse une fiche restée en pouces', () => {
    expect(readHalfChestSeries({ S: 18, M: 20, L: 22, XL: 24, '2XL': 26, '3XL': 28 })).toEqual({})
  })

  it('refuse une série qui ne monte pas', () => {
    expect(readHalfChestSeries({ S: 46, M: 51, L: 49, XL: 61, '2XL': 66, '3XL': 71 })).toEqual({})
  })

  it("refuse un écart entre extrêmes qui n'est pas une gradation", () => {
    // Chaque valeur est plausible seule ; le rapport 3,3 ne l'est pas.
    expect(readHalfChestSeries({ S: 27, M: 40, L: 55, XL: 70, '2XL': 80, '3XL': 90 })).toEqual({})
  })

  it('refuse une seule taille, qui ne fait pas un rapport', () => {
    expect(readHalfChestSeries({ M: 52 })).toEqual({})
  })

  it('rend un objet vide sur tout ce qui n\'est pas un objet', () => {
    for (const junk of [null, undefined, 'oui', 12, [1, 2], true])
      expect(readHalfChestSeries(junk)).toEqual({})
  })

  it('accepte les deux chartes du studio, ce qui est le contrôle de ses bornes', () => {
    // Une règle qui refuserait nos propres vêtements serait mal réglée.
    for (const g of GARMENTS) {
      const series = Object.fromEntries(
        SIZE_IDS.map((s) => [s, sizeSpecCm(g, s).halfChestCm]),
      )
      expect(readHalfChestSeries(series)).toEqual(series)
    }
  })
})
