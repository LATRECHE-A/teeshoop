/**
 * Print grading: how artwork responds to garment size.
 *
 * THE MODEL
 * ---------
 * A design's layer geometry is stored ONCE, in inches, at `printScale.baseSize`.
 * Rendering it at any other size multiplies every inch-valued quantity (layer
 * offsets, widths, heights, font sizes, stroke widths AND the print area itself)
 * by one uniform factor `k`. Because the artwork and the area scale together,
 * the design occupies exactly the same fraction of the print area on every size:
 * an S and a 3XL are visually identical, just at different physical scales.
 *
 * `k` is the CHEST ratio (halfChest(size) / halfChest(baseSize)), and it is
 * deliberately UNIFORM: grading x and y by different amounts (chest vs body
 * length) would distort the artwork, which is never acceptable. Chest is the
 * right reference because prints are width-constrained.
 *
 * In `fixed` mode k is always 1: one physical print for every size, positioned a
 * size-invariant distance below the collar. That is the classic single-transfer
 * convention and it is the cheaper one. See the cost note below.
 *
 * WHY THIS SHAPE
 * --------------
 * Storing one canonical geometry + a derived factor (rather than per-size
 * geometry) keeps the project's core invariant intact (geometry is inches
 * relative to the print-area centre) and means every existing editor gesture
 * keeps writing base-space inches with no change: the editor scales the area
 * rect by k and its pixels-per-inch by k, so the two cancel on write-back.
 *
 * COST
 * ----
 * Grading is not free. In `fixed` mode an order of 6 sizes needs ONE printed
 * transfer; in `scaled` mode it needs six different ones, so the DTF gang sheet
 * carries a distinct piece per (design, side, size) and uses more film. The DTF
 * modal surfaces this: it is a real trade-off, not an implementation detail.
 */
import type { CustomGarment, Design, Layer, SizeIn, PrintScale, PrintScaleMode } from './types'
import {
  DEFAULT_SIZE,
  readHalfChestSeries,
  SIZE_IDS,
  sizeSpecCm,
  type SizeId,
} from '@/content/sizeChart'

/** New designs grade with the garment; override per design in the UI. */
export const DEFAULT_PRINT_SCALE_MODE: PrintScaleMode = 'scaled'

/** Grading policy for a design, with defaults for pre-grading documents. */
export function printScaleOf(design: Design): PrintScale {
  const ps = design.printScale
  return {
    mode: ps?.mode === 'fixed' || ps?.mode === 'scaled' ? ps.mode : DEFAULT_PRINT_SCALE_MODE,
    baseSize: ps?.baseSize ?? DEFAULT_SIZE,
  }
}

/** The size a design's stored inch geometry is authored at. */
export function printBaseSize(design: Design): SizeId {
  return printScaleOf(design).baseSize
}

/**
 * La série du fabricant portée par le document, quand elle s'applique ICI.
 *
 * « Ici » veut dire : sur le vêtement que le champ décrit. Une charte de
 * t-shirt ne dit rien d'un sweat, et l'éditeur laisse changer de vêtement à
 * tout moment ; sans ce contrôle, une capuche serait gradée par la poitrine
 * d'un t-shirt. Une série vide compte pour absente, sinon « la boutique n'a
 * rien dit » et « la boutique a dit rien » seraient le même état, et le second
 * rendrait le vêtement non gradable.
 */
function shopChart(design: Design): Partial<Record<SizeId, number>> | null {
  const chart = design.shopSizeChart
  if (!chart || chart.garmentId !== design.garmentId) return null
  /*
   * RELUE ICI, et pas seulement à l'entrée. Le document arrive aussi de R2, où
   * il a été déposé par le navigateur du client sur une route ouverte : le
   * contrôle de la passerelle est du côté que l'on ne tient pas. C'est ce
   * chemin-là qui découpe le film (`src/lib/dtf/pieces.ts`).
   */
  const series = readHalfChestSeries(chart.halfChestCm)
  return Object.keys(series).length > 0 ? series : null
}

