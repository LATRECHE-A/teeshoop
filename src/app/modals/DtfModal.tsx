/**
 * DTF gang-sheet automation — admin modal.
 *
 * Queue printed sides — from the ORDER BASKET (design × side × qty, the real
 * order) or manually (current design + saved designs) — pick a supplier AND a
 * process (DTF textile / UV-DTF), auto-nest onto that process's geometry
 * (open-ended roll billed per linear metre, or catalogue sheet formats billed
 * per sheet), preflight the artwork against the process guidelines, preview the
 * result live, then export the supplier print PNG(s), a cutting-plan PNG per
 * sheet and a JSON manifest.
 *
 * Everything the automation depends on is editable here and persisted: process
 * geometry, price tiers, sheet formats and every prepress rule. cm is
 * first-class everywhere; all figures in JetBrains Mono.
 */
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  FileJson,
  Image as ImageIcon,
  Plus,
  RefreshCcw,
  Save,
  Scissors,
  ShoppingBag,
  Trash2,
} from 'lucide-react'
import clsx from 'clsx'
import Modal from './Modal'
import { useStore } from '@/state/store'
import { listSavedMetas, loadSavedDesign } from '@/state/savedDesigns'
import { linePrintedSides, type BasketLine } from '@/state/basket'
import { downloadBlob, slugify } from '@/lib/download'
import {
  nest,
  type DtfPiece,
  type DtfSheet,
  type NestOptions,
} from '@/lib/dtf/nesting'
import {
  pieceSourceKey,
  printedSides,
  renderPiece,
  type RenderedPiece,
} from '@/lib/dtf/pieces'
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
  buildManifest,
  clampSheetDpi,
  renderSheet,
  sheetToPngBlob,
  SHEET_TARGET_DPI,
} from '@/lib/dtf/sheet'
import { useDtfT } from './dtfI18n'
import type { Design, SavedDesignMeta, Side, SizeId } from '@/lib/types'

/** Preview pixel density (px/inch) — 58 cm roll ≈ 640 px wide. */
const PREVIEW_DPI = 28
/** Cutting-plan export density — crisp guides, small files. */
const CUTPLAN_DPI = 64
const DEFAULT_QTY = 10

interface QueueRow {
  /** Stable row identity, nest piece id AND rendered-piece cache key. */
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
  | { status: 'ok'; piece: RenderedPiece }

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

  const [gap, setGap] = useState(() => bootProcess(suppliers)?.guidelines.gapCm ?? 0.8)
  const [margin, setMargin] = useState(
    () => bootProcess(suppliers)?.guidelines.marginCm ?? 1,
  )
  const [allowRotate, setAllowRotate] = useState(true)
  const [guides, setGuides] = useState(true)
  const [advanced, setAdvanced] = useState(false)

