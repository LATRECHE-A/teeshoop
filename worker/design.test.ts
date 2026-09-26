/**
 * The design hand-off, against a real R2 shape.
 *
 * The bucket is a Map here, not a mock of the routes: every case posts an actual
 * multipart body through `createDesign` and reads it back through `getDesign` and
 * `serveDesignFile`, so what is asserted is the behaviour a browser and the
 * WordPress plugin will see. What matters most is the pair of refusals (a design
 * whose artwork did not arrive, and an upload of artwork the design never
 * mentions), because the first is an order the workshop cannot fill and the
 * second is R2 as a dead drop.
 */
import { describe, expect, it } from 'vitest'
import {
  createDesign,
  deleteDesign,
  getDesign,
  readDesignDoc,
  reapDesigns,
  serveDesignFile,
  type DesignEnv,
} from './design'
import { ownerProof } from './auth'
import worker from './index'

/**
 * `crypto.subtle.timingSafeEqual` is a Workers runtime extension and is absent
 * from Node's WebCrypto. Supplying it is providing the platform, not stubbing
 * the auth: `worker/auth.ts` runs exactly as deployed, over the SHA-256 digests
 * it already computes to make the comparison length-independent.
 */
if (!('timingSafeEqual' in crypto.subtle)) {
  ;(crypto.subtle as unknown as Record<string, unknown>).timingSafeEqual = (
    a: Uint8Array,
    b: Uint8Array,
  ) => {
    if (a.byteLength !== b.byteLength) throw new TypeError('length mismatch')
    let diff = 0
    for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i]
    return diff === 0
  }
}

/** One object as the double holds it. `uploaded` is R2's own write date. */
interface Stored {
  body: Uint8Array
  type: string
  meta?: Record<string, string>
  uploaded: Date
}

/**
 * Enough of R2Bucket for these routes: put / get / head / list / delete over a
 * Map. `list` is the real contract and not a convenience: it sorts by key (R2
 * lists in key order, which is what lets the reap walk judge a design as a
 * whole), honours `startAfter`, and reports `truncated` against a page size the
 * test chooses, so the pagination in the shipped code is actually exercised
 * rather than assumed.
 */
function bucket(pageSize = 1000) {
  const store = new Map<string, Stored>()
  const calls = { list: 0, delete: 0 }
  const api = {
    async put(
      key: string,
      value: ArrayBuffer | string,
      opts?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
    ) {
      const body =
        typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value)
      store.set(key, {
        body,
        type: opts?.httpMetadata?.contentType ?? '',
        meta: opts?.customMetadata,
        uploaded: new Date(),
      })
      return { key }
    },
    async get(key: string) {
      const hit = store.get(key)
      if (!hit) return null
      return {
        body: new Blob([hit.body]).stream(),
        size: hit.body.byteLength,
        httpEtag: '"x"',
        writeHttpMetadata(h: Headers) {
          if (hit.type) h.set('content-type', hit.type)
        },
        text: async () => new TextDecoder().decode(hit.body),
      }
    },
    async head(key: string) {
      return store.has(key) ? { size: store.get(key)!.body.byteLength } : null
    },
    async list(options?: { prefix?: string; startAfter?: string }) {
      calls.list++
      const prefix = options?.prefix ?? ''
      const after = options?.startAfter
      const keys = [...store.keys()]
        .filter((k) => k.startsWith(prefix) && (after === undefined || k > after))
        .sort()
      const page = keys.slice(0, pageSize)
      const objects = page.map((k) => ({
        key: k,
        uploaded: store.get(k)!.uploaded,
        customMetadata: store.get(k)!.meta,
      }))
      return keys.length > pageSize
        ? { objects, delimitedPrefixes: [], truncated: true, cursor: 'next' }
        : { objects, delimitedPrefixes: [], truncated: false }
    },
    async delete(keys: string | string[]) {
      calls.delete++
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k)
    },
  }
  return { store, api, calls }
}

/*
 * These have to be WHOLE containers, not signatures. The route validates the
 * chunk arithmetic (worker/containers.ts) after a first-bytes check was
 * measured to accept a PNG signature glued to 300 kB of urandom, so the twelve
 * bytes that used to stand in here would now, correctly, be refused. Both are
 * genuine 1x1 images: a 70-byte PNG and a 160-byte baseline JPEG.
 */
const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const PNG = b64(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
)
const JPEG = b64(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
)
const GIF = new TextEncoder().encode('GIF89a-nope')
/* The measured attack, as a fixture: a valid signature with a payload behind it. */
const PNG_WITH_RIDER = new Uint8Array([...PNG, ...new Uint8Array(4096).fill(0x41)])

const DOC = {
  id: 'd1',
  garmentId: 'tee',
  colorId: 'black',
  layers: [
    { id: 'a', type: 'text', side: 'front', text: 'HELLO' },
    { id: 'b', type: 'image', side: 'front', assetId: 'up1' },
  ],
  sides: [{ id: 'front', area_sq_cm: 420.5 }],
}

type TestEnv = DesignEnv & {
  _store: Map<string, Stored>
  _calls: { list: number; delete: number }
}

function env(pageSize = 1000): TestEnv {
  const b = bucket(pageSize)
  return {
    AR_BUCKET: b.api as unknown as R2Bucket,
    APP_VERSION: 'test',
    ADMIN_TOKEN: 'a-token-long-enough-to-be-accepted-abcdefgh',
    _store: b.store,
    _calls: b.calls,
  }
}

function post(parts: Record<string, Blob | string>): Request {
  const form = new FormData()
  for (const [k, v] of Object.entries(parts))
    form.append(k, typeof v === 'string' ? new Blob([v]) : v, typeof v === 'string' ? k : k)
  return new Request('https://x/api/design', { method: 'POST', body: form })
}

const png = () => new Blob([PNG], { type: 'image/png' })
const doc = (o: unknown = DOC) => new Blob([JSON.stringify(o)], { type: 'application/json' })

