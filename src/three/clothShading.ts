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
 * WHY OBJECT SPACE, NOT WORLD. The preview floats the garment on a drei
 * <Float>, so a world-space pattern would swim across the cloth as it sways.
 * Object space is glued to the fabric, which is what a weave is.
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
 * Returns null when the geometry cannot support the measurement (no index, no
 * normals); the caller then simply ships un-occluded cloth, which is what the
 * preview did before this existed.
 */
export function computeCavity(
  geometry: THREE.BufferGeometry,
  opts: CavityOptions = CAVITY_DEFAULTS,
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
  for (let i = 0; i < pos.count; i++) {
    const w = weld.of[i] * 3
    base[w] += pos.getX(i)
    base[w + 1] += pos.getY(i)
    base[w + 2] += pos.getZ(i)
    wn[w] += nrm.getX(i)
    wn[w + 1] += nrm.getY(i)
    wn[w + 2] += nrm.getZ(i)
    hits[weld.of[i]]++
  }
  for (let i = 0; i < n; i++) {
    const c = Math.max(1, hits[i])
    const o = i * 3
    base[o] /= c
    base[o + 1] /= c
    base[o + 2] /= c
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
    for (let i = 0; i < n; i++) sum += d[i]
    const mean = sum / n
    let sq = 0
    for (let i = 0; i < n; i++) {
      d[i] -= mean
      sq += d[i] * d[i]
    }
    const sigma = Math.sqrt(sq / n)
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
    const d = Math.max(-1, Math.min(1, dFine[w] * 0.5 + dBroad[w] * 0.5))
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
  /** Wavelength of that octave, inches. */
  foldPitchIn: number
}

/**
 * `strength` is a SLOPE, not a height: the gradient fields below peak near 5,
 * so 0.035 tilts the shading normal by about 11° at the crest of a thread —
 * enough to catch a highlight, far short of the corrugated-iron look that
 * anything past ~0.08 gives.
 */
export const WEAVE_DEFAULTS: WeaveOptions = {
  pitchIn: 0.045,
  strength: 0.035,
  foldStrength: 0.03,
  foldPitchIn: 2.6,
}

/**
 * GLSL for the bump. Two octaves:
 *
 *  - WEAVE, at thread pitch. Two crossed sine ranks plus a diagonal term, which
 *    is the cheapest field that reads as interlocked loops rather than as a
 *    grid of dots.
 *  - DRAPE, at hand-span scale, domain-warped so it wanders instead of ruling
 *    straight lines. This is the octave that matters most on the TEE, whose
 *    mesh is a smooth balloon with no folds modelled at all; the hoodie is a
 *    Marvelous Designer garment whose folds are real geometry, so it asks for
 *    much less (see CLOTH per garment in calibration.ts).
 *
 * Both are evaluated triplanar — three planar fields blended by the squared
 * face normal — so there is no UV set to need, no seam and no stretching where
 * a sleeve turns away from the body.
 *
 * The gradient is ANALYTIC. A finite-difference bump would need three
 * evaluations of a nine-sine field per fragment; differentiating a sum of sines
 * is exact, one evaluation, and free of the step-size artefacts that make
 * procedural bump shimmer under motion.
 */
const WEAVE_GLSL = /* glsl */ `
uniform float uWeavePitch;
uniform float uWeaveStrength;
uniform float uFoldPitch;
uniform float uFoldStrength;
varying vec3 vClothPos;
varying vec3 vClothNrm;
varying vec3 vClothNX;
varying vec3 vClothNY;
varying vec3 vClothNZ;

const float TAU = 6.28318530718;

// d(height)/d(q) of the weave field, for one planar projection.
vec2 weaveGrad( vec2 q ) {
  float d = cos( ( q.x + q.y ) * TAU ) * 0.7;
  return vec2( cos( q.x * TAU ) + d, cos( q.y * TAU ) + d ) * ( TAU * 0.5 );
}

// …and of the drape field, warped so the folds meander.
vec2 foldGrad( vec2 q ) {
  float warp = sin( q.y * 2.1 );
  float phase = q.x * TAU + warp * 1.7;
  float dx = cos( phase ) * TAU;
  float dy = cos( phase ) * cos( q.y * 2.1 ) * 2.1 * 1.7;
  return vec2( dx, dy );
}

vec3 clothBump( vec3 viewNormal ) {
  vec3 n = normalize( vClothNrm );
  vec3 w = n * n;
  w *= w;                                   // sharpen the blend; a soft one
  w /= max( w.x + w.y + w.z, 1e-4 );        // smears grain across the corners

  vec3 p = vClothPos;

  // A thread pitch approaches one pixel as the camera pulls back, and a bump
  // field sampled below Nyquist does not fade — it crawls. Fade the weave out
  // once a period stops covering a couple of pixels; the drape octave is three
  // orders of magnitude coarser and never gets there.
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

  vec3 g = gWeave * uWeaveStrength + gFold * uFoldStrength;
  g -= n * dot( g, n );                     // only the in-surface part tilts it

  // Object space → view space. The three basis images are constant per draw
  // call; carrying them as varyings is what lets the gradient be built in the
  // space the pattern lives in while the lighting stays in the space three
  // shades in. (normalMatrix is not declared in three's fragment prefix.)
  vec3 gView = vClothNX * g.x + vClothNY * g.y + vClothNZ * g.z;
  return normalize( viewNormal - gView );
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
  const uniforms: { [k: string]: THREE.IUniform } = {
    uWeavePitch: { value: opts.pitchIn },
    uWeaveStrength: { value: opts.strength },
    uFoldPitch: { value: opts.foldPitchIn },
    uFoldStrength: { value: opts.foldStrength },
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
    shader.fragmentShader = WEAVE_GLSL + shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      '#include <normal_fragment_maps>\n\tnormal = clothBump( normal );',
    )
  }
  const key = material.customProgramCacheKey
  material.customProgramCacheKey = () => `${key ? key.call(material) : ''}|${cacheKey}`
  return uniforms
}
