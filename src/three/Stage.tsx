/**
 * Procedural studio stage for the garment preview: Lightformer softboxes
 * rendered into a 256px environment map (no network HDRs), grounded contact
 * shadows and a damped orbit rig with smooth view-snap animation.
 */
import { useEffect, useMemo, useRef, type ComponentRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Lightformer, OrbitControls } from '@react-three/drei'
import type { ViewSnap } from '@/lib/types'
import type { KeyLightSpec, Scene3DConfig } from '@/scenes'

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

/**
 * The scene's one shadow-casting light, sized to the garment.
 *
 * The environment map is still doing almost all of the shading — this is
 * deliberately a modest key on top of it. Its job is not brightness, it is the
 * OCCLUSION the env map structurally cannot produce: the shadow a sleeve throws
 * on the ribs, the dark inside a hood, the line where a kangaroo pocket lifts
 * off the body. Those are the cues that say "solid object" rather than
 * "airbrushed shell".
 *
 * The shadow camera is derived from the measured garment rather than fixed,
 * because the same rig has to cover a 21 in tee and a 52 in hoodie: a frustum
 * tight enough for the tee clips the hoodie's sleeves out of the shadow map,
 * and one loose enough for the hoodie spends most of the tee's texels on empty
 * space and turns its shadows into stairs.
 *
 * `normalBias` is in WORLD units, which here are inches — 0.06 in is a hair
 * over the fabric and comfortably kills the acne a doubleSided cloth surface
 * produces where it nearly faces the light.
 */
