/**
 * Poser sur la création la grille de tailles du vêtement que la boutique vend.
 *
 * POURQUOI UN EFFET ET PAS LA PASSERELLE ELLE-MÊME. `src/lib/teeshoop/bridge.ts`
 * n'importe pas le magasin, et ne doit pas : elle démarre avant que React ait
 * monté quoi que ce soit, et elle tourne aussi dans les harnais de vérification
 * où il n'y a pas de magasin du tout. La palette traverse déjà de la même façon,
 * poussée dans un module sans dépendance (`setShopPalette`). Ici la destination
 * est le document, donc c'est le magasin qui écrit, et l'effet est la couture.
 *
 * POURQUOI IL DÉPEND DE `design.id` ET DE `hydrated`. Deux chemins amènent une
 * autre création sous nos pieds après l'arrivée du contexte : l'hydratation, qui
 * remplace la création d'amorçage par celle du stockage local, et l'ouverture
 * d'une création enregistrée, qui peut porter la série d'un AUTRE produit ou
 * aucune. Dans les deux cas la grille à appliquer est celle de la page ouverte
 * maintenant, pas celle qui dormait dans le document.
 */
import { useEffect } from 'react'
import { useStore } from '@/state/store'
import type { GarmentId } from '@/lib/types'
import { useShopBridge } from './useShopBridge'

/** Ce que l'éditeur sait dessiner. Le reste de la boutique n'arrive pas ici. */
const DRAWABLE: readonly GarmentId[] = ['tee', 'hoodie']

export function useShopSizeChart(): void {
  const { context } = useShopBridge()
  const hydrated = useStore((s) => s.hydrated)
  const designId = useStore((s) => s.design.id)
  const focusedLine = useStore((s) => s.board.focusedId)
  const applyShopSizeChart = useStore((s) => s.applyShopSizeChart)

  useEffect(() => {
    if (!hydrated || !context) return
    /*
     * UNE LIGNE DU PANIER APPARTIENT À UNE AUTRE OFFRE.
     *
     * `focusLine` remplace `design` par l'instantané d'une ligne, avec son
     * propre identifiant, donc cet effet se redéclenche sur un document que la
     * page ouverte n'a pas produit. Y écrire la série de la page en cours, puis
     * laisser `flushFocusedLine` la réécrire dans le panier, contaminerait une
     * ligne faite ailleurs. Trouvé par la passe adversariale du 5 septembre 2026.
     * `setPreviewSize` saute déjà l'enregistrement des préférences pour cette
     * raison exacte.
     */
    if (focusedLine) return
    const garment = context.garment
    /*
     * Un vêtement que le studio ne dessine pas ne reçoit pas de charte : la
     * série serait posée sous un `garmentId` qui ne vaudra jamais celui de la
     * création, donc elle ne servirait jamais, et une donnée morte sur le
     * document est une donnée qui finira par être lue par erreur.
     *
     * L'appel est fait MÊME quand la série est vide : c'est ce qui EFFACE celle
     * d'une offre précédente. Voir `applyShopSizeChart`.
     */
    if (!DRAWABLE.includes(garment as GarmentId)) return
    applyShopSizeChart(garment as GarmentId, context.productId, context.sizeChart)
  }, [context, hydrated, designId, focusedLine, applyShopSizeChart])
}
