/**
 * SVG string → HTMLImageElement rasterization with a small keyed cache.
 * Used for garment bodies/shade overlays and graphic layers.
 */

const cache = new Map<string, Promise<HTMLImageElement>>()
const MAX_ENTRIES = 120

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
 * Rasterize with a stable cache key. The svg itself is NOT part of the key —
 * callers must build keys that change when content changes.
 */
export function rasterize(key: string, svg: string): Promise<HTMLImageElement> {
  const hit = cache.get(key)
  if (hit) return hit
  if (cache.size > MAX_ENTRIES) {
    const first = cache.keys().next().value
    if (first) cache.delete(first)
  }
  const p = svgToImage(svg)
  p.catch(() => cache.delete(key))
  cache.set(key, p)
  return p
}

const resolved = new Map<string, HTMLImageElement>()

/** Await + remember, so render loops can then draw synchronously. */
export async function ensureRaster(
  key: string,
  svg: string,
): Promise<HTMLImageElement> {
  const img = await rasterize(key, svg)
  resolved.set(key, img)
  return img
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