export function KeyLight({ spec, extentIn }: { spec: KeyLightSpec; extentIn: number }) {
  const half = Math.max(14, extentIn * 0.62)
  const distance = Math.max(90, extentIn * 2.4)
  const position = useMemo<[number, number, number]>(() => {
    const v = new THREE.Vector3(...spec.direction)
    if (v.lengthSq() < 1e-6) v.set(-1, 1, 1)
    v.normalize().multiplyScalar(distance)
    return [v.x, v.y, v.z]
  }, [spec.direction, distance])

  return (
    <directionalLight
      position={position}
      intensity={spec.intensity}
      color={spec.color}
      castShadow
      shadow-mapSize-width={2048}
      shadow-mapSize-height={2048}
      shadow-radius={spec.softness}
      shadow-blurSamples={12}
      shadow-bias={-0.0006}
      shadow-normalBias={0.06}
      shadow-camera-near={Math.max(1, distance - half * 2.5)}
      shadow-camera-far={distance + half * 2.5}
      shadow-camera-left={-half}
      shadow-camera-right={half}
      shadow-camera-top={half}
      shadow-camera-bottom={-half}
    />
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
  // drei's ContactShadows memoises two WebGLRenderTargets, a PlaneGeometry and
  // three materials on [resolution, width, height, scale, color] — and disposes
  // NONE of them (there is not one `dispose` call in the module). Passing a
  // size-derived `scale` therefore orphaned two render targets on every garment
  // or size change, unbounded, for the life of the tab.
  //
  // So the shadow rig is built ONCE at unit scale and sized by its PARENT
  // instead: a uniform parent scale transforms the depth camera and its plane
  // together, which is exactly what the `scale` prop does internally — but it
  // never touches a memo dependency, so nothing is ever rebuilt or orphaned.
  // Quantising `scale` was not enough: a tee and a hoodie land in different
  // buckets, so alternating garments still leaked on every swap.
  //
  // `far` is in the rig's LOCAL units, so it must be divided by the parent
  // scale to keep the shadow camera's reach at the same world depth. `blur`
  // works in the render target's pixel space and is scale-invariant.
  const scale = Math.max(1e-3, widthIn * 2.7)
  return (
    <group position={[0, floorY, 0]} scale={scale}>
      <ContactShadows
        opacity={shadowOpacity}
        scale={1}
        blur={2.1}
        far={(heightIn * 0.55) / scale}
        resolution={512}
        color={shadowColor}
      />
    </group>
  )
}

/** Fires onReady on the frame after the first rendered frame, once. */
export function ReadyPing({ onReady }: { onReady?: () => void }) {
  const fired = useRef(false)
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  useFrame(() => {
    if (fired.current) return
    fired.current = true
    // DEV-only render probe. The lighting rig is now the difference between
    // cloth and plastic, and every part of it (shadow map type, cast/receive
    // flags, the cavity attribute, the copied aoMap) is invisible in a
    // screenshot when it silently fails to apply. R3F 9 exposes no store on the
    // canvas element, so headless checks have nowhere else to read it from.
    if (import.meta.env.DEV) {
      const lights: unknown[] = []
      const meshes: unknown[] = []
      scene.traverse((o) => {
        const l = o as THREE.DirectionalLight
        if (l.isLight) {
          lights.push({ type: l.type, intensity: l.intensity, cast: !!l.castShadow, radius: l.shadow?.radius ?? null })
        }
        const m = o as THREE.Mesh
        if (m.isMesh) {
          const mat = m.material as THREE.MeshPhysicalMaterial
          meshes.push({
            cast: !!m.castShadow,
            receive: !!m.receiveShadow,
            cavityAttr: !!m.geometry.attributes.color,
            vertexColors: !!mat.vertexColors,
            aoMap: !!mat.aoMap,
            normalScale: mat.normalScale?.x ?? null,
            sheen: mat.sheen ?? null,
          })
        }
      })
      ;(window as unknown as { __scene3d?: unknown }).__scene3d = {
        shadows: { enabled: gl.shadowMap.enabled, type: gl.shadowMap.type },
        toneMapping: gl.toneMapping,
        lights,
        meshes,
      }
    }
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

/**
 * Head-room around the garment at the framed distance.
 *
 * 1.12, down from 1.22. The framed target is the CHART'S BIGGEST size and the
 * preview usually shows a smaller one, so a generous margin here is air around
 * air: it was leaving an M hoodie sitting in the middle of the pane like a
 * thumbnail. Trimming the constant is the only lever that helps without
 * touching the framed target itself — making the distance follow the previewed
 * size would erase the size difference the selector exists to show, which
 * scripts/board-verify.mjs asserts (it caught exactly that attempt).
 */
const FIT_MARGIN = 1.12
/**
 * Head-room around the SLEEVE SPAN. Exactly 1: the span is a hard "must not be
 * cropped" bound, not something that deserves air around it. A measured 3XL
 * hoodie is 52.5 in wide but only 26 in through the body, so giving the arm
 * tips the same margin as the body pushes the camera 20% further back than it
 * has to be — which is exactly how a hoodie ended up reading SMALLER on screen
 * than a tee it dwarfs in real life.
 */
const EDGE_MARGIN = 1.0

/**
 * Viewing distance that frames a garment of these inches. Garments are scaled to
 * REAL inches, so a fixed distance either crops the big ones or strands the
 * small ones — the rig re-fits whenever the measured mesh changes, until the
 * user takes the controls.
 *
 * `torsoWidthIn` is what the framing is ABOUT: the body a customer is looking
 * at, not the arm span an A-pose adds to the bounding box. It gets the generous
 * margin; the full span only has to fit. In a portrait pane that is the
 * difference between a garment that fills the frame and one that floats in it.
 * Omitted ⇒ the whole width is treated as body (correct for a flat card).
 */
export function fitRadius(
  heightIn: number,
  fovDeg: number,
  aspect: number,
  widthIn = 0,
  torsoWidthIn = widthIn,
): number {
  const halfV = Math.tan((fovDeg * Math.PI) / 360)
  const halfH = halfV * Math.max(aspect, 0.2)
  const span = Math.max(0, widthIn)
  // Never wider than the mesh itself: a chart-derived body width is a
  // laid-flat measure and the projected torso is narrower still.
  const torso = Math.min(Math.max(0, torsoWidthIn), span)
  return Math.max(
    24,
    (heightIn * FIT_MARGIN) / 2 / halfV,
    (torso * FIT_MARGIN) / 2 / halfH,
    (span * EDGE_MARGIN) / 2 / halfH,
  )
}

export interface CameraRigProps {
  viewRequest: { view: ViewSnap; nonce: number } | null
  autoRotate: boolean
  reducedMotion: boolean
  /** Measured garment extents (inches) — the camera frames to these. */
  fitHeightIn?: number
  fitWidthIn?: number
  /** Body width without the A-pose arm span — what the framing is about. */
  fitTorsoWidthIn?: number
}

export function CameraRig({
  viewRequest,
  autoRotate,
  reducedMotion,
  fitHeightIn,
  fitWidthIn,
  fitTorsoWidthIn,
}: CameraRigProps) {
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null)
  const camera = useThree((s) => s.camera)
  const goal = useRef<THREE.Spherical | null>(null)
  // Seed with the CURRENT nonce so an old request doesn't replay (and snap
  // the camera uninvited) every time the user re-enters 3D mode.
  const lastNonce = useRef<number | null>(viewRequest?.nonce ?? null)
  // The auto-fit is a first-impression convenience, not a leash: once the user
  // has orbited or zoomed, their distance is theirs and we stop touching it.
  const userTook = useRef(false)
  const fitted = useRef(0)

  // The framing depends on the canvas shape, so it must re-run when the canvas
  // is reshaped. R3F's initial camera aspect is 1 until its resize observer
  // fires, and a pane that opens narrow and widens (or a phone rotating) would
  // otherwise keep a distance computed for a viewport that no longer exists.
  const size = useThree((s) => s.size)
  const perspective = camera as THREE.PerspectiveCamera
  const radiusFor = (h: number, w: number) =>
    fitRadius(h, perspective.fov ?? 26, perspective.aspect ?? 1, w, fitTorsoWidthIn ?? w)
  const framed = radiusFor(fitHeightIn ?? 0, fitWidthIn ?? 0)

  useEffect(() => {
    if (userTook.current || !fitHeightIn) return
    const radius = radiusFor(fitHeightIn, fitWidthIn ?? 0)
    if (Math.abs(radius - fitted.current) < 0.5) return
    fitted.current = radius
    const dir = camera.position.length() > 1e-3 ? camera.position.clone().normalize() : new THREE.Vector3(0, 0, 1)
    camera.position.copy(dir.multiplyScalar(radius))
    const controls = controlsRef.current
    if (controls) {
      controls.target.set(0, 0, 0)
      controls.update()
    }
    // radiusFor reads fov/aspect off the live camera, and `size` is what makes
    // the aspect change — so depending on it is what makes this correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitHeightIn, fitWidthIn, fitTorsoWidthIn, camera, size])

  useEffect(() => {
    if (!viewRequest || viewRequest.nonce === lastNonce.current) return
    lastNonce.current = viewRequest.nonce
    // Keep the user's current distance (clamped around the framed one) and
    // swing around to the requested side.
    const fit = fitted.current || camera.position.length()
    const radius = THREE.MathUtils.clamp(camera.position.length(), fit * 0.6, fit * 1.6)
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
      userTook.current = true
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
      minDistance={20}
      // Never below the framed distance: OrbitControls.update() clamps whatever
      // the auto-fit just set, so a fixed ceiling would silently crop the very
      // case the fit exists for (a 3XL hoodie, ~52 in across, in a tall narrow
      // pane needs ~280 already).
      maxDistance={Math.max(280, framed * 1.6)}
      minPolarAngle={0.35}
      maxPolarAngle={1.62}
      autoRotate={autoRotate}
      autoRotateSpeed={1.05}
    />
  )
}

const ORIGIN = new THREE.Vector3(0, 0, 0)
const SPHERICAL = new THREE.Spherical()
