/**
 * Text layer rendering: the ONE code path used by the live editor,
 * 3D decal textures, and 300-DPI print export.
 *
 * Draws centered at the origin; callers translate/rotate/alpha first.
 */
import type { TextLayer } from '@/lib/types'
import { drawArcText, measureArcText, type ArcTextConfig } from '@/lib/arcText'

const LINE_HEIGHT = 1.18

function lineConfigs(layer: TextLayer, ppi: number): ArcTextConfig[] {
  const fontSizePx = layer.fontSizeIn * ppi
  const base = {
    fontFamily: layer.fontFamily,
    fontSizePx,
    letterSpacingPx: layer.letterSpacingEm * fontSizePx,
    fill: layer.fill,
    stroke: layer.stroke,
    strokeWidthPx: layer.strokeWidthIn * ppi,
  }
  const curved = Math.abs(layer.curve) >= 2
  const lines = curved
    ? [layer.text.replace(/\s*\n\s*/g, ' ')]
    : layer.text.split('\n')
  return lines.map((text) => ({
    ...base,
    text: text || ' ',
    curve: curved ? layer.curve : 0,
  }))
}

export function measureTextLayer(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
  ppi: number,
): { w: number; h: number } {
  const cfgs = lineConfigs(layer, ppi)
  if (cfgs.length === 1) {
    const m = measureArcText(ctx, cfgs[0])
    return { w: Math.max(1, m.width), h: Math.max(1, m.height) }
  }
  const lineH = layer.fontSizeIn * ppi * LINE_HEIGHT
  let w = 1
  for (const cfg of cfgs) w = Math.max(w, measureArcText(ctx, cfg).width)
  return { w, h: Math.max(1, lineH * cfgs.length) }
}

/**
 * The ink inside `measureTextLayer`'s box: its size, and where its centre sits
 * relative to the layer origin. Both in px at `ppi`.
 *
 * A SINGLE line is already exactly its own ink (`measureArcText` reports glyph
 * ink and `drawArcText` centres that box on the origin), so this returns the
 * measured box unchanged, centred.
 *
 * A MULTI-LINE stack is not. Its declared height is `fontSize × 1.18 × lines`,
 * a leading-based em stack, while the ink is the union of each line's own ink
 * box placed exactly where `drawTextLayer` places it. On a three-line slogan
 * that is about 9 % of the priced and printed area: bought film, on every
 * garment in the run, for the leading above the first line and below the last.
 *
 * Composed from the same `measureArcText` and the same dx/dy arithmetic the
 * drawing uses, so the two cannot drift apart.
 */
export function measureTextInk(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
  ppi: number,
): { w: number; h: number; cx: number; cy: number } {
  const cfgs = lineConfigs(layer, ppi)
  if (cfgs.length === 1) {
    const m = measureTextLayer(ctx, layer, ppi)
    return { w: m.w, h: m.h, cx: 0, cy: 0 }
  }
  const { w } = measureTextLayer(ctx, layer, ppi)
  const lineH = layer.fontSizeIn * ppi * LINE_HEIGHT
  const totalH = lineH * cfgs.length
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  cfgs.forEach((cfg, i) => {
    const m = measureArcText(ctx, cfg)
    let dx = 0
    if (layer.align === 'left') dx = -(w - m.width) / 2
    if (layer.align === 'right') dx = (w - m.width) / 2
    const dy = -totalH / 2 + lineH * (i + 0.5)
    x0 = Math.min(x0, dx - m.width / 2)
    x1 = Math.max(x1, dx + m.width / 2)
    y0 = Math.min(y0, dy - m.height / 2)
    y1 = Math.max(y1, dy + m.height / 2)
  })
  if (!Number.isFinite(x0)) return { w, h: totalH, cx: 0, cy: 0 }
  return {
    w: Math.max(1, x1 - x0),
    h: Math.max(1, y1 - y0),
    cx: (x0 + x1) / 2,
    cy: (y0 + y1) / 2,
  }
}

export function drawTextLayer(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
  ppi: number,
): void {
  const cfgs = lineConfigs(layer, ppi)
  if (cfgs.length === 1) {
    drawArcText(ctx, cfgs[0])
    return
  }
  const { w } = measureTextLayer(ctx, layer, ppi)
  const lineH = layer.fontSizeIn * ppi * LINE_HEIGHT
  const totalH = lineH * cfgs.length
  cfgs.forEach((cfg, i) => {
    const lw = measureArcText(ctx, cfg).width
    let dx = 0
    if (layer.align === 'left') dx = -(w - lw) / 2
    if (layer.align === 'right') dx = (w - lw) / 2
    const dy = -totalH / 2 + lineH * (i + 0.5)
    ctx.save()
    ctx.translate(dx, dy)
    drawArcText(ctx, cfg)
    ctx.restore()
  })
}

let sharedMeasureCtx: CanvasRenderingContext2D | null = null

/** Shared 2D context for measurement (never drawn to screen). */
export function getMeasureCtx(): CanvasRenderingContext2D {
  if (!sharedMeasureCtx) {
    const canvas = document.createElement('canvas')
    canvas.width = 8
    canvas.height = 8
    sharedMeasureCtx = canvas.getContext('2d')!
  }
  return sharedMeasureCtx
}
