/**
 * Shared decal primitives — the ONE implementation of "put this print on this
 * garment", used by the live preview (src/three/GarmentModel.tsx) and by the AR
 * bake (src/lib/arExport.ts). Two renderers drifting apart is exactly the class
 * of bug this module exists to prevent.
 *
 * THE MAPPING
 * -----------
 * A print lives in FABRIC coordinates: inches from the print-area centre, +x to
 * the wearer's LEFT (which is viewer-right on the front panel — see
 * src/content/zones.ts for the convention and its evidence), +y up. The garment
 * surface is turned into the same coordinates by src/three/fabricUnwrap.ts, so
 *
 *     u = 0.5 + s / areaWIn          s = inches of cloth from the centre front
 *     v = 0.5 + (y - centreYIn) / areaHIn
 *
 * is a print rect laid on cloth, at true size, with no projection anywhere. The
 * back panel re-references s to the centre BACK, which also mirrors it for free:
 * a viewer standing behind sees the wearer's right on their own right.
 *
 * Consequences that fall out and are asserted by scripts/fabric-verify.mjs:
 *   - nothing is ever clipped: there is no projector box to clip against
 *   - no front print bleeds onto the back: |s| ≤ areaW/2 < the front half-arc,
 *     so |θ| < 90°, so z > 0 — structurally, not by tuning
 *   - 2D and 3D agree by construction: 2D inches ARE fabric inches
 *
 * THE REJECT ATTRIBUTE (two guards in one float)
 * ----------------------------------------------
 * Every overlay vertex carries `printReject`, and the fragment shader discards
 * wherever the interpolated value exceeds 1. It is per-FRAGMENT on purpose: the
 * hoodie's back has triangles that span from the torso to the hood, and
 * rejecting those whole would punch holes in the print — interpolating cuts
 * them at the right place instead. Two things feed it:
 *
 *  1. SHELL. A hood, a kangaroo pocket and A-pose sleeves sit outside the torso
 *     shell the unwrap tracks, yet a hood hangs at back-panel angles and would
 *     happily take the ink meant for the shoulder blades. So a vertex is
 *     rejected once its radius strays past a tolerance from the tracked shell.
 *
 *  2. SEAM. `s` is an ANGULAR coordinate in disguise: it wraps. The front map
 *     jumps from +halfPerim to −halfPerim across the centre-BACK line (the back
 *     map jumps across the centre front). A triangle straddling that line has
 *     both its endpoints far outside the rect, but the u the rasteriser
 *     interpolates between them sweeps the whole rect — which would smear a
 *     replica of the front print down the wearer's spine. `u` alone cannot see
 *     this; |s| carried separately can, because it stays ≈ halfPerim right
 *     across the straddling triangle. Legitimate ink never exceeds |s| ≈ 0.3 ·
 *     halfPerim (a 12 in print on a 20 in panel), so the guard sits at 0.5 with
 *     a 1.7× margin either way.
 */
import * as THREE from 'three'
import type { Side } from '@/lib/types'
import { applyWeaveBump, type WeaveOptions } from './clothShading'
import {
  arcAt,
  backSeamArcAt,
  halfPerimAt,
  packIndex,
  packXYZ,
  shellRadiusAt,
  thetaAtArc,
  type ArcTable,
} from './fabricUnwrap'

/** How far a surface may sit off the tracked shell and still take ink. */
const SHELL_TOL_IN = 0.45
const SHELL_TOL_FRAC = 0.12
/** Share of the panel's half-perimeter that may carry ink before a fragment is
 *  treated as seam-wrap garbage rather than print (see the header). */
const SEAM_GUARD = 0.5
/** Preview lift: enough to beat coincident-surface z-fighting, small enough to
 *  stay invisible at 1 world unit = 1 inch. AR uses its own, larger lift. */
export const OVERLAY_LIFT_IN = 0.012

/** Everything needed to move between fabric inches and garment world space. */
export interface FabricFrame {
  table: ArcTable
  side: Exclude<Side, 'sleeve'>
  /** Raw glb units → world inches, applied to X and Z. */
  xzScale: number
  /** Raw glb units → world inches, applied to Y. */
  yScale: number
  /** Print-area size in inches, already graded for the previewed size. */
  areaWIn: number
  areaHIn: number
  /** World Y (inches) of the print-area centre. */
  centreYIn: number
}

