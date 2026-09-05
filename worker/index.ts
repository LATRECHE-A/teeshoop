/**
 * Tshop Cloudflare Worker: the small backend behind the AR try-on and the
 * Falk&Ross supplier catalogue.
 *
 * The site is otherwise pure static assets; this Worker adds the dynamic routes
 * the browser cannot serve itself.
 *
 * AR, so a design's 3D model can travel cross-device from a scanned QR to
 * native mobile AR:
 *   POST /api/ar            store {glb, usdz, poster} → returns a short { id }
 *   GET  /r2/ar/{id}.{ext}  stream a stored blob with the correct MIME type
 *   GET  /v/{id}            serve the viewer page (v.html) for the QR short URL
 *
 * DESIGN: the hand-off to WordPress (worker/design.ts). An order line carries
 * an id; this is what the id points at, and until it existed a customer's
 * artwork lived only in their own browser:
 *   POST /api/design        store the design document + its rasters → { id }
 *   GET  /api/design/{id}   the manifest, what the plugin verifies against
 *   GET  /r2/design/{id}/…  the bytes; preview open, document/rasters admin-only
 *   DELETE /api/design/{id} erase every object under the id (RGPD article 17)
 *   POST /api/design/reap   delete designs older than a date, minus a keep list
 *
 * The last two are ADMIN-ONLY and are the only deletions this Worker performs.
 * R2's lifecycle rule covers `ar/` and cannot cover `design/`, because only the
 * shop knows which artwork is still owed against an order.
 *
 * SUPPLIER: `/api/fr/*`, the live Falk&Ross webservice (worker/falkross.ts).
 * It lives server-side because the credentials must not ship to a browser, the
 * supplier sends no CORS headers, and the ingest pipeline needs untainted
 * canvas pixels from the photos. See that module's header for the full story.
 *
 * `/api/fr/*` is ADMIN-ONLY: it returns our purchase cost per SKU and our
 * supplier stock, so it sits behind a bearer gate (worker/auth.ts, secret
 * `ADMIN_TOKEN`, unset means deny all). TWO exemptions, both forced rather than
 * chosen, because an `<img src>` cannot send a header: the photo proxy
 * `/api/fr/img/*`, and `/media/blank/*`, which is the same handler under a
 * prefix that does not name the supplier and is what the shop stores in its
 * database. Both serve public supplier photos fetched upstream with no
 * credentials.
 * `POST /api/ar` stays open on purpose: customers export their own AR models.
 *
 * Everything else falls through to the static assets (with SPA fallback), so
 * the studio is unaffected. Models are stored in R2 (binding AR_BUCKET); set a
 * bucket lifecycle rule to expire the `ar/` prefix (see README) since R2 has no
 * per-object TTL.
 */
import { handleFalkRoss, type FalkRossEnv } from './falkross'
import { requireAdmin } from './auth'
import {
  createDesign,
  deleteDesign,
  getDesign,
  reapDesigns,
  serveDesignFile,
  type DesignEnv,
} from './design'
import { nestOrder } from './nest'
import { isGlb, isPng, isUsdz } from './containers'
import { rateLimited, type RateLimitEnv } from './ratelimit'
import { cspNonce, studioPolicy, viewerPolicy, withCsp, type CspEnv } from './csp'
import { preflight, withCors, type CorsEnv } from './cors'

interface Env extends FalkRossEnv, DesignEnv, RateLimitEnv, CspEnv, CorsEnv {
  ASSETS: Fetcher
  AR_BUCKET: R2Bucket
}

// USDZ MUST be model/vnd.usdz+zip or iOS Quick Look silently refuses to enter AR.
const MIME: Record<string, string> = {
  glb: 'model/gltf-binary',
  usdz: 'model/vnd.usdz+zip',
  png: 'image/png',
}
const MAX_BYTES = 12 * 1024 * 1024 // per file
const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const ID_RE = /^[A-Za-z0-9_-]{6,40}$/

