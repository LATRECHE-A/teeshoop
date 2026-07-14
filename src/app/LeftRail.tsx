import { CircleHelp, ImagePlus, Layers, Shapes, Shirt, Type } from 'lucide-react'
import clsx from 'clsx'
import { useStore, type PanelId } from '@/state/store'

const TABS: { id: PanelId; label: string; icon: typeof Shirt }[] = [
  { id: 'product', label: 'Product', icon: Shirt },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'uploads', label: 'Uploads', icon: ImagePlus },
  { id: 'graphics', label: 'Graphics', icon: Shapes },
  { id: 'layers', label: 'Layers', icon: Layers },
]

export default function LeftRail() {
  const active = useStore((s) => s.activePanel)
  const setPanel = useStore((s) => s.setPanel)
  const openModal = useStore((s) => s.openModal)

  return (
    <nav
      aria-label="Editor tools"
      className="z-20 flex w-[60px] shrink-0 flex-col items-center gap-1 border-r border-line bg-bg1 py-2"
    >
      {TABS.map(({ id, label, icon: Icon }) => {
        const on = active === id
        return (
          <button
            key={id}
            onClick={() => setPanel(on ? null : id)}
            aria-pressed={on}
            className={clsx(
              'group relative flex h-[52px] w-[52px] flex-col items-center justify-center gap-1 rounded-lg transition-colors',
              on ? 'bg-bg3 text-cy' : 'text-tx3 hover:bg-bg2 hover:text-tx2',
            )}
          >
            {on && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-cy" />}
            <Icon size={19} strokeWidth={1.8} />
            <span className="text-[9.5px] font-medium tracking-wide">{label}</span>
          </button>
        )
      })}
      <div className="flex-1" />
      <button
        className="iconbtn mb-1"
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
        onClick={() => openModal('shortcuts')}
      >
        <CircleHelp size={17} />
      </button>
    </nav>
  )
}
