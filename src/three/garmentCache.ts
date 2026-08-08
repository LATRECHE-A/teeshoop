/**
 * Shared normalized geometry + materials for the 3D board.
 *
 * `buildGarmentFrame` clones the GLB mesh, rotates, centres and rescales it for
 * one (garment, size). The single-garment preview does that once; a board of
 * eight would do it eight times and upload eight copies of the same 36k-vertex
 * hoodie. Since the frame depends on NOTHING but (garment, size), one cache
 * keyed on exactly that collapses "eight identical L tees" to one geometry.
 *
 * The cache is SESSION-SCOPED rather than reference-counted on purpose. The key
 * space is tiny and closed — 2 catalog garments × 6 chart sizes, plus one
 * material per (garment, colour) — so the ceiling is bounded and small, while a
 * refcount would have to survive StrictMode's double render (which invokes
 * every useMemo twice and every effect cleanup once) to avoid leaking or
 * double-disposing. `disposeBoardGarments()` on the board's unmount is exact,
 * total, and impossible to get subtly wrong.
 */
import * as THREE from 'three'
import type { CatalogGarmentId, SizeId } from '@/lib/types'
import { CALIBRATION, MAX_BAKED_NORMAL_SCALE } from './calibration'
import { buildGarmentFrame, type GarmentFrame } from './garmentFrame'

const frames = new Map<string, GarmentFrame>()
const materials = new Map<string, THREE.MeshStandardMaterial>()

/**
 * Disposal is DEFERRED and must be PAIRED: the owner calls `keepBoardGarments`
 * from its mount effect and `scheduleDisposeBoardGarments` from the cleanup.
 *
 * React's StrictMode runs mount → cleanup → mount, and the second mount does
 * NOT re-render (memoised), so cancelling only on acquire is not enough — the
 * cleanup's timer would survive and free geometry the live meshes still point
 * at, 1.5 s after the board appeared. Cancelling from the mount effect closes
 * that exact hole, and the grace window still absorbs a real re-layout.
 */
let disposeTimer: ReturnType<typeof setTimeout> | null = null

function cancelDisposal(): void {
  if (disposeTimer === null) return
  clearTimeout(disposeTimer)
  disposeTimer = null
}

/** Cancel a pending disposal — call from the owner's mount effect. */
export function keepBoardGarments(): void {
  cancelDisposal()
}

export function firstMesh(root: THREE.Object3D, name?: string): THREE.Mesh | null {
  let found: THREE.Mesh | null = null
  root.traverse((o) => {
    if (found) return
    const mesh = o as THREE.Mesh
    if (mesh.isMesh && (!name || mesh.name === name)) found = mesh
  })
  return found
}

/** The normalized, inch-scaled frame for this garment at this size. */
export function boardGarmentFrame(
  garment: CatalogGarmentId,
  sizeId: SizeId,
  scene: THREE.Object3D,
): GarmentFrame {
  cancelDisposal()
  const key = `${garment}|${sizeId}`
  const hit = frames.get(key)
  if (hit) return hit
  const calib = CALIBRATION[garment]
  scene.updateMatrixWorld(true)
  const src = firstMesh(scene, calib.meshName) ?? firstMesh(scene)
  if (!src) throw new Error(`No mesh found in ${calib.url}`)
  const frame = buildGarmentFrame(garment, src, sizeId)
  frames.set(key, frame)
  return frame
}

/**
 * Board fabric material. Deliberately MeshStandardMaterial, not the preview's
 * MeshPhysicalMaterial with a cloth sheen: sheen is a per-pixel Fresnel term
 * whose whole payoff is grazing-angle fabric character, which is invisible at
 * the zoom a board is viewed from and is paid for N times over.
 */
export function boardGarmentMaterial(
  garment: CatalogGarmentId,
  colorHex: string,
  scene: THREE.Object3D,
  /**
   * Does the frame this material will be drawn with carry the cavity `color`
   * attribute? It normally does (buildGarmentFrame → applyCavity), but
   * `computeCavity` can decline — no index, no normals, a degenerate bbox — and
   * an unbound `color` attribute reads as (0, 0, 0) in GL, which would paint
   * every garment on the board SOLID BLACK. The preview asks the same question
   * of its own geometry (GarmentModel); the board must not merely assume.
   */
  hasCavity: boolean,
): THREE.MeshStandardMaterial {
  cancelDisposal()
  const key = `${garment}|${colorHex}|${hasCavity ? 'c' : ''}`
  const hit = materials.get(key)
  if (hit) return hit
  const calib = CALIBRATION[garment]
  const src = firstMesh(scene, calib.meshName) ?? firstMesh(scene)
  const srcMat = (
    src && (Array.isArray(src.material) ? src.material[0] : src.material)
  ) as THREE.MeshStandardMaterial | null
  const material = new THREE.MeshStandardMaterial({
    map: srcMat?.map ?? null,
    normalMap: srcMat?.normalMap ?? null,
    roughnessMap: srcMat?.roughnessMap ?? null,
    color: new THREE.Color(colorHex),
    roughness: calib.roughness,
    metalness: 0,
    envMapIntensity: calib.envMapIntensity,
    // The board's frames come from `buildGarmentFrame`, which writes the
    // measured cavity occlusion into a `color` attribute — and without this the
    // GPU simply ignores it, so the SAME tee was seam-shaded in the studio and
    // flat on the board, in one session. Sheen is still deliberately skipped
    // (see the header); occlusion is not a grazing-angle nicety.
    vertexColors: hasCavity,
    // Open surfaces: both bundled GLBs declare doubleSided, and culling their
    // backfaces shows the backdrop through the collar and the hem.
    side: srcMat?.side ?? THREE.DoubleSide,
  })
  // Same ceiling as the preview, from the same constant: the tee's baked normal
  // map asks for 2.81 over a heavily minified lossy texture, which amplifies its
  // compression rather than its threads. Per axis — see the note in GarmentModel.
  if (material.normalMap && srcMat) {
    material.normalScale.set(
      THREE.MathUtils.clamp(srcMat.normalScale.x, -MAX_BAKED_NORMAL_SCALE, MAX_BAKED_NORMAL_SCALE),
      THREE.MathUtils.clamp(srcMat.normalScale.y, -MAX_BAKED_NORMAL_SCALE, MAX_BAKED_NORMAL_SCALE),
    )
  }
  materials.set(key, material)
  return material
}

/** Free everything the board built. Called when the 3D board unmounts. */
export function disposeBoardGarments(): void {
  cancelDisposal()
  for (const frame of frames.values()) frame.geometry.dispose()
  frames.clear()
  for (const material of materials.values()) material.dispose()
  materials.clear()
}

/** Free after `delayMs` unless something asks for a garment meanwhile. */
export function scheduleDisposeBoardGarments(delayMs = 1500): void {
  cancelDisposal()
  disposeTimer = setTimeout(() => {
    disposeTimer = null
    disposeBoardGarments()
  }, delayMs)
}

/** Dev probe (scripts/board-verify.mjs): what the board actually allocated. */
export function boardGarmentStats(): {
  frames: number
  materials: number
  vertices: number
  triangles: number
} {
  let vertices = 0
  let triangles = 0
  for (const frame of frames.values()) {
    const pos = frame.geometry.getAttribute('position')
    const index = frame.geometry.getIndex()
    vertices += pos ? pos.count : 0
    triangles += index ? index.count / 3 : (pos?.count ?? 0) / 3
  }
  return { frames: frames.size, materials: materials.size, vertices, triangles }
}
