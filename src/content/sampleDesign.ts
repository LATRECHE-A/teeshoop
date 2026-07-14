/**
 * STUB — module A5 replaces this file entirely (see docs/CONTRACTS.md §A5).
 */
import { nanoid } from 'nanoid'
import type { Design } from '@/lib/types'

export function makeSampleDesign(): Design {
  return {
    id: nanoid(10),
    name: 'My first design',
    garmentId: 'tee',
    colorId: 'black',
    custom: null,
    layers: [
      {
        id: nanoid(8),
        type: 'text',
        side: 'front',
        name: 'TSHOP',
        text: 'TSHOP',
        xIn: 0,
        yIn: -3,
        rotation: 0,
        opacity: 1,
        fontFamily: 'Anton',
        fontSizeIn: 2.2,
        fill: '#FFFFFF',
        stroke: null,
        strokeWidthIn: 0,
        letterSpacingEm: 0.06,
        curve: 35,
        align: 'center',
      },
    ],
    updatedAt: 0,
  }
}
