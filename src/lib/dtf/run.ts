/**
 * A PRINT RUN — the film of several orders, bought once.
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
 * obvious alternative — proportional to nested area — was measured against it
 * rather than argued about (`scripts/dtf-bench.mjs`, `attribution` block). Area
 * is the wrong denominator for one reason: it charges an order for the ink it
 * carries and not for the film it forces. An order of one 55 × 40 cm back print
 * leaves a 1 cm ribbon down the side of a 56 cm roll that no other order can
 * use; an order of forty 6 × 6 cm chest marks fills whatever it is given. Under
 * the area rule the second subsidises the first, and the margin report then says
 * the awkward order was cheap — which is exactly the fact the report exists to
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

/** `<order id>/<transfer key>` — unique across the whole run. */
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
  /** What a human reads on a press sheet — «#1042», «Devis 2026-114». */
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
  /** Order ids, sorted — the order everything in a run is reported in. */
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

/** The same, as plain rectangles — what the shop's `POST /api/nest` accepts. */
export function runRectangles(index: RunIndex): DtfPiece[] {
  return index.pieces.map((p) => ({
    id: p.id,
    sourceKey: p.sourceKey,
    wCm: p.wCm,
    hCm: p.hCm,
    qty: p.qty,
    allowRotate: p.allowRotate,
  }))
}

/**
 * What one order needs on its own — the counterfactual the saving is measured
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
  /** Σ placed bounding-box area, cm² — the area rule's denominator. */
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
 * cost of knowing what pooling saved — the counterfactual cannot be inferred
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

/**
 * The shop's answer: what each order is charged for the film, in cents.
 *
 * Computed by `Cost::attribute()` in PHP and carried back here so the archive,
 * the screen and the margin report all print the SAME number. Nothing in this
 * module computes it: two implementations of a cost split is two invoices.
 */
export interface RunShare {
  orderId: string
  /** What this order alone would have cost, cents HT. */
  soloCents: number
  /** Its share of the pooled bill, cents HT. Σ shares = the pooled bill. */
  shareCents: number
  /** `soloCents - shareCents`. Never negative under the proportional rule. */
  savedCents: number
  /** What the area rule would have charged instead — published, not applied. */
  areaShareCents: number
}

export interface RunBill {
  origin: 'fr' | 'es'
  /** The pooled film bill, cents HT: metres + waste + one delivery. */
  totalCents: number
  /** Σ of every order's stand-alone bill, each with its own minimum and delivery. */
  soloTotalCents: number
  savedCents: number
  shares: RunShare[]
}

/**
 * The lower bound a reported run length must clear, cm.
 *
 * Σ ink area ÷ printable width. Not a tolerance and not an estimate: you cannot
 * print a square metre of ink on less than a square metre of film, whatever the
 * packer does. It exists because the layout is measured in a browser (see
 * `docs/PRODUCTION.md`) and the shop must be able to refuse a length that is
 * physically impossible rather than take it on trust — a run length that is too
 * SHORT under-costs every order in it and lowers every floor price.
 *
 * The billed length is the raw extent rounded UP and split across sheets, so it
 * is never below the raw extent, so this bounds it too.
 */
export function minimumRunLengthCm(inkSqCm: number, printableWidthCm: number): number {
  if (!(printableWidthCm > 0) || !(inkSqCm > 0)) return 0
  return inkSqCm / printableWidthCm
}

// ---------------------------------------------------------------------------
// Which orders may share a run
// ---------------------------------------------------------------------------

/**
 * Where the film is bought. France is fast and dear, Spain is slow and cheap,
 * and chapter 1 of the Bible says plainly which is for what: « Le DTF peut être
 * commandé en France pour les urgences ou en Espagne pour les délais standards. »
 */
export type FilmOrigin = 'fr' | 'es'

/**
 * An order the shop says is ready to print, with the dates the SHOP computed.
 *
 * THERE IS NO CALENDAR IN THIS MODULE, and that is deliberate rather than lazy.
 * Working days, French public holidays, the promised lead time per urgency and
 * the film's own transit all live in `Production.php`, because that is where the
 * order's paid date and its proof approval live. A second calendar in TypeScript
 * would be a second answer to "when must this be ordered", and the day the two
 * disagreed the shop would promise a date the workshop was not planning for.
 * Everything here is a comparison of ISO dates, which sort as strings.
 */
