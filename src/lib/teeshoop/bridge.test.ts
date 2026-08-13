/**
 * The bridge's rules, exercised against a fake parent window.
 *
 * These are security assertions before they are behaviour assertions. The one
 * that has to exist is the prefix case: `https://teeshoop.com.evil.tld` starts
 * with the shop origin and must be refused, because a `startsWith` written here
 * one tired afternoon would pass every other test in this file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __handleMessageForTests as handleMessage,
  __parseOriginsForTests as parseOrigins,
  addToShopCart,
  bridgeStatus,
  canOrderFromShop,
  isShopConnected,
  requestFrameHeight,
  requestShopQuote,
  resetShopBridgeForTests,
  shopContext,
  startShopBridge,
} from './bridge'

const SHOP = 'https://shop.example'
const OTHER = 'https://other.example'

type Sent = { message: Record<string, unknown>; origin: string }

let sent: Sent[]
let parent: { postMessage: (m: unknown, o: string) => void }

/** A message as the browser would deliver it: source, origin, data. */
function deliver(data: unknown, origin = SHOP, source: unknown = undefined): void {
  handleMessage({
    data,
    origin,
    source: source === undefined ? parent : source,
  } as unknown as MessageEvent)
}

/** Reply to whatever request is outstanding of this type. */
function requestIdOf(type: string): string {
  const hit = [...sent].reverse().find((s) => s.message.type === type)
  return String(hit?.message.requestId ?? '')
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv('VITE_TEESHOOP_SHOP_ORIGINS', `${SHOP},${OTHER}`)
  sent = []
  parent = {
    postMessage: (message, origin) => {
      sent.push({ message: message as Record<string, unknown>, origin })
    },
  }
  const fakeWindow = {
    parent,
    innerHeight: 600,
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  vi.stubGlobal('window', fakeWindow)
})

