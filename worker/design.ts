/**
 * The design hand-off — the first server-side object in this project.
 *
 * Until now a customer's artwork existed in exactly one place: their own
 * browser. The design document lives in zustand, the uploads live in that
 * browser's IndexedDB, and the DTF transfers are rendered from both at the
 * moment the workshop asks for them. That is fine for a studio you play with
 * and impossible for a shop: an order arrives in WooCommerce with a design
 * nobody but the buyer can open.
 *
 * So an order line carries an ID, and this is what the ID points at.
 *
 * WHAT IS STORED IS THE SOURCE, NOT THE OUTPUT. A design is its document plus
 * the rasters it references — never the nested gang sheets. Two reasons, and
 * the second is the one that matters:
 *
 *   The transfers are derived. Nesting depends on the supplier, the roll width,
 *   the quantity and which OTHER orders are being ganged with it, none of which
 *   is known when the customer clicks add-to-cart. Freezing a layout here would
 *   throw away the pooling that makes DTF cheap.
 *
 *   The rasters are NOT derived. A customer's upload exists nowhere else. Lose
 *   it and the order is unprintable, whatever else survives. The document
 *   references assets by id, so the id without the bytes is a dangling pointer
 *   to a file in a browser that has since cleared its storage.
 *
 * `app_version` is stamped on the manifest because the artwork is re-rendered
 * later by whatever code is deployed then. If a render ever changes, that field
 * is what says which orders were quoted under the old one.
 *
 * WHY NOT wp-content/uploads: it is served by URL with no access control, and
 * `robots.txt` is not a permission. Here the split is explicit — the preview is
 * reachable with the id (the customer has to see their own proof), and the
 * document and the source rasters are ADMIN-ONLY, because the only thing that
 * needs them is the workshop.
 *
 * WHY THE UPLOAD IS OPEN, like `POST /api/ar`: a customer cannot authenticate,
 * and they are the one making the design. What stops R2 becoming free file
 * hosting is the same thing that stops it there — magic bytes, per-file and
 * per-request size caps, a file count cap, and a document that has to parse as
 * the shape we expect before anything is written.
 */
import { requireAdmin, type AdminEnv } from './auth'
import { ASSET_ID_RE, MAX_ASSETS, readDesignDoc, type DesignDocSide } from '../src/lib/teeshoop/designDoc'

/*
 * WHAT A DESIGN DOCUMENT IS lives in src/lib/teeshoop/designDoc.ts, imported
 * here rather than restated. The studio decides which rasters to send and this
 * route decides which it will accept; the two sets must match exactly in both
 * directions, so there is one definition of "referenced" and both ends read it.
 * The module is pure by construction, which is what lets it be type-checked
 * under this tsconfig and the app's alike.
 */
export { readDesignDoc } from '../src/lib/teeshoop/designDoc'

export interface DesignEnv extends AdminEnv {
  AR_BUCKET: R2Bucket
  /** Stamped on every manifest — see the header. Set via `vars` in wrangler.jsonc. */
  APP_VERSION?: string
}

/**
 * 24 chars of a 62-char alphabet ≈ 143 bits. Inside the plugin's `[A-Za-z0-9_-]
 * {16,64}` (Design::valid_id), and unguessable, which is what lets the preview
 * be served on the id alone.
 */
const ID_LEN = 24
const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const ID_RE = /^[A-Za-z0-9_-]{16,64}$/

const MAX_FILE_BYTES = 12 * 1024 * 1024
const MAX_TOTAL_BYTES = 40 * 1024 * 1024
const MAX_DOC_BYTES = 2 * 1024 * 1024

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_SIG = [0xff, 0xd8, 0xff]

function shortId(): string {
  const bytes = new Uint8Array(ID_LEN)
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

const startsWith = (b: Uint8Array, sig: number[]): boolean => sig.every((v, i) => b[i] === v)

/** PNG or JPEG, decided by the bytes rather than by what the client called it. */
async function imageType(file: File): Promise<'png' | 'jpeg' | null> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer())
  if (startsWith(head, PNG_SIG)) return 'png'
  if (startsWith(head, JPEG_SIG)) return 'jpeg'
  return null
}