export interface RunCandidate {
  id: string
  ref: string
  /** Cheapest origin that still holds this order's date. The shop chose it. */
  origin: FilmOrigin
  /** Latest date the film may be ORDERED and the promise still hold, ISO. */
  orderByOn: string
  /** The date promised to the customer, ISO. Shown, never computed here. */
  dueOn: string
  urgency: string
  /** Garments, for the capacity readout. */
  garments: number
  /**
   * True when NO origin holds the date any more. The order still has to be
   * printed, so it is scheduled at the fastest origin and flagged, rather than
   * hidden: a late order that disappears off the queue is a late order nobody
   * chases.
   */
  late: boolean
}

/** One run's worth of candidates, before anything has been nested. */
export interface RunGroup {
  origin: FilmOrigin
  /**
   * The film has to be ordered on or before this date: the EARLIEST deadline in
   * the group. It is also how long the run may be held to collect more orders,
   * which is the only legitimate reason to wait — and the reason it may never
   * be waited past. An urgent order does not wait for a cheap one; a cheap one
   * rides along with an urgent one for nothing.
   */
  orderByOn: string
  /** Earliest promise in the group, so a screen can show what is at stake. */
  dueOn: string
  candidates: RunCandidate[]
  garments: number
  late: number
}

/**
 * Group ready orders into the runs they can share, one per origin.
 *
 * Everything ready for an origin goes into that origin's run TODAY. Splitting
 * one origin into several runs by deadline would be the intuitive shape and it
 * is the wrong one: two runs printed the same week are two supplier orders, two
 * delivery charges and two lots of unused film at the end of the roll, and the
 * only thing the split would buy is that a cheap order is ordered later than it
 * had to be.
 */
export function groupCandidates(candidates: RunCandidate[]): RunGroup[] {
  const byOrigin = new Map<FilmOrigin, RunCandidate[]>()
  for (const c of candidates) {
    const list = byOrigin.get(c.origin)
    if (list) list.push(c)
    else byOrigin.set(c.origin, [c])
  }
  const out: RunGroup[] = []
  // 'es' first, deterministically, and it is also the order a screen wants:
  // the standard run is the big one and the French run is the exception.
  for (const origin of ['es', 'fr'] as FilmOrigin[]) {
    const list = byOrigin.get(origin)
    if (!list || list.length === 0) continue
    const sorted = [...list].sort((a, b) => compareOrderIds(a.id, b.id))
    out.push({
      origin,
      orderByOn: sorted.reduce((a, c) => (c.orderByOn < a ? c.orderByOn : a), sorted[0].orderByOn),
      dueOn: sorted.reduce((a, c) => (c.dueOn < a ? c.dueOn : a), sorted[0].dueOn),
      candidates: sorted,
      garments: sorted.reduce((a, c) => a + c.garments, 0),
      late: sorted.filter((c) => c.late).length,
    })
  }
  return out
}

/**
 * Why this candidate may not join this group, in French, or an empty string.
 *
 * The one refusal that matters is moving work to the SLOW origin. An operator
 * who decides to buy everything in France today is making every deadline safer
 * and is never stopped; one who drags an order into the Spanish run is deciding
 * on the customer's behalf that five extra days are acceptable, and this is
 * where that is refused. The date it is refused against is the shop's, not one
 * computed here.
 */
export function joinRefusal(group: RunGroup, candidate: RunCandidate): string {
  if (candidate.origin === group.origin) return ''
  if (group.origin === 'fr') return ''
  return (
    `La commande ${candidate.ref} ne tient pas le délai en achetant le film en Espagne : ` +
    `il faut le commander avant le ${frDate(candidate.orderByOn)} et cette origine ne le permet pas.`
  )
}

/** ISO date as a French one. Display only; nothing downstream parses it back. */
export function frDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}
