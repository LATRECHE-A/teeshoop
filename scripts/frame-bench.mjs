#!/usr/bin/env node
/**
 * FRAME-BENCH: what one frame of the 3D preview costs, and what each setting in
 * the device profile buys.
 *
 *   node scripts/frame-bench.mjs [outFile]
 *
 * WHAT THIS IS NOT. It is not a phone measurement, and it must never be quoted
 * as one. There is no phone GPU on this machine: chromium renders through
 * swiftshader, a software rasteriser running on a desktop CPU, whose absolute
 * milliseconds have no relationship to a Mali or an Adreno. Anyone who writes
 * "16 ms on a mid-range phone" from this output is inventing a number, which is
 * the one thing this module's history says not to do.
 *
 * WHAT IT IS. Two things that ARE portable, plus one that is honest about not
 * being:
 *
 *   1. THE WORK PER FRAME, from three's own counter: draw calls, triangles,
 *      shader programs, texture and geometry residency. These are what scale
 *      with the device and they are identical on every machine, so a budget
 *      written against them travels.
 *   2. THE RATIO between the desktop profile and the phone profile, measured
 *      back to back on the same rasteriser in the same run. A ratio divides the
 *      machine out; it says what halving the shadow map and dropping MSAA
 *      actually buys, which is the question a profile constant has to answer.
 *   3. The raw frame time under this rasteriser, printed as an index and
 *      labelled as such.
 *
 * A WORKED EXAMPLE OF WHY THE MILLISECONDS DO NOT TRAVEL, from this bench's own
 * output: the tee costs MORE per frame than the hoodie (desktop 16,9 against
 * 16,5 ms, phone 45,1 against 31,2) while carrying 3,46x FEWER triangles. It is
 * fill rate, not geometry. The camera frames the chart's biggest size and an
 * A-pose hoodie's arm span sets the distance, so the tee covers 38,8 % of the
 * pane and the hoodie 21,0 % (areaFrac in .qa/render-final/render-verify.json):
 * 1,85x the shaded pixels. A software rasteriser is fragment-bound and loses
 * that trade; a real GPU, with fixed-function triangle setup and a wide
 * fragment array, would very likely win it and put the hoodie back on top.
 * Which is the whole argument for budgeting against the draw calls and the
 * triangle counts below, and not against these milliseconds.
 *
 * The phone profile is emulated the only way it can be: the viewport and device
 * pixel ratio of a Pixel 8a (393 x 851 at 2.75), touch input, and a 4x CPU
 * throttle. That reproduces which BRANCH the app takes, which is the thing under
 * test: `PROFILE` in src/three/index.tsx keys off a media query, so the branch
 * is what a screen width decides.
 *
 * Exit: 0 measured - 1 the harness failed - 2 nothing was measured.
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const PORT = Number(process.env.BENCH_PORT || 5193)
const BASE = `http://localhost:${PORT}`
const OUT = process.argv[2] || '.qa/frame-bench.json'
/**
 * Frames timed per profile, after a warm-up.
 *
 * Small on purpose. A frame here costs SECONDS, not milliseconds, because this
 * is a software rasteriser: sixty of them per case is half an hour of wall clock
 * for a number whose absolute value is meaningless anyway. Fourteen is enough
 * for a median that separates two trees, which is all this is for, and the
 * sample size is printed beside every figure so nobody quotes it as more.
 */
const FRAMES = 14
/**
 * Ticks discarded before timing starts.
 *
 * 4 was not enough: the shader programs compile lazily on first draw under
 * swiftshader, and one 45-second sample landed inside the timed window. 12 is
 * past every compile observed here, and the stall filter in `stat` is the
 * belt to this braces - if a stall still gets through it is reported, not
 * averaged away.
 */
const WARMUP = 12

const PROFILES = [
  {
    id: 'desktop',
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    throttle: 1,
  },
  {
    // Pixel 8a. The width is what src/three/index.tsx's media query reads, so it
    // is what selects the phone branch of PROFILE.
    id: 'phone',
    viewport: { width: 393, height: 851 },
    deviceScaleFactor: 2.75,
    isMobile: true,
    hasTouch: true,
    throttle: 4,
  },
]

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

