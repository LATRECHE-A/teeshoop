/**
 * Pullover hoodie — hand-authored flat product illustration.
 *
 * viewBox 0 0 800 800 · 25 px/inch · chest width 23″ (575 px) · length ≈29″.
 * Front and back share ONE outer silhouette (body + steep hanging sleeves +
 * ribbed cuffs + ribbed waistband + generous hood dome above the shoulders).
 * Front: wide lined hood opening, crossed rim bands, drawcords with aglets,
 * kangaroo pocket below the print area. Back: hood hanging over the yoke.
 * Shading is paired dark≈14% / light≈8% so it reads on white AND black
 * garments; everything is clipped to the silhouette. No feGaussianBlur in
 * body art (see soft.ts); same-style strokes are merged into multi-`M` paths.
 */
import type { GarmentArt } from '@/lib/types'
import { blob, grainDefs, grainRect, soft, softDefs } from './soft'
import { SLEEVE_ART, SLEEVE_AREA_IN } from './sleeve'

/** Outer silhouette — identical for front/back. Bounds x 34..766, y 40..762. */
const SIL =
  'M246 102C258 62 320 40 400 40C480 40 542 62 554 102' +
  'C592 112 648 132 674 150C722 180 744 248 752 340C757 440 751 550 742 640' +
  'C739 664 737 688 734 705C716 707 696 702 682 698C681 718 679 738 678 754' +
  'C590 760 490 762 400 762C310 762 210 760 122 754C121 738 119 718 118 698' +
  'C104 702 84 707 66 705C63 688 61 664 58 640C49 550 43 440 48 340' +
  'C56 248 78 180 126 150C152 132 208 112 246 102Z'

const SLEEVE_R =
  'M674 150C722 180 744 248 752 340C757 440 751 550 742 640C716 646 688 650 662 649C656 570 652 470 648 352C644 285 652 205 674 150Z'
const SLEEVE_L =
  'M126 150C78 180 56 248 48 340C43 440 49 550 58 640C84 646 112 650 138 649C144 570 148 470 152 352C156 285 148 205 126 150Z'
const CUFF_R =
  'M742 640C739 664 737 688 734 705C716 707 696 702 682 698C674 682 666 664 662 649C688 650 716 646 742 640Z'
const CUFF_L =
  'M58 640C61 664 63 688 66 705C84 707 104 702 118 698C126 682 134 664 138 649C112 650 84 646 58 640Z'
const BAND =
  'M118 698C240 703 560 703 682 698C681 718 679 738 678 754C590 760 490 762 400 762C310 762 210 760 122 754C121 738 119 718 118 698Z'
const POCKET =
  'M262 578C350 581 450 581 538 578C556 618 573 658 588 694C470 700 330 700 212 694C227 658 244 618 262 578Z'
const LINING =
  'M306 88C336 70 464 70 494 88C478 140 446 172 410 196L400 202L390 196C354 172 322 140 306 88Z'
/** Hood hanging over the back — bottom edge sweep. */
const HOOD_BACK =
  'M246 102C242 152 256 198 290 226C326 251 362 248 400 248C438 248 474 251 510 226C544 198 558 152 554 102'

function defs(p: string): string {
  return `<defs>
<path id="${p}-sil" d="${SIL}"/>
<clipPath id="${p}-clip"><use href="#${p}-sil"/></clipPath>
<clipPath id="${p}-ck"><path d="${CUFF_R}"/><path d="${CUFF_L}"/></clipPath>
<clipPath id="${p}-bk"><path d="${BAND}"/></clipPath>
<radialGradient id="${p}-hl" cx="0.36" cy="0.26" r="0.62">
<stop offset="0" stop-color="#fff" stop-opacity="0.10"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
</radialGradient>
<linearGradient id="${p}-shx" x1="0" y1="0" x2="1" y2="0">
<stop offset="0" stop-color="#000" stop-opacity="0.07"/><stop offset="0.18" stop-color="#000" stop-opacity="0"/><stop offset="0.62" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.13"/>
</linearGradient>
<linearGradient id="${p}-shb" x1="0" y1="0.78" x2="0" y2="1">
<stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.08"/>
</linearGradient>
${softDefs(p)}
${grainDefs(p, 23)}
</defs>`
}

