/**
 * Pullover hoodie — hand-authored flat product illustration.
 *
 * viewBox 0 0 800 800 · 25 px/inch · chest width 23″ (575 px) · length ≈29″.
 * Front and back share ONE outer silhouette (body + steep hanging sleeves +
 * ribbed cuffs + ribbed waistband + hood dome above the shoulders). The front
 * shows the lined hood opening V with drawcords + kangaroo pocket; the back
 * shows the hood hanging over the yoke. Shading is paired dark≈14% /
 * light≈8% so it reads on white AND black garments; everything is clipped to
 * the silhouette. Blurred shapes are batched into a few filter groups.
 */
import type { GarmentArt } from '@/lib/types'

/** Outer silhouette — identical for front/back. Bounds x 26..774, y 42..766. */
const SIL =
  'M250 102C262 64 326 42 400 42C474 42 538 64 550 102' +
  'C596 116 646 134 674 152C738 192 766 262 772 350C778 448 770 556 755 642' +
  'C752 668 748 690 740 710C722 713 700 715 682 715C681 730 680 745 678 758' +
  'C590 764 490 766 400 766C310 766 210 764 122 758C120 745 119 730 118 715' +
  'C100 715 78 713 60 710C52 690 48 668 45 642C30 556 22 448 28 350' +
  'C34 262 62 192 126 152C154 134 204 116 250 102Z'

const SLEEVE_R =
  'M674 152C738 192 766 262 772 350C778 448 770 556 755 642C726 647 696 649 666 648C658 570 650 470 646 348C646 280 652 210 674 152Z'
const SLEEVE_L =
  'M126 152C62 192 34 262 28 350C22 448 30 556 45 642C74 647 104 649 134 648C142 570 150 470 154 348C154 280 148 210 126 152Z'
const CUFF_R =
  'M755 642C752 668 748 690 740 710C712 714 684 718 658 720C658 700 660 672 666 648C696 649 726 647 755 642Z'
const CUFF_L =
  'M45 642C48 668 52 690 60 710C88 714 116 718 142 720C142 700 140 672 134 648C104 649 74 647 45 642Z'
const BAND =
  'M118 697C240 702 560 702 682 697C681 715 680 738 678 758C590 764 490 766 400 766C310 766 210 764 122 758C120 738 119 715 118 697Z'
const POCKET =
  'M262 578C350 581 450 581 538 578C556 618 572 656 585 690C470 697 330 697 215 691C228 656 244 618 262 578Z'
const LINING =
  'M312 92C340 76 460 76 488 92C470 136 436 172 408 204L400 211L392 204C364 172 330 136 312 92Z'
/** Hood hanging over the back — bottom edge sweep. */
const HOOD_BACK =
  'M250 102C246 150 258 196 292 224C330 250 366 243 400 243C434 243 470 250 508 224C542 196 554 150 550 102'

function defs(p: string): string {
  return `<defs>
<path id="${p}-sil" d="${SIL}"/>
<clipPath id="${p}-clip"><use href="#${p}-sil"/></clipPath>
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
<filter id="${p}-b3" x="-8%" y="-8%" width="116%" height="116%"><feGaussianBlur stdDeviation="3"/></filter>
<filter id="${p}-b6" x="-12%" y="-12%" width="124%" height="124%"><feGaussianBlur stdDeviation="6"/></filter>
<filter id="${p}-b8" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="8"/></filter>
<filter id="${p}-gr" x="-2%" y="-2%" width="104%" height="104%">
<feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="1" seed="23" stitchTiles="stitch"/>
<feColorMatrix type="matrix" values="0 0 0 0 0.62 0 0 0 0 0.62 0 0 0 0 0.62 0.35 0.35 0.35 0 0"/>
</filter>
</defs>`
}

/** Unfiltered fills: washes, sleeve/cuff/band tones, pocket + lining bases. */
function baseFills(p: string, front: boolean): string {
  return `<rect width="800" height="800" fill="url(#${p}-hl)"/>
<rect width="800" height="800" fill="url(#${p}-shr)"/>
<rect width="800" height="800" fill="url(#${p}-shl)"/>
<rect width="800" height="800" fill="url(#${p}-shb)"/>
<path d="${SLEEVE_R}" fill="rgba(0,0,0,0.06)"/>
<path d="${SLEEVE_L}" fill="rgba(255,255,255,0.035)"/>
<path d="${CUFF_R}" fill="rgba(0,0,0,0.05)"/>
<path d="${CUFF_L}" fill="rgba(0,0,0,0.05)"/>
<path d="${BAND}" fill="rgba(0,0,0,0.05)"/>
${front ? `<path d="${POCKET}" fill="rgba(255,255,255,0.035)"/>\n<path d="${LINING}" fill="rgba(0,0,0,0.32)"/>` : ''}`
}

