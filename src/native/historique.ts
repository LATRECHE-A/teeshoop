/**
 * Annuler et rétablir, sur le document de création.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * UNE PILE D'ÉTATS, ET PAS UNE PILE DE COMMANDES INVERSABLES
 *
 * Le document est immuable par construction : chaque modification de
 * `src/native/editeur.ts` fabrique un nouvel objet `Design` et réutilise les
 * calques qu'elle ne touche pas. Retenir l'état d'avant coûte donc un objet et
 * un tableau, jamais une copie des visuels : un calque image porte un `assetId`
 * et les octets vivent dans IndexedDB.
 *
 * Une pile de commandes inversables aurait demandé d'écrire l'inverse de chaque
 * opération, c'est-à-dire une SECONDE implémentation de chaque règle de
 * placement, et le jour où l'une des deux dérive le client voit son visuel
 * revenir ailleurs qu'où il était. `CLAUDE.md` section 1.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LE GESTE, ET POURQUOI IL FAUT LE NOMMER
 *
 * `EditorEngine` émet un correctif de position toutes les 66 ms pendant qu'un
 * doigt glisse, et le champ de texte en émet un par frappe. Sans regroupement,
 * déplacer un visuel une fois demanderait une quinzaine d'annulations et écrire
 * « TEESHOOP » huit. `avant(etat, geste)` n'enregistre donc que le PREMIER état
 * d'un geste nommé ; `fin()` le referme, et la modification suivante repart sur
 * un pas neuf.
 *
 * Ce module ne connaît ni le DOM ni le document : il est écrit ici pour être
 * exécutable par `src/native/historique.test.ts`, parce que le reste de
 * l'éditeur demande un navigateur et que `vitest` tourne en `node`.
 */

/**
 * Combien de pas en arrière, et pourquoi ce nombre-là.
 *
 * Une entrée pèse un objet et un tableau de références (voir l'en-tête), donc
 * la borne n'est pas là pour la mémoire d'un pas : elle est là parce qu'une
 * séance d'une heure passée à pousser un visuel au clavier en produirait un par
 * frappe et que rien ne les libérerait. Cinquante est au-delà de ce que
 * quiconque défait pas à pas ; ce qui compte n'est pas la valeur exacte, c'est
 * qu'il y en ait une.
 */
export const PROFONDEUR = 50

export class Historique<T> {
  private readonly passe: T[] = []
  private readonly futur: T[] = []
  private geste: string | null = null
  private readonly profondeur: number

  constructor(profondeur: number = PROFONDEUR) {
    this.profondeur = Math.max(1, Math.trunc(profondeur))
  }

  get peutAnnuler(): boolean {
    return this.passe.length > 0
  }

  get peutRetablir(): boolean {
    return this.futur.length > 0
  }

  /** Pour le test et pour la borne : combien de pas sont retenus. */
  get pas(): { arriere: number; avant: number } {
    return { arriere: this.passe.length, avant: this.futur.length }
  }

  /**
   * Enregistrer l'état d'AVANT une modification.
   *
   * Avec un `geste`, le premier appel enregistre et les suivants du même nom ne
   * font rien : un glissement, une frappe continue, un pas d'historique.
   */
  avant(etat: T, geste?: string): void {
    if (geste !== undefined && this.geste === geste) return
    this.passe.push(etat)
    if (this.passe.length > this.profondeur) this.passe.shift()
    /*
     * ET LA PILE DE RÉTABLISSEMENT MEURT ICI.
     *
     * Après trois annulations, une nouvelle modification crée une branche : ce
     * qui avait été annulé n'est plus atteignable, et un bouton « Rétablir »
     * qui ramènerait l'autre branche rendrait un document que le client n'a
     * jamais construit.
     */
    this.futur.length = 0
    this.geste = geste ?? null
  }

  /** Refermer le geste en cours : la modification suivante sera un pas à part. */
  fin(): void {
    this.geste = null
  }

  /** L'état d'avant, ou rien. `courant` part sur la pile de rétablissement. */
  annuler(courant: T): T | null {
    this.geste = null
    const precedent = this.passe.pop()
    if (precedent === undefined) return null
    this.futur.push(courant)
    if (this.futur.length > this.profondeur) this.futur.shift()
    return precedent
  }

  /** L'état annulé, ou rien. `courant` repart sur la pile d'annulation. */
  retablir(courant: T): T | null {
    this.geste = null
    const suivant = this.futur.pop()
    if (suivant === undefined) return null
    this.passe.push(courant)
    if (this.passe.length > this.profondeur) this.passe.shift()
    return suivant
  }

  /**
   * Abandonner le geste en cours et rendre l'état d'avant, sans laisser de pas.
   *
   * C'est la touche Échap du champ de texte : le client revient à ce qu'il
   * avait avant de commencer à taper, et cette frappe abandonnée n'a pas à
   * occuper un pas d'historique qui ne ferait rien de visible.
   *
   * Le rétablissement n'est PAS restauré : il a été vidé quand le geste a
   * commencé, et le ressusciter demanderait de retenir une branche que le
   * client a quittée.
   */
  abandonner(): T | null {
    if (this.geste === null) return null
    this.geste = null
    return this.passe.pop() ?? null
  }
}
