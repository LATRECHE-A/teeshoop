/**
 * Bake the current design into the two model formats native mobile AR needs:
 *   • GLB  → Android Scene Viewer (and WebXR)
 *   • USDZ → iOS Quick Look
 *
 * Runs entirely in the browser. Catalog garments (tee / hoodie) reuse the SAME
 * realistic GLB meshes as the studio 3D preview (public/models/*.glb); custom
 * (ship-your-own) garments get a procedural mannequin. The design goes on as
 * low-poly INDEXED planes (NOT three's DecalGeometry, whose non-indexed
 * projected primitives + >2 transparent materials are rejected by Android Scene
 * Viewer / Filament, see docs). Decals come from the shared renderer
 * (renderPrintArea), so vector AND photo designs work.
 *
 * Front/back prints on a torso are built by src/three/decalGeom.ts from the SAME
 * fabric unwrap the 3D preview uses: every grid vertex is placed on the true
 * surface at its true arc distance from the centre front, so AR, the preview and
 * the 2D editor agree by construction rather than by three hand-tuned copies.
 * Everything else (sleeves, mannequin, custom card) keeps the arc-length curved
 * plane, which is right for a tube on its own axis.
 *
 * Scene-Viewer / Quick-Look hard rules honoured here (verified against Google's
 * Scene Viewer requirements + three r185 exporter source):
 *   - 1 glTF/USDZ unit = 1 METRE. Geometry is authored in inches, so the whole
 *     export root is scaled by 0.0254 → life-size (~1.7 m), identical in both
 *     formats (three's USDZExporter hardcodes metersPerUnit=1, so NO extra ×100).
 *   - Decals are alphaMode MASK (transparent:false + alphaTest), which is
 *     order-independent and does NOT count against the "max 2 alpha materials"
 *     budget, so front + back + both sleeves all coexist safely.
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
import type { CatalogGarmentId, Design, Gender, Side } from '@/lib/types'
import { areaOffsetYIn, garmentColorHex, getAreaSizeIn, renderMockup, renderPrintArea, sideLayers } from '@/lib/renderDesign'
import { DEFAULT_SIZE, type SizeId } from '@/content/sizeChart'
import { printScaleK } from '@/lib/printScale'
import { canvasToBlob } from '@/lib/download'
import { acceptedImage } from '../../worker/containers'
import { registerBackPanel } from '@/lib/backRegister'
import { buildDelitMaps, buildInflatedShell, canvasToSilhouette } from '@/lib/silhouette'
import { GARMENTS } from '@/garments'
import { CALIBRATION } from '@/three/calibration'
import { buildFabricDecal, makeCurvedDecal } from '@/three/decalGeom'
import { arcAt, getArcTable } from '@/three/fabricUnwrap'
import { armProfile, buildGarmentFrame, fabricFrameFor, printCentreYIn } from '@/three/garmentFrame'
import { buildMannequin, type MannequinSide } from '@/three/mannequin'
import { canvasTexture, MAX_TEX, nearestPow2, potCanvas } from '@/three/arTexture'
import { garmentTint } from '@/three/garmentTint'

// Author decals at a power of two so potCanvas keeps full resolution (1400 was
// silently snapped down to 1024). Sleeves stay 1024 to bound texture memory.
const TARGET_PX = 2048 // main-decal render density
const SLEEVE_TARGET_PX = 1024
const GAP_BELOW_COLLAR = 2.6 // in, mannequin print top under the neckline
const DECAL_LIFT = 0.22 // in, above the fabric surface (geometric; replaces polygonOffset)
const DECAL_BEND_MAX = THREE.MathUtils.degToRad(58)
const INCH_TO_M = 0.0254 // glTF + USDZ are metres; author in inches, scale root once.

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

/**
 * Print material: alphaMode MASK. transparent:false + alphaTest makes the
 * exporter emit MASK (not BLEND), which writes depth, sorts order-independently
 * and is exempt from Scene Viewer's "max 2 alpha materials" limit, the reason a
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

/**
 * Bake one side's print. AR is a physical-output path, so it always renders at
 * a SIZE: the print area and the artwork in it are graded together
 * (src/lib/printScale.ts), so the AR garment carries the same print the buyer
 * of that size receives. A 3XL's is genuinely bigger than an S's.
 */
async function renderSide(
  design: Design,
  side: Side,
  size?: SizeId,
): Promise<HTMLCanvasElement | null> {
  if (sideLayers(design, side).length === 0) return null
  const area = getAreaSizeIn(design, side, size)
  const target = side === 'sleeve' ? SLEEVE_TARGET_PX : TARGET_PX
  const ppi = target / Math.max(area.wIn, area.hIn)
  return renderPrintArea(design, side, ppi, size).catch(() => null)
}

/** Arc-length-preserving curved plane (src/three/decalGeom.ts), bend-capped. */
const curvedDecal = (wIn: number, hIn: number, radius: number): THREE.PlaneGeometry =>
  makeCurvedDecal(wIn, hIn, radius, DECAL_BEND_MAX)

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

/** Strip vertex attributes Scene Viewer/Filament doesn't need and that can carry
 *  hazards (a stray skin/morph/tangent set on a plain Mesh is invalid glTF). */
function sanitizeGarmentGeometry(geometry: THREE.BufferGeometry, keepUV: boolean): void {
  const drop = ['uv1', 'uv2', 'uv3', 'tangent', 'color', 'skinIndex', 'skinWeight']
  if (!keepUV) drop.push('uv')
  for (const a of drop) geometry.deleteAttribute(a)
  geometry.morphAttributes = {}
}

