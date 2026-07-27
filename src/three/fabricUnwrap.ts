/**
 * Fabric-space unwrap — "how many inches of real cloth is this point from the
 * centre-front line?".
 *
 * WHY THIS EXISTS
 * ---------------
 * A print is a physical rectangle of ink laid on cloth. The 2D editor stores it
 * in inches from the print-area centre; the DTF sheet cuts it in centimetres.
 * For the 3D preview to agree, the garment surface needs a coordinate that is
 * ALSO measured in inches of cloth — not the chord of an orthographic
 * projection, which is what a projected decal gives (a 10 cm logo on the chest
 * lands on ~15 cm of fabric there, stretched non-uniformly across itself).
 *
 * So: slice the mesh into height bands, walk each band's cross-section, and
 * accumulate arc outward from θ = 0. `s(y, θ)` is then arc length along the
 * cloth, and a print rect in `s` is a print rect on the cloth. The garment mesh
 * becomes its own sewing pattern — which is exactly what tee.glb's artist-made
 * UV atlas already is, and validating against that atlas is how this table is
 * proven (scripts/fabric-verify.mjs: residual rms 1.5 mm over the print area).
 *
 * WHY "OUTERMOST RADIUS" IS NOT ENOUGH
 * ------------------------------------
 * The obvious rule — per angle, take the farthest surface — measures the hood,
 * the kangaroo pocket and the A-pose sleeves as if they were the torso, and the
 * hoodie's per-band front arc then jitters ±40 %. So instead we march outward
 * from the centre front and, at every angle, take the candidate radius CLOSEST
 * to the previous angle's: continuity, not extremity.
 *
 * Continuity alone is still not enough, and the failure is instructive. A sleeve
 * is not a detached lobe — it is SEWN to the torso, so at the armhole its
 * surface really is continuous with the body's, and a step-by-step march happily
 * walks up the ramp and out along the arm (measured: the hoodie's shell hit
 * r = 0.40 where the torso is 0.19). Continuity is therefore paired with a
 * budget: no band's shell may exceed RADIUS_CAP × that band's MEDIAN radius. The
 * median is a torso statistic — sleeves occupy ~10 % of the angles and cannot
 * move it — while the cap is loose enough for a real cross-section, whose
 * side-to-front radius ratio is about 1.4. Measured spread afterwards: 3.6 %
 * (tee) and 6.0 % (hoodie) over the chest band, against ±40 % unguarded.
 *
 * WHERE THIS IS KNOWN TO BE APPROXIMATE
 * -------------------------------------
 * A panel can have a SECOND panel lying on it: the hoodie's hood covers the top
 * of its back, its kangaroo pocket the bottom of its front. There, "how many
 * inches of cloth is this" has no single answer, and the honest evidence for
 * that is that the two independent ground truths scripts/fabric-verify.mjs can
 * build — a connectivity loop walk and a radial walk — disagree with EACH OTHER
 * by up to ~17 mm on those rows while agreeing to 0.1 mm everywhere else. The
 * verifier therefore gates only the rows where they agree, and reports the rest.
 * Measured consequence: the extreme top row of a hoodie back print (which the
 * hood physically covers anyway) carries ~1 cm of placement uncertainty. Every
 * row of a tee, and every non-overlapped hoodie row, is inside 0.5 mm.
 *
 * Everything here is in the mesh's RAW glb units and is therefore independent of
 * garment size: one table per model, built once, cached forever. Callers convert
 * with the normalization scales (see calibration.ts).
 *
 * DETERMINISM: pure function of the vertex buffer. No randomness, no time.
 */
import type * as THREE from 'three'

/** Height bands. 96 ≈ 0.3 in per band on a normalized tee — finer than any
 *  vertical detail the arc integral can resolve, coarse enough to stay cheap. */
const BANDS = 96
/** Angular samples over [−π, π]. 361 ⇒ exactly 1° and an exact θ = 0 sample. */
const ANGLES = 361
/** Max candidate radii kept per (band, angle). A hoodie cross-section under the
 *  hood has ≤ 4 shells; 8 is slack. */
