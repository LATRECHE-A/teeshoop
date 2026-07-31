/**
 * Design side → DTF piece bridge.
 *
 * Turns a printed side into the transfers that will actually be nested: one
 * transparent canvas per independent artwork item, cropped to that item's
 * tight, rotation-aware bounding box in INCHES (same math family as
 * sideArtworkSqIn in renderDesign.ts). The SAME rect is used for the nesting
 * geometry and for the pixels, so placements and artwork can never disagree.
 *
 * ONE PIECE PER ITEM, NOT ONE PER SIDE
 * ------------------------------------
 * A side used to emit ONE transfer spanning every layer on it. A chest logo
 * with a separate hem line then became a single tall transfer that is mostly
 * empty film, and the nester — true-shape or not — could only interlock that
 * one blob.
 *
 * Measured on the sample basket (58 cm roll, 5 mm gap, 8 order lines = 60
 * garments, shipped 2 cm interlock): the same order drops from 270 cm of roll
 * to 130 cm, 1,57 m² of film to 0,75 m² — 52 % less. At straight strips it is
 * 340 → 140 cm, at maximum fill 240 → 130 cm; the sample front alone goes from
 * a 444,8 cm² box to three boxes totalling 181,2 cm² for exactly the same ink.
 * `scripts/dtf-bench.mjs` re-measures it on every run (`basket` vs
 * `basketMerged`), and `scripts/dtf-verify.mjs` asserts the ink is identical.
 *
 * THE PRICE, stated because it is real: that order becomes 16 transfers to
 * press instead of 8 — more weeding, more handling, more chances to press one
 * crooked. Which is why every piece carries where it goes (below), and why the
 * modal lets the operator turn the split off for a job where handling costs
 * more than film.
 *
 * Two layers stay in the same piece ONLY when their boxes, each grown by half
 * of `clearanceIn`, intersect — union-find over the side's layers. Artwork that
 * overlaps or touches can therefore never be cut apart; everything else becomes
 * its own transfer. `MERGE_WHOLE_SIDE_IN` restores the old one-per-side
 * behaviour for callers that want to measure against it.
 *
 * Each piece draws ONLY ITS OWN LAYERS. Cropping a shared full-area render
 * would be cheaper by one canvas, but two clusters' union boxes can legitimately
 * overlap (an L-shaped lockup with a small mark tucked in its corner), and the
 * crop would then print the neighbour's ink onto this transfer as well — the
 * same graphic pressed twice onto the garment. Drawing per piece makes that
 * impossible, and skips the resample the old crop-from-full-canvas path did.
 *
 * WHERE IT GOES — placement provenance
 * ------------------------------------
 * Three transfers instead of one is only safe if the press operator knows where
 * each one goes. Every piece therefore carries `areaRectIn`, its box inside the
 * (graded) print area, and `piecePlacementCm` turns that into the two numbers a
 * press is set up from: the drop from the top of the print area and the offset
 * from its centre line. That travels to the queue list, the cutting-plan labels,
 * the README and the manifest — not just to the nesting geometry.
 *
 * GRADING (src/lib/printScale.ts)
 * -------------------------------
 * A piece is identified by (design, side, **size**, part). With a `size` the
 * artwork AND the print area are scaled by the design's grading factor `k`, so
 * `wCm`, `hCm` and the pixels are the transfer that garment size really needs —
 * a graded 3XL piece is physically larger than the same design at S, and the
 * gang sheet has to carry one distinct transfer per size instead of one for the
 * whole order. Omitting `size` (or a `fixed` design) keeps k = 1. Grading is
 * uniform about the area centre, so it never changes how a side splits: part
 * numbering is the same on every size.
 */
import type { Design, Layer, RectIn, Side, SizeIn, SizeId } from '@/lib/types'
import {
  drawLayerContent,
  getAreaSizeIn,
  measureLayer,
  prepareSide,
  sideLayers,
} from '@/lib/renderDesign'
import { printScaleK, scaleLayers } from '@/lib/printScale'
import { getCachedAssetImage } from '@/state/assets'
import { CM_PER_IN, degToRad } from '@/lib/units'

/** Ignore slivers thinner than this (inches) — nothing printable there. */
const MIN_EXTENT_IN = 0.05

