/**
 * The heavy half of background removal: ONNX session management plus the
 * full decode → letterbox → U²-Net → mask → composite pipeline.
 *
 * This module normally executes inside the module Web Worker (worker.ts).
 * When OffscreenCanvas is unavailable, index.ts dynamically imports it on the
 * main thread instead and passes a `yieldFn` so long loops give the UI air.
 */
// NOTE: the shared vite config aliases 'onnxruntime-web' →
// 'onnxruntime-web/wasm' (wasm-EP-only build, keeps the 26 MB jsep binary out
// of the deploy). Import the ROOT specifier: importing the /wasm subpath
// directly would collide with that prefix alias.
import * as ort from 'onnxruntime-web'
import {
  MODEL_SIZE,
  applyAlphaRows,
  blurRowsH,
  blurRowsV,
  computeLetterbox,
  fitWithin,
  minMaxNormalize,
  toModelTensor,
  upsampleMaskRows,
} from './pixels'
import { createRaster, decodeBlob, scaleToCanvas, toPngBlob } from './canvas'
import type { BgStage } from './protocol'

export interface EngineProgress {
  stage: BgStage
  pct?: number
}

/** Optional cooperative-yield hook for the main-thread fallback. */
export type YieldFn = () => void | Promise<void>

const MODEL_URL = '/models/u2netp.onnx'
/** Sources larger than this on the long edge are downscaled first. */
export const MAX_SOURCE_EDGE = 2048
const ROW_CHUNK = 160

/**
 * Where the ort runtime files live. With a string `wasmPaths` prefix ort
 * dynamically imports `ort-wasm-simd-threaded.mjs` (JS glue) and fetches
 * `ort-wasm-simd-threaded.wasm` from that prefix. The shared vite config
 * copies exactly those two files.
 *
 * `/ort/` is the contracted flat path (the runtime is committed at
 * public/ort/). The bare node_modules path is a dev-server-only safety net.
 * Probe the wasm magic bytes once and use the first prefix that is real, so
 * this module works with either layout.
 */
const WASM_FILE = 'ort-wasm-simd-threaded.wasm'
const WASM_BASE_CANDIDATES = [
  '/ort/',
  '/ort/node_modules/onnxruntime-web/dist/',
  '/node_modules/onnxruntime-web/dist/',
] as const

async function sniffWasm(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-3' } })
    if (!res.ok) return false
    let head: Uint8Array
    const reader = res.body?.getReader()
    if (reader) {
      let bytes = new Uint8Array(0)
      while (bytes.length < 4) {
        const { done, value } = await reader.read()
        if (done) break
        const merged = new Uint8Array(bytes.length + value.length)
        merged.set(bytes)
        merged.set(value, bytes.length)
        bytes = merged
      }
      void reader.cancel().catch(() => undefined)
      head = bytes
    } else {
      head = new Uint8Array(await res.arrayBuffer())
    }
    // '\0asm'
    return (
      head.length >= 4 &&
      head[0] === 0x00 &&
      head[1] === 0x61 &&
      head[2] === 0x73 &&
      head[3] === 0x6d
    )
  } catch {
    return false
  }
}

async function resolveWasmPaths(): Promise<string> {
  for (const base of WASM_BASE_CANDIDATES) {
    if (await sniffWasm(`${base}${WASM_FILE}`)) return base
  }
  return WASM_BASE_CANDIDATES[0] // contracted default; ort surfaces the error
}

let ortConfigured = false
let sessionPromise: Promise<ort.InferenceSession> | null = null
let modelReady = false
/** Listeners registered for the duration of one model load. */
const modelListeners = new Set<(pct: number) => void>()
/** Extra global hook (the worker broadcasts download pct to queued jobs). */
let broadcastFn: ((pct: number) => void) | null = null

export function isModelReady(): boolean {
  return modelReady
}

export function setModelProgressBroadcast(fn: (pct: number) => void): void {
  broadcastFn = fn
}

function notifyModelPct(pct: number): void {
  if (broadcastFn) broadcastFn(pct)
  for (const fn of modelListeners) fn(pct)
}

/** Download the model once, streaming progress when Content-Length allows. */
async function fetchModel(onPct: (pct: number) => void): Promise<Uint8Array> {
  const res = await fetch(MODEL_URL)
  if (!res.ok) throw new Error(`Model download failed (HTTP ${res.status})`)
  // Content-Length counts encoded bytes; the stream yields decoded bytes, so
  // treat the ratio as an estimate and clamp below 100 until finished.
  const total = Number(res.headers.get('content-length') ?? 0)
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer())
    onPct(99)
    return buf
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.byteLength
    if (total > 0) {
      onPct(Math.max(1, Math.min(99, Math.round((received / total) * 100))))
    }
  }
  const out = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

async function createSession(): Promise<ort.InferenceSession> {
  if (!ortConfigured) {
    // Object-form override: hand ort ONLY the .wasm binary URL and keep the
    // JS glue that is embedded in the ort.wasm bundle build. A string prefix
    // would make ort dynamic-import `<prefix>/ort-wasm-simd-threaded.mjs`,
    // which vite dev refuses for public-directory files ("assets in public
    // cannot be imported as modules"). Single-threaded: no COOP/COEP needed.
    const base = await resolveWasmPaths()
    ort.env.wasm.wasmPaths = {
      wasm: new URL(`${base}${WASM_FILE}`, globalThis.location.href).toString(),
    }
    ort.env.wasm.numThreads = 1
    ort.env.logLevel = 'error'
    ortConfigured = true
  }
  const bytes = await fetchModel(notifyModelPct)
  return ort.InferenceSession.create(bytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  })
}

