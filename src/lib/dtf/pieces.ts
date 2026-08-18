/**
 * Design side → DTF piece bridge.
 *
 * Turns a printed side into the transfers that will actually be nested: one
 * transparent canvas per independent artwork item, cropped to that item's
 * tight, rotation-aware INK box in inches (`src/lib/ink.ts`, which the customer
 * price reads too). The SAME rect is used for the nesting geometry and for the
 * pixels, so placements and artwork can never disagree.
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
 * AND THE BOX IS THE INK, NOT THE PLACEMENT RECTANGLE
 * ---------------------------------------------------
 * Splitting fixed the space BETWEEN visuals. It left the space INSIDE one: an
 * upload's transparent margins, a cutout's, the leading of a multi-line stack.
 * A layer's declared `wIn × hIn` is the box the artwork was dropped into, and
 * every one of those empty millimetres was bought as film and charged to the
 * customer as printed area. The extent of a visual is now measured from its own
 * alpha (`layerInkBox`), which is also what the Bible's imposition tool asks for
 * — «largeur et hauteur de chaque VISUEL». The measurement is taken once from
 * the source, in fractions of the layer's own box, so it is the same number at
 * 28 DPI in the preview and at 300 DPI in the export: the nested layout and the
 * pixels poured into it cannot drift apart.
 *
 * Two layers stay in the same piece ONLY when their INK boxes, each grown by
 * half of `clearanceIn`, intersect — union-find over the side's layers. Artwork
 * that overlaps or touches can therefore never be cut apart; everything else
 * becomes its own transfer. Measuring the ink rather than the rectangle also
 * stops two padded uploads from merging because their empty margins happened to
 * touch. `MERGE_WHOLE_SIDE_IN` restores the old one-per-side behaviour for
 * callers that want to measure against it.
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
  prepareSide,
  sideLayers,
} from '@/lib/renderDesign'
import { printScaleK, scaleLayers } from '@/lib/printScale'
import { getCachedAssetImage } from '@/state/assets'
import {
  ensureInkProbes,
  MERGE_WHOLE_SIDE_IN,
  MIN_EXTENT_IN,
  PIECE_CLEARANCE_IN,
  sideInkParts,
  TRIM_BLEED_IN,
  type InkPart,
  type PieceSplitOptions,
} from '@/lib/ink'
import { CM_PER_IN, degToRad } from '@/lib/units'

/**
 * The merge distance, the "never split" sentinel, the minimum extent and the
 * trim bleed now live with the ink measurement (`src/lib/ink.ts`), because the
 * customer-facing price and the film cost need the same split as the film does
 * and must not reach into an admin-only module to get it. Re-exported so the
 * DTF modal and the bench keep importing them from here.
 */
export { MERGE_WHOLE_SIDE_IN, MIN_EXTENT_IN, PIECE_CLEARANCE_IN, TRIM_BLEED_IN }
export type { PieceSplitOptions }

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

/** One transfer of a side. Defined with the geometry, in `src/lib/ink.ts`. */
export type PiecePart = InkPart

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
  return sideInkParts(design, side, size, opts)
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
  // Load fonts/assets/rasters FIRST so measurement is export-exact — for the
  // GRADED layers at the density they are drawn at, which is both the effective
  // resolution and the cache key `drawLayerContent` will look up.
  await prepareSide(design, side, dpi, scaleLayers(sideLayers(design, side), k))
  // …then measure where the ink is, and REFUSE if anything could not be
  // measured. Falling back to the declared box here is the one failure that
  // reaches the film: the layout is nested from the 28-DPI preview and filled
  // with a separate 300-DPI render, `renderSheet` stretches each source to fill
  // its placement, so a layer that failed to decode on one pass and succeeded on
  // the other would print at the ratio between a padded box and a tight one.
  // Loud and empty beats quiet and wrong — the modal shows the row as failed and
  // `buildOrderZip` refuses an archive with a missing source for the same reason.
  const { unmeasured } = await ensureInkProbes(sideLayers(design, side))
  if (unmeasured.length > 0)
    throw new Error(
      `Cannot measure the artwork on ${side}: ${unmeasured
        .map((l) => l.name || l.id)
        .join(', ')}`,
    )
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
