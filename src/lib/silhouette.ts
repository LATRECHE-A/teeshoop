/**
 * Silhouette tracing + Poisson inflation for user-uploaded ("ship your own")
 * garments.
 *
 * Given the composited front canvas of a custom garment (which carries the
 * u2netp cutout alpha whenever the customer used background removal):
 *
 *  1. `canvasToSilhouette` traces the garment outline + interior holes
 *     (marching squares → Douglas–Peucker) with ~8 safety gates; anything
 *     ambiguous returns null and the caller falls back to the proven curved
 *     CustomCard.
 *  2. `buildInflatedShell` builds a hollow garment shell: two open sheets on a
 *     shared (GX+1)×(GY+1) grid displaced ONLY in Z by the principled
 *     inflation of Baran & Lehtinen, "Notes on Inflating Curves" (2009) — the
 *     discrete Poisson equation ∇²h = −4 solved on the inside-mask grid with
 *     red–black SOR, then z = amp · flatten(seamRemap(√(h/hMax))). A disk
 *     inflates to a hemisphere, a strip to an elliptical cylinder; the seam
 *     remap turns the rim's vertical tangent into a finite-slope garment seam
 *     (pure √ reads as a sealed air-pillow) and the tanh flatten keeps the
 *     chest reading as fabric rather than a balloon.
 *
 * The shell is HOLLOW: each sheet gets an inward-facing LINING duplicate
 * (z pulled toward the mid-plane, winding flipped), so looking through the
 * neck/hem alpha openings you see the shaded inside of the opposite panel
 * with real parallax. Two single-sided interior catch planes cover the
 * degenerate straight-through ray (all four sheets share the same alpha
 * holes). Photo-derived wrinkle detail: a mid-frequency luminance band
 * displaces Z (big folds are geometric) and a high-pass + knit-grain height
 * field becomes a tangent-space normal map (`normalMapCanvas`).
 *
 * HARD INVARIANTS: X/Y vertex positions and UVs never move — displacement is
 * Z-only, which is what guarantees print/decal inch accuracy and crispness.
 * The visible outline is cut by the texture's own alpha (alphaTest
 * downstream), not the mesh boundary. Back sheet mirrors u (1−u). Front winds
 * CCW from +Z, back reversed. Output is deterministic (fold phases are seeded
 * from mask statistics, never Math.random/Date.now), and a non-finite vertex
 * guard returns null → CustomCard fallback.
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

// --- Poisson inflation (Baran & Lehtinen 2009) ------------------------------

/**
 * Solve the discrete Poisson equation ∇²h = −4 on the inside-mask grid with
 * h = 0 outside (Dirichlet), via red–black SOR directly on the ≤200px working
 * mask. For a disk of radius R the exact solution is h = R² − r², so √h is a
 * hemisphere; a strip gives an elliptical cylinder — the principled inflation
 * of Baran & Lehtinen, "Notes on Inflating Curves" (2009), §2.
 */
function poissonInflate(m: MaskData): { h: Float32Array; hMax: number } {
  const W2 = m.W + 2
  const h = new Float32Array(W2 * (m.H + 2))
  const OMEGA = 1.92 // near-optimal SOR relaxation for a ~200-cell grid
  const ITER = 340
  // Sweep only the content bbox (mask is 0 outside it) — pure speed, no
  // change in the solution.
  const yLo = m.minY + 1
  const yHi = m.maxY + 1
  const xLo = m.minX + 1
  const xHi = m.maxX + 1
  for (let it = 0; it < ITER; it++) {
    for (let parity = 0; parity < 2; parity++) {
      for (let y = yLo; y <= yHi; y++) {
        const row = y * W2
        for (let x = ((xLo + y) & 1) === parity ? xLo : xLo + 1; x <= xHi; x += 2) {
          const i = row + x
          if (!m.mask[i]) continue
          const v = 0.25 * (h[i - 1] + h[i + 1] + h[i - W2] + h[i + W2] + 4)
          h[i] += OMEGA * (v - h[i])
        }
      }
    }
  }
  let hMax = 0
  for (let i = 0; i < h.length; i++) if (h[i] > hMax) hMax = h[i]
  return { h, hMax: hMax || 1 }
}

