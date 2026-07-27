/**
 * Per-model calibration for the 3D preview and the AR bake (module A3).
 *
 * World space convention: 1 world unit = 1 inch, and the inches are PHYSICAL —
 * the mesh is scaled so its own front panel measures the size chart's laid-flat
 * half-chest, and its own body measures the chart's body length:
 *
 *   xzScale = garmentWidthIn / frontArcRaw     (girth: arc, not bbox width)
 *   yScale  = bodyLengthIn  / (hRaw - bodyTopBelowTopRaw)
 *
 * `frontArcRaw` is measured from the mesh's own cross-sections (see
 * src/three/fabricUnwrap.ts) rather than from its bounding box, because a
 * bounding box includes the sleeves and says nothing about how much cloth is
 * wrapped around the torso. This replaces the old `widthFraction` × `wornFactor`
 * pair, which mapped the sleeve-inclusive bbox to the half-chest and then shrank
 * it again — leaving the mesh's front panel carrying only ~63 % of the garment's
 * real fabric, so a true-inch print was physically wider than the visible torso.
 *
 * VERTICAL ANCHORING is collar-relative, not centre-relative. Professional print
 * placement is measured in cm below the collar seam, the 2D art encodes exactly
 * that (GarmentSideArt.collarPx → printAreaPx), and the mesh exposes its own
 * collar seam — so the print is hung from the seam on both, and the two agree
 * without a fudge factor. The old `decalNudgeYIn` constant absorbed the drift of
 * a centre-relative anchor on a mesh whose height was 83 % of the real garment's;
 * with the length now physical there is nothing left for it to absorb. It also
 * could not work for the hoodie at all, whose bounding box centre is displaced
 * by a hood the real garment measures nothing from.
 *
 * Every number below was MEASURED off the shipped GLB, not eyeballed; the
 * measurement scripts live in scripts/fabric-verify.mjs.
 */
import type { CatalogGarmentId } from '@/lib/types'

export interface ModelCalibration {
  /** GLB served from /public. */
  url: string
  /**
   * Name of the mesh that receives decals. When omitted the first mesh found
   * while traversing the scene is used (both bundled models are single-mesh).
   */
  meshName?: string
  /** Extra rotation (radians, around +Y) so the garment faces +Z. */
  rotateY: number
  /**
   * Height window, as fractions of the raw bbox height measured DOWN FROM THE
   * TOP, over which the cross-section is a clean torso: below the armholes (the
   * A-pose sleeves merge into the band above them) and above the hem/pocket.
   * The chest reference arc is the median front arc over this window.
   */
  chestBandFromTop: readonly [number, number]
  /**
   * Raw-unit depth of the SHOULDER LINE below the bbox top. The chart's body
   * length is high-point-shoulder → hem, so anything the mesh carries above the
   * shoulder (a hood) must be excluded from the length scale or the garment
   * renders squashed.
   */
  bodyTopBelowTopRaw: number
  /**
   * Raw-unit depth of the FRONT collar seam below the bbox top — the mesh
   * landmark prints hang from. Only the front is measured: on the hoodie the
   * hood covers the back seam entirely, and the 2D art already knows the
   * front-to-back seam offset (collarPx per side), so one landmark plus the
   * art's own geometry pins both panels.
   */
  neckFrontBelowTopRaw: number
  /** Cotton look: overrides for the recolored garment material. */
  roughness: number
  envMapIntensity: number
  /**
   * Sleeve decal placement — an X-axis flank projection onto the arm (front/back
   * map through the fabric unwrap instead). `yRaw` is the decal-centre height in
   * raw units above the bbox centre, so it follows the mesh at every size
   * instead of drifting as a fixed world inch; `rotZ` is the per-flank tilt
   * (radians) that follows an A-pose arm's slant, sign applied per side.
   */
  sleeve: { yRaw: number; rotZ: number }
}

export const CALIBRATION: Record<CatalogGarmentId, ModelCalibration> = {
  tee: {
    // pmndrs market "shirt_baked" (CC0). Single mesh "Mesh" (node
    // T_Shirt_male), 19.5k tris, lambert1 material with normal + AO maps and
    // no basecolor texture — recolors cleanly through material.color.
    // Raw bbox 0.550w x 0.613h x 0.269d; faces +Z already.
    url: '/models/tee.glb',
    rotateY: 0,
    // Sleeves merge into the torso band above fromTop 0.33; below 0.50 the
    // waist starts tapering. Front arc over this window: 0.4418 ± 3.7 %.
    chestBandFromTop: [0.36, 0.5],
    // The bbox top IS the shoulder: the mesh's top surface reaches 60 % of its
    // max x-extent within 0.5 % of the top.
    bodyTopBelowTopRaw: 0.005,
    neckFrontBelowTopRaw: 0.0475,
    roughness: 0.94,
    envMapIntensity: 1.0,
    // 6.5 world in at the pre-fix yScale of 38.295 — the same physical band.
    sleeve: { yRaw: 0.1697, rotZ: 0 },
  },
  hoodie: {
    // "Hoodie" by ShoyoX/yogaminggames (Sketchfab, CC-BY-4.0), Marvelous
    // Designer garment, simplified 375k -> 67.6k tris and re-packed (see
    // docs/credits/A3.md). Single joined mesh, untextured grey PBR material
    // (recolors via material.color), NO UV set at all. Raw bbox
    // 1.277w x 0.796h x 0.441d — the sleeves stand away from the body and the
    // hood stands above it, which is why neither dimension is used for scale.
    url: '/models/hoodie.glb',
    rotateY: 0,
    // The armholes clear at fromTop 0.47 and the kangaroo pocket starts adding
    // girth by 0.64. Front arc over this window: 0.6318, spread 6.0 % — larger
    // than the tee's 3.6 % because this is a draped Marvelous Designer garment
    // whose folds are real geometry, and comfortably inside the table's 20 %
    // usability gate (scripts/fabric-verify.mjs check A prints both).
    chestBandFromTop: [0.48, 0.62],
    // Hood. The top surface is the hood until x reaches 0.375 of the half-width,
    // where it drops to 0.159 below the top; extrapolating that shoulder slope
    // back to the neck opening puts the high point of the shoulder at ~0.11.
    bodyTopBelowTopRaw: 0.11,
    neckFrontBelowTopRaw: 0.1403,
    roughness: 0.92,
    envMapIntensity: 1.0,
    // 5 world in at the pre-fix yScale of 25.909.
    sleeve: { yRaw: 0.193, rotZ: 0.21 },
  },
}
