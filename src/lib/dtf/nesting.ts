/**
 * DTF gang-sheet strip packer — pure, DOM-free, 100 % deterministic.
 *
 * Shelf/FFDH variant specialised for transfer rolls: fixed printable width,
 * minimise total length. Every shelf boundary is a full-width straight
 * corridor by construction (pieces are top-aligned inside their shelf and can
 * never be taller than it), so a finished gang sheet is scissor-cuttable into
 * straight strips, then into pieces with straight vertical cuts.
 *
 * Two billing models share that one packer (see `nest`):
 *  - `roll`  — one open-ended sheet split at the supplier's max file length,
 *              billed per linear metre (`nestRoll`, unchanged);
 *  - `fixed` — pieces binned into catalogue sheet formats, billed per sheet
 *              (`nestFixed`, which drives the same shelf packer once per
 *              candidate format).
 *
 * Geometry model
 * - All values in **cm** (DTF suppliers quote cm/linear metres; the studio's
 *   inch-based design geometry is converted at the pieces.ts bridge).
 * - The requested `gapCm` is implemented as a half-gap inflation on all four
 *   sides of every piece, so artwork-to-artwork spacing is exactly `gapCm`
 *   and artwork keeps `edgeMarginCm` (+0) from the roll edges.
 * - `lengthCm` per sheet is rounded UP to 10 cm (0.1 lm) billing steps, capped
 *   at `maxLengthCm`; `rawLengthCm` keeps the exact artwork extent incl.
 *   margins. On a fixed format `lengthCm` is the FORMAT height (the whole
 *   sheet is paid for) while `rawLengthCm` still reports the used extent.
 */
// Type-only import: erased at build time, so there is no runtime module cycle
// with suppliers.ts (which type-imports DtfSheet back).
import type { BillingModel, DtfProcess, SheetFormat } from './suppliers'

export interface DtfPiece {
  id: string
  /** Artwork identity — placements copy it so renderers can find the pixels. */
  sourceKey: string
  wCm: number
  hCm: number
  qty: number
  allowRotate: boolean
  // --- optional prepress metadata (nesting ignores it; preflight.ts reads it)
  /** Source raster size in px, when the piece came from a rendered canvas. */
  srcPxW?: number
  srcPxH?: number
  /** False only when the artwork is known to be opaque (flattened background). */
  hasAlpha?: boolean
  /** Thinnest coloured stroke in the artwork, mm at final size, when known. */
  minLineMm?: number
  /** Thinnest white-only element, mm at final size, when known. */
  whiteMinLineMm?: number
  /** Smallest text size, pt at final size, when known. */
  minTextPt?: number
}

export interface NestOptions {
  printableWidthCm: number
  maxLengthCm: number
  gapCm: number
  edgeMarginCm: number
}

export interface DtfPlacement {
  /** `<piece.id>#<n>` — nth copy (0-based) of the input piece. */
  id: string
  sourceKey: string
  /** Artwork top-left, cm from the sheet's top-left corner. */
  xCm: number
  yCm: number
  /** Artwork footprint as placed (swapped w↔h when `rotated`). */
  wCm: number
  hCm: number
  /** True when placed 90° to the INPUT orientation (wCm/hCm as given). */
  rotated: boolean
}

export interface DtfSheet {
  /** 1-based position in `NestResult.sheets`. */
  index: number
  /** Printable width of THIS sheet (roll width, or the format's width). */
  widthCm: number
  /** Catalogue format this sheet is billed as; null on roll billing. */
  formatId: string | null
  placements: DtfPlacement[]
  /** Top edge (cm) of each shelf's artwork row. */
  shelfYsCm: number[]
  /** Artwork height (cm) of each shelf — parallel to `shelfYsCm`. */
  shelfHsCm: number[]
  /** Exact extent: last artwork bottom + edge margin. */
  rawLengthCm: number
  /** Billed length: `rawLengthCm` rounded UP to 10 cm steps, ≤ `maxLengthCm`. */
  lengthCm: number
  /** Σ placed artwork area ÷ (printableWidth × billed length). */
  utilization: number
}