/** rAF deltas, collected in the page so nothing crosses the bridge per frame. */
const TIME_FRAMES = ({ frames, warmup }) =>
  new Promise((resolve) => {
    const out = []
    let n = 0
    let last = performance.now()
    const tick = () => {
      const now = performance.now()
      if (n++ > warmup) out.push(now - last)
      last = now
      if (out.length >= frames) return resolve(out)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

/**
 * Percentiles, with the stalls counted rather than averaged in.
 *
 * The first run of this bench produced a desktop/tee row of p50 18,1 ms with a
 * p95 of 2 877 ms and a max of 44 976 ms - a single sample two and a half
 * thousand times the median - while desktop/hoodie, with 3,46x the triangles,
 * peaked at 27,9 ms. That is not a frame, it is shader compilation and first
 * texture upload landing inside the timed window because four warm-up ticks
 * were not enough under a software rasteriser. A p95 computed over fourteen
 * samples two of which are stalls describes the stall, and the row was quoted
 * as if it described the renderer.
 *
 * So: samples above 8x the median are STALLS. They are excluded from the
 * percentiles and REPORTED, both in the console line and in the JSON, because
 * "one frame in fourteen took 45 seconds" is itself a finding about a cold
 * start and hiding it would be worse than the outlier was. 8x is far enough
 * above real frame-to-frame variance (the clean rows here spread about 1,6x
 * between p50 and max) that nothing legitimate is discarded.
 */
const STALL_FACTOR = 8
const stat = (a) => {
  if (!a.length) return null
  const all = Float64Array.from(a).sort()
  // THE THRESHOLD IS TAKEN FROM THE LOWER QUARTILE, not the median, because the
  // median is a number the stalls themselves move. With six stalls in fourteen
  // samples the median still sits among the good frames and all six are cut;
  // with seven it lands among the stalls, the threshold jumps by two orders of
  // magnitude and nothing is cut at all, so the same tree reports p50 20 ms or
  // p50 5 000 ms depending on one sample. The lower quartile of fourteen frames
  // cannot be moved by anything slower than it.
  const med = all[Math.floor(all.length / 4)]
  const kept = Array.from(all).filter((v) => v <= med * STALL_FACTOR)
  const stalls = Array.from(all).filter((v) => v > med * STALL_FACTOR)
  const s = Float64Array.from(kept.length ? kept : Array.from(all)).sort()
  const q = (p) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]
  return {
    n: s.length,
    p50: q(0.5),
    p95: q(0.95),
    max: s[s.length - 1],
    stalls: stalls.length,
    worstStall: stalls.length ? stalls[stalls.length - 1] : null,
  }
}

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: process.cwd(), stdio: 'ignore' })
let browser
const rows = []
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

  for (const profile of PROFILES) {
    for (const garment of ['tee', 'hoodie']) {
      const ctx = await browser.newContext({
        viewport: profile.viewport,
        deviceScaleFactor: profile.deviceScaleFactor,
        isMobile: profile.isMobile,
        hasTouch: profile.hasTouch,
      })
      const page = await ctx.newPage()
      page.on('pageerror', (e) => console.error('[pageerror]', e.message))
      const cdp = await ctx.newCDPSession(page)
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.throttle })
      await page.goto(`${BASE}/dev/three.html?g=${garment}&c=191C20`, { waitUntil: 'load', timeout: 300000 })
      await page.waitForFunction(() => document.body.innerText.includes('ready'), null, { timeout: 300000 })
      /*
       * THE HARNESS'S SIDEBAR IS 268 CSS PX WIDE AND FIXED, and that made the
       * phone rows measure the wrong thing.
       *
       * `src/dev/threeHarness.tsx` is `aside w-[268px] shrink-0` beside
       * `main flex-1`. At the desktop viewport the stage still gets 1 012 px.
       * At the Pixel 8a's 393 it gets 125, so the "phone" profile was drawing a
       * 125 x 851 CSS canvas - about a seventh of the pixels a phone actually
       * asks for - and the desktop-to-phone ratio taken from it described the
       * CPU throttle and almost nothing else. Hiding the panel gives the stage
       * the whole viewport, which is what the studio gives it on a phone.
       *
       * The canvas size that was really drawn is recorded in every row, so this
       * can be checked rather than believed.
       */
      const hid = await page.evaluate(() => {
        const aside = document.querySelector('aside')
        if (!aside) return false
        aside.style.display = 'none'
        return true
      })
      if (!hid) throw new Error('the harness sidebar could not be found: the phone rows would time a 125 px canvas')
      await page.waitForTimeout(2500)

      const deltas = await page.evaluate(TIME_FRAMES, { frames: FRAMES, warmup: WARMUP })
      const info = await page.evaluate(() => window.__renderInfo ?? null)
      // The four knobs PROFILE actually turns, read back off the live context
      // rather than assumed from the media query.
      const surface = await page.evaluate(() => {
        const c = document.querySelector('main canvas')
        if (!c) return null
        const r = c.getBoundingClientRect()
        const gl = c.getContext('webgl2') || c.getContext('webgl')
        const a = gl?.getContextAttributes?.() ?? {}
        return {
          cssW: Math.round(r.width),
          cssH: Math.round(r.height),
          bufferW: c.width,
          bufferH: c.height,
          dpr: r.width ? Math.round((c.width / r.width) * 100) / 100 : null,
          antialias: a.antialias ?? null,
        }
      })
      const row = { profile: profile.id, garment, frame: stat(deltas), info, surface }
      rows.push(row)
      console.log(
        `${profile.id.padEnd(8)} ${garment.padEnd(7)} frame p50 ${row.frame.p50.toFixed(1)} ms · p95 ${row.frame.p95.toFixed(1)} ms` +
          (row.frame.stalls
            ? ` · ${row.frame.stalls} stall(s) excluded, worst ${(row.frame.worstStall / 1000).toFixed(1)} s`
            : '') +
          (surface ? ` · ${surface.bufferW}x${surface.bufferH} px (dpr ${surface.dpr}, msaa ${surface.antialias})` : '') +
          (info
            ? `  ·  ${info.calls} draw calls · ${info.triangles.toLocaleString('fr-FR')} triangles · ${info.programs} programs` +
              ` · ${info.textures} textures · ${info.geometries} geometries · shadow map ${info.shadowMapSize}`
            : '  ·  (no render info)'),
      )
      await ctx.close()
    }
  }

  if (!rows.length) {
    console.error('nothing was measured')
    done(2)
  }

  console.log('\n=== what the phone profile buys, on this rasteriser ===')
  for (const garment of ['tee', 'hoodie']) {
    const d = rows.find((r) => r.profile === 'desktop' && r.garment === garment)
    const p = rows.find((r) => r.profile === 'phone' && r.garment === garment)
    if (!d || !p) continue
    // The phone runs at a 4x CPU throttle, so the raw ratio is not the answer;
    // what travels is the work per frame, which is printed beside it.
    console.log(
      `  ${garment.padEnd(7)} ${d.frame.p50.toFixed(1)} ms desktop -> ${p.frame.p50.toFixed(1)} ms phone (4x throttle)` +
        (d.info && p.info
          ? `  ·  draw calls ${d.info.calls} -> ${p.info.calls} · shadow map ${d.info.shadowMapSize} -> ${p.info.shadowMapSize}`
          : ''),
    )
  }
  console.log('\nAbsolute milliseconds here are SOFTWARE rasterisation on this machine.')
  console.log('They are an index for comparing two trees, not a phone measurement.')

  writeFileSync(OUT, JSON.stringify({ rows }, null, 2))
  console.log(`\nwritten to ${OUT}`)
  done(0)
} catch (e) {
  console.error('FAILED', e?.stack || e?.message || e)
  done(1)
}
