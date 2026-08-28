/**
 * Unisex heavy-cotton tee, hand-authored flat product illustration.
 *
 * viewBox 0 0 800 800 · 25 px/inch · chest width 21.5″ (537.5 px) · length ≈28.6″.
 * Front and back share ONE outer silhouette path so side-switching is stable.
 * All shading is paired (dark ≈14% + light ≈8%) so it reads on white AND black
 * bodies, and everything except the base fill is clipped to the silhouette.
 * No feGaussianBlur in body art (see soft.ts), cheap on software rasterizers.
 */
import type { GarmentArt } from '@/lib/types'
import { blob, grainDefs, grainRect, soft, softDefs } from './soft'
import { SLEEVE_ART, SLEEVE_AREA_IN } from './sleeve'

/** Outer silhouette, identical for front/back. Bounds x ≈37..763, y ≈44..760. */
const SIL =
  'M318 52C350 42 450 42 482 52C536 62 600 80 644 100C688 120 728 152 760 190' +
  'C752 240 728 294 696 338C681 330 672 314 668 298C661 400 658 600 657 748' +
  'C568 757 478 760 400 760C322 760 232 757 143 748C142 600 139 400 132 298' +
  'C128 314 119 330 104 338C72 294 48 240 40 190C72 152 112 120 156 100' +
  'C200 80 264 62 318 52Z'

/** Sleeve regions (silhouette edge + armhole seam), for tone washes. */
const SLEEVE_R =
  'M644 100C688 120 728 152 760 190C752 240 728 294 696 338C681 330 672 314 668 298C621 236 626 152 644 100Z'
const SLEEVE_L =
  'M156 100C112 120 72 152 40 190C48 240 72 294 104 338C119 330 128 314 132 298C179 236 174 152 156 100Z'

function defs(p: string): string {
  return `<defs>
<path id="${p}-sil" d="${SIL}"/>
<clipPath id="${p}-clip"><use href="#${p}-sil"/></clipPath>
<radialGradient id="${p}-hl" cx="0.36" cy="0.28" r="0.6">
<stop offset="0" stop-color="#fff" stop-opacity="0.10"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
</radialGradient>
<linearGradient id="${p}-shx" x1="0" y1="0" x2="1" y2="0">
<stop offset="0" stop-color="#000" stop-opacity="0.07"/><stop offset="0.18" stop-color="#000" stop-opacity="0"/><stop offset="0.62" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.13"/>
</linearGradient>
<linearGradient id="${p}-shb" x1="0" y1="0.76" x2="0" y2="1">
<stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.08"/>
</linearGradient>
${softDefs(p)}
${grainDefs(p, 11)}
</defs>`
}

/** Flat washes: key light top-left, right/left/bottom falloff, sleeve tones. */
function washes(p: string): string {
  return `<rect x="24" y="36" width="752" height="736" fill="url(#${p}-hl)"/>
<rect x="24" y="36" width="752" height="736" fill="url(#${p}-shx)"/>
<rect x="24" y="36" width="752" height="736" fill="url(#${p}-shb)"/>
<path d="${SLEEVE_R}" fill="rgba(0,0,0,0.07)"/>
<path d="${SLEEVE_L}" fill="rgba(255,255,255,0.04)"/>`
}

/** Soft shadows/highlights (layered strokes + gradient blobs). */
function softShading(p: string, front: boolean): string {
  const collar = front
    ? soft('M314 68C332 114 364 138 400 138C436 138 468 114 486 68', 0.1, 12)
    : soft('M316 60C336 76 366 84 400 84C434 84 464 76 484 60', 0.08, 10)
  return `${blob(p, 660, 314, 30, 54, -20, 0.13)}
${blob(p, 140, 314, 30, 54, 20, 0.1)}
${soft('M648 106C632 156 627 240 668 294', 0.1, 7)}
${soft('M152 106C168 156 173 240 132 294', 0.07, 7)}
${soft('M166 98C216 74 280 58 318 54', 0.07, 7, true)}
${soft('M482 54C540 62 604 80 640 98', 0.04, 6, true)}
${collar}`
}

/** Drape wrinkles: dark stroke paired with a light echo. */
function wrinkles(front: boolean): string {
  const chest = front
    ? `${soft('M384 398C404 406 430 406 452 399', 0.04, 4)}
${soft('M372 468C396 476 426 476 450 469', 0.035, 4)}`
    : `${soft('M340 294C380 304 420 304 460 294', 0.05, 4)}
${soft('M356 430C390 438 424 438 452 431', 0.04, 4)}`
  return `${soft('M648 310C606 330 560 342 516 346', 0.09, 4.5)}
${soft('M644 302C606 322 564 334 522 338', 0.05, 4, true)}
${soft('M152 310C192 328 234 338 276 342', 0.07, 4.5)}
${soft('M156 302C194 320 234 330 272 334', 0.045, 4, true)}
${soft('M336 644C328 682 332 712 326 740M468 652C474 690 470 716 474 742', 0.09, 4.5)}
${soft('M331 644C323 682 327 712 321 740M463 652C469 690 465 716 469 742', 0.05, 3.5, true)}
${chest}
${soft('M652 138C680 154 702 172 714 188', 0.09, 4)}
${soft('M657 130C686 146 708 164 720 180M143 130C114 146 92 164 80 180', 0.05, 3.5, true)}
${soft('M648 210C670 226 686 242 696 258M148 138C120 154 98 172 86 188', 0.07, 4)}
${soft('M152 210C130 226 114 242 104 258', 0.05, 4)}`
}