function shortId(): string {
  const bytes = new Uint8Array(10)
  crypto.getRandomValues(bytes)
  let s = ''
  for (const b of bytes) s += ID_ALPHABET[b % ID_ALPHABET.length]
  return s
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * A path segment, decoded, or null when it cannot be.
 *
 * `decodeURIComponent` THROWS on a malformed escape (`%zz`), and an uncaught
 * throw in this handler is a 500 on input anyone can send. Null is answered as
 * a 404 by every caller: a segment we cannot read names nothing we store.
 */
function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

async function uploadAr(request: Request, env: Env): Promise<Response> {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return json({ error: 'expected multipart/form-data' }, 400)
  }
  const glb = form.get('glb')
  const usdz = form.get('usdz')
  const poster = form.get('poster')
  if (!(glb instanceof File) || !(usdz instanceof File) || !(poster instanceof File)) {
    return json({ error: 'missing glb/usdz/poster' }, 400)
  }
  if (glb.size > MAX_BYTES || usdz.size > MAX_BYTES || poster.size > MAX_BYTES) {
    return json({ error: 'file too large' }, 413)
  }

  /*
   * This route is deliberately OPEN: customers export their own AR models and
   * cannot authenticate. What stops R2 being used as generic file hosting is
   * that the bytes have to BE one of the three formats the viewer can show.
   *
   * It used to be four bytes of 'glTF', four of 'PK\x03\x04' and the eight-byte
   * PNG signature, and measured against a real `wrangler dev` that was no
   * defence at all: 'glTF' plus 50 kB of urandom was accepted, and an ordinary
   * `zip -j payload.txt` renamed .usdz came back out of /r2/ar/<id>.usdz with
   * `unzip -l` listing the payload. A prefix cannot see what follows it, and
   * what follows it is the entire attack. `containers.ts` walks each format's
   * own length arithmetic and requires it to close on the last byte of the
   * file, which is what makes a rider impossible.
   */
  const bytes = async (f: File) => new Uint8Array(await f.arrayBuffer())
  const [gBuf, uBuf, pBuf] = await Promise.all([bytes(glb), bytes(usdz), bytes(poster)])
  if (!isGlb(gBuf) || !isUsdz(uBuf) || !isPng(pBuf)) {
    return json({ error: 'not a glb/usdz/png' }, 415)
  }

  const id = shortId()
  const created = new Date().toISOString()
  // The validated buffers are what gets written, not a second read of the same
  // File: one read means the bytes that were checked are the bytes that land.
  const put = (ext: keyof typeof MIME, buf: Uint8Array) =>
    env.AR_BUCKET.put(`ar/${id}.${ext}`, buf, {
      httpMetadata: { contentType: MIME[ext] },
      customMetadata: { created },
    })
  try {
    await Promise.all([put('glb', gBuf), put('usdz', uBuf), put('png', pBuf)])
  } catch {
    return json({ error: 'storage write failed' }, 502)
  }
  return json({ id })
}

/** Parse a single `bytes=start-end` range against a known size; null if invalid. */
function parseRange(header: string, size: number): { offset: number; length: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null
  const [, s, e] = m
  let start: number
  let end: number
  if (s === '') {
    if (e === '') return null
    const n = parseInt(e, 10) // suffix: last n bytes
    if (!Number.isFinite(n) || n <= 0) return null
    start = Math.max(0, size - n)
    end = size - 1
  } else {
    start = parseInt(s, 10)
    end = e === '' ? size - 1 : Math.min(parseInt(e, 10), size - 1)
  }
  if (!Number.isFinite(start) || start < 0 || start >= size || end < start) return null
  return { offset: start, length: end - start + 1 }
}

/**
 * Serve a stored blob. Full HTTP semantics (Content-Length, Accept-Ranges, and
 * real 206 Range responses) because Android Scene Viewer's model downloader
 * uses Range requests and rejects the object ("couldn't load") if the server
 * ignores them.
 */
