/**
 * The CORS allow-list, and the two ways it could quietly become useless.
 *
 * A header this file gets wrong is not a crash. It is either a purchase that
 * stops one step before the cart (too tight) or a route on the open internet
 * readable by any page (too loose), and neither shows up in a build.
 */
import { describe, expect, it, vi } from 'vitest'
import worker from './index'
import { allowedOrigin, preflight, withCors } from './cors'

const SHOP = 'https://teeshoop.com'
const WWW = 'https://www.teeshoop.com'
const ENV = { SHOP_ORIGINS: `${SHOP} ${WWW}` }

const req = (origin?: string, init: RequestInit = {}) =>
  new Request('https://studio.example/api/design', {
    ...init,
    headers: { ...(init.headers ?? {}), ...(origin ? { origin } : {}) },
  })

describe('allowedOrigin', () => {
  it('allows an origin that is on the list, exactly', () => {
    expect(allowedOrigin(req(SHOP), ENV)).toBe(SHOP)
    expect(allowedOrigin(req(WWW), ENV)).toBe(WWW)
  })

  /*
   * THE ONE THAT MATTERS. `startsWith` is the mistake this project has already
   * written down twice (CLAUDE.md section 4, and the postMessage bridge), and
   * `teeshoop.com.evil.tld` is a domain anyone can register.
   */
  it('refuses a prefix of an allowed origin', () => {
    expect(allowedOrigin(req('https://teeshoop.com.evil.tld'), ENV)).toBeNull()
    expect(allowedOrigin(req('https://teeshoop.como'), ENV)).toBeNull()
    expect(allowedOrigin(req('https://www.teeshoop.com.attacker.example'), ENV)).toBeNull()
  })

  it('refuses a suffix, a scheme swap and a port swap', () => {
    expect(allowedOrigin(req('https://evil.teeshoop.com'), ENV)).toBeNull()
    expect(allowedOrigin(req('http://teeshoop.com'), ENV)).toBeNull()
    expect(allowedOrigin(req('https://teeshoop.com:8443'), ENV)).toBeNull()
  })

  it('refuses a trailing slash, because an Origin never has one', () => {
    expect(allowedOrigin(req('https://teeshoop.com/'), ENV)).toBeNull()
  })

  it('refuses the literal wildcard and the null origin', () => {
    expect(allowedOrigin(req('*'), ENV)).toBeNull()
    // A sandboxed iframe and a `data:` document both send this string.
    expect(allowedOrigin(req('null'), ENV)).toBeNull()
  })

  it('answers null for a request with no Origin at all', () => {
    expect(allowedOrigin(req(), ENV)).toBeNull()
  })

  it('denies every origin when SHOP_ORIGINS is unset, and says so once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(allowedOrigin(req(SHOP), {})).toBeNull()
    expect(allowedOrigin(req(SHOP), { SHOP_ORIGINS: '   ' })).toBeNull()
    expect(warn).toHaveBeenCalledTimes(2)
    expect(String(warn.mock.calls[0][0])).toContain('SHOP_ORIGINS')
    warn.mockRestore()
  })
})

