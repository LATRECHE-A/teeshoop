import { useEffect, useRef, useState } from 'react'
import { Frame, Grid3x3, ImagePlus, Maximize, Minus, Plus, Smartphone, TriangleAlert, Type } from 'lucide-react'
import clsx from 'clsx'
import { EditorEngine, type SelectionInfo } from '@/editor/EditorEngine'
import { useStore } from '@/state/store'
import { addAsset, listAssets } from '@/state/assets'
import { ASSET_DRAG_TYPE } from './panels/UploadsPanel'
import type { AssetMeta } from '@/lib/types'
import { fmtCm, fmtIn, inToCm } from '@/lib/units'
import { stageBackground } from '@/scenes'
import { useT } from '@/i18n'

export default function EditorCanvas() {
  const hostRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<EditorEngine | null>(null)
  const zoneInputRef = useRef<HTMLInputElement>(null)
  const pendingZoneRef = useRef<string | null>(null)
  const [zoomPct, setZoomPct] = useState(100)
  const [sel, setSel] = useState<SelectionInfo | null>(null)
  const [zoneAction, setZoneAction] = useState<{ zoneId: string; x: number; y: number } | null>(null)
  const t = useT()

  const design = useStore((s) => s.design)
  const side = useStore((s) => s.activeSide)
  const selectedId = useStore((s) => s.selectedId)
  const lang = useStore((s) => s.lang)
  const scene = useStore((s) => s.scene)
  const theme = useStore((s) => s.theme)
  const showGuides = useStore((s) => s.showGuides)
  const toggleGuides = useStore((s) => s.toggleGuides)
  const previewSize = useStore((s) => s.previewSize)
  const openModal = useStore((s) => s.openModal)
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
      onZoneAction: (zoneId, rect) =>
        setZoneAction({ zoneId, x: rect.x + rect.w / 2, y: rect.y + rect.h }),
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
    void engineRef.current?.sync({ design, side, selectedId, showGuides, previewSize })
  }, [design, side, selectedId, lang, showGuides, previewSize])

  const zoom = (action: 'in' | 'out' | 'fit') =>
    window.dispatchEvent(new CustomEvent('tshop:zoom', { detail: action }))

  /** Place an asset into a zone (auto-fit), at a dropped point, or centred. */
  const placeAsset = (
    asset: AssetMeta,
    zoneId: string | null,
    at?: { clientX: number; clientY: number },
  ) => {
    const st = useStore.getState()
    if (zoneId) st.addImageLayerInZone(asset, zoneId)
    else if (at && engineRef.current) {
      const p = engineRef.current.inchPointAt(at.clientX, at.clientY)
      st.addImageLayerAt(asset, p.xIn, p.yIn)
    } else st.addImageLayer(asset)
  }

  const ingestAndPlace = async (
    file: File,
    zoneId: string | null,
    at?: { clientX: number; clientY: number },
  ) => {
    const st = useStore.getState()
    if (!file.type.startsWith('image/')) {
      st.toast('warn', t('toast.not_image', { name: file.name }))
      return
    }
    try {
      const meta = await addAsset(file, file.name)
      st.setAssets(await listAssets())
      placeAsset(meta, zoneId, at)
    } catch {
      st.toast('error', t('toast.read_failed_name', { name: file.name }))
    }
  }

  return (
    <div
      className="absolute inset-0"
      onDragOver={(e) => {
        // Only claim drags we can place: library assets or OS image files.
        const kinds = e.dataTransfer.types
        if (!kinds.includes(ASSET_DRAG_TYPE) && !kinds.includes('Files')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        const engine = engineRef.current
        engine?.setDropActive(true)
        engine?.dropTargetAt(e.clientX, e.clientY)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        engineRef.current?.setDropActive(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        const engine = engineRef.current
        const zoneId = engine?.dropTargetAt(e.clientX, e.clientY) ?? null
        engine?.setDropActive(false)
        const at = { clientX: e.clientX, clientY: e.clientY }
        const st = useStore.getState()
        const assetId = e.dataTransfer.getData(ASSET_DRAG_TYPE)
        if (assetId) {
          const meta = st.assets.find((a) => a.id === assetId)
          if (meta) placeAsset(meta, zoneId, at)
          return
        }
        const file = Array.from(e.dataTransfer.files).find((f) =>
          f.type.startsWith('image/'),
        )
        if (file) void ingestAndPlace(file, zoneId, at)
      }}
    >
      <div ref={hostRef} className={clsx('absolute inset-0', bg.className)} style={bg.style} />

      {/* zone click-to-upload: hidden input + image/text chooser popover */}
      <input
        ref={zoneInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          const zoneId = pendingZoneRef.current
          pendingZoneRef.current = null
          e.target.value = ''
          if (file) void ingestAndPlace(file, zoneId)
        }}
      />
      {zoneAction && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setZoneAction(null)} />
          <div
            className="fixed z-30 flex -translate-x-1/2 gap-1 rounded-lg border border-line bg-bg1/95 p-1 shadow-xl backdrop-blur"
            style={{
              left: Math.max(96, Math.min(zoneAction.x, window.innerWidth - 96)),
              top: Math.min(zoneAction.y + 6, window.innerHeight - 64),
            }}
          >
            <button
              className="btn h-8 gap-1.5 px-2.5 text-[12px]"
              onClick={() => {
                pendingZoneRef.current = zoneAction.zoneId
                setZoneAction(null)
                zoneInputRef.current?.click()
              }}
            >
              <ImagePlus size={14} />
              {t('zone.add_image')}
            </button>
            <button
              className="btn h-8 gap-1.5 px-2.5 text-[12px]"
              onClick={() => {
                const st = useStore.getState()
                st.addTextLayerInZone(zoneAction.zoneId)
                st.setPanel('text')
                setZoneAction(null)
              }}
            >
              <Type size={14} />
              {t('zone.add_text')}
            </button>
          </div>
        </>
      )}

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
            {fmtCm(inToCm(sel.wIn))} × {fmtCm(inToCm(sel.hIn))}
            <span className="text-tx3">
              {'  '}({fmtIn(sel.wIn)} × {fmtIn(sel.hIn)})
            </span>
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

      {/* View-in-AR call to action — parity with the 3D stage. On phones it sits
          above the bottom-left SideSwitcher; on desktop it takes the bottom-left. */}
      <button
        className="btn absolute bottom-[calc(var(--tsh-nav)+var(--tsh-selbar)+3.5rem)] left-3 z-10 h-9 gap-1.5 border-cy/40 bg-bg1/90 px-3 text-[12px] text-cy shadow-lg backdrop-blur hover:border-cy md:bottom-4 md:left-4 md:h-8"
        onClick={() => openModal('ar')}
        title={t('ar.view_in_ar')}
      >
        <Smartphone size={14} />
        {t('ar.view_in_ar')}
      </button>

      {/* hint (desktop only; raised to clear the AR button) */}
      <div className="pointer-events-none absolute bottom-16 left-4 z-10 hidden items-center gap-1.5 text-[11px] text-tx3 lg:flex">
        <Frame size={12} />
        {t('editor.hint')}
      </div>
    </div>
  )
}