const MAX_CANDIDATES = 8
/** A neighbouring angle may change the radius by this fraction of it… */
const JUMP_FRAC = 0.22
/** …or this fraction of the band's median radius, whichever is larger (so a
 *  thin fold near the centre line does not lock the march to a hair-trigger). */
const JUMP_FLOOR = 0.02
/** A band needs this share of its angles to carry fabric to count as a real
 *  closed cross-section (the collar and hood are open shells and fail it). */
const BAND_COVERAGE = 0.9
/** Ceiling on the shell radius, as a multiple of the band's median radius. A
 *  real garment cross-section runs ~1.4× from centre-front to side seam; an
 *  A-pose sleeve or a hood runs 2–3×, and this is what stops the march from
 *  following one out (see the header). */
const RADIUS_CAP = 1.5

export interface ArcTable {
  bands: number
  angles: number
  /** Raw-unit y of the first / last band centre's enclosing range. */
  yLoRaw: number
  yHiRaw: number
  /** [bands*angles] outermost CONTIGUOUS shell radius, raw units. */
  r: Float32Array
  /** [bands*angles] signed arc from θ = 0, raw units (+ = wearer's left). */
  s: Float32Array
  /** [bands] half the cross-section perimeter, raw units. */
  halfPerimRaw: Float32Array
  /** Front-panel arc (θ ∈ [−90°, 90°]) at the chest reference band, raw units. */
  frontArcRaw: number
  /** Max−min of that arc across the chest band, relative to its median. */
  frontArcSpread: number
  /** Share of bands that produced a real closed cross-section. */
  bandsOk: number
  /** False ⇒ do not map prints through this table (caller falls back). */
  usable: boolean
}

/**
 * Build the table from a geometry already baked to scene orientation and
 * CENTRED on its bounding box (the same state useNormalizedGarment produces
 * before scaling), in raw units.
 *
 * `chestBand` is the [fromTop, fromTop] window, as fractions of the raw bbox
 * height, where the garment is a clean torso — below the armholes, above the
 * pocket. It is a per-model calibration because only the model knows where its
 * own sleeves attach (see CALIBRATION.chestBandFromTop).
 */
