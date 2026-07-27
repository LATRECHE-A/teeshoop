/**
 * Silhouette tracing + garment-shaped inflation for user-uploaded and
 * supplier-ingested ("ship your own") garments.
 *
 * Given the composited front canvas of a custom garment (which carries the
 * u2netp cutout alpha whenever the customer used background removal):
 *
 *  1. `canvasToSilhouette` traces the garment outline + interior holes
 *     (marching squares → Douglas–Peucker) with ~8 safety gates; anything
 *     ambiguous returns null and the caller falls back to the proven curved
 *     CustomCard.
 *  2. `buildInflatedShell` builds a hollow garment shell: two open sheets on a
 *     shared (GX+1)×(GY+1) grid displaced ONLY in Z.
 *
 * WHERE THE DEPTH COMES FROM — a three-tier ladder, best first:
 *
 *  TIER 1 · TEMPLATE TRANSPLANT (src/lib/templateDepth.ts). The photo is
 *    classified (tee / polo / tank / long sleeve / sweat / hoodie, overridable
 *    by the customer), one of the two shipped garment meshes is graded onto its
 *    silhouette, and that mesh's own front/back depth field is used. This is
 *    what makes an upload read like the catalog garments: a real chest fullness
 *    under the shoulders, shoulders that roll off, a collar dip, sleeve tubes.
 *  TIER 2 · POISSON INFLATION, the principled inflation of Baran & Lehtinen,
 *    "Notes on Inflating Curves" (2009): ∇²h = −4 on the inside-mask grid via
 *    red–black SOR, then z = amp · flatten(seamRemap(√(h/hMax))). A disk
 *    inflates to a hemisphere, a strip to an elliptical cylinder. It is the
 *    right answer to "inflate this outline" and a knowingly WRONG shape for
 *    cloth — a Poisson balloon peaks on the medial axis and is dome-symmetric —
 *    so it is the fallback, taken whenever the template's fit gates refuse.
 *  TIER 3 · `CustomCard`, when the cutout is too ambiguous to trace at all.
 *
 * Tier 1 also switches off the collar/hem `tuck` and the sleeve `droop`, which
 * exist only to fake, on a balloon, the shape the template supplies for real;
 * leaving them on would apply that correction twice.
 *
 * The shell CLOSES AT THE SEAM AND HAS CLOTH THICKNESS. A laid-flat garment's
 * outer silhouette is where the front panel meets the back one (side seam,
 * shoulder seam) or where the cloth is folded under (hem), but neither depth
 * source knows that: the template bake reports 0.23–0.26 of the peak depth at a
 * Z-tangency cell, so the two sheets used to end in mid-air a median 0.25–0.55 in
 * apart (max 2.79) with no surface between them, and that open slot — seen at
 * grazing angles with the darkened linings stacked inside it — is what read as a
 * serrated outline. Both sheets are now blended onto a common seam at
 * ±FABRIC_IN/2 over a gap-adaptive band, and a RIM STRIP built on the sheet
 * grid's own alpha isoline bridges that seam and gives every cut edge (collar,
 * armhole, cuff) a real 0.06 in edge, drawn with the materials the shell already
 * has. Enclosed holes are untouched — the branch is topological, so an opening
 * cannot be sealed by a depth field that happens to be shallow there.
 *
 * The shell is HOLLOW: each sheet gets an inward-facing LINING duplicate
 * (z pulled toward the mid-plane, winding flipped), so looking through the
 * neck/hem alpha openings you see the shaded inside of the opposite panel
 * with real parallax. Two single-sided interior catch planes cover the
 * degenerate straight-through ray (all four sheets share the same alpha
 * holes). Photo-derived wrinkle detail: a mid-frequency luminance band
 * displaces Z (big folds are geometric) and a high-pass + knit-grain height
 * field becomes a tangent-space normal map (`normalMapCanvas`); the photo's own
 * baked studio lighting is divided out into `albedoCanvas` (src/lib/photoLight.ts)
 * so the scene's lights are the only lights.
 *
 * HARD INVARIANTS: X/Y vertex positions and UVs never move — displacement is
 * Z-only, which is what guarantees print/decal inch accuracy and crispness, and
 * it is why the template's depth is transplanted rather than its mesh. The
 * visible outline is cut by the texture's own alpha (alphaTest downstream), not
 * the mesh boundary. Back sheet mirrors u (1−u). Front winds CCW from +Z, back
 * reversed. Output is deterministic (fold phases are seeded from mask
 * statistics, never Math.random/Date.now), and a non-finite vertex guard
 * returns null → CustomCard fallback.
 */
import * as THREE from 'three'
import {
  classifyShape,
  garmentStructure,
  profileMask,
  resolveShape,
  SHAPE_TEMPLATE,
  type GarmentShape,
  type GarmentStructure,
  type MaskProfile,
  type ShapeGuess,
} from '@/lib/garmentShape'
import { blurNorm, delight, readLumAlpha, type LumField } from '@/lib/photoLight'
import { buildTemplateDepth, type DepthField } from '@/lib/templateDepth'

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
/**
 * A connected component smaller than this fraction of the largest one is not
 * part of the garment.
 *
 * THE HANGER. Photograph a t-shirt the way every shop photographs one and the
 * cutout contains a HOOK: it passes through the collar opening, so it touches
 * no cloth and arrives as its own little island above the garment. The outline
 * tracer already ignores such islands (they are neither the outer loop nor a
 * hole inside it) — but the MASK did not, and everything measured downstream is
 * a fraction of the garment's own bounding height. A hook a tenth of the
 * garment tall therefore moved every landmark: the classifier's `topRatio` fell
 * from 0.70 to 0.11, `hoodDrop` doubled, the CLOTH tell's margin dropped from
 * ×2.00 to ×1.31, and — because the hook's rows carry almost no area — the row
 * map's cumulative-area quantile piled all of them onto the donor's first row,
 * which spiked the vertical-stretch gate to ×5.2 and dropped an ordinary tee
 * back to the balloon. Silently.
 *
 * So the mask agrees with the tracer: measure the garment, not the furniture.
 * 10 % is far below any real detached part of a garment (a belt, a hood
 * drawstring lying clear) and two orders of magnitude above a hook; the tracer
 * itself already treats a second component at 40 % as grounds to refuse the
 * whole upload, so nothing in the 10–40 % band changes meaning here.
 */
const MIN_COMPONENT = 0.1

/**
 * Radius of the SHADING estimate, as a fraction of the photo's long edge. Wide
 * enough that only the lightbox gradient survives the blur (a fold is an order
 * of magnitude finer), narrow enough that the garment's own edges do not smear
 * the estimate inward. The same field feeds the mid-frequency wrinkle band, so
 * the two never disagree about what counts as "lighting".
 */
const shadeRadius = (longEdge: number): number => Math.max(8, Math.round(longEdge * 0.085))

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

  // Keep only the garment (see MIN_COMPONENT), then re-derive the bbox and the
  // coverage from what survived — every landmark below is a fraction of them.
  count = dropSmallComponents(inside, W2, H2)
  minX = W
  maxX = -1
  minY = H
  maxY = -1
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!inside[(y + 1) * W2 + (x + 1)]) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
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

/**
 * Zero every 4-connected component of a padded binary grid that is smaller than
 * `MIN_COMPONENT` of the largest one, and return the surviving cell count.
 *
 * Two passes with an explicit queue (never recursion — a 200×200 garment is one
 * component of up to 40 000 cells and a depth-first walk of that overflows the
 * stack): label once to size every component, then erase the ones that lost.
 * Deterministic — raster order in, raster order out.
 */
