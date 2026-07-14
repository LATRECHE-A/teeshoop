/**
 * Asset library — user-uploaded images persisted in IndexedDB, plus a runtime
 * HTMLImageElement cache so canvas renderers can draw synchronously after an
 * async `ensure` step.
 */
import { get, set, del } from 'idb-keyval'
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

async function writeIndex(index: AssetMeta[]): Promise<AssetMeta[]> {
  await set(INDEX_KEY, index)
  return index
}

/** Decode, downscale to ≤2048px long edge, store, return updated meta. */
export async function addAsset(file: Blob, name: string): Promise<AssetMeta> {
  const bitmap = await createImageBitmap(file)
  let { width, height } = bitmap
  let stored: Blob = file

  if (Math.max(width, height) > MAX_EDGE || file.type === 'image/webp') {
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height))
    width = Math.round(width * scale)
    height = Math.round(height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0, width, height)
    const isPhoto = file.type === 'image/jpeg'
    stored = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Could not encode image'))),
        isPhoto ? 'image/jpeg' : 'image/png',
        0.92,
      ),
    )
  }
  bitmap.close()

  const meta: AssetMeta = {
    id: nanoid(10),
    name: name.replace(/\.[a-z0-9]+$/i, '').slice(0, 48) || 'Image',
    width,
    height,
    hasCutout: false,
    createdAt: Date.now(),
  }
  await set(blobKey(meta.id, false), stored)
  const index = await listAssets()
  await writeIndex([meta, ...index])
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
  const index = await listAssets()
  return writeIndex(
    index.map((a) => (a.id === id ? { ...a, hasCutout: true } : a)),
  )
}

export async function removeAsset(id: string): Promise<AssetMeta[]> {
  await del(blobKey(id, false))
  await del(blobKey(id, true))
  invalidateAssetImage(id, 'original')
  invalidateAssetImage(id, 'cutout')
  const index = await listAssets()
  return writeIndex(index.filter((a) => a.id !== id))
}

// --- runtime image cache -----------------------------------------------

interface CacheEntry {
  img: HTMLImageElement | null
  url: string | null
  promise: Promise<HTMLImageElement>
}
const imageCache = new Map<string, CacheEntry>()
const cacheKey = (id: string, variant: AssetVariant) => `${id}:${variant}`

export function invalidateAssetImage(id: string, variant: AssetVariant) {
  const key = cacheKey(id, variant)
  const entry = imageCache.get(key)
  if (entry?.url) URL.revokeObjectURL(entry.url)
  imageCache.delete(key)
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
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Could not decode image'))
      img.src = url
    })
    entry.img = img
    entry.url = url
    return img
  })()
  entry.promise.catch(() => imageCache.delete(key))
  imageCache.set(key, entry)
  return entry.promise
}

/** Synchronous access for render loops — call ensureAssetImage first. */
export function getCachedAssetImage(
  id: string,
  variant: AssetVariant = 'original',
): HTMLImageElement | null {
  return imageCache.get(cacheKey(id, variant))?.img ?? null
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
  const index = await listAssets()
  const orig = await (await fetch(dataUrl)).blob()
  await set(blobKey(meta.id, false), orig)
  if (cutoutDataUrl) {
    const cut = await (await fetch(cutoutDataUrl)).blob()
    await set(blobKey(meta.id, true), cut)
  }
  if (!index.some((a) => a.id === meta.id)) {
    await writeIndex([{ ...meta, hasCutout: !!cutoutDataUrl }, ...index])
  }
  invalidateAssetImage(meta.id, 'original')
  invalidateAssetImage(meta.id, 'cutout')
}
