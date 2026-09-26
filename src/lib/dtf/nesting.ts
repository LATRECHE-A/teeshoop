/**
 * DTF gang-sheet strip packer: pure, DOM-free, 100 % deterministic.
 *
 * Shelf/FFDH variant specialised for transfer rolls: fixed printable width,
 * minimise total length. Every shelf boundary is a full-width straight
 * corridor by construction (pieces are top-aligned inside their shelf and can
 * never be taller than it), so a finished gang sheet is scissor-cuttable into
 * straight strips, then into pieces with straight vertical cuts.
 *
 * Two billing models share that one packer (see `nest`):
 *  - `roll`: one open-ended sheet split at the supplier's max file length,
 *            billed per linear metre (`nestRoll`, unchanged);
 *  - `fixed`: pieces binned into catalogue sheet formats, billed per sheet
 *             (`nestFixed`, which drives the same shelf packer once per
 *             candidate format).
 *
 * Geometry model
 * - All values in **cm** (DTF suppliers quote cm/linear metres; the studio's
 *   inch-based design geometry is converted at the pieces.ts bridge).
 * - The requested `gapCm` is implemented as a half-gap inflation on all four
 *   sides of every piece, so artwork-to-artwork spacing is exactly `gapCm`
 *   and artwork keeps the edge margin (+0) from the sheet edges.
 * - The edge margin is TWO numbers because the two constraints are physically
 *   different: `edgeMarginSideCm` is the printer's laize limit (some suppliers
 *   quote a *printable* width, in which case it is legitimately 0), while
 *   `edgeMarginEndCm` guards the two short edges, which on a roll are a scissor
 *   cut rather than a printer edge and are therefore usually 0 as well. A
 *   single `edgeMarginCm` is still accepted and feeds both.
 * - `lengthCm` per sheet is rounded UP to `billingStepCm` (default 10 cm =
 *   0.1 lm) billing steps, capped at `maxLengthCm`; `rawLengthCm` keeps the
 *   exact artwork extent incl. margins. On a fixed format `lengthCm` is the
 *   FORMAT height (the whole sheet is paid for) while `rawLengthCm` still
 *   reports the used extent.
 */
// Type-only, and from the TYPES module rather than from suppliers.ts: erased at
// build time either way, but suppliers.ts touches localStorage and this packer
// is compiled into the Cloudflare Worker (worker/nest.ts), which has no DOM.
import type { BillingModel, DtfProcess, SheetFormat } from './supplierTypes'

export interface DtfPiece {
  id: string
  /** Artwork identity: placements copy it so renderers can find the pixels. */
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
  /**
   * Legacy single edge margin. Kept as the fallback both split margins read
   * when they are absent, so every pre-split caller keeps its exact geometry.
   */
  edgeMarginCm: number
  /** Clear space at the two LONG edges (the printer's laize limit). */
  edgeMarginSideCm?: number
  /** Clear space at the two SHORT edges (a scissor cut, not a printer edge). */
  edgeMarginEndCm?: number
  /** Billing granularity, cm. 10 = 0.1 linear metre, the common default. */
  billingStepCm?: number
}

/** Every geometry number the packers actually use, defaulted and clamped once. */
export interface ResolvedNestOptions {
  widthCm: number
  maxLengthCm: number
  gapCm: number
  sideMarginCm: number
  endMarginCm: number
  billingStepCm: number
}

/** Default billing step: 0.1 linear metre. */
export const BILLING_STEP_CM = 10

/**
 * Fill in the split margins and the billing step. Single source of truth so the
 * shelf packer and the true-shape packer can never disagree about what a
 * `NestOptions` means.
 */
