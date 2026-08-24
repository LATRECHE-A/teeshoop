#!/usr/bin/env node
/**
 * MOCKUP-SHOTS: the garment images a product page, a proof and an e-mail need,
 * rendered from the studio's own 3D preview, once, deterministically.
 *
 *   node scripts/mockup-shots.mjs [outDir] [garment:colour:size,...]
 *   node scripts/mockup-shots.mjs .qa/mockups "tee:FFFFFF:M,hoodie:191C20:L"
 *
 * WHY THIS EXISTS. Every image a customer has ever received from us is the flat
 * hand-drawn SVG composite (`renderMockup` in src/lib/renderDesign.ts): the cart
 * thumbnail, the proof, the mail. It is a different product from the lit, shaded,
 * grounded garment they spent their time in. The 3D preview could always render
 * these, and could not render them TWICE THE SAME: the garment hung in a
 * <Float> whose phase was seeded with Math.random(), the view snap damped over
 * frames, and the camera framed a placeholder. All three are gone, so a mockup
 * is now a pure function of the design, and this script is the proof: it renders
 * one case twice and fails if the two bytes differ.
 *
 * DETERMINISM, and what each part of it costs:
 *   · `reducedMotion: 'reduce'`: no sway, and the view snap lands analytically
 *     rather than damping over an unknown number of frames.
 *   · a fixed viewport and deviceScaleFactor: the framing is a fraction of the
 *     pane, so the pane has to be a constant.
 *   · `document.fonts.ready`: the print canvas draws text.
 *   · the auto-fit is framed on the chart's BIGGEST size, so a mockup of an M
 *     and a mockup of a 3XL are the same camera and really do differ in size.
 *
 * Exit: 0 rendered and identical - 1 the harness failed - 2 nothing rendered -
 *       3 two renders of the same case differ.
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'

const PORT = Number(process.env.MOCKUP_PORT || 5192)
const BASE = `http://localhost:${PORT}`
const OUT = process.argv[2] || '.qa/mockups'
const SPECS = (process.argv[3] || 'tee:FFFFFF:M,tee:191C20:M,hoodie:191C20:M').split(',')
/**
 * The pane every mockup is composed in.
 *
 * Portrait 4:5, which is what a product grid, a proof column and a mail body all
 * want, and it is the shape a garment is: taller than it is wide. 1200 px wide
 * covers a two-column product gallery at 2x without upscaling.
 */
const PANE = { width: 1200, height: 1500 }
/** The views a product page needs. `detail` is not here; see the README note. */
const VIEWS = ['front', 'threequarter', 'back']

mkdirSync(OUT, { recursive: true })

const waitServer = (url, ms = 240000) =>
  new Promise((res, rej) => {
    const s = Date.now()
    const t = async () => {
      try { if ((await fetch(url)).ok) return res() } catch {}
      if (Date.now() - s > ms) return rej(new Error('server timeout'))
      setTimeout(t, 400)
    }
    t()
  })

/**
 * The composed frame: the CSS stage rasterised through an SVG foreignObject,
 * with the WebGL canvas over it. The same construction render-verify uses, and
 * for the same reason: the frame a customer sees exists in no single buffer.
 */
const COMPOSE = ({ width, height }) =>
  new Promise((resolve) => {
    const gl = document.querySelector('main canvas')
    const main = document.querySelector('main')
    if (!gl || !main) return resolve(null)
    const cs = getComputedStyle(main)
    const decl = [
      ['background-color', cs.backgroundColor],
      ['background-image', cs.backgroundImage],
      ['background-size', cs.backgroundSize],
      ['background-position', cs.backgroundPosition],
      ['background-repeat', cs.backgroundRepeat],
      ['box-shadow', cs.boxShadow],
      ['width', width + 'px'],
      ['height', height + 'px'],
    ]
      .filter(([, v]) => v && v !== 'none')
      .map(([k, v]) => `${k}:${v}`)
      .join(';')
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<foreignObject width="100%" height="100%">` +
      `<div xmlns="http://www.w3.org/1999/xhtml" style="${decl.replace(/"/g, "'")}"></div>` +
      `</foreignObject></svg>`
    const bg = new Image()
    bg.onerror = () => resolve(null)
    bg.onload = () => {
      let tries = 0
      const grab = () => {
        const c = document.createElement('canvas')
        c.width = width
        c.height = height
        const x = c.getContext('2d', { willReadFrequently: true })
        x.drawImage(bg, 0, 0, width, height)
        x.drawImage(gl, 0, 0, width, height)
        const d = x.getImageData(0, 0, width, height).data
        // The readback races the render loop: retry until the buffer holds a
        // garment rather than a cleared frame.
        let lit = 0
        const probe = document.createElement('canvas')
        probe.width = gl.width
        probe.height = gl.height
        const px = probe.getContext('2d', { willReadFrequently: true })
        px.drawImage(gl, 0, 0)
        const pd = px.getImageData(0, 0, probe.width, probe.height).data
        for (let i = 3; i < pd.length; i += 4 * 401) if (pd[i] > 8) lit++
        if (lit < 3 && ++tries < 120)
          return tries % 2 ? setTimeout(() => requestAnimationFrame(grab), 16) : requestAnimationFrame(grab)
        void d
        resolve(c.toDataURL('image/png'))
      }
      requestAnimationFrame(grab)
    }
    bg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  })

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: process.cwd(), stdio: 'ignore' })
let browser
let written = 0
let verdict = 'PASS'
const hashes = new Map()
const done = (code) => {
  try { browser?.close() } catch {}
  try { server.kill('SIGTERM') } catch {}
  process.exit(code)
}

