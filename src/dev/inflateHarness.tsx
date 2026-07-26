/**
 * Dev harness for the HOLLOW Poisson-inflated custom-garment shell.
 *
 * Draws a fake laid-flat garment (cutout alpha with a real crew-neck hole,
 * printed design, soft photo folds), builds the shell, and renders it in a RAW
 * three.js scene with preserveDrawingBuffer so the framebuffer can be read
 * back headlessly (swiftshader-safe). Mirrors ExtrudedGarment's materials
 * exactly (front/back sheets + interior linings + catch planes + photo
 * wrinkle normal map). Default view: a 2×2 grid — front, three-quarter,
 * top-down-into-the-neck, grazing-light — the four angles the hollow read
 * must survive. Exposes window.__inflate for scripts/inflate-verify.mjs.
 */
import * as THREE from 'three'
import { buildInflatedShell, canvasToSilhouette } from '@/lib/silhouette'
import { fabricNormalTexture } from '@/three/fabric'

const WIN = 20
const HIN = 24
const PPI = 54

/** A crew-neck tee silhouette (transparent bg) with an enclosed collar hole,
 * soft photo folds and a printed chest design — enough to exercise silhouette
 * + holes + decal + the photo-derived wrinkle bands. */
function drawShirt(canvas: HTMLCanvasElement) {
  canvas.width = Math.round(WIN * PPI)
  canvas.height = Math.round(HIN * PPI)
  const ctx = canvas.getContext('2d')!
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)

  const grad = ctx.createLinearGradient(0, 0, 0, h)
  grad.addColorStop(0, '#26324a')
  grad.addColorStop(1, '#1a2740')
  ctx.fillStyle = grad

  // sleeves
  const sleeve = (s: 1 | -1) => {
    ctx.save()
    ctx.translate(w / 2 + s * w * 0.34, h * 0.2)
    ctx.rotate(s * 0.5)
    ctx.beginPath()
    ctx.roundRect(-w * 0.1, 0, w * 0.2, h * 0.34, 40)
    ctx.fill()
    ctx.restore()
  }
  sleeve(1)
  sleeve(-1)

  // body
  ctx.beginPath()
  ctx.roundRect(w * 0.2, h * 0.12, w * 0.6, h * 0.8, 48)
  ctx.fill()
  // shoulders
  ctx.beginPath()
  ctx.ellipse(w / 2, h * 0.16, w * 0.3, h * 0.08, 0, 0, Math.PI * 2)
  ctx.fill()

  // Soft photographic folds (deterministic): the wrinkle normal map and the
  // mid-frequency Z band read these — a flat gradient would give them nothing.
  // source-atop keeps the blurred strokes inside the garment alpha.
  ctx.save()
  ctx.globalCompositeOperation = 'source-atop'
  ctx.filter = 'blur(9px)'
  ctx.lineCap = 'round'
  const folds: Array<[number, number, number, number, number, string]> = [
    [0.36, 0.5, 0.4, 0.9, 14, 'rgba(8,12,24,0.5)'],
    [0.5, 0.55, 0.47, 0.92, 10, 'rgba(10,14,26,0.42)'],
    [0.63, 0.48, 0.66, 0.9, 13, 'rgba(8,12,24,0.5)'],
    [0.44, 0.62, 0.38, 0.88, 7, 'rgba(120,140,190,0.28)'],
    [0.57, 0.6, 0.62, 0.86, 8, 'rgba(120,140,190,0.25)'],
    [0.3, 0.7, 0.34, 0.9, 9, 'rgba(6,10,20,0.4)'],
    [0.7, 0.68, 0.68, 0.9, 9, 'rgba(6,10,20,0.4)'],
  ]
  for (const [x0, y0, x1, y1, lw, col] of folds) {
    ctx.strokeStyle = col
    ctx.lineWidth = lw
    ctx.beginPath()
    ctx.moveTo(w * x0, h * y0)
    ctx.quadraticCurveTo(w * ((x0 + x1) / 2 + 0.03), h * ((y0 + y1) / 2), w * x1, h * y1)
    ctx.stroke()
  }
  ctx.restore()

  // enclosed crew collar hole (punch transparent) — punched AFTER the folds so
  // nothing bleeds into the opening.
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  ctx.beginPath()
  ctx.ellipse(w / 2, h * 0.15, w * 0.11, h * 0.05, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // printed chest design
  ctx.save()
  ctx.translate(w / 2, h * 0.4)
  ctx.fillStyle = '#ffc940'
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? w * 0.12 : w * 0.05
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = `800 ${1.7 * PPI}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('TSHOP', 0, h * 0.13)
  ctx.restore()
}

/** Front alpha silhouette flooded with a fabric tone (blank back). */
function silhouetteCanvas(src: HTMLCanvasElement, fill: string): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = src.width
  c.height = src.height
  const ctx = c.getContext('2d')!
  ctx.drawImage(src, 0, 0)
  ctx.globalCompositeOperation = 'source-in'
  ctx.fillStyle = fill
  ctx.fillRect(0, 0, c.width, c.height)
  return c
}

function tex(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  t.flipY = true
  t.needsUpdate = true
  return t
}

function normalTex(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = THREE.NoColorSpace
  t.anisotropy = 4
  t.flipY = true
  t.needsUpdate = true
  return t
}

function gradientEnv(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = 32
  c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, 128)
  g.addColorStop(0, '#eef3fb')
  g.addColorStop(0.5, '#aab6c6')
  g.addColorStop(1, '#3a3630')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 32, 128)
  const t = new THREE.CanvasTexture(c)
  t.mapping = THREE.EquirectangularReflectionMapping
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// --- build ------------------------------------------------------------------

const garment = document.createElement('canvas')
drawShirt(garment)
const t0 = performance.now()
const silCold = canvasToSilhouette(garment, WIN, HIN)
const shellCold = silCold ? buildInflatedShell(garment, silCold, WIN, HIN) : null
const buildColdMs = performance.now() - t0
// Warm rebuild = the steady-state cost of design edits in the app (the cold
// number is dominated by JIT + first-canvas readback, esp. on swiftshader).
shellCold?.front.dispose()
shellCold?.back.dispose()
const t1 = performance.now()
const sil = canvasToSilhouette(garment, WIN, HIN)
const shell = sil ? buildInflatedShell(garment, sil, WIN, HIN) : null
const buildMs = performance.now() - t1

const PANEL_W = 580
const PANEL_H = 440
const CANVAS_W = PANEL_W * 2
const CANVAS_H = PANEL_H * 2

const renderer = new THREE.WebGLRenderer({ alpha: false, antialias: true, preserveDrawingBuffer: true })
renderer.setPixelRatio(1)
renderer.setSize(CANVAS_W, CANVAS_H)
renderer.setClearColor(0x0c0f13, 1)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05
const root = document.getElementById('root')!
root.style.position = 'relative'
root.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.environment = gradientEnv()

const hemi = new THREE.HemisphereLight(0xf2f5ff, 0x30302c, 0.5)
scene.add(hemi)
const key = new THREE.DirectionalLight(0xffffff, 2.2)
key.position.set(-6, 10, 12)
scene.add(key)
// Grazing key: nearly in the sheet plane, raking across the folds.
const grazeKey = new THREE.DirectionalLight(0xfff2df, 3.2)
grazeKey.position.set(28, 12, 2.5)
grazeKey.visible = false
scene.add(grazeKey)
const fill = new THREE.DirectionalLight(0xbcd3ff, 0.5)
fill.position.set(8, 4, -6)
scene.add(fill)

const group = new THREE.Group()
scene.add(group)
/** Named part meshes for debug toggling from __inflate.setPart(). */
const parts: Record<string, THREE.Mesh> = {}
const addPart = (name: string, mesh: THREE.Mesh) => {
  parts[name] = mesh
  group.add(mesh)
}

if (shell) {
  const SHEEN = new THREE.Color('#dfe6f2')
  const fabricN = fabricNormalTexture(WIN / 0.9, HIN / 0.9)
  const photoN = shell.normalMapCanvas ? normalTex(shell.normalMapCanvas) : null
  const frontTex = tex(garment)
  const blankTex = tex(silhouetteCanvas(garment, '#242A33'))

  const frontMesh = new THREE.Mesh(
    shell.front,
    new THREE.MeshPhysicalMaterial({
      map: frontTex,
      vertexColors: true,
      normalMap: photoN ?? fabricN,
      normalScale: photoN ? new THREE.Vector2(0.6, 0.6) : new THREE.Vector2(0.35, 0.35),
      alphaTest: 0.45,
      roughness: 0.86,
      metalness: 0,
      sheen: 0.55,
      sheenRoughness: 0.85,
      sheenColor: SHEEN,
      side: THREE.FrontSide,
    }),
  )
  const backMesh = new THREE.Mesh(
    shell.back,
    new THREE.MeshPhysicalMaterial({
      map: blankTex,
      vertexColors: true,
      normalMap: fabricN,
      normalScale: new THREE.Vector2(0.35, 0.35),
      alphaTest: 0.45,
      roughness: 0.92,
      metalness: 0,
      sheen: 0.35,
      sheenColor: SHEEN,
      emissive: new THREE.Color('#232932'),
      side: THREE.FrontSide,
    }),
  )
  addPart('front', frontMesh)
  addPart('back', backMesh)

  const liningMat = (map: THREE.Texture) =>
    new THREE.MeshStandardMaterial({
      map,
      color: '#adadad', // ≈0.42 linear — matches ExtrudedGarment LINING_TINT
      vertexColors: true,
      normalMap: fabricN,
      normalScale: new THREE.Vector2(0.3, 0.3),
      alphaTest: 0.45,
      roughness: 0.95,
      metalness: 0,
      envMapIntensity: 0.5,
      side: THREE.FrontSide,
    })
  // Blank-back lining floods lighter than the outside face (#59616e): the
  // unprinted reverse of the fabric must stay legible through the neck.
  // (#aab3c0 matches ExtrudedGarment BLANK_LINING.)
  const blankLiningTex = tex(silhouetteCanvas(garment, '#aab3c0'))
  if (shell.liningFront) addPart('liningFront', new THREE.Mesh(shell.liningFront, liningMat(frontTex)))
  if (shell.liningBack) addPart('liningBack', new THREE.Mesh(shell.liningBack, liningMat(blankLiningTex)))

  const interiorMat = () =>
    new THREE.MeshStandardMaterial({
      color: '#14181F',
      emissive: '#0E1218',
      roughness: 0.95,
      metalness: 0,
      side: THREE.FrontSide,
    })
  if (shell.interior) addPart('interior', new THREE.Mesh(shell.interior, interiorMat()))
  if (shell.interiorFront) addPart('interiorFront', new THREE.Mesh(shell.interiorFront, interiorMat()))
}

// --- cameras / views ---------------------------------------------------------

type ViewName = 'front' | 'threequarter' | 'side' | 'top' | 'graze'
const camera = new THREE.PerspectiveCamera(30, PANEL_W / PANEL_H, 0.1, 500)

function aimCamera(name: ViewName) {
  if (name === 'front' || name === 'graze') {
    camera.position.set(name === 'graze' ? 5 : 0, name === 'graze' ? -1 : 0, 47)
    camera.lookAt(0, 0, 0)
  } else if (name === 'side') {
    camera.position.set(46, 0, 3)
    camera.lookAt(0, 0, 0)
  } else if (name === 'top') {
    // Down into the neck: 45° above + in front of the collar, close crop.
    camera.position.set(0, 26, 20)
    camera.lookAt(0, 6, 0)
  } else {
    camera.position.set(-28.5, 2, 36)
    camera.lookAt(0, 0, 0)
  }
  camera.updateProjectionMatrix()
}

function renderPanel(name: ViewName, x: number, y: number, w: number, h: number) {
  grazeKey.visible = name === 'graze'
  key.visible = name !== 'graze'
  hemi.intensity = name === 'graze' ? 0.3 : 0.5
  camera.aspect = w / h
  aimCamera(name)
  renderer.setViewport(x, y, w, h)
  renderer.setScissor(x, y, w, h)
  renderer.render(scene, camera)
}

let mode: 'grid' | ViewName = 'grid'

function render() {
  renderer.setScissorTest(true)
  if (mode === 'grid') {
    renderPanel('front', 0, PANEL_H, PANEL_W, PANEL_H)
    renderPanel('threequarter', PANEL_W, PANEL_H, PANEL_W, PANEL_H)
    renderPanel('top', 0, 0, PANEL_W, PANEL_H)
    renderPanel('graze', PANEL_W, 0, PANEL_W, PANEL_H)
  } else {
    renderPanel(mode, 0, 0, CANVAS_W, CANVAS_H)
  }
  renderer.setScissorTest(false)
}
// Static scene: render on demand (a continuous loop starves the compositor
// under headless swiftshader and screenshots time out).
render()

// --- labels + timing readout (DOM, outside the GL readback) ------------------

const label = (text: string, left: number, top: number) => {
  const el = document.createElement('div')
  el.textContent = text
  el.style.cssText =
    `position:absolute;left:${left}px;top:${top}px;color:#9AA5B4;` +
    'font:600 11px/1.4 monospace;letter-spacing:0.08em;pointer-events:none;' +
    'text-transform:uppercase;background:rgba(12,15,19,0.55);padding:2px 6px;border-radius:3px'
  root.appendChild(el)
  return el
}
label('front', 8, 8)
label('three-quarter', PANEL_W + 8, 8)
label('top — into the neck', 8, PANEL_H + 8)
label('grazing light', PANEL_W + 8, PANEL_H + 8)
const fVerts = shell ? (shell.front.attributes.position as THREE.BufferAttribute).count : 0
const info = label(
  `build ${buildMs.toFixed(0)} ms warm (${buildColdMs.toFixed(0)} cold) · verts ${fVerts}×4 · depth ${shell?.depthIn.toFixed(2) ?? '—'}in · ` +
    `holes ${shell?.interior ? 'yes' : 'no'} · lining ${shell?.liningFront ? 'yes' : 'no'} · ` +
    `normalmap ${shell?.normalMapCanvas ? 'yes' : 'no'}`,
  8,
  CANVAS_H - 26,
)
info.style.color = '#EEF1F5'

