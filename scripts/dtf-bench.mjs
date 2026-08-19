/**
 * DTF nesting benchmark — shelf packer vs the true-shape packer.
 *
 * Runs the REAL bundle in a headless browser (same pattern as dtf-verify.mjs)
 * so the numbers come from the shipped code, not a transcription of it. Four
 * synthetic-but-representative instances plus one built from the sample design
 * rendered through `renderPiece`, i.e. the actual studio pipeline, masks and
 * all.
 *
 *   node scripts/dtf-bench.mjs
 *   BENCH_JSON=/abs/path.json node scripts/dtf-bench.mjs
 */
import { spawn, execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

/**
 * The film tariff this shop is actually quoted on, read out of the PRICE
 * AUTHORITY by running it.
 *
 * NOT the supplier profiles in `src/lib/dtf/suppliers.ts`. Those are public
 * tariffs surveyed in July 2026, they are a market comparison, and they are five
 * to fifteen euros the linear metre; what the associate says he pays is
 * seventeen, and it lives in `Cost::default_config()['film']` because that is the
 * one number allowed to drive a floor price. A bench that converted a measured
 * saving into euros at the wrong rate would publish a number the margin report
 * contradicts.
 *
 * `scripts/hypotheses-guard.mjs` reads PHP the same way and for the same reason:
 * comparing two files as text would not need php, and would not be worth having.
 */
/**
 * The split of a pooled bill, computed by the function that charges it.
 *
 * `Cost::attribute()` in PHP is the authority: it is what writes a share onto a
 * real order and what the margin report reads. Re-implementing the same rule in
 * this script to print a benchmark would be a second answer to "what did this
 * order cost", and the two would eventually disagree on a rounding.
 */
function attribute(soloM, pooledM, inkCm2, origin = 'fr') {
  const code =
    "define('TEESHOOP_TEST',1);" +
    "require 'wp-plugins/teeshoop-core/includes/Money.php';" +
    "require 'wp-plugins/teeshoop-core/includes/Cost.php';" +
    "$in = json_decode(file_get_contents('php://stdin'), true);" +
    "echo json_encode(Teeshoop\\Core\\Cost::attribute(" +
    "$in['solo'], $in['pooled'], Teeshoop\\Core\\Cost::default_config(), $in['origin'], $in['ink']));"
  try {
    return JSON.parse(
      execFileSync('php', ['-r', code], {
        encoding: 'utf8',
        input: JSON.stringify({ solo: soloM, pooled: pooledM, ink: inkCm2, origin }),
      }),
    )
  } catch (e) {
    console.error('ECHEC: could not split the pooled bill with the price authority:', e?.message ?? e)
    process.exit(2)
  }
}

function filmTariff() {
  const code =
    "define('TEESHOOP_TEST',1);" +
    "require 'wp-plugins/teeshoop-core/includes/Money.php';" +
    "require 'wp-plugins/teeshoop-core/includes/Cost.php';" +
    "echo json_encode(Teeshoop\\Core\\Cost::default_config()['film']);"
  try {
    return JSON.parse(execFileSync('php', ['-r', code], { encoding: 'utf8' }))
  } catch (e) {
    console.error('ECHEC: could not read the film tariff from the price authority:', e?.message ?? e)
    process.exit(2)
  }
}

const PORT = 5199
const BASE = `http://localhost:${PORT}`
const JSON_OUT = process.env.BENCH_JSON

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
let code = 1
const done = (c) => {
  try { browser?.close() } catch {}
  try { server.kill('SIGTERM') } catch {}
  process.exit(c)
}

try {
  await waitFor(BASE)
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('pageerror', (e) => console.error('[pageerror]', e.message))
  // 'networkidle' never settles here: this harness spawns a Web Worker, whose
  // vite HMR socket keeps the network permanently busy. The real readiness
  // signal is window.__dtf, which the next statement already waits on.
  await page.goto(BASE + '/dev/dtf.html', { waitUntil: 'load', timeout: 60000 })
  await page.waitForFunction(() => !!window.__dtf, { timeout: 25000 })

  const page_out = await page.evaluate(async () => {
    const { nest, shape, samplePieces, interlockMax } = window.__dtf
    const interlockStops = window.__dtf.interlockStops

    // --- synthetic artwork -> alpha masks -------------------------------
    // Shapes chosen for their bbox fill: circle 78 %, star ~40 %, wordmark
    // ~35 %, arch ~30 %. Rendered on a canvas so the mask pipeline under test
    // is the same one the modal uses.
    const RES = 0.1 // cm per mask cell
    function maskOf(kind, wCm, hCm) {
      const W = Math.max(2, Math.round(wCm / RES))
      const H = Math.max(2, Math.round(hCm / RES))
      const c = document.createElement('canvas')
      c.width = W
      c.height = H
      const x = c.getContext('2d')
      x.fillStyle = '#000'
      if (kind === 'rect') x.fillRect(0, 0, W, H)
      else if (kind === 'circle') {
        x.beginPath()
        x.ellipse(W / 2, H / 2, W / 2, H / 2, 0, 0, Math.PI * 2)
        x.fill()
      } else if (kind === 'star') {
        x.beginPath()
        for (let i = 0; i < 10; i++) {
          const r = i % 2 ? 0.42 : 1
          const a = (i / 10) * Math.PI * 2 - Math.PI / 2
          const px = W / 2 + Math.cos(a) * (W / 2) * r
          const py = H / 2 + Math.sin(a) * (H / 2) * r
          i ? x.lineTo(px, py) : x.moveTo(px, py)
        }
        x.closePath()
        x.fill()
      } else if (kind === 'word') {
        // A wordmark: a low central band plus a few ascenders.
        x.fillRect(0, H * 0.42, W, H * 0.34)
        for (let i = 0; i < 4; i++) x.fillRect(W * (0.08 + i * 0.24), 0, W * 0.08, H)
      } else if (kind === 'arch') {
        x.beginPath()
        x.ellipse(W / 2, H, W / 2, H, 0, Math.PI, 0)
        x.fill()
        x.globalCompositeOperation = 'destination-out'
        x.beginPath()
        x.ellipse(W / 2, H, W * 0.32, H * 0.64, 0, Math.PI, 0)
        x.fill()
      } else if (kind === 'tri') {
        x.beginPath()
        x.moveTo(W / 2, 0)
        x.lineTo(W, H)
        x.lineTo(0, H)
        x.closePath()
        x.fill()
      }
      const d = x.getImageData(0, 0, W, H).data
      const m = new Uint8Array(W * H)
      let ink = 0
      for (let i = 0; i < m.length; i++)
        if (d[i * 4 + 3] >= 8) {
          m[i] = 1
          ink++
        }
      return { mask: m, maskW: W, maskH: H, fill: ink / m.length }
    }

    const mk = (id, kind, wCm, hCm, qty) => {
      const m = maskOf(kind, wCm, hCm)
      return {
        id,
        sourceKey: id,
        wCm,
        hCm,
        qty,
        allowRotate: true,
        mask: m.mask,
        maskW: m.maskW,
        maskH: m.maskH,
        __fill: m.fill,
      }
    }

    const instances = {
      // All rectangles: the packer has nothing to exploit but the search.
      rects: [
        mk('a', 'rect', 21, 29.7, 24),
        mk('b', 'rect', 9, 9, 40),
        mk('c', 'rect', 30, 40, 8),
      ],
      // Chest logos: circles + stars, the everyday boutique order.
      logos: [
        mk('a', 'circle', 12, 12, 40),
        mk('b', 'star', 18, 18, 18),
        mk('c', 'circle', 26, 26, 10),
      ],
      // A realistic apparel mix: big fronts, wordmarks, small chest marks.
      apparel: [
        mk('a', 'word', 28, 12, 30),
        mk('b', 'circle', 10, 10, 36),
        mk('c', 'rect', 30, 38, 10),
        mk('d', 'star', 16, 16, 14),
      ],
      // Deeply concave art, where true-shape nesting earns the most.
      concave: [
        mk('a', 'arch', 30, 18, 22),
        mk('b', 'tri', 24, 22, 20),
        mk('c', 'word', 34, 10, 20),
      ],
    }

    // --- real basket: the sample design rendered through renderPieces ----
    // TWO instances of the SAME order: `basketMerged` is the pre-split
    // behaviour (one transfer per side, empty space and all), `basket` is one
    // transfer per independent visual. The pair is the whole point of this
    // bench — the difference between the two rows is the film the split saves.
    //
    // Quantity is per ORDER LINE, never per transfer: N garments need N copies
    // of every visual on the side. Assigning it per piece instead would give
    // the split instance more copies than the merged one and compare two
    // different orders.
    const rowQty = new Map()
    let ri = 0
    const qtyOf = (row) => {
      if (!rowQty.has(row)) rowQty.set(row, [12, 8, 6, 4][ri++ % 4])
      return rowQty.get(row)
    }
    const toPieces = (list) =>
      list.map((p) => ({
        id: p.key,
        sourceKey: p.key,
        wCm: p.wCm,
        hCm: p.hCm,
        qty: qtyOf(p.row),
        allowRotate: true,
        ...(p.mask ? { mask: p.mask.mask, maskW: p.mask.maskW, maskH: p.mask.maskH } : {}),
        __fill: p.mask ? p.mask.fillRatio : 1,
      }))
    // Merged FIRST so the per-row quantities are assigned in row order and both
    // instances see exactly the same ones.
    instances.basketMerged = toPieces(await samplePieces(48, { merged: true }))
    instances.basket = toPieces(await samplePieces(48))

    // 58 cm printable width, 5 mm gap, 0 margins — the researched defaults.
    const base = {
      printableWidthCm: 58,
      maxLengthCm: 250,
      gapCm: 0.5,
      edgeMarginCm: 0,
      edgeMarginSideCm: 0,
      edgeMarginEndCm: 0,
      billingStepCm: 10,
    }

    const strip = (ps) => ps.map(({ __fill, ...rest }) => rest)
    const rows = []
    for (const [name, piecesRaw] of Object.entries(instances)) {
      const pieces = strip(piecesRaw)
      const bboxFill =
        piecesRaw.reduce((a, p) => a + p.__fill * p.qty, 0) /
        piecesRaw.reduce((a, p) => a + p.qty, 0)
      const qty = piecesRaw.reduce((a, p) => a + p.qty, 0)

      const t0 = performance.now()
      const shelf = nest(pieces, base)
      const tShelf = performance.now() - t0

      const run = (interlock, restarts, flip) => {
        const ps = flip ? pieces.map((p) => ({ ...p, allowFlip: true })) : pieces
        const t = performance.now()
        const r = shape({
          pieces: ps,
          options: { ...base, maxInterlockCm: interlock, restarts },
        })
        return {
          lengthCm: r.totalLengthCm,
          util: r.totalUtilization,
          ink: r.totalInkUtilization ?? null,
          sheets: r.sheets.length,
          pieces: r.totalPieces,
          ms: Math.round(performance.now() - t),
        }
      }

      // The slider is a CEILING, and the packer sweeps every rung below it, so
      // a bigger setting must never buy more film. This is the assertion that
      // keeps that true: without the sweep the logo set packed into 340 cm at
      // "maximum" and 380 cm at "jeu 2 cm", i.e. the operator paid 12 % extra
      // for asking for more fill.
      const ladder = interlockStops.map(
        (s) => shape({ pieces, options: { ...base, maxInterlockCm: s, restarts: 12 } }).totalLengthCm,
      )
      const monotone = ladder.every((v, i) => i === 0 || v <= ladder[i - 1] + 1e-6)

      rows.push({
        instance: name,
        qty,
        transfers: pieces.length,
        ladder,
        monotone,
        bboxFill: Math.round(bboxFill * 1000) / 1000,
        shelf: {
          lengthCm: shelf.totalLengthCm,
          util: shelf.totalUtilization,
          sheets: shelf.sheets.length,
          pieces: shelf.totalPieces,
          ms: Math.round(tShelf),
        },
        strips: run(0, 12, false),
        interlock2: run(2, 12, false),
        maxFill: run(interlockMax, 12, false),
        maxFillFlip: run(interlockMax, 12, true),
        restarts24: run(interlockMax, 24, false),
      })
    }

    // --- a realistic week of orders, pooled against one at a time --------
    //
    // Six paid orders of the kind this shop takes: a club order in two sizes,
    // two small reassorts, a padded customer upload, a staff run. The designs
    // are the same two the rest of this bench uses, rendered through the real
    // pipeline, and each order is nested BOTH inside the pool and on its own so
    // the saving is a difference between two measurements rather than a claim.
    const WEEK = [
      { id: '1041', design: 'sample', sizes: { M: 12, L: 8 } },
      { id: '1042', design: 'padded', sizes: { S: 4, M: 6 } },
      { id: '1043', design: 'sample', sizes: { L: 5 } },
      { id: '1044', design: 'padded', sizes: { M: 3, L: 3, XL: 2 } },
      { id: '1045', design: 'sample', sizes: { S: 2, XL: 2 } },
      { id: '1046', design: 'padded', sizes: { M: 20 } },
    ]
    const weekRaw = await window.__dtf.weekPieces(48, WEEK)
    const toShape = (list) =>
      list.map((p) => ({
        id: p.key,
        sourceKey: p.key,
        wCm: p.wCm,
        hCm: p.hCm,
        qty: p.qty,
        allowRotate: true,
        ...(p.mask ? { mask: p.mask.mask, maskW: p.mask.maskW, maskH: p.mask.maskH } : {}),
      }))

    const byOrder = new Map()
    for (const p of weekRaw) {
      const list = byOrder.get(p.orderId)
      if (list) list.push(p)
      else byOrder.set(p.orderId, [p])
    }

    // 56 cm and 100 cm are the SHOP's roll and file length (Cost.php), not the
    // studio's surveyed profile: the whole point is a euro figure the margin
    // report would agree with.
    const shopGeom = { ...base, printableWidthCm: 56, maxLengthCm: 100 }
    const packShelf = (ps) => nest(ps, shopGeom)
    const packFill = (ps) =>
      shape({ pieces: ps, options: { ...shopGeom, maxInterlockCm: interlockMax, restarts: 12 } })

    const allPieces = toShape(weekRaw)
    const week = {
      orders: [...byOrder.keys()].sort(),
      pooledShelfCm: packShelf(allPieces).totalLengthCm,
      pooledFillCm: packFill(allPieces).totalLengthCm,
      pooledSheets: packFill(allPieces).sheets.length,
      solo: {},
      ink: {},
      poses: {},
    }
    for (const [orderId, list] of byOrder) {
      const ps = toShape(list)
      week.solo[orderId] = {
        shelfCm: packShelf(ps).totalLengthCm,
        fillCm: packFill(ps).totalLengthCm,
      }
      week.ink[orderId] = list.reduce((a, p) => a + p.wCm * p.hCm * p.qty, 0)
      week.poses[orderId] = list.reduce((a, p) => a + p.qty, 0)
    }
    return { rows, week }
  })

  const { rows: out, week } = page_out
  const pc = (a, b) => (b > 0 ? `${(((a - b) / a) * 100).toFixed(1)} %` : '—')
  const fmt = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)} %`)
  console.log(
    '\ninstance   qty  bboxFill |  shelf cm  |  strips cm |  jeu2cm  |  maxfill |  +flip  | 24 essais | gain maxfill',
  )
  console.log('-'.repeat(118))
  for (const r of out)
    console.log(
      `${r.instance.padEnd(10)} ${String(r.qty).padStart(3)}  ` +
        `${(r.bboxFill * 100).toFixed(0).padStart(6)} % | ` +
        `${r.shelf.lengthCm.toFixed(1).padStart(9)} | ` +
        `${r.strips.lengthCm.toFixed(1).padStart(10)} | ` +
        `${r.interlock2.lengthCm.toFixed(1).padStart(8)} | ` +
        `${r.maxFill.lengthCm.toFixed(1).padStart(8)} | ` +
        `${r.maxFillFlip.lengthCm.toFixed(1).padStart(7)} | ` +
        `${r.restarts24.lengthCm.toFixed(1).padStart(9)} | ` +
        `${pc(r.shelf.lengthCm, r.maxFill.lengthCm).padStart(8)}`,
    )
  console.log('\nutilisation (boîte / encre) and timing')
  console.log('-'.repeat(80))
  for (const r of out)
    console.log(
      `${r.instance.padEnd(10)} shelf ${fmt(r.shelf.util).padStart(5)} / —      ` +
        `maxfill ${fmt(r.maxFill.util).padStart(5)} / ${fmt(r.maxFill.ink).padStart(5)}   ` +
        `${String(r.maxFill.ms).padStart(5)} ms (12 restarts) · ` +
        `${String(r.restarts24.ms).padStart(5)} ms (24)`,
    )

  // The split, measured on the real basket: same order, same settings, same
  // packer — the only difference is whether a side is emitted as one transfer
  // or one per independent visual.
  const split = out.find((r) => r.instance === 'basket')
  const mergedRow = out.find((r) => r.instance === 'basketMerged')
  if (split && mergedRow) {
    const ROLL_W_CM = 58
    const m2 = (cm) => (cm * ROLL_W_CM) / 10000
    console.log('\nUN TRANSFERT PAR VISUEL vs UN PAR CÔTÉ — panier réel')
    console.log('-'.repeat(80))
    const line = (tag, a, b) =>
      console.log(
        `${tag.padEnd(16)} ${b.lengthCm.toFixed(1).padStart(8)} cm → ` +
          `${a.lengthCm.toFixed(1).padStart(8)} cm   ` +
          `${m2(b.lengthCm).toFixed(2)} → ${m2(a.lengthCm).toFixed(2)} m²   ` +
          `${pc(b.lengthCm, a.lengthCm).padStart(8)} de film en moins`,
      )
    line('bandes droites', split.shelf, mergedRow.shelf)
    line('jeu 2 cm', split.interlock2, mergedRow.interlock2)
    line('remplissage max', split.maxFill, mergedRow.maxFill)
    console.log(
      `transferts       ${String(mergedRow.transfers).padStart(8)}    → ` +
        `${String(split.transfers).padStart(8)}     ` +
        `(${mergedRow.qty} → ${split.qty} poses)`,
    )
  }

  const totalShelf = out.reduce((a, r) => a + r.shelf.lengthCm, 0)
  const totalMax = out.reduce((a, r) => a + r.maxFill.lengthCm, 0)
  const totalFlip = out.reduce((a, r) => a + r.maxFillFlip.lengthCm, 0)
  console.log(
    `\nTOTAL shelf ${totalShelf.toFixed(1)} cm → maxfill ${totalMax.toFixed(1)} cm ` +
      `(${pc(totalShelf, totalMax)}) · with 180°/270° ${totalFlip.toFixed(1)} cm ` +
      `(${pc(totalMax, totalFlip)} more)`,
  )
  for (const r of out)
    if (r.shelf.pieces !== r.maxFill.pieces)
      console.error(`⚠ ${r.instance}: piece count differs (${r.shelf.pieces} vs ${r.maxFill.pieces})`)

  // -------------------------------------------------------------------------
  // POOLING, on a realistic week
  // -------------------------------------------------------------------------
  //
  // The euros come from the price authority, twice over: the tariff from
  // `Cost::default_config()`, the split from `Cost::attribute()`. Nothing here
  // multiplies a rate by a length itself.
  const film = filmTariff()
  const soloFill = {}
  const soloShelf = {}
  for (const id of week.orders) {
    soloFill[id] = week.solo[id].fillCm / 100
    soloShelf[id] = week.solo[id].shelfCm / 100
  }
  const bill = attribute(soloFill, week.pooledFillCm / 100, week.ink)
  const billShelf = attribute(soloShelf, week.pooledShelfCm / 100, week.ink)

  const m2 = (cm) => (cm * film.width_cm) / 10000
  const e = (cents) => `${(cents / 100).toFixed(2).replace('.', ',')} EUR`
  const sumSoloFill = week.orders.reduce((a, id) => a + week.solo[id].fillCm, 0)
  const sumSoloShelf = week.orders.reduce((a, id) => a + week.solo[id].shelfCm, 0)

  console.log('\nUNE SEMAINE DE COMMANDES : imbriquées ensemble vs une par une')
  console.log('-'.repeat(96))
  console.log(
    `laize ${film.width_cm} cm · fichier max ${film.max_length_cm} cm · ` +
      `${film.rate_fr_ht / 100} EUR/m · minimum ${film.min_m} m · ` +
      `perte ${Math.round(film.waste_rate * 100)} % · livraison ${film.delivery_ht / 100} EUR`,
  )
  console.log(
    'commande'.padEnd(10) +
      'poses'.padStart(7) +
      'seule cm'.padStart(11) +
      'part €'.padStart(12) +
      'seule €'.padStart(12) +
      'économie'.padStart(12) +
      'part surface'.padStart(15),
  )
  for (const id of week.orders) {
    const sh = bill.shares[id]
    console.log(
      id.padEnd(10) +
        String(week.poses[id]).padStart(7) +
        week.solo[id].fillCm.toFixed(1).padStart(11) +
        e(sh.share_ht).padStart(12) +
        e(sh.solo_ht).padStart(12) +
        e(sh.saved_ht).padStart(12) +
        e(sh.area_share_ht).padStart(15),
    )
  }
  console.log('-'.repeat(96))
  console.log(
    'TOTAL'.padEnd(10) +
      String(week.orders.reduce((a, id) => a + week.poses[id], 0)).padStart(7) +
      sumSoloFill.toFixed(1).padStart(11) +
      e(bill.total_ht).padStart(12) +
      e(bill.solo_total_ht).padStart(12) +
      e(bill.saved_ht).padStart(12),
  )
  console.log(
    `\nremplissage max   ${sumSoloFill.toFixed(1)} cm → ${week.pooledFillCm.toFixed(1)} cm   ` +
      `${m2(sumSoloFill).toFixed(2)} → ${m2(week.pooledFillCm).toFixed(2)} m²   ` +
      `${pc(sumSoloFill, week.pooledFillCm)} de film en moins   ` +
      `${e(bill.saved_ht)} économisés (${((bill.saved_ht / bill.solo_total_ht) * 100).toFixed(1)} %)`,
  )
  console.log(
    `bandes droites    ${sumSoloShelf.toFixed(1)} cm → ${week.pooledShelfCm.toFixed(1)} cm   ` +
      `${m2(sumSoloShelf).toFixed(2)} → ${m2(week.pooledShelfCm).toFixed(2)} m²   ` +
      `${pc(sumSoloShelf, week.pooledShelfCm)} de film en moins   ` +
      `${e(billShelf.saved_ht)} économisés`,
  )
  console.log(
    `${week.orders.length} commandes, ${week.pooledSheets} planche(s) au lieu de ` +
      `${week.orders.length}, une livraison au lieu de ${week.orders.length}, ` +
      `un minimum fournisseur au lieu de ${week.orders.length}.`,
  )

  /*
   * WHERE THE MONEY ACTUALLY COMES FROM, decomposed rather than left as a
   * headline. « 61 % d'économie » read as « 61 % de film » is wrong by an order
   * of magnitude: the film itself moves 5 %, and almost all of the euros are six
   * delivery charges and six one-metre minimums collapsing into one of each.
   *
   * FOUR terms, and they are the algebra of `Cost::film` rather than an
   * apportionment we chose:
   *   saved = rate x (1 + perte) x [ Σ max(min, mᵢ) − max(min, P) ] + (N−1) x port
   *         = rate x (1 + perte) x ( Σ max(min, mᵢ) − Σ mᵢ )      the minimums
   *         + rate x (1 + perte) x ( Σ mᵢ − P )                    the nesting
   *         − rate x (1 + perte) x ( max(min, P) − P )             the pool's own
   *         + (N−1) x port                                          the deliveries
   *
   * The third term is what an earlier version of this block dropped, by using P
   * where the formula uses max(min, P). It is zero on any run past the supplier's
   * minimum and it is NOT zero on a small one, which is exactly the case pooling
   * is most valuable in: the identity then failed and the guard below rejected a
   * correct split.
   */
  const N = week.orders.length
  const sumRaw = week.orders.reduce((a, id) => a + week.solo[id].fillCm / 100, 0)
  const sumBilled = week.orders.reduce(
    (a, id) => a + Math.max(film.min_m, week.solo[id].fillCm / 100),
    0,
  )
  const pooledRaw = week.pooledFillCm / 100
  const perM = film.rate_fr_ht * (1 + film.waste_rate)
  const fromMinimums = Math.round(perM * (sumBilled - sumRaw))
  const fromNesting = Math.round(perM * (sumRaw - pooledRaw))
  const pooledUnused = Math.round(perM * (Math.max(film.min_m, pooledRaw) - pooledRaw))
  const fromDelivery = (N - 1) * film.delivery_ht
  const modelled = fromMinimums + fromNesting + fromDelivery - pooledUnused
  console.log(
    `d'où viennent les ${e(bill.saved_ht)} : ` +
      `${e(fromDelivery)} de livraisons mutualisées, ` +
      `${e(fromMinimums)} de minimum fournisseur non gaspillé, ` +
      `${e(fromNesting)} d'imbrication réellement gagnée` +
      (pooledUnused > 0 ? `, moins ${e(pooledUnused)} de minimum que le lot lui-même n'utilise pas` : '') +
      '.',
  )
  if (Math.abs(modelled - bill.saved_ht) > 5) {
    console.error(
      `ECHEC: la décomposition (${e(modelled)}) ne rend pas l'économie mesurée (${e(bill.saved_ht)})`,
    )
    if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ instances: out, week, bill }, null, 2))
    done(1)
  }

  // Which rule charges what. The gap is the argument for choosing one.
  const spread = week.orders.map((id) => {
    const sh = bill.shares[id]
    return {
      id,
      solo: sh.share_ht,
      area: sh.area_share_ht,
      gapPct: sh.area_share_ht > 0 ? ((sh.share_ht - sh.area_share_ht) / sh.area_share_ht) * 100 : 0,
    }
  })
  const worst = spread.reduce((a, r) => (Math.abs(r.gapPct) > Math.abs(a.gapPct) ? r : a), spread[0])
  console.log(
    `\nrègle appliquée (au métrage) contre règle publiée (à la surface) : ` +
      `écart maximal sur la commande ${worst.id}, ${e(worst.solo)} contre ${e(worst.area)} ` +
      `(${worst.gapPct >= 0 ? '+' : ''}${worst.gapPct.toFixed(1)} %)`,
  )
  if (bill.worse)
    console.log(
      'ATTENTION : ce lot coûte PLUS CHER que les mêmes commandes achetées séparément.',
    )

  console.log('\ninterlock ladder (cm par cran, doit être décroissant)')
  console.log('-'.repeat(80))
  let bad = 0
  for (const r of out) {
    console.log(`${r.instance.padEnd(10)} ${r.ladder.map((v) => String(v).padStart(6)).join(' ')}` +
      (r.monotone ? '' : '   ⚠ NON MONOTONE'))
    if (!r.monotone) bad++
  }
  if (bad) {
    console.error(`❌ ${bad} instance(s) get WORSE when the interlock ceiling is raised`)
    if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(out, null, 2))
    done(1)
  }

  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ instances: out, week, bill }, null, 2))
  code = 0
} catch (e) {
  console.error('❌', e?.stack || e?.message || e)
}
done(code)