/** One blurred group (σ=6): big soft shadows + volume highlights. */
function softB6(p: string, front: boolean): string {
  const side = front
    ? `<ellipse cx="350" cy="62" rx="86" ry="18" transform="rotate(-6 350 62)" fill="rgba(255,255,255,0.07)"/>
<circle cx="400" cy="196" r="12" fill="rgba(0,0,0,0.18)"/>
<path d="M266 584C350 587 450 587 534 584" fill="none" stroke="rgba(0,0,0,0.09)" stroke-width="9"/>`
    : `<ellipse cx="348" cy="98" rx="88" ry="38" transform="rotate(-12 348 98)" fill="rgba(255,255,255,0.06)"/>
<path d="M520 130C530 170 520 205 500 222" fill="none" stroke="rgba(0,0,0,0.09)" stroke-width="8" stroke-linecap="round"/>`
  return `<g filter="url(#${p}-b6)">
<path d="M672 156C732 196 760 264 766 350C772 446 764 554 750 638" fill="none" stroke="rgba(0,0,0,0.07)" stroke-width="9"/>
<ellipse cx="652" cy="360" rx="18" ry="30" transform="rotate(-15 652 360)" fill="rgba(0,0,0,0.11)"/>
<ellipse cx="148" cy="360" rx="18" ry="30" transform="rotate(15 148 360)" fill="rgba(0,0,0,0.08)"/>
<path d="M640 352C644 470 652 570 660 646" fill="none" stroke="rgba(0,0,0,0.12)" stroke-width="8"/>
<path d="M160 352C156 470 148 570 140 646" fill="none" stroke="rgba(0,0,0,0.09)" stroke-width="8"/>
<ellipse cx="688" cy="714" rx="20" ry="9" fill="rgba(0,0,0,0.12)"/>
<ellipse cx="112" cy="714" rx="20" ry="9" fill="rgba(0,0,0,0.10)"/>
${side}
</g>`
}

