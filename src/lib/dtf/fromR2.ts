/**
 * A paid order, re-rendered from what the customer actually uploaded.
 *
 * WHERE THIS RUNS, AND WHY IT IS NOT THE SERVER
 * ---------------------------------------------
 * The choice was between deriving a run's transfers server-side and deriving
 * them in the admin bundle. It is here, in the browser, for three reasons that
 * are all the same reason:
 *
 *   A TRANSFER'S EXTENT IS ITS INK, and ink lives in the alpha channel of a
 *   decoded image. `src/lib/ink.ts` measures it on a canvas. Neither the
 *   Cloudflare Worker nor PHP has one, which is already why `POST /api/nest`
 *   packs bare rectangles and why the studio, not the shop, measured the
 *   rectangles in the first place (worker/nest.ts says so at length).
 *
 *   THE TRUE-SHAPE PACKER EATS ALPHA MASKS. `src/lib/dtf/trueshape.ts` is worth
 *   15 to 31 % of the film on concave artwork and cannot run on rectangles.
 *   Moving it server-side would mean shipping a rasteriser to the Worker.
 *
 *   AND THE SHEETS ARE ENORMOUS. A 58 by 250 cm gang sheet at 300 DPI is 202
 *   megapixels, about 800 MB of RGBA backing store; `zipExport.ts` renders one
 *   at a time and frees it immediately for exactly that reason. A Worker has
 *   128 MB and a CPU budget, and o2switch is shared hosting.
 *
 * WHAT THE SHOP KEEPS is the part that decides money: it hands out the queue,
 * it bounds the layout it is handed back (`Production::create_lot` checks the
 * poses, the physical floor, the packer's own ceiling and the ink), and it does
 * the arithmetic of the bill in integer cents. The browser measures; the server
 * decides. That is the seam this project already uses for the price.
 *
 * WHAT IT DOES NOT LEAVE BEHIND
 * -----------------------------
 * A customer's uploads are adopted into the runtime image cache and never into
 * IndexedDB (`adoptAssetImage`). An operator's browser must not slowly become an
 * archive of everybody's artwork, and `releaseStoredDesigns` drops them when the
 * run is done.
 */
import type { Design, Layer, Side, SizeId } from '@/lib/types'
import { migrateDesign } from '@/lib/migrate'
import { adoptAssetImage, releaseAdoptedImages } from '@/state/assets'
import { adminAuthHeaders } from '@/lib/admin/token'
import { piecePlacementCm, printedSides, renderPieces, type RenderedPiece } from './pieces'
import type { PieceSplitOptions } from '@/lib/ink'
import type { RunOrderPiece } from './run'

/** One order line, as the shop's production queue describes it. */
export interface QueueLine {
  item_id: number
  design_id: string
  garment: string
  colour: string
  sku: string
  label: string
  qty: number
  /** Garment size to how many. Empty when the line never carried a grid. */
  sizes: Record<string, number>
}

/** One order in the shop's production queue. */
export interface QueueOrder {
  id: number
  ref: string
  customer: string
  urgency: string
  approved_on: string
  bat: { version: number; by: string }
  target_on: string
  origin: 'fr' | 'es'
  order_by: string
  order_by_fr: string
  order_by_es: string
  late: boolean
  garments: number
  transfers: number
  complete: boolean
  ink_sq_cm: number
  designs: string[]
  lines: QueueLine[]
}

/**
 * A design as it was stored, plus which rasters were adopted for it.
 *
 * The document is the studio's own, verbatim: `worker/design.ts` stores what the
 * studio uploaded and nothing derived from it, so this is the same object the
 * customer was looking at. `migrateDesign` is still applied, because a document
 * uploaded under an older build predates fields the renderer now expects.
 */
export interface StoredDesign {
  id: string
  design: Design
  assetIds: string[]
}

const R2_DOC = (base: string, id: string) => `${base}/r2/design/${id}/design.json`
const R2_ASSET = (base: string, id: string, asset: string) =>
  `${base}/r2/design/${id}/assets/${asset}`
const MANIFEST = (base: string, id: string) => `${base}/api/design/${id}`

/** Reasons a stored design cannot be turned into transfers, for the screen. */
export type LoadFailure = 'auth' | 'not_found' | 'network' | 'unreadable'

