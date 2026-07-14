/** Message protocol between the bgremove client (index.ts) and its worker. */

export type BgStage = 'model' | 'inference' | 'compositing'

export type ClientToWorker =
  | { kind: 'preload'; id: number }
  | { kind: 'remove'; id: number; blob: Blob }

export type WorkerToClient =
  | { kind: 'progress'; id: number; stage: BgStage; pct?: number }
  | { kind: 'done'; id: number; blob?: Blob }
  | { kind: 'fail'; id: number; message: string }
