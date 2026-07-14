/**
 * STUB — module A2 replaces this file entirely (see docs/CONTRACTS.md §A2).
 */

export interface RemoveBgProgress {
  stage: 'model' | 'inference' | 'compositing'
  pct?: number
}

export function isBgRemovalSupported(): boolean {
  return false
}

export async function preloadBgModel(
  onProgress?: (pct: number) => void,
): Promise<void> {
  void onProgress
  throw new Error('Background removal module not built yet')
}

export async function removeBackground(
  source: Blob,
  opts?: { onProgress?: (p: RemoveBgProgress) => void },
): Promise<Blob> {
  void source
  void opts
  throw new Error('Background removal module not built yet')
}

export async function alphaBoundingBox(
  source: Blob,
): Promise<{ x: number; y: number; w: number; h: number } | null> {
  void source
  return null
}
