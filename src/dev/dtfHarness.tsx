/**
 * DTF dev harness — mounts the admin DtfModal against the real store (the
 * sample design provides printed sides) and exposes the pure nesting engine
 * on window.__dtf for scripts/dtf-verify.mjs, which runs its geometry
 * assertions in-page and screenshots the modal.
 */
import ReactDOM from 'react-dom/client'
import '@/styles.css'
import DtfModal from '@/app/modals/DtfModal'
import { nest, type DtfPiece, type NestOptions, type NestResult } from '@/lib/dtf/nesting'
import {
  INTERLOCK_MAX_CM,
  INTERLOCK_STOPS_CM,
  runNestJob,
  type NestJob,
  type ShapeNestOptions,
  type ShapePiece,
} from '@/lib/dtf/trueshape'
import { createNestClient } from '@/lib/dtf/nestClient'

/** The harness's own nesting channel — it also mounts DtfModal, which owns one
 *  of its own; sharing would make each cancel the other's job. */
const harnessNester = createNestClient()
import {
  MERGE_WHOLE_SIDE_IN,
  pieceMask,
  piecePlacementCm,
  renderPieces,
  type PieceMask,
  type RenderedPiece,
} from '@/lib/dtf/pieces'
import { clampSheetDpi, renderSheet } from '@/lib/dtf/sheet'
import { buildOrderZip, planLegend } from '@/lib/dtf/zipExport'
import { estimateCost, loadSuppliers, type CostEstimate } from '@/lib/dtf/suppliers'
import { APP_VERSION } from '@/config'
import { makeSampleDesign } from '@/content/sampleDesign'
import { addAsset, ensureAssetImage } from '@/state/assets'
import { useStore } from '@/state/store'
import type { Design, Layer, Side, SizeId } from '@/lib/types'

declare global {
  interface Window {
    __dtf: {
      nest: (pieces: DtfPiece[], options: NestOptions) => NestResult
      /** The true-shape packer, synchronous — same code path the Worker runs. */
      shape: (job: NestJob) => NestResult
      /** The Worker path, so verification can prove the two agree byte for byte. */
      shapeAsync: (job: NestJob) => Promise<NestResult>
      interlockMax: number
      /** The rungs the slider offers — the set monotonicity is claimed over. */
      interlockStops: readonly number[]
      suppliers: () => ReturnType<typeof loadSuppliers>
      estimate: (supplierId: string, lm: number) => CostEstimate | null
      /**
       * Render the sample design's sides through the real pipeline + masks.
       *
       * `merged: true` reproduces the pre-split behaviour — one transfer per
       * side, empty space included — which is what the bench measures the
       * split against. `row` is the ORDER LINE a piece came from (design side ×
       * size): quantities belong to the line, not to the transfer, so a bench
       * comparing split vs merged has to give every part of a line the same
       * quantity or it is not comparing the same order.
       */
      samplePieces: (
        dpi: number,
        opts?: { merged?: boolean },
      ) => Promise<
        {
          key: string
          row: string
          part: number
          parts: number
          wCm: number
          hCm: number
          /** Placement inside the (graded) print area, cm — the provenance. */
          topCm: number
          centerDxCm: number
          mask: PieceMask | null
        }[]
      >
      /** Rasterise a nested sheet and report the closest ink-to-ink distance. */
      collisionCheck: (
        result: NestResult,
        sheetIndex: number,
        pxPerCm: number,
        radiusCm?: number,
      ) => Promise<{
        minClearanceCm: number
        overlaps: number
        inked: number
        missing: number
      }>
      renderSheet: typeof renderSheet
      buildOrderZip: typeof buildOrderZip
      /**
       * Build a REAL order archive from a nested result and hand back its raw
       * bytes, so verification can crack the ZIP open in Node and check that
       * every PNG inside is the exact pixel size its sheet's cm × dpi implies.
       * Sheets are rendered from the sources `samplePieces` stashed, i.e. the
       * artwork the layout was actually nested from.
       */
      sampleOrderZip: (
        result: NestResult,
        dpi: number,
        opts?: { dropFirstSource?: boolean },
      ) => Promise<{
        base64: string
        fileName: string
        dpis: number[]
        cutplanDpi: number
        /** True when the export REFUSED to build (missing artwork). */
        refused?: boolean
        message?: string
      }>
      /**
       * Legend vs. drawn-guides probe: what `planLegend` promises against
       * whether the sheets actually carry shelf rows (the only case where the
       * plan draws corridors and vertical trims).
       */
      legendProbe: () => {
        tag: string
        legend: string
        promisesVerticals: boolean
        drawsVerticals: boolean
      }[]
      /**
       * Render each side of the sample design split (one transfer per visual)
       * and merged (the pre-split single transfer) and compare ink, boxes and
       * placement provenance.
       */
      splitProbe: (dpi?: number) => Promise<
        {
          side: Side
          parts: number
          keys: string[]
          inkSplit: number
          inkMerged: number
          boxSplitCm2: number
          boxMergedCm2: number
          placements: {
            part: number
            parts: number
            topCm: number
            centerDxCm: number
            areaWCm: number
            areaHCm: number
            insideArea: boolean
          }[]
        }[]
      >
      /**
       * Render each side of the PADDED-UPLOAD fixture with the geometry taken
       * from the ink and from the declared rectangle, and compare. The sample
       * design has nothing to trim; a customer's PNG does.
       */
      trimProbe: (dpi?: number) => Promise<
        {
          side: Side
          partsTrimmed: number
          partsDeclared: number
          inkTrimmed: number
          inkDeclared: number
          boxTrimmedCm2: number
          boxDeclaredCm2: number
          sizesTrimmed: [number, number][]
          sizesDeclared: [number, number][]
          placements: { part: number; topCm: number; centerDxCm: number; insideArea: boolean }[]
        }[]
      >
      /** The padded order as nest pieces, either geometry — same shape as `samplePieces`. */
      paddedPieces: (
        dpi: number,
        opts?: { measureFrom?: 'ink' | 'box' },
      ) => ReturnType<typeof window.__dtf.samplePieces>
      /** True once the modal preview has at least one sheet canvas drawn. */
      previewReady: () => boolean
    }
  }
}