export function buildArcTable(
  position: ArrayLike<number>,
  index: ArrayLike<number>,
  chestBand: readonly [number, number],
): ArcTable {
  const nb = BANDS
  const na = ANGLES
  const mid = (na - 1) / 2
  const dth = (2 * Math.PI) / (na - 1)

  let yLo = Infinity
  let yHi = -Infinity
  for (let i = 1; i < position.length; i += 3) {
    const y = position[i]
    if (y < yLo) yLo = y
    if (y > yHi) yHi = y
  }
  const span = yHi - yLo || 1

  // Bucket triangles by the bands they straddle so each band only walks its own.
  const cell = span / nb
  const counts = new Uint32Array(nb)
  const triCount = Math.floor(index.length / 3)
  const bandOfY = (y: number) => (y - yLo) / cell - 0.5
  for (let t = 0; t < triCount; t++) {
    const a = index[t * 3] * 3
    const b = index[t * 3 + 1] * 3
    const c = index[t * 3 + 2] * 3
    const lo = Math.min(position[a + 1], position[b + 1], position[c + 1])
    const hi = Math.max(position[a + 1], position[b + 1], position[c + 1])
    const j0 = Math.max(0, Math.floor(bandOfY(lo)))
    const j1 = Math.min(nb - 1, Math.ceil(bandOfY(hi)))
    for (let j = j0; j <= j1; j++) counts[j]++
  }
  const start = new Uint32Array(nb + 1)
  for (let j = 0; j < nb; j++) start[j + 1] = start[j] + counts[j]
  const fill = Uint32Array.from(start.subarray(0, nb))
  const bucket = new Uint32Array(start[nb])
  for (let t = 0; t < triCount; t++) {
    const a = index[t * 3] * 3
    const b = index[t * 3 + 1] * 3
    const c = index[t * 3 + 2] * 3
    const lo = Math.min(position[a + 1], position[b + 1], position[c + 1])
    const hi = Math.max(position[a + 1], position[b + 1], position[c + 1])
    const j0 = Math.max(0, Math.floor(bandOfY(lo)))
    const j1 = Math.min(nb - 1, Math.ceil(bandOfY(hi)))
    for (let j = j0; j <= j1; j++) bucket[fill[j]++] = t
  }

  const r = new Float32Array(nb * na)
  const s = new Float32Array(nb * na)
  const halfPerimRaw = new Float32Array(nb)
  const bandOk = new Uint8Array(nb)
  const candR = new Float32Array(na * MAX_CANDIDATES)
  const candN = new Uint8Array(na)
  const outer = new Float64Array(na)
  const march = new Float64Array(na)

  for (let b = 0; b < nb; b++) {
    const y = yLo + (span * (b + 0.5)) / nb
    candN.fill(0)
    let segCount = 0
    for (let p = start[b]; p < start[b + 1]; p++) {
      const t = bucket[p] * 3
      const ia = index[t] * 3
      const ib = index[t + 1] * 3
      const ic = index[t + 2] * 3
      const ya = position[ia + 1]
      const yb = position[ib + 1]
      const yc = position[ic + 1]
      if (Math.max(ya, yb, yc) < y || Math.min(ya, yb, yc) > y) continue
      // The plane y = const cuts a triangle in exactly two points (or in a
      // degenerate edge, which we skip: it contributes no cross-section).
      // Unrolled — this runs ~100k times per model and must not allocate.
      let n = 0
      let x0 = 0
      let z0 = 0
      let x1 = 0
      let z1 = 0
      if ((ya - y) * (yb - y) <= 0 && ya !== yb) {
        const f = (y - ya) / (yb - ya)
        x0 = position[ia] + f * (position[ib] - position[ia])
        z0 = position[ia + 2] + f * (position[ib + 2] - position[ia + 2])
        n = 1
      }
      if ((yb - y) * (yc - y) <= 0 && yb !== yc) {
        const f = (y - yb) / (yc - yb)
        const px = position[ib] + f * (position[ic] - position[ib])
        const pz = position[ib + 2] + f * (position[ic + 2] - position[ib + 2])
        if (n === 0) { x0 = px; z0 = pz; n = 1 } else { x1 = px; z1 = pz; n = 2 }
      }
      if (n < 2 && (yc - y) * (ya - y) <= 0 && yc !== ya) {
        const f = (y - yc) / (ya - yc)
        const px = position[ic] + f * (position[ia] - position[ic])
        const pz = position[ic + 2] + f * (position[ia + 2] - position[ic + 2])
        if (n === 0) { x0 = px; z0 = pz; n = 1 } else { x1 = px; z1 = pz; n = 2 }
      }
      if (n < 2) continue
      segCount++
      // Rays from the mesh axis: only the angles this segment spans can hit it.
      const ta = Math.atan2(x0, z0)
      const tb = Math.atan2(x1, z1)
      const thLo = ta < tb ? ta : tb
      const thHi = ta < tb ? tb : ta
      let kFrom: number
      let kTo: number
      if (thHi - thLo > Math.PI) { kFrom = 0; kTo = na - 1 } else {
        kFrom = Math.max(0, Math.floor(((thLo + Math.PI) / (2 * Math.PI)) * (na - 1)))
        kTo = Math.min(na - 1, Math.ceil(((thHi + Math.PI) / (2 * Math.PI)) * (na - 1)))
      }
      const segX = x1 - x0
      const segZ = z1 - z0
      for (let k = kFrom; k <= kTo; k++) {
        const th = -Math.PI + (2 * Math.PI * k) / (na - 1)
        const dx = Math.sin(th)
        const dz = Math.cos(th)
        const den = segX * dz - segZ * dx
        if (den > -1e-12 && den < 1e-12) continue
        const tt = (z0 * dx - x0 * dz) / den
        if (tt < 0 || tt > 1) continue
        const rr = Math.abs(dx) > Math.abs(dz) ? (x0 + tt * segX) / dx : (z0 + tt * segZ) / dz
        if (rr <= 1e-9) continue
        const c = candN[k]
        if (c < MAX_CANDIDATES) { candR[k * MAX_CANDIDATES + c] = rr; candN[k] = c + 1 }
      }
    }
    if (segCount < 8 || candN[mid] === 0) continue

    let covered = 0
    for (let k = 0; k < na; k++) {
      let m = 0
      for (let c = 0; c < candN[k]; c++) if (candR[k * MAX_CANDIDATES + c] > m) m = candR[k * MAX_CANDIDATES + c]
      outer[k] = m
      if (m > 0) covered++
    }
    if (covered < na * BAND_COVERAGE) continue
    const sorted = Float64Array.from(outer).sort()
    const rMed = sorted[na >> 1]
    const rCap = RADIUS_CAP * rMed

    const pick = (k: number, prev: number): number => {
      const lim = Math.max(JUMP_FRAC * prev, JUMP_FLOOR * rMed)
      let best = prev
      let bestD = Infinity
      for (let c = 0; c < candN[k]; c++) {
        const r = candR[k * MAX_CANDIDATES + c]
        // Over the cap this is a sleeve or a hood, whatever the mesh calls it.
        if (r > rCap) continue
        const d = Math.abs(r - prev)
        if (d < bestD) { bestD = d; best = r }
      }
      return bestD <= lim ? best : prev
    }
    march[mid] = Math.min(outer[mid], rCap)
    for (let k = mid + 1; k < na; k++) march[k] = pick(k, march[k - 1])
    for (let k = mid - 1; k >= 0; k--) march[k] = pick(k, march[k + 1])
    // 3-tap angular median: kills a single-sample spike before it becomes a
    // spurious dr/dθ (a seam vertex sitting a hair off the shell).
    const base = b * na
    for (let k = 0; k < na; k++) {
      const p = march[k > 0 ? k - 1 : 0]
      const q = march[k]
      const w = march[k < na - 1 ? k + 1 : na - 1]
      r[base + k] = Math.max(Math.min(p, q), Math.min(Math.max(p, q), w))
    }
    bandOk[b] = 1
  }

  // Collar / hem / hood bands never receive ink, but bilinear lookups must not
  // read zeros from them — copy the nearest real band's profile.
  let okCount = 0
  for (let b = 0; b < nb; b++) if (bandOk[b]) okCount++
  if (okCount === 0) {
    return {
      bands: nb, angles: na, yLoRaw: yLo, yHiRaw: yHi, r, s, halfPerimRaw,
      frontArcRaw: 0, frontArcSpread: Infinity, bandsOk: 0, usable: false,
    }
  }
  for (let b = 0; b < nb; b++) {
    if (bandOk[b]) continue
    let near = -1
    for (let d = 1; d < nb; d++) {
      if (b - d >= 0 && bandOk[b - d]) { near = b - d; break }
      if (b + d < nb && bandOk[b + d]) { near = b + d; break }
    }
    if (near >= 0) r.copyWithin(b * na, near * na, near * na + na)
  }

  // Arc as the CHORD LENGTH of the sampled polar curve, i.e. ∫√(r² + (dr/dθ)²)dθ
  // evaluated the way that survives real data: a chord needs no derivative, so
  // there is no dr/dθ to estimate off a wrinkled mesh and no clamp to invent.
  // A finite-difference derivative squared under a square root is biased UP by
  // sampling noise; on the hoodie's back, where r swings 4.9→7.5 in over 50°,
  // that bias reached 10 mm. The chord underestimates a smooth curve by only
  // dθ²/24 — 1.3 × 10⁻⁵ relative at 1° — and matches, to that precision, arc
  // walked directly along the mesh's own cross-section (scripts/fabric-verify.mjs).
  for (let b = 0; b < nb; b++) {
    const base = b * na
    const chord = (i: number, j: number): number => {
      const ri = r[base + i]
      const rj = r[base + j]
      const ti = -Math.PI + i * dth
      const tj = -Math.PI + j * dth
      return Math.hypot(ri * Math.sin(ti) - rj * Math.sin(tj), ri * Math.cos(ti) - rj * Math.cos(tj))
    }
    s[base + mid] = 0
    for (let k = mid + 1; k < na; k++) s[base + k] = s[base + k - 1] + chord(k - 1, k)
    for (let k = mid - 1; k >= 0; k--) s[base + k] = s[base + k + 1] - chord(k, k + 1)
  }
  // NO vertical smoothing of s. It was tried, and it costs more than it buys:
  // lookups are already bilinear in (band, angle), so the map is continuous
  // without it, while blending bands biases the arc wherever the cross-section
  // changes fast with height — the armhole, the hood, the hem. Measured on the
  // hoodie's upper back, a 3-tap vertical blend added ~3 mm of placement error.
  for (let b = 0; b < nb; b++) halfPerimRaw[b] = (s[b * na + na - 1] - s[b * na]) / 2

  // Chest reference: the median front arc over the calibrated clean-torso band.
  const quarter = (na - 1) / 4
  const arcs: number[] = []
  for (let b = 0; b < nb; b++) {
    if (!bandOk[b]) continue
    const fromTop = (yHi - (yLo + (span * (b + 0.5)) / nb)) / span
    if (fromTop < chestBand[0] || fromTop > chestBand[1]) continue
    arcs.push(s[b * na + mid + quarter] - s[b * na + mid - quarter])
  }
  arcs.sort((p, q) => p - q)
  const frontArcRaw = arcs.length ? arcs[arcs.length >> 1] : 0
  const frontArcSpread = arcs.length && frontArcRaw > 0 ? (arcs[arcs.length - 1] - arcs[0]) / frontArcRaw : Infinity
  const bandsOk = okCount / nb

  return {
    bands: nb,
    angles: na,
    yLoRaw: yLo,
    yHiRaw: yHi,
    r,
    s,
    halfPerimRaw,
    frontArcRaw,
    frontArcSpread,
    bandsOk,
    // Health gate. A mesh whose chest band still jitters, or which never closed
    // a cross-section, gets NO fabric mapping — the caller keeps the projected
    // decal rather than painting ink somewhere invented.
    usable: frontArcRaw > 0 && frontArcSpread < 0.2 && bandsOk > 0.5,
  }
}

