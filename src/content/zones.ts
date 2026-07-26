/**
 * Print-placement zones — editor guides AND click/drop upload targets (they do
 * NOT change pricing).
 *
 * Two families:
 *  - Paper formats (A3/A4/A5) — the affordable print tiers users know.
 *  - Professional placements ("upload zones") — the industry-standard spots a
 *    print shop measures from the collar seam in CENTIMETRES: left-chest
 *    ("cœur") logo, centre chest, bottom hem, locker patch (upper back),
 *    centre back, sleeve logo. Sizes/offsets follow the pro convention tables
 *    (ScreenPrinting.com / Ninja Transfers / Printful): the offsets from the
 *    collar are size-invariant — only the garment scales.
 *
 * Geometry is in INCHES relative to the print-area CENTRE (+x right, +y down)
 * — the exact convention layers use (LayerBase.xIn/yIn) — so a zone centre
 * maps to a layer position directly. For catalog garments the vertical
 * anchor chain is: collar seam (GarmentSideArt.collarPx) → print-area top
 * (known physical gap) → zone. Customer-shipped garments (no known collar)
 * fall back to proportional placement.
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
  /** The affordable standard tier — emphasised in the UI. */
  standard?: boolean
  /** Semantic placement that acts as a click-to-upload / drop target. */
  upload?: boolean
}

/** ISO paper sizes, inches (portrait). */
const PAPER = {
  a3: { w: 11.69, h: 16.54 },
  a4: { w: 8.27, h: 11.69 },
  a5: { w: 5.83, h: 8.27 },
} as const

/** Pro placement constants, cm (converted at the edge). */
const CM = {
  leftChest: { w: 10, h: 10, topBelowCollar: 7, offCenter: 9.5 },
  centerChest: { w: 20, h: 10, topBelowCollar: 7.5 },
  bottomHem: { w: 20, h: 8, bottomMargin: 5 },
  lockerPatch: { w: 30.5, h: 10 },
  centerBack: { w: 30.5, h: 35.6, belowLocker: 12 },
  sleeve: { w: 7.6, h: 7.6 },
} as const

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
    const lc = CM.leftChest
    zones.push(
      clampZone(
        {
          id: 'left_chest',
          nameKey: 'zone.left_chest',
          wIn: cmToIn(lc.w),
          hIn: cmToIn(lc.h),
          // Viewer's left (the mockup convention for the wearer's heart side).
          cxIn: -cmToIn(lc.offCenter),
          cyIn: topAt(lc.topBelowCollar, cmToIn(lc.h)),
          upload: true,
        },
        wIn,
        hIn,
      ),
    )
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
    zones.push(
      clampZone({ id: 'left_chest', nameKey: 'zone.left_chest', wIn: s, hIn: s, cxIn: -(wIn * 0.24), cyIn: -(hIn * 0.3), upload: true }, wIn, hIn),
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
 * changed. The zone a user picks is size-invariant by design — a left-chest
 * logo is a left-chest logo on an S and on a 3XL — and rendering re-scales it
 * for the previewed size on the way out.
 */
export function zonesFor(design: Design, side: Side): PrintZone[] {
  // Base space on purpose — see the note above. Do NOT add a size argument.
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
