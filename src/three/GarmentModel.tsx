/**
 * Catalog garment (tee / hoodie) with dimensionally mapped print decals.
 *
 * 1 world unit = 1 inch. The GLB geometry is normalized once per
 * (model, garmentWidthIn): baked to scene orientation, centered on its bbox
 * center and scaled so bboxWidth * widthFraction === garmentWidthIn.
 * Decals are then sized wIn x hIn world units directly, and their center Y is
 * garment-visual-center (y=0) minus areaOffsetYIn (+down ⇒ -y), plus a
 * per-model calibration nudge (src/three/calibration.ts).
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Decal, useGLTF } from '@react-three/drei'
import type { CatalogGarmentId, DecalSource, Side } from '@/lib/types'
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

function useNormalizedGarment(garment: CatalogGarmentId, garmentWidthIn: number): NormalizedGarment {
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
    const scale = garmentWidthIn / (size.x * calib.widthFraction)
    geometry.scale(scale, scale, scale)
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()

    const srcMat = (Array.isArray(src.material) ? src.material[0] : src.material) as THREE.MeshStandardMaterial
    const material = srcMat.clone()
    material.roughness = calib.roughness
    material.metalness = 0
    material.envMapIntensity = calib.envMapIntensity

    return {
      geometry,
      material,
      heightIn: size.y * scale,
      depthIn: size.z * scale,
    }
  }, [gltf, calib, garmentWidthIn])

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
    const depth = Math.max(source.wIn * calib.decalDepthFraction, 0.8)
    const surfaceZ = probeSurfaceZ(geometry, 0, y, side)
    // Bias the thin projection box toward the garment interior so surface
    // that curves away at the decal edges is still inside the box, while the
    // box stays far too shallow to ever reach the opposite side.
    const z = side === 'front' ? surfaceZ - depth * calib.decalInset : surfaceZ + depth * calib.decalInset
    return { y, z, depth }
  }, [geometry, side, offsetYIn, source.wIn, calib])

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

export interface GarmentModelProps {
  garment: CatalogGarmentId
  colorHex: string
  garmentWidthIn: number
  front: DecalSource | null
  back: DecalSource | null
  areaOffsetYIn?: Record<Side, number>
  /** Reports the normalized garment height (inches) for floor/shadow layout. */
  onMeasured?: (heightIn: number) => void
}

export function GarmentModel({
  garment,
  colorHex,
  garmentWidthIn,
  front,
  back,
  areaOffsetYIn,
  onMeasured,
}: GarmentModelProps) {
  const { geometry, material, heightIn } = useNormalizedGarment(garment, garmentWidthIn)

  useEffect(() => {
    material.color.set(colorHex)
  }, [material, colorHex])

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
    </mesh>
  )
}