/**
 * How close two layers must be to stay ONE transfer, inches.
 *
 * 0.2 in = 5,1 mm, and it is the film gap in disguise. Two pieces nested apart
 * end up `gapCm` from each other — 5 mm on every researched supplier — plus a
 * scissor cut, so splitting artwork that already sits closer than that frees no
 * film worth having while handing the operator two transfers to align to under
 * a millimetre on the garment. Above it, the gap on the shirt is wide enough
 * that a press guide is the right tool anyway.
 *
 * It also swallows edge bleed roughly sixty times over. The widest thing that
 * leaks past a layer's MEASURED box is an anti-aliased edge, ≈ 1 px = 0,08 mm
 * at 300 dpi; a graphic's soft shadow is baked inside its own SVG viewBox and
 * is therefore already inside the box. So a cluster's crop can neither clip a
 * feathered edge that mattered nor sit close enough to a neighbour for the two
 * to be confused — the same reasoning `MASK_ALPHA_FLOOR` applies to the mask.
 */
export const PIECE_CLEARANCE_IN = 0.2

/**
 * Clearance sentinel meaning "never split this side": larger than any garment,
 * so every layer lands in one cluster and the side emits the single transfer it
 * did before splitting existed. Finite on purpose — Infinity survives the
 * arithmetic here but not a JSON round trip.
 */
export const MERGE_WHOLE_SIDE_IN = 1e6

export interface PieceSplitOptions {
  /**
   * Merge distance, inches. Defaults to `PIECE_CLEARANCE_IN`; pass
   * `MERGE_WHOLE_SIDE_IN` for one transfer per side. This is the ONLY knob:
   * there is deliberately no minimum piece size, because merging a small item
   * into a distant neighbour means buying the empty film between them, which is
   * the exact waste splitting exists to remove.
   */
  clearanceIn?: number
}

/**
 * Stable artwork identity: one rendered canvas per (design side, garment size).
 * A graded design prints a different physical transfer per size, so the size is
 * part of the identity; without one the key is the historical `id:side`.
 */
export const pieceSourceKey = (design: Design, side: Side, size?: SizeId): string =>
  `${design.id}:${side}${size ? `#${size}` : ''}`

/**
 * Identity of one PART of a side.
 *
 * A side yielding a single piece keeps its base key VERBATIM: the modal
 * persists that key as a render-cache key and the nester uses it as a piece id,
 * so a side that was never split has to keep addressing the same transfer.
 * Only a genuinely split side grows the `~n` suffix, 1-based in the part order
 * (top to bottom, then left to right).
 */
export const piecePartKey = (baseKey: string, part: number, parts: number): string =>
  parts <= 1 ? baseKey : `${baseKey}~${part}`

// ---------------------------------------------------------------------------
// Splitting a side into independent items
// ---------------------------------------------------------------------------

/** Rotation-aware extent of one layer, inches from the print-area centre. */
interface Box {
  x0: number
  x1: number
  y0: number
  y1: number
}

function layerBox(l: Layer): Box {
  const m = measureLayer(l, 100)
  const wI = m.w / 100
  const hI = m.h / 100
  const r = Math.abs(degToRad(l.rotation))
  const hx = (wI / 2) * Math.abs(Math.cos(r)) + (hI / 2) * Math.abs(Math.sin(r))
  const hy = (wI / 2) * Math.abs(Math.sin(r)) + (hI / 2) * Math.abs(Math.cos(r))
  return { x0: l.xIn - hx, x1: l.xIn + hx, y0: l.yIn - hy, y1: l.yIn + hy }
}

/**
 * Group layers into independent items, union-find over every pair.
 *
 * Each box is grown by HALF the clearance, so two layers merge exactly when
 * the empty space between them is under `clearanceIn` — the number the UI
 * shows. Overlapping layers merge whatever the clearance is, which is the
 * guarantee that matters: you cannot cut a graphic that overlaps another one.
 *
 * O(n²) on the layers of ONE side (single digits in practice), and the union
 * always keeps the smaller root, so the grouping does not depend on which pair
 * happens to be visited first.
 */
function clusterLayers(layers: Layer[], clearanceIn: number): Layer[][] {
  const n = layers.length
  const parent = new Int32Array(n)
  for (let i = 0; i < n; i++) parent[i] = i
  const find = (i: number): number => {
    let r = i
    while (parent[r] !== r) r = parent[r]
    while (parent[i] !== r) {
      const next = parent[i]
      parent[i] = r
      i = next
    }
    return r
  }
  const boxes = layers.map(layerBox)
  const c = Math.max(0, clearanceIn) / 2
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const a = boxes[i]
      const b = boxes[j]
      if (a.x0 - c > b.x1 + c || b.x0 - c > a.x1 + c) continue
      if (a.y0 - c > b.y1 + c || b.y0 - c > a.y1 + c) continue
      const ra = find(i)
      const rb = find(j)
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb)
    }
  const groups = new Map<number, Layer[]>()
  for (let i = 0; i < n; i++) {
    const r = find(i)
    const g = groups.get(r)
    if (g) g.push(layers[i])
    else groups.set(r, [layers[i]])
  }
  return [...groups.values()]
}

