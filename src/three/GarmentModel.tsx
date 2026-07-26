/**
 * Catalog garment (tee / hoodie) with dimensionally mapped print decals.
 *
 * 1 world unit = 1 inch. The GLB geometry is normalized once per
 * (model, garmentWidthIn): baked to scene orientation, centered on its bbox
 * center and scaled so bboxWidth * widthFraction === garmentWidthIn (height
 * follows the size chart's body-length ratio, see lengthOverWidthRatio).
 * Decals are then sized wIn x hIn world units directly, and their center Y is
 * garment-visual-center (y=0) minus areaOffsetYIn (+down ⇒ -y), plus a
 * per-model calibration nudge (src/three/calibration.ts).
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Decal, useGLTF } from '@react-three/drei'
import type { CatalogGarmentId, DecalSource, Side, SizeId } from '@/lib/types'
import { sizeScale } from '@/content/sizeChart'
import { CALIBRATION } from './calibration'
import { useSourceTexture } from './textures'

useGLTF.preload('/models/tee.glb', false, false)
useGLTF.preload('/models/hoodie.glb', false, false)

interface NormalizedGarment {
  geometry: THREE.BufferGeometry
  material: THREE.MeshStandardMaterial
  heightIn: number
  depthIn: number
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

/**
 * Extra vertical stretch on top of the width-derived scale, so the mesh length
 * follows the chart's BODY-LENGTH ratio (sy) while X/Z keep following the
 * half-chest ratio (sx) that `garmentWidthIn` already carries. Undefined size
 * ⇒ 1, i.e. the nominal-size proportions (the dev harness passes no size).
 */
function lengthOverWidthRatio(garment: CatalogGarmentId, sizeId?: SizeId): number {
  if (!sizeId) return 1
  const { sx, sy } = sizeScale(garment, sizeId)
  return sy / sx
}

