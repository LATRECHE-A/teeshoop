/**
 * L'aperçu en volume et l'essayage en réalité augmentée, dans la page.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * UN SEUL MODULE POUR LES DEUX, PARCE QUE C'EST UN SEUL OBJET
 *
 * `buildArModel` (src/lib/arExport.ts) construit un vêtement en volume portant
 * la création, et rend trois fichiers : un GLB, un USDZ et une affiche. Le GLB
 * EST l'aperçu 3D, et c'est le même octet que la réalité augmentée envoie au
 * téléphone. Les traiter comme deux fonctionnalités aurait produit deux
 * géométries du même vêtement, ce que `CLAUDE.md` section 1 interdit ; ici la
 * seule différence entre « voir en volume » et « voir chez soi » est de savoir
 * si le modèle reste dans ce navigateur ou monte sur R2.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUE ÇA PÈSE, ET POURQUOI ÇA NE DESCEND PAS TOUT SEUL
 *
 * three.js, le chargeur GLTF, l'exportateur GLB et l'exportateur USDZ. C'est le
 * morceau le plus lourd de tout l'éditeur, et il est derrière DEUX clics :
 * ouvrir les réglages avancés, puis demander l'aperçu. `scripts/editeur-guard.mjs`
 * mesure la première charge sur le graphe STATIQUE, où rien de tout cela
 * n'apparaît, et refuse séparément que ces modules soient atteignables sans
 * `import()`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * L'ORDRE, ET POURQUOI IL N'EST PAS CELUI DU STUDIO
 *
 * Le studio construisait et DÉPOSAIT tout de suite, pour avoir un code QR à
 * montrer. Ici l'aperçu est rendu d'abord, depuis un `blob:` local, et le dépôt
 * n'a lieu que si le client demande la réalité augmentée. Un client qui voulait
 * juste tourner autour de son t-shirt ne paie pas un téléversement, et R2 ne
 * garde pas un modèle que personne n'ira scanner.
 */
import type { Design } from '@/lib/types'
import type { Contexte } from './contexte'
import { el, vider } from './dom'

/** Ce que la vue avancée récupère pour pouvoir tout arrêter. */
export interface Apercu {
  fermer(): void
}

const MOTS = {
  titre: 'Aperçu en volume',
  construction: 'Construction du modèle en volume.',
  echecConstruction:
    'Le modèle en volume n’a pas pu être construit. Votre visuel et votre commande ne sont pas touchés : refermez cet aperçu et continuez.',
  echecRendu:
    'Ce navigateur n’a pas pu afficher la 3D. Cela arrive quand l’accélération matérielle est désactivée : votre commande n’est pas touchée.',
  glisser: 'Faites glisser pour tourner le vêtement.',
  homme: 'Homme',
  femme: 'Femme',
  ar: 'Voir chez vous, à taille réelle',
  arEnvoi: 'Préparation de l’essayage.',
  arPret: 'Scannez ce code avec votre téléphone pour poser le vêtement dans votre pièce, à taille réelle.',
  arEchec:
    'L’essayage n’a pas pu être préparé. Vérifiez votre connexion et réessayez : votre commande n’est pas touchée.',
  arSansDepot:
    'Cette boutique n’a pas d’espace de dépôt configuré, donc le modèle ne peut pas être envoyé sur votre téléphone. L’aperçu en volume ci-dessus fonctionne quand même.',
  qrAlt: 'Code à scanner pour l’essayage en réalité augmentée',
} as const

export function ouvrirApercu(
  zone: HTMLElement,
  ctx: Contexte,
  creation: () => Design,
): Apercu {
  const vue = new Apercu3d(zone, ctx, creation)
  return { fermer: () => vue.fermer() }
}

class Apercu3d {
  private readonly zone: HTMLElement
  private readonly ctx: Contexte
  private readonly creation: () => Design
  private scene: { arreter(): void } | null = null
  private urlBlob = ''
  private silhouette: 'male' | 'female' = 'male'
  private ferme = false
  private message = ''
  private modele: { glb: Blob; usdz: Blob; poster: Blob } | null = null

  constructor(zone: HTMLElement, ctx: Contexte, creation: () => Design) {
    this.zone = zone
    this.ctx = ctx
    this.creation = creation
    this.zone.classList.add('tshop-ed__apercu')
    void this.construire()
  }

  fermer(): void {
    this.ferme = true
    this.arreterScene()
    vider(this.zone)
    this.zone.classList.remove('tshop-ed__apercu')
  }

  /**
   * Une scène à la fois, et l'ancienne est vraiment détruite.
   *
   * Chaque montage prend un contexte WebGL, et un navigateur n'en garde qu'une
   * poignée : quand il en manque il jette le plus ancien, c'est-à-dire celui
   * qu'on regarde. Changer de silhouette trois fois sans ceci suffisait, dans
   * le studio, à voir la scène s'éteindre.
   */
  private arreterScene(): void {
    this.scene?.arreter()
    this.scene = null
    if (this.urlBlob !== '') {
      URL.revokeObjectURL(this.urlBlob)
      this.urlBlob = ''
    }
  }

