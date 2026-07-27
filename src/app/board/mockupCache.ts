/**
 * Rasterised product tiles for the 2D board.
 *
 * The board shows N products at once and must never block a frame doing it, so
 * three decisions are load-bearing:
 *
 *  1. ONE RENDER PER ANIMATION FRAME, newest request first. `renderMockup` is
 *     synchronous canvas work once its fonts/images are warm; rendering eight
 *     of them back to back is eight frames' worth of jank in one frame. The
 *     queue is LIFO because the tile the user just looked at is the tile they
 *     want, and a generation counter drops everything a re-layout obsoleted
 *     (the same guard idiom as EditorEngine's syncSeq).
 *
 *  2. THE CANVAS IS ADOPTED INTO THE DOM, never `toDataURL`-ed. PNG-encoding a
 *     512 px tile costs ~8-20 ms and buys nothing here — the basket's own
 *     thumbnails keep using the data-url hook because they are <img> tags.
 *
 *  3. THE KEY LEANS ON `design.updatedAt`, which touch() bumps on every design
 *     mutation, so a focused line's edits invalidate its tile the moment they
 *     are written back to the basket. Anything that mutates a design without
 *     touch() would render a stale tile — that is a store bug, not a cache bug.
 *
 * Evicted canvases are zeroed rather than dropped: Safari does not reclaim a
 * canvas backing store on GC promptly, and a board is where that adds up.
 */
import type { BasketLine } from '@/state/basket'
import type { Design, Side } from '@/lib/types'
import type { SizeId } from '@/content/sizeChart'
import { GARMENTS } from '@/garments'
import { garmentDrawTransform, renderMockup } from '@/lib/renderDesign'
import type { BoardItemSize } from '@/state/board'

/**
 * Cache ceiling, in tiles. Measured: nine products across two density steps
 * reached ~50 MB at 48 entries, which is more than a preview deserves; 24 still
 * holds a full board plus one sharpening step per tile.
 */
const MAX_ENTRIES_DESKTOP = 24
const MAX_ENTRIES_MOBILE = 12

/** Height/width of a custom garment's photo before we have measured one. */
const CUSTOM_FALLBACK_ASPECT = 1.25

function isMobile(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(max-width: 767.98px)').matches
}

// --- physical extents (synchronous, so the layout never waits) -------------

/** Aspect (h/w) measured from a rendered custom-garment canvas, keyed by photo. */
const customAspect = new Map<string, number>()

function customKey(design: Design, side: Side): string | null {
  const setup = side === 'sleeve' ? null : design.custom?.[side] ?? null
  return setup ? `${setup.assetId}:${setup.useCutout ? 'cut' : 'raw'}` : null
}

/**
 * Real size, in inches, of the canvas `renderMockup` produces for this line —
 * the garment INCLUDING sleeves and hem, not its chest width, because that is
 * what the tile actually shows and what makes an S tee read smaller than a 3XL
 * hoodie beside it.
 *
 * Catalog garments are exact and synchronous: the mockup canvas is the union of
 * the 800 px viewBox and the collar-anchored size transform, both pure
 * functions of (garment, side, size). Custom garments depend on the photo's
 * alpha bbox, which is only known after a decode — they start at a nominal
 * aspect and settle once their first tile has been rendered.
 */
export function mockupExtentIn(design: Design, side: Side, size: SizeId): BoardItemSize {
  if (design.garmentId === 'custom') {
    const wIn = design.custom?.widthIn ?? 20
    const key = customKey(design, side)
    const aspect = (key && customAspect.get(key)) || CUSTOM_FALLBACK_ASPECT
    return { wIn, hIn: wIn * aspect }
  }
  const art = GARMENTS[design.garmentId]
  const tf = garmentDrawTransform(design.garmentId, side, size)
  const wPx = Math.max(800, tf.x + 800 * tf.sx) - Math.min(0, tf.x)
  const hPx = Math.max(800, tf.y + 800 * tf.sy) - Math.min(0, tf.y)
  return { wIn: wPx / art.pxPerInch, hIn: hPx / art.pxPerInch }
}

// --- cache ----------------------------------------------------------------

/**
 * Keyed by LINE, not by design: a canvas is one DOM node and each tile adopts
 * its own, so two lines cloned from the same design (same id, same size — the
 * common "same shirt, more of them" case) would otherwise tear the element back
 * and forth between tiles. The expensive part is shared anyway: the garment
 * body SVG raster is cached on (garment, side, colour, px) inside rasterCache.
 */
export function mockupKey(line: BasketLine, side: Side, widthPx: number): string {
  const d = line.design
  return `${line.id}:${d.updatedAt}:${d.garmentId}:${d.colorId}:${line.size}:${side}:${widthPx}`
}

const cache = new Map<string, HTMLCanvasElement>()

/**
 * Keys the LRU may not evict. The 3D board's billboards are textured from a
 * canvas held in THIS cache, and eviction ZEROES that canvas — so a board big
 * enough to overflow the cache would blank the very products that degraded to
 * billboards. Pinning is the cheap fix; re-rendering them into a second cache
 * is the expensive one.
 */
