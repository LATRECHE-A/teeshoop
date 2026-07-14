/**
 * Unisex heavy-cotton tee — hand-authored flat product illustration.
 *
 * viewBox 0 0 800 800 · 25 px/inch · chest width 21.5″ (537.5 px) · length ≈28.6″.
 * Front and back share ONE outer silhouette path so side-switching is stable.
 * All shading is paired (dark ≈14% + light ≈8%) so it reads on white AND black
 * bodies, and everything except the base fill is clipped to the silhouette.
 */
import type { GarmentArt } from '@/lib/types'

/** Outer silhouette — identical for front/back. Bounds x 32..768, y 44..760. */
const SIL =
  'M318 52C350 42 450 42 482 52C540 60 610 74 649 98C692 118 736 158 768 196' +
  'C762 246 740 296 700 342C688 334 676 318 667 300C660 352 655 420 656 520' +
  'C657 630 658 700 658 748C570 757 480 760 400 760C320 760 230 757 142 748' +
  'C142 700 143 630 144 520C145 420 140 352 133 300C124 318 112 334 100 342' +
  'C60 296 38 246 32 196C64 158 108 118 151 98C190 74 260 60 318 52Z'

/** Sleeve regions (bounded by silhouette + armhole seam), for tone washes. */
const SLEEVE_R =
  'M649 98C692 118 736 158 768 196C762 246 740 296 700 342C688 334 676 318 667 300C623 238 629 152 649 98Z'
const SLEEVE_L =
  'M151 98C108 118 64 158 32 196C38 246 60 296 100 342C112 334 124 318 133 300C177 238 171 152 151 98Z'

/** Shared defs (gradients, blurs, grain) with per-side id prefix. */
function defs(p: string): string {
  return `<defs>
<path id="${p}-sil" d="${SIL}"/>
<clipPath id="${p}-clip"><use href="#${p}-sil"/></clipPath>
<radialGradient id="${p}-hl" cx="0.36" cy="0.28" r="0.6">
<stop offset="0" stop-color="#fff" stop-opacity="0.10"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
</radialGradient>
<linearGradient id="${p}-shr" x1="0.6" y1="0" x2="1" y2="0">
<stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.13"/>
</linearGradient>
<linearGradient id="${p}-shl" x1="0.2" y1="0" x2="0" y2="0">
<stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.07"/>
</linearGradient>
<linearGradient id="${p}-shb" x1="0" y1="0.76" x2="0" y2="1">
<stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.08"/>
</linearGradient>
<filter id="${p}-b3" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="3"/></filter>
<filter id="${p}-b6" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="6"/></filter>
<filter id="${p}-gr" x="-5%" y="-5%" width="110%" height="110%">
<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="11" stitchTiles="stitch"/>
<feColorMatrix type="matrix" values="0 0 0 0 0.62 0 0 0 0 0.62 0 0 0 0 0.62 0.35 0.35 0.35 0 0"/>
</filter>
</defs>`
}

/** Big soft light/shadow washes + sleeve tones + armpit shadows (both sides). */
function washes(p: string): string {
  return `<rect width="800" height="800" fill="url(#${p}-hl)"/>
<rect width="800" height="800" fill="url(#${p}-shr)"/>
<rect width="800" height="800" fill="url(#${p}-shl)"/>
<rect width="800" height="800" fill="url(#${p}-shb)"/>
<path d="${SLEEVE_R}" fill="rgba(0,0,0,0.07)"/>
<path d="${SLEEVE_L}" fill="rgba(255,255,255,0.04)"/>
<ellipse cx="663" cy="320" rx="22" ry="40" transform="rotate(-20 663 320)" fill="rgba(0,0,0,0.12)" filter="url(#${p}-b6)"/>
<ellipse cx="137" cy="320" rx="22" ry="40" transform="rotate(20 137 320)" fill="rgba(0,0,0,0.09)" filter="url(#${p}-b6)"/>
<path d="M170 96C220 72 280 58 318 54" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="7" stroke-linecap="round" filter="url(#${p}-b6)"/>
<path d="M482 54C545 62 610 78 646 96" fill="none" stroke="rgba(255,255,255,0.04)" stroke-width="6" stroke-linecap="round" filter="url(#${p}-b6)"/>`
}

