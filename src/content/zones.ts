/**
 * Print-placement zones: editor guides AND click/drop upload targets (they do
 * NOT change pricing).
 *
 * Two families:
 *  - Paper formats (A3/A4/A5), the affordable print tiers users know.
 *  - Professional placements ("upload zones"), the industry-standard spots a
 *    print shop measures from the collar seam in CENTIMETRES: left-chest
 *    ("cœur") logo, centre chest, bottom hem, locker patch (upper back),
 *    centre back, sleeve logo. Sizes/offsets follow the pro convention tables
 *    (ScreenPrinting.com / Ninja Transfers / Printful): the offsets from the
 *    collar are size-invariant: only the garment scales.
 *
 * Geometry is in INCHES relative to the print-area CENTRE (+x right, +y down),
 * the exact convention layers use (LayerBase.xIn/yIn), so a zone centre
 * maps to a layer position directly. For catalog garments the vertical
 * anchor chain is: collar seam (GarmentSideArt.collarPx) → print-area top
 * (known physical gap) → zone. Customer-shipped garments (no known collar)
 * fall back to proportional placement.
 *
 * WHICH SIDE OF THE BODY IS +x? (this was wrong for a long time: the heart
 * logo printed on the wearer's right.) Traced through the renderers, not
 * assumed:
 *   renderPrintArea draws a layer at canvasWidth/2 + xIn·ppi ⇒ +xIn is
 *   canvas-RIGHT (src/lib/renderDesign.ts).
 *   The 3D/AR fabric mapping sets u = 0.5 + s/areaW with s the signed arc from
 *   the centre-front line and θ = atan2(x, z), so world +X ⇒ s > 0 ⇒ u > 0.5 ⇒
 *   canvas-right (src/three/decalGeom.ts). With the camera on +Z, world +X is
 *   screen-right, and a figure facing the camera has its LEFT hand at +X.
 *   ⇒ FRONT: canvas-right = viewer's right = the WEARER'S LEFT (heart side).
 *   The back panel re-references s to the centre BACK, which mirrors it, and
 *   the back is viewed from −Z where +X is screen-left.
 *   ⇒ BACK: canvas-right = the WEARER'S RIGHT.
 * So marking the same body side on both panels means NEGATING cx between them,
 * which is what `bodySideSign` below does.
 */
import type { CatalogGarmentId, Design, Side } from '@/lib/types'
import { GARMENTS } from '@/garments'
import { getAreaSizeIn } from '@/lib/renderDesign'
import { cmToIn } from '@/lib/units'

export interface PrintZone {
  id: string
  /** i18n key for the display name. */
  nameKey: string
  wIn: number
  hIn: number
  /** Zone centre offset from the print-area centre, inches. */
  cxIn: number
  cyIn: number
  /** The affordable standard tier, emphasised in the UI. */
  standard?: boolean
  /** Semantic placement that acts as a click-to-upload / drop target. */
  upload?: boolean
}

/**
 * ISO paper sizes, inches (portrait). Exported because the custom-garment
 * print-area placer offers the same A4/A3 chips: one table, no drift.
 */
export const PAPER_IN = {
  a3: { w: 11.69, h: 16.54 },
  a4: { w: 8.27, h: 11.69 },
  a5: { w: 5.83, h: 8.27 },
} as const
const PAPER = PAPER_IN

/**
 * Pro placement constants, cm (converted at the edge).
 *
 * EXPORTED on purpose: the custom/ingested-garment placer
 * (src/app/PrintAreaPlacer.tsx) measures its guides, snaps and preset chips
 * from a photo's detected collar with THESE numbers, so a "centre chest" on a
 * catalog tee and on a customer's own tee are the same placement by
 * construction rather than by two hand-kept copies.
 *
 * `lockerPatch.topBelowCollar` is the convention the catalog path expresses
 * implicitly (its back print areas already START 10 cm below the collar, see
 * catalogZones); the custom path has no pre-anchored area, so it needs the
 * number spelled out.
 */
export const PLACEMENT_CM = {
  leftChest: { w: 10, h: 10, topBelowCollar: 7, offCenter: 9.5 },
  centerChest: { w: 20, h: 10, topBelowCollar: 7.5 },
  bottomHem: { w: 20, h: 8, bottomMargin: 5 },
  lockerPatch: { w: 30.5, h: 10, topBelowCollar: 10 },
  centerBack: { w: 30.5, h: 35.6, belowLocker: 12 },
  sleeve: { w: 7.6, h: 7.6 },
} as const
const CM = PLACEMENT_CM

/** Physical gap collar-seam → print-area top for a catalog side, inches. */
function collarGapIn(garment: CatalogGarmentId, side: Side): number {
  const art = GARMENTS[garment]
  const s = art.sides[side]
  return (s.printAreaPx.y - s.collarPx.y) / art.pxPerInch
}

