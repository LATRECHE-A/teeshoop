/**
 * Pullover hoodie — hand-authored flat product illustration.
 *
 * viewBox 0 0 800 800 · 25 px/inch · chest width 23″ (575 px) · length ≈29″.
 * Front and back share ONE outer silhouette (body + steep hanging sleeves +
 * ribbed cuffs + ribbed waistband + generous hood dome above the shoulders).
 * Front: wide lined hood opening, crossed rim bands, drawcords with aglets,
 * kangaroo pocket below the print area. Back: hood hanging over the yoke.
 * Shading is paired dark≈14% / light≈8%; everything clipped to the silhouette.
 * No feGaussianBlur in body art (see soft.ts) — cheap on software rasterizers.
 */
import type { GarmentArt } from '@/lib/types'
import { blob, grainDefs, grainRect, soft, softDefs } from './soft'

/** Outer silhouette — identical for front/back. Bounds x 34..766, y 40..762. */
const SIL =
  'M246 102C258 62 320 40 400 40C480 40 542 62 554 102' +
  'C598 114 648 132 676 150C726 182 754 254 764 346C770 442 762 552 752 640' +
  'C749 666 744 690 738 708C720 710 700 706 684 700C682 720 680 738 678 754' +
  'C590 760 490 762 400 762C310 762 210 760 122 754C120 738 118 720 116 700' +
  'C100 706 80 710 62 708C56 690 51 666 48 640C38 552 30 442 36 346' +
  'C46 254 74 182 124 150C152 132 202 114 246 102Z'

const SLEEVE_R =
  'M676 150C726 182 754 254 764 346C770 442 762 552 752 640C726 646 696 651 668 650C660 570 654 470 650 352C646 285 654 205 676 150Z'
const SLEEVE_L =
  'M124 150C74 182 46 254 36 346C30 442 38 552 48 640C74 646 104 651 132 650C140 570 146 470 150 352C154 285 146 205 124 150Z'
const CUFF_R =
  'M752 640C749 666 744 690 738 708C720 710 700 706 684 700C678 682 672 664 668 650C696 651 726 646 752 640Z'
const CUFF_L =
  'M48 640C51 666 56 690 62 708C80 710 100 706 116 700C122 682 128 664 132 650C104 651 74 646 48 640Z'
const BAND =
  'M116 700C240 704 560 704 684 700C682 720 680 738 678 754C590 760 490 762 400 762C310 762 210 760 122 754C120 738 118 720 116 700Z'
const POCKET =
  'M262 578C350 581 450 581 538 578C556 618 573 658 588 694C470 700 330 700 212 694C227 658 244 618 262 578Z'
const LINING =
  'M306 88C336 70 464 70 494 88C478 140 446 172 410 196L400 202L390 196C354 172 322 140 306 88Z'
/** Hood hanging over the back — bottom edge sweep. */
const HOOD_BACK =
  'M246 102C242 152 256 198 290 226C328 252 364 245 400 245C436 245 472 252 510 226C544 198 558 152 554 102'

function defs(p: string): string {
  return `<defs>
<path id="${p}-sil" d="${SIL}"/>
<clipPath id="${p}-clip"><use href="#${p}-sil"/></clipPath>
<clipPath id="${p}-ckr"><path d="${CUFF_R}"/></clipPath>
<clipPath id="${p}-ckl"><path d="${CUFF_L}"/></clipPath>
<clipPath id="${p}-bk"><path d="${BAND}"/></clipPath>
<radialGradient id="${p}-hl" cx="0.36" cy="0.26" r="0.62">
<stop offset="0" stop-color="#fff" stop-opacity="0.10"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
</radialGradient>
<linearGradient id="${p}-shr" x1="0.6" y1="0" x2="1" y2="0">
<stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.13"/>
</linearGradient>
<linearGradient id="${p}-shl" x1="0.2" y1="0" x2="0" y2="0">
<stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.07"/>
</linearGradient>
<linearGradient id="${p}-shb" x1="0" y1="0.78" x2="0" y2="1">
<stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.08"/>
</linearGradient>
${softDefs(p)}
${grainDefs(p, 23)}
</defs>`
}

