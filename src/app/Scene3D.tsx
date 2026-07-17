import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { Play, RotateCcw, Smartphone, Square } from 'lucide-react'
import clsx from 'clsx'
import type { CardSource, DecalSource, Design, Garment3DProps, Side } from '@/lib/types'
import { GARMENTS } from '@/garments'
import { areaOffsetYIn as areaOffsetForSide, renderMockup, renderPrintArea, sideLayers } from '@/lib/renderDesign'
import { useStore } from '@/state/store'
import { RegMark } from './Brand'
import { garmentColorHex } from '@/lib/renderDesign'
import { stageBackground } from '@/scenes'
import { t, useT } from '@/i18n'

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
      <Fallback title={t('three.failed_title')} body={t('three.failed_body')}>
        <button
          className="btn mt-1"
          onClick={() => {
            this.setState({ failed: false })
            this.props.onRetry()
          }}
        >
          {t('three.try_again')}
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

/** Decal texture ≈ this many px on its long edge. WebGL2 keeps non-POT +
 *  mipmaps, so this need not be a power of two (unlike the AR bake). */
const TEXTURE_TARGET_PX = 2048

interface Sources {
  front: DecalSource | null
  back: DecalSource | null
  sleeve: DecalSource | null
  customFront: CardSource | null
  customBack: CardSource | null
}

