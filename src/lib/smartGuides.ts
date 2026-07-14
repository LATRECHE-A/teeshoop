/**
 * STUB — module A4 replaces this file entirely (see docs/CONTRACTS.md §A4).
 */

export interface SnapInput {
  x: number
  y: number
  w: number
  h: number
}
export interface SnapTargets {
  xs: number[]
  ys: number[]
}
export interface SnapResult {
  dx: number
  dy: number
  vLines: number[]
  hLines: number[]
}

export function computeSnap(
  box: SnapInput,
  targets: SnapTargets,
  tolerance: number,
): SnapResult {
  void box
  void targets
  void tolerance
  return { dx: 0, dy: 0, vLines: [], hLines: [] }
}
