/**
 * Tshop Studio — core type contracts.
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
 *  - `fixed`  — one physical print for every size (one film, cheapest). The
 *    print sits a size-invariant distance below the collar, the classic
 *    single-transfer convention.
 *  - `scaled` — artwork and print area are GRADED: both scale uniformly with
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
   * grading existed — migrateDesign fills it in.
   */
  printScale?: PrintScale
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
// 2D garment art (src/garments — module A1)
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
   * Collar-seam centre (viewBox px) — the fixed point the art scales about
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
// 3D (src/three — module A3)
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
}

export type ViewSnap = 'front' | 'back' | 'threequarter'

export interface Garment3DProps {
  garment: GarmentId
  colorHex: string
  /** Environment/lighting scene id (see src/scenes). Defaults to 'studio'. */
  scene?: SceneId
  front: DecalSource | null
  back: DecalSource | null
  sleeve: DecalSource | null
  /**
   * Vertical offset (inches, +down) of each print-area CENTER from the
   * garment's visual center — derived from GarmentSideArt.printAreaPx.
   * Undefined for custom garments (CardSource is already composited).
   */
  areaOffsetYIn?: Record<Side, number>
  /** Garment real width for scale calibration. */
  garmentWidthIn: number
  /**
   * Previewed chart size. garmentWidthIn already carries the half-chest ratio;
   * this additionally stretches the mesh LENGTH by the chart's body-length
   * ratio, which is what areaOffsetYIn assumes. Catalog garments only.
   */
  sizeId?: SizeId
  custom?: { front: CardSource | null; back: CardSource | null }
  autoRotate: boolean
  /** Camera snap request; apply when nonce changes. */
  viewRequest: { view: ViewSnap; nonce: number } | null
  onReady?: () => void
}

// ---------------------------------------------------------------------------
// Graphics registry (src/content — module A5)
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
// Fonts registry (src/lib/fonts.ts — module A4)
// ---------------------------------------------------------------------------

export interface FontDef {
  /** Exact CSS font-family name. */
  family: string
  label: string
  category: 'block' | 'script' | 'retro' | 'display'
}
