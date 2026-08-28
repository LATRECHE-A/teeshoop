/**
 * The board's own chrome, mounted for the whole board session, focused or not,
 * which is what makes it the right place for three things:
 *
 *  - the single way back out (leave the board / leave the focused product), so
 *    the exit never lives inside the thing being exited;
 *  - the `aria-live` narration, because a board that changes what the editing
 *    tools apply to must SAY so; a sighted user sees the stage change, a screen
 *    reader user gets this;
 *  - freeing the tile canvases on unmount, since unmount is exactly "the board
 *    closed" (focusing keeps the bar mounted).
 */
import { useEffect, useRef } from 'react'
import { CheckSquare, LayoutGrid, Square, Undo2, X } from 'lucide-react'
import { useStore } from '@/state/store'
import { keepMockupCache, scheduleClearMockupCache } from './mockupCache'
import { useBoardT } from './boardI18n'

export default function BoardBar() {
  const t = useBoardT()
  const basket = useStore((s) => s.basket)
  const selectedIds = useStore((s) => s.board.selectedIds)
  const focusedId = useStore((s) => s.board.focusedId)
  const exitBoard = useStore((s) => s.exitBoard)
  const unfocusLine = useStore((s) => s.unfocusLine)
  const setBoardSelection = useStore((s) => s.setBoardSelection)
  const focused = basket.find((l) => l.id === focusedId) ?? null
  const shown = basket.filter((l) => selectedIds.includes(l.id)).length
  const liveRef = useRef<HTMLParagraphElement>(null)

  // Free every tile bitmap when the board closes. Safari in particular does not
  // reclaim canvas backing stores promptly, and a board holds dozens. Paired
  // keep/clear so StrictMode's mount → cleanup → mount cannot blank the board.
  useEffect(() => {
    keepMockupCache()
    return () => scheduleClearMockupCache()
  }, [])

  // Written imperatively so the region's text is REPLACED (which is what makes
  // a polite live region announce) without re-rendering the toolbar.
  useEffect(() => {
    const el = liveRef.current
    if (!el) return
    el.textContent = focused
      ? t('board.a11y.focused', { name: focused.label, size: focused.size })
      : t('board.a11y.unfocused', { n: shown })
  }, [focused, shown, t])

  return (
    <div className="z-20 flex h-11 shrink-0 items-center gap-2 border-b border-line bg-bg1 px-2 sm:px-3">
      <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-tx">
        <LayoutGrid size={15} className="text-cy" />
        {t('board.title')}
      </span>

      {focused ? (
        <>
          <span className="mx-1 hidden h-4 w-px bg-line sm:block" />
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-tx2">
            <span className="mr-1.5 rounded-full border border-cy/40 bg-cy/10 px-1.5 py-px text-[10.5px] font-medium text-cy">
              {t('board.focused')}
            </span>
            {focused.label}
            <span className="mono-dim ml-1.5 text-cy">{focused.size}</span>
          </span>
          <button
            className="btn btn-primary h-8 px-2.5 text-[12px]"
            onClick={unfocusLine}
            title={t('board.unfocus_hint')}
          >
            <Undo2 size={14} />
            <span className="hidden sm:inline">{t('board.unfocus')}</span>
          </button>
        </>
      ) : (
        <>
          <span className="mono-dim hidden text-[11.5px] text-tx3 sm:inline">
            {t('board.count', { n: shown, total: basket.length })}
          </span>
          <span className="flex-1" />
          <button
            className="btn btn-ghost h-8 px-2.5 text-[12px]"
            onClick={() => setBoardSelection(basket.map((l) => l.id))}
            disabled={shown === basket.length}
          >
            <CheckSquare size={14} />
            <span className="hidden md:inline">{t('board.select_all')}</span>
          </button>
          <button
            className="btn btn-ghost h-8 px-2.5 text-[12px]"
            onClick={() => setBoardSelection([])}
            disabled={shown === 0}
          >
            <Square size={14} />
            <span className="hidden md:inline">{t('board.select_none')}</span>
          </button>
        </>
      )}

      <button
        className="iconbtn h-8 w-8"
        onClick={exitBoard}
        aria-label={t('board.exit')}
        title={t('board.exit')}
      >
        <X size={16} />
      </button>

      <p ref={liveRef} aria-live="polite" className="sr-only" />
    </div>
  )
}
