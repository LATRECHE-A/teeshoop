/**
 * Gang-sheet rendering — nested sheet → canvas at exact physical scale.
 *
 * Two render modes off one code path (parity by construction):
 *  - PRINT file: transparent background, artwork only (guides OFF) — this is
 *    the PNG uploaded to the DTF supplier.
 *  - CUTTING PLAN: same geometry with the cut-guide layer ON (dashed
 *    full-width corridor lines at shelf boundaries offset gap/2, dashed
 *    verticals between pieces, thin rounded outline per piece at bbox+gap/2,
 *    optional labels) on a light paper-friendly background.
 *
 * DPI is auto-clamped so one canvas stays under ~140 M px, but never below
 * the supplier's minimum DPI — the effective value is surfaced to the UI.
 */
import type { DtfSheet, NestOptions, NestResult } from './nesting'
import type { RenderedPiece } from './pieces'
import type { PreflightIssue } from './preflight'
import type {
  BillingModel,
  CostBreakdown,
  DtfProcess,
  ProcessId,
  SupplierProfile,
} from './suppliers'
import { CM_PER_IN } from '@/lib/units'

export const SHEET_TARGET_DPI = 300
/** Soft canvas-area budget (px) — keeps toBlob/encode reliable. */
export const MAX_SHEET_PX = 140_000_000

/**
 * Largest DPI ≤ `targetDpi` that keeps `widthCm × lengthCm` under the pixel
 * budget — floored at `minDpi` (supplier requirement wins over the budget;
 * callers surface the effective value so the admin sees what happened).
 */
export function clampSheetDpi(
  widthCm: number,
  lengthCm: number,
  targetDpi: number,
  minDpi: number,
): number {
  const wIn = widthCm / CM_PER_IN
  const hIn = lengthCm / CM_PER_IN
  if (wIn <= 0 || hIn <= 0) return targetDpi
  const cap = Math.floor(Math.sqrt(MAX_SHEET_PX / (wIn * hIn)))
  return Math.max(minDpi, Math.min(targetDpi, Math.max(1, cap)))
}

export interface SheetRenderOpts {
  /** Pixel density (px per inch). Use clampSheetDpi for export sizes. */
  dpi: number
  /** Draw the cut-guide layer (cutting plan) — OFF for the print file. */
  guides?: boolean
  /** Opaque background fill; omit/null for transparent (print file). */
  background?: string | null
  /** sourceKey → human label, drawn on the cutting plan next to each piece. */
  labels?: ReadonlyMap<string, string>
}

export interface SheetRenderResult {
  canvas: HTMLCanvasElement
  dpi: number
  pxPerCm: number
}

const GUIDE_CUT = '#0F8BD0' // full-width + vertical scissor lines
const GUIDE_BOX = '#D62F7C' // per-piece outline
const GUIDE_TEXT = '#3E434A'

/**
 * Render one nested sheet. Pieces are drawn at exact physical scale from
 * `sources` (keyed by placement.sourceKey); missing sources are skipped so a
 * partial preview never throws.
 *
 * The canvas is `sheet.widthCm × sheet.lengthCm` — on fixed billing that is
 * the EXACT catalogue format (the whole sheet is bought and delivered), on
 * roll billing the printable width × the billed length.
 */
