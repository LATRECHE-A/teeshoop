/**
 * A PRINT RUN: the film of several orders, bought once.
 *
 * Until this file, nesting was a property of one order. That is the wrong unit
 * and it always was: a roll is 56 cm wide whoever is paying for it, and two
 * orders pressed on the same afternoon that each buy their own metre buy two
 * half-empty metres. `worker/design.ts` stores the SOURCE of every order rather
 * than a frozen layout for exactly this reason, and says so in its header.
 *
 * WHAT A RUN IS. A set of orders that are paid, whose proof is approved, and
 * whose deadlines all still hold if the film is ordered today from one origin
 * (`schedule.ts` decides that part). Their transfers are nested TOGETHER onto
 * one set of gang sheets, the supplier is paid once, and the bill is split back
 * across the orders so each margin report tells the truth about what its own
 * order cost.
 *
 * ── WHY THE PIECES ARE RENAMED ───────────────────────────────────────────────
 *
 * Two orders can carry the same design, and two designs can carry the same side
 * key. `runPieceKey` prefixes every transfer with its order id, so a placement
 * on a shared sheet always names exactly one order's transfer. The mapping back
 * is a MAP built here, never a string parse: an id that has to be split apart to
 * be understood is an id that will be split apart wrongly the day an order
 * reference contains the separator.
 *
 * ── DETERMINISM, WHICH POOLING IS THE NATURAL ENEMY OF ───────────────────────
 *
 * `scripts/dtf-verify.mjs` asserts that three consecutive runs, a reversed input
 * order, and the Worker against the inline packer all agree byte for byte. A
 * pool is assembled from whatever arrived, in whatever order it arrived, which
 * is precisely how that guarantee dies. So `buildRun` sorts the orders by id
 * before it flattens them and sorts each order's pieces by key, and the packers
 * re-sort instances with their own total order on top of that. Arrival order
 * cannot reach the layout.
 *
 * ── THE SPLIT OF THE BILL ────────────────────────────────────────────────────
 *
 * The rule is stated here and computed in PHP. `Cost::attribute()` owns the
 * arithmetic because it is money and money is integer cents on the server; this
 * module owns the MEASUREMENTS the rule is applied to, because they come out of
 * the packer. See `RunMeasurement`.
 *
 * The rule is PROPORTIONAL TO WHAT EACH ORDER WOULD HAVE COST ALONE, and the
 * obvious alternative, proportional to nested area, was measured against it
 * rather than argued about (`scripts/dtf-bench.mjs`, `attribution` block). Area
 * is the wrong denominator for one reason: it charges an order for the ink it
 * carries and not for the film it forces. An order of one 55 × 40 cm back print
 * leaves a 1 cm ribbon down the side of a 56 cm roll that no other order can
 * use; an order of forty 6 × 6 cm chest marks fills whatever it is given. Under
 * the area rule the second subsidises the first, and the margin report then says
 * the awkward order was cheap, which is exactly the fact the report exists to
 * surface. Both numbers are computed and both are reported; only the solo one is
 * charged.
 */
import type { DtfPiece, NestResult } from './nesting'
import type { ShapePiece } from './trueshape'

/**
 * Separator between an order id and a transfer key inside a run.
 *
 * A slash, because it reads as a path on a cutting-plan label and because a
 * WooCommerce order id is digits and can never contain one. Nothing parses on
 * it (`RunIndex.ownerOf` is the authority); it is chosen so that a human reading
 * `1042/front#M~2` off a gang sheet knows immediately whose transfer it is.
 */
export const RUN_KEY_SEP = '/'

/** `<order id>/<transfer key>`: unique across the whole run. */
export const runPieceKey = (orderId: string, key: string): string =>
  `${orderId}${RUN_KEY_SEP}${key}`

/** One transfer of one order, as the run receives it. */
export interface RunOrderPiece {
  /** Unique WITHIN its order. Becomes `<orderId>/<key>` in the run. */
  key: string
  wCm: number
  hCm: number
  /** Copies this order needs. Never a per-run number. */
  qty: number
  /** Alpha mask for the true-shape packer; absent nests the bounding box. */
  mask?: Uint8Array
  maskW?: number
  maskH?: number
  /** The artwork has no "up", so 180°/270° are printable. Operator's call. */
  allowFlip?: boolean
  /** Where it goes on the garment, cm below the top of its print area. */
  topCm?: number
  /** Signed offset from the print area's centre line, cm. + is to the right. */
  centerDxCm?: number
  /** Which side of which garment, for the press sheet. */
  label?: string
}

/** One order in the pool. */
export interface RunOrder {
  /** WooCommerce order id, as a string. Sorted on, so keep it stable. */
  id: string
  /** What a human reads on a press sheet: «#1042», «Devis 2026-114». */
  ref: string
  pieces: RunOrderPiece[]
}

/** The flattened pool, plus the way back from a placement to an order. */
export interface RunIndex {
  /** Every transfer of every order, renamed, in a deterministic order. */
  pieces: ShapePiece[]
  /** run piece key → order id. THE authority; never parse a key instead. */
  ownerOf: ReadonlyMap<string, string>
  /** order id → the order, for labels and press sheets. */
  orderOf: ReadonlyMap<string, RunOrder>
  /** Order ids, sorted: the order everything in a run is reported in. */
  orderIds: string[]
}

/**
 * Total order on order ids that does not depend on how they arrived.
 *
 * Numeric when both sides are numbers, because `'1042' < '99'` as strings and a
 * workshop list sorted that way looks broken; lexicographic otherwise, so a
 * quote reference or a test fixture still gets a stable answer.
 */
export function compareOrderIds(a: string, b: string): number {
  const na = Number(a)
  const nb = Number(b)
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb
  return a === b ? 0 : a < b ? -1 : 1
}

