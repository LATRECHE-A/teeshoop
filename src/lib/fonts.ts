/**
 * Font registry + loader for Tshop Studio print fonts.
 *
 * All families are self-hosted via @fontsource packages (Google Fonts builds,
 * OFL / Apache-2.0, see docs/credits/A4.md), so there are no runtime network
 * calls beyond the site's own assets.
 *
 * THE `@font-face` DECLARATIONS ARE NOT IMPORTED HERE ANY MORE. They live in
 * `src/lib/fontFaces.ts` and `ensureFont` pulls that module in on first use.
 * This file is reached from `renderDesign.ts`, therefore from `ink.ts`,
 * therefore from anything that measures a printed area, including an editor
 * that offers no text at all: the side-effect imports put thirteen families and
 * their woff2 files into every customer's first load for a screen that never
 * writes a word. Measured on the native package, 5 September 2026: the eager
 * stylesheet fell from 27,73 ko to 4,0 ko.
 */
import type { FontDef } from '@/lib/types'


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

async function loadFamily(family: string): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) {
    return
  }
  /*
   * THE DECLARATIONS FIRST, THEN THE LOAD, AND THE ORDER IS THE WHOLE POINT.
   *
   * `document.fonts.load()` resolves with an EMPTY list when no `@font-face`
   * rule matches the family, and it resolves happily: the canvas then draws in
   * a fallback face with nothing in the console. So the stylesheet module is
   * awaited before anything is asked for, and a failure to fetch it is treated
   * like every other failure in this file, by carrying on rather than throwing.
   */
  await import('./fontFaces').catch(() => undefined)
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