export function renderSheet(
  sheet: DtfSheet,
  options: NestOptions,
  sources: ReadonlyMap<string, RenderedPiece>,
  opts: SheetRenderOpts,
): SheetRenderResult {
  const pxPerCm = opts.dpi / CM_PER_IN
  const widthCm = sheet.widthCm > 0 ? sheet.widthCm : options.printableWidthCm
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(2, Math.round(widthCm * pxPerCm))
  canvas.height = Math.max(2, Math.round(sheet.lengthCm * pxPerCm))
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'

  if (opts.background) {
    ctx.fillStyle = opts.background
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  // --- artwork ---------------------------------------------------------
  for (const p of sheet.placements) {
    const src = sources.get(p.sourceKey)
    if (!src) continue
    const x = p.xCm * pxPerCm
    const y = p.yCm * pxPerCm
    const w = p.wCm * pxPerCm
    const h = p.hCm * pxPerCm
    ctx.save()
    ctx.translate(x + w / 2, y + h / 2)
    if (p.rotated) ctx.rotate(Math.PI / 2)
    // Source canvas is in INPUT orientation; when rotated the placed w/h are
    // swapped, so the unrotated draw size is (h × w).
    const dw = p.rotated ? h : w
    const dh = p.rotated ? w : h
    ctx.drawImage(src.canvas, -dw / 2, -dh / 2, dw, dh)
    ctx.restore()
  }

  if (opts.guides) drawGuides(ctx, sheet, options, widthCm, pxPerCm, opts.labels)

  return { canvas, dpi: opts.dpi, pxPerCm }
}

function drawGuides(
  ctx: CanvasRenderingContext2D,
  sheet: DtfSheet,
  options: NestOptions,
  widthCm: number,
  pxPerCm: number,
  labels?: ReadonlyMap<string, string>,
): void {
  const gap = options.gapCm
  const W = widthCm * pxPerCm
  const lw = Math.max(1, Math.round(pxPerCm * 0.035)) // ≈ 0.35 mm
  const dash = [lw * 6, lw * 5]

  // Group placements per shelf (top-aligned ⇒ yCm equals the shelf top).
  const perShelf: (typeof sheet.placements)[] = sheet.shelfYsCm.map(() => [])
  for (const p of sheet.placements) {
    let si = 0
    let bd = Infinity
    for (let i = 0; i < sheet.shelfYsCm.length; i++) {
      const d = Math.abs(sheet.shelfYsCm[i] - p.yCm)
      if (d < bd) {
        bd = d
        si = i
      }
    }
    perShelf[si].push(p)
  }

  ctx.save()
  ctx.lineWidth = lw
  ctx.setLineDash(dash)
  ctx.strokeStyle = GUIDE_CUT

  // Fixed format: solid trim border at the exact delivered sheet size, so the
  // cutting plan shows what physically arrives (a roll has no bottom edge).
  if (sheet.formatId) {
    ctx.save()
    ctx.setLineDash([])
    ctx.strokeRect(lw / 2, lw / 2, W - lw, sheet.lengthCm * pxPerCm - lw)
    ctx.restore()
  }

  // Full-width straight corridor cuts: below each shelf, offset gap/2.
  for (let i = 0; i < sheet.shelfYsCm.length; i++) {
    const y = (sheet.shelfYsCm[i] + sheet.shelfHsCm[i] + gap / 2) * pxPerCm
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(W, y)
    ctx.stroke()
  }

  // Dashed verticals between pieces of one shelf (+ trailing trim cut).
  for (let i = 0; i < perShelf.length; i++) {
    const row = [...perShelf[i]].sort((a, b) => a.xCm - b.xCm)
    if (row.length === 0) continue
    const yTop = (sheet.shelfYsCm[i] - gap / 2) * pxPerCm
    const yBot = (sheet.shelfYsCm[i] + sheet.shelfHsCm[i] + gap / 2) * pxPerCm
    const cuts: number[] = []
    for (let k = 0; k < row.length - 1; k++)
      cuts.push(row[k].xCm + row[k].wCm + gap / 2)
    const last = row[row.length - 1]
    const rightEdge = last.xCm + last.wCm
    if (rightEdge + gap < widthCm - options.edgeMarginCm) cuts.push(rightEdge + gap / 2)
    for (const cx of cuts) {
      const x = cx * pxPerCm
      ctx.beginPath()
      ctx.moveTo(x, Math.max(0, yTop))
      ctx.lineTo(x, yBot)
      ctx.stroke()
    }
  }

  // Per-piece rounded outline at bbox + gap/2.
  ctx.strokeStyle = GUIDE_BOX
  ctx.setLineDash([])
  ctx.globalAlpha = 0.85
  const r = Math.max(2, Math.min(gap / 2, 0.4) * pxPerCm)
  for (const p of sheet.placements) {
    const x = (p.xCm - gap / 2) * pxPerCm
    const y = (p.yCm - gap / 2) * pxPerCm
    const w = (p.wCm + gap) * pxPerCm
    const h = (p.hCm + gap) * pxPerCm
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, r)
    ctx.stroke()
  }

  // Labels (cutting plan only readable on paper — small mono text).
  if (labels) {
    ctx.globalAlpha = 1
    ctx.fillStyle = GUIDE_TEXT
    const fs = Math.max(7, 0.32 * pxPerCm)
    ctx.font = `${fs}px "JetBrains Mono", monospace`
    ctx.textBaseline = 'top'
    for (const p of sheet.placements) {
      const label = labels.get(p.sourceKey)
      if (!label) continue
      ctx.fillText(
        label,
        (p.xCm + 0.15) * pxPerCm,
        (p.yCm + 0.12) * pxPerCm,
        (p.wCm - 0.3) * pxPerCm,
      )
    }
  }
  ctx.restore()
}

