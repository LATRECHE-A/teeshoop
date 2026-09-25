/**
 * The container validators, against REAL files first.
 *
 * The negatives below are the point of the module, but they are not the risky
 * half. An over-strict validator refuses a paying customer's upload and does it
 * silently, so the assertions that matter most are the ones that open the 135
 * genuine PNGs the repository already carries (Playwright captures, every one
 * written by a different code path than ours) and the supplier JPEGs, and
 * require every single one to be accepted.
 *
 * The GLB and the USDZ have no genuine sample committed (they are generated in
 * the browser at export time), so the positives for those are built here byte
 * by byte rather than checked in as binaries.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { imageContainer, isGlb, isJpeg, isPng, isUsdz } from './containers'
import worker from './index'

const repo = fileURLToPath(new URL('..', import.meta.url))

function walk(dir: string, ext: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p, ext))
    else if (e.name.endsWith(ext)) out.push(p)
  }
  return out.sort()
}

const read = (p: string) => new Uint8Array(readFileSync(p))

describe('real files are accepted', () => {
  const pngs = walk(join(repo, 'docs/screens'), '.png')
  const jpegs = walk(join(repo, 'public/catalog/imbretex/img'), '.jpg')

  it('finds the sample corpus (a check that scans nothing must fail)', () => {
    expect(pngs.length).toBeGreaterThanOrEqual(100)
    expect(jpegs.length).toBeGreaterThanOrEqual(20)
  })

  it('accepts every committed PNG screenshot', () => {
    const refused = pngs.filter((p) => !isPng(read(p)))
    expect(refused).toEqual([])
  })

  /*
   * Measured while writing this: 6 of the 88 files the supplier ships under a
   * .jpg extension are PNGs (89 50 4E 47). The extension lies, which is the
   * whole reason the type is decided by the container and not by the name, so
   * the assertion is that every one of them is accepted AS WHAT IT IS.
   */
  it('accepts every committed supplier image, as the format its bytes say', () => {
    const refused = jpegs.filter((p) => imageContainer(read(p)) === null)
    expect(refused).toEqual([])
    const kinds = jpegs.map((p) => imageContainer(read(p)))
    expect(kinds.filter((k) => k === 'jpeg').length).toBe(82)
    expect(kinds.filter((k) => k === 'png').length).toBe(6)
  })

  it('names the format from the bytes, and never both', () => {
    for (const p of pngs.slice(0, 8)) {
      expect(imageContainer(read(p))).toBe('png')
      expect(isJpeg(read(p))).toBe(false)
    }
    for (const p of jpegs.filter((f) => isJpeg(read(f))).slice(0, 8)) {
      expect(imageContainer(read(p))).toBe('jpeg')
      expect(isPng(read(p))).toBe(false)
    }
  })
})

/* ------------------------------------------------------------------ GLB */

function u32le(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]
}

function glb(json: string, opts: { declaredLength?: number } = {}): Uint8Array {
  const body = new TextEncoder().encode(json)
  const pad = (4 - (body.length % 4)) % 4
  const chunk = new Uint8Array(body.length + pad).fill(0x20)
  chunk.set(body)
  const total = 12 + 8 + chunk.length
  return new Uint8Array([
    0x67, 0x6c, 0x54, 0x46, // 'glTF'
    ...u32le(2),
    ...u32le(opts.declaredLength ?? total),
    ...u32le(chunk.length),
    0x4a, 0x53, 0x4f, 0x4e, // 'JSON'
    ...chunk,
  ])
}

/* ----------------------------------------------------------------- USDZ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(b: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of b) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** A one-entry zip, built by hand so the test never depends on a zip library. */
function zip(name: string, data: Uint8Array, method: 0 | 8, comment = ''): Uint8Array {
  const nameBytes = new TextEncoder().encode(name)
  const stored = method === 8 ? new Uint8Array(deflateRawSync(data)) : data
  const crc = crc32(data)
  const local = [
    0x50, 0x4b, 0x03, 0x04,
    20, 0, 0, 0,
    method & 0xff, (method >>> 8) & 0xff,
    0, 0, 0, 0,
    ...u32le(crc),
    ...u32le(stored.length),
    ...u32le(data.length),
    nameBytes.length & 0xff, (nameBytes.length >>> 8) & 0xff,
    0, 0,
    ...nameBytes,
    ...stored,
  ]
  const central = [
    0x50, 0x4b, 0x01, 0x02,
    20, 0, 20, 0,
    0, 0,
    method & 0xff, (method >>> 8) & 0xff,
    0, 0, 0, 0,
    ...u32le(crc),
    ...u32le(stored.length),
    ...u32le(data.length),
    nameBytes.length & 0xff, (nameBytes.length >>> 8) & 0xff,
    0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0,
    ...u32le(0),
    ...nameBytes,
  ]
  const commentBytes = new TextEncoder().encode(comment)
  const eocd = [
    0x50, 0x4b, 0x05, 0x06,
    0, 0, 0, 0,
    1, 0, 1, 0,
    ...u32le(central.length),
    ...u32le(local.length),
    commentBytes.length & 0xff, (commentBytes.length >>> 8) & 0xff,
    ...commentBytes,
  ]
  return new Uint8Array([...local, ...central, ...eocd])
}

