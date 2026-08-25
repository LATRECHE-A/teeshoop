/**
 * Procedural studio stage for the garment preview: Lightformer softboxes
 * rendered into a 256px environment map (no network HDRs), grounded contact
 * shadows and a damped orbit rig with smooth view-snap animation.
 */
import { useEffect, useMemo, useRef, type ComponentRef, type RefObject } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Lightformer, OrbitControls } from '@react-three/drei'
import type { CatalogGarmentId, GarmentId, ViewSnap } from '@/lib/types'
import { SIZE_IDS, garmentWidthInFor } from '@/content/sizeChart'
import type { GroundSpec, KeyLightSpec, RimLightSpec, Scene3DConfig } from '@/scenes'

/**
 * Procedural softbox rig baked into a 256px env map (no network HDRs). The
 * light set comes from the active scene (studio / beach / forest / …) so the
 * garment picks up that environment's key, fills, rims and colour. Positions
 * are in the environment's own virtual scene (not garment inches).
 *
 * Mount this with `key={sceneId}` so switching scenes re-bakes the map.
 */
export function SceneEnvironment({ config, resolution = 512 }: { config: Scene3DConfig; resolution?: number }) {
  return (
    // 512, up from 256: the sheen lobe integrates the env map at grazing
    // angles, and at 256 the softbox edges band visibly across a smooth
    // garment chest. One-time bake per scene switch.
    //
    // This was briefly reverted on the theory that the 4x pixel cost pushed
    // the first 3D mount past e2e-verify's readiness budget under software
    // rendering. That was a false lead, and the measurements are recorded here
    // so it is not "fixed" the same way again: a controlled A/B of the 3D
    // mount (3 runs each, same box) came out 29.3/17.3/14.9 s at 256 against
    // 28.4/13.5/13.9 s at 512 — i.e. no cost at all, the spread is machine
    // load. The real cause was that the suite's own 60 s gate straddled a
    // mount that takes 58-66 s under swiftshader, so it failed as a coin flip
    // on BOTH the changed and the unchanged tree. Fixed in e2e-verify.mjs.
    <Environment resolution={resolution} frames={1}>
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
 * The garment's measured extents, in inches, shared as a MUTABLE BOX.
 *
 * `heightIn`/`widthIn` are the PREVIEWED size (the floor's shadow is that
 * garment's own footprint). `fitHeightIn`/`fitWidthIn` are the biggest size in
 * the chart, which is what the camera frames, so switching S↔3XL changes the
 * garment on screen instead of the viewing distance.
 *
 * Why a box and not React state: see the comment on `extent` in ./index.tsx.
 * The writer lives inside the R3F root and so do both readers, but the state
 * that joined them lived in the DOM root, and on the shipped tree the camera
 * was measurably still framing the seed after the garment had loaded.
 */
export interface MeasuredExtent {
  heightIn: number
  widthIn: number
  fitHeightIn: number
  fitWidthIn: number
  /** False until a garment has reported. The seed is a placeholder, not a fact. */
  measured: boolean
}

/** Placeholder until the first garment reports: a mid-size tee, roughly. */
export const SEED_EXTENT: MeasuredExtent = {
  heightIn: 28,
  widthIn: 24,
  fitHeightIn: 28,
  fitWidthIn: 24,
  measured: false,
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
export function KeyLight({
  spec,
  extent,
  mapSize,
}: {
  spec: KeyLightSpec
  extent: RefObject<MeasuredExtent>
  /** Shadow-map edge. Halved on a phone, where it is the single most expensive
   *  thing in the frame (see PROFILE in ./index.tsx). */
  mapSize: number
}) {
  const light = useRef<THREE.DirectionalLight>(null)
  const dir = useMemo(() => {
    const v = new THREE.Vector3(...spec.direction)
    if (v.lengthSq() < 1e-6) v.set(-1, 1, 1)
    return v.normalize()
  }, [spec.direction])

  // Follow the measurement per frame, like the camera and the floor do: the
  // frustum has to cover the garment that is actually there, and a garment
  // reported after the last React render would otherwise be lit by a rig sized
  // for the seed, which on a hoodie clips the sleeves out of the shadow map.
  useFrame(() => {
    const l = light.current
    if (!l) return
    const e = extent.current
    const extentIn = Math.max(e.fitHeightIn, e.fitWidthIn)
    const half = Math.max(14, extentIn * 0.62)
    const distance = Math.max(90, extentIn * 2.4)
    const cam = l.shadow.camera
    if (cam.right === half && l.position.lengthSq() > 0 && Math.abs(l.position.length() - distance) < 1e-6) return
    l.position.copy(dir).multiplyScalar(distance)
    cam.left = -half
    cam.right = half
    cam.top = half
    cam.bottom = -half
    cam.near = Math.max(1, distance - half * 2.5)
    cam.far = distance + half * 2.5
    cam.updateProjectionMatrix()
  })

  return (
    <directionalLight
      ref={light}
      intensity={spec.intensity}
      color={spec.color}
      castShadow
      shadow-mapSize-width={mapSize}
      shadow-mapSize-height={mapSize}
      shadow-radius={spec.softness}
      shadow-blurSamples={12}
      shadow-bias={-0.0006}
      shadow-normalBias={0.06}
    />
  )
}

/**
 * The separation light. No shadow map, no frustum, no cost beyond one more
 * light in the loop: its whole job is to put a value on the surfaces that face
 * away from the key, which is every surface at the silhouette.
 */
export function RimLight({ spec, extent }: { spec: RimLightSpec; extent: RefObject<MeasuredExtent> }) {
  const light = useRef<THREE.DirectionalLight>(null)
  const dir = useMemo(() => {
    const v = new THREE.Vector3(...spec.direction)
    if (v.lengthSq() < 1e-6) v.set(1, 1, -1)
    return v.normalize()
  }, [spec.direction])
  useFrame(() => {
    const l = light.current
    if (!l) return
    const distance = Math.max(90, Math.max(extent.current.fitHeightIn, extent.current.fitWidthIn) * 2.4)
    if (Math.abs(l.position.length() - distance) < 1e-6) return
    l.position.copy(dir).multiplyScalar(distance)
  })
  return <directionalLight ref={light} intensity={spec.intensity} color={spec.color} castShadow={false} />
}

/**
 * A radial alpha ramp, generated once: opaque under the garment, gone by the
 * rim, so the ground never shows an edge and never needs a horizon.
 *
 * The stops are not a curve fit, they are the two things the ramp has to do:
 * stay flat where the contact shadow lands (the shadow must darken a CONSTANT
 * value, or the ramp's own gradient reads as part of the shadow) and be gone
 * long before the disc's rim. At radiusFactor 7 the flat core reaches 0,11 of
 * the radius, which is 0,77 of the garment's own width: wider than any contact
 * shadow it throws, and the ramp is at zero by the rim.
 */
function groundAlphaTexture(): THREE.CanvasTexture {
  const SIZE = 256
  const c = document.createElement('canvas')
  c.width = SIZE
  c.height = SIZE
  const x = c.getContext('2d')
  if (x) {
    const g = x.createRadialGradient(SIZE / 2, SIZE / 2, 0, SIZE / 2, SIZE / 2, SIZE / 2)
    g.addColorStop(0, '#ffffff')
    g.addColorStop(0.11, '#ffffff')
    g.addColorStop(0.3, '#a8a8a8')
    g.addColorStop(0.6, '#242424')
    g.addColorStop(1, '#000000')
    x.fillStyle = g
    x.fillRect(0, 0, SIZE, SIZE)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.NoColorSpace
  t.needsUpdate = true
  return t
}

/**
 * The floor. See GroundSpec in src/scenes for why there was none and what that
 * cost: a contact shadow drawn onto a transparent canvas over a #0c0f13 page is
 * black on black, which is why not one render in this repository contained a
 * shadow pixel while the shadow rig was mounted and in frame the whole time.
 */
export function Ground({
  spec,
  theme,
  extent,
}: {
  spec: GroundSpec
  theme: 'dark' | 'light'
  extent: RefObject<MeasuredExtent>
}) {
  const mesh = useRef<THREE.Mesh>(null)
  const alphaMap = useMemo(groundAlphaTexture, [])
  useEffect(() => () => alphaMap.dispose(), [alphaMap])
  const color = (theme === 'light' && spec.colorLight) || spec.color
  useFrame(() => {
    const m = mesh.current
    if (!m) return
    const e = extent.current
    const y = -(e.heightIn / 2) - 1.1
    const r = Math.max(1e-3, e.widthIn * spec.radiusFactor)
    if (m.position.y !== y) m.position.y = y
    if (m.scale.x !== r) m.scale.set(r, r, 1)
  })
  return (
    <mesh
      ref={mesh}
      rotation-x={-Math.PI / 2}
      userData={{ role: 'ground' }}
      position={[0, SEED_EXTENT.heightIn / -2 - 1.1, 0]}
      scale={[SEED_EXTENT.widthIn * spec.radiusFactor, SEED_EXTENT.widthIn * spec.radiusFactor, 1]}
      receiveShadow
      renderOrder={-1}
    >
      {/* Unit circle, scaled by the parent: one geometry for every garment. */}
      <circleGeometry args={[1, 96]} />
      <meshStandardMaterial
        color={color}
        roughness={spec.roughness}
        metalness={0}
        alphaMap={alphaMap}
        transparent
        // The ground is behind everything and never occludes the garment; not
        // writing depth keeps it out of the transparent sort entirely.
        depthWrite={false}
      />
    </mesh>
  )
}

/**
 * How far the shadow camera reaches up the garment, in the rig's LOCAL units.
 *
 * It used to be derived from the measured height, which put a measured value in
 * a drei memo dependency, and drei's ContactShadows disposes nothing, so every
 * garment and every size change orphaned two render targets. A constant that
 * covers both garments (0,30 local ≈ 20 in on a tee, 32 in on a hoodie, the whole
 * lower body of each) takes the measurement out of that dependency list.
 *
 * WHAT IS LEFT, so nobody reads this as "fixed": `color` is still a dependency
 * and the six scenes carry six shadow tints, so flipping through the scene
 * picker still orphans a pair of render targets per switch. That is bounded by
 * six. The unbounded one, which grew with every size click, is gone.
 */
const CONTACT_FAR_LOCAL = 0.3

export function Floor({
  extent,
  shadowColor = '#000000',
  shadowOpacity = 0.58,
}: {
  extent: RefObject<MeasuredExtent>
  shadowColor?: string
  shadowOpacity?: number
}) {
  const group = useRef<THREE.Group>(null)
  // Follow the measurement per frame rather than per render: the writer is the
  // garment, inside this same root, and there is no scheduler between us.
  useFrame(() => {
    const g = group.current
    if (!g) return
    const e = extent.current
    const scale = Math.max(1e-3, e.widthIn * 2.7)
    // A hair above the ground plane, which now sits at exactly this height.
    const floorY = -(e.heightIn / 2) - 1.1 + 0.02
    if (g.position.y !== floorY) g.position.y = floorY
    if (g.scale.x !== scale) g.scale.setScalar(scale)
  })
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
  return (
    <group ref={group} userData={{ role: 'shadow' }} position={[0, SEED_EXTENT.heightIn / -2 - 1.1 + 0.02, 0]} scale={SEED_EXTENT.widthIn * 2.7}>
      <ContactShadows
        opacity={shadowOpacity}
        scale={1}
        blur={2.1}
        far={CONTACT_FAR_LOCAL}
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

  // DEV-only per-frame cost probe, for scripts/frame-bench.mjs. Draw calls,
  // triangles and programs are the numbers that TRAVEL between machines: a
  // millisecond measured on a software rasteriser says nothing about a phone,
  // and this file's history is full of numbers that were quoted as if it did.
  useFrame(() => {
    if (!import.meta.env.DEV) return
    // MANUAL RESET. three clears `info.render` at the top of every `render()`,
    // and this callback runs before it, so with `autoReset` left on the counters
    // read as zero however busy the frame was: the first run of
    // scripts/frame-bench.mjs reported "0 draw calls, 0 triangles" beside a
    // 6,5 second frame. Turning it off and resetting here makes the numbers the
    // totals for exactly one frame.
    gl.info.autoReset = false
    // A FRAME COUNTER, so a headless probe can wait for a change to have been
    // DRAWN rather than for a timer. Under software rendering one frame can take
    // seconds: scripts/render-verify.mjs hid the floor, waited 350 ms and read
    // back a frame in which the floor was still there, so its "garment only"
    // layer was the floor and every measurement taken off that mask was about
    // the wrong object.
    const w = window as unknown as { __frames?: number; __renderInfo?: unknown }
    w.__frames = (w.__frames ?? 0) + 1
    w.__renderInfo = {
      calls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      programs: gl.info.programs?.length ?? 0,
      textures: gl.info.memory.textures,
      geometries: gl.info.memory.geometries,
      shadowMapSize: (() => {
        let n = 0
        scene.traverse((o) => {
          const l = o as THREE.DirectionalLight
          if (l.isDirectionalLight && l.castShadow) n = Math.max(n, l.shadow.mapSize.width)
        })
        return n
      })(),
    }
    gl.info.reset()
  })
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
      // Isolate a layer of the stage, for a headless probe that has to tell the
      // GARMENT's silhouette from the FLOOR's. Since the floor was added, the
      // opaque part of the frame is the floor, so a measurement that assumed
      // "opaque = garment" now measures the stage. Objects carry a role in
      // userData; this turns one off and leaves the render otherwise identical.
      ;(window as unknown as { __stage?: unknown }).__stage = {
        show: (role: string, on: boolean) => {
          let n = 0
          scene.traverse((o) => {
            if (o.userData?.role === role) {
              o.visible = on
              n++
            }
          })
          return n
        },
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

/**
 * Body width (inches) of the garment the camera is framing, WITHOUT the arm
 * span an A-pose adds to the bounding box. Read off the size chart's laid-flat
 * half-chest at the biggest size, because that is the same size the camera
 * frames to (see GarmentFrame.fitWidthIn), and because a laid-flat width is a
 * safe upper bound on the projected torso, which curves away from the viewer.
 * A ship-your-own garment is a flat card with no sleeves: its whole width IS
 * the body.
 */
function torsoWidthIn(garment: GarmentId, fallbackIn: number): number {
  if (garment === 'custom') return fallbackIn
  return garmentWidthInFor(garment as CatalogGarmentId, SIZE_IDS[SIZE_IDS.length - 1])
}

/**
 * How much of the vertical slack goes UNDER the garment rather than around it.
 *
 * A garment framed dead centre in a pane whose limiting dimension is the arm
 * span leaves a matching band of empty stage above and below it, and the band
 * below is where the thing that says "this is an object in a place" belongs:
 * its own contact shadow. Aiming the camera slightly below the garment's centre
 * spends that slack on ground instead of on symmetry. It is CLAMPED to the
 * slack that actually exists, so it can never crop the biggest size the rig is
 * framing, which is the invariant scripts/board-verify.mjs check G defends.
 */
const GROUND_ROOM_FRAC = 0.1

export interface CameraRigProps {
  viewRequest: { view: ViewSnap; nonce: number } | null
  autoRotate: boolean
  reducedMotion: boolean
  /** The measured garment, shared as a box (see MeasuredExtent). */
  extent: RefObject<MeasuredExtent>
  garment: GarmentId
}

export function CameraRig({
  viewRequest,
  autoRotate,
  reducedMotion,
  extent,
  garment,
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
  const scene = useThree((s) => s.scene)
  const perspective = camera as THREE.PerspectiveCamera
  const radiusFor = (h: number, w: number) =>
    fitRadius(h, perspective.fov ?? 26, perspective.aspect ?? 1, w, torsoWidthIn(garment, w))
  /**
   * The framed distance AT RENDER TIME, which is only ever the seed's.
   *
   * The extents are a box now, so this component does not re-render when the
   * measurement lands: read here, it is whatever the last render saw. It
   * survives as the SEED for the orbit ceiling below; the live value is set in
   * `applyFit`, and the pose probe recomputes it per frame rather than
   * publishing this one. That distinction is not cosmetic: the first version
   * published the stale number, and the capture harness, which waits for "the
   * applied radius equals the wanted one", sat for five minutes comparing a
   * tee's 77,03 against a hoodie's 123,03 left over from the previous case.
   */
  const framedSeed = radiusFor(extent.current.fitHeightIn, extent.current.fitWidthIn)

  /** Where the camera looks: below the garment's centre by the clamped slack. */
  const aimY = (radius: number, fitHeightIn: number) => {
    const halfV = Math.tan(((perspective.fov ?? 26) * Math.PI) / 360)
    const slack = Math.max(0, halfV * radius - fitHeightIn / 2)
    return -Math.min(slack, halfV * radius * GROUND_ROOM_FRAC)
  }

  /**
   * How far the garment's SILHOUETTE sits off the view axis, in inches along the
   * camera's own right vector.
   *
   * The mesh is centred on its bounding box, so its box is symmetric about the
   * origin and a camera aimed there is, by construction, aimed at the centre of
   * the BOX. The silhouette is not the box: at the three-quarter view the near
   * sleeve projects further than the far one, and measured on the shipped
   * preview the garment sat 4,3 % of the pane width left of centre, with 108 px
   * of air on one side and 178 on the other. A photographer recomposes; this is
   * that, measured off the vertices rather than nudged by a constant.
   *
   * Sampled with a stride: 2 000-odd points bound the projected extent to well
   * under a pixel, and this runs once per fit, not per frame.
   */
  const projectedCentreOffset = (): number => {
    let lo = Infinity
    let hi = -Infinity
    camera.updateMatrixWorld()
    scene.traverse((o) => {
      if (o.userData?.role !== 'garment') return
      o.traverse((child) => {
        const mesh = child as THREE.Mesh
        const pos = mesh.isMesh ? (mesh.geometry?.getAttribute('position') as THREE.BufferAttribute | undefined) : undefined
        if (!pos) return
        mesh.updateWorldMatrix(true, false)
        const stride = Math.max(1, Math.floor(pos.count / 2000))
        for (let i = 0; i < pos.count; i += stride) {
          // NDC, not a world-space projection onto the right vector: the two
          // differ under perspective, because a vertex nearer the camera covers
          // more of the frame per inch. Measured, the world-space version left
          // 2,9 % of the offset behind: the near sleeve is exactly the vertex
          // the difference is largest on.
          V.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).project(camera)
          if (V.x < lo) lo = V.x
          if (V.x > hi) hi = V.x
        }
      })
    })
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return 0
    // NDC half-width back to inches at the target's distance.
    const halfV = Math.tan(((perspective.fov ?? 26) * Math.PI) / 360)
    const dist = camera.position.distanceTo(controlsRef.current?.target ?? ORIGIN_V)
    return ((lo + hi) / 2) * halfV * Math.max(perspective.aspect ?? 1, 0.2) * dist
  }

  const applyFit = (radius: number) => {
    fitted.current = radius
    const controls = controlsRef.current
    // FROM THE TARGET, not from the origin. The rig aims below the garment's
    // centre and recomposes sideways, so `camera.position` carries that offset;
    // normalising it as if it were an orbit vector folds the offset back into
    // the DIRECTION, and every subsequent re-fit tilts a little further down and
    // a little further sideways. A window the customer drags wider re-fits on
    // every resize event, so the drift is not theoretical: it walks the view
    // into the polar limit and stays there for the session.
    const from = DIR.copy(camera.position).sub(controls ? controls.target : ORIGIN_V)
    const dir = from.lengthSq() > 1e-6 ? from.normalize() : from.set(0, 0, 1)
    const y = aimY(radius, extent.current.fitHeightIn)
    camera.position.copy(dir).multiplyScalar(radius).add(AIM.set(0, y, 0))
    if (controls) {
      controls.target.set(0, y, 0)
      controls.update()
      // The orbit ceiling has to follow the garment too: it is derived from the
      // framed distance, and this component no longer re-renders when the
      // measurement lands (the extents are a box, not state), so the value
      // computed during render is the seed's.
      controls.maxDistance = Math.max(280, radius * 1.6)
    }
    recompose()
  }

  /**
   * Slide the view sideways until the silhouette is centred. One pass: the
   * offset is a few per cent of the frame, so re-projecting after the move
   * changes it by less than the sampling stride already costs.
   */
  const recompose = () => {
    const controls = controlsRef.current
    if (!controls || userTook.current) return
    const dx = projectedCentreOffset()
    if (Math.abs(dx) < 1e-3) return
    const right = RIGHT.setFromMatrixColumn(camera.matrixWorld, 0).normalize().multiplyScalar(dx)
    controls.target.add(right)
    camera.position.add(right)
    controls.update()
  }

  // THE FIT RUNS ON A FRAME, not on an effect keyed to a prop.
  //
  // The measurement is written by the garment, which lives in this same root; a
  // prop would carry it out through the DOM root's state and back, and measured
  // on the shipped tree that round trip did not arrive: the rig was still
  // framing the seed {28, 24} after `ready`, so a hoodie that asks to be viewed
  // from 123,0 in was rendered from 67,9 and filled the pane edge to edge.
  // Polling the box removes the scheduler from between the two.
  //
  // `size` still matters (a reshaped pane changes the aspect and therefore the
  // distance), and reading it as state is what re-renders this component so the
  // closure below sees the new aspect.
  void size
  useFrame(() => {
    if (userTook.current || !extent.current.measured) return
    const radius = radiusFor(extent.current.fitHeightIn, extent.current.fitWidthIn)
    if (Math.abs(radius - fitted.current) < 0.5) return
    applyFit(radius)
  })

  useEffect(() => {
    if (!viewRequest || viewRequest.nonce === lastNonce.current) return
    lastNonce.current = viewRequest.nonce
    // Swing around to the requested side at the FRAMED distance while the fit
    // still owns the camera. Reading `camera.position.length()` instead was a
    // race with the measurement: a snap issued before the garment reported
    // captured the seed distance as its goal, and the damp loop below then
    // pulled the camera back off the fitted radius onto it.
    const fit = fitted.current || camera.position.length()
    const radius = userTook.current
      ? THREE.MathUtils.clamp(camera.position.length(), fit * 0.6, fit * 1.6)
      : fit
    const target = new THREE.Spherical(radius, VIEW_POLAR[viewRequest.view], VIEW_AZIMUTH[viewRequest.view])
    if (reducedMotion) {
      camera.position.setFromSpherical(target)
      const controls = controlsRef.current
      const y = aimY(radius, extent.current.fitHeightIn)
      camera.position.y += y
      if (controls) {
        controls.target.set(0, y, 0)
        controls.update()
      }
      recompose()
    } else {
      goal.current = target
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewRequest, camera, reducedMotion])

  // Smooth exponential damp toward the requested view — in SPHERICAL space,
  // so the camera arcs around the garment instead of cutting straight
  // through it (and never jump-cuts).
  useFrame((_, delta) => {
    const controls = controlsRef.current
    if (!goal.current || !controls) return
    // Spherical AROUND THE AIM POINT, not around the origin. The rig now looks
    // slightly below the garment so its contact shadow has room (GROUND_ROOM_FRAC);
    // measuring the orbit from the origin would have the damp quietly drag the
    // camera back down onto it, and the ground would leave the frame again.
    const aim = AIM.set(0, aimY(goal.current.radius, extent.current.fitHeightIn), 0)
    const current = SPHERICAL.setFromVector3(OFFSET.copy(camera.position).sub(controls.target))
    const wrap = (a: number) => THREE.MathUtils.euclideanModulo(a + Math.PI, Math.PI * 2) - Math.PI
    const dTheta = wrap(goal.current.theta - current.theta)
    const dPhi = goal.current.phi - current.phi
    const dRadius = goal.current.radius - current.radius
    const k = 1 - Math.exp(-Math.min(delta, 0.05) * 6)
    current.theta += dTheta * k
    current.phi += dPhi * k
    current.radius += dRadius * k
    controls.target.lerp(aim, k)
    camera.position.setFromSpherical(current).add(controls.target)
    // Re-aim immediately: OrbitControls only re-orients on ITS update pass,
    // which may run before this write — without this, slow frames render one
    // step with a stale orientation and the garment "vanishes" mid-snap.
    camera.lookAt(controls.target)
    if (Math.abs(dTheta) < 0.02 && Math.abs(dPhi) < 0.02 && Math.abs(dRadius) < 0.5) {
      goal.current = null
      controls.target.copy(aim)
      controls.update()
      // The new side has its own silhouette: a front view is symmetric, a
      // three-quarter one is not, so the composition is re-made per view.
      recompose()
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

  // dev-only pose probe for headless debugging. It carries the framing INPUTS
  // as well as the camera, because a preview framed on the placeholder extents
  // and one framed on the measured mesh are indistinguishable in a screenshot
  // until you know which radius was asked for.
  useFrame(() => {
    if (import.meta.env.DEV) {
      ;(window as unknown as { __pose?: unknown }).__pose = {
        cam: camera.position.toArray().map((n) => Math.round(n * 10) / 10),
        r: Math.round(camera.position.length() * 100) / 100,
        tgt: controlsRef.current?.target.toArray().map((n) => Math.round(n * 10) / 10),
        goal: goal.current
          ? { r: goal.current.radius, phi: goal.current.phi, theta: goal.current.theta }
          : null,
        fit: {
          heightIn: extent.current.fitHeightIn,
          widthIn: extent.current.fitWidthIn,
          measured: extent.current.measured,
          wanted:
            Math.round(radiusFor(extent.current.fitHeightIn, extent.current.fitWidthIn) * 100) / 100,
          applied: Math.round(fitted.current * 100) / 100,
          userTook: userTook.current,
          aspect: Math.round((perspective.aspect ?? 0) * 1000) / 1000,
          fov: perspective.fov ?? null,
        },
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
      maxDistance={Math.max(280, framedSeed * 1.6)}
      minPolarAngle={0.35}
      maxPolarAngle={1.62}
      autoRotate={autoRotate}
      autoRotateSpeed={1.05}
    />
  )
}

const SPHERICAL = new THREE.Spherical()
const OFFSET = new THREE.Vector3()
const AIM = new THREE.Vector3()
const RIGHT = new THREE.Vector3()
const V = new THREE.Vector3()
const ORIGIN_V = new THREE.Vector3(0, 0, 0)
const DIR = new THREE.Vector3()
