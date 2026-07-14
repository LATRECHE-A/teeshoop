/**
 * Color palettes — module A5.
 *
 * GARMENT_COLORS: the stocked garment dye colors (ids are stable and are what
 * `Design.colorId` stores). INK_COLORS: the print-ink swatches offered for
 * text/graphic fills — a screen-print-shop style deck: white/black/grays,
 * metallic-ish gold + silver approximations, and CMYK-leaning brights.
 */

export const GARMENT_COLORS: { id: string; name: string; hex: string }[] = [
  { id: 'white', name: 'White', hex: '#FFFFFF' },
  { id: 'black', name: 'Black', hex: '#191C20' },
  { id: 'heather', name: 'Heather', hex: '#B7BCC2' },
  { id: 'charcoal', name: 'Charcoal', hex: '#3E434A' },
  { id: 'navy', name: 'Navy', hex: '#1F2A44' },
  { id: 'royal', name: 'Royal', hex: '#2454B5' },
  { id: 'red', name: 'Red', hex: '#C0272D' },
  { id: 'maroon', name: 'Maroon', hex: '#6E2231' },
  { id: 'forest', name: 'Forest', hex: '#1E4634' },
  { id: 'kelly', name: 'Kelly', hex: '#2E8B47' },
  { id: 'sand', name: 'Sand', hex: '#D9CBB2' },
  { id: 'brown', name: 'Brown', hex: '#5B4636' },
  { id: 'purple', name: 'Purple', hex: '#5B3B8C' },
  { id: 'pink', name: 'Pink', hex: '#F3A6C0' },
  { id: 'sky', name: 'Sky', hex: '#A8CFE8' },
  { id: 'orange', name: 'Orange', hex: '#E8722A' },
  { id: 'gold', name: 'Gold', hex: '#F2B32C' },
  { id: 'mint', name: 'Mint', hex: '#BFE3D0' },
]

/**
 * 16 print-ink hexes, in swatch-deck order:
 * white, black, cool gray, silver, gold, cream, red, orange, yellow, kelly,
 * teal, cyan, royal, purple, magenta, maroon.
 */
export const INK_COLORS: string[] = [
  '#FFFFFF',
  '#111111',
  '#9AA5B4',
  '#C9CED6',
  '#F2B32C',
  '#F5EBDD',
  '#E03A3E',
  '#F2701D',
  '#FFD23F',
  '#2E9E4F',
  '#159A9C',
  '#35C7FF',
  '#2454B5',
  '#6D3BC7',
  '#FF3D8F',
  '#7A2E3A',
]
