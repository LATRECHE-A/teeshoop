#!/usr/bin/env node
/**
 * The product page, driven and photographed.
 *
 *   node scripts/product-shots.mjs [url] [outDir]
 *
 * Mobile first is a claim, and a claim needs a picture. 375 px is the width the
 * CSS was authored at, 768 px is the fold where the layout widens, 1440 px is
 * what a buyer at a desk sees.
 *
 * IT ALSO ASSERTS, because the worst defect this page has had was invisible to
 * every gate in the repository. `Array.prototype.slice.call(params.keys())`
 * returns an empty array (a URLSearchParams iterator has no `length`), so the
 * loop meant to clear stale sizes off the Personnaliser link never ran once:
 * a buyer who put 3 into M and then back to 0 carried `tailles[M]=3` into the
 * studio, and three garments nobody ordered reached the workshop as sizes to
 * press. PHP tests cannot see it, the WooCommerce suite cannot see it, and the
 * end-to-end harness never touches this control. A browser can.
 *
 * Exit: 0 all assertions passed - 1 an assertion failed - 2 nothing was asserted.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const URL_ = process.argv[2] || 'http://localhost:8080/product/teeshoop-demo-tee/'
const OUT = process.argv[3] || 'docs/screens/session02'
const WIDTHS = [375, 768, 1440]

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const errors = []
const results = []
const ok = (name, pass, extra = '') => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`)
  return pass
}

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

    const total = await page.locator('[data-teeshoop-grid-total]').textContent()
    ok(`[${width}] the size grid totals live`, (total || '').replace(/\D/g, '') === '45', total)

    const summary = await page.locator('[data-teeshoop-for]').textContent()
    ok(
      `[${width}] the estimate agrees with the grid, in the plural`,
      /45\s*pièces/.test(summary || ''),
      summary,
    )

    // THE ONE THAT SHIPPED BROKEN: clear a size and it must leave the link.
    await inputs.nth(0).fill('0')
    await page.waitForTimeout(900)
    const href = await page.locator('[data-teeshoop-personnaliser]').getAttribute('href')
    const carried = decodeURIComponent(href || '')
    ok(
      `[${width}] a size set back to zero leaves the Personnaliser link`,
      !/tailles\[S\]/.test(carried),
      carried.slice(-120),
    )
    ok(
      `[${width}] and the sizes still wanted are carried`,
      /tailles\[M\]=15/.test(carried) && /tailles\[L\]=20/.test(carried),
      carried.slice(-120),
    )

    // A single-size run carries a SIZE, never a bare count for the studio to
    // guess at.
    const singleMode = page.locator('.ts-seg__item:has([data-teeshoop-mode][value="single"])')
    await singleMode.click()
    // Scoped: the devis form carries a `qte` of its own, deliberately, because
    // it is the field this one is mirrored into.
    await page.locator('[data-teeshoop-estimator] input[name="qte"]').fill('40')
    await page.waitForTimeout(900)
    const single = decodeURIComponent(
      (await page.locator('[data-teeshoop-personnaliser]').getAttribute('href')) || '',
    )
    ok(
      `[${width}] a single-size run carries a size, not a bare count`,
      /tailles\[[A-Z0-9]+\]=40/.test(single) && !/[?&]qte=/.test(single),
      single.slice(-120),
    )

    // And the devis form is on the same quantity, since its CTA never reloads.
    const devisQty = await page.locator('.ts-devis__form input[name="qte"]').inputValue()
    ok(`[${width}] the devis form follows the buy box`, devisQty === '40', devisQty)

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

if (results.length === 0) {
  // "Nothing found" and "nothing looked" are different results.
  console.error('product-shots: NO ASSERTIONS RAN. A pass here would mean nothing.')
  process.exit(2)
}

const failed = results.filter((r) => !r.pass)
if (failed.length) {
  console.error(`product-shots FAILED: ${failed.length} of ${results.length} assertions`)
  process.exit(1)
}
console.log(`product-shots PASS: ${results.length} assertions, ${WIDTHS.length * 2} shots in ${OUT}`)
