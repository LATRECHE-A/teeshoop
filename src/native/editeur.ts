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
import { addAsset } from '@/state/assets'
import { setShopPalette } from '@/content/garmentPalette'
import { getAreaSizeIn } from '@/lib/renderDesign'
import { layerInkBox } from '@/lib/ink'
import { measureOrder, uploadDesign, DesignUploadError } from '@/lib/teeshoop/upload'
import { inToCm, fmtNum } from '@/lib/units'
import { setCurrentLang } from '@/i18n/lang'
import { facesPermises, type Contexte } from './contexte'
import { ajouterAuPanier, demanderDevis, RefusAtelier, type Devis, type FaceImprimee } from './atelier'
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
  /** Ouvrir le champ de texte sur ce calque et y poser le curseur. */
  modifierTexte(id: string): void
}

/** Combien de pièces au maximum une case de taille accepte à la frappe. */
const QTE_MAX_CASE = 100000

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
  private grille: Record<string, number> = {}
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
  private panierUrl = ''
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
  /** Les boutons de face, construits une fois. Voir `rendreFaces`. */
  private readonly boutonsFace: { face: Side; bouton: HTMLButtonElement }[] = []

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
    tailles: HTMLDivElement
    prix: HTMLDivElement
    achat: HTMLButtonElement
    etat: HTMLDivElement
    fichier: HTMLInputElement
    annuler: HTMLButtonElement
    retablir: HTMLButtonElement
    avance: HTMLButtonElement
    zoneAvancee: HTMLDivElement
  }

  constructor(hote: HTMLElement, ctx: Contexte) {
    this.hote = hote
    this.ctx = ctx
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

    const tailles = el('div', 'tshop-ed__tailles')
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

    this.hote.append(
      scene,
      historique,
      outils,
      bandePhoto,
      section(COPIE.couleurLegende, couleurs),
      blocFaces,
      section(COPIE.visuelLegende, etiquetteFichier, fichier),
      section(COPIE.taillesLegende, tailles),
      prix,
      achat,
      etat,
      avance,
      zoneAvancee,
    )

    this.noeuds = {
      scene: toile,
      vide,
      outils,
      photo,
      photoLegende,
      couleurs,
      tailles,
      prix,
      achat,
      etat,
      fichier,
      annuler,
      retablir,
      avance,
      zoneAvancee,
    }

    this.demarrerMoteur(toile)
    this.brancherDepot(scene)
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
      this.moteur.setViewport(Math.round(r.width), Math.round(r.height))
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

  private saisirQuantite(taille: string, brut: string): void {
    const n = Math.max(0, Math.min(QTE_MAX_CASE, Number.parseInt(brut, 10) || 0))
    if (n === 0) delete this.grille[taille]
    else this.grille[taille] = n
    this.rendrePrix()
    this.chiffrerBientot()
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

    if (this.creation.layers.length === 0 || total === 0) {
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

  private quantite(): number {
    return Object.values(this.grille).reduce((s, n) => s + n, 0)
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

    const total = this.quantite()
    if (this.creation.layers.length === 0) {
      this.montrerEchec(COPIE.riensurLeVetement)
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
      this.montrerEchec(COPIE.tropDePieces(this.ctx.maxQty))
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
    const grille = { ...this.grille }
    const pieces = Object.values(grille).reduce((s, n) => s + n, 0)

    try {
      // 1. LA MESURE se stabilise. Refaite ici et non reprise du devis : entre
      //    le dernier chiffrage et ce clic, le client a pu bouger le visuel.
      this.phase = 'mesure'
      this.echec = ''
      this.rendreAchat()
      const mesure = await measureOrder(creation)
      if (this.detruit) return
      this.faces = mesure.sides

      // 2. LE SERVEUR CHIFFRE, sur ces surfaces. Le refus d'un devis (au-delà
      //    du seuil, vêtement inconnu) arrive AVANT le dépôt, donc avant qu'un
      //    client ait attendu le téléversement de son fichier pour rien.
      const devis = await demanderDevis(this.ctx, this.faces, pieces)
      if (this.detruit) return
      this.devis = devis
      this.devisEtat = 'ok'
      this.rendrePrix()
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
        faces: this.faces,
        grille,
      })
      if (this.detruit) return

      this.panierUrl = panier.cartUrl
      this.phase = 'ajoute'
      this.echec = ''
      this.rendreAchat()
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
    }
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
    this.rendreCouleurs()
    this.rendreFaces()
    this.rendrePhoto()
    this.rendreTailles()
    this.rendreOutils()
    this.rendrePrix()
    this.rendreAchat()
    this.rendreHistorique()
    // L'invite du canevas parle de CE que le canevas montre : une création qui
    // porte un visuel devant, vue de dos, est une face vide et le dit.
    this.noeuds.vide.hidden = this.creation.layers.some((l) => l.side === this.face)
    void this.synchroniser()
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

  private rendreCouleurs(): void {
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
      b.style.setProperty(
        '--pastille',
        c.teintes.length > 1
          ? `linear-gradient(135deg, ${c.teintes[0]} 0 50%, ${c.teintes[1]} 50% 100%)`
          : c.teintes[0],
      )
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

  private rendreTailles(): void {
    const zone = this.noeuds.tailles
    vider(zone)
    if (this.ctx.tailles.length === 0) {
      const p = el('p', 'tshop-ed__note')
      p.textContent = COPIE.aucuneTailleVendue
      zone.append(p)
      return
    }
    for (const taille of this.ctx.tailles) {
      const champ = document.createElement('input')
      champ.type = 'number'
      champ.min = '0'
      champ.max = String(this.ctx.maxQty > 0 ? Math.min(QTE_MAX_CASE, this.ctx.maxQty) : QTE_MAX_CASE)
      champ.step = '1'
      champ.inputMode = 'numeric'
      champ.className = 'tshop-ed__qte'
      champ.id = `tshop-ed-qte-${this.ctx.productId}-${taille}`
      champ.value = this.grille[taille] ? String(this.grille[taille]) : ''
      champ.placeholder = '0'
      champ.setAttribute('aria-label', COPIE.quantiteEn(taille))
      champ.addEventListener('input', () => this.saisirQuantite(taille, champ.value))
      /*
       * Sur `change` et pas sur `input` : normaliser à chaque frappe mangerait
       * la touche suivante. La case pouvait afficher « 1e3 » ou « 999999 »
       * pendant que la grille retenait 1 ou 100 000, donc un écran qui ne dit
       * pas ce qui sera commandé.
       */
      champ.addEventListener('change', () => {
        const n = this.grille[taille] ?? 0
        champ.value = n > 0 ? String(n) : ''
      })

      const etiquette = document.createElement('label')
      etiquette.className = 'tshop-ed__taille'
      etiquette.htmlFor = champ.id
      const nom = el('span', 'tshop-ed__taille-nom')
      nom.textContent = taille
      etiquette.append(nom, champ)
      zone.append(etiquette)
    }
  }

  /**
   * Les contrôles d'un objet n'existent que quand cet objet est sélectionné.
   */
  private rendreOutils(): void {
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
    centrer.addEventListener('click', () => this.centrerSelection())

    const retirer = document.createElement('button')
    retirer.type = 'button'
    retirer.className = 'tshop-ed__outil tshop-ed__outil--retirer'
    retirer.textContent = COPIE.retirer
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
    if (total === 0) {
      zone.append(note(COPIE.prixSansTaille))
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
      const bloc = el('div', 'tshop-ed__devis')
      bloc.append(note(COPIE.surDevis))
      if (this.ctx.devisUrl !== '') {
        const a = document.createElement('a')
        a.className = 'tshop-ed__lien'
        a.href = this.ctx.devisUrl
        a.textContent = COPIE.demanderDevis
        bloc.append(a)
      }
      zone.append(bloc)
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
    totalHt.append(montantHt, texte(suffixe + ' '), texte(COPIE.pour(d.qty)))
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

    // La phrase du régime, écrite par `Vat` et reprise telle quelle. Vide quand
    // le régime n'est pas connu, et l'écran se tait alors.
    if (bases.mention !== '') {
      const mention = el('p', 'tshop-ed__mention')
      mention.setAttribute('data-teeshoop', 'mention-tva')
      mention.textContent = bases.mention
      zone.append(mention)
    }
  }

  private rendreAchat(): void {
    const b = this.noeuds.achat
    const occupe = this.phase === 'mesure' || this.phase === 'depot' || this.phase === 'ajout'
    b.disabled = occupe
    b.textContent =
      this.phase === 'mesure'
        ? COPIE.phaseMesure
        : this.phase === 'depot'
          ? COPIE.phaseDepot
          : this.phase === 'ajout'
            ? COPIE.phaseAjout
            : COPIE.ajouter

    const zone = this.noeuds.etat
    vider(zone)
    if (this.phase === 'ajoute') {
      // LE CONTRÔLE DIT CE QUI VA SE PASSER, LA CONFIRMATION DIT QUE C'EST
      // FAIT. « Ajouter au panier », puis « Ajouté au panier ».
      const p = el('p', 'tshop-ed__ok')
      p.setAttribute('data-teeshoop', 'cart-done')
      p.textContent = COPIE.ajoute
      zone.append(p)
      if (this.panierUrl !== '') {
        const a = document.createElement('a')
        a.className = 'tshop-ed__lien'
        a.href = this.panierUrl
        a.textContent = COPIE.voirPanier
        zone.append(a)
      }
      return
    }
    if (this.phase === 'echec' && this.echec !== '') {
      const p = alerte(this.echec)
      p.setAttribute('data-teeshoop', 'cart-error')
      zone.append(p)
    }
  }

  // --------------------------------------------------------------- démontage

  detruire(): void {
    if (this.detruit) return
    this.detruit = true
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
  if (calque.type !== 'text') return { w: calque.wIn, h: calque.hIn }
  /*
   * ET « VIDE » SE TESTE SUR LE TEXTE, PAS SUR LA MESURE.
   *
   * `measureTextLayer` borne sa boîte à 1 px pour ne jamais rendre une boîte
   * nulle à un tracé, donc un texte vide mesure 0,01 pouce et pas zéro : un
   * contrôle écrit sur « la largeur est-elle nulle » aurait laissé passer
   * « 0,0 × 0,0 cm », qui est le chiffre fabriqué qu'on veut supprimer.
   */
  if (calque.text.trim() === '') return null
  const boite = layerInkBox(calque)
  const w = boite.x1 - boite.x0
  const h = boite.y1 - boite.y0
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
