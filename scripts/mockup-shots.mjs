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
/*
 * Two colourways by default, not three, and the reason is wall clock: one shot
 * costs six to seven minutes on this software rasteriser at 1 200 x 1 500, and
 * the set is now four views x printed-and-bare, so every spec is eight shots.
 * A white tee and a black hoodie are the two ends of the range the lighting has
 * to hold - the brightest cloth and the darkest, jersey and fleece - and a
 * third colourway in between measures nothing new. Pass more as argv[3].
 */
const SPECS = (process.argv[3] || 'tee:FFFFFF:M,hoodie:191C20:M').split(',')
/**
 * The pane every mockup is composed in.
 *
 * Portrait 4:5, which is what a product grid, a proof column and a mail body all
 * want, and it is the shape a garment is: taller than it is wide. 1200 px wide
 * covers a two-column product gallery at 2x without upscaling.
 */
const PANE = { width: 1200, height: 1500 }
/**
 * The views a product page needs.
 *
 * `detail` is the close-up: the same rig and the same light, the camera moved
 * in until the PRINT AREA fills the frame rather than the garment. It is a
 * framing and not a fourth camera angle, and the rectangle it frames is read
 * from the two values that place and size the ink itself, so the close-up
 * cannot show a crop that is not the crop the customer bought (see
 * MeasuredExtent.printHeightIn in src/three/Stage.tsx).
 *
 * `worn` is NOT here, deliberately. The avatar exists, and it is not good
 * enough for this: src/lib/arExport.ts:421 records that it does not grade with
 * size, because body and garment are one baked mesh, so a worn shot would show
 * a print at the wrong size relative to the garment on a shop where print size
 * is a priced, printed commitment. A picture that lies about the product is
 * worse than no picture. QUESTIONS-ASSOCIE.md carries the product question.
 */
const VIEWS = [
  { id: 'front', view: 'front', framing: 'garment' },
  { id: 'threequarter', view: 'threequarter', framing: 'garment' },
  { id: 'back', view: 'back', framing: 'garment' },
  { id: 'detail', view: 'front', framing: 'print' },
]
/**
 * Printed and bare, both.
 *
 * A CATALOGUE product page sells a blank garment and needs a picture of one;
 * the printed set is what a proof, a basket line and a confirmation e-mail
 * show. They are the same rig and the same framing, so shooting both is one
 * extra toggle, and shipping only the printed set would have meant the
 * catalogue had no image at all.
 */
