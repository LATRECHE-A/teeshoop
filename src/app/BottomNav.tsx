/**
 * Mobile bottom tool-nav (Canva-style), replaces the desktop LeftRail below
 * `md`. Tapping a tool opens its panel as a slide-up sheet (PanelHost). Always
 * visible on phones so tools stay in thumb reach; hidden on desktop.
 */
import { CircleHelp, ImagePlus, Layers, Shapes, Shirt, Type } from 'lucide-react'
import clsx from 'clsx'
import { useStore, type PanelId } from '@/state/store'
import { useT } from '@/i18n'
import { useBoardT } from './board/boardI18n'

const TABS: { id: PanelId; labelKey: string; icon: typeof Shirt }[] = [
  { id: 'product', labelKey: 'rail.product', icon: Shirt },
  { id: 'text', labelKey: 'rail.text', icon: Type },
  { id: 'uploads', labelKey: 'rail.uploads', icon: ImagePlus },
  { id: 'graphics', labelKey: 'rail.graphics', icon: Shapes },
  { id: 'layers', labelKey: 'rail.layers', icon: Layers },
]

export default function BottomNav() {
  const t = useT()
  const bt = useBoardT()
  const active = useStore((s) => s.activePanel)
  const setPanel = useStore((s) => s.setPanel)
  const openModal = useStore((s) => s.openModal)
  // Same rule as the desktop rail: locked, not hidden (see LeftRail).
  const locked = useStore((s) => s.board.on && !s.board.focusedId)

  return (
    <nav
      aria-label={t('rail.tools')}
      className="pb-safe fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-line bg-bg1/95 backdrop-blur md:hidden"
    >
      {TABS.map(({ id, labelKey, icon: Icon }) => {
        const on = active === id
        return (
          <button
            key={id}
            onClick={() => setPanel(on ? null : id)}
            aria-pressed={on}
            disabled={locked}
            aria-disabled={locked}
            title={locked ? bt('board.tools_locked') : undefined}
            className={clsx(
              'flex min-h-14 flex-1 flex-col items-center justify-center gap-1 py-1.5 text-[10px] font-medium transition-colors',
              on ? 'text-cy' : 'text-tx3',
              locked && 'opacity-40',
            )}
          >
            <Icon size={21} strokeWidth={1.8} />
            {t(labelKey)}
          </button>
        )
      })}
      <button
        onClick={() => openModal('shortcuts')}
        aria-label={t('rail.shortcuts')}
        className="flex min-h-14 flex-1 flex-col items-center justify-center gap-1 py-1.5 text-[10px] font-medium text-tx3"
      >
        <CircleHelp size={21} strokeWidth={1.8} />
        {t('rail.help')}
      </button>
    </nav>
  )
}
