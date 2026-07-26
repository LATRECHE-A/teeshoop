/**
 * Design side → DTF piece bridge.
 *
 * Computes the tight, rotation-aware bounding box of a side's placed artwork
 * in INCHES (same math family as sideArtworkSqIn in renderDesign.ts), renders
 * the print area via renderPrintArea at the requested DPI and crops it to
 * that box. The resulting canvas + cm size feed the nesting engine — the SAME
 * bbox is used for nesting geometry and for pixel cropping, so placements and
 * pixels can never disagree.
 *
 * GRADING (src/lib/printScale.ts)
 * -------------------------------
 * A piece is identified by (design, side, **size**). With a `size` the artwork
 * AND the print area are scaled by the design's grading factor `k`, so `wCm`,
 * `hCm` and the cropped pixels are the transfer that garment size really needs
 * — a graded 3XL piece is physically larger than the same design at S, and the
 * gang sheet has to carry one distinct transfer per size instead of one for the
 * whole order. Omitting `size` (or a `fixed` design) keeps k = 1 and is
 * byte-identical to the pre-grading behaviour.
 */
import type { Design, RectIn, Side, SizeId } from '@/lib/types'
import {
  getAreaSizeIn,
  measureLayer,
  prepareSide,
  renderPrintArea,
  sideLayers,
} from '@/lib/renderDesign'
import { printScaleK, scaleLayers } from '@/lib/printScale'
import { getCachedAssetImage } from '@/state/assets'
import { CM_PER_IN, degToRad } from '@/lib/units'

/** Ignore slivers thinner than this (inches) — nothing printable there. */
const MIN_EXTENT_IN = 0.05

/**
 * Stable artwork identity: one rendered canvas per (design side, garment size).
 * A graded design prints a different physical transfer per size, so the size is
 * part of the identity; without one the key is the historical `id:side`.
 */
export const pieceSourceKey = (design: Design, side: Side, size?: SizeId): string =>
  `${design.id}:${side}${size ? `#${size}` : ''}`

/**
 * Tight rotation-aware bbox of a side's artwork, clamped to the print area.
 * Top-left-origin inches WITHIN the (graded) print area — the crop rect for the
 * renderPrintArea canvas rendered at the same `size`. Null when the side is
 * empty or degenerate.
 *
 * Text measurement depends on loaded fonts — call after `prepareSide` (or use
 * `renderPiece`, which does) for export-exact numbers.
 */
export function artworkBBoxIn(design: Design, side: Side, size?: SizeId): RectIn | null {
  const layers = scaleLayers(sideLayers(design, side), printScaleK(design, size))
  if (layers.length === 0) return null
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const l of layers) {
    const m = measureLayer(l, 100)
    const wI = m.w / 100
    const hI = m.h / 100
    const r = Math.abs(degToRad(l.rotation))
    const hx = (wI / 2) * Math.abs(Math.cos(r)) + (hI / 2) * Math.abs(Math.sin(r))
    const hy = (wI / 2) * Math.abs(Math.sin(r)) + (hI / 2) * Math.abs(Math.cos(r))
    minX = Math.min(minX, l.xIn - hx)
    maxX = Math.max(maxX, l.xIn + hx)
    minY = Math.min(minY, l.yIn - hy)
    maxY = Math.max(maxY, l.yIn + hy)
  }
  const area = getAreaSizeIn(design, side, size)
  const x0 = Math.max(-area.wIn / 2, minX)
  const x1 = Math.min(area.wIn / 2, maxX)
  const y0 = Math.max(-area.hIn / 2, minY)
  const y1 = Math.min(area.hIn / 2, maxY)
  if (x1 - x0 < MIN_EXTENT_IN || y1 - y0 < MIN_EXTENT_IN) return null
  return {
    xIn: x0 + area.wIn / 2,
    yIn: y0 + area.hIn / 2,
    wIn: x1 - x0,
    hIn: y1 - y0,
  }
}

