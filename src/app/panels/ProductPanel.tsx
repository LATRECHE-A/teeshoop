import { useMemo } from 'react'
import { Camera, Pencil } from 'lucide-react'
import clsx from 'clsx'
import { GARMENTS } from '@/garments'
import { GARMENT_COLORS } from '@/content/palettes'
import { PRICING } from '@/content/pricing'
import { useStore } from '@/state/store'
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
        <div className="panel-title mb-2.5">Garment</div>
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
              <span className="text-[12px] font-medium text-tx">{GARMENTS[id].name}</span>
              <span className="mono-dim">from ${PRICING[id].baseUsd.toFixed(2)}</span>
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
            <span className="block text-[12.5px] font-semibold text-tx">Your own garment</span>
            <span className="block text-[11px] leading-snug text-tx2">
              {design.custom?.front
                ? 'Photos configured — ship it to us, we print on it'
                : 'Upload front & back photos, we print on what you ship us'}
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
              aria-label="Edit garment setup"
            >
              <Pencil size={13} />
            </span>
          )}
        </button>
      </section>

      {!isCustom && (
        <section>
          <div className="panel-title mb-2.5">
            Color ·{' '}
            <span className="normal-case tracking-normal text-tx2">
              {GARMENT_COLORS.find((c) => c.id === design.colorId)?.name}
            </span>
          </div>
          <div className="grid grid-cols-9 gap-1.5">
            {GARMENT_COLORS.map((c) => (
              <button
                key={c.id}
                title={c.name}
                aria-label={c.name}
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
        <div className="panel-title mb-1.5">Print area · {side}</div>
        <div className="mono-dim text-cy">
          {fmtIn(area.wIn)} × {fmtIn(area.hIn)} @ 300 DPI
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-tx3">
          Placement is dimensionally accurate — what you lay out here is what we
          print, at real size.
        </p>
      </section>
    </div>
  )
}
