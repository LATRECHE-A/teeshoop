/**
 * Headless verification for the DTF gang-sheet module.
 *
 * Boots Vite dev, loads dev/dtf.html and runs five suites in-page against the
 * real bundle, then screenshots the admin modal:
 *
 *  1. SHELF PACKER: determinism, gap-aware non-overlap, width bounds, straight
 *     full-width corridors, qty expansion, rotation rules, max-length split.
 *  2. PER-VISUAL SPLIT: the same ink in smaller boxes, unique part keys in
 *     reading order, and a placement for every transfer.
 *  3. INK TRIM: the same, one level down. A visual's box is its ink and not
 *     the rectangle it was dropped into. Measured on a PADDED-UPLOAD fixture
 *     the harness builds, because the sample design has nothing to trim.
 *  4. TRUE-SHAPE PACKER: determinism across three consecutive runs AND across
 *     Worker vs inline, "never worse than the shelf packer", sheet-edge and
 *     billing-step bounds, bbox non-overlap at interlock 0, and an INK-LEVEL
 *     collision audit on real rendered artwork (bounding boxes legitimately
 *     overlap once pieces interlock, so only rasterised ink can prove clearance).
 *  5. ZIP EXPORT: the archive is cracked open HERE, in Node, with a
 *     hand-rolled reader: every member's CRC-32 is recomputed from its stored
 *     bytes, and every PNG's IHDR width/height is checked against the pixel
 *     size its sheet's cm geometry and DPI imply.
 *  6. POOLING: several orders on one film, determinism survives assembling a
 *     run from whatever arrived, every transfer maps back to exactly one order,
 *     and the archive carries the workshop's paperwork (a press sheet per order
 *     stating the PROOF VERSION and the design id, the picking list, the split
 *     of the film bill).
 *
 *   DTF_OUT_DIR=/abs/dir node scripts/dtf-verify.mjs
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'
import { NODE, VITE } from './bin.mjs'

const PORT = 5198
const BASE = `http://localhost:${PORT}`
const OUT = process.env.DTF_OUT_DIR

// ---------------------------------------------------------------------------
// ZIP reader: deliberately hand-rolled and independent of src/lib/zip.ts
// ---------------------------------------------------------------------------
// Verifying a writer with its own reader proves only that it is
// self-consistent. This one parses the archive the way `unzip` does: find the
// EOCD, walk the central directory, follow each record's local-header offset,
// and recompute the CRC-32 from the bytes actually stored there.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

const crc32 = (buf) => {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Central-directory listing: name → { data, crcOk }. Throws on a malformed archive. */
function readZip(buf) {
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 0xffff; i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  if (eocd < 0) throw new Error('no end-of-central-directory record: archive is truncated')
  const count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  const out = new Map()
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50)
      throw new Error(`central directory entry ${n} has a bad signature`)
    const crc = buf.readUInt32LE(off + 16)
    const compSize = buf.readUInt32LE(off + 20)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const local = buf.readUInt32LE(off + 42)
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen)
    if (buf.readUInt32LE(local) !== 0x04034b50)
      throw new Error(`local header for ${name} has a bad signature`)
    const lNameLen = buf.readUInt16LE(local + 26)
    const lExtraLen = buf.readUInt16LE(local + 28)
    const start = local + 30 + lNameLen + lExtraLen
    const data = buf.subarray(start, start + compSize)
    out.set(name, { data, crcOk: crc32(data) === crc, method: buf.readUInt16LE(off + 10) })
    off += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/** PNG IHDR: signature check plus the declared pixel dimensions. */
function pngSize(buf) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) return null
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}

const CM_PER_IN = 2.54
/** Exactly what renderSheet does: max(2, round(cm × dpi ÷ 2.54)). */
const pxFor = (cm, dpi) => Math.max(2, Math.round((cm * dpi) / CM_PER_IN))

function checkZip(buf, result, info) {
  const fails = []
  let entries
  try {
    entries = readZip(buf)
  } catch (e) {
    return [`unreadable archive: ${e.message}`]
  }

  for (const [name, m] of entries) {
    if (!m.crcOk) fails.push(`${name}: CRC-32 does not match the stored bytes`)
    if (m.method !== 0) fails.push(`${name}: method ${m.method}, expected 0 (store)`)
  }

  const names = [...entries.keys()]
  const folder = names[0]?.split('/')[0]
  if (!folder) return ['archive has no top-level folder']
  if (!names.every((n) => n.startsWith(folder + '/')))
    fails.push('archive members are not all inside ONE top-level folder')

  for (const req of ['manifeste.json', 'LISEZ-MOI.txt'])
    if (!entries.has(`${folder}/${req}`)) fails.push(`missing ${req}`)

  // Every sheet must contribute one print PNG and one cutting plan, each at the
  // exact pixel size its cm geometry and DPI imply. This is the check that
  // catches a sheet silently rendered at the wrong scale.
  for (let i = 0; i < result.sheets.length; i++) {
    const s = result.sheets[i]
    const num = String(i + 1).padStart(2, '0')
    for (const [dir, dpi] of [
      ['impression', info.dpis[i]],
      ['decoupe', info.cutplanDpi],
    ]) {
      const key = `${folder}/${dir}/planche-${num}.png`
      const m = entries.get(key)
      if (!m) {
        fails.push(`missing ${key}`)
        continue
      }
      const size = pngSize(m.data)
      if (!size) {
        fails.push(`${key} is not a PNG`)
        continue
      }
      const want = { w: pxFor(s.widthCm, dpi), h: pxFor(s.lengthCm, dpi) }
      if (size.w !== want.w || size.h !== want.h)
        fails.push(
          `${key}: ${size.w}×${size.h} px, expected ${want.w}×${want.h} ` +
            `(${s.widthCm}×${s.lengthCm} cm @ ${dpi} dpi)`,
        )
    }
  }

  const manifest = entries.get(`${folder}/manifeste.json`)
  if (manifest) {
    let m
    try {
      m = JSON.parse(manifest.data.toString('utf8'))
    } catch {
      fails.push('manifeste.json is not valid JSON')
    }
    if (m) {
      if (m.sheets?.length !== result.sheets.length)
        fails.push(`manifest lists ${m.sheets?.length} sheets, the result has ${result.sheets.length}`)
      if (m.totals?.pieces !== result.totalPieces)
        fails.push(`manifest totals.pieces ${m.totals?.pieces} ≠ ${result.totalPieces}`)
      if (!m.orderName) fails.push('manifest carries no order name')
      if (!m.nesting || typeof m.nesting.flip !== 'boolean')
        fails.push('manifest does not record the flip permission')
      // A side printed as several transfers is only pressable if the archive
      // says where each one goes. The manifest is the traceability record, so
      // that is the file it has to be in, not only on screen.
      for (const p of m.pieces ?? []) {
        const pl = p.placement
        if (
          !pl ||
          typeof pl.topCm !== 'number' ||
          typeof pl.centerDxCm !== 'number' ||
          !(pl.areaWCm > 0) ||
          !(pl.areaHCm > 0)
        )
          fails.push(`manifest piece ${p.sourceKey} carries no usable placement`)
        if (p.parts !== undefined && !(p.part >= 1 && p.part <= p.parts))
          fails.push(`manifest piece ${p.sourceKey} has a bad part index ${p.part}/${p.parts}`)
      }
    }
  }

  const readme = entries.get(`${folder}/LISEZ-MOI.txt`)
  if (readme) {
    const txt = readme.data.toString('utf8')
    for (const needle of [
      'DOSSIER D’IMPRESSION DTF',
      'FOURNISSEUR',
      'PLANCHES',
      'VISUELS',
      // The position of every transfer, in the file the workshop actually reads.
      'pose :',
    ])
      if (!txt.includes(needle)) fails.push(`LISEZ-MOI is missing its "${needle}" section`)
  }

  if (!info.fileName.endsWith('.zip')) fails.push(`archive name ${info.fileName} is not a .zip`)
  return fails
}

