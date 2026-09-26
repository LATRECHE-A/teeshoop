/**
 * Les réglages avancés, chargés seulement quand quelqu'un les demande.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER EST SÉPARÉ
 *
 * Tout ce qu'il importe est un morceau que `vite` émet à part et qu'un
 * navigateur ne va chercher qu'au clic : les treize familles de polices
 * d'impression et leurs 1,5 Mo de fontes ne descendent pas chez un client qui
 * n'écrit pas de texte. `scripts/editeur-guard.mjs` marche sur le graphe
 * d'import depuis `src/native/main.ts` et mesure ce que la PREMIÈRE charge
 * pèse, morceaux paresseux exclus.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUI N'EST PAS ICI, ET POURQUOI, AVEC LES CHIFFRES
 *
 * TROIS des sept postes annoncés pour cette vue ne sont pas construits cette
 * nuit. Aucun n'est sur le chemin d'un achat : un client qui n'ouvre jamais
 * cette vue achète exactement comme avant, et un qui l'ouvre y trouve les
 * quatre autres.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LES SEPT POSTES SONT LÀ, ET LES TROIS DERNIERS ONT COÛTÉ UNE MESURE CHACUN
 *
 * Dos et manches, plusieurs calques, texte et polices, alignement au centimètre,
 * DÉTOURAGE, APERÇU EN VOLUME et RÉALITÉ AUGMENTÉE.
 *
 *   LE DÉTOURAGE ne pouvait pas embarquer son runtime : `vite` copie 13 480 ko
 *   de WebAssembly dans le répertoire du greffon, deux fois, parce
 *   qu'`onnxruntime-web` référence son binaire par `new URL(…, import.meta.url)`
 *   et qu'aucune option ne l'en empêche. Avec le modèle, 18 Mo partiraient en
 *   rsync vers o2switch à chaque déploiement. Ils sont donc lus SUR LE WORKER,
 *   qui les sert déjà publiquement, et `src/lib/bgremove/engine.ts` reçoit la
 *   base au lieu de la coder en dur. Ce que ça a coûté à la boutique :
 *   `'wasm-unsafe-eval'` dans son `script-src`, un jeton, mesuré et écrit dans
 *   `includes/Csp.php`.
 *
 *   L'APERÇU EN VOLUME et LA RÉALITÉ AUGMENTÉE sont le MÊME objet, et c'est ce
 *   qui les a rendus faisables : `buildArModel` construit un vêtement portant la
 *   création, le GLB qu'il rend EST l'aperçu, et c'est le même octet que le
 *   téléphone reçoit. Deux fonctionnalités séparées auraient été deux géométries
 *   du même vêtement. La scène three.js est celle de la page du code QR
 *   (`src/lib/glbStage.ts`), extraite plutôt que recopiée.
 */
import type { Design, Layer, Side, TextLayer } from '@/lib/types'
import { FONTS, ensureFont } from '@/lib/fonts'
import { inToCm, cmToIn, fmtNum } from '@/lib/units'
import { getAreaSizeIn } from '@/lib/renderDesign'
import type { Contexte } from './contexte'
import { el, vider } from './dom'

export interface Hote {
  creation(): Design
  /**
   * La face que le canevas montre, et celle qui reçoit un nouveau calque.
   *
   * ELLE APPARTIENT À L'ÉDITEUR, PAS À CE PANNEAU, et c'était le défaut. Ce
   * fichier tenait son propre `face` avec son propre sélecteur : cliquer
   * « Dos » n'y changeait que la liste de calques, le canevas restait sur le
   * devant, et un client décorait une face qu'il ne voyait pas. Le sélecteur
   * est maintenant dans la vue simple, à côté du canevas qu'il commande, et
   * c'est le seul.
   */
  face(): Side
  /**
   * Poser un document.
   *
   * `geste` nomme le mouvement en cours (une frappe dans le champ de texte)
   * pour que l'historique n'en garde qu'un pas au lieu d'un par caractère.
   */
  remplacer(d: Design, geste?: string): void
  /** Refermer le geste : la modification suivante sera un pas d'historique à part. */
  finGeste(): void
  /** Abandonner le geste en cours et revenir à l'état d'avant : la touche Échap. */
  abandonnerGeste(): void
  contexte: Contexte
}