/** One blurred group (σ=3): folds, drape rings, gathers, soft contacts. */
function softB3(p: string, front: boolean): string {
  const side = front
    ? `<path d="M640 380C570 400 500 408 462 408" stroke="rgba(0,0,0,0.09)" stroke-width="5"/>
<path d="M636 372C572 392 506 400 468 400" stroke="rgba(255,255,255,0.05)" stroke-width="4"/>
<path d="M160 380C230 398 296 406 334 406" stroke="rgba(0,0,0,0.07)" stroke-width="5"/>
<path d="M164 372C232 390 296 398 330 398" stroke="rgba(255,255,255,0.04)" stroke-width="4"/>
<path d="M372 430C398 440 432 440 458 432" stroke="rgba(0,0,0,0.05)" stroke-width="4"/>
<path d="M366 500C394 509 428 509 454 501" stroke="rgba(0,0,0,0.04)" stroke-width="4"/>
<path d="M336 540C333 556 335 566 333 574" stroke="rgba(0,0,0,0.06)" stroke-width="3.5"/>
<path d="M462 542C465 558 463 568 465 575" stroke="rgba(0,0,0,0.06)" stroke-width="3.5"/>
<path d="M540 582C557 620 572 656 583 686" stroke="rgba(0,0,0,0.13)" stroke-width="5"/>
<path d="M260 582C243 620 228 656 217 686" stroke="rgba(0,0,0,0.11)" stroke-width="5"/>
<path d="M336 604C332 640 336 668 332 690" stroke="rgba(0,0,0,0.06)" stroke-width="4"/>
<path d="M331 604C327 640 331 668 327 690" stroke="rgba(255,255,255,0.04)" stroke-width="3.5"/>
<path d="M468 606C472 642 468 670 472 690" stroke="rgba(0,0,0,0.06)" stroke-width="4"/>
<path d="M473 606C477 642 473 670 477 690" stroke="rgba(255,255,255,0.04)" stroke-width="3.5"/>
<path d="M220 689C330 695 470 695 582 689" stroke="rgba(0,0,0,0.07)" stroke-width="4"/>
<path d="M254 100C270 92 288 88 306 90" stroke="rgba(0,0,0,0.10)" stroke-width="6"/>
<path d="M546 100C530 92 512 88 494 90" stroke="rgba(0,0,0,0.12)" stroke-width="6"/>
<path d="M330 70C334 78 342 84 352 88" stroke="rgba(0,0,0,0.08)" stroke-width="3"/>
<path d="M470 70C466 78 458 84 448 88" stroke="rgba(0,0,0,0.08)" stroke-width="3"/>
<path d="M316 92C344 79 456 79 484 92" stroke="rgba(0,0,0,0.22)" stroke-width="7"/>
<path d="M352 106C356 134 366 158 376 176" stroke="rgba(255,255,255,0.05)" stroke-width="3"/>
<path d="M400 110C400 140 400 170 400 192" stroke="rgba(0,0,0,0.12)" stroke-width="3"/>
<path d="M448 106C444 134 434 158 424 176" stroke="rgba(255,255,255,0.04)" stroke-width="3"/>`
    : `<path d="M342 282C338 350 344 420 340 480" stroke="rgba(0,0,0,0.06)" stroke-width="4"/>
<path d="M336 282C332 350 338 420 334 480" stroke="rgba(255,255,255,0.04)" stroke-width="3.5"/>
<path d="M458 285C462 353 456 423 460 483" stroke="rgba(0,0,0,0.06)" stroke-width="4"/>
<path d="M464 285C468 353 462 423 466 483" stroke="rgba(255,255,255,0.04)" stroke-width="3.5"/>
<path d="M638 400C580 416 528 424 492 426" stroke="rgba(0,0,0,0.08)" stroke-width="5"/>
<path d="M634 392C582 408 534 416 498 418" stroke="rgba(255,255,255,0.05)" stroke-width="4"/>
<path d="M162 400C220 416 272 424 308 426" stroke="rgba(0,0,0,0.06)" stroke-width="5"/>
<path d="M166 392C222 408 274 416 310 418" stroke="rgba(255,255,255,0.04)" stroke-width="4"/>
<path d="M362 600C356 640 360 668 356 690" stroke="rgba(0,0,0,0.06)" stroke-width="4"/>
<path d="M357 600C351 640 355 668 351 690" stroke="rgba(255,255,255,0.04)" stroke-width="3.5"/>
<path d="M442 604C448 644 444 672 448 692" stroke="rgba(0,0,0,0.06)" stroke-width="4"/>
<path d="M447 604C453 644 449 672 453 692" stroke="rgba(255,255,255,0.04)" stroke-width="3.5"/>
<path d="M332 116C324 156 332 198 350 222" stroke="rgba(0,0,0,0.10)" stroke-width="4"/>
<path d="M326 112C318 154 326 196 344 220" stroke="rgba(255,255,255,0.05)" stroke-width="3.5"/>
<path d="M468 116C476 156 468 198 450 222" stroke="rgba(0,0,0,0.10)" stroke-width="4"/>
<path d="M474 112C482 154 474 196 456 220" stroke="rgba(255,255,255,0.05)" stroke-width="3.5"/>
<path d="M368 208C378 222 390 228 398 229" stroke="rgba(0,0,0,0.08)" stroke-width="3"/>
<path d="M432 208C422 222 410 228 402 229" stroke="rgba(0,0,0,0.08)" stroke-width="3"/>`
  return `<g fill="none" stroke-linecap="round" filter="url(#${p}-b3)">
<path d="M688 318C708 310 726 312 744 304" stroke="rgba(0,0,0,0.09)" stroke-width="4"/>
<path d="M686 311C706 303 726 305 742 297" stroke="rgba(255,255,255,0.05)" stroke-width="3.5"/>
<path d="M684 432C706 424 726 428 748 420" stroke="rgba(0,0,0,0.08)" stroke-width="4"/>
<path d="M682 425C704 417 724 421 746 413" stroke="rgba(255,255,255,0.045)" stroke-width="3.5"/>
<path d="M690 546C708 540 724 542 742 536" stroke="rgba(0,0,0,0.07)" stroke-width="4"/>
<path d="M688 539C706 533 722 535 740 529" stroke="rgba(255,255,255,0.04)" stroke-width="3.5"/>
<path d="M112 318C92 310 74 312 56 304" stroke="rgba(0,0,0,0.07)" stroke-width="4"/>
<path d="M114 311C94 303 74 305 58 297" stroke="rgba(255,255,255,0.04)" stroke-width="3.5"/>
<path d="M116 432C94 424 74 428 52 420" stroke="rgba(0,0,0,0.06)" stroke-width="4"/>
<path d="M118 425C96 417 76 421 54 413" stroke="rgba(255,255,255,0.04)" stroke-width="3.5"/>
<path d="M110 546C92 540 76 542 58 536" stroke="rgba(0,0,0,0.05)" stroke-width="4"/>
<path d="M694 612L700 642" stroke="rgba(0,0,0,0.10)" stroke-width="3"/>
<path d="M716 606L718 640" stroke="rgba(0,0,0,0.10)" stroke-width="3"/>
<path d="M736 602L736 638" stroke="rgba(0,0,0,0.09)" stroke-width="3"/>
<path d="M706 610L710 641" stroke="rgba(255,255,255,0.05)" stroke-width="2.5"/>
<path d="M726 604L727 639" stroke="rgba(255,255,255,0.05)" stroke-width="2.5"/>
<path d="M106 612L100 642" stroke="rgba(0,0,0,0.09)" stroke-width="3"/>
<path d="M84 606L82 640" stroke="rgba(0,0,0,0.09)" stroke-width="3"/>
<path d="M64 602L64 638" stroke="rgba(0,0,0,0.08)" stroke-width="3"/>
<path d="M94 610L90 641" stroke="rgba(255,255,255,0.05)" stroke-width="2.5"/>
<path d="M74 604L73 639" stroke="rgba(255,255,255,0.05)" stroke-width="2.5"/>
<path d="M120 694C240 699 560 699 680 694" stroke="rgba(0,0,0,0.08)" stroke-width="5"/>
${side}
</g>`
}

