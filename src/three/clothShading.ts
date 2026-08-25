/**
 * CLOTH SHADING — the two things that separate a 3D balloon from a photograph
 * of a cotton garment, both derived from the mesh we already ship. No new art
 * assets, no new dependencies, no change to geometry, UVs or inch accuracy.
 *
 * 1. CAVITY OCCLUSION (`computeCavity`, a per-vertex multiplier)
 *    Soft image-based lighting is what makes the preview look expensive, and it
 *    is also what makes it look INFLATED: an env map delivers light from every
 *    direction, so a crease receives exactly as much as the ridge beside it and
 *    every fold flattens out. Real cloth is dark where it folds into itself.
 *    We approximate that occlusion from the mesh alone: Laplacian-smooth the
 *    surface and measure how far each vertex had to travel ALONG ITS NORMAL to
 *    reach the smoothed version. Positive ⇒ the neighbourhood sits outside the
 *    vertex ⇒ it is in a hollow ⇒ darken. Negative ⇒ it rides a fold crest ⇒
 *    leave it, or lift it a hair. Two smoothing scales are measured because the
 *    effect has two scales: a seam crease (fine) and the hollow under an arm or
 *    inside a hood (broad).
 *
 *    Why not a real AO bake: hemisphere ray casting over 36 k vertices needs an
 *    acceleration structure this project does not carry, and would cost seconds
 *    on the main thread at load. Cavity is O(V · iterations), runs in ~100 ms,
 *    is cached per model, and captures the term that actually reads — contact
 *    darkening — while missing only distant occlusion, which soft studio light
 *    barely produces anyway.
 *
 * 2. WEAVE BUMP (`clothShaderChunks`, injected into the material)
 *    A knit surface has a directional micro-relief roughly 1 mm across. Without
 *    it the fabric returns light like moulded vinyl. The tee GLB ships a tiled
 *    normal map on its own UVs, but the hoodie GLB has NO UV set at all, so a
 *    texture-based detail map cannot cover both. Instead the relief is
 *    evaluated procedurally from the OBJECT-SPACE position, triplanar-blended,
 *    with an analytic gradient — seamless on any mesh, UV-free, correct on
 *    sleeves and hood, and physically scaled because 1 world unit is 1 inch.
 *
 *    A 1 mm thread pitch is SMALLER THAN A SCREEN PIXEL at every framing the
 *    app actually uses (the garment is ~30 px/in in the studio pane, a thread
 *    is 0.045 in ⇒ 1.3 px per period), so the Nyquist fade below correctly
 *    takes the bump to zero — and for a long time that meant the octave whose
 *    whole job is "this is cotton, not vinyl" contributed literally nothing
 *    except when zoomed to the dolly limit. Sub-pixel relief does not vanish in
 *    the real world, it becomes ROUGHNESS: a surface too fine to resolve
 *    scatters into a wider lobe instead of returning a sharp highlight. So the
 *    energy the fade removes is handed to `roughnessFactor` (`uWeaveRough`, the
 *    Toksvig/LEAN idea in its cheapest useful form). That is what keeps the
 *    cloth reading the same from across the room and from an inch away.
 *
 * 3. DRAPE OCTAVE — the SECOND, hand-span-scale field, and the one that has to
 *    be handled with the most suspicion, because it is the one term here with
 *    no geometry behind it. It used to be `sin(2π·x/λ + 1.7·sin(2.1·y/λ))`: a
 *    function of x alone plus a y-warp identical for every stripe, i.e. eight
 *    parallel, identically-wobbling vertical ridges 2.6 in apart, tilting the
 *    shading normal 18° at the crest. That is not drape, it is corrugated iron,
 *    and it is exactly what a customer described as "bumps after freezing in
 *    Alaska". It is now two octaves of gradient noise with an ANALYTIC
 *    derivative (same reason the weave differentiates a sum of sines rather
 *    than finite-differencing it), anisotropically stretched down the garment
 *    because cloth hangs, and scaled by a SLACK ramp: a worn tee is taut across
 *    the chest and pools at the hem, so a constant-amplitude fold field is
 *    wrong everywhere. Measured over the same domain the old field had mean
 *    |∇| 4.30 of a 7.23 peak — "on" over the entire garment; the noise field
 *    has mean 1.17 of a 5.39 peak, so the cloth is mostly quiet and folds where
 *    a fold is.
 *
 * WHY OBJECT SPACE, NOT WORLD. Object space is glued to the fabric, which is
 * what a weave is: a world-space pattern would swim across the cloth whenever
 * the garment moved relative to the world. It USED to move for a second
 * reason, a drei <Float> idle sway, which is gone (it seeded its phase from
 * Math.random(), so no two renders of one design were comparable and no mockup
 * could be produced twice). The orbit controls are reason enough on their own.
 */
