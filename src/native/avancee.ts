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
 *   LE DÉTOURAGE. Mesuré le 5 septembre 2026 en le construisant : `vite` copie
 *   13 480 ko de WebAssembly dans le répertoire du greffon, deux fois, parce
 *   qu'`onnxruntime-web` référence son binaire par `new URL(…, import.meta.url)`
 *   et qu'aucune option ne l'en empêche (`external` sur `.wasm` ne l'attrape
 *   pas : ce n'est pas un import, c'est un actif émis). Avec le modèle ONNX,
 *   4 600 ko, ça fait 18 Mo qui partiraient en rsync vers o2switch à chaque
 *   déploiement d'un greffon WordPress. Les servir depuis le Worker marche pour
 *   le TÉLÉCHARGEMENT (`connect-src` autorise déjà cette origine) et demande en
 *   plus `'wasm-unsafe-eval'` dans le `script-src` de la boutique, c'est-à-dire
 *   une modification de sa politique de sécurité. C'est petit, c'est faisable,
 *   et ça se mesure ; ça ne se décide pas à la fin d'une nuit dont le brief dit
 *   que le CORS du Worker est le seul changement d'infrastructure autorisé.
 *
 *   LA RÉALITÉ AUGMENTÉE est bloquée par une chose nommable : `uploadArModel`
 *   poste sur `POST /api/ar`, qui n'expose aucun en-tête CORS. Depuis la page
 *   de la boutique, l'envoi partirait et la réponse serait illisible. C'est une
 *   ligne dans `worker/index.ts` et elle appartient à une nuit qui a le droit
 *   de la faire.
 *
 *   L'APERÇU 3D est monté par React dans le studio (`src/app/Scene3D.tsx`) et
 *   le porter ici est un vrai poste, pas un déplacement : three.js, la scène,
 *   les textures et la caméra. Le faire à moitié produirait une SECONDE
 *   implémentation du rendu du vêtement, ce que `CLAUDE.md` section 1 interdit
 *   précisément parce que les deux divergent ensuite.
 */
import type { Design, Layer, Side, TextLayer } from '@/lib/types'
import { FONTS, ensureFont } from '@/lib/fonts'
import { inToCm, cmToIn, fmtNum } from '@/lib/units'
import { getAreaSizeIn } from '@/lib/renderDesign'
import type { Contexte } from './contexte'
import { el, vider } from './dom'

export interface Hote {
  creation(): Design
  remplacer(d: Design): void
  contexte: Contexte
}

export interface VueAvancee {
  fermer(): void
}

const FACES: { id: Side; nom: string }[] = [
  { id: 'front', nom: 'Devant' },
  { id: 'back', nom: 'Dos' },
  { id: 'sleeve', nom: 'Manche' },
]

/** Les phrases de cette vue, en français, comme celles de la vue simple. */
const MOTS = {
  faces: 'Face imprimée',
  calques: 'Calques',
  aucunCalque: 'Aucun élément sur cette face.',
  ajouterTexte: 'Ajouter du texte',
  texteDefaut: 'Votre texte',
  police: 'Police',
  alignement: 'Position et taille, en centimètres',
  largeur: 'Largeur',
  hauteur: 'Hauteur',
  decalageX: 'Décalage horizontal',
  decalageY: 'Décalage vertical',
  centrerX: 'Centrer horizontalement',
  /*
   * L'ÉTAT VIDE DU DÉTOURAGE, DESSINÉ PLUTÔT QUE TU.
   *
   * Un client qui cherche « enlever le fond » et ne trouve rien croit que le
   * site est cassé ; on lui dit ce qu'on ne sait pas encore faire et ce qu'il
   * peut faire à la place, ce qui est ce que `CLAUDE.md` section 7 demande d'un
   * état vide.
   */
  sansDetourage:
    'Nous ne savons pas encore enlever le fond d’une image ici. Envoyez un PNG à fond transparent, ou écrivez-nous : nous détourons le visuel avant l’impression.',
  supprimer: 'Supprimer',
  selectionner: 'Sélectionner',
} as const

export function ouvrir(zone: HTMLElement, hote: Hote): VueAvancee {
  const vue = new Avancee(zone, hote)
  return { fermer: () => vue.fermer() }
}

class Avancee {
  private readonly zone: HTMLElement
  private readonly hote: Hote
  private face: Side = 'front'
  private selection: string | null = null
  private message = ''

  constructor(zone: HTMLElement, hote: Hote) {
    this.zone = zone
    this.hote = hote
    this.zone.classList.add('tshop-ed__avancee')
    this.rendre()
  }

  fermer(): void {
    vider(this.zone)
    this.zone.classList.remove('tshop-ed__avancee')
  }

  // ------------------------------------------------------------------ rendu

  private rendre(): void {
    vider(this.zone)
    this.zone.append(this.bandeFaces(), this.listeCalques(), this.actions())
    const calque = this.calqueSelectionne()
    if (calque) this.zone.append(this.reglages(calque))
    if (this.message !== '') {
      const p = el('p', 'tshop-ed__note')
      p.setAttribute('role', 'status')
      p.textContent = this.message
      this.zone.append(p)
    }
  }

  /**
   * LE DOS ET LES MANCHES, qui étaient l'une des raisons d'ouvrir cette vue.
   *
   * Les faces proposées sont celles que le PRODUIT déclare imprimables, jamais
   * les trois par défaut : une référence sans manche imprimable proposerait
   * sinon une face que l'atelier refuserait au bon de commande.
   */
  private bandeFaces(): HTMLElement {
    const bloc = el('div', 'tshop-ed__bloc')
    const titre = el('h3', 'tshop-ed__titre')
    titre.textContent = MOTS.faces
    const groupe = el('div', 'tshop-ed__faces')
    groupe.setAttribute('role', 'radiogroup')
    groupe.setAttribute('aria-label', MOTS.faces)

    const permises = FACES.filter(
      (f) => this.hote.contexte.faces.length === 0 || this.hote.contexte.faces.includes(f.id),
    )
    for (const f of permises) {
      const b = el('button', 'tshop-ed__face')
      b.type = 'button'
      b.setAttribute('role', 'radio')
      b.setAttribute('aria-checked', String(f.id === this.face))
      b.textContent = f.nom
      b.addEventListener('click', () => {
        this.face = f.id
        this.selection = null
        this.rendre()
      })
      groupe.append(b)
    }
    bloc.append(titre, groupe)
    return bloc
  }

  private listeCalques(): HTMLElement {
    const bloc = el('div', 'tshop-ed__bloc')
    const titre = el('h3', 'tshop-ed__titre')
    titre.textContent = MOTS.calques
    bloc.append(titre)

    const surCetteFace = this.hote.creation().layers.filter((l) => l.side === this.face)
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
      const p = el('p', 'tshop-ed__note')
      p.setAttribute('data-teeshoop', 'sans-detourage')
      p.textContent = MOTS.sansDetourage
      bloc.append(p)
    }
    return bloc
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

    const zone = getAreaSizeIn(this.hote.creation(), this.face)

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
    if (calque.type === 'text') bloc.append(this.choixPolice(calque))
    return bloc
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
    const zone = getAreaSizeIn(d, this.face)
    const famille = FONTS[0]?.family ?? 'Anton'
    const calque: TextLayer = {
      id: identifiantLocal(),
      type: 'text',
      side: this.face,
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
      this.selection = calque.id
      this.rendre()
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
