/**
 * L'éditeur, DANS la page de la boutique. La vue simple, et rien de plus.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER NE FAIT PAS, ET C'EST LE PLUS IMPORTANT
 *
 * Il ne dessine pas le vêtement, il ne mesure pas l'encre, il ne construit pas
 * le document de création et il ne calcule aucun prix. Tout cela existe déjà et
 * une seconde implémentation serait la faute que `CLAUDE.md` section 1 nomme :
 * deux endroits qui calculent une surface finissent par diverger, et le jour où
 * ils divergent le client voit un chiffre et la facture en dit un autre.
 *
 *   `EditorEngine`         dessine, place, déplace, redimensionne (Konva),
 *                          avec les MÊMES fonctions de tracé que l'export DTF
 *   `src/lib/ink.ts`       mesure l'encre, la seule implémentation, celle que
 *                          lisent le coût du film ET le prix client
 *   `measureOrder`         en tire les faces imprimées, en cm²
 *   `uploadDesign`         dépose sur R2 et rend l'identifiant
 *   `Pricing.php`          calcule le prix, et lui seul
 *
 * Ce fichier est l'écran, l'ordre des opérations, et les phrases françaises.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * L'ORDRE, MOT POUR MOT, ET IL NE SE RÉARRANGE PAS
 *
 *   1. `ensureInkProbes` se stabilise dans le navigateur (dans `measureOrder`)
 *   2. le serveur chiffre (`GET /wp-json/teeshoop/v1/quote`)
 *   3. le fichier part sur R2 et rend un identifiant (`POST /api/design`)
 *   4. l'ajout au panier, avec le nonce de la page (`POST …/cart`)
 *
 * Aucune surface et aucun prix ne voyagent dans la requête d'ajout autrement
 * que pour être COMPARÉS : `Cart::add` redérive le vêtement depuis
 * `Product::garment_of` et les faces depuis le document que le Worker a stocké,
 * et journalise l'écart s'il y en a un.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TOUT L'ÉTAT EST DANS L'INSTANCE
 *
 * Pas une variable mutable de niveau module dans ce fichier, et c'est la réponse
 * à la sixième raison de `Shortcode.php` : deux éditeurs sur un document
 * coexistent, chacun avec sa création, sa sélection, son moteur et son abandon
 * de requête. `scripts/editeur-guard.mjs` refuse un `let` ou un `var` au niveau
 * du module dans tout `src/native/`, et `main.ts` dit ce qui reste partagé et
 * pourquoi c'est de la configuration de document plutôt qu'un singleton.
 */
import type { Design, ImageLayer, Layer, Side, SizeId } from '@/lib/types'
import { EditorEngine } from '@/editor/EditorEngine'
import { addAsset, removeAsset, sweepAssets } from '@/state/assets'
import { garmentHexOf, setShopPalette } from '@/content/garmentPalette'
import { clampLayersToArea, getAreaSizeIn, renderMockup, renderPrintArea } from '@/lib/renderDesign'
import { ensureInkProbes, layerInkSize } from '@/lib/ink'
import { measureOrder, uploadDesign, DesignUploadError } from '@/lib/teeshoop/upload'
import { inToCm, fmtNum } from '@/lib/units'
import { setCurrentLang } from '@/i18n/lang'
import { facesPermises, type Contexte } from './contexte'
import {
  ajouterAuPanier,
  calquesDuModele,
  demanderDevis,
  enregistrerModele,
  imagesDuModele,
  lireImageModele,
  lireModele,
  listerModeles,
  RefusAtelier,
  supprimerModele,
  type Devis,
  type FaceImprimee,
  type ListeModeles,
  type Modele,
} from './atelier'
import { fusionner, lisibiliteSur, recenser, type Encre, type Lisibilite } from './contraste'
import { COPIE } from './copie'
import { el, vider } from './dom'
import { Historique } from './historique'

/** Ce qu'une instance montée rend à qui l'a montée. */
export interface Editeur {
  /** Rendre le conteneur à la page, sans laisser un écouteur derrière. */
  detruire(): void
  /** Pour les tests et le harnais : la création telle qu'elle est. */
  creationActuelle(): Design
}

/**
 * Où en est l'achat. Chaque valeur a un écran, y compris celles qui ratent.
 *
 * `mesure` est visible : sur un téléphone, mesurer l'encre d'un visuel de
 * quatre mégapixels prend une seconde et demie, et un bouton qui ne répond pas
 * pendant une seconde et demie est un bouton qu'on reclique.
 */
type Phase = 'repos' | 'mesure' | 'depot' | 'ajout' | 'ajoute' | 'echec'

/**
 * Ce que la vue avancée rend à l'éditeur qui l'a ouverte.
 *
 * DÉCRIT PAR SA FORME, PAS IMPORTÉ. `import type { VueAvancee } from
 * './avancee'` serait effacé par TypeScript et par `scripts/admin-boundary.mjs`
 * (qui saute les imports de type), donc la garde resterait verte ; c'est
 * l'écriture qui compte : ce fichier ne doit avoir aucune raison de nommer le
 * module paresseux ailleurs que dans son `import()`.
 */
type PanneauAvance = {
  fermer(): void
  /** Redessiner après un changement venu d'ailleurs (annuler, rétablir). */
  rafraichir(): void
  /** Remettre à jour les seuls champs en centimètres (EDI-09). */
  rafraichirCotes(): void
  /** Ouvrir le champ de texte sur ce calque et y poser le curseur. */
  modifierTexte(id: string): void
}

/** Combien de pièces au maximum une case de taille accepte à la frappe. */
const QTE_MAX_CASE = 100000

/**
 * Les deux étapes, et la raison pour laquelle il n'y a pas de navigation.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DEUX ÉCRANS, UNE PAGE, UN SEUL ÉTAT
 *
 * Créer puis choisir sont deux gestes différents : le premier se fait au doigt
 * sur un canevas, le second se tape dans un tableau. Les mettre sur un seul
 * écran donnait une colonne où le choix des tailles était à côté du choix de la
 * police, et sur un téléphone la grille tombait sous la ligne de flottaison.
 *
 * Ce sont deux ÉTATS et pas deux pages : un aller-retour vers le serveur entre
 * les deux perdrait la création, qui n'existe que dans ce navigateur (les
 * octets du visuel sont dans IndexedDB et le document dans cette instance).
 * Revenir en arrière ne coûte donc rien et ne perd rien, ce qui est la
 * propriété que l'indicateur d'étapes promet.
 */
type Etape = 1 | 2

/**
 * Une ligne de la grille : un coloris, et ses quantités par taille.
 *
 * UN TABLEAU ET PAS UN OBJET INDEXÉ PAR COLORIS, parce que l'ORDRE des lignes
 * est ce que le client vient de construire : retirer « noir » puis le remettre
 * le renverrait en bas d'un objet, sous « blanc » qu'il avait ajouté après.
 */
interface LigneCommande {
  couleur: string
  qte: Record<string, number>
}

/**
 * La définition à laquelle l'encre est recensée pour la mesure de contraste,
 * pixels sur le plus grand côté de la zone d'impression.
 *
 * C'est une borne de COÛT et pas une prétention de mesure : la question posée à
 * ces pixels est « de quelle couleur est cette encre », qui ne demande pas de
 * géométrie. À 256 pixels sur une zone de 30 cm, un pixel vaut 1,2 mm, et le
 * recensement d'une face coûte 65 000 pixels au lieu des 1,2 million qu'une
 * mesure à 100 points par pouce demanderait. Ce que le rééchantillonnage change
 * est décrit dans `src/native/contraste.ts` : il ramène les bords vers la
 * transparence, donc vers l'échec du seuil, donc vers l'avertissement, qui est
 * le côté prudent puisqu'un avertissement ne refuse rien.
 */
const COTE_RECENSEMENT_PX = 256

/** La largeur d'un aperçu de coloris, en pixels CSS. */
const APERCU_LARGEUR_CSS = 220

/**
 * Ce qu'un fichier déposé a le droit d'être, décidé par le navigateur.
 *
 * Le Worker refait le contrôle sur le CONTENEUR entier (`worker/containers.ts`,
 * jamais sur les premiers octets, mesuré : une signature PNG collée devant
 * 300 ko d'urandom passait). Celui-ci n'est donc pas une sécurité, c'est une
 * phrase française dite tout de suite plutôt qu'un 415 après l'attente.
 */
const TYPES_ACCEPTES = 'image/png,image/jpeg,image/webp,image/svg+xml'
const OCTETS_MAX = 12 * 1024 * 1024
/** Au-delà, un fichier laissé par une page fermée sans prévenir est effacé (EDI-08). */
const ACTIFS_DUREE_MS = 24 * 60 * 60 * 1000

export function monter(hote: HTMLElement, ctx: Contexte): Editeur {
  return new Instance(hote, ctx)
}

class Instance implements Editeur {
  private readonly ctx: Contexte
  private readonly hote: HTMLElement
  private moteur: EditorEngine | null = null
  private creation: Design
  /**
   * La face que le canevas montre, et celle qui reçoit le prochain calque.
   *
   * ELLE EST DANS L'ÉTAT DE L'ÉDITEUR ET PLUS DANS CELUI DU PANNEAU. La vue
   * avancée avait son propre `face`, si bien que cliquer « Dos » n'y changeait
   * que la liste de calques : le canevas continuait de montrer le devant, le
   * dépôt de fichier continuait d'y poser, et un client qui décorait le dos
   * achetait un vêtement qu'il n'avait jamais vu.
   */
  private face: Side
  private selection: string | null = null
  /** Où en est le client : créer, ou choisir. Voir `Etape`. */
  private etape: Etape = 1
  /**
   * La grille coloris x taille, dans l'ordre où le client a ajouté les lignes.
   *
   * C'EST LA SEULE SAISIE DE QUANTITÉ DE L'ÉDITEUR. La vue simple avait une
   * rangée de cases par taille, à côté du canevas ; elle ne pouvait porter
   * qu'un coloris, donc trois coloris demandaient trois passages, trois
   * créations, trois lignes de panier, et `Pricing::qty_discount` s'appliquant
   * par ligne, le client payait plus cher POUR AVOIR CHOISI PLUSIEURS COULEURS
   * (102,00 EUR mesurés sur trente pièces en trois coloris, voir `Cart::add`).
   * Garder les deux saisies aurait été deux endroits où l'on tape une quantité,
   * donc deux totaux possibles pour une commande.
   */
  private lignes: LigneCommande[] = []
  private readonly histoire = new Historique<Design>()
  private phase: Phase = 'repos'
  private echec = ''
  private devis: Devis | null = null
  private devisEtat: 'vide' | 'chargement' | 'ok' | 'echec' = 'vide'
  private devisEchec = ''
  private faces: FaceImprimee[] = []
  private detruit = false
  private observateur: ResizeObserver | null = null
  private timerDevis: number | null = null
  private annuleDevis: AbortController | null = null
  private sequenceDevis = 0
  /**
   * Ce qui est parti au panier au dernier ajout réussi : la création (immuable,
   * donc son identité suffit) et la matrice sérialisée. Voir `dejaAjoute()`.
   */
  private ajouteCreation: Design | null = null
  private ajouteMatrice = ''
  private panierUrl = ''
  /** Ce que la confirmation annonce : ce qui est VRAIMENT parti au panier. */
  private ajoutePieces = 0
  private ajouteColoris = 0
  private avancee: PanneauAvance | null = null
  /**
   * Le chargement du panneau en vol, pour qu'il n'y en ait qu'un.
   *
   * Deux demandes avant la première réponse (un double-clic sur un texte
   * pendant que le bouton charge déjà) montaient DEUX panneaux sur le même
   * noeud : le second vidait le DOM du premier, `this.avancee` désignait le
   * second, et le premier restait vivant sans que personne puisse le fermer.
   * C'est la forme exacte du défaut que `vite.editeur.config.ts` raconte avec
   * « Several Konva instances detected ».
   */
  private attenteAvancee: Promise<PanneauAvance | null> | null = null
  /**
   * Les modèles du compte pour ce type de vêtement (`includes/Modeles.php`).
   *
   * `null` tant que la liste n'est pas arrivée. `travail` pendant qu'un
   * enregistrement, une application ou une suppression est en vol : un double
   * clic ne part pas deux fois, et deux gestes ne se croisent pas.
   */
  private modeles: ListeModeles | null = null
  private modelesEtat: 'repos' | 'chargement' | 'travail' = 'repos'
  private modelesMessage = ''
  private modelesErreur = false
  /** Les boutons de face, construits une fois. Voir `rendreFaces`. */
  private readonly boutonsFace: { face: Side; bouton: HTMLButtonElement }[] = []
  /** Les pastilles de l'indicateur d'étapes, construites une fois. */
  private readonly boutonsEtape: { etape: Etape; bouton: HTMLButtonElement }[] = []
  /**
   * L'encre de la création, recensée une fois par état du document.
   *
   * `null` en valeur veut dire « on n'a pas pu regarder » et pas « il n'y en a
   * pas » : c'est ce que `contraste.ts` distingue, et c'est ce qui fait dire à
   * l'écran qu'il n'a pas mesuré plutôt que de se taire.
   */
  private encre: { signature: string; mesure: Encre | null } | null = null
  /** La lisibilité par coloris, vidée en même temps que le recensement. */
  private readonly lisibilite = new Map<string, Lisibilite>()
  /**
   * Ce que les aperçus montrent en ce moment : la création et les coloris.
   *
   * Un jeton suffirait à annuler un rendu périmé ; la signature sert à ne PAS
   * relancer un rendu identique, ce qui est le cas courant (chaque frappe dans
   * une case de quantité repasse par le rendu de l'étape 2).
   */
  private signatureApercus = ''
  private jetonApercus = 0
  /** Un rechiffrage demandé à l'étape 1, où aucun prix n'est montré (EDI-12). */
  private devisPerime = false
  /** Les fichiers que CETTE instance a rangés dans IndexedDB, à effacer en partant (EDI-08). */
  private readonly actifs = new Set<string>()

  // Les noeuds que le rendu réécrit. Tenus plutôt que re-cherchés : une requête
  // par frappe sur un DOM que le thème peut avoir enveloppé coûte plus que six
  // références.
  private noeuds!: {
    scene: HTMLDivElement
    vide: HTMLParagraphElement
    outils: HTMLDivElement
    photo: HTMLImageElement
    photoLegende: HTMLElement
    couleurs: HTMLDivElement
    prix: HTMLDivElement
    achat: HTMLButtonElement
    etat: HTMLDivElement
    fichier: HTMLInputElement
    annuler: HTMLButtonElement
    retablir: HTMLButtonElement
    avance: HTMLButtonElement
    zoneAvancee: HTMLDivElement
    creer: HTMLDivElement
    choisir: HTMLDivElement
    valider: HTMLButtonElement
    validerNote: HTMLParagraphElement
    matrice: HTMLDivElement
    apercus: HTMLDivElement
    modelesConnexion: HTMLParagraphElement
    modelesListe: HTMLUListElement
    modelesNote: HTMLParagraphElement
    modeleNomEtiquette: HTMLLabelElement
    modeleNom: HTMLInputElement
    modeleNomAide: HTMLParagraphElement
    modeleEnregistrer: HTMLButtonElement
    modelesEtat: HTMLParagraphElement
  }

  constructor(hote: HTMLElement, ctx: Contexte) {
    this.hote = hote
    this.ctx = ctx
    /*
     * LES FICHIERS D'UN CLIENT NE RESTENT PAS DANS CE NAVIGATEUR (EDI-08).
     * L'éditeur ne restaure aucune création, et chaque visuel déposé restait
     * dans l'IndexedDB de la boutique pour toujours : lisible par le suivant
     * sur un poste partagé, jusqu'à remplir le quota. Ceux de cette instance
     * partent avec la page ; un balayage à l'ouverture reprend ceux d'une page
     * fermée sans prévenir, par l'âge, parce qu'un autre onglet ou un second
     * éditeur de la page tiennent peut-être encore les leurs.
     */
    void sweepAssets(ACTIFS_DUREE_MS).catch(() => undefined)
    window.addEventListener('pagehide', this.surDepart)
    /*
     * LA FACE DE DÉPART EST LA PREMIÈRE QUE LE PRODUIT DÉCLARE, pas « devant ».
     *
     * Une référence dont le fabricant refuse le marquage devant existerait
     * alors sans que l'écran propose une face que le bon de commande
     * refuserait. `facesPermises` porte la règle et son test.
     */
    this.face = facesPermises(ctx)[0] ?? 'front'

    /*
     * LE FRANÇAIS, POSÉ AVANT LE PREMIER TRACÉ.
     *
     * `EditorEngine` écrit l'étiquette de la zone d'impression avec `t()`, qui
     * lit la langue globale. Le studio la prenait dans le stockage local du
     * visiteur : un client qui avait essayé l'anglais dans le studio de
     * démonstration retrouvait « Print area » sur une fiche produit française.
     * La boutique est en français et ne propose pas de la changer.
     */
    setCurrentLang('fr')

    /*
     * LE NUANCIER DE CE PRODUIT, celui que l'atelier peut acheter.
     *
     * `setShopPalette` est la seule valeur de niveau module que cet éditeur
     * écrit, et c'est de la CONFIGURATION DE DOCUMENT, pas un singleton : une
     * fiche produit vend un article. `main.ts` n'en monte qu'un par page et dit
     * pourquoi. Une liste vide efface la restriction au lieu de supprimer
     * toutes les couleurs, ce qui est le studio hors boutique.
     */
    setShopPalette(
      ctx.couleurs.length > 0
        ? ctx.couleurs.map((c) => ({ id: c.id, name: c.nom, stops: c.teintes }))
        : null,
    )

    this.creation = this.creationVide()
    this.construire()
    this.rendre()
    // Les modèles du compte, quand il y a un compte et que la boutique en propose.
    if (this.ctx.connecte && this.ctx.maxModeles > 0) void this.chargerModeles()
  }