/** Flood the exterior: empty cells reachable from the padded border. */
function exteriorFlood(m: MaskData): Uint8Array {
  const W2 = m.W + 2
  const H2 = m.H + 2
  const n = W2 * H2
  const ext = new Uint8Array(n)
  const queue = new Int32Array(n)
  let qh = 0
  let qt = 0
  ext[0] = 1
  queue[qt++] = 0
  while (qh < qt) {
    const i = queue[qh++]
    const x = i % W2
    const y = (i / W2) | 0
    if (x > 0 && !ext[i - 1] && !m.mask[i - 1]) {
      ext[i - 1] = 1
      queue[qt++] = i - 1
    }
    if (x < W2 - 1 && !ext[i + 1] && !m.mask[i + 1]) {
      ext[i + 1] = 1
      queue[qt++] = i + 1
    }
    if (y > 0 && !ext[i - W2] && !m.mask[i - W2]) {
      ext[i - W2] = 1
      queue[qt++] = i - W2
    }
    if (y < H2 - 1 && !ext[i + W2] && !m.mask[i + W2]) {
      ext[i + W2] = 1
      queue[qt++] = i + W2
    }
  }
  return ext
}

/**
 * Fill ENCLOSED holes (neck/underarm cutouts) into the mask. The Poisson
 * solve must run on this filled domain: with hole cells at h = 0 the sheet
 * dives into a CRATER at the collar, and the crater's opaque descending wall
 * occludes the lining from every oblique angle (a "sealed funnel" — the
 * hollow read dies). Filled, the sheet stays a smooth dome and the texture
 * alpha cuts a true WINDOW in it, with the lining visible behind.
 */
function fillHoles(m: MaskData, ext: Uint8Array): MaskData {
  const filled = new Uint8Array(m.mask.length)
  let any = false
  for (let i = 0; i < filled.length; i++) {
    const f = m.mask[i] || (!ext[i] ? 1 : 0)
    filled[i] = f
    if (f && !m.mask[i]) any = true
  }
  return any ? { ...m, mask: filled } : m
}

/**
 * Chamfer distance (working px) to the nearest ENCLOSED hole (neck/underarm
 * cutouts). Exterior background is excluded via the border flood fill. Null
 * when the mask has no enclosed holes.
 */
