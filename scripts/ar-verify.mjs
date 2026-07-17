/**
 * Headless verification for the AR EXPORT pipeline (the risky leg).
 *
 * Boots Vite dev, seeds a design, runs the SAME buildArModel() the AR modal uses,
 * and for tee / hoodie / custom asserts the exported GLB is not just well-formed
 * but SCENE-VIEWER-SAFE. Each of these invariants maps to a real "Couldn't load
 * this object" failure mode we hit and fixed (see src/lib/arExport.ts):
 *
 *   - Khronos glTF-Validator: 0 errors
 *   - decals are low-poly INDEXED planes, never DecalGeometry (non-indexed, huge)
 *   - 0 materials with alphaMode BLEND (we use MASK → exempt from the 2-alpha cap)
 *   - every texture is power-of-two and ≤ 2048²
 *   - inches→metres scale applied (a 0.0254 root node; figure not ~40× oversize)
 *   - total GLB < 15 MB (Scene Viewer hard ceiling)
 *   - USDZ is a zip, poster is a PNG
 *
 *   node scripts/ar-verify.mjs
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
import { validateBytes } from 'gltf-validator'

const PORT = 5198
const BASE = `http://localhost:${PORT}`

const waitFor = (url, ms = 30000) =>
  new Promise((res, rej) => {
    const s = Date.now()
    const t = async () => {
      try { if ((await fetch(url)).ok) return res() } catch {}
      if (Date.now() - s > ms) return rej(new Error('dev server timeout'))
      setTimeout(t, 400)
    }
    t()
  })

// ---- minimal GLB parse ----------------------------------------------------
function parseGlb(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB')
  let off = 12, json = null, bin = null
  while (off < buf.byteLength) {
    const len = dv.getUint32(off, true)
    const type = dv.getUint32(off + 4, true)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(data))
    else if (type === 0x004e4942) bin = data
    off += 8 + len
  }
  return { json, bin }
}
const isPow2 = (n) => n > 0 && (n & (n - 1)) === 0
function imageSize(bin, bv, mime) {
  const d = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength)
  if (mime === 'image/png' || (d[0] === 0x89 && d[1] === 0x50)) {
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength)
    return { w: dv.getUint32(16), h: dv.getUint32(20) } // PNG IHDR
  }
  // JPEG: scan for a Start-Of-Frame marker
  for (let p = 2; p < d.length; ) {
    if (d[p] !== 0xff) { p++; continue }
    const m = d[p + 1]
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: (d[p + 5] << 8) | d[p + 6], w: (d[p + 7] << 8) | d[p + 8] }
    }
    p += 2 + ((d[p + 2] << 8) | d[p + 3])
  }
  return { w: 0, h: 0 }
}

async function validate(buf, name) {
  const r = await validateBytes(new Uint8Array(buf), {
    uri: name,
    externalResourceFunction: () => Promise.reject(new Error('no external')),
  })
  return r.issues
}

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: process.cwd(), stdio: 'ignore' })
let browser
const done = (code) => {
  try { browser?.close() } catch {}
  try { server.kill('SIGTERM') } catch {}
  process.exit(code)
}
const fail = (msg) => { console.error('❌ ' + msg); done(1) }

try {
  await waitFor(BASE)
  browser = await chromium.launch({
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox'],
  })
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push('[console] ' + m.text()))

  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForFunction(() => !!window.__tshop && !!window.__arExport, { timeout: 20000 })

  // Seed a multi-layer design across front, back AND sleeve (exercises every
  // decal path — the sleeve is what pushed the old exporter over the 2-alpha cap).
  await page.evaluate(() => {
    const s = window.__tshop.getState()
    s.setGarment('tee')
    const st = window.__tshop.getState()
    st.addTextLayer('AR CHECK')
    st.addGraphicLayer?.('star')
    st.setSide?.('back')
    window.__tshop.getState().addTextLayer('BACK')
    st.setSide?.('sleeve')
    window.__tshop.getState().addTextLayer('SLV')
    st.setSide?.('front')
  })
  await page.waitForTimeout(300)

  // Seed a REAL ship-your-own garment (alpha-silhouette photo + matching cutout)
  // so the custom case exercises buildCustomFigure (the inflated shell of the
  // customer's ACTUAL garment) — not the mannequin fallback it hit before.
  const customAssetId = await page.evaluate(async () => {
    const assets = await window.__assets()
    const W = 600, H = 760
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#3a6ad0'
    const bx = 120, by = 150, bw = 360, bh = 520, r = 60 // rounded garment body
    ctx.beginPath()
    ctx.moveTo(bx + r, by)
    ctx.arcTo(bx + bw, by, bx + bw, by + bh, r)
    ctx.arcTo(bx + bw, by + bh, bx, by + bh, r)
    ctx.arcTo(bx, by + bh, bx, by, r)
    ctx.arcTo(bx, by, bx + bw, by, r)
    ctx.closePath(); ctx.fill()
    ctx.fillRect(50, 160, 85, 200)    // left sleeve
    ctx.fillRect(465, 160, 85, 200)   // right sleeve
    ctx.globalCompositeOperation = 'destination-out'
    ctx.beginPath(); ctx.ellipse(W / 2, 158, 68, 44, 0, 0, Math.PI * 2); ctx.fill() // neck hole
    ctx.globalCompositeOperation = 'source-over'
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'))
    const meta = await assets.addAsset(blob, 'AR test garment')
    await assets.setAssetCutout(meta.id, blob) // same alpha image as the cutout
    return meta.id
  })

  // Catalog forces garmentId directly; custom attaches the seeded garment.
  const bake = async (garmentId, gender) =>
    page.evaluate(async ({ gid, g, customId }) => {
      const ax = await window.__arExport()
      const base = window.__tshop.getState().design
      const design =
        gid === 'custom'
          ? {
              ...base,
              garmentId: 'custom',
              custom: {
                widthIn: 20,
                // Two-sided so the custom-avatar BACK conformed decal (reversed
                // winding) is exercised, not just the front.
                front: { assetId: customId, useCutout: true, printArea: { xIn: 4, yIn: 5, wIn: 12, hIn: 14 } },
                back: { assetId: customId, useCutout: true, printArea: { xIn: 4, yIn: 5, wIn: 12, hIn: 14 } },
              },
            }
          : { ...base, garmentId: gid }
      const blobs = await ax.buildArModel(design, g)
      const b64 = async (blob) => {
        const u8 = new Uint8Array(await blob.arrayBuffer())
        let s = ''
        for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000))
        return btoa(s)
      }
      return {
        glb: await b64(blobs.glb),
        glbSize: blobs.glb.size,
        usdzSize: blobs.usdz.size,
        posterSize: blobs.poster.size,
        usdzMagic: Array.from(new Uint8Array(await blobs.usdz.slice(0, 2).arrayBuffer())),
        pngMagic: Array.from(new Uint8Array(await blobs.poster.slice(0, 4).arrayBuffer())),
      }
    }, { gid: garmentId, g: gender, customId: customAssetId })

  // Male + female avatars for both catalog garments, plus the real custom shell.
  const cases = [
    ['tee', 'male'], ['tee', 'female'], ['hoodie', 'male'], ['hoodie', 'female'], ['custom', 'male'],
  ]
  for (const [gid, gender] of cases) {
    const r = await bake(gid, gender)
    if (errors.length) fail(`${gid}/${gender} page errors: ` + errors.slice(0, 4).join(' | '))
    const buf = Buffer.from(r.glb, 'base64')
    const { json, bin } = parseGlb(buf)

    // 1) formats
    if (r.usdzMagic[0] !== 0x50 || r.usdzMagic[1] !== 0x4b) fail(`${gid}: USDZ not a zip`)
    if (r.pngMagic[0] !== 137 || r.pngMagic[1] !== 80) fail(`${gid}: poster not a PNG`)
    if (r.posterSize < 1000) fail(`${gid}: poster too small`)

    // 2) Khronos validator — 0 errors
    const iss = await validate(buf, `${gid}.glb`)
    if (iss.numErrors > 0) fail(`${gid}: glTF-Validator ${iss.numErrors} errors — ${iss.messages.filter((m) => m.severity === 0).slice(0, 3).map((m) => m.code).join(', ')}`)

    // 3) size ceiling
    if (buf.byteLength >= 15 * 1024 * 1024) fail(`${gid}: GLB ${(buf.byteLength / 1e6).toFixed(1)}MB ≥ 15MB Scene Viewer cap`)

    // 4) NO DecalGeometry — it emits NON-INDEXED projected primitives, which is
    //    the reject risk. Every primitive (avatar body, garment, plane decals)
    //    must be indexed. 0 BLEND materials (we use MASK, exempt from the 2-alpha cap).
    let blendCount = 0
    ;(json.materials || []).forEach((m) => { if (m.alphaMode === 'BLEND') blendCount++ })
    if (blendCount > 0) fail(`${gid}: ${blendCount} BLEND material(s) — must be 0 (MASK), the 2-alpha cap is what rejected catalog`)
    json.meshes.forEach((mesh, mi) =>
      mesh.primitives.forEach((p) => {
        if (p.indices == null) fail(`${gid}: mesh${mi} is NON-INDEXED (DecalGeometry-style) — Scene Viewer reject risk`)
      }),
    )

    // 5) textures power-of-two and ≤ 2048
    ;(json.images || []).forEach((im, i) => {
      const { w, h } = imageSize(bin, json.bufferViews[im.bufferView], im.mimeType)
      if (!isPow2(w) || !isPow2(h)) fail(`${gid}: image${i} ${w}x${h} (${im.mimeType}) not power-of-two`)
      if (w > 2048 || h > 2048) fail(`${gid}: image${i} ${w}x${h} exceeds 2048`)
    })

    // 6) inches→metres scale applied: a ~0.0254 scaled node exists, and the whole
    //    figure is life-size-ish (< 2.2 m tall), never the ~40× (27 m) bug.
    //    (GLTFExporter defaults trs:false, so the scale rides in node.matrix.)
    const nodeScale = (n) => (n.scale ? n.scale[0] : n.matrix ? Math.hypot(n.matrix[0], n.matrix[1], n.matrix[2]) : 1)
    const hasScaleNode = (json.nodes || []).some((n) => Math.abs(nodeScale(n) - 0.0254) < 1e-4)
    if (!hasScaleNode) fail(`${gid}: no 0.0254 inches→metres scale node (scales: ${(json.nodes || []).map((n) => nodeScale(n).toFixed(4)).join(',')})`)
    let minY = Infinity, maxY = -Infinity
    json.meshes.forEach((mesh) =>
      mesh.primitives.forEach((p) => {
        const acc = json.accessors[p.attributes.POSITION]
        if (acc.min && acc.max) { minY = Math.min(minY, acc.min[1]); maxY = Math.max(maxY, acc.max[1]) }
      }),
    )
    const heightM = (maxY - minY) * 0.0254
    if (heightM > 2.2) fail(`${gid}: figure ${heightM.toFixed(2)}m tall — inches-as-metres scale bug`)

    console.log(
      `✅ ${gid}/${gender} — glb=${(buf.byteLength / 1024).toFixed(0)}KB usdz=${(r.usdzSize / 1024).toFixed(0)}KB ` +
      `val:${iss.numErrors}E/${iss.numWarnings}W blend:${blendCount} h≈${heightM.toFixed(2)}m`,
    )
  }

  console.log('✅ AR verify PASS — GLB/USDZ/poster valid + Scene-Viewer-safe (no DecalGeometry, 0 BLEND, POT, metres) for tee/hoodie/custom')
  done(0)
} catch (e) {
  fail(e?.message || String(e))
}