  // ------------------------------------------------------------- la création

  /**
   * Une création VIDE, sur le produit qui a été cliqué.
   *
   * Le studio encadré restaurait le dernier brouillon du visiteur ou chargeait
   * `makeSampleDesign()`, un t-shirt noir portant « TSHOP » en arche : un client
   * qui cliquait « Personnaliser » sur un sweat voyait le vêtement de quelqu'un
   * d'autre, travaillait dessus, et s'entendait dire au dernier clic que cette
   * page vendait autre chose.
   */
  private creationVide(): Design {
    const couleur = this.ctx.couleurs[0]?.id ?? 'white'
    const design: Design = {
      id: identifiant(),
      name: this.ctx.titre || 'Création',
      garmentId: this.ctx.garment as Design['garmentId'],
      colorId: couleur,
      custom: null,
      layers: [],
      stashedLayers: [],
      /*
       * Le marquage grandit avec le vêtement vendu. `scaled` est ce que la
       * nuit 2 a mesuré comme le comportement attendu, et `baseSize` est la
       * taille sur laquelle le tarif est calé, pas celle que l'aperçu montre :
       * mesuré le 5 septembre, un marquage calé sur le M occupe 19,1 % de plus
       * de la poitrine en S qu'en 3XL sur le Gildan Heavy Cotton.
       */
      printScale: { mode: 'scaled', baseSize: this.tailleTarif() },
      updatedAt: Date.now(),
    }
    if (Object.keys(this.ctx.demiPoitrine).length > 0) {
      design.shopSizeChart = {
        garmentId: design.garmentId as 'tee' | 'hoodie',
        productId: this.ctx.productId,
        halfChestCm: this.ctx.demiPoitrine as Partial<Record<SizeId, number>>,
      }
    }
    return design
  }

  private tailleTarif(): SizeId {
    const t = this.ctx.tailleTarif.toUpperCase()
    return (this.ctx.tailles.includes(t) ? t : this.ctx.tailles[0] ?? 'M') as SizeId
  }

  creationActuelle(): Design {
    return this.creation
  }

  // ------------------------------------------------------------------ le DOM

  private construire(): void {
    vider(this.hote)
    this.hote.classList.add('tshop-ed')
    /*
     * UNE CLASSE SÉPARE LA PAGE DÉDIÉE DE LA FICHE PRODUIT, ET C'EST TOUT.
     *
     * `atelier` ne change ni l'ordre des opérations, ni le document, ni une
     * seule règle de prix : il change la place des blocs et fait apparaître le
     * rappel du produit, parce qu'une page qui ne montre que l'éditeur doit dire
     * sur quoi on travaille et comment revenir. Deux éditeurs auraient été deux
     * endroits où corriger le prochain défaut de l'ajout au panier.
     */
    if (this.ctx.atelier) this.hote.classList.add('tshop-ed--atelier')
    /*
     * Le conteneur prend le clavier, et les raccourcis y sont attachés.
     *
     * Cinquième raison de `Shortcode.php` : le studio posait trois écouteurs
     * clavier sur `window`, si bien qu'une frappe destinée à la recherche du
     * thème pouvait supprimer un calque. Ici l'écouteur est sur ce conteneur,
     * donc il ne voit une touche que quand le focus est dedans, et
     * `scripts/editeur-guard.mjs` refuse le paquet si `window.addEventListener`
     * ou `document.addEventListener` y apparaît avec un événement de clavier.
     */
    this.hote.tabIndex = -1
    this.hote.addEventListener('keydown', this.surTouche)

    const scene = el('div', 'tshop-ed__scene')
    const toile = el('div', 'tshop-ed__toile')
    scene.append(toile)

    const vide = el('p', 'tshop-ed__vide')
    vide.textContent = COPIE.videTitre
    scene.append(vide)

    const outils = el('div', 'tshop-ed__outils')
    outils.hidden = true

    const photo = document.createElement('img')
    photo.className = 'tshop-ed__photo'
    photo.alt = ''
    photo.loading = 'lazy'
    photo.decoding = 'async'
    const photoLegende = el('p', 'tshop-ed__legende')
    const bandePhoto = el('div', 'tshop-ed__bande')
    bandePhoto.append(photo, photoLegende)

    /*
     * ANNULER ET RÉTABLIR, AVEC DEUX BOUTONS EN PLUS DES DEUX RACCOURCIS.
     *
     * Le raccourci seul ne se découvre pas, et sur un téléphone il n'existe
     * pas : la moitié des visiteurs d'une fiche produit n'a pas de clavier. Un
     * état désactivé dit en plus ce qui est possible sans qu'on ait à essayer,
     * ce qu'un bouton qui ne fait rien ne dit pas.
     */
    const historique = el('div', 'tshop-ed__historique')
    historique.setAttribute('role', 'group')
    historique.setAttribute('aria-label', COPIE.historiqueLegende)
    const annuler = boutonHistorique(COPIE.annuler, COPIE.annulerLong, 'Control+Z', 'annuler')
    annuler.addEventListener('click', () => this.defaire())
    const retablir = boutonHistorique(
      COPIE.retablir,
      COPIE.retablirLong,
      'Control+Shift+Z',
      'retablir',
    )
    retablir.addEventListener('click', () => this.refaire())
    historique.append(annuler, retablir)

    const couleurs = el('div', 'tshop-ed__couleurs')
    couleurs.setAttribute('role', 'radiogroup')
    couleurs.setAttribute('aria-label', COPIE.couleurLegende)

    /*
     * LES FACES SONT CONSTRUITES UNE FOIS, ET LE RENDU NE FAIT QUE COCHER.
     *
     * La liste ne bouge pas : elle vient de `ctx`, qui est figé pour la vie de
     * l'instance. Les reconstruire à chaque rendu coûtait le FOCUS : cliquer
     * « Dos » au clavier détruisait le bouton qu'on venait d'activer, et le
     * focus retombait sur le corps de la page, donc la tabulation repartait du
     * haut du document. Le même rendu tourne à chaque frappe du champ de texte.
     */
    const faces = el('div', 'tshop-ed__faces')
    faces.setAttribute('role', 'radiogroup')
    faces.setAttribute('aria-label', COPIE.faceLegende)
    const permises = facesPermises(this.ctx)
    for (const f of permises) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'tshop-ed__face'
      b.setAttribute('role', 'radio')
      b.setAttribute('data-teeshoop', `face-${f}`)
      b.textContent = COPIE.face(f)
      b.addEventListener('click', () => this.choisirFace(f))
      faces.append(b)
      this.boutonsFace.push({ face: f, bouton: b })
    }
    const blocFaces = section(COPIE.faceLegende, faces)
    /*
     * UN GROUPE À UNE SEULE OPTION EST DU BRUIT QUI RESSEMBLE À UN RÉGLAGE : sur
     * une référence sans dos ni manche imprimables, le bloc entier disparaît.
     */
    blocFaces.hidden = permises.length < 2

    const fichier = document.createElement('input')
    fichier.type = 'file'
    fichier.accept = TYPES_ACCEPTES
    fichier.className = 'tshop-ed__fichier'
    fichier.id = `tshop-ed-fichier-${this.ctx.productId}`
    const etiquetteFichier = document.createElement('label')
    etiquetteFichier.className = 'tshop-ed__depot'
    etiquetteFichier.htmlFor = fichier.id
    etiquetteFichier.textContent = COPIE.deposer
    fichier.addEventListener('change', this.surFichier)

    /*
     * LE PASSAGE À L'ÉTAPE 2, ET LA PHRASE QUI DIT POURQUOI IL EST FERMÉ.
     *
     * Un bouton grisé sans explication est un bouton sur lequel on clique trois
     * fois avant de partir. La note porte un identifiant et le bouton la
     * DÉSIGNE (`aria-describedby`), donc un lecteur d'écran l'annonce en même
     * temps que l'état désactivé, au lieu de dire « bouton, indisponible » et
     * rien d'autre.
     */
    const valider = document.createElement('button')
    valider.type = 'button'
    valider.className = 'tshop-ed__valider'
    valider.setAttribute('data-teeshoop', 'valider-creation')
    valider.textContent = COPIE.valider
    valider.addEventListener('click', () => this.allerA(2))
    const validerNote = el('p', 'tshop-ed__note')
    validerNote.id = `tshop-ed-valider-${this.ctx.productId}`
    validerNote.textContent = COPIE.validerSansVisuel
    valider.setAttribute('aria-describedby', validerNote.id)

    const prix = el('div', 'tshop-ed__prix')
    prix.setAttribute('aria-live', 'polite')

    const achat = document.createElement('button')
    achat.type = 'button'
    achat.className = 'tshop-ed__acheter'
    achat.setAttribute('data-teeshoop', 'add-to-cart')
    achat.addEventListener('click', this.surAchat)

    const etat = el('div', 'tshop-ed__etat')
    etat.setAttribute('aria-live', 'polite')

    const avance = document.createElement('button')
    avance.type = 'button'
    avance.className = 'tshop-ed__avance'
    avance.textContent = COPIE.ouvrirAvancee
    avance.setAttribute('data-teeshoop', 'vue-avancee')
    avance.addEventListener('click', this.surAvancee)
    const zoneAvancee = el('div', 'tshop-ed__zone-avancee')

    // ------------------------------------------------------------- étape 2
    const retour = document.createElement('button')
    retour.type = 'button'
    retour.className = 'tshop-ed__outil'
    retour.setAttribute('data-teeshoop', 'revenir-creation')
    retour.textContent = COPIE.revenir
    retour.addEventListener('click', () => this.allerA(1))

    const matrice = el('div', 'tshop-ed__matrice')
    const apercus = el('div', 'tshop-ed__apercus')