function holeDistanceField(m: MaskData, ext: Uint8Array): Float32Array | null {
  const W2 = m.W + 2
  const H2 = m.H + 2
  const n = W2 * H2
  // Seeds: empty cells NOT reachable from outside ⇒ enclosed holes.
  const d = new Float32Array(n)
  const BIG = 1e9
  let any = false
  for (let i = 0; i < n; i++) {
    const isHole = !m.mask[i] && !ext[i]
    d[i] = isHole ? 0 : BIG
    if (isHole) any = true
  }
  if (!any) return null
  // Two-pass chamfer (1 / √2) over the whole grid.
  const SQ2 = Math.SQRT2
  for (let y = 1; y < H2; y++) {
    for (let x = 1; x < W2 - 1; x++) {
      const i = y * W2 + x
      let v = d[i]
      if (d[i - 1] + 1 < v) v = d[i - 1] + 1
      if (d[i - W2] + 1 < v) v = d[i - W2] + 1
      if (d[i - W2 - 1] + SQ2 < v) v = d[i - W2 - 1] + SQ2
      if (d[i - W2 + 1] + SQ2 < v) v = d[i - W2 + 1] + SQ2
      d[i] = v
    }
  }
  for (let y = H2 - 2; y >= 0; y--) {
    for (let x = W2 - 2; x >= 1; x--) {
      const i = y * W2 + x
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

// --- photo analysis: wrinkle bands + normal map -----------------------------

/** Long working edge for luminance analysis (blurs are O(n), radius-free). */
const PHOTO = 768

interface LumField {
  W: number
  H: number
  lum: Float32Array // 0..255
  a: Float32Array // 0..1
}

function readLumAlpha(canvas: HTMLCanvasElement, mirrorX: boolean): LumField | null {
  if (!canvas.width || !canvas.height) return null
  const scale = Math.min(1, PHOTO / Math.max(canvas.width, canvas.height))
  const W = Math.max(4, Math.round(canvas.width * scale))
  const H = Math.max(4, Math.round(canvas.height * scale))
  const off = document.createElement('canvas')
  off.width = W
  off.height = H
  const ctx = off.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.imageSmoothingEnabled = true
  if (mirrorX) {
    ctx.translate(W, 0)
    ctx.scale(-1, 1)
  }
  ctx.drawImage(canvas, 0, 0, W, H)
  const data = ctx.getImageData(0, 0, W, H).data
  const lum = new Float32Array(W * H)
  const a = new Float32Array(W * H)
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    lum[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]
    a[i] = data[p + 3] / 255
  }
  return { W, H, lum, a }
}

/** Separable box blur (edge-clamped) via per-line prefix sums; O(n), radius-free. */
function boxBlur(src: Float32Array, W: number, H: number, r: number): Float32Array {
  const tmp = new Float32Array(W * H)
  const out = new Float32Array(W * H)
  const pre = new Float64Array(Math.max(W, H) + 1)
  for (let y = 0; y < H; y++) {
    const o = y * W
    pre[0] = 0
    for (let x = 0; x < W; x++) pre[x + 1] = pre[x] + src[o + x]
    for (let x = 0; x < W; x++) {
      const s = Math.max(0, x - r)
      const e = Math.min(W, x + r + 1)
      tmp[o + x] = (pre[e] - pre[s]) / (e - s)
    }
  }
  for (let x = 0; x < W; x++) {
    pre[0] = 0
    for (let y = 0; y < H; y++) pre[y + 1] = pre[y] + tmp[y * W + x]
    for (let y = 0; y < H; y++) {
      const s = Math.max(0, y - r)
      const e = Math.min(H, y + r + 1)
      out[y * W + x] = (pre[e] - pre[s]) / (e - s)
    }
  }
  return out
}

/** Alpha-weighted (normalised) box blur — transparent surroundings don't darken
 *  the garment edge the way a plain blur would. */
function blurNorm(f: LumField, r: number): Float32Array {
  const { W, H, lum, a } = f
  const wl = new Float32Array(W * H)
  for (let i = 0; i < wl.length; i++) wl[i] = lum[i] * a[i]
  const bl = boxBlur(wl, W, H, r)
  const ba = boxBlur(a, W, H, r)
  const out = new Float32Array(W * H)
  for (let i = 0; i < out.length; i++) out[i] = bl[i] / Math.max(ba[i], 1e-4)
  return out
}

/**
 * Tangent-space normal map from a garment photo: height = luminance high-pass
 * (folds/wrinkles) + a coarse knit grain (true mm thread pitch is sub-pixel at
 * this resolution — fabric.ts still tiles the physical weave for fallbacks),
 * normals via Scharr gradients. OpenGL green-up convention; pair with a
 * flipY=true CanvasTexture, colorSpace NoColorSpace.
 */
function wrinkleNormalFrom(f: LumField, wIn: number, hIn: number): HTMLCanvasElement | null {
  const { W, H, lum, a } = f
  const rHp = Math.max(2, Math.round(Math.max(W, H) * 0.011))
  const base = blurNorm(f, rHp)
  const height = new Float32Array(W * H)
  const TAU = Math.PI * 2
  const GRAIN_PERIOD = 0.18 // in — coarse knit grain, low amplitude
  // weave(x,y) = sin(xPh)·cos(yPh) + 0.45·sin(yPh) + 0.45·sin(xPh)
  //            = sinX[x]·(cos(yPh) + 0.45) + 0.45·sin(yPh) — hoist per row/col.
  const sinX = new Float32Array(W)
  for (let x = 0; x < W; x++) sinX[x] = Math.sin(((x / W) * wIn * TAU) / GRAIN_PERIOD)
  for (let y = 0; y < H; y++) {
    const yPh = ((y / H) * hIn * TAU) / GRAIN_PERIOD
    const rowA = Math.cos(yPh) + 0.45
    const rowB = 0.45 * Math.sin(yPh)
    const o = y * W
    for (let x = 0; x < W; x++) {
      const i = o + x
      let hp = (lum[i] - base[i]) / 70
      if (hp > 1) hp = 1
      else if (hp < -1) hp = -1
      height[i] = hp * a[i] + 0.14 * (sinX[x] * rowA + rowB)
    }
  }
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')
  if (!ctx) return null
  const img = ctx.createImageData(W, H)
  const px = img.data
  const S = 1.4 // gradient → normal steepness
  for (let y = 0; y < H; y++) {
    // Edge-clamped neighbour row offsets (no per-sample clamping closures).
    const ym = (y > 0 ? y - 1 : 0) * W
    const y0 = y * W
    const yp = (y < H - 1 ? y + 1 : H - 1) * W
    for (let x = 0; x < W; x++) {
      const i = y0 + x
      const p = i * 4
      if (a[i] < 0.1) {
        px[p] = 128
        px[p + 1] = 128
        px[p + 2] = 255
        px[p + 3] = 255
        continue
      }
      const xm = x > 0 ? x - 1 : 0
      const xp = x < W - 1 ? x + 1 : W - 1
      // Scharr 3×3
      const gx =
        (3 * (height[ym + xp] - height[ym + xm]) +
          10 * (height[y0 + xp] - height[y0 + xm]) +
          3 * (height[yp + xp] - height[yp + xm])) /
        32
      const gy =
        (3 * (height[yp + xm] - height[ym + xm]) +
          10 * (height[yp + x] - height[ym + x]) +
          3 * (height[yp + xp] - height[ym + xp])) /
        32
      // canvas y grows downward but UV v grows upward (flipY) ⇒ +gy is +green.
      let nx = -gx * S
      let ny = gy * S
      let nz = 1
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
      nx /= len
      ny /= len
      nz /= len
      px[p] = Math.round((nx * 0.5 + 0.5) * 255)
      px[p + 1] = Math.round((ny * 0.5 + 0.5) * 255)
      px[p + 2] = Math.round((nz * 0.5 + 0.5) * 255)
      px[p + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return c
}

/**
 * Public wrapper: photo → wrinkle+grain normal map canvas (null when the
 * canvas is unreadable). `mirrorX` pre-mirrors the photo so the map stays
 * correct on sheets that sample u mirrored (the back sheet uses 1−u).
 */
export function buildWrinkleNormalCanvas(
  canvas: HTMLCanvasElement,
  wIn: number,
  hIn: number,
  opts?: { mirrorX?: boolean },
): HTMLCanvasElement | null {
  const f = readLumAlpha(canvas, !!opts?.mirrorX)
  return f ? wrinkleNormalFrom(f, wIn, hIn) : null
}

// --- public: inflated hollow shell -----------------------------------------

export interface InflatedShell {
  /** Front sheet: photo cap, bulged toward +Z. */
  front: THREE.BufferGeometry
  /** Back sheet: back photo / blank, bulged toward −Z. */
  back: THREE.BufferGeometry
  /**
   * Dark interior catch plane behind neck/arm holes (faces +Z — covers the
   * straight-through ray from the FRONT); null when there are no holes.
   * Render single-sided — the preview and arExport both do.
   */
  interior: THREE.BufferGeometry | null
  /** Twin catch plane facing −Z for BACK-side views; null when no holes. */
  interiorFront?: THREE.BufferGeometry | null
  /** Interior lining: front sheet pulled inward, winding flipped so it faces
   *  INTO the cavity (−Z). Same UVs/alpha as the front sheet. */
  liningFront?: THREE.BufferGeometry
  /** Interior lining: back sheet pulled inward, faces INTO the cavity (+Z). */
  liningBack?: THREE.BufferGeometry
  /** Photo wrinkle + knit-grain tangent-space normal map (front canvas). */
  normalMapCanvas?: HTMLCanvasElement
  depthIn: number
  /** Alpha-content bbox size in inches (X/Y extent of the built sheets). */
  contentWIn: number
  contentHIn: number
}

const smooth = (t: number): number => {
  const x = THREE.MathUtils.clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}

/** Reverse an indexed geometry's winding (and normals): faces flip sides. */
function flipWinding(g: THREE.BufferGeometry): void {
  const idx = g.index
  if (idx) {
    const arr = idx.array as Uint16Array | Uint32Array
    for (let i = 0; i < arr.length; i += 3) {
      const t = arr[i + 1]
      arr[i + 1] = arr[i + 2]
      arr[i + 2] = t
    }
    idx.needsUpdate = true
  }
  const nor = g.attributes.normal as THREE.BufferAttribute | undefined
  if (nor) {
    for (let i = 0; i < nor.count; i++) nor.setXYZ(i, -nor.getX(i), -nor.getY(i), -nor.getZ(i))
    nor.needsUpdate = true
  }
}

/**
 * Build a hollow, seamed garment shell from the composited garment canvas:
 * front + back sheets (Poisson-inflated, Z-only), inward-facing lining
 * duplicates (the hollow look), interior catch planes behind holes, baked
 * vertex AO, deterministic hem-drape folds and photo-derived mid-frequency
 * wrinkle displacement. X/Y and UVs never move → inch accuracy and decal
 * crispness are preserved exactly; the silhouette + holes come from the
 * texture's own alpha (alphaTest downstream).
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

  // Content bbox in working px + inches.
  const cW = m.maxX - m.minX + 1
  const cH = m.maxY - m.minY + 1
  if (cW < 3 || cH < 3) return null
  const contentWin = (cW / m.W) * wIn
  const contentHin = (cH / m.H) * hIn

  // Inflate over the hole-FILLED domain (smooth dome, alpha cuts the window);
  // AO still darkens toward the real holes below.
  const ext = exteriorFlood(m)
  const { h, hMax } = poissonInflate(fillHoles(m, ext))
  const holeD = holeDistanceField(m, ext)
  const photoField = readLumAlpha(canvas, false)

  // Mid-frequency luminance band → geometric wrinkles (big soft folds).
  let mid: Float32Array | null = null
  let midW = 0
  let midH = 0
  if (photoField) {
    const long = Math.max(photoField.W, photoField.H)
    const bMid = blurNorm(photoField, Math.max(3, Math.round(long * 0.03)))
    const bBig = blurNorm(photoField, Math.max(8, Math.round(long * 0.085)))
    mid = new Float32Array(photoField.W * photoField.H)
    let mMax = 0
    for (let i = 0; i < mid.length; i++) {
      const v = photoField.a[i] > 0.5 ? bMid[i] - bBig[i] : 0
      mid[i] = v
      const av = Math.abs(v)
      if (av > mMax) mMax = av
    }
    if (mMax > 1e-4) {
      for (let i = 0; i < mid.length; i++) mid[i] = THREE.MathUtils.clamp(mid[i] / mMax, -1, 1)
    }
    midW = photoField.W
    midH = photoField.H
  }
  const normalMapCanvas = photoField ? wrinkleNormalFrom(photoField, wIn, hIn) : null

  const W2 = m.W + 2
  /** Bilinear sample of a padded working-grid field at image coords. */
  const sampleField = (field: Float32Array, imgX: number, imgY: number): number => {
    const fx = imgX + 1
    const fy = imgY + 1
    const x0 = Math.max(0, Math.min(m.W, Math.floor(fx)))
    const y0 = Math.max(0, Math.min(m.H, Math.floor(fy)))
    const x1 = Math.min(m.W + 1, x0 + 1)
    const y1 = Math.min(m.H + 1, y0 + 1)
    const tx = fx - x0
    const ty = fy - y0
    const d00 = field[y0 * W2 + x0]
    const d10 = field[y0 * W2 + x1]
    const d01 = field[y1 * W2 + x0]
    const d11 = field[y1 * W2 + x1]
    return (d00 * (1 - tx) + d10 * tx) * (1 - ty) + (d01 * (1 - tx) + d11 * tx) * ty
  }
  /** Bilinear sample of the photo mid band at normalised canvas coords. */
  const sampleMid = (nx: number, ny: number): number => {
    if (!mid) return 0
    const fx = THREE.MathUtils.clamp(nx * midW - 0.5, 0, midW - 1)
    const fy = THREE.MathUtils.clamp(ny * midH - 0.5, 0, midH - 1)
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const x1 = Math.min(midW - 1, x0 + 1)
    const y1 = Math.min(midH - 1, y0 + 1)
    const tx = fx - x0
    const ty = fy - y0
    const d00 = mid[y0 * midW + x0]
    const d10 = mid[y0 * midW + x1]
    const d01 = mid[y1 * midW + x0]
    const d11 = mid[y1 * midW + x1]
    return (d00 * (1 - tx) + d10 * tx) * (1 - ty) + (d01 * (1 - tx) + d11 * tx) * ty
  }

  // Volume budget: chest depth from garment width; the back drapes flatter.
  const bulge = THREE.MathUtils.clamp(contentWin * 0.15, 1.4, 4.6)
  const bulgeBack = bulge * 0.6

  // Seam remap: softens the rim's vertical √-tangent into a finite-slope
  // garment seam (pure √ reads as a sealed air-pillow — the old failure mode).
  const SEAM_EPS = 0.35
  const e2 = SEAM_EPS * SEAM_EPS
  const seamNorm = Math.sqrt(1 + e2) - SEAM_EPS
  const seamRemap = (u: number): number => (Math.sqrt(u * u + e2) - SEAM_EPS) / seamNorm
  // Flatness remap: the chest reads as fabric, not a balloon.
  const FLAT_A = 1.5
  const flatNorm = Math.tanh(FLAT_A)
  const flatten = (u: number): number => Math.tanh(FLAT_A * u) / flatNorm

  // Deterministic drape-fold phases, seeded from mask statistics.
  const TAU = Math.PI * 2
  const phase1 = (m.coverage * 97.13) % TAU
  const phase2 = (((cW * 13 + cH * 7) % 257) / 257) * TAU
  const FOLD_AMP = 0.3 // in, at the hem
  const MID_AMP = 0.11 // in, geometric wrinkle displacement
  const inPerPx = wIn / m.W

  const GX = 112
  const GY = THREE.MathUtils.clamp(Math.round((GX * contentHin) / contentWin), 24, 208)
  const cols = GX + 1
  const rows = GY + 1
  const nVerts = cols * rows

  interface SheetData {
    pos: Float32Array
    uv: Float32Array
    col: Float32Array
  }

  const buildSheetData = (sign: 1 | -1): SheetData => {
    const amp = sign > 0 ? bulge : -bulgeBack
    const pos = new Float32Array(nVerts * 3)
    const uv = new Float32Array(nVerts * 2)
    const col = new Float32Array(nVerts * 3)
    for (let j = 0; j < rows; j++) {
      const fy = j / GY
      const imgY = m.minY + fy * (cH - 1)
      const Y = (0.5 - fy) * contentHin
      const ny = (m.minY + fy * cH) / m.H
      const v = 1 - ny
      // Collar tuck (top ~14%) and hem tuck (bottom ~10%): a worn garment is
      // fullest at the chest and drapes flat at shoulders and hem.
      const vTop = smooth(fy / 0.14)
      const vBot = smooth((1 - fy) / 0.1)
      const tuck = 0.55 + 0.45 * vTop * vBot
      // Hem drape ramps in below the chest; sleeves droop in the upper corners.
      const foldRamp = smooth((fy - 0.32) / 0.55)
      const sUp = smooth((0.5 - fy) / 0.35)
      for (let i = 0; i < cols; i++) {
        const fx = i / GX
        const imgX = m.minX + fx * (cW - 1)
        const X = (fx - 0.5) * contentWin
        const nx = (m.minX + fx * cW) / m.W
        const hv = Math.max(0, sampleField(h, imgX, imgY))
        const u01 = Math.min(1, Math.sqrt(hv / hMax))
        const prof = flatten(seamRemap(u01))
        const rimFade = smooth(u01 / 0.22) // wrinkles/folds vanish at the seam
        const sSide = smooth((Math.abs(X) / (contentWin * 0.5) - 0.52) / 0.3)
        const droop = 1 - 0.22 * sSide * sUp
        let z = amp * prof * tuck * droop
        // Perturbation headroom: near the seam the base depth shrinks faster
        // than rimFade, so an unscaled fold trough (≤0.41in) could push the
        // front sheet through z=0 and into the back sheet / lining. Scaling by
        // smooth(|z|/0.6) keeps every perturbation strictly smaller than the
        // base depth (worst case ≈0.41·smooth(b/0.6) < b for all b > 0).
        const headroom = smooth(Math.abs(z) / 0.6)
        // Deterministic hem drape: superposed sinusoids, chest→hem amplitude.
        const fold =
          FOLD_AMP *
          foldRamp *
          (0.62 * Math.sin((TAU * X) / 3.6 + phase1) + 0.38 * Math.sin((TAU * X) / 2.6 + phase2))
        z += sign * fold * rimFade * headroom * (sign > 0 ? 1 : 0.55)
        // Photo mid-band → geometric wrinkles (front sheet: that's the photo).
        const mv = sign > 0 ? sampleMid(nx, ny) : 0
        if (sign > 0) z += MID_AMP * mv * rimFade * headroom
        const k = (j * cols + i) * 3
        pos[k] = X
        pos[k + 1] = Y
        pos[k + 2] = z
        // Opening-aware AO: darken toward holes + strong Poisson concavities;
        // floored so the rim never vignettes.
        let ao = 0.78 + 0.22 * smooth(u01 / 0.4)
        if (holeD) {
          const dIn = sampleField(holeD, imgX, imgY) * inPerPx
          ao *= 0.8 + 0.2 * smooth(dIn / 1.6)
        }
        ao -= 0.08 * Math.max(0, -mv) * rimFade // crease shadows
        ao = THREE.MathUtils.clamp(ao, 0.72, 1)
        col[k] = ao
        col[k + 1] = ao
        col[k + 2] = ao
        const t = (j * cols + i) * 2
        const u = (m.minX + fx * cW) / m.W
        uv[t] = sign > 0 ? u : 1 - u
        uv[t + 1] = v
      }
    }
    return { pos, uv, col }
  }

  // Grid index; `ccwFromFront` = winds CCW seen from +Z (front-facing).
  const gridIndex = (ccwFromFront: boolean): Uint32Array => {
    const idx = new Uint32Array(GX * GY * 6)
    let p = 0
    for (let j = 0; j < GY; j++) {
      for (let i = 0; i < GX; i++) {
        const a = j * cols + i
        const b = a + 1
        const c = a + cols
        const d = c + 1
        if (ccwFromFront) {
          idx[p++] = a
          idx[p++] = c
          idx[p++] = b
          idx[p++] = b
          idx[p++] = c
          idx[p++] = d
        } else {
          idx[p++] = a
          idx[p++] = b
          idx[p++] = c
          idx[p++] = b
          idx[p++] = d
          idx[p++] = c
        }
      }
    }
    return idx
  }

  const makeGeo = (pos: Float32Array, uv: Float32Array, col: Float32Array, ccw: boolean): THREE.BufferGeometry => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    geo.setIndex(new THREE.BufferAttribute(gridIndex(ccw), 1))
    geo.computeVertexNormals()
    geo.computeBoundingBox()
    geo.computeBoundingSphere()
    return geo
  }

  const frontData = buildSheetData(1)
  const backData = buildSheetData(-1)

  // Non-finite guard (bad mask math must never reach the GPU).
  for (const arr of [frontData.pos, backData.pos]) {
    for (let i = 0; i < arr.length; i++) {
      if (!Number.isFinite(arr[i])) return null
    }
  }

  // Interior LINING: each sheet duplicated with z pulled toward the mid-plane
  // (z·0.82 pushed 0.18in inward, clamped so it never crosses z=0 or its
  // parent) and winding flipped so faces point INTO the cavity. Through the
  // neck/hem alpha openings you see the shaded inside of the opposite panel
  // with real parallax — the hollow-garment read.
  const liningZ = (z: number, front: boolean): number =>
    front ? Math.max(z * 0.82 - 0.18, z * 0.3) : Math.min(z * 0.82 + 0.18, z * 0.3)
  const buildLining = (src: SheetData, front: boolean): SheetData => {
    const pos = src.pos.slice()
    const col = src.col.slice()
    for (let i = 0; i < nVerts; i++) {
      pos[i * 3 + 2] = liningZ(src.pos[i * 3 + 2], front)
      col[i * 3] *= 0.6
      col[i * 3 + 1] *= 0.6
      col[i * 3 + 2] *= 0.6
    }
    return { pos, uv: src.uv.slice(), col }
  }
  const liningFrontData = buildLining(frontData, true)
  const liningBackData = buildLining(backData, false)

  const front = makeGeo(frontData.pos, frontData.uv, frontData.col, true)
  const back = makeGeo(backData.pos, backData.uv, backData.col, false)
  // Linings face the opposite way of their parent (into the cavity).
  const liningFront = makeGeo(liningFrontData.pos, liningFrontData.uv, liningFrontData.col, false)
  const liningBack = makeGeo(liningBackData.pos, liningBackData.uv, liningBackData.col, true)

  // Interior catch planes: the four sheets share the same alpha holes, so a
  // straight-through ray would exit the garment entirely. One plane per view
  // side, single-sided so neither can halo through the rim from the wrong
  // side (arExport consumes both planes single-sided too).
  // Each plane sits STRICTLY BEHIND its side's lining and inside its sheet:
  // deep enough that the parallax lining is what you see through the openings
  // (a shallower plane would occlude the lining over the whole chest — flat
  // black hole again), yet never poking through its own sheet. The nominal
  // 0.91·amp − 0.09 assumes an unperturbed sheet: folds/wrinkles lift a sheet
  // by up to FOLD_AMP + MID_AMP and its lining by 0.82× that, which overshoots
  // the fixed fraction on narrow shells (bulge < ~2.7in), so the lining's
  // MEASURED reach is used as a floor.
  const liningReach = (d: SheetData): number => {
    let z = 0
    for (let i = 0; i < nVerts; i++) {
      const v = Math.abs(d.pos[i * 3 + 2])
      if (v > z) z = v
    }
    return z
  }
  const planeDepth = (amp: number, lining: SheetData): number =>
    Math.max(0.91 * amp - 0.09, liningReach(lining) + 0.03)
  let interior: THREE.BufferGeometry | null = null
  let interiorFront: THREE.BufferGeometry | null = null
  if (sil.holes.length > 0) {
    const gBack = new THREE.ShapeGeometry(new THREE.Shape(sil.outer))
    gBack.translate(0, 0, -planeDepth(bulgeBack, liningBackData))
    interior = gBack // faces +Z (ShapeGeometry default): front-view catch
    const gFront = new THREE.ShapeGeometry(new THREE.Shape(sil.outer))
    flipWinding(gFront)
    gFront.translate(0, 0, planeDepth(bulge, liningFrontData))
    interiorFront = gFront // faces −Z: back-view catch
  }

  return {
    front,
    back,
    interior,
    interiorFront,
    liningFront,
    liningBack,
    normalMapCanvas: normalMapCanvas ?? undefined,
    depthIn: bulge + bulgeBack,
    contentWIn: contentWin,
    contentHIn: contentHin,
  }
}
