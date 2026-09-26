/**
 * IMG-02. A photo of 2048 px or less kept its original bytes, EXIF position
 * included, all the way to R2. `carriesExif` is what sends it through the canvas.
 */
import { describe, expect, it } from 'vitest'
import { carriesExif } from './assets'

const seg = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body]
const jpeg = (...segments: number[][]) => new Uint8Array([0xff, 0xd8, ...segments.flat(), 0xff, 0xda, 0, 2, 0xff, 0xd9])

const chunk = (type: string, body: number[]) => [
  (body.length >>> 24) & 0xff, (body.length >>> 16) & 0xff, (body.length >>> 8) & 0xff, body.length & 0xff,
  ...[...type].map((c) => c.charCodeAt(0)), ...body, 0, 0, 0, 0,
]
const png = (...chunks: number[][]) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunks.flat()])

describe('carriesExif', () => {
  it('finds the EXIF segment of a camera JPEG, after its JFIF header', () => {
    expect(carriesExif(jpeg(seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]), seg(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0])))).toBe(true)
  })

  it('says nothing about a JPEG with only JFIF and a colour profile', () => {
    expect(carriesExif(jpeg(seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]), seg(0xe2, [1, 2, 3])))).toBe(false)
  })

  it('finds an eXIf chunk in a PNG, and nothing in a plain one', () => {
    const ihdr = chunk('IHDR', new Array(13).fill(0))
    expect(carriesExif(png(ihdr, chunk('eXIf', [1, 2]), chunk('IDAT', [0]), chunk('IEND', [])))).toBe(true)
    expect(carriesExif(png(ihdr, chunk('IDAT', [0]), chunk('IEND', [])))).toBe(false)
  })

  it('is not fooled by a truncated header', () => {
    expect(carriesExif(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(false)
    expect(carriesExif(new Uint8Array([]))).toBe(false)
  })
})
