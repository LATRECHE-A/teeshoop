import { useEffect, useRef, useState } from 'react'
import { Camera, RefreshCw, Wand2 } from 'lucide-react'
import clsx from 'clsx'
import Modal from './Modal'
import { useStore } from '@/state/store'
import {
  addAsset,
  ensureAssetImage,
  getAssetBlob,
  listAssets,
  setAssetCutout,
} from '@/state/assets'
import { isBgRemovalSupported, removeBackground } from '@/lib/bgremove'
import { defaultCustomPrintArea, getCustomSideInfo, invalidateCustomBBox } from '@/lib/custom'
import type { CustomSideSetup, RectIn, Side } from '@/lib/types'
import { clamp, fmtIn } from '@/lib/units'

interface SideDraft extends CustomSideSetup {
  processing?: boolean
}

/** Interactive print-area placement over the customer's garment photo. */
function PrintAreaPlacer({
  setup,
  widthIn,
  onChange,
}: {
  setup: CustomSideSetup
  widthIn: number
  onChange: (area: RectIn) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [disp, setDisp] = useState<{ w: number; h: number; ppi: number } | null>(null)
  const drag = useRef<{
    kind: 'move' | 'nw' | 'ne' | 'sw' | 'se'
    startX: number
    startY: number
    area: RectIn
  } | null>(null)

  // draw the garment photo cropped to its bounding box
  useEffect(() => {
    let on = true
    void (async () => {
      const info = await getCustomSideInfo(setup, widthIn)
      if (!on || !canvasRef.current) return
      const maxW = 430
      const maxH = 280
      const gHIn = info.bbox.h / info.pxPerInch
      const ppi = Math.min(maxW / widthIn, maxH / gHIn)
      const w = Math.round(widthIn * ppi)
      const h = Math.round(gHIn * ppi)
      const canvas = canvasRef.current
      canvas.width = w * 2
      canvas.height = h * 2
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      const ctx = canvas.getContext('2d')!
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(
        info.img,
        info.bbox.x,
        info.bbox.y,
        info.bbox.w,
        info.bbox.h,
        0,
        0,
        canvas.width,
        canvas.height,
      )
      setDisp({ w, h, ppi })
    })()
    return () => {
      on = false
    }
  }, [setup, widthIn])

  const area = setup.printArea

  const clampArea = (a: RectIn): RectIn => {
    if (!disp) return a
    const gH = disp.h / disp.ppi
    const wIn = clamp(a.wIn, 3, widthIn)
    const hIn = clamp(a.hIn, 3, gH)
    return {
      wIn,
      hIn,
      xIn: clamp(a.xIn, 0, widthIn - wIn),
      yIn: clamp(a.yIn, 0, gH - hIn),
    }
  }

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current
      if (!d || !disp) return
      const dxIn = (e.clientX - d.startX) / disp.ppi
      const dyIn = (e.clientY - d.startY) / disp.ppi
      const a = { ...d.area }
      if (d.kind === 'move') {
        a.xIn += dxIn
        a.yIn += dyIn
      } else {
        if (d.kind.includes('w')) {
          a.xIn += dxIn
          a.wIn -= dxIn
        } else {
          a.wIn += dxIn
        }
        if (d.kind.includes('n')) {
          a.yIn += dyIn
          a.hIn -= dyIn
        } else {
          a.hIn += dyIn
        }
      }
      onChange(clampArea(a))
    }
    const up = () => {
      drag.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disp, widthIn])

  const start = (kind: NonNullable<typeof drag.current>['kind']) => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    drag.current = { kind, startX: e.clientX, startY: e.clientY, area }
  }

  const gHIn = disp ? disp.h / disp.ppi : 0

  return (
    <div className="flex flex-col gap-2">
      <div className="relative mx-auto select-none" ref={boxRef}>
        <canvas ref={canvasRef} className="rounded-lg bg-bg0" />
        {disp && (
          <div
            className="absolute cursor-move border-2 border-cy bg-cy/10"
            style={{
              left: area.xIn * disp.ppi,
              top: area.yIn * disp.ppi,
              width: area.wIn * disp.ppi,
              height: area.hIn * disp.ppi,
            }}
            onPointerDown={start('move')}
          >
            <span className="absolute -top-6 left-0 whitespace-nowrap rounded bg-bg1/95 px-1.5 py-0.5 font-mono text-[10px] text-cy">
              {fmtIn(area.wIn)} × {fmtIn(area.hIn)}
            </span>
            {(['nw', 'ne', 'sw', 'se'] as const).map((k) => (
              <span
                key={k}
                onPointerDown={start(k)}
                className={clsx(
                  'absolute h-3 w-3 rounded-full border-2 border-bg0 bg-cy',
                  k.includes('n') ? '-top-1.5' : '-bottom-1.5',
                  k.includes('w') ? '-left-1.5' : '-right-1.5',
                  (k === 'nw' || k === 'se') ? 'cursor-nwse-resize' : 'cursor-nesw-resize',
                )}
              />
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <button
          className="chip hover:border-cy/50 hover:text-cy"
          onClick={() => onChange(clampArea(defaultCustomPrintArea(widthIn, gHIn || 28)))}
        >
          Center chest
        </button>
        <button
          className="chip hover:border-cy/50 hover:text-cy"
          onClick={() =>
            onChange(
              clampArea({
                xIn: widthIn * 0.1,
                yIn: (gHIn || 28) * 0.12,
                wIn: widthIn * 0.8,
                hIn: (gHIn || 28) * 0.72,
              }),
            )
          }
        >
          Full side
        </button>
        <span className="text-[10.5px] text-tx3">Drag the box to where we should print</span>
      </div>
    </div>
  )
}

function PhotoTile({
  side,
  draft,
  onUpload,
  onToggleCutout,
  removeSupported,
}: {
  side: Side
  draft: SideDraft | null
  onUpload: (file: File) => void
  onToggleCutout: (use: boolean) => void
  removeSupported: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [thumb, setThumb] = useState<string | null>(null)

  useEffect(() => {
    let on = true
    if (!draft) {
      setThumb(null)
      return
    }
    void (async () => {
      try {
        const img = await ensureAssetImage(draft.assetId, draft.useCutout ? 'cutout' : 'original')
        if (on) setThumb(img.src)
      } catch {
        if (on) setThumb(null)
      }
    })()
    return () => {
      on = false
    }
  }, [draft])

  return (
    <div className="flex flex-1 flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) onUpload(f)
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        className={clsx(
          'relative flex h-40 flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-dashed transition-colors',
          draft ? 'border-line bg-bg0' : 'border-line2 bg-bg1 hover:border-cy/60',
        )}
      >
        {thumb ? (
          <img src={thumb} alt={`${side} of your garment`} className="h-full w-full object-contain p-1" />
        ) : (
          <>
            <Camera size={20} className="text-cy" />
            <span className="text-[12px] font-medium capitalize text-tx">{side} photo{side === 'back' && ' (optional)'}</span>
            <span className="px-4 text-center text-[10.5px] leading-snug text-tx3">
              Lay the garment flat, shoot straight-on in even light
            </span>
          </>
        )}
        {draft?.processing && (
          <span className="absolute inset-0 flex items-center justify-center gap-2 bg-bg0/80 text-[12px] text-cy backdrop-blur-[2px]">
            <Wand2 size={14} className="animate-pulse" /> Removing background…
          </span>
        )}
      </button>
      {draft && (
        <div className="flex items-center justify-between gap-2">
          <button className="chip hover:border-cy/50 hover:text-cy" onClick={() => inputRef.current?.click()}>
            <RefreshCw size={10} /> Replace
          </button>
          {removeSupported && (
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-tx2">
              <input
                type="checkbox"
                className="accent-[#35C7FF]"
                checked={draft.useCutout}
                onChange={(e) => onToggleCutout(e.target.checked)}
              />
              Cutout background
            </label>
          )}
        </div>
      )}
    </div>
  )
}

export default function CustomSetupModal() {
  const design = useStore((s) => s.design)
  const closeModal = useStore((s) => s.closeModal)
  const setCustom = useStore((s) => s.setCustom)
  const setAssets = useStore((s) => s.setAssets)
  const toast = useStore((s) => s.toast)

  const [widthIn, setWidthIn] = useState(design.custom?.widthIn ?? 20)
  const [front, setFront] = useState<SideDraft | null>(design.custom?.front ?? null)
  const [back, setBack] = useState<SideDraft | null>(design.custom?.back ?? null)
  const removeSupported = isBgRemovalSupported()

  // Narrowing the garment after areas were placed must pull them back onto it.
  const reclampForWidth = (w: number) => {
    const fit = (d: SideDraft | null): SideDraft | null => {
      if (!d) return d
      const a = d.printArea
      const wIn = Math.min(a.wIn, w)
      return {
        ...d,
        printArea: { ...a, wIn, xIn: clamp(a.xIn, 0, Math.max(0, w - wIn)) },
      }
    }
    setFront(fit)
    setBack(fit)
  }

  const upload = (side: Side) => async (file: File) => {
    const setDraft = side === 'front' ? setFront : setBack
    try {
      const meta = await addAsset(file, `${side} — ${file.name}`)
      setAssets(await listAssets())
      const gHIn = (meta.height / meta.width) * widthIn
      const base: SideDraft = {
        assetId: meta.id,
        useCutout: false,
        printArea: defaultCustomPrintArea(widthIn, gHIn),
        processing: removeSupported,
      }
      setDraft(base)

      if (removeSupported) {
        // Guarded with functional updates: if the user replaced the photo
        // while this job ran, the stale completion must not resurrect it.
        const ifCurrent = (fn: (d: SideDraft) => SideDraft) => (prev: SideDraft | null) =>
          prev?.assetId === meta.id ? fn(prev) : prev
        try {
          const blob = await getAssetBlob(meta.id)
          if (blob) {
            // Never let a stuck removal wedge the wizard — fall back to the
            // full photo after 90s (user can retry from Uploads later).
            const cut = await Promise.race([
              removeBackground(blob),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('timeout')), 90_000),
              ),
            ])
            setAssets(await setAssetCutout(meta.id, cut))
            invalidateCustomBBox(meta.id)
            setDraft(ifCurrent((d) => ({ ...d, useCutout: true, processing: false })))
            return
          }
        } catch {
          toast('warn', 'Background removal failed — using the full photo')
        }
        setDraft(ifCurrent((d) => ({ ...d, processing: false })))
      }
    } catch {
      toast('error', 'Could not read that photo')
    }
  }

  const save = () => {
    if (!front) {
      toast('warn', 'Add at least the front photo')
      return
    }
    const stripped = (d: SideDraft | null): CustomSideSetup | null =>
      d ? { assetId: d.assetId, useCutout: d.useCutout, printArea: d.printArea } : null
    setCustom({ widthIn, front: stripped(front), back: stripped(back) })
    closeModal('customSetup')
    const hasBackLayers = design.layers.some((l) => l.side === 'back')
    if (!back && hasBackLayers) {
      toast('warn', 'This design has back-side elements — add a back photo to see and edit them')
    } else {
      toast('ok', 'Your garment is set up — design away')
    }
  }

  return (
    <Modal
      title="Print on your own garment"
      subtitle="You ship it to us, we decorate it. Photos let you preview the design in place — in 2D and 3D."
      onClose={() => closeModal('customSetup')}
      size="lg"
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3 sm:flex-row">
          <PhotoTile
            side="front"
            draft={front}
            onUpload={(f) => void upload('front')(f)}
            onToggleCutout={(useCutout) => front && setFront({ ...front, useCutout })}
            removeSupported={removeSupported}
          />
          <PhotoTile
            side="back"
            draft={back}
            onUpload={(f) => void upload('back')(f)}
            onToggleCutout={(useCutout) => back && setBack({ ...back, useCutout })}
            removeSupported={removeSupported}
          />
        </div>

        <section>
          <div className="panel-title mb-2">Garment width — measured flat, pit to pit ×2</div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={14}
              max={30}
              step={0.5}
              value={widthIn}
              onChange={(e) => {
                const w = Number(e.target.value)
                setWidthIn(w)
                reclampForWidth(w)
              }}
            />
            <span className="mono-dim w-12 shrink-0 text-right text-cy">{fmtIn(widthIn)}</span>
          </div>
          <p className="mt-1 text-[11px] text-tx3">
            This keeps every element true to size on the preview and the print.
          </p>
        </section>

        {front && !front.processing && (
          <section>
            <div className="panel-title mb-2">Front print area</div>
            <PrintAreaPlacer
              setup={front}
              widthIn={widthIn}
              onChange={(printArea) => setFront({ ...front, printArea })}
            />
          </section>
        )}
        {back && !back.processing && (
          <section>
            <div className="panel-title mb-2">Back print area</div>
            <PrintAreaPlacer
              setup={back}
              widthIn={widthIn}
              onChange={(printArea) => setBack({ ...back, printArea })}
            />
          </section>
        )}

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <button className="btn btn-ghost" onClick={() => closeModal('customSetup')}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!front || front.processing}>
            Use this garment
          </button>
        </div>
      </div>
    </Modal>
  )
}