import * as THREE from 'three'

// ---------------------------------------------------------------------------
// 1. Cavity occlusion
// ---------------------------------------------------------------------------

export interface CavityOptions {
  /** Laplacian iterations for the fine pass (seams, small creases). */
  fine: number
  /** …and for the broad pass (armpit hollow, inside of a hood). */
  broad: number
  /** How hard a hollow darkens. */
  gain: number
  /** How much a crest brightens — small; cloth does not gain energy. */
  lift: number
  /** Darkest a vertex may get, so nothing ever crushes to black. */
  floor: number
}

/**
 * `gain` and `lift` are FRACTIONS OF FULL DARKENING (0–1), because the raw
 * displacement is normalised against the mesh's own crease-depth distribution
 * (see `CAVITY_SIGMAS`) rather than against an absolute length. Measured
 * against the bounding diagonal instead — the obvious choice, and the one this
 * shipped with for an afternoon — a crease is a rounding error next to a whole
 * garment: the multiplier came out spanning 0.944…1.016 on the hoodie, a 5 %
 * wobble doing none of the work it exists for. Normalising per mesh also means
 * one constant reads the same on a 10 k-vertex tee and a 36 k-vertex hoodie.
 */
export const CAVITY_DEFAULTS: CavityOptions = {
  fine: 5,
  broad: 28,
  gain: 0.42,
  lift: 0.06,
  floor: 0.42,
}

/**
 * How many standard deviations of measured depth count as a full hollow. At
 * 2.5 the deepest few per cent of the surface reaches the full `gain` and the
 * flat majority of the cloth stays untouched, which is how occlusion actually
 * distributes on a garment.
 */
const CAVITY_SIGMAS = 2.5

/** Laplacian step. Below 1 for stability; 0.62 converges without ringing. */
const LAMBDA = 0.62

interface Weld {
  /** Vertex index → welded (position-unique) index. */
  of: Int32Array
  count: number
}

/**
 * Merge vertices that share a position. The GLBs split vertices along UV and
 * shading seams, and an adjacency graph built from raw indices is therefore
 * CUT at exactly those seams — which would stamp the seam pattern into the
 * occlusion as bright piping down the shoulders. Welding on position restores
 * the surface the smoothing has to run on.
 *
 * The grid is relative to the mesh's own extent, so it is scale-free: 1e-5 of
 * the bounding diagonal is far below any real feature and far above the float
 * noise of an exporter.
 */
function weldByPosition(pos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, diag: number): Weld {
  const q = Math.max(diag * 1e-5, 1e-9)
  const map = new Map<string, number>()
  const of = new Int32Array(pos.count)
  let count = 0
  for (let i = 0; i < pos.count; i++) {
    const key = `${Math.round(pos.getX(i) / q)},${Math.round(pos.getY(i) / q)},${Math.round(pos.getZ(i) / q)}`
    let id = map.get(key)
    if (id === undefined) {
      id = count++
      map.set(key, id)
    }
    of[i] = id
  }
  return { of, count }
}

