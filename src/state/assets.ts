/**
 * Asset library: user-uploaded images persisted in IndexedDB, plus a runtime
 * HTMLImageElement cache so canvas renderers can draw synchronously after an
 * async `ensure` step.
 */
import { get, set, del, update } from 'idb-keyval'
import { nanoid } from 'nanoid'
import type { AssetMeta } from '@/lib/types'

const INDEX_KEY = 'tshop:assets:index'
const blobKey = (id: string, cutout: boolean) =>
  `tshop:asset:${id}${cutout ? ':cutout' : ''}`

export type AssetVariant = 'original' | 'cutout'

const MAX_EDGE = 2048

export async function listAssets(): Promise<AssetMeta[]> {
  return (await get<AssetMeta[]>(INDEX_KEY)) ?? []
}

/**
 * Read-modify-write the shared index inside ONE idb transaction: photo
 * ingests (bg removal) and uploads run concurrently, and a plain
 * listAssets()+set() pair silently loses the slower writer's row/flag.
 */
async function mutateIndex(
  fn: (index: AssetMeta[]) => AssetMeta[],
): Promise<AssetMeta[]> {
  let next: AssetMeta[] = []
  await update<AssetMeta[]>(INDEX_KEY, (index) => {
    next = fn(index ?? [])
    return next
  })
  return next
}

/** Decode an svg blob via HTMLImageElement (createImageBitmap rejects svgs). */
async function decodeSvg(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Could not decode SVG'))
      img.src = url
    })
    if (!img.naturalWidth || !img.naturalHeight)
      throw new Error('SVG has no intrinsic size')
    return img
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

/** Decode, downscale to ≤2048px long edge, store, return updated meta. */
export async function addAsset(file: Blob, name: string): Promise<AssetMeta> {
  const isSvg = file.type === 'image/svg+xml'
  const source: ImageBitmap | HTMLImageElement = isSvg
    ? await decodeSvg(file)
    : await createImageBitmap(file)
  let width = 'naturalWidth' in source ? source.naturalWidth : source.width
  let height = 'naturalHeight' in source ? source.naturalHeight : source.height
  let stored: Blob = file

  // svgs are rasterized crisply at up to MAX_EDGE so the rest of the
  // pipeline (cutouts, print export, thumbnails) sees plain bitmaps.
  if (isSvg || Math.max(width, height) > MAX_EDGE || file.type === 'image/webp') {
    const scale = isSvg
      ? MAX_EDGE / Math.max(width, height)
      : Math.min(1, MAX_EDGE / Math.max(width, height))
    width = Math.max(1, Math.round(width * scale))
    height = Math.max(1, Math.round(height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, 0, 0, width, height)
    const isPhoto = file.type === 'image/jpeg'
    stored = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Could not encode image'))),
        isPhoto ? 'image/jpeg' : 'image/png',
        0.92,
      ),
    )
  }
  if ('close' in source) source.close()

  const meta: AssetMeta = {
    id: nanoid(10),
    name: name.replace(/\.[a-z0-9]+$/i, '').slice(0, 48) || 'Image',
    width,
    height,
    hasCutout: false,
    createdAt: Date.now(),
  }
  await set(blobKey(meta.id, false), stored)
  await mutateIndex((index) => [meta, ...index])
  return meta
}

export async function getAssetBlob(
  id: string,
  variant: AssetVariant = 'original',
): Promise<Blob | undefined> {
  return get<Blob>(blobKey(id, variant === 'cutout'))
}

export async function setAssetCutout(
  id: string,
  blob: Blob,
): Promise<AssetMeta[]> {
  await set(blobKey(id, true), blob)
  invalidateAssetImage(id, 'cutout')
  return mutateIndex((index) =>
    index.map((a) => (a.id === id ? { ...a, hasCutout: true } : a)),
  )
}

export async function removeAsset(id: string): Promise<AssetMeta[]> {
  await del(blobKey(id, false))
  await del(blobKey(id, true))
  invalidateAssetImage(id, 'original')
  invalidateAssetImage(id, 'cutout')
  return mutateIndex((index) => index.filter((a) => a.id !== id))
}

// --- runtime image cache -----------------------------------------------

interface CacheEntry {
  img: HTMLImageElement | null
  url: string | null
  promise: Promise<HTMLImageElement>
}
const imageCache = new Map<string, CacheEntry>()
const cacheKey = (id: string, variant: AssetVariant) => `${id}:${variant}`

/**
 * How many times an asset's bytes have been replaced under the same id.
 *
 * Anything that DERIVES something from an asset's pixels and caches it has to
 * be able to tell "the same asset" from "the same id, different pixels":
 * re-running background removal overwrites the cutout blob in place, so an id
 * alone is not an identity. Callers put this number in their own cache key
 * (see `src/lib/ink.ts`), which means every future invalidation path invalidates
 * them too, without this module having to know they exist.
 */
const revisions = new Map<string, number>()

export function assetRevision(id: string, variant: AssetVariant = 'original'): number {
  return revisions.get(cacheKey(id, variant)) ?? 0
}

export function invalidateAssetImage(id: string, variant: AssetVariant) {
  const key = cacheKey(id, variant)
  const entry = imageCache.get(key)
  if (entry?.url) URL.revokeObjectURL(entry.url)
  imageCache.delete(key)
  revisions.set(key, (revisions.get(key) ?? 0) + 1)
}