/** Seams + double-needle stitching shared by both sides. */
function seams(p: string): string {
  return `<g fill="none" stroke-linecap="round">
<!-- shoulder seams -->
<path d="M482 56C540 64 608 78 645 100" stroke="rgba(0,0,0,0.13)" stroke-width="1.6"/>
<path d="M481 59C539 67 607 81 643 103" stroke="rgba(255,255,255,0.07)" stroke-width="1.4"/>
<path d="M318 56C260 64 192 78 155 100" stroke="rgba(0,0,0,0.13)" stroke-width="1.6"/>
<path d="M319 59C261 67 193 81 157 103" stroke="rgba(255,255,255,0.07)" stroke-width="1.4"/>
<!-- armhole seams + soft roll shadow inside sleeve -->
<path d="M652 104C634 156 628 240 669 297" stroke="rgba(0,0,0,0.10)" stroke-width="7" filter="url(#${p}-b3)"/>
<path d="M148 104C166 156 172 240 131 297" stroke="rgba(0,0,0,0.07)" stroke-width="7" filter="url(#${p}-b3)"/>
<path d="M648 100C629 152 623 238 665 298" stroke="rgba(0,0,0,0.14)" stroke-width="1.7"/>
<path d="M651 103C632 155 626 240 668 300" stroke="rgba(255,255,255,0.06)" stroke-width="1.4"/>
<path d="M152 100C171 152 177 238 135 298" stroke="rgba(0,0,0,0.14)" stroke-width="1.7"/>
<path d="M149 103C168 155 174 240 132 300" stroke="rgba(255,255,255,0.06)" stroke-width="1.4"/>
<!-- sleeve double-needle hems -->
<path d="M752 195C746 244 727 290 689 330" stroke="rgba(0,0,0,0.13)" stroke-width="1.5"/>
<path d="M747 193C741 242 722 288 684 328" stroke="rgba(0,0,0,0.13)" stroke-width="1.5"/>
<path d="M756 197C750 246 731 292 693 332" stroke="rgba(255,255,255,0.07)" stroke-width="1.4"/>
<path d="M48 195C54 244 73 290 111 330" stroke="rgba(0,0,0,0.13)" stroke-width="1.5"/>
<path d="M53 193C59 242 78 288 116 328" stroke="rgba(0,0,0,0.13)" stroke-width="1.5"/>
<path d="M44 197C50 246 69 292 107 332" stroke="rgba(255,255,255,0.07)" stroke-width="1.4"/>
<!-- bottom double-needle hem -->
<path d="M652 727C566 736 478 739 400 739C322 739 234 736 148 727" stroke="rgba(0,0,0,0.13)" stroke-width="1.5"/>
<path d="M652 733C566 742 478 745 400 745C322 745 234 742 148 733" stroke="rgba(0,0,0,0.13)" stroke-width="1.5"/>
<path d="M651 736C566 745 478 748 400 748C322 748 234 745 149 736" stroke="rgba(255,255,255,0.07)" stroke-width="1.4"/>
</g>`
}