function dropSmallComponents(g: Uint8Array, W2: number, H2: number): number {
  const n = W2 * H2
  const label = new Int32Array(n).fill(-1)
  const queue = new Int32Array(n)
  const size: number[] = []
  let biggest = 0
  for (let i = 0; i < n; i++) {
    if (!g[i] || label[i] >= 0) continue
    const id = size.length
    let qh = 0
    let qt = 0
    queue[qt++] = i
    label[i] = id
    let count = 0
    while (qh < qt) {
      const k = queue[qh++]
      count++
      const x = k % W2
      // The grid has a one-cell empty border, so a neighbour is always in range.
      if (x > 0 && g[k - 1] && label[k - 1] < 0) (label[k - 1] = id), (queue[qt++] = k - 1)
      if (x < W2 - 1 && g[k + 1] && label[k + 1] < 0) (label[k + 1] = id), (queue[qt++] = k + 1)
      if (k >= W2 && g[k - W2] && label[k - W2] < 0) (label[k - W2] = id), (queue[qt++] = k - W2)
      if (k + W2 < n && g[k + W2] && label[k + W2] < 0) (label[k + W2] = id), (queue[qt++] = k + W2)
    }
    size.push(count)
    if (count > biggest) biggest = count
  }
  if (size.length < 2) return biggest
  const floor = MIN_COMPONENT * biggest
  let kept = 0
  for (let i = 0; i < n; i++) {
    if (!g[i]) continue
    if (size[label[i]] < floor) g[i] = 0
    else kept++
  }
  return kept
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

/**
 * Which gate refused the last trace, or null when it succeeded.
 *
 * Every `return null` below drops an upload to tier 3 (the curved CustomCard),
 * and from the outside those are indistinguishable — which makes "this photo
 * looks flat" impossible to diagnose without a debugger. A diagnostic string
 * costs nothing and is what scripts/inflate-verify.mjs prints when a real
 * supplier garment fails to trace. Never read by rendering code: a module-level
 * mutable that changed behaviour would make two identical inputs disagree.
 */
export type SilhouetteReject =
  | 'empty'
  | 'no-cutout'
  | 'no-loops'
  | 'small'
  | 'complex-outline'
  | 'aspect'
  | 'self-intersects'
  | 'multi-component'
  | 'speckled'
  | 'too-many-holes'
let lastReject: SilhouetteReject | null = null
export function getLastSilhouetteReject(): SilhouetteReject | null {
  return lastReject
}
const reject = (why: SilhouetteReject): null => {
  lastReject = why
  return null
}

export function canvasToSilhouette(
  canvas: HTMLCanvasElement,
  wIn: number,
  hIn: number,
): Silhouette | null {
  lastReject = null
  if (!canvas.width || !canvas.height || wIn <= 0 || hIn <= 0) return reject('empty')
  const m = buildMask(canvas)
  if (!m) return reject('empty')

  // Gate 1: opaque original (no real cutout) or empty.
  const bboxFull =
    m.minX <= 1 && m.maxX >= m.W - 2 && m.minY <= 1 && m.maxY >= m.H - 2
  if (m.coverage < 0.03) return reject('empty')
  if (m.coverage > 0.97 && bboxFull) return reject('no-cutout')

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
  if (loops.length === 0) return reject('no-loops')

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
  if (outerA < 0.25 * canvasAreaIn) return reject('small')
  // Gate 3: shape sanity.
  if (outer.length < 3 || outer.length > 400) return reject('complex-outline')
  const aspect = hIn / wIn
  if (aspect < 0.15 || aspect > 6) return reject('aspect')
  // ensure CCW
  if (signedArea(outer) < 0) outer.reverse()
  if (selfIntersects(outer)) return reject('self-intersects')

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
      return reject('multi-component') // second component ⇒ ambiguous
    }
  }
  // Gate 4: too complex / speckled.
  if (significant > 12) return reject('speckled')
  if (holes.length > 8) return reject('too-many-holes')

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
 * Two-pass chamfer (1 / √2) over a padded grid, in place: `d` arrives holding 0
 * at the seeds and a large value everywhere else, and leaves holding the
 * distance in working pixels. Factored out because the hole field and the
 * exterior field below differ ONLY in their seeds — one kernel, one place to be
 * wrong about the diagonal weight.
 */
function chamfer(d: Float32Array, W2: number, H2: number): void {
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
  chamfer(d, W2, H2)
  return d
}

/**
 * Chamfer distance (working px) to the EXTERIOR — how deep inside the OUTER
 * silhouette a cell is.
 *
 * Enclosed holes are NOT seeds (they are, by definition, the empty cells the
 * border flood could not reach), so a cell at the collar reads as being as deep
 * inside as the cloth around it and the seam convergence below leaves it at full
 * garment depth. That single fact is what keeps the neck open: the blend is
 * driven by distance to the OUTLINE, and a collar is not on the outline.
 */
function outerDistanceField(ext: Uint8Array, W2: number, H2: number): Float32Array {
  const d = new Float32Array(W2 * H2)
  for (let i = 0; i < d.length; i++) d[i] = ext[i] ? 0 : 1e9
  chamfer(d, W2, H2)
  return d
}

// --- photo analysis: wrinkle bands + normal map -----------------------------

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

/**
 * De-light a garment photo the shell was NOT built from — in practice the BACK
 * panel, whose own lightbox gradient fights the scene's lights exactly like the
 * front's, and which would otherwise be the one surface that still carries a
 * highlight that does not move when the camera orbits.
 *
 * The front's correction is computed inside `buildInflatedShell` because it can
 * share its blur with the wrinkle band; the back has no wrinkle band to share
 * with, so it pays for its own pass. Null when the photo needs no correction or
 * cannot be read — callers keep the original, which is always a valid albedo.
 */
export function buildDelitCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  const f = readLumAlpha(canvas, false)
  if (!f) return null
  return delight(canvas, f, blurNorm(f, shadeRadius(Math.max(f.W, f.H))))?.canvas ?? null
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
  /**
   * Cloth thickness at every alpha cut, welded to the FRONT sheet and drawn with
   * the front sheet's material: the front half of the closed outer seam, and the
   * front skirt of every open cut edge (collar, armhole, cuff). Null when the
   * alpha yields no isoline, or when `opts.rim === 'off'`.
   *
   * DRAW IT WITH THE FRONT SHEET'S TEXTURE AND WITHOUT AN ALPHA TEST. The rim is
   * not a surface with a cut in it — it IS the cut, welded to the isoline the
   * sheets' own alpha makes, so every fragment of it is cloth by construction.
   * Testing it against the very matte it represents is how it deletes itself,
   * and measurably did: all of a crossing's rings share one uv, so the ribbon
   * has no across-width texture derivative and samples the matte at a mip where
   * its edge is a whole texel wide, while the BACK strip additionally reads 1−u
   * over the entire canvas and so cuts on the front outline mirrored about the
   * CANVAS centre rather than about the content. Alpha-tested, the darkened
   * lining rather than the rim filled 48–84 % of the seam's scanlines in the ID
   * probe. Opaque costs one material and no image; Scene Viewer's budget counts
   * BLEND, and this is neither BLEND nor MASK.
   */
  rimFront: THREE.BufferGeometry | null
  /** The same, welded to the BACK sheet and drawn with the back's texture. */
  rimBack: THREE.BufferGeometry | null
  /** Photo wrinkle + knit-grain tangent-space normal map (front canvas). */
  normalMapCanvas?: HTMLCanvasElement
  /**
   * The front composite with its own baked studio lighting divided out — the
   * albedo the 3D materials should sample. Absent when the photo needed no
   * correction (already flat) or could not be read; callers then use the
   * original canvas, which is always a valid albedo.
   */
  albedoCanvas?: HTMLCanvasElement
  /**
   * How lit the photo was: the relative spread of its own shading field over
   * the garment. Reported whether or not a correction was applied, so "no
   * albedo" can be told apart from "nothing to correct" — a white garment on a
   * white sweep really is flat, and it is the commonest supplier photo there is.
   */
  albedoSpread?: number
  depthIn: number
  /** Alpha-content bbox size in inches (X/Y extent of the built sheets). */
  contentWIn: number
  contentHIn: number
  /** Which tier of the depth ladder actually produced this shell. */
  depthSource: 'template' | 'poisson'
  /** Garment family used (detected, or the customer's override). */
  shape: GarmentShape
  /** Which mesh actually donated its depth — normally the family's own, but the
   *  other one when that fit was refused. Absent on tier 2. */
  depthTemplate?: 'tee' | 'hoodie'
  /** Stage-A silhouette agreement with the graded template; 0 when tier 2. */
  templateIoU: number
  /**
   * Why the upload does or does not read as a garment. Absent only when the
   * mask could not be profiled at all. A shell whose `structure.isGarment` is
   * false is on tier 2 BY DECISION, not by a failed fit — surfaces that explain
   * the 3D preview should say so, and should offer the shape picker.
   */
  structure?: GarmentStructure
}

