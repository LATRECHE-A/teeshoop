/**
 * Offscreen design rendering: powers 3D decal textures, print-ready PNG
 * export, mockup snapshots and saved-design thumbnails. Pure canvas 2D,
 * no Konva: the editor engine wraps the same per-layer draw calls, which is
 * what guarantees 2D/3D/print parity.
 */
import type { CatalogGarmentId, Design, GraphicLayer, ImageLayer, Layer, Side, SizeIn } from '@/lib/types'
import { GARMENT_VIEW } from '@/lib/types'
import { GARMENTS } from '@/garments'
import { SIZE_CHARTS, sizeScale, type SizeId } from '@/content/sizeChart'
import { GRAPHICS } from '@/content/graphics'
import { garmentHexOf } from '@/content/garmentPalette'
import { ensureFont } from '@/lib/fonts'
import { ensureAssetImage, getCachedAssetImage } from '@/state/assets'
import { ensureRaster, getRaster, sizeBucket, withSvgSize } from '@/lib/rasterCache'
import { drawTextLayer, getMeasureCtx, measureTextLayer } from '@/lib/textRender'
import { getCustomSideInfo, getCachedCustomImage } from '@/lib/custom'
import { clamp, degToRad } from '@/lib/units'
import { printScaleK, scaleAreaIn, scaleLayers } from '@/lib/printScale'

export function sideLayers(design: Design, side: Side): Layer[] {
  return design.layers.filter((l) => l.side === side)
}

/**
 * Print-area size in inches. With a `size`, the area is GRADED by the design's
 * print-scale factor: a 3XL really does have more printable width than an S,
 * and artwork stored at the base size scales into it by the same factor, so the
 * design keeps the same relative footprint on every size.
 */
export function getAreaSizeIn(design: Design, side: Side, size?: SizeId): SizeIn {
  const k = printScaleK(design, size)
  if (design.garmentId === 'custom') {
    // Custom (ship-your-own) garments are front/back only (no sleeve), and
    // only the front is mandatory, so a side can carry artwork while carrying
    // no print area of its own (drop the back photo from a design that already
    // has back layers, which the setup modal warns about but permits).
    //
    // THE OTHER SIDE IS THE ANSWER, not a default. Front and back are the same
    // physical garment: a back print occupies the front's area mirrored about
    // the centre line, and a mirror does not change a size. So the derivation
    // is exact, and it is the number a print shop would use.
    //
    // This used to fall back to a hard-coded 12 × 16, and that guess did not
    // stop at the preview: it sized the layout, it was priced, and it was
    // written into a DTF transfer at a dimension nobody had ever measured. A
    // fabricated print size is worse than no print at all, so the one case with
    // nothing to derive from (a sleeve, which a ship-your-own garment does not
    // have) refuses instead: a zero area makes `renderPrintArea` return null and
    // `dtf/pieces.ts` drop the piece, so nothing reaches a printer. Artwork
    // cannot in fact be stranded on a custom sleeve (the catalog↔custom switch
    // stashes layers rather than carrying them across, state/store.ts
    // switchGarment), but zero is what the truth is if it ever were.
    const c = design.custom
    const area = side === 'sleeve' ? null : (c?.[side] ?? c?.front ?? c?.back)?.printArea
    return area ? scaleAreaIn({ wIn: area.wIn, hIn: area.hIn }, k) : { wIn: 0, hIn: 0 }
  }
  return scaleAreaIn(GARMENTS[design.garmentId].printAreasIn[side], k)
}

/**
 * Keep layer centers inside the print area when the area changes.
 *
 * Deliberately calls getAreaSizeIn WITHOUT a size: stored geometry is
 * base-space inches, so every WRITE clamps against the UNGRADED area. Passing
 * previewSize here would let a 3XL preview push coordinates outside the base
 * area (and shrink them back on an S). See src/lib/printScale.ts.
 *
 * Moved here from src/state/store.ts on 26/09/2026 so that the shop's own editor
 * applies a saved design to another garment by THIS rule rather than a copy of
 * it: the studio's garment switch and the saved-design path are the same move.
 */
