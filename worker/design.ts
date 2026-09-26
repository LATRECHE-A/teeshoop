/**
 * The design hand-off: the first server-side object in this project.
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
 * the rasters it references, never the nested gang sheets. Two reasons, and
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
 * `robots.txt` is not a permission. Here the split is explicit: the preview is
 * reachable with the id (the customer has to see their own proof), and the
 * document and the source rasters are ADMIN-ONLY, because the only thing that
 * needs them is the workshop.
 *
 * WHY THE UPLOAD IS OPEN, like `POST /api/ar`: a customer cannot authenticate,
 * and they are the one making the design. What stops R2 becoming free file
 * hosting is the same thing that stops it there: full container validation
 * (`containers.ts`, not a first-bytes test, which was measured to accept a PNG
 * signature glued to 300 kB of urandom), per-file and per-request size caps, a
 * file count cap, and a document that has to parse as the shape we expect
 * before anything is written.
 */
import { ownerProof, requireAdmin, type AdminEnv } from './auth'
import { imageContainer } from './containers'
import {
  ASSET_ID_RE,
  MAX_ASSETS,
  MAX_SIDES,
  SIDE_ID_RE,
  readDesignDoc,
  type DesignDocSide,
} from '../src/lib/teeshoop/designDoc'

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
  /** Stamped on every manifest (see the header). Set via `vars` in wrangler.jsonc. */
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

/**
 * The `design/` half of the bucket. `ar/` shares the bucket under its own prefix
 * and its own 30-day lifecycle rule, so no key outside this string may ever be
 * passed to `delete`; `deleteKeys` is the single place that enforces it.
 */
const DESIGN_PREFIX = 'design/'

const MAX_FILE_BYTES = 12 * 1024 * 1024
const MAX_TOTAL_BYTES = 40 * 1024 * 1024
const MAX_DOC_BYTES = 2 * 1024 * 1024


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

/**
 * PNG or JPEG, decided by the WHOLE container rather than by its first bytes.
 *
 * This used to read eight bytes and believe them. Measured against a real
 * `wrangler dev`: the PNG signature followed by 300 000 bytes of urandom was
 * stored and served straight back as image/png, immutable, for a year. The
 * signature was never the check; the check is that the chunk arithmetic closes
 * exactly on the end of the file, which is what `containers.ts` does.
 *
 * The answer is still what the caller stores as the content-type, so a file
 * that does not validate has no type and is refused rather than stored under a
 * guess.
 */
async function imageType(file: File): Promise<'png' | 'jpeg' | null> {
  return imageContainer(new Uint8Array(await file.arrayBuffer()))
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
  /**
   * One flattened mockup per PRINTED side, by side id.
   *
   * `preview` above is the cart thumbnail and stays what it always was: the
   * first side that carries ink. These exist because of the bon a tirer. A
   * proof is the document that decides who pays for a reprint, and one showing
   * only the front of a garment printed front and back decides nothing about
   * the back. Reachable on the id alone, exactly like `preview`, for the same
   * reason: the customer has to be able to see their own proof and an e-mail
   * cannot carry a token.
   */
  previews: Record<string, string>
  /** Where the workshop finds the document. Admin-gated; see the header. */
  print_file: string
}

const key = (id: string, name: string) => `${DESIGN_PREFIX}${id}/${name}`

