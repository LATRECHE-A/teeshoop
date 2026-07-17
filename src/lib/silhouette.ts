/**
 * Silhouette extrusion for user-uploaded ("ship your own") garments.
 *
 * Given the composited front canvas of a custom garment (which carries the
 * u2netp cutout alpha whenever the customer used background removal), trace the
 * garment outline + interior holes and build a shallow 3D shell: a silhouette-
 * shaped ExtrudeGeometry with a photo front cap, photo/blank back cap and dark
 * fabric-toned walls. A neck/underarm hole in the cutout reveals a dark interior
 * backing plane, so it reads hollow like the catalog GLBs.
 *
 * This is best-effort and STRICTLY GATED: `canvasToSilhouette` returns null for
 * anything ambiguous (opaque original photo, degenerate/self-intersecting
 * outline, multiple components, …), and the caller falls back to the proven
 * curved CustomCard. The extrude never replaces a working card when unsure.
 *
 * Geometry facts pinned against three r185: ExtrudeGeometry is non-indexed and
 * its cap UVs are raw shape coords, so we overwrite UVs + rebuild material
 * groups by per-triangle z classification (front cap +D/2, back −D/2, walls
 * between). Earcut never throws on self-intersection, so we validate the polygon
 * before and scan for non-finite positions after.
 */
import * as THREE from 'three'

export interface Silhouette {
  /** Outer outline, inch space, centred on the alpha content bbox, CCW. */
  outer: THREE.Vector2[]
  /** Interior holes (neck / gaps), CW. */
  holes: THREE.Vector2[][]
  /** Content-bbox centre in normalised canvas coords (for planar cap UVs). */
  cxn: number
  cyn: number
}

const WORK = 200 // longest working edge for the alpha trace
const ALPHA_T = 128 // matte threshold (u2netp feather sits around 128)

// --- alpha → binary mask ---------------------------------------------------

interface MaskData {
  mask: Uint8Array // (W+2)*(H+2), 1-cell false border, eroded 1px
  W: number
  H: number
  /** content bbox (pre-erosion) in working-pixel coords */
  minX: number
  maxX: number
  minY: number
  maxY: number
  coverage: number // fraction of image inside (pre-erosion)
}

function buildMask(canvas: HTMLCanvasElement): MaskData | null {
  const scale = Math.min(1, WORK / Math.max(canvas.width, canvas.height))
  const W = Math.max(2, Math.round(canvas.width * scale))
  const H = Math.max(2, Math.round(canvas.height * scale))
  const off = document.createElement('canvas')
  off.width = W
  off.height = H
  const ctx = off.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(canvas, 0, 0, W, H)
  const data = ctx.getImageData(0, 0, W, H).data

  const W2 = W + 2
  const H2 = H + 2
  const inside = new Uint8Array(W2 * H2) // padded, border stays 0
  let minX = W,
    maxX = -1,
    minY = H,
    maxY = -1,
    count = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] >= ALPHA_T) {
        inside[(y + 1) * W2 + (x + 1)] = 1
        count++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null

  // erode 1px (4-neighbour) to sit inside the matte feather
  const mask = new Uint8Array(W2 * H2)
  for (let y = 1; y <= H; y++) {
    for (let x = 1; x <= W; x++) {
      const i = y * W2 + x
      if (
        inside[i] &&
        inside[i - 1] &&
        inside[i + 1] &&
        inside[i - W2] &&
        inside[i + W2]
      )
        mask[i] = 1
    }
  }
  return { mask, W, H, minX, maxX, minY, maxY, coverage: count / (W * H) }
}

// --- marching squares → stitched loops (doubled-int coords) ----------------