/**
 * Native resolution ceiling of a side's artwork, in px per inch at its PLACED
 * size — the smallest ratio across the raster layers (an upload blown up to
 * 12 in wide caps the whole piece). Text and graphics are vector: they raster
 * at whatever DPI is asked for, so they impose no ceiling and are skipped;
 * null therefore means "nothing limits the resolution here".
 *
 * Grading spends resolution: the source pixel count is fixed, so placing it at
 * `size` divides the ceiling by the grading factor — a 3XL graded 23 % up from
 * the base size really does print at 23 % fewer DPI, and preflight has to see
 * that. Passing no size keeps the base-size ceiling.
 *
 * Reads the decoded images out of the asset cache, so it is only meaningful
 * after `prepareSide` (renderPiece does that). This is the honest input of the
 * preflight DPI check — the rendered canvas only carries the DPI we asked for.
 */
export function artworkSourceDpi(design: Design, side: Side, size?: SizeId): number | null {
  let dpi: number | null = null
  for (const l of sideLayers(design, side)) {
    if (l.type !== 'image') continue
    const img = getCachedAssetImage(l.assetId, l.useCutout ? 'cutout' : 'original')
    if (!img || l.wIn <= 0 || l.hIn <= 0) continue
    const d = Math.min(img.naturalWidth / l.wIn, img.naturalHeight / l.hIn)
    if (!Number.isFinite(d) || d <= 0) continue
    dpi = dpi === null ? d : Math.min(dpi, d)
  }
  const k = printScaleK(design, size)
  return dpi === null ? null : dpi / k
}

export interface RenderedPiece {
  sourceKey: string
  /** Transparent-background artwork, cropped to the tight bbox. */
  canvas: HTMLCanvasElement
  /** Pixel density the canvas was rendered at (px per inch). */
  dpi: number
  /**
   * Native resolution ceiling (px/in) AT THE GRADED SIZE — null when the
   * artwork is all vector.
   */
  srcDpi: number | null
  /** Garment size this transfer is graded for; undefined = base size. */
  size?: SizeId
  wIn: number
  hIn: number
  /** Physical (graded) artwork size — feed these to the nesting engine. */
  wCm: number
  hCm: number
}

/**
 * Render one printed side as a DTF piece at `dpi`, graded for `size`.
 * Returns null when the side has no printable artwork.
 */
export async function renderPiece(
  design: Design,
  side: Side,
  dpi: number,
  size?: SizeId,
): Promise<RenderedPiece | null> {
  // Load fonts/assets/rasters FIRST so bbox measurement is export-exact. The
  // effective density is dpi × k (renderPrintArea prepares the same way), so a
  // graded-up piece still rasters its vectors crisply.
  await prepareSide(design, side, dpi * printScaleK(design, size))
  const bbox = artworkBBoxIn(design, side, size)
  if (!bbox) return null
  const full = await renderPrintArea(design, side, dpi, size)
  if (!full) return null

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(2, Math.round(bbox.wIn * dpi))
  canvas.height = Math.max(2, Math.round(bbox.hIn * dpi))
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(
    full,
    bbox.xIn * dpi,
    bbox.yIn * dpi,
    bbox.wIn * dpi,
    bbox.hIn * dpi,
    0,
    0,
    canvas.width,
    canvas.height,
  )
  return {
    sourceKey: pieceSourceKey(design, side, size),
    canvas,
    dpi,
    srcDpi: artworkSourceDpi(design, side, size),
    size,
    wIn: bbox.wIn,
    hIn: bbox.hIn,
    wCm: bbox.wIn * CM_PER_IN,
    hCm: bbox.hIn * CM_PER_IN,
  }
}

/** Printed sides of a design (front/back/sleeve that carry layers). */
export function printedSides(design: Design): Side[] {
  return (['front', 'back', 'sleeve'] as Side[]).filter(
    (s) => sideLayers(design, s).length > 0,
  )
}
