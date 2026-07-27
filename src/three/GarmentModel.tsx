/**
 * Catalog garment (tee / hoodie) with the design mapped onto the cloth.
 *
 * 1 world unit = 1 inch, and the inches are physical: the GLB is normalized once
 * per (model, size) so its own chest arc measures the size chart's laid-flat
 * half-chest and its own body measures the chart's body length (see
 * src/three/garmentFrame.ts and src/three/calibration.ts).
 *
 * The front/back print is NOT a projected decal. It is a second pass over the
 * garment geometry whose UVs are FABRIC coordinates — inches of cloth from the
 * centre-front line, from src/three/fabricUnwrap.ts — so a 10 cm logo covers
 * 10 cm of cloth wherever it sits, nothing is clipped by a projector box, and
 * the 2D editor's inches and the 3D surface are literally the same numbers.
 * A projected decal survives only for the sleeve (a tube on its own slanted
 * axis, which the torso unwrap does not describe) and as the fallback when a
 * mesh cannot be unwrapped at all.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Decal, useGLTF } from '@react-three/drei'
import type { CatalogGarmentId, DecalSource, Side, SizeId } from '@/lib/types'
import { DEFAULT_SIZE } from '@/content/sizeChart'
import { CALIBRATION } from './calibration'
import { buildFabricOverlay, fabricPrintMaterial } from './decalGeom'
import { buildGarmentFrame, fabricFrameFor, printCentreYIn, type GarmentFrame } from './garmentFrame'
import { useSourceTexture } from './textures'

useGLTF.preload('/models/tee.glb', false, false)
useGLTF.preload('/models/hoodie.glb', false, false)

interface NormalizedGarment extends GarmentFrame {
  material: THREE.MeshPhysicalMaterial
}

function firstMesh(root: THREE.Object3D, name?: string): THREE.Mesh | null {
  let found: THREE.Mesh | null = null
  root.traverse((o) => {
    if (found) return
    const mesh = o as THREE.Mesh
    if (mesh.isMesh && (!name || mesh.name === name)) found = mesh
  })
  return found
}

function useNormalizedGarment(garment: CatalogGarmentId, sizeId: SizeId): NormalizedGarment {
  const calib = CALIBRATION[garment]
  const gltf = useGLTF(calib.url, false, false)

  const normalized = useMemo<NormalizedGarment>(() => {
    gltf.scene.updateMatrixWorld(true)
    const src = firstMesh(gltf.scene, calib.meshName) ?? firstMesh(gltf.scene)
    if (!src) throw new Error(`No mesh found in ${calib.url}`)
    const frame = buildGarmentFrame(garment, src, sizeId)

    const srcMat = (Array.isArray(src.material) ? src.material[0] : src.material) as THREE.MeshStandardMaterial
    // Upgrade to a physical material with a cloth sheen so the tee/hoodie reads
    // as fabric (a Fresnel grazing highlight that emphasises curvature) rather
    // than plastic. The print is a separate pass, so inch accuracy is untouched.
    // Copy source maps explicitly — Physical.copy(Standard) is unsafe because
    // the Standard source lacks the sheen fields Physical.copy reads.
    const material = new THREE.MeshPhysicalMaterial({
      map: srcMat.map,
      normalMap: srcMat.normalMap,
      roughnessMap: srcMat.roughnessMap,
      color: srcMat.color.clone(),
      roughness: calib.roughness,
      metalness: 0,
      envMapIntensity: calib.envMapIntensity,
      sheen: 0.5,
      sheenRoughness: 0.9,
      sheenColor: new THREE.Color('#ffffff'),
    })

    return { ...frame, material }
  }, [gltf, garment, calib, sizeId])

  useEffect(
    () => () => {
      normalized.geometry.dispose()
      normalized.material.dispose()
    },
    [normalized],
  )

  return normalized
}

const PROBE_MATERIAL = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })

/** Z of the outermost front/back surface at (xIn, yIn), via local raycast. */
function probeSurfaceZ(geometry: THREE.BufferGeometry, xIn: number, yIn: number, side: Side): number | null {
  const mesh = new THREE.Mesh(geometry, PROBE_MATERIAL)
  const ray = new THREE.Raycaster()
  const sign = side === 'front' ? 1 : -1
  ray.set(new THREE.Vector3(xIn, yIn, sign * 1000), new THREE.Vector3(0, 0, -sign))
  const hits = ray.intersectObject(mesh, false)
  return hits.length > 0 ? hits[0].point.z : null
}

/** X of the outer sleeve/arm surface at (yIn, zIn), via local raycast along ∓X. */
function probeSurfaceX(geometry: THREE.BufferGeometry, yIn: number, zIn: number, sign: 1 | -1): number | null {
  const mesh = new THREE.Mesh(geometry, PROBE_MATERIAL)
  const ray = new THREE.Raycaster()
  ray.set(new THREE.Vector3(sign * 1000, yIn, zIn), new THREE.Vector3(-sign, 0, 0))
  const hits = ray.intersectObject(mesh, false)
  return hits.length > 0 ? hits[0].point.x : null
}

