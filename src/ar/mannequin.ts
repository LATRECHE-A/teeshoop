/**
 * Procedural display mannequin for the AR try-on (module: AR).
 *
 * A stylised, matte retail-dummy figure — deliberately NOT a photoreal human
 * (no faces, no skin tone) so it reads as a neutral display body and sidesteps
 * representation/uncanny-valley issues. Male / female are distinguished purely
 * by silhouette (shoulder width, waist, hips, bust, height).
 *
 * 1 world unit = 1 inch, matching the rest of the app, so a print sized in
 * inches lands on the chest at life size. The torso is the "shirt": its front
 * is a smooth elliptical surface the design decal wraps onto (see arScene.ts).
 *
 * Built from a handful of meshes grouped by material (shirt vs. body) — no
 * geometry merge, so recolouring the shirt is one `material.color.set`.
 */
import * as THREE from 'three'

export type Gender = 'male' | 'female'
export type MannequinSide = 'front' | 'back'

/** One horizontal slice of the torso: height y (in), half-widths in x and z. */
interface Ring {
  y: number
  hw: number
  dp: number
}

export interface DecalAnchor {
  /** Centre of the chest/back surface region, world inches. */
  center: THREE.Vector3
  /** Y rotation so the decal faces outward (0 front, π back). */
  rotationY: number
  /** Horizontal curvature radius of the chest at that height (in). */
  radius: number
  /** Outward surface offset (z at the anchor, before the small lift). */
  surfaceZ: number
  /** Top of the printable band (just under the collar), world y. */
  topY: number
}

export interface Mannequin {
  group: THREE.Group
  /** Recolour target for the worn garment. */
  shirtMaterial: THREE.MeshStandardMaterial
  bodyMaterial: THREE.MeshStandardMaterial
  anchors: Record<MannequinSide, DecalAnchor>
  /** Total figure height (in) and its bbox centre Y (for grounding). */
  heightIn: number
  centerY: number
  minY: number
  dispose(): void
}

// --- per-gender silhouette --------------------------------------------------
// Torso rings run bottom (shirt hem, near the hips) → top (shoulders). Values
// are hand-tuned inches; front/back depth `dp` < side half-width `hw` gives the
// flattened human cross-section a real chest curves over.

const MALE_TORSO: Ring[] = [
  { y: 0.0, hw: 7.0, dp: 4.3 },
  { y: 2.5, hw: 6.7, dp: 4.15 },
  { y: 5.5, hw: 6.3, dp: 3.95 }, // waist
  { y: 8.5, hw: 6.6, dp: 4.1 },
  { y: 11.5, hw: 7.3, dp: 4.5 },
  { y: 14.5, hw: 8.1, dp: 4.95 },
  { y: 17.5, hw: 8.7, dp: 5.2 }, // chest
  { y: 20.0, hw: 9.0, dp: 5.15 },
  { y: 22.0, hw: 9.1, dp: 4.85 }, // upper chest
  { y: 23.5, hw: 8.6, dp: 4.35 }, // toward shoulders
]

const FEMALE_TORSO: Ring[] = [
  { y: 0.0, hw: 7.3, dp: 4.05 },
  { y: 2.0, hw: 7.5, dp: 4.1 }, // hips
  { y: 4.5, hw: 6.8, dp: 3.85 },
  { y: 7.0, hw: 5.5, dp: 3.35 }, // waist (defined)
  { y: 10.0, hw: 5.9, dp: 3.6 },
  { y: 12.8, hw: 6.6, dp: 4.15 },
  { y: 15.0, hw: 6.95, dp: 4.5 }, // bust
  { y: 17.2, hw: 6.9, dp: 4.45 },
  { y: 19.8, hw: 6.8, dp: 4.0 },
  { y: 21.8, hw: 7.1, dp: 3.7 }, // shoulders (narrower)
]