// --- probe API for scripts/inflate-verify.mjs --------------------------------

;(window as unknown as { __inflate?: unknown }).__inflate = {
  ok: !!shell,
  hasHoles: !!shell?.interior,
  hasLinings: !!shell?.liningFront && !!shell?.liningBack,
  hasNormalMap: !!shell?.normalMapCanvas,
  buildMs,
  setView(name: ViewName | 'grid') {
    mode = name
    render()
  },
  setPart(name: string, visible: boolean) {
    if (parts[name]) parts[name].visible = visible
    render()
  },
  probe() {
    render()
    const g = shell?.front
    let zMin = 0
    let zMax = 0
    let curvature = 0
    let liningInside = true
    if (g) {
      g.computeBoundingBox()
      zMin = g.boundingBox!.min.z
      zMax = g.boundingBox!.max.z
      // Fraction of front-face normals that actually tilt off +Z. A flat plateau
      // is ~all (0,0,1) → ~0; a real dome tilts most of them.
      const n = g.attributes.normal as THREE.BufferAttribute
      let tilted = 0
      for (let i = 0; i < n.count; i++) if (Math.abs(n.getZ(i)) < 0.985) tilted++
      curvature = tilted / Math.max(1, n.count)
      // Hollow invariant: the front lining must sit between its sheet and the
      // mid-plane at every vertex (never poke through either).
      const lf = shell?.liningFront?.attributes.position as THREE.BufferAttribute | undefined
      const fp = g.attributes.position as THREE.BufferAttribute
      if (lf) {
        for (let i = 0; i < lf.count; i++) {
          const zs = fp.getZ(i)
          const zl = lf.getZ(i)
          if (zl < -1e-4 || zl > zs + 1e-4) {
            liningInside = false
            break
          }
        }
      }
    }
    const gl = renderer.domElement
    const c = document.createElement('canvas')
    c.width = gl.width
    c.height = gl.height
    const ctx = c.getContext('2d')!
    ctx.drawImage(gl, 0, 0)
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    // Count pixels that differ from the #0c0f13 clear color (the garment).
    let cov = 0
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i] - 12) + Math.abs(d[i + 1] - 15) + Math.abs(d[i + 2] - 19) > 24) cov++
    }
    return {
      ok: !!shell,
      verts: g ? (g.attributes.position as THREE.BufferAttribute).count : 0,
      zMin,
      zMax,
      curvature,
      liningInside,
      buildMs,
      thickness: shell?.depthIn ?? 0,
      coverage: cov / (c.width * c.height),
      dataUrl: gl.toDataURL('image/png'),
    }
  },
}
