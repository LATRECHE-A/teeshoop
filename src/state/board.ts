/**
 * Board mode — looking at several basket products at once.
 *
 * THE FLOW (and why it is shaped this way)
 * ----------------------------------------
 * The board is a READ-ONLY presentation of basket lines. Editing happens by
 * FOCUSING one line, which swaps that line's design snapshot into the single
 * live `store.design` the whole app is already built around — every panel,
 * shortcut, engine and renderer keeps working untouched. Un-focusing writes the
 * edits back into the basket and restores the user's own document.
 *
 * That is the entire reason board mode is cheap: the alternative (N live
 * designs inside EditorEngine) would touch layout, snapping, the transformer,
 * undo partialisation, autosave and every panel, and the user explicitly does
 * NOT want to edit several products simultaneously.
 *
 * INVARIANTS
 * ----------
 *  - `board` is SESSION state. It is never persisted: a reload landing on a
 *    board whose `focusedId` points at a line another tab deleted is an
 *    unreachable state, and re-entering the board costs one click.
 *  - `board` is never part of the undo document (zundo partialises on `design`).
 *  - Every render path for a line renders at `line.size`, never at the global
 *    `previewSize`. Grading (src/lib/printScale.ts) is a chest ratio, so a wrong
 *    size is a wrong physical print — subtle on screen, expensive on film.
 *  - History is per DOCUMENT and travels WITH it: the draft's stacks park in
 *    BoardStash below, a focused line's in the session registry
 *    (src/state/history.ts). Neither is ever persisted.
 *
 * The layout below is pure and deterministic (no viewport reads, no randomness)
 * so scripts/board-verify.mjs can assert it without a browser.
 */
import type { Design, Side } from '@/lib/types'
import type { SizeId } from '@/content/sizeChart'
import type { HistoryStacks } from './history'

export interface BoardState {
  /** Board mode active (entered from the basket). */
  on: boolean
  /** Basket line ids shown on the board. Seeded with EVERY line on entry. */
  selectedIds: string[]
  /** The line whose design is currently live in `store.design`, or null. */
  focusedId: string | null
}

export const BOARD_OFF: BoardState = { on: false, selectedIds: [], focusedId: null }

/**
 * Hard caps. Beyond them the board DEGRADES rather than refuses: 2D tiles past
 * the cap are dropped from the board (the basket modal still lists them), and
 * 3D products past the cap render as billboards reusing the already-rasterised
 * 2D mockup — one quad, zero extra texture work, still orbitable.
 */
export const BOARD_MAX_2D = 40
export const BOARD_MAX_3D_DESKTOP = 8
export const BOARD_MAX_3D_MOBILE = 4

export function boardCap3D(mobile: boolean): number {
  return mobile ? BOARD_MAX_3D_MOBILE : BOARD_MAX_3D_DESKTOP
}

/** The user's own working document, parked while a basket line is focused. */
export interface BoardStash {
  design: Design
  previewSize: SizeId
  activeSide: Side
  selectedId: string | null
  /**
   * …and its undo/redo stacks. The draft's history rides WITH the parked
   * document rather than in the history registry: one lifetime instead of two,
   * and the registry's LRU can never evict the one stack whose loss is the bug
   * (Ctrl+Z doing nothing after coming back from the board).
   */
  history: HistoryStacks
}

// --- layout ---------------------------------------------------------------

/** Real extents of one product as it is drawn (inches, sleeves included). */
export interface BoardItemSize {
  wIn: number
  hIn: number
}

export interface BoardPlacement {
  col: number
  row: number
  /** Top-left of the item, in the same unit as the input extents. */
  x: number
  y: number
  w: number
  h: number
}

export interface BoardLayout {
  cols: number
  rows: number
  cellW: number
  cellH: number
  width: number
  height: number
  places: BoardPlacement[]
}

/**
 * Column count that best fills a viewport of `aspect` (w/h) with `n` cells of
 * `cellW × cellH`. Derived rather than tuned: filling the viewport means
 * cols/rows ≈ aspect · cellH/cellW, and rows = n/cols, hence the square root.
 */
export function boardColumns(
  n: number,
  aspect: number,
  cellW: number,
  cellH: number,
  maxCols: number,
): number {
  if (n <= 1) return 1
  const ideal = Math.sqrt((n * Math.max(aspect, 0.05) * cellH) / Math.max(cellW, 1e-6))
  const cap = Math.max(1, Math.min(maxCols, n))
  return Math.max(1, Math.min(cap, Math.round(ideal) || 1))
}

/**
 * Place items on a uniform grid, each centred in its cell, origin at the
 * top-left and +y DOWN. The cell is sized from the BIGGEST item so a 3XL hoodie
 * beside an S tee keeps its real proportions — showing that difference is the
 * whole point of putting the order on one board.
 *
 * Returned coordinates carry the unit of the inputs; the 2D board multiplies by
 * board px-per-inch, the 3D board flips y and centres the result.
 */
export function layoutBoard(
  items: readonly BoardItemSize[],
  opts: { gapW: number; gapH: number; aspect: number; maxCols: number },
): BoardLayout {
  const n = items.length
  if (n === 0)
    return { cols: 0, rows: 0, cellW: 0, cellH: 0, width: 0, height: 0, places: [] }
  const cellW = Math.max(...items.map((i) => i.wIn)) + opts.gapW
  const cellH = Math.max(...items.map((i) => i.hIn)) + opts.gapH
  const cols = boardColumns(n, opts.aspect, cellW, cellH, opts.maxCols)
  const rows = Math.ceil(n / cols)
  const places = items.map((item, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    return {
      col,
      row,
      x: col * cellW + (cellW - item.wIn) / 2,
      y: row * cellH + (cellH - item.hIn) / 2,
      w: item.wIn,
      h: item.hIn,
    }
  })
  return { cols, rows, cellW, cellH, width: cols * cellW, height: rows * cellH, places }
}

// --- texture budget -------------------------------------------------------

/**
 * Long-edge pixel target for a board product's print texture.
 *
 * A print texture costs `px² · 4 B · 4/3` on the GPU (RGBA8 + mipmaps), per
 * side, per product. The single-garment preview uses 2048 px, which is 16 MiB
 * for one 3:4 panel — eight products × two sides at that target would ask for
 * 256 MiB of decal texture alone and drop a phone's WebGL context. The table
 * below keeps the whole board inside ~16-24 MiB, which is what makes it viable
 * at all; shipped as a table rather than the closed form because these are the
 * four cases that exist and the steps are load-bearing.
 */
export function boardTextureTargetPx(n: number, mobile: boolean): number {
  if (n <= 2) return mobile ? 768 : 1024
  if (n <= 4) return mobile ? 512 : 768
  if (n <= 8) return mobile ? 384 : 512
  return mobile ? 256 : 384
}

/** GPU bytes an RGBA8 texture of this canvas occupies, mipmaps included. */
export function textureBytes(widthPx: number, heightPx: number): number {
  return Math.round(widthPx * heightPx * 4 * (4 / 3))
}
