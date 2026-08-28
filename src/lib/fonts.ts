/**
 * Font registry + loader for Tshop Studio print fonts.
 *
 * All families are self-hosted via @fontsource packages (Google Fonts
 * builds, OFL / Apache-2.0, see docs/credits/A4.md); the side-effect CSS
 * imports below register the @font-face rules, so there are no runtime
 * network calls beyond the site's own assets.
 */
import type { FontDef } from '@/lib/types'

import '@fontsource/anton/400.css'
import '@fontsource/archivo-black/400.css'
import '@fontsource/bebas-neue/400.css'
import '@fontsource/oswald/400.css'
import '@fontsource/oswald/600.css'
import '@fontsource/russo-one/400.css'
import '@fontsource/alfa-slab-one/400.css'
import '@fontsource/bangers/400.css'
import '@fontsource/righteous/400.css'
import '@fontsource/permanent-marker/400.css'
import '@fontsource/pacifico/400.css'
import '@fontsource/lobster/400.css'
import '@fontsource/special-elite/400.css'

/** The 12 print fonts, in display order. `family` is the exact CSS name. */
export const FONTS: FontDef[] = [
  { family: 'Anton', label: 'Anton', category: 'block' },
  { family: 'Archivo Black', label: 'Archivo Black', category: 'block' },
  { family: 'Bebas Neue', label: 'Bebas Neue', category: 'block' },
  { family: 'Oswald', label: 'Oswald', category: 'block' },
  { family: 'Russo One', label: 'Russo One', category: 'block' },
  { family: 'Alfa Slab One', label: 'Alfa Slab', category: 'block' },
  { family: 'Bangers', label: 'Bangers', category: 'display' },
  { family: 'Righteous', label: 'Righteous', category: 'display' },
  { family: 'Permanent Marker', label: 'Marker', category: 'script' },
  { family: 'Pacifico', label: 'Pacifico', category: 'script' },
  { family: 'Lobster', label: 'Lobster', category: 'script' },
  { family: 'Special Elite', label: 'Typewriter', category: 'retro' },
]

const LOAD_TIMEOUT_MS = 3000

/** Cached load promises, one per family. */
const pending = new Map<string, Promise<void>>()

/** Resolve when `p` settles (either way) or after `ms`, never reject. */
function settleWithin(p: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    const done = () => {
      clearTimeout(timer)
      resolve()
    }
    p.then(done, done)
  })
}

function loadFamily(family: string): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) {
    return Promise.resolve()
  }
  const quoted = `"${family.replace(/"/g, '\\"')}"`
  const loads: Promise<unknown>[] = [document.fonts.load(`64px ${quoted}`)]
  // Oswald ships a semibold weight used for tracking-heavy sublines.
  if (family === 'Oswald') loads.push(document.fonts.load(`600 64px ${quoted}`))
  return settleWithin(Promise.all(loads), LOAD_TIMEOUT_MS)
}

/**
 * Ensure a family is ready for canvas use. Resolves once loaded, after a
 * 3s timeout, or immediately for unknown families: it never rejects.
 * Promises are cached, so repeat calls are free.
 */
export function ensureFont(family: string): Promise<void> {
  let p = pending.get(family)
  if (!p) {
    p = loadFamily(family)
    pending.set(family, p)
  }
  return p
}

/** Ensure every family in {@link FONTS} (same non-rejecting guarantees). */
export function allFontsReady(): Promise<void> {
  return Promise.all(FONTS.map((f) => ensureFont(f.family))).then(() => undefined)
}
