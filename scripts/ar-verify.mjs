/**
 * Headless verification for the AR EXPORT pipeline (the risky leg).
 *
 * Boots Vite dev, seeds a design in the studio, then runs the SAME
 * buildArModel() the AR modal uses and asserts the exported GLB + USDZ + poster
 * are well-formed (magic bytes + non-trivial size) for both genders and for a
 * multi-layer design. This validates in-browser GLB/USDZ generation without a
 * backend; the Worker/R2 round-trip is covered by scripts/ar-worker-verify.mjs
 * (wrangler dev) and final native AR must be device-tested.
 *
 *   node scripts/ar-verify.mjs
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = 5198
const BASE = `http://localhost:${PORT}`

const waitFor = (url, ms = 30000) =>
  new Promise((res, rej) => {
    const s = Date.now()
    const t = async () => {
      try {
        if ((await fetch(url)).ok) return res()
      } catch {}
      if (Date.now() - s > ms) return rej(new Error('dev server timeout'))
      setTimeout(t, 400)
    }
    t()
  })

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: process.cwd(), stdio: 'ignore' })
let browser
const done = (code) => {
  try { browser?.close() } catch {}
  try { server.kill('SIGTERM') } catch {}
  process.exit(code)
}
const fail = (msg) => { console.error('❌ ' + msg); done(1) }

try {
  await waitFor(BASE)
  browser = await chromium.launch({
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox'],
  })
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push('[console] ' + m.text()))

  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForFunction(() => !!window.__tshop && !!window.__arExport, { timeout: 20000 })

  // Seed a multi-layer design (text + graphic on the front).
  await page.evaluate(() => {
    const s = window.__tshop.getState()
    s.addTextLayer('AR CHECK')
    s.addGraphicLayer?.('star')
  })
  await page.waitForTimeout(300)

  const run = async (gender) =>
    page.evaluate(async (g) => {
      const ax = await window.__arExport()
      const design = window.__tshop.getState().design
      const blobs = await ax.buildArModel(design, g)
      const head = async (blob, n) => Array.from(new Uint8Array(await blob.slice(0, n).arrayBuffer()))
      return {
        glbSize: blobs.glb.size,
        usdzSize: blobs.usdz.size,
        posterSize: blobs.poster.size,
        glbMagic: String.fromCharCode(...(await head(blobs.glb, 4))),
        usdzMagic: await head(blobs.usdz, 2), // 'PK' = 0x50 0x4B (zip)
        pngMagic: await head(blobs.poster, 4), // 137 80 78 71
      }
    }, gender)

  for (const gender of ['male', 'female']) {
    const r = await run(gender)
    console.log(gender, JSON.stringify(r))
    if (errors.length) fail('page errors: ' + errors.slice(0, 4).join(' | '))
    if (r.glbMagic !== 'glTF') fail(`${gender}: GLB magic is "${r.glbMagic}", expected "glTF"`)
    if (r.glbSize < 2000) fail(`${gender}: GLB too small (${r.glbSize})`)
    if (r.usdzMagic[0] !== 0x50 || r.usdzMagic[1] !== 0x4b) fail(`${gender}: USDZ is not a zip (${r.usdzMagic})`)
    if (r.usdzSize < 2000) fail(`${gender}: USDZ too small (${r.usdzSize})`)
    if (r.pngMagic[0] !== 137 || r.pngMagic[1] !== 80) fail(`${gender}: poster is not a PNG (${r.pngMagic})`)
    if (r.posterSize < 1000) fail(`${gender}: poster too small (${r.posterSize})`)
    console.log(
      `✅ ${gender} — glb=${(r.glbSize / 1024).toFixed(0)}KB usdz=${(r.usdzSize / 1024).toFixed(0)}KB poster=${(r.posterSize / 1024).toFixed(0)}KB`,
    )
  }

  console.log('✅ AR export verify PASS — GLB + USDZ + poster valid for both genders')
  done(0)
} catch (e) {
  fail(e?.message || String(e))
}
