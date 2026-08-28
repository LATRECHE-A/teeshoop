/**
 * Reconstruct the BACK view for the catalogue references Imbretex publishes
 * none for, and commit the result into the snapshot.
 *
 * WHY here and not only at import time: the studio already reconstructs a back
 * on the fly (src/lib/ingest/imbretex.ts), but until it does, the catalogue
 * itself is half a product: the grid shows a gap, the detail view has no
 * reverse to show, and every customer pays the U²-Net + reconstruction cost
 * again for an image that is deterministic anyway. Generating once, committing
 * the PNG, and letting the normal ingest path adopt it makes the four
 * references whole while keeping exactly one reconstruction algorithm.
 *
 * WHY a browser: generateBackFromFront (src/lib/ingest/pipeline.ts) is canvas
 * code by design: it is the SAME function that runs in the app, so what ships
 * in the snapshot cannot drift from what the app would have produced. It runs
 * against a real Vite bundle under Playwright, the way scripts/backphoto-
 * verify.mjs suite B does, and the cutout comes from the real U²-Net pass, not
 * from a test approximation.
 *
 * PROVENANCE IS NEVER FAKED. Each generated view is written as
 * `views.back = { file, bytes, origin: 'generated', generatedFrom: {...} }`,
 * the PNG carries the baked "APERÇU · PREVIEW" mark, and `backMissing` keeps
 * meaning what it always meant: the SUPPLIER publishes no back. Real supplier
 * backs stay origin-less (absent ⇒ 'photo', see src/lib/ingest/types.ts), so
 * the diff is four entries wide and no photograph is ever relabelled.
 *
 * DETERMINISM: same photo in, byte-identical PNG out (asserted by
 * backphoto-verify), so a re-run rewrites nothing: `at` is carried over from
 * the existing record rather than re-stamped, and files are only written when
 * their bytes actually change.
 *
 *   node scripts/generate-missing-backs.mjs
 *   node scripts/generate-missing-backs.mjs --check   # fail if it is not a no-op
 *   BACK_GEN_AT=1750000000000 node ...                # pin first-time stamps
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const PORT = 5197
const BASE = `http://localhost:${PORT}`
const ROOT = 'public/catalog/imbretex'
const CHECK = process.argv.includes('--check')

const snapshot = JSON.parse(readFileSync(`${ROOT}/products.json`, 'utf8'))
const before = JSON.stringify(snapshot, null, 1)

/**
 * The snapshot's own description of itself. This script is the LAST writer of
 * products.json (scrape, then generate), so it owns the field: the scraper's
 * wording describes the intermediate state, before any back was reconstructed,
 * and would be a lie once one has been. Every clause here is something the file
 * or a recorded probe can back up; nothing is claimed on the algorithm's behalf.
 */
const NOTE =
  'Temporary snapshot standing in for the Imbretex API. Prices are RRP (tarif conseillé de revente), not buying prices. ' +
  'Front AND back views are captured whenever the supplier publishes them. The ids in `backMissing` publish no back view in ANY ' +
  'colourway: every colourway carrying a visuals endpoint was probed (2026-07-27: 13, 13, 2 and 2 of them, each answering a single ' +
  '`_front` shot), and scrapes from now on record that count per product in `backProbe`. Their `views.back` is NOT a photograph: it is ' +
  'a reconstruction built from the front by scripts/generate-missing-backs.mjs, flagged `origin: "generated"` with its provenance in ' +
  '`views.back.generatedFrom`, carrying an "APERÇU · PREVIEW" mark in the pixels, and it never enters a print file.'

/** A generated back is written as PNG: alpha is the whole point. It takes the
 *  pre-cut fast path at ingest (no second U²-Net pass) and JPEG would both
 *  lose the silhouette and re-compress a synthesised image. */
const backFile = (id) => `img/${id}-back.png`

/** Reconstruct for every product with no supplier back, including the ones
 *  already carrying a reconstruction, so a re-run re-verifies rather than
 *  trusting what is on disk. */
const targets = snapshot.products.filter(
  (p) => !p.views?.back || p.views.back.origin === 'generated',
)
// A reference that GAINED a real back on a later scrape must not leave its old
// reconstruction behind as an orphan image.
const stale = snapshot.products.filter(
  (p) => p.views?.back && p.views.back.origin !== 'generated',
)

console.log(`${targets.length} reference(s) to reconstruct: ${targets.map((p) => p.id).join(', ')}`)
if (!targets.length) process.exit(0)

