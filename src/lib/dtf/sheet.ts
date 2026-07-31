/**
 * Gang-sheet rendering — nested sheet → canvas at exact physical scale.
 *
 * Two render modes off one code path (parity by construction):
 *  - PRINT file: transparent background, artwork only (guides OFF) — this is
 *    the PNG uploaded to the DTF supplier.
 *  - CUTTING PLAN: the same geometry with the cut-guide layer ON, on a light
 *    paper-friendly background.
 *
 * THE CUTTING PLAN DEPENDS ON THE PACKER, and pretending otherwise is how you
 * hand an operator a plan whose lines cut through artwork. The shelf packer
 * produces genuine full-width corridors, so its plan draws them plus the
 * vertical trims between neighbours — one long chop, then verticals. The
 * true-shape packer produces no rows at all, so its plan draws (a) the maximal
 * EMPTY BANDS, which are the full-width chops that do exist, and (b) the
 * per-piece outline at bbox + clearance, which is what you actually cut
 * around. The legend states which mode produced the sheet, because the two
 * plans look similar and are cut very differently.
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
  /**
   * One line printed on the plan saying which packer and which interlock
   * produced it. Without it the operator cannot tell a straight-cut sheet from
   * an interlocked one, and they are cut differently.
   */
  legend?: string
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
    // `rotCw` is authoritative when present (the true-shape packer can emit
    // 180°/270°); `rotated` is the shelf packer's two-state legacy form.
    // Canvas y grows downward, so a positive angle IS clockwise.
    const deg = p.rotCw ?? (p.rotated ? 90 : 0)
    const quarter = deg === 90 || deg === 270
    ctx.save()
    ctx.translate(x + w / 2, y + h / 2)
    if (deg !== 0) ctx.rotate((deg * Math.PI) / 180)
    // Source canvas is in INPUT orientation; at a quarter turn the placed w/h
    // are swapped, so the unrotated draw size is (h × w).
    const dw = quarter ? h : w
    const dh = quarter ? w : h
    ctx.drawImage(src.canvas, -dw / 2, -dh / 2, dw, dh)
    ctx.restore()
  }

  if (opts.guides) drawGuides(ctx, sheet, options, widthCm, pxPerCm, opts.labels, opts.legend)

  return { canvas, dpi: opts.dpi, pxPerCm }
}

/** A full-width chop is only worth drawing when a blade can actually follow it. */
const MIN_BAND_CM = 1

/**
 * Rows of the sheet that NO piece occupies, clearance included — the
 * full-width chops that genuinely exist. On a shelf-packed sheet these are
 * exactly the inter-shelf corridors; on a true-shape sheet there are usually
 * only two or three, and drawing the shelf corridors there would slice through
 * artwork.
 */
export function emptyBandsCm(
  sheet: DtfSheet,
  gapCm: number,
): { fromCm: number; toCm: number }[] {
  if (sheet.placements.length === 0) return []
  const spans = sheet.placements
    .map((p) => ({ a: p.yCm - gapCm / 2, b: p.yCm + p.hCm + gapCm / 2 }))
    .sort((x, y) => x.a - y.a)
  const bands: { fromCm: number; toCm: number }[] = []
  let reach = spans[0].b
  for (let i = 1; i < spans.length; i++) {
    if (spans[i].a > reach) bands.push({ fromCm: reach, toCm: spans[i].a })
    if (spans[i].b > reach) reach = spans[i].b
  }
  // The billing tail after the last piece is a chop too, and it is the one the
  // operator most wants to see: it is the film that was paid for and not used.
  if (sheet.lengthCm > reach) bands.push({ fromCm: reach, toCm: sheet.lengthCm })
  return bands.filter((b) => b.toCm - b.fromCm >= MIN_BAND_CM)
}

function drawGuides(
  ctx: CanvasRenderingContext2D,
  sheet: DtfSheet,
  options: NestOptions,
  widthCm: number,
  pxPerCm: number,
  labels?: ReadonlyMap<string, string>,
  legend?: string,
): void {
  const gap = options.gapCm
  const W = widthCm * pxPerCm
  const lw = Math.max(1, Math.round(pxPerCm * 0.035)) // ≈ 0.35 mm
  const dash = [lw * 6, lw * 5]
  /** Shelf rows exist ⇒ the shelf packer made this sheet. */
  const shelves = sheet.shelfYsCm.length > 0

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

  if (shelves) {
    // --- shelf packer: straight full-width corridors + vertical trims -------
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

    for (let i = 0; i < sheet.shelfYsCm.length; i++) {
      const y = (sheet.shelfYsCm[i] + sheet.shelfHsCm[i] + gap / 2) * pxPerCm
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(W, y)
      ctx.stroke()
    }

    for (let i = 0; i < perShelf.length; i++) {
      const row = [...perShelf[i]].sort((a, b) => a.xCm - b.xCm)
      if (row.length === 0) continue
      const yTop = (sheet.shelfYsCm[i] - gap / 2) * pxPerCm
      const yBot = (sheet.shelfYsCm[i] + sheet.shelfHsCm[i] + gap / 2) * pxPerCm
      const cuts: number[] = []
      for (let k = 0; k < row.length - 1; k++) cuts.push(row[k].xCm + row[k].wCm + gap / 2)
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
  } else {
    // --- true-shape: only the chops that really exist ----------------------
    for (const b of emptyBandsCm(sheet, gap)) {
      const y = ((b.fromCm + b.toCm) / 2) * pxPerCm
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(W, y)
      ctx.stroke()
    }
  }

  // Per-piece rounded outline at bbox + gap/2 — on an interlocked sheet this
  // is THE cut line, so it is drawn last and stays opaque.
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
      const deg = p.rotCw ?? (p.rotated ? 90 : 0)
      // The orientation arrow is not decoration: with four rotations in play,
      // a sleeve print handed over without one gets pressed sideways.
      const text = deg === 0 ? label : `${ARROWS[deg]} ${label}`
      ctx.fillText(
        text,
        (p.xCm + 0.15) * pxPerCm,
        (p.yCm + 0.12) * pxPerCm,
        (p.wCm - 0.3) * pxPerCm,
      )
    }
  }

  if (legend) {
    ctx.globalAlpha = 1
    ctx.setLineDash([])
    const fs = Math.max(8, 0.36 * pxPerCm)
    ctx.font = `${fs}px "JetBrains Mono", monospace`
    ctx.textBaseline = 'top'
    const pad = fs * 0.5
    const tw = ctx.measureText(legend).width
    ctx.fillStyle = 'rgba(255,255,255,0.88)'
    ctx.fillRect(0, 0, Math.min(W, tw + 2 * pad), fs + 2 * pad)
    ctx.fillStyle = GUIDE_TEXT
    ctx.fillText(legend, pad, pad, W - 2 * pad)
  }
  ctx.restore()
}