/** Neighbour lists in CSR form, built from the triangle list over welded ids. */
function buildAdjacency(index: ArrayLike<number>, weld: Weld): { start: Int32Array; nbr: Int32Array } {
  const n = weld.count
  const degree = new Int32Array(n)
  const edge = (a: number, b: number) => {
    degree[a]++
    degree[b]++
  }
  for (let t = 0; t < index.length; t += 3) {
    const a = weld.of[index[t]]
    const b = weld.of[index[t + 1]]
    const c = weld.of[index[t + 2]]
    edge(a, b)
    edge(b, c)
    edge(c, a)
  }
  const start = new Int32Array(n + 1)
  for (let i = 0; i < n; i++) start[i + 1] = start[i] + degree[i]
  const cursor = start.slice(0, n)
  const nbr = new Int32Array(start[n])
  const put = (a: number, b: number) => {
    nbr[cursor[a]++] = b
    nbr[cursor[b]++] = a
  }
  for (let t = 0; t < index.length; t += 3) {
    const a = weld.of[index[t]]
    const b = weld.of[index[t + 1]]
    const c = weld.of[index[t + 2]]
    put(a, b)
    put(b, c)
    put(c, a)
  }
  return { start, nbr }
}

/** One explicit Laplacian pass, writing into `dst`. */
function smoothOnce(src: Float32Array, dst: Float32Array, adj: { start: Int32Array; nbr: Int32Array }, n: number) {
  for (let i = 0; i < n; i++) {
    const s = adj.start[i]
    const e = adj.start[i + 1]
    const deg = e - s
    const o = i * 3
    if (deg === 0) {
      dst[o] = src[o]
      dst[o + 1] = src[o + 1]
      dst[o + 2] = src[o + 2]
      continue
    }
    let ax = 0
    let ay = 0
    let az = 0
    for (let k = s; k < e; k++) {
      const p = adj.nbr[k] * 3
      ax += src[p]
      ay += src[p + 1]
      az += src[p + 2]
    }
    dst[o] = src[o] + LAMBDA * (ax / deg - src[o])
    dst[o + 1] = src[o + 1] + LAMBDA * (ay / deg - src[o + 1])
    dst[o + 2] = src[o + 2] + LAMBDA * (az / deg - src[o + 2])
  }
}

/**
 * Per-vertex diffuse multiplier in [floor, 1 + a hair], one entry per vertex of
 * `geometry` (NOT per welded vertex — the caller feeds it straight into a
 * `color` attribute).
 *
 * `weight` (0..1 per vertex, optional) marks how much of the mesh is CLOTH THIS
 * MEASUREMENT IS ABOUT. It does two things, and both matter on a mesh that is
 * partly scaffolding:
 *
 *  - it is the sample weight for the standardisation below, so a large flat
 *    region contributes neither mean nor sigma. A GLB has no such region and
 *    passes nothing here; the custom-garment shell is a full rectangular grid
 *    whose outside-the-silhouette vertices all sit on one plane, i.e. thousands
 *    of exactly-zero samples that would deflate sigma and push the real cloth's
 *    signal past the clamp into full gain.
 *  - it scales the measured depth per vertex, so a caller can fade the term out
 *    across a feature it does not want measured (the shell's seam roll is a
 *    concavity running the whole length of the outline, and unfaded it draws a
 *    dark ring with a bright halo — piping around the garment).
 *
 * Returns null when the geometry cannot support the measurement (no index, no
 * normals); the caller then simply ships un-occluded cloth, which is what the
 * preview did before this existed.
 */
