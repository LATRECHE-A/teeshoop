/**
 * STUB — module A4 replaces this file entirely (see docs/CONTRACTS.md §A4).
 * Straight-only rendering so the app is wireable meanwhile.
 */

export interface ArcTextConfig {
  text: string
  fontFamily: string
  fontSizePx: number
  letterSpacingPx: number
  /** -100..100, 0 straight, positive arcs up */
  curve: number
  fill: string
  stroke?: string | null
  strokeWidthPx?: number
}

function applyFont(ctx: CanvasRenderingContext2D, cfg: ArcTextConfig) {
  ctx.font = `${cfg.fontSizePx}px "${cfg.fontFamily}"`
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
}

export function measureArcText(
  ctx: CanvasRenderingContext2D,
  cfg: ArcTextConfig,
): { width: number; height: number } {
  ctx.save()
  applyFont(ctx, cfg)
  const m = ctx.measureText(cfg.text)
  const width =
    m.width + Math.max(0, cfg.text.length - 1) * cfg.letterSpacingPx
  ctx.restore()
  return { width: Math.max(1, width), height: cfg.fontSizePx * 1.15 }
}

export function drawArcText(
  ctx: CanvasRenderingContext2D,
  cfg: ArcTextConfig,
): void {
  ctx.save()
  applyFont(ctx, cfg)
  const { width } = measureArcText(ctx, cfg)
  let x = -width / 2
  const y = cfg.fontSizePx * 0.36
  for (const ch of cfg.text) {
    if (cfg.stroke && cfg.strokeWidthPx) {
      ctx.strokeStyle = cfg.stroke
      ctx.lineWidth = cfg.strokeWidthPx
      ctx.lineJoin = 'round'
      ctx.strokeText(ch, x, y)
    }
    ctx.fillStyle = cfg.fill
    ctx.fillText(ch, x, y)
    x += ctx.measureText(ch).width + cfg.letterSpacingPx
  }
  ctx.restore()
}
