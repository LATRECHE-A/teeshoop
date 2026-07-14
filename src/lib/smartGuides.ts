/**
 * Smart guides — pure snapping math for the 2D editor.
 *
 * `computeSnap` tries to align the moving box's LEFT / CENTER / RIGHT edges
 * to the candidate vertical lines in `targets.xs`, and its TOP / MIDDLE /
 * BOTTOM edges to the horizontal lines in `targets.ys`. Per axis, the
 * candidate with the smallest |delta| within `tolerance` wins; the returned
 * `vLines` / `hLines` contain ALL target lines that align at the winning
 * delta (a box can be snapped to several lines at once — e.g. centered both
 * ways, or left AND right edges hitting two guides simultaneously).
 *
 * Pure and allocation-light: called on every mousemove.
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

/** Float slack when collecting every line matched at the winning delta. */
const MATCH_EPS = 1e-4

function bestDelta(
  a: number,
  b: number,
  c: number,
  targets: number[],
  tolerance: number,
): number {
  let best = 0
  let bestAbs = Infinity
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]
    let d = t - a
    let abs = d < 0 ? -d : d
    if (abs <= tolerance && abs < bestAbs) {
      bestAbs = abs
      best = d
    }
    d = t - b
    abs = d < 0 ? -d : d
    if (abs <= tolerance && abs < bestAbs) {
      bestAbs = abs
      best = d
    }
    d = t - c
    abs = d < 0 ? -d : d
    if (abs <= tolerance && abs < bestAbs) {
      bestAbs = abs
      best = d
    }
  }
  return bestAbs === Infinity ? NaN : best
}

function collectMatches(
  a: number,
  b: number,
  c: number,
  targets: number[],
  out: number[],
): void {
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]
    if (
      Math.abs(t - a) <= MATCH_EPS ||
      Math.abs(t - b) <= MATCH_EPS ||
      Math.abs(t - c) <= MATCH_EPS
    ) {
      out.push(t)
    }
  }
}

/**
 * Compute the snap translation for `box` against `targets`.
 * Returns dx/dy = 0 and empty line lists on an axis with no candidate
 * within `tolerance`.
 */
export function computeSnap(
  box: SnapInput,
  targets: SnapTargets,
  tolerance: number,
): SnapResult {
  const left = box.x
  const centerX = box.x + box.w / 2
  const right = box.x + box.w
  const top = box.y
  const middleY = box.y + box.h / 2
  const bottom = box.y + box.h

  const rawDx = bestDelta(left, centerX, right, targets.xs, tolerance)
  const rawDy = bestDelta(top, middleY, bottom, targets.ys, tolerance)

  const vLines: number[] = []
  const hLines: number[] = []
  const dx = Number.isNaN(rawDx) ? 0 : rawDx
  const dy = Number.isNaN(rawDy) ? 0 : rawDy

  if (!Number.isNaN(rawDx)) {
    collectMatches(left + dx, centerX + dx, right + dx, targets.xs, vLines)
  }
  if (!Number.isNaN(rawDy)) {
    collectMatches(top + dy, middleY + dy, bottom + dy, targets.ys, hLines)
  }
  return { dx, dy, vLines, hLines }
}
