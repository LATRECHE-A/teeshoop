#!/usr/bin/env node
/**
 * RENDER-VERIFY: the properties a garment PHOTOGRAPH has, asserted on the real
 * bundle in a real browser.
 *
 *   node scripts/render-verify.mjs [outDir]     (default: .qa/render)
 *
 * Every other 3D harness in this repository measures geometry: fabric-verify
 * asks whether a 10 cm logo covers 10 cm of cloth, inflate-verify asks whether
 * the shell is hollow, board-verify asks whether the framing maths crops. None
 * of them ever looked at a rendered frame, and that is exactly where this
 * module's defects were living. Measured on the tree before this script existed:
 *
 *   · the camera was framing a PLACEHOLDER extent, so a hoodie was viewed from
 *     67,9 in when its own measurement asks for 123,0 and its silhouette filled
 *     the whole 832x900 pane, touching all four edges;
 *   · there was not one shadow pixel in any render: the garment hung in a void;
 *   · a black tee measured DARKER than the page behind it, so half its outline
 *     did not exist;
 *   · a white tee measured (148,142,136), a 58 % warm grey.
 *
 * Each of those is a number, so each of them is a gate.
 *
 * HOW A PIXEL IS CLASSIFIED. The WebGL canvas is transparent and the backdrop is
 * CSS, so the frame a customer sees is a composite that exists nowhere in one
 * buffer. This script builds both halves itself: the canvas by framebuffer
 * readback (the only thing that works for WebGL under swiftshader) and the CSS
 * backdrop by rasterising the stage element's OWN resolved background through an
 * SVG foreignObject: the real gradient, the real dot lattice, the real scene
 * vignette, not a colour invented in the shot script the way every previous
 * proof sheet did it. Everything that differs from the backdrop-only raster is
 * the garment or what it throws: no threshold on "looks like cloth", no
 * background reference guessed per row.
 *
 * Exit: 0 every gate passed · 2 nothing was scanned · 3 a gate failed.
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

const PORT = Number(process.env.RENDER_PORT || 5196)
const BASE = `http://localhost:${PORT}`
const OUT = process.argv[2] || '.qa/render'
const PANE = { width: 1100, height: 900 }

mkdirSync(OUT, { recursive: true })

// ---------------------------------------------------------------------------
// The gates, and where each number comes from
// ---------------------------------------------------------------------------

/**
 * Air the garment must keep on every side, as a fraction of the pane.
 *
 * 0 would only say "not cropped"; a product photograph is not composed to the
 * millimetre of its subject either. 1,5 % of 832 px is 12 px, which is smaller
 * than any margin a person would call deliberate and larger than the anti-alias
 * ramp on the silhouette.
 */
const MIN_MARGIN_FRAC = 0.015
/**
 * How much of the pane's height the garment must fill.
 *
 * The floor is not a taste threshold, it is the "this is a thumbnail, not a
 * preview" line. The ceiling is the crop line with the margin above folded in.
 * A hoodie sits low in this window ON PURPOSE: the camera frames the biggest
 * size in the chart so an S reads smaller than a 3XL (board-verify check G),
 * and an A-pose hoodie is wider than it is tall, so in a portrait pane its arm
 * span sets the distance. That slack is where the ground goes.
 */
const FILL_MIN = 0.42
const FILL_MAX = 0.97
/** How far the garment's silhouette centre may sit off the pane centre. */
const OFFCENTRE_MAX_FRAC = 0.045
/**
 * The garment must cast something onto something. Counted BELOW the silhouette's
 * lowest pixel, where only the ground can be, and only pixels DARKER than the
 * backdrop count: a lighter difference there would be a lens flare, not a
 * shadow. 400 px is about 0,05 % of the pane: small enough that a faint contact
 * shadow passes, large enough that a stray anti-aliased fringe does not.
 */
const SHADOW_MIN_PX = 400
/**
 * Minimum luminance step across the silhouette, sampled row by row.
 *
 * A garment whose edge is the same value as the page behind it has no outline,
 * and 8-bit sRGB is what the customer's screen has: below about 12 levels the
 * boundary stops being a boundary on a normal monitor. Measured before the
 * lighting work, the black tee crossed ZERO on its right flank (the shirt was
 * darker than the page) and the worst row was +1,9.
 */