/**
 * Build a realistic catalog garment (tee/hoodie) with the design on it.
 * Normalization and print placement come from src/three/garmentFrame.ts (the
 * SAME code the studio preview runs), so the AR garment is the preview garment
 * at life size. Front/back prints are fabric-space grids (true arc length, no
 * projector, no clipping); the sleeve keeps the curved plane because an arm is
 * a tube on its own slanted axis, which the torso unwrap does not describe.
 */
async function buildCatalogFigure(
  design: Design,
  garment: CatalogGarmentId,
  sizeId: SizeId,
): Promise<{ figure: THREE.Group; disposables: Disposable[] }> {
  const calib = CALIBRATION[garment]
  const gltf = await new GLTFLoader().loadAsync(modelUrl(calib.url))
  gltf.scene.updateMatrixWorld(true)
  const src = firstMesh(gltf.scene, calib.meshName) ?? firstMesh(gltf.scene)
  if (!src) throw new Error(`No mesh in ${calib.url}`)

  const frame = buildGarmentFrame(garment, src, sizeId)
  const geometry = frame.geometry

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

  // Front / back prints: one grid vertex per fabric sample, on the real surface.
  const k = printScaleK(design, sizeId)
  const sides = ['front', 'back'] as const
  const canvases = await Promise.all(sides.map((s) => renderSide(design, s, sizeId)))
  sides.forEach((side, i) => {
    const canvas = canvases[i]
    if (!canvas) return
    const area = getAreaSizeIn(design, side, sizeId)
    const texture = canvasTexture(canvas)
    const mat = decalMaterial(texture)
    const geo = frame.table.usable
      ? buildFabricDecal(fabricFrameFor(garment, side, frame, area.wIn, area.hIn, k), DECAL_LIFT)
      : curvedDecal(area.wIn, area.hIn, estimateRadius(geometry, printCentreYIn(garment, side, frame, k)))
    const mesh = new THREE.Mesh(geo, mat)
    if (!frame.table.usable) {
      const y = printCentreYIn(garment, side, frame, k)
      const surfaceZ = probeSurfaceZ(geometry, 0, y, side)
      mesh.position.set(0, y, side === 'front' ? surfaceZ + DECAL_LIFT : surfaceZ - DECAL_LIFT)
      mesh.rotation.y = side === 'back' ? Math.PI : 0
    }
    disposables.push(geo, texture, mat)
    figure.add(mesh)
  })

  // Sleeve print (both flanks), curved onto the arm along ±X.
  const sleeveCanvas = await renderSide(design, 'sleeve', sizeId)
  if (sleeveCanvas) {
    const sz = getAreaSizeIn(design, 'sleeve', sizeId)
    const sleeveY = calib.sleeve.yRaw * frame.yScale
    const tex = canvasTexture(sleeveCanvas)
    disposables.push(tex)
    for (const sign of [-1, 1] as const) {
      // The arm, measured: the same profile the preview places its sleeve
      // projector from (src/three/garmentFrame.ts). A curved plane cannot be
      // clipped the way a projector box can, so AR never lost the outboard part
      // of the print; what it DID share is the z = 0 assumption, and an A-pose
      // arm's centre is 1.0-1.4 in forward of the garment's mid-plane. Pinning
      // the plane to z = 0 therefore hung the print a third of its own width off
      // the sleeve, on the phone and on the desktop alike.
      const arm = armProfile(geometry, sleeveY, sign, frame.depthIn / 2)
      const geo = curvedDecal(sz.wIn, sz.hIn, Math.max(3, sz.wIn))
      const mat = decalMaterial(tex)
      disposables.push(geo, mat)
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(arm.crownX + sign * DECAL_LIFT, sleeveY, arm.centreZ)
      mesh.rotation.y = (sign * Math.PI) / 2
      mesh.rotation.z = sign * calib.sleeve.rotZ
      figure.add(mesh)
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
  sizeId?: SizeId,
): Promise<{ figure: THREE.Group; disposables: Disposable[] }> {
  const man = buildMannequin(gender)
  man.shirtMaterial.color.set('#eceef2')

  const figure = new THREE.Group()
  figure.add(man.group)
  const disposables: Disposable[] = [man]

  const sides: MannequinSide[] = ['front', 'back']
  const canvases = await Promise.all(sides.map((s) => renderSide(design, s, sizeId)))
  sides.forEach((side, i) => {
    const canvas = canvases[i]
    if (!canvas) return
    const a = man.anchors[side]
    const sizeIn = getAreaSizeIn(design, side, sizeId)
    const geo = curvedDecal(sizeIn.wIn, sizeIn.hIn, a.radius)
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
 * avatar-*.glb, a single opaque textured mesh, the safest possible Scene Viewer
 * asset). The design is projected onto the chest/back with the same curved MASK
 * plane used everywhere else; the plane raycasts the actual torso so it conforms
 * to ANY body mesh. Life-size inches; grounded at y=0.
 *
 * Per gender × catalog garment. The neutral matte-gray male + female mannequins
 * are generated wearing a chroma-key green garment, recoloured at bake time.
 */
const AVATAR_URL: Record<Gender, Record<CatalogGarmentId, string>> = {
  male: { tee: '/models/avatar-tee.glb', hoodie: '/models/avatar-hoodie.glb' },
  female: { tee: '/models/avatar-tee-female.glb', hoodie: '/models/avatar-hoodie-female.glb' },
}

/**
 * Où sont servis les avatars, quand ce n'est pas sur cette origine.
 *
 * MÊME FORME ET MÊME RAISON QUE `ArUploadOptions` et que la base d'actifs du
 * détourage. Depuis le 5 septembre 2026 la boutique WordPress construit ce
 * modèle dans sa propre page, et les GLB vivent sur le Worker : sans base, le
 * chargeur demande `/models/avatar-tee.glb` à WordPress, reçoit une 404, et le
 * bouton d'essayage n'apparaît jamais. Mesuré, deux 404 et un aperçu vide.
 *
 * Vide veut dire « ici », ce qui est le studio, servi par le Worker.
 */
let avatarBase = ''

/** Poser la base des avatars. Sans effet sur un modèle déjà construit. */
export function configureArAssets(base: string): void {
  avatarBase = (base ?? '').replace(/\/+$/, '')
}

/**
 * L'adresse d'un modèle, TOUJOURS par la base (STU-12). Seuls les avatars la
 * prenaient : le repli sur le vêtement seul et l'avatar du vêtement personnel
 * demandaient `/models/…` à WordPress, 404, et le client lisait « le modèle
 * n'a pas pu être construit » là où le repli existait pour lui.
 */
function modelUrl(path: string): string {
  return path.startsWith('/') ? `${avatarBase}${path}` : path
}

const AVATAR = {
  heightIn: 68, // normalise to a life-size figure
  // Usable flat front width as a fraction of the torso's full width: the print
  // is drawn at its TRUE inch size and only shrinks if it would overhang this.
  frontArcFrac: 0.9,
  sleeveFrac: 0.75, // upper-arm height for the sleeve print
  /** Height window (fraction of figure height, from the crown) that is chest. */
  chestBandFromTop: [0.22, 0.3] as const,
  /** Share of the torso's front half-arc a print may occupy and still be
   *  wrapped exactly. Beyond it the arms crowd the unwrap and the curved-plane
   *  fallback (with its documented shrink) is the honest answer. */
  wrapLimit: 0.86,
}

/**
 * The worn garment's VISUAL centre as a fraction of body height, per gender ×
 * garment: MEASURED from each avatar GLB's garment band (chroma-key green
 * vertex scan, collar/hem percentiles). Front/back prints sit at this centre ∓
 * the SHARED areaOffsetYIn, so they land at the SAME garment-relative height as
 * the 2D editor and 3D preview. Replaces the single 0.72 guess, which sat ~3in
 * too high and crowded the print into the collar.
 */
const GARMENT_CENTER_FRAC: Record<Gender, Record<CatalogGarmentId, number>> = {
  male: { tee: 0.676, hoodie: 0.688 },
  female: { tee: 0.666, hoodie: 0.666 },
}

/**
 * Recolour the chroma-key garment to the studio colour. The mannequins are
 * generated wearing a VIVID GREEN garment; the body, trousers and the atlas
 * padding are all desaturated, so a saturation threshold isolates the garment
 * (sleeves and hood included) despite the fragmented Meshy UV atlas and baked
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

async function buildAvatarFigure(
  design: Design,
  garment: CatalogGarmentId,
  gender: Gender,
  sizeId: SizeId,
): Promise<{ figure: THREE.Group; disposables: Disposable[] }> {
  const url = modelUrl(AVATAR_URL[gender][garment])
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
  //
  // KNOWN LIMIT: the avatar does NOT grade with size. The GLB bakes body and
  // garment into a single mesh at one body size, so a bigger garment cannot be
  // shown without also resizing the person. Scaling girth (X/Z) by the chest
  // ratio was tried and rejected: it widens head, arms and legs by the same
  // factor, which reads as a caricature rather than a larger wearer, and it
  // degraded cross-view vertical parity. Consequence: at sizes far from the
  // base the graded print can exceed the torso arc and the `fit` clamp below
  // shrinks it, so AR under-shows grading. The 2D editor, the 3D preview and
  // the exported transfer are the dimensional sources of truth; fixing AR
  // properly needs per-size avatars, or a GLB with body and garment split.
  geometry.translate(-center.x, -box.min.y, -center.z)
  geometry.scale(AVATAR.heightIn / size.y, AVATAR.heightIn / size.y, AVATAR.heightIn / size.y)
  geometry.computeBoundingBox()

  sanitizeGarmentGeometry(geometry, true) // keep uv: the avatar is textured
  const srcMat = (Array.isArray(src.material) ? src.material[0] : src.material) as THREE.MeshStandardMaterial
  const baseMap = srcMat.map ? buildGarmentTexture(srcMat.map, garmentColorHex(design)) : null
  const material = new THREE.MeshStandardMaterial({ map: baseMap, color: 0xffffff, roughness: 0.92, metalness: 0 })
  const avatarMesh = new THREE.Mesh(geometry, material)
  avatarMesh.updateMatrixWorld(true)

  const figure = new THREE.Group()
  figure.add(avatarMesh)
  const disposables: Disposable[] = [geometry, material]
  if (baseMap) disposables.push(baseMap)

  // The garment's 2D-art centre maps to this absolute height on the figure,
  // measured per (gender, garment) so the print lands mid-chest, not at the neck.
  const garmentCenterY = AVATAR.heightIn * GARMENT_CENTER_FRAC[gender][garment]

  // The avatar body is a garment surface too: unwrap it and place the print by
  // arc length, exactly like the catalog mesh and the studio preview. It falls
  // back to the curved plane when the body cannot be unwrapped cleanly, or when
  // the print is so wide it would reach round to the arms (see
  // AVATAR.wrapLimit), the case the `fit` shrink below exists for.
  const table = getArcTable(url, geometry, AVATAR.chestBandFromTop)

  // Front / back: TRUE inch size, placed per-side at garmentCentre ∓
  // areaOffsetYIn so the worn print matches the 2D editor and the 3D preview
  // (back sits higher than front). Same math source as both.
  const k = printScaleK(design, sizeId)
  const sides = ['front', 'back'] as const
  const canvases = await Promise.all(sides.map((s) => renderSide(design, s, sizeId)))
  sides.forEach((side, i) => {
    const canvas = canvases[i]
    if (!canvas) return
    const a = getAreaSizeIn(design, side, sizeId)
    const y = garmentCenterY - areaOffsetYIn(garment, side, sizeId, k)
    const tex = canvasTexture(canvas)
    const mat = decalMaterial(tex)
    // Front half-arc of the body at the print row: s at θ = +90°.
    const halfArc = table.usable ? arcAt(table, 1, y, 0) : 0
    if (table.usable && a.wIn / 2 <= halfArc * AVATAR.wrapLimit) {
      const geo = buildFabricDecal(
        { table, side, xzScale: 1, yScale: 1, areaWIn: a.wIn, areaHIn: a.hIn, centreYIn: y },
        DECAL_LIFT,
      )
      disposables.push(geo, tex, mat)
      figure.add(new THREE.Mesh(geo, mat))
      return
    }
    const half = estimateRadius(geometry, y) // torso half-width at this height
    const fit = Math.min(1, (half * 2 * AVATAR.frontArcFrac) / Math.max(a.wIn, 1e-3))
    const surfaceZ = probeSurfaceZ(geometry, 0, y, side)
    const geo = curvedDecal(a.wIn * fit, a.hIn * fit, Math.max(3, half))
    disposables.push(geo, tex, mat)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(0, y, side === 'front' ? surfaceZ + DECAL_LIFT : surfaceZ - DECAL_LIFT)
    mesh.rotation.y = side === 'back' ? Math.PI : 0
    figure.add(mesh)
  })

  // Sleeve print (both arms) on the outer upper arm, parity with 2D/3D and the
  // catalog fallback, which the avatar path previously dropped entirely.
  const sleeveCanvas = await renderSide(design, 'sleeve', sizeId)
  if (sleeveCanvas) {
    const sz = getAreaSizeIn(design, 'sleeve', sizeId)
    const sleeveY = AVATAR.heightIn * AVATAR.sleeveFrac
    const tex = canvasTexture(sleeveCanvas)
    disposables.push(tex)
    for (const sign of [-1, 1] as const) {
      const surfaceX = probeSurfaceX(geometry, sleeveY, 0, sign)
      if (!Number.isFinite(surfaceX)) continue
      const geo = curvedDecal(sz.wIn, sz.hIn, Math.max(2, sz.wIn))
      const mat = decalMaterial(tex)
      disposables.push(geo, mat)
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(surfaceX + sign * DECAL_LIFT, sleeveY, 0)
      mesh.rotation.y = (sign * Math.PI) / 2
      figure.add(mesh)
    }
  }

  figure.position.y = -(geometry.boundingBox as THREE.Box3).min.y
  return { figure, disposables }
}

// ---------------------------------------------------------------- custom (ship-your-own)

/** Bottom-pad a canvas to a target height (content stays top-anchored). */
function padCanvasToHeight(src: HTMLCanvasElement, targetH: number): HTMLCanvasElement {
  if (src.height >= targetH) return src
  const c = document.createElement('canvas')
  c.width = src.width
  c.height = targetH
  const ctx = c.getContext('2d')
  if (ctx) ctx.drawImage(src, 0, 0)
  return c
}

/**
 * Multiply a garment's own occlusion map back into its albedo.
 *
 * The 3D preview keeps the two apart: albedo in `map`, occlusion in `aoMap`,
 * so three applies the second only to view-independent light. An exported GLB
 * has no such luxury: Scene Viewer and Quick Look each decide for themselves
 * what to do with an occlusion texture, and the one thing both honour is base
 * colour. Baking is lossy in exactly one way (the occlusion also dims the
 * direct light, where the preview would not) and correct in the way that
 * matters: the garment arrives on the phone with the form its photograph had.
 *
 * Returns the source untouched when there is nothing to bake, so the caller
 * never has to branch.
 */
function bakeOcclusion(
  albedo: HTMLCanvasElement,
  occlusion: HTMLCanvasElement | null | undefined,
): HTMLCanvasElement {
  if (!occlusion) return albedo
  const out = document.createElement('canvas')
  out.width = albedo.width
  out.height = albedo.height
  const ctx = out.getContext('2d')
  if (!ctx) return albedo
  ctx.drawImage(albedo, 0, 0)
  // `multiply` alone would also multiply the transparent surround toward black;
  // `destination-in` against the albedo restores the cutout's own alpha, which
  // is what the shell's alpha test and the rim's UV inset both rely on.
  ctx.globalCompositeOperation = 'multiply'
  ctx.drawImage(occlusion, 0, 0, out.width, out.height)
  ctx.globalCompositeOperation = 'destination-in'
  ctx.drawImage(albedo, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  return out
}

/**
 * Silhouette-shaped back cap when the customer supplied no back photo, flooded
 * with THE GARMENT'S OWN COLOUR, measured off the front (src/three/textures.ts
 * `garmentTint`), not assumed.
 *
 * This used to be a fixed dark slate, which is a fine colour for a navy tee and
 * a lie about a white polo or a red hoodie. It matters more in AR than anywhere
 * else: the customer walks around the garment, so the reverse is not a corner
 * case, it is half of what they came to look at.
 */
function blankBackCanvas(front: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = front.width
  c.height = front.height
  const ctx = c.getContext('2d')
  if (ctx) {
    ctx.drawImage(front, 0, 0)
    ctx.globalCompositeOperation = 'source-in' // keep the garment's own alpha shape
    ctx.fillStyle = garmentTint(front, '#242A33')
    ctx.fillRect(0, 0, c.width, c.height)
  }
  return c
}

// ---------------------------------------------------------------- custom, worn on the avatar

const CUSTOM_UNDERSHIRT_HEX = '#d3cec3' // neutral body/undershirt tone under the garment

/**
 * A garment-shaped plane that HUGS the avatar torso: a subdivided plane whose
 * every vertex is raycast onto the body surface (both the horizontal AND the
 * vertical curve), lifted just proud. Misses (the garment overhanging the torso)
 * fall back to the centre-column surface at that height, so the garment drapes
 * over the sides instead of clipping into the body or floating flat.
 */
function buildConformedDecal(
  wIn: number,
  hIn: number,
  cyIn: number,
  target: THREE.BufferGeometry,
  side: Side,
  liftIn: number,
): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(wIn, hIn, 24, 36)
  geo.translate(0, cyIn, 0)
  const pos = geo.attributes.position as THREE.BufferAttribute
  const mesh = new THREE.Mesh(target, PROBE_MATERIAL)
  const ray = new THREE.Raycaster()
  const sign = side === 'front' ? 1 : -1
  const box = target.boundingBox as THREE.Box3
  const fallbackZ = sign * Math.abs(box.max.z) * 0.55
  const probe = (x: number, y: number): number | null => {
    ray.set(new THREE.Vector3(x, y, sign * 1000), new THREE.Vector3(0, 0, -sign))
    const hits = ray.intersectObject(mesh, false)
    return hits.length ? hits[0].point.z : null
  }
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = probe(x, y) ?? probe(0, y) ?? fallbackZ
    pos.setZ(i, z + sign * liftIn)
  }
  pos.needsUpdate = true
  if (side === 'back') {
    // The plane winds +Z, so displacing only Z leaves the (single-sided) front
    // face pointing +Z (INTO the body), and the rear viewer sees a culled back
    // face. Reverse the triangle winding so the FrontSide points −Z (toward the
    // rear), and mirror the UVs (u→1−u) so the back print reads correctly from
    // behind, the parity the catalog/avatar decals get from rotation.y = π
    // (which we can't use here: the geometry already carries absolute −Z depth).
    const idx = geo.index
    if (idx) {
      const a = idx.array
      for (let i = 0; i < a.length; i += 3) {
        const t = a[i + 1]
        a[i + 1] = a[i + 2]
        a[i + 2] = t
      }
      idx.needsUpdate = true
    }
    const uv = geo.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i))
    uv.needsUpdate = true
  }
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}

/**
 * Central fraction of a laid-flat garment composite that is the BODY (not the
 * spread sleeves): body width (median of the lower rows = waist/hem) ÷ max width
 * (chest + sleeves). Cropping the decal to this drops the sleeves, which would
 * otherwise project as flat flaps off an arms-down body, so the avatar's own
 * neutral sleeves show there instead. ~1 for a sleeveless/rectangular upload.
 */
function bodyCropFraction(canvas: HTMLCanvasElement): number {
  const W = 120
  const H = Math.max(2, Math.round((canvas.height / canvas.width) * W))
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return 1
  ctx.drawImage(canvas, 0, 0, W, H)
  const d = ctx.getImageData(0, 0, W, H).data
  const widths: number[] = []
  let maxW = 0
  for (let y = 0; y < H; y++) {
    let lo = -1
    let hi = -1
    for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3] > 80) {
        if (lo < 0) lo = x
        hi = x
      }
    }
    const w = hi >= 0 ? hi - lo + 1 : 0
    widths.push(w)
    if (w > maxW) maxW = w
  }
  if (maxW <= 0) return 1
  const lower = widths.slice(Math.floor(H * 0.45)).filter((w) => w > 0).sort((a, b) => a - b)
  if (!lower.length) return 1
  const bodyW = lower[Math.floor(lower.length / 2)]
  return THREE.MathUtils.clamp((bodyW / maxW) * 1.12, 0.5, 1)
}

