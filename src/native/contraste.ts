/**
 * Est-ce que ce visuel se verra sur ce tissu ?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI CETTE QUESTION EST DANS LA BOUTIQUE ET PAS DANS LA TÊTE DU CLIENT
 *
 * Un client choisit son coloris sur une pastille de 36 px et son visuel sur son
 * ordinateur. Rien, sur cet écran, ne lui dit qu'un logo anthracite sur un
 * t-shirt noir sortira de presse illisible : le film sera parfait, la commande
 * conforme, et le colis reviendra. Ce module mesure la question avant le
 * paiement et la POSE, en français, à côté du coloris concerné.
 *
 * IL NE REFUSE RIEN. Un contraste faible est un choix légitime (un marquage ton
 * sur ton se vend, et se vend cher). Ce qui n'est pas légitime, c'est de le
 * laisser arriver par accident.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LE SEUIL EST 3 POUR 1, ET IL EST CITÉ, PAS INVENTÉ
 *
 * WCAG 2.2, critère de succès 1.4.11 « Non-text Contrast », niveau AA : les
 * parties d'un graphique nécessaires à sa compréhension doivent atteindre un
 * rapport de contraste d'au moins 3:1 avec les couleurs adjacentes. C'est
 * exactement la question posée ici, mot pour mot : un motif, sur son fond, et
 * « peut-on encore en distinguer la forme ». Le rapport est celui de la même
 * norme, (L1 + 0,05) / (L2 + 0,05) sur la luminance relative, définie plus bas.
 *
 * Aucun autre nombre n'aurait pu être défendu : 4,5:1 est le seuil du TEXTE de
 * taille courante (1.4.3), et l'appliquer à un logo refuserait des marquages
 * parfaitement lisibles ; 7:1 est le niveau AAA. Un chiffre choisi au jugé
 * aurait été un chiffre fabriqué montré à un client.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ET « LA MOITIÉ DE L'ENCRE », PARCE QU'UN LISERÉ N'EST PAS UN VISUEL
 *
 * Un logo blanc cerné d'un filet noir, sur un t-shirt noir, se lit très bien :
 * son filet échoue au seuil et il ne compte que pour quelques pour cent de
 * l'encre. Avertir sur le premier pixel qui échoue serait avertir sur presque
 * tous les visuels, et un avertissement qui se déclenche toujours ne se lit
 * plus. La part est donc mesurée sur la COUVERTURE (la somme des alphas, qui est
 * la quantité d'encre que le film déposera) et l'avertissement se déclenche
 * au-delà de la moitié : c'est le plus petit énoncé qui parle du visuel plutôt
 * que d'un de ses détails.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TROIS ÉTATS, PARCE QUE « JE N'AI PAS PU REGARDER » N'EST PAS « C'EST BON »
 *
 * `lisible`, `faible`, et `inconnu` quand le canevas n'a pas pu être relu (un
 * actif chargé depuis une autre origine tache le canevas et `getImageData` lève
 * une `SecurityError`). L'écran dit alors qu'il n'a pas pu mesurer et renvoie
 * vers l'aperçu, plutôt que de se taire, ce qui se lirait comme un feu vert.
 * `CLAUDE.md` section 3.
 */

/**
 * La linéarisation sRGB de WCAG, pré-calculée pour les 256 valeurs d'un octet.
 *
 * `Math.pow` sur trois canaux fois cent mille pixels fois vingt coloris est le
 * seul endroit de ce module qui coûte quelque chose ; la table le supprime. Le
 * seuil est 0,03928 et non 0,04045 parce que c'est celui que la norme publie
 * (WCAG 2.0 à 2.2, définition de « relative luminance ») : l'écart entre les
 * deux vaut moins d'un millième de luminance, et suivre le texte cité plutôt
 * qu'une correction personnelle est ce qui rend le calcul vérifiable.
 */
const LINEAIRE: readonly number[] = Array.from({ length: 256 }, (_, i) => {
  const c = i / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
})

/** La luminance relative WCAG d'une couleur sRGB, 0 (noir) à 1 (blanc). */
export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * LINEAIRE[r] + 0.7152 * LINEAIRE[g] + 0.0722 * LINEAIRE[b]
}

/** Le rapport de contraste WCAG entre deux luminances relatives, 1 à 21. */
export function rapport(l1: number, l2: number): number {
  const haut = Math.max(l1, l2)
  const bas = Math.min(l1, l2)
  return (haut + 0.05) / (bas + 0.05)
}