export interface VueAvancee {
  fermer(): void
  /** Redessiner après un changement venu d'ailleurs : annuler, rétablir, une face. */
  rafraichir(): void
  /** Ouvrir le champ de texte de ce calque et y poser le curseur. */
  modifierTexte(id: string): void
}

/** Les phrases de cette vue, en français, comme celles de la vue simple. */
const MOTS = {
  calques: 'Calques',
  aucunCalque: 'Aucun élément sur cette face.',
  ajouterTexte: 'Ajouter du texte',
  texteDefaut: 'Votre texte',
  texte: 'Votre texte, tel qu’il sera imprimé',
  police: 'Police',
  alignement: 'Position et taille, en centimètres',
  largeur: 'Largeur',
  hauteur: 'Hauteur',
  decalageX: 'Décalage horizontal',
  decalageY: 'Décalage vertical',
  centrerX: 'Centrer horizontalement',
  detourer: 'Enlever le fond',
  detourageEnCours: 'Détourage en cours.',
  detourageFait: 'Fond enlevé. Le prix suit la nouvelle surface d’encre.',
  detourageRate:
    'Le fond n’a pas pu être enlevé. Votre visuel est intact : réessayez, ou envoyez-nous un fichier déjà détouré.',
  detourageImpossible:
    'Ce navigateur ne sait pas exécuter le détourage. Envoyez un PNG à fond transparent, ou écrivez-nous : nous détourons le visuel avant l’impression.',
  detourageSansDepot:
    'Cette boutique n’a pas d’espace de dépôt configuré, donc le modèle de détourage ne peut pas être téléchargé. Envoyez un PNG à fond transparent, ou écrivez-nous.',
  supprimer: 'Supprimer',
  selectionner: 'Sélectionner',
  ouvrirApercu: 'Voir en volume et essayer chez vous',
  fermerApercu: 'Fermer l’aperçu en volume',
  chargementApercu: 'Chargement de l’aperçu.',
  apercuIndisponible:
    'L’aperçu en volume n’a pas pu être chargé. Vérifiez votre connexion, puis réessayez : votre visuel est conservé.',
} as const

export function ouvrir(zone: HTMLElement, hote: Hote): VueAvancee {
  const vue = new Avancee(zone, hote)
  return {
    fermer: () => vue.fermer(),
    rafraichir: () => vue.rafraichir(),
    modifierTexte: (id) => vue.modifierTexte(id),
  }
}

class Avancee {
  private readonly zone: HTMLElement
  private readonly hote: Hote
  private selection: string | null = null
  private message = ''
  private occupe = false
  private apercu: { fermer(): void } | null = null
  /**
   * FERMÉ, C'EST POUR DE BON (EDI-04). Un chargement de l'aperçu ou un détourage
   * qui finissait après « Fermer les réglages avancés » redessinait tout le
   * panneau dans la zone fermée, avec un aperçu WebGL que plus rien ne fermait.
   */
  private ferme = false
  /** L'aperçu se charge : l'état et non le bouton, que `rendre()` recrée. */
  private chargeApercu = false
  private zoneApercu: HTMLElement | null = null
  /**
   * Les boutons de la liste, par calque, pour suivre une frappe sans tout
   * redessiner : reconstruire le panneau à chaque caractère détruirait le champ
   * de texte sous le curseur du client.
   */
  private readonly noms = new Map<string, HTMLElement>()

  constructor(zone: HTMLElement, hote: Hote) {
    this.zone = zone
    this.hote = hote
    this.zone.classList.add('tshop-ed__avancee')
    this.rendre()
  }

  fermer(): void {
    this.ferme = true
    this.apercu?.fermer()
    this.apercu = null
    this.zoneApercu = null
    vider(this.zone)
    this.zone.classList.remove('tshop-ed__avancee')
  }

