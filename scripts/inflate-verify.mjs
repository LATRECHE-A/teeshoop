/**
 * Headless verification for the HOLLOW Poisson-inflated custom-garment shell.
 * Boots Vite dev, loads dev/inflate.html, asserts real Z-volume, dome
 * curvature, hollow linings (present + strictly inside), photo normal map,
 * build-time budget and coverage, then dumps PNGs (set INFLATE_OUT_DIR).
 *   node scripts/inflate-verify.mjs
 */
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const PORT = 5197
const BASE = `http://localhost:${PORT}`
const OUT = process.env.INFLATE_OUT_DIR

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
let code = 1
const done = (c) => {
  try { browser?.close() } catch {}
  try { server.kill('SIGTERM') } catch {}
  process.exit(c)
}

try {
  await waitFor(BASE)
  browser = await chromium.launch({
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox'],
  })
  const page = await browser.newPage({ viewport: { width: 1220, height: 940 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push('[console] ' + m.text()))

  await page.goto(BASE + '/dev/inflate.html', { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForFunction(() => !!window.__inflate, { timeout: 20000 })
  await page.waitForTimeout(400)

  const flags = await page.evaluate(() => ({
    ok: window.__inflate.ok,
    hasHoles: window.__inflate.hasHoles,
    hasLinings: window.__inflate.hasLinings,
    hasNormalMap: window.__inflate.hasNormalMap,
  }))
  if (!flags.ok) { console.error('❌ shell not built (canvasToSilhouette gate failed)'); done(1) }

  const probe = await page.evaluate(() => {
    const p = window.__inflate.probe()
    return { ...p, dataUrl: undefined } // strip heavy field for logging
  })
  console.log('probe:', JSON.stringify({
    verts: probe.verts,
    zMin: probe.zMin.toFixed(2),
    zMax: probe.zMax.toFixed(2),
    curvature: probe.curvature.toFixed(3),
    thickness: probe.thickness.toFixed(2),
    coverage: probe.coverage.toFixed(3),
    buildMs: probe.buildMs.toFixed(0),
    ...flags,
    liningInside: probe.liningInside,
  }))

  if (errors.length) { console.error('❌ page errors:', errors.slice(0, 5).join(' | ')); done(1) }
  const volume = probe.zMax - probe.zMin
  if (volume < 0.8) { console.error('❌ no volume: front sheet z-range =', volume.toFixed(3)); done(1) }
  if (probe.zMax < 0.4) { console.error('❌ front does not bulge toward +Z (zMax=' + probe.zMax.toFixed(2) + ')'); done(1) }
  // Headroom invariant: fold/wrinkle perturbations must never push the front
  // sheet through the mid-plane (that interpenetrates the back + lining).
  if (probe.zMin < -1e-3) { console.error('❌ front sheet crosses z=0 (zMin=' + probe.zMin.toFixed(3) + ')'); done(1) }
  // A flat "puffed paper" plateau bulges (zMax>0.4) but its normals stay ~(0,0,1).
  // Require a real dome: a large fraction of front normals must tilt off +Z.
  if (probe.curvature < 0.4) { console.error('❌ front is a flat plateau, not a rounded dome (curvature=' + probe.curvature.toFixed(3) + ')'); done(1) }
  if (probe.coverage < 0.05) { console.error('❌ garment not visible (coverage=' + probe.coverage.toFixed(3) + ')'); done(1) }
  // Hollow shell upgrades.
  if (!flags.hasHoles) { console.error('❌ collar hole not detected (no interior catch planes)'); done(1) }
  if (!flags.hasLinings) { console.error('❌ interior linings missing'); done(1) }
  if (!probe.liningInside) { console.error('❌ front lining pokes through its sheet or the mid-plane'); done(1) }
  if (!flags.hasNormalMap) { console.error('❌ photo wrinkle normal map missing'); done(1) }
  // Spec budget ~450ms for an ~1100px canvas (this one is 840×1008); headless
  // swiftshader CPUs are slower than user machines, so warn past 1.5×.
  if (probe.buildMs > 675) console.warn('⚠ build took', probe.buildMs.toFixed(0) + 'ms (budget ~450ms on user hardware)')

  if (OUT) {
    for (const v of ['grid', 'front', 'threequarter', 'top', 'graze', 'side']) {
      const url = await page.evaluate((view) => { window.__inflate.setView(view); return window.__inflate.probe().dataUrl }, v)
      writeFileSync(`${OUT}/inflate-${v}.png`, Buffer.from(url.split(',')[1], 'base64'))
    }
    await page.evaluate(() => window.__inflate.setView('grid'))
    console.log('wrote PNGs to', OUT)
  }

  console.log(`✅ inflate verify PASS — verts=${probe.verts} bulge=${probe.zMax.toFixed(2)}in curvature=${probe.curvature.toFixed(3)} thickness=${probe.thickness.toFixed(2)}in coverage=${probe.coverage.toFixed(3)} build=${probe.buildMs.toFixed(0)}ms hollow=${flags.hasLinings}`)
  code = 0
} catch (e) {
  console.error('❌', e?.message || e)
}
done(code)
