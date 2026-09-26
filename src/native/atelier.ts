/**
 * La boutique, vue de l'éditeur : le devis et le panier, rien d'autre.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IL N'Y A PAS UN PRIX DANS CE FICHIER, ET IL NE DOIT JAMAIS Y EN AVOIR.
 *
 * `Pricing.php` calcule chaque prix payable. Ce module demande et affiche ; il
 * n'additionne rien, n'arrondit rien, ne divise par cent nulle part. Les
 * chaînes `display.*` arrivent déjà écrites en français par `Money::format`,
 * avec la virgule décimale, et c'est ce qui est peint à l'écran. La même règle
 * qui a fait supprimer `src/content/pricing.ts` la même nuit.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LE NONCE NE TRAVERSE PLUS RIEN.
 *
 * Le studio encadré ne pouvait pas porter le nonce REST : il vivait sur une
 * autre origine et n'avait pas le cookie, donc il postait un message à la page
 * parente qui, elle, agissait (`assets/bridge.js`). L'éditeur est maintenant
 * DANS la page : il tient le nonce, il appelle `/cart` lui-même, et les quatre
 * types de messages et leurs comparaisons d'origine n'ont plus d'objet. Ce qui
 * ne change pas : `Rest::check_nonce` exige toujours `x-wp-nonce`
 * explicitement, parce que WordPress ne refuse qu'un MAUVAIS nonce de cookie et
 * jamais un nonce absent.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CHAQUE ÉCHEC A UNE PHRASE FRANÇAISE, ET ELLE DIT QUOI FAIRE.
 *
 * `Cart::add` refuse pour treize raisons distinctes et renvoie un code par
 * raison. La boutique écrit déjà la phrase pour la plupart d'entre elles, et
 * c'est celle-là qui est affichée quand elle existe : deux rédactions de la
 * même règle divergeraient, et celle que le client lirait serait la nôtre,
 * c'est-à-dire la moins à jour. `RAISONS` ne couvre que ce que le serveur ne
 * peut pas dire : le réseau, le nonce, et une réponse illisible.
 */
import type { Layer } from '@/lib/types'
import type { Contexte } from './contexte'

/** Un devis, tel que `Rest::quote()` le rend. Les centimes font foi. */
export interface Devis {
  qty: number
  sides: number
  unit_ht: number
  total_ht: number
  total_vat: number
  total_ttc: number
  discount_rate: number
  vat_rate: number
  needs_quote?: boolean
  display: { unit_ht: string; total_ht: string; total_ttc: string }
}

/** Une face imprimée, telle que le document de création l'a enregistrée. */
export interface FaceImprimee {
  id: string
  area_sq_cm: number
  pieces?: { w_cm: number; h_cm: number; top_cm?: number; center_dx_cm?: number }[]
  area_w_cm?: number
  area_h_cm?: number
  drop_cm?: number
  graded?: boolean
}

export interface PanierAjoute {
  cartCount: number
  cartUrl: string
}

/**
 * Un refus, avec de quoi l'écrire à l'écran.
 *
 * `code` sert au harnais et au journal ; `message` est ce qu'un client lit.
 * Les deux sont séparés parce qu'un code lisible par un client est un code
 * inutilisable par un test, et l'inverse.
 */
export class RefusAtelier extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'RefusAtelier'
    this.code = code
  }
}