/**
 * `POST /api/design`, multipart/form-data:
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

  /*
   * The per-side mockups. Bounded the same way everything else on this open
   * route is: a known side id, PNG by its bytes, the same per-file cap, and at
   * most one per side the document actually declares. A form naming a side the
   * design does not print is refused rather than stored, because R2 as a dead
   * drop is exactly what the asset check above exists to stop.
   */
  const previews: { side: string; file: File }[] = []
  for (const [name, value] of form.entries()) {
    if (!name.startsWith('preview:')) continue
    const side = name.slice(8)
    if (!SIDE_ID_RE.test(side)) return json({ error: `bad preview name ${name}` }, 400)
    if (!doc.sides.some((s) => s.id === side))
      return json({ error: `preview ${side} is not a printed side` }, 422)
    if (previews.some((p) => p.side === side)) return json({ error: `preview ${side} sent twice` }, 400)
    if (previews.length >= MAX_SIDES) return json({ error: 'too many previews' }, 413)
    if (!(value instanceof File)) return json({ error: `preview ${side} is not a file` }, 400)
    if (value.size > MAX_FILE_BYTES) return json({ error: `preview ${side} too large` }, 413)
    if ((await imageType(value)) !== 'png') return json({ error: `preview ${side} is not a png` }, 415)
    total += value.size
    if (total > MAX_TOTAL_BYTES) return json({ error: 'design too large' }, 413)
    previews.push({ side, file: value })
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
    previews: Object.fromEntries(
      previews.map((p) => [p.side, `/r2/design/${id}/preview-${p.side}.png`]),
    ),
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
      ...previews.map((p) =>
        p.file.arrayBuffer().then((buf) =>
          env.AR_BUCKET.put(key(id, `preview-${p.side}.png`), buf, {
            httpMetadata: { contentType: 'image/png' },
            customMetadata: { created },
          }),
        ),
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
    // exist: a half-written upload can never verify as complete and become a
    // paid order line the workshop cannot fill.
    await env.AR_BUCKET.put(key(id, 'manifest.json'), JSON.stringify(manifest), {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
      customMetadata: { created },
    })
  } catch {
    return json({ error: 'storage write failed' }, 502)
  }

  // `proof` goes to the uploader and nowhere else: it is what lets the shop
  // save this design as THEIR model. See `ownerProof`.
  return json({
    id,
    preview: manifest.preview,
    previews: manifest.previews,
    sides: manifest.sides,
    proof: await ownerProof(env, id),
  })
}

/**
 * `GET /api/design/{id}`, what the WordPress plugin asks before it will put a
 * personalised line in a cart (`Design::verify`). 200 with the manifest means
 * the artwork is on the server; 404 means it is not, and the plugin refuses the
 * add-to-cart rather than taking money for an order nobody can print.
 *
 * Open on the id alone. The id carries ~143 bits of entropy and the body names
 * no customer and no order, and the plugin, which is the caller that matters,
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
 * `GET /r2/design/{id}/{path}`: the stored bytes.
 *
 * `preview.png` is reachable with the id: it is the customer's own proof, it is
 * what a BAT email and a cart thumbnail show, and neither can carry a token.
 * EVERYTHING ELSE IS ADMIN-ONLY: the design document and the source rasters are
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
  // `preview.png` and `preview-<side>.png`. Both are the customer's own proof
  // and both are readable on the id alone; the side ids come from the studio's
  // own union and the pattern is the document gate's, not a looser one.
  const isPreview = path === 'preview.png' || /^preview-[a-z_]{1,16}\.png$/.test(path)
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
  // The bytes under one id never change (a re-uploaded design is a new id),
  // but the DOCUMENT and the rasters are private, so they must not be held by a
  // shared cache on the way back.
  headers.set('cache-control', isPreview ? 'public, max-age=31536000, immutable' : 'private, no-store')
  /*
   * These bytes are customer-supplied and this origin also serves the studio,
   * so the browser must never be allowed to talk itself into a different type
   * than the one we stored. `nosniff` is the whole defence; there is
   * deliberately NO `content-disposition: attachment` to go with it, because
   * `preview.png` is an <img> on the WooCommerce cart page and in the bon a
   * tirer email, and attachment would turn both into a download prompt.
   */
  headers.set('x-content-type-options', 'nosniff')
  return new Response(obj.body, { status: 200, headers })
}

