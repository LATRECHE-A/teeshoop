/**
 * Where the ink actually is.
 *
 * Every price and every centimetre of film in this app used to be measured from
 * a layer's DECLARED rectangle — `wIn × hIn` for an image or a graphic, expanded
 * by its rotation. That rectangle is the box the artwork was placed in, not the
 * artwork. A customer's logo exported with transparent margins, a
 * background-removed cutout (which is nothing BUT margins), a photo rotated 30°:
 * all three declare a box far larger than the ink inside it, and we charged for
 * the difference twice — once to the customer as printed area, once to ourselves
 * as film.
 *
 * The Bible is explicit that this is not a detail (chapitre 1, DTF): «Le coût ne
 * doit pas être saisi "par logo" sans calcul. Il dépend de la surface occupée
 * sur une laize de 56 cm, de l'imbrication…», and the imposition tool it
 * specifies is defined by «largeur et hauteur de chaque visuel» — of each
 * VISUAL, which is the ink, not the box someone dropped it into.
 *
 * WHAT IS ALREADY TIGHT, and therefore not touched here:
 *   TEXT. `measureArcText` measures glyph ink (per-glyph `actualBoundingBox*`),
 *   and `drawArcText` centres that ink box on the layer origin. A text layer's
 *   declared size IS its ink — no em-box padding, no leading, no trailing
 *   letter-space. Probing it would cost a raster to learn what it already says.
 *
 * WHAT IS MEASURED HERE: images (uploads and cutouts) and graphics, from their
 * own pixels.
 *
 * DETERMINISM IS A HARD REQUIREMENT, not a nicety. The DTF preview nests at 28
 * DPI and the export re-renders the same pieces at 300; the layout computed from
 * the first is filled with the pixels of the second, matched by `sourceKey`. If
 * a piece's box depended on the DPI it happened to be measured at, the plan and
 * the artwork would disagree — a transfer printed slightly larger than the hole
 * the nester left for it. So the ink of a layer is measured ONCE, from a
 * canonical probe of its source, in fractions of its own box, and that fraction
 * is what every DPI reuses.
 *
 * THE ERROR IS ALWAYS OUTWARD. A box that is a hair too big costs a sliver of
 * film. A box that is a hair too small clips the customer's artwork, which is
 * discovered by the customer. So: the alpha floor here is 1 (any ink at all,
 * unlike `MASK_ALPHA_FLOOR` which may discard an invisible tail because it only
 * decides interlocking), the probe rounds out to whole cells, and one extra cell
 * is added on every side. When anything is unknown — image not decoded yet,
 * canvas unreadable, cross-origin taint — the answer is the full declared box,
 * i.e. exactly what this module replaced.
 */
import type { Design, Layer, RectIn, Side, SizeIn, SizeId } from '@/lib/types'
import {
  getAreaSizeIn,
  graphicDef,
  measureLayer,
  sideLayers,
} from '@/lib/renderDesign'
import { getMeasureCtx, measureTextInk } from '@/lib/textRender'
import { printScaleK, scaleLayers } from '@/lib/printScale'
import { assetRevision, ensureAssetImage, getCachedAssetImage } from '@/state/assets'
import { ensureRaster, getRaster, withSvgSize } from '@/lib/rasterCache'
import { CM_PER_IN, degToRad } from '@/lib/units'

/**
 * How close two visuals must be to stay ONE transfer, inches.
 *
 * 0.2 in = 5,1 mm, and it is the film gap in disguise. Two pieces nested apart
 * end up `gapCm` from each other — 5 mm on every researched supplier — plus a
 * scissor cut, so splitting artwork that already sits closer than that frees no
 * film worth having while handing the operator two transfers to align to under a
 * millimetre on the garment. Above it, the gap on the shirt is wide enough that
 * a press guide is the right tool anyway.
 */
export const PIECE_CLEARANCE_IN = 0.2

/**
 * Clearance sentinel meaning "never split this side": larger than any garment,
 * so every layer lands in one cluster and the side is measured as the single
 * block it was before splitting existed. Finite on purpose — Infinity survives
 * the arithmetic here but not a JSON round trip.
 */
export const MERGE_WHOLE_SIDE_IN = 1e6

/**
 * Alpha at or above which a probe cell counts as ink, 0–255.
 *
 * ONE, not `MASK_ALPHA_FLOOR`'s 8. That constant decides how tightly two
 * transfers may interlock, where discarding an invisible anti-aliased tail is
 * the whole point. This one decides where the artwork gets CUT, where the same
 * discard is a clipped edge. Different question, different answer.
 */
const PROBE_ALPHA_FLOOR = 1

/**
 * Probe resolution cap, px on the long side. Under it the source is measured at
 * its native size and no resampling happens at all — which covers essentially
 * every logo. Above it the browser's high-quality downscale is a genuine area
 * filter, so a 1-px feature in a 4000-px upload still lands around alpha 65 at
 * 1024, sixty times the floor.
 */
const PROBE_MAX_PX = 1024