/** Crisp seams + double-needle stitching (dark line paired with light echo). */
function seams(): string {
  return `<g fill="none" stroke-linecap="round">
<path d="M482 56C536 66 598 83 641 102M318 56C264 66 202 83 159 102" stroke="#000" stroke-opacity="0.13" stroke-width="1.6"/>
<path d="M481 59C535 69 597 86 639 105M319 59C265 69 203 86 161 105" stroke="#fff" stroke-opacity="0.07" stroke-width="1.4"/>
<path d="M644 102C626 152 621 236 666 296M156 102C174 152 179 236 134 296" stroke="#000" stroke-opacity="0.14" stroke-width="1.7"/>
<path d="M647 104C629 155 624 238 669 298M153 104C171 155 176 238 131 298" stroke="#fff" stroke-opacity="0.06" stroke-width="1.4"/>
<path d="M744 190C738 238 718 288 684 327M739 188C733 236 713 286 679 324M56 190C62 238 82 288 116 327M61 188C67 236 87 286 121 324" stroke="#000" stroke-opacity="0.13" stroke-width="1.5"/>
<path d="M747 191C741 239 721 289 687 328M53 191C59 239 79 289 113 328" stroke="#fff" stroke-opacity="0.07" stroke-width="1.4"/>
<path d="M651 727C566 736 478 739 400 739C322 739 234 736 149 727M651 733C566 742 478 745 400 745C322 745 234 742 149 733" stroke="#000" stroke-opacity="0.13" stroke-width="1.5"/>
<path d="M650 736C566 745 478 748 400 748C322 748 234 745 150 736" stroke="#fff" stroke-opacity="0.07" stroke-width="1.4"/>
</g>`
}

/** Front crew collar: interior, back band across top, front rib band. */
function frontCollar(): string {
  return `<g>
<path d="M318 52C352 64 448 64 482 52L478 55C462 92 434 104 400 104C366 104 338 92 322 55Z" fill="rgba(0,0,0,0.30)"/>
${soft('M320 53C352 63 448 63 480 53', 0.2, 4)}
<path d="M318 52C350 42.5 450 42.5 482 52C448 63 352 63 318 52Z" fill="rgba(0,0,0,0.10)"/>
<g fill="none" stroke-linecap="butt">
<path d="M320 51C352 53 448 53 480 51" stroke="rgba(0,0,0,0.10)" stroke-width="15" stroke-dasharray="1.2 2.2"/>
<path d="M320 52.5C352 54.5 448 54.5 480 52.5" stroke="rgba(255,255,255,0.055)" stroke-width="13" stroke-dasharray="1.2 2.2" stroke-dashoffset="1.7"/>
</g>
<path d="M310 59C326 103 360 126 400 126C440 126 474 103 490 59L478 55C462 92 434 104 400 104C366 104 338 92 322 55Z" fill="rgba(0,0,0,0.05)"/>
<g fill="none" stroke-linecap="butt">
<path d="M316 57C331 99 363 115 400 115C437 115 469 99 484 57" stroke="rgba(0,0,0,0.09)" stroke-width="21" stroke-dasharray="1.3 2.3"/>
<path d="M316 57C331 99 363 115 400 115C437 115 469 99 484 57" stroke="rgba(255,255,255,0.05)" stroke-width="21" stroke-dasharray="1.3 2.3" stroke-dashoffset="1.8"/>
</g>
<g fill="none" stroke-linecap="round">
<path d="M322 55C338 92 366 104 400 104C434 104 462 92 478 55" stroke="rgba(255,255,255,0.08)" stroke-width="1.4"/>
<path d="M312 59C328 102 361 125 400 125C439 125 472 102 488 59" stroke="rgba(0,0,0,0.15)" stroke-width="1.6"/>
<path d="M312 61.5C328 104 361 127 400 127C439 127 472 104 488 61.5" stroke="rgba(255,255,255,0.07)" stroke-width="1.3"/>
</g>
</g>`
}