export function clampLayersToArea(design: Design): Design {
  const layers = design.layers.map((l) => {
    const area = getAreaSizeIn(design, l.side)
    return {
      ...l,
      xIn: clamp(l.xIn, -area.wIn / 2, area.wIn / 2),
      yIn: clamp(l.yIn, -area.hIn / 2, area.hIn / 2),
    }
  })
  return { ...design, layers }
}

/**
 * Kept as the name every renderer already imports; the RULE lives in one place
 * now (src/content/garmentPalette.ts). There were four copies of this lookup
 * with three different fallbacks.
 */
export function garmentColorHex(design: Design): string {
  return garmentHexOf(design.colorId)
}

/**
 * Vertical offset (inches, +down) of a catalog side's print-area CENTRE from
 * the garment's visual centre. Derived from GarmentSideArt.printAreaPx so the
 * 2D editor, the 3D preview and the AR export all place front vs back at the
 * SAME height (front and back sit at different heights on the body). Single
 * source of truth: 3D (Scene3D) and AR (arExport) both import this.
 *
 * With a `size`, accounts for the garment scaling about its collar anchor
 * (print placement is collar-anchored, so the print-area centre shifts relative
 * to the garment's visual centre as the body scales). Omitting `size` keeps the
 * historical nominal-size value.
 *
 * `k` is the print grading factor (src/lib/printScale.ts). At k = 1 the print
 * area keeps its authored position, a size-invariant drop below the collar. At
 * k ≠ 1 the area is scaled about the SAME collar anchor the art uses, so the
 * whole composition (drop below collar and area size alike) grades together and
 * every size reads identically.
 */
export function areaOffsetYIn(
  garment: CatalogGarmentId,
  side: Side,
  size?: SizeId,
  k = 1,
): number {
  const art = GARMENTS[garment]
  const a = art.sides[side].printAreaPx
  const anchorY = art.sides[side].collarPx.y
  const printCenterY = anchorY + (a.y + a.h / 2 - anchorY) * k
  if (!size || size === SIZE_CHARTS[garment].nominal)
    return (printCenterY - GARMENT_VIEW / 2) / art.pxPerInch
  const s = sizeScale(garment, size)
  const sy = side === 'sleeve' ? s.sleeve : s.sy
  const visualCenterY = anchorY + (GARMENT_VIEW / 2 - anchorY) * sy
  return (printCenterY - visualCenterY) / art.pxPerInch
}

/**
 * Distance (inches, +down) from a side's COLLAR SEAM to its print-area centre,
 * read straight off the 2D art, which is where the number is authored.
 *
 * This is the anchor the 3D preview and the AR bake hang prints from, because
 * it is the anchor a print shop uses: professional placement is measured in cm
 * below the collar and is size-invariant. `k` is the print grading factor, so
 * the drop and the area scale together about the same seam, exactly as
 * areaOffsetYIn and renderMockup already do in 2D.
 */
export function printDropBelowCollarIn(
  garment: CatalogGarmentId,
  side: Side,
  k = 1,
): number {
  const art = GARMENTS[garment]
  const a = art.sides[side].printAreaPx
  return ((a.y + a.h / 2 - art.sides[side].collarPx.y) * k) / art.pxPerInch
}

/**
 * How much LOWER this side's drawn collar seam sits than the front one, inches.
 * A neckline scoops deeper at the front than at the back, so one measured mesh
 * landmark (the front seam) plus this offset pins both panels, which matters
 * on the hoodie, whose back seam is hidden under the hood.
 */
export function collarSeamDropIn(garment: CatalogGarmentId, side: Side): number {
  const art = GARMENTS[garment]
  return (art.sides[side].collarPx.y - art.sides.front.collarPx.y) / art.pxPerInch
}

export interface GarmentDrawTransform {
  sx: number
  sy: number
  /** Node offset (viewBox px) for art drawn at (0,0,800,800) then scaled. */
  x: number
  y: number
}

/**
 * Scale + offset that renders the nominal-size 800px garment art at `size`,
 * anchored at the collar seam (the point pro print placement measures from,
 * which is size-invariant). Print areas / layers stay untouched: only the
 * garment body/shade art moves.
 */