  /**
   * Redessiner parce que le document a changé ailleurs.
   *
   * Une annulation peut avoir supprimé le calque que ce panneau montre, ou
   * l'éditeur avoir changé de face : ce qui est sélectionné ici doit exister
   * là-bas, sinon les réglages porteraient sur un calque qui n'est plus.
   */
  rafraichir(): void {
    if (!this.hote.creation().layers.some((l) => l.id === this.selection)) this.selection = null
    this.rendre()
  }

  /**
   * Ouvrir le champ de texte sur ce calque, curseur dedans, contenu sélectionné.
   *
   * Appelé par le double-clic sur le texte du canevas (`onEditText`). Tout est
   * sélectionné parce qu'un client qui double-clique un texte pour le changer
   * veut le remplacer, pas insérer au milieu.
   */
  modifierTexte(id: string): void {
    const calque = this.hote.creation().layers.find((l) => l.id === id)
    if (!calque || calque.type !== 'text') return
    this.selection = id
    this.rendre()
    const champ = this.zone.querySelector<HTMLTextAreaElement>('[data-teeshoop="texte"]')
    if (!champ) return
    champ.focus()
    champ.select()
  }

  // ------------------------------------------------------------------ rendu

  private rendre(): void {
    if (this.ferme) return
    /*
     * L'APERÇU EN VOLUME SURVIT AU RE-RENDU DU PANNEAU.
     *
     * `rendre()` vide sa zone à chaque clic, et le canevas WebGL était dedans :
     * changer de face pendant que le modèle tourne le détruisait sans le
     * libérer, ce qui est la fuite de contextes GPU de la séance 10. Le
     * conteneur de l'aperçu est donc SORTI de la zone re-rendue et réattaché
     * après ; il n'est détruit que par son propre bouton, ou par `fermer()`.
     */
    const apercuDetache = this.zoneApercu
    if (apercuDetache?.parentNode) apercuDetache.remove()

    vider(this.zone)
    this.noms.clear()
    this.zone.append(this.listeCalques(), this.actions())
    const calque = this.calqueSelectionne()
    if (calque) this.zone.append(this.reglages(calque))
    this.zone.append(this.boutonApercu())
    if (apercuDetache) this.zone.append(apercuDetache)
    if (this.message !== '') {
      const p = el('p', 'tshop-ed__note')
      p.setAttribute('role', 'status')
      p.textContent = this.message
      this.zone.append(p)
    }
  }

  /**
   * Les calques de la face que le canevas montre, et rien d'autre.
   *
   * `hote.face()` et non un état local : le sélecteur de face vit dans la vue
   * simple depuis que le canevas le suit. Voir `Hote.face`.
   */
  private listeCalques(): HTMLElement {
    const bloc = el('div', 'tshop-ed__bloc')
    const titre = el('h3', 'tshop-ed__titre')
    titre.textContent = MOTS.calques
    bloc.append(titre)

    const surCetteFace = this.hote.creation().layers.filter((l) => l.side === this.hote.face())
    if (surCetteFace.length === 0) {
      const p = el('p', 'tshop-ed__note')
      p.textContent = MOTS.aucunCalque
      bloc.append(p)
      return bloc
    }

    const liste = el('ul', 'tshop-ed__calques')
    for (const l of surCetteFace) {
      const li = el('li', 'tshop-ed__calque')
      const choisir = el('button', 'tshop-ed__calque-nom')
      choisir.type = 'button'
      choisir.setAttribute('aria-pressed', String(l.id === this.selection))
      choisir.textContent = nomDe(l)
      choisir.addEventListener('click', () => {
        this.selection = this.selection === l.id ? null : l.id
        this.rendre()
      })
      this.noms.set(l.id, choisir)
      const oter = el('button', 'tshop-ed__outil tshop-ed__outil--retirer')
      oter.type = 'button'
      oter.textContent = MOTS.supprimer
      oter.addEventListener('click', () => this.supprimer(l.id))
      li.append(choisir, oter)
      liste.append(li)
    }
    bloc.append(liste)
    return bloc
  }

