/**
 * Headless verification of the FRONT + BACK guarantee.
 *
 * Two suites, because the guarantee has two halves:
 *
 *  A. SNAPSHOT (pure Node, no browser) — the supplier catalogue committed under
 *     public/catalog/imbretex carries both views for EVERY product: a front and
 *     a back file on disk, each a decodable bitmap, front ≠ back by content
 *     hash, no orphan images. The four references upstream publishes no back
 *     for carry a RECONSTRUCTION, and that is asserted as such — file present,
 *     `origin: 'generated'`, full `generatedFrom` provenance, and its id on the
 *     allow-list below. Every other product's back must be a real photograph
 *     with NO origin field, so a reconstruction can never be relabelled as one
 *     and a new back-less product FAILS instead of quietly shipping.
 *
 *  B. GENERATOR (Vite dev + real bundle) — the reconstruction is deterministic,
 *     mirrors the silhouette exactly, is provably free of the front's artwork
 *     (no high-frequency edge survives the low-pass), carries no centred
 *     placket, has no alpha-bleed halo, and reports a symmetry number that
 *     actually discriminates a symmetric garment from one with a chest pocket.
 *     Run on a synthetic tee AND on the real 143100 front — a white vest on a
 *     white backdrop, the worst case for halo — whose real back is then used as
 *     ground truth for the colour and luminance the reconstruction claims, plus
 *     the four committed backs themselves.
 *
 *   node scripts/backphoto-verify.mjs
 *   BACK_OUT_DIR=/abs/dir node scripts/backphoto-verify.mjs   # dump PNGs
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const PORT = 5195
const BASE = `http://localhost:${PORT}`
const ROOT = 'public/catalog/imbretex'
const OUT = process.env.BACK_OUT_DIR

/**
 * Products the supplier publishes NO back view for, in any colourway — probed
 * live on 2026-07-27, every colourway carrying a visuals endpoint (13, 13, 2, 2
 * of them), each answering exactly one shot whose origin ends in `_front`.
 *
 * Adding an id here is a deliberate statement that the gap is upstream's, not
 * the scraper's — never a way to silence the check. It no longer means "may
 * have no back": these MUST have a reconstructed back on disk, correctly
 * tagged. It is the list of products allowed to have a generated one, and
 * nothing else may.
 */
const NO_UPSTREAM_BACK = ['202358', '202359', '191135', '191137']