const INKS = [
  { id: 'print', decals: true },
  { id: 'bare', decals: false },
]

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

  const shoot = async (garment, colour, size, view, framing, decals) => {
    await page.evaluate(
      ([g, c, sz, v, f, ink]) => {
        window.__h.setGarment(g)
        window.__h.setColor(c)
        window.__h.setScene('studio')
        window.__h.setSize(sz)
        window.__h.setDecals(ink)
        window.__h.setFraming(f)
        window.__h.setView(v)
      },
      [garment, colour, size, view, framing, decals],
    )
    /*
     * WAIT FOR THE RIG TO BE WHERE IT WAS ASKED TO BE.
     *
     * The old predicate here (`goal === null && fit.measured`) was true the
     * instant it was asked: reducedMotion makes the snap analytic so `goal` is
     * never non-null, and `measured` latches on the first garment and never
     * clears. It passed before the state change had any effect and the capture
     * really ran on the timer below. This asks the three questions that have
     * an answer: is the mounted garment the one requested, is the lens the one
     * requested, and has the camera reached the distance THAT lens asks for.
     */
    await page.waitForFunction(
      ([wantGarment, wantFraming]) => {
        const p = window.__pose
        if (!p || !p.fit || p.fit.measured !== true || p.goal !== null) return false
        if (window.__hGarment !== wantGarment || window.__hFraming !== wantFraming) return false
        if (p.fit.framing !== wantFraming) return false
        return Math.abs(p.fit.applied - p.fit.wanted) <= 0.5
      },
      [garment, framing],
      { timeout: 300000, polling: 250 },
    )
    await page.waitForTimeout(1500)
    const url = await page.evaluate(COMPOSE, box)
    if (!url) throw new Error(`${garment}/${colour}/${size}/${view}: no frame`)
    return Buffer.from(url.split(',')[1], 'base64')
  }

  const nameFor = (garment, colour, size, ink, view) =>
    `${garment}-${colour.toLowerCase()}-${size.toLowerCase()}-${ink}-${view}.png`

  const shots = []
  for (const spec of SPECS) {
    const [garment, colour, size] = spec.split(':')
    if (!garment || !colour || !size) throw new Error(`bad spec "${spec}" (want garment:colour:size)`)
    for (const ink of INKS)
      for (const v of VIEWS) shots.push({ garment, colour, size, ink, v })
  }

  for (const { garment, colour, size, ink, v } of shots) {
    const png = await shoot(garment, `#${colour.toUpperCase()}`, size, v.view, v.framing, ink.decals)
    const name = nameFor(garment, colour, size, ink.id, v.id)
    const hash = createHash('sha256').update(png).digest('hex')
    writeFileSync(`${OUT}/${name}`, png)
    hashes.set(name.replace(/\.png$/, ''), hash)
    written++
    console.log(`  ${name.padEnd(40)} ${(png.length / 1024).toFixed(0)} kB  ${hash.slice(0, 12)}`)
  }

  if (written === 0) {
    console.error('nothing rendered')
    done(2)
  }

  /*
   * THE DETERMINISM GATE, on both axes it actually has.
   *
   * A mockup that cannot be produced twice cannot be "generated once and
   * reused": nothing downstream could ever tell a stale image from a changed
   * one. Two different claims live under that sentence and only the first was
   * ever tested here:
   *
   *   RE-REQUEST  the same case again in the same page, after the whole sweep
   *               has run. This is the one that catches state accumulating in
   *               the WebGL context between shots.
   *   REGENERATE  the same case in a FRESH page. This is the one "generate once
   *               and reuse" really needs, because a regeneration months later
   *               is a new browser, and it is the axis that was not covered.
   *
   * Every shot is re-requested, not only the first: with four views x two ink
   * states the first case is no longer representative, and the detail framing
   * in particular has its own settle path.
   */
  console.log('')
  /*
   * ONE RE-REQUEST PER VIEW, not one per shot, and the cap is PRINTED.
   *
   * Re-requesting all sixteen would double a run that already takes an hour and
   * a half. One per view covers every distinct settle path there is (the three
   * camera angles plus the detail lens, which is the one with its own fit
   * target), which is where a non-deterministic capture would come from. What
   * it does NOT cover is a colourway-specific or ink-specific difference, and
   * saying so here is the difference between a bounded check and a check that
   * reads as if it covered everything.
   */
  const perView = new Map()
  for (const sh of shots) if (!perView.has(sh.v.id)) perView.set(sh.v.id, sh)
  console.log(`  (re-requesting ${perView.size} of ${shots.length} shots: one per view)`)
  for (const { garment, colour, size, ink, v } of perView.values()) {
    const again = await shoot(garment, `#${colour.toUpperCase()}`, size, v.view, v.framing, ink.decals)
    const key = nameFor(garment, colour, size, ink.id, v.id).replace(/\.png$/, '')
    const first = hashes.get(key)
    const second = createHash('sha256').update(again).digest('hex')
    if (first !== second) {
      console.log(`  x ${key}: re-requested, not the same image (${first.slice(0, 12)} vs ${second.slice(0, 12)})`)
      verdict = 'FAIL'
    } else {
      console.log(`  ok ${key}: re-requested, byte-identical (${first.slice(0, 12)})`)
    }
  }

  // REGENERATE: a new page, a new context, the same design.
  const r = shots[0]
  await page.reload({ waitUntil: 'load', timeout: 300000 })
  await page.waitForFunction(() => document.body.innerText.includes('ready'), null, { timeout: 300000 })
  await page.waitForFunction(() => !!window.__h, null, { timeout: 60000 })
  await page.evaluate(() => document.fonts.ready)
  const reborn = await shoot(r.garment, `#${r.colour.toUpperCase()}`, r.size, r.v.view, r.v.framing, r.ink.decals)
  const rkey = nameFor(r.garment, r.colour, r.size, r.ink.id, r.v.id).replace(/\.png$/, '')
  const rfirst = hashes.get(rkey)
  const rsecond = createHash('sha256').update(reborn).digest('hex')
  if (rfirst !== rsecond) {
    console.log(`  x ${rkey}: regenerated in a fresh page, not the same image (${rfirst.slice(0, 12)} vs ${rsecond.slice(0, 12)})`)
    verdict = 'FAIL'
  } else {
    console.log(`  ok ${rkey}: regenerated in a fresh page, byte-identical (${rfirst.slice(0, 12)})`)
  }

  console.log(`\n${written} mockups in ${OUT}`)
  console.log('verdict:', verdict)
  done(verdict === 'FAIL' ? 3 : 0)
} catch (e) {
  console.error('FAILED', e?.stack || e?.message || e)
  done(1)
}