  /** Spacing follows the process guidelines on every switch (never on edit). */
  const adoptSpacing = (p: DtfProcess | null | undefined) => {
    if (!p) return
    setGap(p.guidelines.gapCm)
    setMargin(p.guidelines.marginCm)
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
  useEffect(() => {
    for (const row of rows) {
      if (cacheRef.current.has(row.key)) continue
      cacheRef.current.set(row.key, { status: 'pending' })
      renderPiece(row.design, row.side, PREVIEW_DPI, row.size)
        .then((piece) => {
          cacheRef.current.set(
            row.key,
            piece ? { status: 'ok', piece } : { status: 'empty' },
          )
          bumpPieces()
        })
        .catch(() => {
          cacheRef.current.set(row.key, { status: 'empty' })
          bumpPieces()
        })
    }
  }, [rows])

  const pieceOf = (key: string): PieceState =>
    cacheRef.current.get(key) ?? { status: 'pending' }

  // --- nesting + preflight --------------------------------------------------
  const options: NestOptions = useMemo(
    () => ({
      printableWidthCm: proc?.printableWidthCm ?? 58,
      maxLengthCm: proc?.maxLengthCm ?? 250,
      gapCm: gap,
      edgeMarginCm: margin,
    }),
    [proc, gap, margin],
  )

  const pieces = useMemo(() => {
    const out: DtfPiece[] = []
    for (const row of rows) {
      const st = pieceOf(row.key)
      if (st.status !== 'ok' || row.qty <= 0) continue
      const p = st.piece
      out.push({
        id: row.key,
        sourceKey: row.key,
        wCm: p.wCm,
        hCm: p.hCm,
        qty: row.qty,
        allowRotate,
        // Prepress metadata for preflight: source pixels at the PLACED size
        // (p.srcDpi is the artwork's native ceiling, never the preview DPI —
        // all-vector artwork reports null and simply skips the DPI check).
        ...(p.srcDpi !== null
          ? { srcPxW: Math.round(p.srcDpi * p.wIn), srcPxH: Math.round(p.srcDpi * p.hIn) }
          : {}),
        // Everything the renderer emits is transparent-background by design.
        hasAlpha: true,
      })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, allowRotate, pieceVersion])

  const result = useMemo(
    () => (proc ? nest(pieces, proc, options) : nest(pieces, options)),
    [pieces, proc, options],
  )

  const issues = useMemo(() => (proc ? preflight(pieces, proc) : []), [pieces, proc])
  const errorCount = issues.filter((i) => i.level === 'error').length
  const warnCount = issues.length - errorCount
  const [forceExport, setForceExport] = useState(false)
  const blocked = hasErrors(issues) && !forceExport

  const previewSources = useMemo(() => {
    const map = new Map<string, RenderedPiece>()
    for (const row of rows) {
      const st = pieceOf(row.key)
      if (st.status === 'ok') map.set(row.key, st.piece)
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, pieceVersion])

  const rowByKey = useMemo(() => {
    const m = new Map<string, QueueRow>()
    for (const r of rows) m.set(r.key, r)
    return m
  }, [rows])

  // The size belongs in the label: on a graded order the cutting plan carries
  // several transfers of the same design and only the size tells them apart.
  const labelOf = (sourceKey: string): string => {
    const row = rowByKey.get(sourceKey)
    if (!row) return sourceKey
    const base = `${row.design.name} · ${t('side.' + row.side)}`
    return row.size ? `${base} · ${row.size}` : base
  }

  // --- stats -----------------------------------------------------------------
  const minDpi = proc?.guidelines.minDpi ?? 1
  const targetDpi = Math.max(SHEET_TARGET_DPI, minDpi)
  const effectiveDpis = result.sheets.map((s) =>
    clampSheetDpi(s.widthCm || options.printableWidthCm, s.lengthCm, targetDpi, minDpi),
  )
  const effectiveDpi = effectiveDpis.length ? Math.min(...effectiveDpis) : targetDpi
  const cost =
    supplier && proc && result.sheets.length > 0
      ? estimateCost(supplier, proc, result.sheets)
      : null
  const fixed = proc?.billing === 'fixed'

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
      const st = pieceOf(row.key)
      if (st.status !== 'ok' || row.qty <= 0) continue
      const hit = acc.get(row.baseKey)
      if (hit) {
        hit.qty += row.qty
        continue
      }
      const k = printScaleK(row.design, row.size)
      acc.set(row.baseKey, {
        id: row.baseKey,
        sourceKey: row.baseKey,
        wCm: st.piece.wCm / k,
        hCm: st.piece.hCm / k,
        qty: row.qty,
        allowRotate,
        hasAlpha: true,
      })
    }
    return [...acc.values()]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, allowRotate, pieceVersion])

  /** Null unless grading actually multiplies transfers on THIS order. */
  const tradeoff = useMemo(() => {
    if (singleSizePieces.length >= pieces.length) return null
    const r = proc
      ? nest(singleSizePieces, proc, options)
      : nest(singleSizePieces, options)
    return {
      transfers: pieces.length,
      singleTransfers: singleSizePieces.length,
      cost:
        supplier && proc && r.sheets.length > 0
          ? estimateCost(supplier, proc, r.sheets)
          : null,
    }
  }, [singleSizePieces, pieces, proc, supplier, options])

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
  const baseName = `dtf-${supplier?.id ?? 'roll'}-${proc?.id ?? 'dtf'}-${slugify(design.name)}`

  const canExport = !busy && result.sheets.length > 0 && !blocked

  const renderHiResSources = async (
    dpi: number,
    onStep: (n: number, total: number) => void,
  ): Promise<Map<string, RenderedPiece>> => {
    const keys = new Set(result.sheets.flatMap((s) => s.placements.map((p) => p.sourceKey)))
    const map = new Map<string, RenderedPiece>()
    let n = 0
    for (const key of keys) {
      onStep(++n, keys.size)
      const row = rowByKey.get(key)
      if (!row) continue
      const piece = await renderPiece(row.design, row.side, dpi, row.size)
      if (piece) map.set(key, piece)
    }
    return map
  }