/** Clamp an item's extent to the print area; null when nothing printable is left. */
function clampToArea(b: Box, area: SizeIn): RectIn | null {
  const x0 = Math.max(-area.wIn / 2, b.x0)
  const x1 = Math.min(area.wIn / 2, b.x1)
  const y0 = Math.max(-area.hIn / 2, b.y0)
  const y1 = Math.min(area.hIn / 2, b.y1)
  if (x1 - x0 < MIN_EXTENT_IN || y1 - y0 < MIN_EXTENT_IN) return null
  return { xIn: x0 + area.wIn / 2, yIn: y0 + area.hIn / 2, wIn: x1 - x0, hIn: y1 - y0 }
}

export interface PiecePart {
  /** Crop rect within the (graded) print area, top-left origin, inches. */
  rect: RectIn
  /** The GRADED layers this transfer carries — nothing else is drawn into it. */
  layers: Layer[]
}

/**
 * Split one side into the transfers it should be printed as, in part order
 * (top to bottom, then left to right — the order the suffix in `piecePartKey`
 * counts in, and the order an operator reads the garment in).
 *
 * Empty when the side carries no layers, or when the garment publishes no print
 * area for it. That second case is a REFUSAL, not a default: `getAreaSizeIn`
 * returns a zero area when it has nothing to derive one from (a custom
 * garment's sleeve), and inventing a transfer size there is how a dimension
 * nobody measured reaches a printer.
 *
 * Text measurement depends on loaded fonts — call after `prepareSide` (or use
 * `renderPieces`, which does) for export-exact numbers.
 */
export function artworkParts(
  design: Design,
  side: Side,
  size?: SizeId,
  opts?: PieceSplitOptions,
): PiecePart[] {
  const layers = scaleLayers(sideLayers(design, side), printScaleK(design, size))
  if (layers.length === 0) return []
  const area = getAreaSizeIn(design, side, size)
  if (!(area.wIn > 0) || !(area.hIn > 0)) return []
  const clearance = opts?.clearanceIn ?? PIECE_CLEARANCE_IN
  const seen: { rect: RectIn; layers: Layer[]; seq: number }[] = []
  const groups = clusterLayers(layers, clearance)
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]
    const boxes = g.map(layerBox)
    const rect = clampToArea(
      {
        x0: Math.min(...boxes.map((b) => b.x0)),
        x1: Math.max(...boxes.map((b) => b.x1)),
        y0: Math.min(...boxes.map((b) => b.y0)),
        y1: Math.max(...boxes.map((b) => b.y1)),
      },
      area,
    )
    if (rect) seen.push({ rect, layers: g, seq: i })
  }
  // Total order: reading order, with the cluster's first-layer position as the
  // final tiebreak, so the part suffix of a given item never moves between two
  // renders of the same design.
  seen.sort(
    (a, b) => a.rect.yIn - b.rect.yIn || a.rect.xIn - b.rect.xIn || a.seq - b.seq,
  )
  return seen.map(({ rect, layers: ls }) => ({ rect, layers: ls }))
}

/**
 * Tight rotation-aware bbox of a side's WHOLE artwork, clamped to the print
 * area — top-left-origin inches within the (graded) print area. This is the
 * un-split box: what the side would print as if it were emitted as one transfer.
 */
export function artworkBBoxIn(design: Design, side: Side, size?: SizeId): RectIn | null {
  return artworkParts(design, side, size, { clearanceIn: MERGE_WHOLE_SIDE_IN })[0]?.rect ?? null
}

/**
 * Native resolution ceiling of ONE PIECE's artwork, in px per inch at its
 * PLACED size — the smallest ratio across its raster layers (an upload blown up
 * to 12 in wide caps that piece). Text and graphics are vector: they raster at
 * whatever DPI is asked for, so they impose no ceiling and are skipped; null
 * therefore means "nothing limits the resolution here".
 *
 * It scans ONLY the layers handed to it, which is the point of measuring per
 * piece: a low-res sticker at the hem no longer drags down the DPI verdict of
 * the crisp logo it happens to share a side with — they are two files now, and
 * preflight (which reads this through `DtfPiece.srcPxW/H`) judges them apart.
 *
 * `layers` must already be GRADED (`scaleLayers`), which makes grading exact by
 * construction: the same source pixels spread over k× more inches really do
 * print at k× fewer DPI, and preflight has to see that.
 *
 * Reads the decoded images out of the asset cache, so it is only meaningful
 * after `prepareSide` (renderPieces does that). This is the honest input of the
 * preflight DPI check — the rendered canvas only carries the DPI we asked for.
 */