export function garmentDrawTransform(
  garment: CatalogGarmentId,
  side: Side,
  size: SizeId,
): GarmentDrawTransform {
  const art = GARMENTS[garment]
  const s = sizeScale(garment, size)
  const sx = side === 'sleeve' ? s.sleeve : s.sx
  const sy = side === 'sleeve' ? s.sleeve : s.sy
  const c = art.sides[side].collarPx
  return { sx, sy, x: c.x * (1 - sx), y: c.y * (1 - sy) }
}

export function graphicDef(id: string) {
  return GRAPHICS.find((g) => g.id === id) ?? null
}

/**
 * Raster cache key for a graphic layer at a given render density. The 96-ppi
 * quality floor keeps editor rasters crisp under zoom AND guarantees
 * prepare/draw agree on the key whenever both use the same `ppi`.
 */
export const graphicRasterKey = (layer: GraphicLayer, ppi: number) =>
  `graphic:${layer.graphicId}:${layer.fill}:${sizeBucket(layer.wIn * Math.max(ppi, 96))}`

/**
 * Load everything a side needs (fonts, asset images, graphic rasters) so the
 * subsequent draw is synchronous. `maxPpi` sizes graphic rasters.
 *
 * PASS THE LAYERS YOU WILL DRAW, and the ppi you will draw them at. A graphic's
 * raster is cached under `sizeBucket(layer.wIn × max(ppi, 96))`, so preparing
 * the UNGRADED layers at `ppi × k` and drawing the GRADED ones at `ppi` computes
 * two different keys whenever `ppi < 96` and `k ≠ 1`: `max(ppi × k, 96)` is not
 * `k × max(ppi, 96)`. `getRaster` then misses and `drawGraphicLayerContent`
 * returns early, i.e. the graphic is silently NOT DRAWN. That is exactly the
 * 28-DPI DTF preview of any graded design: a badge that vanishes from the
 * transfer with nothing logged and nothing on screen to notice.
 */
export async function prepareSide(
  design: Design,
  side: Side,
  maxPpi: number,
  layers?: Layer[],
): Promise<void> {
  const jobs: Promise<unknown>[] = []
  for (const layer of layers ?? sideLayers(design, side)) {
    if (layer.type === 'text') jobs.push(ensureFont(layer.fontFamily))
    if (layer.type === 'image')
      jobs.push(
        ensureAssetImage(
          layer.assetId,
          layer.useCutout ? 'cutout' : 'original',
        ).catch(() => null),
      )
    if (layer.type === 'graphic') {
      const def = graphicDef(layer.graphicId)
      if (def) {
        const px = sizeBucket(layer.wIn * Math.max(maxPpi, 96))
        const svg = withSvgSize(
          def.svg(layer.fill),
          px,
          Math.max(2, Math.round(px / def.aspect)),
        )
        jobs.push(
          ensureRaster(graphicRasterKey(layer, maxPpi), svg).catch(() => null),
        )
      }
    }
  }
  await Promise.all(jobs)
}

export function drawImageLayerContent(
  ctx: CanvasRenderingContext2D,
  layer: ImageLayer,
  ppi: number,
): void {
  const img = getCachedAssetImage(
    layer.assetId,
    layer.useCutout ? 'cutout' : 'original',
  )
  if (!img) return
  const w = layer.wIn * ppi
  const h = layer.hIn * ppi
  if (layer.flipX) ctx.scale(-1, 1)
  ctx.drawImage(img, -w / 2, -h / 2, w, h)
}

export function drawGraphicLayerContent(
  ctx: CanvasRenderingContext2D,
  layer: GraphicLayer,
  ppi: number,
): void {
  const img = getRaster(graphicRasterKey(layer, ppi))
  if (!img) return
  const w = layer.wIn * ppi
  const h = layer.hIn * ppi
  if (layer.flipX) ctx.scale(-1, 1)
  ctx.drawImage(img, -w / 2, -h / 2, w, h)
}

/** Draw one layer, centered at its own origin, onto a prepared context. */
export function drawLayerContent(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  ppi: number,
): void {
  if (layer.type === 'text') drawTextLayer(ctx, layer, ppi)
  else if (layer.type === 'image') drawImageLayerContent(ctx, layer, ppi)
  else drawGraphicLayerContent(ctx, layer, ppi)
}

