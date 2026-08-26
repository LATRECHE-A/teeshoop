#!/usr/bin/env node
/**
 * LEAK-VERIFY: flipping scenes and garments must not grow the renderer.
 *
 *   node scripts/leak-verify.mjs
 *
 * The studio's scene picker is something a customer clicks repeatedly, and for
 * a while every click orphaned GPU resources that nothing could reach and
 * nothing disposed. Measured over 18 scene changes on one garment, before the
 * fix: the reachable scene graph never left 5 geometries / 5 materials /
 * 6 textures while the renderer's allocation climbed from 13 to 67 textures,
 * exactly +3 per change, with no ceiling. On a phone that ends as a lost
 * context, and no screenshot of any single frame can see it.
 *
 * Two causes, both closed in src/three/Stage.tsx, both re-openable by a
 * one-line edit, which is why this file exists:
 *
 *   · `<SceneEnvironment key={scene}>` remounted drei's `<Environment>`, and
 *     three r185 attaches its `onPMREMDispose` listener on only one of the two
 *     branches in WebGLCubeUVMaps. A `frames={1}` environment has already
 *     rendered into its cube target by then, so it takes the other branch and
 *     no listener is ever registered. drei calls `fbo.dispose()` correctly and
 *     nothing is listening.
 *   · drei's `<ContactShadows>` memoises two render targets, a geometry and
 *     three materials on `[resolution, width, height, scale, color]` and
 *     disposes none of them. Our per-scene shadow tint was in that list.
 *
 * SO THIS ASSERTS TWO THINGS, not one. A fix that stopped the growth by
 * freezing the environment would be worse than the leak: every scene would
 * render with the first scene's light and every framing gate would still pass.
 * So the scenes must also still differ from each other, and each must return to
 * the same frame when it comes round again.
 *
 * Exit: 0 all gates passed · 2 nothing was scanned · 3 a gate failed.
 *
 * LEAK_CYCLES and LEAK_SCENES cut the walk down. They exist for the
 * nothing-scanned guard, not for tuning: a short walk cannot prove absence.
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'

const PORT = Number(process.env.LEAK_PORT || 5298)
const BASE = `http://localhost:${PORT}`
// Small on purpose. Every number here is a counter or a channel average, none
// of them is a pixel measurement, and software rasterisation is fill-rate bound:
// at 1200x1500 this same walk takes half an hour and says exactly the same thing.
const PANE = { width: 320, height: 320 }
/*
 * The walk's extent is overridable so that the nothing-scanned guard below can
 * actually fire. With both of these fixed at their defaults the guard compared a
 * counter against the loop bounds that had just incremented it, so it could
 * never be false: protection on the page and none in the process.
 */
const SCENES = (process.env.LEAK_SCENES || 'night,studio,sunset,beach,forest,city')
  .split(',').map((x) => x.trim()).filter(Boolean)
const GARMENTS = ['hoodie', 'tee', 'custom', 'tee']
const CYCLES = Number(process.env.LEAK_CYCLES ?? 3)

let failed = 0
const ok = (m) => console.log(`  ok   ${m}`)
const fail = (m) => {
  failed++
  console.error(`  FAIL ${m}`)
}

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
let browser
const done = (c) => {
  try { browser?.close() } catch {}
  try { server.kill('SIGTERM') } catch {}
  process.exit(c)
}
process.on('SIGINT', () => done(130))

const waitServer = async () => {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(BASE)).ok) return } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('vite never came up')
}

const READBACK = () =>
  new Promise((resolve) => {
    // 'main canvas', not 'canvas': the harness page carries more than one and
    // the first is not the stage.
    const gl = document.querySelector('main canvas')
    if (!gl) return resolve(null)
    let tries = 0
    const grab = () => {
      const c = document.createElement('canvas')
      c.width = 64
      c.height = 64
      const x = c.getContext('2d', { willReadFrequently: true })
      x.drawImage(gl, 0, 0, 64, 64)
      const d = x.getImageData(0, 0, 64, 64).data
      let r = 0, g = 0, b = 0, a = 0
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; a += d[i + 3] }
      const n = d.length / 4
      // preserveDrawingBuffer is false, so a copy registered before the render
      // reads a cleared buffer. An all-zero alpha means we lost that race.
      if (a === 0 && ++tries < 8) return requestAnimationFrame(grab)
      resolve([r / n, g / n, b / n].map((v) => Math.round(v * 10) / 10))
    }
    requestAnimationFrame(grab)
  })

