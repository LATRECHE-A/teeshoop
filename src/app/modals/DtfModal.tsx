/**
 * DTF gang-sheet automation — admin modal.
 *
 * Queue printed sides — from the ORDER BASKET (design × side × qty, the real
 * order) or manually (current design + saved designs) — pick a supplier AND a
 * process (DTF textile / UV-DTF), auto-nest onto that process's geometry
 * (open-ended roll billed per linear metre, or catalogue sheet formats billed
 * per sheet), preflight the artwork against the process guidelines, preview the
 * result live, then download the WHOLE order as one .zip.
 *
 * TWO NESTERS, ONE PREVIEW. The shelf packer (nesting.ts) runs synchronously
 * so the preview is never empty, then the true-shape packer (trueshape.ts) runs
 * in a Worker and replaces it. Because the true-shape packer keeps the shelf
 * result as its own restart #0, the displayed layout can only ever get better —
 * never worse than what the operator saw a moment ago.
 *
 * ONE DOWNLOAD. Browsers throttle and silently drop bursts of programmatic
 * downloads, so a 12-sheet order used to arrive incomplete. The export is now a
 * single named archive; see lib/dtf/zipExport.ts.
 *
 * Everything the automation depends on is editable here and persisted: process
 * geometry, price tiers, sheet formats and every prepress rule. cm is
 * first-class everywhere; all figures in JetBrains Mono.
 */
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  Download,
  FileArchive,
  Loader2,
  Plus,
  RefreshCcw,
  Save,
  ShoppingBag,
  Trash2,
} from 'lucide-react'
import clsx from 'clsx'
import Modal from './Modal'
import { APP_VERSION } from '@/config'
import { useStore } from '@/state/store'
import { listSavedMetas, loadSavedDesign } from '@/state/savedDesigns'
import { linePrintedSides, type BasketLine } from '@/state/basket'
import { downloadBlob } from '@/lib/download'
import {
  nest,
  type DtfPiece,
  type DtfSheet,
  type NestOptions,
  type NestResult,
} from '@/lib/dtf/nesting'
import {
  MERGE_WHOLE_SIDE_IN,
  PIECE_CLEARANCE_IN,
  pieceMask,
  piecePartKey,
  piecePlacementCm,
  pieceSourceKey,
  printedSides,
  renderPieces,
  type PieceMask,
  type RenderedPiece,
} from '@/lib/dtf/pieces'
import {
  INTERLOCK_MAX_CM,
  INTERLOCK_STOPS_CM,
  type ShapePiece,
} from '@/lib/dtf/trueshape'
import { createNestClient } from '@/lib/dtf/nestClient'
import { buildOrderZip, planLegend } from '@/lib/dtf/zipExport'
import { hasErrors, preflight, type PreflightIssue } from '@/lib/dtf/preflight'
import { isGraded, printScaleK } from '@/lib/printScale'
import {
  estimateCost,
  loadSuppliers,
  processOf,
  resetSuppliers,
  saveSuppliers,
  validProfile,
  type DtfGuidelines,
  type DtfProcess,
  type ProcessId,
  type SheetFormat,
  type SupplierProfile,
} from '@/lib/dtf/suppliers'
import {
  clampSheetDpi,
  renderSheet,
  sheetToPngBlob,
  SHEET_TARGET_DPI,
  type ManifestPiece,
} from '@/lib/dtf/sheet'
import { CM_PER_IN } from '@/lib/units'
import { useDtfT } from './dtfI18n'
import type { Design, SavedDesignMeta, Side, SizeId } from '@/lib/types'

/** Preview pixel density (px/inch) — 58 cm roll ≈ 640 px wide. */
const PREVIEW_DPI = 28
/** Cutting-plan export density — crisp guides, small files. */
const CUTPLAN_DPI = 64
const DEFAULT_QTY = 10

/**
 * Interlock slider stops, cm — OWNED BY THE PACKER, not by this file. The
 * "a bigger setting is never worse" guarantee is stated over exactly that rung
 * set (trueshape.ts), so offering a stop it does not sweep would reintroduce
 * the anomaly where dragging to "maximum fill" buys MORE film.
 */
const INTERLOCK_STOPS = INTERLOCK_STOPS_CM
/**
 * Default: 2 cm. Real tucking, still obviously cuttable by hand. Shipping
 * "maximum fill" by default would hand someone an hour of scissor work to save
 * film they did not know they were saving.
 */
const DEFAULT_INTERLOCK_INDEX = INTERLOCK_STOPS.indexOf(2)
/** Restart counts offered. A COUNT, never a time budget — see trueshape.ts. */
const RESTART_CHOICES = [6, 12, 24]

/**
 * Merge distance shown in the UI, cm — `PIECE_CLEARANCE_IN` in the operator's
 * unit. Every visual on a side is its own transfer unless two of them sit
 * closer than this, which is roughly the film gap they would be nested with
 * anyway (see pieces.ts for the full argument).
 */
const DEFAULT_MERGE_CM = Math.round(PIECE_CLEARANCE_IN * CM_PER_IN * 100) / 100

interface QueueRow {
  /**
   * Stable row identity — the render-cache key, and the BASE of every nest
   * piece id the row produces. A row is an order line (design × side × size),
   * not a transfer: a side split into three visuals still queues once here and
   * emits `key`, `key~2`, `key~3` (see `piecePartKey`).
   */
  key: string
  /**
   * The same row identity WITHOUT the size — the transfer this row would be if
   * the design did not grade. Rows that share it are one single-size transfer;
   * that is what the grading trade-off is measured against.
   */
  baseKey: string
  design: Design
  side: Side
  qty: number
  /** Basket rows mirror the order — their quantity is owned by the basket. */
  from: 'basket' | 'manual'
  /** Garment size this transfer is graded for; absent = base-size transfer. */
  size?: SizeId
  /** Size × qty summary for merged rows, e.g. `S ×3 · M ×5`. */
  detail?: string
}

type PieceState =
  | { status: 'pending' }
  | { status: 'empty' }
  /** Every transfer this side splits into, in part order. */
  | { status: 'ok'; pieces: RenderedPiece[] }

interface HoverInfo {
  x: number
  y: number
  text: string
}

/**
 * Queue rows for the design currently open in the studio. Manual rows carry no
 * order size, so they are base-size transfers (k = 1) whatever the grading mode
 * — there is no garment size to grade to until the design is in the basket.
 */
const rowsFromDesign = (design: Design): QueueRow[] =>
  printedSides(design).map((side) => {
    const key = pieceSourceKey(design, side)
    return { key, baseKey: key, design, side, qty: DEFAULT_QTY, from: 'manual' as const }
  })

/**
 * Basket → queue: one row per (design snapshot, printed side, size-if-graded),
 * quantities summed across the lines that share it.
 *
 * `updatedAt` is part of the key on purpose: the studio keeps ONE design id
 * across edits, so a line added before an edit and a line added after it are
 * two different artworks — sharing `design.id:side` would print one of them
 * twice.
 *
 * The SIZE is part of the key only when the design grades. A `fixed` design
 * prints one physical transfer for the whole order (layer geometry is inches
 * from the print-area centre, size only scales the garment), so its lines merge
 * as before; a `scaled` design prints a genuinely different transfer per size,
 * so each size gets its own row, its own render and its own nested piece.
 */
function rowsFromBasket(lines: BasketLine[]): QueueRow[] {
  const acc = new Map<string, { row: QueueRow; sizes: Map<string, number> }>()
  for (const line of lines) {
    const graded = isGraded(line.design)
    for (const side of linePrintedSides(line.design)) {
      const stamp = `@${line.design.updatedAt}`
      const baseKey = pieceSourceKey(line.design, side) + stamp
      const key = graded
        ? pieceSourceKey(line.design, side, line.size) + stamp
        : baseKey
      const hit = acc.get(key)
      if (hit) {
        hit.row.qty += line.qty
        hit.sizes.set(line.size, (hit.sizes.get(line.size) ?? 0) + line.qty)
      } else {
        acc.set(key, {
          row: {
            key,
            baseKey,
            design: line.design,
            side,
            qty: line.qty,
            from: 'basket',
            ...(graded ? { size: line.size } : {}),
          },
          sizes: new Map([[line.size, line.qty]]),
        })
      }
    }
  }
  return [...acc.values()].map(({ row, sizes }) => ({
    ...row,
    // A graded row IS one size — its chip already says which, so the size×qty
    // summary is only meaningful on merged (single-transfer) rows.
    ...(row.size
      ? {}
      : { detail: [...sizes.entries()].map(([s, n]) => `${s} ×${n}`).join(' · ') }),
  }))
}

/** Process a freshly loaded profile list starts on (DTF textile when present). */
const bootProcess = (list: SupplierProfile[]): DtfProcess | null =>
  list[0]?.processes.find((p) => p.id === 'dtf') ?? list[0]?.processes[0] ?? null

