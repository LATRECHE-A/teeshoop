/**
 * Tshop Cloudflare Worker — the small backend behind the AR try-on.
 *
 * The site is otherwise pure static assets; this Worker adds exactly three
 * dynamic routes so a design's 3D model can travel cross-device from a scanned
 * QR to native mobile AR:
 *
 *   POST /api/ar            store {glb, usdz, poster} → returns a short { id }
 *   GET  /r2/ar/{id}.{ext}  stream a stored blob with the correct MIME type
 *   GET  /v/{id}            serve the viewer page (v.html) for the QR short URL
 *
 * Everything else falls through to the static assets (with SPA fallback), so
 * the studio is unaffected. Models are stored in R2 (binding AR_BUCKET); set a
 * bucket lifecycle rule to expire the `ar/` prefix (see README) since R2 has no
 * per-object TTL.
 */

interface Env {
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

  const id = shortId()
  const created = new Date().toISOString()
  const put = (ext: keyof typeof MIME, file: File) =>
    file.arrayBuffer().then((buf) =>
      env.AR_BUCKET.put(`ar/${id}.${ext}`, buf, {
        httpMetadata: { contentType: MIME[ext] },
        customMetadata: { created },
      }),
    )
  try {
    await Promise.all([put('glb', glb), put('usdz', usdz), put('png', poster)])
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
 * Serve a stored blob. Full HTTP semantics — Content-Length, Accept-Ranges, and
 * real 206 Range responses — because Android Scene Viewer's model downloader
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
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (path === '/api/ar' && request.method === 'POST') {
      return uploadAr(request, env)
    }

    const blob = path.match(/^\/r2\/ar\/([^/]+)\.(glb|usdz|png)$/)
    if (blob && (request.method === 'GET' || request.method === 'HEAD')) {
      return serveAr(request, env, blob[1], blob[2], request.method === 'HEAD')
    }

    // Viewer page for the QR short link (id travels as ?id=…; a /v/{id} path
    // also works). IMPORTANT: env.ASSETS.fetch applies html_handling, so asking
    // for the literal '/v.html' returns a 307 -> /v (extension dropped) and the
    // binding RELAYS that redirect instead of the HTML — which strips the id and
    // is the exact AR bug. So fetch /v.html, follow the single html_handling
    // redirect to the canonical asset, and return the HTML with a 200 so the
    // browser stays on the original URL (keeping ?id / the /v/{id} segment).
    if (path === '/v' || /^\/v\/[^/]+\/?$/.test(path)) {
      let res = await env.ASSETS.fetch(new URL('/v.html', url.origin))
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location')
        if (loc) res = await env.ASSETS.fetch(new URL(loc, url.origin))
      }
      return new Response(res.body, { status: 200, headers: res.headers })
    }

    return env.ASSETS.fetch(request)
  },
}