async function serveAr(request: Request, env: Env, id: string, ext: string, head: boolean): Promise<Response> {
  if (!ID_RE.test(id) || !MIME[ext]) return new Response('not found', { status: 404 })
  const key = `ar/${id}.${ext}`

  const setCommon = (h: Headers, o: { writeHttpMetadata(h: Headers): void; httpEtag: string }) => {
    o.writeHttpMetadata(h)
    h.set('content-type', MIME[ext]) // force correct type even if stored stale
    h.set('cache-control', 'public, max-age=31536000, immutable')
    h.set('etag', o.httpEtag)
    h.set('accept-ranges', 'bytes')
    /*
     * Customer-supplied bytes on the origin that serves the shop, so the
     * browser must be held to the type we stored. Deliberately NOT paired with
     * `content-disposition: attachment`: iOS Quick Look opens the .usdz INLINE
     * from this URL and Scene Viewer fetches the .glb the same way, so an
     * attachment header would break AR on both platforms.
     */
    h.set('x-content-type-options', 'nosniff')
  }

  if (head) {
    const meta = await env.AR_BUCKET.head(key)
    if (!meta) return new Response('not found', { status: 404 })
    const h = new Headers()
    setCommon(h, meta)
    h.set('content-length', String(meta.size))
    return new Response(null, { status: 200, headers: h })
  }

  const rangeHeader = request.headers.get('range')
  let range: { offset: number; length: number } | null = null
  if (rangeHeader) {
    const meta = await env.AR_BUCKET.head(key)
    if (!meta) return new Response('not found', { status: 404 })
    range = parseRange(rangeHeader, meta.size)
    if (!range) {
      const h = new Headers()
      h.set('accept-ranges', 'bytes')
      h.set('content-range', `bytes */${meta.size}`)
      return new Response(null, { status: 416, headers: h })
    }
  }

  const obj = await env.AR_BUCKET.get(key, range ? { range } : undefined)
  if (!obj) return new Response('not found', { status: 404 })
  const headers = new Headers()
  setCommon(headers, obj)
  if (range) {
    headers.set('content-range', `bytes ${range.offset}-${range.offset + range.length - 1}/${obj.size}`)
    headers.set('content-length', String(range.length))
    return new Response(obj.body, { status: 206, headers })
  }
  headers.set('content-length', String(obj.size))
  return new Response(obj.body, { status: 200, headers })
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (path === '/api/ar' && request.method === 'POST') {
      const tooMany = await rateLimited(env.AR_UPLOAD_LIMIT, request, 'POST /api/ar')
      if (tooMany) return tooMany
      return uploadAr(request, env)
    }

    /*
     * The design hand-off (worker/design.ts). The upload is open for the same
     * reason `POST /api/ar` is (the customer is the author and cannot
     * authenticate), and the read is what the WordPress plugin calls before it
     * will put a personalised line in a cart.
     *
     * THESE TWO ROUTES, AND ONLY THESE TWO, CARRY CORS HEADERS (worker/cors.ts).
     * The customiser now runs inside the shop's own page rather than in a frame
     * served from here, so the fetch that stores a design is cross-origin and
     * the browser will not let the page read the id back without one. Exact
     * string equality against `SHOP_ORIGINS`, no credentials, and `vary: origin`
     * on the refusals too. Nothing else here gains a header: `/api/fr/*` is the
     * supplier's costs, `/api/nest` is the film economics, and both are
     * admin-only and have no business being readable from a page.
     */
    if (path === '/api/design' && request.method === 'OPTIONS') {
      return preflight(request, env, 'POST, OPTIONS')
    }
    if (path === '/api/design' && request.method === 'POST') {
      const tooMany = await rateLimited(env.DESIGN_UPLOAD_LIMIT, request, 'POST /api/design')
      // The refusal is stamped too. A 429 the page cannot read is a purchase
      // that stops with "failed to fetch" instead of "too many uploads".
      if (tooMany) return withCors(tooMany, request, env)
      return withCors(await createDesign(request, env), request, env)
    }
    /*
     * Retention (worker/design.ts). ADMIN-ONLY, and matched before the `{id}`
     * routes below so `reap` can never be read as a design id. Nothing else in
     * this Worker deletes anything.
     */
    if (path === '/api/design/reap' && request.method === 'POST') {
      return reapDesigns(request, env)
    }
    const design = /^\/api\/design\/([^/]+)$/.exec(path)
    if (design) {
      // The preflight is answered BEFORE the id is decoded, and for any id.
      // A browser asking whether it may read /api/design/{id} must get the same
      // answer whether or not that design exists, or the preflight becomes an
      // oracle for which ids are real.
      if (request.method === 'OPTIONS') return preflight(request, env, 'GET, HEAD, OPTIONS')
      const id = decodeSegment(design[1])
      if (id === null) return withCors(json({ error: 'not found' }, 404), request, env)
      if (request.method === 'GET' || request.method === 'HEAD')
        return withCors(await getDesign(env, id), request, env)
      /*
       * The R2 half of an RGPD erasure request; the shop calls it, SERVER TO
       * SERVER, with the admin token. Deliberately NOT stamped: a page that
       * could read this answer is a page that was handed a deletion route, and
       * no browser needs one.
       */
      if (request.method === 'DELETE') return deleteDesign(request, env, id)
    }
    const designFile = /^\/r2\/design\/([^/]+)\/(.+)$/.exec(path)
    if (designFile && (request.method === 'GET' || request.method === 'HEAD')) {
      const rest = decodeSegment(designFile[2])
      if (rest === null) return new Response('not found', { status: 404 })
      return serveDesignFile(request, env, designFile[1], rest)
    }

    /*
     * How much film an order needs (worker/nest.ts). ADMIN-ONLY: the answer is
     * film economics, and a packer left open is a free compute service. The
     * WordPress cost engine is the only caller.
     */
    if (path === '/api/nest' && request.method === 'POST') {
      return nestOrder(request, env)
    }

    // The ADMIN studio. The bundle split (src/app/adminSlots.tsx) keeps the
    // workshop tools out of the customer's JavaScript; it does not make this
    // page private, because dist/ is served wholesale. So the page itself is
    // gated, with a Basic challenge so a browser actually shows a login box.
    // `assets.run_worker_first` in wrangler.jsonc is what routes it here.
    if (path === '/admin' || path === '/admin.html') {
      const denied = await requireAdmin(request, env, 'page')
      if (denied) return denied
      const res = await env.ASSETS.fetch(new URL('/admin.html', url.origin))
      const nonce = cspNonce()
      return withCsp(
        new Response(res.body, {
          status: 200,
          headers: { ...Object.fromEntries(res.headers), 'cache-control': 'no-store' },
        }),
        studioPolicy(nonce, env),
        nonce,
      )
    }

    /*
     * THE ADMIN STUDIO'S OWN JAVASCRIPT.
     *
     * Gating `/admin.html` gated the PAGE and nothing it loads. `dist/` is
     * served wholesale, so until 27/08/2026 `GET /admin.html` answered 401 while
     * `GET /assets/DtfModal-<hash>.js` answered 200 with 137 ko of the film cost
     * model to a request carrying no credentials at all. Both gates that exist
     * for this were green and neither was wrong: `adminBoundary.test.ts` proves
     * the customer entry cannot REACH those modules, and `bundle-guard.mjs`
     * expects shop-internal markers in a file classified ADMIN. Neither asserted
     * that an ADMIN file is not simply downloadable, and the hash in the name is
     * not a secret: `GET /.vite/manifest.json` listed every one of them.
     *
     * `vite.config.ts` now emits those chunks into `admin-assets/`, decided from
     * the real source graph, and this is the gate on it. `page` rather than
     * `api` so a browser that arrives here without having answered the prompt on
     * /admin.html gets one; a browser that HAS answered it attaches the same
     * credentials to these same-origin subresource requests on its own, which is
     * what makes the studio load at all.
     */
    if (path.startsWith('/admin-assets/')) {
      const denied = await requireAdmin(request, env, 'page')
      if (denied) return denied
      return env.ASSETS.fetch(request)
    }

    // The Falk&Ross module memoises derived payloads (INCLUDING PURCHASE
    // PRICES) in caches.default under keys minted as `/__fr-cache/…` URLs on
    // this origin. They are cache keys, never routes: refuse them explicitly
    // rather than letting them fall through to the SPA asset fallback.
    if (path.startsWith('/__fr-cache/')) return new Response('not found', { status: 404 })

    // Supplier catalogue: ADMIN-ONLY behind a bearer gate (worker/auth.ts).
    // Returns null for anything outside /api/fr/*, so the AR routes and the
    // static assets below are untouched.
    const supplier = await handleFalkRoss(request, env, ctx)
    if (supplier) return supplier

    const blob = path.match(/^\/r2\/ar\/([^/]+)\.(glb|usdz|png)$/)
    if (blob && (request.method === 'GET' || request.method === 'HEAD')) {
      return serveAr(request, env, blob[1], blob[2], request.method === 'HEAD')
    }

    // Viewer page for the QR short link (id travels as ?id=…; a /v/{id} path
    // also works). IMPORTANT: env.ASSETS.fetch applies html_handling, so asking
    // for the literal '/v.html' returns a 307 -> /v (extension dropped) and the
    // binding RELAYS that redirect instead of the HTML, which strips the id and
    // is the exact AR bug. So fetch /v.html, follow the single html_handling
    // redirect to the canonical asset, and return the HTML with a 200 so the
    // browser stays on the original URL (keeping ?id / the /v/{id} segment).
    if (path === '/v' || /^\/v\/[^/]+\/?$/.test(path)) {
      let res = await env.ASSETS.fetch(new URL('/v.html', url.origin))
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location')
        if (loc) res = await env.ASSETS.fetch(new URL(loc, url.origin))
      }
      const nonce = cspNonce()
      return withCsp(new Response(res.body, { status: 200, headers: res.headers }), viewerPolicy(nonce), nonce)
    }

    /*
     * THE CUSTOMER STUDIO, which arrives here as the asset fallback rather than
     * through a route of its own. Only DOCUMENTS get the policy: a dedicated
     * worker loaded from an http(s) URL takes its policy from ITS OWN response
     * headers and not from the document that started it, so putting this on
     * every response would need `'wasm-unsafe-eval'` repeated on the background
     * remover's own chunk or the customer clicks « enlever le fond » and gets a
     * worker that will not start.
     */
    const asset = await env.ASSETS.fetch(request)
    if ((asset.headers.get('content-type') ?? '').includes('text/html')) {
      const nonce = cspNonce()
      return withCsp(asset, studioPolicy(nonce, env), nonce)
    }
    return asset
  },
}
