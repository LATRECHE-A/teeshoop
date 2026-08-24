/**
 * Tshop Studio — module A3: 3D garment preview.
 *
 * Default export `Garment3D` renders the current design on a real 3D garment
 * (tee / hoodie GLB, or a curved photo-card for customer-shipped garments)
 * inside a procedural studio stage. All scene math uses 1 world unit = 1 inch
 * so print decals are dimensionally exact (see src/three/calibration.ts).
 */
import { Suspense, useCallback, useEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import type { Garment3DProps } from '@/lib/types'
import { getScene } from '@/scenes'
import {
  CameraRig,
  Floor,
  Ground,
  KeyLight,
  ReadyPing,
  RimLight,
  SceneEnvironment,
  SEED_EXTENT,
  fitRadius,
  homeCameraPosition,
  type MeasuredExtent,
} from './Stage'
import { GarmentModel } from './GarmentModel'
import { CustomGarment } from './ExtrudedGarment'

export type { Garment3DProps } from '@/lib/types'

/**
 * Real probe for WebGL support (not just API presence). Returns false when
 * context creation fails, e.g. blocklisted drivers or disabled WebGL.
 */
export function isWebGLAvailable(): boolean {
  if (typeof document === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    const gl =
      canvas.getContext('webgl2') ??
      canvas.getContext('webgl') ??
      (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null)
    if (!gl || typeof (gl as WebGLRenderingContext).getParameter !== 'function') return false
    const lose = (gl as WebGLRenderingContext).getExtension('WEBGL_lose_context')
    lose?.loseContext()
    return true
  } catch {
    return false
  }
}

/**
 * What this device can afford, decided once at module load.
 *
 * The board canvas beside this one has had a phone profile since it shipped
 * (src/three/Board3D.tsx:392-434); the PRIMARY preview, the one a customer
 * actually buys from, had none: full 1,75x device pixels, MSAA on, a 2048²
 * variance shadow map re-rendered and re-blurred every frame, and a render loop
 * that never stops. On a mid-range phone that is the difference between a
 * preview that reads as expensive and one that judders and then throttles.
 *
 * THESE NUMBERS ARE A STARTING POINT AND NOT A CLAIM, and nothing in this repo
 * can turn them into one: there is no phone GPU on the build machine, chromium
 * renders through a software rasteriser, and a millisecond measured there says
 * nothing about a Mali or an Adreno. `scripts/frame-bench.mjs` measures what IS
 * portable, the work in one frame (draw calls, triangles, programs) and the
 * desktop-to-phone-profile ratio on one rasteriser, and it says so itself in its
 * own header. Anyone tightening these constants should move that number, not a
 * millisecond figure quoted as a phone.
 */
const MOBILE = typeof matchMedia !== 'undefined' && matchMedia('(max-width: 767.98px)').matches

export const PROFILE = {
  mobile: MOBILE,
  dpr: [1, MOBILE ? 1.25 : 1.75] as [number, number],
  antialias: !MOBILE,
  /** Edge of the directional key's variance shadow map. */
  shadowMapSize: MOBILE ? 1024 : 2048,
  /** Env-map bake edge. The sheen lobe integrates it at grazing angles, so a
   *  small map bands visibly across a smooth chest; a phone pays 4x for it. */
  envResolution: MOBILE ? 256 : 512,
}

/**
 * THE GARMENT DOES NOT FLOAT ANY MORE.
 *
 * It used to hang in a drei <Float>, yawing and pitching up to 1,15 degrees and
 * bobbing 0,18 in on a 20,9 second cycle whose phase was seeded with
 * Math.random(). Three things were wrong with it and only one was aesthetic.
 * A garment bobbing in mid-air is the opposite of the thing this preview is
 * for. It made every capture a different pose, so no before/after comparison in
 * this repository ever compared two like frames and no mockup could be
 * generated twice. And now that the garment stands on a floor, it would drift
 * away from its own shadow, which is a stronger "not real" cue than having no
 * shadow at all.
 *
 * `reducedMotion` is still read: it is what makes a view snap land analytically
 * instead of damping, which the capture harnesses depend on.
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

/** Print registration mark — the brand motif for empty/error states. */
function RegMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={52} height={52} className={className} aria-hidden="true">
      <circle cx="32" cy="32" r="19" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="32" cy="32" r="2.6" fill="currentColor" />
      <path
        d="M32 5v17M32 42v17M5 32h17M42 32h17"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function StateCard({
  title,
  body,
  children,
}: {
  title: string
  body: string
  children?: ReactNode
}) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-bg0">
      <div className="flex max-w-[340px] flex-col items-center gap-4 px-6 text-center">
        <RegMark className="text-tx3" />
        <div className="font-display text-[13px] font-bold uppercase tracking-[0.18em] text-tx">
          {title}
        </div>
        <p className="text-[12.5px] leading-relaxed text-tx2">{body}</p>
        {children}
      </div>
    </div>
  )
}



/**
 * 3D garment preview. Mount it in a sized container; the canvas is
 * transparent so the app's bg0 backdrop shows through.
 */
