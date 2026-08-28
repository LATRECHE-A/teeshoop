/**
 * Preflight: the checks that stop a file the supplier would silently crop,
 * and the silence that stops the operator learning to ignore warnings.
 *
 * The process is a literal here, not DEFAULT_SUPPLIERS: the boundaries under
 * test should be stated in the test, not read out of data that moves.
 */
import { describe, expect, it } from 'vitest'
import { hasErrors, preflight } from './preflight'
import type { DtfPiece } from './nesting'
import type { DtfProcess } from './suppliers'

const roll = (over: Partial<DtfProcess> = {}): DtfProcess =>
  ({
    id: 'dtf',
    label: 'test roll',
    billing: 'roll',
    printableWidthCm: 58,
    rollWidthCm: 60,
    maxLengthCm: 200,
    priceTiers: [{ minLm: 1, eurPerLm: 8 }],
    formats: [],
    guidelines: {
      minDpi: 300,
      minLineMmColour: 0.6,
      minLineMmWhite: 1,
      minTextPt: 6,
      marginCm: 1, // usable width = 58 - 2*1 = 56
      gapCm: 0.5,
    },
    ...over,
  }) as DtfProcess

const piece = (over: Partial<DtfPiece> = {}): DtfPiece => ({
  id: 'p',
  sourceKey: 'p',
  wCm: 20,
  hCm: 20,
  qty: 1,
  allowRotate: false,
  ...over,
})

const codes = (issues: ReturnType<typeof preflight>) => issues.map((i) => i.code)

describe('film width', () => {
  it('accepts exactly the usable width and rejects one millimetre more', () => {
    expect(codes(preflight([piece({ wCm: 56 })], roll()))).not.toContain('too-wide')
    const over = preflight([piece({ wCm: 56.1 })], roll())
    expect(codes(over)).toContain('too-wide')
  })

  it('rotation rescues a piece that is too wide but not too long', () => {
    const fixed = preflight([piece({ wCm: 56.1, hCm: 30, allowRotate: false })], roll())
    expect(codes(fixed)).toContain('too-wide')
    const rotatable = preflight([piece({ wCm: 56.1, hCm: 30, allowRotate: true })], roll())
    expect(codes(rotatable)).not.toContain('too-wide')
  })

  it('too long is a DIFFERENT error: it tells the operator to do something else', () => {
    const long = preflight([piece({ wCm: 30, hCm: 500 })], roll())
    expect(codes(long)).toContain('too-long')
    expect(codes(long)).not.toContain('too-wide')
  })
})

describe('silence is not approval', () => {
  it('a piece with no measurable metadata produces ZERO issues', () => {
    // Unmeasurable must mean unreported. A check that fires on `undefined`
    // trains the operator to ignore every check.
    expect(preflight([piece()], roll())).toEqual([])
  })

  it('hasAlpha === false is an error; undefined is not', () => {
    expect(codes(preflight([piece({ hasAlpha: false })], roll()))).toContain('no-transparency')
    expect(codes(preflight([piece({ hasAlpha: undefined })], roll()))).not.toContain(
      'no-transparency',
    )
  })

  it('a piece with qty 0 is skipped entirely, however broken it is', () => {
    expect(preflight([piece({ wCm: 200, qty: 0, hasAlpha: false })], roll())).toEqual([])
  })
})

describe('resolution and line weight', () => {
  it('flags a low DPI and stays quiet at a comfortable one', () => {
    // 20 cm wide at 300 dpi ≈ 2362 px.
    const at300 = Math.round((20 / 2.54) * 300)
    const low = preflight([piece({ srcPxW: Math.round(at300 * 0.6), srcPxH: at300 })], roll())
    expect(codes(low)).toContain('dpi-low')

    const ample = preflight([piece({ srcPxW: at300 * 2, srcPxH: at300 * 2 })], roll())
    expect(codes(ample)).not.toContain('dpi-low')
    expect(codes(ample)).not.toContain('dpi-marginal')
  })

  it('a stroke under the floor errors; at the floor it does not', () => {
    expect(codes(preflight([piece({ minLineMm: 0.3 })], roll()))).toContain('line-thin')
    expect(codes(preflight([piece({ minLineMm: 0.6 })], roll()))).not.toContain('line-thin')
  })

  it('small text is a WARNING, never an error: it is legible-ish, not unprintable', () => {
    const issues = preflight([piece({ minTextPt: 3 })], roll())
    const text = issues.filter((i) => i.code === 'text-small')
    expect(text.length).toBe(1)
    expect(text[0].level).toBe('warn')
    expect(hasErrors(issues)).toBe(false)
  })
})

describe('fixed-format billing', () => {
  const fixed = roll({
    billing: 'fixed',
    formats: [
      { id: 'a', label: '10×10', wCm: 10, hCm: 10, priceEur: 2 },
      { id: 'b', label: '21×28', wCm: 21, hCm: 28, priceEur: 5 },
    ],
    priceTiers: [],
  } as Partial<DtfProcess>)

  it('reports no-format when nothing in the catalogue can hold the piece', () => {
    expect(codes(preflight([piece({ wCm: 25, hCm: 25 })], fixed))).toContain('no-format')
  })

  it('a 10×10 piece does NOT fit a 10×10 format: the margin is real', () => {
    // Usable area of the 10×10 sheet is 8×8 after the 1 cm margin. This looks
    // like an off-by-one and is not; do not "fix" it.
    //
    // Tested against a SINGLE-format catalogue on purpose: the fit test is
    // `boxes.some(...)`, so with the 21×28 format also present a 10×10 piece
    // fits perfectly well, just not on the sheet you would expect.
    const only10 = roll({
      billing: 'fixed',
      formats: [{ id: 'a', label: '10×10', wCm: 10, hCm: 10, priceEur: 2 }],
      priceTiers: [],
    } as Partial<DtfProcess>)
    expect(codes(preflight([piece({ wCm: 10, hCm: 10 })], only10))).toContain('no-format')
    expect(codes(preflight([piece({ wCm: 8, hCm: 8 })], only10))).not.toContain('no-format')

    // And the multi-format catalogue does place it, on the larger sheet.
    expect(codes(preflight([piece({ wCm: 10, hCm: 10 })], fixed))).not.toContain('no-format')
  })
})