/** Canonical probe size for a graphic's SVG, px on the long side. */
const GRAPHIC_PROBE_PX = 256

/** Cells added on every side of a measured box. See "the error is outward". */
const PROBE_PAD_CELLS = 1

/**
 * The measured rect is snapped OUTWARD to this many steps across the box.
 *
 * `drawImage`'s downscale filter is implementation-defined — `imageSmoothingQuality`
 * is a hint, not a specification — so a source edge pixel resampled to a fraction
 * of a percent of coverage can land at alpha 0 in one engine and 1 in another,
 * and the detected bound would move by a probe cell. Snapping to a coarse grid
 * makes that sub-cell disagreement invisible: 1/256 of a 9-inch layer is 0,9 mm,
 * and of a 1-inch mark, 0,1 mm. The studio's number and the workshop's are then
 * the same number on any browser.
 */
const PROBE_SNAP = 256

/** Ink extent as fractions of a layer's own unrotated box: 0 = one edge, 1 = the other. */
export interface UnitRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** The whole declared box — the answer whenever the ink is unknown. */
export const FULL_UNIT: UnitRect = { x0: 0, y0: 0, x1: 1, y1: 1 }

/** Axis-aligned extent in inches from the print-area centre. */
export interface InkBox {
  x0: number
  x1: number
  y0: number
  y1: number
}

// ---------------------------------------------------------------------------
// Pure geometry
// ---------------------------------------------------------------------------

/**
 * Tight bounds of the cells at or above `floor`, in UNIT fractions of a `w × h`
 * probe, grown by `PROBE_PAD_CELLS` on every side. Null when nothing clears the
 * floor — a fully transparent source, which callers treat as "unknown", never as
 * "zero-sized".
 *
 * `alpha` is the interleaved RGBA byte array a 2D context hands back; pass
 * `stride: 1, offset: 0` to scan a plain single-channel grid instead, which is
 * what the tests do.
 */
export function alphaUnitRect(
  alpha: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  floor: number = PROBE_ALPHA_FLOOR,
  stride = 4,
  offset = 3,
): UnitRect | null {
  if (w < 1 || h < 1) return null
  let minX = w
  let maxX = -1
  let minY = h
  let maxY = -1
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      if (alpha[(row + x) * stride + offset] < floor) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return null
  const p = PROBE_PAD_CELLS
  const lo = (v: number) => Math.max(0, Math.floor(v * PROBE_SNAP) / PROBE_SNAP)
  const hi = (v: number) => Math.min(1, Math.ceil(v * PROBE_SNAP) / PROBE_SNAP)
  return {
    x0: lo((minX - p) / w),
    // +1 because maxX is the INDEX of the last inked cell and the cell has width.
    x1: hi((maxX + 1 + p) / w),
    y0: lo((minY - p) / h),
    y1: hi((maxY + 1 + p) / h),
  }
}

/**
 * Where a layer's ink lands, in inches from the print-area centre.
 *
 * `wIn × hIn` is the layer's own unrotated box; `unit` is the ink inside it;
 * `flipX` mirrors that ink about the box's centre exactly as the renderer's
 * `ctx.scale(-1, 1)` does. The result is the axis-aligned hull of the ROTATED
 * ink rectangle, which for `FULL_UNIT` reduces to the half-extent formula this
 * replaced — the property `ink.test.ts` pins, because it is what makes the
 * change a strict tightening and never a shift.
 *
 * Exact for a rectangular ink shape at any angle. For a shape whose ink is
 * diagonal within its own box (a lightning bolt at 45°) the hull of the rotated
 * BOX is larger than the hull of the rotated shape — outward, i.e. safe. The
 * true-shape packer recovers that difference from the alpha mask anyway.
 */
export function placedInkBox(
  at: { xIn: number; yIn: number; rotation: number },
  wIn: number,
  hIn: number,
  unit: UnitRect = FULL_UNIT,
  flipX = false,
): InkBox {
  const u = flipX
    ? { x0: 1 - unit.x1, x1: 1 - unit.x0, y0: unit.y0, y1: unit.y1 }
    : unit
  const lx0 = (u.x0 - 0.5) * wIn
  const lx1 = (u.x1 - 0.5) * wIn
  const ly0 = (u.y0 - 0.5) * hIn
  const ly1 = (u.y1 - 0.5) * hIn
  const r = degToRad(at.rotation)
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (const lx of [lx0, lx1])
    for (const ly of [ly0, ly1]) {
      const rx = lx * cos - ly * sin
      const ry = lx * sin + ly * cos
      if (rx < x0) x0 = rx
      if (rx > x1) x1 = rx
      if (ry < y0) y0 = ry
      if (ry > y1) y1 = ry
    }
  return { x0: at.xIn + x0, x1: at.xIn + x1, y0: at.yIn + y0, y1: at.yIn + y1 }
}

