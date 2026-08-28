/**
 * QA-only (not committed): prove the custom-garment layer siloing (issue #3a).
 * Editing the default tee must NOT mutate the uploaded custom garment's design,
 * and switching back and forth must preserve each context independently.
 *   node scripts/state-check.mjs
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = 5197
const BASE = `http://localhost:${PORT}`
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

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: process.cwd(), stdio: 'ignore' })
let browser
const done = (code) => { try { browser?.close() } catch {} try { server.kill('SIGTERM') } catch {} process.exit(code) }
const fail = (m) => { console.error('❌ ' + m); done(1) }

try {
  await waitFor(BASE)
  browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox'] })
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.error('[pageerror]', e.message))
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForFunction(() => window.__tshop && window.__assets, { timeout: 20000 })

  const result = await page.evaluate(async () => {
    const S = () => window.__tshop.getState()
    const count = () => S().design.layers.length
    const trail = []

    S().newDesign() // clean tee: layers=[], stashedLayers=[]
    S().addTextLayer('TEE-A')
    S().addTextLayer('TEE-B')
    trail.push(['tee after 2 adds', count()]) // 2

    // Seed + adopt a custom garment (crosses catalog -> custom).
    const assets = await window.__assets()
    const c = document.createElement('canvas'); c.width = 400; c.height = 500
    const ctx = c.getContext('2d'); ctx.fillStyle = '#4a7'; ctx.fillRect(60, 60, 280, 380)
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
    const meta = await assets.addAsset(blob, 'g'); await assets.setAssetCutout(meta.id, blob)
    S().setCustom({ widthIn: 20, front: { assetId: meta.id, useCutout: true, printArea: { xIn: 4, yIn: 5, wIn: 12, hIn: 14 } }, back: null })
    trail.push(['custom fresh (should be 0)', count()]) // 0: tee edits did NOT leak

    S().addTextLayer('CUS-A')
    trail.push(['custom after 1 add', count()]) // 1

    S().setGarment('tee') // custom -> catalog
    trail.push(['back to tee (should be 2)', count()]) // 2: custom edit did NOT leak
    const teeIsAB = S().design.layers.every((l) => l.name.startsWith('Text')) && S().design.layers.length === 2

    S().addTextLayer('TEE-C')
    trail.push(['tee after 3rd add', count()]) // 3

    S().setGarment('custom') // catalog -> custom
    trail.push(['back to custom (should be 1)', count()]) // 1: tee's 3rd did NOT leak
    const customText = S().design.layers.map((l) => l.text)

    return { trail, teeIsAB, customText, garment: S().design.garmentId }
  })

  console.log(JSON.stringify(result.trail))
  const map = Object.fromEntries(result.trail)
  if (map['custom fresh (should be 0)'] !== 0) fail('tee edits LEAKED into fresh custom garment')
  if (map['back to tee (should be 2)'] !== 2) fail('custom edits LEAKED into the tee')
  if (map['back to custom (should be 1)'] !== 1) fail('tee edits LEAKED into custom after re-switch')
  console.log('✅ STATE PASS: custom garment layers are siloed from the catalog tee/hoodie design')
  done(0)
} catch (e) {
  fail(e?.message || String(e))
}