describe('readDesignDoc: the gate on what may be stored', () => {
  it('accepts a design and reports the assets it references', () => {
    const r = readDesignDoc(DOC)!
    expect(r.garment).toBe('tee')
    expect(r.assetIds).toEqual(['up1'])
    expect(r.sides).toEqual([{ id: 'front', area_sq_cm: 420.5 }])
  })

  it('carries the transfer rectangles, which is what the film is costed from', () => {
    const r = readDesignDoc({
      ...DOC,
      sides: [{ id: 'front', area_sq_cm: 288, pieces: [{ w_cm: 18, h_cm: 14.5 }, { w_cm: 12, h_cm: 3.2 }] }],
    })!
    expect(r.sides[0].pieces).toEqual([{ w_cm: 18, h_cm: 14.5 }, { w_cm: 12, h_cm: 3.2 }])
  })

  it('drops rectangles too small to hold the ink they claim to carry', () => {
    /*
     * THE OPEN-ROUTE DEFENCE. This document arrives unauthenticated, and these
     * rectangles are what the shop's film cost and therefore its floor price
     * are computed from. Measured with the shipped packer: fifty garments with
     * a real 28,4 x 34,1 cm chest print nest to 14,5 m of roll and 273,83 EUR
     * of film; declared as 0,5 x 0,5 cm they nest to 0,1 m, bill the supplier
     * minimum, and cost 32,85 EUR. Every euro of that comes off the floor.
     *
     * The invariant is derived, not chosen: the priced area is a union of the
     * cluster boxes and the rectangles are those same boxes grown by the trim
     * bleed, so their areas always sum to at least it.
     */
    const r = readDesignDoc({
      ...DOC,
      sides: [{ id: 'front', area_sq_cm: 2000, pieces: [{ w_cm: 0.5, h_cm: 0.5 }] }],
    })!
    expect(r.sides[0].area_sq_cm).toBe(2000)
    expect(r.sides[0].pieces).toBeUndefined()
  })

  it('drops the whole list rather than the rectangles it could not read', () => {
    // Partly read means the film of the pieces that parsed and silence about
    // the rest: a cost that is too LOW, which is a floor that is too low.
    const r = readDesignDoc({
      ...DOC,
      sides: [{ id: 'front', area_sq_cm: 100, pieces: [{ w_cm: 18, h_cm: 14.5 }, { w_cm: 12, h_cm: 'big' }] }],
    })!
    expect(r.sides[0].pieces).toBeUndefined()
  })

  it('carries the placement a bon a tirer states and a press is set up from', () => {
    const r = readDesignDoc({
      ...DOC,
      sides: [
        {
          id: 'front',
          // 257,7 and not a round 250: an 18 x 14,5 cm transfer is an ink box of
          // (18 - 2 x 0,0508) x (14,5 - 2 x 0,0508), and a document that pairs this
          // rectangle with less ink than that is one readDesignDoc now refuses.
          area_sq_cm: 257.7,
          area_w_cm: 30.5,
          area_h_cm: 40.6,
          drop_cm: 22.4,
          pieces: [{ w_cm: 18, h_cm: 14.5, top_cm: 5.2, center_dx_cm: -1.5 }],
        },
      ],
    })!
    expect(r.sides[0].pieces).toEqual([{ w_cm: 18, h_cm: 14.5, top_cm: 5.2, center_dx_cm: -1.5 }])
    expect(r.sides[0].area_w_cm).toBe(30.5)
    expect(r.sides[0].area_h_cm).toBe(40.6)
    expect(r.sides[0].drop_cm).toBe(22.4)
  })

  it('drops a placement that does not fit the print area it declares', () => {
    // Nothing downstream would ever notice: a 30 cm drop inside a 40,6 cm area
    // whose transfer is 14,5 cm tall is a print running off the hem, and the
    // first thing that would catch it is a customer opening a parcel.
    const r = readDesignDoc({
      ...DOC,
      sides: [
        {
          id: 'front',
          // 257,7 and not a round 250: an 18 x 14,5 cm transfer is an ink box of
          // (18 - 2 x 0,0508) x (14,5 - 2 x 0,0508), and a document that pairs this
          // rectangle with less ink than that is one readDesignDoc now refuses.
          area_sq_cm: 257.7,
          area_w_cm: 30.5,
          area_h_cm: 40.6,
          pieces: [{ w_cm: 18, h_cm: 14.5, top_cm: 30, center_dx_cm: 0 }],
        },
      ],
    })!
    expect(r.sides[0].area_w_cm).toBeUndefined()
    expect(r.sides[0].pieces?.[0].top_cm).toBeUndefined()
  })

  it('drops the placement and KEEPS the film geometry, because they cost different things', () => {
    // The rectangles are the film and the floor price; the placement is the
    // proof. Losing the second must not silently lower the first.
    const r = readDesignDoc({
      ...DOC,
      sides: [
        {
          id: 'front',
          area_sq_cm: 288,
          area_w_cm: 30.5,
          area_h_cm: 40.6,
          pieces: [
            { w_cm: 18, h_cm: 14.5, top_cm: 5.2, center_dx_cm: 0 },
            { w_cm: 12, h_cm: 3.2, top_cm: 22, center_dx_cm: 90 },
          ],
        },
      ],
    })!
    expect(r.sides[0].pieces).toEqual([{ w_cm: 18, h_cm: 14.5 }, { w_cm: 12, h_cm: 3.2 }])
    expect(r.sides[0].area_w_cm).toBeUndefined()
  })

  it('keeps the rectangles of a document written before the placement existed', () => {
    // Every design already stored carries no placement. Requiring one would
    // have taken the film geometry off every one of them, which is a floor
    // price that silently drops on orders nobody touched.
    const r = readDesignDoc({
      ...DOC,
      sides: [{ id: 'front', area_sq_cm: 288, pieces: [{ w_cm: 18, h_cm: 14.5 }, { w_cm: 12, h_cm: 3.2 }] }],
    })!
    expect(r.sides[0].pieces).toHaveLength(2)
    expect(r.sides[0].area_w_cm).toBeUndefined()
  })

  it('refuses a drop below the collar no garment could have', () => {
    const r = readDesignDoc({
      ...DOC,
      sides: [
        {
          id: 'front',
          // 257,7 and not a round 250: an 18 x 14,5 cm transfer is an ink box of
          // (18 - 2 x 0,0508) x (14,5 - 2 x 0,0508), and a document that pairs this
          // rectangle with less ink than that is one readDesignDoc now refuses.
          area_sq_cm: 257.7,
          area_w_cm: 30.5,
          area_h_cm: 40.6,
          drop_cm: 4000,
          pieces: [{ w_cm: 18, h_cm: 14.5, top_cm: 5.2, center_dx_cm: 0 }],
        },
      ],
    })!
    expect(r.sides[0].drop_cm).toBeUndefined()
    // and the rest of the placement survives, because it is a separate fact
    expect(r.sides[0].area_h_cm).toBe(40.6)
  })

  it('refuses anything that is not a design document', () => {
    expect(readDesignDoc(null)).toBeNull()
    expect(readDesignDoc('a string')).toBeNull()
    expect(readDesignDoc({})).toBeNull()
    expect(readDesignDoc({ garmentId: 'tee' })).toBeNull() // no layers
    expect(readDesignDoc({ garmentId: '', layers: [] })).toBeNull()
    expect(readDesignDoc({ garmentId: 'tee', layers: [{ nope: 1 }] })).toBeNull()
  })

  it('refuses an asset id that would escape the key path', () => {
    const bad = { ...DOC, layers: [{ type: 'image', side: 'front', assetId: '../../etc/passwd' }] }
    expect(readDesignDoc(bad)).toBeNull()
  })

  it('drops a side with no area, and refuses a document left with none', () => {
    // Two rules in one case, because the second exists BECAUSE of the first.
    // A zero-area side is not a printed side and must not be stored as one; a
    // document with no printed side left is not an order, and until it was
    // refused it priced as an unprinted blank all the way to the invoice.
    // Measured on the shipped config: a tee run of 50 fell from 926,50 EUR to
    // 308,50 EUR HT, and a `custom` garment came to 0,00 EUR while the stored
    // document still carried the artwork the workshop would press.
    expect(readDesignDoc({ ...DOC, sides: [{ id: 'front', area_sq_cm: 0 }, { id: 'back' }] })).toBeNull()
    expect(readDesignDoc({ ...DOC, sides: [] })).toBeNull()
    const { sides, ...noSidesKey } = DOC
    expect(readDesignDoc(noSidesKey)).toBeNull()
    // …and one good side still survives beside a bad one.
    const r = readDesignDoc({ ...DOC, sides: [{ id: 'front', area_sq_cm: 0 }, { id: 'back', area_sq_cm: 12 }] })!
    expect(r.sides).toEqual([{ id: 'back', area_sq_cm: 12 }])
  })

  it('caps a side area at a square metre: past that it is a data error', () => {
    const r = readDesignDoc({ ...DOC, sides: [{ id: 'front', area_sq_cm: 9e9 }] })!
    expect(r.sides[0].area_sq_cm).toBe(10000)
  })
})

