import clsx from 'clsx'
import { useStore } from '@/state/store'
import { useT } from '@/i18n'
import type { Side } from '@/lib/types'

export default function SideSwitcher() {
  const t = useT()
  const side = useStore((s) => s.activeSide)
  const setSide = useStore((s) => s.setSide)
  const layers = useStore((s) => s.design.layers)
  const custom = useStore((s) => s.design.custom)
  const garmentId = useStore((s) => s.design.garmentId)

  const has = (sd: Side) => layers.some((l) => l.side === sd)
  const backDisabled = garmentId === 'custom' && !custom?.back

  const Btn = ({ sd, label }: { sd: Side; label: string }) => (
    <button
      onClick={() => setSide(sd)}
      disabled={sd === 'back' && backDisabled}
      aria-pressed={side === sd}
      title={sd === 'back' && backDisabled ? t('side.back_locked') : undefined}
      className={clsx(
        'relative flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold transition-colors md:px-4',
        side === sd ? 'bg-bg3 text-tx' : 'text-tx3 hover:text-tx2',
        sd === 'back' && backDisabled && 'opacity-40',
      )}
    >
      {label}
      <span
        className={clsx(
          'h-1.5 w-1.5 rounded-full',
          has(sd) ? 'bg-cy' : 'bg-line2',
        )}
        aria-hidden
      />
    </button>
  )

  return (
    <div className="pointer-events-auto flex items-center rounded-full border border-line bg-bg1/90 p-1 shadow-lg backdrop-blur">
      <Btn sd="front" label={t('side.front')} />
      <Btn sd="back" label={t('side.back')} />
      {garmentId !== 'custom' && <Btn sd="sleeve" label={t('side.sleeve')} />}
    </div>
  )
}