function traceLoops(m: MaskData): number[][][] {
  const { mask, W, H } = m
  const W2 = W + 2
  const H2 = H + 2
  const key = (dx: number, dy: number) => dy * (2 * W2 + 4) + dx
  // adjacency: point-key -> up to 2 neighbour point-keys
  const adj = new Map<number, number[]>()
  const pt = new Map<number, [number, number]>()
  const addSeg = (ax: number, ay: number, bx: number, by: number) => {
    const ka = key(ax, ay)
    const kb = key(bx, by)
    if (!pt.has(ka)) pt.set(ka, [ax, ay])
    if (!pt.has(kb)) pt.set(kb, [bx, by])
    ;(adj.get(ka) ?? adj.set(ka, []).get(ka)!).push(kb)
    ;(adj.get(kb) ?? adj.set(kb, []).get(kb)!).push(ka)
  }

  for (let y = 0; y < H2 - 1; y++) {
    for (let x = 0; x < W2 - 1; x++) {
      const tl = mask[y * W2 + x]
      const tr = mask[y * W2 + x + 1]
      const br = mask[(y + 1) * W2 + x + 1]
      const bl = mask[(y + 1) * W2 + x]
      const b = (tl << 3) | (tr << 2) | (br << 1) | bl
      if (b === 0 || b === 15) continue
      // doubled-int midpoints
      const Tx = 2 * x + 1,
        Ty = 2 * y
      const Rx = 2 * x + 2,
        Ry = 2 * y + 1
      const Bx = 2 * x + 1,
        By = 2 * y + 2
      const Lx = 2 * x,
        Ly = 2 * y + 1
      switch (b) {
        case 1:
        case 14:
          addSeg(Lx, Ly, Bx, By)
          break
        case 2:
        case 13:
          addSeg(Bx, By, Rx, Ry)
          break
        case 3:
        case 12:
          addSeg(Lx, Ly, Rx, Ry)
          break
        case 4:
        case 11:
          addSeg(Tx, Ty, Rx, Ry)
          break
        case 6:
        case 9:
          addSeg(Tx, Ty, Bx, By)
          break
        case 7:
        case 8:
          addSeg(Tx, Ty, Lx, Ly)
          break
        case 5: // saddle: T-R and B-L
          addSeg(Tx, Ty, Rx, Ry)
          addSeg(Bx, By, Lx, Ly)
          break
        case 10: // saddle: T-L and B-R
          addSeg(Tx, Ty, Lx, Ly)
          addSeg(Bx, By, Rx, Ry)
          break
      }
    }
  }

  // walk closed loops over the degree-2 graph
  const usedEdge = new Set<number>()
  const edgeKey = (a: number, b: number) => (a < b ? a * 33554432 + b : b * 33554432 + a)
  const loops: number[][][] = []
  for (const [start, neigh] of adj) {
    for (const first of neigh) {
      if (usedEdge.has(edgeKey(start, first))) continue
      const loop: number[][] = []
      let prev = start
      let cur = first
      usedEdge.add(edgeKey(start, first))
      loop.push(pt.get(start)!)
      let guard = 0
      const limit = adj.size * 2 + 8
      while (cur !== start && guard++ < limit) {
        loop.push(pt.get(cur)!)
        const ns = adj.get(cur)
        if (!ns) break
        let next = -1
        for (const n of ns) {
          if (n !== prev && !usedEdge.has(edgeKey(cur, n))) {
            next = n
            break
          }
        }
        if (next < 0) {
          // fall back to any unused edge (degenerate junction)
          for (const n of ns)
            if (!usedEdge.has(edgeKey(cur, n))) {
              next = n
              break
            }
        }
        if (next < 0) break
        usedEdge.add(edgeKey(cur, next))
        prev = cur
        cur = next
      }
      if (loop.length >= 4) loops.push(loop)
    }
  }
  return loops
}

// --- Douglas–Peucker (closed loop) ----------------------------------------

function perpDist(p: number[], a: number[], b: number[]): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2
  const px = a[0] + t * dx
  const py = a[1] + t * dy
  return Math.hypot(p[0] - px, p[1] - py)
}

function dpOpen(points: number[][], eps: number): number[][] {
  const n = points.length
  if (n < 3) return points.slice()
  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()!
    let maxD = -1
    let idx = -1
    for (let i = s + 1; i < e; i++) {
      const d = perpDist(points[i], points[s], points[e])
      if (d > maxD) {
        maxD = d
        idx = i
      }
    }
    if (maxD > eps && idx > 0) {
      keep[idx] = 1
      stack.push([s, idx], [idx, e])
    }
  }
  const out: number[][] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i])
  return out
}