    /*
     * MES MODÈLES. Construits une fois, comme les faces : le champ du nom doit
     * garder son texte et son focus pendant que le reste de l'écran se
     * redessine à chaque frappe ailleurs. Seule la liste est reconstruite, et
     * seulement quand elle change (`rendreModelesListe`).
     */
    const modelesConnexion = el('p', 'tshop-ed__note')
    modelesConnexion.append(texte(COPIE.modelesConnexion + ' '))
    if (this.ctx.compteUrl !== '') {
      const lien = document.createElement('a')
      lien.className = 'tshop-ed__lien'
      lien.href = this.ctx.compteUrl
      lien.textContent = COPIE.modelesSeConnecter
      modelesConnexion.append(lien)
    }
    const modelesListe = el('ul', 'tshop-ed__modeles')
    const modelesNote = el('p', 'tshop-ed__note')
    const modeleNom = document.createElement('input')
    modeleNom.type = 'text'
    modeleNom.maxLength = 60
    modeleNom.autocomplete = 'off'
    modeleNom.className = 'tshop-ed__nom-modele'
    modeleNom.id = `tshop-ed-modele-${this.ctx.productId}`
    modeleNom.setAttribute('data-teeshoop', 'nom-modele')
    const modeleNomEtiquette = document.createElement('label')
    modeleNomEtiquette.className = 'tshop-ed__champ-nom'
    modeleNomEtiquette.htmlFor = modeleNom.id
    modeleNomEtiquette.textContent = COPIE.modeleNom
    const modeleNomAide = el('p', 'tshop-ed__note')
    modeleNomAide.id = `tshop-ed-modele-aide-${this.ctx.productId}`
    modeleNomAide.textContent = COPIE.modeleNomAide
    modeleNom.setAttribute('aria-describedby', modeleNomAide.id)
    modeleNom.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return
      e.preventDefault()
      void this.enregistrerModele()
    })
    const modeleEnregistrer = document.createElement('button')
    modeleEnregistrer.type = 'button'
    modeleEnregistrer.className = 'tshop-ed__outil'
    modeleEnregistrer.setAttribute('data-teeshoop', 'enregistrer-modele')
    modeleEnregistrer.textContent = COPIE.modeleEnregistrer
    modeleEnregistrer.addEventListener('click', () => void this.enregistrerModele())
    const modelesEtat = el('p', 'tshop-ed__note')
    modelesEtat.setAttribute('role', 'status')
    const blocModeles = section(
      COPIE.modelesLegende,
      modelesConnexion,
      modelesListe,
      modelesNote,
      modeleNomEtiquette,
      modeleNom,
      modeleNomAide,
      modeleEnregistrer,
      modelesEtat,
    )
    blocModeles.setAttribute('data-teeshoop', 'modeles')
    // La boutique n'a pas publié de plafond : elle ne propose pas de modèles.
    blocModeles.hidden = this.ctx.maxModeles === 0

    /*
     * CHAQUE ÉCRAN EST UN GROUPE NOMMÉ ET PEUT RECEVOIR LE FOCUS.
     *
     * `tabIndex = -1` le rend atteignable par `focus()` sans l'ajouter à l'ordre
     * de tabulation ; `role` et `aria-label` font qu'un lecteur d'écran annonce
     * OÙ le focus vient d'arriver. Sans les deux, valider sa création renvoyait
     * un client au clavier tabuler depuis le haut du document, vers un écran
     * qu'il ne voit plus.
     */
    const creer = el('div', 'tshop-ed__etape tshop-ed__etape--creer')
    creer.tabIndex = -1
    creer.setAttribute('role', 'group')
    creer.setAttribute('aria-label', COPIE.etapeCreerLong)
    creer.append(
      scene,
      historique,
      outils,
      bandePhoto,
      section(COPIE.couleurLegende, couleurs),
      blocFaces,
      section(COPIE.visuelLegende, etiquetteFichier, fichier),
      blocModeles,
      valider,
      validerNote,
      avance,
      zoneAvancee,
    )

    const choisir = el('div', 'tshop-ed__etape tshop-ed__etape--choisir')
    choisir.tabIndex = -1
    choisir.setAttribute('role', 'group')
    choisir.setAttribute('aria-label', COPIE.etapeChoisirLong)
    // Les deux blocs portent une classe pour que la grande largeur puisse les
    // placer sans aller regarder ce qu'ils contiennent. Voir la feuille.
    const blocGrille = section(COPIE.matriceLegende, matrice)
    blocGrille.classList.add('tshop-ed__bloc--grille')
    const blocApercus = section(COPIE.apercusLegende, apercus)
    blocApercus.classList.add('tshop-ed__bloc--apercus')
    choisir.append(retour, blocGrille, blocApercus, prix, achat, etat)

    if (this.ctx.atelier && this.ctx.productImage !== '') this.hote.append(this.entete())
    this.hote.append(this.indicateurEtapes(), creer, choisir)

    this.noeuds = {
      scene: toile,
      vide,
      outils,
      photo,
      photoLegende,
      couleurs,
      prix,
      achat,
      etat,
      fichier,
      annuler,
      retablir,
      avance,
      zoneAvancee,
      creer,
      choisir,
      valider,
      validerNote,
      matrice,
      apercus,
      modelesConnexion,
      modelesListe,
      modelesNote,
      modeleNomEtiquette,
      modeleNom,
      modeleNomAide,
      modeleEnregistrer,
      modelesEtat,
    }

    this.demarrerMoteur(toile)
    this.brancherDepot(scene)
  }

  /**
   * L'en-tête de la page dédiée : la vignette de l'article, et rien d'autre.
   *
   * LE RETOUR ET LE NOM SONT DANS LA BARRE DE LA PAGE, PAS ICI. Le gabarit de
   * l'atelier (`templates/teeshoop/atelier.php`) pose « Retour à la fiche
   * produit » comme premier élément focalisable et le `h1` « Personnaliser :
   * <article> ». Ce bloc les répétait juste en dessous, relevé sur la capture à
   * 375 px du 26 septembre 2026 : deux liens de retour et deux fois le nom avant
   * le canevas. Reste la vignette, que la barre n'a pas.
   */
  private entete(): HTMLElement {
    /*
     * UN `div` ET PAS UN `header`, ET C'EST UNE MESURE.
     *
     * `<header>` hors d'un `article`, `aside`, `main`, `nav` ou `section` est un
     * repère `banner`. La page de l'atelier en a déjà un, sa propre barre
     * (`ts-atelier__bar`), donc celui-ci en faisait un SECOND : mesuré le
     * 9 septembre 2026 par `npm run verify:a11y`, « 3 repères : 2 banner,
     * plusieurs sans nom ». Deux bannières font que la navigation par repères,
     * qui est la façon dont on saute le décor pour arriver au contenu, mène une
     * fois sur deux au mauvais endroit. Ce bloc n'est pas la bannière de la
     * page : c'est un rappel de ce sur quoi on travaille.
     */
    const bloc = el('div', 'tshop-ed__entete')
    const img = document.createElement('img')
    img.className = 'tshop-ed__vignette'
    img.src = this.ctx.productImage
    img.alt = ''
    img.loading = 'lazy'
    img.decoding = 'async'
    bloc.append(img)
    return bloc
  }

  /**
   * Les deux pastilles d'étape, construites une fois comme celles des faces.
   *
   * Ce sont des BOUTONS et pas des liens : rien ne change d'adresse, et un lien
   * qui ne navigue pas est ce qu'un lecteur d'écran annonce comme une
   * navigation qui n'arrive jamais. L'étape en cours porte `aria-current="step"`
   * plutôt qu'une simple classe, parce que la couleur seule ne se lit ni au
   * clavier ni en contraste forcé.
   */
  private indicateurEtapes(): HTMLElement {
    const nav = el('nav', 'tshop-ed__etapes')
    nav.setAttribute('aria-label', COPIE.etapesLegende)
    const liste = el('ol', 'tshop-ed__etapes-liste')
    for (const [etape, court, long] of [
      [1, COPIE.etapeCreer, COPIE.etapeCreerLong],
      [2, COPIE.etapeChoisir, COPIE.etapeChoisirLong],
    ] as const) {
      const li = el('li', 'tshop-ed__etapes-item')
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'tshop-ed__etape-pas'
      b.textContent = court
      b.setAttribute('aria-label', long)
      b.setAttribute('data-teeshoop', `etape-${etape}`)
      if (etape === 2) b.setAttribute('aria-describedby', `tshop-ed-valider-${this.ctx.productId}`)
      b.addEventListener('click', () => this.allerA(etape))
      li.append(b)
      liste.append(li)
      this.boutonsEtape.push({ etape, bouton: b })
    }
    nav.append(liste)
    return nav
  }

  private demarrerMoteur(toile: HTMLDivElement): void {
    this.moteur = new EditorEngine(toile, {
      /*
       * QUATRE PHRASES, PAS UN DICTIONNAIRE.
       *
       * Le moteur écrivait ses étiquettes avec `t()` de `@/i18n`, qui tire
       * `messages.ts` et ses DEUX langues : 9 664 octets compressés de table de
       * traduction dans le paquet d'une boutique française qui ne propose pas
       * d'en changer, pour trois étiquettes dont deux ne sont jamais dessinées
       * ici (les repères et les emplacements sont coupés). Il les demande
       * maintenant, et voici les seules qu'il puisse demander.
       */
      t: (cle, params) => COPIE.etiquetteMoteur(cle, params),
      onSelect: (id) => {
        this.selection = id
        this.rendreOutils()
        void this.synchroniser()
      },
      onPatch: (id, patch, opts) => {
        /*
         * UN GLISSEMENT EST UN SEUL PAS D'HISTORIQUE, ET C'EST CE QUE LE NOM DU
         * GESTE ACHÈTE. Le moteur émet un correctif toutes les 66 ms tant que
         * le doigt bouge, puis un dernier, non transitoire, au relâchement :
         * sans regroupement, un déplacement demanderait une quinzaine
         * d'annulations. Le dernier porte le MÊME nom, donc il n'ouvre pas un
         * second pas, et `fin()` referme le geste juste après.
         */
        this.appliquerPatch(id, patch, `deplacer:${id}`)
        if (!opts.transient) {
          this.histoire.fin()
          this.chiffrerBientot()
        }
        this.rendreOutils()
        this.avancee?.rafraichirCotes()
      },
      onEditText: (id) => this.modifierTexte(id),
      onZoom: () => {},
      onSelection: () => this.rendreOutils(),
    })

    /*
     * La taille du canevas suit celle du conteneur, jamais celle de la fenêtre.
     *
     * `100dvh` et `body{overflow:hidden}` étaient la deuxième raison de garder
     * le cadre : le studio se dimensionnait sur la fenêtre et coupait le
     * défilement du site. Ici l'éditeur est un bloc dans le flux, il n'écrit ni
     * sur `body` ni sur `html`, et `scripts/editeur-guard.mjs` refuse le paquet
     * si une règle de sa feuille de style vise l'un des deux.
     */
    const suivre = (): void => {
      if (this.detruit || !this.moteur) return
      const r = toile.getBoundingClientRect()
      /*
       * ZÉRO N'EST PAS UNE TAILLE, C'EST « PAS MIS EN PAGE ».
       *
       * L'étape 1 est cachée par `hidden` pendant que le client remplit la
       * grille, donc `ResizeObserver` émet un rectangle de 0 x 0 au moment du
       * basculement. Recopier ce zéro dans le moteur ferait un canevas de 0 px,
       * et le retour à l'étape 1 dépend alors d'une seconde notification pour
       * réparer ce que la première a cassé. On ne l'écrit pas : la dernière
       * taille connue reste bonne, et la prochaine mesure non nulle la remplace.
       */
      const w = Math.round(r.width)
      const h = Math.round(r.height)
      if (w <= 0 || h <= 0) return
      this.moteur.setViewport(w, h)
    }
    if (typeof ResizeObserver === 'function') {
      this.observateur = new ResizeObserver(suivre)
      this.observateur.observe(toile)
    }
    suivre()
    void this.synchroniser()
  }

  /** Déposer un fichier sur la scène, ce qu'un client essaie en premier. */
  private brancherDepot(scene: HTMLElement): void {
    const stop = (e: DragEvent): void => {
      e.preventDefault()
      e.stopPropagation()
    }
    scene.addEventListener('dragover', (e) => {
      stop(e)
      scene.classList.add('tshop-ed__scene--survol')
    })
    scene.addEventListener('dragleave', () => scene.classList.remove('tshop-ed__scene--survol'))
    scene.addEventListener('drop', (e) => {
      stop(e)
      scene.classList.remove('tshop-ed__scene--survol')
      const f = e.dataTransfer?.files?.[0]
      if (f) void this.ajouterVisuel(f)
    })
  }

  // ------------------------------------------------------------- interaction

  private surTouche = (e: KeyboardEvent): void => {
    /*
     * LES RACCOURCIS N'EXISTENT QUE SUR L'ÉCRAN QU'ILS COMMANDENT.
     *
     * Annuler et supprimer agissent sur le document, qui n'est visible qu'à
     * l'étape 1. À l'étape 2, `Ctrl+Z` retirerait le dernier calque sans que
     * rien ne bouge à l'écran, et le client s'en apercevrait sur le vêtement :
     * c'est la même faute que la sélection qui traversait un changement de face
     * (`choisirFace`), un contrôle qui agit là où personne ne regarde. La
     * conséquence est que la création est FIGÉE pendant l'étape 2, ce dont les
     * aperçus et le recensement d'encre dépendent pour être justes.
     */
    if (this.etape !== 1) return
    /*
     * JAMAIS QUAND LA FRAPPE VISE UN CHAMP, et la liste compte TEXTAREA.
     *
     * Elle ne comptait qu'INPUT, ce qui suffisait tant que le seul champ était
     * une quantité. Le champ de texte d'un calque est un `textarea` : sans
     * cette ligne, effacer un caractère au clavier supprimait le calque qu'on
     * était en train d'écrire. Et `Ctrl+Z` dans un champ est l'annulation DU
     * CHAMP, que le navigateur fait mieux que nous ; l'événement `input`
     * qu'elle émet remet le document d'accord avec ce qui est écrit.
     */
    const cible = e.target as HTMLElement | null
    const champ =
      cible !== null &&
      (cible.tagName === 'INPUT' ||
        cible.tagName === 'TEXTAREA' ||
        cible.tagName === 'SELECT' ||
        cible.isContentEditable)

    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'z') {
      if (champ) return
      e.preventDefault()
      if (e.shiftKey) this.refaire()
      else this.defaire()
      return
    }

    if (!this.selection) return
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (champ) return
      e.preventDefault()
      this.supprimerSelection()
    }
  }

  private surFichier = (): void => {
    const f = this.noeuds.fichier.files?.[0]
    if (f) void this.ajouterVisuel(f)
    // Remis à zéro pour que le même fichier choisi deux fois déclenche bien
    // deux fois l'événement.
    this.noeuds.fichier.value = ''
  }

  private async ajouterVisuel(fichier: File): Promise<void> {
    if (fichier.size > OCTETS_MAX) {
      this.montrerEchec(COPIE.fichierTropLourd)
      return
    }
    if (fichier.type !== '' && !TYPES_ACCEPTES.split(',').includes(fichier.type)) {
      this.montrerEchec(COPIE.fichierMauvaisType)
      return
    }
    try {
      const meta = await addAsset(fichier, fichier.name)
      this.actifs.add(meta.id)
      /*
       * SUR LA FACE CHOISIE, ET LA ZONE EST CELLE DE CETTE FACE.
       *
       * Les deux chemins de dépôt passent ici : le glisser-déposer sur la scène
       * (`brancherDepot`) et le champ de fichier (`surFichier`). Il n'y avait
       * qu'une constante `front`, donc une image ne pouvait aller que devant,
       * et la vue avancée n'offrait aucun moyen d'en poser une ailleurs : dos
       * et manche ne pouvaient porter que du texte. La manche fait 10,2 cm de
       * côté en M contre 30,5 sur le devant, donc la taille de départ change
       * d'une face à l'autre et se lit ici.
       */
      const zone = getAreaSizeIn(this.creation, this.face)
      /*
       * 72 % de la largeur et 60 % de la hauteur de la zone, comme le studio.
       * Ce n'est pas une mesure, c'est une taille de DÉPART que le client
       * change au doigt ; ce qui est mesuré, et seul, c'est l'encre qu'elle
       * finit par couvrir (`src/lib/ink.ts`).
       */
      const echelle = Math.min((zone.wIn * 0.72) / meta.width, (zone.hIn * 0.6) / meta.height)
      const calque: ImageLayer = {
        id: identifiant(),
        type: 'image',
        side: this.face,
        name: meta.name,
        assetId: meta.id,
        xIn: 0,
        yIn: 0,
        rotation: 0,
        opacity: 1,
        wIn: meta.width * echelle,
        hIn: meta.height * echelle,
        flipX: false,
        useCutout: meta.hasCutout,
      }
      this.poser({
        ...this.creation,
        layers: [...this.creation.layers, calque],
        updatedAt: Date.now(),
      })
      this.selection = calque.id
      this.echec = ''
      this.rendre()
      this.avancee?.rafraichir()
      this.chiffrerBientot()
    } catch (e) {
      /*
       * « JE N'AI PAS PU LIRE » ET « JE N'AI PAS PU RANGER » NE SONT PAS LA
       * MÊME PANNE.
       *
       * `addAsset` décode le fichier PUIS l'écrit dans IndexedDB. Sur un
       * navigateur dont le quota d'origine est plein (Safari en navigation
       * privée, un téléphone plein), l'écriture lève `QuotaExceededError` alors
       * que le fichier a été lu parfaitement. La phrase « enregistrez-le en PNG
       * puis réessayez » envoie alors le client refaire exactement ce qui vient
       * de marcher, et la vente est perdue sur un conseil faux. Même forme que
       * la trouvaille numéro 1 de la passe précédente : deux états là où il en
       * faut trois.
       */
      const plein =
        e instanceof DOMException &&
        /Quota|NO_DEVICE_SPACE|NS_ERROR_FILE_NO_DEVICE_SPACE/i.test(e.name + ' ' + e.message)
      this.montrerEchec(plein ? COPIE.stockagePlein : COPIE.fichierIllisible)
    }
  }

  // ----------------------------------------------------- les modèles sauvegardés

  private async chargerModeles(): Promise<void> {
    this.modelesEtat = 'chargement'
    this.rendreModeles()
    try {
      this.modeles = await listerModeles(this.ctx)
      this.modelesMessage = ''
      this.modelesErreur = false
    } catch (e) {
      this.modelesMessage = this.phraseDe(e, COPIE.modelesChargementEchec)
      this.modelesErreur = true
    } finally {
      this.modelesEtat = 'repos'
      this.rendreModelesListe()
      this.rendreModeles()
    }
    /*
     * LE MODÈLE QUE L'ADRESSE DEMANDE (`?modele=`, depuis la page devis), une
     * fois la liste arrivée. La boutique a déjà vérifié qu'il est à ce client ;
     * la liste, elle, ne porte que les modèles de ce type de vêtement, donc un
     * modèle absent d'ici est un modèle fait pour autre chose, et l'écran le dit.
     */
    if (this.ctx.modele === '' || !this.modeles || this.detruit) return
    const demande = this.modeles.modeles.find((m) => m.id === this.ctx.modele)
    if (demande) {
      void this.appliquerModele(demande)
    } else {
      this.modelesMessage = COPIE.modeleAutreType
      this.modelesErreur = true
      this.rendreModeles()
    }
  }

  /**
   * Ce qui change à chaque rendu : l'état des boutons et la phrase. Le champ du
   * nom n'est jamais recréé ici, pour qu'il garde son texte et son focus.
   */
  private rendreModeles(): void {
    const n = this.noeuds
    if (this.ctx.maxModeles === 0) return
    const connecte = this.ctx.connecte
    n.modelesConnexion.hidden = connecte
    for (const x of [n.modelesListe, n.modelesNote, n.modeleNomEtiquette, n.modeleNom, n.modeleNomAide, n.modeleEnregistrer])
      x.hidden = !connecte
    const occupe = this.modelesEtat !== 'repos'
    n.modeleEnregistrer.disabled = occupe || this.creation.layers.length === 0
    n.modelesEtat.textContent =
      this.modelesEtat === 'chargement' && !this.modeles ? COPIE.modelesChargement : this.modelesMessage
    n.modelesEtat.className = this.modelesErreur ? 'tshop-ed__alerte' : 'tshop-ed__note'
    for (const b of Array.from(n.modelesListe.querySelectorAll('button'))) b.disabled = occupe
  }

  /** La liste elle-même, reconstruite quand elle change et seulement alors. */
  private rendreModelesListe(): void {
    const n = this.noeuds
    vider(n.modelesListe)
    const liste = this.modeles
    if (!liste) {
      n.modelesNote.textContent = ''
      return
    }
    for (const m of liste.modeles) {
      const li = el('li', 'tshop-ed__modele')
      if (m.apercu !== '') {
        const img = document.createElement('img')
        img.className = 'tshop-ed__modele-apercu'
        img.src = m.apercu
        img.alt = COPIE.modeleApercuAlt(m.nom)
        img.width = 56
        img.height = 56
        img.loading = 'lazy'
        img.decoding = 'async'
        li.append(img)
      }
      const nom = el('span', 'tshop-ed__modele-nom')
      nom.textContent = m.nom
      const appliquer = document.createElement('button')
      appliquer.type = 'button'
      appliquer.className = 'tshop-ed__outil'
      appliquer.textContent = COPIE.modeleAppliquer
      appliquer.setAttribute('aria-label', COPIE.modeleAppliquerLong(m.nom))
      appliquer.setAttribute('data-teeshoop', 'appliquer-modele')
      appliquer.addEventListener('click', () => void this.appliquerModele(m))
      const supprimer = document.createElement('button')
      supprimer.type = 'button'
      supprimer.className = 'tshop-ed__outil tshop-ed__outil--retirer'
      supprimer.textContent = COPIE.modeleSupprimer
      supprimer.setAttribute('aria-label', COPIE.modeleSupprimerLong(m.nom))
      supprimer.addEventListener('click', () => void this.supprimerModele(m))
      li.append(nom, appliquer, supprimer)
      n.modelesListe.append(li)
    }
    const compte = COPIE.modelesCompte(liste.total, liste.max)
    n.modelesNote.textContent = liste.modeles.length === 0 ? `${COPIE.modelesAucun} ${compte}` : compte
  }

  /**
   * Enregistrer la création comme modèle : elle part sur le Worker exactement
   * comme pour un achat (`uploadDesign`, idempotent : une création déjà déposée
   * pour le panier n'est pas renvoyée), puis la boutique la range dans le compte,
   * sur la preuve que le Worker a rendue à ce navigateur au dépôt.
   */
  private async enregistrerModele(): Promise<void> {
    if (this.modelesEtat !== 'repos') return
    const nom = this.noeuds.modeleNom.value.trim()
    const refus =
      this.creation.layers.length === 0
        ? COPIE.modeleSansVisuel
        : nom === ''
          ? COPIE.modeleSansNom
          : this.ctx.workerUrl === ''
            ? COPIE.depotNonConfigure
            : ''
    if (refus !== '') {
      this.modelesMessage = refus
      this.modelesErreur = true
      this.rendreModeles()
      if (nom === '') this.noeuds.modeleNom.focus()
      return
    }
    this.modelesEtat = 'travail'
    this.modelesMessage = COPIE.modeleEnregistrement
    this.modelesErreur = false
    this.rendreModeles()
    try {
      const depose = await uploadDesign(this.creation, { endpoint: this.ctx.workerUrl })
      this.modeles = await enregistrerModele(this.ctx, depose.id, depose.proof, nom)
      this.noeuds.modeleNom.value = ''
      this.modelesMessage = COPIE.modeleEnregistre(nom)
    } catch (e) {
      this.modelesMessage = this.phraseDe(e, COPIE.modeleEchecEnregistrement)
      this.modelesErreur = true
    } finally {
      this.modelesEtat = 'repos'
      this.rendreModelesListe()
      this.rendreModeles()
    }
  }

  /**
   * Poser un modèle sur le vêtement ouvert.
   *
   * CHAQUE IMAGE EST RAPATRIÉE SOUS UN NOUVEL IDENTIFIANT (`addAsset`), jamais
   * sous le sien : ce navigateur peut déjà porter cette image avec son
   * détourage, et l'importer sous le même identifiant écraserait l'original par
   * les octets détourés, pour toute autre création qui s'en sert. Les octets
   * rapatriés sont ceux que le modèle utilisait, d'où `useCutout` à faux.
   *
   * LE VÊTEMENT, LE COLORIS ET LE BARÈME RESTENT CEUX DU PRODUIT OUVERT ; seuls
   * les calques changent, et leurs centres sont ramenés dans la zone de ce
   * vêtement par LA règle du studio (`clampLayersToArea`), celle qu'il applique
   * quand on passe d'un t-shirt à un sweat. Le tout passe par `poser`, donc
   * « Annuler » revient à la création d'avant.
   */
  private async appliquerModele(m: Modele): Promise<void> {
    if (this.modelesEtat !== 'repos') return
    this.modelesEtat = 'travail'
    this.modelesMessage = COPIE.modeleApplication
    this.modelesErreur = false
    this.rendreModeles()
    try {
      const doc = await lireModele(this.ctx, m.id)
      const images = new Map<string, string>()
      for (const asset of imagesDuModele(doc)) {
        const meta = await addAsset(await lireImageModele(this.ctx, m.id, asset), m.nom || 'Modèle')
        this.actifs.add(meta.id)
        images.set(asset, meta.id)
      }
      if (this.detruit) return
      const { calques, ecartes } = calquesDuModele(doc, images, facesPermises(this.ctx))
      if (calques.length === 0) {
        this.modelesMessage = COPIE.modeleVide
        this.modelesErreur = true
        return
      }
      this.poser(clampLayersToArea({ ...this.creation, layers: calques, updatedAt: Date.now() }))
      this.selection = null
      this.echec = ''
      this.modelesMessage = COPIE.modeleApplique(m.nom) + (ecartes > 0 ? ` ${COPIE.modeleEcartes(ecartes)}` : '')
      // Le canevas montre une face qui porte le modèle, pas une face restée vide.
      if (!calques.some((l) => l.side === this.face)) this.choisirFace(calques[0].side)
      this.rendre()
      this.avancee?.rafraichir()
      this.chiffrerBientot()
    } catch (e) {
      const plein =
        e instanceof DOMException &&
        /Quota|NO_DEVICE_SPACE|NS_ERROR_FILE_NO_DEVICE_SPACE/i.test(e.name + ' ' + e.message)
      this.modelesMessage = plein ? COPIE.stockagePlein : this.phraseDe(e, COPIE.modeleEchec)
      this.modelesErreur = true
    } finally {
      this.modelesEtat = 'repos'
      this.rendreModeles()
    }
  }

  private async supprimerModele(m: Modele): Promise<void> {
    if (this.modelesEtat !== 'repos') return
    this.modelesEtat = 'travail'
    this.modelesErreur = false
    this.rendreModeles()
    try {
      this.modeles = await supprimerModele(this.ctx, m.id)
      this.modelesMessage = COPIE.modeleSupprime(m.nom)
    } catch (e) {
      this.modelesMessage = this.phraseDe(e, COPIE.modeleEchecSuppression)
      this.modelesErreur = true
    } finally {
      this.modelesEtat = 'repos'
      this.rendreModelesListe()
      this.rendreModeles()
      // Le bouton cliqué n'existe plus : le focus va au champ du nom plutôt qu'au
      // haut du document.
      this.noeuds.modeleNom.focus()
    }
  }

  private appliquerPatch(id: string, patch: Partial<Layer>, geste?: string): void {
    this.poser(
      {
        ...this.creation,
        layers: this.creation.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)),
        updatedAt: Date.now(),
      },
      geste,
    )
    void this.synchroniser()
  }

  private supprimerSelection(): void {
    if (!this.selection) return
    this.poser({
      ...this.creation,
      layers: this.creation.layers.filter((l) => l.id !== this.selection),
      updatedAt: Date.now(),
    })
    this.selection = null
    this.rendre()
    this.avancee?.rafraichir()
    this.chiffrerBientot()
  }

  private centrerSelection(): void {
    if (!this.selection) return
    this.appliquerPatch(this.selection, { xIn: 0 } as Partial<Layer>)
    this.avancee?.rafraichirCotes()
    this.chiffrerBientot()
  }

  private choisirCouleur(id: string): void {
    if (this.creation.colorId === id) return
    this.poser({ ...this.creation, colorId: id, updatedAt: Date.now() })
    this.rendre()
    // Pas de nouveau devis : la couleur ne change ni la surface ni le prix.
  }

  /**
   * LA FACE QUE LE CANEVAS MONTRE, ET CELLE QUI REÇOIT LE PROCHAIN CALQUE.
   *
   * Pas de nouveau devis : changer de face ne change rien à ce qui est imprimé.
   * `measureOrder` mesure DÉJÀ toutes les faces portant un calque, donc le prix
   * couvrait le dos avant que l'écran sache le montrer ; ce qui manquait était
   * l'écran, pas le chiffre.
   */
  private choisirFace(face: Side): void {
    if (face === this.face || !facesPermises(this.ctx).includes(face)) return
    this.face = face
    /*
     * ET LA SÉLECTION NE TRAVERSE PAS. Un calque sélectionné sur une autre face
     * garderait ses poignées de transformation et sa ligne « Retirer » sur un
     * objet que personne ne voit : un contrôle qui agit hors de l'écran.
     */
    if (!this.creation.layers.some((l) => l.id === this.selection && l.side === face)) {
      this.selection = null
    }
    this.rendre()
    this.avancee?.rafraichir()
  }

  // ---------------------------------------------------------- l'historique

  /**
   * Poser un document, en retenant celui qu'il remplace.
   *
   * TOUTES LES MODIFICATIONS PASSENT PAR ICI, y compris celles que la vue
   * avancée demande (`remplacer`). C'est la seule raison pour laquelle annuler
   * marche sur tout : un chemin d'écriture qui contourne ce point produirait un
   * pas d'historique manquant, c'est-à-dire une annulation qui saute
   * silencieusement par-dessus une modification que le client a faite.
   *
   * `geste` regroupe les modifications d'un même mouvement (un glissement, une
   * frappe continue) en un seul pas. Voir `src/native/historique.ts`.
   */
  private poser(suivant: Design, geste?: string): void {
    this.histoire.avant(this.creation, geste)
    this.creation = suivant
    /*
     * UNE SÉLECTION QUI NE DÉSIGNE PLUS RIEN EST EFFACÉE ICI, une fois, pour
     * tous les chemins. La vue avancée peut supprimer le calque que la vue
     * simple tient pour sélectionné : la barre d'outils disparaissait bien
     * (elle cherche le calque), mais la touche Suppr continuait de viser un
     * identifiant qui n'existait plus.
     */
    if (!suivant.layers.some((l) => l.id === this.selection)) this.selection = null
    this.rendreHistorique()
  }

  private defaire(): void {
    const precedent = this.histoire.annuler(this.creation)
    if (!precedent) return
    this.creation = precedent
    this.apresHistorique(true)
  }

  private refaire(): void {
    const suivant = this.histoire.retablir(this.creation)
    if (!suivant) return
    this.creation = suivant
    this.apresHistorique(true)
  }

  /**
   * Abandonner le geste en cours, ce qu'Échap fait dans le champ de texte.
   *
   * `panneau` est faux ici, et c'est la raison d'être du drapeau : le panneau
   * est l'appelant, son champ a le focus, et le redessiner le détruirait sous
   * le curseur du client au moment précis où il appuie sur Échap.
   */
  private abandonnerGeste(): void {
    const avant = this.histoire.abandonner()
    if (!avant) return
    this.creation = avant
    this.apresHistorique(false)
  }

  private apresHistorique(panneau: boolean): void {
    // Un calque qui n'existe plus ne peut pas rester sélectionné : les poignées
    // du moteur porteraient sur un identifiant que `sync` ne retrouve pas.
    if (!this.creation.layers.some((l) => l.id === this.selection)) this.selection = null
    this.rendre()
    if (panneau) this.avancee?.rafraichir()
    // Le prix suit : annuler peut retirer un visuel, en remettre un, ou rendre
    // à un texte la longueur qu'il avait. Les trois changent la surface d'encre.
    this.chiffrerBientot()
  }

  private saisirQuantite(couleur: string, taille: string, brut: string): void {
    const ligne = this.lignes.find((l) => l.couleur === couleur)
    if (!ligne) return
    const n = Math.max(0, Math.min(QTE_MAX_CASE, Number.parseInt(brut, 10) || 0))
    if (n === 0) delete ligne.qte[taille]
    else ligne.qte[taille] = n
    /*
     * LES TOTAUX SUIVENT LA FRAPPE, LE RESTE DU TABLEAU NON.
     *
     * Redessiner la grille entière à chaque caractère détruirait la case que le
     * client est en train de remplir, et le focus avec : c'est le défaut que la
     * vue avancée a payé sur son champ de texte. Seuls les trois nombres qui
     * dépendent de la saisie sont réécrits.
     */
    this.rendreTotaux()
    this.rendrePrix()
    this.chiffrerBientot()
  }

  // ------------------------------------------------------------- les étapes

  /**
   * Passer d'un écran à l'autre, sans rien perdre.
   *
   * L'étape 2 est FERMÉE tant qu'aucun calque n'est posé, et le contrôle le dit
   * plutôt que de ne rien faire : `rendreEtapes` désactive les deux commandes et
   * `validerNote` porte la phrase, que `aria-describedby` fait lire.
   */
  private allerA(etape: Etape): void {
    if (etape === this.etape) return
    if (etape === 2 && this.creation.layers.length === 0) return
    /*
     * LA PREMIÈRE VISITE SÈME LA GRILLE AVEC LE COLORIS QU'ON VIENT DE CHOISIR.
     *
     * Une grille vide à l'ouverture demanderait au client de rechoisir le
     * coloris sur lequel il vient de travailler pendant cinq minutes, et une
     * commande sans ligne n'a rien à chiffrer. Le coloris repris est celui du
     * document, donc celui que le canevas montrait, et c'est aussi celui que
     * `Cart::normalise_matrix` accepte quand le produit n'a pas de nuancier
     * mesuré (`$fallback`).
     */
    if (etape === 2 && this.lignes.length === 0) this.ajouterLigne(this.creation.colorId)
    this.etape = etape
    this.rendre()
    // Ce qui a changé à l'étape 1 n'a pas été chiffré : on le chiffre maintenant.
    if (etape === 2 && this.devisPerime) this.chiffrerBientot()
    /*
     * LE FOCUS SUIT L'ÉCRAN. Sans cela, un client au clavier qui valide se
     * retrouve à tabuler depuis le haut du document vers un écran qu'il ne voit
     * plus. Le conteneur porte déjà `tabindex`, donc il peut le recevoir.
     */
    const zone = etape === 2 ? this.noeuds.choisir : this.noeuds.creer
    zone.focus()
  }

  /** Ajouter un coloris à la commande, si le plafond de la ligne le permet. */
  private ajouterLigne(couleur: string): void {
    if (couleur === '') return
    if (this.lignes.some((l) => l.couleur === couleur)) return
    if (this.lignes.length >= this.ctx.maxCouleurs) return
    this.lignes.push({ couleur, qte: {} })
  }

  private retirerLigne(couleur: string): void {
    const avant = this.quantite()
    const i = this.lignes.findIndex((l) => l.couleur === couleur)
    const voisine = this.lignes[i + 1] ?? this.lignes[i - 1]
    this.lignes = this.lignes.filter((l) => l.couleur !== couleur)
    this.lisibilite.delete(couleur)
    // Le bouton cliqué n'existe plus : le focus va au « Retirer » de la ligne
    // voisine, puis aux coloris à ajouter.
    this.rendreMatrice(voisine ? [`retirer:${voisine.couleur}`] : [])
    this.rendreApercus()
    // Le prix ne change que si la ligne portait des pièces : rechiffrer une
    // commande identique ferait clignoter le montant pour rien.
    if (this.quantite() !== avant) {
      this.rendrePrix()
      this.chiffrerBientot()
    }
  }

  private choisirLigne(couleur: string): void {
    if (this.lignes.some((l) => l.couleur === couleur)) return
    this.ajouterLigne(couleur)
    // La pastille cliquée a quitté la liste ; la suite est de remplir la ligne.
    this.rendreMatrice([`qte:${couleur}:${this.ctx.tailles[0] ?? ''}`])
    this.rendreApercus()
  }

  private surAvancee = (): void => {
    if (this.avancee) {
      this.avancee.fermer()
      this.avancee = null
      this.noeuds.avance.textContent = COPIE.ouvrirAvancee
      this.noeuds.avance.setAttribute('aria-expanded', 'false')
      return
    }
    void this.ouvrirPanneau()
  }

  /**
   * Le double-clic sur un texte du canevas ouvre son champ.
   *
   * C'est ce que `onEditText` sert, et il ne servait rien : la vue simple le
   * laissait vide avec un commentaire disant que la vue avancée le brancherait,
   * ce qu'elle ne faisait pas. Un client qui posait un texte lisait « Votre
   * texte » et n'avait aucun moyen d'en écrire un autre.
   *
   * Le panneau s'ouvre s'il ne l'est pas : c'est là que vit le champ, et le
   * client vient de demander à modifier ce texte, donc il a demandé le panneau
   * sans le savoir.
   */
  private modifierTexte(id: string): void {
    this.selection = id
    this.rendreOutils()
    void this.ouvrirPanneau().then((vue) => vue?.modifierTexte(id))
  }

  private ouvrirPanneau(): Promise<PanneauAvance | null> {
    if (this.avancee) return Promise.resolve(this.avancee)
    if (this.attenteAvancee) return this.attenteAvancee
    this.noeuds.avance.disabled = true
    this.noeuds.avance.textContent = COPIE.chargementAvancee
    /*
     * LE CHARGEMENT À LA DEMANDE, ET C'EST LA RAISON D'ÊTRE DE LA VUE SIMPLE.
     *
     * Rien de ce que cette branche importe ne descend chez un client qui n'a
     * pas cliqué : le détourage tire 13,5 Mo de WebAssembly et 4,5 Mo de modèle
     * ONNX, l'aperçu 3D tire three.js. `scripts/editeur-guard.mjs` marche sur le
     * graphe d'import depuis `src/native/main.ts` et refuse une arête statique
     * vers l'un ou l'autre ; un `import()` compte comme une arête pour la garde
     * de l'atelier (un morceau paresseux se télécharge quand même) mais pas pour
     * celle-ci, dont la question est ce que la PREMIÈRE charge pèse.
     */
    this.attenteAvancee = import('./avancee')
      .then((mod) => {
        if (this.detruit) return null
        this.avancee = mod.ouvrir(this.noeuds.zoneAvancee, {
          creation: () => this.creation,
          face: () => this.face,
          remplacer: (d, geste) => {
            this.poser(d, geste)
            this.rendre()
            this.chiffrerBientot()
          },
          finGeste: () => this.histoire.fin(),
          abandonnerGeste: () => this.abandonnerGeste(),
          contexte: this.ctx,
        })
        this.noeuds.avance.textContent = COPIE.fermerAvancee
        this.noeuds.avance.setAttribute('aria-expanded', 'true')
        return this.avancee
      })
      .catch(() => {
        if (this.detruit) return null
        this.noeuds.avance.textContent = COPIE.ouvrirAvancee
        this.montrerEchec(COPIE.avanceeIndisponible)
        return null
      })
      .finally(() => {
        this.attenteAvancee = null
        if (!this.detruit) this.noeuds.avance.disabled = false
      })
    return this.attenteAvancee
  }

  // -------------------------------------------------------------- le chiffre

  /**
   * Redemander le prix, après une pause, en annulant celui d'avant.
   *
   * Sans annulation, une quantité tapée chiffre par chiffre produit une requête
   * par frappe, et la réponse du « 1 » arrive après celle du « 12 » : l'écran
   * affiche le prix d'une pièce sous une commande de douze. Le numéro de
   * séquence est la seconde moitié du garde-fou, parce qu'un `AbortController`
   * annule la requête et pas la promesse déjà résolue.
   */
  private chiffrerBientot(): void {
    /*
     * LE PRIX DEVIENT INCONNU À L'INSTANT OÙ L'ÉCRAN CHANGE, ET PAS 250 ms PLUS
     * TARD.
     *
     * Trouvé par la passe adversariale du 5 septembre 2026. `saisirQuantite`
     * mutait la grille, appelait `rendrePrix()` tout de suite, puis armait ce
     * minuteur : `rendrePrix` lisait la NOUVELLE quantité et l'ANCIEN devis, et
     * la fiche affichait « 154,00 EUR HT pour 200 pièces » avec un prix unitaire
     * pris à la mauvaise remise. Le serveur facturait juste ; c'était un prix
     * annoncé qu'une boutique française ne peut pas honorer, affiché pendant une
     * frappe plus un aller-retour, c'est-à-dire des secondes sur un téléphone.
     *
     * Le harnais ne pouvait pas le voir : il compare le montant affiché à
     * `display.total_ttc`, et les deux moitiés venaient du même devis périmé.
     * Le test et le code partageaient l'hypothèse.
     */
    if (this.devisEtat === 'ok') {
      this.devisEtat = 'chargement'
      this.rendrePrix()
    }
    /*
     * ET LA CONFIRMATION CESSE D'ÊTRE VRAIE DÈS QUE LA CRÉATION CHANGE.
     *
     * « Ajouté au panier. » et « Voir le panier » restaient à l'écran quand le
     * client déposait un second visuel ou changeait une quantité : la phrase
     * décrivait un panier qui contenait autre chose, et le lien y menait. Un
     * contrôle dit ce qui va se passer, une confirmation dit ce qui S'EST passé,
     * et celle-là n'était plus vraie. Trouvé par la passe adversariale du
     * 5 septembre 2026.
     *
     * Les phases en vol ne sont PAS remises à zéro : ce sont elles qui font la
     * garde du double clic.
     */
    if (this.phase === 'ajoute' || this.phase === 'echec') {
      this.phase = 'repos'
      this.echec = ''
      this.panierUrl = ''
      this.rendreAchat()
    }
    if (this.timerDevis !== null) window.clearTimeout(this.timerDevis)
    this.timerDevis = null
    /*
     * PAS DE DEVIS QU'AUCUN ÉCRAN NE MONTRE (EDI-12). L'étape 1 n'affiche pas
     * de prix, et chaque frappe dans la vue avancée relançait une mesure de
     * l'encre et un GET /quote, du travail de fil principal pendant la frappe,
     * sur un téléphone. Il est fait en entrant à l'étape 2.
     */
    if (this.etape !== 2) {
      this.annuleDevis?.abort()
      this.annuleDevis = null
      this.devisPerime = true
      return
    }
    this.devisPerime = false
    this.timerDevis = window.setTimeout(() => void this.chiffrer(), 250)
  }

  private async chiffrer(): Promise<void> {
    if (this.detruit) return
    this.timerDevis = null
    const total = this.quantite()

    /*
     * ON ANNULE AVANT DE SORTIR, ET PAS SEULEMENT AVANT DE REPARTIR.
     *
     * L'abandon et l'incrément de séquence étaient SOUS le retour anticipé.
     * Chaîne écrite par la passe adversariale du 5 septembre 2026 : le client
     * tape 300, le devis part, il vide la case, ce bloc met `devis` à null et
     * sort sans rien annuler, la réponse du 300 arrive, son garde de séquence
     * la laisse passer parce que la séquence n'a pas bougé, et `needs_quote`
     * ressuscite. Le client tape 30, clique, et la boutique lui répond « à cette
     * quantité nous chiffrons à la main » pour trente pièces, sans rechiffrer.
     */
    this.annuleDevis?.abort()
    this.annuleDevis = null
    const seq = ++this.sequenceDevis

    /*
     * ── ON NE DEMANDE PAS UN PRIX POUR UNE COMMANDE QU'ON NE PEUT PAS PRENDRE ─
     *
     * Trouvé par la passe adversariale du 9 septembre 2026, et c'est la grille
     * coloris x taille qui l'a rendu atteignable : trois coloris de 5 000 pièces
     * font 15 000 en trois frappes, là où une seule rangée de tailles demandait
     * de le vouloir.
     *
     * `Pricing::quote()` BORNE la quantité à `max_qty` (« $qty = max(1, min($qty,
     * max_qty)) »), ce qui est juste pour une estimation isolée et faux ici : la
     * réponse aurait décrit 10 000 pièces, l'écran aurait imprimé « 94 200,00 EUR
     * HT pour 10 000 pièces » sous une grille totalisant 15 000, et l'ajout au
     * panier aurait ensuite refusé la ligne. C'est exactement le raisonnement
     * écrit dans `Pricing::quote_matrix` (« ON REFUSE, ON NE RABOTE PAS ») ;
     * l'écran doit le tenir aussi, parce que c'est lui qui montre le nombre.
     *
     * Zéro veut toujours dire « la page n'a pas publié de plafond ».
     */
    const auDelaDuPlafond = this.ctx.maxQty > 0 && total > this.ctx.maxQty
    if (this.creation.layers.length === 0 || total === 0 || auDelaDuPlafond) {
      this.faces = []
      this.devis = null
      this.devisEtat = 'vide'
      this.rendrePrix()
      return
    }

    const controleur = new AbortController()
    this.annuleDevis = controleur

    this.devisEtat = 'chargement'
    this.rendrePrix()

    try {
      // 1. LA MESURE, dans le navigateur. `measureOrder` attend
      //    `ensureInkProbes` et refuse un visuel qu'il n'a pas pu lire.
      const mesure = await measureOrder(this.creation)
      if (this.detruit || seq !== this.sequenceDevis) return
      this.faces = mesure.sides

      // 2. LE CHIFFRE, par le serveur, sur ces surfaces-là.
      const devis = await demanderDevis(this.ctx, this.faces, total, controleur.signal)
      if (this.detruit || seq !== this.sequenceDevis) return
      this.devis = devis
      this.devisEtat = 'ok'
      this.devisEchec = ''
    } catch (e) {
      if (this.detruit || seq !== this.sequenceDevis) return
      if (controleur.signal.aborted) return
      this.devis = null
      this.devisEtat = 'echec'
      this.devisEchec = this.phraseDe(e, COPIE.prixIndisponible)
    }
    this.rendrePrix()
  }

  /** Le nombre de pièces de toute la commande, coloris et tailles confondus. */
  private quantite(): number {
    let total = 0
    for (const ligne of this.lignes) for (const n of Object.values(ligne.qte)) total += n
    return total
  }

  /** Ce que la ligne de ce coloris totalise. */
  private quantiteDe(ligne: LigneCommande): number {
    return Object.values(ligne.qte).reduce((s, n) => s + n, 0)
  }

  /** Ce que cette taille totalise, tous coloris confondus. */
  private quantiteEn(taille: string): number {
    return this.lignes.reduce((s, l) => s + (l.qte[taille] ?? 0), 0)
  }

  /**
   * La matrice telle que `Cart::normalise_matrix` l'attend, lignes vides jetées.
   *
   * Une ligne sans quantité est un coloris que le client a ouvert puis laissé à
   * zéro : l'envoyer ferait apparaître un coloris sans pièce sur le bon de
   * commande fournisseur, et `Purchase` chercherait à l'acheter.
   */
  private matrice(): Record<string, Record<string, number>> {
    const out: Record<string, Record<string, number>> = {}
    for (const ligne of this.lignes) {
      if (this.quantiteDe(ligne) > 0) out[ligne.couleur] = { ...ligne.qte }
    }
    return out
  }

  /**
   * La grille agrégée, somme sur les coloris, DÉRIVÉE et jamais saisie.
   *
   * C'est la seule implémentation de « replier la matrice sur les tailles » de
   * ce côté-ci, exactement comme `Cart::flatten_matrix` est la seule de l'autre.
   * Tout ce qui grade un transfert travaille par taille et se moque du coloris :
   * la même taille se presse pareil en noir et en blanc.
   *
   * ELLE REPLIE `matrice()` ET NE RELIT PAS `lignes`. Les deux versions
   * parcouraient la même liste avec le même filtre écrit deux fois ; le jour où
   * l'un des deux filtres change, `size_grid` cesse d'être la somme de `matrix`,
   * et `Cart::add` tire la quantité facturée de l'une pendant que la production
   * lit l'autre. La passe adversariale du 9 septembre 2026 l'a nommé avant que
   * ça arrive.
   */
  private grille(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const cases of Object.values(this.matrice())) {
      for (const [taille, n] of Object.entries(cases)) out[taille] = (out[taille] ?? 0) + n
    }
    return out
  }

  // --------------------------------------------------------------- l'achat

  private surAchat = (): void => {
    void this.acheter()
  }

  private async acheter(): Promise<void> {
    /*
     * LA GARDE EST POSÉE AVANT LE PREMIER `await`, ET C'EST CE QUI LA REND
     * ÉTANCHE : deux clics dans la même tâche du navigateur voient tous les deux
     * `phase === 'repos'` si la première ne l'a pas déjà changée. Elle l'est ici,
     * synchroniquement, plus bas, avant `measureOrder`.
     */
    if (this.phase === 'mesure' || this.phase === 'depot' || this.phase === 'ajout') return
    /*
     * CE QUI EST DÉJÀ AU PANIER N'Y RETOURNE PAS (EDI-01). Après « Ajouté au
     * panier », le bouton restait actif sous son libellé d'origine : un second
     * clic, pour être sûr, déposait une seconde ligne identique, et trente
     * pièces voulues en faisaient soixante chiffrées à part. Toute modification
     * de la création ou de la grille rouvre l'achat (`chiffrerBientot`).
     */
    if (this.dejaAjoute()) return

    const total = this.quantite()
    if (this.creation.layers.length === 0) {
      this.montrerEchec(COPIE.riensurLeVetement)
      return
    }
    // « Aucun coloris » et « aucune quantité » ne sont pas la même chose à
    // corriger, et la phrase disait « indiquez une taille » à quelqu'un dont la
    // grille n'avait aucune ligne où en indiquer une.
    if (this.lignes.length === 0) {
      this.montrerEchec(COPIE.aucunColoris)
      return
    }
    if (total === 0) {
      this.montrerEchec(COPIE.aucuneTaille)
      return
    }
    // Zéro veut dire « la page n'a pas publié de plafond », pas « zéro pièce ».
    // `Cart::add` refuse de toute façon ; ce contrôle-ci n'existe que pour dire
    // non avant que le client ait attendu le téléversement de son fichier.
    if (this.ctx.maxQty > 0 && total > this.ctx.maxQty) {
      this.montrerEchec(COPIE.tropDePieces(fmtNum(this.ctx.maxQty, 0)))
      return
    }
    if (this.devis?.needs_quote) {
      this.montrerEchec(COPIE.surDevis)
      return
    }
    if (this.ctx.workerUrl === '') {
      // « Nous n'avons pas pu demander » n'est pas « oui ». Sans Worker, le
      // dépôt est impossible et `Design::verify` refuserait de toute façon.
      this.montrerEchec(COPIE.depotNonConfigure)
      return
    }

    /*
     * ── L'ACHAT PORTE SUR UN INSTANTANÉ, PAS SUR L'ÉTAT VIVANT ─────────────
     *
     * Trouvé par la passe adversariale du 5 septembre 2026. Cette fonction
     * relisait `this.creation` et `this.grille` à QUATRE moments, avec trois
     * allers-retours réseau entre eux, et rien ne gèle l'éditeur pendant ce
     * temps : `rendreAchat()` ne désactive que le bouton, la scène Konva reste
     * déplaçable, le champ de fichier reste vivant et les champs en centimètres
     * de la vue avancée aussi. Un client qui bouge son visuel pendant
     * « Envoi de votre visuel » se faisait chiffrer un état et facturer l'autre.
     *
     * L'instantané est pris ici, une fois, et les quatre étapes le lisent. Le
     * document est immuable par construction (chaque mutation crée un nouvel
     * objet), donc le retenir suffit ; la grille est copiée parce qu'elle ne
     * l'est pas.
     */
    const creation = this.creation
    /*
     * LES DEUX FORMES SONT FIGÉES ENSEMBLE, ET L'UNE DÉRIVE DE L'AUTRE.
     *
     * `grille()` replie `matrice()` : prendre les deux instantanés à des moments
     * différents, ou laisser le client saisir entre les deux, produirait un
     * `size_grid` qui ne serait pas la somme de la matrice envoyée avec lui, et
     * `Cart::add` déduirait alors la quantité de la matrice tandis que la
     * production lirait l'autre. Deux chiffres pour une commande.
     */
    const matrice = this.matrice()
    const grille = this.grille()
    const pieces = Object.values(grille).reduce((s, n) => s + n, 0)
    const signature = JSON.stringify(matrice)
    /*
     * L'ÉCRAN NE REÇOIT QUE CE QUI LE DÉCRIT ENCORE (EDI-02). Les champs de la
     * grille et la scène restent vivants pendant l'achat : un client qui passe
     * de 40 à 50 pendant l'envoi fait rechiffrer l'écran, et le devis de 40 que
     * cet achat reçoit ensuite écrasait celui de 50, sous une grille à 50.
     */
    const inchange = (): boolean => this.creation === creation && JSON.stringify(this.matrice()) === signature
    /*
     * ET UN CHIFFRAGE DÉJÀ PARTI N'A PLUS À ÉCRIRE : celui-ci mesure et chiffre
     * le même état, une seconde fois, à la même seconde.
     */
    if (this.timerDevis !== null) window.clearTimeout(this.timerDevis)
    this.timerDevis = null
    this.annuleDevis?.abort()
    this.annuleDevis = null
    ++this.sequenceDevis

    try {
      // 1. LA MESURE se stabilise. Refaite ici et non reprise du devis : entre
      //    le dernier chiffrage et ce clic, le client a pu bouger le visuel.
      this.phase = 'mesure'
      this.echec = ''
      this.rendreAchat()
      const mesure = await measureOrder(creation)
      if (this.detruit) return
      const faces = mesure.sides

      // 2. LE SERVEUR CHIFFRE, sur ces surfaces. Le refus d'un devis (au-delà
      //    du seuil, vêtement inconnu) arrive AVANT le dépôt, donc avant qu'un
      //    client ait attendu le téléversement de son fichier pour rien.
      const devis = await demanderDevis(this.ctx, faces, pieces)
      if (this.detruit) return
      if (inchange()) {
        this.faces = faces
        this.devis = devis
        this.devisEtat = 'ok'
        this.devisEchec = ''
        this.rendrePrix()
      }
      if (devis.needs_quote) {
        this.phase = 'echec'
        this.echec = COPIE.surDevis
        this.rendreAchat()
        return
      }

      // 3. LE FICHIER PART SUR R2 et rend un identifiant.
      this.phase = 'depot'
      this.rendreAchat()
      const depose = await uploadDesign(creation, { endpoint: this.ctx.workerUrl })
      if (this.detruit) return

      // 4. L'AJOUT AU PANIER, avec le nonce de la page, et les faces que le
      //    DÉPÔT a enregistrées, pas celles de l'écran.
      this.phase = 'ajout'
      this.rendreAchat()
      /*
       * LES FACES ENVOYÉES SONT CELLES DU DEVIS, PAS CELLES DU DÉPÔT.
       *
       * `Cart::add` ne PRICE jamais sur ce champ : il redérive les faces depuis
       * le document que le Worker a stocké. Ce qu'il en fait, c'est les comparer
       * et journaliser un écart. Envoyer `depose.sides`, c'est-à-dire le tableau
       * que le Worker vient d'enregistrer, rendait cette comparaison
       * structurellement toujours vraie : un garde qui ne peut pas échouer, ce
       * que `CLAUDE.md` section 1 interdit. Envoyer les faces sur lesquelles le
       * PRIX a été calculé lui redonne son travail, et l'écart qu'il attraperait
       * serait exactement celui que la passe adversariale a décrit.
       */
      const panier = await ajouterAuPanier(this.ctx, {
        designId: depose.id,
        faces,
        grille,
        matrice,
      })
      if (this.detruit) return

      this.panierUrl = panier.cartUrl
      this.ajoutePieces = pieces
      this.ajouteColoris = Object.keys(matrice).length
      this.ajouteCreation = creation
      this.ajouteMatrice = signature
      this.phase = 'ajoute'
      this.echec = ''
      this.rendreAchat()
      this.rendreFocusAchat()
      /*
       * Le même événement que `bridge.js` émettait, sur le même noeud.
       *
       * Un thème ou une extension de panier flottant peut l'écouter ; il n'y en
       * a pas dans ce dépôt, et le retirer en silence serait retirer un contrat
       * public parce qu'on n'en connaît pas les lecteurs.
       */
      document.body.dispatchEvent(
        new CustomEvent('teeshoop:added', { detail: { cart_count: panier.cartCount } }),
      )
    } catch (e) {
      if (this.detruit) return
      this.phase = 'echec'
      this.echec = this.phraseDe(e, COPIE.achatEchoue)
      this.rendreAchat()
      this.rendreFocusAchat()
      // Le chiffrage annulé plus haut n'a pas été remplacé : l'écran le refait.
      if (this.devisEtat === 'chargement') void this.chiffrer()
    }
  }

  /**
   * Ce que l'écran montre est-il exactement ce que le dernier ajout a envoyé ?
   * Tant que oui, « Ajouter au panier » achèterait la même chose une seconde
   * fois (EDI-01).
   */
  private dejaAjoute(): boolean {
    return (
      this.phase === 'ajoute' &&
      this.creation === this.ajouteCreation &&
      JSON.stringify(this.matrice()) === this.ajouteMatrice
    )
  }

  /**
   * LE FOCUS NE TOMBE PAS EN HAUT DE LA PAGE À LA FIN D'UN ACHAT.
   *
   * Le bouton est désactivé pendant l'achat, et un élément désactivé perd le
   * focus : un client au clavier se retrouvait sur le corps du document, loin
   * de la confirmation et de « Voir le panier ». Il est rendu à la première
   * commande de la confirmation, ou au bouton quand il est de nouveau utilisable.
   */
  private rendreFocusAchat(): void {
    const actif = document.activeElement
    if (actif instanceof HTMLElement && actif !== document.body && this.hote.contains(actif) && actif !== this.noeuds.achat) return
    const suite = this.noeuds.etat.querySelector<HTMLElement>('a, button')
    if (suite) suite.focus()
    else if (!this.noeuds.achat.disabled) this.noeuds.achat.focus()
  }

  /**
   * La phrase française d'un échec, sans en inventer une que personne n'a dite.
   *
   * Les refus de la boutique portent déjà leur texte, écrit là où la règle est
   * (`Cart::add` en a treize). Ceux du dépôt portent un code et pas de phrase,
   * parce que le Worker répond en anglais à une machine : c'est ici que chacun
   * en reçoit une, et chacune dit quoi faire.
   */
  private phraseDe(e: unknown, defaut: string): string {
    if (e instanceof RefusAtelier) return e.message
    if (e instanceof DesignUploadError) return COPIE.depot[e.code] ?? COPIE.depot.server
    return defaut
  }

  private montrerEchec(phrase: string): void {
    this.phase = 'echec'
    this.echec = phrase
    this.rendreAchat()
  }

  // ----------------------------------------------------------------- rendu

  private async synchroniser(): Promise<void> {
    if (this.detruit || !this.moteur) return
    await this.moteur.sync({
      design: this.creation,
      side: this.face,
      selectedId: this.selection,
      // Pas de repères ni de grille dans la vue simple : la zone imprimable
      // est le seul repère dont un acheteur a besoin, et les zones nommées
      // sont un outil d'atelier. Les emplacements d'import sont coupés pour la
      // même raison, et parce qu'ils ONT L'AIR CLIQUABLES : ici rien ne les
      // écoute, et un rectangle en pointillés qui ne répond pas est un défaut.
      showGuides: false,
      showUploadZones: false,
      previewSize: this.tailleTarif(),
    })
  }

  private rendre(): void {
    if (this.detruit) return
    this.rendreEtapes()
    this.rendreCouleurs()
    this.rendreFaces()
    this.rendrePhoto()
    this.rendreMatrice()
    this.rendreApercus()
    this.rendreOutils()
    this.rendrePrix()
    this.rendreAchat()
    this.rendreHistorique()
    this.rendreModeles()
    // L'invite du canevas parle de CE que le canevas montre : une création qui
    // porte un visuel devant, vue de dos, est une face vide et le dit.
    this.noeuds.vide.hidden = this.creation.layers.some((l) => l.side === this.face)
    void this.synchroniser()
  }

  /**
   * Quel écran est visible, et ce que l'indicateur en dit.
   *
   * `hidden` et pas une classe : l'attribut retire l'écran caché de l'ordre de
   * tabulation ET de l'arbre d'accessibilité, ce qu'une opacité ou un
   * `visibility` ne font pas. La règle `.tshop-ed [hidden]` de la feuille est ce
   * qui l'empêche d'être annulée par le `display: grid` ci-dessous, exactement
   * comme pour la barre d'outils.
   */
  private rendreEtapes(): void {
    const pret = this.creation.layers.length > 0
    this.noeuds.creer.hidden = this.etape !== 1
    this.noeuds.choisir.hidden = this.etape !== 2
    this.noeuds.valider.disabled = !pret
    /*
     * LA PHRASE N'EST LÀ QUE QUAND ELLE EXPLIQUE QUELQUE CHOSE. Laissée en
     * permanence, « posez un visuel » se lit comme une consigne sous un bouton
     * qui marche, et le client la relit en cherchant ce qu'il a raté.
     */
    this.noeuds.validerNote.hidden = pret || this.etape !== 1
    for (const { etape, bouton } of this.boutonsEtape) {
      const courant = etape === this.etape
      bouton.disabled = etape === 2 && !pret
      if (courant) bouton.setAttribute('aria-current', 'step')
      else bouton.removeAttribute('aria-current')
    }
  }

  /** Cocher la face en cours. Les boutons, eux, sont posés par `construire`. */
  private rendreFaces(): void {
    for (const { face, bouton } of this.boutonsFace) {
      bouton.setAttribute('aria-checked', String(face === this.face))
    }
  }

  private rendreHistorique(): void {
    if (this.detruit) return
    const { annuler, retablir } = this.noeuds
    /*
     * QUI A LE FOCUS EST LU AVANT DE DÉSACTIVER, ET PAS APRÈS.
     *
     * Désactiver l'élément qui a le focus le fait perdre au corps de la page :
     * un client au clavier qui annule jusqu'au bout se retrouvait à tabuler
     * depuis le haut du document, et le raccourci ne l'atteignait plus non plus
     * (l'écouteur est sur le conteneur, donc il faut le focus dedans). Lu
     * après, `document.activeElement` vaut déjà `body` et le contrôle ne
     * pourrait pas se déclencher.
     */
    const actif = document.activeElement
    annuler.disabled = !this.histoire.peutAnnuler
    retablir.disabled = !this.histoire.peutRetablir
    if (actif === annuler && annuler.disabled && !retablir.disabled) retablir.focus()
    else if (actif === retablir && retablir.disabled && !annuler.disabled) annuler.focus()
  }

  /**
   * LE FOCUS SURVIT AU RENDU QUI DÉTRUIT SON BOUTON (EDI-05).
   *
   * Les pastilles, la barre d'outils et la grille sont recréées à chaque rendu.
   * Un client au clavier qui choisissait un coloris, centrait, retirait ou
   * ajoutait une ligne voyait le bouton activé détruit sous lui : le focus
   * tombait sur le corps du document, loin de là où il était, et les raccourcis
   * de l'éditeur (écoutés sur son conteneur) cessaient de répondre. Les faces
   * avaient eu le même défaut, réglé en construisant leurs boutons une fois.
   *
   * Ici chaque commande porte une clé (`data-focus`) ; si le focus était dans la
   * zone, il revient à la commande de même clé, sinon à la première des clés de
   * repli qui existe, sinon à la première commande de la zone, sinon au
   * conteneur de l'éditeur. Il n'est jamais DÉPLACÉ s'il n'était pas dans la zone.
   */
  private garderFocus(zone: HTMLElement, dessiner: () => void, repli: string[] = []): void {
    const actif = document.activeElement
    const dedans = actif instanceof HTMLElement && zone.contains(actif)
    const cle = dedans ? (actif.dataset.focus ?? '') : ''
    dessiner()
    if (!dedans || zone.contains(document.activeElement)) return
    for (const k of [cle, ...repli]) {
      if (k === '') continue
      const cible = zone.querySelector<HTMLElement>(`[data-focus="${CSS.escape(k)}"]`)
      if (cible && !cible.closest('[hidden]')) {
        cible.focus()
        return
      }
    }
    const premier = zone.hidden ? null : zone.querySelector<HTMLElement>('button, input, [tabindex="0"]')
    ;(premier ?? this.hote).focus()
  }

  private rendreCouleurs(): void {
    this.garderFocus(this.noeuds.couleurs, () => this.dessinerCouleurs())
  }

  private dessinerCouleurs(): void {
    const zone = this.noeuds.couleurs
    vider(zone)
    if (this.ctx.couleurs.length === 0) {
      // ÉTAT VIDE DESSINÉ. Sans coloris déclaré, l'éditeur ne propose pas ses
      // dix-huit teintures de démonstration : il dit qu'il n'en a pas.
      const p = el('p', 'tshop-ed__note')
      p.textContent = COPIE.aucuneCouleur
      zone.append(p)
      return
    }
    for (const c of this.ctx.couleurs) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'tshop-ed__pastille'
      b.setAttribute('role', 'radio')
      b.setAttribute('aria-checked', String(c.id === this.creation.colorId))
      b.title = c.nom
      // Le NOM DU FABRICANT dans le nom accessible, la pastille MESURÉE dans
      // la couleur. Montrer « Rose » en rose pâle sur un vêtement qui arrivera
      // fuchsia est un chiffre fabriqué qui atteint un client.
      b.setAttribute('aria-label', c.nom)
      b.dataset.focus = `couleur:${c.id}`
      b.style.setProperty('--pastille', fond(c.teintes))
      b.addEventListener('click', () => this.choisirCouleur(c.id))
      zone.append(b)
    }
  }

  private rendrePhoto(): void {
    const c = this.ctx.couleurs.find((x) => x.id === this.creation.colorId)
    const src = c?.photo ?? ''
    this.noeuds.photo.hidden = src === ''
    if (src !== '') {
      this.noeuds.photo.src = src
      this.noeuds.photo.alt = COPIE.photoAlt(this.ctx.titre, c?.nom ?? '')
    }
    /*
     * LA LÉGENDE DIT CE QUE CHAQUE IMAGE EST, et ce n'est pas de la prudence.
     *
     * Le rectangle dessiné sur le gabarit est la zone imprimable publiée par
     * `data/garments.json`, la même que `Design::unprintable_sizes` applique
     * pour refuser une ligne. Ce n'est PAS une zone mesurée sur la photographie
     * du fabricant : au 5 septembre 2026 aucune référence n'en porte
     * (`_teeshoop_zone_impression` absent partout, neuf `_teeshoop_zone_refus`),
     * parce que les vues de face du fournisseur sont des mannequins vivants.
     * Poser le rectangle sur la photographie demanderait une position que
     * personne n'a mesurée, et un placement inventé finit sur un film.
     */
    this.noeuds.photoLegende.textContent = src === '' ? COPIE.legendeSansPhoto : COPIE.legende
  }

  /**
   * LA GRILLE COLORIS x TAILLE, l'écran le plus important de la boutique.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * UN VRAI TABLEAU, PARCE QUE C'EN EST UN
   *
   * Une grille de `div` avec des `aria-label` aurait la même apparence et
   * serait illisible au lecteur d'écran : dans un `table`, l'en-tête de colonne
   * et celui de ligne sont annoncés à l'entrée de chaque case, donc « M, noir,
   * quantité, 10 » sans qu'on ait à écrire cette phrase trois cent fois. Les
   * `scope` sont ce qui rend cela vrai ; sans eux le navigateur devine.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * IL DÉFILE DANS SON PROPRE CONTENEUR, JAMAIS LA PAGE
   *
   * Six tailles plus deux colonnes de service ne tiennent pas dans 375 px. Le
   * conteneur porte `overflow-x: auto`, un `tabindex` (une région défilante
   * doit être atteignable au clavier, WCAG 2.1.1) et un rôle de groupe nommé,
   * pour que ce défilement soit annoncé au lieu d'être découvert.
   */
  private rendreMatrice(repli: string[] = []): void {
    this.garderFocus(this.noeuds.matrice, () => this.dessinerMatrice(), repli)
  }

  private dessinerMatrice(): void {
    const zone = this.noeuds.matrice
    vider(zone)

    if (this.ctx.tailles.length === 0) {
      // ÉTAT VIDE DESSINÉ : sans taille vendable, il n'y a pas de colonne, donc
      // pas de commande. On le dit et on ne montre pas un tableau à une colonne.
      zone.append(note(COPIE.aucuneTailleVendue))
      return
    }

    if (this.lignes.length > 0) zone.append(this.tableauMatrice())
    else zone.append(note(COPIE.aucunColoris))

    zone.append(this.choixColoris())
  }

  private tableauMatrice(): HTMLElement {
    const cadre = el('div', 'tshop-ed__defile')
    cadre.tabIndex = 0
    cadre.setAttribute('role', 'group')
    cadre.setAttribute('aria-label', COPIE.matriceLegende)

    const table = el('table', 'tshop-ed__grille')
    const thead = el('thead')
    const entete = el('tr')
    entete.append(cellule('th', COPIE.colonneColoris, 'col'))
    for (const taille of this.ctx.tailles) entete.append(cellule('th', taille, 'col'))
    entete.append(cellule('th', COPIE.colonneTotal, 'col'))
    entete.append(el('td'))
    thead.append(entete)

    const tbody = el('tbody')
    for (const ligne of this.lignes) {
      tbody.append(this.ligneMatrice(ligne))
    }

    /*
     * LE PIED PORTE LES SOMMES PAR TAILLE, et il est dans un `tfoot` : c'est ce
     * qui dit à un lecteur d'écran que cette rangée résume les précédentes.
     */
    const tfoot = el('tfoot')
    const total = el('tr')
    total.append(cellule('th', COPIE.ligneTotal, 'row'))
    for (const taille of this.ctx.tailles) {
      const td = el('td', 'tshop-ed__somme')
      td.setAttribute('data-teeshoop', `total-taille-${taille}`)
      td.textContent = fmtNum(this.quantiteEn(taille), 0)
      total.append(td)
    }
    const grand = el('td', 'tshop-ed__somme tshop-ed__somme--grand')
    grand.setAttribute('data-teeshoop', 'total-pieces')
    grand.textContent = fmtNum(this.quantite(), 0)
    total.append(grand, el('td'))
    tfoot.append(total)

    table.append(thead, tbody, tfoot)
    cadre.append(table)
    return cadre
  }

  private ligneMatrice(ligne: LigneCommande): HTMLElement {
    const couleur = this.ctx.couleurs.find((c) => c.id === ligne.couleur)
    const nom = couleur?.nom ?? ligne.couleur
    const tr = el('tr')

    /*
     * LA MISE EN PAGE EST DANS UN ENFANT, ET LE `th` GARDE SON DISPLAY DE
     * CELLULE.
     *
     * `display: flex` posé sur un `th` remplace son type d'affichage de tableau,
     * et l'arbre d'accessibilité des navigateurs est construit depuis l'arbre de
     * MISE EN PAGE : la cellule cesse alors d'être un `rowheader`, donc le
     * lecteur d'écran n'annonce plus « noir » en entrant dans chaque case de la
     * ligne, et une grille de trente cases devient une grille de trente champs
     * « quantité ». C'est toute la raison pour laquelle cet écran est un vrai
     * tableau. Écrit par la passe adversariale du 9 septembre 2026, avant que ça
     * casse : à l'écran les deux versions sont identiques.
     */
    const tete = el('th')
    tete.setAttribute('scope', 'row')
    const boite = el('div', 'tshop-ed__coloris')
    if (couleur) boite.append(pastille(couleur.teintes))
    const etiquette = el('span')
    etiquette.textContent = nom
    boite.append(etiquette)
    tete.append(boite)
    tr.append(tete)

    for (const taille of this.ctx.tailles) {
      const td = el('td')
      const champ = document.createElement('input')
      champ.type = 'number'
      champ.min = '0'
      champ.max = String(this.ctx.maxQty > 0 ? Math.min(QTE_MAX_CASE, this.ctx.maxQty) : QTE_MAX_CASE)
      champ.step = '1'
      champ.inputMode = 'numeric'
      champ.className = 'tshop-ed__qte'
      champ.value = ligne.qte[taille] ? String(ligne.qte[taille]) : ''
      champ.placeholder = '0'
      /*
       * LE NOM ACCESSIBLE PORTE LA TAILLE ET LE COLORIS. Les deux en-têtes de
       * table le disent déjà, et c'est la ceinture : `aria-label` gagne sur
       * l'association d'en-tête dans les navigateurs qui la rendent mal, et une
       * case de quantité qui s'annonce « quantité » dans une grille de trente
       * cases ne se remplit pas au clavier.
       */
      champ.setAttribute('aria-label', COPIE.quantitePour(taille, nom))
      champ.dataset.focus = `qte:${ligne.couleur}:${taille}`
      champ.addEventListener('input', () => this.saisirQuantite(ligne.couleur, taille, champ.value))
      /*
       * Sur `change` et pas sur `input` : normaliser à chaque frappe mangerait
       * la touche suivante. La case pouvait afficher « 1e3 » ou « 999999 »
       * pendant que la grille retenait 1 ou 100 000, donc un écran qui ne dit
       * pas ce qui sera commandé.
       */
      champ.addEventListener('change', () => {
        const n = ligne.qte[taille] ?? 0
        champ.value = n > 0 ? String(n) : ''
      })
      td.append(champ)
      tr.append(td)
    }

    const somme = el('td', 'tshop-ed__somme')
    somme.setAttribute('data-teeshoop', `total-coloris-${ligne.couleur}`)
    somme.textContent = fmtNum(this.quantiteDe(ligne), 0)
    tr.append(somme)

    const actions = el('td')
    const oter = document.createElement('button')
    oter.type = 'button'
    oter.className = 'tshop-ed__outil tshop-ed__outil--retirer'
    oter.textContent = COPIE.retirer
    oter.setAttribute('aria-label', COPIE.retirerColoris(nom))
    oter.dataset.focus = `retirer:${ligne.couleur}`
    oter.addEventListener('click', () => this.retirerLigne(ligne.couleur))
    actions.append(oter)
    tr.append(actions)
    return tr
  }

  /**
   * Les coloris qu'on peut encore ajouter, et la phrase quand il n'y en a plus.
   *
   * LE PLAFOND EST DIT, PAS SUBI. `Cart::normalise_matrix` s'arrête au vingtième
   * coloris et jette les suivants sans un mot : une ligne construite au-delà
   * partirait au panier amputée. Voir `MAX_COULEURS_DEFAUT`.
   */
  private choixColoris(): HTMLElement {
    const bloc = el('div', 'tshop-ed__ajout')
    if (this.ctx.couleurs.length === 0) {
      bloc.append(note(COPIE.aucuneCouleur))
      return bloc
    }
    if (this.lignes.length >= this.ctx.maxCouleurs) {
      bloc.append(note(COPIE.colorisPlein(this.ctx.maxCouleurs)))
      return bloc
    }
    const titre = el('p', 'tshop-ed__champ-nom')
    titre.id = `tshop-ed-ajout-${this.ctx.productId}`
    titre.textContent = COPIE.ajouterColoris
    const liste = el('div', 'tshop-ed__couleurs')
    liste.setAttribute('role', 'group')
    liste.setAttribute('aria-labelledby', titre.id)
    let offert = 0
    for (const c of this.ctx.couleurs) {
      if (this.lignes.some((l) => l.couleur === c.id)) continue
      offert += 1
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'tshop-ed__pastille'
      b.title = c.nom
      b.setAttribute('aria-label', c.nom)
      b.dataset.focus = `ajout:${c.id}`
      b.style.setProperty('--pastille', fond(c.teintes))
      b.addEventListener('click', () => this.choisirLigne(c.id))
      liste.append(b)
    }
    // Tous les coloris de la référence sont déjà dans la commande : la rangée
    // vide serait un contrôle sans option, donc rien du tout.
    if (offert === 0) return bloc
    bloc.append(titre, liste)
    return bloc
  }

  /** Les seuls nombres du tableau qui bougent à la frappe. Voir `saisirQuantite`. */
  private rendreTotaux(): void {
    const zone = this.noeuds.matrice
    for (const ligne of this.lignes) {
      const c = zone.querySelector(`[data-teeshoop="total-coloris-${ligne.couleur}"]`)
      if (c) c.textContent = fmtNum(this.quantiteDe(ligne), 0)
    }
    for (const taille of this.ctx.tailles) {
      const c = zone.querySelector(`[data-teeshoop="total-taille-${taille}"]`)
      if (c) c.textContent = fmtNum(this.quantiteEn(taille), 0)
    }
    const g = zone.querySelector('[data-teeshoop="total-pieces"]')
    if (g) g.textContent = fmtNum(this.quantite(), 0)
  }

  // ------------------------------------------------- les aperçus par coloris

  /**
   * Le visuel sur chaque coloris commandé, et l'avertissement de contraste.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * LE MÊME CHEMIN DE PEINTURE QUE LE CANEVAS, ET IL N'Y EN A QU'UN
   *
   * `renderMockup` peint le gabarit avec `garmentColorHex`, qui est
   * `garmentHexOf` de `src/content/garmentPalette.ts`. Ce module existe parce
   * qu'il y a eu QUATRE copies de cette recherche de teinte, avec trois replis
   * différents, et que le jour où elles divergent le canevas 2D, l'aperçu 3D et
   * la vignette du panier montrent trois vêtements. Un second chemin ici, même
   * « juste pour une vignette », serait la cinquième.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * UN RENDU PAR SIGNATURE, PAS UN PAR FRAPPE
   *
   * Chaque caractère tapé dans une case de quantité repasse par ici. Composer
   * vingt vêtements à chaque touche serait vingt rastérisations de SVG et vingt
   * rendus de zone d'impression. La signature (le document plus la liste des
   * coloris) est ce qui distingue « il faut refaire » de « il ne s'est rien
   * passé de visible ».
   */
  private rendreApercus(): void {
    // Les aperçus sont un écran de l'étape 2 ; les composer derrière l'étape 1
    // refaisait un rendu par face et par coloris à chaque frappe (EDI-12).
    if (this.etape !== 2) return
    const zone = this.noeuds.apercus
    const signature = `${this.creation.updatedAt}|${this.face}|${this.lignes
      .map((l) => l.couleur)
      .join(',')}`
    if (signature === this.signatureApercus && zone.childElementCount > 0) return
    this.signatureApercus = signature
    const jeton = ++this.jetonApercus

    vider(zone)
    if (this.lignes.length === 0) {
      zone.append(note(COPIE.apercusVides))
      return
    }
    const attente = note(COPIE.apercuEnCours)
    attente.setAttribute('role', 'status')
    zone.append(attente)
    void this.composerApercus(jeton)
  }

  /**
   * La face montrée par les aperçus : celle qu'on regarde, si elle porte
   * quelque chose.
   *
   * Un aperçu du dos vierge pendant que le visuel est devant ne répond à aucune
   * question. La légende nomme la face dès que le vêtement en porte plus d'une
   * décorée, parce qu'alors l'image ne montre pas tout ce qui sera imprimé.
   */
  private facesDecorees(): Side[] {
    return facesPermises(this.ctx).filter((f) => this.creation.layers.some((l) => l.side === f))
  }

  private faceApercu(): Side | null {
    const decorees = this.facesDecorees()
    if (decorees.length === 0) return null
    return decorees.includes(this.face) ? this.face : decorees[0]
  }

  private async composerApercus(jeton: number): Promise<void> {
    const face = this.faceApercu()
    if (face === null) {
      /*
       * AUCUNE FACE PERMISE NE PORTE DE CALQUE, ET ON LE DIT PLUTÔT QUE DE
       * LAISSER « Composition des aperçus. » À L'ÉCRAN POUR TOUJOURS.
       *
       * L'étape 2 s'ouvre dès qu'un calque existe, et cette fonction ne dessine
       * que les faces que le produit déclare imprimables : un document portant
       * un calque sur une face retirée du produit entre les deux (ou construit
       * ailleurs) passerait la porte et n'aurait rien à montrer. Une phrase
       * d'attente qui ne finit jamais est le pire des états non dessinés,
       * parce qu'elle ressemble à un chargement lent.
       */
      vider(this.noeuds.apercus)
      this.noeuds.apercus.append(note(COPIE.apercusVides))
      return
    }
    await this.recenserEncre()
    if (this.detruit || jeton !== this.jetonApercus) return

    const zone = this.noeuds.apercus
    vider(zone)
    const decorees = this.facesDecorees()
    const largeur = Math.round(APERCU_LARGEUR_CSS * Math.min(2, window.devicePixelRatio || 1))

    for (const ligne of this.lignes) {
      const couleur = this.ctx.couleurs.find((c) => c.id === ligne.couleur)
      const carte = el('figure', 'tshop-ed__apercu-carte')
      const nom = el('figcaption', 'tshop-ed__apercu-nom')
      nom.textContent = couleur?.nom ?? ligne.couleur

      let visuel: HTMLElement
      try {
        const toile = await renderMockup(
          { ...this.creation, colorId: ligne.couleur },
          face,
          largeur,
          this.tailleTarif(),
        )
        if (this.detruit || jeton !== this.jetonApercus) return
        toile.className = 'tshop-ed__apercu-image'
        toile.setAttribute('role', 'img')
        toile.setAttribute('aria-label', COPIE.photoAlt(this.ctx.titre, couleur?.nom ?? ''))
        toile.setAttribute('data-teeshoop', `apercu-${ligne.couleur}`)
        visuel = toile
      } catch {
        if (this.detruit || jeton !== this.jetonApercus) return
        // ÉTAT D'ÉCHEC DESSINÉ, et il dit ce qui reste vrai : la pastille est la
        // mesure, et la commande n'est pas touchée par un aperçu qui manque.
        visuel = alerte(COPIE.apercuRate)
      }

      carte.append(visuel, nom)
      if (decorees.length > 1) {
        const quelle = el('p', 'tshop-ed__apercu-note')
        quelle.textContent = COPIE.apercuFace(COPIE.face(face))
        carte.append(quelle)
      }

      /*
       * LA PHOTOGRAPHIE DU FABRICANT, QUAND ELLE EXISTE VRAIMENT.
       *
       * Relevé le 5 septembre 2026 : le Gildan Heavy Cotton porte 54 coloris et
       * UNE seule photographie pour les 54, parce que `Editeur::couleurs()` y
       * met la vignette du produit. Une image identique sous vingt noms de
       * coloris n'est pas une photographie de coloris, et la légender comme
       * telle serait du contenu fabriqué. Le test est donc mesurable et pas
       * déclaratif : une photographie n'est propre à un coloris que si aucun
       * autre coloris de la référence ne porte la même. Aujourd'hui cette
       * branche ne s'exécute sur aucun produit de la boutique, et c'est la
       * raison pour laquelle l'aperçu peint reste l'image principale : lui seul
       * porte le visuel, qui est la question posée ici.
       */
      const propre = this.photoPropre(ligne.couleur)
      if (propre !== '') {
        const bande = el('div', 'tshop-ed__apercu-photo')
        const img = document.createElement('img')
        img.src = propre
        img.alt = COPIE.photoAlt(this.ctx.titre, couleur?.nom ?? '')
        img.loading = 'lazy'
        img.decoding = 'async'
        const legende = el('p', 'tshop-ed__apercu-note')
        legende.textContent = COPIE.apercuPhoto
        bande.append(img, legende)
        carte.append(bande)
      } else {
        const legende = el('p', 'tshop-ed__apercu-note')
        legende.textContent = COPIE.apercuGabarit
        carte.append(legende)
      }

      const dit = this.lireContraste(ligne.couleur)
      if (dit) {
        /*
         * UNE CARTE QUI AVERTIT PREND TOUTE LA LARGEUR.
         *
         * Mesuré le 9 septembre 2026 sur la page de l'atelier à 375 px : dans
         * une colonne de 145 px, la phrase sortait à trois mots par ligne sur
         * onze lignes, et sur 1440 px c'était pire parce que la colonne des
         * aperçus est plus étroite que l'écran. Un avertissement qu'on renonce à
         * lire ne sert à rien, et il est justement la seule chose de cet écran
         * qui puisse éviter un retour de marchandise.
         */
        carte.classList.add('tshop-ed__apercu-carte--attention')
        carte.append(dit)
      }
      zone.append(carte)
    }
  }

  /**
   * La photographie de CE coloris, ou rien.
   *
   * Rien quand elle est partagée avec un autre coloris de la référence : c'est
   * alors la vignette du produit, pas une vue de cette teinte.
   */
  private photoPropre(id: string): string {
    const photo = this.ctx.couleurs.find((c) => c.id === id)?.photo ?? ''
    if (photo === '') return ''
    return this.ctx.couleurs.some((c) => c.id !== id && c.photo === photo) ? '' : photo
  }

  /**
   * Recenser l'encre de la création, une fois par état du document.
   *
   * TOUTES LES FACES DÉCORÉES, et pas seulement celle qu'on regarde : la
   * question posée est « ce visuel se verra-t-il sur ce tissu », et un dos
   * illisible reste un dos illisible. La mesure est prise à faible définition,
   * voir `COTE_RECENSEMENT_PX`.
   */
  private async recenserEncre(): Promise<void> {
    /*
     * RECOMMENCÉ QUAND LA CRÉATION CHANGE PENDANT LA MESURE (EDI-12). Deux
     * recensements concurrents pouvaient finir dans le désordre, et le plus
     * lent écrivait l'encre de la création PRÉCÉDENTE sous la signature
     * courante : un avertissement de contraste calculé sur un autre dessin.
     */
    for (;;) {
      const signature = String(this.creation.updatedAt)
      if (this.encre?.signature === signature) return
      const mesure = await this.mesurerEncre(signature)
      if (mesure === 'detruit') return
      if (mesure === 'perime') continue
      this.lisibilite.clear()
      this.encre = { signature, mesure }
      return
    }
  }

  /** L'encre de la création telle qu'elle était à `signature`, ou pourquoi on s'est arrêté. */
  private async mesurerEncre(signature: string): Promise<Encre | null | 'perime' | 'detruit'> {
    const parts: Encre[] = []
    let vu = false
    for (const face of this.facesDecorees()) {
      const zone = getAreaSizeIn(this.creation, face, this.tailleTarif())
      const cote = Math.max(zone.wIn, zone.hIn)
      if (!(cote > 0)) continue
      try {
        const toile = await renderPrintArea(
          this.creation,
          face,
          COTE_RECENSEMENT_PX / cote,
          this.tailleTarif(),
        )
        if (this.detruit) return 'detruit'
        if (String(this.creation.updatedAt) !== signature) return 'perime'
        if (!toile) continue
        const part = recenser(toile)
        // `null` veut dire « je n'ai pas pu relire ce canevas » : on ne le
        // compte pas comme une face sans encre, sinon le silence deviendrait un
        // feu vert. Voir `src/native/contraste.ts`.
        if (part === null) continue
        vu = true
        parts.push(part)
      } catch {
        if (this.detruit) return 'detruit'
        if (String(this.creation.updatedAt) !== signature) return 'perime'
      }
    }
    return vu ? fusionner(parts) : null
  }

  /** L'avertissement de contraste de ce coloris, ou rien quand il se lit bien. */
  private lireContraste(id: string): HTMLElement | null {
    let verdict = this.lisibilite.get(id)
    if (!verdict) {
      verdict = lisibiliteSur(this.encre?.mesure ?? null, garmentHexOf(id))
      this.lisibilite.set(id, verdict)
    }
    if (verdict.etat === 'lisible') return null
    const p = el('p', 'tshop-ed__attention')
    p.setAttribute('data-teeshoop', `contraste-${id}`)
    p.textContent =
      verdict.etat === 'faible'
        ? COPIE.contrasteFaible(fmtNum(verdict.part * 100, 0))
        : COPIE.contrasteInconnu
    return p
  }

  /**
   * Les contrôles d'un objet n'existent que quand cet objet est sélectionné.
   */
  private rendreOutils(): void {
    this.garderFocus(this.noeuds.outils, () => this.dessinerOutils())
  }

  private dessinerOutils(): void {
    const zone = this.noeuds.outils
    const calque = this.creation.layers.find((l) => l.id === this.selection)
    if (!calque) {
      vider(zone)
      zone.hidden = true
      return
    }
    zone.hidden = false
    vider(zone)

    const mesure = mesureDe(calque)
    /*
     * L'encre d'une image n'est connue qu'une fois le fichier relu. À l'étape 1
     * rien d'autre ne le demande (EDI-12), donc on le demande ici, et la ligne
     * se redessine si la mesure a changé ; une seconde fois, rien ne change et
     * la boucle s'arrête.
     */
    if (calque.type === 'image') {
      void ensureInkProbes([calque]).then(() => {
        if (this.detruit || this.selection !== calque.id) return
        const apres = mesureDe(calque)
        if (apres?.w !== mesure?.w || apres?.h !== mesure?.h) this.rendreOutils()
      })
    }
    const taille = el('span', 'tshop-ed__mesure')
    if (mesure) {
      // Centimètres, jamais de pouces : c'est l'unité que lit un acheteur
      // français, et `CLAUDE.md` section 7 l'exige.
      taille.textContent = `${fmtNum(inToCm(mesure.w))} × ${fmtNum(inToCm(mesure.h))} cm`
      taille.setAttribute('data-teeshoop', 'taille-visuel')
    }

    const centrer = document.createElement('button')
    centrer.type = 'button'
    centrer.className = 'tshop-ed__outil'
    centrer.textContent = COPIE.centrer
    centrer.dataset.focus = 'centrer'
    centrer.addEventListener('click', () => this.centrerSelection())

    const retirer = document.createElement('button')
    retirer.type = 'button'
    retirer.className = 'tshop-ed__outil tshop-ed__outil--retirer'
    retirer.textContent = COPIE.retirer
    retirer.dataset.focus = 'retirer'
    retirer.addEventListener('click', () => this.supprimerSelection())

    if (mesure) zone.append(taille)
    zone.append(centrer, retirer)
  }

  private rendrePrix(): void {
    const zone = this.noeuds.prix
    vider(zone)
    const total = this.quantite()

    if (this.creation.layers.length === 0) {
      zone.append(note(COPIE.prixSansVisuel))
      return
    }
    if (this.lignes.length === 0) {
      zone.append(note(COPIE.aucunColoris))
      return
    }
    if (total === 0) {
      zone.append(note(COPIE.prixSansTaille))
      return
    }
    // Au-delà du plafond de la ligne, l'écran ne chiffre pas : voir `chiffrer`,
    // qui n'a alors rien demandé au serveur. On dit combien, et où aller.
    if (this.ctx.maxQty > 0 && total > this.ctx.maxQty) {
      zone.append(this.blocDevis(COPIE.tropDePieces(fmtNum(this.ctx.maxQty, 0))))
      return
    }
    if (this.devisEtat === 'chargement') {
      const p = note(COPIE.prixEnCours)
      p.setAttribute('data-teeshoop', 'prix-chargement')
      zone.append(p)
      return
    }
    if (this.devisEtat === 'echec') {
      zone.append(alerte(this.devisEchec))
      return
    }
    const d = this.devis
    if (!d) return

    if (d.needs_quote) {
      // ÉTAT « TROP DE QUELQUE CHOSE », dessiné. Au-delà du seuil la boutique
      // cesse de chiffrer et un humain prend la main ; le dire ici évite au
      // client de téléverser son fichier pour se faire refuser après.
      zone.append(this.blocDevis(COPIE.surDevis))
      return
    }

    /*
     * ── LA BOUTIQUE DÉCIDE COMMENT UN PRIX S'ÉCRIT, PAS CET ÉCRAN ─────────
     *
     * Les montants viennent du serveur, déjà écrits en français par
     * `Money::format` : rien ici ne divise par cent ni n'arrondit. Le
     * SUFFIXE et la MENTION viennent de `Settings::price_bases()`, la même
     * décision que la fiche produit et la grille de tarifs lisent, parce qu'il y
     * a des régimes où « HT » et « TTC » sont le même nombre et où l'écrire deux
     * fois invite le lecteur à chercher une taxe qui ne doit pas exister.
     *
     * `deux` faux : un seul montant, sans suffixe, suivi de la mention que le
     * régime impose. `connue` faux : un seul montant et RIEN sur la taxe, parce
     * qu'une boutique qui n'a pas dit son régime ne peut pas en annoncer un.
     */
    const bases = this.ctx.bases
    const suffixe = bases.deux ? COPIE.suffixeHt : ''

    const ligne = el('p', 'tshop-ed__ligne')
    ligne.setAttribute('data-teeshoop', 'price')
    const unite = el('strong', 'tshop-ed__unite')
    unite.setAttribute('data-teeshoop', 'unit-ht')
    unite.textContent = d.display.unit_ht
    ligne.append(unite, texte(suffixe + COPIE.laPiece))

    /*
     * LE NOMBRE DE PIÈCES VIENT DU DEVIS, PAS DE L'ÉCRAN.
     *
     * `d.qty` est ce que le serveur a chiffré ; `this.quantite()` est ce que la
     * grille dit maintenant. Les deux ne peuvent différer que le temps d'un
     * aller-retour, et c'est précisément l'instant où la phrase mentait. Deux
     * moitiés d'une même phrase doivent venir d'une même réponse.
     */
    const totalHt = el('p', 'tshop-ed__total')
    const montantHt = el('span')
    montantHt.setAttribute('data-teeshoop', 'total-ht')
    montantHt.textContent = d.display.total_ht
    totalHt.append(montantHt, texte(suffixe + ' '), texte(COPIE.pour(d.qty, fmtNum(d.qty, 0))))
    zone.append(ligne, totalHt)

    if (bases.deux) {
      /*
       * LE MONTANT SEUL DANS LE NOEUD MARQUÉ, LE MOT « TTC » À CÔTÉ.
       *
       * `scripts/wp-e2e-verify.mjs` compare `[data-teeshoop="total-ttc"]`
       * caractère pour caractère à `display.total_ttc`, la chaîne que
       * `Money::format` a écrite sur le serveur. Mettre le mot dans le même
       * noeud a fait échouer cette assertion, et la bonne correction est
       * celle-ci et pas un assouplissement du harnais : ce marqueur existe pour
       * dire « voici, exactement, ce que le serveur a répondu ».
       */
      const totalTtc = el('p', 'tshop-ed__ttc')
      const montantTtc = el('span')
      montantTtc.setAttribute('data-teeshoop', 'total-ttc')
      montantTtc.textContent = d.display.total_ttc
      totalTtc.append(montantTtc, texte(COPIE.suffixeTtc))
      zone.append(totalTtc)
    }

    /*
     * ── LA REMISE, DITE PAR SON TAUX ET PAS PAR UN MONTANT ────────────────
     *
     * `discount_rate` est une FRACTION, ce que la mention de TVA a déjà appris à
     * ce fichier à ses dépens : affichée telle quelle, 0,15 s'écrivait
     * « 0,15 % » sous un total qui en portait quinze. Elle est donc multipliée
     * par cent ici, et par cent seulement : le MONTANT de la remise n'est pas
     * recalculé, parce que ce serait une seconde arithmétique de l'argent à
     * côté de `Money::pct`, et les totaux affichés au-dessus la contiennent
     * déjà. Un taux n'est pas un prix payable ; ce total-là, si.
     *
     * Le taux est arrondi au dixième de point, puis écrit sans décimale quand
     * il n'en a pas : les paliers de la boutique sont à 15, 25 et 35 %, et
     * « 15,0 % » sous un chiffre rond se lit comme une précision qui cache
     * quelque chose.
     */
    if (d.discount_rate > 0) {
      const pourcent = Math.round(d.discount_rate * 1000) / 10
      const remise = el('p', 'tshop-ed__remise')
      remise.setAttribute('data-teeshoop', 'remise')
      remise.textContent = COPIE.remise(fmtNum(pourcent, Number.isInteger(pourcent) ? 0 : 1))
      zone.append(remise)
    }

    // La phrase du régime, écrite par `Vat` et reprise telle quelle. Vide quand
    // le régime n'est pas connu, et l'écran se tait alors.
    if (bases.mention !== '') {
      const mention = el('p', 'tshop-ed__mention')
      mention.setAttribute('data-teeshoop', 'mention-tva')
      mention.textContent = bases.mention
      zone.append(mention)
    }
  }

  /**
   * « Nous ne chiffrons plus, un humain prend la main », avec le lien qui va.
   *
   * Les deux cas qui l'utilisent sont différents (le seuil de devis publié par
   * la boutique, et le plafond d'une ligne de panier) et la sortie est la même :
   * ce n'est pas un refus, c'est un autre guichet. Deux rédactions du même bloc
   * auraient fini par en avoir une avec le lien et une sans.
   */
  private blocDevis(phrase: string): HTMLElement {
    const bloc = el('div', 'tshop-ed__devis')
    bloc.append(note(phrase))
    if (this.ctx.devisUrl !== '') {
      const a = document.createElement('a')
      a.className = 'tshop-ed__lien'
      a.href = this.ctx.devisUrl
      a.textContent = COPIE.demanderDevis
      bloc.append(a)
    }
    return bloc
  }

  private rendreAchat(): void {
    const b = this.noeuds.achat
    const occupe = this.phase === 'mesure' || this.phase === 'depot' || this.phase === 'ajout'
    const deja = this.dejaAjoute()
    b.disabled = occupe || deja
    b.toggleAttribute('data-ajoute', deja)
    b.textContent =
      this.phase === 'mesure'
        ? COPIE.phaseMesure
        : this.phase === 'depot'
          ? COPIE.phaseDepot
          : this.phase === 'ajout'
            ? COPIE.phaseAjout
            : deja
              ? COPIE.ajouteBouton
              : COPIE.ajouter

    const zone = this.noeuds.etat
    vider(zone)
    if (this.phase === 'ajoute') {
      // LE CONTRÔLE DIT CE QUI VA SE PASSER, LA CONFIRMATION DIT QUE C'EST
      // FAIT. « Ajouter au panier », puis « Ajouté au panier », puis ce qui a
      // été ajouté : deux nombres qui se comparent à la grille encore à l'écran.
      const p = el('p', 'tshop-ed__ok')
      p.setAttribute('data-teeshoop', 'cart-done')
      p.textContent = `${COPIE.ajoute} ${COPIE.ajouteQuoi(this.ajoutePieces, fmtNum(this.ajoutePieces, 0), this.ajouteColoris)}`
      zone.append(p)
      /*
       * DEUX SORTIES, ET LA SECONDE N'EST PAS UN LIEN.
       *
       * « Voir le panier » quitte cette page. « Continuer la personnalisation »
       * ne quitte rien : la création est encore là, les octets du visuel sont
       * dans IndexedDB, et un client qui veut une seconde série (d'autres
       * coloris, d'autres tailles) n'a pas à tout recommencer. En faire un lien
       * aurait annoncé une navigation qui n'a pas lieu.
       */
      const sorties = el('div', 'tshop-ed__sorties')
      if (this.panierUrl !== '') {
        const a = document.createElement('a')
        a.className = 'tshop-ed__lien'
        a.href = this.panierUrl
        a.textContent = COPIE.voirPanier
        sorties.append(a)
      }
      const continuer = document.createElement('button')
      continuer.type = 'button'
      continuer.className = 'tshop-ed__outil'
      continuer.setAttribute('data-teeshoop', 'continuer')
      continuer.textContent = COPIE.continuer
      continuer.addEventListener('click', () => this.allerA(1))
      sorties.append(continuer)
      zone.append(sorties)
      return
    }
    if (this.phase === 'echec' && this.echec !== '') {
      const p = alerte(this.echec)
      p.setAttribute('data-teeshoop', 'cart-error')
      zone.append(p)
    }
  }

  // --------------------------------------------------------------- démontage

  /** La page part pour de bon (pas vers le cache arrière) : ses fichiers aussi. */
  private surDepart = (e: PageTransitionEvent): void => {
    if (!e.persisted) this.effacerActifs()
  }

  private effacerActifs(): void {
    for (const id of this.actifs) void removeAsset(id).catch(() => undefined)
    this.actifs.clear()
  }

  detruire(): void {
    if (this.detruit) return
    this.detruit = true
    window.removeEventListener('pagehide', this.surDepart)
    this.effacerActifs()
    if (this.timerDevis !== null) window.clearTimeout(this.timerDevis)
    this.annuleDevis?.abort()
    this.observateur?.disconnect()
    this.observateur = null
    this.hote.removeEventListener('keydown', this.surTouche)
    this.avancee?.fermer()
    this.avancee = null
    this.moteur?.destroy()
    this.moteur = null
    vider(this.hote)
    this.hote.classList.remove('tshop-ed')
  }
}

