/**
 * The document the studio sends, read back by the gate that will receive it.
 *
 * `readDesignDoc` here is the SAME function `worker/design.ts` runs on the way
 * in, so these are not two implementations agreeing by luck: what is asserted
 * is that the set of rasters the uploader collects is exactly the set the
 * server considers referenced. A mismatch in either direction is a 422 at the
 * last click of a purchase, and in the custom-garment direction it is a
 * customer's own garment photo silently never reaching the workshop.
 */
import { describe, expect, it } from 'vitest'
import type { CustomSideSetup, Design, ImageLayer, TextLayer } from '@/lib/types'
import { readDesignDoc } from './designDoc'
import {
  __buildDocumentForTests as buildDocument,
  __referencedAssetsForTests as referencedAssets,
} from './upload'

function textLayer(id: string, side: TextLayer['side']): TextLayer {
  return {
    id,
    type: 'text',
    side,
    name: 'Wordmark',
    text: 'TEESHOOP',
    xIn: 0,
    yIn: 0,
    rotation: 0,
    opacity: 1,
    fontFamily: 'Anton',
    fontSizeIn: 2,
    fill: '#FFFFFF',
    stroke: null,
    strokeWidthIn: 0,
    letterSpacingEm: 0,
    curve: 0,
    align: 'center',
  }
}

function imageLayer(id: string, assetId: string, useCutout = false): ImageLayer {
  return {
    id,
    type: 'image',
    side: 'front',
    name: 'Logo client',
    xIn: 0,
    yIn: 0,
    rotation: 0,
    opacity: 1,
    assetId,
    wIn: 4,
    hIn: 4,
    flipX: false,
    useCutout,
  }
}

function customSide(assetId: string): CustomSideSetup {
  return {
    assetId,
    useCutout: true,
    printArea: { xIn: 2, yIn: 4, wIn: 12, hIn: 16 },
  }
}

function design(over: Partial<Design> = {}): Design {
  return {
    id: 'design0001',
    name: 'Essai',
    garmentId: 'tee',
    colorId: 'black',
    custom: null,
    layers: [textLayer('l1', 'front')],
    stashedLayers: [],
    updatedAt: 1755000000000,
    ...over,
  }
}

const FRONT_400 = [{ id: 'front', area_sq_cm: 400 }]

describe('the uploaded document', () => {
  it('is a design as far as the server that will store it is concerned', () => {
    const doc = buildDocument(design(), FRONT_400)
    const read = readDesignDoc(doc)
    expect(read).not.toBeNull()
    expect(read?.garment).toBe('tee')
    expect(read?.color).toBe('black')
    expect(read?.sides).toEqual(FRONT_400)
  })

  it('carries the measured areas in cm², under the side ids the studio uses', () => {
    const sides = [
      { id: 'front', area_sq_cm: 412.5 },
      { id: 'back', area_sq_cm: 96 },
      { id: 'sleeve', area_sq_cm: 30.25 },
    ]
    expect(readDesignDoc(buildDocument(design(), sides))?.sides).toEqual(sides)
  })

  it('never sends the artwork parked for the other garment context', () => {
    const doc = buildDocument(
      design({
        layers: [textLayer('l1', 'front')],
        stashedLayers: [imageLayer('l9', 'stashed01')],
      }),
      FRONT_400,
    )
    expect(doc.stashedLayers).toEqual([])
    expect(JSON.stringify(doc)).not.toContain('stashed01')
  })

  it('never sends a parked custom garment with a catalogue order', () => {
    const doc = buildDocument(
      design({ garmentId: 'tee', custom: { widthIn: 21, front: customSide('photo001'), back: null } }),
      FRONT_400,
    )
    expect(doc.custom).toBeNull()
    expect(readDesignDoc(doc)?.assetIds).toEqual([])
  })
})

describe('which rasters the order carries', () => {
  /**
   * THE INVARIANT. Every id the uploader will send must be one the server
   * considers referenced, and every id the server considers referenced must be
   * one the uploader sends. `worker/design.ts` refuses on either difference.
   */
  const carried = (d: Design): { id: string; variant: string }[] => {
    const doc = buildDocument(d, FRONT_400)
    const read = readDesignDoc(doc)
    expect(read, 'the built document is not a design at all').not.toBeNull()
    const assets = referencedAssets(d, doc)
    expect(assets, 'the uploader would refuse its own document').not.toBeNull()
    expect(assets?.map((a) => a.id)).toEqual(read?.assetIds)
    return assets ?? []
  }

  it('carries nothing for a text-only design', () => {
    expect(carried(design())).toEqual([])
  })

  it('carries each uploaded image, from the variant its layer draws', () => {
    const d = design({ layers: [imageLayer('l1', 'assetAAA'), imageLayer('l2', 'assetBBB', true)] })
    expect(carried(d)).toEqual([
      { id: 'assetAAA', variant: 'original' },
      { id: 'assetBBB', variant: 'cutout' },
    ])
  })

  it('carries the photos of a ship-your-own garment, which are not layers', () => {
    const d = design({
      garmentId: 'custom',
      custom: { widthIn: 21, front: customSide('photoFRONT'), back: customSide('photoBACK') },
      layers: [imageLayer('l1', 'assetAAA')],
    })
    expect(carried(d).map((a) => a.id)).toEqual(['assetAAA', 'photoFRONT', 'photoBACK'])
  })

  it('carries a raster used twice once', () => {
    const d = design({ layers: [imageLayer('l1', 'same'), imageLayer('l2', 'same')] })
    expect(carried(d)).toHaveLength(1)
  })
})
