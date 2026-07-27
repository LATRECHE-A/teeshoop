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

export default function LeftRail() {
  const t = useT()
  const bt = useBoardT()
  const active = useStore((s) => s.activePanel)
  const setPanel = useStore((s) => s.setPanel)
  const openModal = useStore((s) => s.openModal)
  // Nothing to edit until a product is picked. DISABLED, never hidden: the
  // layout must not jump between the board and a focused product.
  const locked = useStore((s) => s.board.on && !s.board.focusedId)

  return (
    <nav
      aria-label={t('rail.tools')}
      className="z-20 hidden w-[60px] shrink-0 flex-col items-center gap-1 border-r border-line bg-bg1 py-2 md:flex"
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
              'group relative flex h-[52px] w-[52px] flex-col items-center justify-center gap-1 rounded-lg transition-colors',
              on ? 'bg-bg3 text-cy' : 'text-tx3 hover:bg-bg2 hover:text-tx2',
              locked && 'opacity-40',
            )}
          >
            {on && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-cy" />}
            <Icon size={19} strokeWidth={1.8} />
            <span className="text-[9.5px] font-medium tracking-wide">{t(labelKey)}</span>
          </button>
        )
      })}
      <div className="flex-1" />
      <button
        className="iconbtn mb-1"
        aria-label={t('rail.shortcuts')}
        title={t('rail.shortcuts_hint')}
        onClick={() => openModal('shortcuts')}
      >
        <CircleHelp size={17} />
      </button>
    </nav>
  )
}
