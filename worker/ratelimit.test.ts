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
