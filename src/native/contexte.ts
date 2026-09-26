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
 *
 * CE QUI LA LIT, ET CE QUI NE LA LIT PAS. `editeur.ts` dessine avec la charte
 * du studio (`GARMENTS[...].printAreasIn`), pas avec ce champ : `EditorEngine`
 * est le tracé et il connaît sa propre géométrie. Les deux sources sont tenues
 * égales par `npm run verify:garments`, qui régénère `data/garments.json` depuis
 * la charte TypeScript et échoue si elles diffèrent. Ce champ sert donc à DIRE
 * la zone au client, en centimètres, telle que la boutique la publie, et à ce
 * que l'écran refuse de la dessiner si les deux venaient à diverger.
 */
import type { Side } from '@/lib/types'
import { MAX_PIECE_CM } from '@/lib/teeshoop/designDoc'

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

/**
 * Combien de coloris une seule ligne de panier accepte.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * L'AUTORITÉ EST `Cart::MAX_COLOURS`, ET CE NOMBRE EN EST UNE COPIE ASSUMÉE.
 *
 * `Editeur::contexte()` ne publie pas ce plafond, contrairement à `maxQty`. La
 * différence de traitement n'est pas une négligence, elle vient de ce que les
 * deux plafonds cassent différemment quand l'écran les ignore :
 *
 *   `maxQty` inconnu, le panier REFUSE et le dit, avec la phrase de
 *   `teeshoop_qty_too_high`. Un défaut chiffré ici serait une seconde maison
 *   pour une valeur qui n'en a qu'une, et le contrôle local n'est là que pour
 *   dire non avant le téléversement. Zéro veut donc dire « non publié ».
 *
 *   Ce plafond-ci, inconnu, ne produit AUCUN refus : `normalise_matrix` s'arrête
 *   au vingtième coloris et jette les suivants sans un mot. Une palette de 54
 *   coloris construirait 54 lignes à l'écran, 54 aperçus, et le client verrait
 *   partir au panier une commande à laquelle il manquerait 34 lignes. Une borne
 *   absente ici est une perte silencieuse de quantités, pas un refus lisible.
 *
 * La page peut la publier sous `maxColours` et elle gagne alors ; c'est la
 * ligne à écrire dans `Editeur::contexte()` le jour où ce nombre bouge.
 */
export const MAX_COULEURS_DEFAUT = 20

/** La zone imprimable d'une face, centimètres, par taille. */
export interface ZoneContexte {
  /** `front`, `back`, `sleeve`. */
  face: string
  /** Taille (`M`, `3XL`, ...) vers ses dimensions en centimètres. */
  parTaille: Record<string, { largeurCm: number; hauteurCm: number }>
}

/**
 * Comment cette boutique écrit un prix, décidé par `Settings::price_bases()`.
 *
 * `connue` false veut dire que le régime de TVA n'est pas renseigné, ce qui
 * n'est PAS la franchise : la page dit alors un seul montant et ne dit rien de
 * la taxe, ce qui est la vérité. `deux` true veut dire qu'il y a un HT et un
 * TTC différents à montrer. `mention` est la phrase du régime, écrite par
 * `Vat`, et jamais rédigée ici.
 */
