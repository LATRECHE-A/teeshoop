/**
 * How much film an order needs, answered by the packer that will print it.
 *
 * WHY THIS ROUTE EXISTS AT ALL. The Bible's chapter 1 is explicit that the DTF
 * cost "ne doit pas être saisi « par logo » sans calcul. Il dépend de la surface
 * occupée sur une laize de 56 cm, de l'imbrication, des marges techniques".
 * That is a two-dimensional packing, and this repository already contains one:
 * `src/lib/dtf/nesting.ts`, a deterministic shelf packer that the workshop's
 * gang sheets and cutting plans are produced from.
 *
 * The shop is PHP. Porting the packer would give this project two
 * implementations of the one number a supplier invoices us on, and they would
 * diverge on a shelf boundary or a rounding step, and the day they did the
 * quote would say one length and the film order another. So the shop asks the
 * packer instead, over HTTP, and there is still exactly one packer.
 *
 * WHY IT COULD NOT BE DONE IN THE BROWSER EITHER. Nesting is a property of the
 * whole ORDER: eight lines of six sizes share one roll, and the browser that
 * drew line three knows nothing about the other seven. The per-transfer
 * rectangles are measured in the browser (they have to be: an ink extent comes
 * from a decoded image's alpha, and neither this runtime nor PHP has a canvas)
 * and stored with the design; the packing of them happens here, once, over all
 * of them.
 *
 * ADMIN-ONLY, on purpose and for two reasons. The answer is film economics,
 * which `scripts/bundle-guard.mjs` and `scripts/php-guard.mjs` exist to keep off
 * every customer surface. And a packer is a CPU-bound endpoint: open, it would
 * be a free compute service. The gate is the same `requireAdmin` as `/api/fr/*`
 * and it fails closed with `ADMIN_TOKEN` unset.
 *
 * IT COMPUTES AND STORES NOTHING. No R2, no cache, no side effect: pieces in,
 * length out, deterministic. The shop stores the answer on the order with its
 * inputs, so a margin report is stable and re-askable rather than recomputed
 * differently every time somebody opens a page.
 */
import { requireAdmin, type AdminEnv } from './auth'
import { nestRoll, type DtfPiece } from '../src/lib/dtf/nesting'

/**
 * Bounds. Every one of them is a real limit on a real order, chosen so a
 * legitimate job passes and a hostile body cannot buy an unbounded packing:
 * `nestRoll` materialises one instance per copy, so the instance cap is the one
 * that actually bounds the work.
 */
const MAX_PIECES = 512
const MAX_INSTANCES = 20_000
const MAX_PIECE_CM = 200
const MAX_WIDTH_CM = 300
const MAX_BODY_BYTES = 256 * 1024

/** The roll this shop is quoted on. Overridable per request; never absent. */
const DEFAULT_WIDTH_CM = 56
const DEFAULT_GAP_CM = 0.5
/*
 * The shop always sends its own (Nest.php), so this is only what an omitted
 * field falls back to. 100 cm is the smallest print-file length any surveyed
 * roll supplier publishes, which is the prudent one: too small only ever adds
 * per-sheet billing roundings, and too large lets an order be billed as one
 * long file the supplier will actually cut into a dozen.
 */
const DEFAULT_MAX_LENGTH_CM = 100