/** Paper-format zones that physically fit, biased toward the chest. */
function paperZones(wIn: number, hIn: number): PrintZone[] {
  const zones: PrintZone[] = []
  for (const [id, p] of [
    ['a3', PAPER.a3],
    ['a4', PAPER.a4],
    ['a5', PAPER.a5],
  ] as const) {
    if (p.w <= wIn + 0.02 && p.h <= hIn + 0.02) {
      const cyIn = -Math.max(0, (hIn - p.h) / 2 - Math.min(1.4, hIn * 0.08))
      zones.push({ id, nameKey: `zone.${id}`, wIn: p.w, hIn: p.h, cxIn: 0, cyIn, standard: id === 'a4' })
    }
  }
  return zones
}

/**
 * Sign of `cxIn` that puts a zone on the WEARER'S LEFT for a given panel.
 * See the handedness note in the module header: the front and back panels
 * disagree, and this is the one place that knows it.
 */
const bodySideSign = (side: Side): 1 | -1 => (side === 'back' ? -1 : 1)

/** Clamp a zone fully inside the print area (centre coords). */
function clampZone(z: PrintZone, wIn: number, hIn: number): PrintZone | null {
  if (z.wIn > wIn + 0.02 || z.hIn > hIn + 0.02) return null
  const maxCx = (wIn - z.wIn) / 2
  const maxCy = (hIn - z.hIn) / 2
  return {
    ...z,
    cxIn: Math.max(-maxCx, Math.min(maxCx, z.cxIn)),
    cyIn: Math.max(-maxCy, Math.min(maxCy, z.cyIn)),
  }
}

/**
 * The mirrored pair of off-centre logo spots on one panel: heart-side first,
 * then its exact negation. Two zones rather than one because sports and
 * workwear routinely print BOTH (crest left, sponsor right), and a user who
 * wants the right one should not have to drag the left one across the chest.
 *
 * `leftId` is always the WEARER'S left. `bodySideSign` turns that into the
 * panel's cx sign, so front and back mark the same shoulder.
 */
function chestPair(
  side: Side,
  leftId: string,
  rightId: string,
  topBelowCollarCm: number,
  topAt: (topBelowCollarCm: number, zoneHIn: number) => number,
  wIn: number,
  hIn: number,
): PrintZone[] {
  const lc = CM.leftChest
  const s = bodySideSign(side)
  const size = { wIn: cmToIn(lc.w), hIn: cmToIn(lc.h) }
  const cyIn = topAt(topBelowCollarCm, size.hIn)
  return [
    { id: leftId, nameKey: `zone.${leftId}`, ...size, cxIn: s * cmToIn(lc.offCenter), cyIn, upload: true },
    { id: rightId, nameKey: `zone.${rightId}`, ...size, cxIn: -s * cmToIn(lc.offCenter), cyIn, upload: true },
  ]
    .map((z) => clampZone(z, wIn, hIn))
    .filter((z): z is PrintZone => z !== null)
}

/**
 * Catalog zones, anchored in real cm from the collar seam. `gapIn` is the
 * collar→print-top distance; zone tops are expressed "cm below collar", so a
 * zone's centre offset from the print-area centre is
 *   (topBelowCollar − gap) + zoneH/2 − areaH/2   (clamped into the area).
 */
function catalogZones(garment: CatalogGarmentId, side: Side, wIn: number, hIn: number): PrintZone[] {
  const gapIn = collarGapIn(garment, side)
  const topAt = (topBelowCollarCm: number, zoneHIn: number): number =>
    Math.max(0, cmToIn(topBelowCollarCm) - gapIn) + zoneHIn / 2 - hIn / 2

  const zones: (PrintZone | null)[] = []

  if (side === 'sleeve') {
    const s = { wIn: cmToIn(CM.sleeve.w), hIn: cmToIn(CM.sleeve.h) }
    zones.push(clampZone({ id: 'sleeve_logo', nameKey: 'zone.sleeve_logo', ...s, cxIn: 0, cyIn: 0, upload: true }, wIn, hIn))
  } else if (side === 'front') {
    zones.push(...chestPair(side, 'left_chest', 'right_chest', CM.leftChest.topBelowCollar, topAt, wIn, hIn))
    const cc = CM.centerChest
    zones.push(
      clampZone(
        {
          id: 'center_chest',
          nameKey: 'zone.center_chest',
          wIn: cmToIn(cc.w),
          hIn: cmToIn(cc.h),
          cxIn: 0,
          cyIn: topAt(cc.topBelowCollar, cmToIn(cc.h)),
          upload: true,
        },
        wIn,
        hIn,
      ),
    )
    const bh = CM.bottomHem
    zones.push(
      clampZone(
        {
          id: 'bottom_center',
          nameKey: 'zone.bottom_center',
          wIn: cmToIn(bh.w),
          hIn: cmToIn(bh.h),
          cxIn: 0,
          cyIn: hIn / 2 - cmToIn(bh.bottomMargin) - cmToIn(bh.h) / 2,
          upload: true,
        },
        wIn,
        hIn,
      ),
    )
  } else {
    const lp = CM.lockerPatch
    zones.push(
      clampZone(
        {
          id: 'upper_back',
          nameKey: 'zone.upper_back',
          wIn: Math.min(cmToIn(lp.w), wIn * 0.96),
          hIn: cmToIn(lp.h),
          cxIn: 0,
          // Back print areas already start at the pro "10 cm below collar".
          cyIn: cmToIn(lp.h) / 2 - hIn / 2,
          upload: true,
        },
        wIn,
        hIn,
      ),
    )
    // Shoulder-blade logos: the back's mirror of the chest pair, at the locker
    // patch's height so a blade logo lines up with a locker patch beside it.
    zones.push(...chestPair(side, 'left_blade', 'right_blade', lp.topBelowCollar, topAt, wIn, hIn))
    const cb = CM.centerBack
    const cbH = Math.min(cmToIn(cb.h), hIn - cmToIn(cb.belowLocker) - 0.5)
    zones.push(
      clampZone(
        {
          id: 'center_back',
          nameKey: 'zone.center_back',
          wIn: Math.min(cmToIn(cb.w), wIn),
          hIn: cbH,
          cxIn: 0,
          cyIn: cmToIn(cb.belowLocker) + cbH / 2 - hIn / 2,
          upload: true,
        },
        wIn,
        hIn,
      ),
    )
  }

  return zones.filter((z): z is PrintZone => z !== null)
}