/**
 * Radius of the arm tube at a height, measured from the mesh: probe the arm's
 * outer X across a Z sweep and take half the Z run that still hits. A sleeve
 * print needs the projector box deep enough to reach the flanks it curves
 * around, and the arm is ~2 in thick where the mesh is ~26 in wide — a
 * width-derived depth is an order of magnitude wrong.
 */
function armRadiusIn(geometry: THREE.BufferGeometry, yIn: number, sign: 1 | -1, reachIn: number): number {
  let zLo = Infinity
  let zHi = -Infinity
  for (let i = 0; i <= 24; i++) {
    const z = -reachIn + (2 * reachIn * i) / 24
    if (probeSurfaceX(geometry, yIn, z, sign) !== null) {
      if (z < zLo) zLo = z
      if (z > zHi) zHi = z
    }
  }
  return Number.isFinite(zLo) && zHi > zLo ? (zHi - zLo) / 2 : reachIn / 2
}

interface PrintOverlayProps {
  frame: GarmentFrame
  garment: CatalogGarmentId
  side: Exclude<Side, 'sleeve'>
  source: DecalSource
  /** Print grading factor for the previewed size (src/lib/printScale.ts). */
  k: number
}

/**
 * The print, painted in fabric space. The overlay is the garment mesh itself
 * with fabric UVs, lifted a hair along its normals; the material discards
 * everything outside the print rect and everything off the printable shell.
 */
function PrintOverlay({ frame, garment, side, source, k }: PrintOverlayProps) {
  const texture = useSourceTexture(source)

  const geometry = useMemo(
    () => buildFabricOverlay(frame.geometry, fabricFrameFor(garment, side, frame, source.wIn, source.hIn, k)),
    [frame, garment, side, source.wIn, source.hIn, k],
  )
  useEffect(() => () => geometry.dispose(), [geometry])

  const material = useMemo(() => (texture ? fabricPrintMaterial(texture) : null), [texture])
  useEffect(() => () => material?.dispose(), [material])

  if (!material) return null
  return <mesh geometry={geometry} material={material} renderOrder={2} />
}

interface PrintDecalProps {
  geometry: THREE.BufferGeometry
  side: Exclude<Side, 'sleeve'>
  source: DecalSource
  /** World Y (inches) of the print-area centre. */
  centreYIn: number
}

/**
 * Fallback for a mesh the unwrap could not validate: an orthographic projector.
 * It clips artwork that curves away from the box and maps chords rather than
 * arc length, so it is deliberately the second choice — but a wrong-looking
 * print beats no print, and it is what keeps an unknown ingested mesh usable.
 */
function PrintDecal({ geometry, side, source, centreYIn }: PrintDecalProps) {
  const texture = useSourceTexture(source)

  const placement = useMemo(() => {
    // Probe the surface Z over the WHOLE footprint (a 5×5 grid), skipping
    // misses: the old ±half-width probes fell off the torso entirely and their
    // bbox fallback floated the box off the fabric.
    let zMin = Infinity
    let zMax = -Infinity
    for (let j = 0; j <= 4; j++) {
      for (let i = 0; i <= 4; i++) {
        const z = probeSurfaceZ(
          geometry,
          -source.wIn / 2 + (source.wIn * i) / 4,
          centreYIn - source.hIn / 2 + (source.hIn * j) / 4,
          side,
        )
        if (z === null) continue
        if (z < zMin) zMin = z
        if (z > zMax) zMax = z
      }
    }
    const half = Math.abs((geometry.boundingBox as THREE.Box3).max.z)
    if (!Number.isFinite(zMin)) return { z: side === 'front' ? half * 0.8 : -half * 0.8, depth: 0.8 }
    // Clamp to < 0.55·halfDepth so a front box never reaches the back
    // hemisphere (DecalGeometry does no normal culling, so it would bleed).
    return { z: (zMin + zMax) / 2, depth: THREE.MathUtils.clamp(zMax - zMin + 1.0, 0.8, 0.55 * half) }
  }, [geometry, side, centreYIn, source.wIn, source.hIn])

  if (!texture) return null
  return (
    <Decal
      position={[0, centreYIn, placement.z]}
      rotation={[0, side === 'back' ? Math.PI : 0, 0]}
      scale={[source.wIn, source.hIn, placement.depth]}
      renderOrder={2}
    >
      <meshStandardMaterial
        map={texture}
        transparent
        polygonOffset
        polygonOffsetFactor={-10}
        depthTest
        depthWrite={false}
        toneMapped
        roughness={0.88}
        metalness={0}
      />
    </Decal>
  )
}

