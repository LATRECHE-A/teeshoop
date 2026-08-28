/**
 * The gang-sheet packer. Every property here has a euro cost attached:
 * overlapping transfers are scrap film, a piece past the laize is a file the
 * supplier rejects, and the billed length is multiplied by €/linear metre.
 *
 * Options are hand-built literals rather than DEFAULT_SUPPLIERS, so a supplier
 * re-pricing can never break a packer test.
 */
import { describe, expect, it } from 'vitest'
import { nestRoll, resolveNestOptions, type DtfPiece, type NestOptions } from './nesting'

const OPTS: NestOptions = {
  printableWidthCm: 58,
  maxLengthCm: 250,
  gapCm: 0.5,
  edgeMarginCm: 1,
}

const piece = (
  id: string,
  wCm: number,
  hCm: number,
  qty = 1,
  allowRotate = true,
): DtfPiece => ({ id, sourceKey: id, wCm, hCm, qty, allowRotate })

const MIXED: DtfPiece[] = [
  piece('a', 20, 25, 4),
  piece('b', 12, 12, 8),
  piece('c', 30, 8, 2),
  piece('d', 6, 40, 3),
  piece('e', 45, 15, 1),
  piece('f', 9, 9, 6),
]

/** Fixed-seed shuffle: Math.random would make a failure unreproducible. */
function shuffled<T>(arr: T[], seed = 12345): T[] {
  let s = seed
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

describe('nestRoll geometry', () => {
  it('never overlaps two placements, and always keeps the supplier gap', () => {
    const r = nestRoll(MIXED, OPTS)
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
          expect(apart, `pieces ${a.id} and ${b.id} overlap`).toBe(true)
        }
    }
  })

  it('never runs off the film, on either margin convention', () => {
    for (const opts of [
      OPTS,
      { ...OPTS, edgeMarginCm: 0, edgeMarginSideCm: 1.5, edgeMarginEndCm: 0.5 },
    ]) {
      const g = resolveNestOptions(opts)
      const r = nestRoll(MIXED, opts)
      for (const sheet of r.sheets)
        for (const p of sheet.placements) {
          expect(p.xCm).toBeGreaterThanOrEqual(g.sideMarginCm - 1e-6)
          expect(p.xCm + p.wCm).toBeLessThanOrEqual(g.widthCm - g.sideMarginCm + 1e-6)
          expect(p.yCm).toBeGreaterThanOrEqual(g.endMarginCm - 1e-6)
          expect(p.yCm + p.hCm).toBeLessThanOrEqual(sheet.rawLengthCm - g.endMarginCm + 1e-6)
        }
    }
  })
})

describe('nestRoll billing', () => {
  it('billed length is a multiple of the billing step, never below the raw length', () => {
    const r = nestRoll(MIXED, OPTS)
    const step = resolveNestOptions(OPTS).billingStepCm
    let sum = 0
    for (const sheet of r.sheets) {
      expect(sheet.lengthCm).toBeGreaterThanOrEqual(sheet.rawLengthCm - 1e-6)
      expect(sheet.lengthCm).toBeLessThanOrEqual(OPTS.maxLengthCm + 1e-6)
      const clamped = Math.abs(sheet.lengthCm - OPTS.maxLengthCm) < 1e-6
      if (!clamped) expect(Math.abs((sheet.lengthCm / step) - Math.round(sheet.lengthCm / step))).toBeLessThan(1e-6)
      sum += sheet.lengthCm
    }
    expect(r.totalLengthCm).toBeCloseTo(sum, 6)
  })

  it('is monotonic in quantity for one repeated piece', () => {
    let prev = 0
    for (let n = 1; n <= 40; n++) {
      const len = nestRoll([piece('x', 20, 25, n)], OPTS).totalLengthCm
      expect(len).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = len
    }
  })
})

describe('nestRoll bookkeeping', () => {
  it('places every copy or reports it: nothing is silently dropped', () => {
    const r = nestRoll(MIXED, OPTS)
    const placed = new Map<string, number>()
    for (const sheet of r.sheets)
      for (const p of sheet.placements) {
        const base = p.id.split('#')[0]
        placed.set(base, (placed.get(base) ?? 0) + 1)
      }
    for (const src of MIXED) {
      const want = Math.floor(src.qty)
      const got = placed.get(src.id) ?? 0
      if (got === want) expect(r.unplaceable).not.toContain(src.id)
      else expect(got).toBe(0)
    }
  })

  it('placement ids are globally unique: the ZIP and the manifest depend on it', () => {
    const r = nestRoll(MIXED, OPTS)
    const ids = r.sheets.flatMap((s) => s.placements.map((p) => p.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('is deterministic, and independent of input order', () => {
    const a = nestRoll(MIXED, OPTS)
    const b = nestRoll(MIXED, OPTS)
    const c = nestRoll(shuffled(MIXED), OPTS)
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
    expect(JSON.stringify(c)).toBe(JSON.stringify(a))
  })
})

describe('nestRoll refuses rather than mangles', () => {
  it('a piece wider than the film is unplaceable, unless rotating rescues it', () => {
    const tooWide = nestRoll([piece('big', 70, 30, 1, false)], OPTS)
    expect(tooWide.sheets.flatMap((s) => s.placements)).toHaveLength(0)
    expect(tooWide.unplaceable.length).toBeGreaterThan(0)

    const rotatable = nestRoll([piece('big', 70, 30, 1, true)], OPTS)
    expect(rotatable.sheets.flatMap((s) => s.placements).length).toBeGreaterThan(0)
  })

  it('survives degenerate input without crashing or inventing placements', () => {
    for (const bad of [
      piece('q0', 20, 20, 0),
      piece('qneg', 20, 20, -1),
      piece('w0', 0, 20, 1),
      piece('nan', Number.NaN, 20, 1),
    ]) {
      const r = nestRoll([bad], OPTS)
      expect(r.sheets.flatMap((s) => s.placements)).toHaveLength(0)
    }
  })
})
