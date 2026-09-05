/**
 * A2: In-browser background removal (docs/CONTRACTS.md §A2).
 *
 * Salient-object background removal with U²-Net small (u2netp.onnx, ~4.6 MB)
 * running on the onnxruntime-web wasm EP (single-threaded, no COOP/COEP).
 *
 * All heavy work happens in a module Web Worker; the main thread only posts
 * blobs and receives progress + the finished PNG. When OffscreenCanvas is
 * unavailable (or the worker cannot boot) the same engine runs on the main
 * thread instead, cooperatively yielding between row chunks.
 *
 * Concurrency: calls are safe to overlap: jobs are queued inside the worker
 * (and behind a promise chain in the fallback), and the model/session is
 * downloaded and created exactly once, then cached for the session lifetime.
 */
import {
  canDecodeImages,
  canRasterize,
  createRaster,
  decodeBlob,
  hasOffscreen2d,
} from './canvas'
import { computeAlphaBBox } from './pixels'
import type { ClientToWorker, WorkerToClient } from './protocol'

/** Progress event for removeBackground. `pct` is 0..100 when known. */
export interface RemoveBgProgress {
  stage: 'model' | 'inference' | 'compositing'
  pct?: number
}

/** Thrown internally when the worker itself dies (triggers the fallback). */
class WorkerCrashedError extends Error {
  constructor() {
    super('Background-removal worker crashed')
    this.name = 'WorkerCrashedError'
  }
}

// ---------------------------------------------------------------------------
// Support detection
// ---------------------------------------------------------------------------

let cachedSupport: boolean | null = null

/** True when this browser can run in-browser background removal. */
export function isBgRemovalSupported(): boolean {
  if (cachedSupport === null) {
    try {
      cachedSupport =
        typeof WebAssembly === 'object' &&
        WebAssembly !== null &&
        typeof WebAssembly.instantiate === 'function' &&
        typeof fetch === 'function' &&
        typeof Blob !== 'undefined' &&
        canDecodeImages() &&
        canRasterize()
    } catch {
      cachedSupport = false
    }
  }
  return cachedSupport
}

// ---------------------------------------------------------------------------
// Worker client
// ---------------------------------------------------------------------------

interface PendingJob {
  resolve: (blob: Blob | undefined) => void
  reject: (err: Error) => void
  onProgress?: (p: RemoveBgProgress) => void
}

let worker: Worker | null = null
let workerBroken = false
let nextJobId = 1
const pending = new Map<number, PendingJob>()

function canUseWorker(): boolean {
  // The worker pipeline needs OffscreenCanvas; per contract we fall back to
  // the main thread when it is missing.
  return !workerBroken && typeof Worker !== 'undefined' && hasOffscreen2d()
}

function onWorkerMessage(ev: MessageEvent): void {
  const msg = ev.data as WorkerToClient
  const job = pending.get(msg.id)
  if (!job) return
  if (msg.kind === 'progress') {
    job.onProgress?.({ stage: msg.stage, pct: msg.pct })
  } else if (msg.kind === 'done') {
    pending.delete(msg.id)
    job.resolve(msg.blob)
  } else {
    pending.delete(msg.id)
    job.reject(new Error(msg.message))
  }
}

/** Worker-level failure (script failed to load/parse/crash) → fall back. */
function onWorkerError(): void {
  workerBroken = true
  const jobs = Array.from(pending.values())
  pending.clear()
  worker?.terminate()
  worker = null
  const err = new WorkerCrashedError()
  for (const job of jobs) job.reject(err)
}

function getWorker(): Worker {
  if (worker) return worker
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    })
  } catch {
    workerBroken = true
    throw new WorkerCrashedError()
  }
  worker.addEventListener('message', onWorkerMessage)
  worker.addEventListener('error', onWorkerError)
  return worker
}

