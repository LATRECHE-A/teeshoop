/**
 * Le contraste, relu contre la norme et contre les mesures déjà faites ici.
 *
 * Ce module produit un nombre qu'un client lit, à côté d'un coloris qu'il est
 * en train d'acheter. Il ne peut donc pas être vérifié « à l'oeil » : les
 * valeurs ci-dessous viennent de WCAG 2.2 (le rapport noir sur blanc, qui vaut
 * 21 par construction de la formule) et de `wp-plugins/teeshoop-core/assets/
 * tokens.css`, où les contrastes de la charte ont été mesurés et écrits en
 * commentaire avant que ce fichier existe. Retomber sur les mêmes chiffres avec
 * une autre implémentation est ce qui prouve la formule.
 */
import { describe, expect, it } from 'vitest'
import { lisibiliteSur, luminance, rapport, rvb, type Encre } from './contraste'

/** Une encre synthétique : des pixels (r, g, b, a) répétés `n` fois. */
function encreDe(...groupes: [number, number, number, number, number][]): Encre {
  const total = groupes.reduce((s, g) => s + g[4], 0)
  const pixels = new Uint8Array(total * 4)
  let i = 0
  let couverture = 0
  for (const [r, g, b, a, n] of groupes) {
    for (let k = 0; k < n; k++) {
      pixels[i] = r
      pixels[i + 1] = g
      pixels[i + 2] = b
      pixels[i + 3] = a
      i += 4
      couverture += a / 255
    }
  }
  return { pixels, couverture }
}

describe('la luminance relative et le rapport de WCAG', () => {
  it('rend 0 pour le noir et 1 pour le blanc', () => {
    expect(luminance(0, 0, 0)).toBe(0)
    expect(luminance(255, 255, 255)).toBeCloseTo(1, 10)
  })

  it('rend 21 pour noir sur blanc, la borne haute de la norme', () => {
    expect(rapport(luminance(255, 255, 255), luminance(0, 0, 0))).toBeCloseTo(21, 6)
  })

  it('rend 1 pour une couleur sur elle-même', () => {
    const l = luminance(0x01, 0x00, 0x50)
    expect(rapport(l, l)).toBe(1)
  })

  /*
   * LES DEUX MESURES QUE LA CHARTE PORTE DÉJÀ. `--ts-muted: #767676` est annoté
   * « on paper 4,54:1 » et `--ts-warn: #a85b00` « 5,05:1 », tous deux sur blanc.
   * Ce sont des nombres écrits par quelqu'un d'autre, avec un autre outil, et
   * les retrouver ici est la seule vérification qui ne se contente pas de
   * comparer ce module à lui-même.
   */
  it('retrouve les contrastes que la charte a mesurés', () => {
    const surBlanc = (hex: string): number => {
      const c = rvb(hex)
      if (!c) throw new Error(hex)
      return rapport(luminance(255, 255, 255), luminance(c[0], c[1], c[2]))
    }
    expect(surBlanc('#767676')).toBeCloseTo(4.54, 2)
    expect(surBlanc('#a85b00')).toBeCloseTo(5.05, 2)
  })

  it('refuse ce qui n’est pas un hexadécimal à six chiffres', () => {
    expect(rvb('#fff')).toBeNull()
    expect(rvb('rouge')).toBeNull()
    expect(rvb('#0a1b3d')).toEqual([10, 27, 61])
  })
})

describe('la part d’encre qui passe sous le seuil', () => {
  it('déclare lisible un visuel noir sur un vêtement blanc', () => {
    const v = lisibiliteSur(encreDe([0, 0, 0, 255, 100]), '#ffffff')
    expect(v).toEqual({ etat: 'lisible', part: 0 })
  })

  it('déclare faible un anthracite sur un noir', () => {
    const v = lisibiliteSur(encreDe([0x22, 0x22, 0x22, 255, 100]), '#111111')
    expect(v.etat).toBe('faible')
  })

  /*
   * LE LISERÉ. Un visuel blanc cerné d'un filet noir sur un vêtement noir se lit
   * parfaitement : le filet échoue au seuil et ne pèse qu'un dixième de l'encre.
   * C'est le cas qui interdit d'avertir dès le premier pixel en échec.
   */
  it('ne s’alarme pas d’un filet noir autour d’un visuel blanc, sur du noir', () => {
    const v = lisibiliteSur(
      encreDe([255, 255, 255, 255, 90], [0, 0, 0, 255, 10]),
      '#000000',
    )
    expect(v.etat).toBe('lisible')
    expect(v.etat === 'lisible' ? v.part : -1).toBeCloseTo(0.1, 6)
  })

  it('et s’alarme quand le rapport s’inverse', () => {
    const v = lisibiliteSur(
      encreDe([255, 255, 255, 255, 10], [0, 0, 0, 255, 90]),
      '#000000',
    )
    expect(v.etat).toBe('faible')
    expect(v.etat === 'faible' ? v.part : -1).toBeCloseTo(0.9, 6)
  })

  /*
   * L'ALPHA COMPTE DEUX FOIS : il compose la couleur ET il pondère la part. Une
   * ombre portée noire à 10 % sur un vêtement blanc arrive en gris très clair,
   * donc sous le seuil ; juger sa couleur brute l'aurait comptée comme du noir
   * parfaitement contrasté, ce qui est l'inverse de ce que l'oeil reçoit.
   */
  it('juge un pixel sur ce qu’il devient une fois posé sur le tissu', () => {
    const brut = lisibiliteSur(encreDe([0, 0, 0, 255, 100]), '#ffffff')
    const voile = lisibiliteSur(encreDe([0, 0, 0, 26, 100]), '#ffffff')
    expect(brut.etat).toBe('lisible')
    expect(voile.etat).toBe('faible')
  })

  it('pondère par la couverture et pas par le nombre de pixels', () => {
    // Autant de pixels blancs que de noirs, mais les noirs ne déposent qu'un
    // dixième d'encre : la part sous le seuil suit l'encre, pas le compte.
    const v = lisibiliteSur(
      encreDe([255, 255, 255, 255, 50], [0, 0, 0, 26, 50]),
      '#000000',
    )
    expect(v.etat).toBe('lisible')
  })
})

/*
 * « JE N'AI PAS PU REGARDER » N'EST PAS « C'EST BON », et c'est le troisième
 * état. Sans lui, un canevas taché par un actif d'une autre origine ferait
 * afficher un silence que le client lirait comme un feu vert.
 */
describe('le troisième état', () => {
  it('rend inconnu quand le recensement a échoué', () => {
    expect(lisibiliteSur(null, '#ffffff')).toEqual({ etat: 'inconnu' })
  })

  it('rend inconnu quand la teinte du vêtement n’est pas une mesure', () => {
    expect(lisibiliteSur(encreDe([0, 0, 0, 255, 10]), 'blanc')).toEqual({ etat: 'inconnu' })
  })

  it('rend inconnu quand il n’y a aucune encre à juger', () => {
    expect(lisibiliteSur({ pixels: new Uint8Array(0), couverture: 0 }, '#ffffff')).toEqual({
      etat: 'inconnu',
    })
  })
})