// ---------------------------------------------------------------- utilitaires

/**
 * Un identifiant local, pour un calque et pour la création.
 *
 * `crypto.randomUUID` quand il existe, sinon douze caractères tirés de
 * `getRandomValues`. Il ne quitte jamais ce navigateur autrement que dans le
 * document de création, où il ne sert qu'à distinguer deux calques, donc il n'a
 * pas à être imprévisible ; il a à être unique, ce qu'un compteur remis à zéro
 * par un rechargement de page n'est pas.
 */
function identifiant(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID().slice(0, 12)
  const b = new Uint8Array(9)
  c.getRandomValues(b)
  return Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 12)
}

/**
 * Ce que ce calque occupe, en pouces, ou rien quand il n'occupe rien.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * UN TEXTE NE DÉCLARE PAS DE RECTANGLE, IL EN OCCUPE UN
 *
 * `TextLayer` n'a ni `wIn` ni `hIn` : il a une taille de police, et ce qu'il
 * couvre dépend des glyphes. La ligne d'outils lisait donc `'wIn' in calque`,
 * qui est faux pour un texte, et affichait « 0,0 × 0,0 cm » dès qu'un client
 * cliquait sur son texte, c'est-à-dire un chiffre fabriqué montré à un client.
 * `layerInkBox` est la mesure d'encre que le prix ET le film lisent, donc il
 * n'y en a qu'une, et c'est celle qui est vraie.
 *
 * ZÉRO N'EST PAS UNE MESURE : un texte vide n'occupe rien, et la ligne se tait
 * plutôt que d'écrire zéro.
 */
