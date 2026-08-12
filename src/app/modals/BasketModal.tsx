/**
 * Order basket — the several products / sizes / quantities that make up one
 * real order. Each line is a design snapshot taken at add time (see
 * src/state/basket.ts), so editing the live design never rewrites history.
 * The basket is a CUSTOMER surface: it holds no prices and no supplier data.
 * Nesting it onto a transfer roll is workshop tooling and lives in the admin
 * build (src/admin/AdminSlots.tsx).
 */
import { useMemo } from 'react'
import { LayoutGrid, Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react'
import Modal from './Modal'
import { useStore } from '@/state/store'
import { useMockupUrl } from '../hooks/useMockup'
import { basketTotals, linePrintedSides, type BasketLine } from '@/state/basket'
import { useBasketT } from './basketI18n'
import { useBoardT } from '../board/boardI18n'
import type { TParams } from '@/i18n'

/** One order line — its own component so the mockup hook can run per line. */
function BasketRow({
  line,
  t,
}: {
  line: BasketLine
  t: (key: string, params?: TParams) => string
}) {
  const setBasketQty = useStore((s) => s.setBasketQty)
  const removeBasketLine = useStore((s) => s.removeBasketLine)
  const toast = useStore((s) => s.toast)

  const sides = linePrintedSides(line.design)
  const thumb = useMockupUrl(line.design, sides[0] ?? 'front', 220)

  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-bg1 p-2.5">
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-bg2">
        {thumb && (
          <img src={thumb} alt={line.label} className="h-full w-full object-contain" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-tx">{line.label}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-tx2">
          <span
            className="h-3 w-3 shrink-0 rounded-full border border-line"
            style={{ backgroundColor: line.colorHex }}
            aria-hidden
          />
          <span className="truncate">{line.garmentLabel}</span>
          <span className="mono-dim shrink-0 text-cy">
            {t('basket.line_size', { size: line.size })}
          </span>
        </div>
        <div className="mt-0.5 text-[11px] text-tx3">
          {sides.length
            ? t('basket.line_sides', {
                sides: sides.map((s) => t(`common.${s}`)).join(' · '),
              })
            : t('basket.line_no_print')}
        </div>
      </div>

      <span className="flex shrink-0 items-center gap-1">
        <button
          className="iconbtn h-7 w-7"
          aria-label={t('basket.fewer', { name: line.label })}
          onClick={() => setBasketQty(line.id, line.qty - 1)}
        >
          <Minus size={12} />
        </button>
        <input
          aria-label={t('basket.qty', { name: line.label })}
          className="w-9 bg-transparent text-center font-mono text-[12.5px] text-tx"
          value={line.qty}
          onChange={(e) => setBasketQty(line.id, Number(e.target.value) || 1)}
        />
        <button
          className="iconbtn h-7 w-7"
          aria-label={t('basket.more', { name: line.label })}
          onClick={() => setBasketQty(line.id, line.qty + 1)}
        >
          <Plus size={12} />
        </button>
      </span>

      <button
        className="iconbtn h-7 w-7 shrink-0 text-dg"
        aria-label={t('basket.remove', { name: line.label })}
        onClick={() => {
          removeBasketLine(line.id)
          toast('info', t('basket.removed', { name: line.label }))
        }}
      >
        <Trash2 size={13} />
      </button>
    </div>
  )
}

export default function BasketModal() {
  const t = useBasketT()
  const bt = useBoardT()
  const enterBoard = useStore((s) => s.enterBoard)
  const basket = useStore((s) => s.basket)
  const design = useStore((s) => s.design)
  const previewSize = useStore((s) => s.previewSize)
  const addToBasket = useStore((s) => s.addToBasket)
  const clearBasket = useStore((s) => s.clearBasket)
  const closeModal = useStore((s) => s.closeModal)
  const toast = useStore((s) => s.toast)

  const totals = useMemo(() => basketTotals(basket), [basket])

  return (
    <Modal
      title={t('basket.title')}
      subtitle={t('basket.subtitle')}
      onClose={() => closeModal('basket')}
      size="lg"
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          className="btn"
          onClick={() => {
            addToBasket()
            toast('ok', t('basket.added', { name: design.name, size: previewSize }))
          }}
        >
          <ShoppingBag size={14} />
          {t('basket.add_current')}
        </button>
        {basket.length > 0 && (
          <button
            className="btn btn-ghost"
            onClick={() => {
              clearBasket()
              toast('info', t('basket.cleared'))
            }}
          >
            <Trash2 size={14} />
            {t('basket.clear')}
          </button>
        )}
      </div>

      {basket.length === 0 ? (
        <div className="rounded-xl border border-line bg-bg1 p-6 text-center text-[13px] text-tx2">
          {t('basket.empty')}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {basket.map((line) => (
              <BasketRow key={line.id} line={line} t={t} />
            ))}
          </div>

          <section className="mt-4 rounded-xl border border-line bg-bg1 p-4">
            <div className="panel-title mb-2">{t('basket.totals.title')}</div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <div className="font-display text-[20px] font-bold text-tx">
                  {totals.garments}
                </div>
                <div className="text-[11px] text-tx3">{t('basket.totals.garments')}</div>
              </div>
              <div>
                <div className="font-display text-[20px] font-bold text-tx">
                  {totals.printsTotal}
                </div>
                <div className="text-[11px] text-tx3">{t('basket.totals.prints')}</div>
              </div>
              <div>
                <div className="font-display text-[20px] font-bold text-tx">
                  {totals.lines}
                </div>
                <div className="text-[11px] text-tx3">{t('basket.totals.lines')}</div>
              </div>
            </div>
            <div className="mono-dim mt-2 border-t border-line pt-2 text-center text-[11px] text-cy">
              {t('basket.totals.by_side', {
                front: totals.prints.front,
                back: totals.prints.back,
                sleeve: totals.prints.sleeve,
              })}
            </div>
          </section>

          <div className="mt-4 flex flex-col gap-2">
            {/* enterBoard() closes this modal in the SAME set() — a board behind
                a live scrim is unreachable and takes the keyboard with it. */}
            <button className="btn h-10 justify-center" onClick={enterBoard}>
              <LayoutGrid size={15} />
              {bt('board.open')}
            </button>
            <p className="text-[11px] leading-relaxed text-tx3">{bt('board.open_hint')}</p>
            {/* The "build the DTF sheet" button used to live here. It is
                workshop tooling — it exposes our film cost per linear metre —
                so it now belongs to the admin build only, reachable from the
                tools menu (which already defaults to nesting the whole basket).
                The basket itself stays customer: it is an order, not a job. */}
          </div>
        </>
      )}
    </Modal>
  )
}