/**
 * Group boxes into independent visuals — union-find over every pair.
 *
 * Each box is grown by HALF the clearance, so two of them merge exactly when the
 * empty space between them is under `clearanceIn`, the number the UI shows.
 * Overlapping boxes merge whatever the clearance is, which is the guarantee that
 * matters: you cannot cut apart a graphic that overlaps another one.
 *
 * Returns index groups in ascending order of their smallest member, so the
 * grouping never depends on which pair happened to be visited first. O(n²) over
 * the layers of ONE side — single digits in practice.
 */
export function clusterBoxes(boxes: InkBox[], clearanceIn: number): number[][] {
  const n = boxes.length
  const parent = new Int32Array(n)
  for (let i = 0; i < n; i++) parent[i] = i
  const find = (i: number): number => {
    let r = i
    while (parent[r] !== r) r = parent[r]
    while (parent[i] !== r) {
      const next = parent[i]
      parent[i] = r
      i = next
    }
    return r
  }
  const c = Math.max(0, clearanceIn) / 2
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const a = boxes[i]
      const b = boxes[j]
      if (a.x0 - c > b.x1 + c || b.x0 - c > a.x1 + c) continue
      if (a.y0 - c > b.y1 + c || b.y0 - c > a.y1 + c) continue
      const ra = find(i)
      const rb = find(j)
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb)
    }
  const groups = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const r = find(i)
    const g = groups.get(r)
    if (g) g.push(i)
    else groups.set(r, [i])
  }
  return [...groups.values()]
}

/**
 * Area covered by the union of some boxes — overlaps counted ONCE.
 *
 * Cluster hulls are not disjoint, and `pieces.ts` says so outright: an L-shaped
 * lockup with a small mark tucked into its corner is two visuals whose boxes
 * overlap. Summing them charges the customer twice for the same square
 * centimetres of shirt, and enough of it would push a design past a tier
 * boundary — or past the whole print area — on artwork that fits comfortably.
 *
 * Exact, by coordinate compression: with a handful of rects per side the O(n³)
 * is a few hundred comparisons, and an approximation here is money.
 */
export function unionArea(boxes: InkBox[]): number {
  if (boxes.length === 0) return 0
  if (boxes.length === 1)
    return Math.max(0, boxes[0].x1 - boxes[0].x0) * Math.max(0, boxes[0].y1 - boxes[0].y0)
  const xs = [...new Set(boxes.flatMap((b) => [b.x0, b.x1]))].sort((a, b) => a - b)
  const ys = [...new Set(boxes.flatMap((b) => [b.y0, b.y1]))].sort((a, b) => a - b)
  let sum = 0
  for (let i = 0; i + 1 < xs.length; i++) {
    const cx = (xs[i] + xs[i + 1]) / 2
    const dx = xs[i + 1] - xs[i]
    for (let j = 0; j + 1 < ys.length; j++) {
      const cy = (ys[j] + ys[j + 1]) / 2
      if (boxes.some((b) => b.x0 <= cx && cx <= b.x1 && b.y0 <= cy && cy <= b.y1))
        sum += dx * (ys[j + 1] - ys[j])
    }
  }
  return sum
}

/** Hull of several boxes. Callers guarantee at least one. */
export function hullOf(boxes: InkBox[]): InkBox {
  const out = { ...boxes[0] }
  for (const b of boxes) {
    if (b.x0 < out.x0) out.x0 = b.x0
    if (b.x1 > out.x1) out.x1 = b.x1
    if (b.y0 < out.y0) out.y0 = b.y0
    if (b.y1 > out.y1) out.y1 = b.y1
  }
  return out
}

// ---------------------------------------------------------------------------
// Probing a layer's source
// ---------------------------------------------------------------------------

/**
 * Content identity of a layer's ink shape — deliberately NOT its placement.
 * The same upload used twice, at two sizes, rotated differently, is probed once.
 * A graphic's `fill` is absent on purpose: recolouring an opaque shape does not
 * move its edges.
 *
 * Null = nothing to probe (text, which already reports its own ink).
 */
function probeKey(l: Layer): string | null {
  if (l.type === 'image') {
    const variant = l.useCutout ? 'cutout' : 'original'
    // The revision is what makes this an identity rather than a name. Re-running
    // background removal overwrites the cutout blob under the SAME asset id; a
    // key without it would crop the new cutout to the old cutout's bounds, and
    // the operator would find out at the press.
    return `img:${l.assetId}:${variant}:${assetRevision(l.assetId, variant)}`
  }
  if (l.type === 'graphic') return `gfx:${l.graphicId}`
  return null
}

/**
 * What a probe concluded. THREE states, not two, and the distinction is the
 * difference between a sliver of film and a reprint: `empty` means "these pixels
 * were read and there is no ink in them", which entitles us to drop the layer.
 * `unreadable` means "we could not look" — a canvas that would not allocate, an
 * asset tainted by another origin — and must never be mistaken for the first.
 */
type Probe =
  | { state: 'ink'; unit: UnitRect }
  | { state: 'empty' }
  | { state: 'unreadable' }