// ------------------------------------------------------------------- lookups

const bandCoord = (t: ArcTable, yRaw: number): number =>
  Math.max(0, Math.min(t.bands - 1.001, ((yRaw - t.yLoRaw) / (t.yHiRaw - t.yLoRaw)) * t.bands - 0.5))

const angleCoord = (t: ArcTable, theta: number): number =>
  Math.max(0, Math.min(t.angles - 1.001, ((theta + Math.PI) / (2 * Math.PI)) * (t.angles - 1)))

function bilinear(grid: Float32Array, t: ArcTable, fb: number, fk: number): number {
  const b0 = Math.floor(fb)
  const k0 = Math.floor(fk)
  const fy = fb - b0
  const fx = fk - k0
  const row0 = b0 * t.angles + k0
  const row1 = row0 + t.angles
  return (
    (1 - fy) * ((1 - fx) * grid[row0] + fx * grid[row0 + 1]) +
    fy * ((1 - fx) * grid[row1] + fx * grid[row1 + 1])
  )
}

/** Signed arc from the centre-front line to (x, y, z), raw units. */
export function arcAt(t: ArcTable, xRaw: number, yRaw: number, zRaw: number): number {
  return bilinear(t.s, t, bandCoord(t, yRaw), angleCoord(t, Math.atan2(xRaw, zRaw)))
}

