/**
 * True-shape nesting. Its headline promise is commercial, not aesthetic: it may
 * never cost MORE film than the plain shelf packer, because restart #0 is the
 * shelf packer. Everything else it does is upside.
 *
 * Masks are plain Uint8Arrays, so none of this needs a DOM.
 */
import { describe, expect, it } from 'vitest'
import { nestRoll, type NestOptions } from './nesting'
import {
  chooseRes,
  INTERLOCK_STOPS_CM,
  nestShapeRoll,
  type ShapeNestOptions,
  type ShapePiece,
} from './trueshape'

const BASE: NestOptions = {
  printableWidthCm: 58,
  maxLengthCm: 250,
  gapCm: 0.5,
  edgeMarginCm: 1,
}
const shapeOpts = (over: Partial<ShapeNestOptions> = {}): ShapeNestOptions => ({
  ...BASE,
  maxInterlockCm: 5,
  restarts: 8,
  ...over,
})

/** Solid rectangle: should degenerate to the plain rectangle path. */
function rectMask(w: number, h: number): Uint8Array {
  return new Uint8Array(w * h).fill(1)
}

/** Lower-left right triangle: the classic case boxes waste and shapes recover. */
function triMask(w: number, h: number): Uint8Array {
  const m = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (x * h < y * w) m[y * w + x] = 1
  return m
}

const shape = (
  id: string,
  wCm: number,
  hCm: number,
  qty: number,
  mask: Uint8Array,
  mw: number,
  mh: number,
): ShapePiece => ({
  id,
  sourceKey: id,
  wCm,
  hCm,
  qty,
  allowRotate: true,
  mask,
  maskW: mw,
  maskH: mh,
})

const TRIANGLES = [shape('tri', 20, 25, 12, triMask(40, 50), 40, 50)]
const SOLIDS = [shape('rect', 20, 25, 6, rectMask(40, 50), 40, 50)]

describe('nestShapeRoll', () => {
  it('IS NEVER WORSE THAN THE SHELF PACKER: the guarantee the tool is sold on', () => {
    for (const pieces of [TRIANGLES, SOLIDS]) {
      const shaped = nestShapeRoll(pieces, shapeOpts({ restarts: 8, maxInterlockCm: 5 }))
      const shelf = nestRoll(pieces, BASE)
      expect(shaped.totalLengthCm).toBeLessThanOrEqual(shelf.totalLengthCm + 1e-9)
    }
  })

  it('actually beats boxes on a concave instance', () => {
    // MEASURED on this instance (12 triangles, 20×25 cm, 58 cm roll), shelf =
    // 130 cm:
    //   allowFlip false: 130 at every interlock rung up to 12; only unlimited
    //                    interlock reaches 110.
    //   allowFlip true:  120 at rung 2, 110 at rung 12, 90 unlimited.
    // Two same-facing triangles cannot tuck into each other's hypotenuse
    // without a 180° turn, so WITHOUT flip there is simply little to win here.
    // That is a real property of the packer, not a shortfall: `allowFlip`
    // defaults to false because a heat transfer pressed upside-down is scrap.
    //
    // An instance-level regression guard, NOT a theorem. If a future packer
    // change flips this, look at it: do not reflexively relax the assertion.
    const flippable = TRIANGLES.map((p) => ({ ...p, allowFlip: true }))
    const shaped = nestShapeRoll(flippable, shapeOpts({ restarts: 12, maxInterlockCm: 12 }))
    const shelf = nestRoll(flippable, BASE)
    expect(shaped.totalLengthCm).toBeLessThan(shelf.totalLengthCm)
  })

  it('a solid mask degenerates to the rectangle result', () => {
    const withMask = nestShapeRoll(SOLIDS, shapeOpts({ restarts: 1, maxInterlockCm: 0 }))
    const shelf = nestRoll(SOLIDS, BASE)
    expect(withMask.totalLengthCm).toBeCloseTo(shelf.totalLengthCm, 6)
  })

  it('stays inside the film at every interlock setting', () => {
    for (const maxInterlockCm of INTERLOCK_STOPS_CM) {
      const r = nestShapeRoll(TRIANGLES, shapeOpts({ maxInterlockCm, restarts: 4 }))
      for (const sheet of r.sheets)
        for (const p of sheet.placements) {
          expect(p.xCm).toBeGreaterThanOrEqual(1 - 1e-6)
          expect(p.xCm + p.wCm).toBeLessThanOrEqual(58 - 1 + 1e-6)
          expect(p.yCm).toBeGreaterThanOrEqual(1 - 1e-6)
        }
    }
  })

  it('interlock 0 means straight rows: nothing overhangs anything', () => {
    const r = nestShapeRoll(TRIANGLES, shapeOpts({ maxInterlockCm: 0, restarts: 4 }))
    for (const sheet of r.sheets) {
      const p = sheet.placements
      for (let i = 0; i < p.length; i++)
        for (let j = i + 1; j < p.length; j++) {
          const a = p[i]
          const b = p[j]
          const apart =
            a.xCm + a.wCm <= b.xCm + 1e-6 ||
            b.xCm + b.wCm <= a.xCm + 1e-6 ||
            a.yCm + a.hCm <= b.yCm + 1e-6 ||
            b.yCm + b.hCm <= a.yCm + 1e-6
          expect(apart, 'interlock 0 must leave scissor-friendly rows').toBe(true)
        }
    }
  })

  it('is deterministic, the manifest is an order-tracking artefact', () => {
    const a = nestShapeRoll(TRIANGLES, shapeOpts())
    const b = nestShapeRoll(TRIANGLES, shapeOpts())
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
  })
})

describe('chooseRes', () => {
  it('never rounds the supplier clearance DOWN: a minimum is a floor', () => {
    for (const gapCm of [0, 0.05, 0.1, 0.2, 0.25, 0.3, 0.5, 0.8, 1, 2, 5]) {
      const { res, half } = chooseRes(gapCm)
      expect(res * half).toBeGreaterThanOrEqual(gapCm / 2 - 1e-9)
      if (half > 0) {
        expect(res).toBeGreaterThanOrEqual(0.15)
        expect(res).toBeLessThanOrEqual(0.4)
      }
    }
  })
})