/**
 * Get (or create) the cached inference session. `onPct` reports model
 * download progress 0..100; when the model is already resident it fires
 * immediately with 100.
 */
export function ensureSession(
  onPct?: (pct: number) => void,
): Promise<ort.InferenceSession> {
  if (onPct) {
    if (modelReady) onPct(100)
    else modelListeners.add(onPct)
  }
  if (!sessionPromise) {
    sessionPromise = createSession()
    sessionPromise.then(
      () => {
        modelReady = true
        notifyModelPct(100)
        modelListeners.clear()
      },
      () => {
        // Allow later calls to retry (e.g. transient network failure).
        sessionPromise = null
        modelListeners.clear()
      },
    )
  }
  return sessionPromise
}

/**
 * Full background-removal pipeline. Returns a PNG blob (straight alpha) at
 * the working size (source size, downscaled to ≤ MAX_SOURCE_EDGE long edge).
 */
export async function removeBackgroundImpl(
  source: Blob,
  onProgress?: (p: EngineProgress) => void,
  yieldFn?: YieldFn,
): Promise<Blob> {
  const emit = (p: EngineProgress): void => {
    if (onProgress) onProgress(p)
  }

  emit({ stage: 'model', pct: modelReady ? 100 : 0 })
  const session = await ensureSession((pct) => emit({ stage: 'model', pct }))

  const decoded = await decodeBlob(source)
  try {
    if (!decoded.width || !decoded.height) throw new Error('Empty image')

    // Working copy: sources > 2048px on the long edge are downscaled first.
    const [workW, workH] = fitWithin(decoded.width, decoded.height, MAX_SOURCE_EDGE)
    const working = scaleToCanvas(decoded.source, decoded.width, decoded.height, workW, workH)

    // Letterbox into the 320×320 model square (pad, never stretch).
    const box = computeLetterbox(workW, workH)
    const content = scaleToCanvas(working.canvas, workW, workH, box.contentW, box.contentH)
    const square = createRaster(MODEL_SIZE, MODEL_SIZE)
    square.ctx.fillStyle = '#808080' // neutral pad: ~0 after normalization
    square.ctx.fillRect(0, 0, MODEL_SIZE, MODEL_SIZE)
    square.ctx.drawImage(content.canvas, box.dx, box.dy)
    const squareData = square.ctx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE)
    const input = new ort.Tensor('float32', toModelTensor(squareData.data), [
      1,
      3,
      MODEL_SIZE,
      MODEL_SIZE,
    ])

    emit({ stage: 'inference' })
    if (yieldFn) await yieldFn()
    const inputName = session.inputNames[0]
    if (!inputName) throw new Error('Model has no inputs')
    const outputName = session.outputNames.includes('d0')
      ? 'd0'
      : session.outputNames[0]
    if (!outputName) throw new Error('Model has no outputs')
    const results = await session.run({ [inputName]: input }, [outputName])
    const d0 = results[outputName]
    if (!d0) throw new Error('Model returned no mask')
    const mask = d0.data as Float32Array
    if (mask.length < MODEL_SIZE * MODEL_SIZE) throw new Error('Unexpected mask size')
    minMaxNormalize(mask, box)

    emit({ stage: 'compositing', pct: 0 })
    const out = working.ctx.getImageData(0, 0, workW, workH)
    const alpha = new Float32Array(workW * workH)
    const tmp = new Float32Array(workW * workH)

    // 1) Bilinear upsample through the letterbox + smoothstep (0 → 60%).
    for (let y = 0; y < workH; y += ROW_CHUNK) {
      const yEnd = Math.min(workH, y + ROW_CHUNK)
      upsampleMaskRows(mask, box, workW, workH, alpha, y, yEnd)
      emit({ stage: 'compositing', pct: Math.round((yEnd / workH) * 60) })
      if (yieldFn) await yieldFn()
    }

    // 2) ~1px feather: separable 1-2-1 blur (60 → 80%).
    blurRowsH(alpha, tmp, workW, 0, workH)
    emit({ stage: 'compositing', pct: 70 })
    if (yieldFn) await yieldFn()
    blurRowsV(tmp, alpha, workW, workH, 0, workH)
    emit({ stage: 'compositing', pct: 80 })
    if (yieldFn) await yieldFn()

    // 3) Multiply into the alpha channel (80 → 92%).
    for (let y = 0; y < workH; y += ROW_CHUNK * 2) {
      const yEnd = Math.min(workH, y + ROW_CHUNK * 2)
      applyAlphaRows(out.data, alpha, workW, y, yEnd)
      if (yieldFn) await yieldFn()
    }
    emit({ stage: 'compositing', pct: 92 })

    // 4) Encode.
    working.ctx.putImageData(out, 0, 0)
    const png = await toPngBlob(working.canvas)
    emit({ stage: 'compositing', pct: 100 })
    return png
  } finally {
    decoded.close()
  }
}
