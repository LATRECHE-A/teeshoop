/**
 * Text layer rendering — the ONE code path used by the live editor,
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
