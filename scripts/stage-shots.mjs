#!/usr/bin/env node
/**
 * STAGE-SHOTS: real supplier garments, under the REAL stage.
 *
 * The gap this fills: /dev/inflate.html is the shell's geometry harness and
 * lights it with three bare directional lamps under ACES, so it exaggerates
 * every normal and says nothing about sheen, the environment bake or the tone
 * map the app actually ships. /dev/three.html mounts the real `Garment3D`
 * (same Environment, same VSM shadows, same NeutralToneMapping) but only ever
 * had a synthetic blob card to put in it. `?cp=<id>` (src/dev/threeHarness.tsx)
 * feeds it a real supplier photo through the app's own u2netp cutout, and this
 * script drives that.
 *
 *   node scripts/stage-shots.mjs [outDir] [id:widthIn:print,...] [views]
 *   node scripts/stage-shots.mjs .qa/stage "201270:23:1,201270:23:0"
 *
 * `print` = 0 renders the BARE garment. Shooting a pair (…:1 and …:0) is how
 * you tell "the photo is shaded badly" apart from "the customer's artwork is
 * being read as cloth", two failures that look alike and have nothing to do
 * with each other.
 *
 * No assertions. This is the proof sheet a human (or a reviewing agent) looks
 * at; verification lives in the *-verify.mjs suites.
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

const PORT = Number(process.env.SHOT_PORT || 5199)
const BASE = `http://localhost:${PORT}`
const OUT = process.argv[2] || '.qa/stage'
const SPECS = (process.argv[3] || '201270:23:1,190402:20:1').split(',')
const VIEWS = (process.argv[4] || 'threequarter,front').split(',')
mkdirSync(OUT, { recursive: true })

const DARK_BG = { grad: [[0, '#0e1116'], [1, '#0a0d11']] }

// Read the WebGL canvas over an opaque backdrop. The drawing buffer is cleared
// after compositing (preserveDrawingBuffer:false), so a single rAF readback
// races the R3F loop: retry until the grab actually contains a garment.
const READBACK = ({ selector, bg }) =>
  new Promise((resolve) => {
    const gl = document.querySelector(selector)
    if (!gl) return resolve(null)
    let tries = 0
    const grab = () => {
      const probe = document.createElement('canvas')
      probe.width = gl.width
      probe.height = gl.height
      const px = probe.getContext('2d', { willReadFrequently: true })
      const g = px.createLinearGradient(0, 0, 0, probe.height)
      for (const [t, c] of bg.grad) g.addColorStop(t, c)
      px.fillStyle = g
      px.fillRect(0, 0, probe.width, probe.height)
      px.drawImage(gl, 0, 0)
      const data = px.getImageData(0, 0, probe.width, probe.height).data
      let lit = 0
      for (let i = 0; i < data.length; i += 4 * 977) if (data[i] > 40) lit++
      if (lit < 4 && tries++ < 40) return setTimeout(() => requestAnimationFrame(grab), 60)
      resolve(probe.toDataURL('image/png'))
    }
    requestAnimationFrame(grab)
  })

const waitServer = (url, ms = 150000) =>
  new Promise((res, rej) => {
    const s = Date.now()
    const t = async () => {
      try { if ((await fetch(url)).ok) return res() } catch {}
      if (Date.now() - s > ms) return rej(new Error('server timeout'))
      setTimeout(t, 400)
    }
    t()
  })

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(),
  stdio: 'ignore',
})
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox'],
})
try {
  await waitServer(BASE)
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 950 }, deviceScaleFactor: 1 })
  for (const spec of SPECS) {
    const [id, w = '22', pk = '1'] = spec.split(':')
    for (const view of VIEWS) {
      const name = `${id}${pk === '0' ? '-bare' : ''}-${view}`
      // Fresh page per shot: re-navigating a live WebGL page under swiftshader
      // can hang the renderer process indefinitely.
      const page = await ctx.newPage()
      page.on('pageerror', (e) => console.error('[pageerror]', e.message))
      page.on('console', (m) => {
        if (m.type() === 'error') console.error('[console]', m.text().slice(0, 200))
      })
      try {
        await page.goto(`${BASE}/dev/three.html?g=custom&cp=${id}&cw=${w}&cpk=${pk}&v=${view}&rot=0`, {
          waitUntil: 'load',
          timeout: 240000,
        })
        await page.waitForFunction(() => document.body.innerText.includes('ready'), { timeout: 240000 })
        // Poll for the cutout rather than waitForFunction: u2netp runs on the
        // CPU here (20-60 s under swiftshader), far past any fixed wait, and a
        // waitForFunction handle over that span proved unreliable.
        let cp = null
        for (let i = 0; i < 40 && !cp; i++) {
          await page.waitForTimeout(8000)
          cp = await page.evaluate(() => window.__cp ?? null).catch(() => null)
        }
        if (cp !== 'ready') throw new Error(`cutout ${cp}`)
        await page.waitForTimeout(9000) // let the view-snap damp settle
        const url = await page.evaluate(READBACK, { selector: 'main canvas', bg: DARK_BG })
        if (!url) {
          console.error('MISSING', name)
          continue
        }
        writeFileSync(`${OUT}/${name}.png`, Buffer.from(url.split(',')[1], 'base64'))
        console.log('saved', name)
      } catch (e) {
        console.error('FAILED', name, String(e).split('\n')[0])
      } finally {
        await page.close().catch(() => {})
      }
    }
  }
  await ctx.close()
} finally {
  await browser.close()
  server.kill('SIGTERM')
}
console.log(`\nstage proof sheet written to ${OUT}`)
