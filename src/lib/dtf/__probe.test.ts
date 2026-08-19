import { describe, it, expect } from 'vitest'
import { nestRoll, type DtfPiece } from './nesting'

const OPT = { printableWidthCm: 56, maxLengthCm: 100, gapCm: 0.5, edgeMarginCm: 0, billingStepCm: 10 }
const p = (w: number, h: number, q: number): DtfPiece => ({
  id: 'a', sourceKey: 'a', wCm: w, hCm: h, qty: q, allowRotate: true,
})
const total = (pieces: DtfPiece[]) => {
  const r = nestRoll(pieces, OPT)
  return { m: r.sheets.reduce((a, s) => a + s.lengthCm, 0) / 100, sheets: r.sheets.length, unplaceable: r.unplaceable.length }
}

describe('floor gap probe', () => {
  it('measures', () => {
    // A real order: one 25 x 30 cm chest print, 20 garments, 45 % ink coverage.
    const real = total([p(25, 30, 20)])
    const inkSqCm = 0.45 * 25 * 30 * 20
    const floorReal = inkSqCm / 56 / 100
    // The shrunken layout an attacker posts: same 20 poses, boxes at ~50 % area.
    const fakeBoxes = 18 * 21 * 20
    const fake = total([p(18, 21, 20)])
    const floorFake = fakeBoxes / 56 / 100
    console.log(JSON.stringify({ real, inkSqCm, floorReal, fakeBoxes, fake, floorFake, ratio: floorFake / real.m }, null, 1))
    expect(fakeBoxes).toBeGreaterThanOrEqual(inkSqCm * 0.99)
    expect(floorFake).toBeLessThanOrEqual(fake.m)
  })
})
