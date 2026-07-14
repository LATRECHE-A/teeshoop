/**
 * Arc text engine — measures and draws a single line of text along a
 * circular arc on a 2D canvas. The exact same layout code runs in the live
 * editor, the 3D texture renders and the 300-DPI print export, so measure
 * and draw are deterministic and always agree.
 *
 * Semantics (canonical for the whole app):
 * - `curve` ∈ -100..100. |curve| < 2 → straight single line.
 * - curve > 0 = ARCH (classic collegiate print): the middle of the text
 *   RISES and the ends drop — the baseline sits on TOP of a circle whose
 *   center is BELOW the text.
 * - curve < 0 = VALLEY: the middle dips — the text sits INSIDE the bottom
 *   of a circle whose center is ABOVE the text.
 * - Total sweep angle = curve × 1.8° (capped at 180°). Baseline radius
 *   r = totalArcLength / sweepRadians, where totalArcLength =
 *   Σ glyph advances + letterSpacingPx × (n − 1) — i.e. letter spacing is
 *   measured ALONG the arc.
 * - Each glyph is anchored at the angle of its advance-midpoint on the arc
 *   and rotated tangent to it (feet stay on the baseline circle).
 * - Stroke, when present, is painted UNDER the fill, per glyph.
 *
 * `drawArcText` draws centered on the origin: the bounding box of the
 * rendered ink is centered at (0, 0), and `measureArcText` returns exactly
 * that box (the editor draws selection frames from it).
 */

export interface ArcTextConfig {
  text: string
  fontFamily: string
  fontSizePx: number
  letterSpacingPx: number
  /** -100..100, 0 straight, positive arcs up (arch), negative dips (valley). */
  curve: number
  fill: string
  stroke?: string | null
  strokeWidthPx?: number
}

const DEG2RAD = Math.PI / 180
/** |curve| below this renders as a straight line. */
const STRAIGHT_THRESHOLD = 2
const MAX_SWEEP_DEG = 180
/** Ascent/descent approximations used when TextMetrics ink boxes are absent. */
const ASCENT_EM = 0.8
const DESCENT_EM = 0.24

interface GlyphPlace {
  g: string
  /** Advance width, px. */
  adv: number
  /** Baseline anchor (glyph advance-midpoint) in raw layout coordinates. */
  x: number
  y: number
  /** Tangent rotation, radians (canvas clockwise-positive). */
  rot: number
  /**
   * Ink box in glyph-local coordinates (anchor at the advance midpoint on
   * the baseline, +y down), already expanded for stroke. `bands` (raster-
   * refined pictographs only) are horizontal ink slices used for a tighter
   * union under rotation. Null = paints nothing (whitespace).
   */
  ink: { l: number; t: number; r: number; b: number; bands: InkBox[] | null } | null
}

interface ArcLayout {
  glyphs: GlyphPlace[]
  /** Union of transformed glyph ink boxes in raw layout coordinates. */
  minX: number
  minY: number
  maxX: number
  maxY: number
  hasInk: boolean
}

let cachedSegmenter: Intl.Segmenter | null | undefined
/** Split into user-perceived characters (keeps emoji/ZWJ clusters intact). */
function splitGraphemes(text: string): string[] {
  if (cachedSegmenter === undefined) {
    cachedSegmenter =
      typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
        ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
        : null
  }
  if (cachedSegmenter) {
    const out: string[] = []
    for (const part of cachedSegmenter.segment(text)) out.push(part.segment)
    return out
  }
  return Array.from(text)
}

function applyFont(ctx: CanvasRenderingContext2D, cfg: ArcTextConfig): void {
  const family = cfg.fontFamily.replace(/"/g, '\\"')
  ctx.font = `${cfg.fontSizePx}px "${family}"`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

function effectiveStrokeWidth(cfg: ArcTextConfig): number {
  const w = cfg.strokeWidthPx ?? 0
  return cfg.stroke && Number.isFinite(w) && w > 0 ? w : 0
}

const WHITESPACE_RE = /^\s+$/u
/** Emoji-ish clusters (incl. flags / variation selectors). */
const PICTOGRAPHIC_RE = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}]/u

