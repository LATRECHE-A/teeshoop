/**
 * The design hand-off, against a real R2 shape.
 *
 * The bucket is a Map here, not a mock of the routes: every case posts an actual
 * multipart body through `createDesign` and reads it back through `getDesign` and
 * `serveDesignFile`, so what is asserted is the behaviour a browser and the
 * WordPress plugin will see. What matters most is the pair of refusals — a design
 * whose artwork did not arrive, and an upload of artwork the design never
 * mentions — because the first is an order the workshop cannot fill and the
 * second is R2 as a dead drop.
 */
import { describe, expect, it } from 'vitest'
import { createDesign, getDesign, readDesignDoc, serveDesignFile, type DesignEnv } from './design'

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

/** Enough of R2Bucket for these routes: put / get / head over a Map. */
function bucket() {
  const store = new Map<string, { body: Uint8Array; type: string }>()
  const api = {
    async put(key: string, value: ArrayBuffer | string, opts?: { httpMetadata?: { contentType?: string } }) {
      const body =
        typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value)
      store.set(key, { body, type: opts?.httpMetadata?.contentType ?? '' })
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
  }
  return { store, api }
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])
const GIF = new TextEncoder().encode('GIF89a-nope')

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

function env(): DesignEnv & { _store: Map<string, unknown> } {
  const b = bucket()
  return {
    AR_BUCKET: b.api as unknown as R2Bucket,
    APP_VERSION: 'test',
    ADMIN_TOKEN: 'a-token-long-enough-to-be-accepted-abcdefgh',
    _store: b.store as unknown as Map<string, unknown>,
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

describe('readDesignDoc — the gate on what may be stored', () => {
  it('accepts a design and reports the assets it references', () => {
    const r = readDesignDoc(DOC)!
    expect(r.garment).toBe('tee')
    expect(r.assetIds).toEqual(['up1'])
    expect(r.sides).toEqual([{ id: 'front', area_sq_cm: 420.5 }])
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

  it('drops a side with no area rather than storing a zero-priced print', () => {
    const r = readDesignDoc({ ...DOC, sides: [{ id: 'front', area_sq_cm: 0 }, { id: 'back' }] })!
    expect(r.sides).toEqual([])
  })

  it('caps a side area at a square metre — past that it is a data error', () => {
    const r = readDesignDoc({ ...DOC, sides: [{ id: 'front', area_sq_cm: 9e9 }] })!
    expect(r.sides[0].area_sq_cm).toBe(10000)
  })
})

describe('POST /api/design', () => {
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

describe('GET /api/design/{id} — what the WordPress plugin verifies against', () => {
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

  it('404s an id that was never stored — the plugin then refuses the cart line', async () => {
    expect((await getDesign(env(), 'aaaaaaaaaaaaaaaaaaaaaaaa')).status).toBe(404)
  })

  it('404s a malformed id without touching storage', async () => {
    const e = env()
    for (const id of ['', 'short', '../../ar/x', 'a'.repeat(65)])
      expect((await getDesign(e, id)).status).toBe(404)
  })
})

describe('GET /r2/design/{id}/… — who may read what', () => {
  const admin = (token?: string) =>
    new Request('https://x/', token ? { headers: { authorization: `Bearer ${token}` } } : undefined)

  async function stored() {
    const e = env()
    const { id } = (await (
      await createDesign(post({ design: doc(), preview: png(), 'asset:up1': png() }), e)
    ).json()) as { id: string }
    return { e, id }
  }

  it('serves the preview on the id alone — a BAT email carries no token', async () => {
    const { e, id } = await stored()
    const res = await serveDesignFile(admin(), e, id, 'preview.png')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('immutable')
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