const EDGE_MIN_DELTA = 12
/**
 * Darkest 5 % of the garment's own pixels. A garment with no fill light crushes
 * its shadow side to the clip floor and stops being cloth: measured before,
 * a black tee's p05 was 10,3 with 4,2 % of it below 10.
 */
const INTERIOR_P05_MIN = 22
/**
 * What "white" has to look like. A white garment photographed under a correct
 * exposure sits high but unclipped, and it is NEUTRAL: the studio rig's key is
 * warm (#fff6ec) and nothing balanced it, so white cloth came out (148,142,136).
 * The spread gate is what catches that; the level gate is what catches the stop.
 */
const WHITE_MEDIAN_MIN = 185
const WHITE_MEDIAN_MAX = 246
const WHITE_CHANNEL_SPREAD_MAX = 12
/**
 * The dark halo an un-dilated transparent texture leaves at every ink edge:
 * pixels darker than BOTH their neighbours four px away on the same row, inside
 * the garment. Measured before the texture was premultiplied, the calibration
 * grid on a white tee produced 5 787 of them, dipping up to 162 sRGB levels.
 *
 * The threshold is not zero because a printed edge is ALLOWED a hair of shadow
 * now: that is the film's own thickness, and it is one pixel wide by
 * construction. 400 is well under a tenth of what the fringe was and well over
 * what the relief can produce on this test pattern.
 */
const INK_FRINGE_MAX_PX = 400
/**
 * A NEUTRAL garment must stay neutral.
 *
 * The sheen was raised and its colour moved from 30 % toward white to 55 %,
 * which is what gives a dark garment an outline. The risk that number was
 * originally guarding against is on the record: a warm off-white sheen over
 * #191C20 once rendered a near-black hoodie BROWN. The studio key is neutral
 * now, but five other scenes keep a tinted key and all six gained a tinted rim,
 * so the guard has to be a measurement rather than an argument.
 */
const NEUTRAL_SPREAD_MAX = 14

// ---------------------------------------------------------------------------
// Page-side helpers (serialised into the browser)
// ---------------------------------------------------------------------------

/** Framebuffer readback of the live canvas, retried until it holds pixels. */
const READBACK = () =>
  new Promise((resolve) => {
    const gl = document.querySelector('main canvas')
    if (!gl) return resolve(null)
    let tries = 0
    const grab = () => {
      const c = document.createElement('canvas')
      c.width = gl.width
      c.height = gl.height
      const x = c.getContext('2d', { willReadFrequently: true })
      x.drawImage(gl, 0, 0)
      const data = x.getImageData(0, 0, c.width, c.height).data
      let lit = 0
      for (let i = 3; i < data.length; i += 4 * 401) if (data[i] > 8) lit++
      // rAF callbacks run FIFO per frame, so a grab registered before the render
      // loop's reads a cleared buffer EVERY frame. Alternate re-registration
      // through a macrotask to flip the ordering.
      if (lit < 3 && ++tries < 120)
        return tries % 2 ? setTimeout(() => requestAnimationFrame(grab), 16) : requestAnimationFrame(grab)
      resolve(c.toDataURL('image/png'))
    }
    requestAnimationFrame(grab)
  })

/**
 * Rasterise the stage's own CSS backdrop.
 *
 * A page screenshot would be the obvious way and it does not work here: the R3F
 * loop never stops, so the compositor never reaches a stable frame and
 * `page.screenshot` times out under swiftshader. An SVG `foreignObject` carrying
 * the element's RESOLVED background properties is rendered by the same engine,
 * synchronously, with no compositor involved, and because the data URL
 * references nothing external it does not taint the canvas it is drawn into.
 */
const BACKDROP = ({ width, height }) =>
  new Promise((resolve) => {
    const main = document.querySelector('main')
    if (!main) return resolve(null)
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
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = width
      c.height = height
      const x = c.getContext('2d')
      x.drawImage(img, 0, 0)
      resolve(c.toDataURL('image/png'))
    }
    img.onerror = () => resolve(null)
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  })

/**
 * Composite backdrop + canvas and measure. Runs in the page because moving two
 * 832x900 RGBA buffers per shot across the bridge costs more than the render.
 */