/** Ce que le serveur ne peut pas dire lui-même, parce qu'il n'a pas répondu. */
const RAISONS: Record<string, string> = {
  reseau:
    'La boutique n’a pas répondu. Vérifiez votre connexion, puis réessayez : rien n’a été facturé.',
  /*
   * LE MÊME INCIDENT, UNE AUTRE PHRASE, PARCE QUE L'AJOUT ÉCRIT.
   *
   * « Rien n'a été facturé » est vrai d'un devis, qui ne fait que lire. Sur
   * l'ajout au panier c'est une affirmation que nous ne pouvons pas tenir : une
   * réponse perdue APRÈS que le serveur a validé laisse une vraie ligne dans le
   * panier, et `Cart::keep_items_distinct` clé sur `microtime()`, donc rien ne
   * fusionne et un second essai en crée une seconde. On dit ce qu'on sait, et on
   * envoie regarder plutôt que de promettre. Trouvé par la passe adversariale
   * du 5 septembre 2026.
   */
  reseau_panier:
    'La connexion s’est interrompue pendant l’ajout, et nous ne savons pas si la boutique l’a enregistré. Ouvrez votre panier pour vérifier avant de réessayer.',
  illisible:
    'La boutique a répondu quelque chose que nous ne savons pas lire. Rechargez la page, puis réessayez.',
  teeshoop_bad_nonce:
    'Votre session a expiré. Rechargez la page, puis réessayez : votre visuel est conservé.',
  sans_nonce:
    'Cette page n’a pas pu prouver que la demande vient bien de vous. Rechargez-la, puis réessayez.',
}

/**
 * Construire l'URL d'une route REST.
 *
 * `new URL`, jamais une concaténation avec « ? ». Avec les permaliens SIMPLES,
 * que WordPress installe par défaut, `restUrl` vaut déjà
 * `…/index.php?rest_route=/teeshoop/v1/` et un second « ? » fait lire la route
 * comme `/teeshoop/v1/quote?garment=tee`, donc 404. Mesuré sur le miroir local
 * le 14 août 2026 : chaque devis échouait en silence pendant que l'ajout au
 * panier, qui n'ajoute aucune requête, marchait parfaitement.
 */
function route(ctx: Contexte, nom: string): URL {
  return new URL(ctx.restUrl + nom, window.location.href)
}