/** Unfiltered fills: washes, sleeve/cuff/band tones, pocket + lining bases. */
function baseFills(p: string, front: boolean): string {
  return `<rect x="26" y="34" width="748" height="736" fill="url(#${p}-hl)"/>
<rect x="26" y="34" width="748" height="736" fill="url(#${p}-shr)"/>
<rect x="26" y="34" width="748" height="736" fill="url(#${p}-shl)"/>
<rect x="26" y="34" width="748" height="736" fill="url(#${p}-shb)"/>
<path d="${SLEEVE_R}" fill="rgba(0,0,0,0.06)"/>
<path d="${SLEEVE_L}" fill="rgba(255,255,255,0.035)"/>
<path d="${CUFF_R}" fill="rgba(0,0,0,0.05)"/>
<path d="${CUFF_L}" fill="rgba(0,0,0,0.05)"/>
<path d="${BAND}" fill="rgba(0,0,0,0.05)"/>
${front ? `<path d="${POCKET}" fill="rgba(255,255,255,0.035)"/>` : ''}`
}

/** Soft shadows/highlights common to both sides. */
function softCommon(p: string): string {
  return `${soft('M674 154C722 186 750 258 760 346C766 442 758 552 748 636', 0.07, 9)}
${blob(p, 656, 368, 26, 40, -12, 0.11)}
${blob(p, 144, 368, 26, 40, 12, 0.08)}
${soft('M644 356C648 470 654 570 662 648', 0.12, 8)}
${soft('M156 356C152 470 146 570 138 648', 0.09, 8)}
${blob(p, 690, 704, 18, 8, 0, 0.1)}
${blob(p, 110, 704, 18, 8, 0, 0.08)}
${soft('M118 697C240 702 560 702 682 697', 0.08, 5)}`
}

/** Sleeve drape rings + cuff gathers, both arms. */
function sleeveFolds(): string {
  return `${soft('M692 330C714 322 732 324 750 316', 0.08, 4)}
${soft('M690 323C712 315 730 317 748 309', 0.045, 3.5, true)}
${soft('M690 444C714 436 734 440 754 432', 0.07, 4)}
${soft('M688 437C712 429 732 433 752 425', 0.04, 3.5, true)}
${soft('M696 556C714 550 732 552 748 546', 0.06, 4)}
${soft('M694 549C712 543 730 545 746 539', 0.035, 3.5, true)}
${soft('M108 330C86 322 68 324 50 316', 0.06, 4)}
${soft('M110 323C88 315 70 317 52 309', 0.04, 3.5, true)}
${soft('M110 444C86 436 66 440 46 432', 0.055, 4)}
${soft('M112 437C88 429 68 433 48 425', 0.035, 3.5, true)}
${soft('M104 556C86 550 68 552 52 546', 0.05, 4)}
${soft('M690 610L697 641', 0.1, 3)}
${soft('M712 604L715 639', 0.1, 3)}
${soft('M733 600L734 637', 0.09, 3)}
${soft('M703 607L707 640', 0.05, 2.5, true)}
${soft('M723 602L724 638', 0.05, 2.5, true)}
${soft('M110 610L103 641', 0.09, 3)}
${soft('M88 604L85 639', 0.09, 3)}
${soft('M67 600L66 637', 0.08, 3)}
${soft('M97 607L93 640', 0.05, 2.5, true)}
${soft('M77 602L76 638', 0.05, 2.5, true)}`
}

/** Body folds per side. */
function bodyFolds(front: boolean): string {
  if (front) {
    return `${soft('M632 386C578 402 532 408 504 408', 0.09, 5)}
${soft('M628 378C580 394 536 400 508 400', 0.05, 4, true)}
${soft('M168 386C222 402 268 408 296 408', 0.07, 5)}
${soft('M172 378C220 394 264 400 292 400', 0.04, 4, true)}
${soft('M372 430C398 440 432 440 458 432', 0.05, 4)}
${soft('M366 500C394 509 428 509 454 501', 0.04, 4)}
${soft('M336 542C333 556 335 566 333 574', 0.06, 3.5)}
${soft('M462 544C465 558 463 568 465 575', 0.06, 3.5)}`
  }
  return `${soft('M342 282C338 350 344 420 340 480', 0.06, 4)}
${soft('M336 282C332 350 338 420 334 480', 0.04, 3.5, true)}
${soft('M458 285C462 353 456 423 460 483', 0.06, 4)}
${soft('M464 285C468 353 462 423 466 483', 0.04, 3.5, true)}
${soft('M632 400C578 416 530 424 494 426', 0.08, 5)}
${soft('M628 392C580 408 534 416 500 418', 0.05, 4, true)}
${soft('M168 400C222 416 270 424 306 426', 0.06, 5)}
${soft('M172 392C220 408 266 416 300 418', 0.04, 4, true)}
${soft('M362 600C356 640 360 668 356 690', 0.06, 4)}
${soft('M357 600C351 640 355 668 351 690', 0.04, 3.5, true)}
${soft('M442 604C448 644 444 672 448 692', 0.06, 4)}
${soft('M447 604C453 644 449 672 453 692', 0.04, 3.5, true)}`
}

