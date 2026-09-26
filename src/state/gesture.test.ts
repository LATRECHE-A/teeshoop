/**
 * STU-04. A slider scrub whose pointerup never came left its pre-gesture state
 * behind, and the next commit on ANOTHER layer rewound to it: the first layer's
 * opacity went silently back while the second one moved.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { undo, useStore } from './store'

const layer = (i: number) => useStore.getState().design.layers[i]

describe('a gesture that never ended', () => {
  beforeEach(() => {
    useStore.getState().newDesign()
    useStore.getState().addTextLayer('A')
    useStore.getState().addTextLayer('B')
    useStore.temporal.getState().clear()
  })

  it('is kept when another layer is committed, and undone as its own step', () => {
    const [a, b] = [layer(0).id, layer(1).id]
    useStore.getState().patchLayer(a, { opacity: 0.5 }, { transient: true })
    useStore.getState().patchLayer(b, { xIn: 1 })
    expect(layer(0).opacity).toBe(0.5)
    expect(layer(1).xIn).toBe(1)
    undo()
    expect(layer(1).xIn).toBe(0)
    expect(layer(0).opacity).toBe(0.5)
    undo()
    expect(layer(0).opacity).toBe(1)
  })

  it('still folds a finished gesture into one step', () => {
    const a = layer(0).id
    useStore.getState().patchLayer(a, { opacity: 0.8 }, { transient: true })
    useStore.getState().patchLayer(a, { opacity: 0.6 }, { transient: true })
    useStore.getState().patchLayer(a, { opacity: 0.4 })
    expect(useStore.temporal.getState().pastStates.length).toBe(1)
    undo()
    expect(layer(0).opacity).toBe(1)
  })

  it('records no step for a commit that changes nothing', () => {
    const a = layer(0).id
    useStore.getState().patchLayer(a, { opacity: 1 })
    expect(useStore.temporal.getState().pastStates.length).toBe(0)
  })
})
