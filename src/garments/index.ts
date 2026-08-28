/**
 * A1: Garment art registry.
 *
 * Hand-authored flat product illustrations (SVG strings) for the catalog
 * garments. Each side exposes:
 *  - `body`:  full garment; contains the `__COLOR__` token for the body fill
 *  - `shade`: print-darkening shading only, multiplied over the design
 *  - `printAreaPx`: print rectangle in viewBox px (= printAreasIn × pxPerInch)
 *
 * viewBox is always `0 0 800 800` (see GARMENT_VIEW), 25 px per real inch,
 * garment visually centered at (400, 400).
 */
import type { GarmentArt } from '@/lib/types'
import { TEE } from './tee'
import { HOODIE } from './hoodie'

export const GARMENTS: Record<'tee' | 'hoodie', GarmentArt> = {
  tee: TEE,
  hoodie: HOODIE,
}
