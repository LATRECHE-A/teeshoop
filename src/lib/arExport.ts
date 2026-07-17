/**
 * Bake the current design into the two model formats native mobile AR needs:
 *   • GLB  → Android Scene Viewer (and WebXR)
 *   • USDZ → iOS Quick Look
 *
 * Runs entirely in the browser. Catalog garments (tee / hoodie) reuse the SAME
 * realistic GLB meshes as the studio 3D preview (public/models/*.glb); custom
 * (ship-your-own) garments get a procedural mannequin. The design is projected
 * on as low-poly INDEXED curved-plane decals (NOT three's DecalGeometry, whose
 * non-indexed projected primitives + >2 transparent materials are rejected by
 * Android Scene Viewer / Filament — see docs). Decals come from the shared
 * renderer (renderPrintArea), so vector AND photo designs work.
 *
 * Scene-Viewer / Quick-Look hard rules honoured here (verified against Google's
 * Scene Viewer requirements + three r185 exporter source):
 *   - 1 glTF/USDZ unit = 1 METRE. Geometry is authored in inches, so the whole
 *     export root is scaled by 0.0254 → life-size (~1.7 m), identical in both
 *     formats (three's USDZExporter hardcodes metersPerUnit=1, so NO extra ×100).
 *   - Decals are alphaMode MASK (transparent:false + alphaTest), which is
 *     order-independent and does NOT count against the "max 2 alpha materials"
 *     budget — so front + back + both sleeves all coexist safely.
 *   - Geometric lift (not polygonOffset, which the exporter drops) keeps decals
 *     off the fabric so they never z-fight.
 *   - Every material is MeshStandardMaterial (the only material USDZExporter
 *     supports well), textures are power-of-two, and hazardous vertex attributes
 *     (tangent/color/skin/morph/extra-UV) are stripped from re-exported meshes.
 */
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { CatalogGarmentId, Design, Side } from '@/lib/types'
import { garmentColorHex, getAreaSizeIn, renderMockup, renderPrintArea, sideLayers } from '@/lib/renderDesign'
import { GARMENTS } from '@/garments'
import { CALIBRATION } from '@/three/calibration'
import { buildMannequin, type Gender, type MannequinSide } from '@/three/mannequin'

const TARGET_PX = 1400 // decal render density (matches the 3D preview)
const GAP_BELOW_COLLAR = 2.6 // in, mannequin print top under the neckline
const DECAL_LIFT = 0.22 // in, above the fabric surface (geometric; replaces polygonOffset)
const DECAL_BEND_MAX = THREE.MathUtils.degToRad(58)
const INCH_TO_M = 0.0254 // glTF + USDZ are metres; author in inches, scale root once.
const MAX_TEX = 2048 // Scene Viewer texture ceiling

export type { Gender }

export interface ArModelBlobs {
  glb: Blob
  usdz: Blob
  poster: Blob
}

interface Disposable {
  dispose(): void
}

// ------------------------------------------------------------------ textures

/** Nearest power-of-two (mobile GPUs mip cleanly only on POT). */
function nearestPow2(n: number): number {
  return Math.pow(2, Math.round(Math.log2(Math.max(1, n))))
}

/** Redraw a canvas at power-of-two dimensions (≤ MAX_TEX) for Filament/Quick Look. */
function potCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const w = Math.min(MAX_TEX, Math.max(64, nearestPow2(src.width)))
  const h = Math.min(MAX_TEX, Math.max(64, nearestPow2(src.height)))
  if (w === src.width && h === src.height) return src
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) return src
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, w, h)
  return c
}

function canvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(potCanvas(canvas))
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  tex.needsUpdate = true
  return tex
}

/**
 * Print material: alphaMode MASK. transparent:false + alphaTest makes the
 * exporter emit MASK (not BLEND), which writes depth, sorts order-independently
 * and is exempt from Scene Viewer's "max 2 alpha materials" limit — the reason a
 * garment with front+back+sleeve prints previously failed to load.
 */