export interface BasesPrix {
  connue: boolean
  deux: boolean
  /** `ht` ou `ttc` : lequel des deux montants est le principal. */
  principal: string
  mention: string
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
  bases: BasesPrix
  /**
   * Le lien vers le formulaire de devis.
   *
   * UNE ANCRE SUR CETTE PAGE, ET RIEN D'AUTRE. `Editeur::contexte()` y met la
   * constante `#teeshoop-devis` ; ce champ devient un `href`, donc le jour où
   * quelqu'un en fait un réglage administrable il devra le filtrer comme
   * `urlSure` filtre le sien, ou une adresse `javascript:` deviendra un lien
   * cliquable sur la fiche produit.
   */
  devisUrl: string
  /**
   * Vrai quand l'éditeur occupe une page à lui, faux quand il est dans la fiche.
   *
   * UN SEUL ÉDITEUR, UNE COMMUTATION DE MISE EN PAGE. La page dédiée donne au
   * canevas la largeur qu'il mérite et rappelle sur quel article on travaille ;
   * dans la fiche produit, l'éditeur occupe la fente d'ajout au panier et ne
   * répète ni le titre ni l'image, qui sont déjà au-dessus de lui. Deux
   * éditeurs auraient été deux endroits où corriger le même défaut.
   */
  atelier: boolean
  /** L'image du produit, pour l'en-tête de la page dédiée. Vide = aucune. */
  productImage: string
  /** Le nombre de coloris qu'une ligne accepte. Voir `MAX_COULEURS_DEFAUT`. */
  maxCouleurs: number
  /**
   * LES MODÈLES SAUVEGARDÉS (`includes/Modeles.php`). Ils sont dans le compte
   * du client : `connecte` décide si l'atelier les propose ou invite à se
   * connecter, `compteUrl` est où se connecter, `maxModeles` le plafond publié
   * (0 = la boutique n'en a pas parlé, la section se tait), et `modele` celui
   * que l'adresse demande, déjà vérifié par la boutique comme étant à ce client.
   */
  connecte: boolean
  compteUrl: string
  maxModeles: number
  modele: string
}

/**
 * Les trois faces que le dessin sait tracer, dans l'ordre où on les propose.
 *
 * `EditorEngine` en connaît exactement trois (`src/garments/*.ts` porte un
 * gabarit par face), donc une quatrième publiée par la boutique ne serait pas
 * dessinable. Cette liste est l'ordre d'affichage et rien d'autre : ce qui dit
 * ce qu'un produit accepte, c'est `facesPermises`.
 */
export const FACES_DESSINABLES: readonly Side[] = ['front', 'back', 'sleeve']

/**
 * Les faces que CE produit accepte, et sur lesquelles on peut donc poser un
 * calque.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POSER UN CALQUE SUR UNE FACE INTERDITE DOIT ÊTRE IMPOSSIBLE, PAS REFUSÉ APRÈS
 *
 * `Editeur::faces()` publie `printableSides` de `data/garments.json`, la même
 * source que le bon de commande fournisseur. Rien côté serveur ne revérifie
 * ENSUITE qu'une face décorée était permise (`Design::unprintable_sizes`
 * contrôle les tailles, pas les faces), donc cette liste est la seule porte :
 * elle décide ce que l'écran propose, et l'écran ne propose rien d'autre.
 *
 * UNE LISTE VIDE VEUT DIRE « LA PAGE NE L'A PAS PUBLIÉE », comme `maxQty`, et
 * on retombe alors sur les trois faces du dessin, qui est ce que l'éditeur a
 * toujours fait. Une liste publiée qui ne nomme aucune face dessinable est une
 * configuration que personne ne peut dessiner : elle rend une liste vide, et
 * l'appelant n'affiche alors aucun choix.
 */
export function facesPermises(ctx: Pick<Contexte, 'faces'>): Side[] {
  if (ctx.faces.length === 0) return [...FACES_DESSINABLES]
  return FACES_DESSINABLES.filter((f) => ctx.faces.includes(f))
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
    out.push({ id, nom, teintes, photo: urlSure(e.photo) })
    if (out.length >= 64) break
  }
  return out
}

/**
 * Une URL vers la boutique, ou rien.
 *
 * Http(s) et rien d'autre : `javascript:` dans un `src` d'image ne s'exécute
 * pas, mais `data:` en accepterait un dans un SVG, et cette valeur traverse
 * depuis la base de données de la boutique. Relative acceptée parce que
 * WordPress sert ses médias sur la même origine.
 *
 * ELLE FILTRE TROIS CHAMPS ET PLUS UN SEUL, et c'est pour cela qu'elle a changé
 * de nom : la photographie d'un coloris, le retour vers la fiche produit et
 * l'image de cette fiche. Les deux derniers deviennent un `href` et un `src` de
 * la page dédiée, donc exactement la même question, et une seconde fonction qui
 * y répondrait presque pareil est ce que `CLAUDE.md` section 1 interdit : la
 * connaissance du `/\` normalisé en `//` ne vivrait alors que dans l'une des
 * deux.
 */
