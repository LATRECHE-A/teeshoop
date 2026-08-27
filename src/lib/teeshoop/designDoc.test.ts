import { describe, expect, it } from 'vitest'
import { readDesignDoc } from './designDoc'
import { MIN_EXTENT_IN, TRIM_BLEED_IN, clampInkToArea } from '@/lib/ink'
import { CM_PER_IN } from '@/lib/units'

/**
 * The gate on the open upload route, and specifically the half of it that was
 * missing.
 *
 * `readPieces` has always refused rectangles too SMALL to hold the ink they
 * claim, because that understates the film. Nothing refused an ink area too
 * small for the rectangles, and that understates the PRICE: `Pricing::area_tier`
 * charges a printed side by its declared ink, so a document carrying a real
 * full-front geometry with `area_sq_cm: 1` bought the cheapest tier. Nothing
 * downstream re-derives the number, and `POST /api/design` takes no credentials.
 */

const doc = (side: Record<string, unknown>) => ({
  garmentId: 'tee',
  colorId: 'white',
  layers: [{ id: 'a', type: 'text', side: 'front', text: 'x' }],
  sides: [{ id: 'front', ...side }],
})

/** A real full-front chest print: 28,4 x 34,1 cm of ink, one transfer. */
const REAL_INK_SQ_CM = 28.4 * 34.1
const REAL_PIECE = { w_cm: 28.5, h_cm: 34.2 }

describe('the copy of ink.ts this file has to keep', () => {
  /*
   * designDoc.ts imports NOTHING, on purpose: it is type-checked under the
   * Worker's tsconfig too, where there is no DOM, and ink.ts reaches a canvas.
   * So the two lengths it needs are restated there, and this is what stops the
   * copy drifting. Same arrangement as Margin.php and the Bible's formula.
   */
  it('is the same bleed and the same minimum extent, in centimetres', () => {
    expect(TRIM_BLEED_IN * CM_PER_IN).toBeCloseTo(0.0508, 6)
    expect(MIN_EXTENT_IN * CM_PER_IN).toBeCloseTo(0.2032, 6)
  })

  /*
   * And the bound itself, checked against the function that actually produces
   * the rectangles rather than against the arithmetic that is supposed to
   * describe it. `clampInkToArea` is the only step between a cluster's ink box
   * and the transfer, and it is pure, so the relation can be exercised directly:
   * whatever it does, the ink box must never be smaller than the transfer
   * shrunk by two bleeds.
   */
  it('never claims more ink than clampInkToArea leaves in the box', () => {
    const area = { wIn: 12, hIn: 14 }
    const boxes = [
      { x0: -5, x1: 5, y0: -6, y1: 6 }, // a full-area print
      { x0: -1, x1: 1, y0: -1, y1: 1 }, // a small chest mark
      { x0: -0.005, x1: 0.005, y0: -3, y1: 3 }, // a hairline rule, grown by atLeastMin
      { x0: -9, x1: 9, y0: -2, y1: 2 }, // wider than the area, so it clamps
      { x0: -0.04, x1: 0.04, y0: -3, y1: 3 }, // just above the floor, so rounding decides
      { x0: 1.2, x1: 1.24, y0: -0.02, y1: 0.02 }, // thin in both directions
    ]
    // Exactly what sidePiecesCm writes into the document, rounding included:
    // the bound has to be sound for the number that actually arrives, not for
    // the one before it was rounded.
    const round2 = (v: number) => Math.round(v * 100) / 100
    const shrink = (v: number) => (v > 0.2032 + 0.01 ? Math.max(0, v - 2 * 0.0508 - 0.01) : 0)
    for (const box of boxes) {
      const rect = clampInkToArea(box, area)
      expect(rect).not.toBeNull()
      const wCm = round2(rect!.wIn * CM_PER_IN)
      const hCm = round2(rect!.hIn * CM_PER_IN)
      const clippedBoxSqCm =
        Math.max(0, Math.min(area.wIn / 2, box.x1) - Math.max(-area.wIn / 2, box.x0)) *
        Math.max(0, Math.min(area.hIn / 2, box.y1) - Math.max(-area.hIn / 2, box.y0)) *
        CM_PER_IN *
        CM_PER_IN
      expect(shrink(wCm) * shrink(hCm)).toBeLessThanOrEqual(clippedBoxSqCm + 1e-9)
    }
  })
})

describe('a document whose ink cannot fit inside its own transfers', () => {
  it('refuses a full-front geometry declared as one square centimetre', () => {
    expect(readDesignDoc(doc({ area_sq_cm: 1, pieces: [REAL_PIECE] }))).toBeNull()
  })

  it('refuses it on the second side too, not only the first', () => {
    const two = {
      garmentId: 'tee',
      layers: [{ id: 'a', type: 'text', side: 'front', text: 'x' }],
      sides: [
        { id: 'front', area_sq_cm: REAL_INK_SQ_CM, pieces: [REAL_PIECE] },
        { id: 'back', area_sq_cm: 2, pieces: [REAL_PIECE] },
      ],
    }
    expect(readDesignDoc(two)).toBeNull()
  })

  it('accepts the same geometry declared honestly', () => {
    const r = readDesignDoc(doc({ area_sq_cm: REAL_INK_SQ_CM, pieces: [REAL_PIECE] }))
    expect(r).not.toBeNull()
    expect(r!.sides[0].area_sq_cm).toBeCloseTo(REAL_INK_SQ_CM, 6)
    expect(r!.sides[0].pieces).toEqual([REAL_PIECE])
  })

  /*
   * The overlap case, which is why the bound is the LARGEST rectangle and not
   * the sum of them. `sideArtworkSqCm` unions the cluster hulls and counts an
   * overlap once, deliberately, so an L-shaped lockup with a mark tucked into
   * its corner legitimately declares less ink than the rectangles add up to.
   * Summing here would refuse it.
   */
  it('accepts two transfers whose declared ink is less than their sum', () => {
    const r = readDesignDoc(
      doc({
        area_sq_cm: 400,
        pieces: [
          { w_cm: 20, h_cm: 20 },
          { w_cm: 20, h_cm: 20 },
        ],
      }),
    )
    expect(r).not.toBeNull()
    expect(r!.sides[0].area_sq_cm).toBe(400)
  })

  /*
   * A hairline is GROWN to the minimum extent before it becomes a transfer, so
   * its rectangle claims ink that is not there. Treating such a dimension as
   * evidence would refuse a real design; it is treated as unknown instead.
   */
  it('draws no conclusion from a transfer at the minimum extent', () => {
    const r = readDesignDoc(doc({ area_sq_cm: 0.01, pieces: [{ w_cm: 0.2, h_cm: 10 }] }))
    expect(r).not.toBeNull()
  })

  it('still refuses rectangles too small for the ink they claim, as before', () => {
    const r = readDesignDoc(doc({ area_sq_cm: 2000, pieces: [{ w_cm: 0.5, h_cm: 0.5 }] }))
    expect(r).not.toBeNull()
    // The film geometry is dropped, the sale is not. That direction is a cost
    // that would be too low, not a price that would be.
    expect(r!.sides[0].pieces).toBeUndefined()
    expect(r!.sides[0].area_sq_cm).toBe(2000)
  })

  it('draws no conclusion when the rectangles cannot be read at all', () => {
    const r = readDesignDoc(doc({ area_sq_cm: 1, pieces: [{ w_cm: 28.5, h_cm: 'grand' }] }))
    expect(r).not.toBeNull()
    expect(r!.sides[0].pieces).toBeUndefined()
  })
})