try {
  await waitServer(BASE)
  browser = await chromium.launch({
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox'],
  })
  const ctx = await browser.newContext({
    viewport: { width: PANE.width + 268, height: PANE.height },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.error('[pageerror]', e.message))
  await page.goto(`${BASE}/dev/three.html?g=tee&c=FFFFFF`, { waitUntil: 'load', timeout: 300000 })
  await page.waitForFunction(() => document.body.innerText.includes('ready'), null, { timeout: 300000 })
  await page.waitForFunction(() => !!window.__h, null, { timeout: 60000 })
  await page.evaluate(() => document.fonts.ready)

  const box = await page.evaluate(() => {
    const r = document.querySelector('main canvas').getBoundingClientRect()
    return { width: Math.round(r.width), height: Math.round(r.height) }
  })

  const shoot = async (garment, colour, size, view) => {
    await page.evaluate(
      ([g, c, sz, v]) => {
        window.__h.setGarment(g)
        window.__h.setColor(c)
        window.__h.setScene('studio')
        window.__h.setSize(sz)
        window.__h.setDecals(true)
        window.__h.setView(v)
      },
      [garment, colour, size, view],
    )
    await page.waitForFunction(
      () => {
        const p = window.__pose
        return !!p && p.goal === null && p.fit && p.fit.measured === true
      },
      null,
      { timeout: 300000, polling: 250 },
    )
    await page.waitForTimeout(1500)
    const url = await page.evaluate(COMPOSE, box)
    if (!url) throw new Error(`${garment}/${colour}/${size}/${view}: no frame`)
    return Buffer.from(url.split(',')[1], 'base64')
  }

  for (const spec of SPECS) {
    const [garment, colour, size] = spec.split(':')
    if (!garment || !colour || !size) throw new Error(`bad spec "${spec}" (want garment:colour:size)`)
    for (const view of VIEWS) {
      const png = await shoot(garment, `#${colour.toUpperCase()}`, size, view)
      const name = `${garment}-${colour.toLowerCase()}-${size.toLowerCase()}-${view}.png`
      const hash = createHash('sha256').update(png).digest('hex')
      writeFileSync(`${OUT}/${name}`, png)
      hashes.set(name.replace(/\.png$/, ''), hash)
      written++
      console.log(`  ${name.padEnd(34)} ${(png.length / 1024).toFixed(0)} kB  ${hash.slice(0, 12)}`)
    }
  }

  if (written === 0) {
    console.error('nothing rendered')
    done(2)
  }

  // THE DETERMINISM GATE. A mockup that cannot be produced twice cannot be
  // "generated once and reused": nothing downstream could ever tell a stale
  // image from a changed one.
  const [g0, c0, s0] = SPECS[0].split(':')
  const again = await shoot(g0, `#${c0.toUpperCase()}`, s0, VIEWS[0])
  const first = hashes.get(`${g0}-${c0.toLowerCase()}-${s0.toLowerCase()}-${VIEWS[0]}`)
  const second = createHash('sha256').update(again).digest('hex')
  if (first !== second) {
    console.log(`  ✗ the same mockup rendered twice is not the same image (${first.slice(0, 12)} vs ${second.slice(0, 12)})`)
    verdict = 'FAIL'
  } else {
    console.log(`  ✓ the same mockup rendered twice is byte-identical (${first.slice(0, 12)})`)
  }

  console.log(`\n${written} mockups in ${OUT}`)
  console.log('verdict:', verdict)
  done(verdict === 'FAIL' ? 3 : 0)
} catch (e) {
  console.error('❌', e?.stack || e?.message || e)
  done(1)
}
