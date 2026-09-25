/**
 * Visual render-QA for the WORN figures (no validation, that's ar-verify).
 * Bakes buildArModel for custom (male/female) + catalog (tee/hoodie) and renders
 * a straight-on front view of each to $WORN_OUT, so the worn custom garment and
 * the corrected avatar print placement can be eyeballed.
 *   node scripts/worn-qa.mjs
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { NODE, VITE } from './bin.mjs'

const PORT = 5194
const BASE = `http://localhost:${PORT}`
// Defaulted under .qa/ like every other harness: the old default was an
// absolute path into one session's scratchpad, so the script died in ENOENT
// for anyone who ran it later, which is to say always.
const OUT = process.env.WORN_OUT || '.qa/worn'
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

const server = spawn(NODE, [VITE, '--port', String(PORT), '--strictPort'], { cwd: process.cwd(), stdio: 'ignore' })
let browser
const done = (code) => { try { browser?.close() } catch {} try { server.kill('SIGTERM') } catch {} process.exit(code) }

try {
  await waitFor(BASE)
  browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 640, height: 1000 } })
  page.on('pageerror', (e) => console.error('[pageerror]', e.message))
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForFunction(() => window.__tshop && window.__arExport && window.__three && window.__gltf && window.__assets, { timeout: 20000 })

  // Seed a real ship-your-own garment (alpha silhouette + cutout), like ar-verify.
  const customId = await page.evaluate(async () => {
    const assets = await window.__assets()
    const W = 600, H = 760
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#3a6ad0'
    const bx = 120, by = 150, bw = 360, bh = 520, r = 60
    ctx.beginPath(); ctx.moveTo(bx + r, by)
    ctx.arcTo(bx + bw, by, bx + bw, by + bh, r); ctx.arcTo(bx + bw, by + bh, bx, by + bh, r)
    ctx.arcTo(bx, by + bh, bx, by, r); ctx.arcTo(bx, by, bx + bw, by, r); ctx.closePath(); ctx.fill()
    ctx.fillRect(50, 160, 85, 200); ctx.fillRect(465, 160, 85, 200)
    ctx.globalCompositeOperation = 'destination-out'
    ctx.beginPath(); ctx.ellipse(W / 2, 158, 68, 44, 0, 0, Math.PI * 2); ctx.fill()
    ctx.globalCompositeOperation = 'source-over'
    // a magenta chest print so placement is legible
    ctx.fillStyle = '#ff2ad0'; ctx.fillRect(W / 2 - 90, 300, 180, 250)
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'))
    const meta = await assets.addAsset(blob, 'worn-qa garment')
    await assets.setAssetCutout(meta.id, blob)
    return meta.id
  })

  const shot = (gid, gender) => page.evaluate(async ({ gid, gender, customId }) => {
    const THREE = await window.__three()
    const { GLTFLoader } = await window.__gltf()
    const ax = await window.__arExport()
    const base = window.__tshop.getState().design
    const design = gid === 'custom'
      ? { ...base, garmentId: 'custom', custom: { widthIn: 20, front: { assetId: customId, useCutout: true, printArea: { xIn: 4, yIn: 5, wIn: 12, hIn: 14 } }, back: null } }
      : { ...base, garmentId: gid }
    if (gid !== 'custom') { design.colorId = 'kelly'; design.layers = [{ id: 'x', type: 'text', side: 'front', name: 't', text: 'FRONT', xIn: 0, yIn: 0, rotation: 0, opacity: 1, fontFamily: 'Anton', fontSizeIn: 2, fill: '#ff2ad0', stroke: null, strokeWidthIn: 0, letterSpacingEm: 0, curve: 0, align: 'center' }] }
    const blobs = await ax.buildArModel(design, gender)
    const buf = await blobs.glb.arrayBuffer()
    const gltf = await new Promise((res, rej) => new GLTFLoader().parse(buf, '', res, rej))
    const W = 560, H = 940
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })
    renderer.setSize(W, H, false); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05
    const scene = new THREE.Scene()
    scene.add(new THREE.HemisphereLight(0xf2f5ff, 0x3a3630, 1.0))
    const key = new THREE.DirectionalLight(0xffffff, 1.9); key.position.set(-4, 10, 12); scene.add(key)
    const model = gltf.scene
    const box = new THREE.Box3().setFromObject(model)
    const size = box.getSize(new THREE.Vector3()); const center = box.getCenter(new THREE.Vector3())
    model.position.sub(center); scene.add(model)
    const cam = new THREE.PerspectiveCamera(26, W / H, 0.01, 100)
    const dist = (size.y * 0.60) / Math.tan((26 * Math.PI) / 360)
    cam.position.set(0, 0, dist); cam.lookAt(0, 0, 0)
    renderer.render(scene, cam)
    const out = document.createElement('canvas'); out.width = W; out.height = H
    const ox = out.getContext('2d')
    const g = ox.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#eef1f6'); g.addColorStop(1, '#c4ccd6')
    ox.fillStyle = g; ox.fillRect(0, 0, W, H); ox.drawImage(renderer.domElement, 0, 0)
    const url = out.toDataURL('image/png'); renderer.dispose()
    return { url, heightM: (size.y * 0.0254).toFixed(2) }
  }, { gid, gender, customId })

  for (const [gid, gender] of [['custom', 'male'], ['custom', 'female'], ['tee', 'male'], ['hoodie', 'female']]) {
    const r = await shot(gid, gender)
    writeFileSync(`${OUT}/worn-${gid}-${gender}.png`, Buffer.from(r.url.split(',')[1], 'base64'))
    console.log(`saved worn-${gid}-${gender}.png  h≈${r.heightM}m`)
  }
  done(0)
} catch (e) { console.error('❌', e?.message || e); done(1) }
