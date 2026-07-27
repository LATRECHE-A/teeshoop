/**
 * Parked undo stacks — one document's history kept aside while another is live.
 *
 * WHY THIS EXISTS
 * ---------------
 * The studio has exactly ONE live document (`store.design`) and one zundo
 * history over it. Board mode swaps a basket line into that slot and parks the
 * user's own draft (src/state/board.ts). History is per DOCUMENT, so the swap
 * has to move the stacks with the document. The previous answer — clearing them
 * — kept undo from walking across documents but threw the draft's history away
 * as collateral: after coming back from the board, Ctrl+Z did nothing.
 *
 * INVARIANTS
 * ----------
 *  - The key is the SLOT, never `design.id`. Two basket lines cloned from one
 *    design share `design.id` AND every `layer.id` (scripts/board-verify.mjs
 *    section C2); the LINE is the document here.
 *  - Session state, exactly like `board`: never persisted, never inside the undo
 *    document, forgotten when board mode ends. A stack outliving a board session
 *    could only reattach to a line that was since edited elsewhere or deleted.
 *  - Bounded by construction: HISTORY_SLOTS documents × zundo's `limit` of 100
 *    snapshots (which bounds past+future TOGETHER — `_handleSet` empties
 *    futureStates on every record, and undo only moves entries between the two).
 *
 * A FACTORY, not a module singleton: under vite HMR a test that imports this
 * module can get a SECOND instance with its own Map, and singleton assertions
 * then pass vacuously (the harness lesson at the top of scripts/board-verify.mjs).
 * The store owns the one real instance; a test makes its own and asserts
 * eviction without a browser.
 */
import type { Design } from '@/lib/types'

/** One zundo entry: the store partialises history down to `{ design }`. */
export type DesignSnapshot = Partial<{ design: Design }>

/** A document's undo/redo stacks, oldest first — zundo's own ordering. */
export interface HistoryStacks {
  past: DesignSnapshot[]
  future: DesignSnapshot[]
}

export function isEmptyHistory(h: HistoryStacks): boolean {
  return h.past.length === 0 && h.future.length === 0
}

/**
 * How many un-focused documents keep their undo history.
 *
 * 8 = BOARD_MAX_3D_DESKTOP, the number of products a person actually works with
 * at once. A `{ design }` snapshot structurally shares every unmutated layer, so
 * it costs 0.15–1.2 kB measured (617 B for a drag commit on a 4-layer design;
 * 1236 B for the worst shape, adding a layer every step) — 8 full slots of 100
 * snapshots is ≈0.9 MB worst case, about what ONE 384×512 board tile texture
 * costs (boardTextureTargetPx / textureBytes in board.ts, against a board budget
 * of 16–24 MiB). That is the trade this cap is chosen against. No snapshot can
 * ever hold pixels: image layers store an `assetId` and `CustomGarment` stores an
 * assetId plus a rect (src/lib/types.ts).
 */
export const HISTORY_SLOTS = 8

export interface HistoryRegistry {
  /** Park `stacks` under `key`, evicting the least recently parked slot. */
  save(key: string, stacks: HistoryStacks): void
  /** Hand back (and forget) the stacks parked under `key`. */
  take(key: string): HistoryStacks | null
  /** The document is gone — so is its history. */
  drop(key: string): void
  /** The board session ended: forget everything. */
  reset(): void
  /** Parked slots. Diagnostics only (scripts/board-verify.mjs). */
  readonly size: number
}

export function createHistoryRegistry(limit = HISTORY_SLOTS): HistoryRegistry {
  // A Map iterates in insertion order, which is all an LRU needs: re-inserting a
  // key moves it to the end, so the first key is always the oldest.
  const slots = new Map<string, HistoryStacks>()
  return {
    save(key, stacks) {
      slots.delete(key)
      // An empty stack is not worth a slot: focusing eight lines without editing
      // them would otherwise evict eight real histories with nothing.
      if (isEmptyHistory(stacks)) return
      slots.set(key, stacks)
      for (const oldest of slots.keys()) {
        if (slots.size <= limit) break
        slots.delete(oldest)
      }
    },
    take(key) {
      const stacks = slots.get(key) ?? null
      // Removed on read: once installed, the temporal store owns those arrays
      // (zundo's undo() splices them in place) and a copy left here would be a
      // second, diverging truth.
      slots.delete(key)
      return stacks
    },
    drop(key) {
      slots.delete(key)
    },
    reset() {
      slots.clear()
    },
    get size() {
      return slots.size
    },
  }
}