/** Crisp lines: seams, edges, stitches, ribbing ticks. */
function crisp(front: boolean): string {
  const ribs = `<g fill="none" stroke-linecap="butt">
<path d="M662 684C690 682 718 678 747 676" stroke="rgba(0,0,0,0.10)" stroke-width="74" stroke-dasharray="1.8 3.1"/>
<path d="M662 684C690 682 718 678 747 676" stroke="rgba(255,255,255,0.055)" stroke-width="74" stroke-dasharray="1.8 3.1" stroke-dashoffset="2.45"/>
<path d="M138 684C110 682 82 678 53 676" stroke="rgba(0,0,0,0.10)" stroke-width="74" stroke-dasharray="1.8 3.1"/>
<path d="M138 684C110 682 82 678 53 676" stroke="rgba(255,255,255,0.055)" stroke-width="74" stroke-dasharray="1.8 3.1" stroke-dashoffset="2.45"/>
<path d="M126 730C300 734 500 734 674 730" stroke="rgba(0,0,0,0.095)" stroke-width="52" stroke-dasharray="2 3.4"/>
<path d="M126 730C300 734 500 734 674 730" stroke="rgba(255,255,255,0.055)" stroke-width="52" stroke-dasharray="2 3.4" stroke-dashoffset="2.7"/>
</g>`
  const seams = `<g fill="none" stroke-linecap="round">
<path d="M672 154C652 210 646 280 646 346" stroke="rgba(0,0,0,0.14)" stroke-width="1.7"/>
<path d="M675 156C655 212 649 282 649 348" stroke="rgba(255,255,255,0.06)" stroke-width="1.4"/>
<path d="M128 154C148 210 154 280 154 346" stroke="rgba(0,0,0,0.14)" stroke-width="1.7"/>
<path d="M125 156C145 212 151 282 151 348" stroke="rgba(255,255,255,0.06)" stroke-width="1.4"/>
<path d="M646 350C650 470 658 570 666 646" stroke="rgba(0,0,0,0.15)" stroke-width="1.8"/>
<path d="M649 352C653 470 661 570 669 646" stroke="rgba(255,255,255,0.05)" stroke-width="2.5"/>
<path d="M154 350C150 470 142 570 134 646" stroke="rgba(0,0,0,0.15)" stroke-width="1.8"/>
<path d="M151 352C147 470 139 570 131 646" stroke="rgba(255,255,255,0.05)" stroke-width="2.5"/>
<path d="M755 643C726 648 696 650 666 649" stroke="rgba(0,0,0,0.14)" stroke-width="1.7"/>
<path d="M755 645.5C726 650.5 696 652.5 666 651.5" stroke="rgba(255,255,255,0.06)" stroke-width="1.4"/>
<path d="M45 643C74 648 104 650 134 649" stroke="rgba(0,0,0,0.14)" stroke-width="1.7"/>
<path d="M45 645.5C74 650.5 104 652.5 134 651.5" stroke="rgba(255,255,255,0.06)" stroke-width="1.4"/>
<path d="M118 698C240 703 560 703 682 698" stroke="rgba(0,0,0,0.15)" stroke-width="1.8"/>
<path d="M118 700.5C240 705.5 560 705.5 682 700.5" stroke="rgba(255,255,255,0.07)" stroke-width="1.4"/>
<path d="M682 700L678 756" stroke="rgba(0,0,0,0.10)" stroke-width="1.5"/>
<path d="M118 700L122 756" stroke="rgba(0,0,0,0.10)" stroke-width="1.5"/>
<path d="M552 104C596 118 646 136 672 152" stroke="rgba(0,0,0,0.12)" stroke-width="1.6"/>
<path d="M551 107C595 121 645 139 670 154" stroke="rgba(255,255,255,0.06)" stroke-width="1.4"/>
<path d="M248 104C204 118 154 136 128 152" stroke="rgba(0,0,0,0.12)" stroke-width="1.6"/>
<path d="M249 107C205 121 155 139 130 154" stroke="rgba(255,255,255,0.06)" stroke-width="1.4"/>
</g>`
  const pocketEdges = `<g fill="none" stroke-linecap="round">
<path d="M262 575.5C350 578.5 450 578.5 538 575.5" stroke="rgba(255,255,255,0.07)" stroke-width="1.4"/>
<path d="M262 578C350 581 450 581 538 578" stroke="rgba(0,0,0,0.15)" stroke-width="1.7"/>
<path d="M266 585C350 588 450 588 534 585" stroke="rgba(0,0,0,0.11)" stroke-width="1.3"/>
<path d="M266 591C350 594 450 594 534 591" stroke="rgba(0,0,0,0.11)" stroke-width="1.3"/>
<path d="M266 594C350 597 450 597 534 594" stroke="rgba(255,255,255,0.05)" stroke-width="1.2"/>
<path d="M538 578C556 618 572 656 585 690" stroke="rgba(0,0,0,0.14)" stroke-width="1.7"/>
<path d="M262 578C244 618 228 656 215 691" stroke="rgba(0,0,0,0.14)" stroke-width="1.7"/>
<path d="M528 582C545 620 560 655 573 688" stroke="rgba(0,0,0,0.11)" stroke-width="1.3"/>
<path d="M521 585C538 622 552 656 565 689" stroke="rgba(0,0,0,0.11)" stroke-width="1.3"/>
<path d="M532 581C549 619 564 654 577 687" stroke="rgba(255,255,255,0.05)" stroke-width="1.2"/>
<path d="M272 582C255 620 240 655 227 688" stroke="rgba(0,0,0,0.11)" stroke-width="1.3"/>
<path d="M279 585C262 622 248 656 235 689" stroke="rgba(0,0,0,0.11)" stroke-width="1.3"/>
<path d="M268 581C251 619 236 654 223 687" stroke="rgba(255,255,255,0.05)" stroke-width="1.2"/>
</g>`
  const hoodFront = `<g fill="none" stroke-linecap="round">
<path d="M373 197C368 219 362 231 356 245" stroke="rgba(0,0,0,0.30)" stroke-width="7"/>
<path d="M373 197C368 219 362 231 356 245" stroke="#D8DBDE" stroke-width="4.6"/>
<path d="M427 197C433 220 440 233 445 247" stroke="rgba(0,0,0,0.30)" stroke-width="7"/>
<path d="M427 197C433 220 440 233 445 247" stroke="#D8DBDE" stroke-width="4.6"/>
<path d="M356 245L351 260" stroke="rgba(0,0,0,0.30)" stroke-width="8"/>
<path d="M356 245L351 260" stroke="#AEB4BC" stroke-width="5.6"/>
<path d="M354.5 247.5L352.5 253.5" stroke="rgba(255,255,255,0.35)" stroke-width="1.4"/>
<path d="M445 247L449 262" stroke="rgba(0,0,0,0.30)" stroke-width="8"/>
<path d="M445 247L449 262" stroke="#AEB4BC" stroke-width="5.6"/>
<path d="M446 249.5L447.6 255.5" stroke="rgba(255,255,255,0.35)" stroke-width="1.4"/>
</g>
<g fill="none">
<path d="M488 92C468 138 435 176 404 210" stroke="__COLOR__" stroke-width="14"/>
<path d="M488 92C468 138 435 176 404 210" stroke="rgba(0,0,0,0.06)" stroke-width="14"/>
<path d="M494 95C474 141 441 181 409 215" stroke="rgba(0,0,0,0.16)" stroke-width="1.5"/>
<path d="M482 89C462 135 429 171 399 205" stroke="rgba(0,0,0,0.12)" stroke-width="1.3"/>
<path d="M491 94C471 140 438 179 406 213" stroke="rgba(0,0,0,0.09)" stroke-width="1.1"/>
<path d="M486 91C466 137 433 174 402 208" stroke="rgba(255,255,255,0.06)" stroke-width="1.2"/>
<path d="M312 92C332 138 365 176 396 210" stroke="__COLOR__" stroke-width="14"/>
<path d="M312 92C332 138 365 176 396 210" stroke="rgba(255,255,255,0.05)" stroke-width="14"/>
<path d="M306 95C326 141 359 181 391 215" stroke="rgba(0,0,0,0.16)" stroke-width="1.5"/>
<path d="M318 89C338 135 371 171 401 205" stroke="rgba(0,0,0,0.12)" stroke-width="1.3"/>
<path d="M309 94C329 140 362 179 394 213" stroke="rgba(0,0,0,0.09)" stroke-width="1.1"/>
<path d="M314 91C334 137 367 174 398 208" stroke="rgba(255,255,255,0.06)" stroke-width="1.2"/>
</g>
<circle cx="373" cy="193" r="6.2" fill="#B9BFC7" stroke="rgba(0,0,0,0.35)" stroke-width="1.2"/>
<circle cx="373" cy="193" r="2.6" fill="#3A3F46"/>
<circle cx="427" cy="193" r="6.2" fill="#B9BFC7" stroke="rgba(0,0,0,0.35)" stroke-width="1.2"/>
<circle cx="427" cy="193" r="2.6" fill="#3A3F46"/>`
  const hoodBack = `<g fill="none" stroke-linecap="round">
<path d="M400 46C398 110 402 175 400 238" stroke="rgba(0,0,0,0.13)" stroke-width="1.7"/>
<path d="M403 46C401 110 405 175 403 238" stroke="rgba(255,255,255,0.06)" stroke-width="1.4"/>
<path d="M254 98C250 146 262 190 296 216C332 240 368 234 400 234C432 234 468 240 504 216C536 190 548 146 546 98" stroke="rgba(0,0,0,0.09)" stroke-width="1.3"/>
<path d="${HOOD_BACK}" stroke="rgba(0,0,0,0.16)" stroke-width="2"/>
<path d="M250 104.5C246 152.5 258 198.5 292 226.5C330 252.5 366 245.5 400 245.5C434 245.5 470 252.5 508 226.5C542 198.5 554 152.5 550 104.5" stroke="rgba(255,255,255,0.07)" stroke-width="1.5"/>
</g>`
  return `${ribs}
${seams}
${front ? pocketEdges + hoodFront : hoodBack}`
}