  private actions(): HTMLElement {
    const bloc = el('div', 'tshop-ed__bloc')
    const texte = el('button', 'tshop-ed__outil')
    texte.type = 'button'
    texte.textContent = MOTS.ajouterTexte
    texte.addEventListener('click', () => this.ajouterTexte())
    bloc.append(texte)

    const calque = this.calqueSelectionne()
    if (calque && calque.type === 'image') {
      const detourer = el('button', 'tshop-ed__outil')
      detourer.type = 'button'
      detourer.textContent = this.occupe ? MOTS.detourageEnCours : MOTS.detourer
      detourer.disabled = this.occupe
      detourer.setAttribute('data-teeshoop', 'detourer')
      detourer.addEventListener('click', () => void this.detourer(calque))
      bloc.append(detourer)
    }
    return bloc
  }

  /**
   * LE DÉTOURAGE, revenu ici et chargé au clic.
   *
   * Il écrit une SECONDE variante sous le même identifiant d'actif, et le calque
   * bascule dessus. Le fichier d'origine n'est jamais remplacé : un détourage
   * raté doit laisser le client exactement où il était, et `assetRevision` fait
   * que le dépôt renverra bien les nouveaux octets plutôt que de resservir la
   * première découpe.
   *
   * `assets` est l'origine du Worker, qui sert `/ort/` et `/models/` : le
   * greffon est servi sous `/wp-content/plugins/…` et sans cette base les 13,5
   * et 4,6 Mo seraient cherchés à la racine du site.
   */
  private async detourer(calque: { id: string; assetId: string }): Promise<void> {
    if (this.hote.contexte.workerUrl === '') {
      this.message = MOTS.detourageSansDepot
      this.rendre()
      return
    }
    this.occupe = true
    this.message = MOTS.detourageEnCours
    this.rendre()
    try {
      const [mod, actifs] = await Promise.all([import('@/lib/bgremove'), import('@/state/assets')])
      if (!mod.isBgRemovalSupported()) {
        this.message = MOTS.detourageImpossible
        return
      }
      const source = await actifs.getAssetBlob(calque.assetId)
      if (!source) {
        this.message = MOTS.detourageRate
        return
      }
      const decoupe = await mod.removeBackground(source, { assets: this.hote.contexte.workerUrl })
      await actifs.setAssetCutout(calque.assetId, decoupe)
      this.message = MOTS.detourageFait
      // `useCutout` fait basculer le calque, et `patch` rechiffre : la surface
      // d'encre vient de changer, donc le prix aussi.
      this.patch(calque.id, { useCutout: true } as Partial<Layer>)
    } catch (e) {
      /*
       * LA PHRASE DU CLIENT RESTE GÉNÉRIQUE, LA CAUSE VA DANS LA CONSOLE.
       *
       * Un client n'a rien à faire d'un message d'ONNX ; celui qui répare, si.
       * `warn` et pas `error` : `scripts/wp-e2e-verify.mjs` échoue sur une
       * erreur de console de notre code, et un détourage refusé par un
       * navigateur trop vieux n'est pas une panne de la boutique.
       */
      console.warn('teeshoop: détourage refusé', e)
      this.message = MOTS.detourageRate
    } finally {
      this.occupe = false
      this.rendre()
    }
  }

