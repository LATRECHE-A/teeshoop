/**
 * Regenerate the AR README screenshots (docs/screens/ar-qr.png + ar.png).
 * These need the Cloudflare Worker + R2, so this runs `wrangler dev` against a
 * prior build (unlike readme-shots.mjs, which uses vite dev + DEV probes):
 *   npm run build:only && node scripts/ar-shots.mjs
 *
 * Drives the real UI (no probes): enters 3D, opens "View in AR" (which bakes the
 * design, uploads GLB/USDZ to R2 and shows a QR), screenshots the modal, then
 * opens the viewer page and reads back its 3D mannequin over a room gradient.
 */
import { spawn } from 'node:child_process'
import { writeFileSync, existsSync } from 'node:fs'
import { chromium } from 'playwright'

const PORT = 8790
const BASE = `http://127.0.0.1:${PORT}`
const DIR = 'docs/screens'

if (!existsSync('dist/v.html')) {
  console.error('❌ dist not built — run `npm run build:only` first')
  process.exit(1)
}

const waitServer = (url, ms = 60000) =>
  new Promise((res, rej) => {
    const s = Date.now()
    const t = async () => {
      try { const r = await fetch(url); if (r.ok || r.status === 404) return res() } catch {}
      if (Date.now() - s > ms) return rej(new Error('wrangler dev timeout'))
      setTimeout(t, 500)
    }
    t()
  })

// rAF x2, then read the viewer canvas composited over a soft room gradient.
const READBACK_GRAD = (selector) =>
  new Promise((resolve) => {
    const gl = document.querySelector(selector)
    if (!gl) return resolve(null)
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const c = document.createElement('canvas')
        c.width = gl.width
        c.height = gl.height
        const x = c.getContext('2d')
        const g = x.createLinearGradient(0, 0, 0, c.height)
        g.addColorStop(0, '#3a4150')
        g.addColorStop(0.55, '#262b34')
        g.addColorStop(1, '#15181e')
        x.fillStyle = g
        x.fillRect(0, 0, c.width, c.height)
        x.drawImage(gl, 0, 0)
        resolve(c.toDataURL('image/png'))
      }),
    )
  })

const server = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--log-level', 'error'], { cwd: process.cwd(), stdio: 'ignore' })
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox'],
})
const done = (code) => { try { browser.close() } catch {} try { server.kill('SIGTERM') } catch {} process.exit(code) }

try {
  await waitServer(BASE + '/')
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 850 }, deviceScaleFactor: 1 })
  await ctx.addInitScript(() => { try { localStorage.setItem('tshop:prefs', JSON.stringify({ theme: 'dark', lang: 'en', scene: 'studio', showGuides: false })) } catch {} })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.error('[pageerror]', e.message))
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 45000 })

  // Open the AR modal from the 2D Share panel. Staying in 2D keeps the export
  // fast — a running 3D scene would starve the CPU-side GLB/USDZ export under
  // swiftshader. The modal bakes the design, uploads to R2 and shows the QR.
  await page.getByRole('button', { name: /Share/i }).first().click({ timeout: 20000 })
  await page.locator('[role="dialog"]').first().waitFor({ state: 'visible', timeout: 10000 })
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: /View in AR/i }).first().click({ timeout: 20000 })
  // The GLB+USDZ export is CPU-bound and very slow under headless swiftshader
  // (~75s; ~2s on a real device), so poll generously for the QR to appear.
  let gotQr = false
  for (let i = 0; i < 32 && !gotQr; i++) {
    await page.waitForTimeout(4000)
    gotQr = await page.evaluate(() => {
      const q = document.querySelector('img[alt*="QR"]')
      return !!(q && (q.getAttribute('src') || '').startsWith('data:image'))
    })
  }
  if (!gotQr) { console.error('❌ QR never appeared (bake/upload failed)'); done(1) }
  await page.waitForTimeout(500)
  await page.locator('[role="dialog"]').first().screenshot({ path: `${DIR}/ar-qr.png` })
  console.log('saved ar-qr')
  const vurl = await page.locator('a[href*="/v/"]').first().getAttribute('href')
  if (!vurl) { console.error('❌ no viewer URL from the AR modal'); done(1) }
  console.log('viewer url:', vurl)
  console.log('\n✅ AR QR screenshot regenerated (ar-qr.png). The viewer hero (ar.png) is produced by readme-shots.mjs.')
  done(0)
} catch (e) {
  console.error('❌', e?.message || e)
  done(1)
}
