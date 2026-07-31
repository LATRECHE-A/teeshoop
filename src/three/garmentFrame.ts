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

  // The arc table is in RAW units and therefore size-independent — build it on
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
  // table beside it — it is the expensive part of loading a garment.
  const cavity = getCavity(calib.url, geometry, { ...CAVITY_DEFAULTS, gain: calib.cloth.cavityGain })

  geometry.scale(xzScale, yScale, xzScale)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  // After the scale, so the attribute rides the geometry the meshes actually
  // use — `scale` does not reorder vertices, so the buffers stay aligned.
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
