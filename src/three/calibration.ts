/**
 * Per-model calibration for the 3D preview (module A3).
 *
 * World space convention: 1 world unit = 1 inch. Every model is normalized at
 * load time (see useNormalizedGarment in GarmentModel.tsx): its geometry is
 * baked to scene orientation, rotated by `rotateY`, centered on its
 * bounding-box center and uniformly scaled so that
 *
 *   bboxWidth * widthFraction === garmentWidthIn   (world units = inches)
 *
 * `widthFraction` exists because a 3D model's bounding box may include
 * outstretched sleeves that the 2D laid-flat art (which defines
 * `garmentWidthIn`) drapes at the garment's side. The values below were
 * calibrated visually against the harness' 1-inch grid decal.
 */
import type { CatalogGarmentId, Side } from '@/lib/types'

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
  /** Fraction of the model bbox width that equals the laid-flat width. */
  widthFraction: number
  /**
   * How much narrower the WORN garment is than laid-flat, applied to X/Z only
   * (height/Y preserved). A laid-flat 21.5in tee wraps to a ~17in worn front —
   * scaling the mesh girth to the laid-flat width over-inflated the torso ~20%,
   * so a true-inch print read undersized (~56%) vs the physically-correct worn
   * AR view (~72%). This narrows the girth to the worn width so the SAME true-
   * inch print reads consistently in the 3D preview and AR. 1 = laid-flat.
   */
  wornFactor: number
  /**
   * Extra per-side nudge of the decal center in inches (+down). Applied on
   * top of props.areaOffsetYIn to absorb model-vs-2D-art proportion drift
   * (e.g. the tee model torso is cropped shorter than a real 29in tee).
   */
  decalNudgeYIn: Record<Side, number>
  /** Decal projection depth as a fraction of the decal width (thin!). */
  decalDepthFraction: number
  /**
   * How far (fraction of depth) the projector center is pushed from the
   * raycast surface point toward the garment interior, so the thin box still
   * covers surface that curves away at the decal edges.
   */
  decalInset: number
  /** Cotton look: overrides for the recolored garment material. */
  roughness: number
  envMapIntensity: number
  /**
   * Sleeve decal placement — an X-axis flank projection onto the arm (front/back
   * project along ±Z). yIn = decal-centre height (world inches, +up, ≈ upper
   * arm); depthFraction like decalDepthFraction; rotZ = per-flank tilt (radians)
   * to follow an A-pose arm's slant (sign applied per side).
   */
  sleeve: { yIn: number; depthFraction: number; rotZ: number }
}

export const CALIBRATION: Record<CatalogGarmentId, ModelCalibration> = {
  tee: {
    // pmndrs market "shirt_baked" (CC0). Single mesh "Mesh" (node
    // T_Shirt_male), 19.5k tris, lambert1 material with normal + AO maps and
    // no basecolor texture — recolors cleanly through material.color.
    // Raw bbox 0.550w x 0.613h x 0.269d; faces +Z already.
    url: '/models/tee.glb',
    rotateY: 0,
    // The model torso reads ~24in long at bbox width 21.5in (a real tee is
    // ~29in) — the model is a slightly cropped/boxy fit. Width mapping stays
    // 1:1 with the bbox: sleeves hang down like the 2D art.
    widthFraction: 1.0,
    // A 21.5in laid-flat tee is ~17in across the worn front; 0.80 narrows the
    // girth to that so a 12in print reads ~0.67 of the visible torso (matching
    // the worn AR avatar) instead of the over-inflated ~0.52.
    wornFactor: 0.8,
    // The torso is ~0.83x the height of the 29in 2D art, so 2D print-area
    // offsets land too close to the collar; push down and use a slightly
    // deeper projector so the top decal rows survive the shoulder curvature.
    decalNudgeYIn: { front: 1.2, back: 1.2, sleeve: 0 },
    decalDepthFraction: 0.18,
    decalInset: 0.22,
    roughness: 0.94,
    envMapIntensity: 1.0,
    sleeve: { yIn: 6.5, depthFraction: 0.2, rotZ: 0 },
  },
  hoodie: {
    // "Hoodie" by ShoyoX/yogaminggames (Sketchfab, CC-BY-4.0), Marvelous
    // Designer garment, simplified 375k -> 67.6k tris and re-packed (see
    // docs/credits/A3.md). Single joined mesh, untextured grey PBR material
    // (recolors via material.color). Raw bbox 1.277w x 0.796h x 0.441d —
    // the sleeves stand away from the body, hence widthFraction < 1.
    url: '/models/hoodie.glb',
    rotateY: 0,
    // A-pose arms inflate the bbox; measured against the 12in grid decal,
    // 0.66 puts the body (pit-to-pit) at ~22in for a 23in laid-flat hoodie.
    widthFraction: 0.66,
    // The hoodie is modeled loose/oversized already, so it needs less worn
    // narrowing than the tee — 0.86 trims the boxy girth without over-slimming.
    wornFactor: 0.86,
    // Keep prints clear of the hood: front sits between drawcords and pocket;
    // the back print must start BELOW the hanging hood or its projector
    // catches the hood's top fold (seen as smears from the front).
    decalNudgeYIn: { front: 1.2, back: 2.2, sleeve: 0 },
    decalDepthFraction: 0.18,
    decalInset: 0.22,
    roughness: 0.92,
    envMapIntensity: 1.0,
    sleeve: { yIn: 5, depthFraction: 0.34, rotZ: 0.21 },
  },
}
