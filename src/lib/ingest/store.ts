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
import { invalidateGarmentAnatomy } from '@/lib/garmentAnatomy'
import {
  backSourceOf,
  isProductDef,
  productSizeIds,
  sanitizeSizes,
  type ProductDef,
  type ProductMeta,
  type ProductSideDef,
} from './types'

const INDEX_KEY = 'tshop:products:index'
const productKey = (id: string) => `tshop:product:${id}`
/** Index schema version — bumped when a row gains a field (see listProducts). */
const INDEX_V_KEY = 'tshop:products:indexV'
const INDEX_V = 2

const THUMB_PX = 120

/**
 * Bring a stored record up to the current schema. Everything here is additive
 * and idempotent: a side with no `origin` predates generated backs and is
 * therefore a real photo, and `backSource` is derivable from the record. Runs
 * on every read so a machine that never re-saves still behaves correctly.
 *
 * `backSource` is RE-derived, not merely filled in: it is denormalised, and the
 * one caller that does not compute it — importProductFile, reading a file a
 * human may have edited — could otherwise hand us a record claiming a real back
 * over a `generated` side. Recomputing is what makes the promise below (record
 * and index row can never disagree) true rather than aspirational; the object
 * is only cloned when the stored value is actually wrong, so reads stay cheap.
 */
function migrateProduct(p: ProductDef): ProductDef {
  const stamp = (s: ProductSideDef | null) =>
    s && s.origin === undefined ? { ...s, origin: 'photo' as const } : s
  const front = stamp(p.front)!
  const back = stamp(p.back)
  let out = front !== p.front || back !== p.back ? { ...p, front, back } : p
  const backSource = backSourceOf(out)
  if (out.backSource !== backSource) out = { ...out, backSource }
  return out
}

/**
 * The index rows are denormalised, so a new field cannot be derived from them —
 * it needs the records. Backfill once, guarded by a version key: at admin scale
 * (tens of products) that is a handful of small IndexedDB reads on first load.
 */
export async function listProducts(): Promise<ProductMeta[]> {
  const index = (await get<ProductMeta[]>(INDEX_KEY)) ?? []
  if (index.length === 0 || (await get<number>(INDEX_V_KEY)) === INDEX_V) return index
  const next = await Promise.all(
    index.map(async (m) =>
      m.backSource
        ? m
        : {
            ...m,
            backSource: backSourceOf(
              (await get<ProductDef>(productKey(m.id))) ?? { back: null },
            ),
          },
    ),
  )
  await set(INDEX_KEY, next)
  await set(INDEX_V_KEY, INDEX_V)
  return next
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
  const raw = await get<ProductDef>(productKey(id))
  return raw && migrateProduct(raw)
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
export async function saveProduct(input: ProductDef): Promise<ProductMeta[]> {
  // Normalised on the way in as well as on the way out, so the record and its
  // index row can never disagree about the back.
  const product = migrateProduct(input)
  const meta: ProductMeta = {
    id: product.id,
    name: product.name,
    brandRef: product.brandRef,
    sizeIds: productSizeIds(product),
    thumb: await renderProductThumb(product),
    createdAt: product.createdAt,
    backSource: backSourceOf(product),
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

/** v1 files predate photo provenance; migrateProduct upgrades them on import. */
interface ProductFile {
  v: 1 | 2
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
  const file: ProductFile = { v: 2, app: 'tshop-product', product, assets }
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
  // EVERY version this app has ever written must stay importable — a file
  // exported last week is the whole point of the format.
  if (
    file.app !== 'tshop-product' ||
    (file.v !== 1 && file.v !== 2) ||
    !isProductDef(file.product)
  )
    throw new Error('Not a Tshop product file')
  // A hand-edited/foreign file may carry malformed size rows the guard only
  // ignores — strip them here so nothing downstream can select one.
  const product: ProductDef = migrateProduct({
    ...file.product,
    sizes: sanitizeSizes(file.product.sizes),
  })
  for (const [id, a] of Object.entries(file.assets ?? {})) {
    await importAsset({ ...a.meta, id }, a.dataUrl, a.cutoutDataUrl)
    invalidateCustomBBox(id)
    invalidateGarmentAnatomy(id)
  }
  await saveProduct(product)
  return product
}