function simplifyClosed(loop: number[][], eps: number): number[][] {
  if (loop.length < 5) return loop
  // rotate to a stable corner (min x+y) so the DP seam sits at an extreme
  let s = 0
  let best = Infinity
  for (let i = 0; i < loop.length; i++) {
    const v = loop[i][0] + loop[i][1]
    if (v < best) {
      best = v
      s = i
    }
  }
  const rot = loop.slice(s).concat(loop.slice(0, s))
  rot.push(rot[0])
  const simp = dpOpen(rot, eps)
  simp.pop() // drop duplicated closing point
  return simp
}

// --- polygon helpers -------------------------------------------------------

function signedArea(pts: THREE.Vector2[]): number {
  let a = 0
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % n]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

function centroid(pts: THREE.Vector2[]): THREE.Vector2 {
  let x = 0
  let y = 0
  for (const p of pts) {
    x += p.x
    y += p.y
  }
  return new THREE.Vector2(x / pts.length, y / pts.length)
}

function pointInPoly(p: THREE.Vector2, poly: THREE.Vector2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside
  }
  return inside
}

function selfIntersects(poly: THREE.Vector2[]): boolean {
  const n = poly.length
  if (n < 4) return false
  // orientation of triangle (o,a,b): >0 CCW, <0 CW, 0 collinear
  const cross = (o: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  // Segments AB and CD properly cross iff each segment straddles the other's
  // supporting line — i.e. the two orientation signs differ on BOTH tests.
  const straddles = (a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2, d: THREE.Vector2) =>
    cross(c, d, a) * cross(c, d, b) < 0 && cross(a, b, c) * cross(a, b, d) < 0
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    for (let j = i + 1; j < n; j++) {
      if (j === i || (i === 0 && j === n - 1)) continue
      const c = poly[j]
      const d = poly[(j + 1) % n]
      if (a === c || a === d || b === c || b === d) continue
      if (straddles(a, b, c, d)) return true
    }
  }
  return false
}

// --- public: canvas → silhouette ------------------------------------------

export function canvasToSilhouette(
  canvas: HTMLCanvasElement,
  wIn: number,
  hIn: number,
): Silhouette | null {
  if (!canvas.width || !canvas.height || wIn <= 0 || hIn <= 0) return null
  const m = buildMask(canvas)
  if (!m) return null

  // Gate 1: opaque original (no real cutout) or empty.
  const bboxFull =
    m.minX <= 1 && m.maxX >= m.W - 2 && m.minY <= 1 && m.maxY >= m.H - 2
  if (m.coverage < 0.03) return null
  if (m.coverage > 0.97 && bboxFull) return null

  const cxn = (m.minX + m.maxX + 1) / 2 / m.W
  const cyn = (m.minY + m.maxY + 1) / 2 / m.H

  const toInch = (dx: number, dy: number): THREE.Vector2 => {
    const nx = THREE.MathUtils.clamp((dx / 2 - 1) / m.W, 0, 1)
    const ny = THREE.MathUtils.clamp((dy / 2 - 1) / m.H, 0, 1)
    return new THREE.Vector2((nx - cxn) * wIn, (cyn - ny) * hIn)
  }

  const eps = (1.2 / WORK) * Math.max(wIn, hIn) // ≈1.2 working-px in inches
  const loops = traceLoops(m)
    .map((loop) => {
      const inch = loop.map(([dx, dy]) => toInch(dx, dy))
      const simp = simplifyClosed(
        inch.map((v) => [v.x, v.y]),
        eps,
      ).map(([x, y]) => new THREE.Vector2(x, y))
      return simp
    })
    .filter((l) => l.length >= 3)
  if (loops.length === 0) return null

  // outer = largest |area|
  let outer = loops[0]
  let outerA = Math.abs(signedArea(outer))
  for (const l of loops) {
    const a = Math.abs(signedArea(l))
    if (a > outerA) {
      outer = l
      outerA = a
    }
  }

  // Gate 2: garment should fill its (tight) bbox.
  const canvasAreaIn = wIn * hIn
  if (outerA < 0.25 * canvasAreaIn) return null
  // Gate 3: shape sanity.
  if (outer.length < 3 || outer.length > 400) return null
  const aspect = hIn / wIn
  if (aspect < 0.15 || aspect > 6) return null
  // ensure CCW
  if (signedArea(outer) < 0) outer.reverse()
  if (selfIntersects(outer)) return null

  // classify holes / reject multi-component
  const holes: THREE.Vector2[][] = []
  let significant = 0
  for (const l of loops) {
    if (l === outer) continue
    const a = Math.abs(signedArea(l))
    if (a >= 0.01 * outerA) significant++
    const inside = pointInPoly(centroid(l), outer)
    if (inside && a >= 0.015 * outerA) {
      const hole = l.slice()
      if (signedArea(hole) > 0) hole.reverse() // holes CW
      if (!selfIntersects(hole)) holes.push(hole)
    } else if (!inside && a >= 0.4 * outerA) {
      return null // second component ⇒ ambiguous
    }
  }
  // Gate 4: too complex / speckled.
  if (significant > 12) return null
  if (holes.length > 8) return null

  return { outer, holes, cxn, cyn }
}