export function resolveNestOptions(o: NestOptions): ResolvedNestOptions {
  const legacy = Math.max(0, o.edgeMarginCm || 0)
  const num = (v: number | undefined, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback
  return {
    widthCm: Math.max(0, o.printableWidthCm),
    maxLengthCm: Math.max(0, o.maxLengthCm),
    gapCm: Math.max(0, o.gapCm),
    sideMarginCm: num(o.edgeMarginSideCm, legacy),
    endMarginCm: num(o.edgeMarginEndCm, legacy),
    billingStepCm: Math.max(0.1, num(o.billingStepCm, BILLING_STEP_CM)),
  }
}

/** Echo the effective geometry back into a result, split fields included. */
export function echoOptions(r: ResolvedNestOptions): NestOptions {
  return {
    printableWidthCm: r4(r.widthCm),
    maxLengthCm: r4(r.maxLengthCm),
    gapCm: r4(r.gapCm),
    // The legacy field keeps reading as "the margin" for old consumers; the
    // side margin is the one that bounds x, which is what they all meant.
    edgeMarginCm: r4(r.sideMarginCm),
    edgeMarginSideCm: r4(r.sideMarginCm),
    edgeMarginEndCm: r4(r.endMarginCm),
    billingStepCm: r4(r.billingStepCm),
  }
}

export interface DtfPlacement {
  /** `<piece.id>#<n>`: nth copy (0-based) of the input piece. */
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
  /**
   * Clockwise rotation applied to the source canvas, degrees. Absent means
   * `rotated ? 90 : 0`, the only two values the shelf packer can produce.
   * The true-shape packer can also emit 180/270 when the artwork declares it
   * has no "up", and renderers must honour this field when it is present.
   */
  rotCw?: 0 | 90 | 180 | 270
}

export interface DtfSheet {
  /** 1-based position in `NestResult.sheets`. */
  index: number
  /** Printable width of THIS sheet (roll width, or the format's width). */
  widthCm: number
  /** Catalogue format this sheet is billed as; null on roll billing. */
  formatId: string | null
  placements: DtfPlacement[]
  /**
   * Top edge (cm) of each shelf's artwork row. EMPTY on a true-shape result:
   * there are no shelves there, and the cutting plan derives its chop lines
   * from the placements instead.
   */
  shelfYsCm: number[]
  /** Artwork height (cm) of each shelf, parallel to `shelfYsCm`. */
  shelfHsCm: number[]
  /** Exact extent: last artwork bottom + edge margin. */
  rawLengthCm: number
  /** Billed length: `rawLengthCm` rounded UP to the billing step, ≤ `maxLengthCm`. */
  lengthCm: number
  /**
   * Σ placed artwork BBOX area ÷ (printableWidth × billed length).
   *
   * May legitimately exceed 1 on a true-shape sheet: interlocked pieces have
   * OVERLAPPING bounding boxes (that is the entire point), so the sum of the
   * boxes can be larger than the film. That is information, not a bug (it
   * says how much the boxes overlap), but `inkUtilization` is the honest
   * "how much of the film is printed" number whenever it is present.
   */
  utilization: number
  /**
   * Σ placed INK area ÷ (printableWidth × billed length). Only the true-shape
   * packer can measure it. This is the honest number: `utilization` counts the
   * transparent corners of every bounding box as if they were printed.
   */
  inkUtilization?: number
}

export interface NestResult {
  sheets: DtfSheet[]
  /** Which billing model produced this result. */
  billing: BillingModel
  /** Which packer produced it. The cutting plan legend states this. */
  packer: 'shelf' | 'trueshape'
  /** How far a piece was allowed to tuck under its neighbours (cm). */
  interlockCm: number
  options: NestOptions
  /** Placements across all sheets (= Σ qty of placeable pieces). */
  totalPieces: number
  /** Σ billed sheet lengths. */
  totalLengthCm: number
  totalLengthM: number
  /** Σ bbox areas ÷ (width × Σ billed lengths); 0 when nothing placed. */
  totalUtilization: number
  /** Σ ink areas ÷ (width × Σ billed lengths); absent on the shelf packer. */
  totalInkUtilization?: number
  /** Input piece ids whose geometry can never fit (even alone, both ways). */
  unplaceable: string[]
}

const EPS = 1e-6
/** Accept a shorter piece into a taller shelf only above this height ratio. */
const SHELF_FILL_RATIO = 0.75

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
  // below the last, both replaced by the edge margin.
  return totalInflH - gap + 2 * margin
}

/**
 * Nest pieces onto ROLL gang sheets. Pure function of its inputs: zero
 * randomness, zero Date/Math.random. Identical inputs give identical output
 * (including input order: instances are re-sorted with a total order).
 */