interface InkBox {
  l: number
  t: number
  r: number
  b: number
}

interface RasterInk {
  box: InkBox
  /**
   * Horizontal ink slices (top→bottom). A single rotated rectangle
   * overbounds round bitmaps badly; unioning rotated thin bands keeps the
   * bbox tight at any tangent angle.
   */
  bands: InkBox[]
}

/**
 * Color-emoji bitmaps paint inside (or occasionally outside) the box that
 * TextMetrics reports, so for pictographic glyphs we rasterize the glyph
 * once, scan the actually painted pixels and cache the true ink geometry
 * (keyed by font + glyph). Returns null when rasterization is unavailable
 * or paints nothing — callers then keep the reported metrics.
 */
const rasterCache = new Map<string, RasterInk | null>()
const RASTER_CACHE_MAX = 256
const RASTER_PAD = 8
let rasterCtx: CanvasRenderingContext2D | null | undefined

function rasterInkBox(
  font: string,
  g: string,
  aL: number,
  aA: number,
  aR: number,
  aD: number,
): RasterInk | null {
  const key = `${font}\u0000${g}`
  const cached = rasterCache.get(key)
  if (cached !== undefined) return cached

  if (rasterCtx === undefined) {
    rasterCtx =
      typeof document === 'undefined'
        ? null
        : document
            .createElement('canvas')
            .getContext('2d', { willReadFrequently: true })
  }
  if (!rasterCtx) return null

  const w = Math.min(2048, Math.ceil(aL + aR) + RASTER_PAD * 2)
  const h = Math.min(2048, Math.ceil(aA + aD) + RASTER_PAD * 2)
  if (w <= RASTER_PAD * 2 || h <= RASTER_PAD * 2) return null
  const ctx = rasterCtx
  const canvas = ctx.canvas
  if (canvas.width < w) canvas.width = w
  if (canvas.height < h) canvas.height = h
  ctx.clearRect(0, 0, w, h)
  ctx.font = font
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#000'
  const ax = Math.ceil(aL) + RASTER_PAD
  const ay = Math.ceil(aA) + RASTER_PAD
  ctx.fillText(g, ax, ay)

  const px = ctx.getImageData(0, 0, w, h).data
  // Per-row ink extents in one pass, then union + band reduction.
  const rowMin = new Array<number>(h).fill(Infinity)
  const rowMax = new Array<number>(h).fill(-Infinity)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let y = 0; y < h; y++) {
    const row = y * w * 4
    for (let x = 0; x < w; x++) {
      if (px[row + x * 4 + 3] > 0) {
        if (x < rowMin[y]) rowMin[y] = x
        if (x > rowMax[y]) rowMax[y] = x
      }
    }
    if (rowMin[y] !== Infinity) {
      if (rowMin[y] < minX) minX = rowMin[y]
      if (rowMax[y] > maxX) maxX = rowMax[y]
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  let result: RasterInk | null = null
  if (minX !== Infinity) {
    const box: InkBox = {
      l: minX - ax,
      t: minY - ay,
      r: maxX + 1 - ax,
      b: maxY + 1 - ay,
    }
    // Collapse rows into ~4px horizontal bands (max 16) so the bbox stays
    // tight when the glyph is rotated along the arc.
    const inkH = maxY - minY + 1
    const bandCount = Math.max(1, Math.min(16, Math.ceil(inkH / 4)))
    const bandH = inkH / bandCount
    const bands: InkBox[] = []
    for (let bi = 0; bi < bandCount; bi++) {
      const y0 = minY + Math.floor(bi * bandH)
      const y1 = bi === bandCount - 1 ? maxY : minY + Math.floor((bi + 1) * bandH) - 1
      let bMinX = Infinity
      let bMaxX = -Infinity
      let bMinY = Infinity
      let bMaxY = -Infinity
      for (let y = y0; y <= y1; y++) {
        if (rowMin[y] === Infinity) continue
        if (rowMin[y] < bMinX) bMinX = rowMin[y]
        if (rowMax[y] > bMaxX) bMaxX = rowMax[y]
        if (y < bMinY) bMinY = y
        if (y > bMaxY) bMaxY = y
      }
      if (bMinX === Infinity) continue
      bands.push({
        l: bMinX - ax,
        t: bMinY - ay,
        r: bMaxX + 1 - ax,
        b: bMaxY + 1 - ay,
      })
    }
    result = { box, bands }
  }
  if (rasterCache.size >= RASTER_CACHE_MAX) rasterCache.clear()
  rasterCache.set(key, result)
  return result
}

/**
 * Shared layout: glyph placement + analytic ink bounding box.
 * Expects the font to be applied on `ctx` already. Returns null when there
 * is nothing to lay out (empty text, non-positive font size).
 */
function layoutArcText(
  ctx: CanvasRenderingContext2D,
  cfg: ArcTextConfig,
): ArcLayout | null {
  if (!cfg.text || !Number.isFinite(cfg.fontSizePx) || cfg.fontSizePx <= 0) {
    return null
  }
  const glyphs = splitGraphemes(cfg.text)
  const n = glyphs.length
  if (n === 0) return null

  const fontSize = cfg.fontSizePx
  const spacing = Number.isFinite(cfg.letterSpacingPx) ? cfg.letterSpacingPx : 0
  const pad = effectiveStrokeWidth(cfg) / 2
  const fallbackAscent = fontSize * ASCENT_EM
  const fallbackDescent = fontSize * DESCENT_EM

  // ---- pass 1: metrics ----------------------------------------------------
  const advances = new Array<number>(n)
  const inkBoxes = new Array<GlyphPlace['ink']>(n)
  let totalAdvance = 0
  for (let i = 0; i < n; i++) {
    const g = glyphs[i]
    const m = ctx.measureText(g)
    const adv = Number.isFinite(m.width) ? m.width : 0
    advances[i] = adv
    totalAdvance += adv
    if (WHITESPACE_RE.test(g)) {
      inkBoxes[i] = null
      continue
    }
    // Tight ink box from TextMetrics when available, else em-box fallback.
    const aL = m.actualBoundingBoxLeft
    const aR = m.actualBoundingBoxRight
    const aA = m.actualBoundingBoxAscent
    const aD = m.actualBoundingBoxDescent
    const useActual =
      Number.isFinite(aL) &&
      Number.isFinite(aR) &&
      Number.isFinite(aA) &&
      Number.isFinite(aD)
    let left = useActual ? -aL : 0
    let right = useActual ? aR : adv
    let top = useActual ? -aA : -fallbackAscent
    let bottom = useActual ? aD : fallbackDescent
    // Reported metrics are exact for vector glyphs but only nominal for
    // color-emoji bitmaps — refine those against the real raster.
    let bands: InkBox[] | null = null
    if (PICTOGRAPHIC_RE.test(g)) {
      const rb = rasterInkBox(ctx.font, g, -left, -top, right, bottom)
      if (rb) {
        left = rb.box.l
        top = rb.box.t
        right = rb.box.r
        bottom = rb.box.b
        bands = rb.bands
      }
    }
    if (right <= left || bottom <= top) {
      inkBoxes[i] = null // paints nothing (e.g. zero-width glyph)
      continue
    }
    // Re-anchor to the advance midpoint and expand for the stroke.
    const half = adv / 2
    inkBoxes[i] = {
      l: left - half - pad,
      t: top - pad,
      r: right - half + pad,
      b: bottom + pad,
      bands: bands
        ? bands.map((bb) => ({
            l: bb.l - half - pad,
            t: bb.t - pad,
            r: bb.r - half + pad,
            b: bb.b + pad,
          }))
        : null,
    }
  }

  const totalArcLength = totalAdvance + spacing * (n - 1)
  const safeLength = Math.max(totalArcLength, 1e-3)

  const curve = Number.isFinite(cfg.curve)
    ? Math.max(-100, Math.min(100, cfg.curve))
    : 0
  const curved = Math.abs(curve) >= STRAIGHT_THRESHOLD

  let sweep = 0
  let radius = 0
  if (curved) {
    sweep = Math.min(Math.abs(curve) * 1.8, MAX_SWEEP_DEG) * DEG2RAD
    radius = safeLength / sweep
  }

  // ---- pass 2: placement + ink union --------------------------------------
  const placed = new Array<GlyphPlace>(n)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let hasInk = false
  let cursor = 0

  for (let i = 0; i < n; i++) {
    const adv = advances[i]
    const mid = cursor + adv / 2
    cursor += adv + spacing

    let x: number
    let y: number
    let rot: number
    if (!curved) {
      // Straight line, baseline y = 0, centered on x = 0 (pre-recenter).
      x = mid - safeLength / 2
      y = 0
      rot = 0
    } else {
      const theta = (mid / safeLength - 0.5) * sweep
      if (curve > 0) {
        // Arch: baseline on top of a circle centered below (raw center 0,0).
        x = radius * Math.sin(theta)
        y = -radius * Math.cos(theta)
        rot = theta
      } else {
        // Valley: inside the bottom of a circle centered above (raw 0,0).
        x = radius * Math.sin(theta)
        y = radius * Math.cos(theta)
        rot = -theta
      }
    }

    const ink = inkBoxes[i]
    placed[i] = { g: glyphs[i], adv, x, y, rot, ink }
    if (!ink) continue
    hasInk = true
    const cos = Math.cos(rot)
    const sin = Math.sin(rot)
    // Transform the 4 corners of the local ink box into raw coordinates.
    for (let corner = 0; corner < 4; corner++) {
      const lx = corner === 0 || corner === 2 ? ink.l : ink.r
      const ly = corner < 2 ? ink.t : ink.b
      const px = x + lx * cos - ly * sin
      const py = y + lx * sin + ly * cos
      if (px < minX) minX = px
      if (px > maxX) maxX = px
      if (py < minY) minY = py
      if (py > maxY) maxY = py
    }
  }

  return { glyphs: placed, minX, minY, maxX, maxY, hasInk }
}

/**
 * Size of the box `drawArcText` will ink for this config (stroke included).
 * Empty / whitespace-only / degenerate input → 1×1.
 */
export function measureArcText(
  ctx2d: CanvasRenderingContext2D,
  cfg: ArcTextConfig,
): { width: number; height: number } {
  ctx2d.save()
  applyFont(ctx2d, cfg)
  const layout = layoutArcText(ctx2d, cfg)
  ctx2d.restore()
  if (!layout || !layout.hasInk) return { width: 1, height: 1 }
  return {
    width: Math.max(1, layout.maxX - layout.minX),
    height: Math.max(1, layout.maxY - layout.minY),
  }
}

/**
 * Draw the configured text centered on the current origin: the ink bounding
 * box spans −w/2..w/2 × −h/2..h/2 where {w, h} = `measureArcText(ctx, cfg)`.
 */
export function drawArcText(
  ctx2d: CanvasRenderingContext2D,
  cfg: ArcTextConfig,
): void {
  ctx2d.save()
  applyFont(ctx2d, cfg)
  const layout = layoutArcText(ctx2d, cfg)
  if (!layout || !layout.hasInk) {
    ctx2d.restore()
    return
  }
  // Shift so the ink bbox is centered on the origin.
  const cx = (layout.minX + layout.maxX) / 2
  const cy = (layout.minY + layout.maxY) / 2

  const strokeWidth = effectiveStrokeWidth(cfg)
  if (strokeWidth > 0 && cfg.stroke) {
    ctx2d.strokeStyle = cfg.stroke
    ctx2d.lineWidth = strokeWidth
    ctx2d.lineJoin = 'round'
    ctx2d.lineCap = 'round'
    ctx2d.miterLimit = 2
  }
  ctx2d.fillStyle = cfg.fill

  for (const p of layout.glyphs) {
    if (!p.ink) continue
    ctx2d.save()
    ctx2d.translate(p.x - cx, p.y - cy)
    ctx2d.rotate(p.rot)
    // Anchor at the advance midpoint: draw from -adv/2 with textAlign left.
    if (strokeWidth > 0 && cfg.stroke) ctx2d.strokeText(p.g, -p.adv / 2, 0)
    ctx2d.fillText(p.g, -p.adv / 2, 0)
    ctx2d.restore()
  }
  ctx2d.restore()
}