/** Drape wrinkles — dark stroke paired with a light echo, blurred soft. */
function wrinkles(p: string, front: boolean): string {
  const chest = front
    ? `<path d="M382 402C404 411 432 411 454 403" stroke="rgba(0,0,0,0.05)" stroke-width="4" filter="url(#${p}-b3)"/>
<path d="M370 470C396 479 428 479 452 471" stroke="rgba(0,0,0,0.045)" stroke-width="4" filter="url(#${p}-b3)"/>`
    : `<path d="M340 296C380 306 420 306 460 296" stroke="rgba(0,0,0,0.05)" stroke-width="4" filter="url(#${p}-b3)"/>
<path d="M356 430C390 438 424 438 452 431" stroke="rgba(0,0,0,0.04)" stroke-width="4" filter="url(#${p}-b3)"/>`
  return `<g fill="none" stroke-linecap="round">
<path d="M650 316C596 342 528 358 472 362" stroke="rgba(0,0,0,0.10)" stroke-width="5" filter="url(#${p}-b3)"/>
<path d="M646 308C596 334 534 350 480 354" stroke="rgba(255,255,255,0.06)" stroke-width="4" filter="url(#${p}-b3)"/>
<path d="M150 316C204 340 268 354 324 358" stroke="rgba(0,0,0,0.08)" stroke-width="5" filter="url(#${p}-b3)"/>
<path d="M154 308C206 332 268 346 320 350" stroke="rgba(255,255,255,0.05)" stroke-width="4" filter="url(#${p}-b3)"/>
<path d="M336 644C328 682 332 712 326 740" stroke="rgba(0,0,0,0.09)" stroke-width="4.5" filter="url(#${p}-b3)"/>
<path d="M331 644C323 682 327 712 321 740" stroke="rgba(255,255,255,0.05)" stroke-width="3.5" filter="url(#${p}-b3)"/>
<path d="M468 652C474 690 470 716 474 742" stroke="rgba(0,0,0,0.09)" stroke-width="4.5" filter="url(#${p}-b3)"/>
<path d="M463 652C469 690 465 716 469 742" stroke="rgba(255,255,255,0.05)" stroke-width="3.5" filter="url(#${p}-b3)"/>
${chest}
<path d="M655 136C684 152 706 172 718 190" stroke="rgba(0,0,0,0.09)" stroke-width="4" filter="url(#${p}-b3)"/>
<path d="M660 128C690 144 712 164 724 182" stroke="rgba(255,255,255,0.05)" stroke-width="3.5" filter="url(#${p}-b3)"/>
<path d="M650 210C672 226 690 244 700 262" stroke="rgba(0,0,0,0.07)" stroke-width="4" filter="url(#${p}-b3)"/>
<path d="M145 136C116 152 94 172 82 190" stroke="rgba(0,0,0,0.07)" stroke-width="4" filter="url(#${p}-b3)"/>
<path d="M140 128C110 144 88 164 76 182" stroke="rgba(255,255,255,0.05)" stroke-width="3.5" filter="url(#${p}-b3)"/>
<path d="M150 210C128 226 110 244 100 262" stroke="rgba(0,0,0,0.05)" stroke-width="4" filter="url(#${p}-b3)"/>
</g>`
}

/** Front crew collar: back band across top, shadowed opening, front rib band. */
function frontCollar(p: string): string {
  return `<g>
<!-- opening interior (inside of the shirt behind the neck) -->
<path d="M318 52C352 64 448 64 482 52L478 55C462 92 434 104 400 104C366 104 338 92 322 55Z" fill="rgba(0,0,0,0.30)"/>
<path d="M320 53C352 63 448 63 480 53" fill="none" stroke="rgba(0,0,0,0.24)" stroke-width="5" filter="url(#${p}-b3)"/>
<!-- back collar band seen across the top -->
<path d="M318 52C350 42.5 450 42.5 482 52C448 63 352 63 318 52Z" fill="rgba(0,0,0,0.10)"/>
<path d="M320 51C352 53 448 53 480 51" fill="none" stroke="rgba(0,0,0,0.13)" stroke-width="15" stroke-dasharray="1.5 2.6"/>
<path d="M320 52.5C352 54.5 448 54.5 480 52.5" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="13" stroke-dasharray="1.5 2.6" stroke-dashoffset="2"/>
<!-- front rib band -->
<path d="M310 59C326 103 360 126 400 126C440 126 474 103 490 59L478 55C462 92 434 104 400 104C366 104 338 92 322 55Z" fill="rgba(0,0,0,0.05)"/>
<path d="M316 57C331 99 363 115 400 115C437 115 469 99 484 57" fill="none" stroke="rgba(0,0,0,0.11)" stroke-width="21" stroke-dasharray="1.6 2.7"/>
<path d="M316 57C331 99 363 115 400 115C437 115 469 99 484 57" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="21" stroke-dasharray="1.6 2.7" stroke-dashoffset="2.15"/>
<path d="M322 55C338 92 366 104 400 104C434 104 462 92 478 55" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1.4"/>
<path d="M312 59C328 102 361 125 400 125C439 125 472 102 488 59" fill="none" stroke="rgba(0,0,0,0.15)" stroke-width="1.6"/>
<path d="M312 61.5C328 104 361 127 400 127C439 127 472 104 488 61.5" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="1.3"/>
<!-- soft shadow the collar casts on the chest -->
<path d="M314 68C332 114 364 138 400 138C436 138 468 114 486 68" fill="none" stroke="rgba(0,0,0,0.10)" stroke-width="12" filter="url(#${p}-b6)"/>
</g>`
}