/** Ribbing ticks (clipped) + crisp seams shared by both sides. */
function ribsAndSeams(p: string): string {
  return `<g clip-path="url(#${p}-ckr)" fill="none" stroke-linecap="butt">
<path d="M668 676C696 673 722 670 750 670" stroke="rgba(0,0,0,0.10)" stroke-width="76" stroke-dasharray="1.8 3.1"/>
<path d="M668 676C696 673 722 670 750 670" stroke="rgba(255,255,255,0.055)" stroke-width="76" stroke-dasharray="1.8 3.1" stroke-dashoffset="2.45"/>
</g>
<g clip-path="url(#${p}-ckl)" fill="none" stroke-linecap="butt">
<path d="M132 676C104 673 78 670 50 670" stroke="rgba(0,0,0,0.10)" stroke-width="76" stroke-dasharray="1.8 3.1"/>
<path d="M132 676C104 673 78 670 50 670" stroke="rgba(255,255,255,0.055)" stroke-width="76" stroke-dasharray="1.8 3.1" stroke-dashoffset="2.45"/>
</g>
<g clip-path="url(#${p}-bk)" fill="none" stroke-linecap="butt">
<path d="M116 730C300 734 500 734 684 730" stroke="rgba(0,0,0,0.095)" stroke-width="58" stroke-dasharray="2 3.4"/>
<path d="M116 730C300 734 500 734 684 730" stroke="rgba(255,255,255,0.055)" stroke-width="58" stroke-dasharray="2 3.4" stroke-dashoffset="2.7"/>
</g>
<g fill="none" stroke-linecap="round">
<path d="M676 152C654 205 646 285 650 350" stroke="rgba(0,0,0,0.14)" stroke-width="1.7"/>
<path d="M679 154C657 207 649 287 653 352" stroke="rgba(255,255,255,0.06)" stroke-width="1.4"/>
<path d="M124 152C146 205 154 285 150 350" stroke="rgba(0,0,0,0.14)" stroke-width="1.7"/>
<path d="M121 154C143 207 151 287 147 352" stroke="rgba(255,255,255,0.06)" stroke-width="1.4"/>
<path d="M650 352C654 470 660 570 668 648" stroke="rgba(0,0,0,0.15)" stroke-width="1.8"/>
<path d="M653 354C657 470 663 570 671 648" stroke="rgba(255,255,255,0.05)" stroke-width="2.2"/>
<path d="M150 352C146 470 140 570 132 648" stroke="rgba(0,0,0,0.15)" stroke-width="1.8"/>
<path d="M147 354C143 470 137 570 129 648" stroke="rgba(255,255,255,0.05)" stroke-width="2.2"/>
<path d="M752 641C726 647 696 652 668 651" stroke="rgba(0,0,0,0.14)" stroke-width="1.7"/>
<path d="M752 643.5C726 649.5 696 654.5 668 653.5" stroke="rgba(255,255,255,0.06)" stroke-width="1.4"/>
<path d="M48 641C74 647 104 652 132 651" stroke="rgba(0,0,0,0.14)" stroke-width="1.7"/>
<path d="M48 643.5C74 649.5 104 654.5 132 653.5" stroke="rgba(255,255,255,0.06)" stroke-width="1.4"/>
<path d="M116 701C240 706 560 706 684 701" stroke="rgba(0,0,0,0.15)" stroke-width="1.8"/>
<path d="M116 703.5C240 708.5 560 708.5 684 703.5" stroke="rgba(255,255,255,0.07)" stroke-width="1.4"/>
<path d="M684 703L678 752" stroke="rgba(0,0,0,0.10)" stroke-width="1.5"/>
<path d="M116 703L122 752" stroke="rgba(0,0,0,0.10)" stroke-width="1.5"/>
<path d="M556 104C598 118 648 136 674 150" stroke="rgba(0,0,0,0.12)" stroke-width="1.6"/>
<path d="M555 107C597 121 647 139 672 152" stroke="rgba(255,255,255,0.06)" stroke-width="1.4"/>
<path d="M244 104C202 118 152 136 126 150" stroke="rgba(0,0,0,0.12)" stroke-width="1.6"/>
<path d="M245 107C203 121 153 139 128 152" stroke="rgba(255,255,255,0.06)" stroke-width="1.4"/>
</g>`
}