/** Encode a rendered sheet as a PNG blob. */
export function sheetToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b)
      else reject(new Error('PNG encode failed'))
    }, 'image/png')
  })
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export interface ManifestPiece {
  sourceKey: string
  label: string
  wCm: number
  hCm: number
  qty: number
}

export interface DtfManifest {
  generatedAt: string
  tool: 'tshop-dtf'
  supplier: {
    id: string
    name: string
    url: string
    printsFrom: string
    vatBasis: 'HT' | 'TTC'
  }
  process: {
    id: ProcessId
    label: string
    billing: BillingModel
    printableWidthCm: number
    maxLengthCm: number
    minDpi: number
    fileFormats: string[]
    colourMode: string
  }
  options: NestOptions
  dpi: { requested: number; effectivePerSheet: number[] }
  pieces: ManifestPiece[]
  /** Prepress issues at export time (empty array = nothing detectable). */
  preflight: PreflightIssue[]
  sheets: {
    index: number
    formatId: string | null
    widthCm: number
    lengthCm: number
    rawLengthCm: number
    utilization: number
    placements: {
      id: string
      sourceKey: string
      xCm: number
      yCm: number
      wCm: number
      hCm: number
      rotated: boolean
    }[]
  }[]
  totals: {
    pieces: number
    lengthCm: number
    lengthM: number
    utilization: number
    unplaceable: string[]
  }
  cost: CostBreakdown | null
}

/** Assemble the order-tracking manifest (JSON-serializable). */
export function buildManifest(args: {
  result: NestResult
  supplier: SupplierProfile
  process: DtfProcess
  cost: CostBreakdown | null
  requestedDpi: number
  effectiveDpis: number[]
  pieces: ManifestPiece[]
  preflight?: PreflightIssue[]
}): DtfManifest {
  const { result, supplier, process: proc } = args
  return {
    generatedAt: new Date().toISOString(),
    tool: 'tshop-dtf',
    supplier: {
      id: supplier.id,
      name: supplier.name,
      url: supplier.url,
      printsFrom: supplier.printsFrom,
      vatBasis: supplier.vatBasis,
    },
    process: {
      id: proc.id,
      label: proc.label,
      billing: proc.billing,
      printableWidthCm: proc.printableWidthCm,
      maxLengthCm: proc.maxLengthCm,
      minDpi: proc.guidelines.minDpi,
      fileFormats: [...proc.guidelines.fileFormats],
      colourMode: proc.guidelines.colourMode,
    },
    options: result.options,
    dpi: { requested: args.requestedDpi, effectivePerSheet: args.effectiveDpis },
    pieces: args.pieces,
    preflight: args.preflight ?? [],
    sheets: result.sheets.map((s) => ({
      index: s.index,
      formatId: s.formatId,
      widthCm: s.widthCm,
      lengthCm: s.lengthCm,
      rawLengthCm: s.rawLengthCm,
      utilization: s.utilization,
      placements: s.placements.map((p) => ({ ...p })),
    })),
    totals: {
      pieces: result.totalPieces,
      lengthCm: result.totalLengthCm,
      lengthM: result.totalLengthM,
      utilization: result.totalUtilization,
      unplaceable: result.unplaceable,
    },
    cost: args.cost,
  }
}
