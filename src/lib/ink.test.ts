/**
 * The ink measurement, pinned.
 *
 * Everything here is the PURE half of `ink.ts` — the arithmetic that turns a
 * probe into a box and boxes into visuals. The probe itself needs a canvas and
 * is exercised by `scripts/dtf-bench.mjs` against the real bundle; what these
 * cases defend is the part where a mistake is silent: a box that comes out
 * smaller than the artwork inside it.
 */
import { describe, expect, it } from 'vitest'
import {
  alphaUnitRect,
  clusterBoxes,
  FULL_UNIT,
  hullOf,
  placedInkBox,
  unionArea,
  type InkBox,
  type UnitRect,
} from './ink'
import { degToRad } from './units'

/** A single-channel alpha grid, the shape `alphaUnitRect` reads with stride 1. */
function grid(w: number, h: number, inked: [number, number][]): Uint8Array {
  const g = new Uint8Array(w * h)
  for (const [x, y] of inked) g[y * w + x] = 255
  return g
}

const unit = (a: Uint8Array, w: number, h: number) => alphaUnitRect(a, w, h, 1, 1, 0)

/**
 * The half-extent formula `layerBox` used before this module existed. Kept
 * verbatim so the equivalence below is a comparison against the real previous
 * behaviour, not against a re-derivation of it.
 */
function legacyBox(
  l: { xIn: number; yIn: number; rotation: number },
  wIn: number,
  hIn: number,
): InkBox {
  const r = Math.abs(degToRad(l.rotation))
  const hx = (wIn / 2) * Math.abs(Math.cos(r)) + (hIn / 2) * Math.abs(Math.sin(r))
  const hy = (wIn / 2) * Math.abs(Math.sin(r)) + (hIn / 2) * Math.abs(Math.cos(r))
  return { x0: l.xIn - hx, x1: l.xIn + hx, y0: l.yIn - hy, y1: l.yIn + hy }
}

const near = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps)
const boxNear = (a: InkBox, b: InkBox, eps = 1e-9) => {
  near(a.x0, b.x0, eps)
  near(a.x1, b.x1, eps)
  near(a.y0, b.y0, eps)
  near(a.y1, b.y1, eps)
}

describe('alphaUnitRect — reading a probe', () => {
  it('returns null for a source with no ink at all', () => {
    expect(unit(grid(8, 8, []), 8, 8)).toBeNull()
  })

  it('covers the whole box when the source is fully inked', () => {
    const g = new Uint8Array(16).fill(255)
    expect(unit(g, 4, 4)).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 })
  })

  it('finds a centred mark, pads by a cell, and snaps outward', () => {
    // 10×10 probe, one inked cell at (5,5). Tight bounds are 0.5..0.6; one cell
    // of padding widens that to 0.4..0.7; the 1/256 snap then rounds each edge
    // AWAY from the ink — 0.3984375 and 0.703125 — never towards it.
    const r = unit(grid(10, 10, [[5, 5]]), 10, 10)!
    near(r.x0, 102 / 256)
    near(r.x1, 180 / 256)
    near(r.y0, 102 / 256)
    near(r.y1, 180 / 256)
    expect(r.x0).toBeLessThan(0.4)
    expect(r.x1).toBeGreaterThan(0.7)
  })

  it('every edge lands on the 1/256 grid, and always on the outside of the ink', () => {
    // The snap is what makes two engines' downscale filters agree: an edge
    // pixel that resamples to alpha 0 on one and 1 on the other moves the raw
    // bound by a probe cell, which at 1024 px is a quarter of a snap step and
    // therefore usually invisible. What is GUARANTEED, and what this pins, is
    // that snapping only ever grows the rect — never trims it towards the ink.
    for (const [x, y] of [[0, 0], [37, 11], [511, 733], [1023, 1023]] as [number, number][]) {
      const r = unit(grid(1024, 1024, [[x, y]]), 1024, 1024)!
      for (const v of [r.x0, r.x1, r.y0, r.y1]) expect(v * 256).toBeCloseTo(Math.round(v * 256), 9)
      expect(r.x0).toBeLessThanOrEqual(x / 1024)
      expect(r.x1).toBeGreaterThanOrEqual((x + 1) / 1024)
      expect(r.y0).toBeLessThanOrEqual(y / 1024)
      expect(r.y1).toBeGreaterThanOrEqual((y + 1) / 1024)
    }
  })

  it('never reports a box that excludes an inked cell', () => {
    // Every inked cell must fall inside the returned rect, at every position —
    // this is the property whose failure clips a customer's artwork.
    const w = 9
    const h = 7
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const r = unit(grid(w, h, [[x, y]]), w, h)!
        expect(r.x0).toBeLessThanOrEqual(x / w)
        expect(r.x1).toBeGreaterThanOrEqual((x + 1) / w)
        expect(r.y0).toBeLessThanOrEqual(y / h)
        expect(r.y1).toBeGreaterThanOrEqual((y + 1) / h)
      }
  })

  it('clamps the padding at the edges instead of running past them', () => {
    const r = unit(grid(4, 4, [[0, 3]]), 4, 4)!
    expect(r.x0).toBe(0)
    expect(r.y1).toBe(1)
  })

  it('ignores alpha below the floor and keeps everything at or above it', () => {
    const g = new Uint8Array(4 * 4)
    g[0] = 0
    g[5] = 1 // exactly the floor — ink
    expect(unit(g, 4, 4)).not.toBeNull()
    const faint = new Uint8Array(4 * 4)
    faint[5] = 4
    expect(alphaUnitRect(faint, 4, 4, 8, 1, 0)).toBeNull()
  })

  it('reads an interleaved RGBA buffer by default', () => {
    const rgba = new Uint8ClampedArray(4 * 4 * 4)
    rgba[(1 * 4 + 1) * 4 + 3] = 255
    const r = alphaUnitRect(rgba, 4, 4)!
    near(r.x0, 0)
    near(r.x1, 0.75)
  })
})