  const exportPrint = async () => {
    if (!canExport) return
    setBusy(t('dtf.export.busy', { n: 0, total: result.sheets.length }))
    try {
      const maxDpi = Math.max(...effectiveDpis)
      const sources = await renderHiResSources(maxDpi, (n, total) =>
        setBusy(t('dtf.export.busy', { n, total: total + result.sheets.length })),
      )
      for (let i = 0; i < result.sheets.length; i++) {
        setBusy(t('dtf.export.busy', { n: i + 1, total: result.sheets.length }))
        const { canvas } = renderSheet(result.sheets[i], result.options, sources, {
          dpi: effectiveDpis[i],
          guides: false,
          background: null,
        })
        const blob = await sheetToPngBlob(canvas)
        downloadBlob(blob, `${baseName}-planche-${i + 1}-impression.png`)
      }
      toast('ok', t('dtf.export.done'))
    } catch {
      toast('error', t('dtf.export.failed'))
    } finally {
      setBusy(null)
    }
  }

  const exportCutplan = async () => {
    if (!canExport) return
    setBusy(t('dtf.export.busy', { n: 1, total: result.sheets.length }))
    try {
      const labels = new Map<string, string>()
      for (const row of rows) labels.set(row.key, labelOf(row.key))
      for (let i = 0; i < result.sheets.length; i++) {
        setBusy(t('dtf.export.busy', { n: i + 1, total: result.sheets.length }))
        const { canvas } = renderSheet(result.sheets[i], result.options, previewSources, {
          dpi: CUTPLAN_DPI,
          guides: true,
          background: '#F4F6F8',
          labels,
        })
        const blob = await sheetToPngBlob(canvas)
        downloadBlob(blob, `${baseName}-planche-${i + 1}-decoupe.png`)
      }
      toast('ok', t('dtf.export.done'))
    } catch {
      toast('error', t('dtf.export.failed'))
    } finally {
      setBusy(null)
    }
  }

  const exportManifest = () => {
    if (!supplier || !proc || !canExport) return
    const manifestPieces = rows
      .map((row) => {
        const st = pieceOf(row.key)
        if (st.status !== 'ok') return null
        return {
          sourceKey: row.key,
          label: labelOf(row.key),
          wCm: Math.round(st.piece.wCm * 100) / 100,
          hCm: Math.round(st.piece.hCm * 100) / 100,
          qty: row.qty,
        }
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)
    const manifest = buildManifest({
      result,
      supplier,
      process: proc,
      cost,
      requestedDpi: targetDpi,
      effectiveDpis,
      pieces: manifestPieces,
      preflight: issues,
    })
    downloadBlob(
      new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }),
      `${baseName}-manifeste.json`,
    )
    toast('ok', t('dtf.export.done'))
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
                  const label = labelOf(row.key)
                  const bad = result.unplaceable.includes(row.key)
                  const rowIssues = issues.filter((i) => i.pieceKey === row.key)
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
                            ? `${st.piece.wCm.toFixed(1)} × ${st.piece.hCm.toFixed(1)} cm`
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

              <div className="grid grid-cols-2 gap-2">
                <NumField
                  label={t('dtf.settings.gap')}
                  value={gap}
                  min={0}
                  step={0.1}
                  onChange={setGap}
                />
                <NumField
                  label={t('dtf.settings.margin')}
                  value={margin}
                  min={0}
                  step={0.1}
                  onChange={setMargin}
                />
              </div>
              <label className="mt-2 flex items-center gap-2 text-[12.5px] text-tx2">
                <input
                  type="checkbox"
                  checked={allowRotate}
                  onChange={(e) => setAllowRotate(e.target.checked)}
                />
                {t('dtf.settings.rotate')}
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
                value={`${Math.round(result.totalUtilization * 100)} %`}
                mono={mono}
              />
              <Stat label={t('dtf.stats.dpi')} value={String(effectiveDpi)} mono={mono} />
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
                    <div className="mb-1 font-mono text-[11px] text-tx3">
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
                      {Math.round(sheet.utilization * 100)} %
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

            <div className="mt-auto flex flex-wrap gap-2">
              <button
                className="btn btn-primary h-9 flex-1 justify-center"
                data-dtf="export-print"
                disabled={!canExport}
                title={blocked ? t('dtf.export.blocked') : undefined}
                onClick={() => void exportPrint()}
              >
                <ImageIcon size={14} />
                {busy ?? t('dtf.export.print')}
              </button>
              <button
                className="btn h-9 flex-1 justify-center"
                data-dtf="export-cutplan"
                disabled={!canExport}
                title={blocked ? t('dtf.export.blocked') : undefined}
                onClick={() => void exportCutplan()}
              >
                <Scissors size={14} />
                {t('dtf.export.cutplan')}
              </button>
              <button
                className="btn h-9 flex-1 justify-center"
                data-dtf="export-manifest"
                disabled={!canExport}
                title={blocked ? t('dtf.export.blocked') : undefined}
                onClick={exportManifest}
              >
                <FileJson size={14} />
                {t('dtf.export.manifest')}
              </button>
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