/** Half-chest in cm for a garment size, or null when it is not knowable. */
function halfChestCm(design: Design, size: SizeId): number | null {
  /*
   * LA CHARTE DU VÊTEMENT VENDU D'ABORD, quel que soit le `garmentId`.
   *
   * `sizeSpecCm` ne connaît qu'un vêtement par famille, le Stanley/Stella dont
   * les 800 px de dessin sont calibrés. Une offre de la boutique déclare bien
   * `tee` ou `hoodie` parce que c'est ce que l'éditeur sait dessiner, et ce
   * n'est PAS ce qu'elle vend : mesuré le 5 septembre 2026, le marquage
   * occupait 19,1 % de plus de la poitrine en S qu'en 3XL sur le Gildan Heavy
   * Cotton, 12,1 % sur le Fruit of the Loom, et 0,0 % sur le Stanley/Stella
   * lui-même, ce qui est le contrôle de la mesure.
   */
  /*
   * ELLE EST LA SEULE SOURCE, OU ELLE N'EST PAS UNE SOURCE.
   *
   * Retomber taille par taille sur la charte du studio fabriquerait un rapport
   * entre DEUX vêtements. Deux chemins mesurés le 5 septembre 2026, tous deux
   * trouvés par la passe adversariale :
   *
   *  - une série honnête mais courte (le Fruit of the Loom Classic Hooded
   *    s'arrête au 2XL) donnait k(3XL) = 64 / 50,8 = 1,2598, le 3XL du
   *    Stanley/Stella divisé par le M du Fruit of the Loom ;
   *  - une série fabriquée { S: 25, M: 26 }, que le contrôle de vraisemblance
   *    accepte parce que chaque valeur et leur rapport sont crédibles, donnait
   *    k(3XL) = 64 / 25 = 2,56 sur un document calé en S. La borne de rapport ne
   *    voyait rien : le rapport tordu n'est pas DANS la série, il est entre la
   *    série et la charte.
   *
   * Une taille que la série ne porte pas n'est donc pas mesurable : `null`, et
   * `printScaleK` rend 1. C'est le même contrat que la branche « vêtement du
   * client » juste en dessous, et c'est le sens conservateur : un marquage à sa
   * taille de base plutôt qu'un marquage inventé. La boutique ne vend de toute
   * façon que les tailles de la série (`ProductPage::sizes_for`), et
   * `gradableSizes` retire celles-là de l'interface.
   */
  const shop = shopChart(design)
  if (shop) {
    const own = shop[size]
    return typeof own === 'number' && own > 0 ? own : null
  }
  if (design.garmentId === 'custom') {
    const chart = design.custom?.halfChestCmBySize
    const v = chart?.[size]
    return typeof v === 'number' && v > 0 ? v : null
  }
  return sizeSpecCm(design.garmentId, size).halfChestCm
}

/**
 * Uniform grading factor for `size`, relative to the design's base size.
 *
 * Returns exactly 1 (no grading) when the mode is `fixed`, when no size is
 * given, when the size IS the base size, or when the garment publishes no chart
 * for either size (an ingested product whose supplier chart we never captured).
 * Never guesses a ratio it cannot derive.
 */
export function printScaleK(design: Design, size?: SizeId | null): number {
  const { mode, baseSize } = printScaleOf(design)
  if (mode === 'fixed' || !size || size === baseSize) return 1
  const a = halfChestCm(design, size)
  const b = halfChestCm(design, baseSize)
  if (a === null || b === null || b <= 0) return 1
  return a / b
}

/** True when this design grades AND the garment can actually be graded. */
export function isGraded(design: Design): boolean {
  if (printScaleOf(design).mode !== 'scaled') return false
  if (shopChart(design)) return gradableSizes(design).length > 1
  if (design.garmentId !== 'custom') return true
  const chart = design.custom?.halfChestCmBySize
  return !!chart && Object.keys(chart).length > 1
}

/** Sizes this design can be graded to, in chart order. */
export function gradableSizes(design: Design): SizeId[] {
  /*
   * UNE TAILLE SANS MESURE N'EST PAS GRADABLE, même sur un vêtement du
   * catalogue. La série du fabricant peut être plus courte que celle du studio
   * (le Fruit of the Loom Classic Hooded s'arrête au 2XL), et grader une taille
   * qu'elle ne contient pas ferait retomber `printScaleK` sur 1 en silence :
   * un marquage à la taille du M sur un 3XL, sans que rien ne le dise.
   */
  const shop = shopChart(design)
  if (shop) {
    return SIZE_IDS.filter((s) => (shop[s] ?? 0) > 0)
  }
  if (design.garmentId !== 'custom') return [...SIZE_IDS]
  const chart = design.custom?.halfChestCmBySize ?? {}
  return SIZE_IDS.filter((s) => (chart[s] ?? 0) > 0)
}

/**
 * Scale one layer's inch-valued geometry. Rotation, opacity, curve and
 * letter-spacing are scale-invariant (letterSpacingEm is relative to the font
 * size, which is itself scaled). Returns the SAME reference when k === 1 so
 * render paths can keep their identity-based memoisation.
 */
export function scaleLayer<T extends Layer>(layer: T, k: number): T {
  if (k === 1) return layer
  const base = { ...layer, xIn: layer.xIn * k, yIn: layer.yIn * k }
  if (base.type === 'text')
    return { ...base, fontSizeIn: base.fontSizeIn * k, strokeWidthIn: base.strokeWidthIn * k }
  return { ...base, wIn: base.wIn * k, hIn: base.hIn * k }
}

/** Scale a whole side's layers (identity when k === 1). */
export function scaleLayers(layers: Layer[], k: number): Layer[] {
  return k === 1 ? layers : layers.map((l) => scaleLayer(l, k))
}

/** Scale a print-area size. */
export function scaleAreaIn(area: SizeIn, k: number): SizeIn {
  return k === 1 ? area : { wIn: area.wIn * k, hIn: area.hIn * k }
}

/**
 * Half-chest chart to stash on a custom garment so ingested products grade too.
 * Drops non-positive entries rather than storing a zero that would read as
 * "chart present but broken".
 */
export function chestChartFrom(
  sizes: Partial<Record<SizeId, { halfChestCm: number }>>,
): CustomGarment['halfChestCmBySize'] {
  const out: Partial<Record<SizeId, number>> = {}
  for (const [size, spec] of Object.entries(sizes) as [SizeId, { halfChestCm: number }][])
    if (spec && spec.halfChestCm > 0) out[size] = spec.halfChestCm
  return out
}
