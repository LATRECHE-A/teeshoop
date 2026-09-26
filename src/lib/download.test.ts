import { describe, expect, it } from 'vitest'
import { slugify } from './download'

describe('slugify', () => {
  it('keeps the letters of an accented name (STU-18)', () => {
    expect(slugify('Équipe Noël')).toBe('equipe-noel')
    expect(slugify('Crème brûlée')).toBe('creme-brulee')
    expect(slugify('Été 2026')).toBe('ete-2026')
    expect(slugify('Œuvre')).toBe('oeuvre')
  })

  it('still falls back when nothing is left', () => {
    expect(slugify('!!!')).toBe('design')
  })
})
