/**
 * Dev harness for module A2: in-browser background removal.
 * Served at /dev/bgremove.html (dev only, excluded from the prod build).
 */
import { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import '@/styles.css'
import {
  alphaBoundingBox,
  isBgRemovalSupported,
  preloadBgModel,
  removeBackground,
  type RemoveBgProgress,
} from '@/lib/bgremove'

type Stage = RemoveBgProgress['stage']

interface Timings {
  modelMs: number
  inferenceMs: number
  compositingMs: number
  totalMs: number
}

type BBox = { x: number; y: number; w: number; h: number } | null

declare global {
  interface Window {
    __bgApi?: {
      removeBackground: typeof removeBackground
      alphaBoundingBox: typeof alphaBoundingBox
      preloadBgModel: typeof preloadBgModel
      isBgRemovalSupported: typeof isBgRemovalSupported
      makeTestBlob: () => Promise<Blob>
    }
    __bgLast?: Timings
    __bgBBox?: BBox
  }
}

// ---------------------------------------------------------------------------
// Generated test image: colorful hot-air balloon on a busy gradient backdrop
// ---------------------------------------------------------------------------

function drawTestScene(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  // Busy multi-stop gradient background.
  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#11667e')
  bg.addColorStop(0.35, '#5a3e9e')
  bg.addColorStop(0.68, '#a03a68')
  bg.addColorStop(1, '#c97a35')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // Diagonal stripes.
  ctx.save()
  ctx.globalAlpha = 0.09
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 24
  for (let x = -H; x < W + H; x += 92) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x + H, H)
    ctx.stroke()
  }
  ctx.restore()

  // Soft light blobs.
  const blobs: Array<[number, number, number, string]> = [
    [W * 0.18, H * 0.24, H * 0.34, 'rgba(53,199,255,0.20)'],
    [W * 0.86, H * 0.2, H * 0.3, 'rgba(255,201,64,0.18)'],
    [W * 0.78, H * 0.85, H * 0.4, 'rgba(255,61,143,0.16)'],
  ]
  for (const [bx, by, br, color] of blobs) {
    const g = ctx.createRadialGradient(bx, by, 0, bx, by, br)
    g.addColorStop(0, color)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
  }

  // Vignette (darker corners → photo-like).
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.95)
  vig.addColorStop(0, 'rgba(0,0,0,0)')
  vig.addColorStop(1, 'rgba(8,10,16,0.5)')
  ctx.fillStyle = vig
  ctx.fillRect(0, 0, W, H)

  // ---- Salient object: hot-air balloon -----------------------------------
  const cx = W / 2
  const cy = H * 0.42
  const R = H * 0.3

  // Envelope with vertical gores.
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.clip()
  ctx.fillStyle = '#e23c54'
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2)
  const gores = ['#ffc940', '#35c7ff', '#ff7a3d', '#8a5cff']
  const widths = [0.78, 0.52, 0.3, 0.12]
  for (let i = 0; i < gores.length; i++) {
    ctx.fillStyle = gores[i]
    ctx.beginPath()
    ctx.ellipse(cx, cy, R * widths[i], R, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  // Glossy highlight.
  const gloss = ctx.createRadialGradient(
    cx - R * 0.4,
    cy - R * 0.45,
    0,
    cx - R * 0.4,
    cy - R * 0.45,
    R * 0.9,
  )
  gloss.addColorStop(0, 'rgba(255,255,255,0.5)')
  gloss.addColorStop(0.4, 'rgba(255,255,255,0.12)')
  gloss.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gloss
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2)
  // Bottom shade.
  const shade = ctx.createLinearGradient(0, cy, 0, cy + R)
  shade.addColorStop(0, 'rgba(30,10,40,0)')
  shade.addColorStop(1, 'rgba(30,10,40,0.45)')
  ctx.fillStyle = shade
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2)
  ctx.restore()

  // Envelope outline.
  ctx.lineWidth = R * 0.045
  ctx.strokeStyle = '#241026'
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.stroke()

  // Throat + ropes + basket.
  const throatY = cy + R * 0.96
  const basketY = cy + R * 1.38
  const basketW = R * 0.42
  const basketH = R * 0.32
  ctx.fillStyle = '#4a2340'
  ctx.beginPath()
  ctx.moveTo(cx - R * 0.22, throatY - R * 0.12)
  ctx.lineTo(cx + R * 0.22, throatY - R * 0.12)
  ctx.lineTo(cx + R * 0.14, throatY + R * 0.06)
  ctx.lineTo(cx - R * 0.14, throatY + R * 0.06)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = '#241026'
  ctx.lineWidth = R * 0.03
  ctx.stroke()

  ctx.strokeStyle = '#3a1c2e'
  ctx.lineWidth = R * 0.035
  ctx.beginPath()
  ctx.moveTo(cx - R * 0.13, throatY + R * 0.05)
  ctx.lineTo(cx - basketW / 2 + R * 0.05, basketY)
  ctx.moveTo(cx + R * 0.13, throatY + R * 0.05)
  ctx.lineTo(cx + basketW / 2 - R * 0.05, basketY)
  ctx.stroke()

  const bg2 = ctx.createLinearGradient(0, basketY, 0, basketY + basketH)
  bg2.addColorStop(0, '#9a642e')
  bg2.addColorStop(1, '#5d3a1a')
  ctx.fillStyle = bg2
  ctx.beginPath()
  ctx.roundRect(cx - basketW / 2, basketY, basketW, basketH, R * 0.05)
  ctx.fill()
  ctx.strokeStyle = '#2d1810'
  ctx.lineWidth = R * 0.035
  ctx.stroke()
  // Weave lines.
  ctx.strokeStyle = 'rgba(45,24,16,0.55)'
  ctx.lineWidth = R * 0.015
  for (let i = 1; i < 4; i++) {
    const yy = basketY + (basketH * i) / 4
    ctx.beginPath()
    ctx.moveTo(cx - basketW / 2 + R * 0.02, yy)
    ctx.lineTo(cx + basketW / 2 - R * 0.02, yy)
    ctx.stroke()
  }
}