const results = []
const ok = (name, pass, extra = '') => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`)
}
const near = (a, b, tol) => Math.abs(a - b) <= tol

// ===========================================================================
// A. SNAPSHOT
// ===========================================================================

const snap = JSON.parse(readFileSync(`${ROOT}/products.json`, 'utf8'))
const files = new Set(readdirSync(`${ROOT}/img`))
const md5 = (f) => createHash('md5').update(readFileSync(`${ROOT}/img/${f}`)).digest('hex')
/**
 * Decodable bitmap, not "ends in .jpg": the supplier's resize endpoint answers
 * PNG for a handful of references (191052, 191054, 75196) even on a .jpg URL.
 * Browsers sniff the content, so the app never noticed — a check that assumed
 * JPEG would have failed on perfectly good photos.
 */
const isImage = (f) => {
  const b = readFileSync(`${ROOT}/img/${f}`)
  if (b.length <= 5120) return false
  const jpeg = b[0] === 0xff && b[1] === 0xd8 && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9
  const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
  return jpeg || png
}

ok('snapshot.count', snap.count === snap.products.length, `${snap.count} products`)

const noFront = []
const noBack = []
const badFile = []
const dupPair = []
/** Ids whose back carries origin 'generated' (a committed reconstruction). */
const generated = []
/** Ids whose back is a supplier photograph (no origin field — absent ⇒ photo). */
const real = []
/** Generated backs whose provenance record is incomplete or wrong. */
const badProvenance = []
for (const p of snap.products) {
  const view = p.views?.back
  const front = p.views?.front?.file?.replace('img/', '')
  const back = view?.file?.replace('img/', '')
  if (!front || !files.has(front) || !isImage(front)) {
    noFront.push(p.id)
    continue
  }
  if (!back) {
    noBack.push(p.id)
    continue
  }
  if (!files.has(back) || !isImage(back)) badFile.push(p.id)
  else if (md5(front) === md5(back)) dupPair.push(p.id)
  if (view.origin === 'generated') {
    generated.push(p.id)
    const g = view.generatedFrom
    // Every field the UI, the AR export and support read off a reconstruction.
    if (
      !g ||
      g.method !== 'front-mirror-flood' ||
      g.v !== 2 ||
      !/^#[0-9a-f]{6}$/.test(String(g.colorHex)) ||
      !['supplier-swatch', 'sampled'].includes(g.colorSource) ||
      typeof g.placketSuppressed !== 'boolean' ||
      !(g.symmetry >= 0 && g.symmetry <= 1) ||
      !(g.at > 0)
    )
      badProvenance.push(p.id)
  } else if (view.origin === undefined) real.push(p.id)
  else badProvenance.push(p.id) // an origin the app does not know how to badge
}
ok('snapshot.front-on-disk', noFront.length === 0, noFront.join(', '))
ok('snapshot.back-decodable', badFile.length === 0, badFile.join(', '))
ok('snapshot.back-is-a-second-shot', dupPair.length === 0, dupPair.join(', '))

// THE invariant, stated positively: nothing in the catalogue is back-less.
ok(
  'snapshot.every-product-has-a-back',
  noBack.length === 0,
  noBack.length ? `NO back at all: ${noBack.join(', ')}` : `${snap.products.length}/${snap.products.length}`,
)
const declared = [...(snap.backMissing ?? [])].sort()
ok('snapshot.backMissing-declared', Array.isArray(snap.backMissing))
// `backMissing` is a statement about the SUPPLIER, so it must name exactly the
// products whose back we had to reconstruct — no more, no less.
ok(
  'snapshot.backMissing-matches-reconstructions',
  JSON.stringify(declared) === JSON.stringify([...generated].sort()),
  `declared ${declared.join(',') || '—'} · generated on disk ${generated.join(',') || '—'}`,
)
const unexpected = generated.filter((id) => !NO_UPSTREAM_BACK.includes(id))
ok(
  'snapshot.no-unexplained-reconstruction',
  unexpected.length === 0,
  unexpected.length
    ? `reconstruction NOT verified as an upstream gap: ${unexpected.join(', ')}`
    : `${generated.length} known upstream gaps, all reconstructed`,
)
// The other direction: a photograph must never end up wearing a preview tag,
// and a reconstruction must never lose one.
ok(
  'snapshot.real-backs-untagged',
  real.length === snap.products.length - generated.length - noBack.length &&
    real.every((id) => !NO_UPSTREAM_BACK.includes(id)),
  `${real.length} supplier photographs, none on the reconstruction list`,
)
ok(
  'snapshot.generated-provenance-complete',
  badProvenance.length === 0,
  badProvenance.length ? `bad/missing generatedFrom: ${badProvenance.join(', ')}` : 'method+v+colour+placket+symmetry+at',
)
// `backProbe` post-dates this snapshot, so its ABSENCE is not a failure — the
// allow-list comment carries the live-probe evidence for these four instead.
// When a re-scrape does write it, an under-probed product may not claim to be
// an upstream gap: that is the scraper bug this check exists to make loud.
// Mirrors `exhaustive` in scripts/scrape-imbretex.mjs, including its two
// degenerate readings: a probe of ZERO colourways, and a probe whose scrape
// aborted (recorded as probed: 0), are both "we did not look", not "we looked
// at all of them" — `0 >= 0` used to say the latter.
const underProbed = generated
  .map((id) => snap.products.find((p) => p.id === id))
  .filter(
    (p) =>
      p.backProbe &&
      !(p.backProbe.colourways > 0 && p.backProbe.probed >= p.backProbe.colourways),
  )
ok(
  'snapshot.backMissing-evidence-is-exhaustive',
  underProbed.length === 0,
  underProbed.length
    ? underProbed.map((p) => `${p.id}: only ${p.backProbe.probed}/${p.backProbe.colourways} colourways probed`).join(', ')
    : generated.every((id) => snap.products.find((p) => p.id === id)?.backProbe)
      ? 'every colourway probed on all four'
      : 'no backProbe recorded (pre-dates the field) — see NO_UPSTREAM_BACK',
)
const orphans = [...files].filter((f) => {
  const [id, view] = f.replace(/\.(jpg|png)$/, '').split('-')
  return !snap.products.some((p) => p.id === id && p.views?.[view]?.file === `img/${f}`)
})
ok('snapshot.no-orphan-images', orphans.length === 0, orphans.slice(0, 6).join(', '))
console.log(
  `\n  backs: ${real.length}/${snap.products.length} supplier photographs, ` +
    `${generated.length} reconstructed (${generated.join(', ')})\n`,
)

// ===========================================================================
// B. GENERATOR
// ===========================================================================

const waitFor = (url, ms = 40000) =>
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
const done = (c) => {
  try {
    browser?.close()
  } catch {}
  try {
    server.kill('SIGTERM')
  } catch {}
  process.exit(c)
}

try {
  await waitFor(BASE)
  browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] })
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)))
  if (OUT) await page.addInitScript(() => ((window).__backDump = true))
  // A harness page spawning a Worker never reaches network-idle under Vite.
  const open = async () => {
    await page.goto(`${BASE}/dev/ingest.html`, { waitUntil: 'load', timeout: 45000 })
    await page.waitForFunction(() => !!document.getElementById('root')?.children.length, {
      timeout: 30000,
    })
  }
  await open()
  // Warm-up: the first dynamic import can make Vite pre-bundle a new dep and
  // force a full reload, which would destroy the execution context mid-probe.
  await page
    .evaluate(async () => {
      await import('/src/lib/ingest/pipeline.ts')
      await import('/src/state/assets.ts')
      await import('/src/lib/custom.ts')
    })
    .catch(() => undefined)
  await page.waitForTimeout(1500)
  await open()

  const probe = await page.evaluate(async () => {
    const pipeline = await import('/src/lib/ingest/pipeline.ts')
    const assets = await import('/src/state/assets.ts')
    const custom = await import('/src/lib/custom.ts')
    const { generateBackFromFront, generateBackSide, normalizeGarmentPhoto } = pipeline

    // ---- helpers --------------------------------------------------------
    const toBlob = (c) => new Promise((r) => c.toBlob(r, 'image/png'))
    const sha = async (blob) => {
      const d = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
      return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
    }
    const decode = async (blob) => {
      const img = new Image()
      const url = URL.createObjectURL(blob)
      await new Promise((res, rej) => {
        img.onload = res
        img.onerror = rej
        img.src = url
      })
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const x = c.getContext('2d', { willReadFrequently: true })
      x.drawImage(img, 0, 0)
      URL.revokeObjectURL(url)
      return { canvas: c, data: x.getImageData(0, 0, c.width, c.height), w: c.width, h: c.height }
    }
    const lum = (d, i) => (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255
    /** Tight alpha bbox (same >16 convention as the app). */
    const bboxOf = ({ data, w, h }) => {
      let x0 = w, y0 = h, x1 = -1, y1 = -1
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          if (data.data[(y * w + x) * 4 + 3] > 16) {
            if (x < x0) x0 = x
            if (x > x1) x1 = x
            if (y < y0) y0 = y
            if (y > y1) y1 = y
          }
      return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
    }

    /**
     * Laid-flat tee with a saturated chest print. `variant`:
     *   'pocket' — a patch pocket INSIDE the silhouette (the outline is
     *              untouched, so this is the metric's documented blind spot)
     *   'hem'    — an asymmetric outline (one side cut away), which the
     *              silhouette IoU must catch.
     */
    function syntheticTee(variant) {
      const c = document.createElement('canvas')
      c.width = 800
      c.height = 900
      const g = c.getContext('2d')
      g.fillStyle = '#b7bcc2'
      g.beginPath()
      g.moveTo(220, 130)
      g.lineTo(580, 130)
      g.lineTo(590, 850)
      g.lineTo(210, 850)
      g.closePath()
      g.fill()
      g.fillStyle = '#adb3ba'
      for (const s of [-1, 1]) {
        g.beginPath()
        g.moveTo(400 + s * 178, 132)
        g.lineTo(400 + s * 280, 200)
        g.lineTo(400 + s * 240, 360)
        g.lineTo(400 + s * 160, 320)
        g.closePath()
        g.fill()
      }
      // A hard-edged saturated print: the thing that must NOT survive.
      g.fillStyle = '#e01b6e'
      g.fillRect(300, 300, 200, 220)
      g.fillStyle = '#ffffff'
      g.fillRect(330, 350, 140, 40)
      if (variant === 'pocket') {
        g.fillStyle = '#9aa0a8'
        g.fillRect(250, 560, 120, 130)
      }
      g.globalCompositeOperation = 'destination-out'
      g.beginPath()
      g.ellipse(400, 128, 95, 58, 0, 0, Math.PI * 2)
      g.fill()
      if (variant === 'hem') g.fillRect(210, 700, 150, 160)
      g.globalCompositeOperation = 'source-over'
      return toBlob(c)
    }

    const WIDTH_IN = 20
    // Deliberately OFF-CENTRE, so a mirror that silently did nothing fails.
    const area = { xIn: 3, yIn: 4, wIn: 12, hIn: 16 }
    const ingest = async (blob, name) => {
      const n = await normalizeGarmentPhoto(blob, { name })
      return { assetId: n.assetId, useCutout: n.hasCutout, printArea: area, precut: n.hasCutout }
    }

    const out = {}
    const front = await ingest(await syntheticTee('plain'), 'verify front')
    out.frontHasCutout = front.useCutout

    // ---- determinism ----------------------------------------------------
    const g1 = await generateBackFromFront(front, WIDTH_IN, { watermark: false })
    const g2 = await generateBackFromFront(front, WIDTH_IN, { watermark: false })
    out.sha1 = await sha(g1.blob)
    out.sha2 = await sha(g2.blob)
    out.symmetrySymmetric = g1.symmetry
    out.colorHex = g1.colorHex
    out.colorSource = g1.colorSource
    out.heightIn = g1.heightIn

    // ---- mirror fidelity + halo + print erasure -------------------------
    const gen = await decode(g1.blob)
    const src = await decode(await assets.getAssetBlob(front.assetId, 'cutout'))
    const fb = bboxOf(src)
    const gb = bboxOf(gen)
    out.bboxSameSize = gb.w === fb.w && gb.h === fb.h
    let alphaMismatch = 0
    for (let y = 0; y < fb.h; y++)
      for (let x = 0; x < fb.w; x++) {
        const a = src.data.data[((fb.y + y) * src.w + fb.x + (fb.w - 1 - x)) * 4 + 3]
        const b = gen.data.data[((gb.y + y) * gen.w + gb.x + x) * 4 + 3]
        if (a !== b) alphaMismatch++
      }
    out.alphaMismatchFrac = alphaMismatch / (fb.w * fb.h)

    // Every output pixel is `flood colour × one scalar shade`, quantised to 256
    // steps — so the whole image can hold at most 256 distinct colours, all on
    // one ramp. A surviving pink print would need colours off that ramp.
    const palette = new Set()
    let maxStep = 0
    const band = []
    const inner = []
    const K = Math.round(0.03 * Math.min(gb.w, gb.h))
    const alphaAt = (x, y) => gen.data.data[(y * gen.w + x) * 4 + 3]
    for (let y = gb.y; y < gb.y + gb.h; y++)
      for (let x = gb.x; x < gb.x + gb.w; x++) {
        const i = (y * gen.w + x) * 4
        if (gen.data.data[i + 3] <= 250) continue
        palette.add(
          (gen.data.data[i] << 16) | (gen.data.data[i + 1] << 8) | gen.data.data[i + 2],
        )
        const edge =
          alphaAt(Math.max(0, x - K), y) < 16 ||
          alphaAt(Math.min(gen.w - 1, x + K), y) < 16 ||
          alphaAt(x, Math.max(0, y - K)) < 16 ||
          alphaAt(x, Math.min(gen.h - 1, y + K)) < 16
        const L = lum(gen.data.data, i)
        if (edge) band.push(L)
        else {
          inner.push(L)
          if (gen.data.data[i + 4 + 3] > 250)
            maxStep = Math.max(maxStep, Math.abs(lum(gen.data.data, i + 4) - L))
        }
      }
    inner.sort((a, b) => a - b)
    const interior = inner[inner.length >> 1]
    out.bandMeanL = band.reduce((s, v) => s + v, 0) / Math.max(1, band.length)
    out.interiorMedianL = interior
    out.haloRatio = Math.abs(out.bandMeanL - interior) / interior
    out.paletteSize = palette.size
    out.maxLumStep = maxStep
    // How much of the artwork's 0.48-luminance step survives as soft shading.
    let printSum = 0
    let printN = 0
    for (let sy = 300; sy < 520; sy++)
      for (let sx = 300; sx < 500; sx++) {
        // source pixel → mirrored position in the generated image
        const gx = gb.x + (fb.w - 1 - (sx - fb.x))
        const i = ((gb.y + (sy - fb.y)) * gen.w + gx) * 4
        if (gen.data.data[i + 3] <= 250) continue
        printSum += lum(gen.data.data, i)
        printN++
      }
    out.printRegionResidual = Math.abs(printSum / Math.max(1, printN) - interior)

    // ---- what the symmetry number does and does not catch ---------------
    const hemFront = await ingest(await syntheticTee('hem'), 'verify hem')
    out.symmetryHem = (await generateBackFromFront(hemFront, WIDTH_IN, { watermark: false }))
      .symmetry
    const pocketFront = await ingest(await syntheticTee('pocket'), 'verify pocket')
    out.symmetryPocket = (
      await generateBackFromFront(pocketFront, WIDTH_IN, { watermark: false })
    ).symmetry

    // ---- watermark ------------------------------------------------------
    const marked = await decode(
      (await generateBackFromFront(front, WIDTH_IN, { watermark: true })).blob,
    )
    let markMax = 0
    let markAlphaChanged = 0
    for (let i = 0; i < marked.data.data.length; i += 4) {
      if (marked.data.data[i + 3] !== gen.data.data[i + 3]) markAlphaChanged++
      if (gen.data.data[i + 3] > 250)
        markMax = Math.max(markMax, Math.abs(lum(marked.data.data, i) - lum(gen.data.data, i)))
    }
    out.watermarkMaxDelta = markMax
    out.watermarkAlphaChanged = markAlphaChanged

    // ---- side def (print area geometry + provenance) --------------------
    const HALF_CHEST_CM = 50.8 // = 20 in
    const def = await generateBackSide(front, HALF_CHEST_CM, { name: 'verify back', at: 1234 })
    out.def = {
      origin: def.origin,
      useCutout: def.useCutout,
      v: def.generatedFrom.v,
      method: def.generatedFrom.method,
      at: def.generatedFrom.at,
      symmetry: def.generatedFrom.symmetry,
      xIn: def.printArea.xIn,
      yIn: def.printArea.yIn,
      wIn: def.printArea.wIn,
      hIn: def.printArea.hIn,
    }

    // ---- refusal without a cutout ---------------------------------------
    try {
      await generateBackFromFront({ ...front, useCutout: false }, WIDTH_IN, {})
      out.refusesNonCutout = false
    } catch (e) {
      out.refusesNonCutout = e?.code === 'cutout_failed'
    }

    // ---- REAL supplier photo: 143100, white vest on white ---------------
    // Build a cutout the way the app's U²-Net would, minus the model: flood the
    // near-white backdrop in from the border. White-on-white is the worst case
    // for both the cutout and the halo, which is exactly why it is the sample.
    const cut = async (url) => {
      const im = await decode(await (await fetch(url)).blob())
      const { data, w, h } = im
      const d = data.data
      const seen = new Uint8Array(w * h)
      const stack = []
      for (let x = 0; x < w; x++) stack.push(x, x + (h - 1) * w)
      for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1)
      while (stack.length) {
        const k = stack.pop()
        if (seen[k]) continue
        const i = k * 4
        if (d[i] < 232 || d[i + 1] < 232 || d[i + 2] < 232) continue
        seen[k] = 1
        const x = k % w
        const y = (k / w) | 0
        if (x > 0) stack.push(k - 1)
        if (x < w - 1) stack.push(k + 1)
        if (y > 0) stack.push(k - w)
        if (y < h - 1) stack.push(k + w)
      }
      for (let k = 0; k < w * h; k++) if (seen[k]) d[k * 4 + 3] = 0
      im.canvas.getContext('2d').putImageData(data, 0, 0)
      return im
    }
    const realCheck = async (id, rgb) => {
      const rf = await cut(`/catalog/imbretex/img/${id}-front.jpg`)
      const rbk = await cut(`/catalog/imbretex/img/${id}-back.jpg`)
      const meta = await assets.addAsset(await toBlob(rf.canvas), `verify ${id}`)
      await assets.setAssetCutout(meta.id, await toBlob(rf.canvas))
      custom.invalidateCustomBBox(meta.id)
      const g = await generateBackFromFront(
        { assetId: meta.id, useCutout: true, printArea: area },
        WIDTH_IN,
        { colorRgb: rgb, watermark: false },
      )
      const im = await decode(g.blob)
      const bb = bboxOf(im)
      const r = { colorHex: g.colorHex, colorSource: g.colorSource, symmetry: g.symmetry }
      // Which half of the confidence number is talking? The generated alpha IS
      // the mirrored front alpha, so its own IoU against its mirror recovers
      // the outline term exactly, leaving the shading term as the remainder.
      let i2 = 0
      let u2 = 0
      for (let y = 0; y < bb.h; y++)
        for (let x = 0; x < bb.w; x++) {
          const p = im.data.data[((bb.y + y) * im.w + bb.x + x) * 4 + 3] > 16
          const q = im.data.data[((bb.y + y) * im.w + bb.x + bb.w - 1 - x) * 4 + 3] > 16
          if (p && q) i2++
          else if (p || q) u2++
        }
      r.outlineIoU = i2 / (i2 + u2)
      // Halo, and how the reconstruction compares with the supplier's own back.
      let bandSum = 0
      let bandN = 0
      const innerR = []
      const KR = Math.round(0.03 * Math.min(bb.w, bb.h))
      const aR = (x, y) => im.data.data[(y * im.w + x) * 4 + 3]
      for (let y = bb.y; y < bb.y + bb.h; y++)
        for (let x = bb.x; x < bb.x + bb.w; x++) {
          const i = (y * im.w + x) * 4
          if (im.data.data[i + 3] <= 250) continue
          const L = lum(im.data.data, i)
          if (
            aR(Math.max(0, x - KR), y) < 16 ||
            aR(Math.min(im.w - 1, x + KR), y) < 16 ||
            aR(x, Math.max(0, y - KR)) < 16 ||
            aR(x, Math.min(im.h - 1, y + KR)) < 16
          ) {
            bandSum += L
            bandN++
          } else innerR.push(L)
        }
      innerR.sort((a, b) => a - b)
      r.interiorMedianL = innerR[innerR.length >> 1]
      r.haloRatio = Math.abs(bandSum / Math.max(1, bandN) - r.interiorMedianL) / r.interiorMedianL
      const truth = []
      const tb = bboxOf(rbk)
      for (let y = tb.y; y < tb.y + tb.h; y++)
        for (let x = tb.x; x < tb.x + tb.w; x++) {
          const i = (y * rbk.w + x) * 4
          if (rbk.data.data[i + 3] > 250) truth.push(lum(rbk.data.data, i))
        }
      truth.sort((a, b) => a - b)
      r.truthMedianL = truth[truth.length >> 1]
      r.png = im.canvas.toDataURL('image/png')
      return r
    }
    // White vest on a white backdrop — worst case for halo and for the cutout.
    out.white = await realCheck('143100', [255, 255, 255])
    // Black polo — the opposite bleed direction, a centred placket, and a
    // silhouette the naive test cutout can actually resolve cleanly.
    out.black = await realCheck('202357', [0, 0, 0])

    if (window.__backDump) {
      out.png = {
        synthetic: gen.canvas.toDataURL('image/png'),
        marked: marked.canvas.toDataURL('image/png'),
        'real-white': out.white.png,
        'real-black': out.black.png,
      }
    }
    delete out.white.png
    delete out.black.png
    return out
  })

  // -------------------------------------------------------------------------
  // C. THE COMMITTED RECONSTRUCTIONS
  //
  // Suite A proves the four files are tagged; this proves they are what they
  // claim to be. Each one is re-derived from its front through the real ingest
  // path (U²-Net cutout included, unlike the flood-fill above — these are the
  // shipped artefacts and deserve the shipped code) and must come out byte
  // identical, which forbids a hand-painted or hand-edited "reconstruction".
  //
  // Then the thing a generic mirror gets wrong: a polo front has a button
  // placket down the centre and a polo back does not. `centred` is the mean
  // column-residual over the chest band at the centre line, in luminance —
  // the number a stripe down the middle of the back would move.
  // -------------------------------------------------------------------------
  const committed = await page.evaluate(async (ids) => {
    const { autoPrintArea, generateBackFromFront, normalizeGarmentPhoto } = await import(
      '/src/lib/ingest/pipeline.ts'
    )
    const imbretex = await import('/src/lib/ingest/imbretex.ts')
    const { getCustomSideInfo } = await import('/src/lib/custom.ts')
    const { cmToIn } = await import('/src/lib/units.ts')
    const catalog = await imbretex.fetchImbretexCatalog()

    const sha = async (buf) => {
      const d = await crypto.subtle.digest('SHA-256', buf)
      return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
    }
    const decode = async (blob) => {
      const img = new Image()
      const url = URL.createObjectURL(blob)
      await new Promise((res, rej) => {
        img.onload = res
        img.onerror = rej
        img.src = url
      })
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const x = c.getContext('2d', { willReadFrequently: true })
      x.drawImage(img, 0, 0)
      URL.revokeObjectURL(url)
      return { canvas: c, d: x.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height }
    }
    const bboxOf = ({ d, w, h }) => {
      let x0 = w, y0 = h, x1 = -1, y1 = -1
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          if (d[(y * w + x) * 4 + 3] > 16) {
            if (x < x0) x0 = x
            if (x > x1) x1 = x
            if (y < y0) y0 = y
            if (y > y1) y1 = y
          }
      return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
    }
    /**
     * Mean |luminance − local mean| at the centre column over the chest band.
     * The local mean is a ±10 %-of-width window, so only a feature NARROWER
     * than the garment registers — exactly what a placket, a zip or a row of
     * buttons is, and exactly what body shading is not.
     */
    const centredFeature = (im) => {
      const bb = bboxOf(im)
      const x0 = Math.round(bb.x + 0.2 * bb.w)
      const n = Math.round(0.6 * bb.w)
      const W = Math.max(2, Math.round(0.1 * bb.w))
      const acc = new Float64Array(n)
      let rows = 0
      for (let y = Math.round(bb.y + 0.16 * bb.h); y < Math.round(bb.y + 0.6 * bb.h); y++) {
        const L = new Float64Array(n)
        let solid = true
        for (let k = 0; k < n && solid; k++) {
          const i = (y * im.w + x0 + k) * 4
          if (im.d[i + 3] <= 250) solid = false
          else L[k] = (0.2126 * im.d[i] + 0.7152 * im.d[i + 1] + 0.0722 * im.d[i + 2]) / 255
        }
        if (!solid) continue
        rows++
        for (let k = 0; k < n; k++) {
          let s = 0
          let m = 0
          for (let j = Math.max(0, k - W); j <= Math.min(n - 1, k + W); j++) {
            s += L[j]
            m++
          }
          acc[k] += L[k] - s / m
        }
      }
      if (!rows) return null
      const cx = bb.x + bb.w / 2 - x0
      const half = Math.max(1, Math.round(0.02 * bb.w))
      let centre = 0
      let cn = 0
      for (let k = 0; k < n; k++)
        if (Math.abs(k - cx) <= half) {
          centre += Math.abs(acc[k] / rows)
          cn++
        }
      return centre / cn
    }

    const out = []
    for (const id of ids) {
      const p = catalog.find((x) => x.id === id)
      const sizes = imbretex.imbretexSizes(p)
      const covered = imbretex.imbretexSizeIds(p)
      const halfChestCm = covered.length
        ? (sizes.M ?? sizes[covered[0]]).halfChestCm
        : p.halfChestCm[p.halfChestCm.length >> 1]
      const widthIn = cmToIn(halfChestCm)
      const photo = await normalizeGarmentPhoto(
        await (await fetch(imbretex.imbretexPhotoUrl(p, 'front'))).blob(),
        { name: `verify ${id} front` },
      )
      const side = { assetId: photo.assetId, useCutout: photo.hasCutout }
      const info = await getCustomSideInfo(
        { ...side, printArea: { xIn: 0, yIn: 0, wIn: 1, hIn: 1 } },
        widthIn,
      )
      const front = {
        ...side,
        printArea: autoPrintArea(info.img, info.bbox, halfChestCm, 'front'),
      }
      const opts = { colorRgb: p.photoColour?.rgb ?? null }
      const marked = await generateBackFromFront(front, widthIn, opts)
      const plain = await generateBackFromFront(front, widthIn, { ...opts, watermark: false })
      const fileBuf = await (
        await fetch(imbretex.imbretexPhotoUrl(p, 'back'), { cache: 'no-cache' })
      ).arrayBuffer()
      // The front is measured through the SAME lens, so the two numbers are
      // directly comparable and the front's placket is visible in the report.
      const frontCut = await decode(await (await import('/src/state/assets.ts')).getAssetBlob(photo.assetId, 'cutout'))
      out.push({
        id,
        committedSha: await sha(fileBuf),
        freshSha: await sha(await marked.blob.arrayBuffer()),
        recorded: p.views.back.generatedFrom,
        placket: plain.placket,
        colorHex: plain.colorHex,
        colorSource: plain.colorSource,
        symmetry: plain.symmetry,
        centredFront: centredFeature(frontCut),
        centredBack: centredFeature(await decode(plain.blob)),
        isPng: new Uint8Array(fileBuf.slice(0, 4)).join() === '137,80,78,71',
      })

      // Control, on the first product only: paint a navy strip 6 % of the
      // garment's width down the centre — the contrast placket the low-pass
      // alone does NOT erase (0.0367 measured) — and check the suppressor both
      // fires and brings it back under the ceiling. Without this the ceiling
      // above could be passing because the metric sees nothing at all.
      if (out.length === 1) {
        const cut = await decode(await (await import('/src/state/assets.ts')).getAssetBlob(photo.assetId, 'cutout'))
        const bb = bboxOf(cut)
        const g = cut.canvas.getContext('2d')
        g.globalCompositeOperation = 'source-atop'
        g.fillStyle = '#1F2A44'
        const pw = Math.round(0.06 * bb.w)
        g.fillRect(Math.round(bb.x + bb.w / 2 - pw / 2), bb.y, pw, Math.round(bb.h * 0.42))
        const assets = await import('/src/state/assets.ts')
        const custom = await import('/src/lib/custom.ts')
        const blob = await new Promise((r) => cut.canvas.toBlob(r, 'image/png'))
        const meta = await assets.addAsset(blob, 'verify placket')
        await assets.setAssetCutout(meta.id, blob)
        custom.invalidateCustomBBox(meta.id)
        const adv = await generateBackFromFront(
          { assetId: meta.id, useCutout: true, printArea: front.printArea },
          widthIn,
          { ...opts, watermark: false },
        )
        out.push({
          control: `${id} + navy placket`,
          placket: adv.placket,
          centredBack: centredFeature(await decode(adv.blob)),
        })
      }
    }
    return out
  }, NO_UPSTREAM_BACK)

  /**
   * Ceiling for the centred-feature residual of a reconstruction. Measured:
   * the four committed backs land at 0.0009-0.0017 and the supplier's own back
   * photographs at 0.0005-0.0011, while a contrast placket that survives the
   * low-pass measures 0.0367. The ceiling therefore sits inside the real-back
   * band's own noise and 20× below the failure it exists to catch.
   */
  const PLACKET_CEILING = 0.0025

  for (const c of committed) {
    if (c.control) {
      ok(
        'committed.control.contrast-placket-is-caught',
        // `centredFeature` returns null when it found no fully covered row to
        // measure, and `null <= x` is true in JS — so a metric that measured
        // NOTHING would have passed this and the ceiling below silently.
        c.placket.suppressed === true &&
          c.centredBack !== null &&
          c.centredBack <= PLACKET_CEILING,
        `${c.control}: suppressed=${c.placket.suppressed} (${(c.placket.widthFrac * 100).toFixed(1)} % wide, ${(c.placket.rowsFrac * 100).toFixed(0)} % of rows) → centred ${c.centredBack.toFixed(5)}`,
      )
      continue
    }
    ok(
      `committed.${c.id}.is-a-png-with-alpha`,
      c.isPng,
      'PNG, so it takes the pre-cut path at import and keeps the silhouette',
    )
    ok(
      `committed.${c.id}.reproducible`,
      c.committedSha === c.freshSha,
      `committed ${c.committedSha.slice(0, 12)} / fresh ${c.freshSha.slice(0, 12)} (a mismatch means: re-run scripts/generate-missing-backs.mjs)`,
    )
    ok(
      `committed.${c.id}.provenance-matches-pixels`,
      c.recorded.colorHex === c.colorHex &&
        c.recorded.colorSource === c.colorSource &&
        c.recorded.placketSuppressed === c.placket.suppressed &&
        Math.abs(c.recorded.symmetry - c.symmetry) < 1e-9,
      `${c.recorded.colorHex} (${c.recorded.colorSource}), symmetry ${c.recorded.symmetry.toFixed(4)}`,
    )
    ok(
      `committed.${c.id}.no-placket-on-the-back`,
      // See the control above: null means "nothing measurable", not "clean".
      c.centredFront !== null && c.centredBack !== null && c.centredBack <= PLACKET_CEILING,
      `centred residual: front ${c.centredFront?.toFixed(5)} → back ${c.centredBack?.toFixed(5)} (≤ ${PLACKET_CEILING})`,
    )
  }

  // --- assertions ----------------------------------------------------------
  ok('gen.front-precut', probe.frontHasCutout)
  ok('gen.deterministic', probe.sha1 === probe.sha2, probe.sha1.slice(0, 16))
  ok('gen.refuses-non-cutout', probe.refusesNonCutout === true)
  ok('gen.bbox-preserved', probe.bboxSameSize)
  ok(
    'gen.alpha-is-exact-mirror',
    probe.alphaMismatchFrac === 0,
    `${(probe.alphaMismatchFrac * 100).toFixed(4)}% mismatched`,
  )
  ok(
    'gen.single-colour-ramp',
    probe.paletteSize <= 256,
    `${probe.paletteSize} distinct colours (artwork would need colours off the ramp)`,
  )
  ok(
    'gen.no-artwork-edges',
    probe.maxLumStep <= 0.03,
    `max per-pixel luminance step ${probe.maxLumStep.toFixed(4)}`,
  )
  ok(
    'gen.artwork-attenuated',
    probe.printRegionResidual <= 0.2,
    `a 0.48-luminance print leaves ${probe.printRegionResidual.toFixed(3)} of soft shading`,
  )
  ok(
    'gen.no-alpha-halo',
    probe.haloRatio <= 0.06,
    `band ${probe.bandMeanL.toFixed(4)} vs interior ${probe.interiorMedianL.toFixed(4)} (${(probe.haloRatio * 100).toFixed(2)}%)`,
  )
  ok(
    'gen.symmetry-symmetric',
    probe.symmetrySymmetric >= 0.99,
    `${probe.symmetrySymmetric.toFixed(4)} (≥ 0.93 ⇒ not flagged)`,
  )
  ok(
    'gen.symmetry-flags-asymmetric-outline',
    probe.symmetryHem < 0.93,
    `${probe.symmetryHem.toFixed(4)} for a garment missing one hem corner`,
  )
  // Pins the DOCUMENTED blind spot rather than hiding it: a patch pocket does
  // not touch the silhouette, so this number cannot see it. If someone ever
  // makes the metric structural, this check fails and they must revisit the
  // admin warning's wording — and check it against a real dark garment first.
  ok(
    'gen.symmetry-blind-to-internal-features',
    probe.symmetryPocket >= 0.99,
    `${probe.symmetryPocket.toFixed(4)} for a tee with a patch pocket — badge + baked mark cover this case, not the number`,
  )
  // The floor is the point of this check, not the ceiling. The sample garment is
  // #b7bcc2 — a mid grey, which is where a polarity chosen by "is this light?"
  // collapses the mark to ~0.023 (measured) because it lands on the weaker side
  // of the crossover. 0.04 is below what either polarity gives on white or black
  // and above what the wrong one gives here, so it fails on exactly that bug.
  ok(
    'gen.watermark-legible-on-mid-grey-and-alpha-safe',
    probe.watermarkMaxDelta >= 0.04 &&
      probe.watermarkMaxDelta < 0.12 &&
      probe.watermarkAlphaChanged === 0,
    `Δluminance ${probe.watermarkMaxDelta.toFixed(4)} on a #b7bcc2 garment (≥ 0.04), ${probe.watermarkAlphaChanged} alpha pixels touched`,
  )
  const d = probe.def
  ok('gen.side.origin', d.origin === 'generated' && d.useCutout === true)
  ok('gen.side.provenance', d.v === 2 && d.method === 'front-mirror-flood' && d.at === 1234)
  // Front area xIn 3, wIn 12 on a 20 in garment → mirrored xIn = 20-(3+12) = 5;
  // yIn gains the standard 10 − 7.5 cm extra back drop = 0.984 in.
  ok('gen.side.area-mirrored', near(d.xIn, 5, 1e-6), `xIn ${d.xIn.toFixed(4)}`)
  ok('gen.side.area-dropped', near(d.yIn - 4, 0.9843, 1e-3), `+${(d.yIn - 4).toFixed(4)} in`)
  ok('gen.side.area-size-kept', d.wIn === 12 && d.hIn === 16)
  for (const [label, id, r] of [
    ['white', '143100 ARCTIC WHITE vest', probe.white],
    ['black', '202357 BLACK polo', probe.black],
  ]) {
    ok(
      `real.${label}.no-alpha-halo`,
      r.haloRatio <= 0.06,
      `${(r.haloRatio * 100).toFixed(2)}% edge-band deviation — ${id}`,
    )
    ok(
      `real.${label}.luminance-matches-supplier-back`,
      Math.abs(r.interiorMedianL - r.truthMedianL) <= 0.08,
      `generated ${r.interiorMedianL.toFixed(3)} vs the supplier's real back ${r.truthMedianL.toFixed(3)}`,
    )
  }
  // Only the black polo carries the symmetry assertion: on the white-on-white
  // sample this script's own naive flood-fill cutout leaks through the strap,
  // and the resulting ragged outline is the TEST's artefact, not the
  // generator's — the app cuts out with U²-Net. Reported either way.
  ok(
    'real.black.symmetry-not-false-flagged',
    probe.black.symmetry >= 0.93,
    `${probe.black.symmetry.toFixed(4)} · white sample ${probe.white.symmetry.toFixed(4)} (this script's cutout leaks through the white strap)`,
  )
  // The supplier swatch is a flat catalogue chip: ARCTIC WHITE is #ffffff while
  // the photograph of that garment is #d9d9d9. Flooding the chip would make the
  // back brighter than the front the customer is looking at, so the guard hands
  // over to the measured colour — and the luminance checks above prove it right.
  ok(
    'real.colour-tracks-the-photo-not-the-swatch',
    probe.white.colorSource === 'sampled' && probe.black.colorSource === 'sampled',
    `white swatch #ffffff → ${probe.white.colorHex} (${probe.white.colorSource}) · black swatch #000000 → ${probe.black.colorHex} (${probe.black.colorSource})`,
  )
  ok('page.no-errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  if (OUT && probe.png) {
    mkdirSync(OUT, { recursive: true })
    for (const [k, url] of Object.entries(probe.png))
      writeFileSync(`${OUT}/back-${k}.png`, Buffer.from(url.split(',')[1], 'base64'))
    console.log(`\n  PNGs → ${OUT}`)
  }
} catch (err) {
  console.error('❌', err)
  done(1)
}

const failed = results.filter((r) => !r.pass)
console.log(`\n${failed.length ? '❌' : '✅'} ${results.length - failed.length}/${results.length} checks passed`)
done(failed.length ? 1 : 0)