/** Only settled probes are cached; "not decoded yet" is deliberately absent. */
const unitCache = new Map<string, Probe>()

/** Alpha bounds of an already-decoded image, measured at most `PROBE_MAX_PX` wide. */
function probeImage(img: HTMLImageElement): Probe {
  const nw = img.naturalWidth
  const nh = img.naturalHeight
  if (!(nw > 0) || !(nh > 0)) return { state: 'unreadable' }
  const scale = Math.min(1, PROBE_MAX_PX / Math.max(nw, nh))
  const w = Math.max(1, Math.round(nw * scale))
  const h = Math.max(1, Math.round(nh * scale))
  try {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return { state: 'unreadable' }
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, w, h)
    const unit = alphaUnitRect(ctx.getImageData(0, 0, w, h).data, w, h)
    return unit ? { state: 'ink', unit } : { state: 'empty' }
  } catch {
    // Tainted canvas — an asset that arrived from another origin.
    return { state: 'unreadable' }
  }
}

const graphicProbeKey = (graphicId: string) => `ink-probe:${graphicId}`

/** SVG at the canonical probe size, so the answer never depends on render DPI. */
function graphicProbeSvg(graphicId: string): string | null {
  const def = graphicDef(graphicId)
  if (!def) return null
  const aspect = def.aspect > 0 ? def.aspect : 1
  const w = aspect >= 1 ? GRAPHIC_PROBE_PX : Math.max(2, Math.round(GRAPHIC_PROBE_PX * aspect))
  const h = aspect >= 1 ? Math.max(2, Math.round(GRAPHIC_PROBE_PX / aspect)) : GRAPHIC_PROBE_PX
  return withSvgSize(def.svg('#000000'), w, h)
}

/**
 * Warm the probe cache for these layers, and report the ones it could NOT
 * measure. Call it wherever the ink measurement has to be right rather than
 * merely safe — before rendering pieces, before quoting a price on a design
 * that has just loaded.
 *
 * It decodes the assets itself instead of trusting that `prepareSide` did:
 * `prepareSide` swallows a decode failure, and an image that failed to decode
 * measures as its full declared box. If that happened during the 28-DPI preview
 * and not during the 300-DPI export, the layout would reserve a padded
 * rectangle and the export would pour a tight canvas into it — `renderSheet`
 * stretches the source to fill its placement, so the artwork would print at the
 * wrong size. Hence the returned list, and hence `renderPieces` refusing on it.
 */
export async function ensureInkProbes(layers: Layer[]): Promise<{ unmeasured: Layer[] }> {
  const jobs: Promise<unknown>[] = []
  for (const l of layers) {
    const key = probeKey(l)
    if (!key || unitCache.has(key)) continue
    if (l.type === 'image')
      jobs.push(ensureAssetImage(l.assetId, l.useCutout ? 'cutout' : 'original').catch(() => null))
    if (l.type === 'graphic') {
      const svg = graphicProbeSvg(l.graphicId)
      if (svg) jobs.push(ensureRaster(graphicProbeKey(l.graphicId), svg).catch(() => null))
    }
  }
  await Promise.all(jobs)
  const unmeasured: Layer[] = []
  for (const l of layers) {
    layerInkUnit(l)
    const key = probeKey(l)
    if (!key) continue
    const hit = unitCache.get(key)
    if (!hit || hit.state === 'unreadable') unmeasured.push(l)
  }
  return { unmeasured }
}

/** Probe a layer, caching a settled answer. Undefined = could not look yet. */
function probeOf(l: Layer): Probe | undefined {
  const key = probeKey(l)
  if (!key) return undefined
  const hit = unitCache.get(key)
  if (hit) return hit

  let probe: Probe | undefined
  if (l.type === 'image') {
    const img = getCachedAssetImage(l.assetId, l.useCutout ? 'cutout' : 'original')
    // Not decoded yet: do NOT cache the miss, or the first render of a design
    // would freeze the untrimmed box in for the session.
    if (!img || !img.complete || img.naturalWidth === 0) return undefined
    probe = probeImage(img)
  } else if (l.type === 'graphic') {
    const raster = getRaster(graphicProbeKey(l.graphicId))
    if (!raster) return undefined
    probe = probeImage(raster)
  }
  if (probe) unitCache.set(key, probe)
  return probe
}

/**
 * A layer's ink as fractions of its own box, or `FULL_UNIT` when we cannot know.
 *
 * Synchronous by design: this sits under a price that is drawn on every
 * keystroke. Anything not yet decoded, unreadable, or empty reports the full box
 * — the same number the app used before this module existed — and tightens as
 * soon as `ensureInkProbes` has run.
 */
export function layerInkUnit(l: Layer): UnitRect {
  const probe = probeOf(l)
  return probe?.state === 'ink' ? probe.unit : FULL_UNIT
}

/**
 * False ONLY when a layer's source was read and found to contain no ink at all —
 * a blank upload, an all-transparent cutout. "Not decoded yet" and "could not be
 * read" are both TRUE, because the cost of being wrong is a customer's artwork
 * silently not printing and their side silently losing its marking charge.
 */
