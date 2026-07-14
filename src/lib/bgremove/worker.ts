/**
 * Module Web Worker entry for background removal.
 *
 * Jobs are processed strictly one at a time (`queue` chain) so concurrent
 * removeBackground() calls from the page are safe — the second simply waits.
 * Model-download progress is broadcast to every enqueued job, so a job
 * waiting behind the first-ever run still surfaces download percentage.
 */
import {
  ensureSession,
  removeBackgroundImpl,
  setModelProgressBroadcast,
} from './engine'
import type { ClientToWorker, WorkerToClient } from './protocol'

// tsconfig lib is DOM (webworker lib would conflict); cast the worker scope.
const scope = self as unknown as {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (ev: MessageEvent) => void): void
}

const post = (msg: WorkerToClient): void => scope.postMessage(msg)

/** Jobs enqueued and not yet finished — model progress fans out to all. */
const activeIds = new Set<number>()
setModelProgressBroadcast((pct) => {
  for (const id of activeIds) post({ kind: 'progress', id, stage: 'model', pct })
})

let queue: Promise<void> = Promise.resolve()

async function run(msg: ClientToWorker): Promise<void> {
  try {
    if (msg.kind === 'preload') {
      await ensureSession()
      post({ kind: 'done', id: msg.id })
    } else {
      const png = await removeBackgroundImpl(msg.blob, (p) =>
        post({ kind: 'progress', id: msg.id, stage: p.stage, pct: p.pct }),
      )
      post({ kind: 'done', id: msg.id, blob: png })
    }
  } catch (err) {
    post({
      kind: 'fail',
      id: msg.id,
      message: err instanceof Error ? err.message : String(err),
    })
  } finally {
    activeIds.delete(msg.id)
  }
}

scope.addEventListener('message', (ev: MessageEvent) => {
  const msg = ev.data as ClientToWorker
  if (!msg || (msg.kind !== 'preload' && msg.kind !== 'remove')) return
  activeIds.add(msg.id)
  queue = queue.then(() => run(msg)) // run() never rejects
})