try {
  await waitServer()
  browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
  const page = await browser.newContext({ viewport: PANE, reducedMotion: 'reduce' }).then((c) => c.newPage())
  await page.goto(`${BASE}/dev/three.html?g=tee&c=FFFFFF`, { waitUntil: 'load', timeout: 300000 })
  await page.waitForFunction(() => !!window.__h, null, { timeout: 60000 })
  await page.waitForFunction(() => !!window.__stage?.census, null, { timeout: 120000 })

  const drawn = async (n = 6) => {
    const from = await page.evaluate(() => window.__frames ?? 0)
    await page.waitForFunction((f) => (window.__frames ?? 0) >= f, from + n, { timeout: 300000, polling: 100 })
  }
  const step = async (garment, scene) => {
    await page.evaluate(([g, sc]) => { window.__h.setGarment(g); window.__h.setScene(sc) }, [garment, scene])
    await page.waitForFunction((g) => window.__hGarment === g, garment, { timeout: 300000, polling: 100 })
    await drawn()
    const census = await page.evaluate(() => window.__stage.census())
    const mean = await page.evaluate(READBACK)
    if (!mean) throw new Error('no canvas to read back')
    console.log(
      `  ${garment.padEnd(7)} ${scene.padEnd(7)} reachable tex ${String(census.reachable.textures).padStart(3)}` +
        ` | allocated tex ${String(census.allocated.textures).padStart(3)}` +
        ` geo ${String(census.allocated.geometries).padStart(3)} | mean ${mean.join('/')}`,
    )
    return { census, mean }
  }

  console.log('\n=== walk ===')
  const byScene = new Map()
  const allocations = []
  let steps = 0
  for (let c = 0; c < CYCLES; c++) {
    for (const sc of SCENES) {
      const r = await step('tee', sc)
      steps++
      allocations.push(r.census.allocated.textures)
      if (!byScene.has(sc)) byScene.set(sc, [])
      byScene.get(sc).push(r.mean.join('/'))
    }
  }
  const afterScenes = allocations[allocations.length - 1]
  for (let c = 0; c < 2; c++) for (const g of GARMENTS) { await step(g, 'studio'); steps++ }
  const settled = (await step('tee', 'studio')).census
  steps++

  console.log('\n=== gates ===')
  /*
   * A check that scanned nothing is not a check that found nothing, and this
   * guard has to be able to say so. It asserts what the gates below actually
   * consume: subtracting a growth needs two allocation samples, and comparing
   * scenes needs two scenes. Both go short when the walk is cut down
   * (LEAK_CYCLES=0), which is how this branch was proven to fire.
   */
  if (allocations.length < 2 || byScene.size < 2) {
    console.error(`nothing was scanned (${allocations.length} samples over ${byScene.size} scenes, ${steps} steps)`)
    done(2)
  }

  const first = allocations[0]
  const grew = afterScenes - first
  if (grew > 0)
    fail(
      `flipping scenes leaks: allocated textures ${first} -> ${afterScenes} over ${allocations.length} changes` +
        ` (+${(grew / (allocations.length - 1)).toFixed(1)} per change, unbounded)`,
    )
  else ok(`flipping scenes allocates nothing new (allocated textures ${first} throughout ${allocations.length} changes)`)

  if (settled.allocated.textures > first)
    fail(`swapping garments leaks: back on the opening garment and scene, allocated textures ${settled.allocated.textures} against ${first}`)
  else ok(`swapping garments returns the renderer to where it started (allocated textures ${settled.allocated.textures})`)

  // A frozen environment would make every one of these identical, and every
  // other gate in the repository would still pass.
  const distinct = new Set([...byScene.values()].map((v) => v[0]))
  if (distinct.size !== SCENES.length)
    fail(`the scenes do not light differently: ${distinct.size} distinct frames across ${SCENES.length} scenes, so the environment is not re-baking`)
  else ok(`each of the ${SCENES.length} scenes lights the garment differently`)

  for (const [sc, seen] of byScene) {
    const same = seen.every((v) => v === seen[0])
    if (!same) fail(`${sc} does not come back the same: ${seen.join('  vs  ')}`)
  }
  if (![...byScene.values()].some((seen) => !seen.every((v) => v === seen[0])))
    ok(`every scene returns to the same frame on each of its ${CYCLES} visits`)

  console.log(`\nverdict: ${failed ? 'FAIL' : 'PASS'}`)
  done(failed ? 3 : 0)
} catch (e) {
  console.error('leak-verify could not run:', e?.stack ?? e)
  done(2)
}