/** Unfiltered fills: washes, sleeve/cuff/band tones, pocket base. */
function baseFills(p: string, front: boolean): string {
  return `<rect x="26" y="34" width="748" height="736" fill="url(#${p}-hl)"/>
<rect x="26" y="34" width="748" height="736" fill="url(#${p}-shx)"/>
<rect x="26" y="34" width="748" height="736" fill="url(#${p}-shb)"/>
<path d="${SLEEVE_R}" fill="rgba(0,0,0,0.06)"/>
<path d="${SLEEVE_L}" fill="rgba(255,255,255,0.035)"/>
<path d="${CUFF_R}" fill="rgba(0,0,0,0.05)"/>
<path d="${CUFF_L}" fill="rgba(0,0,0,0.05)"/>
<path d="${BAND}" fill="rgba(0,0,0,0.05)"/>
${front ? `<path d="${POCKET}" fill="rgba(255,255,255,0.035)"/>` : ''}`
}

/** Soft shadows/highlights + sleeve drape common to both sides. */
function softCommon(p: string): string {
  return `${soft('M672 154C718 184 740 250 748 340C753 440 747 550 739 636', 0.07, 9)}
${blob(p, 652, 362, 20, 30, -12, 0.07)}
${blob(p, 148, 362, 20, 30, 12, 0.05)}
${soft('M642 356C646 470 650 570 656 648', 0.12, 8)}
${soft('M158 356C154 470 150 570 144 648', 0.09, 8)}
${blob(p, 688, 702, 16, 7, 0, 0.09)}
${blob(p, 112, 702, 16, 7, 0, 0.07)}
${soft('M120 695C240 700 560 700 680 695', 0.08, 5)}
${soft('M690 328C710 320 728 322 742 314M688 442C710 434 730 438 746 430M692 554C710 548 728 550 742 544M110 328C90 320 72 322 58 314M112 442C90 434 70 438 54 430M108 554C90 548 72 550 58 544', 0.06, 4)}
${soft('M688 321C708 313 726 315 740 307M686 435C708 427 728 431 744 423M112 321C92 313 74 315 60 307', 0.038, 3.5, true)}
${soft('M686 610L692 640M708 604L711 638M729 600L730 636M114 610L108 640M92 604L89 638M71 600L70 636', 0.09, 3)}
${soft('M698 607L702 639M719 602L720 637M102 607L98 639M81 602L80 637', 0.05, 2.5, true)}`
}

/** Body drape folds per side. */
function bodyFolds(front: boolean): string {
  if (front) {
    return `${soft('M632 386C578 402 532 408 504 408', 0.085, 5)}
${soft('M168 386C222 402 268 408 296 408', 0.07, 5)}
${soft('M628 378C580 394 536 400 508 400M172 378C220 394 264 400 292 400', 0.045, 4, true)}
${soft('M372 430C398 440 432 440 458 432M366 500C394 509 428 509 454 501', 0.045, 4)}
${soft('M336 542C333 556 335 566 333 574M462 544C465 558 463 568 465 575', 0.06, 3.5)}`
  }
  return `${soft('M342 282C338 350 344 420 340 480M458 285C462 353 456 423 460 483', 0.045, 4)}
${soft('M336 282C332 350 338 420 334 480M464 285C468 353 462 423 466 483', 0.03, 3.5, true)}
${soft('M632 400C578 416 530 424 494 426', 0.08, 5)}
${soft('M168 400C222 416 270 424 306 426', 0.06, 5)}
${soft('M628 392C580 408 534 416 500 418M172 392C220 408 266 416 300 418', 0.045, 4, true)}
${soft('M362 600C356 640 360 668 356 690M442 604C448 644 444 672 448 692', 0.06, 4)}
${soft('M357 600C351 640 355 668 351 690M447 604C453 644 449 672 453 692', 0.04, 3.5, true)}`
}

