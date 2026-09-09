/**
 * Annuler et rétablir, relu.
 *
 * Ce module existe séparé de `src/native/editeur.ts` pour être exécutable :
 * l'éditeur demande un navigateur (Konva, un canevas, `ResizeObserver`) et
 * `vitest` tourne en `node`. Ce qui est testé ici est donc exactement le code
 * qui tourne chez le client, et pas une seconde écriture de la même règle.
 *
 * Les deux défauts qu'un historique attrape mal se trouvent ici :
 *
 *   un geste continu (glisser un visuel, taper un mot) enregistré une fois par
 *   image ou par caractère, si bien qu'annuler un mot de huit lettres demande
 *   huit annulations et vide la pile de tout le reste ;
 *
 *   une pile de rétablissement qui survit à une nouvelle modification, donc un
 *   bouton « Rétablir » qui rend un document que le client n'a jamais construit.
 */
import { describe, expect, it } from 'vitest'
import { Historique, PROFONDEUR } from './historique'

describe('l’historique : les pas ordinaires', () => {
  it('ne propose rien tant que rien n’a été fait', () => {
    const h = new Historique<string>()
    expect(h.peutAnnuler).toBe(false)
    expect(h.peutRetablir).toBe(false)
    expect(h.annuler('a')).toBeNull()
    expect(h.retablir('a')).toBeNull()
  })

  it('rend l’état d’avant, puis le reprend', () => {
    const h = new Historique<string>()
    h.avant('a')
    expect(h.peutAnnuler).toBe(true)
    expect(h.annuler('b')).toBe('a')
    expect(h.peutAnnuler).toBe(false)
    expect(h.peutRetablir).toBe(true)
    expect(h.retablir('a')).toBe('b')
    expect(h.peutRetablir).toBe(false)
  })

  it('remonte plusieurs pas dans l’ordre', () => {
    const h = new Historique<string>()
    h.avant('a')
    h.avant('b')
    h.avant('c')
    expect(h.annuler('d')).toBe('c')
    expect(h.annuler('c')).toBe('b')
    expect(h.annuler('b')).toBe('a')
    expect(h.annuler('a')).toBeNull()
  })

  /*
   * LA BRANCHE ABANDONNÉE NE REVIENT PAS. Après une annulation, une nouvelle
   * modification rend le rétablissement inatteignable : le proposer quand même
   * rendrait au client un document qu'il n'a jamais eu sous les yeux.
   */
  it('oublie ce qui était rétablissable dès qu’on modifie autre chose', () => {
    const h = new Historique<string>()
    h.avant('a')
    expect(h.annuler('b')).toBe('a')
    expect(h.peutRetablir).toBe(true)
    h.avant('a')
    expect(h.peutRetablir).toBe(false)
    expect(h.retablir('x')).toBeNull()
  })
})

describe('l’historique : le geste, un mouvement un pas', () => {
  it('n’enregistre qu’une fois pour un geste qui dure', () => {
    const h = new Historique<string>()
    // Huit frappes dans le champ de texte, ou une quinzaine d'images d'un
    // glissement : c'est le même geste et c'est un seul pas.
    for (const etat of ['a', 'ab', 'abc', 'abcd']) h.avant(etat, 'texte:1')
    expect(h.pas.arriere).toBe(1)
    expect(h.annuler('abcde')).toBe('a')
  })

  it('sépare deux gestes différents', () => {
    const h = new Historique<string>()
    h.avant('a', 'deplacer:1')
    h.avant('b', 'deplacer:2')
    expect(h.pas.arriere).toBe(2)
  })

  it('rouvre un pas après fin(), même sous le même nom', () => {
    const h = new Historique<string>()
    h.avant('a', 'texte:1')
    h.fin()
    h.avant('b', 'texte:1')
    expect(h.pas.arriere).toBe(2)
    expect(h.annuler('c')).toBe('b')
    expect(h.annuler('b')).toBe('a')
  })

  it('une modification isolée n’est jamais absorbée par le geste d’avant', () => {
    const h = new Historique<string>()
    h.avant('a', 'texte:1')
    h.avant('b')
    expect(h.pas.arriere).toBe(2)
  })

  it('annuler referme le geste en cours', () => {
    const h = new Historique<string>()
    h.avant('a', 'texte:1')
    expect(h.annuler('b')).toBe('a')
    h.avant('a', 'texte:1')
    expect(h.pas.arriere).toBe(1)
  })
})

describe('l’historique : Échap abandonne le geste', () => {
  it('rend l’état d’avant le geste et ne laisse pas de pas', () => {
    const h = new Historique<string>()
    h.avant('depart', 'texte:1')
    h.avant('depa', 'texte:1')
    expect(h.abandonner()).toBe('depart')
    expect(h.pas.arriere).toBe(0)
    expect(h.peutAnnuler).toBe(false)
  })

  it('ne fait rien quand aucun geste n’est en cours', () => {
    const h = new Historique<string>()
    h.avant('a')
    expect(h.abandonner()).toBeNull()
    expect(h.pas.arriere).toBe(1)
  })

  it('n’abandonne pas deux fois de suite', () => {
    const h = new Historique<string>()
    h.avant('a')
    h.avant('b', 'texte:1')
    expect(h.abandonner()).toBe('b')
    expect(h.abandonner()).toBeNull()
    expect(h.pas.arriere).toBe(1)
  })
})

describe('l’historique : la borne', () => {
  it('garde les derniers pas et laisse tomber les plus vieux', () => {
    const h = new Historique<number>(3)
    for (let i = 0; i < 10; i += 1) h.avant(i)
    expect(h.pas.arriere).toBe(3)
    expect(h.annuler(10)).toBe(9)
    expect(h.annuler(9)).toBe(8)
    expect(h.annuler(8)).toBe(7)
    expect(h.annuler(7)).toBeNull()
  })

  it('borne aussi la pile de rétablissement', () => {
    const h = new Historique<number>(2)
    h.avant(1)
    h.avant(2)
    h.annuler(3)
    h.annuler(2)
    expect(h.pas.avant).toBe(2)
  })

  /*
   * LA PROFONDEUR PAR DÉFAUT EST UNE VALEUR DE PRODUIT, PAS UN NOMBRE QU'ON
   * RÉÉCRIT ICI : ce test lit la constante exportée, donc il suit si elle
   * change, et ce qu'il vérifie est qu'elle est appliquée.
   */
  it('applique la profondeur par défaut', () => {
    const h = new Historique<number>()
    for (let i = 0; i < PROFONDEUR + 5; i += 1) h.avant(i)
    expect(h.pas.arriere).toBe(PROFONDEUR)
  })
})