function decalMaterial(tex: THREE.Texture): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: tex,
    transparent: false,
    alphaTest: 0.5,
    roughness: 0.85,
    metalness: 0,
    side: THREE.FrontSide,
  })
}

async function renderSide(design: Design, side: Side): Promise<HTMLCanvasElement | null> {
  if (sideLayers(design, side).length === 0) return null
  const area = getAreaSizeIn(design, side)
  const ppi = TARGET_PX / Math.max(area.wIn, area.hIn)
  return renderPrintArea(design, side, ppi).catch(() => null)
}

function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('poster encode failed'))), type),
  )
}

/** A cylindrically-curved INDEXED plane hugging a surface, sized in inches. */
function makeCurvedDecal(wIn: number, hIn: number, radius: number): THREE.PlaneGeometry {
  const bend = Math.min(DECAL_BEND_MAX, wIn / Math.max(radius, 1))
  const r = wIn / Math.max(bend, 1e-3)
  const geo = new THREE.PlaneGeometry(wIn, hIn, 40, 1)
  const pos = geo.attributes.position as THREE.BufferAttribute
  const nor = geo.attributes.normal as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const theta = (pos.getX(i) / wIn) * bend
    pos.setXYZ(i, r * Math.sin(theta), pos.getY(i), r * (Math.cos(theta) - 1))
    nor.setXYZ(i, Math.sin(theta), 0, Math.cos(theta))
  }
  pos.needsUpdate = true
  nor.needsUpdate = true
  geo.computeBoundingSphere()
  return geo
}

// ---------------------------------------------------------------- catalog GLB

function firstMesh(root: THREE.Object3D, name?: string): THREE.Mesh | null {
  let found: THREE.Mesh | null = null
  root.traverse((o) => {
    if (found) return
    const mesh = o as THREE.Mesh
    if (mesh.isMesh && (!name || mesh.name === name)) found = mesh
  })
  return found
}

const PROBE_MATERIAL = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })

/** Z of the outermost front/back surface at (xIn, yIn), via local raycast. */
function probeSurfaceZ(geometry: THREE.BufferGeometry, xIn: number, yIn: number, side: Side): number {
  const mesh = new THREE.Mesh(geometry, PROBE_MATERIAL)
  const ray = new THREE.Raycaster()
  const sign = side === 'front' ? 1 : -1
  ray.set(new THREE.Vector3(xIn, yIn, sign * 1000), new THREE.Vector3(0, 0, -sign))
  const hits = ray.intersectObject(mesh, false)
  if (hits.length > 0) return hits[0].point.z
  const box = geometry.boundingBox as THREE.Box3
  return side === 'front' ? box.max.z * 0.9 : box.min.z * 0.9
}

/** X of the outer sleeve/arm surface at (yIn, zIn), via local raycast along ∓X. */
function probeSurfaceX(geometry: THREE.BufferGeometry, yIn: number, zIn: number, sign: 1 | -1): number {
  const mesh = new THREE.Mesh(geometry, PROBE_MATERIAL)
  const ray = new THREE.Raycaster()
  ray.set(new THREE.Vector3(sign * 1000, yIn, zIn), new THREE.Vector3(-sign, 0, 0))
  const hits = ray.intersectObject(mesh, false)
  if (hits.length > 0) return hits[0].point.x
  const box = geometry.boundingBox as THREE.Box3
  return sign > 0 ? box.max.x * 0.9 : box.min.x * 0.9
}

/** Estimate the garment's half-width (radius) at a height, for decal curvature. */
function estimateRadius(geometry: THREE.BufferGeometry, yIn: number): number {
  const x = probeSurfaceX(geometry, yIn, 0, 1)
  return Math.max(5, Number.isFinite(x) ? Math.abs(x) : 9)
}