/** ~1500px synthetic "photo": salient object on a busy gradient background. */
async function makeTestBlob(): Promise<Blob> {
  const W = 1536
  const H = 1152
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  drawTestScene(ctx, W, H)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
      'image/jpeg',
      0.92,
    )
  })
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

const checkerStyle: React.CSSProperties = {
  backgroundColor: '#141920',
  backgroundImage:
    'linear-gradient(45deg,#222a35 25%,transparent 25%,transparent 75%,#222a35 75%),' +
    'linear-gradient(45deg,#222a35 25%,transparent 25%,transparent 75%,#222a35 75%)',
  backgroundSize: '18px 18px',
  backgroundPosition: '0 0, 9px 9px',
}

function RegMark(): React.ReactElement {
  return (
    <svg width="34" height="34" viewBox="0 0 54 54" fill="none" aria-hidden="true">
      <circle cx="27" cy="27" r="16" stroke="#35C7FF" strokeWidth="2.5" />
      <path
        d="M27 2v12M27 40v12M2 27h12M40 27h12"
        stroke="#FF3D8F"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="27" cy="27" r="3" fill="#EEF1F5" />
    </svg>
  )
}

const STAGES: Stage[] = ['model', 'inference', 'compositing']
const STAGE_LABEL: Record<Stage, string> = {
  model: 'model',
  inference: 'inference',
  compositing: 'compositing',
}

function fmtMs(ms: number | undefined): string {
  return ms === undefined ? '—' : `${Math.round(ms)} ms`
}

