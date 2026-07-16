/**
 * Headless verification for the AR try-on page.
 *
 * Boots the Vite DEV server (so the DEV-only __arScene probe exists), seeds a
 * design in the studio (autosaved to IndexedDB), opens /ar.html in the same
 * origin, and asserts the mannequin + design decal actually render by reading
 * the WebGL framebuffer back (swiftshader-safe, unlike OS screenshots).
 *
 *   node scripts/ar-verify.mjs
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = 5199
const BASE = `http://localhost:${PORT}`

function waitForServer(url, ms = 30000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const r = await fetch(url)
        if (r.ok) return resolve()
      } catch {
        /* not up yet */
      }
      if (Date.now() - start > ms) return reject(new Error('dev server timeout'))
      setTimeout(tick, 400)
    }
    tick()
  })
}

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(),
  stdio: 'ignore',
})

let browser
const fail = (msg) => {
  console.error('❌ ' + msg)
  cleanup(1)
}
function cleanup(code) {
  try {
    browser?.close()
  } catch {}
  try {
    server.kill('SIGTERM')
  } catch {}
  process.exit(code)
}

try {
  await waitForServer(BASE)
  browser = await chromium.launch({
    args: [
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--disable-gpu-sandbox',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  })
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 892 },
    deviceScaleFactor: 1,
    permissions: ['camera'],
  })
  const errors = []
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push('[console] ' + m.text()))

  // 1) Seed a design in the studio and let it autosave to IndexedDB.
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForFunction(() => !!window.__tshop, { timeout: 20000 })
  await page.evaluate(() => {
    window.__tshop.getState().addTextLayer('AR CHECK')
    window.__tshop.getState().addGraphicLayer?.('star') // best-effort second layer
  })
  await page.waitForTimeout(1400) // autosave debounce is 700ms

  // 2) Open the AR page (same origin → shares IndexedDB).
  await page.goto(BASE + '/ar.html', { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForFunction(() => !!window.__arScene, { timeout: 25000 })
  await page.waitForTimeout(600) // let textures upload + first frames run

  const probe = await page.evaluate(() => window.__arScene.__probe())
  console.log('probe:', JSON.stringify(probe))

  if (errors.length) fail('page errors: ' + errors.slice(0, 5).join(' | '))
  if (probe.decals < 1) fail('no design decal on the mannequin (decals=0)')
  if (probe.figureHeightIn < 55 || probe.figureHeightIn > 80)
    fail('mannequin height out of range: ' + probe.figureHeightIn)
  const coverage = probe.opaque / probe.total
  if (coverage < 0.02) fail('figure not visible in frame (coverage=' + coverage.toFixed(4) + ')')

  // 3) Start the camera flow + capture a snapshot blob.
  // Tag the live scene first: if Start tears it down and rebuilds it (the
  // phase-keyed-effect bug), the tag — and the camera stream — are lost.
  await page.evaluate(() => {
    window.__arScene.__persistTag = 'live-scene'
  })
  const startBtn = page.getByRole('button', { name: /Démarrer|Start camera/ })
  await startBtn.click({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(1400)
  const afterStart = await page.evaluate(() => {
    const v = document.querySelector('#ar-root video')
    return {
      sameScene: window.__arScene.__persistTag === 'live-scene',
      hasStream: !!v?.srcObject,
      videoW: v?.videoWidth ?? 0,
    }
  })
  console.log('after start:', JSON.stringify(afterStart))
  if (!afterStart.sameScene) fail('scene was rebuilt on Start — camera/motion would be lost')
  if (!afterStart.hasStream) fail('camera stream not acquired after Start (getUserMedia failed)')
  if (afterStart.videoW < 1)
    console.log('note: videoWidth=0 — headless fake camera may not report frames; stream IS acquired')
  const shotUrl = await page.evaluate(async () => {
    const b = await window.__arScene.capture()
    return await new Promise((res) => {
      const r = new FileReader()
      r.onload = () => res(r.result)
      r.readAsDataURL(b)
    })
  })
  const shotBytes = Math.round((shotUrl.length - shotUrl.indexOf(',') - 1) * 0.75)
  console.log('snapshot bytes:', shotBytes)
  if (!shotBytes || shotBytes < 2000) fail('snapshot capture too small: ' + shotBytes)
  if (process.env.AR_SHOT_OUT) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(process.env.AR_SHOT_OUT, Buffer.from(shotUrl.split(',')[1], 'base64'))
    console.log('wrote', process.env.AR_SHOT_OUT)
  }

  console.log(`✅ AR verify PASS — decals=${probe.decals} figureH=${probe.figureHeightIn.toFixed(1)}in coverage=${coverage.toFixed(3)} shot=${shotBytes}B`)
  cleanup(0)
} catch (e) {
  fail(e?.message || String(e))
}