const smooth = (t: number): number => {
  const x = THREE.MathUtils.clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}

// --- cloth thickness: seam convergence + rim strip --------------------------

/**
 * Cloth thickness at a cut edge, inches.
 *
 * A single-jersey knit is 0.5–0.7 mm (0.024 in); a HEM is that cloth turned
 * under twice plus the fold (~3 layers, 0.07 in); a side seam with its allowance
 * pressed to one side is 3–4 layers (0.09 in); fleece body is ~2 mm (0.08 in).
 * 0.06 in is the middle of the band a real garment shows and the smallest number
 * that still renders — the verifier frames the garment at 48–52 px/in, so 0.06 in
 * is ~3 px, always at least one fully-lit pixel of roll at 90°. It is 3.8 % of
 * the SHALLOWEST garment depth in the supplier set (1.61 in on the 143100 vest),
 * so it can never read as a rubber lip. Absolute, not scaled: a hem does not
 * grow with the shirt, and keeping it in inches is what makes it identical
 * across sizes and across both depth tiers.
 */
const FABRIC_IN = 0.06
/** Half of it — the Z each sheet is pulled to at a closed seam. */
const HEM_HALF_IN = FABRIC_IN / 2

/**
 * Seam blend band = SEAM_BAND_K × the local base gap, clamped.
 *
 * smoothstep's max slope is 1.5× its average, so the roll's steepest |dz/dy| is
 * 1.5 / (2·K) = 0.60 in/in INDEPENDENT of the garment, the tier and the gap —
 * which is the whole reason the band tracks the gap instead of being a fixed
 * width. A FIXED band was tried on paper and rejected: at the 180712 hoodie's
 * hem the two sheets end 2.79 in apart, and closing that over 0.55 in is
 * 2.5 in/in, which trips inflate-verify's ×2.5-of-the-balloon roughness budget
 * outright.
 */
const SEAM_BAND_K = 1.25
/** Floor for the band. On the Poisson tier the rim gap is 0.02–0.17 in, so
 *  K×gap would be a band a few thousandths wide — a step, not a seam. */
const SEAM_BAND_MIN_IN = 0.45
/**
 * Ceiling for the band, inches. THIS IS A SEAM ALLOWANCE, NOT A RESHAPING.
 *
 * The bias being corrected has a known spatial extent: the template bake's own
 * cell (0.21 in on a 20-in garment), plus `buildMask`'s one-pixel erosion
 * (0.10–0.12 in), plus half a sheet grid cell (0.06 in) — about 0.4 in, which
 * is why the FLOOR is 0.45. Everything wider exists only to bound the roll's
 * slope, and it must not be allowed to reach the shoulder: the template's rim
 * bias is largest at the TOP edge (front+back = 0.52 of peak, against 0.26 at
 * the sides), so a band proportional to the gap grows to 2.4 in exactly where
 * the garment is 1.0–1.2 in from its own top edge. MEASURED with the band
 * capped at 0.18·contentHin instead: `shoulderFill` fell from 0.265 to 0.204 on
 * the tee (donor 0.301) and from 0.144 to 0.118 on the hoodie (donor 0.156),
 * and inflate-verify's "the transplant must land closer to its donor mesh than
 * the balloon does" dropped from 20/20 garments to 13/20. 0.8 in keeps
 * `smooth((1.0 − dead)/band) > 0.99` at the top of the shoulder band, so the
 * shoulder roll the transplant exists for survives intact.
 */
const SEAM_BAND_MAX_IN = 0.8
/**
 * Working pixels of FULLY converged rim before the blend starts.
 *
 * `buildMask` erodes one working pixel and the exterior flood then treats that
 * erosion ring as outside, so the distance field reads 0 across a ring that the
 * ALPHA still calls cloth — and the sheets' own alpha cut (and therefore the rim
 * isoline) sits up to half a grid cell further out again. Without this dead zone
 * the blend has already started climbing where the rim is welded, and the
 * measured seam lands at 0.09–0.19 in instead of the 0.06 in of cloth it is
 * supposed to be. 1.5 px ≈ 0.16 in of flat rim: under one screen pixel at any
 * framing the garment is viewed at.
 */
const SEAM_DEAD_PX = 1.5
/** Floor, in working pixels, for the hole-capped band: a cell right beside an
 *  opening gets no convergence at all, but the cap must not turn into a cliff
 *  one pixel later. */
const SEAM_HOLE_MIN_PX = 2

/** Rings across the roll of the rim strip (2 quads per side of a cut edge). */
const RIM_RINGS = 3
/**
 * UV inset for the rim's albedo, inches inward along −n̂.
 *
 * The rim must show CLOTH, not the matte's own feather. All of a crossing's
 * rings share ONE uv, so the ribbon has no across-width texture derivative and
 * the sampler picks its mip from the along-contour crossing spacing (~0.19 in,
 * about mip 3 on a 1000-px composite of a 24-in canvas). At that level one texel
 * IS 0.19 in and the matte's edge is smeared across it, so an inset that looks
 * generous counted in full-resolution texels is not: 0.09 in — 3.8 texels at
 * mip 0, the value the cloth-thickness design started from — lands inside the
 * blur. 0.16 in is most of a texel at the mip actually used, and it is still
 * inside the hem band / rib / stripe that is genuinely there and comfortably
 * inside the narrowest thing on a garment (a 1 in cuff).
 *
 * Undershooting now costs COLOUR and nothing else: the rim is drawn opaque (see
 * `rimFront` on InflatedShell), so it can no longer alpha-test itself away.
 */
const RIM_UV_INSET_IN = 0.16
/**
 * How far the rim's INNER rings stand proud of the isoline, inches outward
 * along n̂ — ZERO, so the strip is a wall standing exactly on the sheets' own
 * cut and nothing of it lies outside the silhouette.
 *
 * It is not zero for want of a reason to move it. The linings are alpha-cut on
 * the SAME isoline and reach it at z = ±0.009, inside the ribbon's own ±0.03
 * span, so the two surfaces meet exactly and the lining's cut edge used to win
 * the depth test on about half the scanlines — a dark 1-px stripe down the
 * middle of the seam. An 0.01 in outward excursion was carried for a while to
 * separate them. It turned out to fix nothing the OPACITY had not already
 * fixed (see `rimFront`): with the strip no longer alpha-testing itself away
 * the lining is behind a solid wall, measured cavity-in-seam 0.00–0.21 against
 * 0.72–1.00 without it, identical with the excursion and without. An unjustified
 * excursion is a fringe outside the matte, so it is 0 and the knob stays,
 * documented, for the day a lining stripe comes back.
 */
