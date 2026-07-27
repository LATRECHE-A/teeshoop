/**
 * The 2D board: every selected basket product laid out side by side, at true
 * relative scale, read-only.
 *
 * WHY THIS IS NOT THE EDITOR
 * --------------------------
 * EditorEngine is single-design by construction — one layout, one garment node,
 * one clip rect, one flat node map that drag-snapping iterates globally. Making
 * it hold N designs is a rewrite of the file that owns every mutation gesture in
 * the product, and the board needs none of what that buys: it never selects,
 * drags, snaps or transforms. So the board is a plain DOM layer of pre-
 * rasterised mockups inside ONE transformed wrapper. Pan and zoom are then a
 * single composited transform — zero JS per frame, which is what makes it smooth
 * on a phone — and hit-testing, focus rings and keyboard navigation come free
 * from using real buttons.
 *
 * BOARD SPACE
 * -----------
 * 1 board px = 1/BOARD_PPI inch at scale 1, so tile sizes are physical: the
 * layout is fed the mockups' real inch extents (sleeves and hem included).
 *
 * The gestures deliberately mirror EditorEngine's: wheel zooms about the
 * pointer, drag pans, two fingers pinch about their centroid, and the zoom
 * clamp is the same 0.4×…9× of fit — the board must not feel like a different
 * application.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Maximize, Minus, Plus } from 'lucide-react'
import type { Side } from '@/lib/types'
import type { BasketLine } from '@/state/basket'
import { linePrintedSides } from '@/state/basket'
import { useStore } from '@/state/store'
import { BOARD_MAX_2D, layoutBoard } from '@/state/board'
import { clamp } from '@/lib/units'
import { stageBackground } from '@/scenes'
import { useIsMobile } from '../hooks/useIsMobile'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { cancelPendingMockups, mockupExtentIn } from './mockupCache'
import BoardTile from './BoardTile'
import { useBoardT } from './boardI18n'

/** Board px per real inch at scale 1. */
const BOARD_PPI = 26
/** Gutter between products, inches — a hand's width at true scale. */
const GAP_IN = 3.2
/** Zoom-to-focus flight, ms. Short: it is a transition, not a show. */
const FLY_MS = 260
/**
 * How far a pointer may travel and still count as a tap, CSS px. A finger never
 * lands and lifts on the same pixel, so a tight threshold turns tap-to-focus
 * into a coin flip on a phone; this is the same slop the 3D board uses to tell
 * an orbit from a click.
 */
const TAP_SLOP_PX = 4

/**
 * Which tile the board was zoomed into when the user left for the editor, so
 * coming back can start there and pull out instead of cutting. Module-level
 * because it is neither app state nor component state — it is a scrap of
 * continuity between two mounts of the same view.
 */
let returningFrom: string | null = null

interface View {
  x: number
  y: number
  s: number
}

interface Tile {
  line: BasketLine
  side: Side
  rect: { x: number; y: number; w: number; h: number }
  widthPx: number
  missingAsset: boolean
}

function pow2Ceil(n: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(1, n)))
}