function mesureDe(calque: Layer): { w: number; h: number } | null {
  /*
   * ET « VIDE » SE TESTE SUR LE TEXTE, PAS SUR LA MESURE.
   *
   * `measureTextLayer` borne sa boîte à 1 px pour ne jamais rendre une boîte
   * nulle à un tracé, donc un texte vide mesure 0,01 pouce et pas zéro : un
   * contrôle écrit sur « la largeur est-elle nulle » aurait laissé passer
   * « 0,0 × 0,0 cm », qui est le chiffre fabriqué qu'on veut supprimer.
   */
  if (calque.type === 'text' && calque.text.trim() === '') return null
  /*
   * L'ENCRE, PAS LA BOÎTE DU FICHIER, ET SANS ROTATION (EDI-14). Une image
   * affichait sa boîte, marges transparentes comprises, là où le transfert
   * imprimé et facturé mesure l'encre ; un texte tourné affichait sa boîte
   * englobante tournée. Une seule règle, celle que le prix et le film lisent.
   */
  const { w, h } = layerInkSize(calque)
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { w, h } : null
}

/** Un bouton d'historique : étiquette courte à l'écran, phrase entière au lecteur. */
function boutonHistorique(
  etiquette: string,
  nom: string,
  raccourci: string,
  marqueur: string,
): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'tshop-ed__outil'
  b.textContent = etiquette
  b.disabled = true
  b.setAttribute('aria-label', nom)
  b.setAttribute('aria-keyshortcuts', raccourci)
  b.setAttribute('data-teeshoop', marqueur)
  return b
}

