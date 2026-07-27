import { useEffect, useRef, useState } from 'react'
import { Camera, RefreshCw, Sparkles, Wand2 } from 'lucide-react'
import clsx from 'clsx'
import Modal from './Modal'
import PrintAreaPlacer from '@/app/PrintAreaPlacer'
import { useStore } from '@/state/store'
import { useT } from '@/i18n'
import {
  addAsset,
  ensureAssetImage,
  getAssetBlob,
  listAssets,
  setAssetCutout,
} from '@/state/assets'
import { isBgRemovalSupported, removeBackground } from '@/lib/bgremove'
import { defaultCustomPrintArea, invalidateCustomBBox } from '@/lib/custom'
import { invalidateGarmentAnatomy } from '@/lib/garmentAnatomy'
import {
  GARMENT_SHAPES,
  getShapeOverride,
  setShapeOverride,
  type GarmentShape,
} from '@/lib/garmentShape'
import { detectGarmentShape, type ShapeDetection } from '@/lib/silhouette'
import { generateBackSide, IngestPhotoError } from '@/lib/ingest/pipeline'
import type { CustomSideSetup, Side } from '@/lib/types'
import { fmtCm, fmtIn, inToCm } from '@/lib/units'
import { shapeKey, useShapeT } from './customShapeI18n'

interface SideDraft extends CustomSideSetup {
  processing?: boolean
}

function PhotoTile({
  side,
  draft,
  onUpload,
  onToggleCutout,
  removeSupported,
  extra,
}: {
  side: Side
  draft: SideDraft | null
  onUpload: (file: File) => void
  onToggleCutout: (use: boolean) => void
  removeSupported: boolean
  /** Side-specific controls under the tile (the back's "generate" action). */
  extra?: React.ReactNode
}) {
  const t = useT()
  const ts = useShapeT()
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
          <img src={thumb} alt={t('custom.photo_alt', { side: t('side.' + side) })} className="h-full w-full object-contain p-1" />
        ) : (
          <>
            <Camera size={20} className="text-cy" />
            <span className="text-[12px] font-medium capitalize text-tx">{t('side.' + side)} {t('custom.photo_word')}{side === 'back' && ' ' + t('custom.optional')}</span>
            <span className="px-4 text-center text-[10.5px] leading-snug text-tx3">
              {t('custom.photo_tip')}
            </span>
          </>
        )}
        {draft?.processing && (
          <span className="absolute inset-0 flex items-center justify-center gap-2 bg-bg0/80 text-[12px] text-cy backdrop-blur-[2px]">
            <Wand2 size={14} className="animate-pulse" /> {t('custom.removing_bg')}
          </span>
        )}
        {/* A reconstructed side is never allowed to pass for a photograph —
            the badge sits ON the image, so it travels with every screenshot of
            this dialog exactly as the baked mark travels with the pixels. */}
        {draft?.origin === 'generated' && !draft.processing && (
          <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-bg0/85 px-1.5 py-0.5 text-[10px] font-semibold text-cy">
            <Sparkles size={10} /> {ts('custom.back.generated')}
          </span>
        )}
      </button>
      {draft && (
        <div className="flex items-center justify-between gap-2">
          <button className="chip hover:border-cy/50 hover:text-cy" onClick={() => inputRef.current?.click()}>
            <RefreshCw size={10} /> {t('common.replace')}
          </button>
          {removeSupported && (
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-tx2">
              <input
                type="checkbox"
                className="accent-cy"
                checked={draft.useCutout}
                onChange={(e) => onToggleCutout(e.target.checked)}
              />
              {t('custom.cutout_bg')}
            </label>
          )}
        </div>
      )}
      {extra}
    </div>
  )
}

/**
 * Garment family picker.
 *
 * The 3D shell borrows a real garment mesh's depth field, and WHICH mesh is the
 * one decision in that pipeline a silhouette can genuinely get wrong (a wide
 * flat-lay tee and a cropped sweat read alike from the outline alone). The
 * classifier's answer is shown, and a dropdown beats a wrong guess — so the
 * customer can overrule it in one click instead of living with a hood on a
 * t-shirt. 'auto' stores nothing and leaves detection in charge.
 */
function ShapePicker({
  value,
  detected,
  isGarment,
  onChange,
}: {
  value: GarmentShape | 'auto'
  detected: GarmentShape | null
  /** Did the upload pass the structural test at all (silhouette.ts)? */
  isGarment: boolean
  onChange: (v: GarmentShape | 'auto') => void
}) {
  const ts = useShapeT()
  return (
    <section>
      <div className="panel-title mb-2">{ts('custom.shape.label')}</div>
      <select
        className="input"
        data-custom="shape-select"
        value={value}
        onChange={(e) => onChange(e.target.value as GarmentShape | 'auto')}
      >
        <option value="auto">
          {ts('custom.shape.auto')}
          {detected && isGarment
            ? ` — ${ts('custom.shape.auto_is', { shape: ts(shapeKey(detected)) })}`
            : ''}
        </option>
        {GARMENT_SHAPES.map((s) => (
          <option key={s} value={s}>
            {ts(shapeKey(s))}
          </option>
        ))}
      </select>
      {/* When the structure gate refused, say so plainly and hand the decision
          over. The 3D preview keeps the shape-agnostic shell either way, so this
          is an offer, not an error — and naming a type here overrules the test
          (src/lib/silhouette.ts), which is the right authority order. */}
      <p className={clsx('mt-1 text-[11px]', isGarment ? 'text-tx3' : 'text-yl')}>
        {isGarment ? ts('custom.shape.hint') : ts('custom.shape.unsure')}
      </p>
    </section>
  )
}