export function artworkSourceDpi(layers: Layer[]): number | null {
  let dpi: number | null = null
  for (const l of layers) {
    if (l.type !== 'image') continue
    const img = getCachedAssetImage(l.assetId, l.useCutout ? 'cutout' : 'original')
    if (!img || l.wIn <= 0 || l.hIn <= 0) continue
    const d = Math.min(img.naturalWidth / l.wIn, img.naturalHeight / l.hIn)
    if (!Number.isFinite(d) || d <= 0) continue
    dpi = dpi === null ? d : Math.min(dpi, d)
  }
  return dpi
}

export interface RenderedPiece {
  sourceKey: string
  /** Transparent-background artwork, cropped to this item's tight bbox. */
  canvas: HTMLCanvasElement
  /** Pixel density the canvas was rendered at (px per inch). */
  dpi: number
  /**
   * Native resolution ceiling (px/in) AT THE GRADED SIZE, for THIS piece's
   * layers only — null when its artwork is all vector.
   */
  srcDpi: number | null
  /** Garment size this transfer is graded for; undefined = base size. */
  size?: SizeId
  /** 1-based index of this transfer among the side's parts, in reading order. */
  part: number
  /** How many transfers the side was split into. 1 = the whole side. */
  parts: number
  /**
   * WHERE IT GOES: this transfer's box inside the (graded) print area,
   * top-left origin, inches. Without it a split side is unpressable — the
   * operator has three transfers and no idea where any of them belongs.
   */
  areaRectIn: RectIn
  /** The (graded) print area those coordinates are relative to, inches. */
  areaWIn: number
  areaHIn: number
  wIn: number
  hIn: number
  /** Physical (graded) artwork size — feed these to the nesting engine. */
  wCm: number
  hCm: number
}

/** Where a transfer goes on the garment, in the numbers a press is set up from. */
export interface PiecePlacementCm {
  /** Drop from the TOP of the print area to the top of the transfer. */
  topCm: number
  /** Signed offset of the transfer's centre from the area's centre line (+ = right). */
  centerDxCm: number
  /** Distance from the area's left edge, for anyone squaring off the edge instead. */
  leftCm: number
  areaWCm: number
  areaHCm: number
}

/**
 * `areaRectIn` in press terms. The top of the print area is a fixed drop below
 * the collar (see printDropBelowCollarIn) and the centre line is the garment's
 * fold, so these two numbers place a transfer with a ruler and nothing else.
 */
export function piecePlacementCm(p: RenderedPiece): PiecePlacementCm {
  return {
    topCm: p.areaRectIn.yIn * CM_PER_IN,
    centerDxCm: (p.areaRectIn.xIn + p.areaRectIn.wIn / 2 - p.areaWIn / 2) * CM_PER_IN,
    leftCm: p.areaRectIn.xIn * CM_PER_IN,
    areaWCm: p.areaWIn * CM_PER_IN,
    areaHCm: p.areaHIn * CM_PER_IN,
  }
}

/**
 * Render one printed side as DTF pieces at `dpi`, graded for `size` — one piece
 * per independent artwork item, in part order. Empty when the side has no
 * printable artwork (or no print area at all).
 *
 * `baseKey` defaults to `pieceSourceKey(design, side, size)`; callers that
 * qualify their keys further (the modal stamps the design's `updatedAt` on) pass
 * their own so the parts inherit it.
 */