/** Back crew collar: shallow band, seam, inner neck-tape topstitching. */
function backCollar(): string {
  return `<g>
<path d="M318 52C350 42.5 450 42.5 482 52C450 72 350 72 318 52Z" fill="rgba(0,0,0,0.06)"/>
<g fill="none" stroke-linecap="butt">
<path d="M320 50C351 58 449 58 480 50" stroke="rgba(0,0,0,0.10)" stroke-width="18" stroke-dasharray="1.2 2.2"/>
<path d="M320 51.5C351 59.5 449 59.5 480 51.5" stroke="rgba(255,255,255,0.055)" stroke-width="16" stroke-dasharray="1.2 2.2" stroke-dashoffset="1.7"/>
</g>
<g fill="none" stroke-linecap="round">
<path d="M318 53C350 71 450 71 482 53" stroke="rgba(0,0,0,0.15)" stroke-width="1.6"/>
<path d="M318 55.5C350 73.5 450 73.5 482 55.5" stroke="rgba(255,255,255,0.07)" stroke-width="1.3"/>
<path d="M336 70C360 78 440 78 464 70" stroke="rgba(0,0,0,0.09)" stroke-width="1.3"/>
<path d="M338 76C362 84 438 84 462 76" stroke="rgba(0,0,0,0.09)" stroke-width="1.3"/>
<path d="M340 82C362 89 438 89 460 82" stroke="rgba(255,255,255,0.05)" stroke-width="1.2"/>
</g>
</g>`
}

function body(p: string, front: boolean): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800">
${defs(p)}
<use href="#${p}-sil" fill="__COLOR__"/>
<g clip-path="url(#${p}-clip)">
<use href="#${p}-sil" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="7"/>
${washes(p)}
${softShading(p, front)}
${wrinkles(front)}
${seams()}
${front ? frontCollar() : backCollar()}
<use href="#${p}-sil" fill="none" stroke="rgba(0,0,0,0.16)" stroke-width="3"/>
</g>
${grainRect(p)}
</svg>`
}

/** Print-darkening shading only (multiplied over the design). Max α 0.22. */
function shade(p: string, front: boolean): string {
  const inner = front
    ? `<path d="M312 108C348 156 452 156 488 108" stroke-width="26" stroke="rgba(0,0,0,0.10)"/>
<rect x="222" y="210" width="42" height="370" rx="21" fill="rgba(0,0,0,0.11)"/>
<rect x="536" y="205" width="46" height="380" rx="23" fill="rgba(0,0,0,0.14)"/>
<path d="M540 344C512 354 488 358 462 358" stroke-width="11" stroke="rgba(0,0,0,0.07)"/>
<path d="M380 398C404 408 434 408 458 400" stroke-width="9" stroke="rgba(0,0,0,0.07)"/>
<path d="M368 468C396 477 428 477 452 470" stroke-width="9" stroke="rgba(0,0,0,0.06)"/>
<path d="M334 556C328 578 331 592 327 604" stroke-width="8" stroke="rgba(0,0,0,0.05)"/>`
    : `<path d="M330 120C360 150 440 150 470 120" stroke-width="22" stroke="rgba(0,0,0,0.09)"/>
<rect x="222" y="185" width="42" height="370" rx="21" fill="rgba(0,0,0,0.11)"/>
<rect x="536" y="180" width="46" height="380" rx="23" fill="rgba(0,0,0,0.14)"/>
<path d="M340 298C380 308 420 308 460 298" stroke-width="9" stroke="rgba(0,0,0,0.06)"/>
<path d="M356 432C390 440 424 440 452 433" stroke-width="9" stroke="rgba(0,0,0,0.06)"/>
<path d="M540 336C512 346 488 350 462 350" stroke-width="11" stroke="rgba(0,0,0,0.07)"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800">
<defs><filter id="${p}-sb" x="-15%" y="-15%" width="130%" height="130%"><feGaussianBlur stdDeviation="9"/></filter></defs>
<g fill="none" stroke-linecap="round" filter="url(#${p}-sb)">
${inner}
</g>
</svg>`
}

export const TEE: GarmentArt = {
  id: 'tee',
  name: 'Classic Tee',
  pxPerInch: 25,
  widthIn: 21.5,
  printAreasIn: {
    front: { wIn: 12, hIn: 16 },
    back: { wIn: 12, hIn: 16 },
    sleeve: SLEEVE_AREA_IN,
  },
  sides: {
    front: {
      body: body('t-f', true),
      shade: shade('t-f', true),
      // top edge ≈3″ below the front collar seam (seam ≈ y126)
      printAreaPx: { x: 250, y: 200, w: 300, h: 400 },
      collarPx: { x: 400, y: 125 },
    },
    back: {
      body: body('t-b', false),
      shade: shade('t-b', false),
      // top edge ≈4″ below the back collar seam (seam ≈ y67)
      printAreaPx: { x: 250, y: 168, w: 300, h: 400 },
      collarPx: { x: 400, y: 68 },
    },
    sleeve: SLEEVE_ART,
  },
}
