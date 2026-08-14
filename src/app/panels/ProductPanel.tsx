import { useMemo } from 'react'
import { Camera, Pencil } from 'lucide-react'
import clsx from 'clsx'
import { GARMENTS } from '@/garments'
import { GARMENT_COLORS } from '@/content/palettes'
import { PRICING } from '@/content/pricing'
import { useShopBridge } from '@/app/hooks/useShopBridge'
import { SIZE_CHARTS, SIZE_IDS } from '@/content/sizeChart'
import { useStore } from '@/state/store'
import { useAdminSlots } from '@/app/adminSlots'
import { useT } from '@/i18n'
import { getAreaSizeIn } from '@/lib/renderDesign'
import { gradableSizes, printScaleOf } from '@/lib/printScale'
import { fmtCm, fmtInAsCm, fmtNum, fmtSizeCm, inToCm } from '@/lib/units'
import { withSvgSize } from '@/lib/rasterCache'
import type { CatalogGarmentId, PrintScaleMode } from '@/lib/types'

/**
 * Print-grading strings. `messages.ts` is owned by the i18n integrator, so
 * they live here as literals — French first, English fallback — exactly like a
 * module side-file, minus the file. See the report for the keys to merge.
 */
const GRADE_I18N = {
  fr: {
    title: 'Échelle d’impression',
    scaled: 'Proportionnelle',
    fixed: 'Identique',
    hint_scaled:
      'L’impression grandit avec le vêtement : toutes les tailles ont le même rendu. Un film par taille — plus cher.',
    hint_fixed:
      'Une seule impression physique pour toutes les tailles : un seul film — moins cher, mais le motif paraît petit sur un 3XL.',
    base: 'Taille de référence',
    base_note:
      'Vos dimensions sont mémorisées sur cette taille. En changer réinterprète le design : il grandit ou rétrécit sur les autres tailles.',
    unavailable:
      'Ce vêtement n’a pas de guide des tailles : l’impression reste identique sur toutes les tailles.',
    for_size: 'Taille',
  },
  en: {
    title: 'Print scaling',
    scaled: 'Proportional',
    fixed: 'Same on every size',
    hint_scaled:
      'The print grows with the garment, so every size reads the same. One film per size — costs more.',
    hint_fixed:
      'One physical print for every size: a single film — cheaper, but the artwork looks small on a 3XL.',
    base: 'Reference size',
    base_note:
      'Your dimensions are stored on this size. Changing it re-interprets the design: it grows or shrinks on the other sizes.',
    unavailable:
      'This garment has no size chart — the print stays identical on every size.',
    for_size: 'Size',
  },
} as const

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
  const { canOrder } = useShopBridge()
  const admin = useAdminSlots()
  const design = useStore((s) => s.design)
  const side = useStore((s) => s.activeSide)
  const setGarment = useStore((s) => s.setGarment)
  const setColor = useStore((s) => s.setColor)
  const openModal = useStore((s) => s.openModal)
  const previewSize = useStore((s) => s.previewSize)
  const setPreviewSize = useStore((s) => s.setPreviewSize)
  const setPrintScaleMode = useStore((s) => s.setPrintScaleMode)
  const setPrintBaseSize = useStore((s) => s.setPrintBaseSize)
  const lang = useStore((s) => s.lang)
  const g = (k: keyof typeof GRADE_I18N.fr) => (GRADE_I18N[lang] ?? GRADE_I18N.fr)[k]

  const thumbs = useMemo(
    () => ({
      tee: garmentThumb('tee', '#E8EAED'),
      hoodie: garmentThumb('hoodie', '#E8EAED'),
    }),
    [],
  )

  // READ path (display only) — graded, so the number tells the truth about the
  // size being previewed. Every WRITE path still uses the base-space area.
  const area = getAreaSizeIn(design, side, previewSize)
  const isCustom = design.garmentId === 'custom'
  const printScale = printScaleOf(design)
  const baseSizes = gradableSizes(design)
  const canGrade = baseSizes.length > 1

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
              {/* Silent when a real shop is on the other side of the frame.
                  PRICING is the studio's own demo table, in dollars, and it
                  disagrees with the server: it says "dès 14,50 $" for a tee the
                  shop prices from 9,50 EUR HT. Two prices in two currencies, a
                  panel apart, is exactly the divergence the server-side price
                  authority exists to prevent, and framing the studio is what
                  first put them on one screen. The shop's own "from" price
                  belongs on the product page (GET /wp-json/teeshoop/v1/grid),
                  which is session 02. */}
              {!canOrder && (
                <span className="mono-dim">
                  {t('product.from_price', { price: PRICING[id].baseUsd.toFixed(2) })}
                </span>
              )}
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

        {/* Supplier catalogue — admin only. It shows OUR purchase cost, so the
            card and the code behind it exist in the admin build alone. */}
        {admin.productEntry}
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

      {!isCustom && (
        <section>
          <div className="panel-title mb-2.5">
            {t('product.size')} ·{' '}
            <span className="normal-case tracking-normal text-tx2">{previewSize}</span>
          </div>
          <div className="flex gap-1">
            {SIZE_IDS.map((sz) => (
              <button
                key={sz}
                onClick={() => setPreviewSize(sz)}
                aria-pressed={previewSize === sz}
                className={clsx(
                  'btn h-8 flex-1 px-0 text-[11px]',
                  previewSize === sz && 'btn-primary',
                )}
              >
                {sz}
              </button>
            ))}
          </div>
          {/* Physical print area for the size being previewed — under grading
              this changes as the chips are clicked, which is the feedback that
              makes the feature believable. */}
          <div className="mono-dim mt-2 text-[11px] text-tx2">
            {t('product.print_area')} · {t('side.' + side)} : {fmtSizeCm(area.wIn, area.hIn)}
          </div>
          {(() => {
            const chart = SIZE_CHARTS[design.garmentId as CatalogGarmentId]
            const spec = chart.sizes[previewSize]
            return (
              <>
                <div className="mono-dim mt-2 text-[11px] leading-relaxed text-cy">
                  {t('product.size_dims', {
                    chest: fmtCm(spec.halfChestCm),
                    length: fmtCm(spec.bodyLengthCm),
                    sleeve: fmtCm(spec.sleeveLengthCm),
                  })}
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-[11px] text-tx3 transition-colors hover:text-tx2">
                    {t('product.size_chart')} · {chart.brandRef}
                  </summary>
                  <table className="mono-dim mt-2 w-full text-left text-[10.5px]">
                    <thead>
                      <tr className="text-tx3">
                        <th className="py-0.5 font-normal" />
                        <th className="py-0.5 font-normal">{t('product.chest')}</th>
                        <th className="py-0.5 font-normal">{t('product.length')}</th>
                        <th className="py-0.5 font-normal">{t('product.sleeve')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {SIZE_IDS.map((sz) => {
                        const sp = chart.sizes[sz]
                        return (
                          <tr key={sz} className={clsx(sz === previewSize ? 'text-cy' : 'text-tx2')}>
                            <td className="py-0.5 font-bold">{sz}</td>
                            <td className="py-0.5">{sp.halfChestCm}</td>
                            <td className="py-0.5">{sp.bodyLengthCm}</td>
                            <td className="py-0.5">{sp.sleeveLengthCm}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <p className="mt-1 text-[10px] leading-relaxed text-tx3">
                    {t('product.size_chart_note')}
                  </p>
                </details>
              </>
            )
          })()}
        </section>
      )}

      <section>
        <div className="panel-title mb-2.5">{g('title')}</div>
        <div className="flex gap-1">
          {(['scaled', 'fixed'] as PrintScaleMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setPrintScaleMode(m)}
              aria-pressed={printScale.mode === m}
              className={clsx(
                'btn h-8 flex-1 px-1 text-[11px]',
                printScale.mode === m && 'btn-primary',
              )}
            >
              {g(m)}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-tx3">
          {printScale.mode === 'scaled' ? g('hint_scaled') : g('hint_fixed')}
        </p>
        {printScale.mode === 'scaled' &&
          (canGrade ? (
            <>
              <div className="panel-title mb-1.5 mt-3">{g('base')}</div>
              <div className="flex gap-1">
                {baseSizes.map((sz) => (
                  <button
                    key={sz}
                    onClick={() => setPrintBaseSize(sz)}
                    aria-pressed={printScale.baseSize === sz}
                    className={clsx(
                      'btn h-8 flex-1 px-0 text-[11px]',
                      printScale.baseSize === sz && 'border-cy text-cy',
                    )}
                  >
                    {sz}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-tx3">{g('base_note')}</p>
            </>
          ) : (
            <p className="mt-1.5 text-[11px] leading-relaxed text-yl">{g('unavailable')}</p>
          ))}
      </section>

      <section className="rounded-lg border border-line bg-bg1 p-3">
        <div className="panel-title mb-1.5">
          {t('product.print_area')} · {t('side.' + side)} · {g('for_size')} {previewSize}
        </div>
        <div className="mono-dim text-cy">
          {t('product.print_area_size', {
            w: fmtNum(inToCm(area.wIn)),
            h: fmtInAsCm(area.hIn),
          })}
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-tx3">
          {t('product.print_area_note')}
        </p>
      </section>
    </div>
  )
}