/** Measure a layer's unrotated size in px at the given density. */
export function measureLayer(layer: Layer, ppi: number): { w: number; h: number } {
  if (layer.type === 'text')
    return measureTextLayer(getMeasureCtx(), layer, ppi)
  return { w: layer.wIn * ppi, h: layer.hIn * ppi }
}

/**
 * The priced footprint of a side used to live here, as one rotation-expanded
 * box around every layer. It is now `sideArtworkSqCm` in `src/lib/ink.ts`,
 * because the number a customer pays for and the number the film costs have to
 * be the same measurement, and that one is measured from the ink.
 */

/**
 * Render the full print area (transparent) at `ppi`. This canvas IS the
 * physical transfer, so it is where grading has to be real rather than a
 * preview trick. With a `size`, both the area and every layer are scaled by the
 * design's grading factor, producing a genuinely larger transfer for a larger
 * garment. Returns null when the side has no layers.
 */
export async function renderPrintArea(
  design: Design,
  side: Side,
  ppi: number,
  size?: SizeId,
): Promise<HTMLCanvasElement | null> {
  const k = printScaleK(design, size)
  const layers = scaleLayers(sideLayers(design, side), k)
  if (layers.length === 0) return null
  // Prepare THESE layers at THIS ppi: they are already graded, so their rasters
  // come out at the effective resolution and under the very key the draw below
  // will look up.
  await prepareSide(design, side, ppi, layers)

  const area = getAreaSizeIn(design, side, size)
  // A zero area is `getAreaSizeIn` refusing: this garment has no such side and
  // no other side to derive one from. Returning null is the refusal every
  // caller already handles (they skip the decal, drop the DTF piece); inventing
  // a canvas here is exactly how a made-up print size would reach a transfer.
  if (!(area.wIn > 0) || !(area.hIn > 0)) return null
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(2, Math.round(area.wIn * ppi))
  canvas.height = Math.max(2, Math.round(area.hIn * ppi))
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'

  for (const layer of layers) {
    ctx.save()
    ctx.globalAlpha = layer.opacity
    ctx.translate(
      canvas.width / 2 + layer.xIn * ppi,
      canvas.height / 2 + layer.yIn * ppi,
    )
    ctx.rotate(degToRad(layer.rotation))
    drawLayerContent(ctx, layer, ppi)
    ctx.restore()
  }
  return canvas
}

/**
 * Composite garment + design + shading for thumbnails / share images.
 * Returns a square-ish canvas on transparent background: `widthPx` square at
 * the nominal size, grown symmetrically-as-needed (never smaller) when a
 * larger `size` pushes the scaled art outside the 800px viewBox.
 * `size` scales catalog garment art about its collar anchor (design + print
 * area stay at true physical scale); omitted → nominal art size.
 *
 * `opts.artwork === false` renders the BARE garment at exactly the same size
 * and framing. It is not a preview of anything. It is the photometric
 * reference the 3D shell measures the garment's own light, folds and colour
 * from (see CardSource.photo). Keep the two draws sharing this one function:
 * the moment the bare pass acquires its own scaling or cropping it stops being
 * registered with the composite and every measurement lands a few pixels off.
 */
