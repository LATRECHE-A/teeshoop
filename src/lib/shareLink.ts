/**
 * Share-link codec — pure, store-free serialization of a design into (and out
 * of) a URL hash. Kept in `lib/` (no store/persistence imports) so lean entry
 * points — notably the standalone AR page (src/ar) — can reconstruct a shared
 * design without pulling in the whole editor/Zustand bundle.
 *
 * A link carries the vector document only: image layers and customer-supplied
 * garment photos live in IndexedDB (per-origin, per-device) and cannot travel
 * in a URL, so `canShareAsLink` gates them out and `designToShareHash` nulls
 * `custom`. See src/state/persist.ts, which re-exports these for the studio.
 */
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'
import type { Design } from '@/lib/types'

/** True when the design is fully reconstructable from a link alone. */
export function canShareAsLink(design: Design): boolean {
  return (
    design.garmentId !== 'custom' &&
    design.layers.every((l) => l.type !== 'image')
  )
}

/** `#d=<lz-string>` hash carrying the vector design (custom stripped). */
export function designToShareHash(design: Design): string {
  const payload = { v: 1, design: { ...design, custom: null } }
  return `#d=${compressToEncodedURIComponent(JSON.stringify(payload))}`
}

/** Parse a `#d=…` hash back into a Design, or null if absent/corrupt. */
export function parseShareHash(hash: string): Design | null {
  const m = /^#d=(.+)$/.exec(hash)
  if (!m) return null
  try {
    const json = decompressFromEncodedURIComponent(m[1])
    if (!json) return null
    const payload = JSON.parse(json)
    if (payload?.v !== 1 || !payload.design?.layers) return null
    return payload.design as Design
  } catch {
    return null
  }
}
