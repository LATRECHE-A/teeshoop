/**
 * STUB — module A5 replaces this file entirely (see docs/CONTRACTS.md §A5).
 */
import type { GraphicDef } from '@/lib/types'

export const GRAPHIC_CATEGORIES: { id: string; name: string }[] = [
  { id: 'badges', name: 'Badges' },
]

export const GRAPHICS: GraphicDef[] = [
  {
    id: 'star',
    name: 'Star',
    category: 'badges',
    aspect: 1,
    svg: (color) =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="${color}" d="M50 4 61 36 95 36 68 57 78 91 50 71 22 91 32 57 5 36 39 36 Z"/></svg>`,
  },
  {
    id: 'heart',
    name: 'Heart',
    category: 'badges',
    aspect: 1.1,
    svg: (color) =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 110 100"><path fill="${color}" d="M55 92 C-20 45 15 -8 55 25 C95 -8 130 45 55 92 Z"/></svg>`,
  },
  {
    id: 'bolt',
    name: 'Bolt',
    category: 'badges',
    aspect: 0.62,
    svg: (color) =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 62 100"><path fill="${color}" d="M38 2 6 55 26 55 20 98 56 42 34 42 Z"/></svg>`,
  },
]