describe('POST /api/design', () => {
  it('refuses a document with nothing to print, before it can be priced as a blank', async () => {
    // The route-level half of the gate above. This is the shape that made a
    // `custom` order cost 0,00 EUR: a real document, real artwork, no `sides`.
    const { sides, ...noSides } = DOC
    const e = env()
    const res = await createDesign(post({ design: doc(noSides), preview: png(), 'asset:up1': png() }), e)
    expect(res.status).toBe(422)
    expect(e._store.size).toBe(0)
  })

  it('refuses the same asset sent many times, instead of writing it many times', async () => {
    /*
     * `doc.assetIds.includes(id)` passes for the SAME id repeatedly, and the
     * only other bound was on bytes, so 5000 three-byte parts named asset:up1
     * stayed inside the 40 MB budget and produced 5003 R2 writes from one
     * unauthenticated request. Each put is a subrequest on the real runtime.
     */
    const form = new FormData()
    form.append('design', doc(), 'design.json')
    form.append('preview', png(), 'preview.png')
    for (let i = 0; i < 50; i++) form.append('asset:up1', png(), 'up1')
    const e = env()
    const res = await createDesign(
      new Request('https://x/api/design', { method: 'POST', body: form }),
      e,
    )
    expect(res.status).toBe(400)
    expect(e._store.size).toBe(0)
  })

  it('stores the document, the preview and every referenced raster', async () => {
    const e = env()
    const res = await createDesign(post({ design: doc(), preview: png(), 'asset:up1': png() }), e)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; sides: unknown[] }
    expect(body.id).toMatch(/^[A-Za-z0-9]{24}$/)
    expect(body.sides).toEqual([{ id: 'front', area_sq_cm: 420.5 }])
    expect([...e._store.keys()].sort()).toEqual(
      [
        `design/${body.id}/assets/up1`,
        `design/${body.id}/design.json`,
        `design/${body.id}/manifest.json`,
        `design/${body.id}/preview.png`,
      ].sort(),
    )
  })

  /*
   * THE PROOF OF CREATION. The shop saves a design as a customer's model only
   * with it (`Modeles::preuve`), because a model relays the design's originals
   * back to that account. The vector is the one `tests/test-modeles.php`
   * checks on the PHP side: both ends must compute the same bytes.
   */
  it('hands the uploader a proof of creation the shop can recompute', async () => {
    expect(await ownerProof({ ADMIN_TOKEN: TOKEN }, 'modeletest00000001')).toBe(
      '78a7b7ae12e6d90896185650cd2bf1521e2456eb8850dc2acdea71e7e4190057',
    )
    const e = env()
    const body = (await (await createDesign(post({ design: doc(), preview: png(), 'asset:up1': png() }), e)).json()) as {
      id: string
      proof: string
    }
    expect(body.proof).toBe(await ownerProof(e, body.id))
    expect(body.proof).toMatch(/^[0-9a-f]{64}$/)
  })

  it('gives no proof without a token, so the shop saves nothing (fail closed)', async () => {
    expect(await ownerProof({}, 'modeletest00000001')).toBe('')
    expect(await ownerProof({ ADMIN_TOKEN: 'court' }, 'modeletest00000001')).toBe('')
    const e = env()
    delete e.ADMIN_TOKEN
    const res = await createDesign(post({ design: doc(), preview: png(), 'asset:up1': png() }), e)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { proof: string }).proof).toBe('')
  })

  it('REFUSES a design whose artwork was not uploaded', async () => {
    // The order that cannot be printed. It must fail here, not at the press.
    const res = await createDesign(post({ design: doc(), preview: png() }), env())
    expect(res.status).toBe(422)
    expect(await res.text()).toContain('up1')
  })

  it('REFUSES artwork the design never mentions', async () => {
    // Otherwise the open upload route is generic file hosting.
    const res = await createDesign(
      post({ design: doc(), preview: png(), 'asset:up1': png(), 'asset:stow': png() }),
      env(),
    )
    expect(res.status).toBe(422)
  })

  it('decides the file type from the bytes, not from what the client called it', async () => {
    const e = env()
    const gif = new Blob([GIF], { type: 'image/png' })
    expect((await createDesign(post({ design: doc(), preview: gif }), e)).status).toBe(415)
    expect(
      (await createDesign(post({ design: doc(), preview: png(), 'asset:up1': gif }), e)).status,
    ).toBe(415)
    // …and a JPEG upload is fine, which is most of what customers send.
    const jpeg = new Blob([JPEG])
    expect(
      (await createDesign(post({ design: doc(), preview: png(), 'asset:up1': jpeg }), e)).status,
    ).toBe(200)
  })

  /*
   * The measured hole this route had until 2026-08-27, at the route level and
   * not only in containers.test.ts. Against a real `wrangler dev` the request
   * below returned 200 and the 300 kB of urandom behind the signature came back
   * out of /r2/design/<id>/preview.png as image/png, immutable, for a year:
   * free permanent hosting for arbitrary bytes on the shop's own origin.
   */
  it('refuses a valid signature with a payload riding behind it', async () => {
    const e = env()
    const rider = () => new Blob([PNG_WITH_RIDER], { type: 'image/png' })
    expect((await createDesign(post({ design: doc(), preview: rider() }), e)).status).toBe(415)
    expect(
      (await createDesign(post({ design: doc(), preview: png(), 'asset:up1': rider() }), e)).status,
    ).toBe(415)
    expect(
      (await createDesign(post({ design: doc(), preview: png(), 'asset:up1': png(), 'preview:front': rider() }), e))
        .status,
    ).toBe(415)
    expect(e._store.size).toBe(0)
  })

  it('refuses a body that is not a design at all', async () => {
    const e = env()
    expect((await createDesign(post({ preview: png() }), e)).status).toBe(400)
    expect((await createDesign(post({ design: new Blob(['{oops']), preview: png() }), e)).status).toBe(400)
    expect((await createDesign(post({ design: doc({ a: 1 }), preview: png() }), e)).status).toBe(422)
    expect(e._store.size).toBe(0)
  })

  it('writes nothing at all when it refuses', async () => {
    const e = env()
    await createDesign(post({ design: doc(), preview: png() }), e)
    expect(e._store.size).toBe(0)
  })

  it('writes the manifest last, so a half-written design cannot verify', async () => {
    // `getDesign` answers from the manifest alone. Ordering it last is what makes
    // "verified" mean "complete" rather than "started".
    const e = env()
    const res = await createDesign(post({ design: doc(), preview: png(), 'asset:up1': png() }), e)
    const { id } = (await res.json()) as { id: string }
    const keys = [...e._store.keys()]
    expect(keys[keys.length - 1]).toBe(`design/${id}/manifest.json`)
  })
})