/**
 * Un bloc de l'éditeur, avec son titre.
 *
 * `h2` ET PAS `h3`, ET C'EST UNE MESURE. L'éditeur occupe la fente d'ajout au
 * panier, donc le titre qui le précède sur une fiche produit est le `h1` du
 * produit. Avec des `h3` la page sautait un niveau, `h1` puis « Couleur », et
 * `npm run verify:a11y` l'a refusé aux deux largeurs le 5 septembre 2026 : un
 * lecteur d'écran qui parcourt les titres perd la structure sur exactement
 * l'écran où le client doit choisir. La vue avancée descend en `h3` derrière.
 */
function section(titre: string, ...contenu: (HTMLElement | Node)[]): HTMLElement {
  const s = el('section', 'tshop-ed__bloc')
  const h = el('h2', 'tshop-ed__titre')
  h.textContent = titre
  s.append(h, ...contenu)
  return s
}

/**
 * Le fond d'une pastille de coloris : une teinte, ou deux pour un chiné.
 *
 * Le dégradé à 135 degrés est deux moitiés franches et pas un fondu : un chiné
 * est un tissu à deux fils, et la moyenne des deux est une couleur que le
 * fournisseur ne vend pas. C'était écrit dans `rendreCouleurs` ; il fallait la
 * même chose dans la grille et dans le choix des coloris, et trois copies d'une
 * règle de peinture est exactement ce que `garmentPalette.ts` a été écrit pour
 * supprimer, un étage plus bas.
 */