function App(): React.ReactElement {
  const [beforeUrl, setBeforeUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<RemoveBgProgress | null>(null)
  const [timings, setTimings] = useState<Timings | null>(null)
  const [bbox, setBBox] = useState<BBox>(null)
  const [resultDims, setResultDims] = useState<{ w: number; h: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preloadPct, setPreloadPct] = useState<number | null>(null)
  const [conc, setConc] = useState<{ state: 'idle' | 'running' | 'ok' | 'fail'; text: string }>({
    state: 'idle',
    text: 'not run',
  })
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const runningRef = useRef(false)

  useEffect(() => {
    window.__bgApi = {
      removeBackground,
      alphaBoundingBox,
      preloadBgModel,
      isBgRemovalSupported,
      makeTestBlob,
    }
  }, [])

  async function run(blob: Blob): Promise<void> {
    if (runningRef.current) return
    runningRef.current = true
    setBusy(true)
    setError(null)
    setTimings(null)
    setBBox(null)
    setResultDims(null)
    setProgress({ stage: 'model', pct: 0 })
    const canvas = canvasRef.current
    if (canvas) {
      canvas.dataset.ready = '0'
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    }
    setBeforeUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(blob)
    })

    const marks: Partial<Record<Stage, number>> = {}
    const t0 = performance.now()
    try {
      const png = await removeBackground(blob, {
        onProgress: (p) => {
          if (marks[p.stage] === undefined) marks[p.stage] = performance.now()
          setProgress(p)
        },
      })
      const tDone = performance.now()
      const mModel = marks.model ?? t0
      const mInfer = marks.inference ?? tDone
      const mComp = marks.compositing ?? tDone
      const t: Timings = {
        modelMs: Math.max(0, Math.round(mInfer - mModel)),
        inferenceMs: Math.max(0, Math.round(mComp - mInfer)),
        compositingMs: Math.max(0, Math.round(tDone - mComp)),
        totalMs: Math.round(tDone - t0),
      }

      const bmp = await createImageBitmap(png)
      const target = canvasRef.current
      if (target) {
        target.width = bmp.width
        target.height = bmp.height
        target.getContext('2d')?.drawImage(bmp, 0, 0)
      }
      setResultDims({ w: bmp.width, h: bmp.height })
      bmp.close()

      const box = await alphaBoundingBox(png)
      setBBox(box)
      setTimings(t)
      window.__bgLast = t
      window.__bgBBox = box
      if (target) target.dataset.ready = '1'
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setProgress(null)
      runningRef.current = false
    }
  }

  async function handleGenerated(): Promise<void> {
    try {
      await run(await makeTestBlob())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function handleFile(ev: React.ChangeEvent<HTMLInputElement>): void {
    const file = ev.target.files?.[0]
    ev.target.value = ''
    if (file) void run(file)
  }

  async function handlePreload(): Promise<void> {
    setError(null)
    setPreloadPct(0)
    try {
      await preloadBgModel((pct) => setPreloadPct(pct))
      setPreloadPct(100)
    } catch (err) {
      setPreloadPct(null)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleConcurrent(): Promise<void> {
    if (runningRef.current) return
    runningRef.current = true
    setBusy(true)
    setError(null)
    setConc({ state: 'running', text: 'running 2 overlapping jobs…' })
    try {
      const blob = await makeTestBlob()
      const t0 = performance.now()
      const [a, b] = await Promise.all([removeBackground(blob), removeBackground(blob)])
      const ms = Math.round(performance.now() - t0)
      setConc({
        state: 'ok',
        text: `ok, 2 jobs queued + resolved in ${ms} ms (${Math.round(a.size / 1024)} KiB / ${Math.round(b.size / 1024)} KiB)`,
      })
    } catch (err) {
      setConc({
        state: 'fail',
        text: `failed: ${err instanceof Error ? err.message : String(err)}`,
      })
    } finally {
      setBusy(false)
      runningRef.current = false
    }
  }

  const stageIdx = progress ? STAGES.indexOf(progress.stage) : -1
  const indeterminate = progress?.pct === undefined

  return (
    <div className="h-screen overflow-y-auto canvas-surface">
      <style>{`@keyframes bg-indet { 0% { transform: translateX(-100%);} 100% { transform: translateX(400%);} }`}</style>
      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* Header */}
        <header className="mb-7 flex items-center gap-4">
          <RegMark />
          <div>
            <h1 className="font-display text-xl font-bold tracking-wide">
              Background removal <span className="text-grad-ink">lab</span>
            </h1>
            <p className="mono-dim mt-0.5">
              A2 · u2netp.onnx (4.6 MB) · onnxruntime-web wasm EP · 320×320 letterbox
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="chip">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: isBgRemovalSupported() ? '#3ADC97' : '#FF5C5C' }}
              />
              {isBgRemovalSupported() ? 'wasm supported' : 'unsupported'}
            </span>
          </div>
        </header>

        {/* Controls */}
        <section className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-bg2 p-4">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFile}
            data-testid="input-file"
          />
          <button
            className="btn"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            data-testid="btn-file"
          >
            Choose image…
          </button>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void handleGenerated()}
            data-testid="btn-generated"
          >
            Use generated test image
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() => void handleConcurrent()}
            data-testid="btn-concurrent"
          >
            Run 2× concurrently
          </button>
          <button
            className="btn btn-ghost"
            disabled={busy || preloadPct !== null}
            onClick={() => void handlePreload()}
            data-testid="btn-preload"
          >
            {preloadPct === null
              ? 'Preload model'
              : preloadPct < 100
                ? `Model ${preloadPct}%`
                : 'Model ready'}
          </button>

          {/* Progress */}
          <div className="min-w-56 grow basis-64">
            <div className="mb-1.5 flex items-center gap-2">
              {STAGES.map((s, i) => (
                <span
                  key={s}
                  className="rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider"
                  style={{
                    color: stageIdx === i ? '#0C0F13' : stageIdx > i ? '#3ADC97' : '#6B7686',
                    background: stageIdx === i ? '#35C7FF' : 'transparent',
                    border: `1px solid ${stageIdx === i ? '#35C7FF' : '#2A323E'}`,
                  }}
                >
                  {STAGE_LABEL[s]}
                </span>
              ))}
              <span className="mono-dim ml-auto" data-testid="progress-text">
                {progress
                  ? progress.pct === undefined
                    ? `${progress.stage}…`
                    : `${progress.stage} ${progress.pct}%`
                  : timings
                    ? 'done'
                    : 'idle'}
              </span>
            </div>
            <div
              className="relative h-2 overflow-hidden rounded-full bg-bg3"
              role="progressbar"
              aria-valuenow={progress?.pct ?? undefined}
            >
              {progress &&
                (indeterminate ? (
                  <div
                    className="absolute inset-y-0 w-1/4 rounded-full grad-ink"
                    style={{ animation: 'bg-indet 1.1s ease-in-out infinite' }}
                  />
                ) : (
                  <div
                    className="h-full rounded-full grad-ink transition-[width] duration-150"
                    style={{ width: `${progress.pct ?? 0}%` }}
                  />
                ))}
            </div>
          </div>
        </section>

        {/* Timings */}
        <section className="mb-5 flex flex-wrap items-center gap-2">
          {(
            [
              ['model', timings?.modelMs],
              ['inference', timings?.inferenceMs],
              ['compositing', timings?.compositingMs],
              ['total', timings?.totalMs],
            ] as const
          ).map(([label, ms]) => (
            <span key={label} className="chip">
              <span className="text-tx3">{label}</span>
              <span className="font-mono text-[11px] text-tx" data-testid={`ms-${label}`}>
                {fmtMs(ms)}
              </span>
            </span>
          ))}
          <span
            className="chip"
            data-testid="conc-status"
            data-conc={conc.state}
            style={{
              borderColor:
                conc.state === 'ok' ? '#3ADC97' : conc.state === 'fail' ? '#FF5C5C' : undefined,
            }}
          >
            <span className="text-tx3">2× concurrent</span>
            <span className="font-mono text-[11px]">{conc.text}</span>
          </span>
          {error && (
            <span className="chip" style={{ borderColor: '#FF5C5C', color: '#FF5C5C' }} data-testid="error">
              {error}
            </span>
          )}
        </section>

        {/* Before / After */}
        <section className="grid gap-5 md:grid-cols-2">
          <div className="rounded-xl border border-line bg-bg2 p-4">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="panel-title">Before</h2>
              <span className="mono-dim">source</span>
            </div>
            <div
              className="flex min-h-72 items-center justify-center overflow-hidden rounded-lg border border-line"
              style={checkerStyle}
            >
              {beforeUrl ? (
                <img
                  src={beforeUrl}
                  alt="source"
                  data-testid="before-img"
                  className="max-h-[560px] w-auto max-w-full"
                />
              ) : (
                <p className="mono-dim py-24">pick a file or generate a test image</p>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-line bg-bg2 p-4">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="panel-title">After</h2>
              <span className="mono-dim" data-testid="bbox-text">
                {resultDims ? `${resultDims.w}×${resultDims.h}px · ` : ''}
                {bbox
                  ? `bbox ${bbox.w}×${bbox.h} @ (${bbox.x}, ${bbox.y})`
                  : timings
                    ? 'bbox: null'
                    : 'cutout'}
              </span>
            </div>
            <div
              className="flex min-h-72 items-center justify-center overflow-hidden rounded-lg border border-line"
              style={checkerStyle}
            >
              <div className="relative">
                <canvas
                  ref={canvasRef}
                  id="result-canvas"
                  data-testid="result-canvas"
                  data-ready="0"
                  className="max-h-[560px] w-auto max-w-full"
                  style={{ display: resultDims ? 'block' : 'none' }}
                />
                {resultDims && bbox && (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute border border-dashed"
                    style={{
                      borderColor: 'rgba(53,199,255,0.75)',
                      left: `${(bbox.x / resultDims.w) * 100}%`,
                      top: `${(bbox.y / resultDims.h) * 100}%`,
                      width: `${(bbox.w / resultDims.w) * 100}%`,
                      height: `${(bbox.h / resultDims.h) * 100}%`,
                    }}
                  />
                )}
                {!resultDims && (
                  <p className="mono-dim py-24 text-center">
                    {busy ? 'working…' : 'result appears here'}
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>

        <footer className="mt-6 pb-10">
          <p className="mono-dim">
            worker: module · queue: serialized in-worker · sources &gt;2048px are downscaled ·
            output: PNG straight alpha · bbox = alpha&gt;10
          </p>
        </footer>
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />)