/**
 * Ink-level clearance audit of one nested sheet.
 *
 * Rasterises every placement's own alpha into a per-piece OWNER grid, then
 * scans a bounded neighbourhood around each inked cell for a different owner.
 * This is the only honest overlap test for true-shape nesting: bounding boxes
 * legitimately overlap there, so the AABB assertions that verify the shelf
 * packer would fire on a perfectly good sheet.
 *
 * `radiusCm` bounds the search — the caller passes the required clearance, and
 * "nothing found inside that radius" IS the property under test. Cost is
 * O(inked cells × radius²), which stays in the tens of milliseconds at the
 * 4–8 px/cm the verification runs at.
 */
async function collisionCheck(
  result: NestResult,
  sheetIndex: number,
  pxPerCm: number,
  radiusCm = 1,
): Promise<{ minClearanceCm: number; overlaps: number; inked: number; missing: number }> {
  const sheet = result.sheets[sheetIndex]
  const W = Math.max(1, Math.round(sheet.widthCm * pxPerCm))
  const H = Math.max(1, Math.round(sheet.lengthCm * pxPerCm))
  const owner = new Int32Array(W * H).fill(-1)
  let overlaps = 0
  let missing = 0
  let inked = 0

  const sources = window.__dtfSources ?? new Map()
  const scratch = document.createElement('canvas')
  const ctx = scratch.getContext('2d', { willReadFrequently: true })!

  for (let i = 0; i < sheet.placements.length; i++) {
    const p = sheet.placements[i]
    const src = sources.get(p.sourceKey)
    if (!src) {
      missing++
      continue
    }
    // Render into a canvas the size of the PLACED footprint only — a full
    // sheet readback per piece would be a gigabyte of getImageData.
    const pw = Math.max(1, Math.ceil(p.wCm * pxPerCm))
    const ph = Math.max(1, Math.ceil(p.hCm * pxPerCm))
    scratch.width = pw
    scratch.height = ph
    ctx.clearRect(0, 0, pw, ph)
    const deg = p.rotCw ?? (p.rotated ? 90 : 0)
    const quarter = deg === 90 || deg === 270
    ctx.save()
    ctx.translate(pw / 2, ph / 2)
    if (deg) ctx.rotate((deg * Math.PI) / 180)
    const dw = quarter ? ph : pw
    const dh = quarter ? pw : ph
    ctx.drawImage(src.canvas, -dw / 2, -dh / 2, dw, dh)
    ctx.restore()
    const data = ctx.getImageData(0, 0, pw, ph).data
    const ox = Math.round(p.xCm * pxPerCm)
    const oy = Math.round(p.yCm * pxPerCm)
    for (let y = 0; y < ph; y++) {
      const gy = oy + y
      if (gy < 0 || gy >= H) continue
      for (let x = 0; x < pw; x++) {
        if (data[(y * pw + x) * 4 + 3] < 8) continue
        const gx = ox + x
        if (gx < 0 || gx >= W) continue
        const k = gy * W + gx
        if (owner[k] >= 0 && owner[k] !== i) overlaps++
        else if (owner[k] < 0) {
          owner[k] = i
          inked++
        }
      }
    }
  }

  const R = Math.max(1, Math.round(radiusCm * pxPerCm))
  let minPx2 = Infinity
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const id = owner[y * W + x]
      if (id < 0) continue
      for (let dy = -R; dy <= R; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= H) continue
        for (let dx = -R; dx <= R; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= W) continue
          const other = owner[ny * W + nx]
          if (other < 0 || other === id) continue
          const d2 = dx * dx + dy * dy
          if (d2 < minPx2) minPx2 = d2
        }
      }
    }
  return {
    minClearanceCm: minPx2 === Infinity ? Infinity : Math.sqrt(minPx2) / pxPerCm,
    overlaps,
    inked,
    missing,
  }
}