  private async construire(): Promise<void> {
    this.arreterScene()
    this.modele = null
    this.message = MOTS.construction
    this.rendre()
    try {
      const [{ buildArModel, configureArAssets }, { DEFAULT_SIZE }] = await Promise.all([
        import('@/lib/arExport'),
        import('@/content/sizeChart'),
      ])
      if (this.ferme) return
      /*
       * LES AVATARS SONT SUR LE WORKER, PAS SUR LA BOUTIQUE.
       *
       * Sans cette ligne le chargeur demande `/models/avatar-tee.glb` à
       * WordPress et reçoit une 404 : mesuré, l'aperçu affichait « le modèle
       * n'a pas pu être construit » et le bouton d'essayage n'apparaissait
       * jamais. `worker/index.ts` pose l'en-tête CORS sur ce préfixe pour que
       * le chargeur puisse lire la réponse.
       */
      configureArAssets(this.ctx.workerUrl)
      const taille = (this.ctx.tailleTarif || DEFAULT_SIZE) as never
      this.modele = await buildArModel(this.creation(), this.silhouette, taille)
      if (this.ferme) return
      this.message = ''
      this.rendre()
      this.monterScene()
    } catch {
      if (this.ferme) return
      this.message = MOTS.echecConstruction
      this.rendre()
    }
  }

  private monterScene(): void {
    const canvas = this.zone.querySelector<HTMLCanvasElement>('.tshop-ed__canvas3d')
    if (!canvas || !this.modele) return
    this.urlBlob = URL.createObjectURL(this.modele.glb)
    void import('@/lib/glbStage').then(({ monterGlb }) => {
      if (this.ferme) return
      this.scene = monterGlb(
        canvas,
        this.urlBlob,
        () => {},
        () => {
          this.message = MOTS.echecRendu
          this.rendre()
        },
      )
    })
  }

  /**
   * L'essayage : le modèle monte sur R2 et le client scanne un code.
   *
   * IL NE MONTE QU'ICI, sur demande. Le studio déposait dès l'ouverture pour
   * avoir un code à montrer tout de suite ; un client qui voulait seulement
   * tourner autour de son t-shirt payait alors un téléversement, et R2 gardait
   * un modèle que personne n'irait scanner.
   */
  private async essayer(): Promise<void> {
    if (!this.modele) return
    if (this.ctx.workerUrl === '') {
      this.message = MOTS.arSansDepot
      this.rendre()
      return
    }
    this.message = MOTS.arEnvoi
    this.rendre()
    try {
      const [{ uploadArModel }, { makeQrDataUrl }] = await Promise.all([
        import('@/lib/arExport'),
        import('@/lib/qr'),
      ])
      if (this.ferme) return
      const id = await uploadArModel(this.modele, { endpoint: this.ctx.workerUrl })
      if (this.ferme) return
      const lien = `${this.ctx.workerUrl}/v/${id}`
      const qr = await makeQrDataUrl(lien)
      if (this.ferme) return
      this.message = ''
      this.rendre({ qr, lien })
      this.monterScene()
    } catch {
      if (this.ferme) return
      this.message = MOTS.arEchec
      this.rendre()
    }
  }

  // ------------------------------------------------------------------ rendu

  private rendre(ar?: { qr: string; lien: string }): void {
    if (this.ferme) return
    vider(this.zone)

    const titre = el('h3', 'tshop-ed__titre')
    titre.textContent = MOTS.titre
    this.zone.append(titre)

    // La silhouette : deux boutons, et rien de plus. Le studio en propose
    // davantage ; ici c'est le seul réglage qui change ce qu'on voit.
    const groupe = el('div', 'tshop-ed__faces')
    groupe.setAttribute('role', 'radiogroup')
    groupe.setAttribute('aria-label', MOTS.titre)
    for (const [id, nom] of [
      ['male', MOTS.homme],
      ['female', MOTS.femme],
    ] as const) {
      const b = el('button', 'tshop-ed__face')
      b.type = 'button'
      b.setAttribute('role', 'radio')
      b.setAttribute('aria-checked', String(id === this.silhouette))
      b.textContent = nom
      b.addEventListener('click', () => {
        if (this.silhouette === id) return
        this.silhouette = id
        void this.construire()
      })
      groupe.append(b)
    }
    this.zone.append(groupe)

    const scene = el('div', 'tshop-ed__scene3d')
    const canvas = el('canvas', 'tshop-ed__canvas3d')
    canvas.setAttribute('data-teeshoop', 'apercu-3d')
    scene.append(canvas)
    this.zone.append(scene)

    if (this.message !== '') {
      const p = el('p', this.message === MOTS.construction || this.message === MOTS.arEnvoi ? 'tshop-ed__note' : 'tshop-ed__alerte')
      p.setAttribute('role', 'status')
      p.textContent = this.message
      this.zone.append(p)
    } else if (!ar) {
      const p = el('p', 'tshop-ed__note')
      p.textContent = MOTS.glisser
      this.zone.append(p)
    }

    if (ar) {
      const img = document.createElement('img')
      img.className = 'tshop-ed__qr'
      img.src = ar.qr
      img.alt = MOTS.qrAlt
      const p = el('p', 'tshop-ed__note')
      p.textContent = MOTS.arPret
      const a = document.createElement('a')
      a.className = 'tshop-ed__lien'
      a.href = ar.lien
      a.rel = 'noopener'
      a.target = '_blank'
      a.textContent = ar.lien
      const bloc = el('div', 'tshop-ed__ar')
      bloc.setAttribute('data-teeshoop', 'ar-pret')
      bloc.append(img, p, a)
      this.zone.append(bloc)
    } else if (this.modele) {
      const b = el('button', 'tshop-ed__outil')
      b.type = 'button'
      b.setAttribute('data-teeshoop', 'essayer-ar')
      b.textContent = MOTS.ar
      b.addEventListener('click', () => void this.essayer())
      this.zone.append(b)
    }
  }
}
