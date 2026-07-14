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
import { CameraRig, Floor, ReadyPing, StudioEnvironment, homeCameraPosition } from './Stage'
import { GarmentModel } from './GarmentModel'
import { CustomCard } from './CustomCard'

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
  const [webgl] = useState(isWebGLAvailable)
  const [contextLost, setContextLost] = useState(false)
  const [canvasKey, setCanvasKey] = useState(0)
  const reducedMotion = usePrefersReducedMotion()
  const [heightIn, setHeightIn] = useState(24)
  const onMeasured = useCallback((h: number) => setHeightIn(h), [])

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
        camera={{ position: homeCameraPosition(66), fov: 26, near: 1, far: 700 }}
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
        <StudioEnvironment />
        <CameraRig
          viewRequest={props.viewRequest}
          autoRotate={props.autoRotate}
          reducedMotion={reducedMotion}
        />
        <Suspense fallback={null}>
          <SwayGroup enabled={!reducedMotion}>
            {garment === 'custom' ? (
              <CustomCard
                front={props.custom?.front ?? null}
                back={props.custom?.back ?? null}
                onMeasured={onMeasured}
              />
            ) : (
              <GarmentModel
                garment={garment}
                colorHex={props.colorHex}
                garmentWidthIn={props.garmentWidthIn}
                front={props.front}
                back={props.back}
                areaOffsetYIn={props.areaOffsetYIn}
                onMeasured={onMeasured}
              />
            )}
          </SwayGroup>
          <Floor heightIn={heightIn} widthIn={props.garmentWidthIn} />
          <ReadyPing onReady={onReady} />
        </Suspense>
      </Canvas>
    </div>
  )
}