/** Print-area centre offset from the garment visual centre (inches, +down). */
function areaOffsetYIn(garment: CatalogGarmentId, side: Side): number {
  const art = GARMENTS[garment]
  const a = art.sides[side].printAreaPx
  return (a.y + a.h / 2 - 400) / art.pxPerInch
}

/** Strip vertex attributes Scene Viewer/Filament doesn't need and that can carry
 *  hazards (a stray skin/morph/tangent set on a plain Mesh is invalid glTF). */
function sanitizeGarmentGeometry(geometry: THREE.BufferGeometry, keepUV: boolean): void {
  const drop = ['uv1', 'uv2', 'uv3', 'tangent', 'color', 'skinIndex', 'skinWeight']
  if (!keepUV) drop.push('uv')
  for (const a of drop) geometry.deleteAttribute(a)
  geometry.morphAttributes = {}
}

/**
 * Build a realistic catalog garment (tee/hoodie) with the design projected on.
 * Mirrors src/three/GarmentModel.tsx (normalize to inches, raycast the surface)
 * but uses low-poly curved-plane decals so the GLB loads in Scene Viewer.
 */
async function buildCatalogFigure(
  design: Design,
  garment: CatalogGarmentId,
): Promise<{ figure: THREE.Group; disposables: Disposable[] }> {
  const calib = CALIBRATION[garment]
  const widthIn = GARMENTS[garment].widthIn

  const gltf = await new GLTFLoader().loadAsync(calib.url)
  gltf.scene.updateMatrixWorld(true)
  const src = firstMesh(gltf.scene, calib.meshName) ?? firstMesh(gltf.scene)
  if (!src) throw new Error(`No mesh in ${calib.url}`)

  const geometry = src.geometry.clone()
  geometry.applyMatrix4(src.matrixWorld)
  if (calib.rotateY !== 0) geometry.rotateY(calib.rotateY)
  geometry.computeBoundingBox()
  const box0 = geometry.boundingBox as THREE.Box3
  const size = box0.getSize(new THREE.Vector3())
  const center = box0.getCenter(new THREE.Vector3())
  geometry.translate(-center.x, -center.y, -center.z)
  const scale = widthIn / (size.x * calib.widthFraction)
  geometry.scale(scale, scale, scale)
  geometry.computeBoundingBox()

  const srcMat = (Array.isArray(src.material) ? src.material[0] : src.material) as THREE.MeshStandardMaterial
  // Solid recolour: the tee/hoodie source maps are AO/normal only (no basecolor),
  // dropped for Filament/Quick-Look safety. Keep uv only if there's a real map.
  sanitizeGarmentGeometry(geometry, !!srcMat.map)
  const material = new THREE.MeshStandardMaterial({
    map: srcMat.map ?? null,
    color: new THREE.Color(garmentColorHex(design)),
    roughness: calib.roughness,
    metalness: 0,
  })
  const garmentMesh = new THREE.Mesh(geometry, material)
  garmentMesh.updateMatrixWorld(true)

  const figure = new THREE.Group()
  figure.add(garmentMesh)
  const disposables: Disposable[] = [geometry, material]

  const addCurvedDecal = (
    canvas: HTMLCanvasElement,
    sizeIn: { wIn: number; hIn: number },
    radius: number,
    place: (mesh: THREE.Mesh) => void,
    tex?: THREE.CanvasTexture,
  ) => {
    const geo = makeCurvedDecal(sizeIn.wIn, sizeIn.hIn, radius)
    const texture = tex ?? canvasTexture(canvas)
    const mat = decalMaterial(texture)
    disposables.push(geo, mat)
    if (!tex) disposables.push(texture)
    const mesh = new THREE.Mesh(geo, mat)
    place(mesh)
    figure.add(mesh)
  }

  // Front / back prints — a curved plane conformed to the torso, lifted proud.
  const sides: Side[] = ['front', 'back']
  const canvases = await Promise.all(sides.map((s) => renderSide(design, s)))
  sides.forEach((side, i) => {
    const canvas = canvases[i]
    if (!canvas) return
    const sizeIn = getAreaSizeIn(design, side)
    const y = -(areaOffsetYIn(garment, side) + calib.decalNudgeYIn[side])
    const surfaceZ = probeSurfaceZ(geometry, 0, y, side)
    addCurvedDecal(canvas, sizeIn, estimateRadius(geometry, y), (mesh) => {
      mesh.position.set(0, y, side === 'front' ? surfaceZ + DECAL_LIFT : surfaceZ - DECAL_LIFT)
      mesh.rotation.y = side === 'back' ? Math.PI : 0
    })
  })

  // Sleeve print (both flanks), curved onto the arm along ±X.
  const sleeveCanvas = await renderSide(design, 'sleeve')
  if (sleeveCanvas) {
    const sz = getAreaSizeIn(design, 'sleeve')
    const sl = calib.sleeve
    const tex = canvasTexture(sleeveCanvas)
    disposables.push(tex)
    for (const sign of [-1, 1] as const) {
      const surfaceX = probeSurfaceX(geometry, sl.yIn, 0, sign)
      addCurvedDecal(
        sleeveCanvas,
        sz,
        Math.max(3, sz.wIn),
        (mesh) => {
          mesh.position.set(surfaceX + sign * DECAL_LIFT, sl.yIn, 0)
          mesh.rotation.y = (sign * Math.PI) / 2
          mesh.rotation.z = sign * sl.rotZ
        },
        tex,
      )
    }
  }

  // Ground: hem sits on the floor (geometry is centred, so lift by half-height).
  figure.position.y = -(geometry.boundingBox as THREE.Box3).min.y
  return { figure, disposables }
}