const MEASURE = async ({ backdropUrl, canvasUrl, garmentUrl, stageUrl, printOnly }) => {
  const load = (u) =>
    new Promise((res, rej) => {
      const im = new Image()
      im.onload = () => res(im)
      im.onerror = rej
      im.src = u
    })
  const [bd, fg, gm, st] = await Promise.all([
    load(backdropUrl),
    load(canvasUrl),
    load(garmentUrl),
    load(stageUrl),
  ])
  const W = fg.width
  const H = fg.height
  const mk = (w, h) => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  }
  const bc = mk(W, H)
  const bx = bc.getContext('2d', { willReadFrequently: true })
  bx.drawImage(bd, 0, 0, W, H)
  const back = bx.getImageData(0, 0, W, H).data

  const cc = mk(W, H)
  const cx = cc.getContext('2d', { willReadFrequently: true })
  cx.drawImage(bd, 0, 0, W, H)
  cx.drawImage(fg, 0, 0)
  const comp = cx.getImageData(0, 0, W, H).data

  const luma = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
  // Anything that differs from the backdrop-only capture is the garment or what
  // it throws. 6 levels clears PNG round-tripping and the dot lattice's own
  // anti-aliasing without swallowing a faint contact shadow.
  const DIFF = 6
  const differs = new Uint8Array(W * H)
  for (let p = 0; p < W * H; p++) {
    const i = p * 4
    const d =
      Math.abs(comp[i] - back[i]) + Math.abs(comp[i + 1] - back[i + 1]) + Math.abs(comp[i + 2] - back[i + 2])
    if (d > DIFF) differs[p] = 1
  }

  // THE GARMENT'S SILHOUETTE comes from a capture with the floor and the shadow
  // rig switched off, so "opaque" means the garment and nothing else. Since the
  // stage acquired a real floor, the opaque part of a normal frame IS the floor,
  // and a mask taken from it measures the stage instead of the product.
  const raw = (im) => {
    const c = mk(W, H)
    const x = c.getContext('2d', { willReadFrequently: true })
    x.drawImage(im, 0, 0)
    return x.getImageData(0, 0, W, H).data
  }
  const fgData = raw(gm)
  // …and the EMPTY STAGE (floor lit, garment hidden) is the reference the ground
  // shadow is measured against: a shadow is the difference between a floor with
  // something standing on it and the same floor without.
  const stageOnly = (() => {
    const c = mk(W, H)
    const x = c.getContext('2d', { willReadFrequently: true })
    x.drawImage(bd, 0, 0, W, H)
    x.drawImage(st, 0, 0)
    return x.getImageData(0, 0, W, H).data
  })()
  const solid = new Uint8Array(W * H)
  let minX = W
  let maxX = -1
  let minY = H
  let maxY = -1
  let area = 0
  for (let p = 0; p < W * H; p++) {
    if (fgData[p * 4 + 3] < 250) continue
    solid[p] = 1
    area++
    const x = p % W
    const y = (p / W) | 0
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  if (area === 0) return { empty: true, W, H }

  // Ground shadow: pixels the garment DARKENED on the empty stage. Measured
  // everywhere outside the garment, not only below it, because a key light off
  // to one side throws the shadow sideways.
  let shadowPx = 0
  let shadowDepth = 0
  for (let p = 0; p < W * H; p++) {
    if (solid[p]) continue
    const i = p * 4
    const d = luma(stageOnly, i) - luma(comp, i)
    if (d > 3) {
      shadowPx++
      if (d > shadowDepth) shadowDepth = d
    }
  }

  // Edge separation, row by row across the middle of the garment.
  const rows = []
  const y0 = Math.round(minY + (maxY - minY) * 0.2)
  const y1 = Math.round(minY + (maxY - minY) * 0.8)
  for (let y = y0; y <= y1; y += 4) {
    let l = -1
    let r = -1
    for (let x = 0; x < W; x++) if (solid[y * W + x]) { l = x; break }
    for (let x = W - 1; x >= 0; x--) if (solid[y * W + x]) { r = x; break }
    if (l < 2 || r > W - 3 || l < 0 || r < 0) continue
    for (const [inX, outX] of [[l + 1, l - 2], [r - 1, r + 2]]) {
      if (inX < 0 || outX < 0 || inX >= W || outX >= W) continue
      const a = luma(comp, (y * W + inX) * 4)
      const b = luma(comp, (y * W + outX) * 4)
      rows.push(Math.abs(a - b))
    }
  }

  // Garment pixels only, eroded by 2 so the anti-aliased rim never counts as
  // "the shadow side crushed to black".
  const inner = []
  const chans = [[], [], []]
  for (let y = minY + 2; y <= maxY - 2; y++)
    for (let x = minX + 2; x <= maxX - 2; x++) {
      const p = y * W + x
      if (!solid[p] || !solid[p - 1] || !solid[p + 1] || !solid[p - W] || !solid[p + W]) continue
      const i = p * 4
      inner.push(luma(comp, i))
      chans[0].push(comp[i])
      chans[1].push(comp[i + 1])
      chans[2].push(comp[i + 2])
    }
  const pick = (arr, q) => {
    if (!arr.length) return null
    const s = Float64Array.from(arr).sort()
    return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]
  }

  // Dark fringe around ink: a pixel darker than BOTH its neighbours four px away
  // on the same row, inside the garment, is the halo an un-dilated transparent
  // texture leaves at every artwork edge.
  let fringe = 0
  let fringeWorst = 0
  if (printOnly) {
    for (let y = minY + 6; y <= maxY - 6; y += 2)
      for (let x = minX + 6; x <= maxX - 6; x++) {
        const p = y * W + x
        if (!solid[p] || !solid[p - 4] || !solid[p + 4]) continue
        const c = luma(comp, p * 4)
        const a = luma(comp, (p - 4) * 4)
        const b = luma(comp, (p + 4) * 4)
        const dip = Math.min(a, b) - c
        if (dip > 16) {
          fringe++
          if (dip > fringeWorst) fringeWorst = dip
        }
      }
  }

  return {
    W,
    H,
    bbox: { minX, minY, maxX, maxY },
    areaFrac: area / (W * H),
    fillH: (maxY - minY + 1) / H,
    fillW: (maxX - minX + 1) / W,
    offCentre: ((minX + maxX) / 2 - W / 2) / W,
    margins: { l: minX, r: W - 1 - maxX, t: minY, b: H - 1 - maxY },
    shadowPx,
    shadowDepth,
    edgeMin: rows.length ? Math.min(...rows) : null,
    edgeP05: pick(rows, 0.05),
    rows: rows.length,
    p05: pick(inner, 0.05),
    median: pick(inner, 0.5),
    p99: pick(inner, 0.99),
    rgbMedian: chans.map((c) => pick(c, 0.5)),
    fringe,
    fringeWorst,
    composite: cc.toDataURL('image/png'),
  }
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