/** `#0a1b3d` vers ses trois octets, ou rien si ce n'est pas un hexadécimal. */
export function rvb(hex: string): [number, number, number] | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ]
}

/** Le seuil de WCAG 2.2 SC 1.4.11, et le seul de ce module. */
export const SEUIL = 3

/** Au-delà de cette part de l'encre sous le seuil, on avertit. Voir l'en-tête. */
export const PART_MAX = 0.5

/**
 * Ce qui reste d'un visuel une fois qu'on n'en garde que la couleur.
 *
 * Les pixels d'encre, quatre octets non prémultipliés par pixel, et leur
 * couverture totale. La GÉOMÉTRIE est jetée : ce module ne répond qu'à des
 * questions de couleur, et ce qui mesure une surface imprimée est
 * `src/lib/ink.ts`, qui est la seule mesure que le prix et le film lisent.
 */
export interface Encre {
  pixels: Uint8Array
  couverture: number
}

/**
 * Relire un canevas de zone d'impression, ou dire qu'on n'a pas pu.
 *
 * `null` veut dire « je n'ai pas pu regarder », jamais « il n'y a rien » : un
 * canevas taché par un actif d'une autre origine lève ici, et confondre les
 * deux réponses ferait dire à l'écran que tout va bien.
 */
export function recenser(canvas: HTMLCanvasElement): Encre | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  } catch {
    return null
  }
  const pixels = new Uint8Array(data.length)
  let n = 0
  let couverture = 0
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a === 0) continue
    pixels[n] = data[i]
    pixels[n + 1] = data[i + 1]
    pixels[n + 2] = data[i + 2]
    pixels[n + 3] = a
    n += 4
    couverture += a
  }
  return { pixels: pixels.subarray(0, n), couverture: couverture / 255 }
}

/** Deux recensements mis bout à bout : un visuel peut occuper plusieurs faces. */
export function fusionner(parts: Encre[]): Encre {
  const total = parts.reduce((s, p) => s + p.pixels.length, 0)
  const pixels = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    pixels.set(p.pixels, offset)
    offset += p.pixels.length
  }
  return { pixels, couverture: parts.reduce((s, p) => s + p.couverture, 0) }
}

export type Lisibilite =
  | { etat: 'lisible' | 'faible'; part: number }
  | { etat: 'inconnu' }

/**
 * Quelle part de l'encre passe sous le seuil, sur ce coloris.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CHAQUE PIXEL EST COMPOSÉ SUR LE VÊTEMENT AVANT D'ÊTRE JUGÉ
 *
 * Un pixel à demi transparent n'arrive pas sur le vêtement comme sa propre
 * couleur : il arrive comme le mélange de son encre et du tissu, et c'est ce
 * mélange que l'oeil compare au tissu. Juger la couleur brute déclarerait
 * qu'une ombre portée noire à 10 % contraste comme du noir, alors qu'elle est
 * pratiquement invisible. La composition est faite en sRGB, comme le fait le
 * canevas qui a produit ces octets, donc l'écran juge exactement ce qu'il
 * affiche.
 *
 * L'ERREUR VA DU CÔTÉ DE L'AVERTISSEMENT. Le recensement est pris à faible
 * définition (voir l'appelant) : le rééchantillonnage ramène les bords vers la
 * transparence, donc vers la couleur du tissu, donc vers l'échec du seuil. Le
 * module avertit donc un peu trop tôt plutôt qu'un peu trop tard, et un
 * avertissement n'est pas un refus.
 */
export function lisibiliteSur(encre: Encre | null, hexVetement: string): Lisibilite {
  const fond = encre === null ? null : rvb(hexVetement)
  if (encre === null || fond === null) return { etat: 'inconnu' }
  if (encre.couverture <= 0) return { etat: 'inconnu' }

  const lFond = luminance(fond[0], fond[1], fond[2])
  let sousLeSeuil = 0
  const p = encre.pixels
  for (let i = 0; i < p.length; i += 4) {
    const a = p[i + 3] / 255
    const r = Math.round(fond[0] + (p[i] - fond[0]) * a)
    const g = Math.round(fond[1] + (p[i + 1] - fond[1]) * a)
    const b = Math.round(fond[2] + (p[i + 2] - fond[2]) * a)
    if (rapport(luminance(r, g, b), lFond) < SEUIL) sousLeSeuil += a
  }
  const part = sousLeSeuil / encre.couverture
  return { etat: part > PART_MAX ? 'faible' : 'lisible', part }
}
