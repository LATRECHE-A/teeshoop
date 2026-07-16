/**
 * Reconstruct the design for the AR page and pre-render its print-area decals.
 *
 * Sources, in order: a `#d=…` share link (vector designs, works cross-device)
 * → the same-device autosaved draft in IndexedDB (`tshop:current`, covers
 * uploaded photos + custom garments because their blobs live in this origin's
 * IndexedDB). Uses the SAME store-free renderer as the studio, so the decal is
 * dimensionally identical to 2D/3D/print.
 */
import { get } from 'idb-keyval'
import type { Design, Side, SizeIn } from '@/lib/types'
import { parseShareHash } from '@/lib/shareLink'
import { garmentColorHex, getAreaSizeIn, renderPrintArea, sideLayers } from '@/lib/renderDesign'

// Mirrors the private key in src/state/persist.ts (autosaved current design).
const CURRENT_KEY = 'tshop:current'
const TARGET_PX = 1400

export interface ArDesignBundle {
  design: Design
  garmentColor: string
  front: HTMLCanvasElement | null
  back: HTMLCanvasElement | null
  frontIn: SizeIn
  backIn: SizeIn
  source: 'link' | 'current'
  hasBack: boolean
}

async function renderSide(design: Design, side: Side): Promise<HTMLCanvasElement | null> {
  if (sideLayers(design, side).length === 0) return null
  const area = getAreaSizeIn(design, side)
  const ppi = TARGET_PX / Math.max(area.wIn, area.hIn)
  return renderPrintArea(design, side, ppi).catch(() => null)
}

export async function loadArDesign(): Promise<ArDesignBundle | null> {
  let design = parseShareHash(location.hash)
  let source: ArDesignBundle['source'] = 'link'
  if (!design) {
    try {
      const cur = await get<Design>(CURRENT_KEY)
      if (cur?.layers) {
        design = cur
        source = 'current'
      }
    } catch {
      /* storage unavailable */
    }
  }
  if (!design || !design.layers?.length) return null

  const [front, back] = await Promise.all([renderSide(design, 'front'), renderSide(design, 'back')])
  const frontIn = getAreaSizeIn(design, 'front')
  const backIn = getAreaSizeIn(design, 'back')

  const garmentColor = design.garmentId === 'custom' ? '#eceef2' : garmentColorHex(design)

  return { design, garmentColor, front, back, frontIn, backIn, source, hasBack: !!back }
}