/** Ribbing ticks (clipped) + crisp seams shared by both sides. */
function ribsAndSeams(p: string): string {
  return `<g clip-path="url(#${p}-ck)" fill="none" stroke-linecap="butt">
<path d="M664 674C690 671 714 669 740 669M136 674C110 671 86 669 60 669" stroke="#000" stroke-opacity="0.10" stroke-width="72" stroke-dasharray="1.8 3.1"/>
<path d="M664 674C690 671 714 669 740 669M136 674C110 671 86 669 60 669" stroke="#fff" stroke-opacity="0.055" stroke-width="72" stroke-dasharray="1.8 3.1" stroke-dashoffset="2.45"/>
</g>
<g clip-path="url(#${p}-bk)" fill="none" stroke-linecap="butt">
<path d="M118 728C300 732 500 732 682 728" stroke="#000" stroke-opacity="0.095" stroke-width="56" stroke-dasharray="2 3.4"/>
<path d="M118 728C300 732 500 732 682 728" stroke="#fff" stroke-opacity="0.055" stroke-width="56" stroke-dasharray="2 3.4" stroke-dashoffset="2.7"/>
</g>
<g fill="none" stroke-linecap="round">
<path d="M674 150C652 205 644 285 648 350M126 150C148 205 156 285 152 350" stroke="#000" stroke-opacity="0.14" stroke-width="1.7"/>
<path d="M677 152C655 207 647 287 651 352M123 152C145 207 153 287 149 352" stroke="#fff" stroke-opacity="0.06" stroke-width="1.4"/>
<path d="M648 352C652 470 656 570 662 648M152 352C148 470 144 570 138 648" stroke="#000" stroke-opacity="0.15" stroke-width="1.8"/>
<path d="M651 354C655 470 659 570 665 648M149 354C145 470 141 570 135 648" stroke="#fff" stroke-opacity="0.05" stroke-width="2.2"/>
<path d="M742 641C716 647 688 651 662 650M58 641C84 647 112 651 138 650" stroke="#000" stroke-opacity="0.14" stroke-width="1.7"/>
<path d="M742 643.5C716 649.5 688 653.5 662 652.5M58 643.5C84 649.5 112 653.5 138 652.5" stroke="#fff" stroke-opacity="0.06" stroke-width="1.4"/>
<path d="M118 699C240 704 560 704 682 699" stroke="#000" stroke-opacity="0.15" stroke-width="1.8"/>
<path d="M118 701.5C240 706.5 560 706.5 682 701.5" stroke="#fff" stroke-opacity="0.07" stroke-width="1.4"/>
<path d="M682 701L678 752M118 701L122 752" stroke="#000" stroke-opacity="0.10" stroke-width="1.5"/>
<path d="M556 104C594 116 648 136 672 150M244 104C206 116 152 136 128 150" stroke="#000" stroke-opacity="0.12" stroke-width="1.6"/>
<path d="M555 107C593 119 647 139 670 152M245 107C207 119 153 139 130 152" stroke="#fff" stroke-opacity="0.06" stroke-width="1.4"/>
</g>`
}

/** Kangaroo pocket details (front only). */
function pocket(): string {
  return `${soft('M266 584C350 587 450 587 534 584', 0.07, 9)}
${soft('M540 582C558 621 573 659 585 691', 0.13, 5)}
${soft('M260 582C242 621 227 659 215 691', 0.11, 5)}
${soft('M336 604C332 640 336 668 332 690M468 606C472 642 468 670 472 690', 0.055, 4)}
${soft('M331 604C327 640 331 668 327 690M473 606C477 642 473 670 477 690', 0.035, 3.5, true)}
${soft('M218 692C330 698 470 698 584 692', 0.07, 4)}
<g fill="none" stroke-linecap="round">
<path d="M262 575.5C350 578.5 450 578.5 538 575.5" stroke="#fff" stroke-opacity="0.07" stroke-width="1.4"/>
<path d="M262 578C350 581 450 581 538 578M538 578C556 618 573 658 588 694M262 578C244 618 227 658 212 694" stroke="#000" stroke-opacity="0.145" stroke-width="1.7"/>
<path d="M266 585C350 588 450 588 534 585M266 591C350 594 450 594 534 591M528 582C545 621 561 658 575 692M521 585C538 624 554 660 567 693M272 582C255 621 239 658 225 692M279 585C262 624 246 660 233 693" stroke="#000" stroke-opacity="0.11" stroke-width="1.3"/>
<path d="M266 594C350 597 450 597 534 594M532 581C549 620 565 657 579 691M268 581C251 620 235 657 221 691" stroke="#fff" stroke-opacity="0.05" stroke-width="1.2"/>
</g>`
}

