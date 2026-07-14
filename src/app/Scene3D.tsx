import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { Play, RotateCcw, Square } from 'lucide-react'
import clsx from 'clsx'
import type { CardSource, DecalSource, Design, Garment3DProps, Side } from '@/lib/types'
import { GARMENTS } from '@/garments'
import { renderMockup, renderPrintArea, sideLayers } from '@/lib/renderDesign'
import { useStore } from '@/state/store'
import { RegMark } from './Brand'
import { garmentColorHex } from '@/lib/renderDesign'

const loadGarment3D = () => lazy(() => import('@/three'))

/**
 * React.lazy caches a failed chunk load forever — without this boundary one
 * flaky request would blank the 3D stage until a full page reload.
 */
class Retry3DBoundary extends Component<
  { children: ReactNode; onRetry: () => void },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <Fallback title="The 3D studio did not load" body="Usually a brief connection hiccup. Your design is untouched.">
        <button
          className="btn mt-1"
          onClick={() => {
            this.setState({ failed: false })
            this.props.onRetry()
          }}
        >
          Try again
        </button>
      </Fallback>
    )
  }
}

function webglOk(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

/** Decal texture ≈ this many px on its long edge. */
const TEXTURE_TARGET_PX = 1400

interface Sources {
  front: DecalSource | null
  back: DecalSource | null
  customFront: CardSource | null
  customBack: CardSource | null
}

function useDesignTextures(design: Design): Sources | null {
  const [sources, setSources] = useState<Sources | null>(null)
  const version = useRef(0)

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const v = ++version.current
        const next: Sources = { front: null, back: null, customFront: null, customBack: null }

        if (design.garmentId === 'custom') {
          for (const side of ['front', 'back'] as Side[]) {
            const setup = design.custom?.[side]
            if (!setup) continue
            const widthIn = design.custom?.widthIn ?? 20
            const canvas = await renderMockup(design, side, 1100)
            next[side === 'front' ? 'customFront' : 'customBack'] = {
              canvas,
              version: v,
              wIn: widthIn,
              hIn: (widthIn * canvas.height) / canvas.width,
            }
          }
        } else {
          const art = GARMENTS[design.garmentId]
          for (const side of ['front', 'back'] as Side[]) {
            if (sideLayers(design, side).length === 0) continue
            const area = art.printAreasIn[side]
            const ppi = TEXTURE_TARGET_PX / Math.max(area.wIn, area.hIn)
            const canvas = await renderPrintArea(design, side, ppi)
            if (canvas)
              next[side] = { canvas, version: v, wIn: area.wIn, hIn: area.hIn }
          }
        }
        if (!cancelled) setSources(next)
      } catch {
        if (!cancelled) setSources(null)
      }
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [design])

  return sources
}

function Fallback({
  title,
  body,
  children,
}: {
  title: string
  body: string
  children?: ReactNode
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <RegMark size={40} className="opacity-70" />
      <div className="font-display text-[15px] font-bold text-tx">{title}</div>
      <div className="max-w-sm text-[13px] leading-relaxed text-tx2">{body}</div>
      {children}
    </div>
  )
}

export default function Scene3D() {
  const design = useStore((s) => s.design)
  const viewRequest = useStore((s) => s.viewRequest)
  const autoRotate = useStore((s) => s.autoRotate)
  const setAutoRotate = useStore((s) => s.setAutoRotate)
  const requestView = useStore((s) => s.requestView)
  const [ready, setReady] = useState(false)
  const [Garment3D, setGarment3D] = useState<ComponentType<Garment3DProps>>(loadGarment3D)
  const gl = useMemo(webglOk, [])
  const sources = useDesignTextures(design)

  const areaOffsetYIn = useMemo(() => {
    if (design.garmentId === 'custom') return { front: 0, back: 0 }
    const art = GARMENTS[design.garmentId]
    const off = (side: Side) => {
      const a = art.sides[side].printAreaPx
      return (a.y + a.h / 2 - 400) / art.pxPerInch
    }
    return { front: off('front'), back: off('back') }
  }, [design.garmentId])

  if (!gl) {
    return (
      <Fallback
        title="3D preview is unavailable on this device"
        body="Your browser blocked WebGL. The 2D editor has everything you need — your design and its exact print placement are identical in both views."
      />
    )
  }

  const garmentWidthIn =
    design.garmentId === 'custom'
      ? design.custom?.widthIn ?? 20
      : GARMENTS[design.garmentId].widthIn

  return (
    <div className="absolute inset-0 canvas-surface">
      <Retry3DBoundary onRetry={() => setGarment3D(loadGarment3D)}>
      <Suspense
        fallback={
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <RegMark size={44} className="spin-slow" />
            <div className="text-[13px] text-tx2">Warming up the 3D studio…</div>
          </div>
        }
      >
        <Garment3D
          garment={design.garmentId}
          colorHex={garmentColorHex(design)}
          front={sources?.front ?? null}
          back={sources?.back ?? null}
          custom={{
            front: sources?.customFront ?? null,
            back: sources?.customBack ?? null,
          }}
          areaOffsetYIn={areaOffsetYIn}
          garmentWidthIn={garmentWidthIn}
          autoRotate={autoRotate}
          viewRequest={viewRequest}
          onReady={() => setReady(true)}
        />
      </Suspense>
      </Retry3DBoundary>

      {/* 3D controls */}
      <div className="absolute bottom-4 right-4 z-10 flex items-center gap-1 rounded-lg border border-line bg-bg1/90 p-1 shadow-lg backdrop-blur">
        {(['front', 'threequarter', 'back'] as const).map((v) => (
          <button
            key={v}
            className="btn btn-ghost h-7 px-2 text-[11px]"
            onClick={() => requestView(v)}
          >
            {v === 'front' ? 'Front' : v === 'back' ? 'Back' : '¾ view'}
          </button>
        ))}
        <div className="mx-0.5 h-4 w-px bg-line" />
        <button
          className={clsx('iconbtn h-7 w-7', autoRotate && 'text-cy')}
          onClick={() => setAutoRotate(!autoRotate)}
          aria-label={autoRotate ? 'Stop turntable' : 'Start turntable'}
          title="Turntable"
        >
          {autoRotate ? <Square size={13} /> : <Play size={13} />}
        </button>
        <button
          className="iconbtn h-7 w-7"
          onClick={() => requestView('threequarter')}
          aria-label="Reset camera"
          title="Reset camera"
        >
          <RotateCcw size={13} />
        </button>
      </div>

      {ready && (
        <div className="pointer-events-none absolute bottom-4 left-4 z-10 hidden text-[11px] text-tx3 lg:block">
          Drag to rotate · Scroll to zoom · Right-drag to pan
        </div>
      )}
    </div>
  )
}