/** Kangaroo pocket details (front only). */
function pocket(): string {
  return `${soft('M266 584C350 587 450 587 534 584', 0.09, 9)}
${soft('M540 582C558 621 573 659 585 691', 0.13, 5)}
${soft('M260 582C242 621 227 659 215 691', 0.11, 5)}
${soft('M336 604C332 640 336 668 332 690', 0.06, 4)}
${soft('M331 604C327 640 331 668 327 690', 0.04, 3.5, true)}
${soft('M468 606C472 642 468 670 472 690', 0.06, 4)}
${soft('M473 606C477 642 473 670 477 690', 0.04, 3.5, true)}
${soft('M218 692C330 698 470 698 584 692', 0.07, 4)}
<g fill="none" stroke-linecap="round">
<path d="M262 575.5C350 578.5 450 578.5 538 575.5" stroke="rgba(255,255,255,0.07)" stroke-width="1.4"/>
<path d="M262 578C350 581 450 581 538 578" stroke="rgba(0,0,0,0.15)" stroke-width="1.7"/>
<path d="M266 585C350 588 450 588 534 585" stroke="rgba(0,0,0,0.11)" stroke-width="1.3"/>
<path d="M266 591C350 594 450 594 534 591" stroke="rgba(0,0,0,0.11)" stroke-width="1.3"/>
<path d="M266 594C350 597 450 597 534 594" stroke="rgba(255,255,255,0.05)" stroke-width="1.2"/>
<path d="M538 578C556 618 573 658 588 694" stroke="rgba(0,0,0,0.14)" stroke-width="1.7"/>
<path d="M262 578C244 618 227 658 212 694" stroke="rgba(0,0,0,0.14)" stroke-width="1.7"/>
<path d="M528 582C545 621 561 658 575 692" stroke="rgba(0,0,0,0.11)" stroke-width="1.3"/>
<path d="M521 585C538 624 554 660 567 693" stroke="rgba(0,0,0,0.11)" stroke-width="1.3"/>
<path d="M532 581C549 620 565 657 579 691" stroke="rgba(255,255,255,0.05)" stroke-width="1.2"/>
<path d="M272 582C255 621 239 658 225 692" stroke="rgba(0,0,0,0.11)" stroke-width="1.3"/>
<path d="M279 585C262 624 246 660 233 693" stroke="rgba(0,0,0,0.11)" stroke-width="1.3"/>
<path d="M268 581C251 620 235 657 221 691" stroke="rgba(255,255,255,0.05)" stroke-width="1.2"/>
</g>`
}