interface Proportions {
  torso: Ring[]
  headR: number
  neckR: number
  neckH: number
  shoulderY: number
  armR: number
  armLen: number
  legR: number
  legLen: number
  /** Chest anchor height as a fraction up the torso. */
  chestT: number
}

function proportions(gender: Gender): Proportions {
  if (gender === 'female') {
    return {
      torso: FEMALE_TORSO,
      headR: 3.7,
      neckR: 1.5,
      neckH: 2.6,
      shoulderY: 21.8,
      armR: 1.45,
      armLen: 24,
      legR: 3.1,
      legLen: 31,
      chestT: 0.66,
    }
  }
  return {
    torso: MALE_TORSO,
    headR: 3.95,
    neckR: 1.75,
    neckH: 2.9,
    shoulderY: 23.5,
    armR: 1.75,
    armLen: 25,
    legR: 3.4,
    legLen: 30,
    chestT: 0.7,
  }
}

// --- torso surface (generalised elliptical tube) ---------------------------

/**
 * Build a closed torso shell from horizontal elliptical rings. Adds a domed
 * top cap (shoulders) and a flat bottom cap (hem) so the shirt reads solid.
 */
function buildTorso(rings: Ring[]): THREE.BufferGeometry {
  const RAD = 56 // angular segments
  const rows = rings.length
  const pos: number[] = []
  const idx: number[] = []

  for (let r = 0; r < rows; r++) {
    const { y, hw, dp } = rings[r]
    for (let a = 0; a <= RAD; a++) {
      const th = (a / RAD) * Math.PI * 2
      pos.push(hw * Math.cos(th), y, dp * Math.sin(th))
    }
  }
  const stride = RAD + 1
  for (let r = 0; r < rows - 1; r++) {
    for (let a = 0; a < RAD; a++) {
      const i0 = r * stride + a
      const i1 = i0 + 1
      const i2 = (r + 1) * stride + a
      const i3 = i2 + 1
      idx.push(i0, i2, i1, i1, i2, i3)
    }
  }

  // Top dome cap: a hub vertex lifted above the top ring, fanned to it.
  const top = rings[rows - 1]
  const topHubY = top.y + Math.min(top.hw, top.dp) * 0.55
  const topHub = pos.length / 3
  pos.push(0, topHubY, 0)
  const topRowStart = (rows - 1) * stride
  for (let a = 0; a < RAD; a++) {
    idx.push(topRowStart + a, topRowStart + a + 1, topHub)
  }

  // Bottom cap: a hub at the hem centre, fanned (wound the other way).
  const bot = rings[0]
  const botHub = pos.length / 3
  pos.push(0, bot.y - 0.4, 0)
  for (let a = 0; a < RAD; a++) {
    idx.push(a + 1, a, botHub)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}

/** Linear-interpolate a ring value at a fractional height t ∈ [0,1]. */
function ringAt(rings: Ring[], t: number): Ring {
  const span = rings[rings.length - 1].y - rings[0].y
  const y = rings[0].y + t * span
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i]
    const b = rings[i + 1]
    if (y <= b.y || i === rings.length - 2) {
      const k = THREE.MathUtils.clamp((y - a.y) / (b.y - a.y || 1), 0, 1)
      return {
        y,
        hw: THREE.MathUtils.lerp(a.hw, b.hw, k),
        dp: THREE.MathUtils.lerp(a.dp, b.dp, k),
      }
    }
  }
  return rings[rings.length - 1]
}

// --- assembly ---------------------------------------------------------------

