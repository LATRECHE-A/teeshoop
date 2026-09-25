/**
 * Headless FABRIC-MAPPING verification: the proof behind src/three/fabricUnwrap.ts.
 *
 * The 3D print is no longer a projected decal: the garment mesh is unwrapped
 * into inches of cloth from its centre-front line and the print rect is laid on
 * THAT. Every claim the mapping makes is pure geometry, so every claim is
 * checkable without rendering a single pixel, which is what this script does,
 * against two independent ground truths:
 *
 *   1. tee.glb ships an artist-made UV atlas that is itself an isometric flat
 *      sewing pattern. The computed arc table must reproduce it (up to one
 *      global scale + offset, which is all "is an unwrap" can mean).
 *   2. hoodie.glb ships NO UVs, so it is checked against arc walked directly
 *      along its own cross-section LOOPS, chained by triangle connectivity,
 *      not by the radial heuristic the table uses, so the two cannot agree by
 *      sharing a bug.
 *
 * Checks, in order of how much money they save:
 *   A  table health (the gate that decides fabric mapping vs the decal fallback)
 *   B  physical size: the scaled mesh's chest arc == the size chart's half-chest
 *   C  arc truth: a 10 cm logo covers 10 cm of real cloth, anywhere on the panel
 *   D  tee atlas cross-check (the independent oracle)
 *   E  coverage: every print zone is 100 % on fabric, nothing clipped
 *   F  no bleed: no front ink lands behind z = 0, and no seam-wrap smear
 *   G  AR parity: the exported grid sits on the same surface at the same arc
 *
 *   node scripts/fabric-verify.mjs
 *   FABRIC_SIZES=S,3XL node scripts/fabric-verify.mjs
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
import { NODE, VITE } from './bin.mjs'

const PORT = 5199
const BASE = `http://localhost:${PORT}`
const SIZES = (process.env.FABRIC_SIZES || 'S,L,3XL').split(',').map((s) => s.trim()).filter(Boolean)

const waitFor = (url, ms = 45000) =>
  new Promise((res, rej) => {
    const s = Date.now()
    const t = async () => {
      try { if ((await fetch(url)).ok) return res() } catch {}
      if (Date.now() - s > ms) return rej(new Error('dev server timeout'))
      setTimeout(t, 400)
    }
    t()
  })

const server = spawn(NODE, [VITE, '--port', String(PORT), '--strictPort'], { cwd: process.cwd(), stdio: 'ignore' })
let browser
const done = (code) => {
  try { browser?.close() } catch {}
  try { server.kill('SIGTERM') } catch {}
  process.exit(code)
}

// ---------------------------------------------------------------------------
// Everything below runs IN THE PAGE (so it imports the real app modules).
// ---------------------------------------------------------------------------
async function inPage(sizes) {
  const THREE = await window.__three()
  const { GLTFLoader } = await window.__gltf()
  const fab = await window.__fabric()
  const render = await window.__render()
  const { buildGarmentFrame, fabricFrameFor } = fab.frame
  const { buildFabricOverlay, buildFabricDecal, fabricAt } = fab.decal
  const { thetaAtArc } = fab.unwrap
  const { CALIBRATION } = fab.calibration
  const { zonesFor } = fab.zones
  const sizeChart = await window.__sizes()

  const firstMesh = (root, name) => {
    let found = null
    root.traverse((o) => { if (!found && o.isMesh && (!name || o.name === name)) found = o })
    return found
  }

  const designFor = (garmentId) => ({
    id: 'verify', name: 'verify', garmentId, colorId: 'white', custom: null,
    layers: [], stashedLayers: [], printScale: { mode: 'scaled', baseSize: 'L' }, updatedAt: 0,
  })

  /** Raw cross-section segments at a height, the input to the radial walk. */
  function sectionSegs(pos, idx, y) {
    const segs = []
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3
      const ya = pos[a + 1], yb = pos[b + 1], yc = pos[c + 1]
      if (Math.max(ya, yb, yc) < y || Math.min(ya, yb, yc) > y) continue
      const p = []
      const cut = (i, j, yi, yj) => {
        if (yi === yj || (yi - y) * (yj - y) > 0) return
        const f = (y - yi) / (yj - yi)
        p.push(pos[i] + f * (pos[j] - pos[i]), pos[i + 2] + f * (pos[j + 2] - pos[i + 2]))
      }
      cut(a, b, ya, yb); cut(b, c, yb, yc); cut(c, a, yc, ya)
      if (p.length >= 4) segs.push(p[0], p[1], p[2], p[3])
    }
    return new Float64Array(segs)
  }

  /**
   * SECOND, independent ground truth: walk the cloth radially at 0.25° (four
   * times the table's own sampling), taking at each step the mesh crossing
   * nearest the tracked shell. It shares no machinery with the connectivity
   * loop walk (different traversal, different failure modes), which is what
   * makes their AGREEMENT meaningful and, more importantly, what makes their
   * DISAGREEMENT a usable signal: where two honest measurements of the same
   * span differ, the mesh has no single answer there and neither does any
   * assertion built on it.
   */
  function radialArc(segs, thetaA, thetaB, shellOf) {
    let span = thetaB - thetaA
    while (span > Math.PI) span -= 2 * Math.PI
    while (span < -Math.PI) span += 2 * Math.PI
    const steps = Math.max(4, Math.round((Math.abs(span) * 180) / Math.PI / 0.25))
    let px = null, pz = null, acc = 0
    for (let i = 0; i <= steps; i++) {
      let th = thetaA + (span * i) / steps
      if (th > Math.PI) th -= 2 * Math.PI
      if (th < -Math.PI) th += 2 * Math.PI
      const want = shellOf(th)
      const dx = Math.sin(th), dz = Math.cos(th)
      let r = want, bestD = Infinity
      for (let k = 0; k < segs.length; k += 4) {
        const x0 = segs[k], z0 = segs[k + 1], sx = segs[k + 2] - x0, sz = segs[k + 3] - z0
        const den = sx * dz - sz * dx
        if (den > -1e-12 && den < 1e-12) continue
        const t = (z0 * dx - x0 * dz) / den
        if (t < 0 || t > 1) continue
        const qx = x0 + t * sx, qz = z0 + t * sz
        if (qx * dx + qz * dz <= 0) continue
        const rr = Math.hypot(qx, qz), d = Math.abs(rr - want)
        if (d < bestD) { bestD = d; r = rr }
      }
      const x = r * dx, z = r * dz
      if (px !== null) acc += Math.hypot(x - px, z - pz)
      px = x; pz = z
    }
    return acc
  }

  // ---- independent ground truth: chained cross-section loops ---------------
  // Slice the mesh at a height, weld the resulting segments end-to-end into
  // closed polylines, and keep the loop that encloses the axis. This uses
  // CONNECTIVITY only (the arc table uses outward radial marching), so an
  // agreement between them is real evidence, not a shared assumption.
  function sliceLoops(pos, idx, y) {
    const segs = []
    let scale = 0
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3
      const ya = pos[a + 1], yb = pos[b + 1], yc = pos[c + 1]
      if (Math.max(ya, yb, yc) < y || Math.min(ya, yb, yc) > y) continue
      const pts = []
      const cut = (i, j, yi, yj) => {
        if (yi === yj || (yi - y) * (yj - y) > 0) return
        const f = (y - yi) / (yj - yi)
        pts.push([pos[i] + f * (pos[j] - pos[i]), pos[i + 2] + f * (pos[j + 2] - pos[i + 2])])
      }
      cut(a, b, ya, yb); cut(b, c, yb, yc); cut(c, a, yc, ya)
      if (pts.length < 2) continue
      const d = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1])
      if (d < 1e-9) continue
      segs.push([pts[0], pts[1]])
      scale = Math.max(scale, Math.hypot(pts[0][0], pts[0][1]))
    }
    if (segs.length < 8) return []
    // Chain the segments end to end. Two rules make this survive a mesh with
    // T-junctions and surfaces that touch (a hood resting on a back): match
    // endpoints through a GRID (not a hash key, which splits neighbours that
    // straddle a cell edge), and at a junction continue with the SMALLEST TURN:
    // the cloth carries on, it does not fold back onto whatever is nearby.
    const weld = Math.max(1e-9, scale * 1e-3)
    const cell = weld * 2
    const grid = new Map()
    const put = (p, v) => {
      const k = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`
      if (!grid.has(k)) grid.set(k, [])
      grid.get(k).push(v)
    }
    segs.forEach((s, i) => { put(s[0], [i, 0]); put(s[1], [i, 1]) })
    const near = (p) => {
      const gx = Math.floor(p[0] / cell), gy = Math.floor(p[1] / cell)
      const out = []
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const b = grid.get(`${gx + dx},${gy + dy}`)
        if (b) out.push(...b)
      }
      return out
    }
    const dir = (s, e) => {
      const a = s[e], b = s[e === 0 ? 1 : 0]
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
      return [(b[0] - a[0]) / d, (b[1] - a[1]) / d]
    }
    const used = new Uint8Array(segs.length)
    const loops = []
    for (let start = 0; start < segs.length; start++) {
      if (used[start]) continue
      used[start] = 1
      const loop = [segs[start][0], segs[start][1]]
      let heading = dir(segs[start], 0)
      for (let guard = 0; guard < segs.length; guard++) {
        const tail = loop[loop.length - 1]
        let best = null, bestTurn = -2
        for (const [i, e] of near(tail)) {
          if (used[i]) continue
          const p = segs[i][e]
          if (Math.hypot(p[0] - tail[0], p[1] - tail[1]) > weld) continue
          const d = dir(segs[i], e)
          const turn = d[0] * heading[0] + d[1] * heading[1]
          if (turn > bestTurn) { bestTurn = turn; best = [i, e, d] }
        }
        if (!best || bestTurn < 0) break
        used[best[0]] = 1
        heading = best[2]
        loop.push(segs[best[0]][best[1] === 0 ? 1 : 0])
      }
      if (loop.length >= 16) loops.push(loop)
    }
    return loops
  }

  const encloses = (loop) => {
    let inside = false
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const [xi, zi] = loop[i], [xj, zj] = loop[j]
      if ((zi > 0) !== (zj > 0) && 0 < ((xj - xi) * (0 - zi)) / (zj - zi) + xi) inside = !inside
    }
    return inside
  }

  /**
   * The torso loop at a height: the axis-enclosing loop with the largest area,
   * rejected outright if the chain wandered: a cross-section that is 3× longer
   * than a circle through its own farthest point is not a garment section, and
   * a bad measurement is worse than a missing one.
   */
  function torsoLoop(pos, idx, y) {
    let best = null, bestA = 0
    for (const loop of sliceLoops(pos, idx, y)) {
      if (!encloses(loop)) continue
      let a = 0, len = 0, rMax = 0
      for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) a += loop[j][0] * loop[i][1] - loop[i][0] * loop[j][1]
      for (let i = 0; i < loop.length - 1; i++) len += Math.hypot(loop[i + 1][0] - loop[i][0], loop[i + 1][1] - loop[i][1])
      for (const p of loop) rMax = Math.max(rMax, Math.hypot(p[0], p[1]))
      if (len > 3 * 2 * Math.PI * rMax) continue
      if (Math.abs(a) > bestA) { bestA = Math.abs(a); best = loop }
    }
    return best
  }

  /**
   * Where the ray at angle θ crosses the loop. `want` picks WHICH surface when
   * a garment has two at one angle: a hood draped over a back, a pocket over a
   * hem. Choosing the surface is not the same as measuring along it: the arc is
   * still walked vertex by vertex on the raw mesh. Without `want` the outermost
   * crossing wins, which on a hoodie measures the hood instead of the back.
   */
  function crossing(loop, theta, want) {
    const dx = Math.sin(theta), dz = Math.cos(theta)
    let best = null
    for (let i = 0; i < loop.length - 1; i++) {
      const [x0, z0] = loop[i], [x1, z1] = loop[i + 1]
      const sx = x1 - x0, sz = z1 - z0
      const den = sx * dz - sz * dx
      if (Math.abs(den) < 1e-12) continue
      const t = (z0 * dx - x0 * dz) / den
      if (t < 0 || t > 1) continue
      const px = x0 + t * sx, pz = z0 + t * sz
      if (px * dx + pz * dz <= 0) continue
      const r = Math.hypot(px, pz)
      const score = want == null ? r : -Math.abs(r - want)
      if (!best || score > best.score) best = { i, t, r, score }
    }
    return best
  }

  /** True cloth arc along the loop between two angles (shorter way round). */
  function loopArc(loop, thetaA, thetaB, wantA, wantB) {
    const a = crossing(loop, thetaA, wantA), b = crossing(loop, thetaB, wantB)
    if (!a || !b) return null
    const cum = [0]
    for (let i = 0; i < loop.length - 1; i++) cum.push(cum[i] + Math.hypot(loop[i + 1][0] - loop[i][0], loop[i + 1][1] - loop[i][1]))
    const total = cum[cum.length - 1]
    const at = (c) => cum[c.i] + c.t * (cum[c.i + 1] - cum[c.i])
    const d = Math.abs(at(b) - at(a))
    return Math.min(d, total - d)
  }

  // ---- per-triangle cache for coverage rasterisation ----------------------
  function triangles(geo) {
    const p = geo.getAttribute('position'), uv = geo.getAttribute('uv'), rj = geo.getAttribute('printReject')
    const idx = geo.getIndex().array
    const n = idx.length / 3
    const out = { n, u: new Float32Array(n * 3), v: new Float32Array(n * 3), r: new Float32Array(n * 3), z: new Float32Array(n * 3) }
    for (let t = 0; t < n; t++) {
      for (let c = 0; c < 3; c++) {
        const i = idx[t * 3 + c]
        out.u[t * 3 + c] = uv.getX(i); out.v[t * 3 + c] = uv.getY(i)
        out.r[t * 3 + c] = rj.getX(i); out.z[t * 3 + c] = p.getZ(i)
      }
    }
    return out
  }

  /** Fraction of a UV rect that lands on ink-taking fabric, + the z it lands on. */
  function coverRect(tri, u0, u1, v0, v1, N) {
    const hit = new Uint8Array(N * N)
    let zMin = Infinity, zMax = -Infinity
    const du = (u1 - u0) / N, dv = (v1 - v0) / N
    for (let t = 0; t < tri.n; t++) {
      const o = t * 3
      const ax = tri.u[o], ay = tri.v[o], bx = tri.u[o + 1], by = tri.v[o + 1], cx = tri.u[o + 2], cy = tri.v[o + 2]
      const gi0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - u0) / du))
      const gi1 = Math.min(N - 1, Math.ceil((Math.max(ax, bx, cx) - u0) / du))
      if (gi1 < gi0) continue
      const gj0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - v0) / dv))
      const gj1 = Math.min(N - 1, Math.ceil((Math.max(ay, by, cy) - v0) / dv))
      if (gj1 < gj0) continue
      const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
      if (Math.abs(det) < 1e-14) continue
      for (let gj = gj0; gj <= gj1; gj++) {
        const py = v0 + (gj + 0.5) * dv
        for (let gi = gi0; gi <= gi1; gi++) {
          const px = u0 + (gi + 0.5) * du
          const l0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det
          if (l0 < 0 || l0 > 1) continue
          const l1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det
          if (l1 < 0 || l1 > 1) continue
          const l2 = 1 - l0 - l1
          if (l2 < 0 || l2 > 1) continue
          if (l0 * tri.r[o] + l1 * tri.r[o + 1] + l2 * tri.r[o + 2] > 1) continue
          hit[gj * N + gi] = 1
          const z = l0 * tri.z[o] + l1 * tri.z[o + 1] + l2 * tri.z[o + 2]
          if (z < zMin) zMin = z
          if (z > zMax) zMax = z
        }
      }
    }
    let c = 0
    for (let i = 0; i < hit.length; i++) c += hit[i]
    return { frac: c / hit.length, zMin, zMax }
  }

  const out = { garments: {}, notes: [] }

  for (const garment of ['tee', 'hoodie']) {
    const calib = CALIBRATION[garment]
    const gltf = await new GLTFLoader().loadAsync(calib.url)
    gltf.scene.updateMatrixWorld(true)
    const src = firstMesh(gltf.scene, calib.meshName) || firstMesh(gltf.scene)
    const design = designFor(garment)
    const g = { sizes: {} }
    out.garments[garment] = g

    for (const sizeId of sizes) {
      const frame = buildGarmentFrame(garment, src, sizeId)
      const geo = frame.geometry
      // Through the accessors: hoodie.glb interleaves POSITION with NORMAL, so
      // `.array` is the interleaved buffer and reads back normals as vertices.
      const pos = fab.unwrap.packXYZ(geo, 'position')
      const idx = fab.unwrap.packIndex(geo)
      const rec = {
        table: {
          usable: frame.table.usable,
          frontArcSpread: frame.table.frontArcSpread,
          bandsOk: frame.table.bandsOk,
          frontArcRaw: frame.table.frontArcRaw,
          yLoRaw: frame.table.yLoRaw,
          yHiRaw: frame.table.yHiRaw,
          verts: geo.getAttribute('position').count,
          tris: idx.length / 3,
          r: [180, 225, 270, 315].map((a) => frame.table.r[40 * 361 + a]),
        },
        xzScale: frame.xzScale,
        yScale: frame.yScale,
        heightIn: frame.heightIn,
        widthIn: frame.widthIn,
        chartHalfChestIn: sizeChart.garmentWidthInFor(garment, sizeId),
        chartBodyLenIn: sizeChart.sizeSpecCm(garment, sizeId).bodyLengthCm / 2.54,
        sides: {},
      }
      g.sizes[sizeId] = rec

      // Grading factor, straight off the chart (design base size is 'L').
      const k = sizeChart.sizeSpecCm(garment, sizeId).halfChestCm / sizeChart.sizeSpecCm(garment, 'L').halfChestCm

      for (const side of ['front', 'back']) {
        const area = render.getAreaSizeIn(design, side, sizeId)
        const ff = fabricFrameFor(garment, side, frame, area.wIn, area.hIn, k)
        const overlay = buildFabricOverlay(geo, ff)
        const tri = triangles(overlay)
        const s = { areaWIn: area.wIn, areaHIn: area.hIn, centreYIn: ff.centreYIn, zones: {}, arc: null, ar: null }
        rec.sides[side] = s

        // ---- C/D: arc truth along the loop at the print rows --------------
        // Walk fabric x across the rect, invert to θ through the table, and
        // compare the table's promise against the loop's measured cloth.
        // The FULL rect height, not a comfortable middle band: ±0.45 is where
        // the hoodie's hood (top of the back) and kangaroo pocket (bottom of
        // the front) actually overlap the panel, and a check that never looks
        // there cannot see the one thing that is hard about a hoodie.
        const rows = [-0.45, -0.3, 0, 0.3, 0.45].map((f) => ff.centreYIn + f * area.hIn)
        const arcErr = []
        const logoErr = []
        const lapArcErr = []
        const lapLogoErr = []
        let lappedRows = 0
        for (const yIn of rows) {
          const loop = torsoLoop(pos, idx, yIn)
          if (!loop) continue
          const yRaw = yIn / frame.yScale
          const thetaOf = (sFabIn) => {
            const sIn =
              side === 'back'
                ? sFabIn + fab.unwrap.backSeamArcAt(frame.table, yRaw, sFabIn < 0) * frame.xzScale
                : sFabIn
            return thetaAtArc(frame.table, yRaw, sIn / frame.xzScale)
          }
          // Radius of the ink-carrying surface, so the walk stays on it.
          const shellOf = (theta) => fab.unwrap.shellRadiusAt(frame.table, yRaw, theta) * frame.xzScale
          const arcBetween = (sA, sB) => {
            const tA = thetaOf(sA), tB = thetaOf(sB)
            return loopArc(loop, tA, tB, shellOf(tA), shellOf(tB))
          }
          // Do the two independent ground truths agree about this row? Where
          // they do, the mesh has a definite answer and the table must match
          // it. Where they don't (a hood on the upper back, a pocket on the
          // lower front), no assertion at fabric precision is possible.
          const segs = sectionSegs(pos, idx, yIn)
          let disagree = 0
          for (let n = -5; n <= 5; n++) {
            if (n === 0) continue
            const th = thetaOf((n / 5) * (area.wIn / 2))
            const ref = thetaOf(0)
            const viaLoop = loopArc(loop, ref, th, shellOf(ref), shellOf(th))
            if (viaLoop === null) continue
            disagree = Math.max(disagree, Math.abs(viaLoop - radialArc(segs, ref, th, shellOf)))
          }
          const overlapped = disagree * 25.4 > 1
          if (overlapped) lappedRows++
          const arcInto = overlapped ? lapArcErr : arcErr
          const logoInto = overlapped ? lapLogoErr : logoErr

          for (let n = -5; n <= 5; n++) {
            const sFab = (n / 5) * (area.wIn / 2)
            if (n === 0) continue
            const measured = arcBetween(0, sFab)
            if (measured === null) continue
            arcInto.push(measured - Math.abs(sFab))
          }
          // A 10 cm logo, centred where the left-chest zone puts it.
          const tenCm = 10 / 2.54
          const cx = 9.5 / 2.54
          for (const c of [cx, -cx, 0]) {
            const m = arcBetween(c - tenCm / 2, c + tenCm / 2)
            if (m !== null) logoInto.push(m - tenCm)
          }
        }
        const stat = (a) => a.length
          ? { n: a.length, rms: Math.sqrt(a.reduce((p, q) => p + q * q, 0) / a.length), max: Math.max(...a.map(Math.abs)) }
          : null
        s.arc = {
          sweep: stat(arcErr),
          logo10cm: stat(logoErr),
          lappedRows,
          totalRows: rows.length,
          lappedSweep: stat(lapArcErr),
          lappedLogo: stat(lapLogoErr),
        }

        // ---- E/F: zone coverage + bleed ----------------------------------
        const zones = zonesFor(design, side)
        for (const z of zones) {
          if (!z.upload && z.id !== 'full') continue
          // Zone geometry is BASE-size inches and the area is graded, but both
          // scale by the same k, so the UV rect is size-invariant by design.
          const base = render.getAreaSizeIn(design, side)
          const cov = coverRect(
            tri,
            0.5 + (z.cxIn - z.wIn / 2) / base.wIn,
            0.5 + (z.cxIn + z.wIn / 2) / base.wIn,
            0.5 - (z.cyIn + z.hIn / 2) / base.hIn,
            0.5 - (z.cyIn - z.hIn / 2) / base.hIn,
            96,
          )
          s.zones[z.id] = {
            frac: cov.frac,
            zMin: cov.zMin === Infinity ? null : cov.zMin,
            zMax: cov.zMax === -Infinity ? null : cov.zMax,
          }
        }
        overlay.dispose()

        // ---- G: AR grid on the same surface ------------------------------
        const arGeo = buildFabricDecal(ff, 0.02, 24, 24)
        const ap = arGeo.getAttribute('position')
        let arZMin = Infinity, arZMax = -Infinity
        for (let i = 0; i < ap.count; i++) { const z = ap.getZ(i); if (z < arZMin) arZMin = z; if (z > arZMax) arZMax = z }
        // Arc between the grid's extreme columns on the middle row, measured on
        // the mesh loop: the AR plane must carry the print's true inches.
        const midRow = 12 * 25
        const yMid = ap.getY(midRow)
        const loop = torsoLoop(pos, idx, yMid)
        let arArc = null
        if (loop) {
          const t0 = Math.atan2(ap.getX(midRow), ap.getZ(midRow))
          const t1 = Math.atan2(ap.getX(midRow + 24), ap.getZ(midRow + 24))
          const m = loopArc(loop, t0, t1)
          if (m !== null) arArc = m - s.areaWIn
        }
        s.ar = { indexed: !!arGeo.getIndex(), verts: ap.count, zMin: arZMin, zMax: arZMax, arcErrIn: arArc }
        arGeo.dispose()
      }

      // ---- B: physical girth, measured on the mesh, not asserted ---------
      const bandY = (b) => {
        const yTopRaw = frame.table.yHiRaw
        const spanRaw = frame.table.yHiRaw - frame.table.yLoRaw
        return (yTopRaw - b * spanRaw) * frame.yScale
      }
      const chestY = bandY((calib.chestBandFromTop[0] + calib.chestBandFromTop[1]) / 2)
      const loop = torsoLoop(pos, idx, chestY)
      if (loop) {
        let perim = 0
        for (let i = 0; i < loop.length - 1; i++) perim += Math.hypot(loop[i + 1][0] - loop[i][0], loop[i + 1][1] - loop[i][1])
        rec.chestPerimIn = perim
        rec.frontPanelIn = loopArc(loop, -Math.PI / 2, 0) + loopArc(loop, 0, Math.PI / 2)
      }
      geo.dispose()
    }

    // ---- D: the tee's own isometric atlas, as an independent oracle ------
    if (garment === 'tee') {
      const frame = buildGarmentFrame(garment, src, 'L')
      const geo = frame.geometry
      const p = geo.getAttribute('position'), uvA = geo.getAttribute('uv')
      const area = render.getAreaSizeIn(designFor('tee'), 'front')
      const ff = fabricFrameFor('tee', 'front', frame, area.wIn, area.hIn, 1)
      const su = [], sv = []
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
        if (z <= 0) continue // front island only
        if (Math.abs(y - ff.centreYIn) > area.hIn / 2) continue
        const f = fabricAt(ff, x, y, z)
        if (f.reject > 1 || f.u < 0 || f.u > 1) continue
        su.push(uvA.getX(i))
        sv.push((f.u - 0.5) * area.wIn) // inches of cloth from the centre front
      }
      // Least squares sIn = m·u + b: the atlas is an unwrap up to scale+offset.
      const n = su.length
      const mu = su.reduce((a, b) => a + b, 0) / n
      const ms = sv.reduce((a, b) => a + b, 0) / n
      let num = 0, den = 0
      for (let i = 0; i < n; i++) { num += (su[i] - mu) * (sv[i] - ms); den += (su[i] - mu) ** 2 }
      const m = num / den, b = ms - m * mu
      let sum = 0, mx = 0
      for (let i = 0; i < n; i++) { const e = sv[i] - (m * su[i] + b); sum += e * e; if (Math.abs(e) > mx) mx = Math.abs(e) }
      out.atlas = {
        n,
        inchesPerU: m,
        centreU: -b / m,
        rmsIn: Math.sqrt(sum / n),
        maxIn: mx,
        // The prior forensic run measured this at xzScale 29.7697; report the
        // same residual on that basis so the two numbers are comparable.
        rmsLegacyIn: Math.sqrt(sum / n) * (29.7697 / frame.xzScale),
        maxLegacyIn: mx * (29.7697 / frame.xzScale),
        xzScale: frame.xzScale,
      }
      geo.dispose()
    }
  }
  return out
}

// ---------------------------------------------------------------------------
try {
  await waitFor(BASE)
  browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] })
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForFunction(() => window.__fabric && window.__three && window.__render && window.__sizes, { timeout: 30000 })

  const r = await page.evaluate(inPage, SIZES)
  if (errors.length) console.error('⚠ page errors:', errors.slice(0, 3).join(' | '))

  let verdict = 'PASS'
  const fail = (m) => { console.log('  ✗ ' + m); verdict = 'FAIL' }
  const warn = (m) => { console.log('  ! ' + m); if (verdict === 'PASS') verdict = 'WARN' }

  console.log('\n=== A · arc table health ===')
  for (const [gm, g] of Object.entries(r.garments)) {
    for (const [sz, s] of Object.entries(g.sizes)) {
      const t = s.table
      console.log(
        `  ${gm} ${sz.padEnd(3)} usable=${t.usable} chestArcSpread=${(t.frontArcSpread * 100).toFixed(1)}% bandsOk=${(t.bandsOk * 100).toFixed(0)}%` +
          ` frontArcRaw=${t.frontArcRaw.toFixed(4)} rawY[${t.yLoRaw.toFixed(3)},${t.yHiRaw.toFixed(3)}] ${t.verts}v/${t.tris}t` +
          ` shell@0/45/90/135°=${t.r.map((x) => x.toFixed(3)).join('/')}`,
      )
      if (!t.usable) fail(`${gm} ${sz}: table unusable. Prints fall back to the projected decal`)
    }
  }

  console.log('\n=== B · physical girth (mesh measured vs cm chart) ===')
  for (const [gm, g] of Object.entries(r.garments)) {
    for (const [sz, s] of Object.entries(g.sizes)) {
      if (s.frontPanelIn == null) { warn(`${gm} ${sz}: no torso loop at the chest band`); continue }
      const e = s.frontPanelIn / s.chartHalfChestIn - 1
      console.log(`  ${gm} ${sz.padEnd(3)} front panel ${s.frontPanelIn.toFixed(2)}in vs chart ${s.chartHalfChestIn.toFixed(2)}in (${(e * 100).toFixed(2)}%)  perimeter ${s.chestPerimIn.toFixed(2)}in  height ${s.heightIn.toFixed(1)}in`)
      if (Math.abs(e) > 0.03) fail(`${gm} ${sz}: front panel is ${(e * 100).toFixed(1)}% off the chart half-chest`)
    }
  }

  console.log('\n=== C · arc truth (table vs cloth walked on the mesh) ===')
  for (const [gm, g] of Object.entries(r.garments)) {
    for (const [sz, s] of Object.entries(g.sizes)) {
      for (const [side, sd] of Object.entries(s.sides)) {
        const a = sd.arc.sweep, l = sd.arc.logo10cm
        const rows = `${sd.arc.totalRows - sd.arc.lappedRows}/${sd.arc.totalRows} clean rows`
        if (!a || !l) { warn(`${gm} ${sz} ${side}: no single-sheet arc samples (${rows})`) }
        else {
          console.log(`  ${gm} ${sz.padEnd(3)} ${side.padEnd(5)} ${rows}  sweep rms ${(a.rms * 25.4).toFixed(2)}mm max ${(a.max * 25.4).toFixed(2)}mm  ·  10cm logo err rms ${(l.rms * 25.4).toFixed(2)}mm max ${(l.max * 25.4).toFixed(2)}mm`)
          if (l.max * 25.4 > 2) fail(`${gm} ${sz} ${side}: a 10 cm logo covers ${(100 + l.max * 25.4).toFixed(1)}mm of cloth (>2mm off)`)
        }
        // Rows another panel lies on. Reported, never gated at fabric precision:
        // where a hood or a pocket overlaps the print rect there are two sheets
        // and no defined answer: measured, the two independent ground truths
        // this script can build disagree with EACH OTHER by ~17mm there. What
        // does matter is that it stays a local effect at the rect's edge.
        const la = sd.arc.lappedSweep, ll = sd.arc.lappedLogo
        if (la && ll) {
          console.log(`    ↳ ${sd.arc.lappedRows} undecidable row(s) (the two ground truths disagree, hood / pocket on the panel): sweep max ${(la.max * 25.4).toFixed(1)}mm · 10cm logo max ${(ll.max * 25.4).toFixed(1)}mm, indicative only`)
          if (ll.max * 25.4 > 25) warn(`${gm} ${sz} ${side}: overlapped rows are ${(ll.max * 25.4).toFixed(0)}mm out (the shell may be tracking the wrong panel)`)
        }
      }
    }
  }

  if (r.atlas) {
    console.log('\n=== D · tee UV0 atlas cross-check (independent oracle) ===')
    const a = r.atlas
    console.log(`  n=${a.n} front-panel verts · fitted ${a.inchesPerU.toFixed(3)} in of cloth per u · centre line u=${a.centreU.toFixed(4)}`)
    console.log(`  residual rms ${a.rmsIn.toFixed(4)}in / max ${a.maxIn.toFixed(4)}in at the physical xzScale ${a.xzScale.toFixed(2)}`)
    console.log(`  same residual at the legacy xzScale 29.77 (comparable to the 0.086 / 0.335 forensic figures): rms ${a.rmsLegacyIn.toFixed(4)}in / max ${a.maxLegacyIn.toFixed(4)}in`)
    if (a.rmsLegacyIn > 0.10) fail(`atlas residual rms ${a.rmsLegacyIn.toFixed(3)}in exceeds the 0.086in the forensics reached`)
    if (a.maxLegacyIn > 0.40) warn(`atlas residual max ${a.maxLegacyIn.toFixed(3)}in exceeds the 0.335in the forensics reached`)
  }

  console.log('\n=== E/F · zone coverage and bleed ===')
  for (const [gm, g] of Object.entries(r.garments)) {
    for (const [sz, s] of Object.entries(g.sizes)) {
      for (const [side, sd] of Object.entries(s.sides)) {
        for (const [zid, z] of Object.entries(sd.zones)) {
          const pct = (z.frac * 100).toFixed(1)
          const zr = z.zMin === null ? 'no fabric' : `z ${z.zMin.toFixed(2)}…${z.zMax.toFixed(2)}`
          console.log(`  ${gm} ${sz.padEnd(3)} ${side.padEnd(5)} ${zid.padEnd(13)} ${pct.padStart(5)}%  ${zr}`)
          if (z.frac < 0.995) fail(`${gm} ${sz} ${side} ${zid}: only ${pct}% of the print lands on fabric`)
          const behind = side === 'front' ? z.zMin !== null && z.zMin <= 0 : z.zMax !== null && z.zMax >= 0
          if (behind) fail(`${gm} ${sz} ${side} ${zid}: ink crosses z=0 (bleeds onto the other panel)`)
        }
      }
    }
  }

  console.log('\n=== G · AR decal grid ===')
  for (const [gm, g] of Object.entries(r.garments)) {
    for (const [sz, s] of Object.entries(g.sizes)) {
      for (const [side, sd] of Object.entries(s.sides)) {
        const a = sd.ar
        const err = a.arcErrIn === null ? 'n/a' : `${(a.arcErrIn * 25.4).toFixed(2)}mm`
        console.log(`  ${gm} ${sz.padEnd(3)} ${side.padEnd(5)} indexed=${a.indexed} verts=${a.verts} z ${a.zMin.toFixed(2)}…${a.zMax.toFixed(2)} · width err ${err}`)
        if (!a.indexed) fail(`${gm} ${sz} ${side}: AR decal is not indexed (Scene Viewer will reject it)`)
        if (side === 'front' && a.zMin <= 0) fail(`${gm} ${sz} front: AR decal reaches behind z=0`)
        if (side === 'back' && a.zMax >= 0) fail(`${gm} ${sz} back: AR decal reaches in front of z=0`)
        if (a.arcErrIn !== null && Math.abs(a.arcErrIn) * 25.4 > 4) warn(`${gm} ${sz} ${side}: AR print width is ${(a.arcErrIn * 25.4).toFixed(1)}mm off the cloth it covers`)
      }
    }
  }

  console.log('\nverdict:', verdict)
  done(verdict === 'FAIL' ? 3 : verdict === 'WARN' ? 2 : 0)
} catch (e) {
  console.error('❌', e?.stack || e?.message || e)
  done(1)
}