export function layerHasInk(l: Layer): boolean {
  return probeOf(l)?.state !== 'empty'
}

/** Drop everything measured. Tests and the dev harness use it; nothing else does. */
export function resetInkProbes(): void {
  unitCache.clear()
}

// ---------------------------------------------------------------------------
// Layers → boxes
// ---------------------------------------------------------------------------

/**
 * Ink box of one placed layer, inches from the print-area centre.
 *
 * Text reports its own ink through `measureLayer`, so it passes through with the
 * full unit rect; images and graphics are trimmed to what they actually draw.
 */
export function layerInkBox(l: Layer): InkBox {
  const m = measureLayer(l, 100)
  const wIn = m.w / 100
  const hIn = m.h / 100
  if (l.type === 'text') {
    // Glyph metrics, not pixels: `measureTextInk` composes the ink from the same
    // per-line measurement the renderer draws with, so a stack's leading is
    // excluded without a raster and without a way for the two to disagree.
    const ink = measureTextInk(getMeasureCtx(), l, 100)
    const unit: UnitRect = {
      x0: (ink.cx - ink.w / 2) / m.w + 0.5,
      x1: (ink.cx + ink.w / 2) / m.w + 0.5,
      y0: (ink.cy - ink.h / 2) / m.h + 0.5,
      y1: (ink.cy + ink.h / 2) / m.h + 0.5,
    }
    return placedInkBox(l, wIn, hIn, unit)
  }
  return placedInkBox(l, wIn, hIn, layerInkUnit(l), l.flipX)
}

/** The layer's declared rectangle, rotation-expanded — what this module replaced. */
export function layerDeclaredBox(l: Layer): InkBox {
  const m = measureLayer(l, 100)
  return placedInkBox(l, m.w / 100, m.h / 100, FULL_UNIT)
}

/** One entry per independent visual on a side, in inches from the area centre. */
export interface InkCluster {
  box: InkBox
  layers: Layer[]
  /** Indices into the array handed in — how a caller maps them onto graded layers. */
  idx: number[]
}

/**
 * `ink` measures what the layer draws. `box` measures the rectangle it was
 * dropped into — the behaviour every price and every gang sheet used before
 * 2026-08-13, kept for exactly the reason `MERGE_WHOLE_SIDE_IN` is kept: so the
 * saving is re-measured on every bench run against the real previous code
 * instead of quoted from a commit message.
 */
export type InkMeasure = 'ink' | 'box'

/**
 * Split a side's layers into the independent visuals they really are, measured
 * from their ink. `clearanceIn` defaults to `PIECE_CLEARANCE_IN`; pass
 * `MERGE_WHOLE_SIDE_IN` for the single block the app treated every side as
 * before splitting existed.
 *
 * Order is the order the layers arrived in; callers that need reading order sort
 * the result themselves (the DTF part numbering does).
 */
export function inkClusters(
  layers: Layer[],
  clearanceIn = PIECE_CLEARANCE_IN,
  measure: InkMeasure = 'ink',
): InkCluster[] {
  // A layer measured as carrying no ink at all contributes no footprint: an
  // empty upload used to buy a transfer the size of the box it was dropped in.
  // A layer measured as carrying no ink at all contributes no footprint, but it
  // keeps its INDEX: callers map those indices onto the graded layers.
  const keep: number[] = []
  for (let i = 0; i < layers.length; i++)
    if (measure === 'box' || layerHasInk(layers[i])) keep.push(i)
  if (keep.length === 0) return []
  const boxes = keep.map((i) =>
    measure === 'ink' ? layerInkBox(layers[i]) : layerDeclaredBox(layers[i]),
  )
  return clusterBoxes(boxes, clearanceIn).map((group) => ({
    box: hullOf(group.map((g) => boxes[g])),
    layers: group.map((g) => layers[keep[g]]),
    idx: group.map((g) => keep[g]),
  }))
}

/**
 * The independent visuals of one side, graded for `size`.
 *
 * THE PARTITION IS DECIDED IN BASE SPACE and only then scaled, so a design
 * splits into the same visuals at S as at 3XL. It matters: grading multiplies
 * every box by k while `clearanceIn` stays 0,2 in, so clustering the scaled
 * layers would let a gap that is 0,19 in at S become 0,22 in at 3XL and split
 * one transfer into two — different part count, different `~n` keys, and the
 * modal's grading comparison (which matches pieces by (baseKey, part, parts))
 * silently comparing different things. `pieces.ts` states size-invariance as an
 * invariant; this is what makes it true rather than nearly true.
 */
