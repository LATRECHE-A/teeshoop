/**
 * The shop's copy of the garment facts must equal the studio's.
 *
 * `wp-plugins/teeshoop-core/data/garments.json` is what a PHP template prints
 * on the product page: print areas in cm, the size chart, the colour list. It
 * is generated from the modules below by `scripts/gen-garment-data.mjs`. This
 * test is the gate that stops it drifting: change a print area, a chest
 * measurement or the grading rule and forget to regenerate, and CI says so
 * before a customer measures a logo against a number we no longer print.
 *
 * It is not a self-consistency check. The JSON is read off disk as bytes, the
 * expectation is computed by running the shipped code, and the comparison is
 * on the parsed documents.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildGarmentData } from './garmentData'

const FILE = resolve(__dirname, '../../wp-plugins/teeshoop-core/data/garments.json')

describe('garments.json (the shop’s copy of the studio’s measurements)', () => {
  const onDisk = JSON.parse(readFileSync(FILE, 'utf8'))
  const derived = buildGarmentData()

  it('matches what the studio’s own definitions produce', () => {
    expect(onDisk).toEqual(derived)
  })

  it('publishes centimetres only, never inches', () => {
    const flat = JSON.stringify(onDisk)
    expect(flat).not.toContain('In"')
    expect(flat).not.toContain('wIn')
    expect(flat).not.toContain('hIn')
    expect(flat).toContain('wCm')
  })

  it('measures every published area at the size the price is computed at', () => {
    // Cart.php prices one figure for a run that may span S to 3XL, and that
    // figure is measured at PRICED_SIZE (src/lib/teeshoop/upload.ts). A page
    // that published its areas at a different size would be quoting geometry
    // the invoice does not use.
    for (const garment of Object.values(onDisk.garments) as { pricedSize: string }[]) {
      expect(garment.pricedSize).toBe('M')
    }
  })

  it('is not empty, in any dimension', () => {
    // A generator that silently produced {} would make every product page
    // render an empty specification block and look merely unfinished.
    expect(Object.keys(onDisk.garments).length).toBeGreaterThan(0)
    expect(onDisk.colors.length).toBeGreaterThan(0)
    for (const g of Object.values(onDisk.garments) as {
      areas: { bySize: Record<string, unknown> }[]
      sizes: unknown[]
    }[]) {
      expect(g.areas.length).toBeGreaterThan(0)
      expect(g.sizes.length).toBeGreaterThan(0)
      for (const a of g.areas) expect(Object.keys(a.bySize).length).toBe(g.sizes.length)
    }
  })

  it('names every colour in French', () => {
    // The editor's swatch names are English by construction (they are ids with
    // a label). A customer-facing page must not print "Heather".
    const names = (onDisk.colors as { id: string; name: string }[]).map((c) => c.name)
    expect(names).toContain('Gris chiné')
    expect(names).not.toContain('Heather')
  })
})