export class StoredDesignError extends Error {
  readonly code: LoadFailure
  readonly designId: string
  constructor(code: LoadFailure, designId: string, detail = '') {
    super(`${code}: ${designId}${detail ? ` (${detail})` : ''}`)
    this.name = 'StoredDesignError'
    this.code = code
    this.designId = designId
  }
}

async function admin(url: string, designId: string): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, { headers: adminAuthHeaders(), cache: 'no-store' })
  } catch {
    throw new StoredDesignError('network', designId)
  }
  if (res.status === 401 || res.status === 403) throw new StoredDesignError('auth', designId)
  if (res.status === 404) throw new StoredDesignError('not_found', designId)
  if (!res.ok) throw new StoredDesignError('network', designId, String(res.status))
  return res
}

/**
 * Fetch one stored design and adopt its rasters.
 *
 * The asset list comes from the MANIFEST rather than from the document, because
 * the manifest is what the upload gate actually wrote: a document naming a
 * raster the Worker refused would send us looking for bytes that are not there,
 * and a raster the document no longer names is not this order's.
 */
export async function loadStoredDesign(base: string, designId: string): Promise<StoredDesign> {
  const root = base.replace(/\/+$/, '')
  const manifest = (await (await admin(MANIFEST(root, designId), designId)).json()) as {
    assets?: unknown
  }
  const assetIds = Array.isArray(manifest.assets)
    ? manifest.assets.filter((a): a is string => typeof a === 'string')
    : []

  const raw = await (await admin(R2_DOC(root, designId), designId)).json()
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as Design).layers))
    throw new StoredDesignError('unreadable', designId)
  const design = migrateDesign(raw as Design)

  // Sequential rather than parallel: a run can carry thirty designs, each with
  // several rasters, and firing a hundred concurrent decodes at a browser is how
  // an admin tab runs out of memory rendering a gang sheet immediately after.
  for (const assetId of assetIds) {
    const blob = await (await admin(R2_ASSET(root, designId, assetId), designId)).blob()
    try {
      await adoptAssetImage(assetId, blob)
    } catch {
      throw new StoredDesignError('unreadable', designId, assetId)
    }
  }

  return { id: designId, design, assetIds }
}

/** Give back the memory a run borrowed. */
export function releaseStoredDesigns(designs: readonly StoredDesign[]): void {
  releaseAdoptedImages(designs.flatMap((d) => d.assetIds))
}

/**
 * The sizes a line is actually printed in, and how many of each.
 *
 * A LINE WITHOUT A SIZE GRID IS NOT A LINE WITHOUT SIZES. Quote conversions and
 * older orders carry only a quantity, and the honest answer there is one
 * un-graded run of that quantity: `renderPieces` with no size keeps k = 1, which
 * is the geometry the order was priced on. Inventing an M would print the same
 * transfer and claim a size nobody chose.
 */
export function lineSizes(line: QueueLine): { size: SizeId | undefined; qty: number }[] {
  const entries = Object.entries(line.sizes ?? {})
    .map(([size, qty]) => ({ size: size as SizeId, qty: Math.max(0, Math.floor(qty)) }))
    .filter((e) => e.qty > 0)
    .sort((a, b) => (a.size === b.size ? 0 : a.size < b.size ? -1 : 1))
  const counted = entries.reduce((a, e) => a + e.qty, 0)
  if (counted === line.qty && counted > 0) return entries
  /*
   * A GRID THAT DOES NOT ADD UP IS NOT USED. It would print the wrong number of
   * garments, which is worse than printing them un-graded: the quantity on the
   * line is what was paid for and what the picking list will pull off a shelf.
   */
  return [{ size: undefined, qty: Math.max(1, line.qty) }]
}

/** What one order contributes to a run: its transfers, and the artwork for them. */
export interface OrderTransfers {
  orderId: string
  ref: string
  pieces: RunOrderPiece[]
  /** Rendered artwork by transfer key, for the sheets and the cutting plans. */
  sources: Map<string, RenderedPiece>
  /** Garment-sides pressed. The number the shop checks exactly. */
  poses: number
  /** Copies of transfers on the film. Depends on the split, so it is reported. */
  copies: number
  /** Sum of transfer box area over every copy, cm2. */
  areaSqCm: number
}

const SIDE_LABEL: Record<string, string> = {
  front: 'devant',
  back: 'dos',
  sleeve: 'manche',
}

const sideLabel = (side: Side): string => SIDE_LABEL[side] ?? side