  /**
   * L'ALIGNEMENT AU CENTIMÈTRE.
   *
   * Le doigt place à peu près ; ces quatre champs placent exactement, et c'est
   * ce qu'un client qui a un cahier des charges vient chercher. Les nombres
   * sont en centimètres à l'écran et en pouces dans le document, parce que
   * toute la géométrie de cette application est en pouces et qu'une seconde
   * unité dans le document serait une seconde chance de se tromper. La
   * conversion se fait ici, une fois, avec `src/lib/units.ts`.
   */
  private reglages(calque: Layer): HTMLElement {
    const bloc = el('div', 'tshop-ed__bloc')
    const titre = el('h3', 'tshop-ed__titre')
    titre.textContent = MOTS.alignement
    const grille = el('div', 'tshop-ed__champs')

    const zone = getAreaSizeIn(this.hote.creation(), this.hote.face())

    if (calque.type !== 'text') {
      grille.append(
        this.champCm(MOTS.largeur, calque.wIn, 0.2, inToCm(zone.wIn), (cm) =>
          this.patch(calque.id, { wIn: cmToIn(cm) } as Partial<Layer>),
        ),
        this.champCm(MOTS.hauteur, calque.hIn, 0.2, inToCm(zone.hIn), (cm) =>
          this.patch(calque.id, { hIn: cmToIn(cm) } as Partial<Layer>),
        ),
      )
    }
    /*
     * LA MOITIÉ DE LA ZONE, PAS LA ZONE ENTIÈRE.
     *
     * La géométrie est mesurée depuis le CENTRE de la zone, qui s'étend donc de
     * -w/2 à +w/2. Borner à +/- w laissait taper un décalage qui pose le calque
     * entièrement hors de la zone : `clampInkToArea` rend alors `null`, la pièce
     * disparaît du film ET du prix, et avec deux calques ça se fait sans un mot,
     * ce qui est exactement la forme que `CLAUDE.md` section 3 nomme. Avec un
     * seul calque le dépôt refuse par « rien à imprimer », donc le défaut ne se
     * voyait que dans le cas où il coûte le plus cher.
     *
     * Trouvé par la passe adversariale du 5 septembre 2026. La borne est la même
     * que celle de `clampLayersToArea` dans le magasin du studio.
     */
    const demiW = inToCm(zone.wIn) / 2
    const demiH = inToCm(zone.hIn) / 2
    grille.append(
      this.champCm(MOTS.decalageX, calque.xIn, -demiW, demiW, (cm) =>
        this.patch(calque.id, { xIn: cmToIn(cm) }),
      ),
      this.champCm(MOTS.decalageY, calque.yIn, -demiH, demiH, (cm) =>
        this.patch(calque.id, { yIn: cmToIn(cm) }),
      ),
    )

    const centrer = el('button', 'tshop-ed__outil')
    centrer.type = 'button'
    centrer.textContent = MOTS.centrerX
    centrer.addEventListener('click', () => this.patch(calque.id, { xIn: 0 }))

    bloc.append(titre, grille, centrer)
    if (calque.type === 'text') bloc.append(this.champTexte(calque), this.choixPolice(calque))
    return bloc
  }

