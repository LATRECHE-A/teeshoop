/**
 * A4 dev harness — arc text proof sheet.
 *
 * Draws 'CHAMPIONS 2026' at curves −90/−45/0/45/90 in four registry fonts
 * (after ensureFont), plus a stroke row and a letter-spacing row, and an
 * edge-case strip. Every sample is overlaid with its measureArcText box in
 * magenta — the box must hug the ink tightly and be centered on the cell
 * crosshair.
 */
import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import '@/styles.css'
import { drawArcText, measureArcText, type ArcTextConfig } from '@/lib/arcText'
import { allFontsReady, ensureFont } from '@/lib/fonts'

const TEXT = 'CHAMPIONS 2026'
const CURVES = [-90, -45, 0, 45, 90] as const

interface RowSpec {
  label: string
  family: string
  fontSize: number
  letterSpacing: number
  fill: string
  stroke: string | null
  strokeWidth: number
  cellBg: string | null
}

const ROWS: RowSpec[] = [
  { label: 'Anton', family: 'Anton', fontSize: 34, letterSpacing: 0, fill: '#EEF1F5', stroke: null, strokeWidth: 0, cellBg: null },
  { label: 'Pacifico', family: 'Pacifico', fontSize: 34, letterSpacing: 0, fill: '#EEF1F5', stroke: null, strokeWidth: 0, cellBg: null },
  { label: 'Bangers', family: 'Bangers', fontSize: 34, letterSpacing: 0, fill: '#EEF1F5', stroke: null, strokeWidth: 0, cellBg: null },
  { label: 'Special Elite', family: 'Special Elite', fontSize: 34, letterSpacing: 0, fill: '#EEF1F5', stroke: null, strokeWidth: 0, cellBg: null },
  { label: 'Anton · 6px stroke', family: 'Anton', fontSize: 34, letterSpacing: 0, fill: '#FFFFFF', stroke: '#000000', strokeWidth: 6, cellBg: '#4E5763' },
  { label: 'Anton · spacing 10px', family: 'Anton', fontSize: 26, letterSpacing: 10, fill: '#EEF1F5', stroke: null, strokeWidth: 0, cellBg: null },
]

interface EdgeSpec {
  label: string
  cfg: ArcTextConfig
}

const EDGES: EdgeSpec[] = [
  {
    label: 'empty string → 1×1',
    cfg: { text: '', fontFamily: 'Anton', fontSizePx: 34, letterSpacingPx: 0, curve: 45, fill: '#EEF1F5' },
  },
  {
    label: 'single glyph · c 60',
    cfg: { text: 'M', fontFamily: 'Anton', fontSizePx: 40, letterSpacingPx: 0, curve: 60, fill: '#EEF1F5' },
  },
  {
    label: 'emoji · c 45',
    cfg: { text: '🏆 GO 🎯', fontFamily: 'Bangers', fontSizePx: 34, letterSpacingPx: 0, curve: 45, fill: '#EEF1F5' },
  },
  {
    label: 'spaces only → 1×1',
    cfg: { text: '   ', fontFamily: 'Anton', fontSizePx: 34, letterSpacingPx: 0, curve: 45, fill: '#EEF1F5' },
  },
  {
    label: 'negative tracking · c −45',
    cfg: { text: 'TIGHT TRACKING', fontFamily: 'Anton', fontSizePx: 34, letterSpacingPx: -2, curve: -45, fill: '#EEF1F5' },
  },
]

/**
 * Contract self-test: rasterize each config on a scratch canvas, scan the
 * actually painted pixels, and compare the ink box against measureArcText
 * (must agree within ±2px in size, and be centered on the draw origin).
 */
interface SelfTest {
  samples: number
  maxSizeDev: number
  maxCenterDev: number
  worst: string
}