/** Front: generous dome, wide lined opening, crossed rims, cords, grommets. */
function hoodFront(p: string): string {
  return `<g>
${blob(p, 345, 60, 100, 20, -6, 0.09, true)}
${soft('M250 100C266 92 284 88 302 90M550 100C534 92 516 88 498 90', 0.11, 6)}
${soft('M326 66C330 74 340 82 350 86M474 66C470 74 460 82 450 86', 0.08, 3)}
<path d="${LINING}" fill="rgba(0,0,0,0.32)"/>
${soft('M310 88C340 74 460 74 490 88', 0.2, 7)}
${soft('M348 102C354 130 364 152 374 170M452 102C446 130 436 152 426 170', 0.045, 3, true)}
${soft('M400 106C400 134 400 162 400 186', 0.12, 3)}
${blob(p, 400, 188, 16, 14, 0, 0.16)}
<g fill="none">
<path d="M494 88C480 136 448 172 410 202M306 88C320 136 352 172 390 202" stroke="__COLOR__" stroke-width="15"/>
<path d="M494 88C480 136 448 172 410 202" stroke="#000" stroke-opacity="0.06" stroke-width="15"/>
<path d="M306 88C320 136 352 172 390 202" stroke="#fff" stroke-opacity="0.05" stroke-width="15"/>
</g>
${soft('M397 191C399 196 401 201 402 206', 0.14, 5)}
<g fill="none">
<path d="M501 90C487 138 455 176 415 208M299 90C313 138 345 176 385 208" stroke="#000" stroke-opacity="0.16" stroke-width="1.5"/>
<path d="M487 86C473 134 441 168 405 196M313 86C327 134 359 168 395 196" stroke="#000" stroke-opacity="0.12" stroke-width="1.3"/>
<path d="M492 88C478 136 446 172 408 200M308 88C322 136 354 172 392 200" stroke="#fff" stroke-opacity="0.06" stroke-width="1.2"/>
</g>
<g fill="none" stroke-linecap="round">
<path d="M376 195C369 212 366 228 358 242M424 195C432 214 434 230 443 245" stroke="#000" stroke-opacity="0.30" stroke-width="7"/>
<path d="M376 195C369 212 366 228 358 242M424 195C432 214 434 230 443 245" stroke="#D8DBDE" stroke-width="4.6"/>
<path d="M358 242L352 257M443 245L447 260" stroke="#000" stroke-opacity="0.30" stroke-width="8"/>
<path d="M358 242L352 257M443 245L447 260" stroke="#AEB4BC" stroke-width="5.6"/>
<path d="M356.2 244.8L354 250.8M444.2 247.6L445.8 253.6" stroke="#fff" stroke-opacity="0.35" stroke-width="1.4"/>
</g>
<circle cx="376" cy="190" r="6.2" fill="#B9BFC7" stroke="rgba(0,0,0,0.35)" stroke-width="1.2"/>
<circle cx="376" cy="190" r="2.6" fill="#3A3F46"/>
<circle cx="424" cy="190" r="6.2" fill="#B9BFC7" stroke="rgba(0,0,0,0.35)" stroke-width="1.2"/>
<circle cx="424" cy="190" r="2.6" fill="#3A3F46"/>
</g>`
}

