/**
 * Shared laid-flat short-sleeve illustration + print area, used by the tee and
 * hoodie "sleeve" print side. A sleeve is a sleeve, so both catalog garments
 * reuse this art. viewBox 0 0 800 800, 25 px/inch, centred at (400, 400); a
 * 4″×4″ print area sits on the outer sleeve. Same __COLOR__ + shade contract as
 * the other garment art (see GarmentSideArt).
 */
import type { GarmentSideArt, SizeIn } from '@/lib/types'

export const SLEEVE_AREA_IN: SizeIn = { wIn: 4, hIn: 4 }

// Rounded shoulder cap (top), outer fold (right), cuff hem (bottom), underarm
// seam (left): a believable short sleeve laid flat, centred on the print area.
const SIL =
  'M296 320 C296 302 312 289 338 285 C404 275 470 281 512 307 C528 317 534 333 532 351' +
  'L518 486 C516 506 500 520 480 520 L344 520 C328 520 314 510 310 494 L296 338 Z'

const CUFF = 'M328 494 L500 494 L498 520 L330 520 Z'

function body(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800">
<defs>
<clipPath id="sl-clip"><path d="${SIL}"/></clipPath>
<linearGradient id="sl-hl" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#fff" stop-opacity="0.11"/><stop offset="0.6" stop-color="#fff" stop-opacity="0"/>
</linearGradient>
<linearGradient id="sl-sh" x1="0" y1="0" x2="1" y2="0">
<stop offset="0" stop-color="#000" stop-opacity="0.05"/><stop offset="0.5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.13"/>
</linearGradient>
</defs>
<path d="${SIL}" fill="__COLOR__"/>
<g clip-path="url(#sl-clip)">
<path d="${SIL}" fill="url(#sl-hl)"/>
<path d="${SIL}" fill="url(#sl-sh)"/>
<path d="${CUFF}" fill="rgba(0,0,0,0.10)"/>
<g fill="none" stroke-linecap="round">
<path d="M328 492 L500 492" stroke="rgba(0,0,0,0.16)" stroke-width="2"/>
<path d="M328 497 L500 497" stroke="rgba(255,255,255,0.06)" stroke-width="1.4"/>
<path d="M310 336 C328 302 360 289 402 287" stroke="rgba(255,255,255,0.06)" stroke-width="3"/>
<path d="M300 330 C300 430 302 470 312 494" stroke="rgba(0,0,0,0.09)" stroke-width="2"/>
</g>
<path d="${SIL}" fill="none" stroke="rgba(0,0,0,0.16)" stroke-width="3"/>
</g>
</svg>`
}

function shade(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800">
<defs><filter id="sl-sb" x="-15%" y="-15%" width="130%" height="130%"><feGaussianBlur stdDeviation="8"/></filter></defs>
<g fill="none" stroke-linecap="round" filter="url(#sl-sb)">
<path d="M332 300 C356 430 356 460 340 500" stroke="rgba(0,0,0,0.07)" stroke-width="10"/>
<path d="M472 300 C498 430 498 460 484 500" stroke="rgba(0,0,0,0.06)" stroke-width="10"/>
<path d="M330 490 L500 490" stroke="rgba(0,0,0,0.08)" stroke-width="8"/>
</g>
</svg>`
}

export const SLEEVE_ART: GarmentSideArt = {
  body: body(),
  shade: shade(),
  printAreaPx: { x: 350, y: 350, w: 100, h: 100 },
  // Sleeves scale about the print-area top centre (cap-seam proxy).
  collarPx: { x: 400, y: 350 },
}