export function buildMannequin(gender: Gender): Mannequin {
  const p = proportions(gender)
  const group = new THREE.Group()

  const shirtMaterial = new THREE.MeshStandardMaterial({
    color: '#f4f5f7',
    roughness: 0.82,
    metalness: 0,
    envMapIntensity: 1,
  })
  // Warm neutral display-dummy body (no skin tone).
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: '#cdc6ba',
    roughness: 0.62,
    metalness: 0.04,
    envMapIntensity: 1,
  })

  const disposables: { dispose(): void }[] = [shirtMaterial, bodyMaterial]
  const addMesh = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
    disposables.push(geo)
    const m = new THREE.Mesh(geo, mat)
    m.castShadow = true
    group.add(m)
    return m
  }

  // Shirt = the torso shell.
  addMesh(buildTorso(p.torso), shirtMaterial)

  // Neck + head (body).
  const shoulder = p.torso[p.torso.length - 1]
  const neckBaseY = shoulder.y + 0.4
  const neck = addMesh(new THREE.CylinderGeometry(p.neckR * 0.92, p.neckR, p.neckH, 24), bodyMaterial)
  neck.position.set(0, neckBaseY + p.neckH / 2, 0.2)
  const headY = neckBaseY + p.neckH + p.headR * 0.86
  const head = addMesh(new THREE.SphereGeometry(p.headR, 32, 24), bodyMaterial)
  head.scale.set(0.92, 1.12, 0.98)
  head.position.set(0, headY, 0.25)

  // Arms: upper (sleeve = shirt) + lower (body), angled down-and-out from the
  // shoulders in a relaxed A-pose.
  const shoulderX = shoulder.hw * 0.9
  const shoulderTopY = shoulder.y + 0.2
  const armSplay = THREE.MathUtils.degToRad(9)
  for (const s of [-1, 1] as const) {
    const upperLen = p.armLen * 0.42
    const lowerLen = p.armLen * 0.58
    const upper = addMesh(new THREE.CapsuleGeometry(p.armR, upperLen, 8, 20), shirtMaterial)
    const lower = addMesh(new THREE.CapsuleGeometry(p.armR * 0.82, lowerLen, 8, 18), bodyMaterial)
    // Upper arm: pivot at the shoulder, tilt outward.
    upper.position.set(s * (shoulderX + p.armR * 0.4), shoulderTopY - upperLen / 2 - 1.2, 0.1)
    upper.rotation.z = s * armSplay
    const elbowY = shoulderTopY - upperLen - 1.6
    const elbowX = s * (shoulderX + p.armR * 0.4 + Math.sin(armSplay) * upperLen)
    lower.position.set(elbowX + s * 0.3, elbowY - lowerLen / 2 + 0.4, 0.4)
    lower.rotation.z = s * armSplay * 0.7
  }

  // Pelvis bridge + legs (body).
  const hem = p.torso[0]
  const pelvis = addMesh(new THREE.SphereGeometry(hem.hw * 0.98, 28, 20), bodyMaterial)
  pelvis.scale.set(1, 0.7, hem.dp / hem.hw)
  pelvis.position.set(0, hem.y - 1.4, 0)
  const legTopY = hem.y - 2.2
  const legX = hem.hw * 0.46
  for (const s of [-1, 1] as const) {
    const leg = addMesh(new THREE.CapsuleGeometry(p.legR, p.legLen, 10, 22), bodyMaterial)
    leg.position.set(s * legX, legTopY - p.legLen / 2, 0)
    leg.scale.set(1, 1, 0.86)
  }

  // Bounding box → grounding + framing.
  const box = new THREE.Box3().setFromObject(group)
  const heightIn = box.max.y - box.min.y
  const centerY = (box.max.y + box.min.y) / 2

  // Decal anchors: chest (front) and shoulder blades (back).
  const chest = ringAt(p.torso, p.chestT)
  const collarY = shoulder.y - 1.0
  const mkAnchor = (side: MannequinSide): DecalAnchor => ({
    center: new THREE.Vector3(0, chest.y, side === 'front' ? chest.dp : -chest.dp),
    rotationY: side === 'front' ? 0 : Math.PI,
    radius: chest.hw,
    surfaceZ: chest.dp,
    topY: collarY,
  })

  return {
    group,
    shirtMaterial,
    bodyMaterial,
    anchors: { front: mkAnchor('front'), back: mkAnchor('back') },
    heightIn,
    centerY,
    minY: box.min.y,
    dispose() {
      for (const d of disposables) d.dispose()
    },
  }
}
