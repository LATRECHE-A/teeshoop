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

async function serveAr(env: Env, id: string, ext: string, head: boolean): Promise<Response> {
  if (!ID_RE.test(id) || !MIME[ext]) return new Response('not found', { status: 404 })
  const obj = await env.AR_BUCKET.get(`ar/${id}.${ext}`)
  if (!obj) return new Response('not found', { status: 404 })
  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  // Force the correct type even if an object was stored with a stale MIME.
  headers.set('content-type', MIME[ext])
  headers.set('cache-control', 'public, max-age=31536000, immutable')
  headers.set('etag', obj.httpEtag)
  return new Response(head ? null : obj.body, { headers })
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
      return serveAr(env, blob[1], blob[2], request.method === 'HEAD')
    }

    // Short viewer URL from the QR: serve the viewer SPA page for /v/{id}.
    if (/^\/v\/[^/]+\/?$/.test(path)) {
      return env.ASSETS.fetch(new Request(new URL('/v.html', url.origin), request))
    }

    return env.ASSETS.fetch(request)
  },
}
