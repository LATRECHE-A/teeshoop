import { useEffect, useRef, useState } from 'react'
import { Frame, Grid3x3, Maximize, Minus, Plus, TriangleAlert } from 'lucide-react'
import clsx from 'clsx'
import { EditorEngine, type SelectionInfo } from '@/editor/EditorEngine'
import { useStore } from '@/state/store'
import { fmtIn } from '@/lib/units'
import { stageBackground } from '@/scenes'
import { useT } from '@/i18n'

export default function EditorCanvas() {
  const hostRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<EditorEngine | null>(null)
  const [zoomPct, setZoomPct] = useState(100)
  const [sel, setSel] = useState<SelectionInfo | null>(null)
  const t = useT()

  const design = useStore((s) => s.design)
  const side = useStore((s) => s.activeSide)
  const selectedId = useStore((s) => s.selectedId)
  const lang = useStore((s) => s.lang)
  const scene = useStore((s) => s.scene)
  const theme = useStore((s) => s.theme)
  const showGuides = useStore((s) => s.showGuides)
  const toggleGuides = useStore((s) => s.toggleGuides)
  const bg = stageBackground(scene, theme)

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
      onDragStart: () => useStore.getState().setDragging(true),
      onDragEnd: () => useStore.getState().setDragging(false),
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

  // reconcile engine with state (lang re-syncs so the on-canvas print-area
  // label re-renders in the new language)
  useEffect(() => {
    void engineRef.current?.sync({ design, side, selectedId, showGuides })
  }, [design, side, selectedId, lang, showGuides])

  const zoom = (action: 'in' | 'out' | 'fit') =>
    window.dispatchEvent(new CustomEvent('tshop:zoom', { detail: action }))

  return (
    <div className="absolute inset-0">
      <div ref={hostRef} className={clsx('absolute inset-0', bg.className)} style={bg.style} />

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
        <div className="absolute left-1/2 top-14 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-yl/30 bg-yl/10 px-3 py-1.5 text-[11.5px] font-medium text-yl md:top-3">
          <TriangleAlert size={13} />
          {t('editor.crop_warn')}
        </div>
      )}

      {/* zoom HUD */}
      <div className="absolute bottom-[calc(var(--tsh-nav)+var(--tsh-selbar)+0.75rem)] right-3 z-10 flex items-center gap-1 rounded-lg border border-line bg-bg1/90 p-1 shadow-lg backdrop-blur md:bottom-4 md:right-4">
        <button
          className={clsx('iconbtn hidden h-7 w-7 md:inline-flex', showGuides && 'bg-bg3 text-cy')}
          onClick={toggleGuides}
          aria-pressed={showGuides}
          aria-label={t('editor.guides')}
          title={t('editor.guides_hint')}
        >
          <Grid3x3 size={14} />
        </button>
        <div className="mx-0.5 hidden h-4 w-px bg-line md:block" />
        <button className="iconbtn h-7 w-7" onClick={() => zoom('out')} aria-label={t('editor.zoom_out')}>
          <Minus size={14} />
        </button>
        <span className="mono-dim hidden w-12 text-center md:inline">{zoomPct}%</span>
        <button className="iconbtn h-7 w-7" onClick={() => zoom('in')} aria-label={t('editor.zoom_in')}>
          <Plus size={14} />
        </button>
        <div className="mx-0.5 h-4 w-px bg-line" />
        <button className="iconbtn h-7 w-7" onClick={() => zoom('fit')} aria-label={t('editor.fit')} title={t('editor.fit_hint')}>
          <Maximize size={13} />
        </button>
      </div>

      {/* hint */}
      <div className="pointer-events-none absolute bottom-4 left-4 z-10 hidden items-center gap-1.5 text-[11px] text-tx3 lg:flex">
        <Frame size={12} />
        {t('editor.hint')}
      </div>
    </div>
  )
}
