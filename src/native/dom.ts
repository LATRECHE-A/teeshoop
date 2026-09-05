/**
 * Deux fonctions, et la raison pour laquelle il n'y en a pas trois.
 *
 * L'éditeur natif n'a pas de cadriciel : il tourne dans la page d'une boutique
 * WordPress, sous un thème que nous ne possédons pas, et le prix d'un React
 * embarqué serait une remise à zéro de style ou une seconde copie de celle du
 * thème. Ce qu'il faut à la place tient en « créer un élément avec une classe »
 * et « le vider sans laisser d'écouteur derrière ».
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IL N'Y A PAS DE FONCTION QUI POSE DU HTML, ET C'EST DÉLIBÉRÉ.
 *
 * Tout ce que cet éditeur affiche vient d'ailleurs : le nom d'un coloris vient
 * de la base de la boutique, une phrase de refus vient de `Cart::add`, le nom
 * d'un fichier vient du client. Un seul `innerHTML` quelque part et l'une de
 * ces trois sources devient une injection. `textContent` partout supprime la
 * question, et l'absence d'un helper `html()` supprime la tentation.
 */

/** Un élément, typé, avec sa classe. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

/**
 * Vider un noeud.
 *
 * `replaceChildren()` et non `innerHTML = ''` : le second reparse une chaîne
 * vide et, sur les noeuds détachés, laisse les enfants vivants dans certains
 * navigateurs. Le premier détache, ce qui rend les écouteurs des enfants
 * collectables sans qu'on ait à les retirer un par un.
 */
export function vider(node: Element): void {
  node.replaceChildren()
}