/** One printed side, as the price engine and the workshop both need it. */
export type DesignSide = DesignDocSide

export interface DesignManifest {
  id: string
  created: string
  app_version: string
  garment: string
  color: string
  sides: DesignSide[]
  assets: string[]
  preview: string
  /** Where the workshop finds the document. Admin-gated; see the header. */
  print_file: string
}

const key = (id: string, name: string) => `design/${id}/${name}`

/**
 * `POST /api/design` — multipart/form-data:
 *   design   the design document, JSON
 *   preview  a flattened mockup, PNG
 *   asset:<assetId>  every raster the document references, PNG or JPEG
 *
 * Every asset the document names must be present, and no asset may be sent that
 * the document does not name. Both directions matter: the first is the order
 * that cannot be printed, the second is R2 as a dead drop.
 */
export async function createDesign(request: Request, env: DesignEnv): Promise<Response> {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return json({ error: 'expected multipart/form-data' }, 400)
  }

  const docFile = form.get('design')
  const preview = form.get('preview')
  if (!(docFile instanceof File) || !(preview instanceof File))
    return json({ error: 'missing design/preview' }, 400)
  if (docFile.size > MAX_DOC_BYTES) return json({ error: 'design document too large' }, 413)
  if (preview.size > MAX_FILE_BYTES) return json({ error: 'preview too large' }, 413)
  if ((await imageType(preview)) !== 'png') return json({ error: 'preview is not a png' }, 415)

  const text = await docFile.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return json({ error: 'design is not json' }, 400)
  }
  const doc = readDesignDoc(parsed)
  if (!doc) return json({ error: 'not a design document' }, 422)

  // Collect the rasters, checking each against the document as we go.
  const assets: { id: string; file: File; type: 'png' | 'jpeg' }[] = []
  let total = docFile.size + preview.size
  for (const [name, value] of form.entries()) {
    if (!name.startsWith('asset:')) continue
    const id = name.slice(6)
    if (!ASSET_ID_RE.test(id)) return json({ error: `bad asset name ${name}` }, 400)
    if (!doc.assetIds.includes(id))
      return json({ error: `asset ${id} is not referenced by the design` }, 422)
    /*
     * The document's id list is capped at MAX_ASSETS, and until this check the
     * PARTS were not: `includes` passes for the same id over and over, so a
     * form carrying the same three-byte part 5000 times stayed inside the 40 MB
     * byte budget and produced 5003 R2 writes from one unauthenticated request.
     * Measured against this function with a stub bucket. On the real runtime
     * each put is a subrequest, so it also walks into the cap this project has
     * already been bitten by once, after the writes have been billed.
     */
    if (assets.some((a) => a.id === id)) return json({ error: `asset ${id} sent twice` }, 400)
    if (assets.length >= MAX_ASSETS) return json({ error: 'too many assets' }, 413)
    if (!(value instanceof File)) return json({ error: `asset ${id} is not a file` }, 400)
    if (value.size > MAX_FILE_BYTES) return json({ error: `asset ${id} too large` }, 413)
    const type = await imageType(value)
    if (!type) return json({ error: `asset ${id} is not a png or jpeg` }, 415)
    total += value.size
    if (total > MAX_TOTAL_BYTES) return json({ error: 'design too large' }, 413)
    assets.push({ id, file: value, type })
  }

  const missing = doc.assetIds.filter((id) => !assets.some((a) => a.id === id))
  if (missing.length > 0)
    return json({ error: `design references artwork that was not uploaded: ${missing.join(', ')}` }, 422)

  const id = shortId()
  const created = new Date().toISOString()
  const manifest: DesignManifest = {
    id,
    created,
    app_version: env.APP_VERSION ?? '',
    garment: doc.garment,
    color: doc.color,
    sides: doc.sides,
    assets: assets.map((a) => a.id),
    preview: `/r2/design/${id}/preview.png`,
    print_file: `/r2/design/${id}/design.json`,
  }

  try {
    await Promise.all([
      env.AR_BUCKET.put(key(id, 'design.json'), text, {
        httpMetadata: { contentType: 'application/json; charset=utf-8' },
        customMetadata: { created },
      }),
      preview.arrayBuffer().then((buf) =>
        env.AR_BUCKET.put(key(id, 'preview.png'), buf, {
          httpMetadata: { contentType: 'image/png' },
          customMetadata: { created },
        }),
      ),
      ...assets.map((a) =>
        a.file.arrayBuffer().then((buf) =>
          env.AR_BUCKET.put(key(id, `assets/${a.id}`), buf, {
            httpMetadata: { contentType: a.type === 'png' ? 'image/png' : 'image/jpeg' },
            customMetadata: { created },
          }),
        ),
      ),
    ])
    // The manifest is written LAST and on its own. It is what `GET
    // /api/design/{id}` answers from, so until it exists the design does not
    // exist — a half-written upload can never verify as complete and become a
    // paid order line the workshop cannot fill.
    await env.AR_BUCKET.put(key(id, 'manifest.json'), JSON.stringify(manifest), {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
      customMetadata: { created },
    })
  } catch {
    return json({ error: 'storage write failed' }, 502)
  }

  return json({ id, preview: manifest.preview, sides: manifest.sides })
}