function runSelfTest(measureCtx: CanvasRenderingContext2D): SelfTest {
  const configs: { name: string; cfg: ArcTextConfig }[] = []
  for (const row of ROWS) {
    for (const curve of CURVES) {
      configs.push({
        name: `${row.label} c${curve}`,
        cfg: {
          text: TEXT,
          fontFamily: row.family,
          fontSizePx: row.fontSize,
          letterSpacingPx: row.letterSpacing,
          curve,
          fill: row.fill,
          stroke: row.stroke,
          strokeWidthPx: row.strokeWidth,
        },
      })
    }
  }
  for (const e of EDGES) {
    if (e.cfg.text.trim().length > 0) configs.push({ name: e.label, cfg: e.cfg })
  }

  const scratch = document.createElement('canvas')
  const result: SelfTest = { samples: 0, maxSizeDev: 0, maxCenterDev: 0, worst: '—' }
  let worstDev = -1

  for (const { name, cfg } of configs) {
    // Measure with the sheet ctx, draw with the scratch ctx: proves the two
    // code paths agree across canvases (editor measures, texture draws).
    const m = measureArcText(measureCtx, cfg)
    const w = Math.ceil(m.width) + 40
    const h = Math.ceil(m.height) + 40
    scratch.width = w
    scratch.height = h
    const sctx = scratch.getContext('2d', { willReadFrequently: true })
    if (!sctx) continue
    sctx.clearRect(0, 0, w, h)
    sctx.save()
    sctx.translate(w / 2, h / 2)
    drawArcText(sctx, cfg)
    sctx.restore()

    const px = sctx.getImageData(0, 0, w, h).data
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let y = 0; y < h; y++) {
      const rowOff = y * w * 4
      for (let x = 0; x < w; x++) {
        if (px[rowOff + x * 4 + 3] > 0) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    if (minX === Infinity) continue // nothing painted
    const inkW = maxX - minX + 1
    const inkH = maxY - minY + 1
    const sizeDev = Math.max(Math.abs(inkW - m.width), Math.abs(inkH - m.height))
    const centerDev = Math.max(
      Math.abs((minX + maxX + 1) / 2 - w / 2),
      Math.abs((minY + maxY + 1) / 2 - h / 2),
    )
    result.samples++
    const dev = Math.max(sizeDev, centerDev)
    if (dev > worstDev) {
      worstDev = dev
      result.worst = name
    }
    if (sizeDev > result.maxSizeDev) result.maxSizeDev = sizeDev
    if (centerDev > result.maxCenterDev) result.maxCenterDev = centerDev
  }
  return result
}

const CELL_W = 360
const CELL_H = 200
const PAD = 24
const LABEL_H = 22

const GRID_W = PAD * 2 + CELL_W * CURVES.length
const GRID_H = PAD * 2 + CELL_H * (ROWS.length + 1)

const MAGENTA = '#FF3D8F'

function drawCell(
  ctx: CanvasRenderingContext2D,
  cellX: number,
  cellY: number,
  cfg: ArcTextConfig,
  label: string,
  cellBg: string | null,
): void {
  if (cellBg) {
    ctx.fillStyle = cellBg
    ctx.fillRect(cellX + 1, cellY + 1, CELL_W - 2, CELL_H - 2)
  }
  ctx.strokeStyle = 'rgba(42, 50, 62, 0.9)'
  ctx.lineWidth = 1
  ctx.strokeRect(cellX + 0.5, cellY + 0.5, CELL_W, CELL_H)

  const cx = cellX + CELL_W / 2
  const cy = cellY + (CELL_H - LABEL_H) / 2

  // Center crosshair — the ink bbox must be centered here.
  ctx.strokeStyle = cellBg ? 'rgba(12, 15, 19, 0.5)' : '#39434F'
  ctx.beginPath()
  ctx.moveTo(cx - 9, cy)
  ctx.lineTo(cx + 9, cy)
  ctx.moveTo(cx, cy - 9)
  ctx.lineTo(cx, cy + 9)
  ctx.stroke()

  const m = measureArcText(ctx, cfg)

  ctx.save()
  ctx.translate(cx, cy)
  drawArcText(ctx, cfg)
  ctx.strokeStyle = MAGENTA
  ctx.lineWidth = 1
  ctx.strokeRect(-m.width / 2, -m.height / 2, m.width, m.height)
  ctx.restore()

  ctx.font = '11px "JetBrains Mono", monospace'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = cellBg ? '#161B22' : '#6B7686'
  ctx.fillText(
    `${label}  ·  ${m.width.toFixed(0)}×${m.height.toFixed(0)}`,
    cellX + 10,
    cellY + CELL_H - 8,
  )
}

function drawSheet(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = GRID_W * dpr
  canvas.height = GRID_H * dpr
  canvas.style.width = `${GRID_W}px`
  canvas.style.height = `${GRID_H}px`
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(dpr, dpr)

  ctx.fillStyle = '#0C0F13'
  ctx.fillRect(0, 0, GRID_W, GRID_H)

  ROWS.forEach((row, r) => {
    CURVES.forEach((curve, c) => {
      const cfg: ArcTextConfig = {
        text: TEXT,
        fontFamily: row.family,
        fontSizePx: row.fontSize,
        letterSpacingPx: row.letterSpacing,
        curve,
        fill: row.fill,
        stroke: row.stroke,
        strokeWidthPx: row.strokeWidth,
      }
      drawCell(
        ctx,
        PAD + c * CELL_W,
        PAD + r * CELL_H,
        cfg,
        `${row.label} · c ${curve}`,
        row.cellBg,
      )
    })
  })

  const edgeY = PAD + ROWS.length * CELL_H
  EDGES.forEach((edge, c) => {
    drawCell(ctx, PAD + c * CELL_W, edgeY, edge.cfg, edge.label, null)
  })
  return ctx
}

function Harness(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [test, setTest] = useState<SelfTest | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // Explicitly ensure the families drawn below, then the whole registry.
      await Promise.all(
        ['Anton', 'Pacifico', 'Bangers', 'Special Elite'].map(ensureFont),
      )
      await allFontsReady()
      if (cancelled || !canvasRef.current) return
      const ctx = drawSheet(canvasRef.current)
      setStatus('ready')
      if (ctx) setTest(runSelfTest(ctx))
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const pass = test && test.maxSizeDev <= 2 && test.maxCenterDev <= 2

  return (
    <div className="min-h-full overflow-auto bg-bg0 p-6" data-status={status}>
      <header className="mb-4 flex items-baseline gap-4">
        <h1 className="font-display text-lg font-bold tracking-wide text-tx">
          A4 · arc text proof sheet
        </h1>
        <p className="text-xs text-tx2">
          “{TEXT}” at curves −90 · −45 · 0 · 45 · 90 — magenta frame =
          measureArcText, must hug the ink and center on the crosshair.
        </p>
        <span
          className={
            status === 'ready'
              ? 'font-mono text-xs text-ok'
              : 'font-mono text-xs text-yl'
          }
        >
          {status === 'ready' ? 'fonts ready' : 'loading fonts…'}
        </span>
        {test && (
          <span
            className={
              pass ? 'font-mono text-xs text-ok' : 'font-mono text-xs text-dg'
            }
            data-selftest={pass ? 'pass' : 'fail'}
          >
            measure⇄ink self-test: {test.samples} samples · Δsize{' '}
            {test.maxSizeDev.toFixed(2)}px · Δcenter{' '}
            {test.maxCenterDev.toFixed(2)}px {pass ? '≤2px PASS' : `FAIL (worst: ${test.worst})`}
          </span>
        )}
      </header>
      <canvas ref={canvasRef} />
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Harness />
  </React.StrictMode>,
)