export default function Garment3D(props: Garment3DProps): JSX.Element {
  const { garment, onReady } = props
  const scene = props.scene ?? 'studio'
  // The studio scene is the one that follows the UI theme, and its FLOOR has to
  // follow it too: a dark disc under a garment on paper is a hole in the page.
  const theme = props.theme ?? 'dark'
  const cfg = getScene(scene).three
  const [webgl] = useState(isWebGLAvailable)
  const [contextLost, setContextLost] = useState(false)
  const [canvasKey, setCanvasKey] = useState(0)
  const reducedMotion = usePrefersReducedMotion()
  // Measured mesh extents, in a MUTABLE BOX rather than in React state.
  //
  // They used to be `useState` in this component, written by the garment (which
  // renders inside the R3F root) and read by the camera rig and the floor (which
  // also render inside it). That round trip goes out of one React root and back
  // into another, and it lost: measured on the shipped tree, the camera was
  // still framing the PLACEHOLDER {28, 24} after the garment was fully loaded
  // and `ready` had fired: the hoodie's silhouette filled the whole 832x900
  // pane, touching all four edges, because it was being viewed from 67,9 in
  // when its own measurement asks for 123,0. It was not deterministic either:
  // the same probe on the same tree reported the placeholder on one run and the
  // measured value on the next, depending on machine load.
  //
  // A box written during render and polled by `useFrame` cannot race: there is
  // no scheduler between the two, and the writer is idempotent (the values are
  // derived from the geometry, so writing them twice writes the same numbers).
  // The FLOOR follows the previewed size (its shadow is the garment's own
  // footprint); the CAMERA frames `fit`, the biggest size in the chart, so
  // switching S↔3XL changes the garment on screen rather than the viewing
  // distance. Garments are scaled to real inches, so a fixed distance would crop.
  const extent = useRef<MeasuredExtent>({ ...SEED_EXTENT })
  const onMeasured = useCallback(
    (heightIn: number, widthIn?: number, fitIn?: { heightIn: number; widthIn: number }) => {
      extent.current.heightIn = heightIn
      extent.current.widthIn = widthIn ?? heightIn * 0.9
      extent.current.fitHeightIn = fitIn?.heightIn ?? heightIn
      extent.current.fitWidthIn = fitIn?.widthIn ?? widthIn ?? heightIn * 0.9
      extent.current.measured = true
    },
    [],
  )

  if (!webgl) {
    return (
      <StateCard
        title="3D preview unavailable"
        body="This browser could not start WebGL, so the garment can't be rendered in 3D. The 2D editor has everything you need — dimensions stay exact."
      />
    )
  }

  if (contextLost) {
    return (
      <StateCard
        title="3D preview stalled"
        body="The graphics context was lost (usually a GPU hiccup or the tab was backgrounded for a while). Your design is safe."
      >
        <button
          type="button"
          className="btn"
          onClick={() => {
            setContextLost(false)
            setCanvasKey((k) => k + 1)
          }}
        >
          Reload 3D
        </button>
      </StateCard>
    )
  }

  return (
    <div className="relative h-full w-full">
      <Canvas
        key={canvasKey}
        dpr={PROFILE.dpr}
        // Variance shadow maps: the only three filter whose softness is a real,
        // tunable radius, which each scene needs (a beach sun and a city
        // overcast cannot share one penumbra). Light bleeding, VSM's usual
        // failure, needs a large depth spread to appear and there is one
        // garment in this frustum.
        shadows="variance"
        camera={{ position: homeCameraPosition(fitRadius(30, 26, 1)), fov: 26, near: 1, far: 700 }}
        gl={{
          alpha: true,
          antialias: PROFILE.antialias,
          // Neutral (KHR_PBR_neutral), not ACES. ACES is a FILM look: it pulls
          // saturated colour toward the white point and lifts blacks, so a red
          // garment previewed here came out a different red from the one the
          // customer picked and the one the press will print. Neutral is the
          // tone map built for exactly this — product colour that survives the
          // round trip — and it is the single biggest fidelity win in the
          // pipeline for one line.
          toneMapping: THREE.NeutralToneMapping,
          powerPreference: 'high-performance',
        }}
        onCreated={({ gl }) => {
          // Listener lifetime is tied to this canvas element; a remount (key
          // bump) discards both together.
          gl.domElement.addEventListener('webglcontextlost', (e) => {
            e.preventDefault()
            setContextLost(true)
          })
        }}
      >
        {/* Re-key on scene id so the env map re-bakes when the scene changes. */}
        <SceneEnvironment key={scene} config={cfg} resolution={PROFILE.envResolution} />
        {cfg.hemisphere && (
          <hemisphereLight
            args={[cfg.hemisphere.sky, cfg.hemisphere.ground, cfg.hemisphere.intensity]}
          />
        )}
        {/* Sized to the measured garment, so one rig covers a tee and a 3XL hoodie. */}
        <KeyLight spec={cfg.key} extent={extent} mapSize={PROFILE.shadowMapSize} />
        {cfg.rim && <RimLight spec={cfg.rim} extent={extent} />}
        <CameraRig
          viewRequest={props.viewRequest}
          autoRotate={props.autoRotate}
          reducedMotion={reducedMotion}
          extent={extent}
          garment={garment}
        />
        <Suspense fallback={null}>
          {garment === 'custom' ? (
              <CustomGarment
                front={props.custom?.front ?? null}
                back={props.custom?.back ?? null}
                envIntensity={cfg.envIntensity}
                onMeasured={onMeasured}
              />
            ) : (
              <GarmentModel
                garment={garment}
                colorHex={props.colorHex}
                sizeId={props.sizeId}
                front={props.front}
                back={props.back}
                sleeve={props.sleeve}
                printK={props.printK}
                envIntensity={cfg.envIntensity}
                onMeasured={onMeasured}
              />
          )}
          {cfg.ground && <Ground spec={cfg.ground} theme={theme} extent={extent} />}
          <Floor
            extent={extent}
            shadowColor={cfg.shadowColor}
            shadowOpacity={cfg.shadowOpacity}
          />
          <ReadyPing onReady={onReady} />
        </Suspense>
      </Canvas>
    </div>
  )
}
