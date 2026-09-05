/** Message protocol between the bgremove client (index.ts) and its worker. */

export type BgStage = 'model' | 'inference' | 'compositing'

export type ClientToWorker =
  /*
   * `assets` VOYAGE AVEC CHAQUE DEMANDE, et pas dans un message de réglage.
   *
   * Le runtime ONNX (13,5 Mo) et le modèle (4,6 Mo) sont servis par le Worker
   * Cloudflare, pas par la boutique, depuis que le personnalisateur est dans la
   * page WordPress : sans cette base ils seraient cherchés à la racine du site
   * et rendraient 404. Un message de réglage séparé aurait créé un ordre à
   * garantir entre deux messages ; ici la première demande porte ce qu'il faut
   * et il n'y a rien à séquencer.
   */
  | { kind: 'preload'; id: number; assets?: string }
  | { kind: 'remove'; id: number; blob: Blob; assets?: string }

export type WorkerToClient =
  | { kind: 'progress'; id: number; stage: BgStage; pct?: number }
  | { kind: 'done'; id: number; blob?: Blob }
  | { kind: 'fail'; id: number; message: string }