describe('placedInkBox — a measurement becomes a footprint', () => {
  const at = { xIn: 1.5, yIn: -2, rotation: 0 }

  it('reproduces the previous half-extent box exactly, at every angle', () => {
    for (const rotation of [0, 7, 30, 45, 90, 123, 180, 270, -37, 359]) {
      const p = { xIn: 0.7, yIn: -1.3, rotation }
      boxNear(placedInkBox(p, 4, 2.5, FULL_UNIT), legacyBox(p, 4, 2.5), 1e-12)
    }
  })

  it('an unrotated trim shrinks the footprint by exactly the trimmed fraction', () => {
    // The middle third in each axis: one ninth of the area, centred as before.
    const third: UnitRect = { x0: 1 / 3, y0: 1 / 3, x1: 2 / 3, y1: 2 / 3 }
    const b = placedInkBox(at, 6, 3, third)
    near(b.x1 - b.x0, 2)
    near(b.y1 - b.y0, 1)
    near((b.x0 + b.x1) / 2, at.xIn)
  })

  it('an off-centre trim moves the footprint off the layer origin', () => {
    // Ink hugging the left edge — the case a 2000px PNG with the mark at one
    // side produces, and the one the old centred formula could not express.
    const left: UnitRect = { x0: 0, y0: 0.25, x1: 0.25, y1: 0.75 }
    const b = placedInkBox(at, 8, 4, left)
    near(b.x0, at.xIn - 4)
    near(b.x1, at.xIn - 2)
    near(b.y0, at.yIn - 1)
    near(b.y1, at.yIn + 1)
  })

  it('flipX mirrors the ink about the layer centre', () => {
    const left: UnitRect = { x0: 0, y0: 0, x1: 0.25, y1: 1 }
    const plain = placedInkBox(at, 8, 4, left)
    const flipped = placedInkBox(at, 8, 4, left, true)
    near(plain.x0, at.xIn - 4)
    near(flipped.x1, at.xIn + 4)
    near(flipped.x1 - flipped.x0, plain.x1 - plain.x0)
  })

  it('rotating a trimmed layer hulls the ink, not the declared box', () => {
    // A tall sliver of ink inside a square box, turned 90°: the footprint must
    // become wide and short. The old formula would have returned the square.
    const sliver: UnitRect = { x0: 0.4, y0: 0, x1: 0.6, y1: 1 }
    const b = placedInkBox({ xIn: 0, yIn: 0, rotation: 90 }, 10, 10, sliver)
    near(b.x1 - b.x0, 10)
    near(b.y1 - b.y0, 2)
    const legacy = legacyBox({ xIn: 0, yIn: 0, rotation: 90 }, 10, 10)
    expect(b.y1 - b.y0).toBeLessThan(legacy.y1 - legacy.y0)
  })

  it('never reports a footprint larger than the untrimmed one', () => {
    // The change must be a strict tightening: no design, at any angle, may cost
    // more film after it than before.
    const trims: UnitRect[] = [
      FULL_UNIT,
      { x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.7 },
      { x0: 0, y0: 0, x1: 0.5, y1: 0.5 },
      { x0: 0.45, y0: 0.45, x1: 0.55, y1: 0.55 },
    ]
    for (const rotation of [0, 15, 45, 90, 137, 200, 315])
      for (const u of trims) {
        const p = { xIn: 0, yIn: 0, rotation }
        const b = placedInkBox(p, 5, 9, u)
        const legacy = legacyBox(p, 5, 9)
        expect(b.x1 - b.x0).toBeLessThanOrEqual(legacy.x1 - legacy.x0 + 1e-9)
        expect(b.y1 - b.y0).toBeLessThanOrEqual(legacy.y1 - legacy.y0 + 1e-9)
      }
  })
})