export default function DtfModal() {
  const t = useDtfT()
  const lang = useStore((s) => s.lang)
  const design = useStore((s) => s.design)
  const basket = useStore((s) => s.basket)
  const openModal = useStore((s) => s.openModal)
  const closeModal = useStore((s) => s.closeModal)
  const toast = useStore((s) => s.toast)

  // --- queue ---------------------------------------------------------------
  // The basket is the real order, so it drives the queue whenever it has
  // lines; the manual rows (current design, saved designs) stay available and
  // are simply appended.
  const [fromBasket, setFromBasket] = useState(() => basket.length > 0)
  const [manualRows, setManualRows] = useState<QueueRow[]>(() =>
    basket.length > 0 ? [] : rowsFromDesign(design),
  )
  const basketRows = useMemo(
    () => (fromBasket ? rowsFromBasket(basket) : []),
    [fromBasket, basket],
  )
  const rows = useMemo(
    () => [...basketRows, ...manualRows],
    [basketRows, manualRows],
  )

  const addCurrentDesign = () => {
    const fresh = rowsFromDesign(design)
    if (fresh.length === 0) {
      toast('info', t('dtf.queue.current_none'))
      return
    }
    setManualRows((cur) => mergeRows(cur, fresh))
    toast('ok', t('dtf.queue.current_added'))
  }

  // --- suppliers + process --------------------------------------------------
  const [suppliers, setSuppliers] = useState<SupplierProfile[]>(() => loadSuppliers())
  const [supplierId, setSupplierId] = useState(() => suppliers[0]?.id ?? 'dtfplus')
  const [processId, setProcessId] = useState<ProcessId>(
    () => bootProcess(suppliers)?.id ?? 'dtf',
  )
  const supplier = suppliers.find((s) => s.id === supplierId) ?? suppliers[0]
  // A supplier may not offer the selected process — fall back to its first.
  const proc = supplier
    ? (processOf(supplier, processId) ?? supplier.processes[0] ?? null)
    : null

  const [gap, setGap] = useState(() => bootProcess(suppliers)?.guidelines.gapCm ?? 0.5)
  const [marginSide, setMarginSide] = useState(
    () => bootProcess(suppliers)?.guidelines.marginCm ?? 0,
  )
  const [marginEnd, setMarginEnd] = useState(
    () => bootProcess(suppliers)?.guidelines.marginEndCm ?? 0,
  )
  const [allowRotate, setAllowRotate] = useState(true)
  /**
   * Each visual on a side is its own transfer. ON by default and that is the
   * point: grouping a whole side into one transfer buys film for the empty
   * space between a chest logo and a hem line. Turning it OFF is the explicit
   * escape hatch for an operator who would rather press one big transfer than
   * three small ones — it costs film, and the panel says so.
   */
  const [splitPieces, setSplitPieces] = useState(true)
  /** Two visuals closer than this stay one transfer (cm). See pieces.ts. */
  const [mergeCm, setMergeCm] = useState(DEFAULT_MERGE_CM)
  const clearanceIn = splitPieces ? mergeCm / CM_PER_IN : MERGE_WHOLE_SIDE_IN
  /**
   * 180°/270° as well as 90°. Measured worth 4,6 % of the roll on the benchmark
   * — real money — but it is OFF by default and always will be: a transfer
   * pressed upside down is scrap, and only the operator knows whether their
   * artwork has an "up".
   */
  const [allowFlip, setAllowFlip] = useState(false)
  const [guides, setGuides] = useState(true)
  const [advanced, setAdvanced] = useState(false)
  const [interlockIdx, setInterlockIdx] = useState(DEFAULT_INTERLOCK_INDEX)
  const [restarts, setRestarts] = useState(RESTART_CHOICES[1])
  /** Operator override of the sheet geometry; null = the supplier's maximum. */
  const [sheetWCm, setSheetWCm] = useState<number | null>(null)
  const [sheetLenCm, setSheetLenCm] = useState<number | null>(null)
  const interlockCm = INTERLOCK_STOPS[interlockIdx] ?? 0

  /**
   * Spacing AND sheet geometry follow the process guidelines on every switch
   * (never on edit). The geometry override has to reset too: 58 cm typed for
   * DTF+ would silently overflow a 55 cm supplier.
   */
  const adoptSpacing = (p: DtfProcess | null | undefined) => {
    if (!p) return
    setGap(p.guidelines.gapCm)
    setMarginSide(p.guidelines.marginCm)
    setMarginEnd(p.guidelines.marginEndCm ?? p.guidelines.marginCm)
    setSheetWCm(null)
    setSheetLenCm(null)
  }

  const pickSupplier = (id: string) => {
    setSupplierId(id)
    const s = suppliers.find((x) => x.id === id)
    adoptSpacing(s ? (processOf(s, processId) ?? s.processes[0]) : null)
  }

  const pickProcess = (id: ProcessId) => {
    setProcessId(id)
    adoptSpacing(supplier ? processOf(supplier, id) : null)
  }

  const patchSupplier = (patch: Partial<SupplierProfile>) =>
    setSuppliers((all) =>
      all.map((s) => (s.id === supplierId ? { ...s, ...patch } : s)),
    )

  const patchProcess = (patch: Partial<DtfProcess>) => {
    if (!supplier || !proc) return
    patchSupplier({
      processes: supplier.processes.map((p) => (p.id === proc.id ? { ...p, ...patch } : p)),
    })
  }

  const patchGuidelines = (patch: Partial<DtfGuidelines>) => {
    if (!proc) return
    patchProcess({ guidelines: { ...proc.guidelines, ...patch } })
  }

  // --- preview piece rendering (async, cached by row key) ------------------
  const cacheRef = useRef(new Map<string, PieceState>())
  const [pieceVersion, bumpPieces] = useReducer((x: number) => x + 1, 0)

  // No cancellation flag on purpose: the `has()` guard below means a key set
  // to 'pending' is never re-rendered, so an abandoned promise would strand it
  // forever (every rows change, and StrictMode's mount→cleanup→remount, would
  // orphan the initial renders). The cache is always committed; the resulting
  // dispatch on an unmounted component is a no-op in React 18+.
  //
  // The split setting is part of the cache key rather than a reason to clear
  // the map: a row's artwork genuinely differs per clearance, and keying it in
  // means dragging the setting back and forth costs nothing and can never show
  // pieces rendered under the previous one.
  useEffect(() => {
    for (const row of rows) {
      const ck = cacheKey(row.key, clearanceIn)
      if (cacheRef.current.has(ck)) continue
      cacheRef.current.set(ck, { status: 'pending' })
      renderPieces(row.design, row.side, PREVIEW_DPI, row.size, {
        clearanceIn,
        baseKey: row.key,
      })
        .then((pieces) => {
          cacheRef.current.set(
            ck,
            pieces.length > 0 ? { status: 'ok', pieces } : { status: 'empty' },
          )
          bumpPieces()
        })
        .catch(() => {
          cacheRef.current.set(ck, { status: 'empty' })
          bumpPieces()
        })
    }
  }, [rows, clearanceIn])

  const pieceOf = (key: string): PieceState =>
    cacheRef.current.get(cacheKey(key, clearanceIn)) ?? { status: 'pending' }
  /** The transfers a queue row produced, empty while it is still rendering. */
  const partsOf = (key: string): RenderedPiece[] => {
    const st = pieceOf(key)
    return st.status === 'ok' ? st.pieces : []
  }

  // --- sheet geometry -------------------------------------------------------
  // The process declares the supplier's MAXIMUM; the operator may nest onto a
  // narrower/shorter sheet (a 50 × 250 job on a 58 cm roll is legitimate), but
  // never onto a bigger one — that file would come back rejected or cropped.
  const maxWCm = proc?.printableWidthCm ?? 58
  const maxLenCm = proc?.maxLengthCm ?? 250
  const effWCm = clampNum(sheetWCm ?? maxWCm, 1, maxWCm)
  const effLenCm = clampNum(sheetLenCm ?? maxLenCm, 1, maxLenCm)
  /**
   * The process as actually used, so nesting AND preflight see ONE geometry.
   * The operator's spacing overrides the supplier's recommendation here too:
   * preflight judging "does it fit" against a 0 cm margin while the nester
   * packs on 1 cm reports a clean sheet and then drops the piece into
   * `unplaceable`, which is two contradictory answers to the same question.
   */
  const effProc = useMemo(
    () =>
      proc
        ? {
            ...proc,
            printableWidthCm: effWCm,
            maxLengthCm: effLenCm,
            guidelines: { ...proc.guidelines, marginCm: marginSide, marginEndCm: marginEnd },
          }
        : null,
    [proc, effWCm, effLenCm, marginSide, marginEnd],
  )

  // --- nesting + preflight --------------------------------------------------
  const options: NestOptions = useMemo(
    () => ({
      printableWidthCm: effWCm,
      maxLengthCm: effLenCm,
      gapCm: gap,
      edgeMarginCm: marginSide,
      edgeMarginSideCm: marginSide,
      edgeMarginEndCm: marginEnd,
      billingStepCm: proc?.billingStepCm ?? 10,
    }),
    [effWCm, effLenCm, gap, marginSide, marginEnd, proc],
  )

  // Alpha masks feed the true-shape packer. Keyed by the RenderedPiece object
  // itself, so a re-render invalidates the mask automatically and a stale
  // outline can never be nested against fresh artwork.
  const maskRef = useRef(new WeakMap<RenderedPiece, PieceMask | null>())
  const maskOf = (p: RenderedPiece): PieceMask | null => {
    const hit = maskRef.current.get(p)
    if (hit !== undefined) return hit
    const m = pieceMask(p)
    maskRef.current.set(p, m)
    return m
  }

  // One nest piece per TRANSFER, not per side. The row's quantity applies to
  // every one of them: an order line for 10 garments needs 10 copies of each of
  // that side's visuals, not 10 of the first and one of the rest.
  const pieces = useMemo(() => {
    const out: ShapePiece[] = []
    for (const row of rows) {
      if (row.qty <= 0) continue
      for (const p of partsOf(row.key)) {
        const mask = maskOf(p)
        out.push({
          id: p.sourceKey,
          sourceKey: p.sourceKey,
          wCm: p.wCm,
          hCm: p.hCm,
          qty: row.qty,
          allowRotate,
          ...(allowFlip ? { allowFlip: true } : {}),
          ...(mask ? { mask: mask.mask, maskW: mask.maskW, maskH: mask.maskH } : {}),
          // Prepress metadata for preflight: source pixels at the PLACED size,
          // measured on THIS transfer's own layers (p.srcDpi is the artwork's
          // native ceiling, never the preview DPI — all-vector artwork reports
          // null and simply skips the DPI check).
          ...(p.srcDpi !== null
            ? { srcPxW: Math.round(p.srcDpi * p.wIn), srcPxH: Math.round(p.srcDpi * p.hIn) }
            : {}),
          // Everything the renderer emits is transparent-background by design.
          hasAlpha: true,
        })
      }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, allowRotate, allowFlip, pieceVersion, clearanceIn])

  // Instant, never-empty baseline. The optimiser below can only improve on it.
  const shelfResult = useMemo(
    () => (effProc ? nest(pieces, effProc, options) : nest(pieces, options)),
    [pieces, effProc, options],
  )
  const [optimised, setOptimised] = useState<NestResult | null>(null)
  const [nestBusy, setNestBusy] = useState<{ done: number; total: number } | null>(null)
  // Our OWN nesting channel. A module-shared one would let this modal's effect
  // cleanup terminate a job some other consumer started (the dev harness mounts
  // this modal alongside its own nesting entry point) — and vice versa.
  const nester = useMemo(() => createNestClient(), [])
  useEffect(() => () => nester.cancel(), [nester])

  useEffect(() => {
    if (pieces.length === 0) {
      setOptimised(null)
      return
    }
    let alive = true
    // Drop the previous optimised layout BEFORE asking for a new one. Keeping
    // it would leave a layout — and the price computed from it — belonging to
    // the OLD supplier on screen: switch from a per-metre roll to a per-sheet
    // catalogue and the cost panel quotes fixed-format billing against roll
    // sheets that carry no format at all. `shelfResult` is recomputed
    // synchronously from the new geometry, so nothing is ever blank.
    setOptimised(null)
    setNestBusy({ done: 0, total: restarts })
    nester.nest(
      {
        pieces,
        options: { ...options, maxInterlockCm: interlockCm, restarts },
        ...(supplier ? { supplier } : {}),
        ...(effProc ? { process: effProc } : {}),
      },
      { onProgress: (done, total) => alive && setNestBusy({ done, total }) },
    )
      .then((r) => {
        if (!alive) return
        setOptimised(r)
        setNestBusy(null)
      })
      .catch(() => {
        // The shelf result stays on screen: a failed optimisation must never
        // leave the operator without a layout.
        if (!alive) return
        setOptimised(null)
        setNestBusy(null)
      })
    return () => {
      alive = false
      nester.cancel()
    }
  }, [pieces, options, interlockCm, restarts, supplier, effProc, nester])

  const result = optimised ?? shelfResult

  const issues = useMemo(() => (effProc ? preflight(pieces, effProc) : []), [pieces, effProc])
  const errorCount = issues.filter((i) => i.level === 'error').length
  const warnCount = issues.length - errorCount
  const [forceExport, setForceExport] = useState(false)
  const blocked = hasErrors(issues) && !forceExport

  /** Nest piece id → the transfer it is and the order line it came from. */
  const partsByKey = useMemo(() => {
    const m = new Map<string, { row: QueueRow; piece: RenderedPiece }>()
    for (const row of rows)
      for (const p of partsOf(row.key)) m.set(p.sourceKey, { row, piece: p })
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, pieceVersion, clearanceIn])

  const previewSources = useMemo(() => {
    const map = new Map<string, RenderedPiece>()
    for (const [key, { piece }] of partsByKey) map.set(key, piece)
    return map
  }, [partsByKey])

  /** What one QUEUE ROW is: a design side, at a size when the design grades. */
  const rowLabel = (row: QueueRow): string =>
    `${row.design.name} · ${t('side.' + row.side)}` + (row.size ? ` · ${row.size}` : '')

  // What one TRANSFER is. The size belongs in the label because on a graded
  // order the cutting plan carries several transfers of the same design and
  // only the size tells them apart — and so, now, does the part and its
  // position: once a side prints as three transfers, the cutting plan is the
  // only place the workshop learns which is which and where each goes. Two
  // figures, no more: the label is drawn inside the piece's own width there.
  const labelOf = (sourceKey: string): string => {
    const hit = partsByKey.get(sourceKey)
    if (!hit) return sourceKey
    const { row, piece } = hit
    const base = rowLabel(row)
    if (piece.parts <= 1) return base
    const pl = piecePlacementCm(piece)
    return (
      `${base} · ${t('dtf.piece.part', { n: piece.part, tot: piece.parts })} ` +
      t('dtf.piece.pos_short', { top: fmtCm(pl.topCm), dx: signedCm(pl.centerDxCm) })
    )
  }

  /** Full-sentence placement, for the queue list and the tooltip. */
  const placeText = (piece: RenderedPiece): string => {
    const pl = piecePlacementCm(piece)
    const dx =
      Math.abs(pl.centerDxCm) < 0.05
        ? t('dtf.piece.centered')
        : t(pl.centerDxCm > 0 ? 'dtf.piece.right' : 'dtf.piece.left', {
            v: fmtCm(Math.abs(pl.centerDxCm)),
          })
    return t('dtf.piece.pos', { top: fmtCm(pl.topCm), dx })
  }

  // --- stats -----------------------------------------------------------------
  const minDpi = proc?.guidelines.minDpi ?? 1
  const targetDpi = Math.max(SHEET_TARGET_DPI, minDpi)
  const effectiveDpis = result.sheets.map((s) =>
    clampSheetDpi(s.widthCm || options.printableWidthCm, s.lengthCm, targetDpi, minDpi),
  )
  const effectiveDpi = effectiveDpis.length ? Math.min(...effectiveDpis) : targetDpi
  const cost =
    supplier && effProc && result.sheets.length > 0
      ? estimateCost(supplier, effProc, result.sheets)
      : null
  const fixed = proc?.billing === 'fixed'
  /** How much film the optimiser saved against the straight-strip baseline. */
  const savedCm =
    optimised && shelfResult.totalLengthCm > optimised.totalLengthCm
      ? shelfResult.totalLengthCm - optimised.totalLengthCm
      : 0

  // --- grading trade-off ----------------------------------------------------
  // A graded design needs one transfer PER SIZE — that is the real cost of
  // grading and the sheet has to state it. The counterfactual (this same order
  // printed at a single size) is exactly this piece set UN-graded: each piece's
  // physical size divided by its own factor k — the very factor it was
  // multiplied by, so the division is exact — then merged per design side.
  // Re-nesting that set with the current settings makes both figures measured;
  // nothing below is a guessed number.
  const singleSizePieces = useMemo(() => {
    const acc = new Map<string, DtfPiece>()
    for (const row of rows) {
      if (row.qty <= 0) continue
      const k = printScaleK(row.design, row.size)
      // Grading is uniform about the print-area centre, so it cannot change how
      // a side splits: part n of a size IS part n of every other size, and the
      // un-graded counterfactual merges them part by part.
      for (const p of partsOf(row.key)) {
        const key = piecePartKey(row.baseKey, p.part, p.parts)
        const hit = acc.get(key)
        if (hit) {
          hit.qty += row.qty
          continue
        }
        acc.set(key, {
          id: key,
          sourceKey: key,
          wCm: p.wCm / k,
          hCm: p.hCm / k,
          qty: row.qty,
          allowRotate,
          hasAlpha: true,
        })
      }
    }
    return [...acc.values()]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, allowRotate, pieceVersion, clearanceIn])

  /** Null unless grading actually multiplies transfers on THIS order. */
  const tradeoff = useMemo(() => {
    if (singleSizePieces.length >= pieces.length) return null
    const r = effProc
      ? nest(singleSizePieces, effProc, options)
      : nest(singleSizePieces, options)
    return {
      transfers: pieces.length,
      singleTransfers: singleSizePieces.length,
      cost:
        supplier && effProc && r.sheets.length > 0
          ? estimateCost(supplier, effProc, r.sheets)
          : null,
    }
  }, [singleSizePieces, pieces, effProc, supplier, options])

  // --- saved-designs picker ----------------------------------------------------
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saved, setSaved] = useState<SavedDesignMeta[] | null>(null)
  useEffect(() => {
    if (pickerOpen && saved === null)
      listSavedMetas()
        .then(setSaved)
        .catch(() => setSaved([]))
  }, [pickerOpen, saved])

  const addSaved = async (meta: SavedDesignMeta) => {
    const d = await loadSavedDesign(meta.id).catch(() => undefined)
    if (!d) {
      toast('error', t('dtf.saved.load_failed'))
      return
    }
    const fresh = rowsFromDesign(d)
    if (fresh.length === 0) {
      toast('info', t('dtf.saved.no_sides'))
      return
    }
    setManualRows((cur) => mergeRows(cur, fresh))
    toast('ok', t('dtf.saved.added', { name: meta.name }))
  }

  // --- exports ------------------------------------------------------------------
  const [busy, setBusy] = useState<string | null>(null)
  const [askName, setAskName] = useState(false)
  const [orderName, setOrderName] = useState('')

  const canExport = !busy && result.sheets.length > 0 && !blocked

  /**
   * What the operator most likely wants the order called. The basket is the
   * real order but carries no name of its own, so it contributes its size;
   * a manual queue falls back to the design being worked on.
   */
  const defaultOrderName = useMemo(() => {
    const d = new Date()
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`
    return fromBasket && basket.length > 0
      ? t('dtf.zip.default_basket', { n: basket.length, date: stamp })
      : design.name || t('dtf.zip.default_fallback', { date: stamp })
  }, [fromBasket, basket.length, design.name, t])

  // Re-rendering is per ORDER LINE, not per placed transfer: one renderPieces
  // call hands back every part of a side at once, so a side split into three
  // would otherwise be re-rendered three times for the same three canvases.
  const renderHiResSources = async (
    dpi: number,
    onStep: (n: number, total: number) => void,
  ): Promise<Map<string, RenderedPiece>> => {
    const keys = new Set(result.sheets.flatMap((s) => s.placements.map((p) => p.sourceKey)))
    const needed = new Map<string, QueueRow>()
    for (const key of keys) {
      const hit = partsByKey.get(key)
      if (hit) needed.set(hit.row.key, hit.row)
    }
    const map = new Map<string, RenderedPiece>()
    let n = 0
    for (const row of needed.values()) {
      onStep(++n, needed.size)
      const parts = await renderPieces(row.design, row.side, dpi, row.size, {
        clearanceIn,
        baseKey: row.key,
      })
      for (const p of parts) if (keys.has(p.sourceKey)) map.set(p.sourceKey, p)
    }
    return map
  }

  const manifestPieces = (): ManifestPiece[] => {
    const out: ManifestPiece[] = []
    for (const row of rows)
      for (const p of partsOf(row.key)) {
        const pl = piecePlacementCm(p)
        out.push({
          sourceKey: p.sourceKey,
          label: labelOf(p.sourceKey),
          wCm: r2(p.wCm),
          hCm: r2(p.hCm),
          qty: row.qty,
          ...(p.parts > 1 ? { part: p.part, parts: p.parts } : {}),
          // Always emitted, split or not: the manifest is the traceability
          // record, and "where on the garment" is the one thing about a
          // transfer that nothing else in the archive states.
          placement: {
            topCm: r2(pl.topCm),
            leftCm: r2(pl.leftCm),
            centerDxCm: r2(pl.centerDxCm),
            areaWCm: r2(pl.areaWCm),
            areaHCm: r2(pl.areaHCm),
          },
        })
      }
    return out
  }

  const exportZip = async () => {
    if (!supplier || !proc || !canExport) return
    const name = orderName.trim() || defaultOrderName
    setAskName(false)
    // ONE timestamp for the archive name, the ZIP dates, the manifest and the
    // README — a second clock reading would make them disagree.
    const date = new Date()
    setBusy(t('dtf.zip.busy', { label: t('dtf.zip.step_art'), n: 0, total: 1 }))
    try {
      const maxDpi = Math.max(...effectiveDpis, targetDpi)
      const sources = await renderHiResSources(maxDpi, (n, total) =>
        setBusy(t('dtf.zip.busy', { label: t('dtf.zip.step_art'), n, total })),
      )
      const labels = new Map<string, string>()
      for (const key of partsByKey.keys()) labels.set(key, labelOf(key))
      const { blob, fileName } = await buildOrderZip(
        {
          orderName: name,
          date,
          lang,
          appVersion: APP_VERSION,
          result,
          supplier,
          process: proc,
          cost,
          preflight: issues,
          pieces: manifestPieces(),
          labels,
          sources,
          planSources: previewSources,
          effectiveDpis,
          requestedDpi: targetDpi,
          cutplanDpi: CUTPLAN_DPI,
          restarts,
          flip: allowFlip,
        },
        (p) => setBusy(t('dtf.zip.busy', { label: p.label, n: p.done, total: p.total })),
      )
      downloadBlob(blob, fileName)
      toast('ok', t('dtf.zip.done', { name: fileName }))
    } catch {
      toast('error', t('dtf.export.failed'))
    } finally {
      setBusy(null)
    }
  }

  /** Secondary path: one sheet's print PNG, for a re-send or a spot check. */
  const exportOneSheet = async (i: number) => {
    if (!supplier || !canExport) return
    setBusy(t('dtf.zip.busy', { label: t('dtf.zip.step_art'), n: 0, total: 1 }))
    try {
      const dpi = effectiveDpis[i] ?? targetDpi
      const sources = await renderHiResSources(dpi, (n, total) =>
        setBusy(t('dtf.zip.busy', { label: t('dtf.zip.step_art'), n, total })),
      )
      const { canvas } = renderSheet(result.sheets[i], result.options, sources, {
        dpi,
        guides: false,
        background: null,
      })
      const blob = await sheetToPngBlob(canvas)
      canvas.width = 1
      canvas.height = 1
      downloadBlob(
        blob,
        `${slugFile(orderName.trim() || defaultOrderName)}-planche-${i + 1}.png`,
      )
      toast('ok', t('dtf.export.done'))
    } catch {
      toast('error', t('dtf.export.failed'))
    } finally {
      setBusy(null)
    }
  }

  const saveProfiles = () => {
    // saveSuppliers persists VERBATIM and loadSuppliers drops what it cannot
    // read — refuse here so a half-typed tier can never delete a profile.
    if (!suppliers.every((p) => validProfile(p))) {
      toast('error', t('dtf.settings.invalid'))
      return
    }
    setSuppliers(saveSuppliers(suppliers))
    toast('ok', t('dtf.settings.saved'))
  }

  const resetProfiles = () => {
    const fresh = resetSuppliers()
    setSuppliers(fresh)
    const p = fresh.find((s) => s.id === supplierId) ?? fresh[0]
    if (p) {
      setSupplierId(p.id)
      const pr = processOf(p, processId) ?? p.processes[0]
      if (pr) setProcessId(pr.id)
      adoptSpacing(pr)
    }
    toast('info', t('dtf.settings.reset_done'))
  }

  // --- hover tooltip ------------------------------------------------------------
  const [hover, setHover] = useState<HoverInfo | null>(null)

  const mono = 'font-mono text-[12px] text-tx'

  return (
    <Modal
      title={t('dtf.title')}
      subtitle={t('dtf.subtitle')}
      onClose={() => closeModal('dtf')}
      size="lg"
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
          {/* ---------------- left column: queue + settings ---------------- */}
          <div className="flex min-w-0 flex-col gap-4">
            <section>
              <div className="panel-title mb-2">{t('dtf.queue.title')}</div>

              {/* Order basket vs manual queue. */}
              <div className="mb-2 flex gap-1 rounded-lg border border-line bg-bg1 p-1">
                <button
                  className={clsx(
                    'btn btn-ghost h-7 flex-1 justify-center text-[11.5px]',
                    fromBasket && 'btn-primary',
                  )}
                  data-dtf="src-basket"
                  aria-pressed={fromBasket}
                  onClick={() => setFromBasket(true)}
                >
                  <ShoppingBag size={12} />
                  {t('dtf.queue.src_basket', { n: basket.length })}
                </button>
                <button
                  className={clsx(
                    'btn btn-ghost h-7 flex-1 justify-center text-[11.5px]',
                    !fromBasket && 'btn-primary',
                  )}
                  aria-pressed={!fromBasket}
                  onClick={() => setFromBasket(false)}
                >
                  {t('dtf.queue.src_manual')}
                </button>
              </div>
              {fromBasket && (
                <div className="mb-2 text-[11px] leading-relaxed text-tx3">
                  {basket.length === 0 ? t('dtf.queue.basket_empty') : t('dtf.queue.basket_note')}{' '}
                  <button
                    className="text-cy underline-offset-2 hover:underline"
                    onClick={() => {
                      closeModal('dtf')
                      openModal('basket')
                    }}
                  >
                    {t('dtf.queue.open_basket')}
                  </button>
                </div>
              )}

              {rows.length === 0 && (
                <div className="rounded-lg border border-line bg-bg1 p-3 text-[12px] text-tx2">
                  {t('dtf.queue.empty')}
                </div>
              )}
              <div className="flex max-h-[26vh] flex-col gap-1.5 overflow-y-auto">
                {rows.map((row) => {
                  const st = pieceOf(row.key)
                  const parts = st.status === 'ok' ? st.pieces : []
                  const label = rowLabel(row)
                  // A row is an order line; its warnings are those of every
                  // transfer it prints as.
                  const bad = parts.some((p) => result.unplaceable.includes(p.sourceKey))
                  const rowIssues = issues.filter((i) =>
                    parts.some((p) => p.sourceKey === i.pieceKey),
                  )
                  const rowErr = rowIssues.some((i) => i.level === 'error')
                  return (
                    <div
                      key={row.key}
                      className={clsx(
                        'flex items-center gap-2 rounded-lg border bg-bg1 px-2.5 py-1.5',
                        rowErr ? 'border-dg/50' : 'border-line',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-medium text-tx">{label}</div>
                        <div className="font-mono text-[10.5px] text-tx3">
                          {st.status === 'ok'
                            ? parts.length > 1
                              ? t('dtf.queue.transfers', { n: parts.length })
                              : `${parts[0].wCm.toFixed(1)} × ${parts[0].hCm.toFixed(1)} cm`
                            : st.status === 'pending'
                              ? t('dtf.queue.rendering')
                              : t('dtf.queue.empty_side')}
                          {row.size && (
                            <span className="ml-1.5 text-cy">
                              {t('dtf.queue.size', { size: row.size })}
                            </span>
                          )}
                          {row.detail && <span className="ml-1.5 text-cy">{row.detail}</span>}
                          {bad && (
                            <span className="ml-1.5 text-dg">{t('dtf.queue.unplaceable')}</span>
                          )}
                          {rowIssues.length > 0 && (
                            <span className={clsx('ml-1.5', rowErr ? 'text-dg' : 'text-tx2')}>
                              ⚠ {rowIssues.length}
                            </span>
                          )}
                        </div>
                        {/* Where each transfer goes. A split side is only safe
                            to press if this is on screen, not just in the ZIP. */}
                        {parts.length > 1 && (
                          <ul
                            className="mt-1 flex flex-col gap-0.5 border-l border-line pl-1.5"
                            data-dtf="row-parts"
                          >
                            {parts.map((p) => (
                              <li
                                key={p.sourceKey}
                                className="truncate font-mono text-[10px] text-tx3"
                                title={placeText(p)}
                              >
                                <span className="text-tx2">
                                  {t('dtf.piece.part', { n: p.part, tot: p.parts })}
                                </span>{' '}
                                {p.wCm.toFixed(1)} × {p.hCm.toFixed(1)} cm · {placeText(p)}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      {row.from === 'basket' ? (
                        <span
                          className="shrink-0 rounded-md border border-line px-1.5 py-0.5 font-mono text-[11px] text-tx2"
                          title={t('dtf.queue.basket_note')}
                        >
                          ×{row.qty}
                        </span>
                      ) : (
                        <>
                          <input
                            type="number"
                            min={0}
                            max={999}
                            aria-label={t('dtf.queue.qty', { name: label })}
                            className="input h-7 w-14 text-center font-mono text-[12px]"
                            value={row.qty}
                            onChange={(e) => {
                              const v = Math.max(
                                0,
                                Math.min(999, Math.round(Number(e.target.value) || 0)),
                              )
                              setManualRows((cur) =>
                                cur.map((r) => (r.key === row.key ? { ...r, qty: v } : r)),
                              )
                            }}
                          />
                          <button
                            className="iconbtn h-7 w-7 shrink-0 text-tx3 hover:text-dg"
                            aria-label={t('dtf.queue.remove', { name: label })}
                            onClick={() =>
                              setManualRows((cur) => cur.filter((r) => r.key !== row.key))
                            }
                          >
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>

              <div className="mt-2 flex gap-2">
                <button
                  className="btn btn-ghost h-8 flex-1 justify-center text-[12px]"
                  onClick={addCurrentDesign}
                >
                  <Plus size={13} />
                  {t('dtf.queue.add_current')}
                </button>
                <button
                  className="btn btn-ghost h-8 flex-1 justify-center text-[12px]"
                  data-dtf="add-saved"
                  onClick={() => setPickerOpen((v) => !v)}
                >
                  <Plus size={13} />
                  {t('dtf.queue.add_saved')}
                </button>
              </div>
              {pickerOpen && (
                <div className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-line bg-bg1 p-1.5">
                  {saved === null ? (
                    <div className="p-2 text-[12px] text-tx3">…</div>
                  ) : saved.length === 0 ? (
                    <div className="p-2 text-[12px] text-tx3">{t('dtf.saved.empty')}</div>
                  ) : (
                    saved.map((m) => (
                      <button
                        key={m.id}
                        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-bg3"
                        onClick={() => void addSaved(m)}
                      >
                        {m.thumb ? (
                          <img
                            src={m.thumb}
                            alt=""
                            className="h-8 w-8 rounded bg-bg2 object-contain"
                          />
                        ) : (
                          <span className="h-8 w-8 rounded bg-bg2" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-[12px] text-tx">
                          {m.name}
                        </span>
                        <Plus size={12} className="shrink-0 text-tx3" />
                      </button>
                    ))
                  )}
                </div>
              )}
            </section>

            <section>
              <div className="panel-title mb-2">{t('dtf.settings.title')}</div>
              <label className="mb-2 block">
                <span className="mb-1 block text-[11.5px] text-tx2">
                  {t('dtf.settings.supplier')}
                </span>
                <select
                  className="input"
                  data-dtf="supplier-select"
                  value={supplierId}
                  onChange={(e) => pickSupplier(e.target.value)}
                >
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {s.printsFrom}
                    </option>
                  ))}
                </select>
              </label>

              {supplier && (
                <div className="mb-2">
                  <span className="mb-1 block text-[11.5px] text-tx2">
                    {t('dtf.settings.process')}
                  </span>
                  <div className="flex gap-1.5">
                    {supplier.processes.map((p) => (
                      <button
                        key={p.id}
                        className={clsx(
                          'btn btn-ghost h-7 flex-1 justify-center text-[11.5px]',
                          proc?.id === p.id && 'btn-primary',
                        )}
                        data-dtf={`process-${p.id}`}
                        aria-pressed={proc?.id === p.id}
                        onClick={() => pickProcess(p.id)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  {proc && (
                    <div className="mono-dim mt-1 text-[10.5px] text-tx3">
                      {fixed ? t('dtf.settings.billing_fixed') : t('dtf.settings.billing_roll')} ·{' '}
                      {proc.printableWidthCm} cm ·{' '}
                      {fixed
                        ? `${proc.formats.length} formats`
                        : `≤ ${proc.maxLengthCm} cm`}
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                <NumField
                  label={t('dtf.settings.gap')}
                  value={gap}
                  min={0}
                  step={0.1}
                  onChange={setGap}
                />
                <NumField
                  label={t('dtf.settings.margin_side')}
                  value={marginSide}
                  min={0}
                  step={0.1}
                  onChange={setMarginSide}
                />
                <NumField
                  label={t('dtf.settings.margin_end')}
                  value={marginEnd}
                  min={0}
                  step={0.1}
                  onChange={setMarginEnd}
                />
              </div>
              {proc && (
                <div className="mt-1 text-[10.5px] leading-relaxed text-tx3">
                  {t(`dtf.source.${proc.guidelines.marginSource ?? 'house'}`, {
                    w: fmtCm(proc.printableWidthCm),
                  })}
                </div>
              )}

              {/* Sheet geometry — the operator may go narrower/shorter, never bigger. */}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <NumField
                  label={t('dtf.settings.sheet_w', { max: fmtCm(maxWCm) })}
                  value={effWCm}
                  min={1}
                  step={1}
                  onChange={(v) => setSheetWCm(Math.min(v, maxWCm))}
                />
                <NumField
                  label={t('dtf.settings.sheet_len', { max: fmtCm(maxLenCm) })}
                  value={effLenCm}
                  min={1}
                  step={10}
                  onChange={(v) => setSheetLenCm(Math.min(v, maxLenCm))}
                />
              </div>
              {(sheetWCm !== null || sheetLenCm !== null) && (
                <button
                  className="btn btn-ghost mt-1 h-6 text-[11px]"
                  onClick={() => {
                    setSheetWCm(null)
                    setSheetLenCm(null)
                  }}
                >
                  <RefreshCcw size={11} />
                  {t('dtf.settings.sheet_reset')}
                </button>
              )}

              {/* The one knob that decides fill vs cutting comfort. */}
              <div className="mt-3">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="text-[11.5px] text-tx2">{t('dtf.fill.title')}</span>
                  <span className="font-mono text-[11px] text-cy">
                    {interlockCm >= INTERLOCK_MAX_CM
                      ? t('dtf.fill.max')
                      : interlockCm === 0
                        ? t('dtf.fill.strips')
                        : t('dtf.fill.cm', { v: fmtCm(interlockCm) })}
                  </span>
                </div>
                <input
                  type="range"
                  className="w-full accent-cy"
                  data-dtf="interlock"
                  min={0}
                  max={INTERLOCK_STOPS.length - 1}
                  step={1}
                  value={interlockIdx}
                  aria-label={t('dtf.fill.title')}
                  onChange={(e) => setInterlockIdx(Number(e.target.value))}
                />
                <div className="flex justify-between text-[10px] text-tx3">
                  <span>{t('dtf.fill.left')}</span>
                  <span>{t('dtf.fill.right')}</span>
                </div>
              </div>

              <label className="mt-2 block">
                <span className="mb-1 block text-[11.5px] text-tx2">
                  {t('dtf.fill.restarts')}
                </span>
                <select
                  className="input h-8 text-[12px]"
                  data-dtf="restarts"
                  value={restarts}
                  onChange={(e) => setRestarts(Number(e.target.value))}
                >
                  {RESTART_CHOICES.map((n) => (
                    <option key={n} value={n}>
                      {t('dtf.fill.restarts_opt', { n })}
                    </option>
                  ))}
                </select>
              </label>

              {/* The split. Its default is "each visual alone" and the note
                  says what turning it off costs, because the operator paying
                  for the film is the one who gets to decide whether three
                  small transfers are worth less handling than one big one. */}
              <label className="mt-3 flex items-start gap-2 text-[12.5px] text-tx2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  data-dtf="split-pieces"
                  checked={splitPieces}
                  onChange={(e) => setSplitPieces(e.target.checked)}
                />
                <span>
                  {t('dtf.split.title')}
                  <span className="block text-[10.5px] leading-relaxed text-tx3">
                    {splitPieces ? t('dtf.split.hint') : t('dtf.split.off_hint')}
                  </span>
                </span>
              </label>
              {splitPieces && (
                <div className="mt-1.5">
                  <NumField
                    label={t('dtf.split.merge')}
                    hint={t('dtf.split.merge_hint')}
                    value={mergeCm}
                    min={0}
                    step={0.1}
                    onChange={setMergeCm}
                  />
                </div>
              )}

              <label className="mt-2 flex items-center gap-2 text-[12.5px] text-tx2">
                <input
                  type="checkbox"
                  checked={allowRotate}
                  onChange={(e) => setAllowRotate(e.target.checked)}
                />
                {t('dtf.settings.rotate')}
              </label>
              <label className="mt-1.5 flex items-start gap-2 text-[12.5px] text-tx2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  data-dtf="allow-flip"
                  checked={allowFlip}
                  onChange={(e) => setAllowFlip(e.target.checked)}
                />
                <span>
                  {t('dtf.settings.flip')}
                  <span className="block text-[10.5px] leading-relaxed text-tx3">
                    {t('dtf.settings.flip_hint')}
                  </span>
                </span>
              </label>
              <label className="mt-1.5 flex items-center gap-2 text-[12.5px] text-tx2">
                <input
                  type="checkbox"
                  data-dtf="guides-toggle"
                  checked={guides}
                  onChange={(e) => setGuides(e.target.checked)}
                />
                {t('dtf.settings.guides')}
              </label>
            </section>
          </div>

          {/* ---------------- right column: stats + preview + exports ---------------- */}
          <div className="flex min-w-0 flex-col gap-3">
            <div
              className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-line bg-bg1 px-3.5 py-2.5"
              data-dtf="stats"
            >
              <Stat label={t('dtf.stats.sheets')} value={String(result.sheets.length)} mono={mono} />
              <Stat label={t('dtf.stats.pieces')} value={String(result.totalPieces)} mono={mono} />
              {fixed ? (
                <Stat
                  label={t('dtf.stats.mix')}
                  value={cost?.tierLabel ?? '—'}
                  mono={mono}
                />
              ) : (
                <Stat
                  label={t('dtf.stats.length')}
                  value={`${result.totalLengthM.toFixed(1)} m`}
                  mono={mono}
                />
              )}
              <Stat
                label={t('dtf.stats.util')}
                value={fillText(result.totalUtilization, result.totalInkUtilization, t)}
                mono={mono}
              />
              <Stat label={t('dtf.stats.dpi')} value={String(effectiveDpi)} mono={mono} />
              {nestBusy ? (
                <span
                  className="flex items-center gap-1.5 text-[11px] text-tx3"
                  data-dtf="nest-busy"
                >
                  <Loader2 size={12} className="animate-spin" />
                  {t('dtf.fill.working', { n: nestBusy.done, total: nestBusy.total })}
                </span>
              ) : (
                savedCm > 0 && (
                  <span className="text-[11px] text-cy" data-dtf="nest-gain">
                    {t('dtf.fill.saved', {
                      cm: fmtCm(savedCm),
                      pct: Math.round((savedCm / shelfResult.totalLengthCm) * 100),
                    })}
                  </span>
                )
              )}
              {cost && (
                <span className="ml-auto text-right">
                  <span className="block text-[10px] uppercase tracking-wide text-tx3">
                    {t('dtf.stats.cost')} ·{' '}
                    {cost.vatBasis === 'HT' ? t('dtf.stats.vat_ht') : t('dtf.stats.vat_ttc')}
                  </span>
                  <span className="font-mono text-[15px] font-semibold text-tx">
                    {cost.totalEur.toFixed(2)} €
                  </span>
                  <span className="block font-mono text-[10px] text-tx3">
                    {fixed
                      ? t('dtf.stats.cost_sheets', {
                          print: cost.printEur.toFixed(2),
                          ship: cost.shippingEur.toFixed(2),
                        })
                      : t('dtf.stats.cost_detail', {
                          print: cost.printEur.toFixed(2),
                          ship: cost.shippingEur.toFixed(2),
                          tier: cost.tierLabel,
                        })}
                    {cost.perPieceEur !== null && (
                      <> · {t('dtf.stats.per_piece', { v: cost.perPieceEur.toFixed(2) })}</>
                    )}
                  </span>
                </span>
              )}
            </div>

            {tradeoff && (
              <div
                className="rounded-lg border border-line bg-bg1 px-3 py-2 text-[11.5px] leading-relaxed text-tx2"
                data-dtf="grade-note"
                title={t('dtf.grade.tip')}
              >
                {t('dtf.grade.note', {
                  n: tradeoff.transfers,
                  m: tradeoff.singleTransfers,
                })}
                {cost && tradeoff.cost && (
                  <>
                    {' '}
                    {t('dtf.grade.cost', {
                      graded: cost.totalEur.toFixed(2),
                      single: tradeoff.cost.totalEur.toFixed(2),
                      delta: signedEur(cost.totalEur - tradeoff.cost.totalEur),
                    })}
                  </>
                )}
              </div>
            )}

            {cost && cost.warnings.length > 0 && (
              <div className="rounded-lg border border-line bg-bg1 px-3 py-2 text-[11.5px] text-tx2">
                {cost.warnings.map((w, i) => (
                  <div key={i}>{w}</div>
                ))}
              </div>
            )}

            {fixed && cost && cost.formatLines.length > 0 && (
              <div className="flex flex-wrap gap-1.5" data-dtf="format-lines">
                {cost.formatLines.map((l) => (
                  <span
                    key={l.formatId}
                    className="rounded-md border border-line bg-bg1 px-2 py-1 font-mono text-[11px] text-tx2"
                  >
                    {l.count} × {l.label} = {l.totalEur.toFixed(2)} €
                  </span>
                ))}
              </div>
            )}

            {/* --- preflight ------------------------------------------------ */}
            <section className="rounded-lg border border-line bg-bg1" data-dtf="preflight">
              <div className="flex items-center gap-2 px-3 py-2">
                <AlertTriangle
                  size={13}
                  className={errorCount > 0 ? 'text-dg' : warnCount > 0 ? 'text-tx2' : 'text-tx3'}
                />
                <span className="text-[12px] font-medium text-tx2">{t('dtf.pf.title')}</span>
                <span className="mono-dim text-[11px] text-tx3">
                  {issues.length === 0
                    ? t('dtf.pf.ok')
                    : t('dtf.pf.summary', { err: errorCount, warn: warnCount })}
                </span>
              </div>
              {issues.length > 0 && (
                <ul className="max-h-28 overflow-y-auto border-t border-line px-3 py-1.5">
                  {issues.map((i, k) => (
                    <IssueRow key={k} issue={i} label={labelOf(i.pieceKey)} />
                  ))}
                </ul>
              )}
              {errorCount > 0 && (
                <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2 text-[11.5px] text-dg">
                  {t('dtf.pf.blocked')}
                  <label className="ml-auto flex items-center gap-1.5 text-tx2">
                    <input
                      type="checkbox"
                      data-dtf="force-export"
                      checked={forceExport}
                      onChange={(e) => setForceExport(e.target.checked)}
                    />
                    {t('dtf.pf.override')}
                  </label>
                </div>
              )}
            </section>

            {result.unplaceable.length > 0 && (
              <div className="rounded-lg border border-dg/40 bg-dg/10 px-3 py-2 text-[12px] text-dg">
                {t('dtf.warn.unplaceable', { n: result.unplaceable.length })}
              </div>
            )}

            {result.sheets.length === 0 ? (
              <div className="rounded-xl border border-line bg-bg1 p-8 text-center text-[13px] text-tx2">
                {t('dtf.preview.empty')}
              </div>
            ) : (
              <div className="flex max-h-[40vh] flex-col gap-3 overflow-y-auto pr-1">
                {result.sheets.map((sheet, i) => (
                  <div key={i}>
                    <div className="mb-1 flex items-center gap-2 font-mono text-[11px] text-tx3">
                      <span className="min-w-0 truncate">
                        {sheet.formatId
                          ? t('dtf.preview.sheet_fixed', {
                              n: i + 1,
                              label:
                                proc?.formats.find((f) => f.id === sheet.formatId)?.label ??
                                sheet.formatId,
                              w: sheet.widthCm.toFixed(0),
                              len: sheet.lengthCm.toFixed(0),
                            })
                          : t('dtf.preview.sheet', {
                              n: i + 1,
                              len: sheet.lengthCm.toFixed(0),
                              w: sheet.widthCm.toFixed(0),
                            })}
                        {' · '}
                        {fillText(sheet.utilization, sheet.inkUtilization, t)}
                      </span>
                      <button
                        className="iconbtn ml-auto h-6 w-6 shrink-0 text-tx3"
                        data-dtf="export-one"
                        disabled={!canExport}
                        aria-label={t('dtf.zip.one_sheet', { n: i + 1 })}
                        title={t('dtf.zip.one_sheet', { n: i + 1 })}
                        onClick={() => void exportOneSheet(i)}
                      >
                        <Download size={12} />
                      </button>
                    </div>
                    <SheetPreview
                      sheet={sheet}
                      options={result.options}
                      sources={previewSources}
                      guides={guides}
                      pieceVersion={pieceVersion}
                      labelOf={labelOf}
                      onHover={setHover}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* ONE download. Naming the order is part of the export, not an
                afterthought: the archive is what the print shop receives. */}
            <div className="mt-auto flex flex-col gap-2">
              {askName && (
                <div className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-bg1 p-2.5">
                  <label className="min-w-[180px] flex-1">
                    <span className="mb-1 block text-[11.5px] text-tx2">
                      {t('dtf.zip.name_label')}
                    </span>
                    <input
                      className="input h-8 text-[12.5px]"
                      data-dtf="zip-name"
                      autoFocus
                      value={orderName}
                      placeholder={defaultOrderName}
                      aria-label={t('dtf.zip.name_label')}
                      onChange={(e) => setOrderName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void exportZip()
                        if (e.key === 'Escape') setAskName(false)
                      }}
                    />
                  </label>
                  <button
                    className="btn btn-primary h-8 justify-center"
                    data-dtf="zip-confirm"
                    onClick={() => void exportZip()}
                  >
                    <FileArchive size={13} />
                    {t('dtf.zip.confirm')}
                  </button>
                  <button
                    className="btn btn-ghost h-8 justify-center"
                    data-dtf="zip-cancel"
                    onClick={() => setAskName(false)}
                  >
                    {t('dtf.zip.cancel')}
                  </button>
                  <div className="w-full text-[10.5px] leading-relaxed text-tx3">
                    {t('dtf.zip.name_hint')}
                  </div>
                </div>
              )}
              <button
                className="btn btn-primary h-9 w-full justify-center"
                data-dtf="export-zip"
                disabled={!canExport}
                title={blocked ? t('dtf.export.blocked') : undefined}
                onClick={() => {
                  if (!orderName) setOrderName(defaultOrderName)
                  setAskName(true)
                }}
              >
                <FileArchive size={14} />
                {busy ?? t('dtf.zip.action', { n: result.sheets.length })}
              </button>
              <div className="text-[10.5px] leading-relaxed text-tx3">
                {t('dtf.zip.contents')} ·{' '}
                <span className="text-tx2">{planLegend(result, lang)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ---------------- full-width: editable supplier profile ---------------- */}
        <section className="rounded-lg border border-line bg-bg1">
          <button
            className="flex w-full items-center justify-between px-3 py-2 text-[12px] font-medium text-tx2"
            data-dtf="advanced-toggle"
            onClick={() => setAdvanced((v) => !v)}
          >
            {t('dtf.settings.advanced')}
            <ChevronDown
              size={14}
              className={clsx('transition-transform', advanced && 'rotate-180')}
            />
          </button>
          {advanced && supplier && proc && (
            <div className="flex max-h-[52vh] flex-col gap-4 overflow-y-auto border-t border-line p-3">
              {/* --- identity --- */}
              <div>
                <div className="panel-title mb-1.5">{t('dtf.settings.identity')}</div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <TxtField
                    label={t('dtf.settings.name')}
                    value={supplier.name}
                    onChange={(v) => patchSupplier({ name: v })}
                  />
                  <TxtField
                    label={t('dtf.settings.url')}
                    value={supplier.url}
                    onChange={(v) => patchSupplier({ url: v })}
                  />
                  <TxtField
                    label={t('dtf.settings.printsfrom')}
                    value={supplier.printsFrom}
                    onChange={(v) => patchSupplier({ printsFrom: v })}
                  />
                  <TxtField
                    label={t('dtf.settings.days')}
                    value={supplier.daysToParis}
                    onChange={(v) => patchSupplier({ daysToParis: v })}
                  />
                </div>
                <label className="mt-2 block">
                  <span className="mb-1 block text-[11.5px] text-tx2">
                    {t('dtf.settings.notes')}
                  </span>
                  <textarea
                    className="input min-h-[52px] text-[11.5px] leading-relaxed"
                    value={supplier.notes}
                    onChange={(e) => patchSupplier({ notes: e.target.value })}
                  />
                </label>
              </div>

              {/* --- commercial terms --- */}
              <div>
                <div className="panel-title mb-1.5">{t('dtf.settings.commercial')}</div>
                <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  <label className="block">
                    <span className="mb-1 block text-[11.5px] text-tx2">
                      {t('dtf.settings.vat')}
                    </span>
                    <select
                      className="input h-8 text-[12px]"
                      value={supplier.vatBasis}
                      onChange={(e) =>
                        patchSupplier({ vatBasis: e.target.value === 'HT' ? 'HT' : 'TTC' })
                      }
                    >
                      <option value="HT">HT</option>
                      <option value="TTC">TTC</option>
                    </select>
                  </label>
                  <NumField
                    label={t('dtf.settings.shipping')}
                    value={supplier.shippingEur}
                    min={0}
                    step={0.1}
                    onChange={(v) => patchSupplier({ shippingEur: v })}
                  />
                  <NumField
                    label={t('dtf.settings.freeship_eur')}
                    value={supplier.freeShipAtEur ?? 0}
                    min={0}
                    step={1}
                    onChange={(v) => patchSupplier({ freeShipAtEur: v > 0 ? v : null })}
                  />
                  <NumField
                    label={t('dtf.settings.freeship_lm')}
                    value={supplier.freeShipAtLm ?? 0}
                    min={0}
                    step={1}
                    onChange={(v) => patchSupplier({ freeShipAtLm: v > 0 ? v : null })}
                  />
                  <NumField
                    label={t('dtf.settings.minorder_lm')}
                    value={supplier.minOrderLm}
                    min={0}
                    step={0.5}
                    onChange={(v) => patchSupplier({ minOrderLm: v })}
                  />
                  <NumField
                    label={t('dtf.settings.minorder_eur')}
                    value={supplier.minOrderEur}
                    min={0}
                    step={1}
                    onChange={(v) => patchSupplier({ minOrderEur: v })}
                  />
                </div>
              </div>

              {/* --- process geometry --- */}
              <div>
                <div className="panel-title mb-1.5">
                  {t('dtf.settings.geometry')} — {proc.label}
                </div>
                <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  <TxtField
                    label={t('dtf.settings.proc_label')}
                    value={proc.label}
                    onChange={(v) => patchProcess({ label: v })}
                  />
                  <label className="block">
                    <span className="mb-1 block text-[11.5px] text-tx2">
                      {t('dtf.settings.billing')}
                    </span>
                    <select
                      className="input h-8 text-[12px]"
                      data-dtf="billing-select"
                      value={proc.billing}
                      onChange={(e) =>
                        patchProcess({ billing: e.target.value === 'fixed' ? 'fixed' : 'roll' })
                      }
                    >
                      <option value="roll">{t('dtf.settings.billing_roll')}</option>
                      <option value="fixed">{t('dtf.settings.billing_fixed')}</option>
                    </select>
                  </label>
                  <NumField
                    label={t('dtf.settings.width')}
                    value={proc.printableWidthCm}
                    min={1}
                    step={0.5}
                    onChange={(v) => patchProcess({ printableWidthCm: v })}
                  />
                  <NumField
                    label={t('dtf.settings.rollwidth')}
                    value={proc.rollWidthCm}
                    min={1}
                    step={0.5}
                    onChange={(v) => patchProcess({ rollWidthCm: v })}
                  />
                  <NumField
                    label={t('dtf.settings.maxlen')}
                    value={proc.maxLengthCm}
                    min={1}
                    step={10}
                    onChange={(v) => patchProcess({ maxLengthCm: v })}
                  />
                  <NumField
                    label={t('dtf.settings.minorder_lm_proc')}
                    value={proc.minOrderLm ?? 0}
                    min={0}
                    step={0.5}
                    onChange={(v) => patchProcess({ minOrderLm: v > 0 ? v : undefined })}
                  />
                  <NumField
                    label={t('dtf.settings.billing_step')}
                    hint={t('dtf.settings.billing_step_hint')}
                    value={proc.billingStepCm ?? 10}
                    min={0.1}
                    step={1}
                    onChange={(v) => patchProcess({ billingStepCm: v })}
                  />
                </div>
              </div>

              {/* --- prepress guidelines (drive preflight) --- */}
              <div>
                <div className="panel-title mb-1.5">{t('dtf.settings.guidelines')}</div>
                <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-8">
                  <NumField
                    label={t('dtf.settings.mindpi')}
                    value={proc.guidelines.minDpi}
                    min={1}
                    step={10}
                    onChange={(v) => patchGuidelines({ minDpi: v })}
                  />
                  <NumField
                    label={t('dtf.settings.line_colour')}
                    value={proc.guidelines.minLineMmColour}
                    min={0.05}
                    step={0.05}
                    onChange={(v) => patchGuidelines({ minLineMmColour: v })}
                  />
                  <NumField
                    label={t('dtf.settings.line_white')}
                    value={proc.guidelines.minLineMmWhite}
                    min={0.05}
                    step={0.05}
                    onChange={(v) => patchGuidelines({ minLineMmWhite: v })}
                  />
                  <NumField
                    label={t('dtf.settings.text_pt')}
                    value={proc.guidelines.minTextPt}
                    min={1}
                    step={0.5}
                    onChange={(v) => patchGuidelines({ minTextPt: v })}
                  />
                  <NumField
                    label={t('dtf.settings.g_margin')}
                    value={proc.guidelines.marginCm}
                    min={0}
                    step={0.1}
                    onChange={(v) => patchGuidelines({ marginCm: v })}
                  />
                  <NumField
                    label={t('dtf.settings.g_margin_end')}
                    value={proc.guidelines.marginEndCm ?? 0}
                    min={0}
                    step={0.1}
                    onChange={(v) => patchGuidelines({ marginEndCm: v })}
                  />
                  <NumField
                    label={t('dtf.settings.g_gap')}
                    value={proc.guidelines.gapCm}
                    min={0}
                    step={0.1}
                    onChange={(v) => patchGuidelines({ gapCm: v })}
                  />
                  <NumField
                    label={t('dtf.settings.maxw')}
                    hint={t('dtf.settings.unlimited')}
                    value={proc.guidelines.maxDesignWCm ?? 0}
                    min={0}
                    step={1}
                    onChange={(v) => patchGuidelines({ maxDesignWCm: v > 0 ? v : null })}
                  />
                  <NumField
                    label={t('dtf.settings.maxh')}
                    hint={t('dtf.settings.unlimited')}
                    value={proc.guidelines.maxDesignHCm ?? 0}
                    min={0}
                    step={1}
                    onChange={(v) => patchGuidelines({ maxDesignHCm: v > 0 ? v : null })}
                  />
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <ListField
                    key={`${supplier.id}:${proc.id}:files`}
                    label={t('dtf.settings.files')}
                    value={proc.guidelines.fileFormats}
                    onChange={(v) => patchGuidelines({ fileFormats: v })}
                  />
                  <TxtField
                    label={t('dtf.settings.colourmode')}
                    value={proc.guidelines.colourMode}
                    onChange={(v) => patchGuidelines({ colourMode: v })}
                  />
                  <TxtField
                    label={t('dtf.settings.transparency')}
                    value={proc.guidelines.transparency}
                    onChange={(v) => patchGuidelines({ transparency: v })}
                  />
                  <TxtField
                    label={t('dtf.settings.white')}
                    value={proc.guidelines.whiteUnderbase}
                    onChange={(v) => patchGuidelines({ whiteUnderbase: v })}
                  />
                  <TxtField
                    label={t('dtf.settings.cutting')}
                    value={proc.guidelines.cutting}
                    onChange={(v) => patchGuidelines({ cutting: v })}
                  />
                </div>
              </div>

              {/* --- price tiers (roll billing) --- */}
              <div>
                <div className="panel-title mb-1">{t('dtf.settings.tiers')}</div>
                <div className="mb-1.5 text-[11px] text-tx3">{t('dtf.settings.tiers_hint')}</div>
                <div className="flex flex-col gap-1">
                  {proc.priceTiers.map((tier, i) => (
                    <div key={i} className="flex max-w-md items-center gap-1.5">
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        aria-label={t('dtf.settings.tier_from')}
                        className="input h-7 flex-1 font-mono text-[11.5px]"
                        value={tier.minLm}
                        onChange={(e) =>
                          patchProcess({
                            priceTiers: proc.priceTiers.map((pt, k) =>
                              k === i ? { ...pt, minLm: Number(e.target.value) || 0 } : pt,
                            ),
                          })
                        }
                      />
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        aria-label={t('dtf.settings.tier_rate')}
                        className="input h-7 flex-1 font-mono text-[11.5px]"
                        value={tier.eurPerLm}
                        onChange={(e) =>
                          patchProcess({
                            priceTiers: proc.priceTiers.map((pt, k) =>
                              k === i ? { ...pt, eurPerLm: Number(e.target.value) || 0 } : pt,
                            ),
                          })
                        }
                      />
                      <button
                        className="iconbtn h-7 w-7 shrink-0"
                        aria-label={t('dtf.settings.tier_remove', { n: i + 1 })}
                        disabled={proc.billing === 'roll' && proc.priceTiers.length <= 1}
                        onClick={() =>
                          patchProcess({
                            priceTiers: proc.priceTiers.filter((_, k) => k !== i),
                          })
                        }
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  className="btn btn-ghost mt-1 h-7 text-[11.5px]"
                  onClick={() => {
                    const last = proc.priceTiers[proc.priceTiers.length - 1]
                    patchProcess({
                      priceTiers: [
                        ...proc.priceTiers,
                        { minLm: (last?.minLm ?? 0) + 10, eurPerLm: last?.eurPerLm ?? 8 },
                      ],
                    })
                  }}
                >
                  <Plus size={12} />
                  {t('dtf.settings.tier_add')}
                </button>
              </div>

              {/* --- catalogue formats (fixed billing) --- */}
              <div>
                <div className="panel-title mb-1">{t('dtf.settings.formats_title')}</div>
                <div className="mb-1.5 text-[11px] text-tx3">{t('dtf.settings.formats_hint')}</div>
                <div className="flex flex-col gap-1">
                  {proc.formats.map((f, i) => (
                    <div
                      key={i}
                      className="grid max-w-2xl grid-cols-[64px_1fr_58px_58px_66px_28px] items-center gap-1.5"
                    >
                      <input
                        aria-label={t('dtf.settings.format_id')}
                        className="input h-7 font-mono text-[11.5px]"
                        value={f.id}
                        onChange={(e) => patchFormat(proc, patchProcess, i, { id: e.target.value })}
                      />
                      <input
                        aria-label={t('dtf.settings.format_label')}
                        className="input h-7 text-[11.5px]"
                        value={f.label}
                        onChange={(e) =>
                          patchFormat(proc, patchProcess, i, { label: e.target.value })
                        }
                      />
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        aria-label={t('dtf.settings.format_w')}
                        className="input h-7 font-mono text-[11.5px]"
                        value={f.wCm}
                        onChange={(e) =>
                          patchFormat(proc, patchProcess, i, {
                            wCm: Number(e.target.value) || 0,
                          })
                        }
                      />
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        aria-label={t('dtf.settings.format_h')}
                        className="input h-7 font-mono text-[11.5px]"
                        value={f.hCm}
                        onChange={(e) =>
                          patchFormat(proc, patchProcess, i, {
                            hCm: Number(e.target.value) || 0,
                          })
                        }
                      />
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        aria-label={t('dtf.settings.format_price')}
                        className="input h-7 font-mono text-[11.5px]"
                        value={f.priceEur}
                        onChange={(e) =>
                          patchFormat(proc, patchProcess, i, {
                            priceEur: Number(e.target.value) || 0,
                          })
                        }
                      />
                      <button
                        className="iconbtn h-7 w-7 shrink-0"
                        aria-label={t('dtf.settings.format_remove', { n: i + 1 })}
                        disabled={proc.billing === 'fixed' && proc.formats.length <= 1}
                        onClick={() =>
                          patchProcess({ formats: proc.formats.filter((_, k) => k !== i) })
                        }
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  className="btn btn-ghost mt-1 h-7 text-[11.5px]"
                  onClick={() => patchProcess({ formats: [...proc.formats, newFormat(proc.formats)] })}
                >
                  <Plus size={12} />
                  {t('dtf.settings.format_add')}
                </button>
              </div>

              <div className="flex gap-2">
                <a
                  href={supplier.url}
                  target="_blank"
                  rel="noreferrer"
                  className="self-center text-[11px] text-cy"
                >
                  {supplier.url}
                </a>
                <button
                  className="btn ml-auto h-8 justify-center text-[12px]"
                  data-dtf="save-profiles"
                  onClick={saveProfiles}
                >
                  <Save size={13} />
                  {t('dtf.settings.save')}
                </button>
                <button
                  className="btn btn-ghost h-8 justify-center text-[12px]"
                  onClick={resetProfiles}
                >
                  <RefreshCcw size={13} />
                  {t('dtf.settings.reset')}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      {hover && (
        <div
          className="pointer-events-none fixed z-[80] rounded-md border border-line bg-bg3 px-2 py-1 font-mono text-[11px] text-tx shadow-lg"
          style={{ left: hover.x + 12, top: hover.y + 12 }}
        >
          {hover.text}
        </div>
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------------------

/** €-delta with an explicit sign — "+3.40" reads as a surcharge, "3.40" does not. */
const signedEur = (v: number): string => (v > 0 ? '+' : '') + v.toFixed(2)

/**
 * Render-cache key. A row's transfers depend on how the side is split, so the
 * clearance is part of the identity of what was rendered — not a reason to
 * throw the whole cache away when the operator nudges the setting.
 */
const cacheKey = (rowKey: string, clearanceIn: number): string =>
  `${rowKey}|${Math.round(clearanceIn * 1e4)}`

/** Signed cm, French-style — a bare "3,2" would not say which side of the axis. */
const signedCm = (v: number): string =>
  (Math.abs(v) < 0.05 ? '' : v > 0 ? '+' : '−') + fmtCm(Math.abs(v))

/** cm rounded to 0,1 mm — the manifest's precision for physical dimensions. */
const r2 = (v: number): number => Math.round(v * 100) / 100

const clampNum = (v: number, lo: number, hi: number): number =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo

/** cm with at most one decimal, French-style — "58" and "0,5", never "58.0". */
const fmtCm = (v: number): string =>
  (Math.round(v * 10) / 10).toString().replace('.', ',')

/**
 * Fill readout. When the true-shape packer measured real ink coverage, the INK
 * figure leads and the bounding-box one is labelled as such — because once
 * pieces interlock their boxes overlap and the box figure legitimately goes
 * past 100 %. Shown bare, "117 %" reads as a bug; shown as "encre 31 % · boîtes
 * 117 %" it reads as what it is, a sheet whose boxes overlap by 17 %.
 */
const fillText = (
  box: number,
  ink: number | undefined,
  t: ReturnType<typeof useDtfT>,
): string =>
  ink === undefined
    ? `${Math.round(box * 100)} %`
    : t('dtf.stats.util_both', {
        ink: Math.round(ink * 100),
        box: Math.round(box * 100),
      })

/** ASCII-safe stem for a single-file download (the ZIP keeps accents). */
const slugFile = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'dtf'

/** Merge queue rows, summing quantities of rows that share a key. */
function mergeRows(cur: QueueRow[], add: QueueRow[]): QueueRow[] {
  const next = [...cur]
  for (const row of add) {
    const i = next.findIndex((r) => r.key === row.key)
    if (i >= 0) next[i] = { ...next[i], qty: next[i].qty + row.qty }
    else next.push(row)
  }
  return next
}

/** Patch one catalogue format in place. */
function patchFormat(
  proc: DtfProcess,
  patchProcess: (p: Partial<DtfProcess>) => void,
  index: number,
  patch: Partial<SheetFormat>,
): void {
  patchProcess({
    formats: proc.formats.map((f, k) => (k === index ? { ...f, ...patch } : f)),
  })
}

/** A fresh, valid-by-construction catalogue format with a free id. */
function newFormat(formats: SheetFormat[]): SheetFormat {
  let n = formats.length + 1
  while (formats.some((f) => f.id === `fmt${n}`)) n++
  return { id: `fmt${n}`, label: `Format ${n}`, wCm: 21, hCm: 29.7, priceEur: 10 }
}

function IssueRow({ issue, label }: { issue: PreflightIssue; label: string }) {
  return (
    <li className="flex gap-1.5 py-0.5 text-[11px] leading-relaxed">
      <span
        className={clsx(
          'shrink-0 font-mono',
          issue.level === 'error' ? 'text-dg' : 'text-tx2',
        )}
      >
        {issue.level === 'error' ? '●' : '○'}
      </span>
      <span className="min-w-0">
        <span className="text-tx2">{label}</span>
        <span className="mono-dim mx-1 text-tx3">{issue.code}</span>
        <span className="text-tx3">{issue.message}</span>
      </span>
    </li>
  )
}

function Stat({ label, value, mono }: { label: string; value: string; mono: string }) {
  return (
    <span className="min-w-0">
      <span className="block text-[10px] uppercase tracking-wide text-tx3">{label}</span>
      <span className={clsx(mono, 'block max-w-[220px] truncate text-[14px] font-semibold')}>
        {value}
      </span>
    </span>
  )
}

function NumField({
  label,
  hint,
  value,
  min,
  step,
  onChange,
}: {
  label: string
  hint?: string
  value: number
  min: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <label className="block">
      <span className="mb-1 block truncate text-[11.5px] text-tx2" title={hint ?? label}>
        {label}
      </span>
      <input
        type="number"
        className="input h-8 font-mono text-[12px]"
        min={min}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(Math.max(min, v))
        }}
      />
    </label>
  )
}

function TxtField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className="block">
      <span className="mb-1 block truncate text-[11.5px] text-tx2">{label}</span>
      <input
        className="input h-8 text-[12px]"
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

/**
 * Comma-separated list editor. The visible text is local state so typing a
 * separator does not fight the normalised array; remount it (via `key`) when
 * the underlying process changes.
 */
function ListField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string[]
  onChange: (v: string[]) => void
}) {
  const [draft, setDraft] = useState(() => value.join(', '))
  return (
    <label className="block">
      <span className="mb-1 block truncate text-[11.5px] text-tx2">{label}</span>
      <input
        className="input h-8 font-mono text-[12px]"
        value={draft}
        aria-label={label}
        onChange={(e) => {
          setDraft(e.target.value)
          onChange(
            e.target.value
              .split(',')
              .map((s) => s.trim().toLowerCase())
              .filter(Boolean),
          )
        }}
      />
    </label>
  )
}

function SheetPreview({
  sheet,
  options,
  sources,
  guides,
  pieceVersion,
  labelOf,
  onHover,
}: {
  sheet: DtfSheet
  options: NestOptions
  sources: ReadonlyMap<string, RenderedPiece>
  guides: boolean
  pieceVersion: number
  labelOf: (sourceKey: string) => string
  onHover: (h: HoverInfo | null) => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const { canvas } = renderSheet(sheet, options, sources, {
      dpi: PREVIEW_DPI,
      guides,
      background: null,
    })
    el.width = canvas.width
    el.height = canvas.height
    const ctx = el.getContext('2d')!
    ctx.clearRect(0, 0, el.width, el.height)
    ctx.drawImage(canvas, 0, 0)
  }, [sheet, options, sources, guides, pieceVersion])

  const widthCm = sheet.widthCm > 0 ? sheet.widthCm : options.printableWidthCm

  return (
    <canvas
      ref={ref}
      data-dtf="sheet-canvas"
      className="checkerboard w-full cursor-crosshair rounded-lg border border-line"
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const cmX = ((e.clientX - rect.left) / rect.width) * widthCm
        const cmY = ((e.clientY - rect.top) / rect.height) * sheet.lengthCm
        const p = sheet.placements.find(
          (pl) =>
            cmX >= pl.xCm &&
            cmX <= pl.xCm + pl.wCm &&
            cmY >= pl.yCm &&
            cmY <= pl.yCm + pl.hCm,
        )
        if (!p) {
          onHover(null)
          return
        }
        onHover({
          x: e.clientX,
          y: e.clientY,
          text: `${labelOf(p.sourceKey)} · ${p.wCm.toFixed(1)} × ${p.hCm.toFixed(1)} cm${p.rotated ? ' · 90°' : ''}`,
        })
      }}
      onMouseLeave={() => onHover(null)}
    />
  )
}
