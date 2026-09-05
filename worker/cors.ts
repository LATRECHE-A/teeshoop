/**
 * Who may READ an answer from the two design routes.
 *
 * WHY THIS EXISTS AT ALL. Until the customiser moved into the shop's own page,
 * every caller of `POST /api/design` was the studio itself, served from this
 * same Worker, so the fetch was same-origin and no browser ever asked for a
 * CORS header. The shop's own page is a different origin: it can SEND the
 * upload (a multipart POST is a simple request and always leaves), and without
 * `access-control-allow-origin` on the answer the browser refuses to let the
 * page READ the design id that comes back. The purchase then dies one step
 * before the cart, with nothing in the network tab that looks like a refusal.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EXACT STRING EQUALITY, AND NOTHING ELSE.
 *
 * `startsWith` passes for `https://teeshoop.com.evil.tld`, which is a different
 * site that anyone can register, and `*` hands every origin on the internet a
 * reader for these routes. The comparison here is `===` against the entries of
 * `SHOP_ORIGINS`, split on whitespace, and there is no normalisation step: an
 * origin is already a canonical string (scheme, host, port, no path, no
 * trailing slash) and code that "tidies" one before comparing is code that
 * decides two different strings are the same.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO CREDENTIALS, DELIBERATELY.
 *
 * `access-control-allow-credentials` is never sent. These routes take no cookie
 * and no session; the design id is the capability and it travels in the body.
 * Sending the header would let a page carry ambient authority to a route that
 * has none to carry, which is how a CSRF is built out of two safe halves.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `vary: origin` IS SENT ON EVERY ANSWER, INCLUDING THE REFUSALS.
 *
 * Cloudflare's cache, and any intermediary, keys on the URL. An answer computed
 * for an allowed origin, stored, and then replayed to a request from another
 * one would hand a stranger the header that says they may read it. The refusal
 * needs the same `vary` for the mirror image of that reason: cache the
 * header-less answer under the allowed origin's URL and the shop's own upload
 * starts failing at random.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * UNSET `SHOP_ORIGINS` REFUSES EVERY ORIGIN, which is the opposite of what the
 * same variable does for `frame-ancestors` in worker/csp.ts, and the difference
 * is not an inconsistency.
 *
 * There, omitting the directive loses DEPTH: the real gate on who may drive the
 * studio is the bridge's own origin comparison, which does not move. Here the
 * header IS the gate. There is nothing behind it to fall back on, so an unset
 * variable denies, per CLAUDE.md section 3, and says so in the log rather than
 * silently.
 */

export interface CorsEnv {
  /** Space-separated origins allowed to read these routes. Unset denies all. */
  SHOP_ORIGINS?: string
}

/** The parsed allow-list. Whitespace-separated, empty entries dropped. */
function shopOrigins(env: CorsEnv): string[] {
  return (env.SHOP_ORIGINS ?? '').trim().split(/\s+/).filter((s) => s !== '')
}

/**
 * The request's `Origin` when it is one we allow, else null.
 *
 * Null covers three different situations on purpose, because all three get the
 * same answer: no `Origin` header at all (a server, curl, or a same-origin
 * navigation, none of which needs CORS), an origin that is not on the list, and
 * an unset `SHOP_ORIGINS`. Only the last is worth a line in the log.
 */
export function allowedOrigin(request: Request, env: CorsEnv): string | null {
  const origin = request.headers.get('origin')
  if (origin === null || origin === '') return null

  const allowed = shopOrigins(env)
  if (allowed.length === 0) {
    console.warn(
      'SHOP_ORIGINS is unset, so the design routes send no CORS header and the shop ' +
        "page cannot read the design id it needs. Set it in wrangler.jsonc to the shop's origin.",
    )
    return null
  }

  // === and not startsWith, not includes, not a regexp. See the header.
  for (const candidate of allowed) if (candidate === origin) return origin
  return null
}

/**
 * Stamp the answer for this request's origin, or stamp only `vary`.
 *
 * The response is rebuilt rather than mutated: a `Response` returned by another
 * handler may carry immutable headers (anything that came out of the cache or
 * out of `fetch`), and `headers.set` on one of those throws.
 */
export function withCors(response: Response, request: Request, env: CorsEnv): Response {
  const headers = new Headers(response.headers)
  appendVary(headers)
  const origin = allowedOrigin(request, env)
  if (origin !== null) headers.set('access-control-allow-origin', origin)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/**
 * The preflight, for the methods this route really answers.
 *
 * A multipart upload needs no preflight today (`multipart/form-data` is a
 * safelisted content type and the fetch carries no custom header), so this
 * handler is what keeps that from being load-bearing: the day the shop adds one
 * header to the upload, the browser sends an OPTIONS first, and without this it
 * would fall through to the static-asset SPA fallback and be answered with 200
 * and a page of HTML, which the browser reads as "no CORS headers" and the
 * purchase stops.
 *
 * 204 and an empty body. A preflight the origin is not allowed for gets the
 * same 204 with no `access-control-allow-origin`, which is what a browser needs
 * to refuse: an error status here produces a network failure in the console
 * instead of a CORS message, and the two send whoever is debugging in opposite
 * directions.
 */
export function preflight(request: Request, env: CorsEnv, methods: string): Response {
  const headers = new Headers()
  appendVary(headers)
  const origin = allowedOrigin(request, env)
  if (origin !== null) {
    headers.set('access-control-allow-origin', origin)
    headers.set('access-control-allow-methods', methods)
    /*
     * Echo what was asked for rather than publishing a list.
     *
     * The shop sends no custom header today; echoing means the day it sends
     * one, the preflight answers instead of failing, and the header still never
     * carries credentials because `access-control-allow-credentials` is not
     * sent here or anywhere in this file.
     */
    const asked = request.headers.get('access-control-request-headers')
    if (asked !== null && asked !== '') headers.set('access-control-allow-headers', asked)
    headers.set('access-control-max-age', '600')
  }
  return new Response(null, { status: 204, headers })
}

/**
 * Add `origin` to `vary` without dropping whatever was already there.
 *
 * `serveDesignFile` sets its own `vary` for range requests; a `set` would erase
 * it and the two answers to one URL would be cached as one.
 */
function appendVary(headers: Headers): void {
  const existing = headers.get('vary')
  if (existing === null || existing.trim() === '') {
    headers.set('vary', 'Origin')
    return
  }
  const parts = existing.split(',').map((s) => s.trim())
  if (parts.some((p) => p.toLowerCase() === 'origin')) return
  headers.set('vary', `${existing}, Origin`)
}