export interface NestResult {
  sheets: DtfSheet[]
  /** Which packer produced this result. */
  billing: BillingModel
  options: NestOptions
  /** Placements across all sheets (= Σ qty of placeable pieces). */
  totalPieces: number
  /** Σ billed sheet lengths. */
  totalLengthCm: number
  totalLengthM: number
  /** Σ areas ÷ (width × Σ billed lengths); 0 when nothing placed. */
  totalUtilization: number
  /** Input piece ids whose geometry can never fit (even alone, both ways). */
  unplaceable: string[]
}

const EPS = 1e-6
/** Accept a shorter piece into a taller shelf only above this height ratio. */
const SHELF_FILL_RATIO = 0.75
/** Billing step: 0.1 linear metre. */
const BILLING_STEP_CM = 10

const r4 = (v: number) => Math.round(v * 10000) / 10000

interface Instance {
  baseId: string
  copy: number
  sourceKey: string
  /** Working orientation (pre-oriented to landscape when rotatable). */
  w: number
  h: number
  /** Working orientation is 90° to the input orientation. */
  rotated: boolean
  allowRotate: boolean
}

interface Shelf {
  /** Inflated-space y of the shelf top within the sheet. */
  yInfl: number
  /** Inflated shelf height (tallest member's h + gap). */
  hInfl: number
  /** Inflated width consumed so far. */
  usedW: number
}

interface OpenSheet {
  shelves: Shelf[]
  placements: DtfPlacement[]
  totalInflH: number
}

/** Deterministic total order: taller first, wider first, then id, then copy. */
function compareInstances(a: Instance, b: Instance): number {
  if (a.h !== b.h) return b.h - a.h
  if (a.w !== b.w) return b.w - a.w
  if (a.baseId !== b.baseId) return a.baseId < b.baseId ? -1 : 1
  return a.copy - b.copy
}

function rawLengthOf(totalInflH: number, gap: number, margin: number): number {
  // Σ inflated shelf heights carries gap/2 above the first row and gap/2
  // below the last — both replaced by the edge margin.
  return totalInflH - gap + 2 * margin
}

/**
 * Nest pieces onto ROLL gang sheets. Pure function of its inputs — zero
 * randomness, zero Date/Math.random — identical inputs give identical output
 * (including input order: instances are re-sorted with a total order).
 */
