/**
 * The studio's Content Security Policy, on the one directive that differs
 * between the customer page and the admin page.
 */
import { describe, expect, it } from 'vitest'
import { studioPolicy } from './csp'

const SHOP = { SHOP_ORIGINS: 'https://teeshoop.com https://www.teeshoop.com' }
const connect = (policy: string): string => policy.split('; ').find((d) => d.startsWith('connect-src')) ?? ''

describe('studioPolicy', () => {
  it('lets the admin page reach the shop, whose REST API its DTF queue and import call (STU-01)', () => {
    expect(connect(studioPolicy('n', SHOP, { admin: true }))).toBe(
      "connect-src 'self' data: blob: https://teeshoop.com https://www.teeshoop.com",
    )
  })

  it('keeps the customer studio on its own origin', () => {
    expect(connect(studioPolicy('n', SHOP))).toBe("connect-src 'self' data: blob:")
  })

  it('adds nothing when no shop is configured', () => {
    expect(connect(studioPolicy('n', {}, { admin: true }))).toBe("connect-src 'self' data: blob:")
  })
})
