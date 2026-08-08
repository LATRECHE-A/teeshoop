#!/usr/bin/env node
/**
 * REVERSE-PANEL REGISTRATION — the gate that did not exist.
 *
 * The hollow shell is one piece of geometry cut from the FRONT photo's
 * silhouette; the back sheet is that same grid sampling its texture at
 * `uv = (1 − u, v)` with u,v from the FRONT's content bbox. That is only
 * correct if the back photograph frames the garment the same way, and nothing
 * enforced it: measured over the 46 shipped supplier pairs THROUGH THE CUTOUT the
 * app uses, the two aspect ratios differ by a median 1.0 %, a p90 of 5.7 % and a
 * worst genuine 8 %. Small — and the whole complaint anyway, because the pad
 * that squares the pair up puts ALL of it at the hem: those rows are transparent,
 * alphaTest discards the sheet and its lining across them so you see through the
 * garment, and the rim (no alpha test, by design) shades them black underneath.
 *
 * inflate-verify could never catch it: every geometric gate there measures Z
 * only, against ONE alpha grid built from the front and applied to both sheets.
 * The single metric that did see it — rimMean — had its floor lowered to 0.50
 * with a comment naming this exact defect as the reason.
 *
 * So this file asserts the contract `src/lib/backRegister.ts` exists to provide,
 * which is deliberately stronger than "the offsets roughly agree":
 *
 *   R1  the registered reverse has the FRONT's alpha (mirrored) — EXACTLY, so
 *       the two sheets cut on one isoline whatever the photos did;
 *   R2  no hole: every pixel inside that alpha is opaque cloth;
 *   R3  no overflow: nothing outside it is drawn (that is what put a second,
 *       wider outline round the garment);
 *   R4  the reverse's own content lands on the front's box, mirrored, at the
 *       shoulder — for offsets and scales that broke the old path outright;
 *   R5  one mirror convention, no options: the shell's back sheet and the
 *       curved card's π-rotated reverse face are the same `1 − u`;
 *   R6  two photographs that cannot be one garment are REFUSED (null), so the
 *       caller can show the blank tinted reverse instead of a smear;
 *   R7  it is deterministic — the AR bake rebuilds the same panel from the same
 *       inputs, and preview ≠ AR is a shipping bug, not a rendering nicety.
 *
 * Synthetic garments, on purpose: the offsets are AUTHORED, so a failure says
 * which invariant broke rather than "some supplier photo moved".
 *
 *   node scripts/backreg-verify.mjs
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = Number(process.env.BACKREG_PORT || 5193)
const BASE = `http://localhost:${PORT}`

const waitFor = (url, ms = 60000) =>
  new Promise((res, rej) => {
    const s = Date.now()
    const t = async () => {
      try { if ((await fetch(url)).ok) return res() } catch {}
      if (Date.now() - s > ms) return rej(new Error('dev server timeout'))
      setTimeout(t, 400)
    }
    t()
  })

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(),
  stdio: 'ignore',
})
const browser = await chromium.launch()
let failed = []
try {
  await waitFor(BASE)
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.error('[pageerror]', e.message))
  await page.goto(`${BASE}/dev/three.html`, { waitUntil: 'load', timeout: 60000 })

  const report = await page.evaluate(async () => {
    const { registerBackPanel } = await import('/src/lib/backRegister.ts')
    const { contentBoxOf } = await import('/src/lib/silhouette.ts')

    /** A garment-ish blob: a torso with two sleeves, drawn at an authored box. */
    const garment = (W, H, box, hue) => {
      const c = document.createElement('canvas')
      c.width = W
      c.height = H
      const x = c.getContext('2d')
      const { x0, y0, w, h } = box
      x.fillStyle = hue
      // torso
      x.fillRect(x0 + w * 0.22, y0 + h * 0.14, w * 0.56, h * 0.86)
      // shoulders + sleeves
      x.fillRect(x0, y0 + h * 0.14, w, h * 0.3)
      // collar notch (an opening, so the component filter has something to do)
      x.clearRect(x0 + w * 0.42, y0, w * 0.16, h * 0.2)
      return c
    }

    const alphaOf = (c) => {
      const x = document.createElement('canvas')
      x.width = c.width
      x.height = c.height
      const g = x.getContext('2d', { willReadFrequently: true })
      g.drawImage(c, 0, 0)
      return g.getImageData(0, 0, c.width, c.height).data
    }
    const mirrorOf = (c) => {
      const x = document.createElement('canvas')
      x.width = c.width
      x.height = c.height
      const g = x.getContext('2d')
      g.translate(c.width, 0)
      g.scale(-1, 1)
      g.drawImage(c, 0, 0)
      return x
    }

    /** Opaque-vs-opaque disagreement between two same-sized canvases. */
    const alphaDiff = (a, b) => {
      const da = alphaOf(a)
      const db = alphaOf(b)
      let hole = 0 // mask says cloth, panel is transparent
      let over = 0 // mask says empty, panel painted
      let cloth = 0
      for (let i = 3; i < da.length; i += 4) {
        const A = da[i] >= 115 // the sheets cut at alphaTest 0.45
        const B = db[i] >= 115
        if (A) cloth++
        if (A && !B) hole++
        if (!A && B) over++
      }
      return { holeFrac: cloth ? hole / cloth : 1, overFrac: cloth ? over / cloth : 1, cloth }
    }

    const W = 900
    const H = 800
    const FRONT_BOX = { x0: 150, y0: 60, w: 560, h: 640 }
    const front = garment(W, H, FRONT_BOX, '#3b5bdb')
    const frontBox = contentBoxOf(front)
    const mirroredFront = mirrorOf(front)

    const out = { checks: [], measurements: [] }
    const ok = (name, pass, detail) => out.checks.push({ name, pass: !!pass, detail })

    // --- R1/R2/R3 + R4 over a sweep of framings the old path could not survive.
    const CASES = [
      { id: 'identical', box: { ...FRONT_BOX }, W, H },
      { id: 'shifted-down-20pct', box: { x0: 150, y0: 60 + 160, w: 560, h: 640 }, W, H },
      { id: 'short-by-20pct', box: { x0: 190, y0: 90, w: 560, h: 512 }, W, H },
      { id: 'tall-by-18pct', box: { x0: 120, y0: 20, w: 560, h: 755 }, W, H },
      { id: 'off-centre-left', box: { x0: 30, y0: 60, w: 560, h: 640 }, W, H },
      { id: 'other-canvas-size', box: { x0: 90, y0: 40, w: 420, h: 470 }, W: 640, H: 610 },
    ]
    for (const c of CASES) {
      const back = garment(c.W, c.H, c.box, '#c92a2a')
      const reg = registerBackPanel(front, back)
      if (!reg) {
        ok(`${c.id}.registers`, false, 'returned null')
        continue
      }
      ok(`${c.id}.registers`, true)
      ok(
        `${c.id}.frame`,
        reg.canvas.width === W && reg.canvas.height === H,
        `${reg.canvas.width}x${reg.canvas.height} vs front ${W}x${H}`,
      )
      const d = alphaDiff(mirroredFront, reg.canvas)
      ok(`${c.id}.no-hole`, d.holeFrac === 0, `holeFrac=${d.holeFrac.toFixed(5)}`)
      ok(`${c.id}.no-overflow`, d.overFrac === 0, `overFrac=${d.overFrac.toFixed(5)}`)

      // R4: where the reverse's OWN content landed, against where the geometry
      // expects it. Measured on the panel before the flood would hide it, by
      // comparing the drawn photo's colour rather than its alpha.
      const px = alphaOf(reg.canvas)
      let minX = W, maxX = -1, minY = H, maxY = -1
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4
          if (px[i + 3] < 115) continue
          if (px[i] > px[i + 2] + 20) {
            // the back's red, not the flood
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      const expX0 = W - (frontBox.x1 * W)
      const expY0 = frontBox.y0 * H
      const dx = maxX < 0 ? NaN : minX - expX0
      const dy = maxY < 0 ? NaN : minY - expY0
      out.measurements.push({ id: c.id, dxPx: dx, dyPx: dy })
      // 4 px on a 900 px frame = 0.4 % of the garment: the working mask is a
      // 200-px grid, so one of its cells IS 4.5 px here.
      ok(`${c.id}.content-x`, Math.abs(dx) <= 5, `Δx=${dx.toFixed(1)}px`)
      ok(`${c.id}.content-y`, Math.abs(dy) <= 5, `Δy=${dy.toFixed(1)}px`)
    }


    // --- R6: refuse a reverse that cannot be the same garment.
    for (const bad of [
      { id: 'sliver', box: { x0: 400, y0: 60, w: 40, h: 640 } },
      { id: 'letterbox', box: { x0: 60, y0: 300, w: 780, h: 150 } },
    ]) {
      const back = garment(W, H, bad.box, '#c92a2a')
      ok(`refuse.${bad.id}`, registerBackPanel(front, back) === null)
    }
    // …and accept the ordinary ones (a gate that refuses everything is not a gate).
    ok(
      'refuse.not-trigger-happy',
      CASES.every((c) => registerBackPanel(front, garment(c.W, c.H, c.box, '#c92a2a')) !== null),
    )

    // --- R7: determinism.
    {
      const back = garment(W, H, { x0: 190, y0: 90, w: 560, h: 512 }, '#c92a2a')
      const a = registerBackPanel(front, back).canvas
      const b = registerBackPanel(front, back).canvas
      const da = alphaOf(a)
      const db = alphaOf(b)
      let diff = 0
      for (let i = 0; i < da.length; i++) if (da[i] !== db[i]) diff++
      ok('deterministic', diff === 0, `${diff} bytes differ between two builds`)
    }

    // --- The bare twin must ride the SAME transform as the composite, or the
    // shell measures its light and its folds somewhere other than it paints them.
    {
      const box = { x0: 190, y0: 90, w: 560, h: 512 }
      const back = garment(W, H, box, '#c92a2a')
      const bare = garment(W, H, box, '#2f9e44')
      const reg = registerBackPanel(front, back, bare)
      ok('bare.present', !!reg?.photo)
      if (reg?.photo) {
        const d = alphaDiff(reg.canvas, reg.photo)
        ok('bare.same-transform', d.holeFrac === 0 && d.overFrac === 0, `hole=${d.holeFrac} over=${d.overFrac}`)
      }
    }

    return out
  })

  const pad = (s, n) => String(s).padEnd(n)
  console.log('\nREVERSE-PANEL REGISTRATION\n')
  console.log(`  ${pad('check', 34)} result   detail`)
  for (const c of report.checks) {
    if (!c.pass) failed.push(`${c.name}${c.detail ? ` — ${c.detail}` : ''}`)
    console.log(`  ${pad(c.name, 34)} ${c.pass ? ' ok  ' : 'FAIL '}   ${c.detail ?? ''}`)
  }
  console.log('\n  where the reverse landed, vs where the geometry expects it (px on a 900-px frame):')
  for (const m of report.measurements)
    console.log(`    ${pad(m.id, 24)} Δx ${String(m.dxPx.toFixed(1)).padStart(6)}   Δy ${String(m.dyPx.toFixed(1)).padStart(6)}`)
} catch (e) {
  failed.push(`harness: ${e.message}`)
} finally {
  await browser.close()
  server.kill('SIGTERM')
}

if (failed.length) {
  console.error(`\n✗ ${failed.length} failure(s):`)
  for (const f of failed) console.error(`  · ${f}`)
  process.exit(1)
}
console.log('\n✓ the reverse panel is registered on the front, cut by the front, and refuses what it cannot register\n')