/** Back crew collar: shallow band, seam, inner neck-tape topstitching. */
function backCollar(p: string): string {
  return `<g>
<path d="M318 52C350 42.5 450 42.5 482 52C450 72 350 72 318 52Z" fill="rgba(0,0,0,0.06)"/>
<path d="M320 50C351 58 449 58 480 50" fill="none" stroke="rgba(0,0,0,0.12)" stroke-width="18" stroke-dasharray="1.5 2.6"/>
<path d="M320 51.5C351 59.5 449 59.5 480 51.5" fill="none" stroke="rgba(255,255,255,0.065)" stroke-width="16" stroke-dasharray="1.5 2.6" stroke-dashoffset="2"/>
<path d="M318 53C350 71 450 71 482 53" fill="none" stroke="rgba(0,0,0,0.15)" stroke-width="1.6"/>
<path d="M318 55.5C350 73.5 450 73.5 482 55.5" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="1.3"/>
<!-- neck tape double-needle -->
<path d="M336 70C360 78 440 78 464 70" fill="none" stroke="rgba(0,0,0,0.09)" stroke-width="1.3"/>
<path d="M338 76C362 84 438 84 462 76" fill="none" stroke="rgba(0,0,0,0.09)" stroke-width="1.3"/>
<path d="M340 82C362 89 438 89 460 82" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="1.2"/>
<path d="M316 60C336 76 366 84 400 84C434 84 464 76 484 60" fill="none" stroke="rgba(0,0,0,0.08)" stroke-width="10" filter="url(#${p}-b6)"/>
</g>`
}

function body(p: string, front: boolean): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800">
${defs(p)}
<use href="#${p}-sil" fill="__COLOR__"/>
<g clip-path="url(#${p}-clip)">
<use href="#${p}-sil" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="7"/>
${washes(p)}
${wrinkles(p, front)}
${seams(p)}
${front ? frontCollar(p) : backCollar(p)}
<rect width="800" height="800" filter="url(#${p}-gr)" opacity="0.025"/>
<use href="#${p}-sil" fill="none" stroke="rgba(0,0,0,0.16)" stroke-width="3"/>
</g>
</svg>`
}

/** Print-darkening shading only (multiplied over the design). Max α 0.22. */
function shade(p: string, front: boolean): string {
  const inner = front
    ? `<path d="M312 108C348 156 452 156 488 108" stroke-width="26" stroke="rgba(0,0,0,0.10)"/>
<rect x="222" y="210" width="42" height="370" rx="21" fill="rgba(0,0,0,0.11)"/>
<rect x="536" y="205" width="46" height="380" rx="23" fill="rgba(0,0,0,0.14)"/>
<path d="M545 352C512 366 484 372 456 372" stroke-width="11" stroke="rgba(0,0,0,0.07)"/>
<path d="M380 400C404 410 434 410 458 402" stroke-width="9" stroke="rgba(0,0,0,0.07)"/>
<path d="M368 470C396 479 428 479 452 472" stroke-width="9" stroke="rgba(0,0,0,0.06)"/>
<path d="M334 556C328 578 331 592 327 604" stroke-width="8" stroke="rgba(0,0,0,0.05)"/>`
    : `<path d="M330 120C360 150 440 150 470 120" stroke-width="22" stroke="rgba(0,0,0,0.09)"/>
<rect x="222" y="185" width="42" height="370" rx="21" fill="rgba(0,0,0,0.11)"/>
<rect x="536" y="180" width="46" height="380" rx="23" fill="rgba(0,0,0,0.14)"/>
<path d="M340 300C380 310 420 310 460 300" stroke-width="9" stroke="rgba(0,0,0,0.06)"/>
<path d="M356 432C390 440 424 440 452 433" stroke-width="9" stroke="rgba(0,0,0,0.06)"/>
<path d="M545 340C512 354 484 360 456 360" stroke-width="11" stroke="rgba(0,0,0,0.07)"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800">
<defs><filter id="${p}-sb" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="9"/></filter></defs>
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
  },
  sides: {
    front: {
      body: body('t-f', true),
      shade: shade('t-fs', true),
      // top edge ≈3″ below the front collar seam (seam ≈ y126)
      printAreaPx: { x: 250, y: 200, w: 300, h: 400 },
    },
    back: {
      body: body('t-b', false),
      shade: shade('t-bs', false),
      // top edge ≈4″ below the back collar seam (seam ≈ y67)
      printAreaPx: { x: 250, y: 168, w: 300, h: 400 },
    },
  },
}
