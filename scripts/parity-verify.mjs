/**
 * Headless PRINT-PARITY verification: does the print area occupy the same
 * size + vertical position relative to the garment in the 2D mockup, the 3D
 * preview and the baked AR figure?
 *
 * Seeds a calibration design — a KELLY-GREEN tee with a MAGENTA rectangle that
 * fills the front print area exactly — then measures, in each of the three
 * renderers, the magenta bbox (the print) against the green bbox (the garment):
 *   - ratioW   = printWidth / garmentWidth   (how big the print reads)
 *   - vFrac    = printCentreY within the garment bbox (0=top … 1=hem)
 * Green isolates the garment from the gray AR body + magenta print, so the AR
 * figure is measured against the GARMENT, not the whole body.
 *
 * Prints a table + a PASS/WARN verdict (flags cross-view drift), and writes a
 * side-by-side composite to $PARITY_OUT (default scratch) for visual review.
 *
 *   node scripts/parity-verify.mjs
 */
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const PORT = 5196
const BASE = `http://localhost:${PORT}`
const OUT = process.env.PARITY_OUT || '/tmp/claude-1000/-home-LTH-tshop/5533409e-08ac-431c-8fbf-5bf3f7a42cf0/scratchpad'

const waitFor = (url, ms = 30000) =>
  new Promise((res, rej) => {
    const s = Date.now()
    const t = async () => {
      try { if ((await fetch(url)).ok) return res() } catch {}
      if (Date.now() - s > ms) return rej(new Error('dev server timeout'))
      setTimeout(t, 400)
    }
    t()
  })

// Pixel-measurement helpers, injected into the page so 2D/3D/AR all use one code path.
const MEASURE = `
window.__parity = {
  bbox(d, W, H, pred) {
    let minX = W, minY = H, maxX = -1, maxY = -1
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      if (pred(d[i], d[i+1], d[i+2], d[i+3])) {
        if (x<minX)minX=x; if (x>maxX)maxX=x; if (y<minY)minY=y; if (y>maxY)maxY=y
      }
    }
    if (maxX < 0) return null
    return { x: minX, y: minY, w: maxX-minX+1, h: maxY-minY+1 }
  },
  isGreen: (r,g,b,a) => a > 70 && g > 80 && g > r + 14 && g > b + 8,
  isMagenta: (r,g,b,a) => a > 70 && r > 105 && b > 105 && g < r - 28 && g < b - 28,
  measure(d, W, H) {
    const garment = window.__parity.bbox(d, W, H, window.__parity.isGreen)
    const print = window.__parity.bbox(d, W, H, window.__parity.isMagenta)
    if (!garment || !print) return { ok: false, garment, print }
    return {
      ok: true,
      ratioW: print.w / garment.w,
      ratioH: print.h / garment.h,
      vFrac: (print.y + print.h/2 - garment.y) / garment.h,
      garment, print,
    }
  },
  // composite a (possibly transparent) source canvas over black, return {data,W,H,dataUrl}
  overBlack(src) {
    const c = document.createElement('canvas'); c.width = src.width; c.height = src.height
    const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0,0,c.width,c.height); x.drawImage(src,0,0)
    return { data: x.getImageData(0,0,c.width,c.height).data, W: c.width, H: c.height, dataUrl: c.toDataURL('image/png') }
  },
}
`

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: process.cwd(), stdio: 'ignore' })
let browser
const done = (code) => { try { browser?.close() } catch {} try { server.kill('SIGTERM') } catch {} process.exit(code) }