/** Radius of the printable shell at (y, θ), raw units. */
export function shellRadiusAt(t: ArcTable, yRaw: number, theta: number): number {
  return bilinear(t.r, t, bandCoord(t, yRaw), angleCoord(t, theta))
}

/** Half the cross-section perimeter at a height, raw units. */
export function halfPerimAt(t: ArcTable, yRaw: number): number {
  const fb = bandCoord(t, yRaw)
  const b0 = Math.floor(fb)
  const f = fb - b0
  return (1 - f) * t.halfPerimRaw[b0] + f * t.halfPerimRaw[b0 + 1]
}

/**
 * Arc to the centre-BACK line, reached the long way round through θ = +π
 * (`positiveSide`) or θ = −π. Raw units, signed.
 *
 * These are two different numbers on any real garment: a draped mesh is not
 * left-right symmetric, and the two half-arcs differ by a few millimetres. The
 * back panel must be referenced to the seam it is actually approaching, not to
 * their average — averaging shifts the whole back print sideways by half the
 * difference, which measured 10 mm on the hoodie's upper back.
 */
export function backSeamArcAt(t: ArcTable, yRaw: number, positiveSide: boolean): number {
  const fb = bandCoord(t, yRaw)
  const b0 = Math.floor(fb)
  const f = fb - b0
  const k = positiveSide ? t.angles - 1 : 0
  return (1 - f) * t.s[b0 * t.angles + k] + f * t.s[(b0 + 1) * t.angles + k]
}