function urlSure(v: unknown): string {
  const s = texte(v, 500).trim()
  if (s === '') return ''
  /*
   * `/\` EST UNE ORIGINE, PAS UN CHEMIN.
   *
   * `//evil.tld/x.png` est une URL protocole-relative et tout le monde le sait.
   * `/\evil.tld/x.png` est la même chose : l'analyseur d'URL des navigateurs
   * normalise la barre inverse en barre oblique, donc le second passe un test
   * qui ne regarde que `//` et charge une image depuis un autre site dans la
   * page de la boutique. Trouvé par la passe adversariale du 5 septembre 2026 ;
   * pas atteignable aujourd'hui, parce que `Editeur::couleurs()` ne met là que
   * `get_the_post_thumbnail_url()`, mais un champ de réglage suffirait à
   * l'ouvrir.
   */
  if (s.startsWith('/') && !/^\/[/\\]/.test(s)) return s
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
       * l'imprimeur. Un centimètre au plancher, et au plafond le `MAX_PIECE_CM`
       * du document de création, IMPORTÉ et pas réécrit : c'était un 200 nu ici,
       * quatrième copie d'une valeur qui a déjà trois maisons.
       */
      if (!Number.isFinite(w) || !Number.isFinite(h)) continue
      if (w < 1 || h < 1 || w > MAX_PIECE_CM || h > MAX_PIECE_CM) continue
      parTaille[taille.toUpperCase()] = { largeurCm: w, hauteurCm: h }
    }
    if (Object.keys(parTaille).length > 0) out.push({ face, parTaille })
  }
  return out
}

