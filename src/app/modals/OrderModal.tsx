import { useMemo, useState } from 'react'
import { Copy, Mail, Minus, Plus } from 'lucide-react'
import Modal from './Modal'
import { useStore } from '@/state/store'
import { useMockupUrl } from '../hooks/useMockup'
import { QTY_BREAKS, SIZES, quote } from '@/content/pricing'
import { sideLayers } from '@/lib/renderDesign'
import { BUSINESS } from '@/config'
import { useT } from '@/i18n'

export default function OrderModal() {
  const t = useT()
  const design = useStore((s) => s.design)
  const closeModal = useStore((s) => s.closeModal)
  const toast = useStore((s) => s.toast)
  const [sizes, setSizes] = useState<Record<string, number>>({ M: 5, L: 5 })

  const front = useMockupUrl(design, 'front', 380)
  const back = useMockupUrl(design, 'back', 380)

  const printedSides =
    (sideLayers(design, 'front').length > 0 ? 1 : 0) +
    (sideLayers(design, 'back').length > 0 ? 1 : 0)
  const qty = Object.values(sizes).reduce((a, b) => a + b, 0)
  const unit = quote(design.garmentId, Math.max(1, printedSides), Math.max(1, qty))
  const q = qty === 0 ? { ...unit, totalUsd: 0 } : unit

  const garmentName =
    design.garmentId === 'custom'
      ? t('garment.custom')
      : t('garment.' + design.garmentId)
  const colorName =
    design.garmentId === 'custom'
      ? '—'
      : t('color.' + design.colorId)

  const nextBreak = useMemo(
    () => QTY_BREAKS.find((b) => qty < b.minQty),
    [qty],
  )

  const sizesList =
    SIZES.map((s) => (sizes[s] ? `${s}×${sizes[s]}` : null))
      .filter(Boolean)
      .join(', ') || '—'

  const summary = [
    t('order.summary_design', { name: design.name }),
    design.garmentId !== 'custom'
      ? t('order.summary_garment_color', { name: garmentName, color: colorName })
      : t('order.summary_garment', { name: garmentName }),
    t('order.summary_printed_sides', { n: Math.max(1, printedSides) }),
    t('order.summary_sizes', { sizes: sizesList }),
    t('order.summary_quantity', { n: qty }),
    q.discount
      ? t('order.summary_estimated_discount', {
          unit: q.unitUsd.toFixed(2),
          total: q.totalUsd.toFixed(2),
          pct: Math.round(q.discount * 100),
        })
      : t('order.summary_estimated', {
          unit: q.unitUsd.toFixed(2),
          total: q.totalUsd.toFixed(2),
        }),
  ].join('\n')

  const setQty = (size: string, v: number) =>
    setSizes((s) => ({ ...s, [size]: Math.max(0, Math.min(999, v)) }))

  const mailto = `mailto:${BUSINESS.quoteEmail}?subject=${encodeURIComponent(
    t('order.mail_subject', { name: design.name }),
  )}&body=${encodeURIComponent(
    t('order.mail_body', { business: BUSINESS.name, summary }),
  )}`

  return (
    <Modal
      title={t('order.title')}
      subtitle={t('order.subtitle')}
      onClose={() => closeModal('order')}
      size="lg"
    >
      <div className="grid gap-5 sm:grid-cols-[220px_1fr]">
        <div className="flex flex-col gap-3">
          {front && (
            <img src={front} alt={t('order.front_mockup_alt')} className="rounded-xl border border-line bg-bg1 p-2" />
          )}
          {sideLayers(design, 'back').length > 0 && back && (
            <img src={back} alt={t('order.back_mockup_alt')} className="rounded-xl border border-line bg-bg1 p-2" />
          )}
          <div className="rounded-lg border border-line bg-bg1 p-3 text-[12px] leading-relaxed text-tx2">
            <div className="font-semibold text-tx">{garmentName}</div>
            {design.garmentId !== 'custom' && <div>{t('order.color_line', { name: colorName })}</div>}
            <div>
              {printedSides > 1
                ? t('order.printed_side_other', { n: Math.max(1, printedSides) })
                : t('order.printed_side_one', { n: Math.max(1, printedSides) })}
              {' · '}
              {design.layers.length === 1
                ? t('order.element_one', { n: design.layers.length })
                : t('order.element_other', { n: design.layers.length })}
            </div>
            {design.garmentId === 'custom' && (
              <div className="mt-1.5 text-yl">
                {t('order.custom_note')}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <section>
            <div className="panel-title mb-2">{t('order.sizes_quantity')}</div>
            <div className="grid grid-cols-3 gap-2">
              {SIZES.map((size) => (
                <div key={size} className="flex items-center justify-between rounded-lg border border-line bg-bg1 px-2 py-1.5">
                  <span className="text-[12px] font-semibold text-tx2">{size}</span>
                  <span className="flex items-center gap-1">
                    <button className="iconbtn h-6 w-6" aria-label={t('order.fewer_size', { size })} onClick={() => setQty(size, (sizes[size] ?? 0) - 1)}>
                      <Minus size={12} />
                    </button>
                    <input
                      aria-label={t('order.quantity_size', { size })}
                      className="w-8 bg-transparent text-center font-mono text-[12.5px] text-tx"
                      value={sizes[size] ?? 0}
                      onChange={(e) => setQty(size, Number(e.target.value) || 0)}
                    />
                    <button className="iconbtn h-6 w-6" aria-label={t('order.more_size', { size })} onClick={() => setQty(size, (sizes[size] ?? 0) + 1)}>
                      <Plus size={12} />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-line bg-bg1 p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-[13px] text-tx2">
                {qty || 0} × ${q.unitUsd.toFixed(2)}
              </span>
              <span className="font-display text-[22px] font-bold text-tx">
                ${q.totalUsd.toFixed(2)}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[11.5px]">
              <span className="text-tx3">{t('order.estimate_note')}</span>
              {q.discount > 0 ? (
                <span className="font-semibold text-ok">
                  {t('order.discount_applied', { pct: Math.round(q.discount * 100) })}
                </span>
              ) : nextBreak ? (
                <span className="text-yl">
                  {t('order.discount_next', { pct: Math.round(nextBreak.discount * 100), min: nextBreak.minQty })}
                </span>
              ) : null}
            </div>
          </section>

          <div className="flex flex-col gap-2 sm:flex-row">
            <a className="btn btn-primary h-10 flex-1 justify-center" href={qty > 0 ? mailto : undefined} aria-disabled={qty === 0} onClick={(e) => qty === 0 && e.preventDefault()}>
              <Mail size={15} />
              {t('order.email_quote')}
            </a>
            <button
              className="btn h-10 flex-1 justify-center"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(summary)
                  toast('ok', t('toast.summary_copied'))
                } catch {
                  toast('error', t('toast.clipboard_failed'))
                }
              }}
            >
              <Copy size={15} />
              {t('order.copy_summary')}
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-tx3">
            {t('order.attach_note')}
          </p>
        </div>
      </div>
    </Modal>
  )
}