describe('GET /api/design/{id}: what the WordPress plugin verifies against', () => {
  it('answers 200 with the fields Design::verify reads', async () => {
    const e = env()
    const { id } = (await (
      await createDesign(post({ design: doc(), preview: png(), 'asset:up1': png() }), e)
    ).json()) as { id: string }

    const res = await getDesign(e, id)
    expect(res.status).toBe(200)
    const meta = (await res.json()) as Record<string, unknown>
    expect(meta.preview).toBe(`/r2/design/${id}/preview.png`)
    expect(meta.print_file).toBe(`/r2/design/${id}/design.json`)
    expect(meta.sides).toEqual([{ id: 'front', area_sq_cm: 420.5 }])
    expect(meta.app_version).toBe('test')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('404s an id that was never stored: the plugin then refuses the cart line', async () => {
    expect((await getDesign(env(), 'aaaaaaaaaaaaaaaaaaaaaaaa')).status).toBe(404)
  })

  it('404s a malformed id without touching storage', async () => {
    const e = env()
    for (const id of ['', 'short', '../../ar/x', 'a'.repeat(65)])
      expect((await getDesign(e, id)).status).toBe(404)
  })
})

describe('GET /r2/design/{id}/…: who may read what', () => {
  const admin = (token?: string) =>
    new Request('https://x/', token ? { headers: { authorization: `Bearer ${token}` } } : undefined)

  async function stored() {
    const e = env()
    const { id } = (await (
      await createDesign(post({ design: doc(), preview: png(), 'asset:up1': png() }), e)
    ).json()) as { id: string }
    return { e, id }
  }

  it('serves the preview on the id alone: a BAT email carries no token', async () => {
    const { e, id } = await stored()
    const res = await serveDesignFile(admin(), e, id, 'preview.png')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('immutable')
    // Held to the type we stored. No content-disposition: this is an <img> on
    // the cart page, and attachment would turn it into a download prompt.
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-disposition')).toBe(null)
  })

  it('refuses the design document and the source rasters without the admin token', async () => {
    const { e, id } = await stored()
    expect((await serveDesignFile(admin(), e, id, 'design.json')).status).toBe(401)
    expect((await serveDesignFile(admin(), e, id, 'assets/up1')).status).toBe(401)
    expect((await serveDesignFile(admin('wrong'), e, id, 'design.json')).status).toBe(401)
  })

  it('serves them to the workshop, and never lets a shared cache hold them', async () => {
    const { e, id } = await stored()
    const res = await serveDesignFile(admin(e.ADMIN_TOKEN), e, id, 'design.json')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
  })

  it('refuses a path that is not one of the three shapes it stores', async () => {
    const { e, id } = await stored()
    for (const p of ['manifest.json', '../ar/x.glb', 'assets/../design.json', 'assets/'])
      expect((await serveDesignFile(admin(e.ADMIN_TOKEN), e, id, p)).status).toBe(404)
  })
})

/* -------------------------------------------------------------------------- */

const TOKEN = 'a-token-long-enough-to-be-accepted-abcdefgh'

/** A request carrying (or deliberately not carrying) the admin bearer token. */
const asAdmin = (token?: string, method = 'DELETE') =>
  new Request('https://x/api/design/x', {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  })

/**
 * A reap call. `null` for the token means the header is absent, which is a
 * different case from a wrong one and must not be spelled `undefined`: a
 * default parameter would then quietly hand the test the real token.
 */
function reapPost(body: unknown, token: string | null = TOKEN, raw?: string): Request {
  return new Request('https://x/api/design/reap', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: raw ?? JSON.stringify(body),
  })
}

/**
 * Write a design straight into the bucket with a chosen `created` stamp.
 *
 * `createDesign` stamps the moment it runs, so retention cannot be tested
 * through it: the objects would always be seconds old. Putting them directly is
 * putting the platform in a known state, which is what the double is for.
 * Passing `created: null` writes objects with NO stamp, which is what anything
 * stored before the stamp existed looks like.
 */
async function seed(
  e: TestEnv,
  id: string,
  created: string | null,
  names: string[] = ['design.json', 'manifest.json', 'preview.png'],
) {
  for (const n of names) {
    await e.AR_BUCKET.put(
      `design/${id}/${n}`,
      'bytes',
      created === null ? undefined : { customMetadata: { created } },
    )
  }
}

const OLD = '2024-01-01T00:00:00.000Z'
const RECENT = '2026-08-20T00:00:00.000Z'
const CUTOFF = '2025-01-01T00:00:00.000Z'
/** 24 chars from the writer's alphabet, which is the shape `shortId` mints. */
const ID_A = 'AAAAAAAAAAAAAAAAAAAAAAAA'
const ID_B = 'BBBBBBBBBBBBBBBBBBBBBBBB'

describe('DELETE /api/design/{id}: the R2 half of an erasure request', () => {
  it('erases the document, the manifest, every preview and every asset', async () => {
    // Through the real upload route, so what is erased is what the shop stores.
    const e = env()
    const many = {
      ...DOC,
      layers: [
        { id: 'a', type: 'image', side: 'front', assetId: 'up1' },
        { id: 'b', type: 'image', side: 'front', assetId: 'up2' },
        { id: 'c', type: 'image', side: 'back', assetId: 'up3' },
      ],
      sides: [
        { id: 'front', area_sq_cm: 300 },
        { id: 'back', area_sq_cm: 200 },
      ],
    }
    const { id } = (await (
      await createDesign(
        post({
          design: doc(many),
          preview: png(),
          'asset:up1': png(),
          'asset:up2': png(),
          'asset:up3': png(),
          'preview:front': png(),
          'preview:back': png(),
        }),
        e,
      )
    ).json()) as { id: string }
    expect(e._store.size).toBe(8)

    const res = await deleteDesign(asAdmin(TOKEN), e, id)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; deleted: number; keys: string[] }
    expect(body).toMatchObject({ id, deleted: 8 })
    expect(body.keys.sort()).toEqual(
      [
        `design/${id}/assets/up1`,
        `design/${id}/assets/up2`,
        `design/${id}/assets/up3`,
        `design/${id}/design.json`,
        `design/${id}/manifest.json`,
        `design/${id}/preview-back.png`,
        `design/${id}/preview-front.png`,
        `design/${id}/preview.png`,
      ].sort(),
    )
    expect(e._store.size).toBe(0)
    // …and the plugin now refuses any cart line that names it.
    expect((await getDesign(e, id)).status).toBe(404)
  })

  it('erases a design whose objects run past one R2 list page', async () => {
    /*
     * R2 answers `list` with a page and a truncated flag, and an erasure that
     * reads only the first page leaves the rest of a customer's artwork in the
     * bucket while answering 200. Three objects per page over eight objects is
     * three pages.
     */
    const e = env(3)
    await seed(e, ID_A, OLD, [
      'design.json',
      'manifest.json',
      'preview.png',
      'preview-front.png',
      'assets/up1',
      'assets/up2',
      'assets/up3',
      'assets/up4',
    ])
    const res = await deleteDesign(asAdmin(TOKEN), e, ID_A)
    expect(res.status).toBe(200)
    expect((await res.json()) as { deleted: number }).toMatchObject({ deleted: 8 })
    expect(e._store.size).toBe(0)
    expect(e._calls.list).toBeGreaterThan(1)
  })

  it('answers 200 with deleted 0 for an id that is already gone', async () => {
    // An erasure request gets re-run: a retry, an operator who is not sure the
    // first one worked, a WordPress job replaying its queue. The second run
    // must not read as a failure, because the asked-for state is the state.
    const e = env()
    const first = await deleteDesign(asAdmin(TOKEN), e, ID_A)
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ id: ID_A, deleted: 0, keys: [] })

    await seed(e, ID_A, OLD)
    expect(((await (await deleteDesign(asAdmin(TOKEN), e, ID_A)).json()) as { deleted: number }).deleted).toBe(3)
    const again = await deleteDesign(asAdmin(TOKEN), e, ID_A)
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({ id: ID_A, deleted: 0, keys: [] })
  })

  it('refuses without the admin token, and touches no storage', async () => {
    const e = env()
    await seed(e, ID_A, OLD)
    for (const req of [asAdmin(), asAdmin('wrong')]) {
      const res = await deleteDesign(req, e, ID_A)
      expect(res.status).toBe(401)
    }
    expect(e._store.size).toBe(3)
    expect(e._calls.list).toBe(0)
    expect(e._calls.delete).toBe(0)
  })

  it('denies everything when ADMIN_TOKEN is unset, rather than opening up', async () => {
    // Fail closed: a Worker deployed before the secret is set must not be a
    // route that erases any design anyone can name.
    const e = env()
    await seed(e, ID_A, OLD)
    delete e.ADMIN_TOKEN
    expect((await deleteDesign(asAdmin(TOKEN), e, ID_A)).status).toBe(401)
    expect(e._store.size).toBe(3)
  })

  it('refuses a malformed id as a 400, before it lists anything', async () => {
    // The prefix is built from this string. It is refused rather than used.
    const e = env()
    for (const id of ['', 'short', '../ar', 'a/b', 'a'.repeat(65), `${ID_A}/../../ar`]) {
      const res = await deleteDesign(asAdmin(TOKEN), e, id)
      expect(res.status).toBe(400)
    }
    expect(e._calls.list).toBe(0)
    expect(e._calls.delete).toBe(0)
  })

  it('never touches a key outside design/', async () => {
    const e = env()
    await e.AR_BUCKET.put('ar/keepthis.glb', 'model')
    await seed(e, ID_A, OLD)
    await seed(e, ID_B, OLD)
    await deleteDesign(asAdmin(TOKEN), e, ID_A)
    expect([...e._store.keys()].sort()).toEqual([
      'ar/keepthis.glb',
      `design/${ID_B}/design.json`,
      `design/${ID_B}/manifest.json`,
      `design/${ID_B}/preview.png`,
    ])
  })

  it('deletes NOTHING when the listing hands back a key outside the prefix', async () => {
    /*
     * A bucket answering with a key it was not asked for cannot happen from
     * correct code, which is exactly why the guard refuses the whole call
     * instead of quietly dropping the odd key: half an erasure plus somebody
     * else's AR model deleted is the worst of both.
     */
    const e = env()
    await e.AR_BUCKET.put('ar/keepthis.glb', 'model')
    await seed(e, ID_A, OLD)
    const real = e.AR_BUCKET.list.bind(e.AR_BUCKET)
    e.AR_BUCKET = {
      ...e.AR_BUCKET,
      list: async (o?: R2ListOptions) => {
        const page = await real(o)
        return { ...page, objects: [...page.objects, { key: 'ar/keepthis.glb' } as R2Object] }
      },
      delete: e.AR_BUCKET.delete.bind(e.AR_BUCKET),
    } as R2Bucket
    const res = await deleteDesign(asAdmin(TOKEN), e, ID_A)
    expect(res.status).toBe(500)
    expect(e._store.has('ar/keepthis.glb')).toBe(true)
    expect(e._store.size).toBe(4)
  })

  it('reports a partial erasure as a failure, never as a 200', async () => {
    // The one thing a delete route must not do is stop half way and say done.
    const e = env()
    await seed(e, ID_A, OLD)
    e.AR_BUCKET = { ...e.AR_BUCKET, delete: async () => { throw new Error('R2 down') } } as R2Bucket
    const res = await deleteDesign(asAdmin(TOKEN), e, ID_A)
    expect(res.status).toBe(502)
    expect((await res.json()) as { deleted: number }).toMatchObject({ deleted: 0 })
  })
})

