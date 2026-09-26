/**
 * SVG string → HTMLImageElement rasterization with a small keyed cache.
 * Used for garment bodies/shade overlays and graphic layers.
 */

const cache = new Map<string, Promise<HTMLImageElement>>()
const MAX_ENTRIES = 120

/**
 * The decoded images `getRaster` hands to synchronous render loops.
 *
 * BOUNDED BY THE SAME EVICTION AS `cache` (EDI-17). It used to keep every image
 * it had ever been given: `cache` dropped the promise at 120 entries while this
 * map held the decoded bitmap for the life of the page, so memory grew with
 * every colour a customer tried, at 2048 px, on the phone where it is shortest.
 */
const resolved = new Map<string, HTMLImageElement>()

function evictOne(): void {
  const first = cache.keys().next().value
  if (first === undefined) return
  cache.delete(first)
  resolved.delete(first)
}

function svgToImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('SVG failed to rasterize'))
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
}

/**
 * Rasterize with a stable cache key. The svg itself is NOT part of the key:
 * callers must build keys that change when content changes.
 */
export function rasterize(key: string, svg: string): Promise<HTMLImageElement> {
  const hit = cache.get(key)
  if (hit) {
    // Least recently USED goes first: the garment body is asked for on every
    // frame and must not be the entry a burst of new colours pushes out.
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  while (cache.size >= MAX_ENTRIES) evictOne()
  const p = svgToImage(svg)
  p.catch(() => {
    if (cache.get(key) === p) {
      cache.delete(key)
      resolved.delete(key)
    }
  })
  cache.set(key, p)
  return p
}

/** Await + remember, so render loops can then draw synchronously. */
export async function ensureRaster(
  key: string,
  svg: string,
): Promise<HTMLImageElement> {
  const p = rasterize(key, svg)
  const img = await p
  // Only while the entry is still cached: one evicted during the await would
  // otherwise come back here and never leave.
  if (cache.get(key) === p) resolved.set(key, img)
  return img
}

/** How many decoded images are held. For the bound's own test. */
export function heldRasters(): number {
  return resolved.size
}

export function getRaster(key: string): HTMLImageElement | null {
  return resolved.get(key) ?? null
}

/** Size bucket so scaled graphics re-rasterize only at meaningful steps. */
export function sizeBucket(px: number): number {
  const clamped = Math.max(128, Math.min(4096, px))
  return 2 ** Math.ceil(Math.log2(clamped))
}

/**
 * Force explicit pixel dimensions on an svg string's root element.
 * Without width/height, browsers rasterize viewBox-only svgs at 300×150.
 */
export function withSvgSize(svg: string, w: number, h: number): string {
  return svg.replace(
    /<svg([^>]*?)>/,
    (_m, attrs: string) =>
      `<svg${attrs
        .replace(/\swidth="[^"]*"/, '')
        .replace(/\sheight="[^"]*"/, '')} width="${Math.round(w)}" height="${Math.round(h)}">`,
  )
}
