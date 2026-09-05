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
  arg: { designId: string; faces: FaceImprimee[]; grille: Record<string, number> },
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
        size_grid: arg.grille,
      }),
    })
  } catch {
    throw new RefusAtelier('reseau', RAISONS.reseau)
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