// ---------------------------------------------------------------- mannequin (custom)

async function buildMannequinFigure(
  design: Design,
  gender: Gender,
): Promise<{ figure: THREE.Group; disposables: Disposable[] }> {
  const man = buildMannequin(gender)
  man.shirtMaterial.color.set('#eceef2')

  const figure = new THREE.Group()
  figure.add(man.group)
  const disposables: Disposable[] = [man]

  const sides: MannequinSide[] = ['front', 'back']
  const canvases = await Promise.all(sides.map((s) => renderSide(design, s)))
  sides.forEach((side, i) => {
    const canvas = canvases[i]
    if (!canvas) return
    const a = man.anchors[side]
    const sizeIn = getAreaSizeIn(design, side)
    const geo = makeCurvedDecal(sizeIn.wIn, sizeIn.hIn, a.radius)
    const tex = canvasTexture(canvas)
    const mat = decalMaterial(tex)
    disposables.push(geo, tex, mat)
    const mesh = new THREE.Mesh(geo, mat)
    const cy = a.topY - GAP_BELOW_COLLAR - sizeIn.hIn / 2
    mesh.position.set(0, cy, side === 'front' ? a.surfaceZ + DECAL_LIFT : -(a.surfaceZ + DECAL_LIFT))
    mesh.rotation.y = a.rotationY
    figure.add(mesh)
  })

  figure.position.y = -man.minY
  return { figure, disposables }
}

// ---------------------------------------------------------------- avatar (a real person wearing the garment)

/**
 * A realistic AI-generated figure already WEARING the garment (public/models/
 * avatar-*.glb — a single opaque textured mesh, the safest possible Scene Viewer
 * asset). The design is projected onto the chest/back with the same curved MASK
 * plane used everywhere else; the plane raycasts the actual torso so it conforms
 * to ANY body mesh. Life-size inches; grounded at y=0.
 */
const AVATAR = {
  tee: '/models/avatar-tee.glb',
  hoodie: '/models/avatar-hoodie.glb',
  custom: '/models/avatar-tee.glb',
  heightIn: 68, // normalise to a life-size figure
  chestFrac: 0.72, // front/back print CENTRE as a fraction of height from the floor
  printScale: 0.82, // the design print area is garment-sized; sit it on the chest
}

