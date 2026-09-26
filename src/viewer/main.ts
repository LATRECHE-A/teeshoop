/**
 * AR viewer page (v.html), the destination of the scanned QR short URL
 * (/v/{id}). Shows an in-page auto-rotating 3D preview of the design baked onto
 * a mannequin (loaded from R2), and a button that launches NATIVE mobile AR:
 *   • iOS  → Quick Look, via an <a rel="ar" href=…usdz> anchor
 *   • Android → Scene Viewer, via an ARCore intent to the GLB
 * Fully cross-device (the model lives server-side, not on the scanning phone)
 * and dependency-light: it reuses the app's own three.js. No model-viewer, no
 * CDN. The heavy native-AR rendering is done by the phone's OS.
 */
/*
 * LA SCÈNE EST PARTAGÉE AVEC L'ÉDITEUR DE LA FICHE PRODUIT.
 *
 * `initPreview` et son dégradé d'environnement vivaient ici. Le
 * personnalisateur natif (`src/native/apercu3d.ts`) a besoin exactement de la
 * même chose, et deux éclairages seraient deux couleurs sur le même tissu. Ils
 * sont dans `src/lib/glbStage.ts` ; cette page garde son propre DOM, ses propres
 * phrases et son propre lancement de la réalité augmentée native.
 */
import { monterGlb } from '@/lib/glbStage'
import { downloadBlob } from '@/lib/download'

const ID_RE = /^[A-Za-z0-9_-]{6,40}$/

type Lang = 'fr' | 'en'
const LANG: Lang = (() => {
  try {
    return JSON.parse(localStorage.getItem('tshop:prefs') || '{}').lang === 'en' ? 'en' : 'fr'
  } catch {
    return 'fr'
  }
})()

/*
 * LE LIEN DE RETOUR MÈNE À LA BOUTIQUE, et plus au studio servi à la racine de
 * ce Worker : le client arrive ici depuis l'atelier de teeshoop.com, et c'est là
 * qu'il commande. Le studio n'a pas de caisse.
 */
const BOUTIQUE = 'https://www.teeshoop.com/'
const LOGO = '<img class="brand" src="/logo-teeshoop.png" width="122" height="22" alt="Teeshoop" />'

const T = {
  fr: {
    sub: 'Essayage en réalité augmentée',
    arButton: 'Voir dans votre espace',
    loading: 'Chargement du modèle 3D…',
    hint: 'Faites glisser pour tourner. Touchez « Voir dans votre espace » pour le placer, à taille réelle, dans votre pièce.',
    desktop: 'Ouvrez ce lien sur votre téléphone pour l’essayer en réalité augmentée. Vous pouvez déjà faire tourner le modèle 3D ci-dessus.',
    download: 'Enregistrer l’image',
    dlFailed: 'L’image n’a pas pu être enregistrée : ce lien a peut-être expiré. Rouvrez votre vêtement sur teeshoop.com pour en obtenir un nouveau.',
    create: 'Retour à la boutique',
    errTitle: 'Modèle introuvable',
    errBody: 'Ce lien a expiré ou n’existe pas. Rouvrez votre vêtement dans l’atelier de teeshoop.com pour obtenir un nouveau lien d’essayage.',
  },
  en: {
    sub: 'Augmented reality try-on',
    arButton: 'View in your space',
    loading: 'Loading 3D model…',
    hint: 'Drag to rotate. Tap “View in your space” to place it, life-size, in your room.',
    desktop: 'Open this link on your phone to try it in augmented reality. You can already spin the 3D model above.',
    download: 'Save image',
    dlFailed: 'The image could not be saved: this link may have expired. Reopen your garment on teeshoop.com to get a new one.',
    create: 'Back to the shop',
    errTitle: 'Model not found',
    errBody: 'This link has expired or does not exist. Reopen your garment in the teeshoop.com workshop to get a new try-on link.',
  },
}[LANG]

const CUBE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12"/></svg>'

const root = document.getElementById('ar-root')!

