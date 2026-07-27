/**
 * One product on the 2D board.
 *
 * A real `<button>` hosting a real `<canvas>`, absolutely positioned in board
 * space. Two separate controls on purpose: the button focuses the product
 * (Enter), the checkbox adds/removes it from the board (Space). Overloading one
 * control with both meanings is the kind of mode ambiguity that makes a board
 * unusable with a keyboard — and the separation costs nothing visually.
 *
 * The mockup canvas is ADOPTED into the DOM rather than copied through a data
 * url, so a tile costs one draw of an already-rasterised bitmap.
 */
import { useEffect, useRef, useState } from 'react'
import { ImageOff } from 'lucide-react'
import clsx from 'clsx'
import type { Side } from '@/lib/types'
import type { BasketLine } from '@/state/basket'
import { getCachedMockup, mockupKey, requestMockup } from './mockupCache'
import type { BoardT } from './boardI18n'

export interface BoardTileProps {
  line: BasketLine
  side: Side
  /** Board-space rect (px at scale 1). */
  rect: { x: number; y: number; w: number; h: number }
  /** Raster density for this tile's canvas. */
  widthPx: number
  /** The roving-tabindex holder — exactly one tile at a time carries it. */
  active: boolean
  selected: boolean
  /** Another tile is being focused: fade this one out of the way. */
  dimmed: boolean
  /** An upload this line references no longer exists in the library. */
  missingAsset: boolean
  t: BoardT
  /** Open this product in the editor (click / Enter). */
  onOpen(): void
  /** Add or remove it from the board (the checkbox / Space). */
  onToggle(): void
  /** This tile took DOM focus — it now holds the roving tabindex. */
  onRove(): void
  /** The rendered mockup's real h/w — the board re-lays-out on it. */
  onMeasured(lineId: string, aspect: number): void
}

export default function BoardTile({
  line,
  side,
  rect,
  widthPx,
  active,
  selected,
  dimmed,
  missingAsset,
  t,
  onOpen,
  onToggle,
  onRove,
  onMeasured,
}: BoardTileProps) {
  const hostRef = useRef<HTMLSpanElement>(null)
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(() =>
    getCachedMockup(mockupKey(line, side, widthPx)),
  )
  /** The mockup could not be produced (a purged upload, a decode failure). */
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    let live = true
    const req = requestMockup(line, side, widthPx)
    setUnavailable(false)
    if (req.canvas) {
      setCanvas(req.canvas)
      return
    }
    setCanvas(null)
    void req.promise.then((c) => {
      if (!live) return
      setCanvas(c)
      // A null canvas means the render threw (a ship-your-own line whose photo
      // was purged) or was superseded. Either way, stop pretending it is still
      // loading — a skeleton that never resolves is the worst of both.
      if (!c) setUnavailable(true)
    })
    return () => {
      live = false
    }
  }, [line, side, widthPx])

  useEffect(() => {
    if (canvas && canvas.width > 0) onMeasured(line.id, canvas.height / canvas.width)
  }, [canvas, line.id, onMeasured])

  // Adopt the cached canvas; it is sized in CSS so the same bitmap serves every
  // zoom level until the density step re-renders it.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    if (!canvas) {
      host.replaceChildren()
      return
    }
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    host.replaceChildren(canvas)
  }, [canvas])

  const name = t('board.tile', {
    name: line.label,
    garment: line.garmentLabel,
    size: line.size,
    qty: line.qty,
  })

  return (
    <li
      className="board-tile"
      data-dim={dimmed ? '' : undefined}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      <button
        type="button"
        className="board-tile-btn"
        tabIndex={active ? 0 : -1}
        data-board-tile={line.id}
        aria-label={name}
        title={t('board.tile_hint')}
        onFocus={onRove}
        onClick={onOpen}
        onKeyDown={(e) => {
          // A button fires click on BOTH Enter and Space, which would leave the
          // checkbox (deliberately out of the tab order, so one Tab leaves the
          // board) unreachable by keyboard. Splitting them here restores the
          // two meanings the tile carries: Enter opens, Space selects.
          if (e.key !== ' ' && e.key !== 'Spacebar') return
          e.preventDefault()
          onToggle()
        }}
        aria-describedby={`${line.id}-board-check`}
      >
        <span ref={hostRef} className="board-tile-canvas" aria-hidden />
        {!canvas && (
          <span className={unavailable ? 'board-tile-broken' : 'board-tile-skeleton'} aria-hidden>
            {unavailable && <ImageOff size={22} />}
          </span>
        )}
      </button>

      <label
        className="board-tile-check"
        id={`${line.id}-board-check`}
        title={t('board.tile_select', { name: line.label })}
      >
        <input
          type="checkbox"
          checked={selected}
          tabIndex={-1}
          onChange={onToggle}
          aria-label={t('board.tile_select', { name: line.label })}
        />
        <span className="board-tile-name">
          {line.label}
          <span className="mono-dim ml-1.5 text-cy">{line.size}</span>
          <span className="ml-1 text-tx3">×{line.qty}</span>
        </span>
      </label>

      {(missingAsset || unavailable) && (
        <span
          className={clsx(
            'pointer-events-none absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full',
            'border border-yl/40 bg-yl/15 px-1.5 py-0.5 text-[10px] font-medium text-yl',
          )}
          title={t('board.missing_asset_hint')}
        >
          <ImageOff size={11} />
          {t('board.missing_asset')}
        </span>
      )}
    </li>
  )
}