/**
 * Recolour the chroma-key garment to the studio colour. The mannequins are
 * generated wearing a VIVID GREEN garment; the body, trousers and the atlas
 * padding are all desaturated, so a saturation threshold isolates the garment —
 * sleeves and hood included — despite the fragmented Meshy UV atlas and baked
 * shading. Each garment texel becomes the target colour scaled by its own
 * brightness, so folds and highlights survive.
 */
function recolorGarment(canvas: HTMLCanvasElement, hex: string): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const col = new THREE.Color(hex)
  const tr = col.r * 255
  const tg = col.g * 255
  const tb = col.b * 255
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i]
    const g = d[i + 1]
    const b = d[i + 2]
    const max = Math.max(r, g, b)
    // green-DOMINANT ⇒ garment fabric. Catches the vivid green AND the desaturated
    // green fringe blended into the collar/sleeve edges, while neutral gray (body,
    // trousers, atlas padding: g≈r≈b) and warm tones stay untouched.
    if (g > r + 10 && g > b + 10 && max > 40) {
      // fold shading from the source brightness, floored so dark studio colours
      // (navy, forest) stay recognisable instead of collapsing toward black.
      const shade = Math.max(0.45, Math.min(1.12, (max / 255) * 1.35))
      d[i] = Math.min(255, tr * shade)
      d[i + 1] = Math.min(255, tg * shade)
      d[i + 2] = Math.min(255, tb * shade)
    }
  }
  ctx.putImageData(img, 0, 0)
}

/** Draw the avatar's baked texture to a POT canvas, recolour the garment to the
 *  studio colour, and return a Filament/USDZ-safe texture (flipY matches glTF). */
function buildGarmentTexture(map: THREE.Texture, hex: string): THREE.Texture {
  const img = map.image as { width?: number; height?: number } | undefined
  const w = Math.min(MAX_TEX, nearestPow2(img?.width || 2048))
  const h = Math.min(MAX_TEX, nearestPow2(img?.height || 2048))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (ctx && img) ctx.drawImage(img as CanvasImageSource, 0, 0, w, h)
  recolorGarment(c, hex)
  const tex = new THREE.CanvasTexture(c)
  tex.flipY = map.flipY // glTF textures are flipY=false; a CanvasTexture defaults true
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  tex.needsUpdate = true
  return tex
}

async function buildAvatarFigure(design: Design): Promise<{ figure: THREE.Group; disposables: Disposable[] }> {
  const url = AVATAR[design.garmentId]
  const gltf = await new GLTFLoader().loadAsync(url)
  gltf.scene.updateMatrixWorld(true)
  const src = firstMesh(gltf.scene)
  if (!src) throw new Error(`No mesh in ${url}`)

  const geometry = src.geometry.clone()
  geometry.applyMatrix4(src.matrixWorld)
  geometry.computeBoundingBox()
  const box = geometry.boundingBox as THREE.Box3
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  // centre X/Z, plant feet at y=0, uniformly scale to a life-size height.
  geometry.translate(-center.x, -box.min.y, -center.z)
  geometry.scale(AVATAR.heightIn / size.y, AVATAR.heightIn / size.y, AVATAR.heightIn / size.y)
  geometry.computeBoundingBox()

  sanitizeGarmentGeometry(geometry, true) // keep uv — the avatar is textured
  const srcMat = (Array.isArray(src.material) ? src.material[0] : src.material) as THREE.MeshStandardMaterial
  const baseMap = srcMat.map ? buildGarmentTexture(srcMat.map, garmentColorHex(design)) : null
  const material = new THREE.MeshStandardMaterial({ map: baseMap, color: 0xffffff, roughness: 0.92, metalness: 0 })
  const avatarMesh = new THREE.Mesh(geometry, material)
  avatarMesh.updateMatrixWorld(true)

  const figure = new THREE.Group()
  figure.add(avatarMesh)
  const disposables: Disposable[] = [geometry, material]
  if (baseMap) disposables.push(baseMap)

  const chestY = AVATAR.heightIn * AVATAR.chestFrac
  const sides: Side[] = ['front', 'back']
  const canvases = await Promise.all(sides.map((s) => renderSide(design, s)))
  sides.forEach((side, i) => {
    const canvas = canvases[i]
    if (!canvas) return
    const a = getAreaSizeIn(design, side)
    const surfaceZ = probeSurfaceZ(geometry, 0, chestY, side)
    const geo = makeCurvedDecal(a.wIn * AVATAR.printScale, a.hIn * AVATAR.printScale, estimateRadius(geometry, chestY))
    const tex = canvasTexture(canvas)
    const mat = decalMaterial(tex)
    disposables.push(geo, tex, mat)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(0, chestY, side === 'front' ? surfaceZ + DECAL_LIFT : surfaceZ - DECAL_LIFT)
    mesh.rotation.y = side === 'back' ? Math.PI : 0
    figure.add(mesh)
  })

  figure.position.y = -(geometry.boundingBox as THREE.Box3).min.y
  return { figure, disposables }
}

