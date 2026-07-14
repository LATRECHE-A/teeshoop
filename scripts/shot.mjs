// Screenshot helper: node scripts/shot.mjs <url> <out.png> [width] [height] [waitMs]
import { chromium } from 'playwright'

const [url, out, w = '1440', h = '900', wait = '1400'] = process.argv.slice(2)
if (!url || !out) {
  console.error('usage: node scripts/shot.mjs <url> <out.png> [w] [h] [waitMs]')
  process.exit(1)
}

const browser = await chromium.launch({
  args: [
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--disable-gpu-sandbox',
  ],
})
const page = await browser.newPage({
  viewport: { width: Number(w), height: Number(h) },
  deviceScaleFactor: 2,
})
page.on('pageerror', (e) => console.error('[pageerror]', e.message))
page.on('console', (m) => {
  if (m.type() === 'error') console.error('[console.error]', m.text())
})
await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 })
await page.waitForTimeout(Number(wait))
await page.screenshot({ path: out })
await browser.close()
console.log('saved', out)
