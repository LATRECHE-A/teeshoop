/**
 * Print textures for the 3D board, the per-line analogue of Scene3D's
 * useDesignTextures, with two differences that are the whole point.
 *
 * 1. EVERY render passes `line.size`. The print area and the artwork inside it
 *    are both graded by the design's chest ratio (src/lib/printScale.ts), so a
 *    board rendered at the global `previewSize` would show (and eventually
 *    print) physically wrong artwork on every line but one. This is the single
 *    most expensive mistake available in board mode, and it is invisible on
 *    screen until someone measures a transfer.
 *
 * 2. The pixel target comes from the BUDGET, not from the single-garment
 *    constant. 2048 px is 16 MiB of GPU per 3:4 panel; two sides across eight
 *    products at that target is 256 MiB, which is more than many phones budget
 *    for the whole page. See boardTextureTargetPx.
 *
 * Renders are serialised with a frame yielded between them: eight print areas
 * back to back is eight frames of work inside one, and the board is supposed to
 * appear progressively rather than after a freeze.
 */
import { useEffect, useMemo, useState } from 'react'
import type { CardSource, DecalSource, Side } from '@/lib/types'
import type { BasketLine } from '@/state/basket'
import { getAreaSizeIn, renderMockup, renderPrintArea, sideLayers } from '@/lib/renderDesign'
import { printScaleK } from '@/lib/printScale'
import { textureBytes } from '@/state/board'
import type { BoardProduct } from '@/three/Board3D'
import { getCachedMockup, mockupExtentIn, mockupKey, pinMockups, requestMockup } from './mockupCache'
import { linePrintedSides } from '@/state/basket'

/**
 * Long edge of the flat billboard preview past the 3D cap. It shrinks as the
 * overflow grows because these canvases are PINNED for as long as they are on
 * screen (the tile LRU may not zero a canvas the GPU is sampling), so they are
 * the one part of the board's memory that the cache ceiling does not bound:
 * 32 billboards cost ~11 MB at 256 px and ~45 MB at 512.
 */
function billboardPx(overflow: number): number {
  if (overflow <= 8) return 512
  if (overflow <= 16) return 384
  return 256
}

interface Entry {
  front: DecalSource | null
  back: DecalSource | null
  customFront: CardSource | null
  customBack: CardSource | null
}

/** Keyed on everything that changes a pixel; cleared when the board closes. */
const cache = new Map<string, Entry>()
let version = 0

/**
 * Freeing is DEFERRED and PAIRED with `keepBoardTextures` on mount: StrictMode
 * runs an effect's cleanup once before re-running it, and zeroing a canvas a
 * live CanvasTexture still points at would show a blank print.
 */
let clearTimer: ReturnType<typeof setTimeout> | null = null

function cancelClear(): void {
  if (clearTimer === null) return
  clearTimeout(clearTimer)
  clearTimer = null
}

/** Cancel a pending clear (call from the owner's mount effect). */
export function keepBoardTextures(): void {
  cancelClear()
}

function entryKey(line: BasketLine, targetPx: number): string {
  return `${line.id}:${line.design.updatedAt}:${line.size}:${targetPx}`
}