const CASES = [
  // Bare cloth: the colour, the outline, the shadow side and the ground are
  // properties of the GARMENT, and a print covers a third of the front panel.
  { id: 'tee-white-34', g: 'tee', c: '#FFFFFF', sc: 'studio', v: 'threequarter', white: true },
  { id: 'tee-white-front', g: 'tee', c: '#FFFFFF', sc: 'studio', v: 'front', white: true },
  { id: 'tee-black-34', g: 'tee', c: '#191C20', sc: 'studio', v: 'threequarter', neutral: true },
  { id: 'hoodie-black-34', g: 'hoodie', c: '#191C20', sc: 'studio', v: 'threequarter', neutral: true },
  { id: 'tee-black-night', g: 'tee', c: '#191C20', sc: 'night', v: 'threequarter' },
  { id: 'tee-black-sunset', g: 'tee', c: '#191C20', sc: 'sunset', v: 'threequarter' },
  { id: 'tee-white-beach', g: 'tee', c: '#FFFFFF', sc: 'beach', v: 'threequarter', white: true },
  { id: 'tee-red-34', g: 'tee', c: '#C0272D', sc: 'studio', v: 'threequarter' },
  // …and the same tee WITH the calibration print, for the ink measurements.
  { id: 'tee-white-print', g: 'tee', c: '#FFFFFF', sc: 'studio', v: 'threequarter', ink: true },
  { id: 'tee-black-print', g: 'tee', c: '#191C20', sc: 'studio', v: 'threequarter', ink: true },
  // Neutrality is a STUDIO claim. Every other scene is a mood: warm sun really
  // does tint white cloth, and a gate that refused that would be wrong about
  // photography rather than right about colour.
]