describe('clusterBoxes — what counts as one visual', () => {
  const box = (x0: number, y0: number, x1: number, y1: number): InkBox => ({ x0, x1, y0, y1 })

  it('splits two marks whose gap exceeds the clearance', () => {
    const groups = clusterBoxes([box(0, 0, 1, 1), box(0, 2, 1, 3)], 0.2)
    expect(groups.length).toBe(2)
  })

  it('merges two marks whose gap is under the clearance', () => {
    const groups = clusterBoxes([box(0, 0, 1, 1), box(0, 1.1, 1, 2)], 0.2)
    expect(groups).toEqual([[0, 1]])
  })

  it('is exactly the stated gap, not half of it', () => {
    // Boxes 0,19 in apart merge at a 0,2 in clearance; 0,21 in apart do not.
    expect(clusterBoxes([box(0, 0, 1, 1), box(0, 1.19, 1, 2)], 0.2).length).toBe(1)
    expect(clusterBoxes([box(0, 0, 1, 1), box(0, 1.21, 1, 2)], 0.2).length).toBe(2)
  })

  it('merges overlapping artwork whatever the clearance', () => {
    expect(clusterBoxes([box(0, 0, 2, 2), box(1, 1, 3, 3)], 0).length).toBe(1)
  })

  it('chains transitively — a bridge between two distant marks joins them', () => {
    const groups = clusterBoxes(
      [box(0, 0, 1, 1), box(0, 1.1, 1, 2), box(0, 2.1, 1, 3)],
      0.2,
    )
    expect(groups).toEqual([[0, 1, 2]])
  })

  it('does not depend on the order the pairs are visited in', () => {
    const boxes = [box(0, 0, 1, 1), box(5, 5, 6, 6), box(0, 1.1, 1, 2), box(5.05, 5, 6, 6)]
    expect(clusterBoxes(boxes, 0.2)).toEqual([
      [0, 2],
      [1, 3],
    ])
  })

  it('the merge sentinel collapses a whole side into one visual', () => {
    const boxes = [box(-6, -8, -5, -7), box(5, 7, 6, 8)]
    expect(clusterBoxes(boxes, 1e6)).toEqual([[0, 1]])
  })

  it('hulls a cluster tightly', () => {
    expect(hullOf([box(0, 0, 1, 1), box(2, -3, 4, -1)])).toEqual({
      x0: 0,
      y0: -3,
      x1: 4,
      y1: 1,
    })
  })
})

describe('unionArea — the priced area, counted once', () => {
  const box = (x0: number, y0: number, x1: number, y1: number): InkBox => ({ x0, x1, y0, y1 })

  it('is zero for nothing and the plain area for one', () => {
    expect(unionArea([])).toBe(0)
    expect(unionArea([box(0, 0, 3, 4)])).toBe(12)
  })

  it('adds disjoint visuals', () => {
    expect(unionArea([box(0, 0, 2, 2), box(5, 5, 6, 7)])).toBe(6)
  })

  /**
   * `pieces.ts` states outright that two clusters' boxes can legitimately
   * overlap — an L-shaped lockup with a small mark tucked into its corner.
   * Summing them charges the customer twice for the same square centimetres.
   */
  it('counts an overlap once, not twice', () => {
    // 4×4 and 4×4 sharing a 2×2 corner: 16 + 16 − 4 = 28, not 32.
    expect(unionArea([box(0, 0, 4, 4), box(2, 2, 6, 6)])).toBe(28)
  })

  it('a mark inside another visual’s box adds nothing', () => {
    expect(unionArea([box(0, 0, 10, 10), box(3, 3, 5, 5)])).toBe(100)
  })

  it('cannot exceed the print area it was clamped to', () => {
    // The failure this guards: a ring of small elements clusters into one hull
    // spanning the whole chest, a mark in the middle becomes its own cluster
    // inside it, and the SUM prices a 12 × 16 tee at more than 12 × 16.
    const area = 12 * 16
    const boxes = [box(-6, -8, 6, 8), box(-1, -1, 1, 1), box(-3, 2, 3, 5)]
    expect(unionArea(boxes)).toBeLessThanOrEqual(area)
    expect(unionArea(boxes)).toBe(area)
  })

  it('is exact for a run of touching boxes (no double count at the seam)', () => {
    expect(unionArea([box(0, 0, 1, 1), box(1, 0, 2, 1), box(2, 0, 3, 1)])).toBe(3)
  })
})