/** Front: generous dome, wide lined opening, crossed rims, cords, grommets. */
function hoodFront(p: string): string {
  return `<g>
${blob(p, 345, 60, 100, 20, -6, 0.09, true)}
${soft('M250 100C266 92 284 88 302 90', 0.1, 6)}
${soft('M550 100C534 92 516 88 498 90', 0.12, 6)}
${soft('M326 66C330 74 340 82 350 86', 0.08, 3)}
${soft('M474 66C470 74 460 82 450 86', 0.08, 3)}
<path d="${LINING}" fill="rgba(0,0,0,0.32)"/>
${soft('M310 88C340 74 460 74 490 88', 0.2, 7)}
${soft('M348 102C354 130 364 152 374 170', 0.05, 3, true)}
${soft('M400 106C400 134 400 162 400 186', 0.12, 3)}
${soft('M452 102C446 130 436 152 426 170', 0.04, 3, true)}
${blob(p, 400, 188, 16, 14, 0, 0.16)}
<g fill="none">
<path d="M494 88C480 136 448 172 410 202" stroke="__COLOR__" stroke-width="15"/>
<path d="M494 88C480 136 448 172 410 202" stroke="rgba(0,0,0,0.06)" stroke-width="15"/>
<path d="M501 90C487 138 455 176 415 208" stroke="rgba(0,0,0,0.16)" stroke-width="1.5"/>
<path d="M487 86C473 134 441 168 405 196" stroke="rgba(0,0,0,0.12)" stroke-width="1.3"/>
<path d="M492 88C478 136 446 172 408 200" stroke="rgba(255,255,255,0.06)" stroke-width="1.2"/>
</g>
${soft('M396 192C398 197 400 202 401 207', 0.14, 5)}
<g fill="none">
<path d="M306 88C320 136 352 172 390 202" stroke="__COLOR__" stroke-width="15"/>
<path d="M306 88C320 136 352 172 390 202" stroke="rgba(255,255,255,0.05)" stroke-width="15"/>
<path d="M299 90C313 138 345 176 385 208" stroke="rgba(0,0,0,0.16)" stroke-width="1.5"/>
<path d="M313 86C327 134 359 168 395 196" stroke="rgba(0,0,0,0.12)" stroke-width="1.3"/>
<path d="M308 88C322 136 354 172 392 200" stroke="rgba(255,255,255,0.06)" stroke-width="1.2"/>
</g>
<g fill="none" stroke-linecap="round">
<path d="M376 195C369 212 368 228 358 242" stroke="rgba(0,0,0,0.30)" stroke-width="7"/>
<path d="M376 195C369 212 368 228 358 242" stroke="#D8DBDE" stroke-width="4.6"/>
<path d="M424 195C432 214 434 230 443 245" stroke="rgba(0,0,0,0.30)" stroke-width="7"/>
<path d="M424 195C432 214 434 230 443 245" stroke="#D8DBDE" stroke-width="4.6"/>
<path d="M358 242L352 257" stroke="rgba(0,0,0,0.30)" stroke-width="8"/>
<path d="M358 242L352 257" stroke="#AEB4BC" stroke-width="5.6"/>
<path d="M356.2 244.8L354 250.8" stroke="rgba(255,255,255,0.35)" stroke-width="1.4"/>
<path d="M443 245L447 260" stroke="rgba(0,0,0,0.30)" stroke-width="8"/>
<path d="M443 245L447 260" stroke="#AEB4BC" stroke-width="5.6"/>
<path d="M444.2 247.6L445.8 253.6" stroke="rgba(255,255,255,0.35)" stroke-width="1.4"/>
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
${soft('M246 112C242 160 256 205 290 233C328 259 364 252 400 252C436 252 472 259 510 233C544 205 558 160 554 112', 0.12, 14)}
${blob(p, 346, 96, 100, 42, -12, 0.07, true)}
${soft('M524 130C534 170 524 205 504 224', 0.09, 8)}
${soft('M330 116C322 156 330 198 348 224', 0.1, 4)}
${soft('M324 112C316 154 324 196 342 220', 0.05, 3.5, true)}
${soft('M470 116C478 156 470 198 452 224', 0.1, 4)}
${soft('M476 112C484 154 476 196 458 220', 0.05, 3.5, true)}
${soft('M366 210C376 224 388 230 397 231', 0.08, 3)}
${soft('M434 210C424 224 412 230 403 231', 0.08, 3)}
<g fill="none" stroke-linecap="round">
<path d="M400 46C398 110 402 175 400 240" stroke="rgba(0,0,0,0.13)" stroke-width="1.7"/>
<path d="M403 46C401 110 405 175 403 240" stroke="rgba(255,255,255,0.06)" stroke-width="1.4"/>
<path d="M252 98C248 146 260 192 294 218C330 242 366 236 400 236C434 236 470 242 506 218C538 192 552 146 548 98" stroke="rgba(0,0,0,0.09)" stroke-width="1.3"/>
<path d="${HOOD_BACK}" stroke="rgba(0,0,0,0.16)" stroke-width="2"/>
<path d="M246 104.5C242 154.5 256 200.5 290 228.5C328 254.5 364 247.5 400 247.5C436 247.5 472 254.5 510 228.5C544 200.5 558 154.5 554 104.5" stroke="rgba(255,255,255,0.07)" stroke-width="1.5"/>
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
${sleeveFolds()}
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
  },
  sides: {
    front: {
      body: body('h-f', true),
      shade: shade('h-fs', true),
      // below the drawcord tips (y≈260); bottom clears the pocket top (y578)
      printAreaPx: { x: 250, y: 268, w: 300, h: 300 },
    },
    back: {
      body: body('h-b', false),
      shade: shade('h-bs', false),
      // just below the hanging hood (hood bottom ≈ y245)
      printAreaPx: { x: 250, y: 255, w: 300, h: 350 },
    },
  },
}
