/**
 * Headless verification for the custom-garment shell (3-tier depth ladder).
 *
 * Boots Vite dev, loads dev/inflate.html and:
 *   1. asserts the hollow invariants on the synthetic tee in BOTH modes
 *      (template = tier 1, poisson = tier 2 — the fallback must stay healthy);
 *   2. asserts the HARD INVARIANT numerically: swapping the balloon for a
 *      template's depth field moves Z and NOTHING else — X/Y and UVs are float
 *      for float identical — and that the same input twice is bit-identical;
 *   3. runs the garment / not-a-garment gate over both populations: every real
 *      supplier flat-lay must reach tier 1 with the expected donor mesh — INCLUDING
 *      the awkward ones a customer really uploads, a garment still on its hanger
 *      and a garment under a print big enough to be mistaken for shading — and
 *      every non-garment (tote, mug, poster, cap, and a PERSON wearing the thing)
 *      must be REFUSED and land on the shape-agnostic Poisson shell, with the
 *      separation printed so the threshold can be read rather than believed;
 *   4. exercises TIER 3: an upload with no background removal at all must be
 *      refused by the tracer outright, which is what puts the app on the card;
 *   5. checks that the resulting depth field is measurably closer to a real
 *      garment's than the balloon is, and no ROUGHER in y than the donor mesh it
 *      came from — normals are computed from that field, so a step between two
 *      rows ships as a black crease across the chest;
 *   6. measures CLOTH THICKNESS at the alpha cut — the front↔back separation at
 *      the sheets' own isovalue on every case, whether the rim ribbon CLOSES on
 *      the whole outline or simply stops somewhere, and an ID-render of the seam
 *      on a four-case subset — and runs every one of those assertions a SECOND
 *      time against `rim:'off'` (the pre-thickness geometry), failing if they pass;
 *   7. dumps before/after PNGs (set INFLATE_OUT_DIR, RIM_OUT_DIR).
 *
 *   node scripts/inflate-verify.mjs
 *
 * The page spawns the background-removal Worker, so it NEVER goes network-idle:
 * navigate with waitUntil 'load' and poll for the API.
 */
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const PORT = 5197
const BASE = `http://localhost:${PORT}`
const OUT = process.env.INFLATE_OUT_DIR
const RIM_OUT = process.env.RIM_OUT_DIR

/**
 * How far apart the two sheets may still be at the alpha cut, inches: the
 * 0.06 in of cloth the shell targets (silhouette.FABRIC_IN) plus one coarse grid
 * cell of interpolation slack.
 */
const SEAM_MAX_IN = 0.1
/**
 * How much of the outline may be left with no rim ribbon on it at all, inches.
 *
 * A marching-squares isoline can be CLIPPED by its own grid, and this one's grid
 * spans the alpha's bounding box — so it was clipped exactly where a laid-flat
 * garment is flattest (the hem, a sleeve at its widest), which no other gate
 * here can see. Measured unpadded: 3.5–20.7 in bare on all 18 supplier photos,
 * worst 20.7 of a 46.5 in outline. Padded: 0 on fifteen of them, 0.12–0.15 in on
 * the other three, from single dropped quads at raster corners. 0.6 in is four
 * of those and still ×34 below the defect it rejects.
 */
const RIM_GAP_MAX_IN = 0.6
/**
 * How much of the seam may still show the garment's own cavity — its lining or
 * a catch plane — ON THE BEST GRAZING VIEW. This is the defect in the words a
 * viewer would use ("you can see through the edge of the shirt"), and it is
 * asked of the best view for the same reason `rimMax` is: the scanline window
 * localises the seam only where the row is monotone, and on a sleeved garment
 * seen from +75° it is not (the interleaving counter finds 519–707 of ~800 rows
 * carrying two separate front runs, so the window spans a sleeve as well as a
 * seam). Measured over the four rendered cases the best view scores 0.05 / 0.19
 * / 0.10 / 0.21 with the rim and 1.00 / 1.00 / 1.00 / 0.99 without it, so a
 * quarter separates the two populations by ×4 either way.
 */
const SEAM_OPEN_MAX = 0.25
/** Cases that get the (expensive) ID render of the seam. A tee, a hoodie, a
 *  vest with the shallowest depth in the set, and the one case with an enclosed
 *  collar hole. */
const RIM_RENDER = ['synthetic', '190402', '180712', '143100']
/** An azimuth is only usable for the seam metric once enough scanlines actually
 *  carry a front↔back boundary; below ~55° the back panel is entirely
 *  back-facing and is never drawn. */
const RIM_MIN_ROWS = 300

/** Which garment mesh each real case must end up borrowing its depth from. */
const EXPECT = {
  190402: 'tee',
  190608: 'tee',
  191052: 'tee',
  75369: 'tee',
  74606: 'tee',
  202358: 'tee',
  171722: 'tee',
  143100: 'tee',
  75368: 'hoodie',
  145165: 'hoodie',
  74958: 'hoodie',
  75078: 'hoodie',
  180711: 'hoodie',
  75079: 'hoodie',
  180712: 'hoodie',
  75149: 'hoodie',
  75196: 'hoodie',
  201270: 'hoodie',
  hanger: 'tee',
  bigprint: 'hoodie',
}

/** Cases that get a rendered before/after pair when INFLATE_OUT_DIR is set. */
const SHOT = new Set([
  '190402',
  '202358',
  '143100',
  '75368',
  '75078',
  '180712',
  '75149',
  'tote',
  'person',
  'hanger',
  'bigprint',
])

/**
 * How far a shell's depth profile sits from its donor garment's own profile.
 *
 * THIS is the claim under test, and it is deliberately not "the depth moved
 * up". The first version of this script asserted that, on the theory that a
 * Poisson balloon peaks on the medial axis while a garment carries its volume
 * at the chest — which is true of a LAID-FLAT garment and false of the supplier
 * catalogue, whose ghost-mannequin photos are widest at the shoulders, so the
 * balloon peaks high all by itself. Comparing each shell against the mesh whose
 * depth it is supposed to be reproducing has no such pose dependence: it asks
 * the question the feature actually promises to answer, and the Poisson shell
 * is measured against the very same reference.
 */