try {
  await waitFor(BASE)
  browser = await chromium.launch({
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox'],
  })
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 }, deviceScaleFactor: 1 })
  await ctx.addInitScript(() => { try { localStorage.setItem('tshop:prefs', JSON.stringify({ theme: 'dark', lang: 'en', scene: 'studio', showGuides: false })) } catch {} })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push('[console] ' + m.text()))
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForFunction(() => window.__tshop && window.__render && window.__arExport && window.__three, { timeout: 20000 })
  await page.addScriptTag({ content: MEASURE })

  // Seed: kelly-green tee + a magenta rectangle filling the FRONT print area (12x16).
  await page.evaluate(async () => {
    const assets = await window.__assets()
    const c = document.createElement('canvas'); c.width = 300; c.height = 400
    const x = c.getContext('2d'); x.fillStyle = '#ff2ad0'; x.fillRect(0, 0, 300, 400)
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
    const meta = await assets.addAsset(blob, 'parity')
    const s = window.__tshop.getState()
    s.setGarment('tee'); s.setColor('kelly'); s.setSide('front'); s.addImageLayer(meta)
    const st = window.__tshop.getState()
    const l = st.design.layers[st.design.layers.length - 1]
    st.patchLayer(l.id, { xIn: 0, yIn: 0, wIn: 12, hIn: 16 })
  })
  await page.waitForTimeout(400)

  // ---- 2D (renderMockup — the shared 2D truth) ----
  const twoD = await page.evaluate(async () => {
    const { renderMockup } = await window.__render()
    const design = window.__tshop.getState().design
    const cv = await renderMockup(design, 'front', 900)
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
    const m = window.__parity.measure(d, cv.width, cv.height)
    return { ...m, dataUrl: cv.toDataURL('image/png') }
  })

  // ---- 3D (real GarmentModel, front snap, framebuffer readback) ----
  await page.evaluate(() => { window.__tshop.getState().setMode('3d') })
  await page.waitForFunction(() => document.querySelector('main canvas'), { timeout: 60000 })
  await page.waitForTimeout(3500)
  await page.evaluate(() => window.__tshop.getState().requestView('front'))
  await page.waitForTimeout(2500)
  // WebGL readback must happen INSIDE rAF (the drawing buffer is cleared after
  // the frame otherwise — same pattern as scripts/readme-shots.mjs).
  const threeD = await page.evaluate(() => new Promise((resolve) => {
    const gl = document.querySelector('main canvas')
    if (!gl) return resolve({ ok: false })
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const r = window.__parity.overBlack(gl)
      resolve({ ...window.__parity.measure(r.data, r.W, r.H), dataUrl: r.dataUrl })
    }))
  }))

  // ---- AR (bake GLB, render straight-on front, readback) ----
  await page.evaluate(() => { window.__tshop.getState().setMode('2d') })
  await page.waitForTimeout(300)
  const ar = await page.evaluate(async () => {
    const THREE = await window.__three()
    const { GLTFLoader } = await window.__gltf()
    const ax = await window.__arExport()
    const design = window.__tshop.getState().design
    const blobs = await ax.buildArModel(design, 'male')
    const buf = await blobs.glb.arrayBuffer()
    const gltf = await new Promise((res, rej) => new GLTFLoader().parse(buf, '', res, rej))
    const W = 520, H = 900
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })
    renderer.setSize(W, H, false)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    const scene = new THREE.Scene()
    scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 1.1))
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-3, 8, 12); scene.add(key)
    const model = gltf.scene
    const box = new THREE.Box3().setFromObject(model)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    // Straight-on front: aim at the upper-chest so the front print faces the cam.
    const chestY = box.min.y + size.y * 0.70
    model.position.sub(new THREE.Vector3(center.x, chestY, center.z))
    scene.add(model)
    const cam = new THREE.PerspectiveCamera(24, W / H, 0.01, 100)
    const dist = (size.y * 0.62) / Math.tan((24 * Math.PI) / 360)
    cam.position.set(0, 0, dist)
    cam.lookAt(0, 0, 0)
    renderer.render(scene, cam)
    const r = window.__parity.overBlack(renderer.domElement)
    const m = window.__parity.measure(r.data, r.W, r.H)
    renderer.dispose()
    return { ...m, dataUrl: r.dataUrl }
  })

  if (errors.length) console.error('⚠ page errors:', errors.slice(0, 4).join(' | '))

  // ---- report ----
  const row = (name, m) => m && m.ok
    ? `${name.padEnd(6)} ratioW=${m.ratioW.toFixed(3)}  ratioH=${m.ratioH.toFixed(3)}  vFrac=${m.vFrac.toFixed(3)}`
    : `${name.padEnd(6)} MEASURE FAILED (garment=${JSON.stringify(m?.garment)} print=${JSON.stringify(m?.print)})`
  console.log('\n— PRINT PARITY (front, tee, 12×16 print) —')
  console.log(row('2D', twoD)); console.log(row('3D', threeD)); console.log(row('AR', ar))

  const ok = twoD.ok && threeD.ok && ar.ok
  let verdict = 'PASS'
  if (!ok) verdict = 'INCONCLUSIVE'
  else {
    const rW = [twoD.ratioW, threeD.ratioW, ar.ratioW]
    const vF = [twoD.vFrac, threeD.vFrac, ar.vFrac]
    const spread = (a) => Math.max(...a) - Math.min(...a)
    console.log(`\nratioW spread=${spread(rW).toFixed(3)} (2D↔3D=${Math.abs(twoD.ratioW-threeD.ratioW).toFixed(3)}, 3D↔AR=${Math.abs(threeD.ratioW-ar.ratioW).toFixed(3)})`)
    console.log(`vFrac  spread=${spread(vF).toFixed(3)} (2D↔3D=${Math.abs(twoD.vFrac-threeD.vFrac).toFixed(3)}, 3D↔AR=${Math.abs(threeD.vFrac-ar.vFrac).toFixed(3)})`)
    // 2D and 3D SHOULD closely agree (both garment-relative flat/near-flat views).
    if (Math.abs(twoD.ratioW - threeD.ratioW) > 0.12) verdict = 'WARN: 2D vs 3D print size drift'
    if (Math.abs(twoD.vFrac - threeD.vFrac) > 0.08) verdict = 'WARN: 2D vs 3D vertical drift'
    if (spread(vF) > 0.14) verdict = 'WARN: vertical placement spread across views'
  }
  console.log('\nverdict:', verdict)

  for (const [name, m] of [['2d', twoD], ['3d', threeD], ['ar', ar]]) {
    if (m?.dataUrl) writeFileSync(`${OUT}/parity-${name}.png`, Buffer.from(m.dataUrl.split(',')[1], 'base64'))
  }
  console.log('wrote parity-{2d,3d,ar}.png to', OUT)
  done(verdict.startsWith('WARN') ? 2 : ok ? 0 : 3)
} catch (e) {
  console.error('❌', e?.message || e)
  done(1)
}