export function sideInkClusters(
  design: Design,
  side: Side,
  size?: SizeId,
  clearanceIn = PIECE_CLEARANCE_IN,
  measure: InkMeasure = 'ink',
): InkCluster[] {
  const base = sideLayers(design, side)
  if (base.length === 0) return []
  const k = printScaleK(design, size)
  const scaled = scaleLayers(base, k)
  return inkClusters(base, clearanceIn, measure).map((c) => ({
    box:
      k === 1
        ? c.box
        : { x0: c.box.x0 * k, x1: c.box.x1 * k, y0: c.box.y0 * k, y1: c.box.y1 * k },
    layers: c.idx.map((i) => scaled[i]),
    idx: c.idx,
  }))
}

/**
 * Printed area of a side, SQUARE CENTIMETRES — what area-aware pricing charges
 * for, and the number the PHP price authority is handed as `area_sq_cm`.
 *
 * cm² and not in², deliberately. The server has always worked in cm² and the
 * studio has always worked in in²; the conversion between them existed nowhere
 * in this repo, so wiring the bridge meant someone writing `area_sq_cm:
 * sideArtworkSqIn(...)` and dividing every print in the shop by 6,4516. A
 * full-front tee would have arrived as 192 cm² — a postcard — and priced flat
 * forever with nothing on screen looking wrong. There is now no conversion to
 * forget. (It is also the unit the customer reads everywhere else in the app;
 * quoting a French buyer a surcharge in square inches was its own bug.)
 *
 * THREE corrections over the box it replaced, all of them the customer's money:
 *
 *   THE MARGINS. It measures ink, so a logo delivered as a 2000 × 2000 PNG with
 *   the mark occupying the middle third is charged as the mark, not as the PNG.
 *   A background-removed cutout is the extreme case — its declared box is the
 *   photo it was cut out of.
 *
 *   THE GAP. It sums the INDEPENDENT VISUALS instead of unioning every layer on
 *   the side into one rectangle. A chest lockup with a line at the hem was
 *   charged as one box spanning both, i.e. mostly for the bare shirt between
 *   them — measured on the sample front, 59 % of the priced area was that empty
 *   space. It is also what the film costs, because the same split is what gets
 *   nested and pressed.
 *
 *   THE OVERHANG. It clamps the INTERSECTION with the print area, not each
 *   extent independently. Artwork dragged half off the chest was charged in
 *   full while only the part inside was ever printed; a layer dragged entirely
 *   outside was charged as a printed side while the DTF module emitted nothing
 *   for it at all.
 *
 * Returns 0 for a side with nothing printable on it — which is what makes it
 * not a printed side, in both price engines.
 */
export function sideArtworkSqCm(design: Design, side: Side, size?: SizeId): number {
  const area = getAreaSizeIn(design, side, size)
  if (!(area.wIn > 0) || !(area.hIn > 0)) return 0
  const clipped: InkBox[] = []
  for (const { box } of sideInkClusters(design, side, size)) {
    const x0 = Math.max(-area.wIn / 2, box.x0)
    const x1 = Math.min(area.wIn / 2, box.x1)
    const y0 = Math.max(-area.hIn / 2, box.y0)
    const y1 = Math.min(area.hIn / 2, box.y1)
    if (x1 > x0 && y1 > y0) clipped.push({ x0, x1, y0, y1 })
  }
  // UNION, not sum: two visuals' boxes may legitimately overlap, and charging
  // the overlap twice both overstates the bill and lets a design that fits the
  // chest measure larger than the whole print area.
  return unionArea(clipped) * CM_PER_IN * CM_PER_IN
}

// ---------------------------------------------------------------------------
// Boxes → the transfers a side is actually printed as
//
// This lived in `src/lib/dtf/pieces.ts` until session 05. It moved here for the
// same reason `PIECE_CLEARANCE_IN` did before it: the cost engine has to know
// how much film an order needs, `src/lib/dtf/**` is admin-only and unreachable
// from the customer bundle (src/app/adminBoundary.test.ts enforces it), and a
// second copy of "what rectangle does this visual print as" in the customer
// path would be a second answer. `pieces.ts` now calls this and adds the pixels.
// ---------------------------------------------------------------------------

/**
 * Below this (inches) a transfer is too thin to be represented. It is a FLOOR,
 * not a filter: the box is grown to it. A 0,4 mm hairline rule is real artwork,
 * and dropping it — which is what the old rule did — would delete a customer's
 * design element with no error anywhere.
 *
 * 0,08 in = 2,0 mm, which is 2 px at `PREVIEW_DPI` (28), the lowest density
 * anything renders at. That is not a coincidence: `canvas.width` is
 * `max(2, round(wIn × dpi))`, so a rect under 2 px would be drawn into a canvas
 * bigger than itself, and `renderSheet` stretches a piece's canvas to fill its
 * placement — the cutting plan would show a hairline 40 % too fat. At this floor
 * `round(wIn × dpi) ≥ 2` holds by construction at every DPI in use.
 */
export const MIN_EXTENT_IN = 0.08

