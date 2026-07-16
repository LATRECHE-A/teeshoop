/**
 * Print-placement zones — editor guides only (they do NOT change pricing).
 *
 * Zones help users drop artwork onto common areas precisely: standard paper
 * sizes (A4 is the affordable standard, A5 smaller) plus garment areas (chest,
 * left-chest logo, upper/centre back). Geometry is in INCHES relative to the
 * print-area CENTRE (+x right, +y down) — the exact convention layers use
 * (LayerBase.xIn/yIn) — so a zone centre maps to a layer position directly.
 *
 * Derived from `getAreaSizeIn`, so it works for tee/hoodie AND customer
 * garments without per-garment tables.
 */
import type { Design, Side } from '@/lib/types'
import { getAreaSizeIn } from '@/lib/renderDesign'

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
}

/** ISO paper sizes, inches (portrait). */
const PAPER = {
  a3: { w: 11.69, h: 16.54 },
  a4: { w: 8.27, h: 11.69 },
  a5: { w: 5.83, h: 8.27 },
} as const

/** The full set of placement zones for a design's active side. */
export function zonesFor(design: Design, side: Side): PrintZone[] {
  const { wIn, hIn } = getAreaSizeIn(design, side)
  const zones: PrintZone[] = [
    { id: 'full', nameKey: 'zone.full', wIn, hIn, cxIn: 0, cyIn: 0 },
  ]

  if (side === 'sleeve') {
    // Sleeves take a small centred logo; paper/chest zones don't apply.
    const s = Math.min(3, Math.min(wIn, hIn) * 0.8)
    zones.push({ id: 'sleeve_logo', nameKey: 'zone.sleeve_logo', wIn: s, hIn: s, cxIn: 0, cyIn: 0 })
    return zones
  }

  // Standard paper sizes that physically fit, biased slightly toward the top
  // (where chest prints sit). A4 is the highlighted affordable standard.
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

  // A wide band near the top: chest (front) / upper back.
  const bandH = Math.min(4.5, hIn * 0.34)
  const bandCy = -(hIn / 2 - bandH / 2 - Math.min(1.3, hIn * 0.08))
  zones.push({
    id: side === 'front' ? 'chest' : 'upper_back',
    nameKey: side === 'front' ? 'zone.chest' : 'zone.upper_back',
    wIn: wIn * 0.86,
    hIn: bandH,
    cxIn: 0,
    cyIn: bandCy,
  })

  if (side === 'front') {
    // Small left-chest logo (viewer's left, the usual mockup convention).
    const s = Math.min(4.2, wIn * 0.36)
    zones.push({ id: 'left_chest', nameKey: 'zone.left_chest', wIn: s, hIn: s, cxIn: -(wIn * 0.24), cyIn: -(hIn * 0.28) })
  } else {
    const s = Math.min(8, wIn * 0.7)
    zones.push({ id: 'center_back', nameKey: 'zone.center_back', wIn: s, hIn: s, cxIn: 0, cyIn: 0 })
  }

  return zones
}
