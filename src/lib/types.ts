/**
 * Tshop Studio: core type contracts.
 *
 * INVARIANT: all design geometry is stored in INCHES, positioned relative to
 * the CENTER of the active print area (+x right, +y down, rotation in degrees).
 * Pixels are a rendering concern only. This is what keeps 2D editing, 3D
 * preview and 300-DPI print export dimensionally identical.
 */
import type { SceneId } from '@/scenes'

export type Side = 'front' | 'back' | 'sleeve'
export type GarmentId = 'tee' | 'hoodie' | 'custom'
export type CatalogGarmentId = Exclude<GarmentId, 'custom'>
/** Display-mannequin silhouette for the 3D preview + AR try-on. */
export type Gender = 'male' | 'female'
/** Chart size. The real dimensions live in src/content/sizeChart.ts. */
export type SizeId = 'S' | 'M' | 'L' | 'XL' | '2XL' | '3XL'

export interface SizeIn {
  wIn: number
  hIn: number
}

/** Rect with top-left origin, inches. */
export interface RectIn {
  xIn: number
  yIn: number
  wIn: number
  hIn: number
}

export interface RectPx {
  x: number
  y: number
  w: number
  h: number
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

export interface LayerBase {
  id: string
  side: Side
  name: string
  /** Offset of the layer's center from the print-area center, inches. */
  xIn: number
  yIn: number
  rotation: number
  opacity: number
}

export interface TextLayer extends LayerBase {
  type: 'text'
  text: string
  /** Must be a `family` from the FONTS registry (src/lib/fonts.ts). */
  fontFamily: string
  /** CSS font-size expressed in inches (px = fontSizeIn * pixelsPerInch). */
  fontSizeIn: number
  fill: string
  stroke: string | null
  strokeWidthIn: number
  /** Extra tracking relative to font size (em units). */
  letterSpacingEm: number
  /** -100..100. 0 = straight. Positive arcs upward (smile). */
  curve: number
  /** Multiline alignment; ignored when curved. */
  align: 'left' | 'center' | 'right'
}

export interface ImageLayer extends LayerBase {
  type: 'image'
  assetId: string
  wIn: number
  hIn: number
  flipX: boolean
  /** Render the background-removed cutout when the asset has one. */
  useCutout: boolean
}

export interface GraphicLayer extends LayerBase {
  type: 'graphic'
  /** Must be an `id` from the GRAPHICS registry (src/content/graphics.ts). */
  graphicId: string
  wIn: number
  hIn: number
  fill: string
  flipX: boolean
}

export type Layer = TextLayer | ImageLayer | GraphicLayer

// ---------------------------------------------------------------------------
// Custom garment (customer ships their own garment, we print on it)
// ---------------------------------------------------------------------------

export interface CustomSideSetup {
  /** Photo of the garment side, stored in the asset library. */
  assetId: string
  /** Use the background-removed cutout of the photo (recommended). */
  useCutout: boolean
  /**
   * Print area placed by the user on their garment photo.
   * Coordinates are inches relative to the garment's bounding box (top-left),
   * where the bounding box width equals CustomGarment.widthIn.
   */
  printArea: RectIn
  /**
   * Where the image came from. `'generated'` = RECONSTRUCTED from the other
   * side because no real photo exists (src/lib/ingest/pipeline.ts), so every
   * surface showing it must say so. Absent ⇒ `'photo'`: documents written
   * before provenance existed all held real photos. Mirrors
   * ProductSideDef.origin and is carried across by ingest/apply.ts.
   */
  origin?: 'photo' | 'generated'
}

export interface CustomGarment {
  /** Real laid-flat garment width in inches (drives all px↔inch mapping). */
  widthIn: number
  front: CustomSideSetup | null
  back: CustomSideSetup | null
  /**
   * Half-chest (cm) per size from the supplier's own chart, captured when the
   * product was applied. Lets print-size grading work for ship-your-own /
   * ingested garments exactly as it does for catalog ones; absent ⇒ no grading
   * (k = 1), never a guess. `widthIn` above is this chart read at `baseSize`.
   */
  halfChestCmBySize?: Partial<Record<SizeId, number>>
}

/**
 * How artwork responds to garment size.
 *  - `fixed`:  one physical print for every size (one film, cheapest). The
 *    print sits a size-invariant distance below the collar, the classic
 *    single-transfer convention.
 *  - `scaled`: artwork and print area are GRADED: both scale uniformly with
 *    the garment's chest so a 3XL carries a proportionally larger print and
 *    every size reads identically. Costs more film: each size is a distinct
 *    piece on the gang sheet.
 */
export type PrintScaleMode = 'fixed' | 'scaled'

export interface PrintScale {
  mode: PrintScaleMode
  /** The size the design's inch geometry is authored at (k = 1 here). */
  baseSize: SizeId
}

// ---------------------------------------------------------------------------
// Design (the undoable document)
// ---------------------------------------------------------------------------

export interface Design {
  id: string
  name: string
  garmentId: GarmentId
  /** Id from GARMENT_COLORS (src/content/palettes.ts). Ignored for custom. */
  colorId: string
  custom: CustomGarment | null
  /** ACTIVE garment context's artwork (tee+hoodie share one; custom has its own). */
  layers: Layer[]
  /**
   * The OTHER design context's layers, parked while it is inactive. `layers`
   * always holds the active garment's artwork; crossing the catalog↔custom
   * boundary swaps these two, so a ship-your-own custom garment keeps its own
   * design independent of the tee/hoodie design. Seeded from older
   * single-bucket documents by migrateDesign (src/lib/migrate.ts).
   */
  stashedLayers: Layer[]
  /**
   * Print grading policy. Layer geometry above is stored ONCE, in inches, at
   * `printScale.baseSize`; every other size is derived by a single uniform
   * factor (see src/lib/printScale.ts). Absent on documents saved before
   * grading existed: migrateDesign fills it in.
   */
  printScale?: PrintScale
  /**
   * La grille de tailles DU VÊTEMENT RÉELLEMENT VENDU, demi-poitrine à plat en
   * centimètres, quand la boutique l'a fournie.
   *
   * ── POURQUOI ELLE EST SUR LE DOCUMENT ET PAS DANS UN ÉTAT AMBIANT ─────────
   *
   * Le gradient d'impression est un rapport de demi-poitrines
   * (`src/lib/printScale.ts`), et jusqu'au 5 septembre 2026 ce rapport venait
   * toujours de `src/content/sizeChart.ts`, c'est-à-dire d'UN vêtement : le
   * Stanley/Stella Creator pour le t-shirt, le Cruiser pour le sweat. Or la
   * boutique vend des B&C, des Gildan et des Fruit of the Loom, dont les séries
   * ne montent pas de la même façon. Mesuré sur les références de la gamme, la
   * part de la demi-poitrine qu'occupe le marquage variait de 12,1 % entre le S
   * et le 3XL sur le Fruit of the Loom Valueweight et de 19,1 % sur le Gildan
   * Heavy Cotton, contre 0,0 % sur le vêtement dont la charte vient. La même
   * commande, le même fichier, un rendu visiblement différent selon la taille.
   *
   * Elle vit ICI et pas dans un module poussé par la passerelle, parce que le
   * FILM est découpé plus tard, par le module DTF, à partir du document stocké
   * (`src/lib/dtf/pieces.ts` appelle `printScaleK`). Un état ambiant serait
   * absent au moment où l'atelier découpe, et le film reprendrait la charte du
   * studio sans que rien ne le dise. `buildDocument` recopie tout le design,
   * donc ce champ part avec lui vers R2.
   *
   * Absente, le gradient retombe sur la charte du studio : c'est le studio hors
   * boutique et le vêtement fourni par le client, deux états légitimes.
   *
   * Le vêtement est DANS le champ, et pas à côté, parce qu'une série de
   * t-shirts ne dit rien d'un sweat : l'éditeur laisse changer de vêtement à
   * tout moment, et un champ nu graderait alors une capuche par la poitrine
   * d'un t-shirt. Ici, changer de vêtement suffit à faire retomber le gradient
   * sur la charte du studio, sans rien effacer, et revenir au vêtement d'origine
   * le remet en service.
   */
  shopSizeChart?: {
    garmentId: GarmentId
    /**
     * L'offre qui a fourni la série. 0 quand elle n'est pas connue.
     *
     * Le vêtement ne suffit pas à reconnaître une série étrangère : deux offres
     * sont des `tee` et n'ont pas la même fiche. Mesuré le 5 septembre 2026, une
     * création faite sur un B&C puis rouverte sur un Gildan gardait la série du
     * B&C, et la boutique validait le placement avec la fiche du Gildan pendant
     * que le film était découpé avec celle du B&C : 13,75 % d'écart dans chaque
     * direction. `CartModal` refuse la ligne sur ce champ.
     */
    productId: number
    halfChestCm: Partial<Record<SizeId, number>>
  }
  updatedAt: number
}

export interface SavedDesignMeta {
  id: string
  name: string
  garmentId: GarmentId
  updatedAt: number
  /** Small PNG data-url thumbnail. */
  thumb: string
}

// ---------------------------------------------------------------------------
// Asset library (user uploads, persisted in IndexedDB)
// ---------------------------------------------------------------------------

export interface AssetMeta {
  id: string
  name: string
  width: number
  height: number
  hasCutout: boolean
  createdAt: number
}

// ---------------------------------------------------------------------------
// 2D garment art (src/garments, module A1)
// ---------------------------------------------------------------------------

/** The 2D editor viewBox is always 0 0 800 800. */
export const GARMENT_VIEW = 800

export interface GarmentSideArt {
  /**
   * Complete `<svg>` markup of the garment. Must contain the literal token
   * __COLOR__ everywhere the body color goes (replaced at runtime).
   * The garment must be visually centered at (400, 400) of the viewBox.
   */
  body: string
  /**
   * Complete `<svg>` markup: grayscale-on-transparent shading (soft shadows,
   * folds, seam darkening) drawn ABOVE the design with multiply blending so
   * prints inherit the garment's shading. Must align 1:1 with `body`.
   */
  shade: string
  /** Print area in viewBox pixels. */
  printAreaPx: RectPx
  /**
   * Collar-seam centre (viewBox px), the fixed point the art scales about
   * when rendering non-nominal sizes (professional print placement is
   * measured from the collar and is size-invariant). For the sleeve side this
   * is the print-area top centre (cap seam proxy).
   */
  collarPx: { x: number; y: number }
}

export interface GarmentArt {
  id: CatalogGarmentId
  name: string
  /** viewBox px per real inch (identical for front/back of one garment). */
  pxPerInch: number
  /** Real laid-flat garment width in inches. */
  widthIn: number
  /** Physical print-area size per side. */
  printAreasIn: Record<Side, SizeIn>
  sides: Record<Side, GarmentSideArt>
}

// ---------------------------------------------------------------------------
// 3D (src/three, module A3)
// ---------------------------------------------------------------------------

export interface DecalSource {
  /** Transparent render of the full print area. */
  canvas: HTMLCanvasElement
  /** Bump to signal the texture changed. */
  version: number
  wIn: number
  hIn: number
}

export interface CardSource {
  /** Full custom-garment composite (photo + design), transparent bg if cutout. */
  canvas: HTMLCanvasElement
  version: number
  wIn: number
  hIn: number
  /**
   * The same garment WITHOUT the design: same pixel dimensions, same alpha.
   * `canvas` is what you SEE; this is what the 3D shell MEASURES (the photo's
   * baked lighting, its folds, its colour). A print is none of those, and the
   * shell reading it as all three is what embossed a customer's wordmark into
   * the cloth. Optional: a photo with no artwork on it measures itself.
   */
  photo?: HTMLCanvasElement
}

export type ViewSnap = 'front' | 'back' | 'threequarter'

export interface Garment3DProps {
  garment: GarmentId
  colorHex: string
  /** Environment/lighting scene id (see src/scenes). Defaults to 'studio'. */
  scene?: SceneId
  /**
   * UI theme. Only `studio` follows it, and it does so for one reason: its
   * GROUND. A dark floor disc under a garment standing on paper is a hole in
   * the page, and the floor is what the contact shadow is drawn onto.
   */
  theme?: 'dark' | 'light'
  front: DecalSource | null
  back: DecalSource | null
  sleeve: DecalSource | null
  /**
   * Print grading factor for the previewed size (src/lib/printScale.ts). The
   * print area's drop below the collar grades with the artwork, so the 3D
   * anchor needs it. 1 in `fixed` mode. Catalog garments only.
   */
  printK?: number
  /** Garment real width, used for stage/floor layout and custom garments. */
  garmentWidthIn: number
  /**
   * Previewed chart size. Catalog garments are scaled from the official cm
   * chart: girth from the half-chest, length from the body length.
   */
  sizeId?: SizeId
  custom?: { front: CardSource | null; back: CardSource | null }
  autoRotate: boolean
  /** Camera snap request; apply when nonce changes. */
  viewRequest: { view: ViewSnap; nonce: number } | null
  /**
   * What the camera composes on. `print` moves in until the print area fills
   * the frame, which is the DETAIL image a product page needs beside the front
   * and the back. Not a `ViewSnap`: the three views are places to stand and the
   * studio gives the customer a button for each, this is a lens and it has no
   * button. Defaults to `garment`.
   */
  framing?: 'garment' | 'print'
  onReady?: () => void
}

// ---------------------------------------------------------------------------
// Graphics registry (src/content, module A5)
// ---------------------------------------------------------------------------

export interface GraphicDef {
  id: string
  name: string
  category: string
  /** width / height. */
  aspect: number
  /** Complete `<svg>` markup at the given color (stroke- or fill-based). */
  svg: (color: string) => string
}

// ---------------------------------------------------------------------------
// Fonts registry (src/lib/fonts.ts, module A4)
// ---------------------------------------------------------------------------

export interface FontDef {
  /** Exact CSS font-family name. */
  family: string
  label: string
  category: 'block' | 'script' | 'retro' | 'display'
}
