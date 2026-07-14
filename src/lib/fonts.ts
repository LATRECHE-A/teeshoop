/**
 * STUB — module A4 replaces this file entirely (see docs/CONTRACTS.md §A4).
 * Registry is real; font loading is a no-op until A4 lands.
 */
import type { FontDef } from '@/lib/types'

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

export async function ensureFont(family: string): Promise<void> {
  void family
}

export async function allFontsReady(): Promise<void> {}