/**
 * Slack added around every trimmed visual, inches. 0,02 in = 0,5 mm.
 *
 * Under declared boxes the crop always had margin to spare, so the roundings
 * downstream were free. They are not any more: the crop is tangent to the ink,
 * and `canvas.width = round(wIn × dpi)` can round DOWN half a pixel — 0,45 mm at
 * 28 DPI — straight off the outermost glyph edge. This is DPI-independent (it
 * has to be; the geometry is shared between the 28-DPI preview and the 300-DPI
 * export), it covers that half pixel five times over, and against a 5 mm nesting
 * gap it costs nothing worth measuring.
 */
export const TRIM_BLEED_IN = 0.02

export interface PieceSplitOptions {
  /**
   * Merge distance, inches. Defaults to `PIECE_CLEARANCE_IN`; pass
   * `MERGE_WHOLE_SIDE_IN` for one transfer per side. There is deliberately no
   * minimum piece size, because merging a small item into a distant neighbour
   * means buying the empty film between them, which is the exact waste
   * splitting exists to remove.
   */
  clearanceIn?: number
  /**
   * `'box'` measures every visual from its declared rectangle instead of its
   * ink — the pre-2026-08-13 geometry. Not an operator setting: it exists so
   * `scripts/dtf-bench.mjs` can put both against each other on the same order
   * and report what the trim is actually worth.
   */
  measureFrom?: InkMeasure
}

/**
 * Grow a span to at least `MIN_EXTENT_IN` without leaving `[0, limit]`, then
 * report it. Symmetric where there is room, pushed inward at an edge.
 */
function atLeastMin(lo: number, hi: number, limit: number): [number, number] {
  const need = Math.min(MIN_EXTENT_IN, limit)
  if (hi - lo >= need) return [lo, hi]
  const grow = (need - (hi - lo)) / 2
  let a = lo - grow
  let b = hi + grow
  if (a < 0) {
    b -= a
    a = 0
  }
  if (b > limit) {
    a -= b - limit
    b = limit
  }
  return [Math.max(0, a), Math.min(limit, b)]
}

/**
 * Clamp an item's ink extent to the print area, in top-left-origin inches.
 * Null only when nothing of it lands inside the area at all.
 *
 * A span thinner than `MIN_EXTENT_IN` is GROWN to it rather than discarded. The
 * old rule dropped the whole cluster, which was survivable while the box was a
 * layer's declared rectangle (always at least as big as the artwork) and is not
 * survivable now that it is the ink: a 0,4 mm rule under a wordmark measures
 * 0,4 mm tall, and dropping it would remove it from the print in silence.
 */
export function clampInkToArea(b: InkBox, area: SizeIn): RectIn | null {
  const x0 = Math.max(-area.wIn / 2, b.x0 - TRIM_BLEED_IN)
  const x1 = Math.min(area.wIn / 2, b.x1 + TRIM_BLEED_IN)
  const y0 = Math.max(-area.hIn / 2, b.y0 - TRIM_BLEED_IN)
  const y1 = Math.min(area.hIn / 2, b.y1 + TRIM_BLEED_IN)
  if (x1 <= x0 || y1 <= y0) return null
  const [ax0, ax1] = atLeastMin(x0 + area.wIn / 2, x1 + area.wIn / 2, area.wIn)
  const [ay0, ay1] = atLeastMin(y0 + area.hIn / 2, y1 + area.hIn / 2, area.hIn)
  if (ax1 - ax0 <= 0 || ay1 - ay0 <= 0) return null
  return { xIn: ax0, yIn: ay0, wIn: ax1 - ax0, hIn: ay1 - ay0 }
}

/** One transfer of a side: where it sits in the print area, and what it carries. */
export interface InkPart {
  /** Crop rect within the (graded) print area, top-left origin, inches. */
  rect: RectIn
  /** The GRADED layers this transfer carries — nothing else is drawn into it. */
  layers: Layer[]
}

/**
 * Split one side into the transfers it should be printed as, in part order
 * (top to bottom, then left to right — the order the DTF suffix counts in, and
 * the order an operator reads the garment in).
 *
 * Empty when the side carries no layers, or when the garment publishes no print
 * area for it. That second case is a REFUSAL, not a default: `getAreaSizeIn`
 * returns a zero area when it has nothing to derive one from (a custom
 * garment's sleeve), and inventing a transfer size there is how a dimension
 * nobody measured reaches a printer.
 *
 * Text measurement depends on loaded fonts — call after the fonts and the ink
 * probes have settled (`renderPieces` and `measureOrder` both do) for numbers
 * that match the export.
 */
export function sideInkParts(
  design: Design,
  side: Side,
  size?: SizeId,
  opts?: PieceSplitOptions,
): InkPart[] {
  const area = getAreaSizeIn(design, side, size)
  if (!(area.wIn > 0) || !(area.hIn > 0)) return []
  const clearance = opts?.clearanceIn ?? PIECE_CLEARANCE_IN
  const seen: { rect: RectIn; layers: Layer[]; seq: number }[] = []
  const clusters = sideInkClusters(design, side, size, clearance, opts?.measureFrom ?? 'ink')
  for (let i = 0; i < clusters.length; i++) {
    const rect = clampInkToArea(clusters[i].box, area)
    if (rect) seen.push({ rect, layers: clusters[i].layers, seq: i })
  }
  // Total order: reading order, with the cluster's first-layer position as the
  // final tiebreak, so the part suffix of a given item never moves between two
  // renders of the same design.
  seen.sort((a, b) => a.rect.yIn - b.rect.yIn || a.rect.xIn - b.rect.xIn || a.seq - b.seq)
  return seen.map(({ rect, layers: ls }) => ({ rect, layers: ls }))
}

