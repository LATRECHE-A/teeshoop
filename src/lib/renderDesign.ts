/**
 * Offscreen design rendering — powers 3D decal textures, print-ready PNG
 * export, mockup snapshots and saved-design thumbnails. Pure canvas 2D,
 * no Konva: the editor engine wraps the same per-layer draw calls, which is
 * what guarantees 2D/3D/print parity.
 */
import type { Design, GraphicLayer, ImageLayer, Layer, Side, SizeIn } from '@/lib/types'
import { GARMENTS } from '@/garments'
import { GRAPHICS } from '@/content/graphics'
import { GARMENT_COLORS } from '@/content/palettes'
import { ensureFont } from '@/lib/fonts'
import { ensureAssetImage, getCachedAssetImage } from '@/state/assets'
import { ensureRaster, getRaster, sizeBucket, withSvgSize } from '@/lib/rasterCache'
import { drawTextLayer, getMeasureCtx, measureTextLayer } from '@/lib/textRender'
import { getCustomSideInfo, getCachedCustomImage } from '@/lib/custom'
import { degToRad } from '@/lib/units'

export function sideLayers(design: Design, side: Side): Layer[] {
  return design.layers.filter((l) => l.side === side)
}

export function getAreaSizeIn(design: Design, side: Side): SizeIn {
  if (design.garmentId === 'custom') {
    // Custom (ship-your-own) garments are front/back only — no sleeve.
    const area = side === 'sleeve' ? undefined : design.custom?.[side]?.printArea
    return area ? { wIn: area.wIn, hIn: area.hIn } : { wIn: 12, hIn: 16 }
  }
  return GARMENTS[design.garmentId].printAreasIn[side]
}

export function garmentColorHex(design: Design): string {
  return (
    GARMENT_COLORS.find((c) => c.id === design.colorId)?.hex ?? '#FFFFFF'
  )
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
 */
export async function prepareSide(
  design: Design,
  side: Side,
  maxPpi: number,
): Promise<void> {
  const jobs: Promise<unknown>[] = []
  for (const layer of sideLayers(design, side)) {
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
 * Bounding-box footprint of a side's placed artwork in square inches, clamped
 * to the print area (rotation-aware). Feeds area-aware pricing — a bigger print
 * lands in a higher tier. Returns 0 when the side is empty.
 */
export function sideArtworkSqIn(design: Design, side: Side): number {
  const layers = sideLayers(design, side)
  if (layers.length === 0) return 0
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
  const area = getAreaSizeIn(design, side)
  const wIn = Math.min(area.wIn, maxX - minX)
  const hIn = Math.min(area.hIn, maxY - minY)
  return Math.max(0, wIn) * Math.max(0, hIn)
}

/**
 * Render the full print area (transparent) at `ppi`.
 * Returns null when the side has no layers.
 */
export async function renderPrintArea(
  design: Design,
  side: Side,
  ppi: number,
): Promise<HTMLCanvasElement | null> {
  const layers = sideLayers(design, side)
  if (layers.length === 0) return null
  await prepareSide(design, side, ppi)

  const area = getAreaSizeIn(design, side)
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
 * Always returns a square-ish canvas on transparent background.
 */
export async function renderMockup(
  design: Design,
  side: Side,
  widthPx: number,
): Promise<HTMLCanvasElement> {
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
    const design2 = await renderPrintArea(design, side, Math.min(140, ppiOut * 2))
    if (design2) {
      const a = setup.printArea
      ctx.drawImage(
        design2,
        a.xIn * ppiOut,
        a.yIn * ppiOut,
        a.wIn * ppiOut,
        a.hIn * ppiOut,
      )
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

  canvas.width = widthPx
  canvas.height = widthPx
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  const s = widthPx / 800
  ctx.drawImage(body, 0, 0, widthPx, widthPx)

  const ppiOut = art.pxPerInch * s
  const designCanvas = await renderPrintArea(
    design,
    side,
    Math.min(160, ppiOut * 2),
  )
  if (designCanvas) {
    const a = sideArt.printAreaPx
    // Multiply the garment's shading into the print, clipped to the print's
    // own alpha, so ink inherits fabric folds without darkening the fabric.
    const tmp = document.createElement('canvas')
    tmp.width = Math.max(2, Math.round(a.w * s))
    tmp.height = Math.max(2, Math.round(a.h * s))
    const tctx = tmp.getContext('2d')!
    tctx.drawImage(designCanvas, 0, 0, tmp.width, tmp.height)
    tctx.globalCompositeOperation = 'multiply'
    tctx.drawImage(shade, a.x, a.y, a.w, a.h, 0, 0, tmp.width, tmp.height)
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