export function computeCavity(
  geometry: THREE.BufferGeometry,
  opts: CavityOptions = CAVITY_DEFAULTS,
  weight?: Float32Array | null,
): Float32Array | null {
  const pos = geometry.getAttribute('position')
  const nrm = geometry.getAttribute('normal')
  if (!pos || !nrm) return null
  const index = geometry.getIndex()?.array
  if (!index || index.length < 3) return null

  geometry.computeBoundingBox()
  const box = geometry.boundingBox as THREE.Box3
  const diag = box.min.distanceTo(box.max)
  if (!(diag > 0)) return null

  const weld = weldByPosition(pos, diag)
  const n = weld.count
  const adj = buildAdjacency(index, weld)

  // Welded positions/normals: the mean over the vertices that share the spot.
  const base = new Float32Array(n * 3)
  const wn = new Float32Array(n * 3)
  const hits = new Float32Array(n)
  const wWeight = weight ? new Float32Array(n) : null
  for (let i = 0; i < pos.count; i++) {
    const w = weld.of[i] * 3
    base[w] += pos.getX(i)
    base[w + 1] += pos.getY(i)
    base[w + 2] += pos.getZ(i)
    wn[w] += nrm.getX(i)
    wn[w + 1] += nrm.getY(i)
    wn[w + 2] += nrm.getZ(i)
    if (wWeight && weight) wWeight[weld.of[i]] += weight[i]
    hits[weld.of[i]]++
  }
  for (let i = 0; i < n; i++) {
    const c = Math.max(1, hits[i])
    const o = i * 3
    base[o] /= c
    base[o + 1] /= c
    base[o + 2] /= c
    if (wWeight) wWeight[i] /= c
    const len = Math.hypot(wn[o], wn[o + 1], wn[o + 2]) || 1
    wn[o] /= len
    wn[o + 1] /= len
    wn[o + 2] /= len
  }

  // Smooth, sampling the along-normal displacement at both scales.
  let a = Float32Array.from(base)
  let b = new Float32Array(n * 3)
  const dFine = new Float32Array(n)
  const dBroad = new Float32Array(n)
  const sample = (into: Float32Array) => {
    for (let i = 0; i < n; i++) {
      const o = i * 3
      into[i] = (a[o] - base[o]) * wn[o] + (a[o + 1] - base[o + 1]) * wn[o + 1] + (a[o + 2] - base[o + 2]) * wn[o + 2]
    }
  }
  const total = Math.max(opts.fine, opts.broad)
  for (let it = 1; it <= total; it++) {
    smoothOnce(a, b, adj, n)
    const t = a
    a = b
    b = t
    if (it === opts.fine) sample(dFine)
    if (it === opts.broad) sample(dBroad)
  }

  // Explicit Laplacian smoothing SHRINKS a closed surface, so every vertex
  // picks up the same positive drift on top of its real cavity signal. Left in,
  // it would just dim the whole garment by a constant. Removing the mean turns
  // the measurement back into what it is meant to be: relative depth. Dividing
  // by the spread then turns it into a scale-free one — see CAVITY_DEFAULTS.
  const standardise = (d: Float32Array) => {
    let sum = 0
    let wsum = 0
    for (let i = 0; i < n; i++) {
      const w = wWeight ? wWeight[i] : 1
      sum += d[i] * w
      wsum += w
    }
    if (!(wsum > 1e-6)) {
      d.fill(0)
      return
    }
    const mean = sum / wsum
    let sq = 0
    for (let i = 0; i < n; i++) {
      d[i] -= mean
      sq += d[i] * d[i] * (wWeight ? wWeight[i] : 1)
    }
    const sigma = Math.sqrt(sq / wsum)
    const inv = sigma > 1e-12 ? 1 / (sigma * CAVITY_SIGMAS) : 0
    for (let i = 0; i < n; i++) d[i] *= inv
  }
  standardise(dFine)
  standardise(dBroad)

  const out = new Float32Array(pos.count)
  for (let i = 0; i < pos.count; i++) {
    const w = weld.of[i]
    // The two scales are combined AFTER standardising, so a garment whose
    // folds are modelled geometry (the hoodie) and one that is a smooth shell
    // (the tee) both spend their whole range instead of one washing out.
    let d = Math.max(-1, Math.min(1, dFine[w] * 0.5 + dBroad[w] * 0.5))
    if (weight) d *= weight[i]
    out[i] = d >= 0 ? Math.max(opts.floor, 1 - d * opts.gain) : 1 - d * opts.lift
  }
  return out
}

const CAVITY_CACHE = new Map<string, Float32Array>()

/**
 * `computeCavity`, memoised per model. Keyed by the caller's id plus the vertex
 * count so a swapped GLB can never be served a stale buffer of the wrong length.
 */