/**
 * Build the design → AR model (GLB + USDZ + poster). Primary path: a realistic
 * figure WEARING the garment (buildAvatarFigure). If the avatar asset can't load
 * we degrade gracefully to the garment-mesh (catalog) / mannequin (custom) path.
 * The whole scene is scaled inches→metres so it's life-size in AR.
 */
export async function buildArModel(design: Design, gender: Gender): Promise<ArModelBlobs> {
  let built: { figure: THREE.Group; disposables: Disposable[] }
  try {
    built = await buildAvatarFigure(design)
  } catch {
    built =
      design.garmentId === 'custom'
        ? await buildMannequinFigure(design, gender)
        : await buildCatalogFigure(design, design.garmentId)
  }
  const { figure, disposables } = built

  const root = new THREE.Group()
  root.add(figure)
  // Inches → metres (both GLB and USDZ declare metres). One uniform scale fixes
  // both; USDZExporter hardcodes metersPerUnit=1 so there is NO extra ×100.
  root.scale.setScalar(INCH_TO_M)
  root.updateMatrixWorld(true)
  // Re-plant feet on the floor (y=0) after scaling, using world-space bounds.
  const grounded = new THREE.Box3().setFromObject(root)
  root.position.y -= grounded.min.y
  root.updateMatrixWorld(true)

  try {
    const glbData = (await new GLTFExporter().parseAsync(root, {
      binary: true,
      embedImages: true,
      onlyVisible: true,
    })) as ArrayBuffer

    const usdzData = await new USDZExporter().parseAsync(root, {
      maxTextureSize: MAX_TEX,
      quickLookCompatible: true,
    })

    const posterSide: Side = sideLayers(design, 'front').length ? 'front' : 'back'
    const poster = await renderMockup(design, posterSide, 720).then((c) => canvasToBlob(c))

    return {
      glb: new Blob([glbData], { type: 'model/gltf-binary' }),
      usdz: new Blob([usdzData as BlobPart], { type: 'model/vnd.usdz+zip' }),
      poster,
    }
  } finally {
    for (const d of disposables) d.dispose()
  }
}

/**
 * Upload the model blobs to the AR blob store (Cloudflare Worker → R2) and
 * return the short id. Throws when the backend isn't reachable (e.g. plain
 * `vite dev` with no Worker) so the caller can show a helpful message.
 */
export async function uploadArModel(blobs: ArModelBlobs): Promise<string> {
  const form = new FormData()
  form.append('glb', blobs.glb, 'model.glb')
  form.append('usdz', blobs.usdz, 'model.usdz')
  form.append('poster', blobs.poster, 'poster.png')
  const res = await fetch('/api/ar', { method: 'POST', body: form })
  if (!res.ok) throw new Error(`AR upload failed (${res.status})`)
  const data = (await res.json()) as { id?: string }
  if (!data.id) throw new Error('AR upload returned no id')
  return data.id
}