async function buildEntry(line: BasketLine, targetPx: number): Promise<Entry> {
  const design = line.design
  const size = line.size
  const v = ++version
  const out: Entry = { front: null, back: null, customFront: null, customBack: null }

  if (design.garmentId === 'custom') {
    const widthIn = design.custom?.widthIn ?? 20
    for (const side of ['front', 'back'] as const) {
      if (!design.custom?.[side]) continue
      const canvas = await renderMockup(design, side, Math.round(targetPx * 1.3), size)
      if (canvas.width === 0) continue
      out[side === 'front' ? 'customFront' : 'customBack'] = {
        canvas,
        version: v,
        wIn: widthIn,
        hIn: (widthIn * canvas.height) / canvas.width,
      }
    }
    return out
  }

  for (const side of ['front', 'back'] as const) {
    if (sideLayers(design, side).length === 0) continue
    // GRADED area at THIS line's size, the decal's world size in inches.
    const area = getAreaSizeIn(design, side, size)
    const ppi = targetPx / Math.max(area.wIn, area.hIn)
    const canvas = await renderPrintArea(design, side, ppi, size)
    if (canvas) out[side] = { canvas, version: v, wIn: area.wIn, hIn: area.hIn }
  }
  return out
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

/**
 * The board's 3D products, textures filling in progressively. The first
 * `solidCap` lines render as real garments; the rest become billboards on the
 * already-cached 2D mockup, so an over-long basket degrades instead of failing.
 */
export function useBoardProducts(
  lines: BasketLine[],
  solidCap: number,
  targetPx: number,
): BoardProduct[] {
  // How many lines have finished. Doubles as the signal that re-derives
  // `products` below: the cache is a module Map, so nothing else would notice
  // it filling.
  const [tick, bump] = useState(0)
  const signature = lines
    .map((l) => `${l.id}:${l.design.updatedAt}:${l.size}:${l.design.colorId}`)
    .join('|')

  useEffect(() => {
    let cancelled = false
    cancelClear()
    bump(0)
    // The billboards' pixels live in the 2D tile cache, which evicts by zeroing
    // the canvas. Pin them for as long as the 3D board is showing them, or a
    // basket long enough to overflow that cache blanks its own flat previews.
    const flatPx = billboardPx(Math.max(0, lines.length - solidCap))
    pinMockups(
      lines
        .slice(solidCap)
        .map((l) => mockupKey(l, linePrintedSides(l.design)[0] ?? 'front', flatPx)),
    )
    void (async () => {
      for (const [i, line] of lines.entries()) {
        if (cancelled) return
        const key = entryKey(line, targetPx)
        if (i < solidCap) {
          if (!cache.has(key)) {
            try {
              const entry = await buildEntry(line, targetPx)
              if (cancelled) return
              cache.set(key, entry)
            } catch {
              if (cancelled) return
              cache.set(key, { front: null, back: null, customFront: null, customBack: null })
            }
          }
        } else {
          // Billboards reuse the 2D board's raster, no new texture work.
          const side = linePrintedSides(line.design)[0] ?? 'front'
          await requestMockup(line, side, flatPx).promise
          if (cancelled) return
        }
        bump(i + 1)
        await nextFrame()
      }
      // SWEEP. A billboard's pixels can go missing between the request and the
      // render pass that reads them back: the queue's generation is bumped
      // when the 2D board unmounts, and an eviction can land in the gap between
      // StrictMode's two effect runs. Nothing else would ever ask again, and the
      // product would sit on the wall as an empty slot, so ask once more for
      // whatever is not there. Bounded: one extra pass, only over what is
      // missing.
      for (const line of lines.slice(solidCap)) {
        if (cancelled) return
        const side = linePrintedSides(line.design)[0] ?? 'front'
        if (getCachedMockup(mockupKey(line, side, flatPx))) continue
        await requestMockup(line, side, flatPx).promise
        if (cancelled) return
        bump((n) => n + 1)
      }
    })()
    // The pin set is deliberately NOT cleared here. Each run REPLACES it, and
    // clearing on cleanup opens a window (StrictMode's mount→cleanup→mount, or
    // any dependency change) in which a render that lands can evict (and zero)
    // a canvas the very next run is about to pin. `clearMockupCache` drops the
    // pins when the board closes, which is the correct lifetime.
    return () => {
      cancelled = true
    }
    // `signature` is the identity of the work; `lines` is recreated every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, solidCap, targetPx])

  const products = useMemo<BoardProduct[]>(() => {
    const flatPx = billboardPx(Math.max(0, lines.length - solidCap))
    return lines.map((line, i) => {
      const solid = i < solidCap
      const entry = cache.get(entryKey(line, targetPx))
      const side = linePrintedSides(line.design)[0] ?? 'front'
      const extentIn = mockupExtentIn(line.design, side, line.size)
      // READ ONLY here: the effect above enqueues the flat preview for the
      // products that need one. Requesting from a render pass would queue a
      // mockup for every solid garment as well, which none of them use.
      const flatCanvas = getCachedMockup(mockupKey(line, side, flatPx))
      return {
        id: line.id,
        label: `${line.label}, ${line.garmentLabel} ${line.size} ×${line.qty}`,
        garment: line.design.garmentId,
        colorHex: line.colorHex,
        sizeId: line.size,
        printK: printScaleK(line.design, line.size),
        front: entry?.front ?? null,
        back: entry?.back ?? null,
        custom: { front: entry?.customFront ?? null, back: entry?.customBack ?? null },
        flat: flatCanvas
          ? { canvas: flatCanvas, version: 1, wIn: extentIn.wIn, hIn: extentIn.hIn }
          : null,
        extentIn,
        solid,
      }
    })
    // Same reasoning as the effect: the signature plus `tick` is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, solidCap, targetPx, tick])

  return products
}

/** GPU bytes the board's print textures occupy (RGBA8 + mipmaps). */
export function boardTextureBytes(): number {
  let bytes = 0
  for (const entry of cache.values())
    for (const src of [entry.front, entry.back, entry.customFront, entry.customBack])
      if (src) bytes += textureBytes(src.canvas.width, src.canvas.height)
  return bytes
}

export function boardTextureCount(): number {
  let n = 0
  for (const entry of cache.values())
    for (const src of [entry.front, entry.back, entry.customFront, entry.customBack])
      if (src) n++
  return n
}

/** Free after `delayMs` unless the board asks for textures meanwhile. */
export function scheduleClearBoardTextures(delayMs = 1500): void {
  cancelClear()
  clearTimer = setTimeout(() => {
    clearTimer = null
    clearBoardTextures()
  }, delayMs)
}

/** Free every print canvas, called when the board closes. */
export function clearBoardTextures(): void {
  cancelClear()
  for (const entry of cache.values())
    for (const src of [entry.front, entry.back, entry.customFront, entry.customBack])
      if (src) {
        src.canvas.width = 0
        src.canvas.height = 0
      }
  cache.clear()
}
