/**
 * Procedural studio stage for the garment preview: Lightformer softboxes
 * rendered into a 256px environment map (no network HDRs), grounded contact
 * shadows and a damped orbit rig with smooth view-snap animation.
 */
import { useEffect, useRef, type ComponentRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Lightformer, OrbitControls } from '@react-three/drei'
import type { ViewSnap } from '@/lib/types'

/**
 * Softbox rig, calibrated to match the 2D garment art's lighting: big warm
 * key from the top-left, cool rim from the right/behind, gentle low fill.
 * Positions are in the environment's own virtual scene (not garment inches).
 */
export function StudioEnvironment() {
  return (
    <Environment resolution={256} frames={1}>
      {/* key softbox — top-left, slightly in front */}
      <Lightformer
        form="rect"
        intensity={5.2}
        color="#fff6ec"
        position={[-5.5, 6.5, 6]}
        scale={[8, 5.5, 1]}
        target={[0, 0, 0]}
      />
      {/* cool rim — right, behind the garment */}
      <Lightformer
        form="rect"
        intensity={2.6}
        color="#a9cdff"
        position={[8.5, 2, -5]}
        scale={[3.2, 8, 1]}
        target={[0, 0, 0]}
      />
      {/* gentle fill — low front-right */}
      <Lightformer
        form="rect"
        intensity={1.05}
        color="#e9eef6"
        position={[3.5, -2.5, 7.5]}
        scale={[8, 3.5, 1]}
        target={[0, 0, 0]}
      />
      {/* soft overhead ring for hair-light speculars */}
      <Lightformer
        form="ring"
        intensity={0.7}
        color="#ffffff"
        position={[0, 9, 0.5]}
        scale={6.5}
        target={[0, 0, 0]}
      />
      {/* faint cyan kicker, low left-behind (brand energy) */}
      <Lightformer
        form="rect"
        intensity={0.5}
        color="#35c7ff"
        position={[-8, 0, -6]}
        scale={[2.5, 6, 1]}
        target={[0, 0, 0]}
      />
    </Environment>
  )
}

export function Floor({ heightIn, widthIn }: { heightIn: number; widthIn: number }) {
  const floorY = -(heightIn / 2) - 1.1
  return (
    <ContactShadows
      position={[0, floorY, 0]}
      opacity={0.58}
      scale={widthIn * 2.7}
      blur={2.1}
      far={heightIn * 0.55}
      resolution={512}
      color="#000000"
    />
  )
}

/** Fires onReady on the frame after the first rendered frame, once. */
export function ReadyPing({ onReady }: { onReady?: () => void }) {
  const fired = useRef(false)
  useFrame(() => {
    if (fired.current) return
    fired.current = true
    if (onReady) requestAnimationFrame(() => onReady())
  })
  return null
}

const VIEW_AZIMUTH: Record<ViewSnap, number> = {
  front: 0,
  threequarter: -0.62,
  back: Math.PI,
}
const VIEW_POLAR: Record<ViewSnap, number> = {
  front: 1.42,
  threequarter: 1.36,
  back: 1.42,
}

/** Initial camera position (¾ view) for a given viewing radius. */
export function homeCameraPosition(radius: number): [number, number, number] {
  const v = new THREE.Vector3().setFromSphericalCoords(
    radius,
    VIEW_POLAR.threequarter,
    VIEW_AZIMUTH.threequarter,
  )
  return [v.x, v.y, v.z]
}

export interface CameraRigProps {
  viewRequest: { view: ViewSnap; nonce: number } | null
  autoRotate: boolean
  reducedMotion: boolean
}

export function CameraRig({ viewRequest, autoRotate, reducedMotion }: CameraRigProps) {
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null)
  const camera = useThree((s) => s.camera)
  const goal = useRef<THREE.Vector3 | null>(null)
  const lastNonce = useRef<number | null>(null)

  useEffect(() => {
    if (!viewRequest || viewRequest.nonce === lastNonce.current) return
    lastNonce.current = viewRequest.nonce
    // Keep the user's current distance (clamped to a pleasant range) and
    // swing around to the requested side.
    const radius = THREE.MathUtils.clamp(camera.position.length(), 48, 96)
    const target = new THREE.Vector3().setFromSphericalCoords(
      radius,
      VIEW_POLAR[viewRequest.view],
      VIEW_AZIMUTH[viewRequest.view],
    )
    if (reducedMotion) {
      camera.position.copy(target)
      const controls = controlsRef.current
      if (controls) {
        controls.target.set(0, 0, 0)
        controls.update()
      }
    } else {
      goal.current = target
    }
  }, [viewRequest, camera, reducedMotion])

  // Smooth exponential damp toward the requested view (never a jump-cut).
  useFrame((_, delta) => {
    const controls = controlsRef.current
    if (!goal.current || !controls) return
    const k = 1 - Math.exp(-Math.min(delta, 0.05) * 6)
    camera.position.lerp(goal.current, k)
    controls.target.lerp(ORIGIN, k)
    if (camera.position.distanceToSquared(goal.current) < 0.02) goal.current = null
  })

  // The user grabbing the controls cancels any in-flight snap animation.
  useEffect(() => {
    const controls = controlsRef.current
    if (!controls) return
    const cancel = () => {
      goal.current = null
    }
    controls.addEventListener('start', cancel)
    return () => controls.removeEventListener('start', cancel)
  }, [])

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      enablePan
      minDistance={30}
      maxDistance={150}
      minPolarAngle={0.35}
      maxPolarAngle={1.62}
      autoRotate={autoRotate}
      autoRotateSpeed={1.05}
    />
  )
}

const ORIGIN = new THREE.Vector3(0, 0, 0)
