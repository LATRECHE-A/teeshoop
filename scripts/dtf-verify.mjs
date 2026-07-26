/**
 * Headless verification for the DTF gang-sheet module.
 * Boots Vite dev, loads dev/dtf.html, runs the pure nesting engine's
 * geometry assertions in-page (determinism, gap-aware non-overlap, width
 * bounds, straight full-width corridors, qty expansion, rotation rules,
 * max-length split, utilization floor) and screenshots the admin modal
 * twice (default view, then supplier switch + guides off).
 *   DTF_OUT_DIR=/abs/dir node scripts/dtf-verify.mjs
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const PORT = 5198
const BASE = `http://localhost:${PORT}`
const OUT = process.env.DTF_OUT_DIR

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
  const page = await browser.newPage({ viewport: { width: 1280, height: 920 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push('[console] ' + m.text()))

  await page.goto(BASE + '/dev/dtf.html', { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForFunction(() => !!window.__dtf, { timeout: 20000 })

  // ------------------------------------------------------------------
  // Pure-engine assertion suite (runs in-page against the real bundle)
  // ------------------------------------------------------------------
  const suite = await page.evaluate(() => {
    const { nest } = window.__dtf
    const fails = []
    const TOL = 1e-3
    const opts = { printableWidthCm: 58, maxLengthCm: 250, gapCm: 0.8, edgeMarginCm: 1 }

    const checkGeometry = (res, o, tag) => {
      for (let si = 0; si < res.sheets.length; si++) {
        const s = res.sheets[si]
        for (const p of s.placements) {
          if (p.xCm < o.edgeMarginCm - TOL)
            fails.push(`${tag}#${si}: ${p.id} crosses left margin`)
          if (p.xCm + p.wCm > o.printableWidthCm - o.edgeMarginCm + TOL)
            fails.push(`${tag}#${si}: ${p.id} crosses right margin`)
          if (p.yCm < o.edgeMarginCm - TOL)
            fails.push(`${tag}#${si}: ${p.id} crosses top margin`)
          if (p.yCm + p.hCm > s.rawLengthCm - o.edgeMarginCm + TOL)
            fails.push(`${tag}#${si}: ${p.id} crosses bottom margin`)
        }
        // pairwise AABB with required gap spacing between artworks
        for (let i = 0; i < s.placements.length; i++)
          for (let j = i + 1; j < s.placements.length; j++) {
            const a = s.placements[i]
            const b = s.placements[j]
            const overlap =
              a.xCm < b.xCm + b.wCm + o.gapCm - TOL &&
              b.xCm < a.xCm + a.wCm + o.gapCm - TOL &&
              a.yCm < b.yCm + b.hCm + o.gapCm - TOL &&
              b.yCm < a.yCm + a.hCm + o.gapCm - TOL
            if (overlap) fails.push(`${tag}#${si}: ${a.id} vs ${b.id} closer than gap`)
          }
        // shelf membership (top-aligned, never taller than the shelf)
        for (const p of s.placements) {
          const k = s.shelfYsCm.findIndex((y) => Math.abs(y - p.yCm) < TOL)
          if (k === -1) fails.push(`${tag}#${si}: ${p.id} not top-aligned to a shelf`)
          else if (p.hCm > s.shelfHsCm[k] + TOL)
            fails.push(`${tag}#${si}: ${p.id} taller than its shelf`)
        }
        // straight full-width corridors between shelves
        for (let k = 0; k + 1 < s.shelfYsCm.length; k++) {
          const y0 = s.shelfYsCm[k] + s.shelfHsCm[k]
          const y1 = s.shelfYsCm[k + 1]
          if (y1 - y0 < o.gapCm - TOL)
            fails.push(`${tag}#${si}: corridor ${k} narrower than gap (${(y1 - y0).toFixed(3)})`)
          for (const p of s.placements)
            if (p.yCm < y1 - TOL && p.yCm + p.hCm > y0 + TOL)
              fails.push(`${tag}#${si}: ${p.id} crosses corridor ${k}`)
        }
        if (s.rawLengthCm > o.maxLengthCm + TOL)
          fails.push(`${tag}#${si}: raw length ${s.rawLengthCm} exceeds max ${o.maxLengthCm}`)
        if (Math.abs(s.lengthCm / 10 - Math.round(s.lengthCm / 10)) > 1e-6)
          fails.push(`${tag}#${si}: billed length ${s.lengthCm} not a 10 cm step`)
        if (s.lengthCm + 1e-6 < s.rawLengthCm)
          fails.push(`${tag}#${si}: billed ${s.lengthCm} < raw ${s.rawLengthCm}`)
      }
    }

    // Realistic mixed set: 40× left-chest 9×9, 10× A4, 5× 30×40.
    const mixed = [
      { id: 'chest', sourceKey: 'chest', wCm: 9, hCm: 9, qty: 40, allowRotate: true },
      { id: 'a4', sourceKey: 'a4', wCm: 21, hCm: 29.7, qty: 10, allowRotate: true },
      { id: 'big', sourceKey: 'big', wCm: 30, hCm: 40, qty: 5, allowRotate: true },
    ]

    // determinism (identical + order-shuffled inputs)
    const r1 = nest(mixed, opts)
    if (JSON.stringify(r1) !== JSON.stringify(nest(mixed, opts)))
      fails.push('determinism: identical input produced different output')
    if (JSON.stringify(r1) !== JSON.stringify(nest([...mixed].reverse(), opts)))
      fails.push('determinism: input order changed the output')

    // qty expansion
    const placed = r1.sheets.reduce((a, s) => a + s.placements.length, 0)
    if (placed !== 55 || r1.totalPieces !== 55)
      fails.push(`qty expansion: expected 55 placements, got ${placed}/${r1.totalPieces}`)

    checkGeometry(r1, opts, 'mixed')

    // max-length split
    if (r1.sheets.length < 2) fails.push('expected the mixed set to split across ≥2 sheets')

    // utilization floor
    if (!(r1.totalUtilization > 0.6))
      fails.push(`utilization ${r1.totalUtilization} ≤ 0.6 on the mixed set`)

    // rotation only when allowed
    const noRot = nest(
      [{ id: 'p', sourceKey: 'p', wCm: 10, hCm: 30, qty: 6, allowRotate: false }],
      opts,
    )
    for (const s of noRot.sheets)
      for (const p of s.placements)
        if (p.rotated || Math.abs(p.wCm - 10) > TOL || Math.abs(p.hCm - 30) > TOL)
          fails.push(`rotation applied to allowRotate:false piece (${p.id})`)
    checkGeometry(noRot, opts, 'noRot')

    const rot = nest(
      [{ id: 'p', sourceKey: 'p', wCm: 10, hCm: 30, qty: 6, allowRotate: true }],
      opts,
    )
    checkGeometry(rot, opts, 'rot')

    // unplaceable geometry is reported, never silently dropped into a sheet
    const un = nest(
      [{ id: 'huge', sourceKey: 'huge', wCm: 70, hCm: 10, qty: 2, allowRotate: false }],
      opts,
    )
    if (!un.unplaceable.includes('huge')) fails.push('oversized piece not reported unplaceable')
    if (un.totalPieces !== 0) fails.push('oversized piece was placed anyway')

    // exact gap/margin semantics on a 2-piece shelf
    const two = nest(
      [{ id: 't', sourceKey: 't', wCm: 20, hCm: 10, qty: 2, allowRotate: false }],
      opts,
    )
    const ps = [...(two.sheets[0]?.placements ?? [])].sort((a, b) => a.xCm - b.xCm)
    if (ps.length !== 2) fails.push('two-piece case did not place 2 pieces')
    else {
      if (Math.abs(ps[0].xCm - opts.edgeMarginCm) > TOL)
        fails.push(`left margin ${ps[0].xCm} ≠ ${opts.edgeMarginCm}`)
      if (Math.abs(ps[1].xCm - (ps[0].xCm + ps[0].wCm) - opts.gapCm) > TOL)
        fails.push('artwork-to-artwork spacing ≠ gap')
      if (Math.abs(ps[0].yCm - opts.edgeMarginCm) > TOL)
        fails.push(`top margin ${ps[0].yCm} ≠ ${opts.edgeMarginCm}`)
    }

    return {
      fails,
      stats: {
        sheets: r1.sheets.length,
        totalLm: r1.totalLengthM,
        utilization: r1.totalUtilization,
        perSheet: r1.sheets.map((s) => ({ len: s.lengthCm, util: s.utilization })),
      },
    }
  })

  console.log('engine stats:', JSON.stringify(suite.stats))
  if (suite.fails.length) {
    console.error(`❌ ${suite.fails.length} engine assertion(s) failed:`)
    for (const f of suite.fails.slice(0, 20)) console.error('  -', f)
    done(1)
  }

  // ------------------------------------------------------------------
  // Modal screenshots (2 rounds)
  // ------------------------------------------------------------------
  await page.waitForFunction(() => window.__dtf.previewReady(), { timeout: 25000 })
  await page.waitForTimeout(500)
  if (OUT) {
    mkdirSync(OUT, { recursive: true })
    await page.screenshot({ path: `${OUT}/dtf-modal-1.png` })
  }

  // Round 2: express supplier + guides off — preview must re-nest live.
  await page.selectOption('select[data-dtf="supplier-select"]', 'royaldtf')
  await page.click('input[data-dtf="guides-toggle"]')
  await page.waitForFunction(() => window.__dtf.previewReady(), { timeout: 15000 })
  await page.waitForTimeout(400)
  const round2 = await page.evaluate(() => ({
    sheets: document.querySelectorAll('canvas[data-dtf="sheet-canvas"]').length,
    stats: document.querySelector('[data-dtf="stats"]')?.textContent ?? '',
  }))
  if (round2.sheets < 1) {
    console.error('❌ no preview sheets after supplier switch')
    done(1)
  }
  if (OUT) await page.screenshot({ path: `${OUT}/dtf-modal-2.png` })

  // Round 3: advanced supplier profile + saved-designs picker open.
  await page.click('[data-dtf="advanced-toggle"]')
  await page.click('[data-dtf="add-saved"]')
  await page.waitForTimeout(400)
  if (OUT) await page.screenshot({ path: `${OUT}/dtf-modal-3.png` })

  if (errors.length) {
    console.error('❌ page errors:', errors.slice(0, 5).join(' | '))
    done(1)
  }

  console.log(
    `✅ dtf verify PASS — sheets=${suite.stats.sheets} totalLm=${suite.stats.totalLm} utilization=${suite.stats.utilization}` +
      (OUT ? ` (screenshots in ${OUT})` : ''),
  )
  code = 0
} catch (e) {
  console.error('❌', e?.message || e)
}
done(code)