export function nestRoll(pieces: DtfPiece[], options: NestOptions): NestResult {
  const gap = Math.max(0, options.gapCm)
  const margin = Math.max(0, options.edgeMarginCm)
  const width = Math.max(0, options.printableWidthCm)
  const maxLen = Math.max(0, options.maxLengthCm)
  /** Usable width in inflated space (margins swallow the outer half-gaps). */
  const usableW = width - 2 * margin + gap

  const unplaceable: string[] = []
  const instances: Instance[] = []

  for (const p of pieces) {
    const qty = Math.floor(p.qty)
    if (!Number.isFinite(p.wCm) || !Number.isFinite(p.hCm) || p.wCm <= 0 || p.hCm <= 0) {
      if (qty > 0) unplaceable.push(p.id)
      continue
    }
    if (qty <= 0) continue
    // Pre-orient rotatable pieces to landscape (shorter shelves, longer runs).
    const landscape = p.allowRotate && p.hCm > p.wCm
    const w = landscape ? p.hCm : p.wCm
    const h = landscape ? p.wCm : p.hCm
    // Reject geometry that cannot fit even alone in its best orientation.
    const fitsAsIs =
      w + gap <= usableW + EPS && rawLengthOf(h + gap, gap, margin) <= maxLen + EPS
    const fitsFlipped =
      p.allowRotate &&
      h + gap <= usableW + EPS &&
      rawLengthOf(w + gap, gap, margin) <= maxLen + EPS
    if (!fitsAsIs && !fitsFlipped) {
      unplaceable.push(p.id)
      continue
    }
    for (let i = 0; i < qty; i++) {
      instances.push({
        baseId: p.id,
        copy: i,
        sourceKey: p.sourceKey,
        w,
        h,
        rotated: landscape,
        allowRotate: p.allowRotate,
      })
    }
  }

  instances.sort(compareInstances)

  const sheets: OpenSheet[] = []
  let cur: OpenSheet | null = null

  const place = (
    sheet: OpenSheet,
    shelf: Shelf,
    inst: Instance,
    flipped: boolean,
  ): void => {
    const w = flipped ? inst.h : inst.w
    const h = flipped ? inst.w : inst.h
    sheet.placements.push({
      id: `${inst.baseId}#${inst.copy}`,
      sourceKey: inst.sourceKey,
      xCm: r4(margin + shelf.usedW),
      yCm: r4(margin + shelf.yInfl), // top-aligned → straight under-corridor
      wCm: r4(w),
      hCm: r4(h),
      rotated: flipped ? !inst.rotated : inst.rotated,
    })
    shelf.usedW += w + gap
  }

  for (let idx = 0; idx < instances.length; idx++) {
    const inst = instances[idx]

    // Candidate orientations: working one first, flipped when allowed and
    // not square (a flipped square is the same rectangle).
    const orientations: { flipped: boolean; w: number; h: number }[] = [
      { flipped: false, w: inst.w, h: inst.h },
    ]
    if (inst.allowRotate && Math.abs(inst.w - inst.h) > EPS)
      orientations.push({ flipped: true, w: inst.h, h: inst.w })

    // --- best-fit into the open shelves of the current sheet -------------
    let best: { shelf: Shelf; flipped: boolean; waste: number } | null = null
    if (cur) {
      for (const shelf of cur.shelves) {
        for (const o of orientations) {
          const inflW = o.w + gap
          const inflH = o.h + gap
          if (inflW > usableW - shelf.usedW + EPS) continue
          if (inflH > shelf.hInfl + EPS) continue
          // Fill-ratio rule in ARTWORK space: pieceH ≥ 0.75 × shelfH.
          if (o.h < SHELF_FILL_RATIO * (shelf.hInfl - gap) - EPS) continue
          const waste = shelf.hInfl - inflH
          if (!best || waste < best.waste - EPS) best = { shelf, flipped: o.flipped, waste }
        }
      }
    }
    if (best && cur) {
      place(cur, best.shelf, inst, best.flipped)
      continue
    }

    // --- open a new shelf -------------------------------------------------
    // Run-aware orientation: for the run of identical upcoming instances,
    // pick the orientation minimising the strip length the run will occupy
    // (rows × shelf height). This is what packs e.g. A4 two-abreast portrait
    // instead of one-per-shelf landscape.
    let run = 1
    while (
      idx + run < instances.length &&
      instances[idx + run].baseId === inst.baseId &&
      instances[idx + run].w === inst.w &&
      instances[idx + run].h === inst.h
    )
      run++

    let chosen: { flipped: boolean; w: number; h: number } | null = null
    let chosenScore = Infinity
    for (const o of orientations) {
      const inflW = o.w + gap
      const inflH = o.h + gap
      if (inflW > usableW + EPS) continue
      if (rawLengthOf(inflH, gap, margin) > maxLen + EPS) continue
      const perRow = Math.max(1, Math.floor((usableW + EPS) / inflW))
      const score = Math.ceil(run / perRow) * inflH
      if (
        score < chosenScore - EPS ||
        (Math.abs(score - chosenScore) <= EPS && chosen !== null && inflH < chosen.h + gap - EPS)
      ) {
        chosen = o
        chosenScore = score
      }
    }
    if (!chosen) {
      // Guarded at expansion time; only reachable via degenerate options.
      if (!unplaceable.includes(inst.baseId)) unplaceable.push(inst.baseId)
      continue
    }

    const inflH = chosen.h + gap
    // Close the sheet when the new shelf would exceed the billing max length.
    if (
      !cur ||
      rawLengthOf(cur.totalInflH + inflH, gap, margin) > maxLen + EPS
    ) {
      cur = { shelves: [], placements: [], totalInflH: 0 }
      sheets.push(cur)
    }
    const shelf: Shelf = { yInfl: cur.totalInflH, hInfl: inflH, usedW: 0 }
    cur.shelves.push(shelf)
    cur.totalInflH += inflH
    place(cur, shelf, inst, chosen.flipped)
  }

  // --- finalise ------------------------------------------------------------
  const outSheets: DtfSheet[] = []
  let sumBilled = 0
  let sumArea = 0
  for (const s of sheets) {
    if (s.shelves.length === 0) continue
    const raw = rawLengthOf(s.totalInflH, gap, margin)
    // Round up to the billing step, but never past the supplier's max file
    // length (raw ≤ maxLen by construction, so the artwork always fits).
    const billed = Math.min(
      maxLen,
      Math.max(BILLING_STEP_CM, Math.ceil((raw - EPS) / BILLING_STEP_CM) * BILLING_STEP_CM),
    )
    const area = s.placements.reduce((a, p) => a + p.wCm * p.hCm, 0)
    sumBilled += billed
    sumArea += area
    outSheets.push({
      index: outSheets.length + 1,
      widthCm: r4(width),
      formatId: null,
      placements: s.placements,
      shelfYsCm: s.shelves.map((sh) => r4(margin + sh.yInfl)),
      shelfHsCm: s.shelves.map((sh) => r4(sh.hInfl - gap)),
      rawLengthCm: r4(raw),
      lengthCm: r4(billed),
      utilization: width * billed > 0 ? r4(area / (width * billed)) : 0,
    })
  }

  return {
    sheets: outSheets,
    billing: 'roll',
    options: { printableWidthCm: width, maxLengthCm: maxLen, gapCm: gap, edgeMarginCm: margin },
    totalPieces: outSheets.reduce((a, s) => a + s.placements.length, 0),
    totalLengthCm: r4(sumBilled),
    totalLengthM: r4(sumBilled / 100),
    totalUtilization: width * sumBilled > 0 ? r4(sumArea / (width * sumBilled)) : 0,
    unplaceable,
  }
}