/**
 * The customer's OWN uploaded garment, WORN on a realistic avatar: the primary
 * custom AR path. The gendered avatar's own garment is recoloured to a neutral
 * undershirt tone (the "body"), and the uploaded garment (photo + design,
 * composited through the SHARED renderer) is projected onto the torso as a
 * body-conforming decal at its TRUE inch size, centred on the worn-garment band.
 * Outside the garment's silhouette the neutral body shows, so it reads as a
 * person wearing exactly the uploaded garment. Scene-Viewer-safe throughout.
 */
async function buildCustomAvatarFigure(
  design: Design,
  gender: Gender,
  sizeId?: SizeId,
): Promise<{ figure: THREE.Group; disposables: Disposable[] }> {
  const hasFront = !!design.custom?.front
  const hasBack = !!design.custom?.back
  if (!hasFront && !hasBack) throw new Error('custom garment has no sides')
  const widthIn = design.custom?.widthIn ?? 20

  const url = modelUrl(AVATAR_URL[gender].tee) // a generic body in a plain tee
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
  geometry.translate(-center.x, -box.min.y, -center.z)
  geometry.scale(AVATAR.heightIn / size.y, AVATAR.heightIn / size.y, AVATAR.heightIn / size.y)
  geometry.computeBoundingBox()

  sanitizeGarmentGeometry(geometry, true)
  const srcMat = (Array.isArray(src.material) ? src.material[0] : src.material) as THREE.MeshStandardMaterial
  const baseMap = srcMat.map ? buildGarmentTexture(srcMat.map, CUSTOM_UNDERSHIRT_HEX) : null
  const material = new THREE.MeshStandardMaterial({
    map: baseMap,
    color: baseMap ? 0xffffff : new THREE.Color(CUSTOM_UNDERSHIRT_HEX),
    roughness: 0.92,
    metalness: 0,
  })
  const avatarMesh = new THREE.Mesh(geometry, material)

  const figure = new THREE.Group()
  figure.add(avatarMesh)
  const disposables: Disposable[] = [geometry, material]
  if (baseMap) disposables.push(baseMap)

  // The uploaded garment's visual centre → the same worn band the catalog uses.
  const garmentCenterY = AVATAR.heightIn * GARMENT_CENTER_FRAC[gender].tee

  // Which composite faces forward vs back (a back-only upload faces forward).
  const plan: { side: Side; src: Side }[] = hasFront
    ? [{ side: 'front', src: 'front' }, ...(hasBack ? [{ side: 'back' as Side, src: 'back' as Side }] : [])]
    : [{ side: 'front', src: 'back' }]

  // Crop the sleeves once (from the forward composite) so they don't flap.
  // The composite is a physical output, so it bakes the GRADED print (the
  // uploaded garment photo keeps its own real widthIn: only the print grades).
  const firstCanvas = await renderMockup(design, plan[0].src, 1100, sizeId)
  const cropFrac = bodyCropFraction(firstCanvas)
  for (const { side, src: srcSide } of plan) {
    const canvas = srcSide === plan[0].src ? firstCanvas : await renderMockup(design, srcSide, 1100, sizeId)
    const gW = widthIn * cropFrac
    const gH = (widthIn * canvas.height) / canvas.width // height is unchanged by the horizontal crop
    let useCanvas = canvas
    if (cropFrac < 0.98) {
      const cw = Math.max(2, Math.round(canvas.width * cropFrac))
      const cx = Math.round((canvas.width - cw) / 2)
      const cc = document.createElement('canvas')
      cc.width = cw
      cc.height = canvas.height
      cc.getContext('2d')?.drawImage(canvas, cx, 0, cw, canvas.height, 0, 0, cw, canvas.height)
      useCanvas = cc
    }
    const geo = buildConformedDecal(gW, gH, garmentCenterY, geometry, side, DECAL_LIFT * 2)
    const tex = canvasTexture(useCanvas)
    const mat = decalMaterial(tex)
    disposables.push(geo, tex, mat)
    figure.add(new THREE.Mesh(geo, mat))
  }

  figure.position.y = -(geometry.boundingBox as THREE.Box3).min.y
  return { figure, disposables }
}

