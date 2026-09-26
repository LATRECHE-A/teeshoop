/**
 * Les modèles sauvegardés, côté atelier : ce qu'un document relu devient avant
 * d'être posé sur le vêtement ouvert, et la liste relue comme une donnée venue
 * d'ailleurs.
 *
 * Le document vient du Worker, à travers la boutique : il a été écrit par notre
 * propre éditeur, mais peut-être par une version plus ancienne, et il traverse
 * deux frontières. Ce qui ne peut pas être posé est écarté ET compté, pour que
 * l'écran le dise au lieu de le taire.
 */
import { describe, expect, it } from 'vitest'
import { calquesDuModele, imagesDuModele, lireListe } from './atelier'

const IMG = { id: 'c1', type: 'image', side: 'front', xIn: 1, yIn: -2, assetId: 'origine', useCutout: true }
const TXT = { id: 'c2', type: 'text', side: 'back', xIn: 0, yIn: 0, text: 'Club' }

describe('calquesDuModele', () => {
  it('pointe chaque image vers sa copie locale et lit ses octets tels quels', () => {
    const { calques, ecartes } = calquesDuModele({ layers: [IMG, TXT] }, new Map([['origine', 'locale']]), ['front', 'back'])
    expect(ecartes).toBe(0)
    expect(calques).toHaveLength(2)
    expect(calques[0]).toMatchObject({ assetId: 'locale', useCutout: false, xIn: 1, yIn: -2 })
    expect(calques[1]).toMatchObject({ type: 'text', text: 'Club' })
  })

  it('écarte et compte une face que ce produit n’accepte pas', () => {
    const { calques, ecartes } = calquesDuModele({ layers: [IMG, TXT] }, new Map([['origine', 'locale']]), ['front'])
    expect(calques.map((c) => c.id)).toEqual(['c1'])
    expect(ecartes).toBe(1)
  })

  it('écarte une image qui n’a pas été rapatriée plutôt que de poser un calque vide', () => {
    const { calques, ecartes } = calquesDuModele({ layers: [IMG] }, new Map(), ['front'])
    expect(calques).toEqual([])
    expect(ecartes).toBe(1)
  })

  it('écarte ce qui n’est pas un calque connu, ou n’a pas de coordonnées', () => {
    const bruit = [
      null,
      'x',
      { ...TXT, type: 'video' },
      { ...TXT, xIn: 'milieu' },
      { ...TXT, yIn: Number.NaN },
      { ...TXT, id: 3 },
    ]
    const { calques, ecartes } = calquesDuModele({ layers: bruit }, new Map(), ['front', 'back'])
    expect(calques).toEqual([])
    expect(ecartes).toBe(bruit.length)
  })

  it('rend une liste vide pour un document sans calques', () => {
    expect(calquesDuModele({}, new Map(), ['front'])).toEqual({ calques: [], ecartes: 0 })
  })
})

describe('imagesDuModele', () => {
  it('nomme chaque image une fois, et rien d’autre', () => {
    const doc = { layers: [IMG, { ...IMG, id: 'c3' }, TXT, { ...IMG, id: 'c4', assetId: '../x' }] }
    expect(imagesDuModele(doc)).toEqual(['origine'])
  })
})

describe('lireListe', () => {
  it('écarte une entrée dont l’identifiant n’est pas une création, et un aperçu qui n’est pas une adresse', () => {
    const l = lireListe({
      modeles: [
        { id: 'aZ09_-aZ09_-aZ09_-', nom: 'Club', garment: 'tee', apercu: 'javascript:alert(1)', cree: '' },
        { id: 'court', nom: 'x' },
        'pas un objet',
      ],
      total: '3',
      max: '7',
    })
    expect(l.modeles).toHaveLength(1)
    expect(l.modeles[0].apercu).toBe('')
    expect(l.total).toBe(3)
    expect(l.max).toBe(7)
  })
})