/**
 * Render every transfer an order needs, at the size each garment is really
 * printed at.
 *
 * THIS IS WHAT RE-RENDERING BUYS. The rectangles stored on the order were all
 * measured at ONE size, the pricing size, because a price has to be one number
 * (question 37). The workshop prints the sizes that were ordered, and a graded
 * design's 3XL transfer is physically larger than its M. Nesting the stored
 * rectangles would under-buy film on a run of large garments and over-buy on a
 * run of small ones; nesting these does not.
 *
 * The key of every piece carries the line, the side, the size and the part, so a
 * placement on a shared gang sheet names exactly one transfer of one order at
 * one size, which is what the press sheet and the cutting plan are read from.
 */
export async function renderOrderTransfers(
  order: QueueOrder,
  designs: ReadonlyMap<string, StoredDesign>,
  dpi: number,
  opts?: PieceSplitOptions,
): Promise<OrderTransfers> {
  const pieces: RunOrderPiece[] = []
  const sources = new Map<string, RenderedPiece>()
  let poses = 0
  let copies = 0
  let areaSqCm = 0

  for (const line of order.lines) {
    const stored = designs.get(line.design_id)
    if (!stored) throw new StoredDesignError('not_found', line.design_id)
    const sides: Side[] = printedSides(stored.design)
    poses += sides.length * Math.max(1, line.qty)

    for (const side of sides) {
      for (const { size, qty } of lineSizes(line)) {
        const baseKey = `${line.item_id}:${side}${size ? `#${size}` : ''}`
        const parts = await renderPieces(stored.design, side, dpi, size, { ...opts, baseKey })
        for (const part of parts) {
          const placement = piecePlacementCm(part)
          pieces.push({
            key: part.sourceKey,
            wCm: part.wCm,
            hCm: part.hCm,
            qty,
            topCm: placement.topCm,
            centerDxCm: placement.centerDxCm,
            label: `${order.ref} ${line.label}${size ? ` ${size}` : ''} ${sideLabel(side)}${
              part.parts > 1 ? ` ${part.part}/${part.parts}` : ''
            }`,
          })
          sources.set(part.sourceKey, part)
          copies += qty
          areaSqCm += part.wCm * part.hCm * qty
        }
      }
    }
  }

  return {
    orderId: String(order.id),
    ref: order.ref,
    pieces,
    sources,
    poses,
    copies,
    areaSqCm: Math.round(areaSqCm * 1000) / 1000,
  }
}

/** Blanks to pull off a shelf for a whole run, one row per SKU and size. */
export interface PickRow {
  sku: string
  label: string
  colour: string
  size: string
  qty: number
  /** Which orders need it, so a short delivery names who waits. */
  orders: string[]
}

/**
 * The picking list, summed across the run.
 *
 * ACROSS THE RUN AND NOT PER ORDER, because that is how a shelf is walked: four
 * orders needing the same white M is one trip and one count, and four separate
 * lines is four chances to miscount. The orders are still named on the row, so a
 * supplier shortfall says immediately whose parcel is at risk.
 *
 * A blank with no SKU is listed under its own name rather than dropped. The
 * catalogue publishes six articles without a barcode and a quote line carries no
 * product at all, and a picking list that silently omits them sends someone to
 * press onto garments nobody fetched.
 */
export function pickingList(orders: readonly QueueOrder[]): PickRow[] {
  const rows = new Map<string, PickRow>()
  for (const order of orders) {
    for (const line of order.lines) {
      for (const { size, qty } of lineSizes(line)) {
        const sizeLabel = size ?? 'taille unique'
        const key = `${line.sku}|${line.colour}|${sizeLabel}|${line.label}`
        const row = rows.get(key) ?? {
          sku: line.sku,
          label: line.label,
          colour: line.colour,
          size: sizeLabel,
          qty: 0,
          orders: [],
        }
        row.qty += qty
        if (!row.orders.includes(order.ref)) row.orders.push(order.ref)
        rows.set(key, row)
      }
    }
  }
  return [...rows.values()].sort((a, b) => {
    const bySku = a.sku.localeCompare(b.sku)
    if (bySku !== 0) return bySku
    const byColour = a.colour.localeCompare(b.colour)
    if (byColour !== 0) return byColour
    return a.size.localeCompare(b.size)
  })
}

/** Whether a side carries anything at all. Cheap, for a caller sizing up work. */
export const sideHasArt = (design: Design, side: Side): boolean =>
  design.layers.some((l: Layer) => l.side === side)
