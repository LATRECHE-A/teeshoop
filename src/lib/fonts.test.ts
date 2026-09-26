/**
 * EDI-11. `ensureFont` resolved after its 3 s wait whether the face had arrived
 * or not, and cached that as a success: on a slow line the text was measured in
 * the browser's default face, and that area went into the document the shop
 * bills. It now says whether the face is there, and retries after a timeout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loaded = new Set<string>()
let loads = 0

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetModules()
  loaded.clear()
  loads = 0
  ;(globalThis as { document?: unknown }).document = {
    fonts: {
      // A face that arrives resolves; one that does not stays pending for ever.
      load: (spec: string) => {
        loads++
        return loaded.has(spec) ? Promise.resolve([]) : new Promise(() => {})
      },
      check: (spec: string) => loaded.has(spec),
    },
    createElement: () => ({ setAttribute() {}, append() {} }),
    head: { append() {}, appendChild() {} },
  }
})

afterEach(() => {
  vi.useRealTimers()
  delete (globalThis as { document?: unknown }).document
})

describe('ensureFont', () => {
  it('says true for a face that arrived', async () => {
    loaded.add('64px "Anton"')
    const { ensureFont } = await import('./fonts')
    const p = ensureFont('Anton')
    await vi.runAllTimersAsync()
    await expect(p).resolves.toBe(true)
  })

  it('says false when the wait runs out, and tries again next time', async () => {
    const { ensureFont } = await import('./fonts')
    const first = ensureFont('Bangers')
    await vi.runAllTimersAsync()
    await expect(first).resolves.toBe(false)
    const before = loads
    loaded.add('64px "Bangers"')
    const second = ensureFont('Bangers')
    await vi.runAllTimersAsync()
    await expect(second).resolves.toBe(true)
    expect(loads).toBeGreaterThan(before)
  })
})
