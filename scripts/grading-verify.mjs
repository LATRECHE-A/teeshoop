/**
 * Headless PRINT-GRADING verification.
 *
 * Grading means a bigger garment carries a proportionally bigger print. Two
 * independent things must hold, and they are checked separately because they
 * can fail independently:
 *
 *  1. THE PRINTED FILE. `renderPrintArea` is the actual transfer. In `scaled`
 *     mode its physical size must track k = halfChest(size)/halfChest(base)
 *     exactly; in `fixed` mode it must not move at all. This is the one that
 *     costs money if it is wrong: it is what gets sent to the printer.
 *
 *  2. THE VISUAL RESULT. In the 2D mockup the print's width relative to the
 *     garment's width must be CONSTANT across sizes when grading (that is what
 *     "reads identically on every size" means), and must vary as 1/chestRatio
 *     when fixed. Constant-ratio is a strong test: the print scales by
 *     chest(size)/chest(base) while the garment art scales by
 *     chest(size)/chest(nominal), so the ratio collapses to a size-independent
 *     constant only if BOTH scalings are applied correctly.
 *
 *   node scripts/grading-verify.mjs
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = 5197
const BASE = `http://localhost:${PORT}`
const SIZES = (process.env.GRADE_SIZES || 'S,M,3XL').split(',')
const TOL = 0.02 // 2 %, pixel quantisation of the bbox measurement

const waitFor = (url, ms = 40000) =>
  new Promise((res, rej) => {
    const s = Date.now()
    const t = async () => {
      try { if ((await fetch(url)).ok) return res() } catch {}
      if (Date.now() - s > ms) return rej(new Error('dev server timeout'))
      setTimeout(t, 400)
    }
    t()
  })

const MEASURE = `
window.__g = {
  bbox(d, W, H, pred) {
    let minX = W, minY = H, maxX = -1, maxY = -1
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      if (pred(d[i], d[i+1], d[i+2], d[i+3])) {
        if (x<minX)minX=x; if (x>maxX)maxX=x; if (y<minY)minY=y; if (y>maxY)maxY=y
      }
    }
    return maxX < 0 ? null : { x: minX, y: minY, w: maxX-minX+1, h: maxY-minY+1 }
  },
  isGreen: (r,g,b,a) => a > 70 && g > 80 && g > r + 14 && g > b + 8,
  isMagenta: (r,g,b,a) => a > 70 && r > 105 && b > 105 && g < r - 28 && g < b - 28,
}
`

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: process.cwd(), stdio: 'ignore' })
let browser
let fail = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ': ' + detail : ''}`)
  if (!ok) fail++
}
const done = (code) => { try { browser?.close() } catch {} try { server.kill('SIGTERM') } catch {} process.exit(code) }

try {
  await waitFor(BASE)
  browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] })
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 }, reducedMotion: 'reduce' })
  await ctx.addInitScript(() => { try { localStorage.setItem('tshop:prefs', JSON.stringify({ theme: 'dark', lang: 'en', scene: 'studio', showGuides: false })) } catch {} })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push('[console] ' + m.text()))
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForFunction(() => window.__tshop && window.__render && window.__sizes, { timeout: 20000 })
  await page.addScriptTag({ content: MEASURE })

  // Seed: kelly-green tee + a magenta rectangle filling the FRONT print area.
  await page.evaluate(async () => {
    const assets = await window.__assets()
    const c = document.createElement('canvas'); c.width = 300; c.height = 400
    const x = c.getContext('2d'); x.fillStyle = '#ff2ad0'; x.fillRect(0, 0, 300, 400)
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
    const meta = await assets.addAsset(blob, 'grade')
    const s = window.__tshop.getState()
    s.setGarment('tee'); s.setColor('kelly'); s.setSide('front'); s.addImageLayer(meta)
    const st = window.__tshop.getState()
    const l = st.design.layers[st.design.layers.length - 1]
    st.patchLayer(l.id, { xIn: 0, yIn: 0, wIn: 12, hIn: 16 })
  })
  await page.waitForTimeout(400)

  const chart = await page.evaluate(async () => {
    const { sizeSpecCm } = await window.__sizes()
    return Object.fromEntries(['S', 'M', 'L', 'XL', '2XL', '3XL'].map((s) => [s, sizeSpecCm('tee', s).halfChestCm]))
  })
  const BASE_SIZE = 'M'
  console.log('tee half-chest cm:', JSON.stringify(chart), '· base', BASE_SIZE, '\n')

  for (const mode of ['fixed', 'scaled']) {
    console.log(`-- mode: ${mode} --`)
    const rows = {}
    for (const size of SIZES) {
      rows[size] = await page.evaluate(
        async ({ mode, size, baseSize }) => {
          const { renderMockup, renderPrintArea, getAreaSizeIn } = await window.__render()
          window.__tshop.setState((s) => ({ design: { ...s.design, printScale: { mode, baseSize } } }))
          window.__tshop.getState().setPreviewSize(size)
          const design = window.__tshop.getState().design
          // 1. the printed file itself
          const area = getAreaSizeIn(design, 'front', size)
          const print = await renderPrintArea(design, 'front', 100, size)
          // 2. the visual result
          const cv = await renderMockup(design, 'front', 900, size)
          const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
          const g = window.__g.bbox(d, cv.width, cv.height, window.__g.isGreen)
          const m = window.__g.bbox(d, cv.width, cv.height, window.__g.isMagenta)
          return {
            areaWIn: area.wIn,
            areaHIn: area.hIn,
            printPx: print ? { w: print.width, h: print.height } : null,
            ratioW: g && m ? m.w / g.w : null,
            garmentW: g?.w ?? null,
            printW: m?.w ?? null,
          }
        },
        { mode, size, baseSize: BASE_SIZE },
      )
    }

    for (const size of SIZES) {
      const r = rows[size]
      console.log(
        `  ${size.padEnd(3)} area ${r.areaWIn.toFixed(2)}×${r.areaHIn.toFixed(2)}in` +
          `  file ${r.printPx ? r.printPx.w + '×' + r.printPx.h + 'px' : 'none'}` +
          `  ratioW ${r.ratioW?.toFixed(4) ?? 'n/a'}  [garment ${r.garmentW}px, print ${r.printW}px]`,
      )
    }

    // --- 1. the printed file tracks k exactly ---
    for (const size of SIZES) {
      const k = mode === 'scaled' ? chart[size] / chart[BASE_SIZE] : 1
      const expectW = 12 * k
      const got = rows[size].areaWIn
      const err = Math.abs(got / expectW - 1)
      check(
        `${mode}/${size}: printed area is ${expectW.toFixed(2)}in wide (k=${k.toFixed(4)})`,
        err < 0.001,
        `got ${got.toFixed(3)}in`,
      )
      const px = rows[size].printPx
      if (px) {
        const errPx = Math.abs(px.w / Math.round(expectW * 100) - 1)
        check(`${mode}/${size}: transfer raster matches the area`, errPx < 0.01, `${px.w}px vs ${Math.round(expectW * 100)}px`)
      }
    }

    // --- 2. the visual result ---
    const ratios = SIZES.map((s) => rows[s].ratioW).filter((v) => typeof v === 'number')
    const spread = Math.max(...ratios) - Math.min(...ratios)
    const rel = spread / (ratios.reduce((a, b) => a + b, 0) / ratios.length)
    if (mode === 'scaled') {
      check(
        'scaled: print/garment ratio is CONSTANT across sizes (identical look)',
        rel < TOL,
        `spread ${spread.toFixed(4)} = ${(rel * 100).toFixed(2)}% of mean`,
      )
    } else {
      // fixed: a fixed print on a growing garment ⇒ ratio ∝ 1/chestRatio
      let worst = 0
      for (const size of SIZES) {
        const expect = rows[BASE_SIZE].ratioW * (chart[BASE_SIZE] / chart[size])
        worst = Math.max(worst, Math.abs(rows[size].ratioW / expect - 1))
      }
      check('fixed: print/garment ratio varies as 1/chestRatio (one film)', worst < TOL, `worst ${(worst * 100).toFixed(2)}%`)
    }
    console.log()
  }

  if (errors.length) console.error('⚠ page errors:', errors.slice(0, 4).join(' | '))
  console.log(fail ? `❌ ${fail} check(s) failed` : '✅ grading verify PASS')
  done(fail ? 2 : 0)
} catch (e) {
  console.error('❌', e?.message || e)
  done(1)
}
