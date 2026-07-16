/**
 * Regenerate README screenshots (docs/screens/*.png).
 *
 * Runs against the Vite DEV server (needs window.__tshop / __arScene / __inflate
 * probes, which are DEV-only). 2D + DOM UI is captured with normal screenshots;
 * WebGL (3D preview, AR mannequin, inflated garment) is captured via
 * framebuffer readback (OS screenshots don't composite WebGL under swiftshader).
 *
 *   node scripts/readme-shots.mjs [baseUrl]
 */
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const BASE = process.argv[2] || 'http://localhost:5190'
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

await waitServer(BASE)
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox'],
})

try {
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
  // dismiss the welcome toast if present
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

  // 3) 3D preview — tee
  await page.evaluate(() => window.__tshop.getState().setMode('3d'))
  await page.waitForFunction(() => document.body.innerText.includes('Drag to rotate'), { timeout: 60000 })
  await page.waitForTimeout(3000)
  save('3d-tee', await page.evaluate(READBACK, { selector: 'main canvas', bg: { grad: [[0, '#171b22'], [0.55, '#101318'], [1, '#0a0c10']] } }))

  // 4) 3D preview — hoodie
  await page.evaluate(() => window.__tshop.getState().setGarment('hoodie'))
  await page.waitForTimeout(9000)
  save('hoodie', await page.evaluate(READBACK, { selector: 'main canvas', bg: { grad: [[0, '#171b22'], [0.55, '#101318'], [1, '#0a0c10']] } }))
  await page.evaluate(() => { const s = window.__tshop.getState(); s.setGarment('tee'); s.setMode('2d') })
  await page.waitForTimeout(800)

  // 5) Volumetric custom garment (inflate harness readback, already on dark bg)
  await page.goto(BASE + '/dev/inflate.html', { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForFunction(() => !!window.__inflate && window.__inflate.ok, { timeout: 20000 })
  await page.waitForTimeout(600)
  save('3d-custom', await page.evaluate(() => { window.__inflate.setView('threequarter'); return window.__inflate.probe().dataUrl }))

  // 6) AR modal (QR) — back on the studio, force autosave so the AR page has a design
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForFunction(() => !!window.__tshop, { timeout: 20000 })
  await page.waitForTimeout(1000)
  await page.evaluate(() => { const s = window.__tshop.getState(); s.setColor(s.design.colorId); s.openModal('ar') })
  await page.waitForFunction(() => { const i = document.querySelector('img[alt*="QR"],img[alt*="RA"]'); return i && i.getAttribute('src')?.startsWith('data:image') }, { timeout: 15000 })
  await page.waitForTimeout(500)
  {
    const modal = page.locator('[role="dialog"]').first()
    await modal.screenshot({ path: `${DIR}/ar-qr.png` })
    console.log('saved ar-qr')
  }
  await page.evaluate(() => window.__tshop.getState().closeModal('ar'))
  await page.waitForTimeout(1400) // let autosave flush

  // 7) AR mannequin try-on (portrait viewport, readback over a soft room gradient)
  await page.setViewportSize({ width: 560, height: 900 })
  await page.goto(BASE + '/ar.html', { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForFunction(() => !!window.__arScene, { timeout: 25000 })
  await page.waitForTimeout(900)
  save('ar', await page.evaluate(() => new Promise((resolve) => {
    window.__arScene.__probe()
    const gl = document.querySelector('#ar-root canvas')
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const c = document.createElement('canvas'); c.width = gl.width; c.height = gl.height
      const x = c.getContext('2d')
      const g = x.createLinearGradient(0, 0, 0, c.height)
      g.addColorStop(0, '#3a4150'); g.addColorStop(0.55, '#262b34'); g.addColorStop(1, '#15181e')
      x.fillStyle = g; x.fillRect(0, 0, c.width, c.height)
      x.drawImage(gl, 0, 0)
      resolve(c.toDataURL('image/png'))
    }))
  })))
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
  await mp.evaluate(() => { const s = window.__tshop.getState(); const l = s.design.layers.find((x) => x.side === 'front'); if (l) s.select(l.id) })
  await mp.waitForTimeout(600)
  await mp.screenshot({ path: `${DIR}/mobile-edit.png`, animations: 'disabled' })
  console.log('saved mobile-edit')
  await mctx.close()

  console.log('\nAll README screenshots regenerated in', DIR)
} finally {
  await browser.close()
}
