import { useEffect, useId, useRef, useState } from 'react'
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
import { SCENE_IDS, getScene, offeredScene, type SceneId } from '@/scenes'
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
 *
 * IT IS A LISTBOX IN BEHAVIOUR AND NOT ONLY IN ARIA, since session 13.
 *
 * It carried `role="listbox"` and `role="option"` from the day it was written,
 * with none of what those words promise: no arrow keys, every option its own
 * tab stop, focus neither entering the list on open nor returning to the button
 * on close. A screen reader announced « liste, 6 éléments » and then the
 * keyboard did something else, which is the failure mode session 12 named:
 * the wrong role is worse than no role, because the person is told what to
 * expect and then it does not happen.
 *
 * The shape is the one the ARIA practices describe for a collapsed listbox:
 * ONE tab stop for the whole control (roving `tabIndex`), arrows to move,
 * Home and End for the ends, Escape and Tab to leave, and focus handed back to
 * the button whichever way it closes. Arrows deliberately do NOT wrap: a
 * six-item list where Down at the bottom silently jumps to the top reads as a
 * glitch, and no native select does it.
 *
 * The markup changed with it. `<ul role="listbox"><li><button role="option">`
 * put a `listitem` between the list and its options, and a listbox may only own
 * options or groups, so the intermediate element broke the relationship a
 * reader walks. The options are now direct children of the listbox element.
 */
export default function ScenePicker() {
  const scene = useStore((s) => s.scene)
  const setScene = useStore((s) => s.setScene)
  const theme = useStore((s) => s.theme)
  const t = useT()
  const [open, setOpen] = useState(false)
  // The option the keyboard is standing on. Not the chosen scene: moving with
  // the arrows must not change what the stage renders until Enter or a click.
  // COERCED, because the stored scene may not be one this list draws: `night`
  // was withdrawn on 1 September 2026 and a returning visitor still carries it.
  // An `active` with no option element takes no focus and counts from -1.
  const [active, setActive] = useState<SceneId>(() => offeredScene(scene))
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const options = useRef<Partial<Record<SceneId, HTMLButtonElement | null>>>({})
  const listId = useId()

  /** Close and put the keyboard back on the button that opened the list. */
  const closeToButton = () => {
    setOpen(false)
    buttonRef.current?.focus({ preventScroll: true })
  }

  const openList = () => {
    setActive(offeredScene(scene))
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      // A click outside closes without moving focus: the pointer already
      // decided where attention is, and yanking it back to the button would
      // fight the click that is about to land.
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  // Focus follows the active option, which is what makes the arrows audible:
  // a reader announces each one as it is reached.
  useEffect(() => {
    if (open) options.current[active]?.focus({ preventScroll: true })
  }, [open, active])

  const move = (delta: number) => {
    const i = SCENE_IDS.indexOf(active)
    const next = Math.min(SCENE_IDS.length - 1, Math.max(0, (i < 0 ? 0 : i) + delta))
    setActive(SCENE_IDS[next])
  }

  const onListKey = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        move(1)
        break
      case 'ArrowUp':
        e.preventDefault()
        move(-1)
        break
      case 'Home':
        e.preventDefault()
        setActive(SCENE_IDS[0])
        break
      case 'End':
        e.preventDefault()
        setActive(SCENE_IDS[SCENE_IDS.length - 1])
        break
      case 'Escape':
        // Stopped here rather than left to the window handler, which would
        // also unwind the board or clear the selection behind the list.
        e.preventDefault()
        e.stopPropagation()
        closeToButton()
        break
      case 'Tab':
        // A collapsed listbox closes on Tab and lets focus carry on, so the
        // control is one stop rather than seven. Not prevented: the browser
        // moves focus itself, and it moves it from the button.
        setOpen(false)
        buttonRef.current?.focus({ preventScroll: true })
        break
      default:
        break
    }
  }

  const CurrentIcon = SCENE_ICON[scene]

  return (
    <div ref={ref} className="pointer-events-auto relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={t('scene.aria')}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            openList()
          }
        }}
        className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-bg1/90 px-2.5 text-[12px] font-medium text-tx shadow-lg backdrop-blur transition-colors hover:border-line2"
      >
        <CurrentIcon size={14} className="text-cy" />
        <span className="hidden sm:inline">{t(getScene(scene).nameKey)}</span>
        <ChevronDown size={13} className="text-tx3" />
      </button>

      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label={t('scene.aria')}
          onKeyDown={onListKey}
          className="absolute left-0 top-10 z-30 w-60 overflow-hidden rounded-xl border border-line bg-bg2/95 p-1 shadow-2xl backdrop-blur"
        >
          {SCENE_IDS.map((id) => {
            const Icon = SCENE_ICON[id]
            const selected = id === scene
            return (
              <button
                key={id}
                ref={(el) => {
                  options.current[id] = el
                }}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={id === active ? 0 : -1}
                onClick={() => {
                  setScene(id)
                  closeToButton()
                }}
                className={clsx(
                  'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors',
                  selected ? 'bg-bg3' : 'hover:bg-bg3/60',
                )}
              >
                <SceneSwatch id={id} theme={theme} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <Icon size={13} className={selected ? 'text-cy' : 'text-tx2'} />
                    <span className="text-[12.5px] font-medium text-tx">{t(getScene(id).nameKey)}</span>
                  </span>
                  <span className="block truncate text-[11px] text-tx3">{t(getScene(id).descKey)}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
