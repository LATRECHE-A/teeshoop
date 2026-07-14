import { useEffect, useRef, useState } from 'react'
import { Frame, Maximize, Minus, Plus, TriangleAlert } from 'lucide-react'
import { EditorEngine, type SelectionInfo } from '@/editor/EditorEngine'
import { useStore } from '@/state/store'
import { fmtIn } from '@/lib/units'

export default function EditorCanvas() {
  const hostRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<EditorEngine | null>(null)
  const [zoomPct, setZoomPct] = useState(100)
  const [sel, setSel] = useState<SelectionInfo | null>(null)

  const design = useStore((s) => s.design)
  const side = useStore((s) => s.activeSide)
  const selectedId = useStore((s) => s.selectedId)

  // mount engine once
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const engine = new EditorEngine(host, {
      onSelect: (id) => useStore.getState().select(id),
      onPatch: (id, patch, opts) =>
        useStore.getState().patchLayer(id, patch, { transient: opts.transient }),
      onEditText: (id) => {
        useStore.getState().select(id)
        useStore.getState().setPanel('text')
      },
      onZoom: setZoomPct,
      onSelection: setSel,
    })
    engineRef.current = engine

    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      engine.setViewport(r.width, r.height)
    })
    ro.observe(host)

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      const t = e.target as HTMLElement
      // Only hijack Space when nothing interactive owns the keyboard —
      // buttons/inputs keep their native Space behavior.
      if (t !== document.body) return
      e.preventDefault()
      engine.setPanMode(true)
    }
    // Always release pan on keyup/blur, wherever focus went mid-press.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') engine.setPanMode(false)
    }
    const onBlur = () => engine.setPanMode(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)

    const onZoomEvent = (e: Event) => {
      const action = (e as CustomEvent<string>).detail
      if (action === 'fit') engine.zoomFit()
      if (action === 'in') engine.zoomBy(1.3)
      if (action === 'out') engine.zoomBy(1 / 1.3)
    }
    window.addEventListener('tshop:zoom', onZoomEvent)

    return () => {
      ro.disconnect()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('tshop:zoom', onZoomEvent)
      engine.destroy()
      engineRef.current = null
    }
  }, [])

  // reconcile engine with state
  useEffect(() => {
    void engineRef.current?.sync({ design, side, selectedId })
  }, [design, side, selectedId])

  const zoom = (action: 'in' | 'out' | 'fit') =>
    window.dispatchEvent(new CustomEvent('tshop:zoom', { detail: action }))

  return (
    <div className="absolute inset-0">
      <div ref={hostRef} className="canvas-surface absolute inset-0" />

      {/* selection dimension chip */}
      {sel && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border border-line bg-bg1/95 px-2 py-1 shadow-lg"
          style={{
            left: sel.rect.x + sel.rect.w / 2,
            top: Math.min(sel.rect.y + sel.rect.h + 10, window.innerHeight - 120),
          }}
        >
          <span className="mono-dim text-cy">
            {fmtIn(sel.wIn)} × {fmtIn(sel.hIn)}
            {Math.abs(sel.rotation % 360) > 0.4 &&
              `  ·  ${Math.round(sel.rotation)}°`}
          </span>
        </div>
      )}

      {/* crop warning */}
      {sel?.cropped && (
        <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-yl/30 bg-yl/10 px-3 py-1.5 text-[11.5px] font-medium text-yl">
          <TriangleAlert size={13} />
          Outside the print area — anything past the dashed line is cropped
        </div>
      )}

      {/* zoom HUD */}
      <div className="absolute bottom-4 right-4 z-10 flex items-center gap-1 rounded-lg border border-line bg-bg1/90 p-1 shadow-lg backdrop-blur">
        <button className="iconbtn h-7 w-7" onClick={() => zoom('out')} aria-label="Zoom out">
          <Minus size={14} />
        </button>
        <span className="mono-dim w-12 text-center">{zoomPct}%</span>
        <button className="iconbtn h-7 w-7" onClick={() => zoom('in')} aria-label="Zoom in">
          <Plus size={14} />
        </button>
        <div className="mx-0.5 h-4 w-px bg-line" />
        <button className="iconbtn h-7 w-7" onClick={() => zoom('fit')} aria-label="Fit to screen" title="Fit (F)">
          <Maximize size={13} />
        </button>
      </div>

      {/* hint */}
      <div className="pointer-events-none absolute bottom-4 left-4 z-10 hidden items-center gap-1.5 text-[11px] text-tx3 lg:flex">
        <Frame size={12} />
        Scroll to zoom · Space + drag to pan · Double-click text to edit
      </div>
    </div>
  )
}