export function nestRoll(pieces: DtfPiece[], options: NestOptions): NestResult {
  const R = resolveNestOptions(options)
  const gap = R.gapCm
  /** Side margin bounds x; the end margin bounds y. They are not the same. */
  const side = R.sideMarginCm
  const margin = R.endMarginCm
  const width = R.widthCm
  const maxLen = R.maxLengthCm
  const step = R.billingStepCm
  /** Usable width in inflated space (margins swallow the outer half-gaps). */
  const usableW = width - 2 * side + gap

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
      xCm: r4(side + shelf.usedW),
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

    /*
     * SHEETS FIRST, LENGTH SECOND. The score used to be the strip length the run
     * would take on an endless roll, `rows × shelf height`, and on a bounded
     * sheet that is the wrong quantity: 30 transfers of 8 × 24 cm stood up three
     * to a row (194 cm of strip) beat lying down one to a row (208 cm), but a
     * 46 cm sheet takes ONE standing row and FIVE lying ones, so it bought 10
     * sheets where 6 did it (COU-01). The run is now counted in the sheets it
     * opens beyond the room left on the current one.
     *
     * ONLY WHERE SHEETS ARE WHAT IS BILLED, that is where every file costs the
     * full sheet length (`step ≥ maxLen`). On a roll the bill is the length,
     * and ranking by files first made `dtf-verify`'s pooled run longer (120 cm
     * became 150): there every orientation opens « 0 » and the strip length
     * decides, exactly as before.
     */
    const bySheet = step >= maxLen - EPS
    const rowsOn = (room: number, inflH: number): number => Math.max(0, Math.floor((room + gap - 2 * margin + EPS) / inflH))
    let chosen: { flipped: boolean; w: number; h: number } | null = null
    let chosenSheets = Infinity
    let chosenScore = Infinity
    for (const o of orientations) {
      const inflW = o.w + gap
      const inflH = o.h + gap
      if (inflW > usableW + EPS) continue
      if (rawLengthOf(inflH, gap, margin) > maxLen + EPS) continue
      const perRow = Math.max(1, Math.floor((usableW + EPS) / inflW))
      const rows = Math.ceil(run / perRow)
      const left = cur ? rowsOn(maxLen - cur.totalInflH, inflH) : 0
      const perSheet = Math.max(1, rowsOn(maxLen, inflH))
      const sheetsOpened = !bySheet || rows <= left ? 0 : Math.ceil((rows - left) / perSheet)
      const score = rows * inflH
      if (
        sheetsOpened < chosenSheets ||
        (sheetsOpened === chosenSheets &&
          (score < chosenScore - EPS ||
            (Math.abs(score - chosenScore) <= EPS && chosen !== null && inflH < chosen.h + gap - EPS)))
      ) {
        chosen = o
        chosenSheets = sheetsOpened
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
      Math.max(step, Math.ceil((raw - EPS) / step) * step),
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
    packer: 'shelf',
    interlockCm: 0,
    options: echoOptions(R),
    totalPieces: outSheets.reduce((a, s) => a + s.placements.length, 0),
    totalLengthCm: r4(sumBilled),
    totalLengthM: r4(sumBilled / 100),
    totalUtilization: width * sumBilled > 0 ? r4(sumArea / (width * sumBilled)) : 0,
    unplaceable: stableIds(unplaceable),
  }
}

/**
 * De-duplicate and sort a list of piece ids. `unplaceable` reaches the manifest
 * and the README, so gathering it in INPUT order would make two exports of the
 * same order differ purely because the operator reordered the queue, which is
 * exactly the determinism the module claims. Sorting also makes the two packers
 * agree on how they present the same set.
 */
const stableIds = (ids: string[]): string[] => [...new Set(ids)].sort()

// ---------------------------------------------------------------------------
// Fixed-format packer
// ---------------------------------------------------------------------------

/**
 * Bin pieces into a supplier's catalogue sheet formats (OhMyDTF-style: you buy
 * a whole A4/A3/1 m sheet, not a metré).
 *
 * STRATEGY (greedy, one sheet at a time, deterministic and explainable):
 *   1. for every candidate format, run the SAME shelf packer on everything
 *      that is still unplaced, with the format as the sheet (width = wCm,
 *      max length = hCm) and keep only its first sheet;
 *   2. score each candidate by € per piece actually placed on that one sheet
 *      (`format.priceEur / placed`), tie-broken by cheaper sheet, then more
 *      pieces, then smaller area, then id;
 *   3. emit the winner, remove the pieces it consumed, repeat until nothing
 *      can be placed any more.
 *
 * LIMITS (accepted on purpose): no backtracking, so the LAST sheet is often
 * half empty. Rotation still obeys `allowRotate`; a piece that fits no format
 * at all comes back in `unplaceable` rather than being silently dropped. NOTE:
 * the edge margin applies to every format, so a 1 cm margin leaves only 8 × 8
 * cm usable on a 10 × 10 cm sheet. Small formats need a smaller margin to be
 * reachable.
 *
 * The inner packer is a PARAMETER (`packRoll`) so the true-shape packer can
 * reuse this whole format-selection loop unchanged: the only thing that differs
 * between the two is how one candidate sheet gets filled. `packRoll` receives
 * the caller's own piece objects with only `id`/`qty` rewritten, so extra
 * fields it needs (alpha masks, flip permissions) survive the round trip even
 * though `DtfPiece` does not declare them.
 */
export type RollPacker = (pieces: DtfPiece[], options: NestOptions) => NestResult

function greedyFixed(
  pieces: DtfPiece[],
  cands: SheetFormat[],
  options: NestOptions,
  packRoll: RollPacker,
): NestResult {
  const R = resolveNestOptions(options)
  const gap = R.gapCm
  const margin = R.sideMarginCm

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
  let sumInk = 0
  let sumCapacity = 0
  /** Ink utilisation is only meaningful when EVERY sheet reported it. */
  let inkKnown = true
  let innerPacker: 'shelf' | 'trueshape' = 'shelf'
  let innerInterlockCm = 0
  // Each accepted sheet consumes ≥ 1 copy, so the total qty bounds the loop.
  const guard = specs.reduce((a, s) => a + s.left, 0)

  for (let iter = 0; iter < guard && cands.length > 0; iter++) {
    // Synthetic ids (`f<specIndex>`) keep the mapping back to specs exact.
    // User piece ids may contain any character, including '#'.
    const remaining: DtfPiece[] = []
    for (let i = 0; i < specs.length; i++) {
      if (specs[i].left <= 0) continue
      remaining.push({ ...specs[i].piece, id: `f${i}`, qty: specs[i].left })
    }
    if (remaining.length === 0) break

    let best: { fmt: SheetFormat; sheet: DtfSheet; score: number } | null = null
    for (const f of cands) {
      const packed = packRoll(remaining, {
        ...options,
        printableWidthCm: f.wCm,
        maxLengthCm: f.hCm,
        gapCm: gap,
        edgeMarginCm: margin,
        edgeMarginSideCm: R.sideMarginCm,
        edgeMarginEndCm: R.endMarginCm,
        billingStepCm: R.billingStepCm,
      })
      innerPacker = packed.packer
      innerInterlockCm = packed.interlockCm
      const one = packed.sheets[0]
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
      ...(best.sheet.inkUtilization !== undefined
        ? {
            inkUtilization:
              capacity > 0
                ? r4(
                    (best.sheet.inkUtilization *
                      best.sheet.widthCm *
                      best.sheet.lengthCm) /
                      capacity,
                  )
                : 0,
          }
        : {}),
    })
    sumInk +=
      best.sheet.inkUtilization !== undefined
        ? best.sheet.inkUtilization * best.sheet.widthCm * best.sheet.lengthCm
        : 0
    inkKnown = inkKnown && best.sheet.inkUtilization !== undefined
  }

  for (const s of specs)
    if (s.left > 0 && !unplaceable.includes(s.piece.id)) unplaceable.push(s.piece.id)

  const widest = cands.reduce((a, f) => Math.max(a, f.wCm), 0)
  const longest = cands.reduce((a, f) => Math.max(a, f.hCm), 0)
  return {
    sheets: outSheets,
    billing: 'fixed',
    packer: innerPacker,
    interlockCm: innerInterlockCm,
    options: echoOptions({
      ...R,
      widthCm: widest || R.widthCm,
      maxLengthCm: longest || R.maxLengthCm,
    }),
    totalPieces: outSheets.reduce((a, s) => a + s.placements.length, 0),
    totalLengthCm: r4(sumBilled),
    totalLengthM: r4(sumBilled / 100),
    totalUtilization: sumCapacity > 0 ? r4(sumArea / sumCapacity) : 0,
    ...(inkKnown && outSheets.length > 0
      ? { totalInkUtilization: sumCapacity > 0 ? r4(sumInk / sumCapacity) : 0 }
      : {}),
    unplaceable: stableIds(unplaceable),
  }
}

