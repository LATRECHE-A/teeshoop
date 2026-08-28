/**
 * One place that turns a catalog GLB into a physically-true, inch-scaled
 * garment and says where a print sits on it. The live preview
 * (src/three/GarmentModel.tsx) and the AR bake (src/lib/arExport.ts) both go
 * through here, so they cannot disagree about size or placement.
 *
 * See src/three/calibration.ts for why the scales are derived from the mesh's
 * own chest arc and the chart's body length rather than from its bounding box,
 * and why the print hangs from the collar seam.
 */
import * as THREE from 'three'
import type { CatalogGarmentId, Side } from '@/lib/types'
import { SIZE_IDS, garmentWidthInFor, sizeSpecCm, type SizeId } from '@/content/sizeChart'
import { collarSeamDropIn, printDropBelowCollarIn } from '@/lib/renderDesign'
import { cmToIn } from '@/lib/units'
import { CALIBRATION } from './calibration'
import { applyCavity, CAVITY_DEFAULTS, getCavity } from './clothShading'
import { getArcTable, type ArcTable } from './fabricUnwrap'
import type { FabricFrame } from './decalGeom'

export interface GarmentFrame {
  /** Baked to scene orientation, bbox-centred, scaled to physical inches. */
  geometry: THREE.BufferGeometry
  xzScale: number
  yScale: number
  heightIn: number
  widthIn: number
  depthIn: number
  /**
   * Extents of the BIGGEST size in this garment's chart. The camera frames to
   * these, never to the previewed size: a rig that re-fits per size would keep
   * every size the same number of pixels tall and silently erase the one thing
   * the size selector is supposed to show. Framing the largest instead means an
   * S really does look smaller than a 3XL, and nothing is ever cropped.
   * (scripts/board-verify.mjs asserts both halves of that.)
   */
  fitHeightIn: number
  fitWidthIn: number
  /** World Y (inches) of the FRONT collar seam on the scaled mesh. */
  neckFrontYIn: number
  table: ArcTable
}

/**
 * Normalize a source mesh in place-free fashion: the returned geometry is a new
 * buffer, safe to mutate and dispose. `sizeId` drives both scales through the
 * official cm chart, so an S and a 3XL genuinely differ in girth AND length.
 */
export function buildGarmentFrame(
  garment: CatalogGarmentId,
  source: THREE.Mesh,
  sizeId: SizeId,
): GarmentFrame {
  const calib = CALIBRATION[garment]
  const geometry = source.geometry.clone()
  geometry.applyMatrix4(source.matrixWorld)
  if (calib.rotateY !== 0) geometry.rotateY(calib.rotateY)
  geometry.computeBoundingBox()
  const box = geometry.boundingBox as THREE.Box3
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  geometry.translate(-center.x, -center.y, -center.z)

  // The arc table is in RAW units and therefore size-independent: build it on
  // the centred, unscaled geometry and cache it per model for the app's life.
  const table = getArcTable(calib.url, geometry, calib.chestBandFromTop)

  // Girth from the mesh's own front-panel arc; fall back to the bbox width when
  // the mesh is too irregular to unwrap (the print then keeps the projected
  // decal path, but the garment must still be a sane size).
  const frontArcRaw = table.usable && table.frontArcRaw > 0 ? table.frontArcRaw : size.x
  const xzScale = garmentWidthInFor(garment, sizeId) / frontArcRaw
  const bodyRaw = Math.max(1e-6, size.y - calib.bodyTopBelowTopRaw)
  const yScale = cmToIn(sizeSpecCm(garment, sizeId).bodyLengthCm) / bodyRaw

  // Cavity occlusion is measured on the CENTRED, UNSCALED mesh so one buffer
  // serves every size: the girth and length scales differ by a few per cent,
  // which moves no crease anywhere a viewer could see. Doing it here (rather
  // than after `scale`) is also what lets it be cached per model like the arc
  // table beside it. It is the expensive part of loading a garment.
  const cavity = getCavity(calib.url, geometry, { ...CAVITY_DEFAULTS, gain: calib.cloth.cavityGain })

  geometry.scale(xzScale, yScale, xzScale)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  // After the scale, so the attribute rides the geometry the meshes actually
  // use: `scale` does not reorder vertices, so the buffers stay aligned.
  if (cavity) applyCavity(geometry, cavity)

  const biggest = SIZE_IDS[SIZE_IDS.length - 1]
  return {
    geometry,
    xzScale,
    yScale,
    heightIn: size.y * yScale,
    widthIn: size.x * xzScale,
    depthIn: size.z * xzScale,
    fitWidthIn: (size.x * garmentWidthInFor(garment, biggest)) / frontArcRaw,
    fitHeightIn: (size.y * cmToIn(sizeSpecCm(garment, biggest).bodyLengthCm)) / bodyRaw,
    neckFrontYIn: (size.y / 2 - calib.neckFrontBelowTopRaw) * yScale,
    table,
  }
}

// --- the arm, measured -----------------------------------------------------

const ARM_PROBE_MATERIAL = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
/** Samples across the depth sweep. 24 steps ≈ 0.55 in on a tee. */
const ARM_SWEEP = 24