/*
 * ---------------------------------------------------------------------------
 * ERASURE AND REAPING
 *
 * WHY THIS EXISTS. Two things were true until now: there was no `.delete()`
 * anywhere in this Worker, and the bucket's only lifecycle rule expires the
 * `ar/` prefix after 30 days. So every design ever uploaded was kept forever,
 * with no way to remove one. Both halves are problems, and they are different
 * problems:
 *
 *   An RGPD erasure request (article 17) has to reach the artwork. A customer's
 *   uploaded raster IS personal data: it is theirs, it can be a photograph of
 *   them, and deleting their WooCommerce order while the file stays in R2 is
 *   not erasure. `DELETE /api/design/{id}` is what the shop calls for that.
 *
 *   Most designs never become an order. Add-to-cart writes one, and a cart that
 *   is abandoned leaves it behind with nothing pointing at it. Keeping those
 *   forever is both a storage bill and a retention-limitation breach (article
 *   5(1)(e)): personal data kept longer than the purpose needs it. A blanket
 *   lifecycle rule on `design/` cannot do this job, because it cannot tell an
 *   orphan from the artwork of a two-year-old order the shop still owes a
 *   reprint on. Only the shop knows that, so `POST /api/design/reap` takes the
 *   list of ids it still holds and deletes the rest.
 *
 * BOTH ARE ADMIN-ONLY, through the same gate as everything else here
 * (worker/auth.ts, `ADMIN_TOKEN`, unset means deny all). A delete route that
 * could be reached with the id alone would turn the capability URL that lets a
 * customer see their own proof into a capability to destroy the order.
 *
 * WHAT IS ENUMERATED IS THE BUCKET, NOT THE MANIFEST. The manifest lists the
 * assets it knew about when it was written, and the whole point of an erasure
 * is that it must work on a design whose manifest is already gone, was never
 * finished (the manifest is written last, on purpose), or lists a raster whose
 * name changed. `list()` over `design/{id}/` is the only account of what is
 * actually stored.
 */

/**
 * The destructive routes take the Bearer encoding of `ADMIN_TOKEN` and nothing
 * else. This is a CSRF gate, not a second authentication.
 *
 * worker/auth.ts deliberately accepts a SECOND encoding, `Basic
 * base64(anything:token)`, because a bearer challenge shows no login box and
 * `/admin.html` is a plain browser navigation. The side effect that module
 * documents as useful is the problem here: once an operator has answered that
 * prompt, the browser attaches those credentials to this origin by itself, and
 * HTTP Basic has no SameSite. So a page the operator merely visits can submit a
 * cross-site form POST to `/api/design/reap` (a form body can be shaped into
 * valid JSON with `enctype="text/plain"`), the browser decorates that top-level
 * navigation with the admin credentials, and 500 customers' artwork is gone.
 *
 * A form cannot set a header, and a cross-origin `fetch` that sets
 * `Authorization` is preflighted, which this Worker answers with no CORS
 * headers at all. Requiring the Bearer form is therefore what makes these two
 * routes unreachable from another site. The caller that matters is the
 * WordPress server and it sends Bearer; a browser tool that wants them has to
 * send the token explicitly rather than lean on the ambient credential, which
 * for an irreversible delete is the right amount of friction.
 */
async function requireBearerAdmin(request: Request, env: DesignEnv): Promise<Response | null> {
  const denied = await requireAdmin(request, env, 'api')
  if (denied) return denied
  if (!/^Bearer\s/i.test(request.headers.get('authorization') ?? '')) {
    return json(
      {
        error: 'admin_auth',
        message: 'This route takes the Authorization: Bearer form of the admin token.',
      },
      401,
    )
  }
  return null
}

/** R2 accepts at most 1000 keys in one `delete` call. */
const DELETE_BATCH = 1000

/*
 * WORK CAPS, AND WHERE THE NUMBERS COME FROM.
 *
 * This Worker is on the Cloudflare FREE plan, which allows 50 subrequests per
 * invocation, and an R2 binding call is a subrequest. That ceiling has already
 * taken this project down in production once (see the budget section in
 * worker/falkross.ts), and it aborts the invocation rather than returning an
 * error you can act on, which for a delete route means stopping in the middle
 * of an erasure. So the work one call may do is reserved before it is started:
 *
 *   4000 keys      at most 4  `delete` calls  (4000 / DELETE_BATCH)
 *   40 list pages  at most 40 `list`   calls
 *   6 spare                             = 50
 *
 * 4000 keys is comfortably more than 500 designs: a design is 3 objects (the
 * document, the cart preview, the manifest) plus one per referenced raster and
 * one per printed side, so 5 to 8 in practice and 43 at the document gate's
 * maximum (MAX_ASSETS 32, MAX_SIDES 8).
 *
 * 40 pages is the same 4000 objects, because ASKING FOR METADATA SHRINKS THE
 * PAGE. Measured against a real workerd R2 (miniflare) over 1500 objects: a
 * plain `list` returns 1000 per page, and `list` with
 * `include: ['customMetadata']` returns 100, even when `limit: 1000` is passed
 * explicitly. The reap needs the `created` stamp, so it pays the 100. Also
 * measured there, because it decided which of the two pagination mechanisms
 * this uses: walking with `startAfter` costs the same as walking with the
 * opaque `cursor` (322 ms against 362 ms for the same 15 pages), and
 * `startAfter` is the one that can name an id boundary.
 *
 * Hitting a cap is NOT an error and must never be reported as a completed job.
 * Reap answers with `truncated: true` and the cursor to resume from, which is
 * the same shape `/api/fr/styles` already uses for the same reason.
 */