/** Fabric coordinate of a world-space point on the garment. */
export function fabricAt(frame: FabricFrame, xIn: number, yIn: number, zIn: number): {
  u: number
  v: number
  /** > 1 ⇒ this point must not take ink. See the header. */
  reject: number
} {
  const { table, xzScale, yScale } = frame
  const yRaw = yIn / yScale
  const halfPerimIn = halfPerimAt(table, yRaw) * xzScale
  let sIn = arcAt(table, xIn / xzScale, yRaw, zIn / xzScale) * xzScale
  // The back panel is the SAME arc re-referenced to the centre back, which also
  // mirrors it for free: a viewer behind sees the wearer's right on their right.
  // Referenced to the seam this point is actually approaching (±π), not to the
  // mean of the two — see backSeamArcAt.
  if (frame.side === 'back') sIn -= backSeamArcAt(table, yRaw, sIn >= 0) * xzScale
  const shellIn = shellRadiusAt(table, yRaw, Math.atan2(xIn, zIn)) * xzScale
  const shellDev = Math.abs(Math.hypot(xIn, zIn) - shellIn) / Math.max(SHELL_TOL_IN, SHELL_TOL_FRAC * shellIn)
  const seam = Math.abs(sIn) / Math.max(1e-6, SEAM_GUARD * halfPerimIn)
  return {
    u: 0.5 + sIn / frame.areaWIn,
    // flipY = true on every print texture ⇒ v = 1 samples canvas row 0 (top),
    // so v must INCREASE with world +y.
    v: 0.5 + (yIn - frame.centreYIn) / frame.areaHIn,
    reject: Math.max(shellDev, seam),
  }
}

/**
 * A copy of the garment geometry carrying fabric UVs — the print overlay pass.
 * Positions are lifted along the vertex normal so the overlay never z-fights
 * with the fabric underneath (the same geometric trick AR uses, rather than
 * polygonOffset, which the glTF exporter drops).
 */
export function buildFabricOverlay(
  geometry: THREE.BufferGeometry,
  frame: FabricFrame,
  liftIn = OVERLAY_LIFT_IN,
): THREE.BufferGeometry {
  const src = geometry.getAttribute('position')
  const nrm = geometry.getAttribute('normal')
  const count = src.count
  const position = new Float32Array(count * 3)
  const uv = new Float32Array(count * 2)
  const reject = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const x = src.getX(i)
    const y = src.getY(i)
    const z = src.getZ(i)
    const f = fabricAt(frame, x, y, z)
    uv[i * 2] = f.u
    uv[i * 2 + 1] = f.v
    reject[i] = f.reject
    position[i * 3] = x + nrm.getX(i) * liftIn
    position[i * 3 + 1] = y + nrm.getY(i) * liftIn
    position[i * 3 + 2] = z + nrm.getZ(i) * liftIn
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(position, 3))
  // packXYZ, not `nrm.array`: glTF-Transform interleaves POSITION with NORMAL,
  // and the raw buffer would hand back positions labelled as normals.
  out.setAttribute('normal', new THREE.BufferAttribute(packXYZ(geometry, 'normal'), 3))
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  out.setAttribute('printReject', new THREE.BufferAttribute(reject, 1))
  // Carry the garment's cavity occlusion onto the ink. Ink printed into the
  // hollow under an arm is in that hollow's shade; without this the artwork
  // keeps its own flat brightness right across a fold and reads as a sticker
  // floating a millimetre off the cloth, which is exactly what it was doing.
  if (geometry.getAttribute('color')) {
    out.setAttribute('color', new THREE.BufferAttribute(packXYZ(geometry, 'color'), 3))
  }
  out.setIndex(new THREE.BufferAttribute(packIndex(geometry), 1))
  out.computeBoundingSphere()
  return out
}

const FABRIC_CLIP_CACHE_KEY = 'tshop-fabric-clip'

/**
 * Print material for the overlay pass: samples the print canvas through the
 * fabric UVs and discards everything outside the rect or off the shell. The
 * discard (rather than ClampToEdge padding) is exact — a full-area print whose
 * ink touches the rect edge would smear across the whole garment otherwise.
 *
 * It is a LIT material sharing the garment's cavity occlusion and weave relief,
 * because a print is not a sticker: a DTF or screen transfer sits in the cloth
 * and takes the same light. It is left a little smoother than the cotton
 * (`roughness` below the garment's ~0.93) since cured ink genuinely is — that
 * faint sheen difference is most of what makes a print look printed.
 *
 * `vertexColors` is enabled only when the overlay geometry actually carries the
 * attribute: an unbound `color` attribute reads as (0,0,0) in GL, which would
 * paint every print solid black.
 */
