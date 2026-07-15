/**
 * End-to-end verification against a served build (immune to HMR reloads).
 * Usage: node scripts/e2e-verify.mjs <baseUrl> <outDir>
 *
 * The app now ships French-by-default with a light/dark theme and preview
 * scenes. The main flow pins prefs to EN/dark/studio (via addInitScript) so the
 * text assertions stay stable, and dedicated checks cover the French default,
 * the theme toggle and scene switching.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'

const [base = 'http://localhost:4173', outDir = '/tmp/e2e'] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })
const out = (n) => `${outDir}/${n}.png`
const results = []
const ok = (name, pass, extra = '') => {
  results.push({ name, pass, extra })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${extra}`)
}

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
})

try {
  // ---- 0. French-by-default (fresh context, no stored prefs) -------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 } })
    const p = await ctx.newPage()
    const frErrors = []
    p.on('pageerror', (e) => frErrors.push(e.message.slice(0, 200)))
    await p.goto(base, { waitUntil: 'networkidle', timeout: 45000 })
    await p.waitForTimeout(2600)
    ok('default-lang-fr', (await p.evaluate(() => document.documentElement.lang)) === 'fr')
    ok('default-theme-dark', (await p.evaluate(() => document.documentElement.dataset.theme)) === 'dark')
    ok('french-continue', await p.getByRole('button', { name: /Continuer/ }).isVisible().catch(() => false))
    ok('lang-toggle-present', (await p.getByRole('group', { name: /langue/i }).count()) > 0)
    ok('scene-picker-present', (await p.getByRole('button', { name: /ambiance/i }).count()) > 0)
    await p.screenshot({ path: out('e0-french-default'), animations: 'disabled', timeout: 30000 }).catch(() => {})
    ok('french-no-errors', frErrors.length === 0, frErrors.slice(0, 2).join(' | '))
    await ctx.close()
  }

  // ---- main flow pinned to EN / dark / studio ----------------------------
  const context = await browser.newContext({ viewport: { width: 1440, height: 860 } })
  await context.addInitScript(() => {
    try {
      localStorage.setItem('tshop:prefs', JSON.stringify({ theme: 'dark', lang: 'en', scene: 'studio' }))
    } catch {}
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)))
  page.on('crash', () => errors.push('PAGE CRASH'))
  const shot = (n) =>
    page.screenshot({ path: out(n), animations: 'disabled', timeout: 30000 }).catch(() => {})

  // 1. boot + sample design
  await page.goto(base, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(2800)
  ok('boot', await page.evaluate(() => document.querySelectorAll('canvas').length > 0))
  await shot('e1-boot')

  // 2. select + transform chip
  await page.mouse.click(870, 355)
  await page.waitForTimeout(700)
  ok('select-shows-properties', await page.getByText('Letter spacing').isVisible().catch(() => false))

  // 3. drag with snapping
  await page.mouse.move(870, 355)
  await page.mouse.down()
  await page.mouse.move(820, 470, { steps: 10 })
  await page.mouse.move(872, 360, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Escape')

  // 3b. theme toggle -> light, then back to dark
  await page.getByRole('button', { name: 'Switch to light theme' }).click({ timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(500)
  ok('theme-light', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light')
  await shot('e1b-light')
  await page.getByRole('button', { name: 'Switch to dark theme' }).click({ timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(400)
  ok('theme-back-dark', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark')

  // 3c. scene switch -> beach (backdrop applied in 2D)
  await page.getByRole('button', { name: 'Choose scene' }).click({ timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(300)
  await page.getByRole('option', { name: /Beach/ }).click({ timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(500)
  const sceneApplied = await page.evaluate(() => !!document.querySelector('.scene-surface'))
  ok('scene-beach-applied', sceneApplied)
  await shot('e1c-beach')

  // 4. 3D mode
  await page.locator('button[aria-pressed]').filter({ hasText: '3D' }).first().click({ force: true, noWaitAfter: true })
  const readyOk = await page
    .waitForFunction(() => document.body.innerText.includes('Drag to rotate'), { timeout: 60000 })
    .then(() => true)
    .catch(() => false)
  ok('3d-ready-signal', readyOk)
  if (readyOk) {
    await page.waitForTimeout(2500)
    const px = await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const c = document.querySelector('main canvas')
              if (!c) return resolve(null)
              try {
                const d = c.toDataURL('image/png')
                resolve(d.length)
              } catch {
                resolve(null)
              }
            }),
          )
        }),
    )
    ok('3d-canvas-has-pixels', px !== null && px > 20000, `dataUrl ${px} bytes`)
    const durl = await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const c = document.querySelector('main canvas')
              resolve(c ? c.toDataURL('image/png') : null)
            }),
          )
        }),
    )
    if (durl) fs.writeFileSync(out('e2-3d-tee'), Buffer.from(durl.split(',')[1], 'base64'))
    // camera snap + hoodie in 3D
    await page.getByText('Pullover Hoodie').click({ force: true, timeout: 8000, noWaitAfter: true })
    await page.waitForTimeout(9000)
    const durl2 = await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const c = document.querySelector('main canvas')
              resolve(c ? c.toDataURL('image/png') : null)
            }),
          )
        }),
    )
    if (durl2) {
      fs.writeFileSync(out('e3-3d-hoodie'), Buffer.from(durl2.split(',')[1], 'base64'))
      ok('3d-hoodie-renders', durl2.length > 20000, `${durl2.length} bytes`)
    } else ok('3d-hoodie-renders', false)
  }

  // 5. back to 2D, hoodie art
  await page.locator('button[aria-pressed]').filter({ hasText: '2D' }).first().click({ force: true, noWaitAfter: true })
  await page.waitForTimeout(1500)
  await shot('e4-hoodie-2d')

  // 6. order modal quote math
  await page.getByRole('button', { name: /Continue/ }).click({ noWaitAfter: true })
  await page.waitForTimeout(1500)
  const total = await page.evaluate(() => document.body.innerText.match(/\$[\d,.]+/g)?.slice(-1)[0])
  ok('order-modal-quote', !!total, total ?? '')
  await shot('e5-order')
  await page.keyboard.press('Escape')

  // 7. mobile layout
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(1200)
  await shot('e6-mobile')
  ok('mobile-canvas', await page.evaluate(() => document.querySelectorAll('canvas').length > 0))

  ok('zero-page-errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