afterEach(() => {
  resetShopBridgeForTests()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('shop origin parsing', () => {
  it('normalises to scheme://host[:port] and nothing else', () => {
    expect(parseOrigins('https://teeshoop.com/studio/')).toEqual(['https://teeshoop.com'])
    expect(parseOrigins('HTTPS://TeeShoop.COM')).toEqual(['https://teeshoop.com'])
    expect(parseOrigins('http://localhost:8080')).toEqual(['http://localhost:8080'])
  })

  it('drops anything that is not an http(s) origin, and duplicates', () => {
    expect(parseOrigins('javascript:alert(1)')).toEqual([])
    expect(parseOrigins('teeshoop.com')).toEqual([])
    expect(parseOrigins('  ,  ')).toEqual([])
    expect(parseOrigins('https://a.example, https://a.example/')).toEqual(['https://a.example'])
  })
})

describe('handshake', () => {
  it('offers itself to every allowed origin and to no other', () => {
    startShopBridge()
    const ready = sent.filter((s) => s.message.type === 'teeshoop:ready')
    expect(ready.map((s) => s.origin).sort()).toEqual([OTHER, SHOP])
    // Never a wildcard: the browser drops the message unless the parent really
    // is that origin, which is what makes offering it to a list safe.
    expect(sent.some((s) => s.origin === '*')).toBe(false)
  })

  it('locks onto the origin that answers', () => {
    startShopBridge()
    expect(bridgeStatus()).toBe('connecting')
    deliver({ type: 'teeshoop:context', productId: 42, garment: 'tee', locale: 'fr' })
    expect(bridgeStatus()).toBe('connected')
    expect(isShopConnected()).toBe(true)
    expect(shopContext()).toEqual({ productId: 42, garment: 'tee', locale: 'fr' })
  })

  it('reads the product id WordPress actually sends, which is a string', () => {
    // wp_localize_script casts every scalar to a string. Measured against the
    // real page on 2026-08-13: {"productId":"33"}. Read as a number this is 0,
    // and the basket button never appears on a working product page.
    startShopBridge()
    deliver({ type: 'teeshoop:context', productId: '33', garment: 'tee', locale: 'fr' })
    expect(shopContext()?.productId).toBe(33)
    expect(canOrderFromShop()).toBe(true)
  })

  it('cannot order from a page that frames the studio without selling anything', () => {
    startShopBridge()
    deliver({ type: 'teeshoop:context', productId: '0', garment: '', locale: 'fr' })
    expect(isShopConnected()).toBe(true)
    expect(canOrderFromShop()).toBe(false)
  })

  it('gives up rather than spinning when nothing answers', () => {
    startShopBridge()
    vi.advanceTimersByTime(5000)
    expect(bridgeStatus()).toBe('unavailable')
  })

  it('is inert when the studio is not framed', () => {
    // `window.parent === window` is what "not framed" means: a top-level page
    // is its own parent. The fake has to hold that, or the test proves nothing.
    const solo: Record<string, unknown> = {
      addEventListener: () => {},
      removeEventListener: () => {},
      innerHeight: 600,
    }
    solo.parent = solo
    vi.stubGlobal('window', solo)
    startShopBridge()
    expect(bridgeStatus()).toBe('standalone')
    expect(sent).toEqual([])
  })

  it('is inert when no shop origin is allowed in this build', () => {
    vi.stubEnv('VITE_TEESHOOP_SHOP_ORIGINS', '   ,  not-an-origin  ')
    startShopBridge()
    expect(bridgeStatus()).toBe('standalone')
    expect(sent).toEqual([])
  })
})

describe('the three inbound checks', () => {
  it('refuses an origin that merely STARTS WITH an allowed one', () => {
    startShopBridge()
    deliver({ type: 'teeshoop:context', productId: 1 }, `${SHOP}.evil.tld`)
    deliver({ type: 'teeshoop:context', productId: 1 }, `${SHOP}@evil.tld`)
    deliver({ type: 'teeshoop:context', productId: 1 }, `${SHOP}:8443`)
    expect(bridgeStatus()).toBe('connecting')
    expect(shopContext()).toBeNull()
  })

  it('refuses a message that did not come from our own parent', () => {
    startShopBridge()
    deliver({ type: 'teeshoop:context', productId: 1 }, SHOP, { notTheParent: true })
    expect(bridgeStatus()).toBe('connecting')
  })

  it('refuses a payload that is not an object with a known type', () => {
    startShopBridge()
    deliver('teeshoop:context')
    deliver(null)
    deliver({ type: 7 })
    deliver({ type: 'teeshoop:something-else' })
    expect(bridgeStatus()).toBe('connecting')
  })

  it('narrows to the one origin that answered, once it has', () => {
    startShopBridge()
    deliver({ type: 'teeshoop:context', productId: 42, garment: 'tee', locale: 'fr' })
    // OTHER is on the allow-list, but it is not the parent that answered.
    deliver({ type: 'teeshoop:context', productId: 99, garment: 'hoodie', locale: 'en' }, OTHER)
    expect(shopContext()?.productId).toBe(42)
  })
})

describe('requests', () => {
  beforeEach(() => {
    startShopBridge()
    deliver({ type: 'teeshoop:context', productId: 42, garment: 'tee', locale: 'fr' })
    sent.length = 0
  })

  it('never lets two quotes in flight resolve into each other', async () => {
    const first = requestShopQuote({ garment: 'tee', qty: 5, sides: [{ id: 'front', area_sq_cm: 100 }] })
    const idA = requestIdOf('teeshoop:quote')
    const second = requestShopQuote({ garment: 'tee', qty: 50, sides: [{ id: 'front', area_sq_cm: 100 }] })
    const idB = requestIdOf('teeshoop:quote')
    expect(idA).not.toBe(idB)

    // Replies arrive in the wrong order, the slow first one last.
    deliver({ type: 'teeshoop:quote-result', requestId: idB, ok: true, quote: { qty: 50 } })
    deliver({ type: 'teeshoop:quote-result', requestId: idA, ok: true, quote: { qty: 5 } })

    await expect(first).resolves.toMatchObject({ qty: 5 })
    await expect(second).resolves.toMatchObject({ qty: 50 })
  })

  it('rejects with the shop’s own reason rather than a generic failure', async () => {
    const q = requestShopQuote({ garment: 'nope', qty: 1, sides: [] })
    deliver({
      type: 'teeshoop:quote-result',
      requestId: requestIdOf('teeshoop:quote'),
      ok: false,
      error: 'teeshoop_unknown_garment',
    })
    await expect(q).rejects.toThrow('teeshoop_unknown_garment')
  })

  it('sends no price field with an add-to-cart', async () => {
    const add = addToShopCart({
      garment: 'tee',
      qty: 3,
      sides: [{ id: 'front', area_sq_cm: 400 }],
      designId: 'abcdefghijklmnop1234',
    })
    const body = sent.find((s) => s.message.type === 'teeshoop:add-to-cart')?.message ?? {}
    expect(Object.keys(body).some((k) => /price|total|amount|eur/i.test(k))).toBe(false)
    deliver({
      type: 'teeshoop:cart-result',
      requestId: requestIdOf('teeshoop:add-to-cart'),
      ok: true,
      cartCount: 3,
      cartUrl: 'https://shop.example/panier/',
      message: 'Ajouté au panier',
    })
    await expect(add).resolves.toMatchObject({ cartCount: 3 })
  })

  it('refuses a second add-to-cart while one is in flight', async () => {
    const first = addToShopCart({ garment: 'tee', qty: 1, sides: [], designId: 'abcdefghijklmnop1234' })
    await expect(
      addToShopCart({ garment: 'tee', qty: 1, sides: [], designId: 'abcdefghijklmnop1234' }),
    ).rejects.toThrow('already_in_flight')
    deliver({ type: 'teeshoop:cart-result', ok: true, cartCount: 1, cartUrl: '/x', message: 'ok' })
    await expect(first).resolves.toMatchObject({ cartCount: 1 })
  })

  it('resolves a cart reply that carries no requestId (an older bridge.js)', async () => {
    const add = addToShopCart({ garment: 'tee', qty: 2, sides: [], designId: 'abcdefghijklmnop1234' })
    deliver({ type: 'teeshoop:cart-result', ok: false, error: 'teeshoop_design_design_not_found' })
    await expect(add).rejects.toThrow('teeshoop_design_design_not_found')
  })

  it('times out rather than leaving a click hanging forever', async () => {
    const q = requestShopQuote({ garment: 'tee', qty: 1, sides: [] })
    const settled = expect(q).rejects.toThrow('timeout')
    vi.advanceTimersByTime(30000)
    await settled
  })
})

describe('frame height', () => {
  beforeEach(() => {
    startShopBridge()
    deliver({ type: 'teeshoop:context', productId: 42, garment: 'tee', locale: 'fr' })
    sent.length = 0
  })

  it('only ever grows the frame, and never past the parent’s clamp', () => {
    requestFrameHeight(500) // shorter than the 600 the fake window reports
    expect(sent).toEqual([])
    requestFrameHeight(900)
    expect(sent[0].message).toEqual({ type: 'teeshoop:resize', height: 900 })
    requestFrameHeight(99999)
    expect(sent[1].message).toEqual({ type: 'teeshoop:resize', height: 4000 })
  })
})