// 90 s: Vite measured at 35 s to start on a loaded machine (26/09/2026), and a
// gate that fails on a slow start says nothing about the packer it guards. The
// bound only exists so a server that never comes up is not waited on for ever.
const waitFor = (url, ms = 90000) =>
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

const server = spawn(NODE, [VITE, '--port', String(PORT), '--strictPort'], {
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 920 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push('[console] ' + m.text()))

  // 'networkidle' never settles here: this harness spawns a Web Worker, whose
  // vite HMR socket keeps the network permanently busy. The real readiness
  // signal is window.__dtf, which the next statement already waits on.
  await page.goto(BASE + '/dev/dtf.html', { waitUntil: 'load', timeout: 45000 })
  await page.waitForFunction(() => !!window.__dtf, { timeout: 20000 })

  // ------------------------------------------------------------------
  // Pure-engine assertion suite (runs in-page against the real bundle)
  // ------------------------------------------------------------------
  const suite = await page.evaluate(() => {
    const { nest } = window.__dtf
    const fails = []
    const TOL = 1e-3
    const opts = { printableWidthCm: 58, maxLengthCm: 250, gapCm: 0.8, edgeMarginCm: 1 }

    const checkGeometry = (res, o, tag) => {
      for (let si = 0; si < res.sheets.length; si++) {
        const s = res.sheets[si]
        for (const p of s.placements) {
          if (p.xCm < o.edgeMarginCm - TOL)
            fails.push(`${tag}#${si}: ${p.id} crosses left margin`)
          if (p.xCm + p.wCm > o.printableWidthCm - o.edgeMarginCm + TOL)
            fails.push(`${tag}#${si}: ${p.id} crosses right margin`)
          if (p.yCm < o.edgeMarginCm - TOL)
            fails.push(`${tag}#${si}: ${p.id} crosses top margin`)
          if (p.yCm + p.hCm > s.rawLengthCm - o.edgeMarginCm + TOL)
            fails.push(`${tag}#${si}: ${p.id} crosses bottom margin`)
        }
        // pairwise AABB with required gap spacing between artworks
        for (let i = 0; i < s.placements.length; i++)
          for (let j = i + 1; j < s.placements.length; j++) {
            const a = s.placements[i]
            const b = s.placements[j]
            const overlap =
              a.xCm < b.xCm + b.wCm + o.gapCm - TOL &&
              b.xCm < a.xCm + a.wCm + o.gapCm - TOL &&
              a.yCm < b.yCm + b.hCm + o.gapCm - TOL &&
              b.yCm < a.yCm + a.hCm + o.gapCm - TOL
            if (overlap) fails.push(`${tag}#${si}: ${a.id} vs ${b.id} closer than gap`)
          }
        // shelf membership (top-aligned, never taller than the shelf)
        for (const p of s.placements) {
          const k = s.shelfYsCm.findIndex((y) => Math.abs(y - p.yCm) < TOL)
          if (k === -1) fails.push(`${tag}#${si}: ${p.id} not top-aligned to a shelf`)
          else if (p.hCm > s.shelfHsCm[k] + TOL)
            fails.push(`${tag}#${si}: ${p.id} taller than its shelf`)
        }
        // straight full-width corridors between shelves
        for (let k = 0; k + 1 < s.shelfYsCm.length; k++) {
          const y0 = s.shelfYsCm[k] + s.shelfHsCm[k]
          const y1 = s.shelfYsCm[k + 1]
          if (y1 - y0 < o.gapCm - TOL)
            fails.push(`${tag}#${si}: corridor ${k} narrower than gap (${(y1 - y0).toFixed(3)})`)
          for (const p of s.placements)
            if (p.yCm < y1 - TOL && p.yCm + p.hCm > y0 + TOL)
              fails.push(`${tag}#${si}: ${p.id} crosses corridor ${k}`)
        }
        if (s.rawLengthCm > o.maxLengthCm + TOL)
          fails.push(`${tag}#${si}: raw length ${s.rawLengthCm} exceeds max ${o.maxLengthCm}`)
        if (Math.abs(s.lengthCm / 10 - Math.round(s.lengthCm / 10)) > 1e-6)
          fails.push(`${tag}#${si}: billed length ${s.lengthCm} not a 10 cm step`)
        if (s.lengthCm + 1e-6 < s.rawLengthCm)
          fails.push(`${tag}#${si}: billed ${s.lengthCm} < raw ${s.rawLengthCm}`)
      }
    }

    // Realistic mixed set: 40× left-chest 9×9, 10× A4, 5× 30×40.
    const mixed = [
      { id: 'chest', sourceKey: 'chest', wCm: 9, hCm: 9, qty: 40, allowRotate: true },
      { id: 'a4', sourceKey: 'a4', wCm: 21, hCm: 29.7, qty: 10, allowRotate: true },
      { id: 'big', sourceKey: 'big', wCm: 30, hCm: 40, qty: 5, allowRotate: true },
    ]

    // determinism (identical + order-shuffled inputs)
    const r1 = nest(mixed, opts)
    if (JSON.stringify(r1) !== JSON.stringify(nest(mixed, opts)))
      fails.push('determinism: identical input produced different output')
    if (JSON.stringify(r1) !== JSON.stringify(nest([...mixed].reverse(), opts)))
      fails.push('determinism: input order changed the output')

    // qty expansion
    const placed = r1.sheets.reduce((a, s) => a + s.placements.length, 0)
    if (placed !== 55 || r1.totalPieces !== 55)
      fails.push(`qty expansion: expected 55 placements, got ${placed}/${r1.totalPieces}`)

    checkGeometry(r1, opts, 'mixed')

    // max-length split
    if (r1.sheets.length < 2) fails.push('expected the mixed set to split across ≥2 sheets')

    // utilization floor
    if (!(r1.totalUtilization > 0.6))
      fails.push(`utilization ${r1.totalUtilization} ≤ 0.6 on the mixed set`)

    // rotation only when allowed
    const noRot = nest(
      [{ id: 'p', sourceKey: 'p', wCm: 10, hCm: 30, qty: 6, allowRotate: false }],
      opts,
    )
    for (const s of noRot.sheets)
      for (const p of s.placements)
        if (p.rotated || Math.abs(p.wCm - 10) > TOL || Math.abs(p.hCm - 30) > TOL)
          fails.push(`rotation applied to allowRotate:false piece (${p.id})`)
    checkGeometry(noRot, opts, 'noRot')

    const rot = nest(
      [{ id: 'p', sourceKey: 'p', wCm: 10, hCm: 30, qty: 6, allowRotate: true }],
      opts,
    )
    checkGeometry(rot, opts, 'rot')

    // unplaceable geometry is reported, never silently dropped into a sheet
    const un = nest(
      [{ id: 'huge', sourceKey: 'huge', wCm: 70, hCm: 10, qty: 2, allowRotate: false }],
      opts,
    )
    if (!un.unplaceable.includes('huge')) fails.push('oversized piece not reported unplaceable')
    if (un.totalPieces !== 0) fails.push('oversized piece was placed anyway')

    // exact gap/margin semantics on a 2-piece shelf
    const two = nest(
      [{ id: 't', sourceKey: 't', wCm: 20, hCm: 10, qty: 2, allowRotate: false }],
      opts,
    )
    const ps = [...(two.sheets[0]?.placements ?? [])].sort((a, b) => a.xCm - b.xCm)
    if (ps.length !== 2) fails.push('two-piece case did not place 2 pieces')
    else {
      if (Math.abs(ps[0].xCm - opts.edgeMarginCm) > TOL)
        fails.push(`left margin ${ps[0].xCm} ≠ ${opts.edgeMarginCm}`)
      if (Math.abs(ps[1].xCm - (ps[0].xCm + ps[0].wCm) - opts.gapCm) > TOL)
        fails.push('artwork-to-artwork spacing ≠ gap')
      if (Math.abs(ps[0].yCm - opts.edgeMarginCm) > TOL)
        fails.push(`top margin ${ps[0].yCm} ≠ ${opts.edgeMarginCm}`)
    }

    return {
      fails,
      stats: {
        sheets: r1.sheets.length,
        totalLm: r1.totalLengthM,
        utilization: r1.totalUtilization,
        perSheet: r1.sheets.map((s) => ({ len: s.lengthCm, util: s.utilization })),
      },
    }
  })

  console.log('engine stats:', JSON.stringify(suite.stats))
  if (suite.fails.length) {
    console.error(`❌ ${suite.fails.length} engine assertion(s) failed:`)
    for (const f of suite.fails.slice(0, 20)) console.error('  -', f)
    done(1)
  }

  // ------------------------------------------------------------------
  // Per-visual splitting: same ink, smaller boxes, every piece placed
  // ------------------------------------------------------------------
  // Runs BEFORE the true-shape suite on purpose: `samplePieces` publishes
  // window.__dtfSources, which the ZIP suite later reads, and the true-shape
  // suite re-publishes it at its own DPI as its first act.
  const splitSuite = await page.evaluate(async () => {
    const { splitProbe, shape, samplePieces, interlockMax } = window.__dtf
    const fails = []
    const probe = await splitProbe(48)

    // If nothing splits, every assertion below is vacuous and the feature is
    // untested. Say so rather than passing quietly.
    if (!probe.some((s) => s.parts > 1))
      fails.push('no side of the sample design splits: the split suite is vacuous')

    const seen = new Set()
    for (const s of probe) {
      // The artwork is the SAME artwork: splitting may not lose ink (a crop
      // that clipped a neighbour's edge) or invent it (a crop that swallowed a
      // neighbour, printing that visual twice on the garment).
      const drift = s.inkMerged > 0 ? Math.abs(s.inkSplit - s.inkMerged) / s.inkMerged : 0
      if (drift > 0.03)
        fails.push(
          `${s.side}: split ink ${s.inkSplit} vs merged ${s.inkMerged} (${(drift * 100).toFixed(1)} % drift)`,
        )
      // …in strictly less bounding-box area, which IS the saving.
      if (s.boxSplitCm2 > s.boxMergedCm2 + 1e-6)
        fails.push(`${s.side}: split boxes ${s.boxSplitCm2} cm² > merged ${s.boxMergedCm2} cm²`)
      if (s.parts > 1 && !(s.boxSplitCm2 < s.boxMergedCm2 - 1e-6))
        fails.push(`${s.side}: split into ${s.parts} pieces but saved no box area`)

      // Identity: a side that yields ONE piece keeps its key verbatim (things
      // persist that key), a split side numbers its parts 1..n, uniquely.
      if (s.parts === 1 && s.keys[0].includes('~'))
        fails.push(`${s.side}: single-piece side grew a part suffix (${s.keys[0]})`)
      for (const k of s.keys) {
        if (seen.has(k)) fails.push(`duplicate piece key ${k}`)
        seen.add(k)
      }
      if (s.parts > 1 && !s.keys.every((k, i) => k.endsWith(`~${i + 1}`)))
        fails.push(`${s.side}: part suffixes are not 1..n (${s.keys.join(',')})`)

      // Placement provenance: every transfer knows where it goes, and "where"
      // is inside the print area it claims to be relative to.
      for (const pl of s.placements) {
        if (!pl.insideArea)
          fails.push(`${s.side} part ${pl.part}: placement rect falls outside the print area`)
        if (!(pl.areaWCm > 0) || !(pl.areaHCm > 0))
          fails.push(`${s.side} part ${pl.part}: placement carries no print area to be relative to`)
        if (!Number.isFinite(pl.topCm) || !Number.isFinite(pl.centerDxCm))
          fails.push(`${s.side} part ${pl.part}: placement is not a number`)
      }
      if (s.parts > 1 && s.placements.some((p, i) => p.part !== i + 1))
        fails.push(`${s.side}: part indices are not in reading order`)
    }

    // Quantity semantics: an order line for N garments needs N copies of EVERY
    // transfer that line's side prints as, not N of the first and one of the
    // rest. The quantity belongs to the row, so it is assigned per row here.
    const rendered = await samplePieces(48)
    const rowQty = new Map()
    let ri = 0
    for (const p of rendered)
      if (!rowQty.has(p.row)) rowQty.set(p.row, [7, 5, 4, 3][ri++ % 4])
    const pieces = rendered.map((p) => ({
      id: p.key,
      sourceKey: p.key,
      wCm: p.wCm,
      hCm: p.hCm,
      qty: rowQty.get(p.row),
      allowRotate: true,
      ...(p.mask ? { mask: p.mask.mask, maskW: p.mask.maskW, maskH: p.mask.maskH } : {}),
    }))
    const geom = {
      printableWidthCm: 58,
      maxLengthCm: 90,
      gapCm: 0.5,
      edgeMarginCm: 0,
      edgeMarginSideCm: 0,
      edgeMarginEndCm: 0,
      billingStepCm: 10,
    }
    const r = shape({ pieces, options: { ...geom, maxInterlockCm: interlockMax, restarts: 4 } })
    const placed = new Map()
    for (const s of r.sheets)
      for (const pl of s.placements) placed.set(pl.sourceKey, (placed.get(pl.sourceKey) ?? 0) + 1)
    for (const p of pieces)
      if ((placed.get(p.sourceKey) ?? 0) !== p.qty)
        fails.push(
          `qty: ${p.sourceKey} placed ${placed.get(p.sourceKey) ?? 0} times, its line ordered ${p.qty}`,
        )

    return {
      fails,
      stats: {
        sides: probe.map((s) => ({
          side: s.side,
          parts: s.parts,
          boxCm2: `${s.boxSplitCm2} vs ${s.boxMergedCm2}`,
          inkDrift:
            s.inkMerged > 0
              ? Math.round((Math.abs(s.inkSplit - s.inkMerged) / s.inkMerged) * 1000) / 10
              : 0,
        })),
        transfers: pieces.length,
        copies: [...placed.values()].reduce((a, n) => a + n, 0),
      },
    }
  })

  console.log('split stats:', JSON.stringify(splitSuite.stats))
  if (splitSuite.fails.length) {
    console.error(`❌ ${splitSuite.fails.length} split assertion(s) failed:`)
    for (const f of splitSuite.fails.slice(0, 20)) console.error('  -', f)
    done(1)
  }

  // ------------------------------------------------------------------
  // Ink trim: same ink, tighter boxes, on artwork that HAS padding
  // ------------------------------------------------------------------
  // Measured against the padded-upload fixture, not the sample design: the
  // sample's text is measured from glyph ink and its graphics have tight
  // viewBoxes, so a trim recovers ~2 % of one piece there and every assertion
  // below would be vacuous. What the shop actually prints is customer uploads.
  const trimSuite = await page.evaluate(async () => {
    const { trimProbe, nest, paddedPieces } = window.__dtf
    const fails = []
    const probe = await trimProbe(48)

    if (!probe.some((s) => s.boxDeclaredCm2 > s.boxTrimmedCm2 * 1.5))
      fails.push('the padded fixture has nothing to trim: the trim suite is vacuous')

    for (const s of probe) {
      // THE SAFETY PROPERTY. Cropping to the ink may not remove ink. A tolerance
      // is needed because the two arms rasterise into differently sized canvases
      // and an anti-aliased edge lands on different pixels, but it is one-sided
      // in spirit: what must never happen is the trimmed arm losing artwork.
      const drift = s.inkDeclared > 0 ? (s.inkTrimmed - s.inkDeclared) / s.inkDeclared : 0
      if (drift < -0.01)
        fails.push(
          `${s.side}: trimming LOST ink, ${s.inkTrimmed} px vs ${s.inkDeclared} (${(drift * 100).toFixed(2)} %)`,
        )
      if (drift > 0.05)
        fails.push(
          `${s.side}: trimming gained ${(drift * 100).toFixed(1)} % ink, a crop is swallowing a neighbour`,
        )
      // …and it must actually save something, or it is complexity for nothing.
      if (s.boxTrimmedCm2 > s.boxDeclaredCm2 + 1e-6)
        fails.push(`${s.side}: trimmed boxes ${s.boxTrimmedCm2} cm² > declared ${s.boxDeclaredCm2} cm²`)
      // Every transfer still has to know where it goes, and "where" moves with
      // the crop: a box trimmed without moving its placement is pressed off by
      // exactly the margin that was discarded.
      for (const pl of s.placements) {
        if (!pl.insideArea)
          fails.push(`${s.side} part ${pl.part}: trimmed placement falls outside the print area`)
        if (!Number.isFinite(pl.topCm) || !Number.isFinite(pl.centerDxCm))
          fails.push(`${s.side} part ${pl.part}: trimmed placement is not a number`)
      }
      // No piece may be sub-millimetre: the packer's grid cannot represent one.
      for (const [w, h] of s.sizesTrimmed)
        if (!(w > 0.1) || !(h > 0.1))
          fails.push(`${s.side}: trimmed piece ${w} × ${h} cm is too small to nest`)
    }

    // And the whole point, through the real packer: less roll for the same order.
    const geom = {
      printableWidthCm: 58,
      maxLengthCm: 2500,
      gapCm: 0.5,
      edgeMarginCm: 0,
      edgeMarginSideCm: 0,
      edgeMarginEndCm: 0,
      billingStepCm: 10,
    }
    const QTY = { S: 2, M: 4, L: 3, XL: 1 }
    const roll = {}
    for (const arm of ['box', 'ink']) {
      const rows = await paddedPieces(48, { measureFrom: arm })
      const pieces = rows.map((r) => ({
        id: r.key,
        sourceKey: r.key,
        wCm: r.wCm,
        hCm: r.hCm,
        qty: QTY[r.row.slice(r.row.indexOf('#') + 1)] ?? 1,
        allowRotate: true,
      }))
      roll[arm] = nest(pieces, geom).totalLengthCm
    }
    if (!(roll.ink < roll.box))
      fails.push(`the trimmed order nests into ${roll.ink} cm, the untrimmed one into ${roll.box}`)

    return {
      fails,
      stats: {
        sides: probe.map((s) => ({
          side: s.side,
          parts: `${s.partsDeclared} → ${s.partsTrimmed}`,
          boxCm2: `${s.boxDeclaredCm2} → ${s.boxTrimmedCm2}`,
          inkDrift:
            s.inkDeclared > 0
              ? Math.round(((s.inkTrimmed - s.inkDeclared) / s.inkDeclared) * 1000) / 10
              : 0,
        })),
        rollCm: `${roll.box} → ${roll.ink}`,
      },
    }
  })

  console.log('trim stats:', JSON.stringify(trimSuite.stats))
  if (trimSuite.fails.length) {
    console.error(`❌ ${trimSuite.fails.length} trim assertion(s) failed:`)
    for (const f of trimSuite.fails.slice(0, 20)) console.error('  -', f)
    done(1)
  }

  // ------------------------------------------------------------------
  // True-shape packer suite
  // ------------------------------------------------------------------
  const shapeSuite = await page.evaluate(async () => {
    const { nest, shape, shapeAsync, samplePieces, collisionCheck, interlockMax } = window.__dtf
    const interlockStops = window.__dtf.interlockStops
    const fails = []
    const TOL = 1e-3

    // Real artwork through the real pipeline: rendered pieces + alpha masks.
    // Nothing synthetic: a mask bug that only bites the studio's own output
    // has to be able to fail here.
    const rendered = await samplePieces(64)
    if (rendered.length === 0) fails.push('samplePieces produced nothing to nest')
    // Quantity is a property of the ORDER LINE (design side × size), not of the
    // transfer: every visual a side splits into is needed once per garment.
    const rowQty = new Map()
    let ri = 0
    for (const p of rendered)
      if (!rowQty.has(p.row)) rowQty.set(p.row, [7, 5, 4, 3][ri++ % 4])
    const pieces = rendered.map((p) => ({
      id: p.key,
      sourceKey: p.key,
      wCm: p.wCm,
      hCm: p.hCm,
      qty: rowQty.get(p.row),
      allowRotate: true,
      ...(p.mask ? { mask: p.mask.mask, maskW: p.mask.maskW, maskH: p.mask.maskH } : {}),
    }))
    const totalQty = pieces.reduce((a, p) => a + p.qty, 0)

    // Researched defaults: 58 cm printable, 5 mm gap, zero edge margin. The
    // short max length keeps the verification archive encodable in seconds
    // while still exercising the multi-sheet split.
    const geom = {
      printableWidthCm: 58,
      maxLengthCm: 90,
      gapCm: 0.5,
      edgeMarginCm: 0,
      edgeMarginSideCm: 0,
      edgeMarginEndCm: 0,
      billingStepCm: 10,
    }
    const job = (maxInterlockCm, restarts = 8) => ({
      pieces,
      options: { ...geom, maxInterlockCm, restarts },
    })

    const bounds = (res, o, tag) => {
      const side = o.edgeMarginSideCm ?? o.edgeMarginCm
      const end = o.edgeMarginEndCm ?? o.edgeMarginCm
      let placed = 0
      for (let si = 0; si < res.sheets.length; si++) {
        const s = res.sheets[si]
        placed += s.placements.length
        for (const p of s.placements) {
          if (p.xCm < side - TOL) fails.push(`${tag}#${si}: ${p.id} past the left edge`)
          if (p.xCm + p.wCm > s.widthCm - side + TOL)
            fails.push(`${tag}#${si}: ${p.id} past the right edge`)
          if (p.yCm < end - TOL) fails.push(`${tag}#${si}: ${p.id} past the top edge`)
          // A piece may never straddle a billed-sheet boundary: everything on
          // sheet k must live inside that sheet's own extent.
          if (p.yCm + p.hCm > s.rawLengthCm - end + TOL)
            fails.push(`${tag}#${si}: ${p.id} past the sheet's raw extent`)
          if (p.yCm + p.hCm > s.lengthCm + TOL)
            fails.push(`${tag}#${si}: ${p.id} past the BILLED length (straddles the cut)`)
        }
        if (s.rawLengthCm > o.maxLengthCm + TOL)
          fails.push(`${tag}#${si}: raw ${s.rawLengthCm} > max ${o.maxLengthCm}`)
        if (s.lengthCm > o.maxLengthCm + TOL)
          fails.push(`${tag}#${si}: billed ${s.lengthCm} > max ${o.maxLengthCm}`)
        if (Math.abs(s.lengthCm / 10 - Math.round(s.lengthCm / 10)) > 1e-6)
          fails.push(`${tag}#${si}: billed ${s.lengthCm} is not a 10 cm step`)
        if (s.lengthCm + 1e-6 < s.rawLengthCm)
          fails.push(`${tag}#${si}: billed ${s.lengthCm} < raw ${s.rawLengthCm}`)
      }
      if (placed + res.unplaceable.length * 0 !== res.totalPieces)
        fails.push(`${tag}: totalPieces ${res.totalPieces} ≠ ${placed} placements`)
      if (placed !== totalQty)
        fails.push(`${tag}: placed ${placed} of ${totalQty} copies, pieces went missing`)
    }

    // --- determinism: three consecutive runs, byte for byte ---------------
    const a = shape(job(interlockMax))
    const b = shape(job(interlockMax))
    const c = shape(job(interlockMax))
    const sa = JSON.stringify(a)
    if (sa !== JSON.stringify(b) || sa !== JSON.stringify(c))
      fails.push('determinism: three identical runs disagreed')
    if (sa !== JSON.stringify(shape({ ...job(interlockMax), pieces: [...pieces].reverse() })))
      fails.push('determinism: input ORDER changed the layout')

    // --- determinism: Worker vs inline ------------------------------------
    const viaWorker = await shapeAsync(job(interlockMax))
    if (sa !== JSON.stringify(viaWorker))
      fails.push('determinism: the Worker and the inline run disagreed')

    // --- determinism WITH pieces that cannot be placed ---------------------
    // `unplaceable` reaches the manifest and the README. Gathered in input
    // order it made two exports of the same order differ purely because the
    // operator had reordered the queue, invisible to a suite where every
    // piece fits, which is why this case is spelled out.
    {
      const dud = [
        { id: 'zzz-wide', sourceKey: 'zzz-wide', wCm: 90, hCm: 9, qty: 2, allowRotate: false },
        { id: 'aaa-long', sourceKey: 'aaa-long', wCm: 9, hCm: 400, qty: 2, allowRotate: false },
        { id: 'mmm-zero', sourceKey: 'mmm-zero', wCm: 0, hCm: 0, qty: 2, allowRotate: true },
        ...pieces,
      ]
      const opt = { ...geom, maxInterlockCm: interlockMax, restarts: 6 }
      const fwd = shape({ pieces: dud, options: opt })
      const rev = shape({ pieces: [...dud].reverse(), options: opt })
      if (JSON.stringify(fwd) !== JSON.stringify(rev))
        fails.push('determinism: input ORDER changed the result once pieces are unplaceable')
      const un = fwd.unplaceable
      if ([...un].sort().join() !== un.join())
        fails.push(`unplaceable is not in a stable order: ${un.join(',')}`)
      if (un.length !== 3) fails.push(`expected 3 unplaceable ids, got ${un.join(',')}`)
      if (fwd.totalPieces !== totalQty)
        fails.push(`unplaceable run placed ${fwd.totalPieces} of ${totalQty} good copies`)
      // and the shelf packer must agree about the ordering, since either one
      // can be the winner the manifest ends up describing
      const sh = nest([...dud].reverse(), geom)
      if (sh.unplaceable.join() !== un.join())
        fails.push(`shelf unplaceable ${sh.unplaceable.join(',')} ≠ true-shape ${un.join(',')}`)
    }

    // --- a bigger interlock ceiling is NEVER worse -------------------------
    // Greedy BLF is not monotone in the dip allowance, so the packer sweeps
    // every rung at or below the ceiling. Without that sweep the slider's
    // "maximum fill" measurably bought MORE film than its 12 cm stop, which is
    // the single fastest way to lose an operator's trust in the feature.
    {
      let bestSoFar = Infinity
      const seq = []
      for (const stop of interlockStops) {
        const r = shape(job(stop, 8))
        seq.push(r.totalLengthCm)
        if (r.totalLengthCm > bestSoFar + TOL)
          fails.push(
            `interlock: ceiling ${stop} cm gave ${r.totalLengthCm} cm, worse than a lower stop's ${bestSoFar} cm`,
          )
        bestSoFar = Math.min(bestSoFar, r.totalLengthCm)
      }
      window.__dtfInterlockSeq = seq
    }

    // --- the printable width is usable to the last millimetre -------------
    // Every profile is dilated by half a gap on all four sides; the outer half
    // has no neighbour, so it must be swallowed by the sheet edge exactly as
    // the shelf packer does it. Three 19 cm pieces + two 5 mm gaps = 58 cm on
    // the nose: if the packer only fits two, it is silently renting out the
    // roll's last centimetre.
    {
      const w3 = [{ id: 'w3', sourceKey: 'w3', wCm: 19, hCm: 10, qty: 9, allowRotate: false }]
      const r = shape({ pieces: w3, options: { ...geom, maxInterlockCm: interlockMax, restarts: 8 } })
      const perRow = new Map()
      for (const s of r.sheets)
        for (const p of s.placements) {
          const k = Math.round(p.yCm * 100)
          perRow.set(k, (perRow.get(k) ?? 0) + 1)
        }
      const widest = Math.max(0, ...perRow.values())
      if (widest < 3)
        fails.push(`exact-width fit: only ${widest} of 3 pieces per 58 cm row`)
      // a piece exactly the printable width must not become unplaceable either
      const full = shape({
        pieces: [
          { id: 'full', sourceKey: 'full', wCm: 58, hCm: 12, qty: 2, allowRotate: false },
          ...pieces,
        ],
        options: { ...geom, maxInterlockCm: interlockMax, restarts: 4 },
      })
      if (full.unplaceable.length)
        fails.push(`full-width piece reported unplaceable: ${full.unplaceable.join(',')}`)
    }

    // --- never worse than the shelf packer --------------------------------
    const shelf = nest(pieces, geom)
    for (const [tag, r] of [
      ['strips', shape(job(0))],
      ['interlock2', shape(job(2))],
      ['maxfill', a],
    ]) {
      bounds(r, geom, tag)
      if (r.totalLengthCm > shelf.totalLengthCm + TOL)
        fails.push(`${tag}: ${r.totalLengthCm} cm is WORSE than the shelf packer's ${shelf.totalLengthCm}`)
      if (r.totalPieces !== shelf.totalPieces)
        fails.push(`${tag}: placed ${r.totalPieces}, shelf placed ${shelf.totalPieces}`)
    }

    // --- interlock 0 ⇒ bounding boxes stay gap-apart -----------------------
    // At zero interlock the packer drops to bbox profiles, so the cheap AABB
    // test is valid and it is exactly the "hand-cuttable" promise being made.
    const strips = shape(job(0))
    for (const s of strips.sheets)
      for (let i = 0; i < s.placements.length; i++)
        for (let j = i + 1; j < s.placements.length; j++) {
          const p = s.placements[i]
          const q = s.placements[j]
          if (
            p.xCm < q.xCm + q.wCm + geom.gapCm - TOL &&
            q.xCm < p.xCm + p.wCm + geom.gapCm - TOL &&
            p.yCm < q.yCm + q.hCm + geom.gapCm - TOL &&
            q.yCm < p.yCm + p.hCm + geom.gapCm - TOL
          )
            fails.push(`strips: ${p.id} and ${q.id} are closer than the gap`)
        }

    // --- ink-level clearance on the interlocked result --------------------
    // The only honest overlap test once pieces tuck into each other. Measured
    // on a raster, so the tolerance is two pixels of quantisation.
    const PX = 8
    const audits = []
    for (let i = 0; i < Math.min(2, a.sheets.length); i++) {
      const audit = await collisionCheck(a, i, PX, geom.gapCm + 0.3)
      audits.push({ sheet: i, ...audit, minClearanceCm: Math.round(audit.minClearanceCm * 100) / 100 })
      if (audit.missing > 0) fails.push(`collision#${i}: ${audit.missing} placements had no artwork`)
      if (audit.overlaps > 0)
        fails.push(`collision#${i}: ${audit.overlaps} ink cells owned by two pieces`)
      if (audit.minClearanceCm < geom.gapCm - 2 / PX)
        fails.push(
          `collision#${i}: closest ink ${audit.minClearanceCm.toFixed(3)} cm < gap ${geom.gapCm} cm`,
        )
    }

    // --- rotation permission is still obeyed ------------------------------
    const noRot = shape({
      pieces: pieces.map((p) => ({ ...p, allowRotate: false })),
      options: { ...geom, maxInterlockCm: interlockMax, restarts: 4 },
    })
    for (const s of noRot.sheets)
      for (const p of s.placements)
        if (p.rotated || (p.rotCw ?? 0) !== 0)
          fails.push(`rotation applied to an allowRotate:false piece (${p.id})`)

    // --- 180°/270° only when the artwork declares it has no "up" ----------
    for (const s of a.sheets)
      for (const p of s.placements)
        if ((p.rotCw ?? 0) === 180 || (p.rotCw ?? 0) === 270)
          fails.push(`flip emitted without allowFlip (${p.id} at ${p.rotCw}°)`)

    // --- flips appear ONLY when asked for, and still respect the geometry --
    const flipped = shape({
      pieces: pieces.map((p) => ({ ...p, allowFlip: true })),
      options: { ...geom, maxInterlockCm: interlockMax, restarts: 8 },
    })
    bounds(flipped, geom, 'flip')
    if (flipped.totalLengthCm > a.totalLengthCm + TOL)
      fails.push(`flip: ${flipped.totalLengthCm} cm is worse than without flips (${a.totalLengthCm})`)

    // --- FIXED billing drives the same packer through nestFixedWith -------
    // Different seam, different failure mode: the inner packer is scored on
    // how full the FIRST sheet comes out, and every piece must still land
    // inside the catalogue format that was actually bought.
    const fixedSupplier = window.__dtf.suppliers().find((s) => s.id === 'ohmydtf')
    let fixedStats = null
    if (fixedSupplier) {
      const fp = fixedSupplier.processes.find((p) => p.billing === 'fixed')
      const fx = shape({
        pieces,
        options: { ...geom, gapCm: 0.5, maxInterlockCm: interlockMax, restarts: 4 },
        supplier: fixedSupplier,
        process: fp,
      })
      if (fx.billing !== 'fixed') fails.push(`fixed: billing came back "${fx.billing}"`)
      for (const s of fx.sheets) {
        const f = fp.formats.find((x) => x.id === s.formatId)
        if (!f) {
          fails.push(`fixed: sheet ${s.index} has an unknown format "${s.formatId}"`)
          continue
        }
        if (Math.abs(s.widthCm - f.wCm) > TOL || Math.abs(s.lengthCm - f.hCm) > TOL)
          fails.push(`fixed: sheet ${s.index} is ${s.widthCm}×${s.lengthCm}, format is ${f.wCm}×${f.hCm}`)
        for (const p of s.placements)
          if (p.xCm + p.wCm > f.wCm + TOL || p.yCm + p.hCm > f.hCm + TOL)
            fails.push(`fixed: ${p.id} overflows format ${f.id}`)
      }
      if (fx.totalPieces !== totalQty)
        fails.push(`fixed: placed ${fx.totalPieces} of ${totalQty}`)
      // The bill must beat every "just buy one format over and over" plan.
      // Cheapest-€-per-piece-per-sheet is myopic and used to lose to exactly
      // those. This is the assertion that keeps the wrapper honest.
      const bill = (r) =>
        r.sheets.reduce(
          (a, s) => a + (fp.formats.find((f) => f.id === s.formatId)?.priceEur ?? 0),
          0,
        )
      const mixed = bill(fx)
      for (const f of fp.formats) {
        const solo = shape({
          pieces,
          options: { ...geom, gapCm: 0.5, maxInterlockCm: interlockMax, restarts: 4 },
          supplier: fixedSupplier,
          process: { ...fp, formats: [f] },
        })
        if (solo.totalPieces === totalQty && bill(solo) < mixed - 1e-6)
          fails.push(
            `fixed: buying only "${f.id}" costs ${bill(solo).toFixed(2)} €, the chosen mix costs ${mixed.toFixed(2)} €`,
          )
      }
      fixedStats = {
        sheets: fx.sheets.length,
        formats: fx.sheets.map((s) => s.formatId),
        eur: Math.round(mixed * 100) / 100,
      }
      if (JSON.stringify(fx) !== JSON.stringify(shape({
        pieces,
        options: { ...geom, gapCm: 0.5, maxInterlockCm: interlockMax, restarts: 4 },
        supplier: fixedSupplier,
        process: fp,
      })))
        fails.push('fixed: two identical runs disagreed')
    }

    return {
      fails,
      result: a,
      stats: {
        pieces: totalQty,
        interlockSeq: window.__dtfInterlockSeq,
        shelfCm: shelf.totalLengthCm,
        stripsCm: strips.totalLengthCm,
        maxfillCm: a.totalLengthCm,
        gainPct: Math.round(((shelf.totalLengthCm - a.totalLengthCm) / shelf.totalLengthCm) * 1000) / 10,
        flipCm: flipped.totalLengthCm,
        inkUtil: a.totalInkUtilization ?? null,
        sheets: a.sheets.length,
        fixed: fixedStats,
        audits,
      },
    }
  })

  console.log('trueshape stats:', JSON.stringify(shapeSuite.stats))
  if (shapeSuite.fails.length) {
    console.error(`❌ ${shapeSuite.fails.length} true-shape assertion(s) failed:`)
    for (const f of shapeSuite.fails.slice(0, 20)) console.error('  -', f)
    done(1)
  }

  // ------------------------------------------------------------------
  // ZIP export suite: the archive is opened here, in Node
  // ------------------------------------------------------------------
  const zipInfo = await page.evaluate(
    (result) => window.__dtf.sampleOrderZip(result, 200),
    shapeSuite.result,
  )
  // An export whose artwork is missing must FAIL LOUDLY. renderSheet skips a
  // placement it has no pixels for, right for a live preview, catastrophic
  // for an export, because the archive still looks complete (right sheet
  // count, plausible manifest) while one transfer is simply not on the film.
  const partial = await page.evaluate(
    (result) => window.__dtf.sampleOrderZip(result, 120, { dropFirstSource: true }),
    shapeSuite.result,
  )
  if (!partial.refused) {
    console.error('❌ the ZIP export shipped an archive with missing artwork instead of refusing')
    done(1)
  }
  console.log(`zip refusal on missing artwork: ${partial.message}`)

  // The cutting-plan legend must describe the lines that are actually drawn.
  // Only the SHELF packer draws full-width corridors plus vertical trims; the
  // true-shape packer at interlock 0 draws neither, so promising "puis les
  // verticales" there sends someone cutting lines that do not exist.
  const legends = await page.evaluate(() => window.__dtf.legendProbe())
  for (const l of legends)
    if (l.promisesVerticals !== l.drawsVerticals) {
      console.error(
        `❌ cutting-plan legend mismatch (${l.tag}): legend "${l.legend}" but shelf rows = ${l.drawsVerticals}`,
      )
      done(1)
    }
  console.log('plan legends:', legends.map((l) => `${l.tag}=${l.drawsVerticals ? 'shelf' : 'free'}`).join(' '))

  // ------------------------------------------------------------------
  // SUITE 6, POOLING: several orders on one film
  // ------------------------------------------------------------------
  //
  // Three things, and each has a euro or a garment behind it.
  //
  //   DETERMINISM SURVIVES POOLING. A run is assembled from whatever arrived in
  //   whatever order it arrived, which is precisely how the "same job, same
  //   film" guarantee dies. Reversing the orders AND reversing each order's
  //   pieces must produce a byte-identical layout.
  //
  //   NOTHING IS LOST BETWEEN THE ARMS. Every copy nested in the pool is nested
  //   in exactly one order's solo pass, and every transfer maps back to exactly
  //   one order. A run that dropped an order's transfer would print, cost and
  //   invoice perfectly, and one customer would simply never be made.
  //
  //   AND THE ARCHIVE CARRIES THE WORKSHOP'S PAPERWORK. Opened here, in Node,
  //   with the same hand-rolled reader: one press sheet per order, the picking
  //   list, the split of the film bill, and a manifest naming each order's proof
  //   VERSION and design id, which is the chain a dispute is settled on.
  /*
   * R2 STORES ONE RASTER PER ASSET AND IT ANSWERS TO TWO NAMES.
   *
   * `assetVariants` in the upload sends the CUTOUT bytes under the plain asset
   * id when the layer that references them has background removal on, so there
   * is no second blob and nothing in the bytes says which variant they are.
   * Adopted under `original` alone, every such layer looked up `cutout`, missed,
   * fell through to IndexedDB, missed again and threw, `ensureInkProbes` reported
   * the layer as unmeasurable and `renderPieces` refused the whole side. Every
   * paid order whose customer removed a background was unrenderable in the
   * production queue.
   */
  const adopt = await page.evaluate(() => window.__dtf.adoptProbe())
  if (!adopt.original || !adopt.cutout) {
    console.error(
      `ECHEC: an adopted raster is not found under both variant names (original=${adopt.original}, cutout=${adopt.cutout}): ` +
        'an order whose artwork had its background removed cannot be re-rendered',
    )
    done(1)
  }
  if (!adopt.released) {
    console.error('ECHEC: releasing an adopted raster left it in the cache; the tab keeps customers’ artwork')
    done(1)
  }

  const WEEK = [
    { id: '1041', design: 'sample', sizes: { M: 6, L: 4 } },
    { id: '1042', design: 'padded', sizes: { S: 3, M: 3 } },
    { id: '1043', design: 'sample', sizes: { L: 5 } },
  ]
  const pooled = await page.evaluate((week) => window.__dtf.runOrderZip(120, week), WEEK)
  const reversed = await page.evaluate(
    (week) => window.__dtf.runOrderZip(120, week),
    [...WEEK].reverse(),
  )
  if (pooled.pooledCm !== reversed.pooledCm) {
    console.error(
      `ECHEC: pooling is order-dependent: ${pooled.pooledCm} cm forwards, ${reversed.pooledCm} cm reversed`,
    )
    done(1)
  }
  if (JSON.stringify(pooled.owners) !== JSON.stringify(reversed.owners)) {
    console.error('ECHEC: the transfer-to-order map depends on the order the run was assembled in')
    done(1)
  }
  const owned = Object.keys(pooled.owners).length
  if (owned === 0) {
    console.error('ECHEC: the pooled run mapped no transfer back to an order')
    done(1)
  }
  for (const [key, orderId] of Object.entries(pooled.owners))
    if (!key.startsWith(`${orderId}/`)) {
      console.error(`ECHEC: transfer ${key} is owned by ${orderId}, which its own key contradicts`)
      done(1)
    }

  const runZip = readZip(Buffer.from(pooled.base64, 'base64'))
  const runFails = []
  const names = [...runZip.keys()]
  const folder = names[0]?.split('/')[0] ?? ''
  for (const order of WEEK) {
    const sheet = `${folder}/commandes/#${order.id}/fiche-de-pose.txt`
    const entry = runZip.get(sheet)
    if (!entry) {
      runFails.push(`no press sheet for order ${order.id} (${sheet})`)
      continue
    }
    const text = entry.data.toString('utf8')
    if (!text.includes('Version')) runFails.push(`press sheet ${order.id} states no proof version`)
    if (!text.includes(`design-${order.id}`))
      runFails.push(`press sheet ${order.id} names no design id`)
    // The heading is uppercased by the writer; what matters is that the sheet is
    // not the EMPTY state, which is what an order whose transfers went missing
    // from the film would produce, silently and legibly.
    if (!text.includes('TRANSFERTS À POSER') || text.includes('Aucun transfert'))
      runFails.push(`press sheet ${order.id} lists no transfers`)
    if (!text.includes('Planche')) runFails.push(`press sheet ${order.id} names no sheet`)
  }
  // The FIRST order's proof was waived rather than approved, and the sheet has
  // to say which: both authorise production and they are not the same fact.
  const waived = runZip.get(`${folder}/commandes/#${WEEK[0].id}/fiche-de-pose.txt`)
  if (waived && !waived.data.toString('utf8').includes('renonciation'))
    runFails.push('a waived proof is printed as an approval on the press sheet')
  const approved = runZip.get(`${folder}/commandes/#${WEEK[1].id}/fiche-de-pose.txt`)
  if (approved && !approved.data.toString('utf8').includes('le client'))
    runFails.push('a customer approval is not named on the press sheet')

  for (const doc of ['liste-de-prelevement.txt', 'repartition-du-film.txt'])
    if (!runZip.has(`${folder}/${doc}`)) runFails.push(`the run archive has no ${doc}`)

  const runManifestEntry = runZip.get(`${folder}/manifeste.json`)
  if (!runManifestEntry) runFails.push('the run archive has no manifest')
  else {
    const m = JSON.parse(runManifestEntry.data.toString('utf8'))
    if (!m.run) runFails.push('the manifest of a pooled run carries no run block')
    else {
      if (m.run.orders.length !== WEEK.length)
        runFails.push(`manifest run block names ${m.run.orders.length} orders, expected ${WEEK.length}`)
      for (const o of m.run.orders) {
        if (!(o.batVersion > 0)) runFails.push(`order ${o.ref} has no proof version in the manifest`)
        if (!o.designIds.length) runFails.push(`order ${o.ref} has no design id in the manifest`)
        if (!o.keys.length) runFails.push(`order ${o.ref} claims no transfer on the film`)
      }
    }
  }
  if (runFails.length) {
    console.error(`ECHEC: ${runFails.length} pooled-run assertion(s) failed:`)
    for (const f of runFails.slice(0, 20)) console.error('  -', f)
    done(1)
  }
  console.log(
    `pooling: ${WEEK.length} orders, ${owned} transfers, adopted rasters answer to both ` +
      `variant names and are released, ${pooled.soloCm} cm apart -> ` +
      `${pooled.pooledCm} cm together, archive carries ${WEEK.length} press sheets, ` +
      `the picking list and the film split`,
  )

  const zipFails = checkZip(
    Buffer.from(zipInfo.base64, 'base64'),
    shapeSuite.result,
    zipInfo,
  )
  if (zipFails.length) {
    console.error(`❌ ${zipFails.length} zip assertion(s) failed:`)
    for (const f of zipFails.slice(0, 20)) console.error('  -', f)
    done(1)
  }
  console.log(
    `zip: ${zipInfo.fileName}, ${(Buffer.from(zipInfo.base64, 'base64').length / 1024).toFixed(0)} KiB, ` +
      `${shapeSuite.result.sheets.length} sheet(s), every PNG at the exact implied pixel size`,
  )

  // ------------------------------------------------------------------
  // Modal rounds (the packer runs off-thread here, so wait for it to settle)
  // ------------------------------------------------------------------
  const settled = () =>
    page.waitForFunction(
      () => window.__dtf.previewReady() && !document.querySelector('[data-dtf="nest-busy"]'),
      { timeout: 60000 },
    )

  // The suites above drove `shapeAsync`, and the nesting client is a singleton
  // that TERMINATES a superseded job, so they stole the modal's worker. Change
  // a real nesting input to make it ask again, which is also the only way these
  // screenshots show an optimised layout rather than the shelf fallback.
  await page.selectOption('select[data-dtf="restarts"]', '6')
  await settled()
  await page.waitForTimeout(400)
  if (OUT) {
    mkdirSync(OUT, { recursive: true })
    await page.screenshot({ path: `${OUT}/dtf-modal-1.png` })
  }

  // Round 2: express supplier + guides off. Preview must re-nest live.
  await page.selectOption('select[data-dtf="supplier-select"]', 'royaldtf')
  await page.click('input[data-dtf="guides-toggle"]')
  await settled()
  await page.waitForTimeout(400)
  const round2 = await page.evaluate(() => ({
    sheets: document.querySelectorAll('canvas[data-dtf="sheet-canvas"]').length,
    stats: document.querySelector('[data-dtf="stats"]')?.textContent ?? '',
  }))
  if (round2.sheets < 1) {
    console.error('❌ no preview sheets after supplier switch')
    done(1)
  }
  if (OUT) await page.screenshot({ path: `${OUT}/dtf-modal-2.png` })

  // Round 3: the max-fill end of the slider + flips on, with the ZIP naming
  // prompt open. Everything the operator touches to get the smallest bill.
  await page.click('input[data-dtf="guides-toggle"]')
  // Keyboard, not `el.value = …`: React tracks the DOM value itself and treats
  // a direct write as "unchanged", so the slider would silently not move and
  // the round would screenshot the default instead of the max-fill end.
  await page.focus('input[data-dtf="interlock"]')
  await page.keyboard.press('End')
  await page.check('input[data-dtf="allow-flip"]')
  const stop = await page.$eval('input[data-dtf="interlock"]', (el) => ({
    v: el.value,
    max: el.max,
  }))
  if (stop.v !== stop.max) {
    console.error(`❌ interlock slider stuck at ${stop.v}/${stop.max}`)
    done(1)
  }
  await settled()
  await page.click('[data-dtf="export-zip"]')
  await page.waitForSelector('input[data-dtf="zip-name"]', { timeout: 5000 })
  await page.waitForTimeout(300)
  if (OUT) await page.screenshot({ path: `${OUT}/dtf-modal-3.png` })

  // Round 4: FIXED-format supplier, a different billing model, a different
  // cutting plan, and the branch where the packer is scored per sheet bought.
  await page.click('[data-dtf="zip-cancel"]')
  await page.selectOption('select[data-dtf="supplier-select"]', 'ohmydtf')
  // The cost panel must never quote catalogue billing against roll sheets, so
  // the per-format lines are the signal that the fixed result is really on
  // screen. Waiting on the spinner alone would sample the transition.
  await page.waitForSelector('[data-dtf="format-lines"]', { timeout: 60000 })
  await settled()
  await page.waitForTimeout(400)
  const round4 = await page.evaluate(() => ({
    sheets: document.querySelectorAll('canvas[data-dtf="sheet-canvas"]').length,
    formats: document.querySelector('[data-dtf="format-lines"]')?.textContent ?? '',
  }))
  if (round4.sheets < 1) {
    console.error('❌ no preview sheets on the fixed-format supplier')
    done(1)
  }
  if (!round4.formats) {
    console.error('❌ fixed-format supplier showed no per-format cost lines')
    done(1)
  }
  console.log('fixed-format mix:', round4.formats.trim())
  if (OUT) await page.screenshot({ path: `${OUT}/dtf-modal-4.png` })

  // Round 5: advanced supplier profile + saved-designs picker open.
  await page.click('[data-dtf="advanced-toggle"]')
  await page.click('[data-dtf="add-saved"]')
  await page.waitForTimeout(400)
  if (OUT) await page.screenshot({ path: `${OUT}/dtf-modal-5.png` })

  if (errors.length) {
    console.error('❌ page errors:', errors.slice(0, 5).join(' | '))
    done(1)
  }

  console.log(
    `✅ dtf verify PASS: sheets=${suite.stats.sheets} totalLm=${suite.stats.totalLm} utilization=${suite.stats.utilization}` +
      (OUT ? ` (screenshots in ${OUT})` : ''),
  )
  code = 0
} catch (e) {
  console.error('❌', e?.message || e)
}
done(code)