/** X of the outermost surface at (yIn, zIn), via local raycast along ∓X. */
function probeSurfaceX(
  geometry: THREE.BufferGeometry,
  yIn: number,
  zIn: number,
  sign: 1 | -1,
): number | null {
  const mesh = new THREE.Mesh(geometry, ARM_PROBE_MATERIAL)
  const ray = new THREE.Raycaster()
  ray.set(new THREE.Vector3(sign * 1000, yIn, zIn), new THREE.Vector3(-sign, 0, 0))
  const hits = ray.intersectObject(mesh, false)
  return hits.length > 0 ? hits[0].point.x : null
}

export interface ArmProfile {
  /** Half the arm tube's depth at this height, inches. */
  radiusIn: number
  /** Signed X of the arm's CROWN, its outermost point, which is not at z = 0. */
  crownX: number
  /** Z of the arm's own centre. Also not 0: an A-pose arm hangs forward of the
   *  garment's mid-plane. */
  centreZ: number
}

/**
 * Where the sleeve actually is, measured off the mesh.
 *
 * A ray fired inward along ∓X at sleeve height hits the ARM where the arm is and
 * the TORSO everywhere else, so "how far does the surface extend in z" (the
 * question the old `armRadiusIn` asked) is answered by the torso and comes back
 * as the garment's own half-depth. Measured on the shipped meshes it returned
 * 5.45 in on the tee where the arm is 1.91, and 6.15 on the hoodie where it is
 * 2.39. Since the caller turns that radius into a projector depth through a
 * SAGITTA, a too-large radius reads as a flat surface and produces a box far too
 * SHALLOW: 1.36 in against the 2.06 in a 7.6 cm sleeve print needs on the tee.
 * The outboard part of the artwork fell outside the box and was clipped.
 *
 * So separate the two: the arm is a hump standing proud of the torso plateau, and
 * the plateau is the MEDIAN of the sweep (it can never be the minority: the
 * sweep spans the garment's whole depth and an arm is a few inches across). Take
 * the contiguous run around the crown that stays above the half-way line between
 * crown and plateau. That yields the tube's own z-run, its centre, and its crown.
 *
 * All three matter. The crown, because pinning the box's outer face to the
 * surface at z = 0 left it 0.26-0.31 in inboard of the real crown, which then
 * poked out of the box and lost a strip down the middle of the print. The
 * centre, because the arm's z-centre is −1.36 in on the tee and −1.02 on the
 * hoodie: a decal centred on z = 0 sits a third of a print-width off the sleeve.
 */
export function armProfile(
  geometry: THREE.BufferGeometry,
  yIn: number,
  sign: 1 | -1,
  reachIn: number,
): ArmProfile {
  const n = ARM_SWEEP + 1
  const zAt = (i: number) => -reachIn + (2 * reachIn * i) / ARM_SWEEP
  const out = new Float64Array(n).fill(-Infinity)
  const hits: number[] = []
  let peak = -1
  for (let i = 0; i < n; i++) {
    const x = probeSurfaceX(geometry, yIn, zAt(i), sign)
    if (x === null) continue
    out[i] = x * sign
    hits.push(out[i])
    if (peak < 0 || out[i] > out[peak]) peak = i
  }
  /** Nothing recognisable: degrade to the pre-measurement behaviour rather than
   *  to something new and unexamined. */
  const unknown: ArmProfile = { radiusIn: reachIn / 2, crownX: sign * reachIn, centreZ: 0 }
  if (peak < 0) return unknown
  hits.sort((a, b) => a - b)
  const cut = (out[peak] + hits[hits.length >> 1]) / 2
  let lo = peak
  let hi = peak
  while (lo - 1 >= 0 && out[lo - 1] >= cut) lo--
  while (hi + 1 < n && out[hi + 1] >= cut) hi++
  // A "limb" covering most of the sweep means the threshold found no plateau to
  // separate, i.e. this is not a mesh whose arm stands proud of its body.
  if (hi <= lo || hi - lo > ARM_SWEEP * 0.6) return unknown
  return {
    radiusIn: (zAt(hi) - zAt(lo)) / 2,
    crownX: sign * out[peak],
    centreZ: (zAt(hi) + zAt(lo)) / 2,
  }
}

/**
 * Where a print panel's centre sits on the scaled mesh, in world inches.
 * Collar seam of THIS side (the front landmark plus the art's own front-to-back
 * seam offset) minus the graded drop the 2D art draws.
 */
export function printCentreYIn(
  garment: CatalogGarmentId,
  side: Exclude<Side, 'sleeve'>,
  frame: GarmentFrame,
  k: number,
): number {
  return frame.neckFrontYIn - collarSeamDropIn(garment, side) - printDropBelowCollarIn(garment, side, k)
}

/** The fabric mapping for one print panel at the previewed size. */
export function fabricFrameFor(
  garment: CatalogGarmentId,
  side: Exclude<Side, 'sleeve'>,
  frame: GarmentFrame,
  areaWIn: number,
  areaHIn: number,
  k: number,
): FabricFrame {
  return {
    table: frame.table,
    side,
    xzScale: frame.xzScale,
    yScale: frame.yScale,
    areaWIn,
    areaHIn,
    centreYIn: printCentreYIn(garment, side, frame, k),
  }
}