function idFromUrl(): string | null {
  const fromPath = location.pathname.split('/').filter(Boolean).pop() || ''
  const id = ID_RE.test(fromPath) ? fromPath : new URLSearchParams(location.search).get('id') || ''
  return ID_RE.test(id) ? id : null
}


function renderError() {
  root.innerHTML = `
    <div class="vw-head">${LOGO}</div>
    <div class="vw-center">
      <div class="big">${T.errTitle}</div>
      <div class="muted">${T.errBody}</div>
      <div class="vw-links"><a href="${BOUTIQUE}">${T.create}</a></div>
    </div>`
}

/** Android → Scene Viewer (native ARCore). Needs an absolute HTTPS GLB URL. */
function launchAndroidAr(glbUrl: string, fallback: string) {
  const intent =
    `intent://arvr.google.com/scene-viewer/1.0?file=${encodeURIComponent(glbUrl)}` +
    `&mode=ar_preferred&title=${encodeURIComponent('Teeshoop')}` +
    `#Intent;scheme=https;package=com.google.ar.core;action=android.intent.action.VIEW;` +
    `S.browser_fallback_url=${encodeURIComponent(fallback)};end;`
  window.location.href = intent
}

function renderViewer(id: string) {
  const base = `/r2/ar/${id}`
  const iosAR = !!document.createElement('a').relList?.supports?.('ar')
  const isAndroid = /android/i.test(navigator.userAgent)

  root.innerHTML = `
    <div class="vw-head">${LOGO}<span class="sub">${T.sub}</span></div>
    <div class="vw-stage"><canvas id="vw-canvas"></canvas></div>
    <div class="vw-foot">
      <div id="vw-arbtn"></div>
      <div class="vw-hint" id="vw-hint">${T.loading}</div>
      <div class="vw-links">
        <button id="vw-dl">${T.download}</button>
        <a href="${BOUTIQUE}">${T.create}</a>
      </div>
    </div>`

  const arbtn = root.querySelector('#vw-arbtn')!
  const hint = root.querySelector('#vw-hint')!

  if (iosAR) {
    // Quick Look: Safari intercepts a rel="ar" anchor that contains an <img>.
    arbtn.innerHTML =
      `<a class="ar-btn" rel="ar" href="${base}.usdz#allowsContentScaling=0">` +
      `<img class="ql-img" src="${base}.png" alt="" />${CUBE_ICON}${T.arButton}</a>`
  } else if (isAndroid) {
    const b = document.createElement('button')
    b.className = 'ar-btn'
    b.innerHTML = `${CUBE_ICON}${T.arButton}`
    b.addEventListener('click', () => launchAndroidAr(`${location.origin}${base}.glb`, location.href))
    arbtn.appendChild(b)
  } // desktop: no AR button. Hint tells them to open on a phone.

  const canvas = root.querySelector('#vw-canvas') as HTMLCanvasElement
  monterGlb(
    canvas,
    `${base}.glb`,
    () => {
      hint.textContent = iosAR || isAndroid ? T.hint : T.desktop
    },
    renderError,
  )

  /*
   * AN ERROR PAGE IS NOT SAVED AS A PICTURE, AND THE DOWNLOAD IS NOT CANCELLED
   * UNDER ITSELF (STU-11). An expired poster (30 days in R2) answered 404 and its
   * body was saved as teeshoop-essayage.png; the blob URL was revoked in the
   * same task, which Safari iOS and Firefox read as « cancel »; and a failure
   * said nothing. `downloadBlob` revokes later, and a failure is said.
   */
  root.querySelector('#vw-dl')!.addEventListener('click', async () => {
    try {
      const res = await fetch(`${base}.png`)
      const blob = await res.blob()
      if (!res.ok || blob.type !== 'image/png') throw new Error(`HTTP ${res.status} ${blob.type}`)
      downloadBlob(blob, 'teeshoop-essayage.png')
    } catch {
      hint.textContent = T.dlFailed
    }
  })
}

const id = idFromUrl()
if (id) renderViewer(id)
else renderError()