export function fabricPrintMaterial(map: THREE.Texture, cavity: boolean, weave?: WeaveOptions): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    // Cured ink IS smoother than cotton, but 0.78 against the garment's 0.92-0.94
    // made the printed patch the glossiest thing on the shirt. 0.86 keeps the
    // difference legible as "printed" without turning a logo into plastic.
    roughness: 0.86,
    metalness: 0,
    side: THREE.FrontSide,
    vertexColors: cavity,
  })
  material.onBeforeCompile = (shader) => {
    shader.vertexShader =
      'attribute float printReject;\nvarying float vReject;\n' +
      shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvReject = printReject;')
    shader.fragmentShader =
      'varying float vReject;\n' +
      shader.fragmentShader.replace(
        '#include <map_fragment>',
        'if ( vReject > 1.0 || vMapUv.x < 0.0 || vMapUv.x > 1.0 || vMapUv.y < 0.0 || vMapUv.y > 1.0 ) discard;\n#include <map_fragment>',
      )
  }
  // Without this every material instance compiles its own program.
  material.customProgramCacheKey = () => `${FABRIC_CLIP_CACHE_KEY}|${cavity ? 'c' : ''}`
  // The ink follows the weave underneath it, at a fraction of the cloth's own
  // relief — a transfer bridges the threads rather than sinking between them.
  if (weave) applyWeaveBump(material, weave, 'tshop-print')
  return material
}

/**
 * The AR form of the same mapping: a low-poly INDEXED plane whose vertices are
 * placed on the true garment surface by inverting s → θ per band. glTF cannot
 * carry a custom shader, so instead of discarding we simply never generate
 * geometry outside the print rect — strictly better, and it keeps every
 * Scene-Viewer rule in src/lib/arExport.ts intact (indexed, one MASK material,
 * geometric lift).
 */
export function buildFabricDecal(
  frame: FabricFrame,
  liftIn: number,
  segX = 32,
  segY = 32,
): THREE.BufferGeometry {
  const { table, xzScale, yScale, areaWIn, areaHIn, centreYIn } = frame
  const nx = segX + 1
  const ny = segY + 1
  const position = new Float32Array(nx * ny * 3)
  const normal = new Float32Array(nx * ny * 3)
  const uv = new Float32Array(nx * ny * 2)
  for (let j = 0; j < ny; j++) {
    const yIn = centreYIn + areaHIn / 2 - (areaHIn * j) / segY
    const yRaw = yIn / yScale
    for (let i = 0; i < nx; i++) {
      const sFabIn = -areaWIn / 2 + (areaWIn * i) / segX
      // Inverse of the back re-referencing in fabricAt: fabric-x < 0 sits on the
      // +π side of the seam and vice versa, which is the mirroring itself.
      const sIn =
        frame.side === 'back'
          ? sFabIn + backSeamArcAt(table, yRaw, sFabIn < 0) * xzScale
          : sFabIn
      const theta = thetaAtArc(table, yRaw, sIn / xzScale)
      const r = shellRadiusAt(table, yRaw, theta) * xzScale + liftIn
      const o = (j * nx + i) * 3
      position[o] = r * Math.sin(theta)
      position[o + 1] = yIn
      position[o + 2] = r * Math.cos(theta)
      normal[o] = Math.sin(theta)
      normal[o + 1] = 0
      normal[o + 2] = Math.cos(theta)
      uv[(j * nx + i) * 2] = i / segX
      // flipY = true ⇒ the top row (j = 0) must be v = 1.
      uv[(j * nx + i) * 2 + 1] = 1 - j / segY
    }
  }
  // Same winding as PlaneGeometry, which puts the face outward on BOTH panels:
  // the back panel's own wrap already carries it round to −Z.
  const index = new Uint32Array(segX * segY * 6)
  let p = 0
  for (let j = 0; j < segY; j++) {
    for (let i = 0; i < segX; i++) {
      const a = j * nx + i
      const b = (j + 1) * nx + i
      const c = (j + 1) * nx + i + 1
      const d = j * nx + i + 1
      index[p++] = a; index[p++] = b; index[p++] = d
      index[p++] = b; index[p++] = c; index[p++] = d
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  geo.setIndex(new THREE.BufferAttribute(index, 1))
  geo.computeBoundingSphere()
  return geo
}

/**
 * A cylindrically-curved INDEXED plane hugging a surface, sized in inches.
 * Arc-length preserving (bend·r = wIn), so a 4 in sleeve print really wraps 4 in
 * of sleeve. Still used where no arc table applies: sleeves (a tube on its own
 * slanted axis), the procedural mannequin and the custom-garment card.
 */
export function makeCurvedDecal(wIn: number, hIn: number, radius: number, bendMax: number): THREE.PlaneGeometry {
  const bend = Math.min(bendMax, wIn / Math.max(radius, 1))
  const r = wIn / Math.max(bend, 1e-3)
  const geo = new THREE.PlaneGeometry(wIn, hIn, 40, 1)
  const pos = geo.attributes.position as THREE.BufferAttribute
  const nor = geo.attributes.normal as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const theta = (pos.getX(i) / wIn) * bend
    pos.setXYZ(i, r * Math.sin(theta), pos.getY(i), r * (Math.cos(theta) - 1))
    nor.setXYZ(i, Math.sin(theta), 0, Math.cos(theta))
  }
  pos.needsUpdate = true
  nor.needsUpdate = true
  geo.computeBoundingSphere()
  return geo
}