function basesPrix(raw: unknown): BasesPrix {
  const b = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  /*
   * LE DÉFAUT EST « ON NE SAIT PAS », et c'est ce qui fait taire l'écran plutôt
   * que de lui faire annoncer un régime fiscal. Une page qui n'a rien reçu ne
   * peut pas affirmer « TVA 20 % incluse » ni « TVA non applicable » : les deux
   * sont des déclarations sur la position fiscale du vendeur, faites à un
   * client, et sans preuve.
   */
  return {
    connue: b.known === true || b.known === '1' || b.known === 1,
    deux: b.two === true || b.two === '1' || b.two === 1,
    principal: texte(b.lead, 8) === 'ttc' ? 'ttc' : 'ht',
    mention: texte(b.mention, 300),
  }
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

/**
 * Les tailles vendables, normalisées EXACTEMENT comme le panier les normalise.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TROIS RAISONS, DONT DEUX ONT ÉTÉ ÉCRITES PAR LA PASSE ADVERSARIALE DU
 * 9 SEPTEMBRE 2026
 *
 * `Cart::normalise_size_grid` fait trois choses à chaque clé qu'il reçoit : il
 * la met en majuscules, il en retire tout ce qui n'est pas alphanumérique, et il
 * la jette au-delà de quatre caractères ; puis il s'arrête à douze entrées.
 * Cette fonction fait la même chose, à l'arrivée, et il fallait les trois :
 *
 *   UNE CLÉ QUE LE PANIER RÉÉCRIT est une taille offerte sous un nom que la
 *   commande ne portera pas. Le client tape une quantité en « m-1 », la ligne
 *   enregistre « M1 », et la production presse une taille que personne n'a
 *   choisie.
 *
 *   AU-DELÀ DE LA DOUZIÈME, le panier jette en silence. C'est la même forme que
 *   le plafond de coloris : une quantité saisie, disparue sans un mot. Ne pas
 *   l'offrir est la seule façon honnête de ne pas la perdre.
 *
 *   ET LA CLÉ DEVIENT UN SÉLECTEUR. `rendreTotaux` retrouve la case de somme par
 *   `[data-teeshoop="total-taille-<clé>"]` à chaque frappe. Une taille contenant
 *   un guillemet faisait lever `querySelector` au milieu de la saisie, donc une
 *   grille dont les totaux cessaient de suivre. Aujourd'hui `sizes` vient de
 *   `data/garments.json` et ne peut pas contenir ça ; ce fichier est la
 *   frontière, et une frontière qui borne tout sauf un champ ne borne rien.
 */
function tailles(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const v of raw) {
    const t = texte(v, 16).toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (t === '' || t.length > 4 || out.includes(t)) continue
    out.push(t)
    if (out.length >= 12) break
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

  /*
   * LE PLANCHER EST ZÉRO, PAS UN, ET C'EST LE TEST QUI L'A DIT.
   *
   * Avec un plancher à 1, un `productId` de 0 (une page mal configurée, un
   * champ absent) était BORNÉ à 1, le refus juste en dessous ne se déclenchait
   * jamais, et l'éditeur aurait posé chaque ajout au panier sur le billet
   * numéro 1. Une borne qui remonte une valeur au-dessus du seuil de refus est
   * une borne qui désarme le refus.
   */
  const productId = entier(c.productId, 0, Number.MAX_SAFE_INTEGER, 0)
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
    tailles: tailles(c.sizes ?? c.tailles),
    tailleTarif: texte(c.pricedSize ?? c.tailleTarif, 16),
    demiPoitrine: demiPoitrine(c.sizeChart ?? c.demiPoitrine),
    zones: zones(c.areas ?? c.zones),
    faces: listeCles(c.sides ?? c.faces, 8),
    // Le défaut est 0, « non publié », dans les trois cas. Voir `maxQty`.
    maxQty: entier(c.maxQty, 0, Number.MAX_SAFE_INTEGER, 0),
    devisDesQte: entier(c.quoteFromQty, 0, Number.MAX_SAFE_INTEGER, 0),
    devisDesHt: entier(c.quoteFromHt, 0, Number.MAX_SAFE_INTEGER, 0),
    bases: basesPrix(c.priceBases),
    /*
     * UNE ANCRE, OU UNE ADRESSE FILTRÉE. La fiche produit publie
     * `#teeshoop-devis` ; l'atelier dédié publie depuis le 26/09/2026 la page
     * devis sur ce produit, une vraie adresse, qui passe donc par `urlSure`
     * comme ce champ l'annonçait : sinon une adresse `javascript:` deviendrait
     * un lien cliquable.
     */
    devisUrl: ((s: string) => (/^#[A-Za-z0-9_-]+$/.test(s) ? s : urlSure(s)))(texte(c.quoteUrl ?? c.devisUrl, 500)),
    /*
     * LES DEUX CHAMPS DE LA PAGE DÉDIÉE, ET LE DÉFAUT EST « DANS LA FICHE ».
     *
     * `wp_localize_script` sérialise `true` en « 1 », donc le booléen est lu
     * comme `priceBases` lit les siens : trois écritures acceptées, et tout le
     * reste vaut faux. Un défaut à faux et pas à vrai parce que la fiche produit
     * est le seul endroit d'où l'éditeur démarre aujourd'hui, et qu'une page qui
     * n'a rien dit n'est pas une page dédiée.
     */
    atelier: c.atelier === true || c.atelier === '1' || c.atelier === 1,
    productImage: urlSure(c.productImage),
    // Publié, il gagne ; absent, `MAX_COULEURS_DEFAUT` sert, et l'en-tête de la
    // constante dit pourquoi zéro n'est pas une option ici.
    maxCouleurs: entier(c.maxColours, 0, 64, 0) || MAX_COULEURS_DEFAUT,
    connecte: c.loggedIn === true || c.loggedIn === '1' || c.loggedIn === 1,
    compteUrl: urlSure(c.accountUrl),
    maxModeles: entier(c.maxModels, 0, 50, 0),
    // Le même alphabet que `Design::valid_id` : ce qui n'en a pas la forme n'est
    // pas un modèle, et n'est pas demandé au serveur.
    modele: /^[A-Za-z0-9_-]{16,64}$/.test(texte(c.model, 64)) ? texte(c.model, 64) : '',
  }
}