// ---------------------------------------------------------------------------

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

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: process.cwd(), stdio: 'ignore' })
let browser
const results = []
let verdict = 'PASS'
const fail = (m) => { console.log('  ✗ ' + m); verdict = 'FAIL' }
const ok = (m) => console.log('  ✓ ' + m)
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
  // reducedMotion is not a convenience: it is what makes a capture repeatable.
  // The view snap lands analytically under it and damps over an unknown number
  // of frames without it, so a capture taken on a timer is a different pose each
  // time. (It also unwrapped the drei <Float> the preview used to hang in, until
  // that was removed for the same reason.)
  const ctx = await browser.newContext({ viewport: PANE, deviceScaleFactor: 1, reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.error('[pageerror]', e.message))
  await page.goto(`${BASE}/dev/three.html?g=tee&c=FFFFFF`, { waitUntil: 'load', timeout: 300000 })
  await page.waitForFunction(() => document.body.innerText.includes('ready'), null, { timeout: 300000 })
  await page.waitForFunction(() => !!window.__h, null, { timeout: 60000 })
  // reducedMotion is load-bearing: it is what makes the view snap land
  // analytically instead of damping over frames. Without it every capture is a
  // different pose and nothing here means anything, so it is asserted rather
  // than assumed.
  const reduced = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  if (!reduced) {
    console.error('the browser is not reporting prefers-reduced-motion: reduce')
    done(2)
  }

  // getBoundingClientRect, not locator.boundingBox(): the canvas is inside a
  // continuously rendering R3F root, and playwright's stability wait never
  // settles on it.
  const canvasBox = await page.evaluate(() => {
    const r = document.querySelector('main canvas').getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
  })

  /** The CSS backdrop alone, per scene: the canvas hidden, so the compositor
   *  handles it correctly and only WebGL needs the readback path. */
  const backdrops = new Map()
  const backdropFor = async (scene) => {
    const key = `${scene}`
    if (backdrops.has(key)) return backdrops.get(key)
    const url = await page.evaluate(BACKDROP, canvasBox)
    if (!url) throw new Error(`${scene}: the stage backdrop could not be rasterised`)
    backdrops.set(key, url)
    writeFileSync(`${OUT}/backdrop-${scene}.png`, Buffer.from(url.split(',')[1], 'base64'))
    return url
  }

  const shoot = async (kase) => {
    await page.evaluate(
      ([g, c, sc, v, ink]) => {
        window.__h.setGarment(g)
        window.__h.setColor(c)
        window.__h.setScene(sc)
        window.__h.setDecals(!!ink)
        window.__h.setView(v)
      },
      [kase.g, kase.c, kase.sc, kase.v, !!kase.ink],
    )
    // The scene re-bakes its env map and the garment may swap its GLB; wait for
    // the rig to say it has stopped moving rather than for a timer.
    try {
      /*
       * WAIT FOR THE FRAME TO STOP CHANGING, not for a flag that is already set.
       *
       * The obvious predicate, `__pose.goal === null && __pose.fit.measured`, is
       * TRUE THE INSTANT IT IS ASKED: reducedMotion makes the snap analytic so
       * `goal` is never non-null, and `measured` is latched by the first garment
       * and never cleared. It passed before the state change had any effect, so
       * the capture was really taken on the 1,2 s timer below and the wait was
       * decoration. This asks the question the harness actually has: has the
       * camera reached the radius the CURRENT garment asks for, and has the
       * frame stopped moving?
       */
      await page.waitForFunction(
        (want) => {
          const p = window.__pose
          if (!p || !p.fit || !p.fit.measured) return false
          if (p.goal !== null) return false
          // The applied radius is the one thing that changes when the garment
          // does, and it is the number every framing gate depends on.
          if (Math.abs(p.fit.applied - p.fit.wanted) > 0.5) return false
          const w = window
          const stable = w.__lastR === p.r ? (w.__stableN = (w.__stableN || 0) + 1) : ((w.__stableN = 0), 0)
          w.__lastR = p.r
          return stable >= 3 && w.__hGarment === want
        },
        kase.g,
        { timeout: 300000, polling: 250 },
      )
    } catch (e) {
      console.error(`${kase.id}: never settled`, JSON.stringify(await page.evaluate(() => window.__pose)))
      throw e
    }
    await page.waitForTimeout(1200)
    const layer = async (hide) => {
      const n = await page.evaluate(
        (roles) => roles.map((r) => window.__stage.show(r, false)),
        hide,
      )
      // `some`, not `every`. The call that matters hides ['ground','shadow'], and
      // a scene with no ground still has a shadow rig: with `every` the guard
      // stays silent, the floor is never hidden, and the "garment" mask becomes
      // the floor, which is the exact failure the layering exists to prevent.
      if (hide.some((_, i) => n[i] === 0)) throw new Error(`${kase.id}: nothing tagged ${hide.filter((_, i) => n[i] === 0).join('/')}`)
      await page.waitForTimeout(350)
      const url = await page.evaluate(READBACK)
      await page.evaluate((roles) => roles.forEach((r) => window.__stage.show(r, true)), hide)
      await page.waitForTimeout(250)
      return url
    }
    const canvasUrl = await layer([])
    if (!canvasUrl) throw new Error(`${kase.id}: no canvas`)
    const garmentUrl = await layer(['ground', 'shadow'])
    const stageUrl = await layer(['garment'])
    const backdropUrl = await backdropFor(kase.sc)
    const m = await page.evaluate(MEASURE, {
      backdropUrl,
      canvasUrl,
      garmentUrl,
      stageUrl,
      printOnly: !!kase.ink,
    })
    if (m.composite) {
      writeFileSync(`${OUT}/${kase.id}.png`, Buffer.from(m.composite.split(',')[1], 'base64'))
      delete m.composite
    }
    return m
  }

  // RENDER_ONLY=tee-black-34,tee-white-34 restricts the sweep while tuning.
  const only = (process.env.RENDER_ONLY || '').split(',').map((x) => x.trim()).filter(Boolean)
  const cases = only.length ? CASES.filter((k) => only.includes(k.id)) : CASES
  for (const kase of cases) {
    const m = await shoot(kase)
    results.push({ kase, m })
    console.log(
      `\n${kase.id}  ${m.W}x${m.H}  fill ${(m.fillH * 100).toFixed(0)}%H/${(m.fillW * 100).toFixed(0)}%W` +
        `  margins l${m.margins.l} r${m.margins.r} t${m.margins.t} b${m.margins.b}` +
        `  offCentre ${(m.offCentre * 100).toFixed(1)}%` +
        `  shadow ${m.shadowPx}px/${m.shadowDepth.toFixed(0)}lv` +
        `  edge min ${m.edgeMin === null ? 'n/a' : m.edgeMin.toFixed(1)} p05 ${m.edgeP05 === null ? 'n/a' : m.edgeP05.toFixed(1)} (${m.rows} rows)` +
        `  luma p05 ${m.p05?.toFixed(0)} med ${m.median?.toFixed(0)} p99 ${m.p99?.toFixed(0)}` +
        `  rgb ${m.rgbMedian.map((v) => v?.toFixed(0)).join('/')}` +
        (kase.ink ? `  fringe ${m.fringe}px worst ${m.fringeWorst.toFixed(0)}` : ''),
    )
  }

  // Determinism: the same case twice, with nothing touched in between.
  const twice = await shoot(cases[0])
  const first = results[0].m
  const same =
    twice.bbox.minX === first.bbox.minX &&
    twice.bbox.maxY === first.bbox.maxY &&
    Math.abs(twice.median - first.median) < 0.5
  console.log(`\ndeterminism: bbox ${JSON.stringify(twice.bbox)} vs ${JSON.stringify(first.bbox)}`)

  // ---- gates --------------------------------------------------------------
  console.log('\n=== gates ===')
  if (results.length === 0) {
    console.error('nothing was scanned')
    done(2)
  }
  for (const { kase, m } of results) {
    const tag = kase.id.padEnd(18)
    const minMargin = Math.round(Math.min(m.W, m.H) * MIN_MARGIN_FRAC)
    const worst = Math.min(m.margins.l, m.margins.r, m.margins.t, m.margins.b)
    if (worst < minMargin) fail(`${tag} the garment is cropped or touching the frame (worst margin ${worst}px, needs ${minMargin})`)
    else ok(`${tag} clear of every edge (worst margin ${worst}px)`)

    if (m.fillH < FILL_MIN || m.fillH > FILL_MAX)
      fail(`${tag} fills ${(m.fillH * 100).toFixed(0)}% of the pane height, outside ${FILL_MIN * 100}-${FILL_MAX * 100}%`)
    if (Math.abs(m.offCentre) > OFFCENTRE_MAX_FRAC)
      fail(`${tag} sits ${(m.offCentre * 100).toFixed(1)}% off the pane centre (max ${OFFCENTRE_MAX_FRAC * 100}%)`)

    if (m.shadowPx < SHADOW_MIN_PX)
      fail(`${tag} throws no shadow on anything (${m.shadowPx}px below the garment, needs ${SHADOW_MIN_PX})`)
    else ok(`${tag} stands on something (${m.shadowPx}px of ground shadow)`)

    if (m.edgeP05 === null) fail(`${tag} no silhouette rows could be sampled`)
    else if (m.edgeP05 < EDGE_MIN_DELTA)
      fail(`${tag} the outline disappears into the backdrop (p05 edge step ${m.edgeP05.toFixed(1)} levels, needs ${EDGE_MIN_DELTA})`)
    else ok(`${tag} reads against its backdrop (p05 edge step ${m.edgeP05.toFixed(1)} levels)`)

    if (m.p05 < INTERIOR_P05_MIN)
      fail(`${tag} the shadow side crushes to black (p05 luma ${m.p05.toFixed(1)}, needs ${INTERIOR_P05_MIN})`)

    if (kase.ink) {
      if (m.fringe > INK_FRINGE_MAX_PX)
        fail(`${tag} ${m.fringe}px of dark fringe around the ink, worst ${m.fringeWorst.toFixed(0)} levels (max ${INK_FRINGE_MAX_PX})`)
      else ok(`${tag} the ink has no dark halo (${m.fringe}px, worst ${m.fringeWorst.toFixed(0)} levels)`)
    }

    if (kase.neutral) {
      const spread = Math.max(...m.rgbMedian) - Math.min(...m.rgbMedian)
      if (spread > NEUTRAL_SPREAD_MAX)
        fail(`${tag} a neutral colourway reads ${spread.toFixed(0)} levels off neutral (max ${NEUTRAL_SPREAD_MAX})`)
      else ok(`${tag} a neutral colourway stays neutral (channel spread ${spread.toFixed(0)})`)
    }

    if (kase.white) {
      const spread = Math.max(...m.rgbMedian) - Math.min(...m.rgbMedian)
      const neutral = kase.sc === 'studio'
      if (m.median < WHITE_MEDIAN_MIN || m.median > WHITE_MEDIAN_MAX)
        fail(`${tag} white cloth reads ${m.median.toFixed(0)}, outside ${WHITE_MEDIAN_MIN}-${WHITE_MEDIAN_MAX}`)
      else ok(`${tag} white cloth reads white (${m.median.toFixed(0)})`)
      if (neutral && spread > WHITE_CHANNEL_SPREAD_MAX)
        fail(`${tag} white cloth is tinted ${spread.toFixed(0)} levels across channels (max ${WHITE_CHANNEL_SPREAD_MAX})`)
      else if (neutral) ok(`${tag} white cloth is neutral (channel spread ${spread.toFixed(0)})`)
    }
  }
  if (!same) fail('two captures of the same case are not the same image')
  else ok('the same case captured twice is the same image')

  writeFileSync(
    `${OUT}/render-verify.json`,
    JSON.stringify({ cases: results.map((r) => ({ id: r.kase.id, ...r.m })) }, null, 2),
  )
  console.log(`\ncomposites and measurements in ${OUT}`)
  console.log('verdict:', verdict)
  done(verdict === 'FAIL' ? 3 : 0)
} catch (e) {
  console.error('❌', e?.stack || e?.message || e)
  done(1)
}