const RIM_PROUD_IN = 0
/**
 * Baked AO multiplier for the innermost ring of an OPEN cut edge (collar,
 * armhole, cuff): that face looks INTO the cavity, exactly like the linings'
 * ×0.6 but less, because it is a rim and not a wall. A CLOSED seam is a convex
 * fold and gets no extra darkening at all — a fold is not occluded. Floored at
 * 0.72, the same floor every other vertex in this file uses.
 */
const RIM_CUT_AO = 0.8
/**
 * How far outboard of a crossing the exterior flood is sampled to decide
 * "closed seam" vs "open cut edge", in working pixels.
 *
 * The eroded mask ends one pixel inside the alpha cut, so one pixel is not
 * enough to be sure a probe has left the cloth; two is, and the smallest opening
 * in the set (a collar) is ~20 working pixels across, so two cannot fall out the
 * far side of one. The branch is topological ON PURPOSE — a numeric test on the
 * measured gap would bridge a collar the moment a future depth source made the
 * neck shallow, i.e. seal the opening.
 */
const RIM_OUTBOARD_PX = 2
/** Ring separation floor, inches. A crossing whose two sheets have already met
 *  would otherwise make a zero-area quad: no normal to wind by, and a primitive
 *  the glTF validator flags. Half a thou is invisible at the weld. */
const RIM_MIN_RING_IN = 5e-4

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
 * Count the interior holes that look like ARMHOLES: high on the garment and
 * well off the centre line. Two of them is the one unambiguous tell for a
 * sleeveless cut — a racerback vest laid flat is as wide at the shoulder as a
 * tee, so the width test alone would call it a tee.
 *
 * A tote's two handles land in this bucket exactly as a vest's armholes do: an
 * opening cannot tell you how much cloth is around it. That is what
 * `garmentStructure`'s CLOTH tell is for, and it is why this count decides only
 * WHICH garment, never WHETHER.
 */
function armholeCount(sil: Silhouette, contentWin: number, contentHin: number): number {
  let n = 0
  for (const hole of sil.holes) {
    const c = centroid(hole)
    // sil coordinates are inches from the content-bbox CENTRE, +y up.
    const fromTop = 0.5 - c.y / Math.max(1e-6, contentHin)
    if (fromTop < 0.45 && Math.abs(c.x) > 0.16 * contentWin) n++
  }
  return n
}

/**
 * Which garment family does this photo look like?
 *
 * Exported so the setup modal can show the customer the detection and let them
 * correct it BEFORE any 3D preview exists. It deliberately re-runs the exact
 * measurement the shell runs — hole-filled mask → row profile → classifier — on
 * the same alpha, so the label in the modal cannot drift from the template the
 * shell will actually borrow from. (The print composited on top is inside the
 * garment's alpha, so a photo and its composite classify identically.)
 *
 * Scale-free: the classifier reads ratios only, so the caller need not know the
 * garment's real inches. Null when the alpha is unreadable.
 */
export interface ShapeDetection extends ShapeGuess {
  /** Whether the upload reads as a garment at all. When it does not, the 3D
   *  preview keeps the shape-agnostic Poisson shell whatever family is named
   *  here — so the modal should present the family as a choice, not a fact. */
  structure: GarmentStructure
}

export function detectGarmentShape(canvas: HTMLCanvasElement): ShapeDetection | null {
  const m = measureGarmentPhoto(canvas)
  return m ? { ...classifyShape(m.profile, m.armholes), structure: m.structure } : null
}

/**
 * Everything the shape decision is made from, measured once.
 *
 * `profile` is the HOLE-FILLED mask's row profile — the domain the depth field
 * lives on. `raw` is the same mask before filling, and it is not redundant:
 * filling is what turns a tote's handle loops into solid shoulder lobes, so the
 * one place a handle can still be told from a strap is before it happens.
 *
 * Exported for the dev harness, which reports the whole measurement per
 * supplier photo — a classifier tuned against anything other than the profile
 * the shell will really see is tuned against fiction.
 */
export interface GarmentMeasure {
  profile: MaskProfile
  raw: MaskProfile
  /** Enclosed openings that sit where a sleeveless cut's armholes do. */
  armholes: number
  structure: GarmentStructure
  /** The filled mask and its addressing, so the shell can reuse this exact
   *  measurement instead of recomputing (and possibly disagreeing with) it. */
  mask: Uint8Array
  W: number
  H: number
  stride: number
  offset: number
}

function measureMask(m: MaskData, sil: Silhouette | null, wIn: number, hIn: number): GarmentMeasure | null {
  const filled = fillHoles(m, exteriorFlood(m))
  const stride = m.W + 2
  const offset = m.W + 3
  const profile = profileMask(filled.mask, m.W, m.H, stride, offset)
  const raw = profileMask(m.mask, m.W, m.H, stride, offset)
  if (!profile || !raw) return null
  const contentWin = ((m.maxX - m.minX + 1) / m.W) * wIn
  const contentHin = ((m.maxY - m.minY + 1) / m.H) * hIn
  return {
    profile,
    raw,
    armholes: sil ? armholeCount(sil, contentWin, contentHin) : 0,
    structure: garmentStructure(profile, raw),
    mask: filled.mask,
    W: m.W,
    H: m.H,
    stride,
    offset,
  }
}

export function measureGarmentPhoto(canvas: HTMLCanvasElement): GarmentMeasure | null {
  if (!canvas.width || !canvas.height) return null
  const m = buildMask(canvas)
  if (!m) return null
  const hIn = canvas.height / canvas.width
  return measureMask(m, canvasToSilhouette(canvas, 1, hIn), 1, hIn)
}

/**
 * Build a hollow, seamed garment shell from the composited garment canvas:
 * front + back sheets (Z-only displacement from the template transplant, or
 * from the Poisson balloon when its gates refuse), inward-facing lining
 * duplicates (the hollow look), interior catch planes behind holes, baked
 * vertex AO, deterministic hem-drape folds and photo-derived mid-frequency
 * wrinkle displacement. X/Y and UVs never move → inch accuracy and decal
 * crispness are preserved exactly; the silhouette + holes come from the
 * texture's own alpha (alphaTest downstream).
 *
 * `opts.shape` forces a garment family (the dev harness uses it to A/B the
 * templates); production leaves it out and the customer's stored override —
 * or the classifier — decides, identically here and in the AR bake.
 *
 * `opts.rim = 'off'` reproduces the pre-thickness geometry byte for byte (no
 * seam convergence, no rim strip). It exists so scripts/inflate-verify.mjs can
 * run every rim assertion against the geometry those assertions were written to
 * REJECT, and fail if they pass — a metric nobody has watched fail is a metric
 * nobody has tested.
 */