declare global {
  interface Window {
    /** Populated by samplePieces so collisionCheck and sampleOrderZip find the artwork. */
    __dtfSources?: Map<string, RenderedPiece>
  }
}

/**
 * A whole order archive, built from the very sources the layout was nested
 * from. `clampSheetDpi` is applied per sheet exactly as the modal does it, and
 * the effective DPIs come back so the verifier can predict every PNG's pixel
 * size from the sheet's cm geometry alone.
 */
const CUTPLAN_DPI = 32

async function sampleOrderZip(
  result: NestResult,
  dpi: number,
  opts: { dropFirstSource?: boolean } = {},
): Promise<{
  base64: string
  fileName: string
  dpis: number[]
  cutplanDpi: number
  refused?: boolean
  message?: string
}> {
  const supplier = loadSuppliers()[0]
  const process = supplier.processes.find((p) => p.id === 'dtf') ?? supplier.processes[0]
  const all = window.__dtfSources ?? new Map<string, RenderedPiece>()
  // `dropFirstSource` simulates an artwork render that failed after the layout
  // was computed — the export must refuse, not ship a sheet with a hole in it.
  const sources = new Map(all)
  if (opts.dropFirstSource) {
    const victim = [...sources.keys()][0]
    if (victim !== undefined) sources.delete(victim)
  }
  const labels = new Map<string, string>()
  for (const key of all.keys()) labels.set(key, `Visuel ${key}`)
  const dpis = result.sheets.map((s) =>
    clampSheetDpi(s.widthCm, s.lengthCm, dpi, process.guidelines.minDpi),
  )
  const empty = { base64: '', fileName: '', dpis, cutplanDpi: CUTPLAN_DPI }
  let blob: Blob
  let fileName: string
  try {
    const built = await buildOrderZip({
      orderName: 'Commande de vérification',
      // A FIXED instant: the archive must be reproducible, and a clock reading
      // here would make two runs of the verifier disagree for no reason.
      date: new Date(Date.UTC(2026, 6, 26, 9, 30, 0)),
      lang: 'fr',
      appVersion: APP_VERSION,
      result,
      supplier,
      process,
      cost: estimateCost(supplier, process, result.sheets),
      preflight: [],
      pieces: [...sources.entries()].map(([sourceKey, p]) => ({
        sourceKey,
        label: labels.get(sourceKey) ?? sourceKey,
        wCm: p.wCm,
        hCm: p.hCm,
        qty: 1,
        ...(p.parts > 1 ? { part: p.part, parts: p.parts } : {}),
        placement: piecePlacementCm(p),
      })),
      labels,
      sources,
      planSources: sources,
      effectiveDpis: dpis,
      requestedDpi: dpi,
      cutplanDpi: CUTPLAN_DPI,
      restarts: 1,
      flip: false,
    })
    blob = built.blob
    fileName = built.fileName
  } catch (e) {
    return { ...empty, refused: true, message: e instanceof Error ? e.message : String(e) }
  }
  // Base64 rather than a number array: the archive crosses into Node through
  // page.evaluate's JSON channel, where a megabyte of bytes is a megabyte of
  // comma-separated integers.
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { base64: btoa(bin), fileName, dpis, cutplanDpi: CUTPLAN_DPI, refused: false }
}