/**
 * Flatten a pool into one piece list.
 *
 * Refuses a duplicate order id rather than letting the second one silently
 * overwrite the first in `orderOf`: two rows for order 1042 in a run is a
 * workshop pressing one of them twice and the other never, and the archive
 * would look complete either way.
 */
export function buildRun(orders: RunOrder[]): RunIndex {
  const orderOf = new Map<string, RunOrder>()
  for (const o of orders) {
    if (orderOf.has(o.id)) throw new Error(`order ${o.id} is in this run twice`)
    orderOf.set(o.id, o)
  }
  const orderIds = [...orderOf.keys()].sort(compareOrderIds)

  const ownerOf = new Map<string, string>()
  const pieces: ShapePiece[] = []
  for (const id of orderIds) {
    const order = orderOf.get(id)!
    // Sorted inside the order too: the packer's own total order breaks ties on
    // the piece id, so leaving these in document order would let a re-render
    // that emits the same transfers in a different sequence move the layout.
    const sorted = [...order.pieces].sort((a, b) => (a.key === b.key ? 0 : a.key < b.key ? -1 : 1))
    for (const p of sorted) {
      const key = runPieceKey(id, p.key)
      if (ownerOf.has(key)) throw new Error(`transfer ${key} is in this run twice`)
      ownerOf.set(key, id)
      pieces.push({
        id: key,
        sourceKey: key,
        wCm: p.wCm,
        hCm: p.hCm,
        qty: p.qty,
        /*
         * ROTATION IS ALWAYS ALLOWED, FLIPPING NEVER IS BY DEFAULT. A gang
         * sheet is cut into pieces, so a transfer lying on its side prints the
         * same garment; a transfer at 180° prints it upside down and is scrap.
         * `worker/nest.ts` takes the same position for the same reason.
         */
        allowRotate: true,
        ...(p.allowFlip ? { allowFlip: true } : {}),
        ...(p.mask && p.maskW && p.maskH
          ? { mask: p.mask, maskW: p.maskW, maskH: p.maskH }
          : {}),
      })
    }
  }
  return { pieces, ownerOf, orderOf, orderIds }
}

/**
 * What one order needs on its own: the counterfactual the saving is measured
 * against, and the weight the bill is split by.
 *
 * It must be packed with the SAME settings as the pool. A baseline computed at
 * fewer restarts or a lower interlock ceiling would nest worse, which would
 * inflate every reported saving. `measureRun` is the only thing that produces
 * these, and it takes one packer and one options object for both arms.
 */
export interface RunSolo {
  orderId: string
  lengthCm: number
  sheets: number
  /** Σ placed bounding-box area, cm²: the area rule's denominator. */
  boxSqCm: number
  /** Copies placed. A mismatch with the pooled count means a piece was lost. */
  placed: number
}

/** Everything the shop needs to price a run and split its bill. */
export interface RunMeasurement {
  /** Pooled: what the supplier will actually bill. */
  pooledLengthCm: number
  pooledSheets: number
  /** Σ of what each order would have been billed alone. */
  soloLengthCm: number
  solos: RunSolo[]
  /** Σ placed bbox area over the pooled sheets, cm². */
  pooledBoxSqCm: number
  /** Ink coverage of the pooled sheets when the packer could measure it. */
  pooledInkUtilization: number | null
  /** How the layout was produced. Change any of these and it moves. */
  packer: 'shelf' | 'trueshape'
  interlockCm: number
  restarts: number
  flip: boolean
  /** Transfers the packer could not place, in run keys. Non-empty = no answer. */
  unplaceable: string[]
}

const boxAreaOf = (r: NestResult): number =>
  r.sheets.reduce((a, s) => a + s.placements.reduce((b, p) => b + p.wCm * p.hCm, 0), 0)

/**
 * Nest the pool once and every order once, with one packer and one settings
 * object, and report both.
 *
 * `pack` is a parameter so the caller decides which packer this is: the shelf
 * one for a cheap server-side answer, the true-shape one for the layout that
 * will be printed. It is called N+1 times for N orders, which is the honest
 * cost of knowing what pooling saved, the counterfactual cannot be inferred
 * from the pooled layout.
 */
export function measureRun(
  index: RunIndex,
  pack: (pieces: ShapePiece[]) => NestResult,
  meta: { restarts: number; flip: boolean },
): RunMeasurement {
  const pooled = pack(index.pieces)

  const byOrder = new Map<string, ShapePiece[]>()
  for (const id of index.orderIds) byOrder.set(id, [])
  for (const p of index.pieces) byOrder.get(index.ownerOf.get(p.sourceKey)!)!.push(p)

  const solos: RunSolo[] = []
  const unplaceable = new Set(pooled.unplaceable)
  for (const id of index.orderIds) {
    const alone = pack(byOrder.get(id)!)
    for (const u of alone.unplaceable) unplaceable.add(u)
    solos.push({
      orderId: id,
      lengthCm: alone.totalLengthCm,
      sheets: alone.sheets.length,
      boxSqCm: boxAreaOf(alone),
      placed: alone.totalPieces,
    })
  }

  return {
    pooledLengthCm: pooled.totalLengthCm,
    pooledSheets: pooled.sheets.length,
    soloLengthCm: solos.reduce((a, s) => a + s.lengthCm, 0),
    solos,
    pooledBoxSqCm: boxAreaOf(pooled),
    pooledInkUtilization: pooled.totalInkUtilization ?? null,
    packer: pooled.packer,
    interlockCm: pooled.interlockCm,
    restarts: meta.restarts,
    flip: meta.flip,
    unplaceable: [...unplaceable].sort(),
  }
}