export function buildInflatedShell(
  canvas: HTMLCanvasElement,
  sil: Silhouette,
  wIn: number,
  hIn: number,
  opts?: { shape?: GarmentShape; forcePoisson?: boolean; rim?: 'on' | 'off' },
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

  // Both depth tiers run over the hole-FILLED domain (a smooth dome the alpha
  // then cuts a window in; with hole cells at h = 0 the sheet dives into a
  // crater at the collar). The template's own coverage has no collar hole
  // either, so the two masks describe the same topology — which is what makes
  // the row/run correspondence in templateDepth.ts meaningful.
  const ext = exteriorFlood(m)
  const filled = fillHoles(m, ext)
  const holeD = holeDistanceField(m, ext)
  // Distance to the OUTLINE (never to a collar — see outerDistanceField): what
  // the seam convergence and the rim's closed/open branch are both driven by.
  const outerD = outerDistanceField(ext, m.W + 2, m.H + 2)
  const rimOn = opts?.rim !== 'off'

  // TIER 1 — transplant a real garment's depth field, but only once the upload
  // has been shown to BE a garment. The structural test comes first and the
  // template fit second, in that order and not the other way round: the fit's
  // grading map is free enough to squash a tee mesh into a tote bag and report
  // a better overlap than it manages on a real polo, so a silhouette that has
  // no neck, no shoulder line and no cloth at its top must never reach it. The
  // refusal costs nothing — tier 2 is the shape-agnostic balloon, i.e. exactly
  // what a non-garment used to get and still should.
  //
  // A CUSTOMER'S EXPLICIT CHOICE OVERRULES THE TEST. The structural tells are
  // evidence, not authority: someone who has told the setup modal "this is a
  // hoodie" knows something the outline does not carry, and refusing them on a
  // heuristic would be the wrong kind of confident.
  const measure = measureMask(m, sil, wIn, hIn)
  const structure = measure?.structure ?? null
  let depth: DepthField | null = null
  let shape: GarmentShape = 'tee'
  if (!opts?.forcePoisson && measure) {
    const resolved = resolveShape(measure.profile, measure.armholes)
    shape = opts?.shape ?? resolved.shape
    if (measure.structure.isGarment || opts?.shape || resolved.source === 'user') {
      // Preference order, not a set: the family's own donor first, the other
      // as a rescue (see buildTemplateDepth). With two donors this is simply
      // "mine, then the other one".
      const first = SHAPE_TEMPLATE[shape]
      depth = buildTemplateDepth(measure.mask, m.W, m.H, measure.profile, [
        first,
        first === 'tee' ? 'hoodie' : 'tee',
      ])
    }
  }
  // TIER 2 — the Poisson balloon, only when tier 1 declined.
  const poisson = depth ? null : poissonInflate(filled)
  const photoField = readLumAlpha(canvas, false)

  // Mid-frequency luminance band → geometric wrinkles (big soft folds), and the
  // big blur doubles as the shading estimate the de-lighting divides out.
  let mid: Float32Array | null = null
  let midW = 0
  let midH = 0
  let albedoCanvas: HTMLCanvasElement | undefined
  let albedoSpread: number | undefined
  if (photoField) {
    const long = Math.max(photoField.W, photoField.H)
    const bMid = blurNorm(photoField, Math.max(3, Math.round(long * 0.03)))
    const bBig = blurNorm(photoField, shadeRadius(long))
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
    const dl = delight(canvas, photoField, bBig)
    albedoCanvas = dl?.canvas ?? undefined
    albedoSpread = dl?.spread
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
  // A transplanted profile spends it where a garment actually carries volume,
  // so it can afford more of it: extra depth on a balloon reads as a pillow,
  // extra depth on a real profile reads as volume. (0.15 → 0.17 measured as
  // the point where the shell matches the catalog meshes' apparent thickness
  // without the front sheet's fold troughs threatening the mid-plane.)
  const bulge = THREE.MathUtils.clamp(contentWin * (depth ? 0.17 : 0.15), 1.4, depth ? 5.0 : 4.6)
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
  /** Tier-2 surface profile from a raw Poisson height. Hoisted out of the vertex
   *  loop so the base-gap field below and the sheets can never disagree. */
  const profPoisson = (h: number, hMax: number): number =>
    flatten(seamRemap(Math.min(1, Math.sqrt(Math.max(0, h) / hMax))))

  // UN-PERTURBED front−back separation per working cell, inches. Only the seam
  // BAND WIDTH reads it, so the fold/wrinkle terms (≤0.41 in, and killed at the
  // rim by `headroom` anyway) and the tuck/droop factors are deliberately left
  // out: what the band needs is how deep the garment is here, not how deep this
  // particular vertex ended up.
  const gapField = new Float32Array(W2 * (m.H + 2))
  for (let i = 0; i < gapField.length; i++) {
    const uf = depth
      ? Math.min(1, Math.max(0, depth.front[i]))
      : profPoisson(poisson!.h[i], poisson!.hMax)
    const ub = depth
      ? Math.min(1, Math.max(0, depth.back[i]))
      : profPoisson(poisson!.h[i], poisson!.hMax)
    gapField[i] = bulge * uf + bulgeBack * ub
  }
  // A seam allowance does not scale with the shirt, but it must not outgrow a
  // doll-sized one either: 12 % of the height is 0.8 in on the smallest garment
  // in the supplier set and smaller only on things that are not garments.
  const seamBandMax = Math.min(SEAM_BAND_MAX_IN, 0.12 * contentHin)

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
      // fullest at the chest and drapes flat at shoulders and hem. These two
      // fudges — and the sleeve `droop` below — exist to fake, on a symmetric
      // balloon, exactly the shape a real garment has. The template already
      // carries it, so applying them on top would bank the same correction
      // twice: a shoulder that rolls off and then rolls off again.
      const vTop = smooth(fy / 0.14)
      const vBot = smooth((1 - fy) / 0.1)
      const tuck = depth ? 1 : 0.55 + 0.45 * vTop * vBot
      // Hem drape ramps in below the chest; sleeves droop in the upper corners.
      const foldRamp = smooth((fy - 0.32) / 0.55)
      const sUp = smooth((0.5 - fy) / 0.35)
      for (let i = 0; i < cols; i++) {
        const fx = i / GX
        const imgX = m.minX + fx * (cW - 1)
        const X = (fx - 0.5) * contentWin
        const nx = (m.minX + fx * cW) / m.W
        // TIER 1: the template's own front/back surface, already 0..1 with 1 at
        // the deepest point. TIER 2: √(h/hMax) through the seam + flatten
        // remaps that make a Poisson balloon survivable.
        const u01 = depth
          ? Math.min(1, Math.max(0, sampleField(sign > 0 ? depth.front : depth.back, imgX, imgY)))
          : Math.min(1, Math.sqrt(Math.max(0, sampleField(poisson!.h, imgX, imgY)) / poisson!.hMax))
        const prof = depth ? u01 : flatten(seamRemap(u01))
        const rimFade = smooth(u01 / 0.22) // wrinkles/folds vanish at the seam
        const sSide = smooth((Math.abs(X) / (contentWin * 0.5) - 0.52) / 0.3)
        const droop = depth ? 1 : 1 - 0.22 * sSide * sUp
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
        // SEAM. A garment photographed LAID FLAT has its whole outer silhouette
        // on the mid-plane: that outline IS where the front panel meets the back
        // panel (side seam, shoulder seam) or where the cloth is folded under
        // (hem). The transplanted depth field does not know this. The template
        // bake rasterises max-Z per cell, so at a Z-tangency cell it reports the
        // surface a fraction of a cell INSIDE the rim rather than 0 — measured
        // on the shipped blobs, front+back at the side rim is 0.264 of the peak
        // (tee) and 0.232 (hoodie) — and buildMask's 1-px erosion then samples
        // one working pixel further in again. The two sheets therefore ended in
        // mid-air 0.25–0.55 in apart (p90 up to 2.15, max 2.79) with NOTHING
        // between them, and that open slot — not any depth fight — is what reads
        // as a serrated edge at grazing angles: the Poisson balloon closes the
        // same rim to 0.02–0.05 in and has never serrated.
        //
        // So blend both sheets onto a common seam at ±HEM_HALF_IN over a band
        // that tracks the LOCAL gap, which bounds the roll's slope at 0.60 in/in
        // whatever the tier and whatever the garment. Enclosed holes are not on
        // the outline, so `outerD` is large there and this is a no-op: the
        // collar keeps the full garment depth on both sheets and its lining
        // parallax is untouched.
        if (rimOn) {
          let band = THREE.MathUtils.clamp(
            SEAM_BAND_K * Math.max(1e-4, sampleField(gapField, imgX, imgY)),
            SEAM_BAND_MIN_IN,
            seamBandMax,
          )
          // A seam allowance cannot be wider than the panel it lives on. On the
          // synthetic tee the cloth between the collar hole and the shoulder
          // line is 0.5 in, and a 1.9 in band reaching across it pulled the
          // collar's own edge down to 28 % of the garment depth — the hollow
          // read is delivered THROUGH that opening, so it must not be. Capping
          // the band by the distance to the nearest opening leaves the outline
          // converging exactly as before and the hole at full depth.
          if (holeD)
            band = Math.min(band, Math.max(SEAM_HOLE_MIN_PX * inPerPx, sampleField(holeD, imgX, imgY) * inPerPx))
          const dOut = (sampleField(outerD, imgX, imgY) - SEAM_DEAD_PX) * inPerPx
          const seam = smooth(dOut / band)
          z = sign * HEM_HALF_IN + (z - sign * HEM_HALF_IN) * seam
        }
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

  /**
   * THE RIM STRIP — the cloth thickness the sheets never had.
   *
   * Everything here is cut from the 0.45 isoline of a GRID-RESOLUTION,
   * box-filtered alpha, in the sheets' own coordinates, and never from
   * `Silhouette.outer`: that polygon is up to 0.324 in inside the real alpha cut
   * (1-px erosion + a 1.2-working-px Douglas–Peucker epsilon + half-pixel
   * marching-squares quantisation) and up to 0.204 in outside it at a
   * concavity — 15 px of fringe face-on or 10 px of crack at 90°. The isoline
   * of a box filter whose cells are centred on the sheet's own vertices is
   * unbiased to ~0.018 in, and it costs one 113×180 getImageData.
   *
   * Each crossing is sorted by TOPOLOGY, never by the measured gap:
   *  · outboard cell is EXTERIOR  → CLOSED SEAM. Front and back are bridged
   *    through a mid ring; the front half is welded to the front sheet and the
   *    back half to the back, so each keeps its own texture and its own u
   *    convention and the GLB gains no material.
   *  · outboard cell is NOT exterior → OPEN CUT EDGE (collar, armhole, cuff).
   *    Two independent skirts that do not meet, so the opening cannot be sealed
   *    by construction — which is exactly why the branch is topological and not
   *    a threshold on the depth.
   */
  const buildRim = (): { rimFront: THREE.BufferGeometry; rimBack: THREE.BufferGeometry } | null => {
    const stepX = (cW - 1) / GX
    const stepY = (cH - 1) / GY
    /**
     * Transparent PADDING cells around the sheet grid, so the isoline CLOSES on
     * the grid instead of being clipped by it.
     *
     * The grid spans exactly the content bbox, and the bbox is the alpha's own
     * bounding box — so wherever the cut RUNS ALONG that box the boundary cell's
     * box filter is half cloth, reads ≈0.5 ≥ T, and no edge of it ever crosses:
     * the contour walks off the grid and the ribbon simply ends. That is not a
     * corner case, it is where a laid-flat garment is flattest — the hem across
     * the bottom of every flat-lay, the outer edge of a sleeve at its widest.
     * MEASURED over the 18 supplier photos before this pad existed: 4–14 open
     * ribbon ends each, longest single break 3.5–9.7 in, 3.5–20.7 in of a
     * 39–55 in outline (8–45 %) carrying no cloth thickness at all — and every
     * one of those ends within 0.25 in of the bbox.
     *
     * TWO cells, not one, and the outermost ring is forced transparent. The
     * bbox is `alpha ≥ ALPHA_T` measured on the 200-px WORKING mask, while this
     * grid box-filters the full-resolution canvas, so the matte a cell beyond
     * the bbox is not 0 — it is the far half of the feather, and one pad cell
     * still read ≥ T often enough to leave 190608 a 7.2 in break and 191052 a
     * 5.7 in one. Two cells clear the feather; zeroing the ring makes closure a
     * property of the grid rather than of the photo, and costs nothing because
     * every crossing is clamped back onto the sheet's own extent anyway.
     */
    const PAD = 2
    const aCols = cols + 2 * PAD
    const aRows = rows + 2 * PAD
    const ac = document.createElement('canvas')
    ac.width = aCols
    ac.height = aRows
    const actx = ac.getContext('2d', { willReadFrequently: true })
    if (!actx) return null
    actx.imageSmoothingEnabled = true
    // A 9:1 downscale is where the browser's default filter stops being a box
    // filter and starts being a bilinear tap off a short mip chain, which
    // aliases: `A` comes back nearly binary, every crossing's interpolation
    // parameter lands at 0 or 1, and the isoline the rim is welded to turns
    // into a staircase with one step per grid cell — 0.19 in, seven screen
    // pixels on a collar close-up, and plainly visible as a polygonal lip.
    actx.imageSmoothingQuality = 'high'
    // The destination rect is derived from the VERTEX SPACING, not from the
    // content bbox: a bbox-aligned downsample puts cell centres half a cell off
    // the vertices they describe, which biases the whole isoline by ~0.06 in —
    // the same size as the thickness being added.
    actx.drawImage(
      canvas,
      PAD + 0.5 - m.minX / stepX,
      PAD + 0.5 - m.minY / stepY,
      m.W / stepX,
      m.H / stepY,
    )
    const A = new Float32Array(aCols * aRows)
    {
      const d = actx.getImageData(0, 0, aCols, aRows).data
      for (let i = 0; i < A.length; i++) A[i] = d[i * 4 + 3] / 255
      // The outermost ring is no-cloth by fiat, so no contour can leave the grid.
      for (let i = 0; i < aCols; i++) A[i] = A[(aRows - 1) * aCols + i] = 0
      for (let j = 0; j < aRows; j++) A[j * aCols] = A[j * aCols + aCols - 1] = 0
    }
    const T = 0.45 // the sheets' own alphaTest — the rim must sit on THAT cut

    const sampleA = (gi: number, gj: number): number => {
      const x = THREE.MathUtils.clamp(gi, 0, aCols - 1)
      const y = THREE.MathUtils.clamp(gj, 0, aRows - 1)
      const x0 = Math.min(aCols - 2, Math.floor(x))
      const y0 = Math.min(aRows - 2, Math.floor(y))
      const tx = x - x0
      const ty = y - y0
      const i0 = y0 * aCols + x0
      return (
        (A[i0] * (1 - tx) + A[i0 + 1] * tx) * (1 - ty) +
        (A[i0 + aCols] * (1 - tx) + A[i0 + aCols + 1] * tx) * ty
      )
    }
    const gridOfX = (X: number): number => (X / contentWin + 0.5) * GX + PAD
    const gridOfY = (Y: number): number => (0.5 - Y / contentHin) * GY + PAD

    // --- crossings, deduped by grid-edge index -------------------------------
    // Deduping halves the vertex count, makes adjacent segments watertight
    // bit-exactly (no crack from recomputing t twice), and gives the averaged
    // outward normal somewhere to accumulate so the roll does not facet at
    // outline corners.
    const cX: number[] = []
    const cY: number[] = []
    const cZF: number[] = []
    const cZB: number[] = []
    const cNF: number[] = []
    const cNB: number[] = []
    const cAoF: number[] = []
    const cAoB: number[] = []
    const cNx: number[] = []
    const cNy: number[] = []
    const cOpen: number[] = []
    const fNor = front.attributes.normal.array as Float32Array
    const bNor = back.attributes.normal.array as Float32Array
    const edgeMap = new Map<number, number>()

    /** Sheet vertex under an ALPHA-GRID cell. A padding cell has none, so it
     *  reads the outline vertex next to it — which the seam has already pulled
     *  to ±HEM_HALF_IN, exactly the depth a crossing a fraction of a cell
     *  outside it should carry. */
    const sheetOf = (gi: number, gj: number): number =>
      THREE.MathUtils.clamp(gj - PAD, 0, GY) * cols + THREE.MathUtils.clamp(gi - PAD, 0, GX)

    const crossing = (
      edgeId: number,
      gi0: number,
      gj0: number,
      gi1: number,
      gj1: number,
      t: number,
    ): number => {
      const hit = edgeMap.get(edgeId)
      if (hit !== undefined) return hit
      const k = cX.length
      edgeMap.set(edgeId, k)
      const a3 = sheetOf(gi0, gj0) * 3
      const b3 = sheetOf(gi1, gj1) * 3
      const mix = (p: Float32Array, o: number): number => p[a3 + o] + (p[b3 + o] - p[a3 + o]) * t
      // X/Y come from the GRID, not from those two vertices: on a padding edge
      // both clamp to the same vertex and the crossing would collapse onto it.
      // Clamped back onto the sheet's own extent so the strip can never stand
      // outside the silhouette the sheets cut — the crossing on a padding edge
      // lands at most 0.55 cell (0.10 in) out, which face-on is a fringe.
      const gx = THREE.MathUtils.clamp(gi0 + (gi1 - gi0) * t, PAD, PAD + GX)
      const gy = THREE.MathUtils.clamp(gj0 + (gj1 - gj0) * t, PAD, PAD + GY)
      cX.push(((gx - PAD) / GX - 0.5) * contentWin)
      cY.push((0.5 - (gy - PAD) / GY) * contentHin)
      cZF.push(mix(frontData.pos, 2))
      cZB.push(mix(backData.pos, 2))
      for (const [src, out] of [
        [fNor, cNF],
        [bNor, cNB],
      ] as const) {
        const nx = mix(src, 0)
        const ny = mix(src, 1)
        const nz = mix(src, 2)
        const L = Math.hypot(nx, ny, nz) || 1
        out.push(nx / L, ny / L, nz / L)
      }
      cAoF.push(mix(frontData.col, 0))
      cAoB.push(mix(backData.col, 0))
      cNx.push(0)
      cNy.push(0)
      cOpen.push(0)
      return k
    }

    const segP: number[] = []
    const segQ: number[] = []
    const segNx: number[] = []
    const segNy: number[] = []
    const probeIn = 0.5 * Math.min(contentWin / GX, contentHin / GY)
    const H2 = m.H + 2
    const addSeg = (p: number, q: number): void => {
      const dX = cX[q] - cX[p]
      const dY = cY[q] - cY[p]
      const L = Math.hypot(dX, dY)
      // A raster corner can put two crossings on the same point; a zero-area
      // primitive is a glTF-validator finding and has no normal to wind by.
      if (!(L > 1e-4)) return
      let nx = dY / L
      let ny = -dX / L
      // Orient from cloth toward no-cloth by ASKING THE ALPHA rather than
      // trusting a winding convention: the two saddle cases carry a pair of
      // segments whose outward sides are opposite, and any cell-average
      // gradient gets one of them wrong.
      //
      // Asked along a RAY, not at a point. A single half-cell sample cannot
      // tell the outside of the garment from the far wall of a one-cell notch,
      // and the outline of a real cutout is full of those: measured, a
      // point probe flipped 2–26 rim triangles per garment (26 on the hoodie),
      // and an inverted rim triangle is a hole in AR, where Scene Viewer culls
      // back faces. Three cells of profile on each side is enough to see past
      // any notch the grid can represent.
      const mX = (cX[p] + cX[q]) / 2
      const mY = (cY[p] + cY[q]) / 2
      let side = 0
      for (let s = 1; s <= 6; s++) {
        const d = probeIn * s
        side +=
          sampleA(gridOfX(mX + nx * d), gridOfY(mY + ny * d)) -
          sampleA(gridOfX(mX - nx * d), gridOfY(mY - ny * d))
      }
      if (side > 0) {
        nx = -nx
        ny = -ny
      }
      const oX = mX + nx * RIM_OUTBOARD_PX * inPerPx
      const oY = mY + ny * RIM_OUTBOARD_PX * inPerPx
      const ix = Math.round(m.minX + (oX / contentWin + 0.5) * (cW - 1)) + 1
      const iy = Math.round(m.minY + (0.5 - oY / contentHin) * (cH - 1)) + 1
      // Off the padded grid entirely is as exterior as it gets.
      const outboardIsExterior =
        ix < 0 || iy < 0 || ix >= W2 || iy >= H2 ? 1 : ext[iy * W2 + ix]
      if (!outboardIsExterior) {
        cOpen[p] = 1
        cOpen[q] = 1
      }
      cNx[p] += nx
      cNy[p] += ny
      cNx[q] += nx
      cNy[q] += ny
      segP.push(p)
      segQ.push(q)
      segNx.push(nx)
      segNy.push(ny)
    }

    // Marching squares on the padded alpha grid — the same 16-case table
    // `traceLoops` uses, with the crossing interpolated to the exact isovalue
    // on each edge.
    for (let j = 0; j + 1 < aRows; j++) {
      for (let i = 0; i + 1 < aCols; i++) {
        const i00 = j * aCols + i
        const i10 = i00 + 1
        const i01 = i00 + aCols
        const i11 = i01 + 1
        const a00 = A[i00]
        const a10 = A[i10]
        const a01 = A[i01]
        const a11 = A[i11]
        const b =
          ((a00 >= T ? 1 : 0) << 3) |
          ((a10 >= T ? 1 : 0) << 2) |
          ((a11 >= T ? 1 : 0) << 1) |
          (a01 >= T ? 1 : 0)
        if (b === 0 || b === 15) continue
        const eTop = () => crossing(2 * i00, i, j, i + 1, j, (T - a00) / (a10 - a00))
        const eRight = () => crossing(2 * (i00 + 1) + 1, i + 1, j, i + 1, j + 1, (T - a10) / (a11 - a10))
        const eBottom = () => crossing(2 * i01, i, j + 1, i + 1, j + 1, (T - a01) / (a11 - a01))
        const eLeft = () => crossing(2 * i00 + 1, i, j, i, j + 1, (T - a00) / (a01 - a00))
        switch (b) {
          case 1:
          case 14:
            addSeg(eLeft(), eBottom())
            break
          case 2:
          case 13:
            addSeg(eBottom(), eRight())
            break
          case 3:
          case 12:
            addSeg(eLeft(), eRight())
            break
          case 4:
          case 11:
            addSeg(eTop(), eRight())
            break
          case 6:
          case 9:
            addSeg(eTop(), eBottom())
            break
          case 7:
          case 8:
            addSeg(eTop(), eLeft())
            break
          case 5: // saddle: T-R and B-L
            addSeg(eTop(), eRight())
            addSeg(eBottom(), eLeft())
            break
          case 10: // saddle: T-L and B-R
            addSeg(eTop(), eLeft())
            addSeg(eBottom(), eRight())
            break
        }
      }
    }
    const nCross = cX.length
    if (!nCross || !segP.length) return null

    // --- rings ---------------------------------------------------------------
    const posF: number[] = []
    const norF: number[] = []
    const uvF: number[] = []
    const colF: number[] = []
    const posB: number[] = []
    const norB: number[] = []
    const uvB: number[] = []
    const colB: number[] = []
    const base = new Int32Array(nCross)
    const ringN = new Int32Array(nCross)
    for (let k = 0; k < nCross; k++) {
      let nx = cNx[k]
      let ny = cNy[k]
      const L = Math.hypot(nx, ny)
      if (L > 1e-9) {
        nx /= L
        ny /= L
      } else {
        nx = 1
        ny = 0
      }
      cNx[k] = nx
      cNy[k] = ny
      // Albedo is sampled INSIDE the cut, where the alpha is ≈1: the rim can
      // neither be eaten by its own alphaTest nor sample a feathered edge texel,
      // and it picks up the hem band / rib / stripe that is really there.
      const ux = cX[k] - nx * RIM_UV_INSET_IN
      const uy = cY[k] - ny * RIM_UV_INSET_IN
      const u = (m.minX + (ux / contentWin + 0.5) * cW) / m.W
      const v = 1 - (m.minY + (0.5 - uy / contentHin) * cH) / m.H
      const zF = cZF[k]
      const zB = cZB[k]
      const aoF = cAoF[k]
      const aoB = cAoB[k]
      const n3 = k * 3
      // rimFront and rimBack grow in lockstep (2 rings each on a seam, 3 each on
      // a cut edge), so one base index addresses both.
      base[k] = posF.length / 3
      const push = (
        pos: number[],
        nor: number[],
        uvA: number[],
        col: number[],
        z: number,
        nX: number,
        nY: number,
        nZ: number,
        ao: number,
        uu: number,
        proud: number,
      ): void => {
        pos.push(cX[k] + nx * proud, cY[k] + ny * proud, z)
        const nl = Math.hypot(nX, nY, nZ) || 1
        nor.push(nX / nl, nY / nl, nZ / nl)
        uvA.push(uu, v)
        col.push(ao, ao, ao)
      }
      const P = RIM_PROUD_IN
      if (cOpen[k]) {
        // OPEN CUT EDGE. Cap the roll at 40 % of the local gap so an opening in
        // a shallow part of the garment can never be sealed by its own cloth
        // thickness — the two skirts stay gap − 2·skirt apart.
        const skirt = Math.min(FABRIC_IN, Math.max(RIM_MIN_RING_IN, (zF - zB) * 0.4))
        const aoIn = Math.max(0.72, aoF * RIM_CUT_AO)
        const aoInB = Math.max(0.72, aoB * RIM_CUT_AO)
        ringN[k] = RIM_RINGS
        push(posF, norF, uvF, colF, zF, cNF[n3], cNF[n3 + 1], cNF[n3 + 2], aoF, u, 0)
        push(posF, norF, uvF, colF, zF - skirt / 2, cNF[n3] + nx, cNF[n3 + 1] + ny, cNF[n3 + 2], (aoF + aoIn) / 2, u, P)
        push(posF, norF, uvF, colF, zF - skirt, nx, ny, 0, aoIn, u, P)
        push(posB, norB, uvB, colB, zB, cNB[n3], cNB[n3 + 1], cNB[n3 + 2], aoB, 1 - u, 0)
        push(posB, norB, uvB, colB, zB + skirt / 2, cNB[n3] + nx, cNB[n3 + 1] + ny, cNB[n3 + 2], (aoB + aoInB) / 2, 1 - u, P)
        push(posB, norB, uvB, colB, zB + skirt, nx, ny, 0, aoInB, 1 - u, P)
      } else {
        // CLOSED SEAM. No extra darkening anywhere on it: a convex fold is not
        // occluded, and the linings' ×0.6 is for a wall.
        const zM = (zF + zB) / 2
        const zf = Math.max(zF, zM + RIM_MIN_RING_IN)
        const zb = Math.min(zB, zM - RIM_MIN_RING_IN)
        const aoM = (aoF + aoB) / 2
        ringN[k] = 2
        push(posF, norF, uvF, colF, zf, cNF[n3], cNF[n3 + 1], cNF[n3 + 2], aoF, u, 0)
        push(posF, norF, uvF, colF, zM, nx, ny, 0, aoM, u, P)
        push(posB, norB, uvB, colB, zM, nx, ny, 0, aoM, 1 - u, P)
        push(posB, norB, uvB, colB, zb, cNB[n3], cNB[n3 + 1], cNB[n3 + 2], aoB, 1 - u, 0)
      }
    }

    // --- quads ---------------------------------------------------------------
    const idxF: number[] = []
    const idxB: number[] = []
    for (let s = 0; s < segP.length; s++) {
      let p = segP[s]
      let q = segQ[s]
      // A crossing shared by an outer-contour segment and a hole segment can
      // only happen where erosion has welded a hole to the outline; the two
      // sides then disagree about how many rings there are, so drop the one
      // quad rather than stitch mismatched strips.
      if (ringN[p] !== ringN[q]) continue
      // Wind so the strip faces OUT of the cloth: Scene Viewer culls back faces
      // aggressively, and an inverted segment reopens the slot in AR while
      // looking fine in a DoubleSide-tolerant preview.
      if ((cY[q] - cY[p]) * segNx[s] - (cX[q] - cX[p]) * segNy[s] < 0) {
        const t = p
        p = q
        q = t
      }
      for (const [pos, idx] of [
        [posF, idxF],
        [posB, idxB],
      ] as const) {
        for (let r = 0; r + 1 < ringN[p]; r++) {
          const a = base[p] + r
          const bb = base[q] + r
          const c = a + 1
          const d = bb + 1
          if (pos[c * 3 + 2] - pos[a * 3 + 2] >= 0) idx.push(a, bb, c, bb, d, c)
          else idx.push(a, c, bb, bb, c, d)
        }
      }
    }
    if (!idxF.length || !idxB.length) return null

    const geoOf = (
      pos: number[],
      nor: number[],
      uvA: number[],
      col: number[],
      idx: number[],
    ): THREE.BufferGeometry | null => {
      for (const v of pos) if (!Number.isFinite(v)) return null
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3))
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3))
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvA), 2))
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3))
      const n = pos.length / 3
      g.setIndex(
        new THREE.BufferAttribute(n < 65536 ? new Uint16Array(idx) : new Uint32Array(idx), 1),
      )
      g.computeBoundingBox()
      g.computeBoundingSphere()
      return g
    }
    const rimFront = geoOf(posF, norF, uvF, colF, idxF)
    const rimBack = geoOf(posB, norB, uvB, colB, idxB)
    if (!rimFront || !rimBack) {
      rimFront?.dispose()
      rimBack?.dispose()
      return null
    }
    return { rimFront, rimBack }
  }
  const rim = rimOn ? buildRim() : null

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
    rimFront: rim?.rimFront ?? null,
    rimBack: rim?.rimBack ?? null,
    normalMapCanvas: normalMapCanvas ?? undefined,
    albedoCanvas,
    albedoSpread,
    depthIn: bulge + bulgeBack,
    contentWIn: contentWin,
    contentHIn: contentHin,
    depthSource: depth ? 'template' : 'poisson',
    shape,
    depthTemplate: depth?.template,
    templateIoU: depth?.iou ?? 0,
    structure: structure ?? undefined,
  }
}