  /**
   * LE CHAMP DE TEXTE, ET SANS LUI CETTE VUE NE SAVAIT PAS VENDRE DU TEXTE.
   *
   * `ajouterTexte` posait la phrase « Votre texte » et RIEN ne permettait de la
   * changer : chaque calque de texte créé depuis cette vue portait la même, le
   * client s'en apercevait sur le vêtement, et `onEditText` de la vue simple
   * était une fonction vide accompagnée d'un commentaire disant que cette vue
   * la brancherait.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * LA FRAPPE MET À JOUR SANS REDESSINER, ET C'EST OBLIGATOIRE
   *
   * `rendre()` vide le panneau : appelé à chaque caractère, il détruirait le
   * champ que le client est en train de remplir et le focus avec. Une frappe
   * pose donc le document (le canevas et le prix suivent, ils sont ailleurs) et
   * met à jour la seule chose de CE panneau qui dépend du texte, l'étiquette de
   * la liste des calques.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * ÉCHAP REVIENT EN ARRIÈRE, LE DÉPART DU FOCUS VALIDE
   *
   * Les deux passent par l'historique : une frappe continue est UN geste, donc
   * un seul pas d'annulation, et Échap abandonne ce geste-là au lieu d'en
   * laisser un qui ne ferait rien de visible. Voir `src/native/historique.ts`.
   *
   * Un `textarea` et pas un `input` : `TextLayer` porte plusieurs lignes (le
   * tracé les centre selon `align`), et un champ d'une ligne aurait rendu
   * impossible d'écrire ce que le moteur sait déjà dessiner.
   */
  private champTexte(calque: TextLayer): HTMLElement {
    const enveloppe = el('label', 'tshop-ed__champ')
    const nom = el('span', 'tshop-ed__champ-nom')
    nom.textContent = MOTS.texte
    const champ = el('textarea', 'tshop-ed__texte')
    champ.rows = 2
    champ.value = calque.text
    champ.setAttribute('data-teeshoop', 'texte')

    const poser = (valeur: string): void => {
      const d = this.hote.creation()
      this.hote.remplacer(
        {
          ...d,
          layers: d.layers.map((l) => (l.id === calque.id ? { ...l, text: valeur } : l)),
          updatedAt: Date.now(),
        },
        `texte:${calque.id}`,
      )
      const bouton = this.noms.get(calque.id)
      if (bouton) bouton.textContent = valeur.slice(0, 40) || calque.name
    }

    champ.addEventListener('input', () => poser(champ.value))
    champ.addEventListener('blur', () => this.hote.finGeste())
    champ.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      this.hote.abandonnerGeste()
      /*
       * LE CHAMP SUIT LE DOCUMENT, il ne décide pas. L'état d'avant est celui
       * que l'historique vient de rendre ; relire le calque plutôt que garder
       * une copie locale évite que les deux disent deux choses différentes le
       * jour où l'abandon échoue (aucun geste en cours, par exemple).
       */
      const revenu = this.hote.creation().layers.find((l) => l.id === calque.id)
      if (!revenu || revenu.type !== 'text') return
      champ.value = revenu.text
      const bouton = this.noms.get(calque.id)
      if (bouton) bouton.textContent = nomDe(revenu)
    })

    enveloppe.append(nom, champ)
    return enveloppe
  }

  private champCm(
    etiquette: string,
    valeurIn: number,
    minCm: number,
    maxCm: number,
    poser: (cm: number) => void,
  ): HTMLElement {
    const enveloppe = el('label', 'tshop-ed__champ')
    const nom = el('span', 'tshop-ed__champ-nom')
    nom.textContent = etiquette
    const champ = el('input', 'tshop-ed__qte')
    champ.type = 'number'
    champ.step = '0.1'
    champ.min = String(Math.round(minCm * 10) / 10)
    champ.max = String(Math.round(maxCm * 10) / 10)
    champ.inputMode = 'decimal'
    champ.value = fmtNum(inToCm(valeurIn)).replace(',', '.')
    champ.addEventListener('change', () => {
      const cm = Number.parseFloat(champ.value.replace(',', '.'))
      if (!Number.isFinite(cm)) return
      // Borné aux dimensions de la zone : ce qui déborde est de toute façon
      // rogné par `clampInkToArea`, et un champ qui accepte 400 cm laisse
      // croire qu'on peut imprimer 400 cm.
      poser(Math.max(minCm, Math.min(maxCm, cm)))
    })
    enveloppe.append(nom, champ)
    return enveloppe
  }

  private choixPolice(calque: TextLayer): HTMLElement {
    const enveloppe = el('label', 'tshop-ed__champ')
    const nom = el('span', 'tshop-ed__champ-nom')
    nom.textContent = MOTS.police
    const select = el('select', 'tshop-ed__select')
    for (const f of FONTS) {
      const o = el('option')
      o.value = f.family
      o.textContent = f.family
      if (f.family === calque.fontFamily) o.selected = true
      select.append(o)
    }
    select.addEventListener('change', () => {
      const famille = select.value
      void ensureFont(famille).then(() => this.patch(calque.id, { fontFamily: famille } as Partial<Layer>))
    })
    enveloppe.append(nom, select)
    return enveloppe
  }

  // --------------------------------------------------------------- actions

  /**
   * Le bouton qui charge l'aperçu en volume, et le morceau le plus lourd.
   *
   * three.js, le chargeur GLTF et les deux exportateurs sont derrière DEUX
   * clics : ouvrir les réglages avancés, puis demander l'aperçu. Rien de tout
   * cela n'atteint un client qui reste sur la vue simple, ce que
   * `scripts/editeur-guard.mjs` mesure sur le graphe statique.
   */
  private boutonApercu(): HTMLElement {
    const bloc = el('div', 'tshop-ed__bloc')
    const b = el('button', 'tshop-ed__outil')
    b.type = 'button'
    b.setAttribute('data-teeshoop', 'apercu-volume')
    b.setAttribute('aria-expanded', String(this.apercu !== null))
    b.textContent = this.chargeApercu ? MOTS.chargementApercu : this.apercu ? MOTS.fermerApercu : MOTS.ouvrirApercu
    b.disabled = this.chargeApercu
    b.addEventListener('click', () => {
      if (this.apercu) {
        this.apercu.fermer()
        this.apercu = null
        this.zoneApercu?.remove()
        this.zoneApercu = null
        this.rendre()
        return
      }
      if (this.chargeApercu) return
      this.chargeApercu = true
      b.disabled = true
      b.textContent = MOTS.chargementApercu
      void import('./apercu3d')
        .then((mod) => {
          if (this.ferme || this.apercu) return
          const hote = el('div', 'tshop-ed__zone-apercu')
          this.zone.append(hote)
          this.zoneApercu = hote
          this.apercu = mod.ouvrirApercu(hote, this.hote.contexte, () => this.hote.creation())
          this.rendre()
        })
        .catch(() => {
          this.message = MOTS.apercuIndisponible
          this.rendre()
        })
        .finally(() => {
          this.chargeApercu = false
          b.disabled = false
        })
    })
    bloc.append(b)
    return bloc
  }

  private calqueSelectionne(): Layer | null {
    return this.hote.creation().layers.find((l) => l.id === this.selection) ?? null
  }

  private patch(id: string, patch: Partial<Layer>): void {
    const d = this.hote.creation()
    this.hote.remplacer({
      ...d,
      layers: d.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)),
      updatedAt: Date.now(),
    })
    this.rendre()
  }

  private supprimer(id: string): void {
    const d = this.hote.creation()
    this.hote.remplacer({
      ...d,
      layers: d.layers.filter((l) => l.id !== id),
      updatedAt: Date.now(),
    })
    if (this.selection === id) this.selection = null
    this.rendre()
  }

  private ajouterTexte(): void {
    const d = this.hote.creation()
    // La face de l'éditeur, donc une de celles que le produit déclare
    // imprimables : `facesPermises` est la seule liste, et elle borne déjà le
    // sélecteur. Poser un calque sur une face interdite est impossible, pas
    // refusé après coup.
    const face = this.hote.face()
    const zone = getAreaSizeIn(d, face)
    const famille = FONTS[0]?.family ?? 'Anton'
    const calque: TextLayer = {
      id: identifiantLocal(),
      type: 'text',
      side: face,
      name: MOTS.texteDefaut,
      xIn: 0,
      yIn: 0,
      rotation: 0,
      opacity: 1,
      text: MOTS.texteDefaut,
      fontFamily: famille,
      // Un dixième de la hauteur de zone : lisible d'emblée, et modifiable au
      // doigt comme au centimètre juste en dessous.
      fontSizeIn: Math.max(0.4, zone.hIn * 0.1),
      fill: '#111111',
      stroke: null,
      strokeWidthIn: 0,
      letterSpacingEm: 0,
      curve: 0,
      align: 'center',
    }
    void ensureFont(famille).then(() => {
      const courant = this.hote.creation()
      this.hote.remplacer({
        ...courant,
        layers: [...courant.layers, calque],
        updatedAt: Date.now(),
      })
      /*
       * ET LE CHAMP S'OUVRE TOUT DE SUITE, contenu sélectionné.
       *
       * « Votre texte » n'est pas une proposition, c'est un texte de départ que
       * le client doit remplacer : le laisser sans curseur, c'est le laisser
       * partir avec cette phrase sur son vêtement, ce qui est exactement ce que
       * cette nuit corrige.
       */
      this.modifierTexte(calque.id)
    })
  }

}

function nomDe(l: Layer): string {
  if (l.type === 'text') return l.text.slice(0, 40) || l.name
  return l.name
}

/** Le même identifiant local que la vue simple, pour la même raison. */
function identifiantLocal(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID().slice(0, 12)
  const b = new Uint8Array(9)
  c.getRandomValues(b)
  return Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 12)
}