const usdc = new TextEncoder().encode('PXR-USDC-not-really-but-the-walk-does-not-decode-it')

/**
 * The one format with no genuine sample committed, checked against the code
 * that will actually produce it. `src/lib/arExport.ts` exports the USDZ with
 * three's USDZExporter, which is `fflate.zipSync(files, { level: 0 })` over a
 * `model.usda` plus its textures. Running that exact call here is what proves
 * the validator will not start refusing every customer's AR upload: if a three
 * upgrade ever switched that to a deflating level, this test goes red instead
 * of the AR route quietly answering 415 in production.
 *
 * The import has no type declarations and does not need any: nothing in
 * worker/ is typechecked through a test file (worker/tsconfig.json lists its
 * sources explicitly, the app's includes only src).
 */
import { strToU8, zipSync } from 'three/examples/jsm/libs/fflate.module.js'

describe('the real exporter output', () => {
  it('accepts what three USDZExporter actually writes', () => {
    const out = zipSync(
      {
        'model.usda': strToU8('#usda 1.0\n(\n    defaultPrim = "Root"\n)\n'),
        'textures/0.png': new Uint8Array(1024),
      },
      { level: 0 },
    )
    expect(isUsdz(new Uint8Array(out))).toBe(true)
  })
})

describe('synthetic positives', () => {
  it('accepts a minimal GLB whose JSON chunk declares an asset', () => {
    expect(isGlb(glb('{"asset":{"version":"2.0"}}'))).toBe(true)
  })

  it('accepts a minimal USDZ: one stored entry named scene.usdc', () => {
    expect(isUsdz(zip('scene.usdc', usdc, 0))).toBe(true)
  })

  it('accepts a stored .usda as well, and is not case-fussy about it', () => {
    expect(isUsdz(zip('model.usda', usdc, 0))).toBe(true)
    expect(isUsdz(zip('MODEL.USDA', usdc, 0))).toBe(true)
  })
})

/* ------------------------------------------------------------ negatives */

const PNG_SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n)
  for (let i = 0; i < n; i++) b[i] = (i * 2654435761) & 0xff
  return b
}

describe('negatives, one per attack', () => {
  const realPng = read(walk(join(repo, 'docs/screens'), '.png')[0])
  const realJpeg = read(
    walk(join(repo, 'public/catalog/imbretex/img'), '.jpg').find((p) => isJpeg(read(p)))!,
  )

  it('refuses the PNG signature followed by arbitrary bytes', () => {
    const evil = new Uint8Array([...PNG_SIG, ...randomBytes(300_000)])
    expect(isPng(evil)).toBe(false)
    expect(imageContainer(evil)).toBe(null)
  })

  it('refuses a real PNG with bytes appended after IEND', () => {
    expect(isPng(realPng)).toBe(true)
    const ridealong = new Uint8Array([...realPng, ...randomBytes(4096)])
    expect(isPng(ridealong)).toBe(false)
  })

  it('refuses a truncated PNG', () => {
    expect(isPng(realPng.subarray(0, realPng.length - 1))).toBe(false)
    expect(isPng(realPng.subarray(0, 2048))).toBe(false)
  })

  it('refuses glTF magic followed by arbitrary bytes', () => {
    const evil = new Uint8Array([0x67, 0x6c, 0x54, 0x46, ...randomBytes(50_000)])
    expect(isGlb(evil)).toBe(false)
  })

  it('refuses a GLB whose length field disagrees with the file size', () => {
    const good = glb('{"asset":{"version":"2.0"}}')
    expect(isGlb(good)).toBe(true)
    const lying = glb('{"asset":{"version":"2.0"}}', { declaredLength: good.length + 64 })
    expect(isGlb(lying)).toBe(false)
    const padded = new Uint8Array([...good, ...randomBytes(64)])
    expect(isGlb(padded)).toBe(false)
  })

  it('refuses a GLB whose first chunk is not JSON with an asset', () => {
    expect(isGlb(glb('{"scenes":[]}'))).toBe(false)
    expect(isGlb(glb('{"asset":"2.0"}'))).toBe(false)
    expect(isGlb(glb('not json at all'))).toBe(false)
  })

  it('refuses a plain zip of a text file offered as a USDZ', () => {
    expect(isUsdz(zip('payload.txt', new TextEncoder().encode('payload\n'), 0))).toBe(false)
  })

  it('refuses a deflated zip even when the entry is named scene.usdc', () => {
    const deflated = zip('scene.usdc', usdc, 8)
    expect(isUsdz(deflated)).toBe(false)
  })

  it('refuses a zip whose comment is long enough to hide a second EOCD', () => {
    expect(isUsdz(zip('scene.usdc', usdc, 0, 'x'.repeat(21)))).toBe(true)
    expect(isUsdz(zip('scene.usdc', usdc, 0, 'x'.repeat(22)))).toBe(false)
  })

  it('refuses a USDZ with bytes appended after the EOCD', () => {
    const good = zip('scene.usdc', usdc, 0)
    expect(isUsdz(new Uint8Array([...good, ...randomBytes(64)]))).toBe(false)
  })

  it('refuses a JPEG missing its EOI', () => {
    expect(isJpeg(realJpeg)).toBe(true)
    expect(isJpeg(realJpeg.subarray(0, realJpeg.length - 2))).toBe(false)
  })

  it('refuses a JPEG with bytes appended after EOI', () => {
    expect(isJpeg(new Uint8Array([...realJpeg, ...randomBytes(1024)]))).toBe(false)
  })

  it('refuses the JPEG signature followed by arbitrary bytes ending in EOI', () => {
    const evil = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...randomBytes(20_000), 0xff, 0xd9])
    expect(isJpeg(evil)).toBe(false)
  })

  it('refuses empty and tiny inputs without throwing', () => {
    for (const n of [0, 1, 2, 4, 8, 12, 20, 22, 30]) {
      const b = randomBytes(n)
      expect(isPng(b)).toBe(false)
      expect(isJpeg(b)).toBe(false)
      expect(isGlb(b)).toBe(false)
      expect(isUsdz(b)).toBe(false)
    }
  })
})