/** What a fixed-format solution actually costs: Σ the price of each sheet bought. */
function priceOf(res: NestResult, formats: SheetFormat[]): number {
  let sum = 0
  for (const s of res.sheets) sum += formats.find((f) => f.id === s.formatId)?.priceEur ?? 0
  return sum
}

/**
 * Fixed-format binning, scored on the ONLY number that matters: the total bill.
 *
 * WHY THIS WRAPPER EXISTS. `greedyFixed` buys, each round, the format with the
 * best € per piece placed on that one sheet. That is myopic and it costs real
 * money: measured on a real order of 19 small back prints (≈ 4 × 4 cm) and 19
 * chest prints (≈ 21 × 23 cm) at OhMyDTF, the greedy buys five 10 × 10 "cœur"
 * sheets at €0,63/pièce for the small ones and then still has to buy a 2 m
 * sheet for the big ones: €44,50, when the 2 m sheet alone holds the entire
 * order for €32. Cheapest-per-piece is not cheapest.
 *
 * The fix is not a search, it is a handful of RESTRICTED CATALOGUES, each one a
 * decision a human would make out loud, all run through the same greedy and
 * scored on the bill:
 *   - the whole catalogue (always a candidate, so this can never be worse than
 *     the plain greedy);
 *   - each format ON ITS OWN, the "just buy the 2 m sheet" answer above;
 *   - "nothing smaller than F", for each F: the "stop buying cœur sheets"
 *     answer. It is a distinct family, not a rounding of the previous one: the
 *     greedy above ends up buying THREE 1 m sheets (€51) where one 2 m plus one
 *     1 m holds the same order for €49, and only a plan that still has both big
 *     formats available but no small ones finds that. The doc's own rule,
 *     "never route gang sheets through A4/A3/cœur, 2–11× the €/m² of a metre",
 *     is exactly this lever.
 * Cost is ≤ 2F+1 passes with F ≈ 6, and duplicated catalogues are dropped.
 *
 * Ranking is lexicographic and total (fewer pieces left behind, then cheaper,
 * then fewer sheets, then the format sequence as a string), so two runs on the
 * same input always buy the same thing.
 */
