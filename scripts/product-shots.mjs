#!/usr/bin/env node
/**
 * Screenshots of the product page, at the widths the design was written for.
 *
 *   node scripts/product-shots.mjs [url] [outDir]
 *
 * Mobile first is a claim, and a claim needs a picture. 375 px is the width the
 * CSS was authored at, 768 px is the fold where the layout widens, 1440 px is
 * what a buyer at a desk sees. It also drives the estimator once, so the shot
 * shows a live total rather than the page's first paint.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const URL_ = process.argv[2] || 'http://localhost:8080/product/teeshoop-demo-tee/'
const OUT = process.argv[3] || 'docs/screens/session02'
const WIDTHS = [375, 768, 1440]

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const errors = []

for (const width of WIDTHS) {
  const context = await browser.newContext({
    viewport: { width, height: width < 500 ? 900 : 1000 },
    deviceScaleFactor: 2,
    locale: 'fr-FR',
  })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(`[${width}] ${e.message.slice(0, 200)}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${width}] console: ${m.text().slice(0, 200)}`)
  })

  await page.goto(URL_, { waitUntil: 'networkidle', timeout: 45000 })
  await page.screenshot({ path: `${OUT}/product-${width}.png`, fullPage: true })

  // The B2B path: several sizes, which is also what makes the estimator move.
  // Clicked through the label, the way a person does: the radio itself is
  // visually hidden by design, so a direct .check() is not a real interaction.
  const gridMode = page.locator('.ts-seg__item:has([data-teeshoop-mode][value="grid"])')
  if (await gridMode.count()) {
    await gridMode.click()
    const inputs = page.locator('[data-teeshoop-pane="grid"] input[type="number"]')
    const n = await inputs.count()
    for (let i = 0; i < Math.min(n, 3); i++) await inputs.nth(i).fill(String(10 + i * 5))
    await page.waitForTimeout(1200)
    await page
      .locator('[data-teeshoop-buy]')
      .screenshot({ path: `${OUT}/buybox-grid-${width}.png` })
      .catch(() => {})
  }

  await context.close()
}

await browser.close()

if (errors.length) {
  console.error('page errors:\n  ' + errors.join('\n  '))
  process.exit(1)
}
console.log(`wrote ${WIDTHS.length * 2} shots to ${OUT}`)