const MAX_KEYS_PER_CALL = 4000
const MAX_LIST_PAGES = 40

/**
 * Designs one reap call may take. The cap is the blast radius: an operator can
 * read what a dry run proposes, and a wrong `keep` list costs 500 designs and
 * not the whole bucket.
 */
const MAX_REAP_IDS = 500

/**
 * How far ahead of our clock a `before` cut-off may sit. WordPress and the
 * Worker are two different hosts, so a cut-off of "now" computed in the shop
 * can land slightly ahead of now here. Anything further ahead is not a
 * retention cut-off, it is "delete everything not in keep", and that is exactly
 * the shape a mis-computed cut-off takes: an off-by-one on a month, a
 * timezone read as UTC, a clock that never synced.
 */
const CLOCK_SKEW_MS = 5 * 60 * 1000

/**
 * The design id a key belongs to, or null when the key is not `design/{id}/…`
 * with an id of the shape this Worker writes.
 *
 * Null is deliberately unreapable. A key we cannot attribute to a design is
 * left alone rather than guessed at, which is the same "no" versus "could not
 * look" rule the rest of this module follows.
 */
function designIdOf(key: string): string | null {
  if (!key.startsWith(DESIGN_PREFIX)) return null
  const rest = key.slice(DESIGN_PREFIX.length)
  const slash = rest.indexOf('/')
  if (slash <= 0) return null
  const id = rest.slice(0, slash)
  return ID_RE.test(id) ? id : null
}

/**
 * When an object was written, in epoch milliseconds, or null when that cannot
 * be read.
 *
 * `created` is the stamp every put in this module writes; `uploaded` is R2's
 * own record and covers anything written before the stamp existed. A stamp that
 * is present but unreadable returns null rather than falling back, because a
 * design whose provenance we cannot read is one to keep: null is never old, so
 * it is never reaped.
 */
function objectTime(o: { customMetadata?: Record<string, string>; uploaded: Date }): number | null {
  const stamped = o.customMetadata?.created
  if (typeof stamped === 'string' && stamped !== '') {
    const t = Date.parse(stamped)
    return Number.isNaN(t) ? null : t
  }
  const t = o.uploaded instanceof Date ? o.uploaded.getTime() : Number.NaN
  return Number.isNaN(t) ? null : t
}

/**
 * The only call to `R2Bucket.delete` in this Worker.
 *
 * Every key is checked against `prefix` BEFORE the first batch goes out, so a
 * list that answered with something outside `design/` deletes nothing at all
 * rather than half an erasure plus somebody's AR model. That case cannot arise
 * from correct code, which is why it throws instead of being filtered: silently
 * dropping the odd key would hide the bug that produced it.
 *
 * A batch that fails stops the run and reports how many keys are confirmed
 * gone. Keys are deleted in the order given, so a caller that grouped them by
 * design can tell exactly which designs are erased and which are not.
 */
async function deleteKeys(
  bucket: R2Bucket,
  keys: string[],
  prefix: string,
): Promise<{ deleted: number; failed: boolean }> {
  for (const k of keys) {
    if (!k.startsWith(prefix)) throw new Error('key outside the prefix')
  }
  let deleted = 0
  for (let i = 0; i < keys.length; i += DELETE_BATCH) {
    const batch = keys.slice(i, i + DELETE_BATCH)
    try {
      await bucket.delete(batch)
    } catch {
      return { deleted, failed: true }
    }
    deleted += batch.length
  }
  return { deleted, failed: false }
}

