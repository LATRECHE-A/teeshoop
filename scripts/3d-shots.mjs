#!/usr/bin/env node
/**
 * 3D-SHOTS — render-QA stills of every 3D garment path, for eyeballing.
 *
 * Captures, via WebGL framebuffer readback (OS screenshots don't composite
 * WebGL under swiftshader — same pattern as readme-shots.mjs):
 *   - /dev/three.html   tee / hoodie / custom(synthetic card) at fixed views
 *   - the studio app    sample design on tee + hoodie (dark), tee (light)
 *   - /dev/inflate.html the inflated-shell harness probe
 *
 *   node scripts/3d-shots.mjs [outDir]        (default: .qa/3d-shots)
 *
 * No validation here — this is the proof sheet a human (or a reviewing agent)
 * looks at. Verification lives in the *-verify.mjs suites.
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

const PORT = Number(process.env.SHOT_PORT || 5195)
const BASE = `http://localhost:${PORT}`
const OUT = process.argv[2] || '.qa/3d-shots'
mkdirSync(OUT, { recursive: true })

// SHOTS=name1,name2 restricts the run (substring match); empty = everything.
const ONLY = (process.env.SHOTS || '').split(',').map((s) => s.trim()).filter(Boolean)
const wanted = (name) => ONLY.length === 0 || ONLY.some((o) => name.includes(o))

const save = (name, dataUrl) => {
  if (!dataUrl) return console.error('MISSING', name)
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(dataUrl.split(',')[1], 'base64'))
  console.log('saved', name)
}
// Generous: under heavy machine load (another session's test fleet), a vite
// boot that normally takes 2 s can take over a minute.
const waitServer = (url, ms = 150000) =>
  new Promise((res, rej) => {
    const s = Date.now()
    const t = async () => {
      try { if ((await fetch(url)).ok) return res() } catch {}
      if (Date.now() - s > ms) return rej(new Error('server timeout'))
      setTimeout(t, 400)
    }
    t()
  })

// Read the main WebGL canvas, composited over a background. The drawing
// buffer is cleared after compositing (preserveDrawingBuffer:false), so a
// single rAF readback races the R3F render loop and sometimes grabs an empty
// frame — retry until the grab actually contains pixels.
const READBACK = ({ selector, bg }) =>
  new Promise((resolve) => {
    const gl = document.querySelector(selector)
    if (!gl) return resolve(null)
    let tries = 0
    const grab = () => {
      const probe = document.createElement('canvas')
      probe.width = Math.max(1, Math.floor(gl.width / 8))
      probe.height = Math.max(1, Math.floor(gl.height / 8))
      const px = probe.getContext('2d', { willReadFrequently: true })
      px.drawImage(gl, 0, 0, probe.width, probe.height)
      const data = px.getImageData(0, 0, probe.width, probe.height).data
      let hasPixels = false
      for (let i = 3; i < data.length; i += 16) {
        if (data[i] > 0) {
          hasPixels = true
          break
        }
      }
      // rAF callbacks run FIFO per frame, so if this grab is registered before
      // the render loop's, it reads a cleared buffer EVERY frame. Alternate
      // re-registration through a macrotask to flip the ordering.
      if (!hasPixels && ++tries < 120)
        return tries % 2
          ? setTimeout(() => requestAnimationFrame(grab), 16)
          : requestAnimationFrame(grab)
      const c = document.createElement('canvas')
      c.width = gl.width
      c.height = gl.height
      const x = c.getContext('2d')
      if (bg && bg.grad) {
        const g = x.createLinearGradient(0, 0, 0, c.height)
        bg.grad.forEach(([o, col]) => g.addColorStop(o, col))
        x.fillStyle = g
      } else {
        x.fillStyle = bg || '#0c0f13'
      }
      x.fillRect(0, 0, c.width, c.height)
      x.drawImage(gl, 0, 0)
      resolve(c.toDataURL('image/png'))
    }
    requestAnimationFrame(grab)
  })
const DARK_BG = { grad: [[0, '#171b22'], [0.55, '#101318'], [1, '#0a0c10']] }
const LIGHT_BG = { grad: [[0, '#f4f6f9'], [0.55, '#e8ecf1'], [1, '#d9dee6']] }

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: process.cwd(), stdio: 'ignore' })
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox'],
})

try {
  await waitServer(BASE)

  // ------------- /dev/three.html at fixed views -------------
  // Fresh page per shot: re-navigating a live WebGL page under swiftshader
  // can hang the renderer process indefinitely.
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1 })
  const harnessShot = async (name, params) => {
    if (!wanted(name)) return
    const page = await ctx.newPage()
    page.on('pageerror', (e) => console.error('[pageerror]', e.message))
    try {
      await page.goto(`${BASE}/dev/three.html?${params}`, { waitUntil: 'load', timeout: 180000 })
      await page.waitForFunction(() => document.body.innerText.includes('ready'), { timeout: 180000 })
      await page.waitForTimeout(2500) // let the view-snap damp settle
      save(name, await page.evaluate(READBACK, { selector: 'main canvas', bg: DARK_BG }))
    } catch (e) {
      console.error('FAILED', name, String(e).split('\n')[0])
    } finally {
      await page.close().catch(() => {})
    }
  }
  await harnessShot('tee-white-34', 'g=tee&c=FFFFFF&v=threequarter')
  await harnessShot('tee-white-front', 'g=tee&c=FFFFFF&v=front')
  await harnessShot('tee-red-34', 'g=tee&c=C0272D&v=threequarter')
  await harnessShot('tee-black-front', 'g=tee&c=191C20&v=front&fd=0&bd=0')
  await harnessShot('hoodie-black-34', 'g=hoodie&c=191C20&v=threequarter')
  await harnessShot('hoodie-black-front', 'g=hoodie&c=191C20&v=front')
  await harnessShot('custom-card-34', 'g=custom&v=threequarter')
  await harnessShot('custom-card-front', 'g=custom&v=front')
  await harnessShot('custom-card-back', 'g=custom&v=back')
  await ctx.close()

  // ------------- studio app (sample design) -------------
  const shoot = async (theme, shots) => {
    try {
    const c2 = await browser.newContext({ viewport: { width: 1600, height: 980 }, deviceScaleFactor: 1 })
    await c2.addInitScript((t) => {
      try { localStorage.setItem('tshop:prefs', JSON.stringify({ theme: t, lang: 'en', scene: 'studio', showGuides: false })) } catch {}
    }, theme)
    const p = await c2.newPage()
    p.on('pageerror', (e) => console.error('[pageerror]', e.message))
    await p.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 45000 })
    await p.waitForFunction(() => !!window.__tshop, { timeout: 20000 })
    await p.waitForTimeout(1200)
    await p.evaluate(() => window.__tshop.getState().toasts.forEach((t) => window.__tshop.getState().dismissToast(t.id)))
    await p.evaluate(() => window.__tshop.getState().setMode('3d'))
    await p.waitForFunction(() => document.body.innerText.includes('Drag to rotate'), { timeout: 60000 })
    await p.waitForTimeout(3000)
    save(`studio-tee-${theme}`, await p.evaluate(READBACK, { selector: 'main canvas', bg: theme === 'dark' ? DARK_BG : LIGHT_BG }))
    if (shots.hoodie) {
      await p.evaluate(() => window.__tshop.getState().setGarment('hoodie'))
      await p.waitForTimeout(9000)
      save(`studio-hoodie-${theme}`, await p.evaluate(READBACK, { selector: 'main canvas', bg: theme === 'dark' ? DARK_BG : LIGHT_BG }))
    }
    await c2.close()
    } catch (e) {
      console.error('FAILED studio', theme, String(e).split('\n')[0])
    }
  }
  if (wanted('studio-dark')) await shoot('dark', { hoodie: true })
  if (wanted('studio-light')) await shoot('light', { hoodie: false })

  // ------------- inflated shell harness -------------
  if (wanted('inflate'))
  try {
    const c3 = await browser.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1 })
    const p3 = await c3.newPage()
    p3.on('pageerror', (e) => console.error('[pageerror]', e.message))
    // The inflate harness is the heaviest dev page (bg-removal worker + shell
    // builds for its whole case set) — under machine load its boot needs the
    // longest leash of any shot.
    await p3.goto(BASE + '/dev/inflate.html', { waitUntil: 'load', timeout: 240000 })
    await p3.waitForFunction(() => !!window.__inflate && window.__inflate.ok, { timeout: 240000 })
    await p3.waitForTimeout(600)
    save('inflate-34', await p3.evaluate(() => { window.__inflate.setView('threequarter'); return window.__inflate.probe().dataUrl }))
    save('inflate-front', await p3.evaluate(() => { window.__inflate.setView('front'); return window.__inflate.probe().dataUrl }))
    await c3.close()
  } catch (e) {
    console.error('FAILED inflate', String(e).split('\n')[0])
  }

  console.log('\n3D proof sheet written to', OUT)
} finally {
  await browser.close()
  try { server.kill('SIGTERM') } catch {}
}