// ---------------------------------------------------------------------------
// Fixed-format packer
// ---------------------------------------------------------------------------

/**
 * Bin pieces into a supplier's catalogue sheet formats (OhMyDTF-style: you buy
 * a whole A4/A3/1 m sheet, not a metré).
 *
 * STRATEGY — greedy, one sheet at a time, deterministic and explainable:
 *   1. for every candidate format, run the SAME shelf packer on everything
 *      that is still unplaced, with the format as the sheet (width = wCm,
 *      max length = hCm) and keep only its first sheet;
 *   2. score each candidate by € per piece actually placed on that one sheet
 *      (`format.priceEur / placed`), tie-broken by cheaper sheet, then more
 *      pieces, then smaller area, then id;
 *   3. emit the winner, remove the pieces it consumed, repeat until nothing
 *      can be placed any more.
 *
 * LIMITS (accepted on purpose): no global optimisation and no backtracking, so
 * the LAST sheet is often half empty and a mix that two A3 would cover can end
 * up on one 1 m sheet (or vice-versa) when the per-piece scores are close.
 * Rotation still obeys `allowRotate`; a piece that fits no format at all comes
 * back in `unplaceable` rather than being silently dropped. NOTE: the edge
 * margin applies to every format, so a 1 cm margin leaves only 8 × 8 cm usable
 * on a 10 × 10 cm sheet — small formats need a smaller margin to be reachable.
 */
