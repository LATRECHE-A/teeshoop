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

export interface Shell {
  geometry: THREE.ExtrudeGeometry
  /** Dark interior backing plane; present only when there are holes. */
  interior: THREE.BufferGeometry | null
  depthIn: number
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

// --- public: silhouette → 3D shell ----------------------------------------

export function buildShell(sil: Silhouette, wIn: number, hIn: number): Shell | null {
  const depthIn = THREE.MathUtils.clamp(wIn * 0.06, 0.8, 1.5)
  const shape = new THREE.Shape(sil.outer)
  for (const h of sil.holes) shape.holes.push(new THREE.Path(h))

  let geometry: THREE.ExtrudeGeometry
  try {
    geometry = new THREE.ExtrudeGeometry(shape, {
      depth: depthIn,
      bevelEnabled: false,
      steps: 1,
      curveSegments: 1,
    })
  } catch {
    return null
  }
  geometry.translate(0, 0, -depthIn / 2)

  const pos = geometry.attributes.position as THREE.BufferAttribute
  const uv = geometry.attributes.uv as THREE.BufferAttribute
  if (!pos || !uv) {
    geometry.dispose()
    return null
  }

  // NaN scan (Earcut can emit garbage without throwing).
  for (let i = 0; i < pos.count; i++) {
    if (!Number.isFinite(pos.getX(i)) || !Number.isFinite(pos.getY(i)) || !Number.isFinite(pos.getZ(i))) {
      geometry.dispose()
      return null
    }
  }

  // Per-triangle: classify front cap / back cap / wall, set planar cap UVs,
  // and rebuild material groups (0 front, 1 back, 2 walls).
  const front = depthIn / 2
  const back = -depthIn / 2
  const eps = depthIn * 0.02
  const triCount = pos.count / 3
  geometry.clearGroups()
  let runStart = 0
  let runMat = -1
  const flush = (endTri: number) => {
    if (runMat >= 0 && endTri > runStart)
      geometry.addGroup(runStart * 3, (endTri - runStart) * 3, runMat)
  }
  for (let t = 0; t < triCount; t++) {
    const i0 = t * 3
    const z0 = pos.getZ(i0)
    const z1 = pos.getZ(i0 + 1)
    const z2 = pos.getZ(i0 + 2)
    const isFront = Math.abs(z0 - front) < eps && Math.abs(z1 - front) < eps && Math.abs(z2 - front) < eps
    const isBack = Math.abs(z0 - back) < eps && Math.abs(z1 - back) < eps && Math.abs(z2 - back) < eps
    const mat = isFront ? 0 : isBack ? 1 : 2
    if (mat !== runMat) {
      flush(t)
      runStart = t
      runMat = mat
    }
    if (isFront || isBack) {
      for (let k = 0; k < 3; k++) {
        const vi = i0 + k
        const x = pos.getX(vi)
        const y = pos.getY(vi)
        let u = x / wIn + sil.cxn
        const v = 1 - sil.cyn + y / hIn
        if (isBack) u = 1 - u
        uv.setXY(vi, u, v)
      }
    }
  }
  flush(triCount)
  uv.needsUpdate = true

  const interior =
    sil.holes.length > 0
      ? (() => {
          const g = new THREE.ShapeGeometry(new THREE.Shape(sil.outer))
          g.translate(0, 0, back + 0.06)
          return g
        })()
      : null

  return { geometry, interior, depthIn }
}
