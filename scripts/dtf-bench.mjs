/**
 * DTF nesting benchmark — shelf packer vs the true-shape packer.
 *
 * Runs the REAL bundle in a headless browser (same pattern as dtf-verify.mjs)
 * so the numbers come from the shipped code, not a transcription of it. Four
 * synthetic-but-representative instances plus one built from the sample design
 * rendered through `renderPiece`, i.e. the actual studio pipeline, masks and
 * all.
 *
 *   node scripts/dtf-bench.mjs
 *   BENCH_JSON=/abs/path.json node scripts/dtf-bench.mjs
 */
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const PORT = 5199
const BASE = `http://localhost:${PORT}`
const JSON_OUT = process.env.BENCH_JSON

const waitFor = (url, ms = 40000) =>
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

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(),
  stdio: 'ignore',
})
let browser
let code = 1
const done = (c) => {
  try { browser?.close() } catch {}
  try { server.kill('SIGTERM') } catch {}
  process.exit(c)
}

try {
  await waitFor(BASE)
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('pageerror', (e) => console.error('[pageerror]', e.message))
  // 'networkidle' never settles here: this harness spawns a Web Worker, whose
  // vite HMR socket keeps the network permanently busy. The real readiness
  // signal is window.__dtf, which the next statement already waits on.
  await page.goto(BASE + '/dev/dtf.html', { waitUntil: 'load', timeout: 60000 })
  await page.waitForFunction(() => !!window.__dtf, { timeout: 25000 })

  const out = await page.evaluate(async () => {
    const { nest, shape, samplePieces, interlockMax } = window.__dtf
    const interlockStops = window.__dtf.interlockStops

    // --- synthetic artwork -> alpha masks -------------------------------
    // Shapes chosen for their bbox fill: circle 78 %, star ~40 %, wordmark
    // ~35 %, arch ~30 %. Rendered on a canvas so the mask pipeline under test
    // is the same one the modal uses.
    const RES = 0.1 // cm per mask cell
    function maskOf(kind, wCm, hCm) {
      const W = Math.max(2, Math.round(wCm / RES))
      const H = Math.max(2, Math.round(hCm / RES))
      const c = document.createElement('canvas')
      c.width = W
      c.height = H
      const x = c.getContext('2d')
      x.fillStyle = '#000'
      if (kind === 'rect') x.fillRect(0, 0, W, H)
      else if (kind === 'circle') {
        x.beginPath()
        x.ellipse(W / 2, H / 2, W / 2, H / 2, 0, 0, Math.PI * 2)
        x.fill()
      } else if (kind === 'star') {
        x.beginPath()
        for (let i = 0; i < 10; i++) {
          const r = i % 2 ? 0.42 : 1
          const a = (i / 10) * Math.PI * 2 - Math.PI / 2
          const px = W / 2 + Math.cos(a) * (W / 2) * r
          const py = H / 2 + Math.sin(a) * (H / 2) * r
          i ? x.lineTo(px, py) : x.moveTo(px, py)
        }
        x.closePath()
        x.fill()
      } else if (kind === 'word') {
        // A wordmark: a low central band plus a few ascenders.
        x.fillRect(0, H * 0.42, W, H * 0.34)
        for (let i = 0; i < 4; i++) x.fillRect(W * (0.08 + i * 0.24), 0, W * 0.08, H)
      } else if (kind === 'arch') {
        x.beginPath()
        x.ellipse(W / 2, H, W / 2, H, 0, Math.PI, 0)
        x.fill()
        x.globalCompositeOperation = 'destination-out'
        x.beginPath()
        x.ellipse(W / 2, H, W * 0.32, H * 0.64, 0, Math.PI, 0)
        x.fill()
      } else if (kind === 'tri') {
        x.beginPath()
        x.moveTo(W / 2, 0)
        x.lineTo(W, H)
        x.lineTo(0, H)
        x.closePath()
        x.fill()
      }
      const d = x.getImageData(0, 0, W, H).data
      const m = new Uint8Array(W * H)
      let ink = 0
      for (let i = 0; i < m.length; i++)
        if (d[i * 4 + 3] >= 8) {
          m[i] = 1
          ink++
        }
      return { mask: m, maskW: W, maskH: H, fill: ink / m.length }
    }

    const mk = (id, kind, wCm, hCm, qty) => {
      const m = maskOf(kind, wCm, hCm)
      return {
        id,
        sourceKey: id,
        wCm,
        hCm,
        qty,
        allowRotate: true,
        mask: m.mask,
        maskW: m.maskW,
        maskH: m.maskH,
        __fill: m.fill,
      }
    }

    const instances = {
      // All rectangles: the packer has nothing to exploit but the search.
      rects: [
        mk('a', 'rect', 21, 29.7, 24),
        mk('b', 'rect', 9, 9, 40),
        mk('c', 'rect', 30, 40, 8),
      ],
      // Chest logos: circles + stars, the everyday boutique order.
      logos: [
        mk('a', 'circle', 12, 12, 40),
        mk('b', 'star', 18, 18, 18),
        mk('c', 'circle', 26, 26, 10),
      ],
      // A realistic apparel mix: big fronts, wordmarks, small chest marks.
      apparel: [
        mk('a', 'word', 28, 12, 30),
        mk('b', 'circle', 10, 10, 36),
        mk('c', 'rect', 30, 38, 10),
        mk('d', 'star', 16, 16, 14),
      ],
      // Deeply concave art, where true-shape nesting earns the most.
      concave: [
        mk('a', 'arch', 30, 18, 22),
        mk('b', 'tri', 24, 22, 20),
        mk('c', 'word', 34, 10, 20),
      ],
    }

    // --- real basket: the sample design rendered through renderPiece -----
    const rendered = await samplePieces(48)
    instances.basket = rendered.map((p, i) => ({
      id: p.key,
      sourceKey: p.key,
      wCm: p.wCm,
      hCm: p.hCm,
      qty: [12, 8, 6, 4][i % 4],
      allowRotate: true,
      ...(p.mask ? { mask: p.mask.mask, maskW: p.mask.maskW, maskH: p.mask.maskH } : {}),
      __fill: p.mask ? p.mask.fillRatio : 1,
    }))

    // 58 cm printable width, 5 mm gap, 0 margins — the researched defaults.
    const base = {
      printableWidthCm: 58,
      maxLengthCm: 250,
      gapCm: 0.5,
      edgeMarginCm: 0,
      edgeMarginSideCm: 0,
      edgeMarginEndCm: 0,
      billingStepCm: 10,
    }

    const strip = (ps) => ps.map(({ __fill, ...rest }) => rest)
    const rows = []
    for (const [name, piecesRaw] of Object.entries(instances)) {
      const pieces = strip(piecesRaw)
      const bboxFill =
        piecesRaw.reduce((a, p) => a + p.__fill * p.qty, 0) /
        piecesRaw.reduce((a, p) => a + p.qty, 0)
      const qty = piecesRaw.reduce((a, p) => a + p.qty, 0)

      const t0 = performance.now()
      const shelf = nest(pieces, base)
      const tShelf = performance.now() - t0

      const run = (interlock, restarts, flip) => {
        const ps = flip ? pieces.map((p) => ({ ...p, allowFlip: true })) : pieces
        const t = performance.now()
        const r = shape({
          pieces: ps,
          options: { ...base, maxInterlockCm: interlock, restarts },
        })
        return {
          lengthCm: r.totalLengthCm,
          util: r.totalUtilization,
          ink: r.totalInkUtilization ?? null,
          sheets: r.sheets.length,
          pieces: r.totalPieces,
          ms: Math.round(performance.now() - t),
        }
      }

      // The slider is a CEILING, and the packer sweeps every rung below it, so
      // a bigger setting must never buy more film. This is the assertion that
      // keeps that true: without the sweep the logo set packed into 340 cm at
      // "maximum" and 380 cm at "jeu 2 cm", i.e. the operator paid 12 % extra
      // for asking for more fill.
      const ladder = interlockStops.map(
        (s) => shape({ pieces, options: { ...base, maxInterlockCm: s, restarts: 12 } }).totalLengthCm,
      )
      const monotone = ladder.every((v, i) => i === 0 || v <= ladder[i - 1] + 1e-6)

      rows.push({
        instance: name,
        qty,
        ladder,
        monotone,
        bboxFill: Math.round(bboxFill * 1000) / 1000,
        shelf: {
          lengthCm: shelf.totalLengthCm,
          util: shelf.totalUtilization,
          sheets: shelf.sheets.length,
          pieces: shelf.totalPieces,
          ms: Math.round(tShelf),
        },
        strips: run(0, 12, false),
        interlock2: run(2, 12, false),
        maxFill: run(interlockMax, 12, false),
        maxFillFlip: run(interlockMax, 12, true),
        restarts24: run(interlockMax, 24, false),
      })
    }
    return rows
  })

  const pc = (a, b) => (b > 0 ? `${(((a - b) / a) * 100).toFixed(1)} %` : '—')
  const fmt = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)} %`)
  console.log(
    '\ninstance   qty  bboxFill |  shelf cm  |  strips cm |  jeu2cm  |  maxfill |  +flip  | 24 essais | gain maxfill',
  )
  console.log('-'.repeat(118))
  for (const r of out)
    console.log(
      `${r.instance.padEnd(10)} ${String(r.qty).padStart(3)}  ` +
        `${(r.bboxFill * 100).toFixed(0).padStart(6)} % | ` +
        `${r.shelf.lengthCm.toFixed(1).padStart(9)} | ` +
        `${r.strips.lengthCm.toFixed(1).padStart(10)} | ` +
        `${r.interlock2.lengthCm.toFixed(1).padStart(8)} | ` +
        `${r.maxFill.lengthCm.toFixed(1).padStart(8)} | ` +
        `${r.maxFillFlip.lengthCm.toFixed(1).padStart(7)} | ` +
        `${r.restarts24.lengthCm.toFixed(1).padStart(9)} | ` +
        `${pc(r.shelf.lengthCm, r.maxFill.lengthCm).padStart(8)}`,
    )
  console.log('\nutilisation (boîte / encre) and timing')
  console.log('-'.repeat(80))
  for (const r of out)
    console.log(
      `${r.instance.padEnd(10)} shelf ${fmt(r.shelf.util).padStart(5)} / —      ` +
        `maxfill ${fmt(r.maxFill.util).padStart(5)} / ${fmt(r.maxFill.ink).padStart(5)}   ` +
        `${String(r.maxFill.ms).padStart(5)} ms (12 restarts) · ` +
        `${String(r.restarts24.ms).padStart(5)} ms (24)`,
    )

  const totalShelf = out.reduce((a, r) => a + r.shelf.lengthCm, 0)
  const totalMax = out.reduce((a, r) => a + r.maxFill.lengthCm, 0)
  const totalFlip = out.reduce((a, r) => a + r.maxFillFlip.lengthCm, 0)
  console.log(
    `\nTOTAL shelf ${totalShelf.toFixed(1)} cm → maxfill ${totalMax.toFixed(1)} cm ` +
      `(${pc(totalShelf, totalMax)}) · with 180°/270° ${totalFlip.toFixed(1)} cm ` +
      `(${pc(totalMax, totalFlip)} more)`,
  )
  for (const r of out)
    if (r.shelf.pieces !== r.maxFill.pieces)
      console.error(`⚠ ${r.instance}: piece count differs (${r.shelf.pieces} vs ${r.maxFill.pieces})`)

  console.log('\ninterlock ladder (cm par cran, doit être décroissant)')
  console.log('-'.repeat(80))
  let bad = 0
  for (const r of out) {
    console.log(`${r.instance.padEnd(10)} ${r.ladder.map((v) => String(v).padStart(6)).join(' ')}` +
      (r.monotone ? '' : '   ⚠ NON MONOTONE'))
    if (!r.monotone) bad++
  }
  if (bad) {
    console.error(`❌ ${bad} instance(s) get WORSE when the interlock ceiling is raised`)
    if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(out, null, 2))
    done(1)
  }

  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(out, null, 2))
  code = 0
} catch (e) {
  console.error('❌', e?.stack || e?.message || e)
}
done(code)