const pinned = new Set<string>()

/** Replace the pin set (the 3D board owns it; empty on unmount). */
export function pinMockups(keys: Iterable<string>): void {
  pinned.clear()
  for (const key of keys) pinned.add(key)
}

function evict(): void {
  const max = isMobile() ? MAX_ENTRIES_MOBILE : MAX_ENTRIES_DESKTOP
  if (cache.size <= max) return
  // Insertion order = LRU order; pinned entries are skipped rather than
  // breaking the loop, or one pinned key would freeze the whole cache.
  for (const key of [...cache.keys()]) {
    if (cache.size <= max) return
    if (pinned.has(key)) continue
    const canvas = cache.get(key)
    cache.delete(key)
    if (canvas) {
      canvas.width = 0
      canvas.height = 0
    }
  }
}

/**
 * Freeing is DEFERRED and PAIRED: the board's owner calls `keepMockupCache`
 * from its mount effect and `scheduleClearMockupCache` from the cleanup.
 * StrictMode runs mount → cleanup → mount, so an immediate clear would zero the
 * canvases the re-mounted tiles have already adopted. Any request cancels a
 * pending clear too, which covers the ordinary case.
 */
let clearTimer: ReturnType<typeof setTimeout> | null = null

function cancelClear(): void {
  if (clearTimer === null) return
  clearTimeout(clearTimer)
  clearTimer = null
}

/** Cancel a pending clear — call from the owner's mount effect. */
export function keepMockupCache(): void {
  cancelClear()
}

export function getCachedMockup(key: string): HTMLCanvasElement | null {
  cancelClear()
  return cache.get(key) ?? null
}

interface Job {
  key: string
  line: BasketLine
  side: Side
  widthPx: number
  gen: number
  resolve(canvas: HTMLCanvasElement | null): void
}

let generation = 0
const queue: Job[] = []
const pending = new Map<string, Promise<HTMLCanvasElement | null>>()
let pumping = false

async function pump(): Promise<void> {
  if (pumping) return
  pumping = true
  try {
    while (queue.length > 0) {
      // LIFO: whatever was requested last is what the user is looking at.
      const job = queue.pop() as Job
      if (job.gen !== generation) {
        job.resolve(null)
        continue
      }
      let canvas: HTMLCanvasElement | null = null
      try {
        canvas = await renderMockup(job.line.design, job.side, job.widthPx, job.line.size)
      } catch {
        canvas = null
      }
      if (canvas && job.gen === generation) {
        cache.set(job.key, canvas)
        evict()
        const ck = customKey(job.line.design, job.side)
        if (ck && canvas.width > 0) customAspect.set(ck, canvas.height / canvas.width)
      }
      pending.delete(job.key)
      job.resolve(job.gen === generation ? canvas : null)
      // Yield a whole frame between renders — the point of the queue.
      await new Promise<void>((r) => requestAnimationFrame(() => r()))
    }
  } finally {
    pumping = false
  }
}

/** Cached canvas, or a promise for one. Never renders the same key twice. */
export function requestMockup(
  line: BasketLine,
  side: Side,
  widthPx: number,
): { key: string; canvas: HTMLCanvasElement | null; promise: Promise<HTMLCanvasElement | null> } {
  cancelClear()
  const key = mockupKey(line, side, widthPx)
  const hit = cache.get(key)
  if (hit) return { key, canvas: hit, promise: Promise.resolve(hit) }
  const inflight = pending.get(key)
  if (inflight) return { key, canvas: null, promise: inflight }
  const promise = new Promise<HTMLCanvasElement | null>((resolve) => {
    queue.push({ key, line, side, widthPx, gen: generation, resolve })
  })
  pending.set(key, promise)
  void pump()
  return { key, canvas: null, promise }
}

/** Drop every queued render (a re-layout obsoleted them all). */
export function cancelPendingMockups(): void {
  generation++
  for (const job of queue.splice(0)) job.resolve(null)
  pending.clear()
}

/** Free every tile canvas — called when the board closes. */
export function clearMockupCache(): void {
  cancelClear()
  cancelPendingMockups()
  for (const canvas of cache.values()) {
    canvas.width = 0
    canvas.height = 0
  }
  cache.clear()
  pinned.clear()
}

/** Free after `delayMs` unless a tile asks for a mockup meanwhile. */
export function scheduleClearMockupCache(delayMs = 1500): void {
  cancelClear()
  clearTimer = setTimeout(() => {
    clearTimer = null
    clearMockupCache()
  }, delayMs)
}

/** Bytes the cached tile canvases occupy (RGBA8, no mipmaps in 2D). */
export function mockupCacheBytes(): number {
  let bytes = 0
  for (const canvas of cache.values()) bytes += canvas.width * canvas.height * 4
  return bytes
}

export function mockupCacheSize(): number {
  return cache.size
}