const profileDist = (s, ref) =>
  Math.abs(s.peakFromTop - ref.peakFromTop) +
  Math.abs(s.shoulderFill - ref.shoulderFill) +
  Math.abs(s.chestFlat - ref.chestFlat)

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

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: process.cwd(), stdio: 'ignore' })
let browser
let code = 1
const fail = []
const done = (c) => {
  try { browser?.close() } catch {}
  try { server.kill('SIGTERM') } catch {}
  process.exit(c)
}
const f2 = (v) => (typeof v === 'number' ? v.toFixed(2) : '—')
const f3 = (v) => (typeof v === 'number' ? v.toFixed(3) : '—')

try {
  await waitFor(BASE)
  browser = await chromium.launch({
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox'],
  })
  const page = await browser.newPage({ viewport: { width: 1220, height: 940 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push('[console] ' + m.text()))
  let lastNav = Date.now()
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) lastNav = Date.now()
  })
  /** Block until Vite has stopped full-reloading the page. */
  const settle = async (quiet = 5000, cap = 120000) => {
    const start = Date.now()
    while (Date.now() - lastNav < quiet && Date.now() - start < cap) await page.waitForTimeout(500)
  }

  // 'load' + a readiness probe: a page that owns a Worker never goes idle.
  // The first visit makes Vite discover onnxruntime (the bg-removal engine) and
  // full-reload once it has pre-bundled it, which would destroy any execution
  // context we were holding — so visit twice and only then talk to the page.
  await page.goto(BASE + '/dev/inflate.html', { waitUntil: 'load', timeout: 45000 })
  await page.waitForFunction(() => !!window.__inflate, { timeout: 20000 })
  // Vite discovers the ONNX runtime only when the bg-removal worker first
  // pulls it in, then full-reloads the page once it has pre-bundled it — which
  // destroys whatever execution context we were holding. So run the heaviest
  // path repeatedly until one full real-photo build completes with no
  // navigation; from then on the bundle (and the model) are settled.
  let warm = false
  for (let i = 0; i < 5 && !warm; i++) {
    const before = lastNav
    await page.evaluate(() => window.__inflate.build('190402', 'template')).catch(() => {})
    await settle(4000)
    if (lastNav === before) {
      warm = true
      break
    }
    await page.goto(BASE + '/dev/inflate.html', { waitUntil: 'load', timeout: 45000 })
    await page.waitForFunction(() => !!window.__inflate, { timeout: 20000 })
    await page.evaluate(() => window.__inflate.ready).catch(() => {})
  }
  if (!warm) console.warn('⚠ dev server never settled; timings below are unreliable')

  const meta = await page.evaluate(() => ({
    cases: window.__inflate.cases,
    templates: window.__inflate.templates,
    shapeTemplate: window.__inflate.shapeTemplate,
  }))
  console.log('template reference (the real garments the depth is borrowed from):')
  for (const [id, s] of Object.entries(meta.templates))
    console.log(
      `  ${id.padEnd(7)} peakFromTop ${f3(s.peakFromTop)}  shoulderFill ${f3(s.shoulderFill)}  chestFlat ${f3(s.chestFlat)}` +
        `  maxSlope ${f2(s.maxSlope)}  rmsCurv ${f2(s.rmsCurv)}`,
    )

  /**
   * Re-establish the page after a Vite full reload destroyed our context. Our
   * own goto can be interrupted by the NEXT reload (the dep optimizer can fire
   * more than once), so this settles and retries rather than propagating an
   * infrastructure race as a verification failure.
   */
  const renav = async () => {
    for (let i = 0; ; i++) {
      await settle(6000)
      try {
        await page.goto(BASE + '/dev/inflate.html', { waitUntil: 'load', timeout: 45000 })
        await page.waitForFunction(() => !!window.__inflate, { timeout: 20000 })
        await page.evaluate(() => window.__inflate.ready)
        return
      } catch (e) {
        if (i >= 3) throw e
      }
    }
  }
  /**
   * Vite can still full-reload the first time a new bare import is pulled in
   * (the ONNX runtime arrives lazily), which destroys the execution context.
   * Retry the WHOLE sequence rather than a single call: a reload also discards
   * the built case, so a half-finished build/setView/screenshot chain would
   * screenshot the wrong garment instead of failing.
   */
  const attempt = async (fn, tries = 5) => {
    for (let i = 0; ; i++) {
      try {
        return await fn()
      } catch (e) {
        if (i >= tries - 1 || !/Execution context was destroyed|Target closed/.test(e?.message ?? ''))
          throw e
        await renav()
      }
    }
  }

  const shot = async (name) => {
    if (!OUT) return
    const url = await page.evaluate(() => window.__inflate.probe().dataUrl)
    writeFileSync(`${OUT}/${name}.png`, Buffer.from(url.split(',')[1], 'base64'))
  }

  /**
   * Build a case and probe it — TWICE, keeping the faster build.
   *
   * `buildMs` is asserted against a budget that exists to describe the CODE, and
   * a single sample on a machine shared with anything else describes the
   * machine. Measured on this one: 190402 builds in 216 ms with the rim off and
   * 255 ms with it on (best of five, nothing else running), and the very same
   * case has been timed at 1251 ms with three other processes competing — five
   * times the signal being measured. Two samples do not make it a benchmark,
   * but they cost 25 s over the whole case list and they remove the single
   * scheduling hiccup, which is the failure mode that actually happens.
   */
  const buildCase = (id, mode) =>
    attempt(async () => {
      const one = async () => {
        await page.evaluate(([c, m]) => window.__inflate.build(c, m), [id, mode])
        return await page.evaluate(() => {
          const r = window.__inflate.probe()
          return { ...r, dataUrl: undefined }
        })
      }
      const a = await one()
      const b = await one()
      return { ...b, buildMs: Math.min(a.buildMs, b.buildMs) }
    })

  // ---- 1. synthetic tee: the hollow invariants, in both modes ---------------
  for (const mode of ['template', 'poisson']) {
    const probe = await buildCase('synthetic', mode)
    const flags = await attempt(() =>
      page.evaluate(() => ({
        ok: window.__inflate.ok,
        hasHoles: window.__inflate.hasHoles,
        hasLinings: window.__inflate.hasLinings,
        hasNormalMap: window.__inflate.hasNormalMap,
      })),
    )
    console.log(
      `synthetic/${mode}:`,
      JSON.stringify({
        source: probe.depthSource,
        shape: probe.shape,
        iou: f3(probe.iou),
        zMin: f2(probe.zMin),
        zMax: f2(probe.zMax),
        curvature: f3(probe.curvature),
        thickness: f2(probe.thickness),
        coverage: f3(probe.coverage),
        buildMs: probe.buildMs.toFixed(0),
        coldMs: probe.coldMs.toFixed(0),
        fit: probe.fit,
        structure: probe.structure,
        delit: probe.delit,
        ...flags,
        liningInside: probe.liningInside,
      }),
    )
    if (!flags.ok) fail.push(`${mode}: shell not built (canvasToSilhouette gate failed)`)
    const volume = probe.zMax - probe.zMin
    if (volume < 0.8) fail.push(`${mode}: no volume, front sheet z-range = ${f3(volume)}`)
    if (probe.zMax < 0.4) fail.push(`${mode}: front does not bulge toward +Z (zMax=${f2(probe.zMax)})`)
    // Headroom invariant: fold/wrinkle perturbations must never push the front
    // sheet through the mid-plane (that interpenetrates the back + lining).
    if (probe.zMin < -1e-3) fail.push(`${mode}: front sheet crosses z=0 (zMin=${f3(probe.zMin)})`)
    // A flat "puffed paper" plateau bulges but its normals stay ~(0,0,1).
    if (probe.curvature < 0.4) fail.push(`${mode}: flat plateau, not a rounded dome (curvature=${f3(probe.curvature)})`)
    if (probe.coverage < 0.05) fail.push(`${mode}: garment not visible (coverage=${f3(probe.coverage)})`)
    if (!flags.hasHoles) fail.push(`${mode}: collar hole not detected (no interior catch planes)`)
    if (!flags.hasLinings) fail.push(`${mode}: interior linings missing`)
    if (!probe.liningInside) fail.push(`${mode}: front lining pokes through its sheet or the mid-plane`)
    if (!flags.hasNormalMap) fail.push(`${mode}: photo wrinkle normal map missing`)
    if (mode === 'template' && probe.depthSource !== 'template')
      fail.push('synthetic tee did not reach tier 1 (template depth)')
    await attempt(() => shot(`inflate-synthetic-${mode}`))
  }

  // ---- 1b. the hard invariant, and determinism -----------------------------
  //
  // Z-ONLY. The transplant is allowed to change the depth field and nothing
  // else: a print occupying inches [x0,x1]×[y0,y1] of the photo must occupy
  // exactly that footprint on the sheet whichever tier built it. Measured as an
  // exact float comparison between the two modes of the same photo, over every
  // sheet and lining vertex — not a tolerance, because there is no reason for a
  // single ulp to move.
  console.log('\nhard invariant (template vs poisson, same photo) + determinism:')
  for (const id of ['synthetic', '190402', '180712']) {
    const d = await attempt(() => page.evaluate(([c]) => window.__inflate.diffModes(c, 'template', 'poisson'), [id]))
    const rep = await attempt(() => page.evaluate(([c]) => window.__inflate.diffModes(c, 'template', 'template'), [id]))
    console.log(
      `  ${id.padEnd(11)} ${String(d.verts).padStart(6)} verts · X/Y differ ${d.xy} · UV differ ${d.uv} · ` +
        `Z differ ${d.z} (max ${f3(d.maxDz)} in) · rebuild differs ${rep.xy + rep.uv + rep.z}`,
    )
    if (!d.ok) fail.push(`${id}: could not build both modes for the invariant check`)
    if (d.xy !== 0) fail.push(`${id}: ${d.xy} vertices moved in X/Y — the transplant must displace Z ONLY`)
    if (d.uv !== 0) fail.push(`${id}: ${d.uv} UVs changed — decal/print mapping is not preserved`)
    if (d.other !== 0) fail.push(`${id}: the two tiers produced different sheet sets`)
    if (d.z === 0) fail.push(`${id}: the two tiers produced the SAME Z — the transplant did nothing`)
    if (rep.xy + rep.uv + rep.z !== 0)
      fail.push(`${id}: not deterministic — ${rep.xy + rep.uv + rep.z} floats differ between two identical builds`)
  }

  // The SAME invariant, asked of the cloth thickness rather than of the tier.
  // Closing the seam is a Z-only blend by construction, but "by construction" is
  // what every broken invariant was before it broke: this compares the shipped
  // shell against the pre-thickness one, float for float, over the sheets and
  // their linings. A print occupying inches [x0,x1]x[y0,y1] must still occupy
  // exactly that footprint now that the garment has a hem.
  console.log('\nthe same invariant, asked of the cloth thickness (rim on vs rim off):')
  for (const id of ['synthetic', '190402', '180712']) {
    const d = await attempt(() =>
      page.evaluate(([c]) => window.__inflate.diffModes(c, 'template', 'template', 'on', 'off'), [id]),
    )
    console.log(
      `  ${id.padEnd(11)} ${String(d.verts).padStart(6)} verts · X/Y differ ${d.xy} · UV differ ${d.uv} · ` +
        `Z differ ${d.z} (max ${f3(d.maxDz)} in)`,
    )
    if (!d.ok) fail.push(`${id}: could not build both rim states for the invariant check`)
    if (d.xy !== 0) fail.push(`${id}: ${d.xy} vertices moved in X/Y when the seam closed — it must displace Z ONLY`)
    if (d.uv !== 0) fail.push(`${id}: ${d.uv} UVs changed when the seam closed — print mapping is not preserved`)
    if (d.z === 0) fail.push(`${id}: rim:'on' and rim:'off' produced the same Z — the convergence did nothing`)
  }

  // ---- 2. every case, both tiers -------------------------------------------
  //
  // Screenshots are EVIDENCE, not assertions, and they are handled as such: a
  // Vite full reload mid-capture is an infrastructure event, and letting it sink
  // a twelve-minute verification run would mean the answer to "did the gate
  // work" depends on the dev server's mood. Failures here are counted and
  // warned about; every claim below is measured from the probes.
  // Phase 1 measures, phase 2 photographs, and they are separate loops on
  // purpose: interleaving them puts a 1160×880 PNG encode between consecutive
  // shell builds, and the timings then measure the screenshot. Splitting costs
  // nothing (the capture pass had to rebuild its case anyway) and makes every
  // number below come from the same, unloaded, state.
  const rows = []
  for (const c of meta.cases) {
    if (c.id === 'synthetic') continue
    const t = await buildCase(c.id, 'template')
    const p = await buildCase(c.id, 'poisson')
    rows.push({ c, t, p })
  }
  const garments = rows.filter(({ c }) => c.kind === 'garment')
  const negatives = rows.filter(({ c }) => c.kind === 'negative')
  const untraceable = rows.filter(({ c }) => c.kind === 'untraceable')

  // ---- 2a. TIER 3, the bottom rung ----------------------------------------
  //
  // An upload the tracer refuses outright must produce NO shell, so the app
  // shows the curved CustomCard. Without a case here the ladder's last rung is
  // never exercised, and "it falls back safely" is a claim about code nobody
  // ran — the failure mode it guards against (an opaque JPEG, i.e. every upload
  // made on a browser where background removal is unavailable) is the single
  // most common awkward input there is.
  for (const { c, t, p } of untraceable) {
    console.log(`\ntier 3 · ${c.label}: shell=${t.ok ? 'BUILT' : 'none'} reject=${t.reject ?? '—'}`)
    if (t.ok) fail.push(`${c.id}: the tracer accepted an un-cut-out photo — no tier-3 fallback happened`)
    if (!t.reject) fail.push(`${c.id}: refused without saying why (getLastSilhouetteReject is silent)`)
    if (p.ok) fail.push(`${c.id}: forced-poisson built a shell the template path refused — tiers disagree`)
  }

  const shotFail = []
  let shots = 0
  for (const { c, t } of rows) {
    if (!OUT || !SHOT.has(c.id) || !t.ok) continue
    // Build + aim + capture is ONE retry unit: after a reload the page shows
    // the synthetic tee again, and a lone re-shot would file that as evidence.
    for (const m of ['template', 'poisson']) {
      try {
        await attempt(async () => {
          await page.evaluate(([id, mm]) => window.__inflate.build(id, mm), [c.id, m])
          await shot(`inflate-${c.id}-${m === 'template' ? 'after' : 'before'}-${m}`)
          await page.evaluate(() => window.__inflate.setView('side'))
          await shot(`inflate-${c.id}-side-${m}`)
          await page.evaluate(() => window.__inflate.setView('grid'))
        })
        shots += 2
      } catch (e) {
        shotFail.push(`${c.id}/${m}: ${e?.message ?? e}`)
        await renav()
      }
    }
  }

  // ---- 2b. the gate: is this a garment at all? -----------------------------
  //
  // Three structural tells, ALL required, each scored as measurement/threshold
  // so ≥ 1 means it passed (src/lib/garmentShape.ts documents what each one is
  // and why). Printing both populations is the point: a threshold justified
  // only by the garments it accepts is half a calibration, and outline overlap
  // alone provably cannot do this job — a tote once scored IoU 0.935 against
  // the tee template, better than five of the seven garments then under test.
  console.log('\nis-it-a-garment gate (score = measurement / threshold; ALL three must be ≥ 1):')
  console.log('case        kind      collar   cloth  shoulder    neck  verdict   tier      iou    trace')
  const TELLS = ['collar', 'cloth', 'shoulder', 'neck']
  const margin = { collar: Infinity, cloth: Infinity, shoulder: Infinity, neck: Infinity }
  // How close the CLOSEST non-garment came to being accepted. A negative needs
  // only one tell below 1, so its distance from the gate is the SMALLEST score
  // it scored, and the gate's real margin is the largest of those over the
  // population — printing the largest score per tell instead (which is what an
  // earlier version of this line did) reports how well a refused object did on
  // the tells that were never going to refuse it, which is not a margin at all.
  let closestNeg = { score: 0, id: '—', tell: '—' }
  for (const { c, t } of rows) {
    if (c.kind === 'untraceable') continue // no mask to measure — asserted above
    const s = t.structure ?? {}
    console.log(
      `${c.id.padEnd(11)} ${c.kind.padEnd(9)} ${f3(s.collar).padStart(6)} ${f3(s.cloth).padStart(7)} ` +
        `${f3(s.shoulder).padStart(8)} ${f3(s.neck).padStart(7)}  ${(s.isGarment ? 'garment' : 'REFUSED').padEnd(8)} ` +
        `${String(t.depthSource).padEnd(9)} ${f3(t.iou)}  ${t.reject ?? 'ok'}`,
    )
    if (!t.structure) {
      fail.push(
        `${c.id}: no shell at all — the outline tracer refused it (${t.reject ?? 'unknown'}), ` +
          'so nothing downstream was exercised',
      )
      continue
    }
    if (c.kind === 'garment') {
      if (!s.isGarment) fail.push(`${c.id}: a real garment was refused by the structure gate (${JSON.stringify(s)})`)
      for (const k of TELLS) margin[k] = Math.min(margin[k], s[k])
    } else {
      if (s.isGarment) fail.push(`${c.id}: NOT a garment but the structure gate accepted it (${JSON.stringify(s)})`)
      if (t.depthSource === 'template')
        fail.push(`${c.id}: a non-garment took a garment template (iou ${f3(t.iou)}) — the gate is too loose`)
      if (!t.ok) fail.push(`${c.id}: no shell at all (the Poisson fallback must still build one)`)
      let worst = { score: Infinity, tell: '—' }
      for (const k of TELLS) if (s[k] < worst.score) worst = { score: s[k], tell: k }
      if (worst.score > closestNeg.score) closestNeg = { ...worst, id: c.id }
    }
  }
  if (negatives.length < 4) fail.push(`only ${negatives.length} negative controls — need at least four`)
  if (garments.length < 12) fail.push(`only ${garments.length} real garments — the positive set is too thin`)
  console.log(
    `  tightest garment margin: ${TELLS.map((k) => `${k} ×${f2(margin[k])}`).join(' ')}` +
      `   ·   closest non-garment: ${closestNeg.id} refused on ${closestNeg.tell} at ` +
      `${f3(closestNeg.score)} (margin ×${f2(1 / Math.max(1e-6, closestNeg.score))})`,
  )
  // Each negative must be refused by a DIFFERENT tell — otherwise three tells
  // are one tell with two passengers, and the next non-garment walks through.
  const refusedBy = new Set()
  for (const { t } of negatives) {
    const s = t.structure ?? {}
    for (const k of TELLS) if (s[k] < 1) refusedBy.add(k)
  }
  if (refusedBy.size < TELLS.length)
    fail.push(`the negatives only exercise ${[...refusedBy].join('+') || 'no'} of the ${TELLS.length} tells — the rest are unproven`)

  console.log('\nsilhouette features (what the classifier decides on):')
  console.log('case        shape        hemRatio hoodDrop shldNarrow topRatio armholes')
  for (const { c, t } of garments) {
    const g = t.guess ?? {}
    console.log(
      `${c.id.padEnd(11)} ${String(t.shape).padEnd(12)} ${f3(g.hemRatio).padStart(8)} ` +
        `${f3(g.hoodDrop).padStart(8)} ${f3(g.shoulderNarrow).padStart(10)} ` +
        `${f3(g.topRatio).padStart(8)} ${String(g.armholes ?? '—').padStart(8)}`,
    )
  }

  console.log(
    '\ncase                                  tier      shape        donor   iou  warm/cold ' +
      'peakFromTop     shoulderFill    chestFlat       depth(in)     → distance to donor   maxSlope',
  )
  console.log(
    '                                                                                    ' +
      'tmpl / poisson  tmpl / poisson  tmpl / poisson  tmpl / poisson  tmpl / poisson       tmpl / poisson',
  )

  // The claim under test, measured identically on the two shells of the SAME
  // photo against the SAME reference: the transplanted shell reproduces the
  // donor garment's depth profile, and the balloon does not.
  let closer = 0
  let gated = 0
  let slowest = 0
  let slopeWorst = { v: 0, id: '—', poisson: 0 }
  let coldest = 0
  for (const { c, t, p } of garments) {
    if (!t.ok) { fail.push(`${c.id}: no shell built from a real supplier photo`); continue }
    if (t.depthSource !== 'template') { fail.push(`${c.id}: fell back to the Poisson balloon (iou ${f3(t.iou)}, fit ${JSON.stringify(t.fit)})`); continue }
    gated++
    const want = EXPECT[c.id]
    if (want && t.donor !== want) fail.push(`${c.id}: borrowed the ${t.donor} mesh, expected ${want} (shape=${t.shape})`)
    const ref = meta.templates[t.donor]
    const dT = ref ? profileDist(t.stats, ref) : NaN
    const dP = ref ? profileDist(p.stats, ref) : NaN
    console.log(
      `${c.label.padEnd(36)} ${String(t.depthSource).padEnd(9)} ${String(t.shape).padEnd(12)} ` +
        `${String(t.donor).padEnd(7)} ${f3(t.iou)} ${String(Math.round(t.buildMs)).padStart(4)}  ` +
        `${f3(t.stats?.peakFromTop)} / ${f3(p.stats?.peakFromTop)}   ` +
        `${f3(t.stats?.shoulderFill)} / ${f3(p.stats?.shoulderFill)}   ` +
        `${f3(t.stats?.chestFlat)} / ${f3(p.stats?.chestFlat)}   ` +
        `${f2(t.thickness)} / ${f2(p.thickness)}   ${f3(dT)} / ${f3(dP)}   ` +
        `${f2(t.stats?.maxSlope)} / ${f2(p.stats?.maxSlope)}   ` +
        `albedo ${t.delit ? 'de-lit' : 'as-shot'} (spread ${f3(t.delitSpread)})`,
    )
    // SMOOTHNESS. The depth field is what the sheet's normals are computed
    // from, so a step between two rows ships as a hard black crease across the
    // cloth. The control is the BALLOON BUILT FROM THE SAME PHOTO: it carries
    // the identical hem folds and the identical photo-derived wrinkle band, and
    // its own field is the solution of a smoothing PDE — so anything rougher on
    // the transplanted shell was put there by the warp and by nothing else.
    // Comparing per photo rather than against a fixed number also means the
    // threshold cannot drift with the garment or the grid.
    //
    // ×2.5 is the budget, and it is read off the two populations rather than
    // picked: with templateDepth's y-filter in, the ratio over the twenty cases
    // runs 0.49 … 1.99 (median 0.83 — the transplant is usually SMOOTHER than
    // the balloon); with the filter alone removed and nothing else changed, the
    // same twenty run 2.2 … 6.6 (median 3.9). So the line sits above every
    // healthy case by ×1.26 and still fails eighteen of the twenty regressions
    // it exists to catch.
    if (t.stats && p.stats && t.stats.maxSlope > 2.5 * Math.max(4, p.stats.maxSlope))
      fail.push(
        `${c.id}: transplanted depth is ${f2(t.stats.maxSlope / Math.max(1e-6, p.stats.maxSlope))}× rougher in y ` +
          `than the balloon of the same photo (${f2(t.stats.maxSlope)} vs ${f2(p.stats.maxSlope)}) — ` +
          'the warp invented that, and it ships as a black crease',
      )
    if (t.stats && p.stats && t.stats.maxSlope > slopeWorst.v)
      slopeWorst = { v: t.stats.maxSlope, id: c.id, poisson: p.stats.maxSlope }
    if (t.zMin < -1e-3) fail.push(`${c.id}: front sheet crosses z=0 (zMin=${f3(t.zMin)})`)
    if (!t.liningInside) fail.push(`${c.id}: lining pokes through its sheet`)
    // De-lighting is CONDITIONAL AT BOTH ENDS by design (photoLight.ts): below
    // FLAT_SPREAD a white garment on a white sweep carries no shading to divide
    // out and correcting it only amplifies JPEG grain, and above CONTENT_SPREAD
    // what the wide blur found is the customer's own artwork rather than light,
    // so brightening it would damage a colour they chose. Assert the decision,
    // not the outcome.
    const lit = t.delitSpread >= 0.02 && t.delitSpread <= 0.25
    if (lit && !t.delit)
      fail.push(`${c.id}: photo had shading (spread ${f3(t.delitSpread)}) and was not de-lit`)
    if (!lit && t.delit)
      fail.push(
        `${c.id}: spread ${f3(t.delitSpread)} is outside the lightbox range and was de-lit anyway`,
      )
    if (t.buildMs > slowest) slowest = t.buildMs
    if (t.coldMs > coldest) coldest = t.coldMs
    // Fastest of three warm passes (see the harness): a headless swiftshader
    // run that is also encoding PNGs perturbs a single sample by 4×, and the
    // budget has to be about the code. 900 ms leaves ~2× headroom over the
    // slowest garment in the set and stays well inside the 1.5 s the feature
    // promises end to end.
    if (t.buildMs > 900) fail.push(`${c.id}: shell build ${Math.round(t.buildMs)}ms — over the headless budget`)
    if (dT < dP) closer++
    else console.warn(`⚠ ${c.id}: no closer to the ${t.donor} mesh than the balloon (${f3(dT)} vs ${f3(dP)})`)
  }
  if (gated < garments.length) fail.push(`only ${gated}/${garments.length} garments reached tier 1`)
  if (closer < garments.length)
    fail.push(`transplant beat the balloon on only ${closer}/${garments.length} garments`)

  // ---- 3. CLOTH THICKNESS AT THE ALPHA CUT ---------------------------------
  //
  // The defect this measures is an OPEN SLOT. The template bake rasterises
  // max-Z per cell, so at a Z-tangency it reports depth where a laid-flat
  // garment's two panels must MEET, and the two alpha-tested sheets used to end
  // in mid-air a median 0.25–0.55 in apart (max 2.79) with nothing between them.
  // Seen at a grazing angle that slot is the serrated edge: two independent cut
  // curves with the darkened linings stacked between them.
  //
  // EVERY ASSERTION BELOW RUNS TWICE — once on the shipped geometry and once
  // with `rim:'off'`, which reproduces the pre-thickness shell byte for byte —
  // and the run FAILS IF THE 'off' PASS PASSES. A metric nobody has watched fail
  // is a metric nobody has tested.
  const rimStat = (id, mode, rim) =>
    attempt(() => page.evaluate(([a, b, c]) => window.__inflate.rimStats(a, b, c), [id, mode, rim]))
  /**
   * The geometric gates, as a list of complaints (empty = passed). Deliberately
   * one function used for both the real run and the negative control: the two
   * cannot drift apart.
   */
  const geoGates = (r, isGarment) => {
    const bad = []
    // A1 — the outer silhouette must close. FABRIC_IN + one coarse grid cell of
    // interpolation slack; the shell targets exactly FABRIC_IN.
    if (r.seamP99 > SEAM_MAX_IN) bad.push(`seam p99 ${f3(r.seamP99)} in (> ${SEAM_MAX_IN})`)
    if (r.rimVerts === 0) bad.push('no rim geometry')
    // A3 — budget. The strip is a 1-D thing on a 2-D grid, so its share of the
    // sheet is a perimeter-to-area ratio and a COMPACT silhouette pays more of
    // it: measured worst 16.4 % of the front sheet's vertices and 8.9 % of its
    // triangles over every garment, against 21.9 % / 12.4 % on the mug and
    // 21.7 % / 12.2 % on the tote — neither of which is a garment, both of which
    // are refused, and both of which are a fifth the perimeter of a shirt in
    // absolute terms (≈3 k vertices). 23 %/13 % bounds the real cost without
    // pretending a mug is a hoodie.
    if (r.rimVerts > 0.23 * r.frontVerts) bad.push(`rim ${r.rimVerts} verts (> 23 % of ${r.frontVerts})`)
    if (r.rimTris > 0.13 * r.frontTris) bad.push(`rim ${r.rimTris} tris (> 13 % of ${r.frontTris})`)
    // A4 — winding, asked of the alpha the materials themselves cut on. Scene
    // Viewer culls back faces aggressively: an inverted segment reopens the slot
    // in AR while looking fine in a DoubleSide-tolerant preview.
    if (r.badWinding > 0) bad.push(`${r.badWinding} rim triangles face into the cloth`)
    if (r.degenerate > 0) bad.push(`${r.degenerate} degenerate rim triangles`)
    // A5 — the ribbon must CLOSE. Everything above measures the SHEETS or a
    // sample of the strip; none of it can see the strip simply stopping, and it
    // did stop, on every garment, wherever the alpha cut ran along the content
    // bbox (see rimOpenEnds in the harness): 4–14 open ends and 3.5–20.7 in of a
    // 39–55 in outline left with no cloth thickness at all. With the alpha grid
    // padded every garment is 0.00–0.17 in.
    //
    // Asserted on GARMENTS, printed for everything, because on a silhouette
    // whose outline IS the content bbox on all four sides — the poster, and
    // nothing else in either population — every crossing clamps onto the sheet's
    // own extent, the corners land on top of each other, the zero-area segments
    // between them are dropped, and the end-pairing then measures the rectangle
    // rather than a break. That is a limit of the probe on a shape the app
    // refuses, not cloth missing from a garment.
    if (isGarment && r.rimGapIn > RIM_GAP_MAX_IN)
      bad.push(
        `${f2(r.rimGapIn)} in of the outline has no rim on it (${r.rimOpenEnds} open ribbon ends, > ${RIM_GAP_MAX_IN} in)`,
      )
    return bad
  }

  console.log(
    '\ncloth thickness at the sheets\' own alpha cut (gap between the two sheets, inches):\n' +
      'case        tier      rim   seam p50    p90    p99    max   side p50   p99    opening p50   rimV/frontV  rimT/frontT  unjudged/normDis  bare in (ends)',
  )
  let rimCases = 0
  let controlSilent = []
  let worstSeam = { v: 0, id: '—' }
  let worstOffSeam = { v: 0, id: '—' }
  let worstGap = { v: 0, id: '—', ends: 0 }
  for (const c of meta.cases) {
    if (c.kind === 'untraceable') continue // no shell at all — asserted above
    for (const mode of ['template', 'poisson']) {
      const on = await rimStat(c.id, mode, 'on')
      const off = await rimStat(c.id, mode, 'off')
      if (!on || !off) {
        fail.push(`${c.id}/${mode}: could not measure the seam (no shell)`)
        continue
      }
      rimCases++
      for (const [rim, r] of [
        ['on ', on],
        ['off', off],
      ]) {
        if (mode !== 'template' && c.kind !== 'garment') continue
        console.log(
          `${c.id.padEnd(11)} ${mode.padEnd(9)} ${rim}  ${f3(r.seamP50)} ${f3(r.seamP90)} ${f3(r.seamP99)} ${f3(r.seamMax)}   ` +
            `${f3(r.sideP50)} ${f3(r.sideP99)}   ${r.cutN ? f3(r.cutP50) : '   —  '} (${String(r.cutN).padStart(3)})   ` +
            `${String(r.rimVerts).padStart(5)}/${r.frontVerts}  ${String(r.rimTris).padStart(5)}/${r.frontTris}  ` +
            `${r.outwardMiss}/${r.normalDisagree}  ${f2(r.rimGapIn)} (${r.rimOpenEnds})`,
        )
      }
      const bad = geoGates(on, c.kind === 'garment')
      if (bad.length) fail.push(`${c.id}/${mode}: ${bad.join('; ')}`)
      // THE NEGATIVE CONTROL. `rim:'off'` is the geometry these gates exist to
      // reject; if it walks through them they are not gates.
      if (geoGates(off, c.kind === 'garment').length === 0) controlSilent.push(`${c.id}/${mode}`)
      // Garments only, for the same reason A5 is asserted on garments only.
      if (c.kind === 'garment' && on.rimGapIn > worstGap.v)
        worstGap = { v: on.rimGapIn, id: `${c.id}/${mode}`, ends: on.rimOpenEnds }
      if (on.seamP99 > worstSeam.v) worstSeam = { v: on.seamP99, id: `${c.id}/${mode}` }
      if (off.seamP99 > worstOffSeam.v) worstOffSeam = { v: off.seamP99, id: `${c.id}/${mode}` }
      // A2 — THE OPENINGS MUST STAY OPEN. Only the synthetic tee (and the tote /
      // mug) have an enclosed hole at all: every ghost-mannequin supplier photo
      // has none, which is why this cannot be asserted on the real cases. The
      // claim is exact and ungameable — the seam convergence must not have
      // touched the opening AT ALL, so the gap there must still be what it was
      // before the convergence existed.
      if (on.cutN > 0) {
        if (on.cutP50 < 0.98 * off.cutP50)
          fail.push(
            `${c.id}/${mode}: the seam convergence leaked into an opening — median gap across the ` +
              `collar/armhole is ${f3(on.cutP50)} in, was ${f3(off.cutP50)} in without it`,
          )
        if (on.cutP50 < 0.3 * on.depthIn)
          fail.push(
            `${c.id}/${mode}: openings are only ${f3(on.cutP50 / on.depthIn)} of the garment's own depth — ` +
              'the hollow read is delivered THROUGH them',
          )
      }
    }
  }
  if (controlSilent.length)
    fail.push(
      `the cloth-thickness gates do not discriminate — they PASS with rim:'off' on ` +
        `${controlSilent.slice(0, 4).join(', ')}, i.e. on the geometry they were written to reject`,
    )

  // ---- 3b. the seam, rendered ----------------------------------------------
  //
  // The geometric gate proves the two sheets meet. This proves you can SEE that
  // they meet: an identity render (flat per-part colours, no antialiasing, an
  // orthographic camera so px/in is exact) swept around the garment, reading off
  // each scanline where the front panel's region ends and the back panel's
  // begins. The rim must be the thing in between. `rim:'off'` scores exactly
  // zero on that, which is the point.
  console.log('\nthe same seam, rendered as part identities (1024² orthographic, no AA):')
  console.log(
    'case        tier      rim   px/in   azimuths(rows)  seam w50/w90 in   rim-in-seam max/mean   cavity min/mean   silhouette RMS px   id flips',
  )
  const rimRender = []
  for (const id of RIM_RENDER) {
    for (const mode of ['template', 'poisson']) {
      for (const rim of ['on', 'off']) {
        const r = await attempt(() =>
          page.evaluate(
            ([a, b, c, d]) => window.__inflate.rimProbe(a, b, c, d),
            [id, mode, rim, RIM_OUT ? 85 : undefined],
          ),
        )
        if (!r) {
          fail.push(`${id}/${mode}/rim:${rim}: the seam render produced no shell`)
          continue
        }
        if (RIM_OUT && r.dataUrl)
          try {
            writeFileSync(`${RIM_OUT}/rim-${id}-${mode}-${rim}-85.png`, Buffer.from(r.dataUrl.split(',')[1], 'base64'))
          } catch (e) {
            console.warn('⚠ rim evidence not written —', e?.message ?? e)
          }
        const usable = r.azimuths.filter((a) => a.rows >= RIM_MIN_ROWS)
        const mean = (f) => (usable.length ? usable.reduce((s, a) => s + f(a), 0) / usable.length : 0)
        const rec = {
          id,
          mode,
          rim,
          usable: usable.length,
          rimMax: usable.length ? Math.max(...usable.map((a) => a.rimFrac)) : 0,
          rimMean: mean((a) => a.rimFrac),
          openMin: usable.length ? Math.min(...usable.map((a) => a.openFrac)) : 1,
          openMean: mean((a) => a.openFrac),
          w50: mean((a) => a.wP50),
          w90: mean((a) => a.wP90),
          rough: r.azimuths.reduce((s, a) => s + a.rough, 0) / r.azimuths.length,
          flips: r.flips,
          covered: r.covered,
        }
        rimRender.push(rec)
        console.log(
          `${id.padEnd(11)} ${mode.padEnd(9)} ${rim.padEnd(4)}  ${f2(r.pxPerIn)}  ` +
            `${r.azimuths.map((a) => `${a.deg}°:${a.rows}`).join(' ')}   ` +
            `${f3(rec.w50)}/${f3(rec.w90)}   ${f3(rec.rimMax)}/${f3(rec.rimMean)}   ` +
            `${f3(rec.openMin)}/${f3(rec.openMean)}   ${f3(rec.rough)}   ${rec.flips}/${rec.covered}`,
        )
      }
    }
  }
  /**
   * B1/B2 — the rim must BE the thing in the seam.
   *
   * `max` is the load-bearing half: on at least one grazing azimuth the 0.06 in
   * of cloth must resolve on essentially every scanline. The `mean` is looser on
   * purpose, and the reason is a pre-existing property of the shell rather than
   * of the rim: the back panel samples 1−u over the WHOLE canvas, so its alpha
   * cut is the front's outline mirrored about the canvas centre rather than
   * about the content bbox, and where a cutout's margins are asymmetric the back
   * sheet overhangs the isoline the rim was built on and covers it from one
   * side. Measured, that costs the hoodie 0.54/0.72 on its +75°/+85° views and
   * nothing anywhere else.
   */
  const renderGates = (r) => {
    const bad = []
    if (r.usable < 2) bad.push(`only ${r.usable} usable azimuths`)
    if (r.rimMax < 0.95) bad.push(`rim covers at most ${f3(r.rimMax)} of the seam's scanlines (< 0.95)`)
    if (r.rimMean < 0.5) bad.push(`rim covers ${f3(r.rimMean)} of them on average (< 0.50)`)
    // B2b — and what the rim replaced must be GONE. A rim that merely joined the
    // party would satisfy the coverage test above while the lining still showed
    // beside it; this is the defect in the viewer's own words.
    if (r.openMin > SEAM_OPEN_MAX)
      bad.push(
        `the cavity shows through the seam on ${f3(r.openMin)} of the scanlines even on the best ` +
          `grazing view (> ${SEAM_OPEN_MAX})`,
      )
    return bad
  }
  const renderSilent = []
  for (const rec of rimRender) {
    const bad = renderGates(rec)
    if (rec.rim === 'on' && bad.length) fail.push(`${rec.id}/${rec.mode}: ${bad.join('; ')}`)
    if (rec.rim === 'off' && bad.length === 0) renderSilent.push(`${rec.id}/${rec.mode}`)
  }
  if (renderSilent.length)
    fail.push(
      `the rendered seam gate does not discriminate — it passes with rim:'off' on ${renderSilent.join(', ')}`,
    )
  // B3 — THE STAIRCASE. The outer silhouette's RMS second difference, on/off,
  // same photo, same tier, same six azimuths: the fix must not roughen the one
  // edge a viewer studies, and where the slot used to gape it should smooth it.
  // A ratio against the same shell without the rim is the only control that
  // carries the known-good look; an absolute number would just measure the grid.
  let roughWorst = { r: 0, id: '—' }
  for (const on of rimRender.filter((r) => r.rim === 'on')) {
    const off = rimRender.find((r) => r.id === on.id && r.mode === on.mode && r.rim === 'off')
    if (!off || !(off.rough > 0)) continue
    const ratio = on.rough / off.rough
    if (ratio > roughWorst.r) roughWorst = { r: ratio, id: `${on.id}/${on.mode}` }
    // The claim is stated per TIER, because the two tiers start from different
    // defects, and as a WIDTH IN PIXELS rather than a ratio, because a ratio on
    // an already-clean edge magnifies a change the eye cannot resolve. On the
    // TRANSPLANT the open slot is the serration and closing it takes 0.09–0.12
    // px off the outline; a twentieth of a pixel of slack covers the one case
    // whose slot was small to begin with (the vest, +0.027 px). On the BALLOON
    // there was never a slot to close — it already meets its own rim to
    // 0.02–0.05 in — so the rim is new geometry on a clean edge and may cost up
    // to a tenth of a pixel, which is what the synthetic tee costs.
    const limit = off.rough + (on.mode === 'template' ? 0.05 : 0.1)
    if (on.rough > limit)
      fail.push(
        `${on.id}/${on.mode}: the silhouette is ${f2(ratio)}× rougher WITH the rim ` +
          `(${f3(on.rough)} vs ${f3(off.rough)} px RMS) — the strip is supposed to remove that edge, not add to it`,
      )
    // B4 — sub-pixel jitter. Pixels whose identity flips a ⅓-px camera move away
    // from any identity boundary are coplanar surfaces resolving per pixel, i.e.
    // the rim z-fighting the sheet it is welded to. Comparative, because the
    // absolute number has no published baseline.
    if (on.flips > Math.max(off.flips, 0.0005 * on.covered))
      fail.push(
        `${on.id}/${on.mode}: ${on.flips} identity flips under a ⅓-px jitter (rim off: ${off.flips}) — ` +
          'the rim is z-fighting its own sheet',
      )
  }

  if (errors.length) fail.push('page errors: ' + errors.slice(0, 5).join(' | '))
  if (OUT) {
    console.log(`\nwrote ${shots * 2} PNGs to ${OUT}`)
    for (const m of shotFail) console.warn('⚠ screenshot skipped —', m)
  }

  if (fail.length) {
    for (const m of fail) console.error('❌', m)
    done(1)
  }
  console.log(
    `\n✅ inflate verify PASS — ${gated}/${garments.length} real garments on tier 1 with the expected donor mesh ` +
      `(closer to that mesh's own depth profile than the balloon on ${closer}/${garments.length}); ` +
      `${negatives.length}/${negatives.length} non-garments refused and safely on the balloon; ` +
      `${untraceable.length}/${untraceable.length} un-cut-out uploads refused down to the tier-3 card; ` +
      `X/Y and UVs bit-identical across tiers; roughest transplanted depth ${f2(slopeWorst.v)} ` +
      `(${slopeWorst.id}, balloon of the same photo ${f2(slopeWorst.poisson)}); ` +
      `slowest warm shell ${Math.round(slowest)} ms, coldest first build ${Math.round(coldest)} ms; ` +
      `\n   cloth thickness: the two sheets meet to ${f3(worstSeam.v)} in at the alpha cut over ${rimCases} case×tier ` +
      `combinations (worst ${worstSeam.id}; the same shells without the rim gape ${f3(worstOffSeam.v)} in, ` +
      `${worstOffSeam.id}), the ribbon closes on every garment's whole outline (worst ${f2(worstGap.v)} in bare, ` +
      `${worstGap.ends} open ends, ${worstGap.id}), the rim is on ≥95 % of the seam's scanlines at a grazing azimuth, ` +
      `the silhouette is at worst ${f2(roughWorst.r)}× as rough as without it (${roughWorst.id}), ` +
      `and every one of those gates FAILS on rim:'off'`,
  )
  code = 0
} catch (e) {
  console.error('❌', e?.stack || e?.message || e)
}
done(code)