/**
 * The customer's OWN uploaded garment on its own (no body), the fallback when
 * the avatar can't load. It is the SAME shell the studio 3D preview builds
 * (silhouette.ts), from the same synchronous, deterministic code: the depth
 * comes from a shipped garment mesh graded onto the upload's silhouette, and
 * the garment family is resolved through the one shared slot
 * (garmentShape.resolveShape), so the customer's override moves both surfaces
 * at once and the two can never disagree about the shape of the same garment.
 * Falls back again to a curved card when the upload has no clean cutout, and
 * throws when there is no usable custom side.
 */
async function buildCustomFigure(
  design: Design,
  sizeId?: SizeId,
): Promise<{ figure: THREE.Group; disposables: Disposable[] }> {
  const widthIn = design.custom?.widthIn ?? 20
  const hasFront = !!design.custom?.front
  const hasBack = !!design.custom?.back
  const backGenerated = design.custom?.back?.origin === 'generated'
  if (!hasFront && !hasBack) throw new Error('custom garment has no sides')

  // Composite each supplied side (garment photo + design) through the SHARED
  // renderer, byte-identical to the studio 3D texture, so AR matches 3D.
  const frontSide = hasFront ? 'front' : 'back'
  let frontCanvas = await renderMockup(design, frontSide, 1100, sizeId)
  let backCanvas = hasFront && hasBack ? await renderMockup(design, 'back', 1100, sizeId) : null
  // The bare garment behind each composite. The shell measures its photometry
  // from this (CardSource.photo / buildInflatedShell's `opts.photo`) and the
  // measurement moves GEOMETRY (the photo's mid-frequency band is real Z
  // displacement), so AR must hand over exactly what the preview does or the
  // two stop being the same garment.
  let frontPhoto = await renderMockup(design, frontSide, 1100, sizeId, { artwork: false })
  let backPhoto = backCanvas ? await renderMockup(design, 'back', 1100, sizeId, { artwork: false }) : null
  // Register front & back so the back design maps onto the (front-derived)
  // shell, matching the studio 3D (Scene3D + ExtrudedGarment) EXACTLY: the pad
  // to a shared height first (which is what fixes hIn, and therefore GY and
  // therefore the geometry), then the reverse panel redrawn into the front's own
  // frame. The second step is what stops a differently-framed back photo landing
  // off its outline (see src/lib/backRegister.ts). It must happen here as well
  // as in the preview or the phone and the desktop show different garments.
  if (backCanvas) {
    const maxH = Math.max(frontCanvas.height, backCanvas.height)
    const minH = Math.min(frontCanvas.height, backCanvas.height)
    if (minH > 0 && maxH / minH <= 1.7) {
      frontCanvas = padCanvasToHeight(frontCanvas, maxH)
      backCanvas = padCanvasToHeight(backCanvas, maxH)
      frontPhoto = padCanvasToHeight(frontPhoto, maxH)
      if (backPhoto) backPhoto = padCanvasToHeight(backPhoto, maxH)
    }
    const registered = registerBackPanel(frontCanvas, backCanvas, backPhoto)
    // Null = the two photographs cannot be the same garment. Dropping the back
    // hands the reverse to `blankBackCanvas` below, which is the front's own
    // silhouette flooded with the garment's colour: right shape, right colour,
    // no smear.
    backCanvas = registered?.canvas ?? null
    backPhoto = registered?.photo ?? null
  }
  const wIn = widthIn
  const hIn = (widthIn * frontCanvas.height) / frontCanvas.width

  const figure = new THREE.Group()
  const disposables: Disposable[] = []

  const sil = canvasToSilhouette(frontCanvas, wIn, hIn)
  const shell = sil ? buildInflatedShell(frontCanvas, sil, wIn, hIn, { photo: frontPhoto, shape: design.custom?.shape }) : null

  if (shell) {
    sanitizeGarmentGeometry(shell.front, true)
    sanitizeGarmentGeometry(shell.back, true)
    // De-lit albedo, exactly as the studio preview samples it: the photo's own
    // lightbox HIGHLIGHT is divided out so Scene Viewer's / Quick Look's
    // lighting is the only lighting, and a highlight that stays put while the
    // phone moves (the strongest "this is a picture, not an object" cue there
    // is) cannot happen. Falls back to the raw composite when the photo was
    // already flat.
    //
    // …with the occlusion half of that same correction multiplied straight back
    // in. The preview binds it as an aoMap; a GLB headed for Scene Viewer /
    // Quick Look cannot rely on one being honoured, and vertex colours are
    // stripped here anyway (sanitizeGarmentGeometry), so it is baked into the
    // base colour instead. Without this the phone shows a flat cutout of the
    // garment the desktop shows with its own form: the same divergence, in the
    // one place the customer is most likely to notice it.
    const frontTex = canvasTexture(bakeOcclusion(shell.albedoCanvas ?? frontCanvas, shell.occlusionCanvas))
    const frontMat = decalMaterial(frontTex)
    figure.add(new THREE.Mesh(shell.front, frontMat))
    disposables.push(shell.front, frontTex, frontMat)

    // Fallback base for the reverse when the customer supplied no back shot.
    // (Named apart from `backPhoto`, which is the BARE back: the photometric
    // reference, not a substitute picture.)
    const backBase = backCanvas ?? blankBackCanvas(frontCanvas)
    // A GENERATED back is a reconstruction, not a photograph: ingest mirrors the
    // front's silhouette and floods it with the garment colour, so there is no
    // lightbox gradient to divide out, and running the correction anyway would
    // work on the baked "APERÇU · PREVIEW" mark, the one thing in those pixels
    // that does vary. Same decision the studio preview makes.
    const backMaps =
      backCanvas && !backGenerated
        ? buildDelitMaps(backCanvas, backPhoto)
        : { albedo: null, occlusion: null }
    const backTex = canvasTexture(bakeOcclusion(backMaps.albedo ?? backBase, backMaps.occlusion))
    const backMat = decalMaterial(backTex)
    figure.add(new THREE.Mesh(shell.back, backMat))
    disposables.push(shell.back, backTex, backMat)

    // Interior linings (hollow read through the neck/hem in AR too): darkened
    // copies of each panel facing inward. Same textures, tinted material:
    // #adadad is the sRGB hex whose linear value ≈0.42 (the lining multiply).
    // alphaMode MASK keeps them exempt from Scene Viewer's alpha budget.
    const addLining = (geo: THREE.BufferGeometry | undefined, tex: THREE.Texture) => {
      if (!geo) return
      sanitizeGarmentGeometry(geo, true)
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        color: 0xadadad,
        roughness: 0.95,
        metalness: 0,
        transparent: false,
        alphaTest: 0.5,
        side: THREE.FrontSide,
      })
      figure.add(new THREE.Mesh(geo, mat))
      disposables.push(geo, mat)
    }
    addLining(shell.liningFront, frontTex)
    addLining(shell.liningBack, backTex)

    // Cloth thickness at every alpha cut: the rim strip that closes the outer
    // seam and rolls the collar/armhole edges. It reuses the sheets' TEXTURES,
    // so no new image reaches the GLB and the POT/≤2048 checks are untouched,
    // and it is indexed like every other primitive here.
    //
    // It gets its own material for one reason: IT MUST NOT BE ALPHA-TESTED. The
    // rim is not a surface with a cut in it, it IS the cut, welded to the
    // isoline the sheets' alpha makes, so every fragment of it is cloth by
    // construction. decalMaterial's alphaTest deletes it instead of shading it:
    // all of a crossing's rings share one uv, so the ribbon has no across-width
    // texture derivative and samples the matte at a mip where its edge is a
    // whole texel wide. Measured in the ID probe, that left the darkened lining
    // rather than the rim filling 48–84 % of the seam's scanlines. alphaMode
    // OPAQUE is exempt from Scene Viewer's 2-alpha cap, which counts BLEND.
    for (const [geo, tex] of [
      [shell.rimFront, frontTex],
      [shell.rimBack, backTex],
    ] as const) {
      if (!geo) continue
      sanitizeGarmentGeometry(geo, true)
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        transparent: false,
        roughness: 0.85,
        metalness: 0,
        side: THREE.FrontSide,
      })
      figure.add(new THREE.Mesh(geo, mat))
      disposables.push(geo, mat)
    }

    for (const plane of [shell.interior, shell.interiorFront]) {
      if (!plane) continue
      const intMat = new THREE.MeshStandardMaterial({
        color: 0x14181f,
        roughness: 0.95,
        metalness: 0,
        // Single-sided, like the preview (ExtrudedGarment): each plane sits
        // deep inside its own dome, so double-siding it would occlude most of
        // the garment sheet from the side it is meant to be invisible on.
        side: THREE.FrontSide,
      })
      figure.add(new THREE.Mesh(plane, intMat))
      disposables.push(plane, intMat)
    }
  } else {
    // No clean cutout: a gently curved double-sided card with the composite.
    const frontTex = canvasTexture(frontCanvas)
    const geoF = curvedDecal(wIn, hIn, wIn * 1.4)
    const matF = decalMaterial(frontTex)
    figure.add(new THREE.Mesh(geoF, matF))
    disposables.push(geoF, frontTex, matF)

    const backSrc = backCanvas ?? blankBackCanvas(frontCanvas)
    const backTex = canvasTexture(backSrc)
    const geoB = curvedDecal(wIn, hIn, wIn * 1.4)
    const matB = decalMaterial(backTex)
    const meshB = new THREE.Mesh(geoB, matB)
    meshB.rotation.y = Math.PI
    figure.add(meshB)
    disposables.push(geoB, backTex, matB)
  }

  // Ground the garment (hem at y=0) using world bounds.
  figure.updateMatrixWorld(true)
  const grounded = new THREE.Box3().setFromObject(figure)
  figure.position.y = -grounded.min.y
  return { figure, disposables }
}