/** Load (and cache) the drawable image for an asset. */
export function ensureAssetImage(
  id: string,
  variant: AssetVariant = 'original',
): Promise<HTMLImageElement> {
  const key = cacheKey(id, variant)
  const hit = imageCache.get(key)
  if (hit) return hit.promise

  const entry: CacheEntry = {
    img: null,
    url: null,
    promise: Promise.resolve(new Image()),
  }
  entry.promise = (async () => {
    let blob = await getAssetBlob(id, variant)
    if (!blob && variant === 'cutout') blob = await getAssetBlob(id)
    if (!blob) throw new Error(`Asset ${id} is missing from the library`)
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.decoding = 'async'
    try {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('Could not decode image'))
        img.src = url
      })
    } catch (err) {
      URL.revokeObjectURL(url)
      throw err
    }
    entry.img = img
    entry.url = url
    return img
  })()
  entry.promise.catch(() => imageCache.delete(key))
  imageCache.set(key, entry)
  return entry.promise
}

/** Synchronous access for render loops: call ensureAssetImage first. */
export function getCachedAssetImage(
  id: string,
  variant: AssetVariant = 'original',
): HTMLImageElement | null {
  return imageCache.get(cacheKey(id, variant))?.img ?? null
}

/**
 * Put someone else's artwork in the runtime cache and NOWHERE ELSE.
 *
 * The workshop re-renders a paid order from the rasters stored on R2
 * (`src/lib/dtf/fromR2.ts`). Those are customers' own files, borrowed for the
 * length of one nesting, and `importAsset` above would write every one of them
 * into this machine's IndexedDB for ever, an operator's browser slowly
 * accumulating the artwork of everybody who has ever ordered, with nothing that
 * ever removes it. This fills the image cache alone, so it lives as long as the
 * tab and not a minute longer.
 *
 * BOTH VARIANTS, FROM ONE BLOB, and that is not laziness.
 *
 * R2 holds exactly ONE raster per asset id, and it is the one the design draws:
 * `assetVariants` in src/lib/teeshoop/upload.ts sends the CUTOUT bytes under the
 * plain id when the layer that references it has `useCutout`. So there is no
 * second blob to fetch and no way to tell from the bytes which variant they are.
 * Registering them under `original` alone meant that any layer with background
 * removal looked up `cutout`, missed, fell through to IndexedDB, missed again
 * and threw. `ensureInkProbes` swallows that throw and reports the layer as
 * unmeasurable, and `renderPieces` then refuses the whole side, so EVERY paid
 * order whose customer removed a background was unrenderable in the production
 * queue. Loudly, which is the only mercy in it: background removal is a headline
 * feature of the studio, so that was most of the interesting orders.
 *
 * The failure mode of doing it this way is the opposite one and it is harmless:
 * a design that draws the original while a cutout exists would find the original
 * under both names, which is exactly what it wanted.
 */
export async function adoptAssetImage(id: string, blob: Blob): Promise<HTMLImageElement> {
  for (const variant of VARIANTS) {
    const previous = imageCache.get(cacheKey(id, variant))
    if (previous?.url) URL.revokeObjectURL(previous.url)
    imageCache.delete(cacheKey(id, variant))
  }

  const url = URL.createObjectURL(blob)
  const img = new Image()
  img.decoding = 'async'
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error(`Could not decode artwork ${id}`))
      img.src = url
    })
  } catch (err) {
    URL.revokeObjectURL(url)
    throw err
  }
  /*
   * ONE object URL, revoked once. `releaseAdoptedImages` walks the same two
   * variants, and `invalidateAssetImage` revokes whatever url it finds, so the
   * second entry must NOT carry a copy of it: revoking the same url twice is
   * harmless, but handing a stale entry a live url is not.
   */
  imageCache.set(cacheKey(id, 'original'), { img, url, promise: Promise.resolve(img) })
  imageCache.set(cacheKey(id, 'cutout'), { img, url: null, promise: Promise.resolve(img) })
  for (const variant of VARIANTS) {
    const key = cacheKey(id, variant)
    revisions.set(key, (revisions.get(key) ?? 0) + 1)
  }
  return img
}

/** The two names one stored raster answers to. */
const VARIANTS: readonly AssetVariant[] = ['original', 'cutout']

/** Drop every adopted image and its object URL. Call it when a run is done. */
export function releaseAdoptedImages(ids: readonly string[]): void {
  for (const id of ids) {
    invalidateAssetImage(id, 'original')
    invalidateAssetImage(id, 'cutout')
  }
}

/** Read an asset as a data URL (for design-file export). */
export async function assetToDataUrl(
  id: string,
  variant: AssetVariant,
): Promise<string | null> {
  const blob = await getAssetBlob(id, variant)
  if (!blob) return null
  return new Promise((resolve) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => resolve(null)
    r.readAsDataURL(blob)
  })
}

/** Recreate an asset from an exported design file (keeps its id). */
export async function importAsset(
  meta: AssetMeta,
  dataUrl: string,
  cutoutDataUrl?: string | null,
): Promise<void> {
  const orig = await (await fetch(dataUrl)).blob()
  await set(blobKey(meta.id, false), orig)
  if (cutoutDataUrl) {
    const cut = await (await fetch(cutoutDataUrl)).blob()
    await set(blobKey(meta.id, true), cut)
  }
  await mutateIndex((index) =>
    index.some((a) => a.id === meta.id)
      ? index
      : [{ ...meta, hasCutout: !!cutoutDataUrl }, ...index],
  )
  invalidateAssetImage(meta.id, 'original')
  invalidateAssetImage(meta.id, 'cutout')
}
