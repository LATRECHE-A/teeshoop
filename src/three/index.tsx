/**
 * Tshop Studio — module A3: 3D garment preview.
 *
 * Default export `Garment3D` renders the current design on a real 3D garment
 * (tee / hoodie GLB, or a curved photo-card for customer-shipped garments)
 * inside a procedural studio stage. All scene math uses 1 world unit = 1 inch
 * so print decals are dimensionally exact (see src/three/calibration.ts).
 */
import { Suspense, useCallback, useEffect, useState, type JSX, type ReactNode } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { Float } from '@react-three/drei'
import type { Garment3DProps } from '@/lib/types'
import { SIZE_IDS, garmentWidthInFor } from '@/content/sizeChart'
import { getScene } from '@/scenes'
import { CameraRig, Floor, ReadyPing, SceneEnvironment, fitRadius, homeCameraPosition } from './Stage'
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
 * Body width (inches) of the garment the camera is framing, WITHOUT the arm
 * span an A-pose adds to the bounding box. Read off the size chart's laid-flat
 * half-chest at the biggest size, because that is the same size the camera
 * frames to (see GarmentFrame.fitWidthIn) — and because a laid-flat width is a
 * safe upper bound on the projected torso, which curves away from the viewer.
 * A ship-your-own garment is a flat card with no sleeves: its whole width IS
 * the body.
 */
function torsoWidthIn(garment: Garment3DProps['garment'], fallbackIn: number): number {
  if (garment === 'custom') return fallbackIn
  return garmentWidthInFor(garment, SIZE_IDS[SIZE_IDS.length - 1])
}

function SwayGroup({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  if (!enabled) return <>{children}</>
  return (
    <Float speed={1.2} rotationIntensity={0.16} floatIntensity={0.6} floatingRange={[-0.3, 0.3]}>
      {children}
    </Float>
  )
}

/**
 * 3D garment preview. Mount it in a sized container; the canvas is
 * transparent so the app's bg0 backdrop shows through.
 */
export default function Garment3D(props: Garment3DProps): JSX.Element {
  const { garment, onReady } = props
  const scene = props.scene ?? 'studio'
  const cfg = getScene(scene).three
  const [webgl] = useState(isWebGLAvailable)
  const [contextLost, setContextLost] = useState(false)
  const [canvasKey, setCanvasKey] = useState(0)
  const reducedMotion = usePrefersReducedMotion()
  // Measured mesh extents. The FLOOR follows the previewed size (its shadow is
  // the garment's own footprint); the CAMERA frames `fit`, the biggest size in
  // the chart, so switching S↔3XL changes the garment on screen rather than the
  // viewing distance. Garments are scaled to real inches — a 3XL hoodie with
  // A-pose sleeves is genuinely ~49 in across — so a fixed distance would crop.
  const [extent, setExtent] = useState({ heightIn: 28, widthIn: 24, fitHeightIn: 28, fitWidthIn: 24 })
  const onMeasured = useCallback(
    (heightIn: number, widthIn?: number, fitIn?: { heightIn: number; widthIn: number }) =>
      setExtent((prev) => {
        const next = {
          heightIn,
          widthIn: widthIn ?? heightIn * 0.9,
          fitHeightIn: fitIn?.heightIn ?? heightIn,
          fitWidthIn: fitIn?.widthIn ?? widthIn ?? heightIn * 0.9,
        }
        return (Object.keys(next) as (keyof typeof next)[]).every((k) => prev[k] === next[k]) ? prev : next
      }),
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
        dpr={[1, 1.75]}
        camera={{ position: homeCameraPosition(fitRadius(30, 26, 1)), fov: 26, near: 1, far: 700 }}
        gl={{
          alpha: true,
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
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
        <SceneEnvironment key={scene} config={cfg} />
        {cfg.hemisphere && (
          <hemisphereLight
            args={[cfg.hemisphere.sky, cfg.hemisphere.ground, cfg.hemisphere.intensity]}
          />
        )}
        <CameraRig
          viewRequest={props.viewRequest}
          autoRotate={props.autoRotate}
          reducedMotion={reducedMotion}
          fitHeightIn={extent.fitHeightIn}
          fitWidthIn={extent.fitWidthIn}
          fitTorsoWidthIn={torsoWidthIn(garment, extent.fitWidthIn)}
        />
        <Suspense fallback={null}>
          <SwayGroup enabled={!reducedMotion}>
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
          </SwayGroup>
          <Floor
            heightIn={extent.heightIn}
            widthIn={extent.widthIn}
            shadowColor={cfg.shadowColor}
            shadowOpacity={cfg.shadowOpacity}
          />
          <ReadyPing onReady={onReady} />
        </Suspense>
      </Canvas>
    </div>
  )
}
