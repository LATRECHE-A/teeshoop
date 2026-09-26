/**
 * STU-02. The customer's garment shape was one global slot (localStorage
 * `tshop.customShape`) that `resolveShape` read for EVERY custom garment built
 * afterwards: a hoodie chosen for one design dressed the next design's tee, or
 * a tote bag, in hood geometry. The choice now travels on the design
 * (`CustomGarment.shape`, passed as `opts.shape`); resolution itself reads
 * nothing but the photograph.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { GARMENT_SHAPES, classifyShape, profileMask, resolveShape } from './garmentShape'

/** A plain box, the way `measureMask` pads it: a one-cell border all round. */
function boxProfile(w = 40, h = 60) {
  const stride = w + 2
  const mask = new Uint8Array(stride * (h + 2))
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[(y + 1) * stride + x + 1] = 1
  const p = profileMask(mask, w, h, stride, w + 3)
  if (!p) throw new Error('the synthetic mask did not profile')
  return p
}

describe('resolveShape', () => {
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage
  })

  it('answers from the photograph alone, whatever another design once chose', () => {
    const p = boxProfile()
    const detected = classifyShape(p, 0).shape
    const other = GARMENT_SHAPES.find((s) => s !== detected)!
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => (k === 'tshop.customShape' ? other : null),
      setItem() {},
      removeItem() {},
    }
    expect(resolveShape(p, 0).shape).toBe(detected)
  })
})