/**
 * Inverse of `arcAt`: the angle whose arc from the centre front is `sRaw`.
 *
 * The bisection runs on the BAND-BLENDED profile, not on each band separately.
 * That is not a refinement, it is the whole point: `arcAt` is bilinear, and a
 * bilinear factorises exactly into "blend the two bands' rows, then interpolate
 * in θ" — so inverting the blended row is an EXACT inverse, while solving each
 * band and averaging the two angles is not an inverse at all.
 *
 * The difference is worst precisely where it hurts. Adjacent bands' half-arcs
 * can differ by inches across an armhole; there the per-band solve clamps one
 * band at ±π while the other walks tens of degrees, and the averaged angle put
 * the centre-BACK column of a print up to 25 mm off the seam it is defined to
 * sit on — a shift the 3D preview (which uses `arcAt` directly) did not share,
 * so preview and AR disagreed. Blending first removes the failure mode.
 *
 * s is monotone in θ within a band (chords are non-negative), so the blend of
 * two bands is monotone too and the bisection is well-posed.
 */
export function thetaAtArc(t: ArcTable, yRaw: number, sRaw: number): number {
  const fb = bandCoord(t, yRaw)
  const b0 = Math.floor(fb)
  const f = fb - b0
  const base0 = b0 * t.angles
  const base1 = base0 + t.angles
  const at = (k: number): number => (1 - f) * t.s[base0 + k] + f * t.s[base1 + k]
  let hi = t.angles - 1
  if (sRaw <= at(0)) return -Math.PI
  if (sRaw >= at(hi)) return Math.PI
  let lo = 0
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1
    if (at(m) <= sRaw) lo = m
    else hi = m
  }
  const a = at(lo)
  const c = at(hi)
  const frac = c > a ? (sRaw - a) / (c - a) : 0
  return -Math.PI + (2 * Math.PI * (lo + frac)) / (t.angles - 1)
}

// --------------------------------------------------------------------- cache

const CACHE = new Map<string, ArcTable>()

/**
 * Memoised table for a model. The key must identify the MESH (its url), not the
 * size: the table is in raw units, so every size shares it.
 *
 * Positions are read through the attribute's ACCESSORS, never `.array`. Half the
 * catalog is exported by glTF-Transform, which interleaves POSITION and NORMAL
 * into one buffer — `.array` then hands back normals disguised as vertices, and
 * the unwrap quietly measures a unit sphere. (That is not hypothetical: it is
 * exactly what hoodie.glb does.)
 */
export function getArcTable(
  key: string,
  geometry: THREE.BufferGeometry,
  chestBand: readonly [number, number],
): ArcTable {
  const hit = CACHE.get(key)
  if (hit) return hit
  const table = buildArcTable(packXYZ(geometry, 'position'), packIndex(geometry), chestBand)
  CACHE.set(key, table)
  return table
}

/** A tightly packed xyz copy of a vertex attribute, interleaved or not. */
export function packXYZ(geometry: THREE.BufferGeometry, name: string): Float32Array {
  const a = geometry.getAttribute(name)
  const out = new Float32Array(a.count * 3)
  for (let i = 0; i < a.count; i++) {
    out[i * 3] = a.getX(i)
    out[i * 3 + 1] = a.getY(i)
    out[i * 3 + 2] = a.getZ(i)
  }
  return out
}

/** The geometry's triangle list, synthesised when the mesh is non-indexed. */
export function packIndex(geometry: THREE.BufferGeometry): Uint32Array {
  const index = geometry.getIndex()
  if (index) return Uint32Array.from(index.array as ArrayLike<number>)
  const out = new Uint32Array(geometry.getAttribute('position').count)
  for (let i = 0; i < out.length; i++) out[i] = i
  return out
}