interface NestRequestPiece {
  id: string
  w_cm: number
  h_cm: number
  qty: number
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback

/**
 * The same, for a value ZERO is a legitimate answer to.
 *
 * The gap between two transfers is one: a supplier that quotes a printable
 * width has already taken its own margin, and the shop's screen lets an
 * operator type 0. Read through `num`, that 0 was silently replaced by the
 * house 0,5 cm here while `Cost::prudent_length_cm` on the other side used the
 * 0 it was given, so the two ends costed the same order differently on a
 * setting the shop offers.
 */
const nonNeg = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback

/**
 * Read the pieces, or say which rule the body broke.
 *
 * It returns a REASON rather than an empty list, because the shop has to be able
 * to tell "this order needs no film" from "we could not read your request", and
 * treating the second as the first is how a costed order silently loses its
 * biggest expense.
 */
function readPieces(raw: unknown): { pieces: DtfPiece[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: 'pieces must be an array' }
  if (raw.length === 0) return { error: 'no pieces' }
  if (raw.length > MAX_PIECES) return { error: 'too many pieces' }

  const pieces: DtfPiece[] = []
  let instances = 0

  for (const p of raw) {
    if (!p || typeof p !== 'object') return { error: 'a piece is not an object' }
    const piece = p as Partial<NestRequestPiece>
    const id = typeof piece.id === 'string' && piece.id.length > 0 && piece.id.length <= 64 ? piece.id : ''
    if (!id) return { error: 'a piece has no usable id' }

    const w = typeof piece.w_cm === 'number' ? piece.w_cm : NaN
    const h = typeof piece.h_cm === 'number' ? piece.h_cm : NaN
    const qty = typeof piece.qty === 'number' ? Math.floor(piece.qty) : NaN
    if (!Number.isFinite(w) || !Number.isFinite(h) || !Number.isFinite(qty)) {
      return { error: `piece ${id} has a value that is not a number` }
    }
    if (w <= 0 || h <= 0 || w > MAX_PIECE_CM || h > MAX_PIECE_CM) {
      return { error: `piece ${id} is not a plausible transfer` }
    }
    if (qty <= 0) return { error: `piece ${id} has no quantity` }

    instances += qty
    if (instances > MAX_INSTANCES) return { error: 'too many transfers in one order' }

    pieces.push({
      id,
      // Nothing here renders pixels, so the source key is only an identity. It
      // is the id, so a placement can still be traced back to its transfer.
      sourceKey: id,
      wCm: w,
      hCm: h,
      qty,
      /*
       * ROTATION IS ALLOWED, and it is what the workshop actually does: the
       * gang sheet is cut into strips, so an upright transfer lying on its side
       * on the film prints the same garment. Forbidding it here would overstate
       * every order's film, which overstates the floor price, which loses
       * quotes the shop could have taken.
       */
      allowRotate: true,
    })
  }

  return { pieces }
}

/**
 * `POST /api/nest`: pack a set of transfers onto the roll and report the
 * length the supplier will bill.
 */
export async function nestOrder(request: Request, env: AdminEnv): Promise<Response> {
  const denied = await requireAdmin(request, env)
  if (denied) return denied

  const length = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    return json({ error: 'too_large' }, 413)
  }

  let body: unknown
  try {
    const text = await request.text()
    if (text.length > MAX_BODY_BYTES) return json({ error: 'too_large' }, 413)
    body = JSON.parse(text)
  } catch {
    return json({ error: 'bad_json' }, 400)
  }
  if (!body || typeof body !== 'object') return json({ error: 'bad_json' }, 400)

  const req = body as Record<string, unknown>
  const read = readPieces(req.pieces)
  if ('error' in read) return json({ error: 'bad_pieces', message: read.error }, 422)

  const widthCm = Math.min(MAX_WIDTH_CM, num(req.width_cm, DEFAULT_WIDTH_CM))
  const options = {
    printableWidthCm: widthCm,
    gapCm: nonNeg(req.gap_cm, DEFAULT_GAP_CM),
    maxLengthCm: num(req.max_length_cm, DEFAULT_MAX_LENGTH_CM),
    // The roll's two short edges are a scissor cut rather than a printer edge,
    // and the long edges are the laize the tariff is quoted on, so the quoted
    // width IS the printable width. See nesting.ts on why these are two numbers.
    edgeMarginCm: 0,
    billingStepCm: num(req.billing_step_cm, 10),
  }

  const result = nestRoll(read.pieces, options)

  return json({
    billed_m: result.totalLengthM,
    billed_cm: result.totalLengthCm,
    sheets: result.sheets.length,
    total_pieces: result.totalPieces,
    /*
     * Reported, never swallowed. A piece the packer cannot place is a transfer
     * the workshop cannot print, and an order costed as though it were not there
     * is costed too low. The shop refuses to state a film cost when this is not
     * empty.
     */
    unplaceable: result.unplaceable,
    utilization: result.totalUtilization,
    width_cm: widthCm,
    gap_cm: options.gapCm,
    billing_step_cm: options.billingStepCm,
  })
}