export function getCavity(key: string, geometry: THREE.BufferGeometry, opts?: CavityOptions): Float32Array | null {
  const count = geometry.getAttribute('position')?.count ?? 0
  const k = `${key}#${count}`
  const hit = CAVITY_CACHE.get(k)
  if (hit) return hit
  const value = computeCavity(geometry, opts)
  if (value) CAVITY_CACHE.set(k, value)
  return value
}

/**
 * Write a cavity buffer onto a geometry as a grey `color` attribute, which
 * three multiplies into `diffuseColor` — so it darkens both the direct and the
 * image-based diffuse response, and rides along for free onto anything built
 * from a copy of this geometry (the print overlay does exactly that).
 *
 * Vertex colours are LINEAR here on purpose: this is an occlusion factor, not
 * an sRGB paint value, and three multiplies it in linear working space.
 */
export function applyCavity(geometry: THREE.BufferGeometry, cavity: Float32Array): void {
  const rgb = new Float32Array(cavity.length * 3)
  for (let i = 0; i < cavity.length; i++) {
    rgb[i * 3] = cavity[i]
    rgb[i * 3 + 1] = cavity[i]
    rgb[i * 3 + 2] = cavity[i]
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(rgb, 3))
}

// ---------------------------------------------------------------------------
// 2. Procedural weave bump
// ---------------------------------------------------------------------------

export interface WeaveOptions {
  /** Distance between neighbouring threads, INCHES. ~1 mm for jersey. */
  pitchIn: number
  /** Micro-relief strength. */
  strength: number
  /** Strength of the second, drape-scale octave (see below). */
  foldStrength: number
  /** Feature size of that octave, inches. */
  foldPitchIn: number
  /**
   * Half-height of the garment in object-space inches, for the drape's SLACK
   * ramp (folds vanish over the taut chest and pool toward the hem). Both
   * garment paths centre their geometry on the bounding box, so object-space Y
   * runs −h/2 … +h/2 and one number describes the ramp. 0 disables it, which is
   * what any surface that is not a whole garment (a print overlay) wants.
   */
  foldHalfHeightIn?: number
  /**
   * How much of the way to fully rough the sub-Nyquist weave takes this surface
   * (see WEAVE_ROUGH_GAIN). Cloth wants the default whether its grain comes from
   * this shader or from a tiled normal map, because both mip away; INK does not
   * — a cured transfer is a smoother film than the knit under it, and that
   * difference is most of what makes a print read as printed.
   */
  roughGain?: number
}

/**
 * `strength` is a SLOPE, not a height: measured over 4·10⁵ samples the weave
 * field peaks at |∇| 7.55 and the drape field at 5.39, so `strength` × that
 * peak IS tan(tilt). Two rules follow, and every constant in this project is
 * derived from them rather than eyeballed:
 *
 *   · MICRO relief (the weave) may reach ~10–15° at a crest. It is a real
 *     surface feature a millimetre across; a steep one is what catches the
 *     grazing highlight that says "fibre".
 *   · A MACRO octave (the drape) must stay under ~6°, because there is no
 *     geometry under it: it cannot occlude, it cannot break the silhouette, and
 *     it does not move with the camera. Past that it stops reading as a fold
 *     and starts reading as embossed metal. The 0.045 the tee shipped with was
 *     18° — 3× over — and it is the whole of complaint "ugly bumps".
 */
export const WEAVE_DEFAULTS: WeaveOptions = {
  pitchIn: 0.045,
  strength: 0.035,
  /** 0.02 × 5.39 = tan 6.2° at the peak of a fold, ~1.3° over quiet cloth. */
  foldStrength: 0.02,
  /** Hand-span. Folds this size are what a garment photograph shows. */
  foldPitchIn: 3.4,
}

