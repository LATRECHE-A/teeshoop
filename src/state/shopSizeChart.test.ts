/**
 * La série du fabricant posée sur la création, et ce qu'elle ne doit PAS faire.
 *
 * Elle n'est pas un geste du client : elle arrive de la fiche du fabricant par
 * la passerelle, au moment où l'éditeur s'ouvre. Deux choses en découlent, et
 * chacune a coûté un défaut ailleurs dans ce dépôt : elle ne date pas le
 * document, et elle ne fait pas d'entrée dans l'historique. Sans la seconde, un
 * client qui appuie sur annuler juste après l'ouverture repasserait au gradient
 * du studio sans que rien ne le dise.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './store'
import { printScaleK } from '@/lib/printScale'

/** Le Gildan Heavy Cotton 18009, tel que la boutique l'envoie. */
const GILDAN = { S: 45.72, M: 50.8, L: 55.88, XL: 60.96, '2XL': 66.04, '3XL': 71.12 }

const history = () => useStore.temporal.getState().pastStates.length

describe('applyShopSizeChart', () => {
  beforeEach(() => {
    useStore.getState().newDesign()
  })

  it('grade la création par la série reçue', () => {
    useStore.getState().applyShopSizeChart('tee', 42, GILDAN)
    expect(printScaleK(useStore.getState().design, '3XL')).toBeCloseTo(71.12 / 50.8, 6)
  })

  it("ne fait aucune entrée d'historique, donc annuler ne l'enlève pas", () => {
    const before = history()
    useStore.getState().applyShopSizeChart('tee', 42, GILDAN)
    expect(history()).toBe(before)
  })

  it("ne jette pas l'historique déjà là", () => {
    // Le cas réel : le client ouvre une création enregistrée, dessine, et la
    // série arrive ensuite parce que l'effet se redéclenche sur le changement
    // de création. `clear()` lui prendrait son travail.
    useStore.getState().setColor('black')
    const before = history()
    expect(before).toBeGreaterThan(0)
    useStore.getState().applyShopSizeChart('tee', 42, GILDAN)
    expect(history()).toBe(before)
  })

  it('laisse repartir l’historique après elle', () => {
    useStore.getState().applyShopSizeChart('tee', 42, GILDAN)
    const before = history()
    useStore.getState().setColor('navy')
    expect(history()).toBe(before + 1)
  })

  it('déplace la date, parce que deux caches identifient la géométrie par elle', () => {
    /*
     * `src/app/board/mockupCache.ts` et `DtfModal` construisent leur clé avec
     * `design.updatedAt`. La série change le facteur de gradation ; laisser la
     * date en place ferait fusionner deux lignes du panier faites sur deux
     * vêtements différents, et pressait vingt transferts au facteur de dix
     * d'entre eux. Trouvé par la passe adversariale du 5 septembre 2026.
     */
    const at = useStore.getState().design.updatedAt
    useStore.getState().applyShopSizeChart('tee', 42, GILDAN)
    expect(useStore.getState().design.updatedAt).toBeGreaterThan(at - 1)
    expect(useStore.getState().design.updatedAt).not.toBe(at - 1)
  })

  it('efface la série quand la page suivante n’en publie pas', () => {
    /*
     * Le chemin mesuré : une création faite sur un Gildan (1,4000) rouverte sur
     * une offre sans fiche. La boutique validait le placement avec
     * `garments.json` (1,2295) pendant que le film était découpé à 1,4000 :
     * 35,0 cm de transfert sur un film de 33 cm, payé et impressable.
     */
    useStore.getState().applyShopSizeChart('tee', 42, GILDAN)
    expect(useStore.getState().design.shopSizeChart).toBeTruthy()
    useStore.getState().applyShopSizeChart('tee', 43, {})
    expect(useStore.getState().design.shopSizeChart).toBeUndefined()
    expect(printScaleK(useStore.getState().design, '3XL')).toBeCloseTo(64 / 52, 6)
  })

  it('ne réécrit rien quand il n’y avait déjà pas de série', () => {
    const design = useStore.getState().design
    useStore.getState().applyShopSizeChart('tee', 44, {})
    expect(useStore.getState().design).toBe(design)
  })

  it('remplace la série quand c’est la même fiche sur une AUTRE offre', () => {
    // Deux offres peuvent porter la même série et rester deux offres : c'est
    // l'identifiant du produit qui dit à qui la création appartient.
    useStore.getState().applyShopSizeChart('tee', 42, GILDAN)
    useStore.getState().applyShopSizeChart('tee', 99, GILDAN)
    expect(useStore.getState().design.shopSizeChart?.productId).toBe(99)
  })

  it('ne réécrit rien quand la série posée est déjà la même', () => {
    useStore.getState().applyShopSizeChart('tee', 42, GILDAN)
    const design = useStore.getState().design
    useStore.getState().applyShopSizeChart('tee', 42, { ...GILDAN })
    expect(useStore.getState().design).toBe(design)
  })

  it('remplace la série quand le client ouvre un autre produit', () => {
    const fotl = { S: 46, M: 51, L: 56, XL: 61, '2XL': 66, '3XL': 71 }
    useStore.getState().applyShopSizeChart('tee', 42, GILDAN)
    useStore.getState().applyShopSizeChart('tee', 43, fotl)
    expect(useStore.getState().design.shopSizeChart?.halfChestCm).toEqual(fotl)
  })
})
