/**
 * Dev harness for the inflated custom-garment shell (Feature: 3D volume).
 *
 * Draws a fake laid-flat garment (cutout alpha + printed design), builds the
 * inflated shell, and renders it in a RAW three.js scene with
 * preserveDrawingBuffer so the framebuffer can be read back headlessly
 * (swiftshader-safe). Mirrors ExtrudedGarment's materials. Exposes
 * window.__inflate for scripts/inflate-verify.mjs.
 */
import * as THREE from 'three'
import { buildInflatedShell, canvasToSilhouette } from '@/lib/silhouette'

const WIN = 20
const HIN = 24
const PPI = 42

/** A crew-neck tee silhouette (transparent bg) with an enclosed collar hole
 * and a printed chest design — enough to exercise silhouette + holes + decal. */
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

  // enclosed crew collar hole (punch transparent)
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
const sil = canvasToSilhouette(garment, WIN, HIN)
const shell = sil ? buildInflatedShell(garment, sil, WIN, HIN) : null

const renderer = new THREE.WebGLRenderer({ alpha: false, antialias: true, preserveDrawingBuffer: true })
renderer.setPixelRatio(1)
renderer.setSize(640, 760)
renderer.setClearColor(0x0c0f13, 1)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05
document.getElementById('root')!.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.environment = gradientEnv()
const camera = new THREE.PerspectiveCamera(30, 640 / 760, 0.1, 500)

scene.add(new THREE.HemisphereLight(0xf2f5ff, 0x30302c, 0.5))
const key = new THREE.DirectionalLight(0xffffff, 2.2)
key.position.set(-6, 10, 12)
scene.add(key)
const fill = new THREE.DirectionalLight(0xbcd3ff, 0.5)
fill.position.set(8, 4, -6)
scene.add(fill)

const group = new THREE.Group()
scene.add(group)

if (shell) {
  const SHEEN = new THREE.Color('#dfe6f2')
  const frontMesh = new THREE.Mesh(
    shell.front,
    new THREE.MeshPhysicalMaterial({
      map: tex(garment),
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
      map: tex(silhouetteCanvas(garment, '#242A33')),
      alphaTest: 0.45,
      roughness: 0.92,
      metalness: 0,
      sheen: 0.35,
      sheenColor: SHEEN,
      emissive: new THREE.Color('#232932'),
      side: THREE.FrontSide,
    }),
  )
  group.add(frontMesh, backMesh)
  if (shell.interior) {
    group.add(
      new THREE.Mesh(
        shell.interior,
        new THREE.MeshStandardMaterial({ color: '#14181F', emissive: '#0E1218', roughness: 0.95, side: THREE.DoubleSide }),
      ),
    )
  }
}

function setView(name: 'front' | 'threequarter' | 'side') {
  const r = 46
  if (name === 'front') camera.position.set(0, 0, r)
  else if (name === 'side') camera.position.set(r, 0, 3)
  else camera.position.set(-r * 0.62, 2, r * 0.78)
  camera.lookAt(0, 0, 0)
}
setView('threequarter')

function render() {
  renderer.render(scene, camera)
}
renderer.setAnimationLoop(render)
;(window as unknown as { __inflate?: unknown }).__inflate = {
  ok: !!shell,
  hasHoles: !!shell?.interior,
  setView(name: 'front' | 'threequarter' | 'side') {
    setView(name)
  },
  probe() {
    render()
    const g = shell?.front
    let zMin = 0
    let zMax = 0
    if (g) {
      g.computeBoundingBox()
      zMin = g.boundingBox!.min.z
      zMax = g.boundingBox!.max.z
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
      thickness: shell?.depthIn ?? 0,
      coverage: cov / (c.width * c.height),
      dataUrl: gl.toDataURL('image/png'),
    }
  },
}