function useNormalizedGarment(
  garment: CatalogGarmentId,
  garmentWidthIn: number,
  sizeId?: SizeId,
): NormalizedGarment {
  const calib = CALIBRATION[garment]
  const gltf = useGLTF(calib.url, false, false)

  const normalized = useMemo<NormalizedGarment>(() => {
    gltf.scene.updateMatrixWorld(true)
    const src = firstMesh(gltf.scene, calib.meshName) ?? firstMesh(gltf.scene)
    if (!src) throw new Error(`No mesh found in ${calib.url}`)

    const geometry = src.geometry.clone()
    geometry.applyMatrix4(src.matrixWorld)
    if (calib.rotateY !== 0) geometry.rotateY(calib.rotateY)

    geometry.computeBoundingBox()
    const box = geometry.boundingBox as THREE.Box3
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    geometry.translate(-center.x, -center.y, -center.z)
    // Narrow the girth (X/Z) to the WORN width: mapping the laid-flat width
    // onto the worn torso over-inflated the girth ~20%, so a true-inch print
    // read undersized vs the worn AR avatar. Height follows the chart's
    // body-length ratio instead of the chest ratio — the 2D art stretches by
    // sy about the collar and areaOffsetYIn assumes exactly that, so a
    // chest-scaled height would drift the collar-relative print placement.
    const widthScale = garmentWidthIn / (size.x * calib.widthFraction)
    const yScale = widthScale * lengthOverWidthRatio(garment, sizeId)
    const xzScale = widthScale * calib.wornFactor
    geometry.scale(xzScale, yScale, xzScale)
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()

    const srcMat = (Array.isArray(src.material) ? src.material[0] : src.material) as THREE.MeshStandardMaterial
    // Upgrade to a physical material with a cloth sheen so the tee/hoodie reads
    // as fabric (a Fresnel grazing highlight that emphasises curvature) rather
    // than plastic. Decals are a separate projected mesh, so inch accuracy is
    // untouched. Copy source maps explicitly — Physical.copy(Standard) is unsafe
    // because the Standard source lacks the sheen fields Physical.copy reads.
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

    return {
      geometry,
      material,
      heightIn: size.y * yScale,
      depthIn: size.z * xzScale,
    }
  }, [gltf, garment, calib, garmentWidthIn, sizeId])

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

interface PrintDecalProps {
  geometry: THREE.BufferGeometry
  garment: CatalogGarmentId
  side: Side
  source: DecalSource
  /** Print-area center offset from garment visual center, inches, +down. */
  offsetYIn: number
}

function PrintDecal({ geometry, garment, side, source, offsetYIn }: PrintDecalProps) {
  const texture = useSourceTexture(source)
  const calib = CALIBRATION[garment]

  const placement = useMemo(() => {
    const y = -(offsetYIn + calib.decalNudgeYIn[side])
    const hw = source.wIn / 2
    const hh = source.hIn / 2
    // Probe the surface Z across the WHOLE print footprint (centre + the four
    // mid-edges), not just the centre: a tall print spans the torso's vertical
    // curvature, so a width-only box clipped its top/bottom rows. The box must
    // span [zMin,zMax] of the footprint so every row projects.
    const zs = [
      probeSurfaceZ(geometry, 0, y, side),
      probeSurfaceZ(geometry, -hw, y, side),
      probeSurfaceZ(geometry, hw, y, side),
      probeSurfaceZ(geometry, 0, y + hh, side),
      probeSurfaceZ(geometry, 0, y - hh, side),
    ]
    const zMin = Math.min(...zs)
    const zMax = Math.max(...zs)
    const halfDepth = Math.abs((geometry.boundingBox as THREE.Box3).max.z)
    // Clamp the box depth to < 0.55·halfDepth so a front box never reaches the
    // back hemisphere (which would bleed the front print through to the back).
    const depth = THREE.MathUtils.clamp(zMax - zMin + 1.0, 0.8, 0.55 * halfDepth)
    return { y, z: (zMin + zMax) / 2, depth }
  }, [geometry, side, offsetYIn, source.wIn, source.hIn, calib])

  if (!texture) return null
  return (
    <Decal
      position={[0, placement.y, placement.z]}
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
  geometry: THREE.BufferGeometry
  garment: CatalogGarmentId
  source: DecalSource
  /** +1 = one flank (+X), −1 = the other (−X). */
  sign: 1 | -1
}

/** Project the sleeve design onto an arm flank (±X), mirroring PrintDecal's ±Z. */
function SleeveDecal({ geometry, garment, source, sign }: SleeveDecalProps) {
  const texture = useSourceTexture(source)
  const calib = CALIBRATION[garment]

  const placement = useMemo(() => {
    const sl = calib.sleeve
    const depth = Math.max(source.wIn * sl.depthFraction, 0.8)
    const surfaceX = probeSurfaceX(geometry, sl.yIn, 0, sign)
    const x = surfaceX - sign * depth * calib.decalInset
    return { x, y: sl.yIn, depth }
  }, [geometry, sign, source.wIn, calib])

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
  garmentWidthIn: number
  /** Previewed chart size; stretches the mesh length by the body-length ratio. */
  sizeId?: SizeId
  front: DecalSource | null
  back: DecalSource | null
  sleeve: DecalSource | null
  areaOffsetYIn?: Record<Side, number>
  /** Scene lighting multiplier for the fabric's env-map response. */
  envIntensity?: number
  /** Reports the normalized garment height (inches) for floor/shadow layout. */
  onMeasured?: (heightIn: number) => void
}

export function GarmentModel({
  garment,
  colorHex,
  garmentWidthIn,
  sizeId,
  front,
  back,
  sleeve,
  areaOffsetYIn,
  envIntensity = 1,
  onMeasured,
}: GarmentModelProps) {
  const { geometry, material, heightIn } = useNormalizedGarment(garment, garmentWidthIn, sizeId)

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
    onMeasured?.(heightIn)
  }, [heightIn, onMeasured])

  return (
    <mesh geometry={geometry} material={material}>
      {front && (
        <PrintDecal
          geometry={geometry}
          garment={garment}
          side="front"
          source={front}
          offsetYIn={areaOffsetYIn?.front ?? 0}
        />
      )}
      {back && (
        <PrintDecal
          geometry={geometry}
          garment={garment}
          side="back"
          source={back}
          offsetYIn={areaOffsetYIn?.back ?? 0}
        />
      )}
      {sleeve && (
        <>
          <SleeveDecal geometry={geometry} garment={garment} source={sleeve} sign={-1} />
          <SleeveDecal geometry={geometry} garment={garment} source={sleeve} sign={1} />
        </>
      )}
    </mesh>
  )
}