export default function CustomSetupModal() {
  const t = useT()
  const ts = useShapeT()
  const design = useStore((s) => s.design)
  const closeModal = useStore((s) => s.closeModal)
  const setCustom = useStore((s) => s.setCustom)
  const setAssets = useStore((s) => s.setAssets)
  const toast = useStore((s) => s.toast)

  const [widthIn, setWidthIn] = useState(design.custom?.widthIn ?? 20)
  const [front, setFront] = useState<SideDraft | null>(design.custom?.front ?? null)
  const [back, setBack] = useState<SideDraft | null>(design.custom?.back ?? null)
  const [shape, setShape] = useState<GarmentShape | 'auto'>(getShapeOverride() ?? 'auto')
  const [detected, setDetected] = useState<ShapeDetection | null>(null)
  const [genBack, setGenBack] = useState(false)
  const removeSupported = isBgRemovalSupported()
  /** The live front, for async completions that must not act on a stale one. */
  const frontRef = useRef(front)
  frontRef.current = front

  // Run the shell's own classifier on the front photo so the picker can say
  // what it found. Keyed on the photo (not the draft object) — the print-area
  // placer rewrites the draft on every drag, and re-decoding the image for
  // that would be pure waste.
  const frontAsset = front?.assetId ?? null
  const frontCutout = front?.useCutout ?? false
  const frontBusy = front?.processing ?? false
  useEffect(() => {
    let on = true
    setDetected(null)
    if (!frontAsset || frontBusy) return
    void (async () => {
      try {
        const img = await ensureAssetImage(frontAsset, frontCutout ? 'cutout' : 'original')
        // 512 px long edge: the classifier works off a 200 px mask anyway, so
        // anything larger only costs a decode.
        const scale = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight))
        const c = document.createElement('canvas')
        c.width = Math.max(2, Math.round(img.naturalWidth * scale))
        c.height = Math.max(2, Math.round(img.naturalHeight * scale))
        c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height)
        const guess = detectGarmentShape(c)
        if (on) setDetected(guess)
      } catch {
        if (on) setDetected(null)
      }
    })()
    return () => {
      on = false
    }
  }, [frontAsset, frontCutout, frontBusy])

  /**
   * The print area is stored in inches against a bbox whose WIDTH is the
   * garment width, so every one of its numbers is a fraction of `widthIn` in
   * disguise. Re-declaring the garment's width therefore has to rescale the
   * area by the same factor: the box then stays on exactly the same spot of
   * the photo instead of sliding across it (and can never end up hanging past
   * a hem that just moved up).
   */
  const rescaleForWidth = (prev: number, next: number) => {
    if (!(prev > 0) || !(next > 0) || prev === next) return
    const k = next / prev
    const fit = (d: SideDraft | null): SideDraft | null =>
      d
        ? {
            ...d,
            printArea: {
              xIn: d.printArea.xIn * k,
              yIn: d.printArea.yIn * k,
              wIn: d.printArea.wIn * k,
              hIn: d.printArea.hIn * k,
            },
          }
        : d
    setFront(fit)
    setBack(fit)
  }

  const upload = (side: Side) => async (file: File) => {
    const setDraft = side === 'front' ? setFront : setBack
    // A new front photo is a new garment: whatever the customer chose was about
    // the previous one, so hand the decision back to the classifier.
    if (side === 'front') setShape('auto')
    try {
      const meta = await addAsset(file, `${t('side.' + side)} — ${file.name}`)
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
            invalidateGarmentAnatomy(meta.id)
            setDraft(ifCurrent((d) => ({ ...d, useCutout: true, processing: false })))
            return
          }
        } catch {
          toast('warn', t('toast.bg_removed_fallback'))
        }
        setDraft(ifCurrent((d) => ({ ...d, processing: false })))
      }
    } catch {
      toast('error', t('toast.photo_read_failed'))
    }
  }

  /**
   * Reconstruct the back from the front — the same `generateBackSide` the admin
   * ingest flow runs, so a customer's own upload gets exactly the reconstruction
   * a catalogued product does, provenance stamp included.
   *
   * NEVER AUTOMATIC, and never over anything real. It is offered only when there
   * is no back at all (a real photo must never be replaced by a mirror of the
   * front) and only when the front is CUT OUT: the reconstruction mirrors the
   * front's alpha silhouette and floods it with the garment's colour, so without
   * a cutout there is no silhouette to mirror and the result would be the
   * photo's rectangle, background and all.
   */
  const generateBack = async () => {
    if (!front || front.processing || back || !front.useCutout) return
    const assetId = front.assetId
    setGenBack(true)
    try {
      const gen = await generateBackSide(front, inToCm(widthIn), {
        name: `${t('side.back')} — ${ts('custom.back.generated')}`,
        at: Date.now(),
      })
      setAssets(await listAssets())
      // The front may have been replaced while this ran; a back mirrored from a
      // photo that is no longer there would be worse than none. Read the live
      // front through a ref rather than from inside a setFront updater: an
      // updater must be pure (React may invoke it twice), and one that commits
      // another piece of state as a side effect is exactly the shape of bug
      // that only ever shows up in a StrictMode build.
      if (frontRef.current?.assetId !== assetId) return
      setBack({
        assetId: gen.assetId,
        useCutout: gen.useCutout,
        printArea: gen.printArea,
        origin: 'generated',
      })
    } catch (err) {
      toast(
        'error',
        err instanceof IngestPhotoError && err.code !== 'cutout_failed'
          ? t(`ingest.err.${err.code}`)
          : ts('custom.back.err'),
      )
    } finally {
      setGenBack(false)
    }
  }

  const save = () => {
    if (!front) {
      toast('warn', t('toast.need_front'))
      return
    }
    // `origin` rides along: it is what every downstream surface badges, and what
    // makes the 3D preview and the AR bake treat a reconstructed panel as the
    // reconstruction it is rather than as a second photograph.
    const stripped = (d: SideDraft | null): CustomSideSetup | null =>
      d
        ? {
            assetId: d.assetId,
            useCutout: d.useCutout,
            printArea: d.printArea,
            ...(d.origin ? { origin: d.origin } : {}),
          }
        : null
    // Commit the shape BEFORE setCustom: that call rebuilds the design, which
    // is what makes the 3D preview (and the AR bake behind it) re-read the
    // override — writing it afterwards would leave one stale frame.
    setShapeOverride(shape === 'auto' ? null : shape)
    setCustom({ widthIn, front: stripped(front), back: stripped(back) })
    closeModal('customSetup')
    const hasBackLayers = design.layers.some((l) => l.side === 'back')
    if (!back && hasBackLayers) {
      toast('warn', t('toast.back_elements'))
    } else {
      toast('ok', t('toast.garment_ready'))
    }
  }

  return (
    <Modal
      title={t('custom.title')}
      subtitle={t('custom.subtitle')}
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
            extra={
              front && !front.processing && !back ? (
                <div>
                  <button
                    className="chip w-full justify-center hover:border-cy/50 hover:text-cy disabled:opacity-45"
                    data-custom="generate-back"
                    disabled={genBack || !front.useCutout}
                    onClick={() => void generateBack()}
                  >
                    <Sparkles size={10} className={clsx(genBack && 'animate-pulse')} />
                    {genBack ? ts('custom.back.generating') : ts('custom.back.generate')}
                  </button>
                  <p className="mt-1 text-[10.5px] leading-snug text-tx3">
                    {front.useCutout ? ts('custom.back.hint') : ts('custom.back.needs_cutout')}
                  </p>
                </div>
              ) : null
            }
          />
        </div>

        <section>
          <div className="panel-title mb-2">{t('custom.width_label')}</div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={14}
              max={30}
              step={0.5}
              value={widthIn}
              onChange={(e) => {
                const w = Number(e.target.value)
                rescaleForWidth(widthIn, w)
                setWidthIn(w)
              }}
            />
            <span className="mono-dim w-24 shrink-0 text-right text-cy">
              {fmtCm(inToCm(widthIn))}
              <span className="text-tx3"> · {fmtIn(widthIn)}</span>
            </span>
          </div>
          <p className="mt-1 text-[11px] text-tx3">
            {t('custom.width_hint')}
          </p>
        </section>

        {front && (
          <ShapePicker
            value={shape}
            detected={detected?.shape ?? null}
            isGarment={detected?.structure.isGarment ?? true}
            onChange={setShape}
          />
        )}

        {front && !front.processing && (
          <section>
            <div className="panel-title mb-2">{t('custom.print_area_side', { side: t('side.front') })}</div>
            <PrintAreaPlacer
              setup={front}
              widthIn={widthIn}
              side="front"
              onChange={(printArea) => setFront({ ...front, printArea })}
            />
          </section>
        )}
        {back && !back.processing && (
          <section>
            <div className="panel-title mb-2">{t('custom.print_area_side', { side: t('side.back') })}</div>
            <PrintAreaPlacer
              setup={back}
              widthIn={widthIn}
              side="back"
              onChange={(printArea) => setBack({ ...back, printArea })}
            />
          </section>
        )}

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <button className="btn btn-ghost" onClick={() => closeModal('customSetup')}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!front || front.processing}>
            {t('custom.use_garment')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
