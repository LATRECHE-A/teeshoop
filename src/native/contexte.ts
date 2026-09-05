/**
 * Ce que la fiche produit remet à l'éditeur, lu et borné une seule fois.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TOUT ARRIVE EN CHAÎNE DE CARACTÈRES.
 *
 * `wp_localize_script` sérialise en JavaScript en passant par `wp_json_encode`
 * sur un tableau PHP dont les entiers ont déjà été convertis en chaînes. Une
 * comparaison `qty > cfg.maxQty` entre deux chaînes compare alphabétiquement,
 * donc « 9 » y est plus grand que le plafond de la boutique. C'est la raison
 * d'être de ce fichier : rien ailleurs dans le paquet ne relit
 * `window.TEESHOOP_EDITEUR`, tout passe par `lireContexte`, et ce qui en sort
 * a des types.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUI N'EST PAS ICI, ET NE DOIT JAMAIS Y ÊTRE : UN PRIX.
 *
 * Le serveur calcule chaque prix payable (`Pricing.php`). L'éditeur affiche ce
 * qu'on lui donne et ne calcule rien qu'un client puisse payer. Il n'y a donc
 * ni tarif de base, ni palier, ni remise dans ce contrat : seulement les deux
 * seuils au-delà desquels la boutique cesse de chiffrer et passe la main à un
 * humain, parce que l'écran doit pouvoir le DIRE avant que le panier le refuse.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LA ZONE D'IMPRESSION EST DÉRIVÉE, PAS MESURÉE, ET L'ÉCRAN LE DIT.
 *
 * `zones` porte la zone imprimable par face et par taille, en centimètres,
 * telle que `Garments::area_by_size()` la publie depuis `data/garments.json`.
 * C'est la MÊME source que `Design::unprintable_sizes` utilise pour refuser une
 * ligne, donc une seule implémentation de « quelle est la zone ».
 *
 * Elle n'est PAS la zone mesurée sur la photographie du fournisseur : au
 * 5 septembre 2026 aucune référence n'en porte une (`_teeshoop_zone_impression`
 * est absent des 2 309 produits, et neuf portent un `_teeshoop_zone_refus`).
 * Voir docs/decisions/2026-09-05-la-zone-dessinee-et-la-photographie.md.
 */

/** Une couleur que l'atelier peut réellement acheter dans cette référence. */
export interface CouleurContexte {
  /** L'identifiant de teinture du studio, ce que porte le document. */
  id: string
  /** Le nom du fabricant, celui que le client lit. */
  nom: string
  /** Un ou deux hexadécimaux MESURÉS sur la photographie du fournisseur. */
  teintes: string[]
  /** La photographie de ce coloris, quand la boutique en a une. */
  photo: string
}

/** La zone imprimable d'une face, centimètres, par taille. */
export interface ZoneContexte {
  /** `front`, `back`, `sleeve`. */
  face: string
  /** Taille (`M`, `3XL`, ...) vers ses dimensions en centimètres. */
  parTaille: Record<string, { largeurCm: number; hauteurCm: number }>
}

export interface Contexte {
  productId: number
  /** `tee` ou `hoodie`. Vide veut dire « ce produit n'est pas personnalisable ». */
  garment: string
  titre: string
  restUrl: string
  nonce: string
  cartUrl: string
  /** L'origine du Worker qui stocke les créations. Vide interdit le dépôt. */
  workerUrl: string
  couleurs: CouleurContexte[]
  /** Les tailles réellement achetables, dans l'ordre de la charte. */
  tailles: string[]
  /** La taille sur laquelle le tarif est calé (`Garments::priced_size`). */
  tailleTarif: string
  /** La demi-poitrine du fabricant, par taille, centimètres. Vide = pas lue. */
  demiPoitrine: Record<string, number>
  zones: ZoneContexte[]
  /** Les faces imprimables, dans l'ordre. */
  faces: string[]
  /**
   * Le plus grand nombre de pièces que la boutique prend sur une ligne.
   *
   * ZÉRO VEUT DIRE « LA PAGE NE L'A PAS DIT », ET PAS « ZÉRO PIÈCE ».
   *
   * Le contrôle local n'existe que pour dire non tout de suite, avec une phrase,
   * plutôt que de laisser un client téléverser son visuel pour se faire refuser
   * après : `Cart::add` refuse de toute façon, et c'est lui l'autorité. Un
   * défaut chiffré ici serait une SECONDE copie du plafond, dans un fichier qui
   * ne peut pas savoir s'il est encore juste, et le registre d'hypothèses
   * l'aurait signalé comme une deuxième maison pour une valeur qui n'en a qu'une.
   */
  maxQty: number
  /** Au-delà, la boutique chiffre à la main. Pièces. 0 = non publié. */
  devisDesQte: number
  /** Au-delà, la boutique chiffre à la main. Centimes HT. 0 = non publié. */
  devisDesHt: number
  /** Le lien vers le formulaire de devis, sur la même page. */
  devisUrl: string
}

/** Un entier borné, quelle que soit la forme sous laquelle il est arrivé. */
function entier(v: unknown, min: number, max: number, defaut: number): number {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10)
  if (!Number.isFinite(n)) return defaut
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

function texte(v: unknown, maxLen = 200): string {
  const s = typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v)
  return s.length > maxLen ? s.slice(0, maxLen) : s
}

/**
 * Un identifiant du même alphabet que `sanitize_key` côté PHP.
 *
 * Il devient une classe CSS, une clé de tableau et un champ du document de
 * création. Ce qui n'est pas de cette forme n'est pas repris, jamais échappé et
 * laissé passer : une teinture nommée `"><script>` est une teinture que le
 * fournisseur ne vend pas.
 */
