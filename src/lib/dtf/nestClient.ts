/**
 * Worker client for the true-shape packer, with an inline fallback.
 *
 * WHY A CLIENT AT ALL: the modal re-nests on every keystroke in the gap field.
 * A 250-piece run at 12 restarts is ~2 s of straight-line arithmetic (enough
 * to make the whole admin UI stutter), so it belongs off-thread. But Workers
 * are absent in some embedded webviews and in the headless harness, and a
 * feature that silently does nothing there would be worse than a slow one:
 * `nest` therefore runs the very same pure function inline when construction
 * fails, and callers cannot tell the difference in the result.
 *
 * ONE JOB AT A TIME, PER CLIENT. A superseded job is not queued, it is
 * TERMINATED: the operator has already moved on, and finishing the old layout
 * only delays the one they are waiting for. The next call builds a fresh
 * worker.
 *
 * CANCELLATION IS SCOPED TO A CLIENT, NOT TO THE MODULE. This used to be one
 * module-level worker + abort pair, which meant any second consumer silently
 * killed the first: the dev harness (src/dev/dtfHarness.tsx) both mounts
 * `DtfModal` and exposes its own nesting entry point, so the modal's effect
 * cleanup terminated the harness's in-flight job and the whole DTF suite failed
 * with `nesting superseded`. That was a real design flaw and not merely a test
 * artefact: "cancel" must mean "cancel MY job", or the abstraction is a
 * booby trap for the next caller. Each consumer now owns a `NestClient`.
 *
 * A terminated job's promise is REJECTED, never left dangling. Killing the
 * worker silently means the caller's `.then` never runs and its `.catch` never
 * runs either: the modal's "Optimisation 7/33…" spinner then stays on screen
 * for the rest of the session, because the only thing that clears it is one of
 * those two callbacks. A promise that can never settle is a leak with a UI.
 */
import { runNestJob, type NestJob } from './trueshape'
import type { NestResult } from './nesting'
import type { NestWorkerResponse } from './nestWorker'

/** Marks the rejection a cancellation produces, so callers can tell it apart. */
export const NEST_CANCELLED = 'nesting superseded'

function spawn(): Worker | null {
  if (typeof Worker === 'undefined') return null
  try {
    return new Worker(new URL('./nestWorker.ts', import.meta.url), { type: 'module' })
  } catch {
    return null
  }
}

export interface NestAsyncOpts {
  onProgress?: (done: number, total: number) => void
  /** True when the worker was unavailable and the run happened on this thread. */
  onInline?: () => void
}

export interface NestClient {
  /**
   * Nest `job`, off-thread when possible. Resolves with the same `NestResult`
   * the synchronous `runNestJob` would have produced, byte-identical, since
   * the masks cross the boundary as structured-clone copies and the packer
   * reads nothing else. Supersedes this client's own previous job, and only
   * that one.
   */
  nest(job: NestJob, opts?: NestAsyncOpts): Promise<NestResult>
  /** Kill this client's in-flight job and settle its promise. Idempotent. */
  cancel(): void
}

/**
 * An independent nesting channel. Give each consumer its own: two components
 * sharing one client will cancel each other, which is precisely the bug this
 * shape exists to prevent.
 */
export function createNestClient(): NestClient {
  let worker: Worker | null = null
  let abort: ((reason: Error) => void) | null = null
  let jobSeq = 0

  const cancel = (): void => {
    const stop = abort
    abort = null
    if (worker) {
      worker.terminate()
      worker = null
    }
    stop?.(new Error(NEST_CANCELLED))
  }

  const nest = (job: NestJob, opts: NestAsyncOpts = {}): Promise<NestResult> => {
    cancel()
    const w = spawn()
    if (!w) {
      opts.onInline?.()
      // Still a promise, so the caller has exactly one code path. The work is
      // synchronous; the microtask hop just lets the caller paint "computing…".
      return Promise.resolve().then(() => runNestJob(job, opts.onProgress))
    }
    worker = w
    const jobId = ++jobSeq

    return new Promise<NestResult>((resolve, reject) => {
      abort = reject
      /** This job is over: stop `cancel` from rejecting it afterwards. */
      const settle = () => {
        if (abort === reject) abort = null
        if (worker === w) {
          w.terminate()
          worker = null
        }
      }
      w.onmessage = (e: MessageEvent<NestWorkerResponse>) => {
        const msg = e.data
        if (msg.jobId !== jobId) return
        if (msg.type === 'progress') {
          opts.onProgress?.(msg.done, msg.total)
          return
        }
        settle()
        if (msg.type === 'done') resolve(msg.result)
        else reject(new Error(msg.message))
      }
      w.onerror = (e) => {
        settle()
        // A module-Worker that fails to boot (CSP, bundler edge case) must not
        // take the feature down with it: fall back rather than surface an error.
        opts.onInline?.()
        try {
          resolve(runNestJob(job, opts.onProgress))
        } catch {
          reject(new Error(e.message || 'nesting worker failed'))
        }
      }
      w.postMessage({ jobId, job })
    })
  }

  return { nest, cancel }
}

/**
 * Shared client for one-off callers that have no lifecycle of their own.
 * Anything that mounts, unmounts, or runs alongside another consumer must call
 * `createNestClient()` instead (see the module header).
 */
const shared = createNestClient()

export const nestAsync = (job: NestJob, opts?: NestAsyncOpts): Promise<NestResult> =>
  shared.nest(job, opts)

export const cancelNesting = (): void => shared.cancel()