export function nestFixedWith(
  pieces: DtfPiece[],
  formats: SheetFormat[],
  options: NestOptions,
  packRoll: RollPacker,
): NestResult {
  const cands = formats.filter(
    (f) => Number.isFinite(f.wCm) && Number.isFinite(f.hCm) && f.wCm > 0 && f.hCm > 0,
  )
  const plans: SheetFormat[][] = [cands]
  // A restricted plan only ever helps when there is a mix to be blind about.
  if (cands.length > 1) {
    const seen = new Set([cands.map((f) => f.id).join(',')])
    const add = (plan: SheetFormat[]) => {
      const key = plan.map((f) => f.id).join(',')
      if (plan.length > 0 && !seen.has(key)) {
        seen.add(key)
        plans.push(plan)
      }
    }
    for (const f of cands) add([f])
    for (const f of cands) add(cands.filter((x) => x.wCm * x.hCm >= f.wCm * f.hCm - EPS))
  }

  let best: NestResult | null = null
  let bestKey: [number, number, number, string] | null = null
  for (const plan of plans) {
    const r = greedyFixed(pieces, plan, options, packRoll)
    const key: [number, number, number, string] = [
      r.unplaceable.length,
      r4(priceOf(r, cands)),
      r.sheets.length,
      r.sheets.map((s) => s.formatId ?? '').join(','),
    ]
    if (
      bestKey === null ||
      key[0] < bestKey[0] ||
      (key[0] === bestKey[0] &&
        (key[1] < bestKey[1] - EPS ||
          (Math.abs(key[1] - bestKey[1]) <= EPS &&
            (key[2] < bestKey[2] || (key[2] === bestKey[2] && key[3] < bestKey[3])))))
    ) {
      best = r
      bestKey = key
    }
  }
  return best ?? greedyFixed(pieces, cands, options, packRoll)
}

/** Fixed-format binning with the classic shelf packer. */
const nestFixed = (
  pieces: DtfPiece[],
  formats: SheetFormat[],
  options: NestOptions,
): NestResult => nestFixedWith(pieces, formats, options, nestRoll)

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
  return nestWith(pieces, a as DtfProcess, b, nestRoll)
}

/**
 * `nest`, with the roll packer as a parameter: the seam the true-shape packer
 * plugs into so BOTH billing models get the better nesting without duplicating
 * the process-geometry override or the fixed-format selection loop.
 */
export function nestWith(
  pieces: DtfPiece[],
  proc: DtfProcess,
  opts: NestOptions,
  packRoll: RollPacker,
): NestResult {
  const geometry: NestOptions = {
    ...opts,
    printableWidthCm: proc.printableWidthCm,
    maxLengthCm: proc.maxLengthCm,
    billingStepCm: opts.billingStepCm ?? proc.billingStepCm ?? BILLING_STEP_CM,
  }
  if (proc.billing === 'fixed') return nestFixedWith(pieces, proc.formats, geometry, packRoll)
  return packRoll(pieces, geometry)
}