/**
 * Every key under `prefix`, following R2's pagination.
 *
 * `startAfter` rather than `cursor`: one mechanism reads the same whether it is
 * continuing a page inside this call or resuming a reap in the next one, and it
 * is a key we can reason about instead of an opaque token.
 *
 * `complete` false means a cap stopped the walk, so the answer is a prefix of
 * what is there and must not be reported as the whole of it.
 */
async function listPrefix(
  bucket: R2Bucket,
  prefix: string,
): Promise<{ keys: string[]; complete: boolean }> {
  const keys: string[] = []
  let after: string | undefined
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const res = await bucket.list({ prefix, startAfter: after })
    for (const o of res.objects) keys.push(o.key)
    // An empty page cannot advance `after`, so stop here rather than loop.
    if (res.objects.length === 0) return { keys, complete: !res.truncated }
    if (!res.truncated) return { keys, complete: true }
    after = res.objects[res.objects.length - 1].key
    if (keys.length >= MAX_KEYS_PER_CALL) return { keys, complete: false }
  }
  return { keys, complete: false }
}

/**
 * `DELETE /api/design/{id}`, the R2 half of an RGPD erasure request. Removes
 * the document, the manifest, every preview and every asset stored under the
 * id, whatever the manifest says or fails to say.
 *
 * IDEMPOTENT BY DESIGN. An id that is already gone answers 200 with
 * `deleted: 0`. An erasure request gets re-run: by a retry, by an operator who
 * is not sure the first one worked, by a WordPress job replaying its queue.
 * Answering 404 the second time would turn a completed erasure into an alarm,
 * and the state the caller asked for ("nothing of this id is in R2") is exactly
 * the state it is in.
 *
 * Answers `{ id, deleted, keys }`, the keys being what was actually removed, so
 * the shop can record what it erased. A run that could not finish answers 502
 * with the partial count instead of a 200 that reads as done.
 *
 * WHAT THIS DOES NOT REACH, and the erasure record must say so: the CDN. A
 * preview is served `public, max-age=31536000, immutable` because a bon a tirer
 * e-mail and a cart thumbnail load it repeatedly, so a copy can sit in
 * Cloudflare's edge cache after the R2 object is gone. Emptying that needs a
 * zone purge through the Cloudflare API, which is a credential this Worker does
 * not hold. What limits the exposure meanwhile is that the URL is the only way
 * in and it carries about 143 bits: nobody who was not sent it can construct
 * it. See the note in the session report.
 */
export async function deleteDesign(request: Request, env: DesignEnv, id: string): Promise<Response> {
  const denied = await requireBearerAdmin(request, env)
  if (denied) return denied

  /*
   * 400 rather than a listing built from whatever arrived. ID_RE is the one
   * definition of a design id in this module (`getDesign` and `serveDesignFile`
   * read the same one, and it is the plugin's `Design::valid_id` shape); it
   * admits no `/` and no `.`, so no prefix built from an id that passes it can
   * name anything outside `design/{id}/`.
   */
  if (!ID_RE.test(id)) return json({ error: 'not a design id' }, 400)

  const prefix = `${DESIGN_PREFIX}${id}/`
  let listed: { keys: string[]; complete: boolean }
  try {
    listed = await listPrefix(env.AR_BUCKET, prefix)
  } catch {
    return json({ error: 'storage list failed', id, deleted: 0 }, 502)
  }
  if (listed.keys.length === 0 && listed.complete) return json({ id, deleted: 0, keys: [] })

  let res: { deleted: number; failed: boolean }
  try {
    res = await deleteKeys(env.AR_BUCKET, listed.keys, prefix)
  } catch {
    return json({ error: 'refused a key outside the design prefix', id, deleted: 0 }, 500)
  }
  if (res.failed || !listed.complete) {
    return json(
      { error: 'erasure did not finish, run it again', id, deleted: res.deleted, keys: listed.keys.slice(0, res.deleted) },
      502,
    )
  }
  return json({ id, deleted: res.deleted, keys: listed.keys })
}

