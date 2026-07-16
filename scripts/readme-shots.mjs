/**
 * Regenerate the probe-based README screenshots (docs/screens/*.png).
 *
 * Self-contained: spawns its own Vite DEV server (the shots need window.__tshop
 * / __inflate probes, which are DEV-only). 2D + DOM UI is captured with normal
 * screenshots; WebGL (3D preview, inflated garment) via framebuffer readback
 * (OS screenshots don't composite WebGL under swiftshader).
 *
 * The AR QR screenshot (ar-qr) needs the Cloudflare Worker + R2, so it lives in
 * scripts/ar-shots.mjs (wrangler dev). Run both to refresh everything:
 *   node scripts/readme-shots.mjs && npm run build:only && node scripts/ar-shots.mjs
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const PORT = 5190
const BASE = `http://localhost:${PORT}`
const DIR = 'docs/screens'
const save = (name, dataUrl) => {
  writeFileSync(`${DIR}/${name}.png`, Buffer.from(dataUrl.split(',')[1], 'base64'))
  console.log('saved', name)
}
const waitServer = (url, ms = 30000) =>
  new Promise((res, rej) => {
    const s = Date.now()
    const t = async () => {
      try { if ((await fetch(url)).ok) return res() } catch {}
      if (Date.now() - s > ms) return rej(new Error('server timeout'))
      setTimeout(t, 400)
    }
    t()
  })

// rAF x2 then read the main WebGL canvas, composited over a background.
const READBACK = ({ selector, bg }) =>
  new Promise((resolve) => {
    const gl = document.querySelector(selector)
    if (!gl) return resolve(null)
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
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
      }),
    )
  })

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: process.cwd(), stdio: 'ignore' })
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox'],
})

try {
  await waitServer(BASE)

  // ---------------- Desktop (dark) ----------------
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 980 }, deviceScaleFactor: 1 })
  await ctx.addInitScript(() => {
    try { localStorage.setItem('tshop:prefs', JSON.stringify({ theme: 'dark', lang: 'en', scene: 'studio', showGuides: false })) } catch {}
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.error('[pageerror]', e.message))
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForFunction(() => !!window.__tshop, { timeout: 20000 })
  await page.waitForTimeout(1400)
  await page.evaluate(() => window.__tshop.getState().toasts.forEach((t) => window.__tshop.getState().dismissToast(t.id)))
  await page.waitForTimeout(300)

  // 1) 2D editor (clean sample)
  await page.screenshot({ path: `${DIR}/editor.png`, animations: 'disabled' })
  console.log('saved editor')

  // 2) Placement guides on
  await page.evaluate(() => { const s = window.__tshop.getState(); if (!s.showGuides) s.toggleGuides() })
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${DIR}/guides.png`, animations: 'disabled' })
  console.log('saved guides')
  await page.evaluate(() => { const s = window.__tshop.getState(); if (s.showGuides) s.toggleGuides() })

  // 3) Sleeve print side (with a placed design)
  await page.evaluate(() => {
    const s = window.__tshop.getState()
    s.setSide('sleeve')
    if (s.design.layers.filter((l) => l.side === 'sleeve').length === 0) s.addGraphicLayer('star')
  })
  await page.waitForTimeout(900)
  await page.evaluate(() => window.__tshop.getState().select(null))
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${DIR}/sleeve.png`, animations: 'disabled' })
  console.log('saved sleeve')
  await page.evaluate(() => { const s = window.__tshop.getState(); const l = s.design.layers.find((x) => x.side === 'sleeve'); if (l) s.removeLayer(l.id); s.setSide('front') })
  await page.waitForTimeout(400)

  // 4) 3D preview — tee (cloth sheen)
  await page.evaluate(() => window.__tshop.getState().setMode('3d'))
  await page.waitForFunction(() => document.body.innerText.includes('Drag to rotate'), { timeout: 60000 })
  await page.waitForTimeout(3000)
  save('3d-tee', await page.evaluate(READBACK, { selector: 'main canvas', bg: { grad: [[0, '#171b22'], [0.55, '#101318'], [1, '#0a0c10']] } }))

  // 5) 3D preview — hoodie
  await page.evaluate(() => window.__tshop.getState().setGarment('hoodie'))
  await page.waitForTimeout(9000)
  save('hoodie', await page.evaluate(READBACK, { selector: 'main canvas', bg: { grad: [[0, '#171b22'], [0.55, '#101318'], [1, '#0a0c10']] } }))
  await page.evaluate(() => { const s = window.__tshop.getState(); s.setGarment('tee'); s.setMode('2d') })
  await page.waitForTimeout(800)

  // 6) AR model — bake the design onto the mannequin (the same buildArModel the
  // AR modal uses), load the GLB with GLTFLoader (the loader the viewer uses),
  // and read it back over a room gradient. Avoids the slow worker+viewer flow.
  save('ar', await page.evaluate(async () => {
    const THREE = await window.__three()
    const { GLTFLoader } = await window.__gltf()
    const ax = await window.__arExport()
    const design = window.__tshop.getState().design
    const blobs = await ax.buildArModel(design, 'male')
    const buf = await blobs.glb.arrayBuffer()
    const gltf = await new Promise((res, rej) => new GLTFLoader().parse(buf, '', res, rej))
    const W = 560
    const H = 860
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })
    renderer.setSize(W, H, false)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    const scene = new THREE.Scene()
    const ec = document.createElement('canvas')
    ec.width = 32
    ec.height = 128
    const exx = ec.getContext('2d')
    const eg = exx.createLinearGradient(0, 0, 0, 128)
    eg.addColorStop(0, '#eef3fb')
    eg.addColorStop(0.55, '#aeb9c8')
    eg.addColorStop(1, '#42484f')
    exx.fillStyle = eg
    exx.fillRect(0, 0, 32, 128)
    const et = new THREE.CanvasTexture(ec)
    et.mapping = THREE.EquirectangularReflectionMapping
    et.colorSpace = THREE.SRGBColorSpace
    scene.environment = et
    scene.add(new THREE.HemisphereLight(0xf2f5ff, 0x3a3630, 0.55))
    const key = new THREE.DirectionalLight(0xffffff, 2.0)
    key.position.set(-6, 12, 10)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xbcd3ff, 0.5)
    fill.position.set(8, 5, -6)
    scene.add(fill)
    const model = gltf.scene
    const box = new THREE.Box3().setFromObject(model)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    model.position.sub(center)
    scene.add(model)
    const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 4000)
    const radius = Math.max(size.x, size.y, size.z) * 0.5
    cam.position.set(radius * 0.55, size.y * 0.04, (radius / Math.tan((30 * Math.PI) / 360)) * 1.12)
    cam.lookAt(0, 0, 0)
    renderer.render(scene, cam)
    const out = document.createElement('canvas')
    out.width = W
    out.height = H
    const ox = out.getContext('2d')
    const rg = ox.createLinearGradient(0, 0, 0, H)
    rg.addColorStop(0, '#3a4150')
    rg.addColorStop(0.55, '#262b34')
    rg.addColorStop(1, '#15181e')
    ox.fillStyle = rg
    ox.fillRect(0, 0, W, H)
    ox.drawImage(renderer.domElement, 0, 0)
    const url = out.toDataURL('image/png')
    renderer.dispose()
    return url
  }))

  // 7) Volumetric custom garment (inflate harness readback, already on dark bg)
  await page.goto(BASE + '/dev/inflate.html', { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForFunction(() => !!window.__inflate && window.__inflate.ok, { timeout: 20000 })
  await page.waitForTimeout(600)
  save('3d-custom', await page.evaluate(() => { window.__inflate.setView('threequarter'); return window.__inflate.probe().dataUrl }))
  await ctx.close()

  // ---------------- Mobile ----------------
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
  await mctx.addInitScript(() => {
    try { localStorage.setItem('tshop:prefs', JSON.stringify({ theme: 'dark', lang: 'en', scene: 'studio', showGuides: false })) } catch {}
  })
  const mp = await mctx.newPage()
  await mp.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 45000 })
  await mp.waitForFunction(() => !!window.__tshop, { timeout: 20000 })
  await mp.waitForTimeout(1200)
  await mp.evaluate(() => window.__tshop.getState().toasts.forEach((t) => window.__tshop.getState().dismissToast(t.id)))
  await mp.waitForTimeout(300)
  await mp.screenshot({ path: `${DIR}/mobile.png`, animations: 'disabled' })
  console.log('saved mobile')
  // Select a layer → the compact selection bar (not the full sheet).
  await mp.evaluate(() => { const s = window.__tshop.getState(); const l = s.design.layers.find((x) => x.side === 'front'); if (l) s.select(l.id) })
  await mp.waitForTimeout(600)
  await mp.screenshot({ path: `${DIR}/mobile-edit.png`, animations: 'disabled' })
  console.log('saved mobile-edit')
  await mctx.close()

  console.log('\nProbe README screenshots (incl. ar.png) regenerated in', DIR, '— run scripts/ar-shots.mjs for ar-qr.png')
} finally {
  await browser.close()
  try { server.kill('SIGTERM') } catch {}
}