interface SleeveDecalProps {
  frame: GarmentFrame
  garment: CatalogGarmentId
  source: DecalSource
  /** +1 = one flank (+X), −1 = the other (−X). */
  sign: 1 | -1
}

/**
 * The sleeve keeps a PROJECTED decal on purpose. The fabric unwrap measures arc
 * around the garment's vertical axis; an arm is a separate tube on its own
 * slanted axis (hence `sleeve.rotZ`), and estimating that axis from an A-pose
 * mesh is far less stable than projecting a 4 in print onto a ~2 in-radius tube.
 * What DID need fixing is the box: it is now sized from the arm's measured
 * thickness, so the print no longer loses its outboard fifth.
 */
function SleeveDecal({ frame, garment, source, sign }: SleeveDecalProps) {
  const texture = useSourceTexture(source)
  const calib = CALIBRATION[garment]

  const placement = useMemo(() => {
    const y = calib.sleeve.yRaw * frame.yScale
    const surfaceX = probeSurfaceX(frame.geometry, y, 0, sign)
    const r = armRadiusIn(frame.geometry, y, sign, frame.depthIn / 2)
    // Depth must cover how far the tube falls away under the print's own half
    // width, plus slack for the vertical curve. sagitta = r − √(r² − (w/2)²).
    const halfW = Math.min(source.wIn / 2, r * 0.98)
    const sagitta = r - Math.sqrt(Math.max(0, r * r - halfW * halfW))
    const depth = Math.max(2 * sagitta + 0.6, 1.2)
    const x = (surfaceX ?? sign * frame.depthIn) - sign * depth * 0.5
    return { x, y, depth }
  }, [frame, calib, sign, source.wIn])

  if (!texture) return null
  return (
    <Decal
      position={[placement.x, placement.y, 0]}
      rotation={[0, (sign * Math.PI) / 2, sign * calib.sleeve.rotZ]}
      scale={[source.wIn, source.hIn, placement.depth]}
      renderOrder={2}
    >
      <meshStandardMaterial
        map={texture}
        transparent
        polygonOffset
        polygonOffsetFactor={-10}
        depthTest
        depthWrite={false}
        toneMapped
        roughness={0.88}
        metalness={0}
      />
    </Decal>
  )
}

export interface GarmentModelProps {
  garment: CatalogGarmentId
  colorHex: string
  /** Previewed chart size; drives both the girth and the length scale. */
  sizeId?: SizeId
  front: DecalSource | null
  back: DecalSource | null
  sleeve: DecalSource | null
  /** Print grading factor for the previewed size (src/lib/printScale.ts). */
  printK?: number
  /** Scene lighting multiplier for the fabric's env-map response. */
  envIntensity?: number
  /**
   * Reports the normalized garment extents (inches). The floor follows the
   * PREVIEWED size; the camera frames `fitIn` (the chart's biggest size) so
   * changing size visibly changes the garment instead of the camera.
   */
  onMeasured?: (heightIn: number, widthIn?: number, fitIn?: { heightIn: number; widthIn: number }) => void
}

export function GarmentModel({
  garment,
  colorHex,
  sizeId,
  front,
  back,
  sleeve,
  printK = 1,
  envIntensity = 1,
  onMeasured,
}: GarmentModelProps) {
  const normalized = useNormalizedGarment(garment, sizeId ?? DEFAULT_SIZE)
  const { geometry, material, heightIn, widthIn, fitHeightIn, fitWidthIn, table } = normalized

  useEffect(() => {
    material.color.set(colorHex)
  }, [material, colorHex])

  // Scene lighting: scale the calibrated env-map response so the fabric reads
  // brighter on the beach, moodier at night, etc.
  useEffect(() => {
    material.envMapIntensity = CALIBRATION[garment].envMapIntensity * envIntensity
    material.needsUpdate = true
  }, [material, garment, envIntensity])

  useEffect(() => {
    onMeasured?.(heightIn, widthIn, { heightIn: fitHeightIn, widthIn: fitWidthIn })
  }, [heightIn, widthIn, fitHeightIn, fitWidthIn, onMeasured])

  const panel = (side: Exclude<Side, 'sleeve'>, source: DecalSource) =>
    table.usable ? (
      <PrintOverlay frame={normalized} garment={garment} side={side} source={source} k={printK} />
    ) : (
      <PrintDecal
        geometry={geometry}
        side={side}
        source={source}
        centreYIn={printCentreYIn(garment, side, normalized, printK)}
      />
    )

  return (
    <mesh geometry={geometry} material={material}>
      {front && panel('front', front)}
      {back && panel('back', back)}
      {sleeve && (
        <>
          <SleeveDecal frame={normalized} garment={garment} source={sleeve} sign={-1} />
          <SleeveDecal frame={normalized} garment={garment} source={sleeve} sign={1} />
        </>
      )}
    </mesh>
  )
}