function nestFixed(
  pieces: DtfPiece[],
  formats: SheetFormat[],
  options: NestOptions,
): NestResult {
  const gap = Math.max(0, options.gapCm)
  const margin = Math.max(0, options.edgeMarginCm)
  const cands = formats.filter(
    (f) => Number.isFinite(f.wCm) && Number.isFinite(f.hCm) && f.wCm > 0 && f.hCm > 0,
  )

  interface Spec {
    piece: DtfPiece
    /** Copies still to place. */
    left: number
    /** Next global copy index, so placement ids stay unique across sheets. */
    next: number
  }
  const specs: Spec[] = []
  const unplaceable: string[] = []
  for (const p of pieces) {
    const qty = Math.floor(p.qty)
    if (qty <= 0) continue
    if (!Number.isFinite(p.wCm) || !Number.isFinite(p.hCm) || p.wCm <= 0 || p.hCm <= 0) {
      unplaceable.push(p.id)
      continue
    }
    specs.push({ piece: p, left: qty, next: 0 })
  }

  const outSheets: DtfSheet[] = []
  let sumBilled = 0
  let sumArea = 0
  let sumCapacity = 0
  // Each accepted sheet consumes ≥ 1 copy, so the total qty bounds the loop.
  const guard = specs.reduce((a, s) => a + s.left, 0)

  for (let iter = 0; iter < guard && cands.length > 0; iter++) {
    // Synthetic ids (`f<specIndex>`) keep the mapping back to specs exact —
    // user piece ids may contain any character, including '#'.
    const remaining: DtfPiece[] = []
    for (let i = 0; i < specs.length; i++) {
      if (specs[i].left <= 0) continue
      remaining.push({ ...specs[i].piece, id: `f${i}`, qty: specs[i].left })
    }
    if (remaining.length === 0) break

    let best: { fmt: SheetFormat; sheet: DtfSheet; score: number } | null = null
    for (const f of cands) {
      const one = nestRoll(remaining, {
        printableWidthCm: f.wCm,
        maxLengthCm: f.hCm,
        gapCm: gap,
        edgeMarginCm: margin,
      }).sheets[0]
      if (!one || one.placements.length === 0) continue
      const score = f.priceEur / one.placements.length
      if (
        !best ||
        score < best.score - EPS ||
        (Math.abs(score - best.score) <= EPS &&
          (f.priceEur < best.fmt.priceEur - EPS ||
            (Math.abs(f.priceEur - best.fmt.priceEur) <= EPS &&
              (one.placements.length > best.sheet.placements.length ||
                (one.placements.length === best.sheet.placements.length &&
                  f.wCm * f.hCm < best.fmt.wCm * best.fmt.hCm - EPS)))))
      )
        best = { fmt: f, sheet: one, score }
    }
    if (!best) break

    // Consume + renumber into stable, unique placement ids.
    const placements: DtfPlacement[] = best.sheet.placements.map((p) => {
      const i = Number(p.id.slice(1, p.id.lastIndexOf('#')))
      const spec = specs[i]
      spec.left--
      return { ...p, id: `${spec.piece.id}#${spec.next++}`, sourceKey: spec.piece.sourceKey }
    })
    const area = placements.reduce((a, p) => a + p.wCm * p.hCm, 0)
    const capacity = best.fmt.wCm * best.fmt.hCm
    sumBilled += best.fmt.hCm
    sumArea += area
    sumCapacity += capacity
    outSheets.push({
      index: outSheets.length + 1,
      widthCm: r4(best.fmt.wCm),
      formatId: best.fmt.id,
      placements,
      shelfYsCm: best.sheet.shelfYsCm,
      shelfHsCm: best.sheet.shelfHsCm,
      rawLengthCm: best.sheet.rawLengthCm,
      // The whole format is paid for and physically delivered.
      lengthCm: r4(best.fmt.hCm),
      utilization: capacity > 0 ? r4(area / capacity) : 0,
    })
  }

  for (const s of specs)
    if (s.left > 0 && !unplaceable.includes(s.piece.id)) unplaceable.push(s.piece.id)

  const widest = cands.reduce((a, f) => Math.max(a, f.wCm), 0)
  const longest = cands.reduce((a, f) => Math.max(a, f.hCm), 0)
  return {
    sheets: outSheets,
    billing: 'fixed',
    options: {
      printableWidthCm: r4(widest || options.printableWidthCm),
      maxLengthCm: r4(longest || options.maxLengthCm),
      gapCm: gap,
      edgeMarginCm: margin,
    },
    totalPieces: outSheets.reduce((a, s) => a + s.placements.length, 0),
    totalLengthCm: r4(sumBilled),
    totalLengthM: r4(sumBilled / 100),
    totalUtilization: sumCapacity > 0 ? r4(sumArea / sumCapacity) : 0,
    unplaceable,
  }
}

/**
 * Nest against a supplier PROCESS, dispatching on its billing model.
 *
 * The process owns the geometry (printable width, max length) and `opts`
 * supplies the operator's spacing (`gapCm`, `edgeMarginCm`); the effective
 * values are echoed back in `result.options`.
 *
 * The legacy 2-arg form `nest(pieces, options)` is the raw roll packer and is
 * kept for the verification harness and older callers.
 */
export function nest(pieces: DtfPiece[], options: NestOptions): NestResult
export function nest(pieces: DtfPiece[], proc: DtfProcess, opts: NestOptions): NestResult
export function nest(
  pieces: DtfPiece[],
  a: NestOptions | DtfProcess,
  b?: NestOptions,
): NestResult {
  if (!b) return nestRoll(pieces, a as NestOptions)
  const proc = a as DtfProcess
  if (proc.billing === 'fixed') return nestFixed(pieces, proc.formats, b)
  return nestRoll(pieces, {
    ...b,
    printableWidthCm: proc.printableWidthCm,
    maxLengthCm: proc.maxLengthCm,
  })
}