/**
 * `GET /api/design/{id}` — what the WordPress plugin asks before it will put a
 * personalised line in a cart (`Design::verify`). 200 with the manifest means
 * the artwork is on the server; 404 means it is not, and the plugin refuses the
 * add-to-cart rather than taking money for an order nobody can print.
 *
 * Open on the id alone. The id carries ~143 bits of entropy and the body names
 * no customer and no order — and the plugin, which is the caller that matters,
 * is a server with no session to attach a token to.
 */
export async function getDesign(env: DesignEnv, id: string): Promise<Response> {
  if (!ID_RE.test(id)) return json({ error: 'not found' }, 404)
  const obj = await env.AR_BUCKET.get(key(id, 'manifest.json'))
  if (!obj) return json({ error: 'not found' }, 404)
  return new Response(obj.body, {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * `GET /r2/design/{id}/{path}` — the stored bytes.
 *
 * `preview.png` is reachable with the id: it is the customer's own proof, it is
 * what a BAT email and a cart thumbnail show, and neither can carry a token.
 * EVERYTHING ELSE IS ADMIN-ONLY — the design document and the source rasters are
 * the customer's original artwork, and the only thing that needs them is the
 * workshop.
 */
export async function serveDesignFile(
  request: Request,
  env: DesignEnv,
  id: string,
  path: string,
): Promise<Response> {
  if (!ID_RE.test(id)) return new Response('not found', { status: 404 })
  const isPreview = path === 'preview.png'
  const isDoc = path === 'design.json'
  const asset = /^assets\/([A-Za-z0-9_-]{1,64})$/.exec(path)
  if (!isPreview && !isDoc && !asset) return new Response('not found', { status: 404 })

  if (!isPreview) {
    const denied = await requireAdmin(request, env, 'api')
    if (denied) return denied
  }

  const obj = await env.AR_BUCKET.get(key(id, path))
  if (!obj) return new Response('not found', { status: 404 })
  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('etag', obj.httpEtag)
  headers.set('content-length', String(obj.size))
  // The bytes under one id never change — a re-uploaded design is a new id —
  // but the DOCUMENT and the rasters are private, so they must not be held by a
  // shared cache on the way back.
  headers.set('cache-control', isPreview ? 'public, max-age=31536000, immutable' : 'private, no-store')
  return new Response(obj.body, { status: 200, headers })
}