describe('POST /api/design/reap: retention', () => {
  it('names what it would delete and deletes nothing, under dryRun', async () => {
    const e = env()
    await seed(e, ID_A, OLD)
    await seed(e, ID_B, RECENT)
    const res = await reapDesigns(reapPost({ before: CUTOFF, keep: [], dryRun: true }), e)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      candidates: 1,
      deleted: 0,
      ids: [ID_A],
      dryRun: true,
      truncated: false,
      cursor: null,
    })
    expect(e._store.size).toBe(6)
    expect(e._calls.delete).toBe(0)
  })

  it('REFUSES a call with no keep list: absent is not empty', async () => {
    /*
     * `keep` is the shop's list of the ids it still holds against an order or a
     * devis. Absent means the caller never computed it, and running on that
     * deletes the artwork of live orders. Empty is a different statement ("I
     * hold none") and is honoured.
     */
    const e = env()
    await seed(e, ID_A, OLD)
    for (const body of [
      { before: CUTOFF, dryRun: false },
      { before: CUTOFF, keep: null, dryRun: false },
      { before: CUTOFF, keep: 'AAAA', dryRun: false },
      { before: CUTOFF, keep: [ID_A, 7], dryRun: false },
    ]) {
      const res = await reapDesigns(reapPost(body), e)
      expect(res.status).toBe(400)
    }
    expect(e._store.size).toBe(3)
    expect(e._calls.delete).toBe(0)

    // …and the empty list really does mean "hold none", so it deletes.
    const ok = await reapDesigns(reapPost({ before: CUTOFF, keep: [], dryRun: false }), e)
    expect(ok.status).toBe(200)
    expect(e._store.size).toBe(0)
  })

  it('keeps an id the shop still holds, however old it is', async () => {
    const e = env()
    await seed(e, ID_A, OLD)
    await seed(e, ID_B, OLD)
    const res = await reapDesigns(
      reapPost({ before: CUTOFF, keep: [ID_A], dryRun: false }),
      e,
    )
    expect(await res.json()).toMatchObject({ candidates: 1, deleted: 1, ids: [ID_B] })
    expect([...e._store.keys()].every((k) => k.startsWith(`design/${ID_A}/`))).toBe(true)
    expect(e._store.size).toBe(3)
  })

  it('judges a design as a whole: one object newer than the cut-off keeps it', async () => {
    // A design is one unit. An old document beside a raster re-uploaded last
    // week is a design still in use, and half of it is unprintable.
    const e = env()
    await seed(e, ID_A, OLD, ['design.json', 'manifest.json'])
    await e.AR_BUCKET.put(`design/${ID_A}/preview.png`, 'x', { customMetadata: { created: RECENT } })
    const res = await reapDesigns(reapPost({ before: CUTOFF, keep: [], dryRun: false }), e)
    expect(await res.json()).toMatchObject({ candidates: 0, deleted: 0 })
    expect(e._store.size).toBe(3)
  })

  it('judges a design straddling a page boundary on all of its objects', async () => {
    /*
     * The walk streams, so a design whose objects span two pages is judged in
     * pieces unless the code holds the group open across the boundary. Two
     * objects per page and the NEWEST one last: reading only the first page
     * would delete a design still in use.
     */
    const e = env(2)
    await seed(e, ID_A, OLD, ['a-one', 'b-two'])
    await e.AR_BUCKET.put(`design/${ID_A}/c-three`, 'x', { customMetadata: { created: RECENT } })
    const res = await reapDesigns(reapPost({ before: CUTOFF, keep: [], dryRun: false }), e)
    expect(await res.json()).toMatchObject({ candidates: 0, deleted: 0 })
    expect(e._store.size).toBe(3)
    expect(e._calls.list).toBeGreaterThan(1)
  })

  it('uses the R2 upload date when there is no created stamp', async () => {
    // Everything written before the stamp existed has only R2's own date.
    const e = env()
    await seed(e, ID_A, null)
    for (const k of e._store.keys()) e._store.get(k)!.uploaded = new Date(OLD)
    await seed(e, ID_B, null) // uploaded just now

    const res = await reapDesigns(reapPost({ before: CUTOFF, keep: [], dryRun: false }), e)
    expect(await res.json()).toMatchObject({ candidates: 1, ids: [ID_A], deleted: 1 })
    expect([...e._store.keys()].every((k) => k.startsWith(`design/${ID_B}/`))).toBe(true)
  })

  it('will not reap a design whose age it cannot read', async () => {
    // "Could not look" is not "old". A stamp we cannot parse keeps the artwork.
    const e = env()
    await seed(e, ID_A, 'sometime last year')
    const res = await reapDesigns(reapPost({ before: CUTOFF, keep: [], dryRun: false }), e)
    expect(await res.json()).toMatchObject({ candidates: 0, deleted: 0 })
    expect(e._store.size).toBe(3)
  })

  it('never touches a key outside design/', async () => {
    const e = env()
    await e.AR_BUCKET.put('ar/keepthis.glb', 'model')
    e._store.get('ar/keepthis.glb')!.uploaded = new Date(OLD)
    await e.AR_BUCKET.put('design/not-a-design-key', 'x', { customMetadata: { created: OLD } })
    await seed(e, ID_A, OLD)
    const res = await reapDesigns(reapPost({ before: CUTOFF, keep: [], dryRun: false }), e)
    expect(await res.json()).toMatchObject({ candidates: 1, ids: [ID_A], deleted: 1 })
    expect([...e._store.keys()].sort()).toEqual(['ar/keepthis.glb', 'design/not-a-design-key'])
  })

  it('refuses without the admin token, and touches no storage', async () => {
    const e = env()
    await seed(e, ID_A, OLD)
    for (const token of [null, 'wrong']) {
      const res = await reapDesigns(reapPost({ before: CUTOFF, keep: [], dryRun: false }, token), e)
      expect(res.status).toBe(401)
    }
    expect(e._store.size).toBe(3)
    expect(e._calls.list).toBe(0)
  })

  it('refuses a cut-off in the future, which is not a retention rule', async () => {
    // "Delete everything not in keep" is the shape a mis-computed cut-off takes.
    const e = env()
    await seed(e, ID_A, OLD)
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    expect((await reapDesigns(reapPost({ before: soon, keep: [], dryRun: false }), e)).status).toBe(400)
    expect(e._store.size).toBe(3)
  })

  it('refuses a body it cannot read, before it looks at the bucket', async () => {
    const e = env()
    await seed(e, ID_A, OLD)
    const bad: [unknown, string | undefined][] = [
      [null, '{not json'],
      [[1, 2], undefined],
      [{ keep: [], dryRun: false }, undefined],
      [{ before: 'la semaine derniere', keep: [], dryRun: false }, undefined],
      [{ before: CUTOFF, keep: [] }, undefined],
      [{ before: CUTOFF, keep: [], dryRun: 'yes' }, undefined],
      [{ before: CUTOFF, keep: [], dryRun: false, cursor: 'ar/' }, undefined],
    ]
    for (const [body, raw] of bad) {
      const res = await reapDesigns(reapPost(body, TOKEN, raw), e)
      expect(res.status).toBe(400)
    }
    expect(e._calls.list).toBe(0)
    expect(e._store.size).toBe(3)
  })

  it('answers an empty bucket with nothing to do, not with an error', async () => {
    // The empty state. A retention job runs on a schedule and will meet this
    // most nights; it must read as "nothing to do", not as a failure to chase.
    const e = env()
    const res = await reapDesigns(reapPost({ before: CUTOFF, keep: [], dryRun: false }), e)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      candidates: 0,
      deleted: 0,
      ids: [],
      dryRun: false,
      truncated: false,
      cursor: null,
    })
    expect(e._calls.delete).toBe(0)
  })

  it('caps one call at 500 designs and says where to resume', async () => {
    /*
     * The cap is the blast radius, and a job that silently stops half way and
     * reports success is the failure mode here. 501 designs: the first call
     * takes 500 and says it is not finished, the second finishes from the
     * cursor it handed back.
     */
    const e = env()
    for (let i = 0; i <= 500; i++) await seed(e, `dddddddddd${String(i).padStart(6, '0')}`, OLD)
    expect(e._store.size).toBe(501 * 3)

    const first = (await (
      await reapDesigns(reapPost({ before: CUTOFF, keep: [], dryRun: true }), e)
    ).json()) as { candidates: number; ids: string[]; truncated: boolean; cursor: string }
    expect(first.candidates).toBe(500)
    expect(first.truncated).toBe(true)
    expect(first.cursor).toBe('design/dddddddddd000499/preview.png')

    const second = (await (
      await reapDesigns(
        reapPost({ before: CUTOFF, keep: [], dryRun: true, cursor: first.cursor }),
        e,
      )
    ).json()) as { candidates: number; ids: string[]; truncated: boolean; cursor: null }
    expect(second.candidates).toBe(1)
    expect(second.ids).toEqual(['dddddddddd000500'])
    expect(second.truncated).toBe(false)
    expect(second.cursor).toBeNull()
  })

  it('counts only the designs actually gone when a delete fails', async () => {
    const e = env()
    await seed(e, ID_A, OLD)
    await seed(e, ID_B, OLD)
    e.AR_BUCKET = { ...e.AR_BUCKET, delete: async () => { throw new Error('R2 down') } } as R2Bucket
    const res = await reapDesigns(reapPost({ before: CUTOFF, keep: [], dryRun: false }), e)
    expect(res.status).toBe(502)
    expect((await res.json()) as { deleted: number; ids: string[] }).toMatchObject({
      candidates: 2,
      deleted: 0,
      ids: [],
    })
    expect(e._store.size).toBe(6)
  })
})

