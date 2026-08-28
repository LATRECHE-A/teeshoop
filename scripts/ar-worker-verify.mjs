/**
 * Headless verification for the AR Worker + R2 round-trip (scripts build on
 * ar-verify.mjs which covers the export itself). Runs `wrangler dev` locally
 * (workerd + a simulated R2 bucket, no cloud/login), then exercises every
 * dynamic route:
 *   POST /api/ar            → { id }
 *   GET  /r2/ar/{id}.glb    → 200, model/gltf-binary
 *   GET  /r2/ar/{id}.usdz   → 200, model/vnd.usdz+zip   (Quick Look requires this)
 *   GET  /r2/ar/{id}.png    → 200, image/png
 *   GET  /v/{id}            → 200, the viewer page
 *   GET  /                  → 200, the studio (assets fallback)
 *   GET  /r2/ar/nope.glb    → 404
 *   POST /api/ar (no files) → 400
 *
 * Requires a prior `npm run build:only` (serves ./dist). Run:
 *   node scripts/ar-worker-verify.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const PORT = 8799
const BASE = `http://127.0.0.1:${PORT}`

if (!existsSync('dist/index.html') || !existsSync('dist/v.html')) {
  console.error('❌ dist not built: run `npm run build:only` first')
  process.exit(1)
}

const waitFor = (url, ms = 60000) =>
  new Promise((res, rej) => {
    const s = Date.now()
    const t = async () => {
      try {
        const r = await fetch(url)
        if (r.ok || r.status === 404) return res()
      } catch {}
      if (Date.now() - s > ms) return rej(new Error('wrangler dev timeout'))
      setTimeout(t, 500)
    }
    t()
  })

/* ---- real containers, built here so the repo commits no binaries ---- */

const u32le = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]

