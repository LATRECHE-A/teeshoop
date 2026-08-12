/**
 * Front / back / sleeve switch for the stage.
 *
 * Two states are encoded here, and they are not the same thing:
 *  - a side that CANNOT be designed (a ship-your-own garment with no back image
 *    at all) is `disabled`, because there is nothing to draw on;
 *  - a side whose image was RECONSTRUCTED from the other one
 *    (CustomSideSetup.origin === 'generated', src/lib/ingest/pipeline.ts) is
 *    fully designable and must be MARKED instead. Suppliers routinely publish no
 *    back photo, so this is the common case for catalogue products: treating it
 *    as "no back" would lock the back of half the catalogue, and treating it as
 *    a real photo would let someone approve a print over a picture the supplier
 *    never took. The mark is the same yellow the catalogue and the ingest admin
 *    already use for the same fact.
 *
 * The dot on each button is unrelated: it says the side already carries artwork.
 */
import clsx from 'clsx'
import { Sparkles } from 'lucide-react'
import { useStore } from '@/state/store'
import { useT } from '@/i18n'
import type { Side } from '@/lib/types'
import { useBackOriginT } from '@/app/backOriginI18n'

export default function SideSwitcher() {
  const t = useT()
  // "Dos reconstitué" is the catalogue's own label for this fact — one wording
  // for one concept — but it lives customer-side, because importing the
  // catalogue's side-file would drag our purchase-price strings in here.
  const ct = useBackOriginT()
  const side = useStore((s) => s.activeSide)
  const setSide = useStore((s) => s.setSide)
  const layers = useStore((s) => s.design.layers)
  const custom = useStore((s) => s.design.custom)
  const garmentId = useStore((s) => s.design.garmentId)

  const has = (sd: Side) => layers.some((l) => l.side === sd)
  const isCustom = garmentId === 'custom'
  // Locked only when there is genuinely no back image — a generated one IS a
  // back, and the badge beside it says where it came from.
  const backDisabled = isCustom && !custom?.back
  const backGenerated = isCustom && custom?.back?.origin === 'generated'

  const Btn = ({ sd, label }: { sd: Side; label: string }) => {
    const disabled = sd === 'back' && backDisabled
    const generated = sd === 'back' && backGenerated
    return (
      <button
        onClick={() => setSide(sd)}
        disabled={disabled}
        aria-pressed={side === sd}
        aria-label={generated ? `${label} — ${ct('catalog.card.back_generated')}` : undefined}
        title={
          disabled
            ? t('side.back_locked')
            : generated
              ? ct('catalog.back_preview_tip')
              : undefined
        }
        className={clsx(
          'relative flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold transition-colors md:px-4',
          side === sd ? 'bg-bg3 text-tx' : 'text-tx3 hover:text-tx2',
          disabled && 'opacity-40',
        )}
      >
        {label}
        {generated && <Sparkles size={11} className="text-yl" aria-hidden />}
        <span
          className={clsx('h-1.5 w-1.5 rounded-full', has(sd) ? 'bg-cy' : 'bg-line2')}
          aria-hidden
        />
      </button>
    )
  }

  return (
    <div className="pointer-events-auto flex items-center rounded-full border border-line bg-bg1/90 p-1 shadow-lg backdrop-blur">
      <Btn sd="front" label={t('side.front')} />
      <Btn sd="back" label={t('side.back')} />
      {!isCustom && <Btn sd="sleeve" label={t('side.sleeve')} />}
    </div>
  )
}
