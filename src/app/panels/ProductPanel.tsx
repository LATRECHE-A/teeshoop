import { useMemo } from 'react'
import { Camera, Pencil } from 'lucide-react'
import clsx from 'clsx'
import { GARMENTS } from '@/garments'
import { GARMENT_COLORS } from '@/content/palettes'
import { PRICING } from '@/content/pricing'
import { useStore } from '@/state/store'
import { useT } from '@/i18n'
import { getAreaSizeIn } from '@/lib/renderDesign'
import { fmtIn } from '@/lib/units'
import { withSvgSize } from '@/lib/rasterCache'
import type { CatalogGarmentId } from '@/lib/types'

function garmentThumb(id: CatalogGarmentId, hex: string): string {
  const svg = withSvgSize(
    GARMENTS[id].sides.front.body.replaceAll('__COLOR__', hex),
    132,
    132,
  )
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export default function ProductPanel() {
  const t = useT()
  const design = useStore((s) => s.design)
  const side = useStore((s) => s.activeSide)
  const setGarment = useStore((s) => s.setGarment)
  const setColor = useStore((s) => s.setColor)
  const openModal = useStore((s) => s.openModal)

  const thumbs = useMemo(
    () => ({
      tee: garmentThumb('tee', '#E8EAED'),
      hoodie: garmentThumb('hoodie', '#E8EAED'),
    }),
    [],
  )

  const area = getAreaSizeIn(design, side)
  const isCustom = design.garmentId === 'custom'

  return (
    <div className="flex flex-col gap-5 p-3.5">
      <section>
        <div className="panel-title mb-2.5">{t('product.garment')}</div>
        <div className="grid grid-cols-2 gap-2">
          {(['tee', 'hoodie'] as const).map((id) => (
            <button
              key={id}
              onClick={() => setGarment(id)}
              aria-pressed={design.garmentId === id}
              className={clsx(
                'flex flex-col items-center gap-1 rounded-xl border p-2.5 pt-1.5 transition-colors',
                design.garmentId === id
                  ? 'border-cy bg-bg3'
                  : 'border-line bg-bg1 hover:border-line2',
              )}
            >
              <img src={thumbs[id]} alt="" className="h-[84px] w-[84px]" draggable={false} />
              <span className="text-[12px] font-medium text-tx">{t('garment.' + id)}</span>
              <span className="mono-dim">
                {t('product.from_price', { price: PRICING[id].baseUsd.toFixed(2) })}
              </span>
            </button>
          ))}
        </div>

        <button
          onClick={() =>
            design.custom?.front ? setGarment('custom') : openModal('customSetup')
          }
          aria-pressed={isCustom}
          className={clsx(
            'mt-2 flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors',
            isCustom ? 'border-cy bg-bg3' : 'border-dashed border-line2 bg-bg1 hover:border-cy/60',
          )}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-bg3 text-cy">
            <Camera size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] font-semibold text-tx">
              {t('product.your_garment')}
            </span>
            <span className="block text-[11px] leading-snug text-tx2">
              {design.custom?.front
                ? t('product.your_garment_set')
                : t('product.your_garment_cta')}
            </span>
          </span>
          {design.custom?.front && (
            <span
              role="button"
              tabIndex={0}
              className="iconbtn h-7 w-7 shrink-0"
              onClick={(e) => {
                e.stopPropagation()
                openModal('customSetup')
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation()
                  openModal('customSetup')
                }
              }}
              aria-label={t('product.edit_setup')}
            >
              <Pencil size={13} />
            </span>
          )}
        </button>
      </section>

      {!isCustom && (
        <section>
          <div className="panel-title mb-2.5">
            {t('product.color')} ·{' '}
            <span className="normal-case tracking-normal text-tx2">
              {t('color.' + design.colorId)}
            </span>
          </div>
          <div className="grid grid-cols-9 gap-1.5">
            {GARMENT_COLORS.map((c) => (
              <button
                key={c.id}
                title={t('color.' + c.id)}
                aria-label={t('color.' + c.id)}
                aria-pressed={design.colorId === c.id}
                onClick={() => setColor(c.id)}
                className={clsx(
                  'h-6 w-6 rounded-full border transition-transform hover:scale-110',
                  design.colorId === c.id
                    ? 'border-cy ring-2 ring-cy/40'
                    : 'border-black/30',
                )}
                style={{ backgroundColor: c.hex }}
              />
            ))}
          </div>
        </section>
      )}

      <section className="rounded-lg border border-line bg-bg1 p-3">
        <div className="panel-title mb-1.5">
          {t('product.print_area')} · {t('side.' + side)}
        </div>
        <div className="mono-dim text-cy">
          {t('product.print_area_size', { w: fmtIn(area.wIn), h: fmtIn(area.hIn) })}
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-tx3">
          {t('product.print_area_note')}
        </p>
      </section>
    </div>
  )
}