/** One design's objects, as the reap walk accumulates them. */
interface ReapGroup {
  id: string
  keys: string[]
  /** Every object seen so far is older than the cut-off. */
  old: boolean
}

/**
 * `POST /api/design/reap`, retention. Body:
 *
 *   { "before": "2026-02-01T00:00:00Z", "keep": ["<id>", …], "dryRun": true }
 *
 * Deletes every design whose objects are ALL older than `before` and whose id
 * is not in `keep`. All, not any: a design is one unit, and an old document
 * beside a raster re-uploaded last week is a design still in use.
 *
 * `keep` IS REQUIRED AND ABSENT IS NOT EMPTY. It is the shop's list of the ids
 * it still holds against an order or a devis, so an absent one is a caller that
 * did not compute it, and acting on that would delete live orders' artwork. An
 * explicitly empty list is a different statement ("I hold none") and is
 * honoured. `dryRun` is required for the same reason: on a bulk delete, a
 * missing field must not be read as consent.
 *
 * `before` must be in the past. A cut-off ahead of now is not a retention rule,
 * it is "delete everything not in keep", and it is the shape a mis-computed
 * cut-off takes. It is also what protects the design being written right now:
 * every object carries a `created` stamp of its upload time, so an upload in
 * flight during a reap is never old enough to be swept, and the manifest being
 * written last cannot orphan the assets that preceded it.
 *
 * `keep` IS A SNAPSHOT, and the cut-off is what covers the gap. Between the
 * shop listing the ids it holds and this walk reading the bucket, a customer
 * can add to cart and create a design that is in neither. It survives because
 * every object carries the `created` stamp of its own upload and is therefore
 * newer than any cut-off worth the name. That protection is only as wide as the
 * gap between `before` and now, so the shop must choose a `before` older than a
 * cart can hold a design (WooCommerce sessions run 48 hours by default) rather
 * than "a moment ago", and must compute `keep` after choosing it.
 *
 * Answers `{ candidates, deleted, ids, dryRun, truncated, cursor }`. `truncated`
 * true means a cap stopped the walk before the end of the prefix and `cursor`
 * is where to resume; the caller loops until it is false. Under `dryRun` the
 * same call repeats rather than advancing unless the cursor is passed back,
 * which is what the cursor is for: a dry run is a preview of the next real
 * call.
 */