/** Back: hood hanging over the shoulders/yoke with drape + cast shadow. */
function hoodBack(p: string): string {
  return `<g>
${soft('M246 112C242 160 256 205 290 233C326 258 362 255 400 255C438 255 474 258 510 233C544 205 558 160 554 112', 0.12, 14)}
${blob(p, 346, 96, 100, 42, -12, 0.07, true)}
${soft('M524 130C534 170 524 205 504 224', 0.09, 8)}
${soft('M330 116C322 156 330 198 348 224M470 116C478 156 470 198 452 224', 0.1, 4)}
${soft('M324 112C316 154 324 196 342 220M476 112C484 154 476 196 458 220', 0.05, 3.5, true)}
<g fill="none" stroke-linecap="round">
<path d="M400 46C398 110 402 175 400 244" stroke="#000" stroke-opacity="0.13" stroke-width="1.7"/>
<path d="M403 46C401 110 405 175 403 244" stroke="#fff" stroke-opacity="0.06" stroke-width="1.4"/>
<path d="M252 98C248 146 260 192 294 218C328 241 362 239 400 239C438 239 472 241 506 218C538 192 552 146 548 98" stroke="#000" stroke-opacity="0.09" stroke-width="1.3"/>
<path d="${HOOD_BACK}" stroke="#000" stroke-opacity="0.16" stroke-width="2"/>
<path d="M246 104.5C242 154.5 256 200.5 290 228.5C326 253.5 362 250.5 400 250.5C438 250.5 474 253.5 510 228.5C544 200.5 558 154.5 554 104.5" stroke="#fff" stroke-opacity="0.07" stroke-width="1.5"/>
</g>
</g>`
}

function body(p: string, front: boolean): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800">
${defs(p)}
<use href="#${p}-sil" fill="__COLOR__"/>
<g clip-path="url(#${p}-clip)">
<use href="#${p}-sil" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="7"/>
${baseFills(p, front)}
${softCommon(p)}
${bodyFolds(front)}
${ribsAndSeams(p)}
${front ? pocket() : ''}
${front ? hoodFront(p) : hoodBack(p)}
<use href="#${p}-sil" fill="none" stroke="rgba(0,0,0,0.16)" stroke-width="3"/>
</g>
${grainRect(p)}
</svg>`
}

/** Print-darkening shading only (multiplied over the design). Max α 0.22. */
function shade(p: string, front: boolean): string {
  const inner = front
    ? `<rect x="222" y="280" width="44" height="270" rx="22" fill="rgba(0,0,0,0.11)"/>
<rect x="534" y="275" width="46" height="280" rx="23" fill="rgba(0,0,0,0.14)"/>
<circle cx="400" cy="278" r="26" fill="rgba(0,0,0,0.09)"/>
<path d="M372 430C398 440 432 440 458 432" stroke-width="9" stroke="rgba(0,0,0,0.07)"/>
<path d="M366 500C394 509 428 509 454 501" stroke-width="9" stroke="rgba(0,0,0,0.06)"/>
<path d="M540 396C510 408 486 412 458 412" stroke-width="11" stroke="rgba(0,0,0,0.07)"/>`
    : `<path d="M310 262C350 288 450 288 490 262" stroke-width="34" stroke="rgba(0,0,0,0.16)"/>
<rect x="224" y="320" width="44" height="240" rx="22" fill="rgba(0,0,0,0.11)"/>
<rect x="532" y="315" width="46" height="250" rx="23" fill="rgba(0,0,0,0.14)"/>
<path d="M400 330C398 400 402 470 400 540" stroke-width="10" stroke="rgba(0,0,0,0.06)"/>
<path d="M540 400C510 412 486 416 458 416" stroke-width="11" stroke="rgba(0,0,0,0.07)"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800">
<defs><filter id="${p}-sb" x="-15%" y="-15%" width="130%" height="130%"><feGaussianBlur stdDeviation="9"/></filter></defs>
<g fill="none" stroke-linecap="round" filter="url(#${p}-sb)">
${inner}
</g>
</svg>`
}

export const HOODIE: GarmentArt = {
  id: 'hoodie',
  name: 'Pullover Hoodie',
  pxPerInch: 25,
  widthIn: 23,
  printAreasIn: {
    front: { wIn: 12, hIn: 12 },
    back: { wIn: 12, hIn: 14 },
    sleeve: SLEEVE_AREA_IN,
  },
  sides: {
    front: {
      body: body('h-f', true),
      shade: shade('h-f', true),
      // below the drawcord tips (y≈260); bottom clears the pocket top (y578)
      printAreaPx: { x: 250, y: 268, w: 300, h: 300 },
    },
    back: {
      body: body('h-b', false),
      shade: shade('h-b', false),
      // just below the hanging hood (hood bottom ≈ y248)
      printAreaPx: { x: 250, y: 255, w: 300, h: 350 },
    },
    sleeve: SLEEVE_ART,
  },
}