function body(p: string, front: boolean): string {
  const backCast = front
    ? ''
    : `<path d="M250 110C246 158 258 204 292 232C330 258 366 251 400 251C434 251 470 258 508 232C542 204 554 158 550 110" fill="none" stroke="rgba(0,0,0,0.13)" stroke-width="14" filter="url(#${p}-b8)"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800">
${defs(p)}
<use href="#${p}-sil" fill="__COLOR__"/>
<g clip-path="url(#${p}-clip)">
<use href="#${p}-sil" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="7"/>
${baseFills(p, front)}
${softB6(p, front)}
${backCast}
${softB3(p, front)}
${crisp(front)}
<rect x="24" y="36" width="752" height="736" filter="url(#${p}-gr)" opacity="0.025"/>
<use href="#${p}-sil" fill="none" stroke="rgba(0,0,0,0.16)" stroke-width="3"/>
</g>
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
<path d="M545 396C512 408 486 412 458 412" stroke-width="11" stroke="rgba(0,0,0,0.07)"/>`
    : `<path d="M310 262C350 288 450 288 490 262" stroke-width="34" stroke="rgba(0,0,0,0.16)"/>
<rect x="224" y="320" width="44" height="240" rx="22" fill="rgba(0,0,0,0.11)"/>
<rect x="532" y="315" width="46" height="250" rx="23" fill="rgba(0,0,0,0.14)"/>
<path d="M400 330C398 400 402 470 400 540" stroke-width="10" stroke="rgba(0,0,0,0.06)"/>
<path d="M545 400C512 412 486 416 458 416" stroke-width="11" stroke="rgba(0,0,0,0.07)"/>`
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
      // below the drawcord tips (y≈262); bottom clears the pocket top (y578)
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