/**
 * The ROUTE TABLE, through the Worker's own `fetch`.
 *
 * The suites above call the handlers directly, which proves what they do and
 * nothing about whether a request ever reaches them. Two of the ways this could
 * be wrong are invisible from a handler test: `/api/design/reap` also matches
 * the `/api/design/{id}` pattern, and the id segment is percent-decoded before
 * anyone looks at it.
 */
describe('the design routes, through worker.fetch', () => {
  const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext

  function routed() {
    const e = env() as TestEnv & { ASSETS: Fetcher }
    e.ASSETS = { fetch: async () => new Response('static asset', { status: 200 }) } as unknown as Fetcher
    return e
  }

  const call = (e: TestEnv & { ASSETS: Fetcher }, path: string, init?: RequestInit) =>
    worker.fetch(new Request(`https://x${path}`, init), e as never, ctx)

  const auth = { authorization: `Bearer ${TOKEN}` }

  it('routes DELETE /api/design/{id} to the erasure, admin-gated', async () => {
    const e = routed()
    await seed(e, ID_A, OLD)
    expect((await call(e, `/api/design/${ID_A}`, { method: 'DELETE' })).status).toBe(401)
    expect(e._store.size).toBe(3)

    const res = await call(e, `/api/design/${ID_A}`, { method: 'DELETE', headers: auth })
    expect(res.status).toBe(200)
    expect((await res.json()) as { deleted: number }).toMatchObject({ id: ID_A, deleted: 3 })
    expect(e._store.size).toBe(0)
  })

  it('routes POST /api/design/reap to the reap, not to an id called reap', async () => {
    const e = routed()
    await seed(e, ID_A, OLD)
    const res = await call(e, '/api/design/reap', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ before: CUTOFF, keep: [], dryRun: true }),
    })
    expect(res.status).toBe(200)
    expect((await res.json()) as { ids: string[] }).toMatchObject({ candidates: 1, ids: [ID_A] })
  })

  it('refuses DELETE /api/design/reap as a malformed id rather than acting on it', async () => {
    const e = routed()
    const res = await call(e, '/api/design/reap', { method: 'DELETE', headers: auth })
    expect(res.status).toBe(400)
  })

  it('404s a percent-escape it cannot decode, instead of throwing a 500', async () => {
    // `decodeURIComponent('%zz')` throws, and an uncaught throw in the fetch
    // handler is a 500 on input anyone can send.
    const e = routed()
    expect((await call(e, '/api/design/%zz')).status).toBe(404)
    expect((await call(e, '/api/design/%zz', { method: 'DELETE', headers: auth })).status).toBe(404)
    expect((await call(e, '/r2/design/x/%zz')).status).toBe(404)
  })

  it('still answers the manifest and the preview it always did', async () => {
    const e = routed()
    const { id } = (await (
      await createDesign(post({ design: doc(), preview: png(), 'asset:up1': png() }), e)
    ).json()) as { id: string }
    expect((await call(e, `/api/design/${id}`)).status).toBe(200)
    expect((await call(e, `/r2/design/${id}/preview.png`)).status).toBe(200)
    expect((await call(e, `/r2/design/${id}/design.json`)).status).toBe(401)
    // A method the design routes do not handle still falls through to assets.
    expect(await (await call(e, `/api/design/${id}`, { method: 'PUT' })).text()).toBe('static asset')
  })
})

