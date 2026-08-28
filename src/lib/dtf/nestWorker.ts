/**
 * Nesting Web Worker: keeps a 250-piece true-shape run off the main thread.
 *
 * The packer itself stays a pure, synchronously-callable function in
 * trueshape.ts; this file is nothing but a message pump. That split is
 * deliberate: the headless harness (scripts/dtf-verify.mjs) and the benchmark
 * exercise the SAME code path the UI runs, with no Worker in sight, so a
 * regression cannot hide behind postMessage.
 *
 * The protocol is one job at a time: the client terminates a superseded
 * worker rather than queueing, because a stale layout arriving after the
 * operator has already changed the gap is worse than no layout at all.
 */
/// <reference lib="webworker" />
import { runNestJob, type NestJob } from './trueshape'
import type { NestResult } from './nesting'

export interface NestWorkerRequest {
  /** Echoed back so the client can drop answers to superseded jobs. */
  jobId: number
  job: NestJob
}

export type NestWorkerResponse =
  | { jobId: number; type: 'progress'; done: number; total: number }
  | { jobId: number; type: 'done'; result: NestResult }
  | { jobId: number; type: 'error'; message: string }

const post = (msg: NestWorkerResponse) => (self as DedicatedWorkerGlobalScope).postMessage(msg)

self.onmessage = (e: MessageEvent<NestWorkerRequest>) => {
  const { jobId, job } = e.data
  try {
    const result = runNestJob(job, (done, total) =>
      post({ jobId, type: 'progress', done, total }),
    )
    post({ jobId, type: 'done', result })
  } catch (err) {
    post({ jobId, type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