async function corps(res: Response): Promise<Record<string, unknown>> {
  try {
    const json: unknown = await res.json()
    return json && typeof json === 'object' ? (json as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * Le prix de cette commande, calculé par le serveur.
 *
 * `signal` est là parce qu'un client qui tape une quantité en produit un par
 * frappe : sans annulation, la réponse d'un « 1 » arrive après celle d'un
 * « 12 » et l'écran affiche le prix d'une pièce sous une commande de douze.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LA MATRICE N'EST PAS ENVOYÉE ICI, ET LE TOTAL EST POURTANT LE BON
 *
 * `GET /quote` (`Rest::register`, argument `qty`) ne prend qu'une quantité et
 * des faces : il ne connaît ni les coloris ni les tailles. La grille agrégée
 * n'aurait donc rien à y faire, et ce qui est envoyé est sa SOMME, qui est
 * exactement l'entrée que la route accepte.
 *
 * Cette somme donne le même montant que la matrice, et ce n'est pas une
 * espérance, c'est un chemin de code : `Pricing::quote_matrix` appelle
 * `quote()` une fois par prix de textile nu DISTINCT, avec la quantité TOTALE,
 * et `Cart::cells_for` laisse délibérément `blank_ht` absent (son en-tête dit
 * pourquoi : le tarif est celui de la famille, et le plancher de `Gamme::range`
 * absorbe déjà l'écart de 42 % mesuré entre coloris). Il y a donc un seul nu,
 * un seul appel, une seule remise, et le total de la ligne de panier est
 * `Pricing::quote()` sur la quantité totale, c'est-à-dire ce que cette requête
 * demande. Le jour où un supplément par case est décidé, c'est cette route
 * qu'il faudra apprendre à recevoir une matrice, pas cet écran à calculer.
 *
 * RIEN N'EST CALCULÉ ICI. Ni remise, ni total, ni moyenne : les trois arrivent
 * écrits par `Money::format`.
 */
export async function demanderDevis(
  ctx: Contexte,
  faces: FaceImprimee[],
  qty: number,
  signal?: AbortSignal,
): Promise<Devis> {
  const url = route(ctx, 'quote')
  url.searchParams.set('garment', ctx.garment)
  url.searchParams.set('qty', String(qty))
  faces.forEach((f, i) => {
    url.searchParams.set(`sides[${i}][id]`, f.id)
    url.searchParams.set(`sides[${i}][area_sq_cm]`, String(f.area_sq_cm))
  })

  let res: Response
  try {
    res = await fetch(url.toString(), {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      signal,
    })
  } catch (e) {
    if (signal?.aborted) throw e
    throw new RefusAtelier('reseau', RAISONS.reseau)
  }

  const body = await corps(res)
  if (!res.ok) {
    throw new RefusAtelier(
      typeof body.code === 'string' ? body.code : 'devis_refuse',
      messageDe(body, 'Le prix n’a pas pu être calculé. Rechargez la page, puis réessayez.'),
    )
  }
  if (!body.display || typeof body.display !== 'object') {
    throw new RefusAtelier('illisible', RAISONS.illisible)
  }
  return body as unknown as Devis
}

/**
 * Ajouter la ligne au panier.
 *
 * CE QUI N'EST PAS DANS LE CORPS : la moindre surface et le moindre prix. Le
 * corps porte ce que le client a choisi, et `Cart::add` redérive le vêtement
 * depuis `Product::garment_of` et les faces imprimées depuis le document que le
 * Worker a stocké. Un lien trafiqué change ce qu'un formulaire montre et jamais
 * ce qu'une facture dit.
 *
 * `sides` est envoyé quand même, et c'est délibéré : `Cart::add` compare ce
 * qu'on lui envoie à ce que la création porte et JOURNALISE l'écart sans
 * refuser. Ne rien envoyer supprimerait ce contrôle, et l'écart qu'il attrape
 * est un bug de notre côté, pas une fraude du client.
 */
export async function ajouterAuPanier(
  ctx: Contexte,
  arg: {
    designId: string
    faces: FaceImprimee[]
    grille: Record<string, number>
    /** Coloris vers taille vers quantité, la forme de `Cart::normalise_matrix`. */
    matrice: Record<string, Record<string, number>>
  },
): Promise<PanierAjoute> {
  if (ctx.nonce === '') throw new RefusAtelier('sans_nonce', RAISONS.sans_nonce)

  const qty = Object.values(arg.grille).reduce((s, n) => s + n, 0)

  let res: Response
  try {
    res = await fetch(route(ctx, 'cart').toString(), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'X-WP-Nonce': ctx.nonce },
      body: JSON.stringify({
        product_id: ctx.productId,
        garment: ctx.garment,
        qty,
        sides: arg.faces,
        design_id: arg.designId,
        /*
         * LES DEUX FORMES PARTENT, ET LA SECONDE EST LA SOMME DE LA PREMIÈRE.
         *
         * `Cart::add` lit `matrix` en priorité et en déduit `size_grid` par
         * `flatten_matrix` ; il ne retombe sur `size_grid` que si la matrice est
         * vide, ce qui est le chemin des paniers ouverts avant le 9 septembre
         * 2026. Les envoyer tous les deux n'est donc PAS une seconde source de
         * vérité : c'est la même donnée sous les deux formes que le serveur sait
         * lire, et le serveur choisit. Ce qu'on ne peut pas se permettre, c'est
         * de les laisser diverger, donc `grille` est calculée à partir de
         * `matrice` par le seul endroit qui la calcule (`Instance.grille()`) et
         * jamais saisie séparément.
         */
        matrix: arg.matrice,
        size_grid: arg.grille,
      }),
    })
  } catch {
    throw new RefusAtelier('reseau', RAISONS.reseau_panier)
  }

  const body = await corps(res)
  if (!res.ok) {
    const code = typeof body.code === 'string' ? body.code : 'panier_refuse'
    /*
     * 403 est le nonce, et c'est le seul cas où la phrase du serveur est
     * inutilisable : WordPress répond « rest_cookie_invalid_nonce » avec sa
     * propre formulation anglaise avant que `check_nonce` ait pu parler.
     */
    const defaut =
      res.status === 403
        ? RAISONS.teeshoop_bad_nonce
        : 'L’article n’a pas pu être ajouté. Rien n’a été facturé.'
    throw new RefusAtelier(code, messageDe(body, defaut))
  }

  return {
    cartCount: Number(body.cart_count) || 0,
    cartUrl: typeof body.cart_url === 'string' && body.cart_url !== '' ? body.cart_url : ctx.cartUrl,
  }
}

// ─────────────────────────────────────────────────────────── modèles sauvegardés

/** Un modèle, tel que `Rest::modeles_reponse` le rend. */
export interface Modele {
  id: string
  nom: string
  garment: string
  /** L'aperçu public sur le Worker, ou '' quand il n'y en a pas. */
  apercu: string
  cree: string
}

/** Les modèles de ce vêtement, et combien le compte en a en tout sur combien. */
export interface ListeModeles {
  modeles: Modele[]
  total: number
  max: number
}

const ID_CREATION = /^[A-Za-z0-9_-]{16,64}$/

/**
 * Un appel aux routes des modèles : le nonce ET le cookie du compte, et la
 * phrase du serveur quand il refuse (plus de place, pas connecté, modèle
 * inconnu). Toutes ces routes répondent la liste à jour, sauf les deux lectures.
 */
async function appelModeles(
  ctx: Contexte,
  chemin: string,
  init: { method?: string; corps?: Record<string, unknown>; params?: Record<string, string> } = {},
): Promise<Record<string, unknown>> {
  if (ctx.nonce === '') throw new RefusAtelier('sans_nonce', RAISONS.sans_nonce)
  const url = route(ctx, chemin)
  for (const [k, v] of Object.entries(init.params ?? {})) url.searchParams.set(k, v)

  let res: Response
  try {
    res = await fetch(url.toString(), {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        'X-WP-Nonce': ctx.nonce,
        ...(init.corps ? { 'content-type': 'application/json' } : {}),
      },
      body: init.corps ? JSON.stringify(init.corps) : undefined,
    })
  } catch {
    throw new RefusAtelier('reseau', 'La boutique n’a pas répondu. Vérifiez votre connexion, puis réessayez.')
  }

  const body = await corps(res)
  if (!res.ok) {
    throw new RefusAtelier(
      typeof body.code === 'string' ? body.code : 'modele_refuse',
      messageDe(body, res.status === 403 ? RAISONS.teeshoop_bad_nonce : 'Vos modèles n’ont pas pu être lus. Rechargez la page, puis réessayez.'),
    )
  }
  return body
}

/** La liste relue comme une donnée venue d'ailleurs : une entrée malformée est écartée. */
export function lireListe(body: Record<string, unknown>): ListeModeles {
  const brut = Array.isArray(body.modeles) ? body.modeles : []
  const modeles: Modele[] = []
  for (const m of brut) {
    if (!m || typeof m !== 'object') continue
    const e = m as Record<string, unknown>
    const id = typeof e.id === 'string' ? e.id : ''
    if (!ID_CREATION.test(id)) continue
    modeles.push({
      id,
      nom: typeof e.nom === 'string' ? e.nom.slice(0, 60) : '',
      garment: typeof e.garment === 'string' ? e.garment : '',
      apercu: typeof e.apercu === 'string' && /^https?:\/\//i.test(e.apercu) ? e.apercu : '',
      cree: typeof e.cree === 'string' ? e.cree : '',
    })
  }
  return { modeles, total: Number(body.total) || 0, max: Number(body.max) || 0 }
}

export async function listerModeles(ctx: Contexte): Promise<ListeModeles> {
  return lireListe(await appelModeles(ctx, 'modeles', { params: { garment: ctx.garment } }))
}

/** `preuve` : celle que le Worker a rendue au dépôt (`UploadedDesign.proof`), sans quoi la boutique refuse. */
export async function enregistrerModele(
  ctx: Contexte,
  designId: string,
  preuve: string,
  nom: string,
): Promise<ListeModeles> {
  return lireListe(
    await appelModeles(ctx, 'modeles', {
      method: 'POST',
      corps: { design_id: designId, preuve, nom, garment: ctx.garment },
    }),
  )
}

export async function supprimerModele(ctx: Contexte, id: string): Promise<ListeModeles> {
  return lireListe(
    await appelModeles(ctx, `modeles/${encodeURIComponent(id)}`, { method: 'DELETE', params: { garment: ctx.garment } }),
  )
}

/** Les calques du modèle, tels que le Worker les a stockés, relus par la boutique. */
export async function lireModele(ctx: Contexte, id: string): Promise<Record<string, unknown>> {
  const body = await appelModeles(ctx, `modeles/${encodeURIComponent(id)}/document`)
  const doc = body.document
  if (!doc || typeof doc !== 'object') throw new RefusAtelier('illisible', RAISONS.illisible)
  return doc as Record<string, unknown>
}

/** Une image du modèle. Le serveur la rend en base64 dans du JSON. */
export async function lireImageModele(ctx: Contexte, id: string, asset: string): Promise<Blob> {
  const body = await appelModeles(ctx, `modeles/${encodeURIComponent(id)}/fichier/${encodeURIComponent(asset)}`)
  const type = body.type === 'image/png' || body.type === 'image/jpeg' ? body.type : ''
  if (type === '' || typeof body.base64 !== 'string') throw new RefusAtelier('illisible', RAISONS.illisible)
  const octets = Uint8Array.from(atob(body.base64), (c) => c.charCodeAt(0))
  return new Blob([octets], { type })
}

/**
 * Les calques d'un modèle, prêts à poser sur le vêtement ouvert. PURE.
 *
 * `images` associe chaque image du modèle à sa copie locale (un NOUVEL
 * identifiant, voir `Instance.appliquerModele`) : ses octets sont ceux que la
 * création utilisait, détourage compris, d'où `useCutout` à faux. Un calque qui
 * n'est pas d'un type connu, qui n'a pas de coordonnées, qui vise une face que
 * ce produit n'accepte pas, ou dont l'image n'a pas été rapatriée, est écarté et
 * COMPTÉ, pour que l'écran puisse le dire au lieu de le taire.
 */
export function calquesDuModele(
  doc: Record<string, unknown>,
  images: ReadonlyMap<string, string>,
  faces: readonly string[],
): { calques: Layer[]; ecartes: number } {
  const brut = Array.isArray(doc.layers) ? doc.layers : []
  const calques: Layer[] = []
  let ecartes = 0
  for (const l of brut) {
    const e = l && typeof l === 'object' ? (l as Record<string, unknown>) : null
    const ok =
      e !== null &&
      (e.type === 'text' || e.type === 'image' || e.type === 'graphic') &&
      typeof e.id === 'string' &&
      typeof e.side === 'string' &&
      faces.includes(e.side) &&
      Number.isFinite(e.xIn) &&
      Number.isFinite(e.yIn) &&
      (e.type !== 'image' || (typeof e.assetId === 'string' && images.has(e.assetId)))
    if (!ok || e === null) {
      ecartes++
      continue
    }
    calques.push(
      (e.type === 'image'
        ? { ...e, assetId: images.get(e.assetId as string), useCutout: false }
        : { ...e }) as unknown as Layer,
    )
  }
  return { calques, ecartes }
}

/** Les images qu'un document de modèle nomme, une fois chacune. PURE. */
export function imagesDuModele(doc: Record<string, unknown>): string[] {
  const ids = new Set<string>()
  for (const l of Array.isArray(doc.layers) ? doc.layers : []) {
    const e = l && typeof l === 'object' ? (l as Record<string, unknown>) : null
    if (e && e.type === 'image' && typeof e.assetId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(e.assetId)) ids.add(e.assetId)
  }
  return [...ids]
}

/**
 * La phrase du serveur, quand il en a écrit une.
 *
 * WordPress met le texte d'un `WP_Error` dans `message`, déjà traduit et déjà
 * échappé pour du texte. Il est repris tel quel et posé par `textContent`,
 * jamais par `innerHTML` : il vient d'un serveur que nous écrivons, mais il
 * traverse une frontière, et une phrase de refus n'a aucune raison de porter du
 * balisage.
 */
function messageDe(body: Record<string, unknown>, defaut: string): string {
  const m = body.message
  return typeof m === 'string' && m.trim() !== '' ? m.trim() : defaut
}