// --- public: inflated ("pillow") shell -------------------------------------

export interface InflatedShell {
  /** Front sheet: photo cap, bulged toward +Z. */
  front: THREE.BufferGeometry
  /** Back sheet: back photo / blank, bulged toward −Z. */
  back: THREE.BufferGeometry
  /** Dark interior backing behind neck/arm holes; null when there are none. */
  interior: THREE.BufferGeometry | null
  depthIn: number
  /** Alpha-content bbox size in inches (X/Y extent of the built sheets). */
  contentWIn: number
  contentHIn: number
}

/**
 * Distance transform of the eroded inside mask (two-pass chamfer 1 / √2).
 * Returns per-cell distance-to-edge in working pixels; 0 outside.
 */
function insideDistance(m: MaskData): Float32Array {
  const W2 = m.W + 2
  const H2 = m.H + 2
  const d = new Float32Array(W2 * H2)
  const BIG = 1e9
  const SQ2 = Math.SQRT2
  for (let i = 0; i < d.length; i++) d[i] = m.mask[i] ? BIG : 0
  for (let y = 1; y < H2; y++) {
    for (let x = 1; x < W2; x++) {
      const i = y * W2 + x
      if (!m.mask[i]) continue
      let v = d[i]
      if (d[i - 1] + 1 < v) v = d[i - 1] + 1
      if (d[i - W2] + 1 < v) v = d[i - W2] + 1
      if (d[i - W2 - 1] + SQ2 < v) v = d[i - W2 - 1] + SQ2
      if (d[i - W2 + 1] + SQ2 < v) v = d[i - W2 + 1] + SQ2
      d[i] = v
    }
  }
  for (let y = H2 - 2; y >= 0; y--) {
    for (let x = W2 - 2; x >= 0; x--) {
      const i = y * W2 + x
      if (!m.mask[i]) continue
      let v = d[i]
      if (d[i + 1] + 1 < v) v = d[i + 1] + 1
      if (d[i + W2] + 1 < v) v = d[i + W2] + 1
      if (d[i + W2 + 1] + SQ2 < v) v = d[i + W2 + 1] + SQ2
      if (d[i + W2 - 1] + SQ2 < v) v = d[i + W2 - 1] + SQ2
      d[i] = v
    }
  }
  return d
}

/**
 * Build a volumetric "pillow" from the composited garment canvas: two densely
 * tessellated sheets (front photo, back photo/blank) displaced ONLY in Z by a
 * smooth distance-to-edge profile, so the flat billboard becomes a rounded,
 * cloth-like body. X/Y never move, so UVs — and therefore inch accuracy and
 * decal crispness — are preserved exactly. The garment silhouette + neck/arm
 * holes come from the texture's own alpha (alphaTest downstream), which is
 * crisper than any mesh boundary; `sil` supplies the outer outline for the dark
 * interior backing behind holes.
 */
