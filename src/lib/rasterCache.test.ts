import { beforeAll, describe, expect, it } from 'vitest'

/*
 * EDI-17. `cache` was bounded and `resolved` was not: every decoded garment
 * image stayed in memory for the life of the page. The node environment has no
 * Image, so a minimal one that "decodes" as soon as it is given a source stands
 * in for it; the bound is what is under test, not the browser's decoder.
 */
beforeAll(() => {
  class FakeImage {
    decoding = ''
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_v: string) {
      queueMicrotask(() => this.onload?.())
    }
  }
  ;(globalThis as unknown as { Image: unknown }).Image = FakeImage
})

describe('the raster cache', () => {
  it('holds no more decoded images than it holds entries', async () => {
    const { ensureRaster, getRaster, heldRasters } = await import('./rasterCache')
    for (let i = 0; i < 300; i++) await ensureRaster(`k${i}`, '<svg/>')
    expect(getRaster('k0')).toBeNull()
    expect(heldRasters()).toBeLessThanOrEqual(120)
    expect(getRaster('k299')).not.toBeNull()
  })

  it('keeps the entry every frame asks for, however many new ones arrive', async () => {
    const { ensureRaster, getRaster } = await import('./rasterCache')
    await ensureRaster('garment-body', '<svg/>')
    for (let i = 0; i < 300; i++) {
      await ensureRaster(`colour${i}`, '<svg/>')
      await ensureRaster('garment-body', '<svg/>')
    }
    expect(getRaster('garment-body')).not.toBeNull()
  })
})
