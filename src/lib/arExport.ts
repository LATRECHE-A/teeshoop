/**
 * Bake the current design into the two model formats native mobile AR needs:
 *   • GLB  → Android Scene Viewer (and WebXR) via <model-viewer src>
 *   • USDZ → iOS Quick Look via <model-viewer ios-src>
 *
 * Runs entirely in the browser. Catalog garments (tee / hoodie) reuse the SAME
 * realistic GLB meshes as the studio 3D preview (public/models/*.glb), with the
 * design projected on as a DecalGeometry — so the AR model is a photoreal draped
 * garment, dimensionally identical to the live preview. Custom (ship-your-own)
 * garments fall back to a procedural mannequin. Decals come from the shared
 * renderer (renderPrintArea), so vector AND photo designs work, at life-size
 * (1 unit = 1 inch). The figure stands with its base at y=0 for on-floor AR.
 *
 * Everything in the export scene is MeshStandardMaterial — the only material the
 * three USDZExporter supports well (no MeshPhysicalMaterial/sheen, no normal map
 * with a texture-transform, which Quick Look mis-tiles).
 */
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js'
import type { CatalogGarmentId, Design, Side } from '@/lib/types'
import { garmentColorHex, getAreaSizeIn, renderMockup, renderPrintArea, sideLayers } from '@/lib/renderDesign'
import { GARMENTS } from '@/garments'
import { CALIBRATION } from '@/three/calibration'
import { buildMannequin, type Gender, type MannequinSide } from '@/three/mannequin'

const TARGET_PX = 1400 // decal render density (matches the 3D preview)
const GAP_BELOW_COLLAR = 2.6 // in, mannequin print top under the neckline
const DECAL_LIFT = 0.25 // in, above the mannequin fabric surface
const DECAL_BEND_MAX = THREE.MathUtils.degToRad(58)

export type { Gender }

export interface ArModelBlobs {
  glb: Blob
  usdz: Blob
  poster: Blob
}

interface Disposable {
  dispose(): void
}

function canvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  tex.flipY = true
  tex.needsUpdate = true
  return tex
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

/** Print-area centre offset from the garment visual centre (inches, +down). */
function areaOffsetYIn(garment: CatalogGarmentId, side: Side): number {
  const art = GARMENTS[garment]
  const a = art.sides[side].printAreaPx
  return (a.y + a.h / 2 - 400) / art.pxPerInch
}

/**
 * Build a realistic catalog garment (tee/hoodie) with the design projected on.
 * Mirrors src/three/GarmentModel.tsx (normalize to inches, raycast the surface,
 * DecalGeometry the shared-renderer canvas) but in plain three for the exporter.
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
  // USDZ-safe: MeshStandardMaterial, keep the baked AO but DROP the normal map
  // (the tee's normal carries a texture-transform Quick Look mis-tiles).
  const material = new THREE.MeshStandardMaterial({
    map: srcMat.map ?? null,
    aoMap: srcMat.aoMap ?? null,
    color: new THREE.Color(garmentColorHex(design)),
    roughness: calib.roughness,
    metalness: 0,
  })
  const garmentMesh = new THREE.Mesh(geometry, material)
  garmentMesh.updateMatrixWorld(true)

  const figure = new THREE.Group()
  figure.add(garmentMesh)
  const disposables: Disposable[] = [geometry, material]

  const sides: Side[] = ['front', 'back']
  const canvases = await Promise.all(sides.map((s) => renderSide(design, s)))
  sides.forEach((side, i) => {
    const canvas = canvases[i]
    if (!canvas) return
    const src2 = getAreaSizeIn(design, side)
    const y = -(areaOffsetYIn(garment, side) + calib.decalNudgeYIn[side])
    const depth = Math.max(src2.wIn * calib.decalDepthFraction, 0.8)
    const surfaceZ = probeSurfaceZ(geometry, 0, y, side)
    const z = side === 'front' ? surfaceZ - depth * calib.decalInset : surfaceZ + depth * calib.decalInset
    const decalGeo = new DecalGeometry(
      garmentMesh,
      new THREE.Vector3(0, y, z),
      new THREE.Euler(0, side === 'back' ? Math.PI : 0, 0),
      new THREE.Vector3(src2.wIn, src2.hIn, depth),
    )
    const tex = canvasTexture(canvas)
    const decalMat = new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      alphaTest: 0.02,
      polygonOffset: true,
      polygonOffsetFactor: -10,
      depthWrite: false,
      roughness: 0.88,
      metalness: 0,
    })
    disposables.push(decalGeo, tex, decalMat)
    figure.add(new THREE.Mesh(decalGeo, decalMat))
  })

  // Sleeve print (both flanks), projected onto the arm along ±X.
  const sleeveCanvas = await renderSide(design, 'sleeve')
  if (sleeveCanvas) {
    const sz = getAreaSizeIn(design, 'sleeve')
    const sl = calib.sleeve
    const depth = Math.max(sz.wIn * sl.depthFraction, 0.8)
    const tex = canvasTexture(sleeveCanvas)
    disposables.push(tex)
    for (const sign of [-1, 1] as const) {
      const surfaceX = probeSurfaceX(geometry, sl.yIn, 0, sign)
      const decalGeo = new DecalGeometry(
        garmentMesh,
        new THREE.Vector3(surfaceX - sign * depth * calib.decalInset, sl.yIn, 0),
        new THREE.Euler(0, (sign * Math.PI) / 2, sign * sl.rotZ),
        new THREE.Vector3(sz.wIn, sz.hIn, depth),
      )
      const decalMat = new THREE.MeshStandardMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.02,
        polygonOffset: true,
        polygonOffsetFactor: -10,
        depthWrite: false,
        roughness: 0.88,
        metalness: 0,
      })
      disposables.push(decalGeo, decalMat)
      figure.add(new THREE.Mesh(decalGeo, decalMat))
    }
  }

  // Ground: hem sits on the floor (geometry is centred, so lift by half-height).
  figure.position.y = -(geometry.boundingBox as THREE.Box3).min.y
  return { figure, disposables }
}

// ---------------------------------------------------------------- mannequin (custom)

/** A cylindrically-curved plane hugging the chest, sized in inches. */
function makeCurvedDecal(wIn: number, hIn: number, radius: number): THREE.PlaneGeometry {
  const bend = Math.min(DECAL_BEND_MAX, wIn / Math.max(radius, 1))
  const r = wIn / bend
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
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      alphaTest: 0.02,
      roughness: 0.82,
      metalness: 0,
      side: THREE.FrontSide,
    })
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

/**
 * Build the design -> AR model (GLB + USDZ + poster). Catalog garments get the
 * real garment mesh; custom garments get the mannequin. Disposes GPU resources.
 */
export async function buildArModel(design: Design, gender: Gender): Promise<ArModelBlobs> {
  const { figure, disposables } =
    design.garmentId === 'custom'
      ? await buildMannequinFigure(design, gender)
      : await buildCatalogFigure(design, design.garmentId)

  const root = new THREE.Group()
  root.add(figure)

  try {
    const glbData = (await new GLTFExporter().parseAsync(root, {
      binary: true,
      embedImages: true,
      onlyVisible: true,
    })) as ArrayBuffer

    const usdzData = await new USDZExporter().parseAsync(root, {
      maxTextureSize: 2048,
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
