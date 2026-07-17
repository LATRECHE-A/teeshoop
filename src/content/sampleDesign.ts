/**
 * First-load sample design — module A5.
 *
 * A print-shop-credible starter on the black tee: a classic collegiate lockup
 * (arched wordmark over a gold starburst seal with a tracking-heavy subline)
 * plus a small nape hit on the back. All geometry is inches relative to the
 * print-area center (front area 12×16). Uses only pinned fonts (Anton,
 * Oswald), graphic ids from this module's GRAPHICS registry, and INK_COLORS
 * values (#FFFFFF white, #F2B32C gold, #C9CED6 silver).
 */
import { nanoid } from 'nanoid'
import type { Design, GraphicLayer, TextLayer } from '@/lib/types'
import { GRAPHICS } from './graphics'

/** Height in inches for a graphic drawn `wIn` wide at its native aspect. */
function heightFor(graphicId: string, wIn: number): number {
  const def = GRAPHICS.find((g) => g.id === graphicId)
  const aspect = def ? def.aspect : 1
  return Math.round((wIn / aspect) * 100) / 100
}

export function makeSampleDesign(): Design {
  const arch: TextLayer = {
    id: nanoid(8),
    type: 'text',
    side: 'front',
    name: 'Arch text',
    text: 'TSHOP',
    xIn: 0,
    yIn: -4.2,
    rotation: 0,
    opacity: 1,
    fontFamily: 'Anton',
    fontSizeIn: 2.0,
    fill: '#FFFFFF',
    stroke: null,
    strokeWidthIn: 0,
    letterSpacingEm: 0.08,
    curve: 35, // classic collegiate arch — middle raised, ends dropped
    align: 'center',
  }

  const seal: GraphicLayer = {
    id: nanoid(8),
    type: 'graphic',
    side: 'front',
    name: 'Badge',
    graphicId: 'starburst-seal',
    xIn: 0,
    yIn: 0.2,
    rotation: 0,
    opacity: 1,
    wIn: 3.2,
    hIn: heightFor('starburst-seal', 3.2),
    fill: '#F2B32C',
    flipX: false,
  }

  const subline: TextLayer = {
    id: nanoid(8),
    type: 'text',
    side: 'front',
    name: 'Subline',
    text: 'CUSTOM APPAREL · EST. 2019',
    xIn: 0,
    yIn: 3.1,
    rotation: 0,
    opacity: 1,
    fontFamily: 'Oswald',
    fontSizeIn: 0.45,
    fill: '#C9CED6',
    stroke: null,
    strokeWidthIn: 0,
    letterSpacingEm: 0.28,
    curve: 0,
    align: 'center',
  }

  const napeBadge: GraphicLayer = {
    id: nanoid(8),
    type: 'graphic',
    side: 'back',
    name: 'Nape badge',
    graphicId: 'star-badge',
    xIn: 0,
    yIn: -6.2,
    rotation: 0,
    opacity: 1,
    wIn: 1.6,
    hIn: heightFor('star-badge', 1.6),
    fill: '#F2B32C',
    flipX: false,
  }

  return {
    id: nanoid(10),
    name: 'TSHOP classic',
    garmentId: 'tee',
    colorId: 'black',
    custom: null,
    layers: [seal, arch, subline, napeBadge],
    // Custom (ship-your-own) garment starts blank — design it fresh on the
    // uploaded garment; the catalog design above is never forced onto it.
    stashedLayers: [],
    updatedAt: Date.now(),
  }
}
