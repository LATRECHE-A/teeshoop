/**
 * Headless PRINT-PARITY verification: does the print area occupy the same
 * size + vertical position relative to the garment in the 2D mockup, the 3D
 * preview and the baked AR figure, at EVERY garment size?
 *
 * Seeds a calibration design (a KELLY-GREEN tee with a MAGENTA rectangle that
 * fills the front print area exactly), then, for each swept size, measures in
 * all three renderers the magenta bbox (the print) against the green bbox (the
 * garment):
 *   - ratioW   = printWidth / garmentWidth   (how big the print reads)
 *   - vFrac    = printCentreY within the garment bbox (0=top … 1=hem)
 * Green isolates the garment from the gray AR body + magenta print, so the AR
 * figure is measured against the GARMENT, not the whole body.
 *
 * The size sweep is the point: art scales about the collar while print areas
 * never scale, so ratioW/vFrac legitimately MOVE with size, but they must move
 * IDENTICALLY in 2D, 3D and AR. A per-size table catches an absolute mismatch;
 * the drift table catches the subtler bug where one renderer scales length by
 * the chest ratio instead of the body-length ratio.
 *
 *   node scripts/parity-verify.mjs
 *   PARITY_SIZES=S,L,3XL PARITY_OUT=/tmp/x node scripts/parity-verify.mjs
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { NODE, VITE } from './bin.mjs'

const PORT = 5196
const BASE = `http://localhost:${PORT}`
const OUT = process.env.PARITY_OUT || join(tmpdir(), 'tshop-parity')
// S and 3XL bracket the chart; L is the nominal art size (identity transform).
const SIZES = (process.env.PARITY_SIZES || 'S,L,3XL').split(',').map((s) => s.trim()).filter(Boolean)

mkdirSync(OUT, { recursive: true })

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

const server = spawn(NODE, [VITE, '--port', String(PORT), '--strictPort'], { cwd: process.cwd(), stdio: 'ignore' })
let browser
const done = (code) => { try { browser?.close() } catch {} try { server.kill('SIGTERM') } catch {} process.exit(code) }

try {
  await waitFor(BASE)
  browser = await chromium.launch({
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox'],
  })
  // reducedMotion makes the view snap land analytically instead of damping over
  // an unknown number of frames, so a capture is taken at the pose that was
  // asked for. It also used to kill a <Float> idle sway, which is gone now.
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
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

  const rows = {} // sizeId -> { twoD, threeD, ar }
  for (const size of SIZES) rows[size] = {}

  // The chart ratios the rendered garment must reproduce (sx = half-chest,
  // sy = body length, both relative to the nominal art size).
  const chart = await page.evaluate(async (sizes) => {
    const { sizeScale } = await window.__sizes()
    return Object.fromEntries(sizes.map((s) => [s, sizeScale('tee', s)]))
  }, SIZES)

  // ---- 2D (renderMockup, the shared 2D truth) ----
  for (const size of SIZES) {
    rows[size].twoD = await page.evaluate(async (sizeId) => {
      const { renderMockup } = await window.__render()
      window.__tshop.getState().setPreviewSize(sizeId)
      const design = window.__tshop.getState().design
      const cv = await renderMockup(design, 'front', 900, sizeId)
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
      const m = window.__parity.measure(d, cv.width, cv.height)
      return { ...m, dataUrl: cv.toDataURL('image/png') }
    }, size)
  }

  // ---- 3D (real GarmentModel, front snap, framebuffer readback) ----
  await page.evaluate(() => { window.__tshop.getState().setMode('3d') })
  await page.waitForFunction(() => document.querySelector('main canvas'), { timeout: 60000 })
  await page.waitForTimeout(3500)
  for (const size of SIZES) {
    await page.evaluate((sizeId) => { window.__tshop.getState().setPreviewSize(sizeId) }, size)
    await page.waitForTimeout(1800) // geometry rescale + decal texture rebuild
    await page.evaluate(() => window.__tshop.getState().requestView('front'))
    await page.waitForTimeout(2500)
    // WebGL readback must happen INSIDE rAF (the drawing buffer is cleared after
    // the frame otherwise, same pattern as scripts/readme-shots.mjs).
    rows[size].threeD = await page.evaluate(() => new Promise((resolve) => {
      const gl = document.querySelector('main canvas')
      if (!gl) return resolve({ ok: false })
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const r = window.__parity.overBlack(gl)
        resolve({ ...window.__parity.measure(r.data, r.W, r.H), dataUrl: r.dataUrl })
      }))
    }))
  }

  // ---- AR (bake GLB, render straight-on front, readback) ----
  await page.evaluate(() => { window.__tshop.getState().setMode('2d') })
  await page.waitForTimeout(300)
  for (const size of SIZES) {
    rows[size].ar = await page.evaluate(async (sizeId) => {
      const THREE = await window.__three()
      const { GLTFLoader } = await window.__gltf()
      const ax = await window.__arExport()
      window.__tshop.getState().setPreviewSize(sizeId)
      const design = window.__tshop.getState().design
      const blobs = await ax.buildArModel(design, 'male', sizeId)
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
    }, size)
  }

  if (errors.length) console.error('⚠ page errors:', errors.slice(0, 4).join(' | '))

  // ---- report ----
  const row = (name, m) => m && m.ok
    ? `  ${name.padEnd(4)} ratioW=${m.ratioW.toFixed(3)}  ratioH=${m.ratioH.toFixed(3)}  vFrac=${m.vFrac.toFixed(3)}  [garment ${m.garment.w}x${m.garment.h}px, print ${m.print.w}x${m.print.h}px]`
    : `  ${name.padEnd(4)} MEASURE FAILED (garment=${JSON.stringify(m?.garment)} print=${JSON.stringify(m?.print)})`

  console.log('\n=== PRINT PARITY (front, tee, 12×16 print) ===')
  let ok = true
  let verdict = 'PASS'
  const drift = {}
  for (const size of SIZES) {
    const { twoD, threeD, ar } = rows[size]
    console.log(`\n[${size}]`)
    console.log(row('2D', twoD)); console.log(row('3D', threeD)); console.log(row('AR', ar))
    if (!(twoD?.ok && threeD?.ok && ar?.ok)) { ok = false; continue }
    drift[size] = { rW3: twoD.ratioW - threeD.ratioW, rWa: twoD.ratioW - ar.ratioW, v3: twoD.vFrac - threeD.vFrac, va: twoD.vFrac - ar.vFrac }
    if (Math.abs(drift[size].v3) > 0.08) verdict = `WARN: ${size} 2D vs 3D vertical drift`
    const vF = [twoD.vFrac, threeD.vFrac, ar.vFrac]
    if (Math.max(...vF) - Math.min(...vF) > 0.14) verdict = `WARN: ${size} vertical placement spread across views`
  }

  // ---- does the rendered garment actually obey the cm chart? ----
  // The projection-free test: measure the garment silhouette itself against the
  // chart's chest (sx) and body-length (sy) ratios. This is what catches a
  // renderer that scales length by the chest ratio. Unlike the print-relative
  // numbers below, it is immune to perspective and surface curvature.
  const ref = SIZES.find((s) => rows[s].twoD?.ok && rows[s].threeD?.ok)
  if (ref) {
    console.log(`\n=== garment silhouette vs cm chart (ratios relative to ${ref}) ===`)
    for (const view of ['twoD', 'threeD']) {
      for (const size of SIZES) {
        const m = rows[size][view], r = rows[ref][view]
        if (!m?.ok || !r?.ok || size === ref) continue
        const expW = chart[size].sx / chart[ref].sx
        const expH = chart[size].sy / chart[ref].sy
        const gotW = m.garment.w / r.garment.w
        const gotH = m.garment.h / r.garment.h
        const eW = Math.abs(gotW / expW - 1)
        const eH = Math.abs(gotH / expH - 1)
        const tag = view === 'twoD' ? '2D' : '3D'
        console.log(`  ${tag} ${size.padEnd(3)} width ${gotW.toFixed(3)} vs chart ${expW.toFixed(3)} (${(eW * 100).toFixed(1)}%)   length ${gotH.toFixed(3)} vs chart ${expH.toFixed(3)} (${(eH * 100).toFixed(1)}%)`)
        if (eW > 0.03) verdict = `WARN: ${tag} ${size} garment WIDTH is ${(eW * 100).toFixed(1)}% off the chart chest ratio`
        if (eH > 0.03) verdict = `WARN: ${tag} ${size} garment LENGTH is ${(eH * 100).toFixed(1)}% off the chart body-length ratio`
      }
    }
  }

  // Cross-size drift: the 2D↔3D and 2D↔AR gaps must be CONSTANT across sizes.
  // A renderer that scales length by the chest ratio instead of the body-length
  // ratio passes every per-size check above but fails here.
  const sizesOk = SIZES.filter((s) => drift[s])
  if (sizesOk.length > 1) {
    console.log('\n=== cross-size drift (2D minus other view) ===')
    // Vertical drift (v3/va) is the guarantee areaOffsetYIn makes across the
    // three renderers. rW3 is flat only because print GRADING is on: the print
    // and the garment scale together, so the size term cancels and all that is
    // left is the constant flat-2D-vs-curved-3D projection offset, which makes
    // it the regression test for grading reaching 3D at all.
    //
    // rWa is deliberately NOT enforced. The AR figure is an AVATAR: a fixed
    // human body wearing the print (arExport.buildAvatarFigure, limitation
    // documented at its head), so it does not grade and the print's ratio to it
    // MUST grow with size. It is printed as a diagnostic only, and the honest
    // AR grading assertion is rHa below.
    for (const k of ['v3', 'va', 'rW3', 'rWa']) {
      const vals = sizesOk.map((s) => drift[s][k])
      const spread = Math.max(...vals) - Math.min(...vals)
      const note = k === 'rWa' ? '  (avatar does not grade, diagnostic only)' : ''
      console.log(`  ${k.padEnd(4)} ${sizesOk.map((s, i) => `${s}=${vals[i].toFixed(3)}`).join('  ')}   spread=${spread.toFixed(3)}${note}`)
      if (k !== 'rWa' && spread > 0.05) verdict = `WARN: ${k} drift varies with size (spread ${spread.toFixed(3)}): grading may not be reaching this view`
    }

    // AR grading, measured the one way the avatar path allows. The body is a
    // constant, so the print's HEIGHT against it must track k exactly. Height,
    // not width: the print wraps around the torso, so its projected width is
    // foreshortened by an amount that itself grows with the print.
    const ref = sizesOk[0]
    const kOf = (s) => chart[s].sx / chart[ref].sx
    console.log('\n=== AR print grading (print height vs the fixed avatar body) ===')
    for (const s of sizesOk) {
      const got = rows[s].ar.ratioH / rows[ref].ar.ratioH
      const e = Math.abs(got / kOf(s) - 1)
      console.log(`  ${s.padEnd(3)} ${got.toFixed(3)} vs k ${kOf(s).toFixed(3)} (${(e * 100).toFixed(1)}%)`)
      if (e > 0.03) verdict = `WARN: AR ${s} print height is ${(e * 100).toFixed(1)}% off the grading factor`
    }
  }
  if (!ok) verdict = 'INCONCLUSIVE'
  console.log('\nverdict:', verdict)

  for (const size of SIZES) {
    for (const [name, m] of [['2d', rows[size].twoD], ['3d', rows[size].threeD], ['ar', rows[size].ar]]) {
      if (m?.dataUrl) writeFileSync(`${OUT}/parity-${size}-${name}.png`, Buffer.from(m.dataUrl.split(',')[1], 'base64'))
    }
  }
  console.log(`wrote parity-{${SIZES.join(',')}}-{2d,3d,ar}.png to`, OUT)
  done(verdict.startsWith('WARN') ? 2 : ok ? 0 : 3)
} catch (e) {
  console.error('❌', e?.message || e)
  done(1)
}
