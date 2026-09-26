/**
 * STU-03. Deleting an upload from the library removes its blob at once, so the
 * undo history must not be able to bring back a layer that points at it: that
 * layer drew nothing and exported a 300 PPI print file without the logo.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { AssetMeta } from '@/lib/types'
import { missingImageLayers } from '@/lib/renderDesign'
import { undo, redo, useStore } from './store'

const asset = (id: string): AssetMeta => ({ id, name: `logo ${id}`, width: 600, height: 600, hasCutout: false, createdAt: 0 })

const images = () =>
  useStore
    .getState()
    .design.layers.filter((l) => l.type === 'image')
    .map((l) => (l as { assetId: string }).assetId)

describe('purgeAsset', () => {
  beforeEach(() => {
    useStore.getState().newDesign()
    useStore.temporal.getState().clear()
  })

  it('removes the image, and undo does not bring it back', () => {
    useStore.getState().addImageLayer(asset('a1'))
    expect(images()).toEqual(['a1'])
    useStore.getState().purgeAsset('a1')
    expect(images()).toEqual([])
    undo()
    expect(images()).toEqual([])
  })

  it('keeps the rest of the history, with the image taken out of it', () => {
    useStore.getState().addImageLayer(asset('a1'))
    useStore.getState().addImageLayer(asset('a2'))
    useStore.getState().purgeAsset('a1')
    expect(images()).toEqual(['a2'])
    // Undoing the second upload is still possible, and still does just that.
    undo()
    expect(images()).toEqual([])
    redo()
    expect(images()).toEqual(['a2'])
  })

  it('reaches the redo stack as well', () => {
    useStore.getState().addImageLayer(asset('a1'))
    undo()
    useStore.getState().purgeAsset('a1')
    redo()
    expect(images()).toEqual([])
  })
})

describe('missingImageLayers', () => {
  beforeEach(() => {
    useStore.getState().newDesign()
    // Node has no Image; the loader builds one before it looks for the blob.
    ;(globalThis as { Image?: unknown }).Image ??= class {}
  })

  it('names an image layer whose picture is not in the library', async () => {
    useStore.getState().addImageLayer(asset('gone'))
    const d = useStore.getState().design
    const layer = d.layers.find((l) => l.type === 'image')!
    expect(await missingImageLayers(d, layer.side)).toEqual([layer.name])
  })

  it('names nothing on a side with no image layer', async () => {
    expect(await missingImageLayers(useStore.getState().design, 'back')).toEqual([])
  })
})