const CLE = /^[a-z0-9_-]{1,40}$/

function couleurs(raw: unknown): CouleurContexte[] {
  if (!Array.isArray(raw)) return []
  const out: CouleurContexte[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const id = texte(e.id, 40)
    const nom = texte(e.name ?? e.nom, 80).trim()
    if (!CLE.test(id) || nom === '') continue
    const teintes = (Array.isArray(e.stops) ? e.stops : [])
      .map((h) => texte(h, 7))
      .filter((h) => /^#[0-9a-fA-F]{6}$/.test(h))
      .slice(0, 2)
    // Une pastille sans couleur mesurée est ÉCARTÉE, pas peinte en gris : la
    // pastille EST la mesure, et un carré neutre sous un vrai nom de coloris
    // est exactement le défaut que `Product::blank_palette_of` refuse déjà.
    if (teintes.length === 0) continue
    out.push({ id, nom, teintes, photo: photoSure(e.photo) })
    if (out.length >= 64) break
  }
  return out
}

/**
 * Une URL d'image, ou rien.
 *
 * Http(s) et rien d'autre : `javascript:` dans un `src` d'image ne s'exécute
 * pas, mais `data:` en accepterait un dans un SVG, et cette valeur traverse
 * depuis la base de données de la boutique. Relative acceptée parce que
 * WordPress sert ses médias sur la même origine.
 */
function photoSure(v: unknown): string {
  const s = texte(v, 500).trim()
  if (s === '') return ''
  if (s.startsWith('/') && !s.startsWith('//')) return s
  return /^https?:\/\//i.test(s) ? s : ''
}

function zones(raw: unknown): ZoneContexte[] {
  if (!Array.isArray(raw)) return []
  const out: ZoneContexte[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const face = texte(e.side ?? e.face, 16)
    if (!/^[a-z_]{1,16}$/.test(face)) continue
    const brut = e.bySize ?? e.parTaille
    if (!brut || typeof brut !== 'object') continue
    const parTaille: Record<string, { largeurCm: number; hauteurCm: number }> = {}
    for (const [taille, dim] of Object.entries(brut as Record<string, unknown>)) {
      if (!dim || typeof dim !== 'object') continue
      const d = dim as Record<string, unknown>
      const w = Number(d.wCm ?? d.largeurCm)
      const h = Number(d.hCm ?? d.hauteurCm)
      /*
       * BORNÉE À LA LECTURE AUSSI. Le même garde-fou que `maker_half_chest`
       * applique à la demi-poitrine : une zone de 400 cm de côté est une fiche
       * mal lue ou un tableau en pouces, et ce rectangle finirait chez
       * l'imprimeur. Un centimètre au plancher, deux mètres au plafond, ce qui
       * est le `MAX_PIECE_CM` du document de création.
       */
      if (!Number.isFinite(w) || !Number.isFinite(h)) continue
      if (w < 1 || h < 1 || w > 200 || h > 200) continue
      parTaille[taille.toUpperCase()] = { largeurCm: w, hauteurCm: h }
    }
    if (Object.keys(parTaille).length > 0) out.push({ face, parTaille })
  }
  return out
}

function demiPoitrine(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, number> = {}
  for (const [taille, cm] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(cm)
    // Les mêmes bornes que `ProductPage::maker_half_chest`, relues ici parce
    // que ce nombre décide du gradient et donc de ce que le film porte.
    if (Number.isFinite(n) && n >= 25 && n <= 95) out[taille.toUpperCase()] = n
  }
  return out
}

function listeCles(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const v of raw) {
    const s = texte(v, 16)
    if (s !== '' && !out.includes(s)) out.push(s)
    if (out.length >= max) break
  }
  return out
}

/**
 * Lire l'objet que la page a publié, ou rien du tout.
 *
 * Rien du tout est une réponse : `monter()` n'affiche alors pas d'éditeur, et
 * la fiche produit garde son bouton de devis. Un éditeur à moitié configuré
 * serait un éditeur qui laisse le client travailler puis refuse au dernier
 * clic, ce que cette nuit existe pour supprimer.
 */
export function lireContexte(brut: unknown): Contexte | null {
  if (!brut || typeof brut !== 'object') return null
  const c = brut as Record<string, unknown>

  const productId = entier(c.productId, 1, Number.MAX_SAFE_INTEGER, 0)
  const garment = texte(c.garment, 40)
  const restUrl = texte(c.restUrl, 500)
  if (productId === 0 || !CLE.test(garment) || restUrl === '') return null

  return {
    productId,
    garment,
    titre: texte(c.title ?? c.titre, 200),
    restUrl,
    nonce: texte(c.nonce, 64),
    cartUrl: texte(c.cartUrl, 500),
    workerUrl: texte(c.workerUrl, 500).replace(/\/+$/, ''),
    couleurs: couleurs(c.colours ?? c.couleurs),
    tailles: listeCles(c.sizes ?? c.tailles, 24),
    tailleTarif: texte(c.pricedSize ?? c.tailleTarif, 16),
    demiPoitrine: demiPoitrine(c.sizeChart ?? c.demiPoitrine),
    zones: zones(c.areas ?? c.zones),
    faces: listeCles(c.sides ?? c.faces, 8),
    // Le défaut est 0, « non publié », dans les trois cas. Voir `maxQty`.
    maxQty: entier(c.maxQty, 0, Number.MAX_SAFE_INTEGER, 0),
    devisDesQte: entier(c.quoteFromQty, 0, Number.MAX_SAFE_INTEGER, 0),
    devisDesHt: entier(c.quoteFromHt, 0, Number.MAX_SAFE_INTEGER, 0),
    devisUrl: texte(c.quoteUrl ?? c.devisUrl, 500),
  }
}