/** Which way is "up" for a rotated transfer, in one glyph. */
const ARROWS: Record<number, string> = { 90: '▶', 180: '▼', 270: '◀' }

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
  /**
   * Which transfer of its side this is, and how many that side was split into.
   * Absent on a side that prints as one piece.
   */
  part?: number
  parts?: number
  /**
   * WHERE IT GOES on the garment: the transfer's box inside that side's
   * (graded) print area, cm. A split side hands the press several transfers
   * that used to be one file, and without these numbers there is nothing in the
   * archive saying which goes where — the manifest is the traceability record,
   * so it carries them even though nesting never reads them.
   *
   * `topCm` is the drop from the top edge of the print area (itself a fixed
   * distance below the collar); `centerDxCm` is the signed offset of the
   * transfer's centre from the area's centre line, + to the wearer's right as
   * seen on the artwork.
   */
  placement?: {
    topCm: number
    leftCm: number
    centerDxCm: number
    areaWCm: number
    areaHCm: number
  }
}

export interface DtfManifest {
  generatedAt: string
  tool: 'tshop-dtf'
  /** App build the archive came from — the first thing to check on a dispute. */
  appVersion: string
  /** Operator's order / basket name; the archive is named from it. */
  orderName: string
  /**
   * How the layout was produced. Reproducing a manifest requires ALL of these:
   * same packer, same interlock, same restart count, same flip permission —
   * change any one and the placements move.
   */
  nesting: {
    packer: 'shelf' | 'trueshape'
    interlockCm: number
    restarts: number
    /** 180°/270° were allowed (artwork declared to have no "up"). */
    flip: boolean
  }
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
    /** Real ink coverage; absent when the shelf packer produced the sheet. */
    inkUtilization?: number
    placements: {
      id: string
      sourceKey: string
      xCm: number
      yCm: number
      wCm: number
      hCm: number
      rotated: boolean
      rotCw?: 0 | 90 | 180 | 270
    }[]
  }[]
  totals: {
    pieces: number
    lengthCm: number
    lengthM: number
    utilization: number
    inkUtilization?: number
    unplaceable: string[]
  }
  cost: CostBreakdown | null
}

/**
 * Assemble the order-tracking manifest (JSON-serializable).
 *
 * `generatedAt` is a PARAMETER, not a `Date.now()` read: the whole export —
 * archive name, ZIP member timestamps, README and manifest — must agree on one
 * instant, and a function that reads the clock cannot be re-run to reproduce
 * a delivered archive.
 */
export function buildManifest(args: {
  result: NestResult
  supplier: SupplierProfile
  process: DtfProcess
  cost: CostBreakdown | null
  requestedDpi: number
  effectiveDpis: number[]
  pieces: ManifestPiece[]
  preflight?: PreflightIssue[]
  orderName?: string
  appVersion?: string
  restarts?: number
  flip?: boolean
  generatedAt?: Date
}): DtfManifest {
  const { result, supplier, process: proc } = args
  return {
    generatedAt: (args.generatedAt ?? new Date()).toISOString(),
    tool: 'tshop-dtf',
    appVersion: args.appVersion ?? '',
    orderName: args.orderName ?? '',
    nesting: {
      packer: result.packer,
      interlockCm: result.interlockCm,
      restarts: args.restarts ?? 1,
      flip: args.flip ?? false,
    },
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
      ...(s.inkUtilization !== undefined ? { inkUtilization: s.inkUtilization } : {}),
      placements: s.placements.map((p) => ({ ...p })),
    })),
    totals: {
      pieces: result.totalPieces,
      lengthCm: result.totalLengthCm,
      lengthM: result.totalLengthM,
      utilization: result.totalUtilization,
      ...(result.totalInkUtilization !== undefined
        ? { inkUtilization: result.totalInkUtilization }
        : {}),
      unplaceable: result.unplaceable,
    },
    cost: args.cost,
  }
}