export async function reapDesigns(request: Request, env: DesignEnv): Promise<Response> {
  const denied = await requireBearerAdmin(request, env)
  if (denied) return denied

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'body is not json' }, 400)
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    return json({ error: 'body is not an object' }, 400)
  const b = body as Record<string, unknown>

  if (typeof b.before !== 'string') return json({ error: 'before is required, ISO 8601' }, 400)
  const beforeMs = Date.parse(b.before)
  if (Number.isNaN(beforeMs)) return json({ error: 'before is not a date' }, 400)
  if (beforeMs > Date.now() + CLOCK_SKEW_MS)
    return json({ error: 'before is in the future, which is not a retention cut-off' }, 400)

  if (!Array.isArray(b.keep))
    return json({ error: 'keep is required: send [] to state that you hold none' }, 400)
  /*
   * No cap on how many ids `keep` may carry, on purpose. A truncated keep list
   * is indistinguishable from a shorter one, and acting on it deletes the
   * artwork of the orders that fell off the end. The route is admin-only and
   * the platform bounds the request body; a keep list that is too big to send
   * is a refusal we can see, which a silent trim is not.
   */
  const keep = new Set<string>()
  for (const k of b.keep) {
    if (typeof k !== 'string') return json({ error: 'keep must be a list of design ids' }, 400)
    keep.add(k)
  }

  if (typeof b.dryRun !== 'boolean') return json({ error: 'dryRun is required, true or false' }, 400)
  const dryRun = b.dryRun

  let after: string | undefined
  if (b.cursor !== undefined && b.cursor !== null) {
    if (typeof b.cursor !== 'string' || !b.cursor.startsWith(DESIGN_PREFIX))
      return json({ error: 'cursor is not one this route issued' }, 400)
    after = b.cursor
  }
  const startedAt = after

  /*
   * THE WALK. R2 lists in key order, and every key of one design shares the
   * prefix `design/{id}/`, so a design's objects are contiguous: any key
   * sorting between two keys of the same prefix has that prefix too. That is
   * what lets this judge a design as a whole while streaming, and it is why
   * `resume` only ever advances past a design whose LAST object has been seen.
   * Stopping in the middle of one and resuming after it would judge the tail on
   * its own and delete a design whose newest object was on the previous page.
   */
  const ready: ReapGroup[] = []
  let current: ReapGroup | null = null
  let keyCount = 0
  let truncated = false
  let resume = after

  const finish = () => {
    if (!current) return
    if (current.old && !keep.has(current.id)) ready.push(current)
    resume = current.keys[current.keys.length - 1]
    current = null
  }

  try {
    let pages = 0
    for (;;) {
      if (pages >= MAX_LIST_PAGES) {
        truncated = true
        break
      }
      const res = await env.AR_BUCKET.list({
        prefix: DESIGN_PREFIX,
        startAfter: after,
        include: ['customMetadata'],
      })
      pages++
      let capped = false
      for (const o of res.objects) {
        const id = designIdOf(o.key)
        if (id === null) continue
        if (current && current.id !== id) finish()
        if (!current) {
          if (ready.length >= MAX_REAP_IDS || keyCount >= MAX_KEYS_PER_CALL) {
            capped = true
            break
          }
          current = { id, keys: [], old: true }
        }
        current.keys.push(o.key)
        keyCount++
        const t = objectTime(o)
        if (t === null || t >= beforeMs) current.old = false
      }
      if (capped) {
        truncated = true
        break
      }
      if (!res.truncated) {
        finish()
        break
      }
      // A truncated page with nothing on it cannot advance `after`; stop rather
      // than spin.
      if (res.objects.length === 0) {
        truncated = true
        break
      }
      after = res.objects[res.objects.length - 1].key
      if (ready.length >= MAX_REAP_IDS || keyCount >= MAX_KEYS_PER_CALL) {
        truncated = true
        break
      }
    }
  } catch {
    return json({ error: 'storage list failed' }, 502)
  }

  /*
   * A truncated walk that finished no design would hand back the cursor it was
   * given, and a caller looping on it would loop forever. It takes a single id
   * holding more objects than a whole call may read, which the document gate
   * makes impossible, so say so loudly instead of answering with a job that
   * cannot progress.
   */
  if (truncated && resume === startedAt)
    return json({ error: 'reap made no progress, look at the design/ prefix' }, 500)

  const ids = ready.map((g) => g.id)
  if (dryRun || ready.length === 0) {
    return json({
      candidates: ids.length,
      deleted: 0,
      ids,
      dryRun,
      truncated,
      cursor: truncated ? (resume ?? null) : null,
    })
  }

  let out: { deleted: number; failed: boolean }
  try {
    out = await deleteKeys(env.AR_BUCKET, ready.flatMap((g) => g.keys), DESIGN_PREFIX)
  } catch {
    return json({ error: 'refused a key outside the design prefix' }, 500)
  }

  // Keys go out grouped by design and in order, so the designs actually erased
  // are the ones entirely inside the keys confirmed gone. Counting the rest
  // would be the "stopped half way and said done" failure this route exists to
  // avoid.
  let covered = 0
  let deleted = 0
  for (const g of ready) {
    if (covered + g.keys.length > out.deleted) break
    covered += g.keys.length
    deleted++
  }

  if (out.failed) {
    // Resume from the last design that IS gone, so the ones that are not are
    // seen again by the next call.
    const back = deleted > 0 ? ready[deleted - 1].keys[ready[deleted - 1].keys.length - 1] : startedAt
    return json(
      {
        error: 'reap did not finish, run it again',
        candidates: ids.length,
        deleted,
        ids: ids.slice(0, deleted),
        dryRun,
        truncated: true,
        cursor: back ?? null,
      },
      502,
    )
  }

  return json({
    candidates: ids.length,
    deleted,
    ids,
    dryRun,
    truncated,
    cursor: truncated ? (resume ?? null) : null,
  })
}
