import { useRef, useState } from 'react'
import { FileDown, FileUp, Image as ImageIcon, Link2, Printer, Smartphone, TriangleAlert } from 'lucide-react'
import Modal from './Modal'
import { useStore } from '@/state/store'
import { useMockupUrl } from '../hooks/useMockup'
import {
  canShareAsLink,
  designToShareHash,
  exportDesignFile,
  importDesignFile,
} from '@/state/persist'
import { getAreaSizeIn, missingImageLayers, renderMockup, renderPrintArea, sideLayers } from '@/lib/renderDesign'
import { printScaleK } from '@/lib/printScale'
import { listAssets } from '@/state/assets'
import { downloadBlob, downloadCanvasPng, slugify } from '@/lib/download'
import { fmtSizeCm } from '@/lib/units'
import type { Side } from '@/lib/types'
import { useT } from '@/i18n/useT'

const PRINT_DPI = 300
const MIN_EFFECTIVE_DPI = 150

export default function ShareModal() {
  const t = useT()
  const design = useStore((s) => s.design)
  const assets = useStore((s) => s.assets)
  const closeModal = useStore((s) => s.closeModal)
  const openModal = useStore((s) => s.openModal)
  const toast = useStore((s) => s.toast)
  const loadDesign = useStore((s) => s.loadDesign)
  const previewSize = useStore((s) => s.previewSize)
  const preview = useMockupUrl(design, 'front', 420)
  const importRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const linkable = canShareAsLink(design)
  const sides = (['front', 'back', 'sleeve'] as Side[]).filter(
    (sd) => sideLayers(design, sd).length > 0,
  )

  // Effective DPI is measured against the PHYSICAL width, so a graded-up size
  // (the same pixels stretched over a wider print) must be able to trip the
  // soft-print warning that the base size did not.
  const k = printScaleK(design, previewSize)
  const lowResLayers = (side: Side): string[] =>
    sideLayers(design, side)
      .filter((l) => l.type === 'image')
      .filter((l) => {
        const a = assets.find((x) => x.id === (l as { assetId: string }).assetId)
        if (!a) return false
        return a.width / ((l as { wIn: number }).wIn * k) < MIN_EFFECTIVE_DPI
      })
      .map((l) => l.name)

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    try {
      await fn()
    } catch {
      toast('error', t('toast.export_failed'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal
      title={t('share.title')}
      subtitle={t('share.subtitle')}
      onClose={() => closeModal('share')}
      size="lg"
    >
      <div className="grid gap-5 sm:grid-cols-[200px_1fr]">
        <div>
          {preview ? (
            <img src={preview} alt={t('share.preview_alt')} className="rounded-xl border border-line bg-bg1 p-2" />
          ) : (
            <div className="aspect-square rounded-xl border border-line bg-bg1" />
          )}
        </div>

        <div className="flex flex-col gap-4">
          <section>
            <div className="panel-title mb-2">{t('share.mockups')}</div>
            <div className="flex flex-wrap gap-2">
              {(['front', 'back', 'sleeve'] as Side[])
                .filter((sd) => sd !== 'sleeve' || sideLayers(design, sd).length > 0)
                .map((sd) => (
                  <button
                    key={sd}
                    className="btn"
                    disabled={busy !== null}
                    onClick={() =>
                      run(`mock-${sd}`, async () => {
                        const c = await renderMockup(design, sd, 1600, previewSize)
                        await downloadCanvasPng(c, `teeshoop-${slugify(design.name)}-${sd}-mockup.png`)
                      })
                    }
                  >
                    <ImageIcon size={14} />
                    {sd === 'front' ? t('share.front_png') : sd === 'back' ? t('share.back_png') : t('share.sleeve_png')}
                  </button>
                ))}
            </div>
          </section>

          <section>
            {/* The size is part of the deliverable now: a graded print differs
                physically per size, so it is shown next to the DPI. */}
            <div className="panel-title mb-2">
              {t('share.print_ready', { dpi: PRINT_DPI })} · {previewSize}
            </div>
            {sides.length === 0 ? (
              <p className="text-[12px] text-tx3">{t('share.add_something')}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {sides.map((sd) => {
                  // Graded to the previewed size: this listing describes the
                  // file the printer receives, so it must match renderPrintArea.
                  const area = getAreaSizeIn(design, sd, previewSize)
                  const warn = lowResLayers(sd)
                  return (
                    <div key={sd} className="flex items-center gap-3 rounded-lg border border-line bg-bg1 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-[12.5px] font-medium capitalize text-tx">{sd === 'front' ? t('common.front') : sd === 'back' ? t('common.back') : t('common.sleeve')}</div>
                        <div className="mono-dim">
                          {fmtSizeCm(area.wIn, area.hIn)} · {t('share.transparent_png')}
                        </div>
                        {warn.length > 0 && (
                          <div className="mt-1 flex items-start gap-1 text-[11px] text-yl">
                            <TriangleAlert size={11} className="mt-px shrink-0" />
                            {t('share.may_print_soft', { names: warn.join(', '), dpi: MIN_EFFECTIVE_DPI })}
                          </div>
                        )}
                      </div>
                      <button
                        className="btn shrink-0"
                        disabled={busy !== null}
                        onClick={() =>
                          run(`print-${sd}`, async () => {
                            // A file for a printer is refused, not sent without a layer (STU-03).
                            const manquants = await missingImageLayers(design, sd)
                            if (manquants.length > 0) {
                              toast('error', t('share.missing_images', { names: manquants.join(', ') }))
                              return
                            }
                            const c = await renderPrintArea(design, sd, PRINT_DPI, previewSize)
                            if (!c) return
                            // Grading makes the physical size size-dependent:
                            // name the file after the size it was graded to, or
                            // two sizes of the same design are indistinguishable
                            // on the printer's desk.
                            await downloadCanvasPng(
                              c,
                              `teeshoop-${slugify(design.name)}-${sd}-${previewSize}-${area.wIn.toFixed(1)}x${area.hIn.toFixed(1)}in-300dpi.png`,
                            )
                            toast('ok', t('toast.print_saved'))
                          })
                        }
                      >
                        <Printer size={14} />
                        {busy === `print-${sd}` ? t('common.rendering') : t('common.download')}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          <section>
            <div className="panel-title mb-2">{t('ar.section')}</div>
            <button
              className="btn btn-primary"
              onClick={() => {
                closeModal('share')
                openModal('ar')
              }}
            >
              <Smartphone size={14} />
              {t('ar.view_in_ar')}
            </button>
          </section>

          <section>
            <div className="panel-title mb-2">{t('share.share_section')}</div>
            <div className="flex flex-wrap gap-2">
              <button
                className="btn"
                disabled={!linkable}
                title={
                  linkable
                    ? t('share.link_tip')
                    : t('share.link_tip_disabled')
                }
                onClick={() =>
                  run('link', async () => {
                    const url = `${location.origin}${location.pathname}${designToShareHash(design)}`
                    await navigator.clipboard.writeText(url)
                    toast('ok', t('toast.link_copied'))
                  })
                }
              >
                <Link2 size={14} />
                {t('share.copy_link')}
              </button>
              <button
                className="btn"
                disabled={busy !== null}
                onClick={() =>
                  run('file', async () => {
                    const blob = await exportDesignFile(design)
                    downloadBlob(blob, `${slugify(design.name)}.teeshoop.json`)
                  })
                }
              >
                <FileDown size={14} />
                {t('share.design_file')}
              </button>
              <button className="btn" onClick={() => importRef.current?.click()}>
                <FileUp size={14} />
                {t('share.open_file')}
              </button>
              <input
                ref={importRef}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) return
                  try {
                    const d = await importDesignFile(f)
                    loadDesign(d)
                    useStore.getState().setAssets(await listAssets())
                    closeModal('share')
                    toast('ok', t('toast.loaded_name', { name: d.name }))
                  } catch {
                    toast('error', t('toast.not_tshop_file'))
                  }
                }}
              />
            </div>
            {!linkable && (
              <p className="mt-2 text-[11px] leading-relaxed text-tx3">
                {t('share.photos_note')}
              </p>
            )}
          </section>
        </div>
      </div>
    </Modal>
  )
}
