/**
 * AR viewer page (v.html) — the destination of the scanned QR short URL
 * (/v/{id}). Shows an in-page auto-rotating 3D preview of the design baked onto
 * a mannequin (loaded from R2), and a button that launches NATIVE mobile AR:
 *   • iOS  → Quick Look, via an <a rel="ar" href=…usdz> anchor
 *   • Android → Scene Viewer, via an ARCore intent to the GLB
 * Fully cross-device (the model lives server-side, not on the scanning phone)
 * and dependency-light: it reuses the app's own three.js — no model-viewer, no
 * CDN. The heavy native-AR rendering is done by the phone's OS.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const ID_RE = /^[A-Za-z0-9_-]{6,40}$/

type Lang = 'fr' | 'en'
const LANG: Lang = (() => {
  try {
    return JSON.parse(localStorage.getItem('tshop:prefs') || '{}').lang === 'en' ? 'en' : 'fr'
  } catch {
    return 'fr'
  }
})()

const T = {
  fr: {
    sub: 'Réalité augmentée',
    arButton: 'Voir dans votre espace',
    loading: 'Chargement du modèle 3D…',
    hint: 'Faites glisser pour tourner. Touchez « Voir dans votre espace » pour le placer, à taille réelle, dans votre pièce.',
    desktop: 'Ouvrez ce lien sur votre téléphone pour l’essayer en réalité augmentée. Vous pouvez déjà faire tourner le modèle 3D ci-dessus.',
    download: 'Enregistrer l’image',
    create: 'Créer le vôtre',
    errTitle: 'Modèle AR introuvable',
    errBody: 'Ce lien a peut-être expiré. Créez un nouveau design dans le studio pour réessayer.',
  },
  en: {
    sub: 'Augmented reality',
    arButton: 'View in your space',
    loading: 'Loading 3D model…',
    hint: 'Drag to rotate. Tap “View in your space” to place it, life-size, in your room.',
    desktop: 'Open this link on your phone to try it in augmented reality. You can already spin the 3D model above.',
    download: 'Save image',
    create: 'Create your own',
    errTitle: 'AR model not found',
    errBody: 'This link may have expired. Create a new design in the studio to try again.',
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

/** Soft equirectangular studio gradient for gentle ambient + reflections. */
function gradientEnv(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = 32
  c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, 128)
  g.addColorStop(0.0, '#eef3fb')
  g.addColorStop(0.5, '#aeb9c8')
  g.addColorStop(1.0, '#42484f')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 32, 128)
  const tex = new THREE.CanvasTexture(c)
  tex.mapping = THREE.EquirectangularReflectionMapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function renderError() {
  root.innerHTML = `
    <div class="vw-head"><span class="brand">Tshop</span></div>
    <div class="vw-center">
      <div class="big">${T.errTitle}</div>
      <div class="muted">${T.errBody}</div>
      <div class="vw-links"><a href="/">${T.create} →</a></div>
    </div>`
}

/** Android → Scene Viewer (native ARCore). Needs an absolute HTTPS GLB URL. */
function launchAndroidAr(glbUrl: string, fallback: string) {
  const intent =
    `intent://arvr.google.com/scene-viewer/1.0?file=${encodeURIComponent(glbUrl)}` +
    `&mode=ar_preferred&title=${encodeURIComponent('Tshop')}` +
    `#Intent;scheme=https;package=com.google.ar.core;action=android.intent.action.VIEW;` +
    `S.browser_fallback_url=${encodeURIComponent(fallback)};end;`
  window.location.href = intent
}

function initPreview(canvas: HTMLCanvasElement, glbUrl: string, onReady: () => void, onFail: () => void) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05

  const scene = new THREE.Scene()
  scene.environment = gradientEnv()
  scene.add(new THREE.HemisphereLight(0xf2f5ff, 0x3a3630, 0.55))
  const key = new THREE.DirectionalLight(0xffffff, 2.0)
  key.position.set(-6, 12, 10)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0xbcd3ff, 0.5)
  fill.position.set(8, 5, -6)
  scene.add(fill)

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 4000)
  const pivot = new THREE.Group()
  scene.add(pivot)

  const resize = () => {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (w < 2 || h < 2) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  window.addEventListener('resize', resize)

  // Drag to rotate; idle auto-spin.
  let auto = true
  let dragging = false
  let lastX = 0
  let vel = 0.004
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true
    auto = false
    lastX = e.clientX
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  })
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return
    const dx = e.clientX - lastX
    lastX = e.clientX
    vel = dx * 0.01
    pivot.rotation.y += vel
  })
  const stop = () => (dragging = false)
  canvas.addEventListener('pointerup', stop)
  canvas.addEventListener('pointercancel', stop)

  new GLTFLoader().loadAsync(glbUrl).then(
    (gltf) => {
      const model = gltf.scene
      const box = new THREE.Box3().setFromObject(model)
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      model.position.sub(center) // centre at the origin so it spins in place
      pivot.add(model)
      const radius = Math.max(size.x, size.y, size.z) * 0.5 || 30
      camera.position.set(0, size.y * 0.04, radius / Math.tan((camera.fov * Math.PI) / 360) * 1.15)
      camera.lookAt(0, 0, 0)
      resize()
      renderer.setAnimationLoop(() => {
        if (auto) pivot.rotation.y += 0.006
        else if (!dragging) {
          pivot.rotation.y += vel
          vel *= 0.94
        }
        renderer.render(scene, camera)
      })
      onReady()
    },
    () => onFail(),
  )
}

function renderViewer(id: string) {
  const base = `/r2/ar/${id}`
  const iosAR = !!document.createElement('a').relList?.supports?.('ar')
  const isAndroid = /android/i.test(navigator.userAgent)

  root.innerHTML = `
    <div class="vw-head"><span class="brand">Tshop</span><span class="sub">· ${T.sub}</span></div>
    <div class="vw-stage"><canvas id="vw-canvas"></canvas></div>
    <div class="vw-foot">
      <div id="vw-arbtn"></div>
      <div class="vw-hint" id="vw-hint">${T.loading}</div>
      <div class="vw-links">
        <button id="vw-dl">${T.download}</button>
        <a href="/">${T.create} →</a>
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
  } // desktop: no AR button — hint tells them to open on a phone.

  const canvas = root.querySelector('#vw-canvas') as HTMLCanvasElement
  initPreview(
    canvas,
    `${base}.glb`,
    () => {
      hint.textContent = iosAR || isAndroid ? T.hint : T.desktop
    },
    renderError,
  )

  root.querySelector('#vw-dl')!.addEventListener('click', async () => {
    try {
      const res = await fetch(`${base}.png`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'tshop-ar.png'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      /* ignore */
    }
  })
}

const id = idFromUrl()
if (id) renderViewer(id)
else renderError()
