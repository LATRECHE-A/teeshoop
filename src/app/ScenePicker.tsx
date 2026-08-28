import { useEffect, useRef, useState } from 'react'
import {
  Aperture,
  Building2,
  ChevronDown,
  MoonStar,
  Sunset,
  Trees,
  Umbrella,
  type LucideIcon,
} from 'lucide-react'
import clsx from 'clsx'
import { useStore } from '@/state/store'
import { SCENE_IDS, getScene, type SceneId } from '@/scenes'
import { useT } from '@/i18n'

const SCENE_ICON: Record<SceneId, LucideIcon> = {
  studio: Aperture,
  beach: Umbrella,
  forest: Trees,
  city: Building2,
  sunset: Sunset,
  night: MoonStar,
}

/** Small gradient chip previewing a scene's backdrop. */
function SceneSwatch({ id, theme }: { id: SceneId; theme: 'dark' | 'light' }) {
  const bg = getScene(id).backdrop(theme)
  return (
    <span
      aria-hidden
      className={clsx('h-6 w-6 shrink-0 rounded-md border border-line', !bg && 'canvas-surface')}
      style={bg ? { background: bg } : undefined}
    />
  )
}

/**
 * Environment picker: swaps the backdrop (2D + 3D) and the 3D lighting rig.
 * Floats over the stage in both preview modes.
 */
export default function ScenePicker() {
  const scene = useStore((s) => s.scene)
  const setScene = useStore((s) => s.setScene)
  const theme = useStore((s) => s.theme)
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const CurrentIcon = SCENE_ICON[scene]

  return (
    <div ref={ref} className="pointer-events-auto relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('scene.aria')}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-bg1/90 px-2.5 text-[12px] font-medium text-tx shadow-lg backdrop-blur transition-colors hover:border-line2"
      >
        <CurrentIcon size={14} className="text-cy" />
        <span className="hidden sm:inline">{t(getScene(scene).nameKey)}</span>
        <ChevronDown size={13} className="text-tx3" />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label={t('scene.aria')}
          className="absolute left-0 top-10 z-30 w-60 overflow-hidden rounded-xl border border-line bg-bg2/95 p-1 shadow-2xl backdrop-blur"
        >
          {SCENE_IDS.map((id) => {
            const Icon = SCENE_ICON[id]
            const active = id === scene
            return (
              <li key={id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    setScene(id)
                    setOpen(false)
                  }}
                  className={clsx(
                    'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors',
                    active ? 'bg-bg3' : 'hover:bg-bg3/60',
                  )}
                >
                  <SceneSwatch id={id} theme={theme} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <Icon size={13} className={active ? 'text-cy' : 'text-tx2'} />
                      <span className="text-[12.5px] font-medium text-tx">{t(getScene(id).nameKey)}</span>
                    </span>
                    <span className="block truncate text-[11px] text-tx3">{t(getScene(id).descKey)}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