function fond(teintes: readonly string[]): string {
  return teintes.length > 1
    ? `linear-gradient(135deg, ${teintes[0]} 0 50%, ${teintes[1]} 50% 100%)`
    : teintes[0]
}

/** Une pastille décorative : le nom du coloris est écrit à côté, en toutes lettres. */
function pastille(teintes: readonly string[]): HTMLElement {
  const p = el('span', 'tshop-ed__puce')
  p.style.setProperty('--pastille', fond(teintes))
  // `aria-hidden` parce que la couleur est déjà nommée par le texte voisin : un
  // lecteur d'écran annoncerait sinon un élément vide entre chaque nom.
  p.setAttribute('aria-hidden', 'true')
  return p
}

/** Une cellule d'en-tête, avec sa portée déclarée plutôt que devinée. */
function cellule(tag: 'th' | 'td', contenu: string, scope?: string): HTMLElement {
  const c = el(tag)
  c.textContent = contenu
  if (scope) c.setAttribute('scope', scope)
  return c
}

function note(phrase: string): HTMLParagraphElement {
  const p = el('p', 'tshop-ed__note')
  p.textContent = phrase
  return p
}

function alerte(phrase: string): HTMLParagraphElement {
  const p = el('p', 'tshop-ed__alerte')
  p.setAttribute('role', 'alert')
  p.textContent = phrase
  return p
}

function texte(s: string): Text {
  return document.createTextNode(s)
}
