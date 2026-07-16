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
  console.error('❌ dist not built — run `npm run build:only` first')
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

  // 1) Upload three dummy blobs (the Worker only stores/serves bytes).
  const form = new FormData()
  form.append('glb', new Blob([new Uint8Array([0x67, 0x6c, 0x54, 0x46, 1, 2, 3, 4])]), 'model.glb')
  form.append('usdz', new Blob([new Uint8Array([0x50, 0x4b, 3, 4, 9, 9])]), 'model.usdz')
  form.append('poster', new Blob([new Uint8Array([137, 80, 78, 71, 13, 10])]), 'poster.png')
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

  // 3) Viewer page — for BOTH /v?id=… (the QR shape) and /v/{id}. redirect:manual
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

  console.log('✅ AR worker verify PASS — upload, MIME-correct serve, viewer routing, fallback + errors all OK')
  done(0)
} catch (e) {
  fail(e?.message || String(e))
}