/**
 * Split-vs-merged audit of the real sample design, per side.
 *
 * The claim splitting makes is narrow and checkable: the SAME ink, in less
 * bounding-box area, with every transfer told where it goes. So this renders
 * each side both ways through the shipped pipeline and counts inked pixels on
 * each — pixels, not boxes, because the whole failure mode worth fearing is a
 * cluster crop that silently drops or duplicates artwork. Anything the split
 * loses shows up here as missing ink; anything it double-prints (a neighbour's
 * mark landing in two crops) shows up as extra.
 */
async function splitProbe(dpi = 48) {
  const design = makeSampleDesign()
  const inkOf = (p: RenderedPiece): number => {
    const ctx = p.canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return 0
    const d = ctx.getImageData(0, 0, p.canvas.width, p.canvas.height).data
    let n = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] >= 8) n++
    return n
  }
  const out = []
  for (const side of ['front', 'back'] as Side[]) {
    const split = await renderPieces(design, side, dpi)
    const merged = await renderPieces(design, side, dpi, undefined, {
      clearanceIn: MERGE_WHOLE_SIDE_IN,
    })
    out.push({
      side,
      parts: split.length,
      keys: split.map((p) => p.sourceKey),
      inkSplit: split.reduce((a, p) => a + inkOf(p), 0),
      inkMerged: merged.reduce((a, p) => a + inkOf(p), 0),
      boxSplitCm2: Math.round(split.reduce((a, p) => a + p.wCm * p.hCm, 0) * 10) / 10,
      boxMergedCm2: Math.round(merged.reduce((a, p) => a + p.wCm * p.hCm, 0) * 10) / 10,
      // Every transfer must be able to say where it belongs, or a split side
      // cannot be pressed at all.
      placements: split.map((p) => {
        const pl = piecePlacementCm(p)
        return {
          part: p.part,
          parts: p.parts,
          topCm: Math.round(pl.topCm * 100) / 100,
          centerDxCm: Math.round(pl.centerDxCm * 100) / 100,
          areaWCm: Math.round(pl.areaWCm * 100) / 100,
          areaHCm: Math.round(pl.areaHCm * 100) / 100,
          insideArea:
            p.areaRectIn.xIn >= -1e-6 &&
            p.areaRectIn.yIn >= -1e-6 &&
            p.areaRectIn.xIn + p.areaRectIn.wIn <= p.areaWIn + 1e-6 &&
            p.areaRectIn.yIn + p.areaRectIn.hIn <= p.areaHIn + 1e-6,
        }
      }),
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// The padded-upload fixture
// ---------------------------------------------------------------------------

/**
 * The sample design has nothing to trim, and that is not an accident: its text
 * is measured from glyph ink and its graphics are hand-authored on tight
 * viewBoxes. Measured on it, an ink trim recovers 2,6 % of one piece and moves
 * no roll length at all.
 *
 * What the shop actually prints is customer uploads, and a customer's PNG is
 * padded — exported from Illustrator on a square artboard, cut out of a photo
 * by the background remover, dropped in with room around the mark. So the trim
 * has to be measured against THAT, and the fixture is built here rather than
 * shipped as a file so the padding is an exact, stated number instead of
 * whatever a checked-in asset happens to contain.
 *
 * Two of the three uploads are placed so their DECLARED boxes overlap while
 * their ink sits inches apart — the false merge, which costs a whole extra
 * transfer's worth of empty film and is invisible in the preview.
 */
const UPLOADS = [
  {
    // Chest lockup on a square artboard: the mark fills half of it each way.
    name: 'chest-lockup',
    pxW: 1200,
    pxH: 1200,
    ink: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
    place: { wIn: 9, hIn: 9, xIn: 0, yIn: -1.5, rotation: 0 },
    side: 'front' as Side,
  },
  {
    // Hem strip: a wide bar sitting low in a much taller export.
    name: 'hem-strip',
    pxW: 1800,
    pxH: 600,
    ink: { x: 0.05, y: 0.62, w: 0.9, h: 0.3 },
    place: { wIn: 6, hIn: 2, xIn: 0, yIn: 3.1, rotation: 0 },
    side: 'front' as Side,
  },
  {
    // Background-removed subject: off-centre, and turned.
    name: 'cutout-subject',
    pxW: 1000,
    pxH: 700,
    ink: { x: 0.08, y: 0.3, w: 0.34, h: 0.5 },
    place: { wIn: 8, hIn: 5.6, xIn: -0.6, yIn: -2, rotation: 12 },
    side: 'back' as Side,
  },
]

/** A transparent PNG with one opaque rectangle in it, at a stated fraction. */
async function paddedPng(
  pxW: number,
  pxH: number,
  ink: { x: number; y: number; w: number; h: number },
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = pxW
  canvas.height = pxH
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#20242c'
  ctx.fillRect(
    Math.round(ink.x * pxW),
    Math.round(ink.y * pxH),
    Math.round(ink.w * pxW),
    Math.round(ink.h * pxH),
  )
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no blob'))), 'image/png'),
  )
}

let paddedDesignCache: Design | null = null

/** Built once per tab: `addAsset` writes to IndexedDB and decoding is not free. */
async function makePaddedDesign(): Promise<Design> {
  if (paddedDesignCache) return paddedDesignCache
  const base = makeSampleDesign()
  const layers: Layer[] = []
  for (const u of UPLOADS) {
    const meta = await addAsset(await paddedPng(u.pxW, u.pxH, u.ink), u.name)
    await ensureAssetImage(meta.id, 'original')
    layers.push({
      id: `padded-${u.name}`,
      type: 'image',
      side: u.side,
      name: u.name,
      assetId: meta.id,
      opacity: 1,
      flipX: false,
      useCutout: false,
      ...u.place,
    })
  }
  paddedDesignCache = { ...base, id: 'padded-upload-fixture', name: 'Padded uploads', layers }
  return paddedDesignCache
}

/** Inked pixels (alpha ≥ the mask floor) on a rendered transfer. */
function inkPx(p: RenderedPiece): number {
  const ctx = p.canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return 0
  const d = ctx.getImageData(0, 0, p.canvas.width, p.canvas.height).data
  let n = 0
  for (let i = 3; i < d.length; i += 4) if (d[i] >= 8) n++
  return n
}

/**
 * Ink-measured vs declared-rectangle geometry, on the padded fixture, through
 * the shipped pipeline.
 *
 * The claim the trim makes is exactly as narrow as the split's: the SAME ink,
 * in less bounding box. So this counts inked pixels on both arms. Anything the
 * trim clips shows up here immediately as missing ink, and a trim that clips is
 * a reprint — the one failure worth building a harness for.
 */
async function trimProbe(dpi = 48) {
  const design = await makePaddedDesign()
  const out = []
  for (const side of ['front', 'back'] as Side[]) {
    const trimmed = await renderPieces(design, side, dpi)
    const declared = await renderPieces(design, side, dpi, undefined, { measureFrom: 'box' })
    out.push({
      side,
      partsTrimmed: trimmed.length,
      partsDeclared: declared.length,
      inkTrimmed: trimmed.reduce((a, p) => a + inkPx(p), 0),
      inkDeclared: declared.reduce((a, p) => a + inkPx(p), 0),
      boxTrimmedCm2: Math.round(trimmed.reduce((a, p) => a + p.wCm * p.hCm, 0) * 10) / 10,
      boxDeclaredCm2: Math.round(declared.reduce((a, p) => a + p.wCm * p.hCm, 0) * 10) / 10,
      sizesTrimmed: trimmed.map((p) => [r1(p.wCm), r1(p.hCm)] as [number, number]),
      sizesDeclared: declared.map((p) => [r1(p.wCm), r1(p.hCm)] as [number, number]),
      // Where each transfer goes must still land inside the print area, and it
      // must have MOVED — a trim that shrinks the box without moving the press
      // instruction is a transfer pressed off-centre by the discarded margin.
      placements: trimmed.map((p) => {
        const pl = piecePlacementCm(p)
        return {
          part: p.part,
          topCm: r2(pl.topCm),
          centerDxCm: r2(pl.centerDxCm),
          insideArea:
            p.areaRectIn.xIn >= -1e-6 &&
            p.areaRectIn.yIn >= -1e-6 &&
            p.areaRectIn.xIn + p.areaRectIn.wIn <= p.areaWIn + 1e-6 &&
            p.areaRectIn.yIn + p.areaRectIn.hIn <= p.areaHIn + 1e-6,
        }
      }),
    })
  }
  return out
}

const r1 = (v: number) => Math.round(v * 10) / 10
const r2 = (v: number) => Math.round(v * 100) / 100

/**
 * The padded order, as nest pieces — the same shape `samplePieces` returns so
 * the bench can run both arms through the identical packing code.
 */
async function paddedPieces(dpi: number, opts: { measureFrom?: 'ink' | 'box' } = {}) {
  const design = await makePaddedDesign()
  const out: Awaited<ReturnType<typeof window.__dtf.samplePieces>> = []
  const store: Map<string, RenderedPiece> = window.__dtfSources ?? new Map()
  const sizes: SizeId[] = ['S', 'M', 'L', 'XL']
  for (const side of ['front', 'back'] as Side[])
    for (const size of sizes) {
      const row = `${opts.measureFrom ?? 'ink'}:${side}#${size}`
      const parts = await renderPieces(design, side, dpi, size, {
        ...(opts.measureFrom ? { measureFrom: opts.measureFrom } : {}),
        baseKey: row,
      })
      for (const p of parts) {
        store.set(p.sourceKey, p)
        const pl = piecePlacementCm(p)
        out.push({
          key: p.sourceKey,
          row,
          part: p.part,
          parts: p.parts,
          wCm: p.wCm,
          hCm: p.hCm,
          topCm: pl.topCm,
          centerDxCm: pl.centerDxCm,
          mask: pieceMask(p),
        })
      }
    }
  window.__dtfSources = store
  return out
}

/**
 * Does the cutting-plan legend describe the lines the plan actually draws?
 *
 * `drawGuides` keys off `shelfYsCm`: only a shelf-packed sheet carries rows,
 * and only then does it draw full-width corridors plus vertical trims. Any
 * legend that says "puis les verticales" on a sheet without rows is sending
 * someone to cut lines that were never printed.
 */
function legendProbe() {
  const geom = {
    printableWidthCm: 58,
    maxLengthCm: 90,
    gapCm: 0.5,
    edgeMarginCm: 0,
    edgeMarginSideCm: 0,
    edgeMarginEndCm: 0,
    billingStepCm: 10,
  }
  // Concave alpha masks, or the true-shape packer never beats the shelf one
  // and every case below would come back tagged `shelf`, making the check
  // vacuous. Built arithmetically — no canvas, so this stays pure.
  const mask = (
    wCm: number,
    hCm: number,
    kind: 'arch' | 'tri',
  ): { mask: Uint8Array; maskW: number; maskH: number } => {
    const W = Math.max(2, Math.round(wCm / 0.1))
    const H = Math.max(2, Math.round(hCm / 0.1))
    const m = new Uint8Array(W * H)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const u = (x + 0.5) / W
        const v = (y + 0.5) / H
        const d = Math.hypot((u - 0.5) * 2, 1 - v)
        const ink = kind === 'arch' ? d <= 1 && d >= 0.55 : v >= Math.abs(u - 0.5) * 2
        if (ink) m[y * W + x] = 1
      }
    return { mask: m, maskW: W, maskH: H }
  }
  const pieces: ShapePiece[] = [
    { id: 'a', sourceKey: 'a', wCm: 30, hCm: 18, qty: 10, allowRotate: true, ...mask(30, 18, 'arch') },
    { id: 'b', sourceKey: 'b', wCm: 22, hCm: 20, qty: 12, allowRotate: true, ...mask(22, 20, 'tri') },
    { id: 'c', sourceKey: 'c', wCm: 9, hCm: 9, qty: 16, allowRotate: true },
  ]
  const cases: { tag: string; result: NestResult }[] = [
    { tag: 'shelf', result: nest(pieces, geom) },
    {
      tag: 'strips',
      result: runNestJob({ pieces, options: { ...geom, maxInterlockCm: 0, restarts: 8 } }),
    },
    {
      tag: 'interlock',
      result: runNestJob({ pieces, options: { ...geom, maxInterlockCm: 2, restarts: 8 } }),
    },
    {
      tag: 'maxfill',
      result: runNestJob({
        pieces,
        options: { ...geom, maxInterlockCm: INTERLOCK_MAX_CM, restarts: 8 },
      }),
    },
  ]
  return cases.map(({ tag, result }) => {
    const legend = planLegend(result, 'fr')
    return {
      tag,
      legend,
      promisesVerticals: legend.includes('verticales'),
      drawsVerticals: result.sheets.every((s) => s.shelfYsCm.length > 0),
    }
  })
}

window.__dtf = {
  nest,
  shape: (job) => runNestJob(job),
  shapeAsync: (job) => harnessNester.nest(job),
  interlockMax: INTERLOCK_MAX_CM,
  interlockStops: INTERLOCK_STOPS_CM,
  suppliers: () => loadSuppliers(),
  estimate: (supplierId, lm) => {
    const p = loadSuppliers().find((s) => s.id === supplierId)
    return p ? estimateCost(p, lm) : null
  },
  samplePieces: async (dpi, opts = {}) => {
    const out: Awaited<ReturnType<typeof window.__dtf.samplePieces>> = []
    const store = new Map<string, RenderedPiece>()
    const sizes: SizeId[] = ['S', 'M', 'L', 'XL']
    for (const side of ['front', 'back'] as Side[])
      for (const size of sizes) {
        const row = `${side}#${size}`
        const parts = await renderPieces(makeSampleDesign(), side, dpi, size, {
          ...(opts.merged ? { clearanceIn: MERGE_WHOLE_SIDE_IN } : {}),
          baseKey: row,
        })
        for (const p of parts) {
          store.set(p.sourceKey, p)
          const pl = piecePlacementCm(p)
          out.push({
            key: p.sourceKey,
            row,
            part: p.part,
            parts: p.parts,
            wCm: p.wCm,
            hCm: p.hCm,
            topCm: pl.topCm,
            centerDxCm: pl.centerDxCm,
            mask: pieceMask(p),
          })
        }
      }
    window.__dtfSources = store
    return out
  },
  collisionCheck,
  renderSheet,
  buildOrderZip,
  sampleOrderZip,
  legendProbe,
  splitProbe,
  trimProbe,
  paddedPieces,
  previewReady: () => {
    const els = document.querySelectorAll<HTMLCanvasElement>('canvas[data-dtf="sheet-canvas"]')
    if (els.length === 0) return false
    for (const el of els) if (el.width < 4 || el.height < 4) return false
    return true
  },
}

export type { ShapePiece, ShapeNestOptions }

// The modal closes via the store; keep it force-open for the harness.
useStore.setState((s) => ({ modals: { ...s.modals, dtf: true } }))

function Harness() {
  const open = useStore((s) => s.modals.dtf)
  return (
    <div className="min-h-screen bg-bg0">
      {open ? (
        <DtfModal />
      ) : (
        <button
          className="btn m-6"
          onClick={() =>
            useStore.setState((s) => ({ modals: { ...s.modals, dtf: true } }))
          }
        >
          Reopen DTF modal
        </button>
      )}
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Harness />)
