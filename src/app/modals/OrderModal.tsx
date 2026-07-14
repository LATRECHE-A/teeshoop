import { useMemo, useState } from 'react'
import { Copy, Mail, Minus, Plus } from 'lucide-react'
import Modal from './Modal'
import { useStore } from '@/state/store'
import { useMockupUrl } from '../hooks/useMockup'
import { GARMENTS } from '@/garments'
import { GARMENT_COLORS } from '@/content/palettes'
import { QTY_BREAKS, SIZES, quote } from '@/content/pricing'
import { sideLayers } from '@/lib/renderDesign'
import { BUSINESS } from '@/config'

export default function OrderModal() {
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
  const q = quote(design.garmentId, Math.max(1, printedSides), Math.max(1, qty))

  const garmentName =
    design.garmentId === 'custom'
      ? 'Customer-supplied garment'
      : GARMENTS[design.garmentId].name
  const colorName =
    design.garmentId === 'custom'
      ? '—'
      : GARMENT_COLORS.find((c) => c.id === design.colorId)?.name ?? design.colorId

  const nextBreak = useMemo(
    () => QTY_BREAKS.find((b) => qty < b.minQty),
    [qty],
  )

  const summary = [
    `Design: ${design.name}`,
    `Garment: ${garmentName}${design.garmentId !== 'custom' ? ` — ${colorName}` : ''}`,
    `Printed sides: ${Math.max(1, printedSides)}`,
    `Sizes: ${SIZES.map((s) => (sizes[s] ? `${s}×${sizes[s]}` : null))
      .filter(Boolean)
      .join(', ') || '—'}`,
    `Quantity: ${qty}`,
    `Estimated: $${q.unitUsd.toFixed(2)}/pc · $${q.totalUsd.toFixed(2)} total${
      q.discount ? ` (${Math.round(q.discount * 100)}% qty discount)` : ''
    }`,
  ].join('\n')

  const setQty = (size: string, v: number) =>
    setSizes((s) => ({ ...s, [size]: Math.max(0, Math.min(999, v)) }))

  const mailto = `mailto:${BUSINESS.quoteEmail}?subject=${encodeURIComponent(
    `Quote request — ${design.name}`,
  )}&body=${encodeURIComponent(
    `Hi ${BUSINESS.name},\n\nI'd like a quote for this design:\n\n${summary}\n\n(Design created in ${BUSINESS.name} Studio — I can share the design file on request.)`,
  )}`

  return (
    <Modal
      title="Review & request a quote"
      subtitle="Checkout is coming with the full site — for now we confirm every order personally."
      onClose={() => closeModal('order')}
      size="lg"
    >
      <div className="grid gap-5 sm:grid-cols-[220px_1fr]">
        <div className="flex flex-col gap-3">
          {front && (
            <img src={front} alt="Front mockup" className="rounded-xl border border-line bg-bg1 p-2" />
          )}
          {sideLayers(design, 'back').length > 0 && back && (
            <img src={back} alt="Back mockup" className="rounded-xl border border-line bg-bg1 p-2" />
          )}
          <div className="rounded-lg border border-line bg-bg1 p-3 text-[12px] leading-relaxed text-tx2">
            <div className="font-semibold text-tx">{garmentName}</div>
            {design.garmentId !== 'custom' && <div>Color: {colorName}</div>}
            <div>
              {Math.max(1, printedSides)} printed side
              {printedSides > 1 ? 's' : ''} · {design.layers.length} element
              {design.layers.length === 1 ? '' : 's'}
            </div>
            {design.garmentId === 'custom' && (
              <div className="mt-1.5 text-yl">
                You ship the garment to us; pricing covers decoration only.
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <section>
            <div className="panel-title mb-2">Sizes & quantity</div>
            <div className="grid grid-cols-3 gap-2">
              {SIZES.map((size) => (
                <div key={size} className="flex items-center justify-between rounded-lg border border-line bg-bg1 px-2 py-1.5">
                  <span className="text-[12px] font-semibold text-tx2">{size}</span>
                  <span className="flex items-center gap-1">
                    <button className="iconbtn h-6 w-6" aria-label={`Fewer ${size}`} onClick={() => setQty(size, (sizes[size] ?? 0) - 1)}>
                      <Minus size={12} />
                    </button>
                    <input
                      aria-label={`Quantity ${size}`}
                      className="w-8 bg-transparent text-center font-mono text-[12.5px] text-tx"
                      value={sizes[size] ?? 0}
                      onChange={(e) => setQty(size, Number(e.target.value) || 0)}
                    />
                    <button className="iconbtn h-6 w-6" aria-label={`More ${size}`} onClick={() => setQty(size, (sizes[size] ?? 0) + 1)}>
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
              <span className="text-tx3">Estimate — final quote confirmed by email</span>
              {q.discount > 0 ? (
                <span className="font-semibold text-ok">
                  {Math.round(q.discount * 100)}% quantity discount applied
                </span>
              ) : nextBreak ? (
                <span className="text-yl">
                  {Math.round(nextBreak.discount * 100)}% off from {nextBreak.minQty}+
                </span>
              ) : null}
            </div>
          </section>

          <div className="flex flex-col gap-2 sm:flex-row">
            <a className="btn btn-primary h-10 flex-1 justify-center" href={qty > 0 ? mailto : undefined} aria-disabled={qty === 0} onClick={(e) => qty === 0 && e.preventDefault()}>
              <Mail size={15} />
              Email quote request
            </a>
            <button
              className="btn h-10 flex-1 justify-center"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(summary)
                  toast('ok', 'Order summary copied')
                } catch {
                  toast('error', 'Could not access the clipboard')
                }
              }}
            >
              <Copy size={15} />
              Copy summary
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-tx3">
            Attach your saved design file (Share & export → design file) to the
            email so we can print exactly what you made.
          </p>
        </div>
      </div>
    </Modal>
  )
}