describe('withCors', () => {
  it('stamps the requesting origin, never a wildcard', async () => {
    const res = withCors(new Response('{}'), req(SHOP), ENV)
    expect(res.headers.get('access-control-allow-origin')).toBe(SHOP)
    expect(res.headers.get('access-control-allow-origin')).not.toBe('*')
  })

  it('never sends credentials', () => {
    const res = withCors(new Response('{}'), req(SHOP), ENV)
    expect(res.headers.get('access-control-allow-credentials')).toBeNull()
  })

  it('sends vary: origin even when it refuses, so a cache cannot cross the two', () => {
    const allowed = withCors(new Response('{}'), req(SHOP), ENV)
    const refused = withCors(new Response('{}'), req('https://evil.tld'), ENV)
    expect(allowed.headers.get('vary')).toBe('Origin')
    expect(refused.headers.get('vary')).toBe('Origin')
    expect(refused.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('keeps a vary the handler had already set', () => {
    const res = withCors(new Response('{}', { headers: { vary: 'Range' } }), req(SHOP), ENV)
    expect(res.headers.get('vary')).toBe('Range, Origin')
  })

  it('does not duplicate origin in vary', () => {
    const res = withCors(new Response('{}', { headers: { vary: 'origin' } }), req(SHOP), ENV)
    expect(res.headers.get('vary')).toBe('origin')
  })

  it('keeps the body, the status and the other headers', async () => {
    const res = withCors(
      new Response('{"id":"x"}', { status: 201, headers: { 'content-type': 'application/json' } }),
      req(SHOP),
      ENV,
    )
    expect(res.status).toBe(201)
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(await res.text()).toBe('{"id":"x"}')
  })
})

describe('preflight', () => {
  it('answers 204 with the methods for an allowed origin', () => {
    const res = preflight(req(SHOP, { method: 'OPTIONS' }), ENV, 'POST, OPTIONS')
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe(SHOP)
    expect(res.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS')
  })

  it('answers 204 with NO allow-origin for an origin that is not ours', () => {
    const res = preflight(req('https://teeshoop.com.evil.tld', { method: 'OPTIONS' }), ENV, 'POST, OPTIONS')
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(res.headers.get('access-control-allow-methods')).toBeNull()
    expect(res.headers.get('vary')).toBe('Origin')
  })

  it('echoes the requested headers rather than publishing a list', () => {
    const res = preflight(
      req(SHOP, { method: 'OPTIONS', headers: { 'access-control-request-headers': 'x-teeshoop-run' } }),
      ENV,
      'POST, OPTIONS',
    )
    expect(res.headers.get('access-control-allow-headers')).toBe('x-teeshoop-run')
  })
})

/**
 * THROUGH THE ROUTE TABLE, because a correct module wired to nothing is the
 * failure that unit tests cannot see. `worker/design.test.ts` makes the same
 * argument for the design handlers themselves.
 */
describe('the design routes, through worker.fetch', () => {
  const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext

  /**
   * The SPA fallback, exactly as production has it: `not_found_handling` is
   * `single-page-application`, so any URL with no route answers 200 with the
   * studio's HTML. This stub is what makes "the OPTIONS handler exists" a real
   * assertion instead of one that passes on an asset.
   */
  const routed = () =>
    ({
      ...ENV,
      AR_BUCKET: { get: async () => null, head: async () => null } as unknown as R2Bucket,
      ASSETS: {
        fetch: async () =>
          new Response('<!doctype html><title>studio</title>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
      } as unknown as Fetcher,
    }) as never

  const call = (path: string, init?: RequestInit) =>
    worker.fetch(new Request(`https://studio.example${path}`, init), routed(), ctx)

  it('answers OPTIONS /api/design itself and not with the SPA page', async () => {
    const res = await call('/api/design', { method: 'OPTIONS', headers: { origin: SHOP } })
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
    expect(res.headers.get('access-control-allow-origin')).toBe(SHOP)
  })

  it('answers OPTIONS /api/design/{id} for an id that does not exist', async () => {
    const res = await call('/api/design/aaaaaaaaaaaaaaaa', {
      method: 'OPTIONS',
      headers: { origin: SHOP },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, HEAD, OPTIONS')
  })

  it('stamps the 404 from GET /api/design/{id}, so the page can read the refusal', async () => {
    const res = await call('/api/design/aaaaaaaaaaaaaaaa', { headers: { origin: SHOP } })
    expect(res.status).toBe(404)
    expect(res.headers.get('access-control-allow-origin')).toBe(SHOP)
    expect(await res.json()).toEqual({ error: 'not found' })
  })

  it('stamps nothing for an origin that only looks like ours', async () => {
    const res = await call('/api/design/aaaaaaaaaaaaaaaa', {
      headers: { origin: 'https://teeshoop.com.evil.tld' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(res.headers.get('vary')).toBe('Origin')
  })

  /*
   * THE ROUTES THAT MUST NOT GAIN A HEADER. `/api/nest` is the film economics
   * and `/api/fr/*` is our purchase cost; both are admin-only, and a page that
   * could read either would be a page holding shop-internal numbers. The
   * erasure route is left out for the same reason: nothing in a browser needs
   * to delete a design.
   */
  it('leaves every other route without CORS headers', async () => {
    for (const [path, init] of [
      ['/api/nest', { method: 'POST', headers: { origin: SHOP } }],
      ['/api/fr/catalog', { headers: { origin: SHOP } }],
      ['/api/design/aaaaaaaaaaaaaaaa', { method: 'DELETE', headers: { origin: SHOP } }],
      // The proof image, which the cart shows in an `<img>`: an element that
      // has never needed CORS to display anything.
      ['/r2/design/aaaaaaaaaaaaaaaa/preview.png', { headers: { origin: SHOP } }],
      ['/__fr-cache/anything', { headers: { origin: SHOP } }],
    ] as const) {
      const res = await call(path, init as RequestInit)
      expect(res.headers.get('access-control-allow-origin'), `${path} must not be readable`).toBeNull()
    }
  })
})
