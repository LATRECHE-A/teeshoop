/**
 * INGEST — product library persistence (IndexedDB via idb-keyval), following
 * the savedDesigns.ts idiom: a meta index under one key + one record per
 * product. Photos live in the shared asset library (src/state/assets.ts);
 * products only reference assetIds. Export/import embeds the photos as
 * data-urls (mirroring persist.ts exportDesignFile) so a garment definition
 * can move between machines as a single JSON file.
 */
import { get, set, del, update } from 'idb-keyval'
import type { AssetMeta } from '@/lib/types'
import { assetToDataUrl, ensureAssetImage, importAsset, listAssets } from '@/state/assets'
import { invalidateCustomBBox } from '@/lib/custom'
import {
  isProductDef,
  productSizeIds,
  sanitizeSizes,
  type ProductDef,
  type ProductMeta,
} from './types'

const INDEX_KEY = 'tshop:products:index'
const productKey = (id: string) => `tshop:product:${id}`

const THUMB_PX = 120

export async function listProducts(): Promise<ProductMeta[]> {
  return (await get<ProductMeta[]>(INDEX_KEY)) ?? []
}

/** Atomic read-modify-write of the index (see mutateIndex in assets.ts). */
async function mutateIndex(
  fn: (index: ProductMeta[]) => ProductMeta[],
): Promise<ProductMeta[]> {
  let next: ProductMeta[] = []
  await update<ProductMeta[]>(INDEX_KEY, (index) => {
    next = fn(index ?? [])
    return next
  })
  return next
}

export async function getProduct(id: string): Promise<ProductDef | undefined> {
  return get<ProductDef>(productKey(id))
}

/** Small front-photo data-url for the library cards ('' when unavailable). */
async function renderProductThumb(product: ProductDef): Promise<string> {
  try {
    const img = await ensureAssetImage(
      product.front.assetId,
      product.front.useCutout ? 'cutout' : 'original',
    )
    const scale = THUMB_PX / Math.max(img.naturalWidth, img.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  } catch {
    return ''
  }
}

/** Save (or overwrite by id) with a fresh thumbnail; returns the new index. */
export async function saveProduct(product: ProductDef): Promise<ProductMeta[]> {
  const meta: ProductMeta = {
    id: product.id,
    name: product.name,
    brandRef: product.brandRef,
    sizeIds: productSizeIds(product),
    thumb: await renderProductThumb(product),
    createdAt: product.createdAt,
  }
  await set(productKey(product.id), product)
  return mutateIndex((index) => [
    meta,
    ...index.filter((m) => m.id !== product.id),
  ])
}

/**
 * Remove a product (its photos stay in the shared asset library — they may
 * be referenced by the active design or other products).
 */
export async function deleteProduct(id: string): Promise<ProductMeta[]> {
  await del(productKey(id))
  return mutateIndex((index) => index.filter((m) => m.id !== id))
}

// ---------------------------------------------------------------------------
// Single-product JSON file (portable between machines)
// ---------------------------------------------------------------------------

interface ProductFile {
  v: 1
  app: 'tshop-product'
  product: ProductDef
  assets: Record<
    string,
    { meta: AssetMeta; dataUrl: string; cutoutDataUrl: string | null }
  >
}

export async function exportProductFile(product: ProductDef): Promise<Blob> {
  const ids = new Set<string>([product.front.assetId])
  if (product.back) ids.add(product.back.assetId)

  const assets: ProductFile['assets'] = {}
  const metas = await listAssets()
  for (const id of ids) {
    const meta = metas.find((a) => a.id === id)
    const dataUrl = await assetToDataUrl(id, 'original')
    if (!meta || !dataUrl) continue
    assets[id] = {
      meta,
      dataUrl,
      cutoutDataUrl: meta.hasCutout ? await assetToDataUrl(id, 'cutout') : null,
    }
  }
  const file: ProductFile = { v: 1, app: 'tshop-product', product, assets }
  return new Blob([JSON.stringify(file)], { type: 'application/json' })
}

/**
 * Import a product file: recreates the embedded photos (keeping their asset
 * ids), saves the product (same-id imports overwrite — that is what keeps a
 * garment in sync across machines) and returns it.
 */
export async function importProductFile(blob: Blob): Promise<ProductDef> {
  let file: ProductFile
  try {
    file = JSON.parse(await blob.text()) as ProductFile
  } catch {
    throw new Error('Not a Tshop product file')
  }
  if (file.app !== 'tshop-product' || file.v !== 1 || !isProductDef(file.product))
    throw new Error('Not a Tshop product file')
  // A hand-edited/foreign file may carry malformed size rows the guard only
  // ignores — strip them here so nothing downstream can select one.
  const product: ProductDef = {
    ...file.product,
    sizes: sanitizeSizes(file.product.sizes),
  }
  for (const [id, a] of Object.entries(file.assets ?? {})) {
    await importAsset({ ...a.meta, id }, a.dataUrl, a.cutoutDataUrl)
    invalidateCustomBBox(id)
  }
  await saveProduct(product)
  return product
}
