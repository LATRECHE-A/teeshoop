/**
 * STUB — module A1 replaces this file entirely (see docs/CONTRACTS.md §A1).
 * Placeholder silhouettes with CORRECT metadata so geometry code is exercised.
 */
import type { GarmentArt } from '@/lib/types'

const PPI = 25

function placeholderSvg(label: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800">
  <path d="M290 78 L212 108 L96 190 L156 296 L232 252 L232 722 L568 722 L568 252 L644 296 L704 190 L588 108 L510 78 Q450 122 400 122 Q350 122 290 78 Z"
    fill="__COLOR__" stroke="rgba(0,0,0,.25)" stroke-width="3"/>
  <path d="M290 78 Q350 122 400 122 Q450 122 510 78 Q460 108 400 108 Q340 108 290 78 Z" fill="rgba(0,0,0,.18)"/>
  <text x="400" y="770" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#666">${label} (placeholder)</text>
</svg>`
}

const emptyShade = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800"></svg>`

function side(label: string, area: { x: number; y: number; w: number; h: number }) {
  return { body: placeholderSvg(label), shade: emptyShade, printAreaPx: area }
}

export const GARMENTS: Record<'tee' | 'hoodie', GarmentArt> = {
  tee: {
    id: 'tee',
    name: 'Classic Tee',
    pxPerInch: PPI,
    widthIn: 21.5,
    printAreasIn: {
      front: { wIn: 12, hIn: 16 },
      back: { wIn: 12, hIn: 16 },
    },
    sides: {
      front: side('tee front', { x: 250, y: 163, w: 300, h: 400 }),
      back: side('tee back', { x: 250, y: 188, w: 300, h: 400 }),
    },
  },
  hoodie: {
    id: 'hoodie',
    name: 'Pullover Hoodie',
    pxPerInch: PPI,
    widthIn: 23,
    printAreasIn: {
      front: { wIn: 12, hIn: 12 },
      back: { wIn: 12, hIn: 14 },
    },
    sides: {
      front: side('hoodie front', { x: 250, y: 210, w: 300, h: 300 }),
      back: side('hoodie back', { x: 250, y: 195, w: 300, h: 350 }),
    },
  },
}