export default function BoardStage2D() {
  const t = useBoardT()
  const basket = useStore((s) => s.basket)
  const selectedIds = useStore((s) => s.board.selectedIds)
  const assets = useStore((s) => s.assets)
  const scene = useStore((s) => s.scene)
  const theme = useStore((s) => s.theme)
  const focusLine = useStore((s) => s.focusLine)
  const toggleBoardLine = useStore((s) => s.toggleBoardLine)
  const isMobile = useIsMobile()
  const reducedMotion = useReducedMotion()

  const viewportRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLUListElement>(null)
  const zoomLabelRef = useRef<HTMLSpanElement>(null)
  const view = useRef<View>({ x: 0, y: 0, s: 1 })
  const fitScale = useRef(1)
  const moved = useRef(false)
  const flying = useRef(false)

  const [size, setSize] = useState({ w: 0, h: 0 })
  /** Scale the tile bitmaps were rasterised for (progressive sharpening). */
  const [renderScale, setRenderScale] = useState(1)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [focusingId, setFocusingId] = useState<string | null>(null)
  /** h/w actually measured from each tile's rendered mockup (see the layout). */
  const [aspects, setAspects] = useState<Record<string, number>>({})

  const reportAspect = useCallback((id: string, aspect: number) => {
    if (!Number.isFinite(aspect) || aspect <= 0) return
    setAspects((prev) =>
      // Re-layout only on a REAL change: a rounded canvas is a fraction of a
      // percent off the computed extent, and churning the grid on that would
      // re-request every tile.
      Math.abs((prev[id] ?? 0) - aspect) < aspect * 0.005 ? prev : { ...prev, [id]: aspect },
    )
  }, [])

  const bg = stageBackground(scene, theme)

  // --- which lines, in basket order, capped ---------------------------------
  const lines = useMemo(
    () => basket.filter((l) => selectedIds.includes(l.id)).slice(0, BOARD_MAX_2D),
    [basket, selectedIds],
  )
  const overflow = Math.max(
    0,
    basket.filter((l) => selectedIds.includes(l.id)).length - lines.length,
  )

  const missingIds = useMemo(() => {
    const have = new Set(assets.map((a) => a.id))
    const out = new Set<string>()
    for (const l of lines) {
      const used: string[] = []
      for (const y of l.design.layers) if (y.type === 'image') used.push(y.assetId)
      // The GARMENT photo of a ship-your-own line counts too: purging it leaves
      // nothing to draw at all, so without this the tile is blank AND silent.
      if (l.design.garmentId === 'custom') {
        if (l.design.custom?.front) used.push(l.design.custom.front.assetId)
        if (l.design.custom?.back) used.push(l.design.custom.back.assetId)
      }
      if (used.some((id) => !have.has(id))) out.add(l.id)
    }
    return out
  }, [lines, assets])

  // --- layout ---------------------------------------------------------------
  const layout = useMemo(() => {
    const sides = lines.map((l) => linePrintedSides(l.design)[0] ?? 'front')
    const items = lines.map((l, i) => {
      const nominal = mockupExtentIn(l.design, sides[i], l.size)
      // A ship-your-own garment's real proportions are only known once its photo
      // has been decoded, so mockupExtentIn starts from a nominal aspect. Adopt
      // the measured one as soon as the tile reports it, or the canvas is
      // stretched to a cell that was sized from a guess.
      const measured = aspects[l.id]
      return measured ? { wIn: nominal.wIn, hIn: nominal.wIn * measured } : nominal
    })
    const aspect = size.h > 0 ? size.w / size.h : 1.5
    // Phones need every tile to stay a comfortable tap target, which caps the
    // columns long before the viewport aspect would.
    const maxCols = isMobile ? (size.w > size.h ? 3 : 2) : lines.length
    const grid = layoutBoard(items, {
      gapW: GAP_IN,
      gapH: GAP_IN,
      aspect,
      maxCols,
    })
    return { grid, sides }
  }, [lines, size.w, size.h, isMobile, aspects])

  const boardW = layout.grid.width * BOARD_PPI
  const boardH = layout.grid.height * BOARD_PPI

  const tiles = useMemo<Tile[]>(() => {
    const maxPx = isMobile ? 512 : 1024
    return lines.map((line, i) => {
      const p = layout.grid.places[i]
      const w = p.w * BOARD_PPI
      const dpr = Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 2)
      return {
        line,
        side: layout.sides[i],
        rect: { x: p.x * BOARD_PPI, y: p.y * BOARD_PPI, w, h: p.h * BOARD_PPI },
        widthPx: clamp(pow2Ceil(w * renderScale * dpr), 256, maxPx),
        missingAsset: missingIds.has(line.id),
      }
    })
  }, [lines, layout, renderScale, isMobile, missingIds])

  // --- view transform (imperative: never re-renders React) ------------------
  const apply = useCallback(() => {
    const world = worldRef.current
    if (!world) return
    const v = view.current
    world.style.transform = `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.s})`
    // Tile captions live inside the transformed world (so they travel with
    // their product for free) but must stay READABLE, so they carry the
    // inverse scale. Clamped: an unclamped inverse makes a caption wider than
    // its own tile when the board is zoomed right out.
    world.style.setProperty('--board-inv', String(clamp(1 / v.s, 0.35, 4)))
    if (zoomLabelRef.current)
      zoomLabelRef.current.textContent = `${Math.round((v.s / fitScale.current) * 100)}%`
  }, [])

  const fitView = useCallback(
    (animate = false) => {
      const pad = isMobile ? 20 : 44
      const s = Math.max(
        0.05,
        Math.min((size.w - pad * 2) / Math.max(boardW, 1), (size.h - pad * 2) / Math.max(boardH, 1)),
      )
      fitScale.current = s
      const world = worldRef.current
      if (world && !animate) world.style.transition = 'none'
      view.current = { x: (size.w - boardW * s) / 2, y: (size.h - boardH * s) / 2, s }
      apply()
      if (world && !animate) {
        // Force the "no transition" write to land before the next paint.
        void world.offsetWidth
        world.style.transition = ''
      }
    },
    [apply, boardW, boardH, size.w, size.h, isMobile],
  )

  const zoomAt = useCallback(
    (next: number, fx: number, fy: number) => {
      const v = view.current
      const s = clamp(next, fitScale.current * 0.4, fitScale.current * 9)
      const wx = (fx - v.x) / v.s
      const wy = (fy - v.y) / v.s
      view.current = { x: fx - wx * s, y: fy - wy * s, s }
      apply()
    },
    [apply],
  )

  // --- viewport size --------------------------------------------------------
  useEffect(() => {
    const host = viewportRef.current
    if (!host) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      setSize((prev) =>
        Math.abs(prev.w - r.width) < 1 && Math.abs(prev.h - r.height) < 1
          ? prev
          : { w: r.width, h: r.height },
      )
    })
    ro.observe(host)
    return () => ro.disconnect()
  }, [])

  // Re-fit whenever the board or the viewport changes shape. Coming back from a
  // focused product, start on that product and pull out — the reverse of the
  // flight in, so the two transitions read as one movement.
  useEffect(() => {
    if (size.w < 10 || size.h < 10 || tiles.length === 0) return
    const back = returningFrom
    returningFrom = null
    fitView(false)
    setRenderScale(fitScale.current)
    if (!back || reducedMotion) return
    const tile = tiles.find((x) => x.line.id === back)
    const world = worldRef.current
    if (!tile || !world) return
    const target = focusTransform(tile, size, fitScale.current, isMobile)
    const fitted = { ...view.current }
    world.style.transition = 'none'
    view.current = target
    apply()
    void world.offsetWidth
    world.style.transition = ''
    requestAnimationFrame(() => {
      view.current = fitted
      apply()
    })
    // Only the first layout after a return should replay the flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h, boardW, boardH, tiles.length])

  // --- gestures -------------------------------------------------------------
  useEffect(() => {
    const host = viewportRef.current
    const world = worldRef.current
    if (!host || !world) return

    const pointers = new Map<number, { x: number; y: number }>()
    let pinch: { dist: number; cx: number; cy: number } | null = null
    /** Where the gesture started, for the tap-vs-pan decision. */
    let anchor: { x: number; y: number } | null = null

    const local = (e: PointerEvent) => {
      const r = host.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }

    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return
      const p = local(e)
      const prev = pointers.get(e.pointerId) as { x: number; y: number }
      pointers.set(e.pointerId, p)
      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()]
        const dist = Math.hypot(b.x - a.x, b.y - a.y)
        const cx = (a.x + b.x) / 2
        const cy = (a.y + b.y) / 2
        if (pinch && pinch.dist > 0) {
          zoomAt(view.current.s * (dist / pinch.dist), cx, cy)
          view.current.x += cx - pinch.cx
          view.current.y += cy - pinch.cy
          apply()
          moved.current = true
        }
        pinch = { dist, cx, cy }
        return
      }
      const dx = p.x - prev.x
      const dy = p.y - prev.y
      // Measured from where the finger LANDED, not per event: summing per-event
      // deltas would call a slow 1 px-at-a-time wobble a pan.
      if (anchor && Math.hypot(p.x - anchor.x, p.y - anchor.y) > TAP_SLOP_PX)
        moved.current = true
      view.current.x += dx
      view.current.y += dy
      apply()
    }

    const release = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
      if (pointers.size < 2) pinch = null
      if (pointers.size > 0) return
      anchor = null
      world.removeAttribute('data-panning')
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      // Sharpen (or relax) the tile bitmaps once the gesture settles.
      const s = view.current.s
      setRenderScale((cur) => (s > cur * 1.8 || s < cur / 1.8 ? s : cur))
    }

    const onDown = (e: PointerEvent) => {
      if (flying.current) return
      if (pointers.size === 0) {
        moved.current = false
        anchor = local(e)
        // Filters and shadows are the classic mobile pan killers — CSS drops
        // them while this attribute is present.
        world.setAttribute('data-panning', '')
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', release)
        window.addEventListener('pointercancel', release)
      }
      pointers.set(e.pointerId, local(e))
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        pinch = {
          dist: Math.hypot(b.x - a.x, b.y - a.y),
          cx: (a.x + b.x) / 2,
          cy: (a.y + b.y) / 2,
        }
      }
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = host.getBoundingClientRect()
      zoomAt(view.current.s * Math.pow(1.0016, -e.deltaY), e.clientX - r.left, e.clientY - r.top)
      const s = view.current.s
      setRenderScale((cur) => (s > cur * 1.8 || s < cur / 1.8 ? s : cur))
    }

    host.addEventListener('pointerdown', onDown)
    host.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      host.removeEventListener('pointerdown', onDown)
      host.removeEventListener('wheel', onWheel)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
    }
  }, [apply, zoomAt])

  // The editor's zoom shortcuts and HUD speak through this event; the board
  // answers the same vocabulary so `f`, `+` and `-` keep meaning what they mean.
  useEffect(() => {
    const onZoom = (e: Event) => {
      const action = (e as CustomEvent<string>).detail
      const cx = size.w / 2
      const cy = size.h / 2
      if (action === 'fit') fitView(true)
      if (action === 'in') zoomAt(view.current.s * 1.3, cx, cy)
      if (action === 'out') zoomAt(view.current.s / 1.3, cx, cy)
    }
    window.addEventListener('tshop:zoom', onZoom)
    return () => window.removeEventListener('tshop:zoom', onZoom)
  }, [fitView, zoomAt, size.w, size.h])

  useEffect(() => () => cancelPendingMockups(), [])

  // --- focus flight ---------------------------------------------------------
  const startFocus = useCallback(
    (id: string) => {
      if (moved.current || flying.current) return
      const tile = tiles.find((x) => x.line.id === id)
      if (!tile) return
      returningFrom = id
      if (reducedMotion) {
        focusLine(id)
        return
      }
      flying.current = true
      setFocusingId(id)
      view.current = focusTransform(tile, size, fitScale.current, isMobile)
      apply()
      window.setTimeout(() => {
        flying.current = false
        focusLine(id)
      }, FLY_MS)
    },
    [tiles, size, isMobile, reducedMotion, focusLine, apply],
  )

  // --- keyboard (roving tabindex) -------------------------------------------
  const moveActive = (delta: number) => {
    const ids = tiles.map((x) => x.line.id)
    if (ids.length === 0) return
    const from = activeId ? ids.indexOf(activeId) : 0
    const next = clamp((from < 0 ? 0 : from) + delta, 0, ids.length - 1)
    setActiveId(ids[next])
    const el = worldRef.current?.querySelector<HTMLButtonElement>(
      `[data-board-tile="${ids[next]}"]`,
    )
    el?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const cols = layout.grid.cols || 1
    if (e.key === 'ArrowRight') moveActive(1)
    else if (e.key === 'ArrowLeft') moveActive(-1)
    else if (e.key === 'ArrowDown') moveActive(cols)
    else if (e.key === 'ArrowUp') moveActive(-cols)
    else if (e.key === 'Home') moveActive(-tiles.length)
    else if (e.key === 'End') moveActive(tiles.length)
    else return
    e.preventDefault()
  }

  // Keep the roving index on a tile that still exists.
  useEffect(() => {
    if (tiles.length === 0) setActiveId(null)
    else if (!activeId || !tiles.some((x) => x.line.id === activeId))
      setActiveId(tiles[0].line.id)
  }, [tiles, activeId])

  if (lines.length === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center px-8 text-center">
        <p className="max-w-sm text-[13px] leading-relaxed text-tx2">{t('board.empty')}</p>
      </div>
    )
  }

  return (
    <div ref={viewportRef} className={`board-viewport ${bg.className}`} style={bg.style}>
      <ul
        ref={worldRef}
        className="board-world"
        style={{ width: boardW, height: boardH }}
        onKeyDown={onKeyDown}
      >
        {tiles.map((tile) => (
          <BoardTile
            key={tile.line.id}
            line={tile.line}
            side={tile.side}
            rect={tile.rect}
            widthPx={tile.widthPx}
            active={tile.line.id === activeId}
            selected
            dimmed={focusingId !== null && focusingId !== tile.line.id}
            missingAsset={tile.missingAsset}
            t={t}
            onRove={() => setActiveId(tile.line.id)}
            onOpen={() => startFocus(tile.line.id)}
            onToggle={() => toggleBoardLine(tile.line.id)}
            onMeasured={reportAspect}
          />
        ))}
      </ul>

      {overflow > 0 && (
        <p className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full border border-yl/30 bg-yl/10 px-3 py-1 text-[11.5px] text-yl">
          {t('board.cap_2d', { shown: lines.length, total: lines.length + overflow })}
        </p>
      )}

      <div className="absolute bottom-[calc(var(--tsh-nav)+0.75rem)] right-3 z-10 flex items-center gap-1 rounded-lg border border-line bg-bg1/90 p-1 shadow-lg backdrop-blur md:bottom-4 md:right-4">
        <button
          className="iconbtn h-7 w-7"
          onClick={() => zoomAt(view.current.s / 1.3, size.w / 2, size.h / 2)}
          aria-label={t('board.zoom_out')}
        >
          <Minus size={14} />
        </button>
        <span ref={zoomLabelRef} className="mono-dim hidden w-12 text-center md:inline">
          100%
        </span>
        <button
          className="iconbtn h-7 w-7"
          onClick={() => zoomAt(view.current.s * 1.3, size.w / 2, size.h / 2)}
          aria-label={t('board.zoom_in')}
        >
          <Plus size={14} />
        </button>
        <div className="mx-0.5 h-4 w-px bg-line" />
        <button
          className="iconbtn h-7 w-7"
          onClick={() => fitView(true)}
          aria-label={t('board.fit')}
          title={t('board.fit')}
        >
          <Maximize size={13} />
        </button>
      </div>
    </div>
  )
}

/** Transform that fills the viewport with one tile (capped at 6× the fit). */
function focusTransform(
  tile: Tile,
  size: { w: number; h: number },
  fit: number,
  isMobile: boolean,
): View {
  const pad = isMobile ? 20 : 56
  const s = Math.min(
    Math.min((size.w - pad * 2) / Math.max(tile.rect.w, 1), (size.h - pad * 2) / Math.max(tile.rect.h, 1)),
    fit * 6,
  )
  return {
    s,
    x: size.w / 2 - (tile.rect.x + tile.rect.w / 2) * s,
    y: size.h / 2 - (tile.rect.y + tile.rect.h / 2) * s,
  }
}
