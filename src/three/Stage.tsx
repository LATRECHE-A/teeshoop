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
import type { Scene3DConfig } from '@/scenes'

/**
 * Procedural softbox rig baked into a 256px env map (no network HDRs). The
 * light set comes from the active scene (studio / beach / forest / …) so the
 * garment picks up that environment's key, fills, rims and colour. Positions
 * are in the environment's own virtual scene (not garment inches).
 *
 * Mount this with `key={sceneId}` so switching scenes re-bakes the map.
 */
export function SceneEnvironment({ config }: { config: Scene3DConfig }) {
  return (
    <Environment resolution={256} frames={1}>
      {config.lightformers.map((lf, i) => (
        <Lightformer
          key={i}
          form={lf.form ?? 'rect'}
          intensity={lf.intensity}
          color={lf.color}
          position={lf.position}
          scale={lf.scale}
          target={lf.target ?? [0, 0, 0]}
        />
      ))}
    </Environment>
  )
}

export function Floor({
  heightIn,
  widthIn,
  shadowColor = '#000000',
  shadowOpacity = 0.58,
}: {
  heightIn: number
  widthIn: number
  shadowColor?: string
  shadowOpacity?: number
}) {
  const floorY = -(heightIn / 2) - 1.1
  return (
    <ContactShadows
      position={[0, floorY, 0]}
      opacity={shadowOpacity}
      scale={widthIn * 2.7}
      blur={2.1}
      far={heightIn * 0.55}
      resolution={512}
      color={shadowColor}
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
  const goal = useRef<THREE.Spherical | null>(null)
  // Seed with the CURRENT nonce so an old request doesn't replay (and snap
  // the camera uninvited) every time the user re-enters 3D mode.
  const lastNonce = useRef<number | null>(viewRequest?.nonce ?? null)

  useEffect(() => {
    if (!viewRequest || viewRequest.nonce === lastNonce.current) return
    lastNonce.current = viewRequest.nonce
    // Keep the user's current distance (clamped to a pleasant range) and
    // swing around to the requested side.
    const radius = THREE.MathUtils.clamp(camera.position.length(), 48, 96)
    const target = new THREE.Spherical(radius, VIEW_POLAR[viewRequest.view], VIEW_AZIMUTH[viewRequest.view])
    if (reducedMotion) {
      camera.position.setFromSpherical(target)
      const controls = controlsRef.current
      if (controls) {
        controls.target.set(0, 0, 0)
        controls.update()
      }
    } else {
      goal.current = target
    }
  }, [viewRequest, camera, reducedMotion])

  // Smooth exponential damp toward the requested view — in SPHERICAL space,
  // so the camera arcs around the garment instead of cutting straight
  // through it (and never jump-cuts).
  useFrame((_, delta) => {
    const controls = controlsRef.current
    if (!goal.current || !controls) return
    const current = SPHERICAL.setFromVector3(camera.position)
    const wrap = (a: number) => THREE.MathUtils.euclideanModulo(a + Math.PI, Math.PI * 2) - Math.PI
    const dTheta = wrap(goal.current.theta - current.theta)
    const dPhi = goal.current.phi - current.phi
    const dRadius = goal.current.radius - current.radius
    const k = 1 - Math.exp(-Math.min(delta, 0.05) * 6)
    current.theta += dTheta * k
    current.phi += dPhi * k
    current.radius += dRadius * k
    camera.position.setFromSpherical(current)
    controls.target.lerp(ORIGIN, k)
    // Re-aim immediately: OrbitControls only re-orients on ITS update pass,
    // which may run before this write — without this, slow frames render one
    // step with a stale orientation and the garment "vanishes" mid-snap.
    camera.lookAt(controls.target)
    if (Math.abs(dTheta) < 0.02 && Math.abs(dPhi) < 0.02 && Math.abs(dRadius) < 0.5) {
      goal.current = null
      controls.update()
    }
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

  // dev-only pose probe for headless debugging
  useFrame(() => {
    if (import.meta.env.DEV) {
      ;(window as unknown as { __pose?: unknown }).__pose = {
        cam: camera.position.toArray().map((n) => Math.round(n * 10) / 10),
        tgt: controlsRef.current?.target.toArray().map((n) => Math.round(n * 10) / 10),
        goal: goal.current
          ? { r: goal.current.radius, phi: goal.current.phi, theta: goal.current.theta }
          : null,
      }
    }
  })

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
const SPHERICAL = new THREE.Spherical()
