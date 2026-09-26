import { describe, expect, it, vi } from 'vitest'
import { callerKey, rateLimited } from './ratelimit'

/**
 * The limiter's behaviour when it is NOT there is the part worth testing.
 *
 * It is bound only on a deployed Worker, so `wrangler dev`, every harness in
 * scripts/ and this suite all run with it absent. If absence refused, the whole
 * shop would be untestable and a deploy that forgot the binding would take the
 * studio off the air; if absence allowed silently, a production Worker missing
 * the binding would be uncapped and nobody would ever find out. It allows, and
 * it warns.
 */
const req = (headers: Record<string, string> = {}) =>
  new Request('https://studio.example/api/design', { method: 'POST', headers })

describe('the key a limit is counted against', () => {
  it('is the address Cloudflare puts on the request', () => {
    expect(callerKey(req({ 'cf-connecting-ip': '203.0.113.7' }))).toBe('203.0.113.7')
  })

  it('never reads X-Forwarded-For, which the client can set', () => {
    const key = callerKey(req({ 'x-forwarded-for': '203.0.113.7', 'cf-connecting-ip': '198.51.100.4' }))
    expect(key).toBe('198.51.100.4')
    expect(callerKey(req({ 'x-forwarded-for': '203.0.113.7' }))).toBe('unknown')
  })

  /*
   * SEC-03. One subscriber holds a whole /64, and counting the full address
   * gave them 2^64 budgets: a limit a script walks straight past.
   */
  it('counts an IPv6 caller by its /64, however the address is written', () => {
    const key = (ip: string) => callerKey(req({ 'cf-connecting-ip': ip }))
    const one = key('2001:db8:1:2::1')
    expect(key('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe(one)
    expect(key('2001:0DB8:0001:0002:ffff::')).toBe(one)
    expect(key('2001:db8:1:3::1')).not.toBe(one)
    expect(key('::1')).toBe('0:0:0:0::/64')
    expect(key('64:ff9b::192.0.2.1')).toBe('64:ff9b:0:0::/64')
    expect(key('::ffff:203.0.113.7')).toBe('203.0.113.7')
    expect(key('203.0.113.7')).toBe('203.0.113.7')
    // Unreadable is still one key, never a pass.
    expect(key('zz::1')).toBe('zz::1')
    expect(key('1:2:3:4:5:6:7:8:9')).toBe('1:2:3:4:5:6:7:8:9')
  })
})

describe('rateLimited', () => {
  it('allows and warns when no limiter is bound', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await rateLimited(undefined, req(), 'POST /api/design')).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0][0])).toContain('POST /api/design')
    warn.mockRestore()
  })

  it('allows when the limiter says yes', async () => {
    const limiter = { limit: async () => ({ success: true }) }
    expect(await rateLimited(limiter, req({ 'cf-connecting-ip': '203.0.113.7' }), 'x')).toBeNull()
  })

  it('refuses with 429, a retry delay and a sentence the studio can show', async () => {
    const limiter = { limit: async () => ({ success: false }) }
    const res = await rateLimited(limiter, req({ 'cf-connecting-ip': '203.0.113.7' }), 'x')
    expect(res).not.toBeNull()
    expect(res!.status).toBe(429)
    expect(res!.headers.get('retry-after')).toBe('60')
    expect(res!.headers.get('cache-control')).toBe('no-store')
    const body = await res!.json()
    expect(body.error).toBe('rate_limited')
    // French, and it says the work is not lost: a customer who has just spent
    // twenty minutes on a design must not read this as "start again".
    expect(body.message).toContain('n’est pas perdue')
  })

  it('passes the caller address to the limiter, so two visitors do not share a count', async () => {
    const seen: string[] = []
    const limiter = {
      limit: async ({ key }: { key: string }) => {
        seen.push(key)
        return { success: true }
      },
    }
    await rateLimited(limiter, req({ 'cf-connecting-ip': '203.0.113.7' }), 'x')
    await rateLimited(limiter, req({ 'cf-connecting-ip': '198.51.100.4' }), 'x')
    expect(seen).toEqual(['203.0.113.7', '198.51.100.4'])
  })

  it('allows when the limiter throws, because a counter is not an authorisation', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const limiter = {
      limit: async () => {
        throw new Error('rate limiting unavailable')
      },
    }
    expect(await rateLimited(limiter, req(), 'POST /api/ar')).toBeNull()
    expect(String(warn.mock.calls[0][0])).toContain('POST /api/ar')
    warn.mockRestore()
  })
})