describe('the destructive routes and the browser credential', () => {
  /** What a browser attaches by itself after someone answers the /admin box. */
  const basic = (token: string) => `Basic ${btoa(`admin:${token}`)}`

  const req = (method: string, header: string) =>
    new Request('https://x/api/design/reap', { method, headers: { authorization: header } })

  it('refuses the Basic encoding, which is what a cross-site form POST gets for free', async () => {
    /*
     * HTTP Basic has no SameSite. Once an operator has answered the /admin
     * login box, a page they merely visit can submit a cross-site form POST
     * that the browser decorates with those credentials, and a reap deletes up
     * to 500 designs. A form cannot set a header, so the Bearer form cannot be
     * reached that way.
     */
    const e = env()
    await seed(e, ID_A, OLD)

    expect((await deleteDesign(req('DELETE', basic(TOKEN)), e, ID_A)).status).toBe(401)
    expect(
      (
        await reapDesigns(
          new Request('https://x/api/design/reap', {
            method: 'POST',
            headers: { authorization: basic(TOKEN), 'content-type': 'application/json' },
            body: JSON.stringify({ before: CUTOFF, keep: [], dryRun: false }),
          }),
          e,
        )
      ).status,
    ).toBe(401)
    expect(e._store.size).toBe(3)
    expect(e._calls.delete).toBe(0)
  })

  it('still lets the workshop read a design document with Basic, which is unchanged', async () => {
    // The read gate is the one a browser has to be able to satisfy. Narrowing
    // the delete routes must not have narrowed that too.
    const e = env()
    const { id } = (await (
      await createDesign(post({ design: doc(), preview: png(), 'asset:up1': png() }), e)
    ).json()) as { id: string }
    const res = await serveDesignFile(
      new Request('https://x/', { headers: { authorization: basic(TOKEN) } }),
      e,
      id,
      'design.json',
    )
    expect(res.status).toBe(200)
  })
})

describe('a design is a contiguous run of keys, whatever the id contains', () => {
  it('does not let one id absorb another that sorts next to it', async () => {
    /*
     * `Design::valid_id` admits `-` and `_`, and `-` (0x2D) sorts BEFORE the
     * `/` (0x2F) that separates the id from the file name. So `design/AAA-B/x`
     * lists before `design/AAA/x`, and a walk that assumed the shorter id comes
     * first would judge one design on another design's objects. Contiguity per
     * prefix is what the walk actually relies on, and this is the case that
     * would break a length or alphabetical assumption instead.
     */
    const short = 'AAAAAAAAAAAAAAAA'
    const long = 'AAAAAAAAAAAAAAAA-BB'
    const e = env()
    await seed(e, short, OLD)
    await seed(e, long, RECENT)
    const res = await reapDesigns(reapPost({ before: CUTOFF, keep: [], dryRun: false }), e)
    expect(await res.json()).toMatchObject({ candidates: 1, ids: [short], deleted: 1 })
    expect([...e._store.keys()].every((k) => k.startsWith(`design/${long}/`))).toBe(true)
    expect(e._store.size).toBe(3)
  })
})