/**
 * Build the design → AR model (GLB + USDZ + poster). Primary path: a realistic
 * figure WEARING the garment (buildAvatarFigure). If the avatar asset can't load
 * we degrade gracefully to the garment-mesh (catalog) / mannequin (custom) path.
 * The whole scene is scaled inches→metres so it's life-size in AR.
 */
export async function buildArModel(
  design: Design,
  gender: Gender,
  sizeId: SizeId = DEFAULT_SIZE,
): Promise<ArModelBlobs> {
  let built: { figure: THREE.Group; disposables: Disposable[] }
  if (design.garmentId === 'custom') {
    // Custom (ship-your-own): the customer's ACTUAL uploaded garment WORN on a
    // realistic male/female avatar. Degrade to the bare inflated shell, then the
    // procedural mannequin, if the avatar / cutout can't be built. (Custom
    // garments carry their own real widthIn: sizeId only grades the PRINT, and
    // only when the upload carries a half-chest chart.)
    try {
      built = await buildCustomAvatarFigure(design, gender, sizeId)
    } catch {
      try {
        built = await buildCustomFigure(design, sizeId)
      } catch {
        built = await buildMannequinFigure(design, gender, sizeId)
      }
    }
  } else {
    // Catalog (tee/hoodie): a gendered figure wearing the garment; fall back to
    // the garment-mesh figure if the avatar GLB can't load.
    const garment = design.garmentId
    try {
      built = await buildAvatarFigure(design, garment, gender, sizeId)
    } catch {
      built = await buildCatalogFigure(design, garment, sizeId)
    }
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

    // Poster (QR-page thumbnail): the real garment mockup. For custom, prefer
    // the side that actually has an uploaded photo.
    const posterSide: Side =
      design.garmentId === 'custom'
        ? design.custom?.front
          ? 'front'
          : 'back'
        : sideLayers(design, 'front').length
          ? 'front'
          : 'back'
    const drawn = new Uint8Array(await (await renderMockup(design, posterSide, 720, sizeId).then((c) => canvasToBlob(c))).arrayBuffer())
    // The Worker refuses a PNG chunk it does not know (SEC-02); an engine that
    // writes one gets it left out here, losslessly, rather than a 415.
    const poster = new Blob([(acceptedImage(drawn) ?? drawn) as BlobPart], { type: 'image/png' })

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
 * Where `POST /api/ar` lives when it is not on this page's own origin.
 *
 * THE SAME SHAPE AS `UploadOptions` IN `src/lib/teeshoop/upload.ts`, and for the
 * same reason: the studio is served by the Worker, so its fetch is same-origin
 * and no browser ever asks for a CORS header, while the shop's product page is a
 * different origin. Passed rather than set on a module variable, because a
 * module-level setting is a setting one caller can change under another.
 */
export interface ArUploadOptions {
  /** Origin (and optional path prefix) the AR route is served from. */
  endpoint?: string
}

/**
 * Upload the model blobs to the AR blob store (Cloudflare Worker → R2) and
 * return the short id. Throws when the backend isn't reachable (e.g. plain
 * `vite dev` with no Worker) so the caller can show a helpful message.
 */
export async function uploadArModel(blobs: ArModelBlobs, opts?: ArUploadOptions): Promise<string> {
  const form = new FormData()
  form.append('glb', blobs.glb, 'model.glb')
  form.append('usdz', blobs.usdz, 'model.usdz')
  form.append('poster', blobs.poster, 'poster.png')
  const base = (opts?.endpoint ?? '').replace(/\/+$/, '')
  /*
   * Relative from the studio, absolute from the shop's page. Cross-origin the
   * multipart POST leaves on its own and it is READING the id back that needs
   * `worker/cors.ts`; without it the QR has nothing to point at and the failure
   * looks like a network error rather than a refusal.
   */
  const res = await fetch(base === '' ? '/api/ar' : `${base}/api/ar`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`AR upload failed (${res.status})`)
  const data = (await res.json()) as { id?: string }
  if (!data.id) throw new Error('AR upload returned no id')
  return data.id
}