export async function renderPieces(
  design: Design,
  side: Side,
  dpi: number,
  size?: SizeId,
  opts?: PieceSplitOptions & { baseKey?: string },
): Promise<RenderedPiece[]> {
  const k = printScaleK(design, size)
  // Load fonts/assets/rasters FIRST so measurement is export-exact. The
  // effective density is dpi × k, so a graded-up piece still rasters crisply.
  await prepareSide(design, side, dpi * k)
  const parts = artworkParts(design, side, size, opts)
  if (parts.length === 0) return []

  const area = getAreaSizeIn(design, side, size)
  // The full-area pixel width the layer origins are measured against. Rounded
  // exactly as renderPrintArea rounds its canvas, so a piece drawn here lands
  // on the same pixel as the 2D/3D/AR renders of the same design do.
  const areaPxW = Math.max(2, Math.round(area.wIn * dpi))
  const areaPxH = Math.max(2, Math.round(area.hIn * dpi))
  const baseKey = opts?.baseKey ?? pieceSourceKey(design, side, size)

  return parts.map(({ rect, layers }, i) => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(2, Math.round(rect.wIn * dpi))
    canvas.height = Math.max(2, Math.round(rect.hIn * dpi))
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    // Origin = the print area's top-left corner, so every layer keeps the
    // coordinates it has everywhere else in the app; the canvas edge does the
    // cropping, which is also what clips artwork that runs past the area.
    ctx.translate(-rect.xIn * dpi, -rect.yIn * dpi)
    for (const layer of layers) {
      ctx.save()
      ctx.globalAlpha = layer.opacity
      ctx.translate(areaPxW / 2 + layer.xIn * dpi, areaPxH / 2 + layer.yIn * dpi)
      ctx.rotate(degToRad(layer.rotation))
      drawLayerContent(ctx, layer, dpi)
      ctx.restore()
    }
    return {
      sourceKey: piecePartKey(baseKey, i + 1, parts.length),
      canvas,
      dpi,
      srcDpi: artworkSourceDpi(layers),
      ...(size ? { size } : {}),
      part: i + 1,
      parts: parts.length,
      areaRectIn: rect,
      areaWIn: area.wIn,
      areaHIn: area.hIn,
      wIn: rect.wIn,
      hIn: rect.hIn,
      wCm: rect.wIn * CM_PER_IN,
      hCm: rect.hIn * CM_PER_IN,
    }
  })
}

// ---------------------------------------------------------------------------
// Alpha mask (the true-shape packer's input)
// ---------------------------------------------------------------------------

/**
 * Alpha floor for "there is ink here", 0–255.
 *
 * Anti-aliased edges and soft drop shadows mean `alpha > 0` covers far more
 * area than the visible print, so thresholding at 1 would quietly turn
 * true-shape nesting back into bounding-box nesting — all of the complexity,
 * none of the gain. 8/255 keeps a genuinely feathered edge while discarding
 * the invisible tail.
 */
export const MASK_ALPHA_FLOOR = 8

/** Target mask cell size, cm. Finer than the packer's grid, so it resamples down. */
const MASK_CELL_CM = 0.1

export interface PieceMask {
  /** Row-major, 1 = ink. Spans exactly the piece's wCm × hCm bounding box. */
  mask: Uint8Array
  maskW: number
  maskH: number
  /** Inked cells ÷ total cells — how much of the box the artwork really uses. */
  fillRatio: number
}

/**
 * Alpha mask of a rendered piece, for `trueshape.ts`.
 *
 * A mask cell is ink when ANY source pixel landing in it clears the alpha
 * floor. That direction is the safe one: the mask may only ever be too big,
 * which costs a sliver of film, never too small, which would let two transfers
 * touch. Cells are capped at one per source pixel so every cell is backed by
 * real pixels — an upsampled mask would have holes the artwork does not have.
 *
 * Returns null when the canvas is unreadable (tainted, zero-sized) or when
 * nothing clears the floor; callers then nest the bounding box, which is what
 * the tool did before this existed.
 */
export function pieceMask(piece: RenderedPiece): PieceMask | null {
  const c = piece.canvas
  if (c.width < 1 || c.height < 1) return null
  let data: Uint8ClampedArray
  try {
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    data = ctx.getImageData(0, 0, c.width, c.height).data
  } catch {
    return null
  }
  const maskW = Math.max(1, Math.min(c.width, Math.round(piece.wCm / MASK_CELL_CM)))
  const maskH = Math.max(1, Math.min(c.height, Math.round(piece.hCm / MASK_CELL_CM)))
  const mask = new Uint8Array(maskW * maskH)
  let ink = 0
  for (let y = 0; y < c.height; y++) {
    const my = Math.min(maskH - 1, Math.floor((y * maskH) / c.height))
    const row = y * c.width
    for (let x = 0; x < c.width; x++) {
      if (data[(row + x) * 4 + 3] < MASK_ALPHA_FLOOR) continue
      const i = my * maskW + Math.min(maskW - 1, Math.floor((x * maskW) / c.width))
      if (mask[i]) continue
      mask[i] = 1
      ink++
    }
  }
  if (ink === 0) return null
  return { mask, maskW, maskH, fillRatio: ink / (maskW * maskH) }
}

/** Printed sides of a design (front/back/sleeve that carry layers). */
export function printedSides(design: Design): Side[] {
  return (['front', 'back', 'sleeve'] as Side[]).filter(
    (s) => sideLayers(design, s).length > 0,
  )
}