const waitFor = (url, ms = 60000) =>
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
  // A harness page spawning a Worker never reaches network-idle under Vite.
  const open = async () => {
    await page.goto(`${BASE}/dev/ingest.html`, { waitUntil: 'load', timeout: 60000 })
    await page.waitForFunction(() => !!document.getElementById('root')?.children.length, {
      timeout: 40000,
    })
  }
  await open()
  // Warm-up: the first dynamic import can make Vite pre-bundle a new dep and
  // force a full reload, which would destroy the execution context mid-run.
  await page
    .evaluate(async () => {
      await import('/src/lib/ingest/pipeline.ts')
      await import('/src/lib/ingest/imbretex.ts')
      await import('/src/lib/custom.ts')
    })
    .catch(() => undefined)
  await page.waitForTimeout(1500)
  await open()

  const generated = await page.evaluate(async (ids) => {
    const { autoPrintArea, generateBackFromFront, normalizeGarmentPhoto } = await import(
      '/src/lib/ingest/pipeline.ts'
    )
    const imbretex = await import('/src/lib/ingest/imbretex.ts')
    const { getCustomSideInfo } = await import('/src/lib/custom.ts')
    const { cmToIn } = await import('/src/lib/units.ts')
    const catalog = await imbretex.fetchImbretexCatalog()

    const out = []
    for (const id of ids) {
      const p = catalog.find((x) => x.id === id)
      if (!p) {
        out.push({ id, error: 'not in catalogue' })
        continue
      }
      try {
        // Reference half chest: the size the studio would author the photos at,
        // and for a run the studio cannot carry at all (kids' 5/6…13/14) the
        // middle published size. It only scales the print-area mask used to
        // keep artwork out of the colour median: the pixels are the front's.
        const sizes = imbretex.imbretexSizes(p)
        const covered = imbretex.imbretexSizeIds(p)
        const halfChestCm = covered.length
          ? (sizes.M ?? sizes[covered[0]]).halfChestCm
          : p.halfChestCm[p.halfChestCm.length >> 1]
        const widthIn = cmToIn(halfChestCm)

        // Exactly the app's ingest path: real cutout, real print-area guess.
        const blob = await (await fetch(imbretex.imbretexPhotoUrl(p, 'front'))).blob()
        const photo = await normalizeGarmentPhoto(blob, { name: `${p.name}, face` })
        const probe = { assetId: photo.assetId, useCutout: photo.hasCutout }
        const info = await getCustomSideInfo(
          { ...probe, printArea: { xIn: 0, yIn: 0, wIn: 1, hIn: 1 } },
          widthIn,
        )
        const gen = await generateBackFromFront(
          { ...probe, printArea: autoPrintArea(info.img, info.bbox, halfChestCm, 'front') },
          widthIn,
          // The supplier swatch is a flat catalogue chip; generateBackFromFront
          // falls back to the colour measured in the photo when the two
          // disagree perceptually (see SWATCH_MAX_DIST).
          { colorRgb: p.photoColour?.rgb ?? null },
        )
        const bytes = new Uint8Array(await gen.blob.arrayBuffer())
        let b64 = ''
        for (let i = 0; i < bytes.length; i += 0x8000)
          b64 += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        out.push({
          id,
          png: btoa(b64),
          halfChestCm,
          colorHex: gen.colorHex,
          colorSource: gen.colorSource,
          symmetry: gen.symmetry,
          placket: gen.placket,
        })
      } catch (err) {
        out.push({ id, error: String(err?.message ?? err).slice(0, 120) })
      }
    }
    return out
  }, targets.map((p) => p.id))

  if (errors.length) throw new Error(`page errors: ${errors.slice(0, 2).join(' | ')}`)
  const failed = generated.filter((g) => g.error)
  if (failed.length)
    throw new Error(failed.map((f) => `${f.id}: ${f.error}`).join(' · '))

  const now = Number(process.env.BACK_GEN_AT) || Date.now()
  const changed = []
  for (const g of generated) {
    const product = snapshot.products.find((p) => p.id === g.id)
    const file = backFile(g.id)
    const buf = Buffer.from(g.png, 'base64')
    let same = false
    try {
      same = readFileSync(`${ROOT}/${file}`).equals(buf)
    } catch {}
    if (!same) {
      if (!CHECK) writeFileSync(`${ROOT}/${file}`, buf)
      changed.push(`${file} (${buf.length} B)`)
    }
    product.views = {
      front: product.views.front,
      back: {
        file,
        bytes: buf.length,
        origin: 'generated',
        generatedFrom: {
          method: 'front-mirror-flood',
          v: 2,
          colorHex: g.colorHex,
          colorSource: g.colorSource,
          placketSuppressed: g.placket.suppressed,
          symmetry: g.symmetry,
          // Carried over when the pixels did not change, so a re-run is a
          // no-op instead of a fresh timestamp on identical bytes.
          at: (same && product.views.back?.generatedFrom?.at) || now,
        },
      },
    }
    console.log(
      `  ✓ ${g.id} ${product.name}: ${g.colorHex} (${g.colorSource}), symmetry ${g.symmetry.toFixed(3)}` +
        `, placket ${g.placket.suppressed ? `suppressed (${(g.placket.widthFrac * 100).toFixed(1)} % wide)` : `none (contrast ${g.placket.contrast.toFixed(2)}, ${(g.placket.rowsFrac * 100).toFixed(0)} % of rows)`}`,
    )
  }
  for (const p of stale) {
    if (!existsSync(`${ROOT}/${backFile(p.id)}`)) continue
    if (!CHECK) rmSync(`${ROOT}/${backFile(p.id)}`)
    changed.push(`${backFile(p.id)} removed (real back published since)`)
  }

  snapshot.note = NOTE
  const after = JSON.stringify(snapshot, null, 1)
  if (after !== before) {
    if (!CHECK) writeFileSync(`${ROOT}/products.json`, after)
    changed.push('products.json')
  }

  if (CHECK) {
    console.log(
      changed.length
        ? `\n❌ not a no-op, would change: ${changed.join(', ')}`
        : '\n✅ no-op: the committed snapshot already matches a fresh reconstruction',
    )
    done(changed.length ? 1 : 0)
  }
  console.log(changed.length ? `\n✅ wrote ${changed.join(', ')}` : '\n✅ nothing to do, already up to date')
} catch (err) {
  console.error('❌', err)
  done(1)
}
done(0)