/* -------------------------------------------------- the AR route, end to end */

/**
 * `POST /api/ar` through the real handler, because the pure functions being
 * right is not the same claim as the route calling them. The two refusals here
 * are the exact requests that were measured returning 200 against a real
 * `wrangler dev` on 2026-08-27, with the payload readable straight back off
 * /r2/ar/<id>.usdz.
 */
describe('POST /api/ar', () => {
  const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext

  function arEnv() {
    const store = new Map<string, Uint8Array>()
    const obj = (k: string) => {
      const v = store.get(k)
      if (!v) return null
      return {
        body: v,
        size: v.length,
        httpEtag: '"e"',
        writeHttpMetadata() {},
      }
    }
    return {
      store,
      env: {
        AR_BUCKET: {
          async put(k: string, v: ArrayBuffer | Uint8Array) {
            store.set(k, v instanceof Uint8Array ? v : new Uint8Array(v))
          },
          async get(k: string) {
            return obj(k)
          },
          async head(k: string) {
            return obj(k)
          },
        },
        ASSETS: { fetch: async () => new Response('asset') },
      } as never,
    }
  }

  const goodGlb = () => glb('{"asset":{"version":"2.0"}}')
  const goodUsdz = () => zip('scene.usdc', usdc, 0)
  const goodPng = () =>
    Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      ),
      (c) => c.charCodeAt(0),
    )

  function arPost(parts: Record<string, Uint8Array>): Request {
    const form = new FormData()
    for (const [k, v] of Object.entries(parts)) form.append(k, new Blob([v]), k)
    return new Request('https://x/api/ar', { method: 'POST', body: form })
  }

  it('accepts a real glb, a stored usdz and a real png', async () => {
    const { env, store } = arEnv()
    const res = await worker.fetch(
      arPost({ glb: goodGlb(), usdz: goodUsdz(), poster: goodPng() }),
      env,
      ctx,
    )
    expect(res.status).toBe(200)
    const { id } = (await res.json()) as { id: string }
    expect([...store.keys()].sort()).toEqual([`ar/${id}.glb`, `ar/${id}.png`, `ar/${id}.usdz`])
  })

  it('refuses glTF magic with a payload behind it, and writes nothing', async () => {
    const { env, store } = arEnv()
    const evil = new Uint8Array([0x67, 0x6c, 0x54, 0x46, ...randomBytes(50_000)])
    const res = await worker.fetch(
      arPost({ glb: evil, usdz: goodUsdz(), poster: goodPng() }),
      env,
      ctx,
    )
    expect(res.status).toBe(415)
    expect(store.size).toBe(0)
  })

  it('refuses an ordinary zip renamed .usdz, and writes nothing', async () => {
    const { env, store } = arEnv()
    const payload = zip('payload.txt', new TextEncoder().encode('payload\n'), 0)
    const res = await worker.fetch(
      arPost({ glb: goodGlb(), usdz: payload, poster: goodPng() }),
      env,
      ctx,
    )
    expect(res.status).toBe(415)
    expect(store.size).toBe(0)
  })

  it('serves the stored bytes with nosniff and no attachment header', async () => {
    const { env } = arEnv()
    const { id } = (await (
      await worker.fetch(arPost({ glb: goodGlb(), usdz: goodUsdz(), poster: goodPng() }), env, ctx)
    ).json()) as { id: string }
    for (const ext of ['glb', 'usdz', 'png']) {
      const res = await worker.fetch(new Request(`https://x/r2/ar/${id}.${ext}`), env, ctx)
      expect(res.status).toBe(200)
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
      // Quick Look opens the .usdz INLINE from this URL; attachment breaks AR.
      expect(res.headers.get('content-disposition')).toBe(null)
    }
  })
})