export async function renderMockup(
  design: Design,
  side: Side,
  widthPx: number,
  size?: SizeId,
  opts?: { artwork?: boolean },
): Promise<HTMLCanvasElement> {
  const withArtwork = opts?.artwork !== false
  const canvas = document.createElement('canvas')

  if (design.garmentId === 'custom') {
    const setup = side === 'sleeve' ? null : design.custom?.[side] ?? null
    const widthIn = design.custom?.widthIn ?? 20
    if (!setup) {
      canvas.width = widthPx
      canvas.height = widthPx
      return canvas
    }
    const info = await getCustomSideInfo(setup, widthIn)
    const scale = widthPx / info.bbox.w
    canvas.width = widthPx
    canvas.height = Math.round(info.bbox.h * scale)
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(
      info.img,
      info.bbox.x,
      info.bbox.y,
      info.bbox.w,
      info.bbox.h,
      0,
      0,
      canvas.width,
      canvas.height,
    )
    const ppiOut = widthPx / widthIn
    const design2 = withArtwork
      ? await renderPrintArea(design, side, Math.min(140, ppiOut * 2), size)
      : null
    if (design2) {
      // Grading scales the area about its own top-centre: the drop below the
      // collar and the area itself grade together, matching the catalog path
      // where both scale about the collar anchor.
      const k = printScaleK(design, size)
      const a = setup.printArea
      const wIn = a.wIn * k
      const hIn = a.hIn * k
      const xIn = a.xIn + (a.wIn - wIn) / 2
      ctx.drawImage(design2, xIn * ppiOut, a.yIn * k * ppiOut, wIn * ppiOut, hIn * ppiOut)
    }
    return canvas
  }

  const art = GARMENTS[design.garmentId]
  const sideArt = art.sides[side]
  const hex = garmentColorHex(design)
  const rasterPx = sizeBucket(widthPx)
  const body = await ensureRaster(
    `garment:${design.garmentId}:${side}:${hex}:${rasterPx}`,
    withSvgSize(sideArt.body.replaceAll('__COLOR__', hex), rasterPx, rasterPx),
  )
  const shade = await ensureRaster(
    `garment-shade:${design.garmentId}:${side}:800`,
    withSvgSize(sideArt.shade, 800, 800),
  )

  const s = widthPx / 800
  const tf = garmentDrawTransform(
    design.garmentId,
    side,
    size ?? SIZE_CHARTS[design.garmentId].nominal,
  )
  // Sizes above nominal scale the art past the 800px viewBox, which a fixed
  // square canvas would clip (sleeve tips, hem). Grow the canvas to the union
  // of the viewBox and the drawn art and shift the origin, so every draw below
  // keeps viewBox coordinates. Nominal (and smaller) sizes stay square.
  const minX = Math.min(0, tf.x)
  const minY = Math.min(0, tf.y)
  const maxX = Math.max(800, tf.x + 800 * tf.sx)
  const maxY = Math.max(800, tf.y + 800 * tf.sy)
  canvas.width = Math.round((maxX - minX) * s)
  canvas.height = Math.round((maxY - minY) * s)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.translate(-minX * s, -minY * s)
  ctx.drawImage(body, tf.x * s, tf.y * s, widthPx * tf.sx, widthPx * tf.sy)

  const ppiOut = art.pxPerInch * s
  const designCanvas = withArtwork
    ? await renderPrintArea(design, side, Math.min(160, ppiOut * 2), size)
    : null
  if (designCanvas) {
    const c = art.sides[side].collarPx
    // Grading scales the print area about the SAME collar anchor the art uses,
    // so the drop below the collar and the area itself grade together. k = 1
    // leaves the authored rect untouched.
    const k = printScaleK(design, size)
    const pa = sideArt.printAreaPx
    const a = {
      x: c.x + (pa.x - c.x) * k,
      y: c.y + (pa.y - c.y) * k,
      w: pa.w * k,
      h: pa.h * k,
    }
    // Multiply the garment's shading into the print, clipped to the print's
    // own alpha, so ink inherits fabric folds without darkening the fabric.
    // The shade art scales with the garment, so the crop that overlaps the
    // print area is the (graded) print rect mapped back into unscaled art
    // coords about the collar anchor: p = collar + (a − collar) / scale.
    const srcX = c.x + (a.x - c.x) / tf.sx
    const srcY = c.y + (a.y - c.y) / tf.sy
    const tmp = document.createElement('canvas')
    tmp.width = Math.max(2, Math.round(a.w * s))
    tmp.height = Math.max(2, Math.round(a.h * s))
    const tctx = tmp.getContext('2d')!
    tctx.drawImage(designCanvas, 0, 0, tmp.width, tmp.height)
    tctx.globalCompositeOperation = 'multiply'
    tctx.drawImage(
      shade,
      srcX,
      srcY,
      a.w / tf.sx,
      a.h / tf.sy,
      0,
      0,
      tmp.width,
      tmp.height,
    )
    tctx.globalCompositeOperation = 'destination-in'
    tctx.drawImage(designCanvas, 0, 0, tmp.width, tmp.height)
    ctx.drawImage(tmp, a.x * s, a.y * s, a.w * s, a.h * s)
  }
  return canvas
}

/** Small PNG data-url for saved-design cards. */
export async function renderThumbnail(design: Design): Promise<string> {
  const front = await renderMockup(design, 'front', 320)
  return front.toDataURL('image/png')
}
