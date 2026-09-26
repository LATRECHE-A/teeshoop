/**
 * STU-05. « Mes designs » is keyed by design.id; these are the two ways a
 * second document came to carry an id the library already held.
 */
import { describe, expect, it } from 'vitest'
import { makeSampleDesign } from '@/content/sampleDesign'
import { designToSave, importDesignFile } from './persist'

describe('what may overwrite a saved design', () => {
  it('imports a design file as a copy with a fresh id', async () => {
    const original = makeSampleDesign()
    const file = new Blob([JSON.stringify({ v: 1, app: 'tshop', design: original, assets: {} })])
    const imported = await importDesignFile(file)
    expect(imported.id).not.toBe(original.id)
    expect(imported.layers.map((l) => l.id)).toEqual(original.layers.map((l) => l.id))
  })

  it('saves a basket line opened on the board under its own id, and the draft under its own', () => {
    const draft = makeSampleDesign()
    expect(designToSave(draft, null)).toBe(draft)
    const line = designToSave(draft, 'ligne123')
    expect(line.id).toBe('ligne123')
    expect(line.id).not.toBe(draft.id)
    expect(designToSave(draft, 'ligne123').id).toBe(line.id)
  })
})