function useDesignTextures(design: Design): Sources | null {
  const [sources, setSources] = useState<Sources | null>(null)
  const version = useRef(0)
  const lastGarment = useRef(design.garmentId)

  useEffect(() => {
    let cancelled = false
    // Garment switched: drop the old garment's decals immediately instead of
    // showing them (wrong size/placement) for a debounce tick.
    if (lastGarment.current !== design.garmentId) {
      lastGarment.current = design.garmentId
      setSources(null)
    }
    const t = setTimeout(async () => {
      try {
        const v = ++version.current
        const next: Sources = { front: null, back: null, sleeve: null, customFront: null, customBack: null }

        if (design.garmentId === 'custom') {
          const widthIn = design.custom?.widthIn ?? 20
          // Render each supplied side, then auto-scale to a consistent
          // footprint: widths already map bbox→widthIn, but heights/framing can
          // differ, so pad the shorter side's canvas at the BOTTOM to the same
          // inch height. printArea is stored top-left-relative and both garment
          // and design are drawn from the top-left, so bottom padding keeps
          // every placement valid while front/back register (shoulders align)
          // in 2D, 3D and the extruded back cap.
          const rendered: { side: Side; canvas: HTMLCanvasElement }[] = []
          for (const side of ['front', 'back'] as const) {
            if (!design.custom?.[side]) continue
            rendered.push({ side, canvas: await renderMockup(design, side, 1100) })
          }
          const hIns = rendered.map((r) => (widthIn * r.canvas.height) / r.canvas.width)
          let unifiedHIn = hIns.length ? Math.max(...hIns) : 0
          const minH = hIns.length ? Math.min(...hIns) : 0
          // Framings too different (bad crop/zoom) — don't force a runaway pad.
          if (unifiedHIn > 0 && minH > 0 && unifiedHIn / minH > 1.7) unifiedHIn = 0
          for (const r of rendered) {
            let canvas = r.canvas
            const natHIn = (widthIn * canvas.height) / canvas.width
            if (unifiedHIn > 0 && natHIn < unifiedHIn - 1e-3) {
              const padded = document.createElement('canvas')
              padded.width = canvas.width
              padded.height = Math.max(2, Math.round((canvas.width * unifiedHIn) / widthIn))
              const pctx = padded.getContext('2d')
              if (pctx) {
                pctx.drawImage(canvas, 0, 0)
                canvas = padded
              }
            }
            next[r.side === 'front' ? 'customFront' : 'customBack'] = {
              canvas,
              version: v,
              wIn: widthIn,
              hIn: (widthIn * canvas.height) / canvas.width,
            }
          }
        } else {
          const art = GARMENTS[design.garmentId]
          for (const side of ['front', 'back', 'sleeve'] as const) {
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
  const openModal = useStore((s) => s.openModal)
  const scene = useStore((s) => s.scene)
  const theme = useStore((s) => s.theme)
  const tr = useT()
  const [ready, setReady] = useState(false)
  const [Garment3D, setGarment3D] = useState<ComponentType<Garment3DProps>>(loadGarment3D)
  const gl = useMemo(webglOk, [])
  const sources = useDesignTextures(design)

  const areaOffsetYIn = useMemo(() => {
    if (design.garmentId === 'custom') return { front: 0, back: 0, sleeve: 0 }
    const g = design.garmentId
    // Shared with the AR export (src/lib/renderDesign.areaOffsetYIn) so front
    // and back sit at the same height in the 3D preview and in AR.
    return { front: areaOffsetForSide(g, 'front'), back: areaOffsetForSide(g, 'back'), sleeve: 0 }
  }, [design.garmentId])

  if (!gl) {
    return (
      <Fallback
        title={tr('three.unavailable_title')}
        body={tr('three.unavailable_body')}
      />
    )
  }

  const garmentWidthIn =
    design.garmentId === 'custom'
      ? design.custom?.widthIn ?? 20
      : GARMENTS[design.garmentId].widthIn

  const bg = stageBackground(scene, theme)

  return (
    <div className={clsx('absolute inset-0', bg.className)} style={bg.style}>
      <Retry3DBoundary onRetry={() => setGarment3D(loadGarment3D)}>
      <Suspense
        fallback={
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <RegMark size={44} className="spin-slow" />
            <div className="text-[13px] text-tx2">{tr('three.warming')}</div>
          </div>
        }
      >
        <Garment3D
          garment={design.garmentId}
          colorHex={garmentColorHex(design)}
          scene={scene}
          front={sources?.front ?? null}
          back={sources?.back ?? null}
          sleeve={sources?.sleeve ?? null}
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

      {/* View-in-AR call to action */}
      <button
        className="btn absolute bottom-[calc(var(--tsh-nav)+0.75rem)] left-3 z-10 h-9 gap-1.5 border-cy/40 bg-bg1/90 px-3 text-[12px] text-cy shadow-lg backdrop-blur hover:border-cy md:bottom-4 md:left-4 md:h-8"
        onClick={() => openModal('ar')}
        title={tr('ar.view_in_ar')}
      >
        <Smartphone size={14} />
        {tr('ar.view_in_ar')}
      </button>

      {/* 3D controls */}
      <div className="absolute bottom-[calc(var(--tsh-nav)+0.75rem)] right-3 z-10 flex items-center gap-1 rounded-lg border border-line bg-bg1/90 p-1 shadow-lg backdrop-blur md:bottom-4 md:right-4">
        {(['front', 'threequarter', 'back'] as const).map((v) => (
          <button
            key={v}
            className="btn btn-ghost h-7 px-2 text-[11px]"
            onClick={() => requestView(v)}
          >
            {v === 'front' ? tr('three.front') : v === 'back' ? tr('three.back') : tr('three.threequarter')}
          </button>
        ))}
        <div className="mx-0.5 h-4 w-px bg-line" />
        <button
          className={clsx('iconbtn h-7 w-7', autoRotate && 'text-cy')}
          onClick={() => setAutoRotate(!autoRotate)}
          aria-label={autoRotate ? tr('three.stop_turntable') : tr('three.start_turntable')}
          title={tr('three.turntable')}
        >
          {autoRotate ? <Square size={13} /> : <Play size={13} />}
        </button>
        <button
          className="iconbtn h-7 w-7"
          onClick={() => requestView('threequarter')}
          aria-label={tr('three.reset_camera')}
          title={tr('three.reset_camera')}
        >
          <RotateCcw size={13} />
        </button>
      </div>

      {ready && (
        <div className="pointer-events-none absolute bottom-14 left-4 z-10 hidden text-[11px] text-tx3 lg:block">
          {tr('three.hint')}
        </div>
      )}
    </div>
  )
}