/**
 * GLSL for the bump. Two octaves:
 *
 *  - WEAVE, at thread pitch. Two crossed sine ranks plus a diagonal term, which
 *    is the cheapest field that reads as interlocked loops rather than as a
 *    grid of dots. Below Nyquist it turns into roughness rather than
 *    disappearing (see `uWeaveRough` and the header).
 *  - DRAPE, at hand-span scale: two octaves of gradient noise, stretched down
 *    the garment and damped over the taut chest. This is the octave that
 *    matters most on the TEE, whose mesh is a smooth balloon with no folds
 *    modelled at all; the hoodie is a Marvelous Designer garment whose folds
 *    are real geometry, so it asks for much less (see CLOTH per garment in
 *    calibration.ts).
 *
 * Both are evaluated triplanar — three planar fields blended by the squared
 * face normal — so there is no UV set to need, no seam and no stretching where
 * a sleeve turns away from the body.
 *
 * The gradient is ANALYTIC in both. A finite-difference bump would need three
 * evaluations of the field per fragment; a sum of sines and gradient noise both
 * differentiate exactly, in one evaluation, and free of the step-size artefacts
 * that make procedural bump shimmer under motion.
 */
const WEAVE_GLSL = /* glsl */ `
uniform float uWeavePitch;
uniform float uWeaveStrength;
uniform float uWeaveRough;
uniform float uFoldPitch;
uniform float uFoldStrength;
uniform float uFoldHalfH;
varying vec3 vClothPos;
varying vec3 vClothNrm;
varying vec3 vClothNX;
varying vec3 vClothNY;
varying vec3 vClothNZ;

const float TAU = 6.28318530718;
/** Folds run down the garment, so the noise is stretched ~3:1 in y. */
const float FOLD_ANISO = 0.34;
/** Brings the two-octave field's peak |grad| to 5.39 — the number the
 *  foldStrength constants are quoted against (see WEAVE_DEFAULTS). */
const float FOLD_NORM = 1.9;

// d(height)/d(q) of the weave field, for one planar projection.
vec2 weaveGrad( vec2 q ) {
  float d = cos( ( q.x + q.y ) * TAU ) * 0.7;
  return vec2( cos( q.x * TAU ) + d, cos( q.y * TAU ) + d ) * ( TAU * 0.5 );
}

// Hash22 (Dave Hoskins, "Hash without Sine"). A sin()-based hash bands badly
// wherever the driver honours mediump and repeats at exactly the scales a
// garment is viewed at, which on a field this large is a visible tile.
vec2 clothHash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * vec3( 0.1031, 0.1030, 0.0973 ) );
  p3 += dot( p3, p3.yzx + 33.33 );
  return -1.0 + 2.0 * fract( ( p3.xx + p3.yz ) * p3.zy );
}

// Gradient (Perlin) noise with its EXACT derivative: vec3( value, d/dx, d/dy ).
// Quintic fade, so the derivative is itself C1 and the shading has no creases
// on the lattice lines. (Validated against central differences to 1.5e-7.)
vec3 clothNoiseD( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = p - i;
  vec2 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
  vec2 du = 30.0 * f * f * ( f * ( f - 2.0 ) + 1.0 );
  vec2 ga = clothHash( i );
  vec2 gb = clothHash( i + vec2( 1.0, 0.0 ) );
  vec2 gc = clothHash( i + vec2( 0.0, 1.0 ) );
  vec2 gd = clothHash( i + vec2( 1.0, 1.0 ) );
  float va = dot( ga, f );
  float vb = dot( gb, f - vec2( 1.0, 0.0 ) );
  float vc = dot( gc, f - vec2( 0.0, 1.0 ) );
  float vd = dot( gd, f - vec2( 1.0, 1.0 ) );
  float k1 = vb - va;
  float k2 = vc - va;
  float k3 = va - vb - vc + vd;
  vec2 d = ga + u.x * ( gb - ga ) + u.y * ( gc - ga ) + u.x * u.y * ( ga - gb - gc + gd )
         + du * vec2( k1 + u.y * k3, k2 + u.x * k3 );
  return vec3( va + u.x * k1 + u.y * k2 + u.x * u.y * k3, d );
}

// …and of the drape field. NON-PERIODIC by construction: the sine it replaced
// ruled ~8 parallel ridges across every garment at a fixed 2.6 in pitch.
vec2 foldGrad( vec2 q ) {
  vec2 a = vec2( q.x, q.y * FOLD_ANISO );
  vec3 n1 = clothNoiseD( a );
  vec3 n2 = clothNoiseD( a * 2.13 + 17.7 );
  vec2 g = n1.yz + ( 0.42 * 2.13 ) * n2.yz;
  g.y *= FOLD_ANISO;                        // chain rule for the stretch
  return g * FOLD_NORM;
}

/**
 * How slack the cloth is here, 0…1. A worn garment is pulled taut across the
 * chest and shoulders and pools at the hem, so a constant-amplitude fold field
 * is wrong at both ends. uFoldHalfH = 0 means "not a whole garment" (a print
 * overlay), and the ramp switches off.
 */
float clothSlack( float y ) {
  if ( uFoldHalfH <= 0.0 ) return 1.0;
  float t = clamp( y / uFoldHalfH, -1.0, 1.0 );   // +1 shoulders, −1 hem
  return mix( 1.0, 0.28, smoothstep( -0.55, 0.45, t ) );
}

vec3 clothBump( vec3 viewNormal ) {
  vec3 n = normalize( vClothNrm );
  vec3 w = n * n;
  w *= w;                                   // sharpen the blend; a soft one
  w /= max( w.x + w.y + w.z, 1e-4 );        // smears grain across the corners

  vec3 p = vClothPos;

  // A thread pitch approaches one pixel as the camera pulls back, and a bump
  // field sampled below Nyquist does not fade — it crawls. Fade the weave out
  // once a period stops covering a couple of pixels; the drape octave is two
  // orders of magnitude coarser and never gets there. What the fade removes is
  // returned as roughness by the caller: sub-pixel relief IS a wider lobe.
  float footprint = max( fwidth( p.x ), max( fwidth( p.y ), fwidth( p.z ) ) ) / uWeavePitch;
  float weaveFade = 1.0 - smoothstep( 0.14, 0.5, footprint );

  vec3 gWeave = vec3( 0.0 );
  vec3 gFold = vec3( 0.0 );

  vec2 a = weaveGrad( p.zy / uWeavePitch ) * w.x;
  vec2 b = weaveGrad( p.xz / uWeavePitch ) * w.y;
  vec2 c = weaveGrad( p.xy / uWeavePitch ) * w.z;
  gWeave += ( vec3( 0.0, a.y, a.x ) + vec3( b.x, 0.0, b.y ) + vec3( c.x, c.y, 0.0 ) ) * weaveFade;

  // The drape octave is anisotropic: cloth hangs, so the folds run down the
  // garment. Feeding y as the SECOND coordinate on every plane keeps that true
  // whichever way the surface faces.
  vec2 fa = foldGrad( p.zy / uFoldPitch ) * w.x;
  vec2 fb = foldGrad( p.xz / uFoldPitch ) * w.y;
  vec2 fc = foldGrad( p.xy / uFoldPitch ) * w.z;
  gFold += vec3( 0.0, fa.y, fa.x ) + vec3( fb.x, 0.0, fb.y ) + vec3( fc.x, fc.y, 0.0 );

  vec3 g = gWeave * uWeaveStrength + gFold * ( uFoldStrength * clothSlack( p.y ) );
  g -= n * dot( g, n );                     // only the in-surface part tilts it

  // Object space → view space. The three basis images are constant per draw
  // call; carrying them as varyings is what lets the gradient be built in the
  // space the pattern lives in while the lighting stays in the space three
  // shades in. (normalMatrix is not declared in three's fragment prefix.)
  // …and follow the SHADED SIDE. three's <normal_fragment_begin> has already
  // flipped viewNormal for a backface on a double-sided material, but
  // vClothNrm is the raw object normal, so the perturbation would arrive with
  // the wrong sign and every crest would read as a trough. Inert until a
  // garment is double-sided — which the catalogue meshes now are, because both
  // GLBs declare it and dropping it was showing the backdrop through the collar.
  vec3 gView = vClothNX * g.x + vClothNY * g.y + vClothNZ * g.z;
  return normalize( viewNormal - gView * ( gl_FrontFacing ? 1.0 : -1.0 ) );
}
`