/** Proportional fallback for customer-shipped garments (no known collar). */
function customZones(side: Side, wIn: number, hIn: number): PrintZone[] {
  if (side === 'sleeve') return []
  const zones: (PrintZone | null)[] = []
  if (side === 'front') {
    const s = Math.min(4, wIn * 0.36)
    const off = wIn * 0.24
    zones.push(
      clampZone({ id: 'left_chest', nameKey: 'zone.left_chest', wIn: s, hIn: s, cxIn: bodySideSign(side) * off, cyIn: -(hIn * 0.3), upload: true }, wIn, hIn),
      clampZone({ id: 'right_chest', nameKey: 'zone.right_chest', wIn: s, hIn: s, cxIn: -bodySideSign(side) * off, cyIn: -(hIn * 0.3), upload: true }, wIn, hIn),
      clampZone({ id: 'center_chest', nameKey: 'zone.center_chest', wIn: wIn * 0.7, hIn: hIn * 0.24, cxIn: 0, cyIn: -(hIn * 0.3), upload: true }, wIn, hIn),
      clampZone({ id: 'bottom_center', nameKey: 'zone.bottom_center', wIn: wIn * 0.6, hIn: hIn * 0.2, cxIn: 0, cyIn: hIn * 0.34, upload: true }, wIn, hIn),
    )
  } else {
    zones.push(
      clampZone({ id: 'upper_back', nameKey: 'zone.upper_back', wIn: wIn * 0.86, hIn: hIn * 0.2, cxIn: 0, cyIn: -(hIn * 0.36), upload: true }, wIn, hIn),
      clampZone({ id: 'center_back', nameKey: 'zone.center_back', wIn: Math.min(12, wIn * 0.8), hIn: Math.min(14, hIn * 0.6), cxIn: 0, cyIn: hIn * 0.06, upload: true }, wIn, hIn),
    )
  }
  return zones.filter((z): z is PrintZone => z !== null)
}

/**
 * The full set of placement zones for a design's active side.
 *
 * NO `size` is passed to getAreaSizeIn, and none ever must be: zones exist to
 * POSITION layers, and layer geometry is stored once in BASE-size inches (see
 * src/lib/printScale.ts). Grading a zone would write graded inches into a
 * base-space field, so the artwork would drift every time the preview size
 * changed. The zone a user picks is size-invariant by design (a left-chest
 * logo is a left-chest logo on an S and on a 3XL), and rendering re-scales it
 * for the previewed size on the way out.
 */
export function zonesFor(design: Design, side: Side): PrintZone[] {
  // Base space on purpose: see the note above. Do NOT add a size argument.
  const { wIn, hIn } = getAreaSizeIn(design, side)
  const zones: PrintZone[] = [
    { id: 'full', nameKey: 'zone.full', wIn, hIn, cxIn: 0, cyIn: 0 },
  ]

  if (design.garmentId === 'custom') {
    zones.push(...customZones(side, wIn, hIn))
  } else {
    zones.push(...catalogZones(design.garmentId, side, wIn, hIn))
  }
  if (side !== 'sleeve') zones.push(...paperZones(wIn, hIn))
  return zones
}

/** Upload-target zones only (click-to-upload / drag-drop spots). */
export function uploadZonesFor(design: Design, side: Side): PrintZone[] {
  return zonesFor(design, side).filter((z) => z.upload)
}
