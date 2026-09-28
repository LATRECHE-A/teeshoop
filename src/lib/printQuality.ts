/**
 * Whether an image will print sharp at the size it is placed.
 *
 * ONE RULE, READ BY THE STUDIO'S EXPORT AND BY THE CUSTOMER'S EDITOR. It lived
 * as a constant inside `ShareModal`, so the customer placing a 400 px logo
 * across a whole back was never told: the first to see it was the workshop, at
 * the proof, or the customer, at delivery.
 *
 * Effective resolution is measured against the PHYSICAL width, so a graded-up
 * size (the same pixels stretched over a wider print, `k > 1`) can trip it when
 * the reference size does not.
 */

/** Below this many pixels per inch of printed width, a transfer prints soft. */
export const MIN_EFFECTIVE_DPI = 150

/** Pixels per printed inch for an image `pixelWidth` wide printed `wIn` wide, graded by `k`. */
export function effectiveDpi(pixelWidth: number, wIn: number, k = 1): number {
  const inches = wIn * k
  return inches > 0 ? pixelWidth / inches : Infinity
}

/** The widest an image can print, in inches, before it goes soft. */
export function sharpWidthIn(pixelWidth: number): number {
  return pixelWidth / MIN_EFFECTIVE_DPI
}
