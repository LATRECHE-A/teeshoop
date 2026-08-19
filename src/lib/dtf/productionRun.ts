/**
 * Turning the shop's production queue into something the gang-sheet modal can
 * nest, and turning what it nested back into something the shop can record.
 *
 * IT IS A TRANSLATION AND NOT A SECOND PIPELINE. The modal already renders a
 * queue row into transfers, masks them, nests them, preflights them and exports
 * them; a production row is a queue row whose design came off R2 instead of out
 * of the basket, and whose quantity came off a paid order instead of a spinner.
 * Everything downstream is untouched. That is the whole reason the shop's queue
 * is shaped the way it is.
 *
 * WHAT THIS FILE OWNS is the two edges:
 *   - one row per (order line, printed side, garment size actually ordered),
 *     because the workshop presses the sizes that were bought and a graded
 *     design's 3XL transfer is physically bigger than its M;
 *   - the report the shop is handed back, which has to carry the poses, the
 *     per-order solo length and every transfer's geometry, because those are
 *     exactly what `Production::create_lot` bounds the layout against.
 */
import type { Design, Side, SizeId } from '@/lib/types'
import type { NestResult } from './nesting'
import { printedSides } from './pieces'
import {
  lineSizes,
  loadStoredDesign,
  type QueueOrder,
  type StoredDesign,
} from './fromR2'
import type { LayoutReport } from './shopQueue'
import type { RunArchive, RunArchiveOrder } from './runExport'

/** One row of the gang-sheet queue that came from a paid order. */
export interface ProductionRow {
  /** `<order>/<item>:<side>[#<size>]`, unique across the whole run. */
  key: string
  /** The same row without the size, for the grading trade-off readout. */
  baseKey: string
  design: Design
  side: Side
  size?: SizeId
  qty: number
  order: RowOrder
}

/** What a row remembers about the order it belongs to. */
export interface RowOrder {
  id: string
  ref: string
  customer: string
  urgency: string
  targetOn: string
  batVersion: number
  batBy: string
  designId: string
  garments: number
  /** Which line of the order, so a press sheet can name the garment. */
  lineLabel: string
}

/**
 * Fetch every design the chosen orders reference, once each.
 *
 * ONCE EACH, and it matters: two orders of the same design are common (a
 * reassort, a second club order) and fetching the rasters twice would double the
 * download and the decode for nothing. A design that cannot be fetched is
 * reported by id rather than swallowed, because a run missing one order's
 * artwork must not quietly become a run of the others.
 */
export async function loadRunDesigns(
  base: string,
  orders: readonly QueueOrder[],
  onStep?: (done: number, total: number) => void,
): Promise<{ designs: Map<string, StoredDesign>; failed: { designId: string; why: unknown }[] }> {
  const wanted = [...new Set(orders.flatMap((o) => o.designs))]
  const designs = new Map<string, StoredDesign>()
  const failed: { designId: string; why: unknown }[] = []
  let done = 0
  for (const designId of wanted) {
    onStep?.(++done, wanted.length)
    try {
      designs.set(designId, await loadStoredDesign(base, designId))
    } catch (why) {
      failed.push({ designId, why })
    }
  }
  return { designs, failed }
}

/**
 * One order as gang-sheet queue rows.
 *
 * The key carries the order, the line, the side and the size, in that order, so
 * a placement on a shared film names exactly one transfer of one order at one
 * size. It is also what `RunIndex.ownerOf` maps back, and what the shop stores
 * on the lot: three readers, one identity.
 */
export function productionRows(
  order: QueueOrder,
  designs: ReadonlyMap<string, StoredDesign>,
): ProductionRow[] {
  const out: ProductionRow[] = []
  for (const line of order.lines) {
    const stored = designs.get(line.design_id)
    if (!stored) continue
    const rowOrder: RowOrder = {
      id: String(order.id),
      ref: order.ref,
      customer: order.customer,
      urgency: order.urgency,
      targetOn: order.target_on,
      batVersion: order.bat.version,
      batBy: order.bat.by,
      designId: line.design_id,
      garments: order.garments,
      lineLabel: line.label,
    }
    for (const side of printedSides(stored.design))
      for (const { size, qty } of lineSizes(line))
        out.push({
          key: `${order.id}/${line.item_id}:${side}${size ? `#${size}` : ''}`,
          baseKey: `${order.id}/${line.item_id}:${side}`,
          design: stored.design,
          side,
          ...(size ? { size } : {}),
          qty,
          order: rowOrder,
        })
  }
  return out
}

/**
 * Garment-sides an order presses, from its rows.
 *
 * The number the shop checks EXACTLY, because it is the only one that survives
 * both the grading and the operator's split choice. Counted from the rows rather
 * than from the transfers for that reason: a row IS a garment-side at a size,
 * whatever it renders into.
 */
export function posesOf(rows: readonly { qty: number }[]): number {
  return rows.reduce((a, r) => a + r.qty, 0)
}