/** A glTF-binary of exactly `total` bytes: JSON chunk with an asset, then BIN. */
function validGlb(total) {
  const json = new TextEncoder().encode('{"asset":{"version":"2.0"}}')
  const jsonChunk = new Uint8Array(Math.ceil(json.length / 4) * 4).fill(0x20)
  jsonChunk.set(json)
  const binLen = total - 12 - 8 - jsonChunk.length - 8
  if (binLen < 0 || binLen % 4 !== 0) throw new Error(`bad glb size ${total}`)
  return new Uint8Array([
    0x67, 0x6c, 0x54, 0x46, ...u32le(2), ...u32le(total),
    ...u32le(jsonChunk.length), 0x4a, 0x53, 0x4f, 0x4e, ...jsonChunk,
    ...u32le(binLen), 0x42, 0x49, 0x4e, 0x00, ...new Uint8Array(binLen),
  ])
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (b) => {
  let c = 0xffffffff
  for (const byte of b) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** A one-entry STORED zip. The compression method is what USDZ requires. */
function storedZip(name) {
  const nb = new TextEncoder().encode(name)
  const data = new TextEncoder().encode('not really a crate, the walk does not decode it')
  const crc = crc32(data)
  const local = [
    0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ...u32le(crc), ...u32le(data.length), ...u32le(data.length),
    nb.length & 0xff, (nb.length >>> 8) & 0xff, 0, 0, ...nb, ...data,
  ]
  const central = [
    0x50, 0x4b, 0x01, 0x02, 20, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ...u32le(crc), ...u32le(data.length), ...u32le(data.length),
    nb.length & 0xff, (nb.length >>> 8) & 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ...u32le(0), ...nb,
  ]
  const eocd = [
    0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 1, 0, 1, 0,
    ...u32le(central.length), ...u32le(local.length), 0, 0,
  ]
  return new Uint8Array([...local, ...central, ...eocd])
}

const validUsdz = () => storedZip('scene.usdc')
const plainZip = () => storedZip('payload.txt')

const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const validPng = () => Uint8Array.from(Buffer.from(PNG_1X1, 'base64'))
const signatureOnlyPng = () => {
  const b = new Uint8Array(300000)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return b
}

const server = spawn(
  'npx',
  ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--log-level', 'error'],
  { cwd: process.cwd(), stdio: 'ignore' },
)
const done = (code) => {
  try { server.kill('SIGTERM') } catch {}
  process.exit(code)
}
const fail = (msg) => { console.error('❌ ' + msg); done(1) }

try {
  await waitFor(BASE + '/')

  /*
   * 1) Upload three REAL containers. These used to be four magic bytes each,
   * which is exactly the hole worker/containers.ts closed: the route now walks
   * each format's own length arithmetic and requires it to end on the last byte
   * of the file, so a stub no longer gets in (and neither does a payload glued
   * behind a signature, asserted in step 4).
   */
  const form = new FormData()
  form.append('glb', new Blob([validGlb(2048)]), 'model.glb') // 2048 so the Range asserts below are meaningful
  form.append('usdz', new Blob([validUsdz()]), 'model.usdz')
  form.append('poster', new Blob([validPng()]), 'poster.png')
  const up = await fetch(BASE + '/api/ar', { method: 'POST', body: form })
  const upBody = await up.json().catch(() => ({}))
  console.log('upload:', up.status, JSON.stringify(upBody))
  if (up.status !== 200) fail(`upload status ${up.status} (routing? worker not handling /api/ar)`)
  const id = upBody.id
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(id || '')) fail(`bad id: ${id}`)

  // 2) Serve each blob with the correct MIME.
  const expect = { glb: 'model/gltf-binary', usdz: 'model/vnd.usdz+zip', png: 'image/png' }
  for (const [ext, mime] of Object.entries(expect)) {
    const r = await fetch(`${BASE}/r2/ar/${id}.${ext}`)
    const ct = r.headers.get('content-type')
    console.log(`GET ${ext}:`, r.status, ct)
    if (r.status !== 200) fail(`${ext} serve status ${r.status}`)
    if (ct !== mime) fail(`${ext} content-type "${ct}", expected "${mime}"`)
  }

  // 2b) Range / HEAD semantics: Android Scene Viewer's downloader uses HEAD +
  // ranged GETs and rejects the object ("couldn't load") if they're not honored.
  const glbUrl = `${BASE}/r2/ar/${id}.glb`
  const full = await fetch(glbUrl)
  const clen = Number(full.headers.get('content-length'))
  console.log('GLB full:', full.status, 'content-length', clen, 'accept-ranges', full.headers.get('accept-ranges'))
  if (!Number.isFinite(clen) || clen < 1000) fail(`GLB GET missing/bad content-length: ${full.headers.get('content-length')}`)
  if (full.headers.get('accept-ranges') !== 'bytes') fail('GLB GET missing "Accept-Ranges: bytes"')
  const hd = await fetch(glbUrl, { method: 'HEAD' })
  if (hd.status !== 200 || Number(hd.headers.get('content-length')) !== clen)
    fail(`HEAD content-length ${hd.headers.get('content-length')} != ${clen}`)
  const rg = await fetch(glbUrl, { headers: { Range: 'bytes=0-9' } })
  const cr = rg.headers.get('content-range')
  const rbytes = (await rg.arrayBuffer()).byteLength
  console.log('Range bytes=0-9:', rg.status, cr, rbytes + 'B')
  if (rg.status !== 206) fail(`Range GET status ${rg.status} (expected 206, Scene Viewer needs range support)`)
  if (cr !== `bytes 0-9/${clen}`) fail(`Range content-range "${cr}" (expected "bytes 0-9/${clen}")`)
  if (rbytes !== 10) fail(`Range body ${rbytes} bytes (expected 10)`)

  // 3) Viewer page, for BOTH /v?id=… (the QR shape) and /v/{id}. redirect:manual
  // so we CATCH the html_handling 307 that used to strip the id (the old test
  // followed the redirect and silently passed).
  for (const p of [`/v?id=${id}`, `/v/${id}`]) {
    const v = await fetch(BASE + p, { redirect: 'manual' })
    const vText = v.status === 200 ? await v.text() : ''
    console.log(`GET ${p}:`, v.status, v.headers.get('location') || '')
    if (v.status !== 200) fail(`${p} returned ${v.status} (a 3xx here is the id-stripping redirect bug)`)
    if (!vText.includes('ar-root')) fail(`${p} did not serve the viewer page`)
  }
  const home = await fetch(`${BASE}/`)
  const homeText = await home.text()
  if (home.status !== 200 || !homeText.includes('id="root"')) fail('studio not served at /')

  // 4) Error cases.
  const miss = await fetch(`${BASE}/r2/ar/doesnotexist.glb`)
  if (miss.status !== 404) fail(`missing object should 404, got ${miss.status}`)
  const bad = await fetch(BASE + '/api/ar', { method: 'POST', body: new FormData() })
  if (bad.status !== 400) fail(`empty upload should 400, got ${bad.status}`)

  /*
   * The measured abuse, refused. Both of these returned 200 against this same
   * `wrangler dev` before container validation, and the zip's payload was then
   * readable straight off /r2/ar/{id}.usdz. R2 is not free hosting.
   */
  const junk = new Uint8Array(50000)
  junk.set([0x67, 0x6c, 0x54, 0x46])
  for (const [what, parts] of [
    ['glTF magic + junk', { glb: junk, usdz: validUsdz(), poster: validPng() }],
    ['a plain zip renamed .usdz', { glb: validGlb(2048), usdz: plainZip(), poster: validPng() }],
    ['PNG signature + junk', { glb: validGlb(2048), usdz: validUsdz(), poster: signatureOnlyPng() }],
  ]) {
    const f = new FormData()
    for (const [k, v] of Object.entries(parts)) f.append(k, new Blob([v]), k)
    const r = await fetch(BASE + '/api/ar', { method: 'POST', body: f })
    console.log(`refuse ${what}:`, r.status)
    if (r.status !== 415) fail(`${what} should 415, got ${r.status} (R2 is free hosting again)`)
  }

  console.log(
    '✅ AR worker verify PASS: upload, MIME-correct serve, viewer routing, fallback, errors and container refusals all OK',
  )
  done(0)
} catch (e) {
  fail(e?.message || String(e))
}
