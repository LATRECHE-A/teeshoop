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
const WARMUP = 4

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

const stat = (a) => {
  if (!a.length) return null
  const s = Float64Array.from(a).sort()
  const q = (p) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]
  return { n: s.length, p50: q(0.5), p95: q(0.95), max: s[s.length - 1] }
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
      await page.waitForTimeout(2500)

      const deltas = await page.evaluate(TIME_FRAMES, { frames: FRAMES, warmup: WARMUP })
      const info = await page.evaluate(() => window.__renderInfo ?? null)
      const row = { profile: profile.id, garment, frame: stat(deltas), info }
      rows.push(row)
      console.log(
        `${profile.id.padEnd(8)} ${garment.padEnd(7)} frame p50 ${row.frame.p50.toFixed(1)} ms · p95 ${row.frame.p95.toFixed(1)} ms` +
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
  console.error('❌', e?.stack || e?.message || e)
  done(1)
}
