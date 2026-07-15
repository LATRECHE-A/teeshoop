import { useRef, useState } from 'react'
import { FileDown, FileUp, Image as ImageIcon, Link2, Printer, TriangleAlert } from 'lucide-react'
import Modal from './Modal'
import { useStore } from '@/state/store'
import { useMockupUrl } from '../hooks/useMockup'
import {
  canShareAsLink,
  designToShareHash,
  exportDesignFile,
  importDesignFile,
} from '@/state/persist'
import { getAreaSizeIn, renderMockup, renderPrintArea, sideLayers } from '@/lib/renderDesign'
import { listAssets } from '@/state/assets'
import { downloadBlob, downloadCanvasPng, slugify } from '@/lib/download'
import { fmtIn } from '@/lib/units'
import type { Side } from '@/lib/types'
import { useT } from '@/i18n'

const PRINT_DPI = 300
const MIN_EFFECTIVE_DPI = 150

export default function ShareModal() {
  const t = useT()
  const design = useStore((s) => s.design)
  const assets = useStore((s) => s.assets)
  const closeModal = useStore((s) => s.closeModal)
  const toast = useStore((s) => s.toast)
  const loadDesign = useStore((s) => s.loadDesign)
  const preview = useMockupUrl(design, 'front', 420)
  const importRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const linkable = canShareAsLink(design)
  const sides = (['front', 'back'] as Side[]).filter(
    (sd) => sideLayers(design, sd).length > 0,
  )

  const lowResLayers = (side: Side): string[] =>
    sideLayers(design, side)
      .filter((l) => l.type === 'image')
      .filter((l) => {
        const a = assets.find((x) => x.id === (l as { assetId: string }).assetId)
        if (!a) return false
        return a.width / (l as { wIn: number }).wIn < MIN_EFFECTIVE_DPI
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
              {(['front', 'back'] as Side[]).map((sd) => (
                <button
                  key={sd}
                  className="btn"
                  disabled={busy !== null}
                  onClick={() =>
                    run(`mock-${sd}`, async () => {
                      const c = await renderMockup(design, sd, 1600)
                      await downloadCanvasPng(c, `tshop-${slugify(design.name)}-${sd}-mockup.png`)
                    })
                  }
                >
                  <ImageIcon size={14} />
                  {sd === 'front' ? t('share.front_png') : t('share.back_png')}
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="panel-title mb-2">{t('share.print_ready', { dpi: PRINT_DPI })}</div>
            {sides.length === 0 ? (
              <p className="text-[12px] text-tx3">{t('share.add_something')}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {sides.map((sd) => {
                  const area = getAreaSizeIn(design, sd)
                  const warn = lowResLayers(sd)
                  return (
                    <div key={sd} className="flex items-center gap-3 rounded-lg border border-line bg-bg1 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-[12.5px] font-medium capitalize text-tx">{sd === 'front' ? t('common.front') : t('common.back')}</div>
                        <div className="mono-dim">
                          {fmtIn(area.wIn)} × {fmtIn(area.hIn)} · {t('share.transparent_png')}
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
                            const c = await renderPrintArea(design, sd, PRINT_DPI)
                            if (!c) return
                            await downloadCanvasPng(
                              c,
                              `tshop-${slugify(design.name)}-${sd}-${area.wIn}x${area.hIn}in-300dpi.png`,
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
                    downloadBlob(blob, `${slugify(design.name)}.tshop.json`)
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