export function buildInflatedShell(
  canvas: HTMLCanvasElement,
  sil: Silhouette,
  wIn: number,
  hIn: number,
): InflatedShell | null {
  if (!canvas.width || !canvas.height || wIn <= 0 || hIn <= 0) return null
  const m = buildMask(canvas)
  if (!m) return null

  const dist = insideDistance(m)
  const W2 = m.W + 2

  // Content bbox in working px + inches.
  const cW = m.maxX - m.minX + 1
  const cH = m.maxY - m.minY + 1
  if (cW < 3 || cH < 3) return null
  const contentWin = (cW / m.W) * wIn
  const contentHin = (cH / m.H) * hIn

  // Volume budget: a torso-centred garment cross-section. Z-only, so X/Y
  // (inches) and UVs never move — inch accuracy and decal crispness are
  // preserved exactly. The back is markedly flatter than the chest (a worn
  // garment's reverse drapes flat), which — together with the seamed edge
  // profile and per-row medial depth below — reads as a real garment rather
  // than a symmetric inflatable pillow.
  const bulge = THREE.MathUtils.clamp(contentWin * 0.15, 1.4, 4.6)
  const bulgeBack = bulge * 0.6

  // Normalise the distance field by its GLOBAL max so only the medial axis
  // reaches full height. The old clamp(dist / dTarget) saturated the entire
  // torso interior into a flat-topped mesa — the "puffed paper" look.
  let dMax = 0
  for (let p = 0; p < dist.length; p++) if (dist[p] < 1e8 && dist[p] > dMax) dMax = dist[p]
  if (dMax < 1e-3) dMax = 1

  const sampleDist = (imgX: number, imgY: number): number => {
    // bilinear over the padded dist grid (mask index = img + 1)
    const fx = imgX + 1
    const fy = imgY + 1
    const x0 = Math.max(0, Math.min(m.W, Math.floor(fx)))
    const y0 = Math.max(0, Math.min(m.H, Math.floor(fy)))
    const x1 = Math.min(m.W + 1, x0 + 1)
    const y1 = Math.min(m.H + 1, y0 + 1)
    const tx = fx - x0
    const ty = fy - y0
    const d00 = dist[y0 * W2 + x0]
    const d10 = dist[y0 * W2 + x1]
    const d01 = dist[y1 * W2 + x0]
    const d11 = dist[y1 * W2 + x1]
    return (d00 * (1 - tx) + d10 * tx) * (1 - ty) + (d01 * (1 - tx) + d11 * tx) * ty
  }

  const GX = 92
  const GY = THREE.MathUtils.clamp(Math.round((GX * contentHin) / contentWin), 24, 168)

  // Per-row body centre + half-width (working px) → each horizontal slice gets a
  // half-ellipse cross-section, so the sheet reads as a rounded cylinder/torso
  // rather than a flat billboard. Thin regions (sleeves) have a small
  // distance-to-edge and stay low; the thick body bulges most.
  const nRows = GY + 1
  const rowC = new Float32Array(nRows)
  const rowH = new Float32Array(nRows)
  // Peak medial thickness (distance-to-edge) per row: large in the round body,
  // small on the thin sleeves — so depth follows where the garment is actually
  // thick (chest deep, sleeves/hem shallow) instead of a uniform inflated tube.
  const rowThick = new Float32Array(nRows)
  for (let j = 0; j < nRows; j++) {
    const ry = Math.round(m.minY + (j / GY) * (cH - 1))
    const base = (ry + 1) * W2
    let lo = -1
    let hi = -1
    let tk = 0
    for (let x = m.minX; x <= m.maxX; x++) {
      if (m.mask[base + x + 1]) {
        if (lo < 0) lo = x
        hi = x
        const dv = dist[base + x + 1]
        if (dv < 1e8 && dv > tk) tk = dv
      }
    }
    if (hi < 0) {
      rowC[j] = (m.minX + m.maxX) / 2
      rowH[j] = Math.max(1, (cW - 1) / 2)
    } else {
      rowC[j] = (lo + hi) / 2
      rowH[j] = Math.max(1, (hi - lo) / 2)
    }
    rowThick[j] = tk
  }

  const smooth = (t: number): number => {
    const x = THREE.MathUtils.clamp(t, 0, 1)
    return x * x * (3 - 2 * x)
  }

  const makeSheet = (sign: 1 | -1): THREE.BufferGeometry => {
    const amp = sign > 0 ? bulge : -bulgeBack
    const cols = GX + 1
    const rows = GY + 1
    const pos = new Float32Array(cols * rows * 3)
    const uv = new Float32Array(cols * rows * 2)
    const col = new Float32Array(cols * rows * 3)
    for (let j = 0; j < rows; j++) {
      const fy = j / GY
      const imgY = m.minY + fy * (cH - 1)
      const Y = (0.5 - fy) * contentHin
      const v = 1 - (m.minY + fy * cH) / m.H
      const rc = rowC[j]
      const rh = rowH[j]
      // Vertical fullness: tuck the collar/shoulder (top ~14%) and hem (bottom
      // ~10%) in Z and peak the fullness over the upper chest — a real tee is
      // fullest at the chest and drapes flat at the shoulders and hem, unlike
      // the old symmetric sin() that still puffed the very top/bottom edges.
      const vTop = smooth(THREE.MathUtils.clamp(fy / 0.14, 0, 1))
      const vBot = smooth(THREE.MathUtils.clamp((1 - fy) / 0.1, 0, 1))
      const chest = 0.72 + 0.28 * Math.sin(THREE.MathUtils.clamp(fy / 0.8, 0, 1) * Math.PI)
      const bias = chest * (0.55 + 0.45 * vTop * vBot)
      // Peak depth follows how THICK the garment is at this row (chest deep,
      // sleeves/hem shallow) so it stops reading as one uniform inflated tube.
      const rowDepth = THREE.MathUtils.clamp(smooth(rowThick[j] / dMax / 0.65), 0.35, 1)
      for (let i = 0; i < cols; i++) {
        const fx = i / GX
        const imgX = m.minX + fx * (cW - 1)
        const X = (fx - 0.5) * contentWin
        const nd = THREE.MathUtils.clamp(sampleDist(imgX, imgY) / dMax, 0, 1)
        const taper = smooth(nd / 0.34) // round every rim + hole down to 0
        const hx = THREE.MathUtils.clamp((imgX - rc) / rh, -1, 1)
        // cos() reaches 0 at the edge with a FINITE slope (~57°), so the front
        // and back panels meet at a garment SEAM instead of wrapping into each
        // other tangentially (which is what read as a sealed air-pillow).
        const cross = Math.cos(hx * (Math.PI / 2))
        const z = amp * cross * taper * bias * rowDepth
        const k = (j * cols + i) * 3
        pos[k] = X
        pos[k + 1] = Y
        pos[k + 2] = z
        // Free ambient occlusion baked to vertex colour: darken toward holes /
        // deep concavities. Floor raised so the whole silhouette rim no longer
        // reads as a dark vignette (which reinforced the sealed-pillow look).
        const ao = 0.75 + 0.25 * smooth(nd / 0.5)
        col[k] = ao
        col[k + 1] = ao
        col[k + 2] = ao
        const u = (m.minX + fx * cW) / m.W
        const t = (j * cols + i) * 2
        uv[t] = sign > 0 ? u : 1 - u
        uv[t + 1] = v
      }
    }
    const idx: number[] = []
    for (let j = 0; j < GY; j++) {
      for (let i = 0; i < GX; i++) {
        const a = j * cols + i
        const b = a + 1
        const c = a + cols
        const d = c + 1
        // Front winds CCW from +Z; back reverses so its normals face −Z.
        if (sign > 0) idx.push(a, c, b, b, c, d)
        else idx.push(a, b, c, b, d, c)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    geo.computeBoundingBox()
    geo.computeBoundingSphere()
    return geo
  }

  const front = makeSheet(1)
  const back = makeSheet(-1)

  // Non-finite guard (bad mask math must never reach the GPU).
  const fpos = front.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < fpos.count; i++) {
    if (!Number.isFinite(fpos.getX(i)) || !Number.isFinite(fpos.getY(i)) || !Number.isFinite(fpos.getZ(i))) {
      front.dispose()
      back.dispose()
      return null
    }
  }

  // Dark interior backing so neck/arm holes read hollow (not see-through).
  let interior: THREE.BufferGeometry | null = null
  if (sil.holes.length > 0) {
    const g = new THREE.ShapeGeometry(new THREE.Shape(sil.outer))
    g.translate(0, 0, -bulgeBack * 0.35)
    interior = g
  }

  return { front, back, interior, depthIn: bulge + bulgeBack, contentWIn: contentWin, contentHIn: contentHin }
}
