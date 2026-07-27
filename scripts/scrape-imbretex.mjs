/**
 * Imbretex catalogue snapshot — TEMPORARY stand-in for the supplier API.
 *
 * Imbretex (imbretex.fr) is the blank-garment supplier we buy from. Their API
 * is promised but not yet available, so this pulls a SAMPLE of their public
 * catalogue into the same shape the API adapter will emit, letting the editor,
 * the cm size system, the 3D/AR preview and the DTF nester be exercised against
 * real products and real measurements today. When the API lands, only
 * src/lib/ingest/imbretex.ts changes — this script and its snapshot go away.
 *
 * What is public (anonymous) and therefore what we can use:
 *   - designation, brand, supplier + Imbretex reference, description
 *   - fabric weight (g/m2), composition, gender, country of origin
 *   - marking types (we filter to products that accept DTF / transfer)
 *   - colours: name + swatch RGB + CMYK + Pantone
 *   - the SIZE GUIDE table: row "A" = half-chest (largeur) cm,
 *     row "B" = body length (longueur) cm, one column per size
 *   - per-COLOUR photo sets (1000x1000): front / back / side. Coverage is
 *     uneven — a given colourway may publish a front and no back — so we PROBE
 *     colourways until one carries both (see resolveViews). A front-only
 *     snapshot leaves the studio with nothing to show on the back of the
 *     garment, which is why completeness outranks colour neutrality here, and
 *     why a product that ends up back-less records how many colourways were
 *     actually probed (`backProbe`) instead of asserting more than it checked.
 * Prices shown anonymously are "tarif conseillé de revente" (RRP), not our
 * buying price — recorded as such, never treated as cost.
 *
 * Politeness: robots.txt (checked) disallows only password-reset paths and
 * publishes a sitemap. We identify ourselves, run 3 requests at a time with a
 * delay, and fetch a small sample rather than the whole catalogue.
 *
 *   node scripts/scrape-imbretex.mjs                     # default sample
 *   IMB_PER_CAT=25 IMB_CATS=tee-shirt_185 node scripts/scrape-imbretex.mjs
 *   node scripts/generate-missing-backs.mjs              # ALWAYS run after
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const BASE = 'https://www.imbretex.fr'
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36 tshop-catalog-sync/1.0 (+contact via imbretex account)'
const OUT = process.env.IMB_OUT || 'public/catalog/imbretex'
const PER_CAT = Number(process.env.IMB_PER_CAT || 16)
const CATS = (process.env.IMB_CATS || 'tee-shirt_185,polo_153,sweat-shirt_168').split(',')
const CONCURRENCY = 3
const DELAY_MS = 250

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function get(url, asJson = false) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, ...(asJson ? { 'X-Requested-With': 'XMLHttpRequest' } : {}) },
  })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return asJson ? res.json() : res.text()
}

/** Page through a category's AJAX grid and collect product ids. */
async function listCategory(cat, limit) {
  const ids = []
  for (let p = 1; ids.length < limit && p <= 10; p++) {
    const url = `${BASE}/produits/${cat}?1&templates%5B%5D=products&p=${p}&q=16&t=`
    const json = await get(url, true)
    const html = json?.templates?.products || ''
    const found = [...new Set([...html.matchAll(/produits\/(\d+)["?]/g)].map((m) => m[1]))]
    if (!found.length) break
    for (const id of found) if (!ids.includes(id) && ids.length < limit) ids.push(id)
    await sleep(DELAY_MS)
  }
  return ids
}

/** Parse one product's HTML in a real DOM (no HTML-parser dependency). */
async function parseProduct(page, id, html) {
  await page.setContent(html, { waitUntil: 'domcontentloaded' })
  return page.evaluate((productId) => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim()
    const grids = [...document.querySelectorAll('table')].map((t) =>
      [...t.querySelectorAll('tr')]
        .map((r) => [...r.querySelectorAll('th,td')].map((c) => clean(c.innerText)).filter(Boolean))
        .filter((r) => r.length),
    )

    // Spec table: label/value pairs (Grammage, Matière, Genre, ...).
    const spec = {}
    for (const g of grids) for (const row of g) if (row.length === 2) spec[row[0]] = row[1]

    // Size table: a header row of size labels, then rows keyed "A" / "B" / "C".
    let sizes = null
    const meas = {}
    for (const g of grids) {
      const letters = g.filter((r) => /^[A-D]$/.test(r[0]) && r.length > 2)
      if (!letters.length) continue
      const header = g.find((r) => r.length === letters[0].length - 1 && !/^[A-D]$/.test(r[0]))
      if (!header) continue
      sizes = header
      for (const r of letters) meas[r[0]] = r.slice(1).map((v) => Number(String(v).replace(',', '.')))
      break
    }

    // Colours. The swatch RGB is an inline style attribute (setContent has no
    // stylesheets, so read the attribute rather than the computed value); the
    // name is the label's own text; CMYK/Pantone live in the .color-infos card.
    const colours = []
    for (const el of document.querySelectorAll('[data-color]')) {
      const styled = el.querySelector('[style*="rgb("]')
      const rgb = (styled?.getAttribute('style')?.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/) || []).slice(1).map(Number)
      const label = el.querySelector('label')
      const name = clean(label?.textContent) || clean(el.innerText).split('\n')[0]
      const info = clean(el.querySelector('.color-infos')?.innerText)
      const pantone = (info.match(/PANTONE\s+([A-Za-z0-9]+)/i) || [])[1]
      const cmyk = (info.match(/CMYK\s+([\d\s]+)/i) || [])[1]
      if (!name) continue
      // The page renders each colour TWICE (selector + filter list) and the
      // second copy carries no CMYK/Pantone — keep one entry per id, richest
      // wins, or the ids stop being unique downstream.
      const id = el.getAttribute('data-color')
      const row = {
        id,
        name: name.slice(0, 40),
        rgb: rgb.length === 3 ? rgb : null,
        cmyk: cmyk ? cmyk.trim().split(/\s+/).map(Number) : null,
        pantone: pantone || null,
        // Public per-colour photo set: front / back / side, 1000x1000.
        visualsUrl: el.getAttribute('data-url') || null,
      }
      const score = (c) => (c.cmyk ? 2 : 0) + (c.pantone ? 1 : 0) + (c.rgb ? 1 : 0)
      const at = colours.findIndex((c) => c.id === id)
      if (at < 0) colours.push(row)
      else if (score(row) > score(colours[at])) colours[at] = row
    }

    const main = document.querySelector('img.lightgallery-item, .lightgallery-item img')
    const h1 = document.querySelector('h1')
    const priceTxt = clean(document.body.innerText).match(/revente à la pièce\s*([\d.,]+)\s*€/)

    return {
      id: productId,
      url: `https://www.imbretex.fr/produits/${productId}`,
      name: clean(h1?.innerText) || null,
      brand: clean(document.querySelector('img.brand-logo')?.getAttribute('alt')) || null,
      supplierRef: spec['Référence fournisseur'] || null,
      sizesRange: spec['Tailles'] || null,
      weightGsm: spec['Grammage'] ? Number((spec['Grammage'].match(/[\d.]+/) || [])[0]) : null,
      material: spec['Matière'] || null,
      gender: spec['Genre'] || null,
      origin: spec['Pays d’origine'] || spec["Pays d'origine"] || null,
      markingTypes: (spec['Type de marquage'] || '').split('|').map((s) => s.trim()).filter(Boolean),
      labelType: spec['Type d’étiquette'] || spec["Type d'étiquette"] || null,
      rrpEur: priceTxt ? Number(priceTxt[1].replace(',', '.')) : null,
      colours: colours.slice(0, 40),
      // How many the page actually listed, BEFORE the cap above. Five products
      // in the current catalogue sit exactly on that cap, i.e. they were very
      // likely truncated — and a colourway we never listed is one we never
      // probed, so `backProbe.colourways` has to count it or "we looked at all
      // of them" becomes true by deletion (see resolveViews).
      colourTotal: colours.length,
      sizes,
      // A = half-chest (largeur), B = body length (longueur). Imbretex does not
      // publish a sleeve measurement, so sleeveLengthCm is derived downstream.
      halfChestCm: meas.A || null,
      bodyLengthCm: meas.B || null,
      extraMeasureC: meas.C || null,
      imageUrl: main ? new URL(main.getAttribute('src') || main.getAttribute('data-src'), 'https://www.imbretex.fr').href.replace(/\/\d+\/\d+(\?.*)?$/, '/1000/1000') : null,
    }
  }, id)
}

// ---------------------------------------------------------------- run

mkdirSync(`${OUT}/img`, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage()
const products = []
const failures = []

try {
  for (const cat of CATS) {
    process.stdout.write(`\n${cat}: listing… `)
    const ids = await listCategory(cat, PER_CAT)
    process.stdout.write(`${ids.length} products\n`)

    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      const batch = ids.slice(i, i + CONCURRENCY)
      const htmls = await Promise.all(
        batch.map((id) => get(`${BASE}/produits/${id}`).catch((e) => ({ err: String(e) }))),
      )
      for (let k = 0; k < batch.length; k++) {
        const id = batch[k]
        const html = htmls[k]
        if (typeof html !== 'string') { failures.push({ id, why: html.err }); continue }
        try {
          const p = await parseProduct(page, id, html)
          p.category = cat
          if (!p.halfChestCm || !p.sizes) { failures.push({ id, why: 'no size table' }); continue }
          products.push(p)
          process.stdout.write(`  ✓ ${p.brand ?? '?'} ${p.supplierRef ?? id} — ${p.name ?? ''}\n`)
        } catch (e) {
          failures.push({ id, why: String(e).slice(0, 90) })
        }
      }
      await sleep(DELAY_MS)
    }
  }

  // Photos. Each colour has a public front/back/side set; we snapshot ONE
  // representative colour per product (front + back, which is what the editor's
  // custom-garment pipeline consumes) and keep every colour's swatch + visuals
  // URL so the UI can offer colour switching and pull more on demand.
  process.stdout.write('\nresolving colour photo sets…\n')
  const grab = async (url, file) => {
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!res.ok) throw new Error(String(res.status))
    const buf = Buffer.from(await res.arrayBuffer())
    writeFileSync(`${OUT}/img/${file}`, buf)
    return buf.length
  }

  /** Light neutral colourways cut out cleanest and recolour best. */
  const NEUTRAL = /^(white|blanc|natural|off\s*white|ecru|ivory)\b/i
  /**
   * Politeness valve, NOT a filter: it may never be the reason a colourway went
   * unlooked-at while the snapshot claims "no back in any colourway". It is set
   * to the same 40 that caps `colours` in parseProduct — but that cap is not a
   * reason to relax, it is the OTHER place a colourway can go unlooked-at, and
   * five products in the catalogue already sit exactly on it. `resolveViews`
   * therefore counts the colourways the cap dropped into its denominator, so
   * either limit biting produces `probed < candidates` and the claim is
   * withheld (see `colourTotal` / `backProbe` / `backMissing` below).
   *
   * It was 12 while both LUX polos carry 13 colourways: the 13th was never
   * probed, and "no back in any colourway" was asserted anyway. That happened
   * to be true (verified live, every colourway of all four answers exactly one
   * shot, `_front`) — next catalogue it would be a silent miss.
   */
  const MAX_COLOUR_PROBES = 40

  /**
   * `{front,back,…} → large-image URL` for one colourway.
   *
   * `null` = there was nothing to ask (no visuals endpoint). `undefined` =
   * we ASKED and did not get an answer, which is a different fact and must
   * stay one: folding a failed request into "this colourway publishes no back"
   * is how a network hiccup turns into "the supplier publishes none in ANY
   * colourway". `resolveViews` does not count an unanswered colourway.
   */
  async function viewsFor(colour) {
    if (!colour?.visualsUrl) return null
    let shots
    try {
      shots = await get(colour.visualsUrl, true)
    } catch {
      return undefined
    }
    const byView = {}
    for (const s of shots || []) {
      const view = (String(s.origin).match(/_(front|back|leftside|rightside|detail)\.[a-z]+$/i) || [])[1]
      if (view && !byView[view.toLowerCase()]) byView[view.toLowerCase()] = s.large
    }
    return byView
  }

  /**
   * Choose the colourway to snapshot: COMPLETENESS first, neutrality second.
   *
   * A colour's name is no evidence of which views it publishes, so we probe.
   * Neutral colourways go first (they are the nicest to cut out) and we stop at
   * the first one carrying BOTH front and back; a front-only colour is kept as
   * the best-so-far in case no complete set exists at all. The previous rule —
   * an anchored /^WHITE$/ match, else the first colour in DOM order — silently
   * picked a front-only colourway for products whose backs are published under
   * another name ("WHITE / WHITE"), which is how five products ended up
   * back-less in the snapshot while the supplier published a back all along.
   *
   * Most products settle on the first probe; only genuinely back-less products
   * pay the full candidate list.
   *
   * Returns `probed` / `candidates` alongside the pick: a back-less product's
   * evidence is exactly "we looked at N of M colourways", and only N === M
   * supports the claim the snapshot makes.
   */
  async function resolveViews(p) {
    const candidates = [...p.colours]
      .filter((c) => c.visualsUrl)
      .sort((a, b) => (NEUTRAL.test(b.name) ? 1 : 0) - (NEUTRAL.test(a.name) ? 1 : 0))
    // Colourways parseProduct's own cap dropped are unprobeable AND uncounted,
    // which would make `probed === candidates` true for a product we only saw
    // 40 of. Count them in: we cannot know whether they publish a visuals
    // endpoint, so the honest denominator is the pessimistic one.
    const unlisted = Math.max(0, (p.colourTotal ?? p.colours.length) - p.colours.length)
    const total = candidates.length + unlisted
    let best = null
    let probed = 0
    for (const c of candidates.slice(0, MAX_COLOUR_PROBES)) {
      const byView = await viewsFor(c)
      if (byView === undefined) continue // asked, no answer — NOT a probe
      probed++
      if (!byView?.front) continue
      if (!best) best = { colour: c, byView }
      if (byView.back) return { ...best, colour: c, byView, probed, candidates: total }
      await sleep(DELAY_MS)
    }
    // Even with nothing usable found, say how far we got: a caller that has to
    // decide whether "the supplier publishes no back" is sayable needs the
    // count, and `null` used to hand it nothing at all (see `exhaustive`).
    return { ...(best ?? { colour: null, byView: null }), probed, candidates: total }
  }

  for (let i = 0; i < products.length; i += CONCURRENCY) {
    await Promise.all(
      products.slice(i, i + CONCURRENCY).map(async (p) => {
        // Declared out here so the catch below can still record how far the
        // probe got: a product that threw mid-download is a product we did not
        // finish looking at, and `exhaustive` has to be able to see that.
        let found = null
        try {
          found = await resolveViews(p)
          const { colour, byView, probed, candidates } = found
          if (!colour) {
            p.backProbe = { colourways: candidates, probed }
            failures.push({ id: p.id, why: 'no colourway publishes a front view' })
            return
          }
          p.photoColour = { id: colour.id, name: colour.name, rgb: colour.rgb }
          p.views = {}
          for (const view of ['front', 'back']) {
            if (!byView[view]) continue
            const file = `${p.id}-${view}.jpg`
            p.views[view] = { file: `img/${file}`, bytes: await grab(byView[view], file) }
          }
          // A missing BACK is a real gap, not a detail: the studio has to
          // reconstruct one (src/lib/ingest/pipeline.ts) and say so to the
          // customer. Record it like any other failure so it cannot go unseen —
          // together with how hard we looked, which is the only thing that
          // makes "the supplier publishes none" a claim rather than a guess.
          if (!p.views.front) failures.push({ id: p.id, why: 'no front view' })
          if (!p.views.back) {
            p.backProbe = { colourways: candidates, probed }
            failures.push({
              id: p.id,
              why:
                probed >= candidates
                  ? `no back view (all ${candidates} colourways probed)`
                  : `no back view — ONLY ${probed}/${candidates} colourways probed, claim withheld`,
            })
          }
        } catch (e) {
          // A throw here is usually a failed image download — which can happen
          // AFTER we saw a back URL, so the surviving probe count is no longer
          // evidence of anything. Zero is the honest reading and keeps such a
          // product out of `backMissing`, where it would otherwise have
          // asserted that the supplier publishes no back at all.
          p.backProbe = { colourways: found?.candidates ?? 0, probed: 0 }
          failures.push({ id: p.id, why: `visuals: ${String(e).slice(0, 60)}` })
        }
      }),
    )
    await sleep(DELAY_MS)
  }

  // Products the supplier publishes no back view for, in ANY colourway. These
  // are not scraper misses: they are the honest gap the studio has to cover by
  // generating a back, and the list is what lets a check assert on it.
  //
  // Membership requires EXHAUSTIVE evidence — every colourway with a visuals
  // endpoint actually probed. A product we ran out of probes on is back-less as
  // far as the snapshot knows, but that is not the same statement, so it goes
  // in `backUnknown` and nobody gets to read it as "the supplier has none".
  const noBack = products.filter((p) => !p.views?.back)
  /**
   * NO recorded probe is the WEAKEST evidence there is, not the strongest.
   * `(probed ?? 0) >= (colourways ?? 0)` read 0 >= 0 as "all of them" and
   * promoted straight into `backMissing` exactly the products we learned
   * nothing about: the ones whose every visuals endpoint threw (resolveViews
   * returns null before it can record a probe) and the ones that fell into the
   * catch below while downloading — including a product whose back URL we had
   * in hand and merely failed to fetch. That is the claim this whole field
   * exists to stop being made.
   */
  const exhaustive = (p) =>
    !!p.backProbe && p.backProbe.colourways > 0 && p.backProbe.probed >= p.backProbe.colourways
  const backMissing = noBack.filter(exhaustive).map((p) => p.id)
  const backUnknown = noBack.filter((p) => !exhaustive(p)).map((p) => p.id)

  const snapshot = {
    source: 'imbretex.fr (public catalogue)',
    note: 'Temporary snapshot standing in for the Imbretex API. Prices are RRP (tarif conseillé de revente), not buying prices. Front AND back views are captured whenever the supplier publishes them. `backMissing` lists the ids that publish no back view in ANY colourway — every colourway with a visuals endpoint was probed, see each product’s `backProbe`; `backUnknown` lists ids whose colourways were not all probed, which is a weaker statement. Run scripts/generate-missing-backs.mjs next: it reconstructs a back for the `backMissing` ids and stamps it `origin: "generated"`.',
    scrapedAt: new Date().toISOString(),
    measurementLegend: { A: 'halfChestCm (largeur, laid flat)', B: 'bodyLengthCm (longueur)' },
    categories: CATS,
    count: products.length,
    backMissing,
    backUnknown,
    products,
  }
  writeFileSync(`${OUT}/products.json`, JSON.stringify(snapshot, null, 1))
  console.log(`\n✅ ${products.length} products → ${OUT}/products.json`)
  console.log(
    `   backs: ${products.length - noBack.length}/${products.length}` +
      (backMissing.length ? ` — none published for ${backMissing.join(', ')}` : ''),
  )
  if (backUnknown.length)
    console.log(`   ⚠ under-probed (no claim made): ${backUnknown.join(', ')}`)
  if (noBack.length)
    console.log('   → run: node scripts/generate-missing-backs.mjs')
  if (failures.length) {
    console.log(`⚠ ${failures.length} skipped:`)
    for (const f of failures.slice(0, 12)) console.log(`   ${f.id}: ${f.why}`)
  }
} finally {
  await browser.close()
}