/**
 * The roughness half of the weave, injected separately because three resolves
 * `roughnessFactor` BEFORE it resolves the normal. Recomputing the footprint
 * here costs two `fwidth`s and keeps the two injections independent — the
 * alternative, hoisting a varying out of the normal stage, would only work if
 * the stages were ordered the other way round.
 *
 * `uWeaveRough` is a fraction of the way to fully rough, not an addition: a
 * knit whose threads have gone sub-pixel scatters more widely, but it is still
 * cotton and must not turn into chalk. 0.12 is the largest value at which a
 * white tee's key highlight is still a highlight.
 */
const WEAVE_ROUGH_GAIN = 0.12
const WEAVE_ROUGH_GLSL = /* glsl */ `
  {
    float fp = max( fwidth( vClothPos.x ), max( fwidth( vClothPos.y ), fwidth( vClothPos.z ) ) ) / uWeavePitch;
    float lost = smoothstep( 0.14, 0.5, fp );
    roughnessFactor = mix( roughnessFactor, 1.0, lost * uWeaveRough );
  }
`

/**
 * Install the weave bump on a material. Returns the uniforms so a caller can
 * retune per garment without recompiling (the program cache key is fixed, so
 * every cloth material in the scene shares ONE compiled program).
 */
export function applyWeaveBump(
  material: THREE.Material & { onBeforeCompile: THREE.Material['onBeforeCompile'] },
  opts: WeaveOptions = WEAVE_DEFAULTS,
  cacheKey = 'tshop-cloth',
): { [k: string]: THREE.IUniform } {
  // IDEMPOTENT. The injection may only happen once per material — chaining
  // onBeforeCompile twice would install the chunk twice — but the VALUES have
  // to stay live: a caller re-attaching with a different garment height or a
  // different weave strength (the shell swaps between a photo-wrinkle surface
  // and a fabric-texture one, and a card's height changes with the upload) must
  // see the change. Uniform writes need no recompile, so a second call is just
  // an assignment.
  const existing = material.userData.clothUniforms as { [k: string]: THREE.IUniform } | undefined
  if (existing) {
    existing.uWeavePitch.value = opts.pitchIn
    existing.uWeaveStrength.value = opts.strength
    existing.uFoldPitch.value = opts.foldPitchIn
    existing.uFoldStrength.value = opts.foldStrength
    existing.uFoldHalfH.value = opts.foldHalfHeightIn ?? 0
    existing.uWeaveRough.value = opts.roughGain ?? WEAVE_ROUGH_GAIN
    return existing
  }
  const uniforms: { [k: string]: THREE.IUniform } = {
    uWeavePitch: { value: opts.pitchIn },
    uWeaveStrength: { value: opts.strength },
    uWeaveRough: { value: opts.roughGain ?? WEAVE_ROUGH_GAIN },
    uFoldPitch: { value: opts.foldPitchIn },
    uFoldStrength: { value: opts.foldStrength },
    uFoldHalfH: { value: opts.foldHalfHeightIn ?? 0 },
  }
  const previous = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer)
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader =
      'varying vec3 vClothPos;\nvarying vec3 vClothNrm;\nvarying vec3 vClothNX;\nvarying vec3 vClothNY;\nvarying vec3 vClothNZ;\n' +
      shader.vertexShader
        .replace(
          '#include <beginnormal_vertex>',
          '#include <beginnormal_vertex>\n\tvClothNrm = objectNormal;\n\tvClothNX = normalMatrix[ 0 ];\n\tvClothNY = normalMatrix[ 1 ];\n\tvClothNZ = normalMatrix[ 2 ];',
        )
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvClothPos = transformed;')
    shader.fragmentShader =
      WEAVE_GLSL +
      shader.fragmentShader
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>' + WEAVE_ROUGH_GLSL)
        .replace(
          '#include <normal_fragment_maps>',
          '#include <normal_fragment_maps>\n\tnormal = clothBump( normal );',
        )
  }
  const key = material.customProgramCacheKey
  material.customProgramCacheKey = () => `${key ? key.call(material) : ''}|${cacheKey}`
  material.userData.clothUniforms = uniforms
  return uniforms
}