/** Where a transfer goes on the garment, in the numbers a press is set up from. */
export interface PiecePlacementCm {
  /** Drop from the TOP of the print area to the top of the transfer. */
  topCm: number
  /** Signed offset of the transfer's centre from the area's centre line (+ = right). */
  centerDxCm: number
  /** Distance from the area's left edge, for anyone squaring off the edge instead. */
  leftCm: number
  areaWCm: number
  areaHCm: number
}

/** The only geometry `piecePlacementCm` reads. `RenderedPiece` satisfies it. */
export interface PiecePlacedIn {
  /** The transfer's box inside the (graded) print area, top-left origin, inches. */
  areaRectIn: RectIn
  /** The (graded) print area those coordinates are relative to, inches. */
  areaWIn: number
  areaHIn: number
}

/**
 * `areaRectIn` in press terms. The top of the print area is a fixed drop below
 * the collar (see printDropBelowCollarIn) and the centre line is the garment's
 * fold, so these two numbers place a transfer with a ruler and nothing else.
 *
 * It takes the geometry rather than a `RenderedPiece` so that the two things
 * that must agree can both call it: the DTF export, which has pixels, and the
 * design document, which has none. The bon a tirer states these numbers to the
 * customer and the workshop presses to them; two implementations of that is one
 * reprint nobody can be billed for.
 */
export function piecePlacementCm(p: PiecePlacedIn): PiecePlacementCm {
  return {
    topCm: p.areaRectIn.yIn * CM_PER_IN,
    centerDxCm: (p.areaRectIn.xIn + p.areaRectIn.wIn / 2 - p.areaWIn / 2) * CM_PER_IN,
    leftCm: p.areaRectIn.xIn * CM_PER_IN,
    areaWCm: p.areaWIn * CM_PER_IN,
    areaHCm: p.areaHIn * CM_PER_IN,
  }
}

/**
 * One transfer's footprint on the film, centimetres, and where it goes.
 *
 * The last two are the proof's, not the packer's: a gang sheet does not care
 * where on a shirt a rectangle lands, and a customer approving a bon a tirer
 * cares about nothing else. They ride here because they are measured from the
 * SAME rect at the SAME moment, and measuring them anywhere else would be a
 * second answer to "where is this print".
 */
export interface PieceCm {
  w_cm: number
  h_cm: number
  /** Top edge of the transfer below the top edge of the print area, cm. */
  top_cm: number
  /** Its centre, signed, from the print area's centre line, cm. + is to the right. */
  center_dx_cm: number
}

/**
 * The transfers a side needs, as the two numbers a gang sheet is packed from.
 *
 * THIS IS THE ORDER'S FILM GEOMETRY and it is why it exists: the WordPress cost
 * engine has to ask the nesting engine how many linear metres an order takes,
 * and a length is a packing of rectangles, never an area divided by a width.
 * The rectangles are these. They are measured in the browser, at the priced
 * size, once, and stored with the design (src/lib/teeshoop/designDoc.ts), so
 * the film cost and the customer's printed-area price are computed from one
 * measurement rather than two.
 *
 * Centimetres, and rounded to 0,01 cm: the same unit the nester and the DTF
 * suppliers work in, with no conversion left anywhere for anyone to forget.
 * Rounding at the source rather than at each reader is what keeps the number in
 * the design document byte-identical to the number that gets packed.
 */
export function sidePiecesCm(design: Design, side: Side, size?: SizeId): PieceCm[] {
  const round2 = (v: number) => Math.round(v * 100) / 100
  const area = getAreaSizeIn(design, side, size)
  return sideInkParts(design, side, size).map((p) => {
    const place = piecePlacementCm({ areaRectIn: p.rect, areaWIn: area.wIn, areaHIn: area.hIn })
    return {
      w_cm: round2(p.rect.wIn * CM_PER_IN),
      h_cm: round2(p.rect.hIn * CM_PER_IN),
      top_cm: round2(place.topCm),
      center_dx_cm: round2(place.centerDxCm),
    }
  })
}

/** The (graded) print area a side's transfers are placed inside, cm. */
export function sideAreaCm(design: Design, side: Side, size?: SizeId): { w_cm: number; h_cm: number } {
  const round2 = (v: number) => Math.round(v * 100) / 100
  const area = getAreaSizeIn(design, side, size)
  return { w_cm: round2(area.wIn * CM_PER_IN), h_cm: round2(area.hIn * CM_PER_IN) }
}
