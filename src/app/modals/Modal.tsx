import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import clsx from 'clsx'
import { useT } from '@/i18n'

/**
 * WHY THIS FILE HOLDS A FOCUS TRAP AND NOT JUST A LAYOUT.
 *
 * `aria-modal="true"` is a promise to a screen reader that everything outside
 * this dialog is inert. Until session 13 it was made and not kept: nothing held
 * focus inside, nothing gave it back on close. That is worse than never
 * claiming it, because the announcement says the page behind is gone while Tab
 * walks straight into it, and the reader keeps describing what it was told had
 * disappeared. Session 12 found it, could not take it (it is the studio, not
 * the buying path) and named it for this one.
 */

/**
 * Everything a keyboard can land on inside the panel, in tab order.
 *
 * `offsetParent === null` is what catches a step the dialog has collapsed with
 * `display:none`, which is how these modals hide their inactive halves. It also
 * reports null for a `position:fixed` element; nothing inside a panel is fixed,
 * and if that ever changes the worst case is the panel itself taking focus.
 */
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'

function focusable(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('disabled') && el.tabIndex >= 0 && el.offsetParent !== null,
  )
}

/**
 * The dialogs mounted right now, innermost last.
 *
 * `openModal` does not close its siblings, so two can be up at once. Two traps
 * that both pull focus home would bounce it between them for as long as the
 * browser let them, so only the top of this stack enforces. That is also the
 * right answer for the person typing: the dialog they opened last is the one
 * they are in.
 */
const stack: HTMLElement[] = []

export default function Modal({
  title,
  subtitle,
  onClose,
  children,
  size = 'md',
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
  size?: 'md' | 'lg'
}) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const panel = ref.current
    if (!panel) return

    // Where the keyboard was standing before this opened, so it can be put back.
    const opener = document.activeElement as HTMLElement | null
    stack.push(panel)

    const first = panel.querySelector<HTMLElement>('input, textarea, button:not([data-close])')
    ;(first ?? panel).focus({ preventScroll: true })

    const mine = () => stack[stack.length - 1] === panel

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !mine()) return
      const stops = focusable(panel)
      if (stops.length === 0) {
        // A dialog with nothing to type in still must not leak Tab to the page.
        e.preventDefault()
        panel.focus({ preventScroll: true })
        return
      }
      const edge = e.shiftKey ? stops[0] : stops[stops.length - 1]
      if (document.activeElement === edge || !panel.contains(document.activeElement)) {
        e.preventDefault()
        ;(e.shiftKey ? stops[stops.length - 1] : stops[0]).focus({ preventScroll: true })
      }
    }

    /*
     * Focus also leaves without a Tab this component ever sees: a round trip
     * through the browser's own chrome (the address bar, a find bar) comes back
     * at the top of the document, outside the dialog and past the handler
     * above. So the boundary is held on arrival as well as on the keystroke.
     */
    const onFocusIn = (e: FocusEvent) => {
      if (!mine() || panel.contains(e.target as Node)) return
      const stops = focusable(panel)
      ;(stops[0] ?? panel).focus({ preventScroll: true })
    }

    document.addEventListener('keydown', onKey, true)
    document.addEventListener('focusin', onFocusIn)

    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('focusin', onFocusIn)
      const wasTop = mine()
      const i = stack.indexOf(panel)
      if (i >= 0) stack.splice(i, 1)
      /*
       * Give the keyboard back what it had. Two things are deliberately not
       * done: an opener that left with the dialog (a lazily rendered button) is
       * skipped rather than focused, and a dialog closing UNDER another one
       * does not steal focus out of the one still on screen.
       */
      if (wasTop && opener && document.contains(opener)) opener.focus({ preventScroll: true })
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        ref={ref}
        // -1 so the panel can take focus when the dialog has nothing focusable
        // in it, and never so that Tab stops on the panel itself.
        tabIndex={-1}
        className={clsx(
          'flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-bg2 shadow-2xl outline-none sm:rounded-2xl',
          size === 'md' ? 'sm:max-w-[560px]' : 'sm:max-w-[760px]',
        )}
        style={{ animation: 'toast-in .18s ease both' }}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-display text-[16px] font-bold text-tx">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[12.5px] text-tx2">{subtitle}</p>}
          </div>
          <button data-close className="iconbtn -mr-1" onClick={onClose} aria-label={t('common.close')}>
            <X size={17} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}