/** One nested transfer as the shop reads it. */
export interface ReportedPiece {
  key: string
  w_cm: number
  h_cm: number
  qty: number
}

const r2 = (v: number): number => Math.round(v * 100) / 100

/**
 * The report the shop bounds and records.
 *
 * `soloByOrder` is what each order was measured at ON ITS OWN, and the caller has
 * to have measured it with the same packer, the same interlock ceiling and the
 * same restart count as the pool: a cheaper baseline nests worse and inflates
 * every saving reported against it. `DtfModal.makeLot` is what does that, on its
 * own nesting channel so that the baselines and the pooled layout cannot cancel
 * each other; `measureRun` in run.ts is the same measurement for a caller that
 * has the pieces but not the modal, and the bench and the verifier use it.
 */
export function layoutReport(input: {
  result: NestResult
  restarts: number
  flip: boolean
  appVersion: string
  /** order id to the transfers of that order that were nested. */
  piecesByOrder: ReadonlyMap<string, ReportedPiece[]>
  /** order id to garment-sides pressed. */
  posesByOrder: ReadonlyMap<string, number>
  /** order id to metres that order alone would have been billed. */
  soloByOrder: ReadonlyMap<string, number>
}): LayoutReport {
  const orders: LayoutReport['orders'] = {}
  for (const [orderId, pieces] of input.piecesByOrder)
    orders[orderId] = {
      solo_m: input.soloByOrder.get(orderId) ?? 0,
      poses: input.posesByOrder.get(orderId) ?? 0,
      pieces: pieces.map((p) => ({ ...p, w_cm: r2(p.w_cm), h_cm: r2(p.h_cm) })),
    }
  const geometry = input.result.options
  return {
    pooled_m: input.result.totalLengthM,
    sheets: input.result.sheets.length,
    /*
     * READ OFF THE RESULT, never off the settings the operator can still move.
     * `NestResult.options` is the geometry the packer really used, echoed back by
     * `resolveNestOptions`, so this cannot describe a layout other than the one
     * measured.
     */
    width_cm: geometry.printableWidthCm,
    gap_cm: geometry.gapCm,
    billing_step_cm: geometry.billingStepCm ?? 10,
    packer: input.result.packer,
    interlock_cm: input.result.interlockCm,
    restarts: input.restarts,
    flip: input.flip,
    app_version: input.appVersion,
    orders,
  }
}

/** The shop's stored lot, as the JSON it hands back. */
interface StoredLot {
  lot_id?: unknown
  origin?: unknown
  state?: unknown
  created_on?: unknown
  order_by?: unknown
  warnings?: unknown
  layout?: { pooled_m?: unknown }
  bill?: {
    total_ht?: unknown
    solo_total_ht?: unknown
    saved_ht?: unknown
    worse?: unknown
    shares?: Record<string, Record<string, unknown>>
  }
  members?: unknown[]
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * The lot the shop recorded, as the archive states it.
 *
 * EVERY FIGURE IS THE SHOP'S. Nothing here recomputes a share or a saving: the
 * archive is the copy the workshop holds and would be believed over the margin
 * report if the two ever disagreed, so it must be a transcription and not a
 * second calculation.
 */
export function runArchive(
  lot: Record<string, unknown>,
  keysByOrder: ReadonlyMap<string, string[]>,
  picking: RunArchive['picking'],
): RunArchive {
  const l = lot as StoredLot
  const shares = l.bill?.shares ?? {}
  const members = Array.isArray(l.members) ? l.members : []

  const orders: RunArchiveOrder[] = members.map((raw) => {
    const m = raw as Record<string, unknown>
    const id = String(num(m.id))
    const share = (shares[id] ?? {}) as Record<string, unknown>
    const bat = (m.bat ?? {}) as Record<string, unknown>
    return {
      id,
      ref: str(m.ref),
      customer: str(m.customer),
      urgency: str(m.urgency_label) || str(m.urgency),
      targetOn: str(m.target_on),
      batVersion: num(bat.version),
      batBy: str(bat.by),
      designIds: Array.isArray(m.designs) ? (m.designs as unknown[]).map(str) : [],
      keys: keysByOrder.get(id) ?? [],
      soloM: num(share.solo_m),
      soloCents: num(share.solo_ht),
      shareCents: num(share.share_ht),
      savedCents: num(share.saved_ht),
      areaShareCents: num(share.area_share_ht),
      garments: num(m.garments),
    }
  })

  return {
    lotId: num(l.lot_id),
    origin: 'es' === l.origin ? 'es' : 'fr',
    state: str(l.state),
    createdOn: str(l.created_on),
    orderByOn: str(l.order_by),
    pooledM: num(l.layout?.pooled_m),
    totalCents: num(l.bill?.total_ht),
    soloTotalCents: num(l.bill?.solo_total_ht),
    savedCents: num(l.bill?.saved_ht),
    worse: true === l.bill?.worse,
    orders,
    picking,
    warnings: Array.isArray(l.warnings) ? (l.warnings as unknown[]).map(str) : [],
  }
}