function submitToWorker(
  build: (id: number) => ClientToWorker,
  onProgress?: (p: RemoveBgProgress) => void,
): Promise<Blob | undefined> {
  return new Promise<Blob | undefined>((resolve, reject) => {
    const id = nextJobId++
    pending.set(id, { resolve, reject, onProgress })
    try {
      getWorker().postMessage(build(id))
    } catch (err) {
      pending.delete(id)
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

// ---------------------------------------------------------------------------
// Main-thread fallback (no OffscreenCanvas / worker crashed)
// ---------------------------------------------------------------------------

let enginePromise: Promise<typeof import('./engine')> | null = null

function loadEngine(): Promise<typeof import('./engine')> {
  enginePromise ??= import('./engine')
  return enginePromise
}

/** Serializes fallback jobs so concurrent calls never share a session.run. */
let fallbackQueue: Promise<unknown> = Promise.resolve()

function enqueueOnMain<T>(task: () => Promise<T>): Promise<T> {
  const run = fallbackQueue.then(task, task)
  fallbackQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

const yieldToUi = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Warm everything up front: boots the worker, downloads u2netp.onnx (progress
 * 0..100 via `onProgress`) and creates the cached inference session, so the
 * first removeBackground() call skips straight to inference.
 */
export async function preloadBgModel(
  onProgress?: (pct: number) => void,
  assets?: string,
): Promise<void> {
  if (!isBgRemovalSupported()) {
    throw new Error('Background removal is not supported in this browser')
  }
  if (canUseWorker()) {
    try {
      await submitToWorker(
        (id) => ({ kind: 'preload', id, assets }),
        (p) => {
          if (p.stage === 'model' && typeof p.pct === 'number') {
            onProgress?.(Math.min(99, p.pct))
          }
        },
      )
      onProgress?.(100)
      return
    } catch (err) {
      if (!(err instanceof WorkerCrashedError)) throw err
    }
  }
  const engine = await loadEngine()
  // Comme dans `removeBackground` : le repli sur le fil principal a besoin de
  // la même base, sinon il cherche 18 Mo à la racine du site.
  if (assets) engine.configureAssets(assets)
  await enqueueOnMain(() =>
    engine.ensureSession((pct) => onProgress?.(Math.min(99, pct))),
  )
  onProgress?.(100)
}

/**
 * Remove the background of an image blob. Resolves to a PNG blob with a
 * straight-alpha cutout of the salient object. Sources larger than 2048px on
 * the long edge are downscaled to 2048 first. Safe to call concurrently.
 */
export async function removeBackground(
  source: Blob,
  opts?: { onProgress?: (p: RemoveBgProgress) => void; assets?: string },
): Promise<Blob> {
  if (!isBgRemovalSupported()) {
    throw new Error('Background removal is not supported in this browser')
  }
  const onProgress = opts?.onProgress
  if (canUseWorker()) {
    try {
      const png = await submitToWorker(
        (id) => ({ kind: 'remove', id, blob: source, assets: opts?.assets }),
        onProgress,
      )
      if (!(png instanceof Blob)) throw new Error('Worker returned no image')
      return png
    } catch (err) {
      if (!(err instanceof WorkerCrashedError)) throw err
      // Worker died (e.g. module workers unsupported). Retry on main thread.
    }
  }
  const engine = await loadEngine()
  /*
   * LE CHEMIN DE REPLI, SUR LE FIL PRINCIPAL, A BESOIN DE LA MÊME BASE.
   *
   * Il ne sert que quand le Web Worker meurt (modules non supportés), et c'est
   * précisément le navigateur où l'on ne veut pas ajouter une seconde panne :
   * sans cette ligne il chercherait le runtime à la racine du site et
   * échouerait pour une raison différente de la première.
   */
  if (opts?.assets) engine.configureAssets(opts.assets)
  return enqueueOnMain(() =>
    engine.removeBackgroundImpl(source, onProgress, yieldToUi),
  )
}

/**
 * Decode an image blob and return the tight bounding box (source pixel
 * coordinates) of pixels with alpha > 10, or null when the image is fully
 * opaque (or nothing clears the threshold).
 */
export async function alphaBoundingBox(
  source: Blob,
): Promise<{ x: number; y: number; w: number; h: number } | null> {
  const decoded = await decodeBlob(source)
  try {
    if (!decoded.width || !decoded.height) return null
    const raster = createRaster(decoded.width, decoded.height)
    raster.ctx.drawImage(decoded.source, 0, 0)
    const img = raster.ctx.getImageData(0, 0, decoded.width, decoded.height)
    return computeAlphaBBox(img.data, decoded.width, decoded.height)
  } finally {
    decoded.close()
  }
}
