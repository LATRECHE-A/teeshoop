/**
 * The garment dye deck: ONE answer to "what colour is this shirt".
 *
 * WHY THIS MODULE EXISTS, TWICE OVER
 * ----------------------------------
 * 1. There were FOUR copies of `GARMENT_COLORS.find(c => c.id === colorId)?.hex`
 *    (src/state/basket.ts, src/lib/renderDesign.ts and twice in
 *    src/state/store.ts), each with its own fallback: '#FFFFFF', '#fff' and a
 *    FALLBACK_HEX constant. Four places computing one value is four chances to
 *    disagree, and the day they do the 2D canvas, the 3D preview, the basket
 *    thumbnail and the proof sheet print four different garments.
 *
 * 2. The eighteen entries of `src/content/palettes.ts` are DEMONSTRATION dyes.
 *    They were invented so the studio had something to paint before there was a
 *    catalogue. A shop product knows better: it carries the colourways the
 *    supplier actually sells for that reference, with the maker's own name and
 *    the swatch the shop MEASURED off the supplier's own colour chip
 *    (wp-plugins/teeshoop-core/includes/Colours.php, 442 of them).
 *
 *    Measured on 4 September 2026 over the nine references of the launch range:
 *    the studio paints "Rose" as #F3A6C0, and the nearest pink the B&C #E150
 *    is actually sold in is "Fuchsia", 0,306 away in OKLab. Showing a customer
 *    a pale pink circle labelled "Rose" and shipping fuchsia is a fabricated
 *    number reaching a customer. So when the shop hands over a deck, the deck
 *    WINS: the circle is painted with the measurement and labelled with the
 *    maker's own name.
 *
 * WHAT THIS IS NOT. It is not an authorisation. The cart re-derives everything
 * it charges for and `Purchase.php` refuses a colour it cannot buy, by name. A
 * frame that was handed an empty deck, or that was never handed one at all,
 * falls back to the studio's own dyes: that is the standalone studio, and it is
 * a legitimate state, not a hole.
 */
import { GARMENT_COLORS } from '@/content/palettes'

export interface GarmentDye {
  /** `Design.colorId`. Stable across the shop boundary. */
  id: string
  /** What to call it. The maker's own name when the shop supplied one. */
  name: string
  /** One or two measured hexes. Two means a heather, drawn as a gradient. */
  stops: string[]
}

/** The studio's own dyes, in the shape this module hands out. */
const STUDIO_DECK: GarmentDye[] = GARMENT_COLORS.map((c) => ({
  id: c.id,
  name: c.name,
  stops: [c.hex],
}))

/**
 * Last resort when a design names a dye nobody has heard of.
 *
 * WHITE, and it is the conservative answer rather than the pretty one: a light
 * garment is what `isDark()` reads to decide whether new artwork starts white
 * or black, and guessing "dark" on an unknown colour puts white text on what
 * may well be a white shirt.
 */
const FALLBACK_HEX = '#FFFFFF'

let shopDeck: GarmentDye[] | null = null

/**
 * The shop's own deck for the product being decorated.
 *
 * Pushed IN by the bridge rather than pulled from it, so this module has no
 * import edge to `@/lib/teeshoop/bridge` and stays usable by the render path,
 * which runs in workers and in verification harnesses with no bridge at all.
 *
 * An empty list clears the restriction rather than removing every colour: "the
 * shop said nothing" and "the shop said none" would otherwise be the same
 * value, and the first must leave a usable editor.
 */
export function setShopPalette(entries: readonly GarmentDye[] | null): void {
  shopDeck = entries && entries.length > 0 ? entries.map((e) => ({ ...e, stops: [...e.stops] })) : null
}

/** The deck to offer: the shop's when there is one, the studio's otherwise. */
export function garmentPalette(): GarmentDye[] {
  return shopDeck ?? STUDIO_DECK
}

/** True when the deck on offer is the shop's measured one. */
export function paletteIsMeasured(): boolean {
  return shopDeck !== null
}

/** One dye, or null. Looks in the offered deck first, then the studio's. */
export function garmentDye(colorId: string): GarmentDye | null {
  return (
    shopDeck?.find((c) => c.id === colorId) ??
    STUDIO_DECK.find((c) => c.id === colorId) ??
    null
  )
}

/**
 * The fill for a garment body. The ONE implementation.
 *
 * The first stop, not a blend: a heather is drawn as a two-stop gradient where
 * the surface supports one and as its dominant stop where it does not, and a
 * blended average of the two is a colour the supplier does not sell.
 */
export function garmentHexOf(colorId: string): string {
  return garmentDye(colorId)?.stops[0] ?? FALLBACK_HEX
}
