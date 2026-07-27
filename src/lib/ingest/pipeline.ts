/**
 * INGEST — photo normalization, automatic print-area suggestion, and back
 * reconstruction when the supplier publishes no back view.
 *
 * Dependency-free canvas math: everything works on downscaled ImageData
 * scans, mirroring the alpha-bbox conventions of src/lib/custom.ts so the
 * resulting ProductSideDef maps 1:1 onto the custom-garment pipeline.
 *
 * Deterministic throughout — same pixels in, same pixels out — so a generated
 * back can be verified by a headless run and re-generating never quietly
 * changes a product. Timestamps are parameters, never read from the clock.
 */
import { addAsset, getAssetBlob, removeAsset, setAssetCutout } from '@/state/assets'
import { isBgRemovalSupported, removeBackground } from '@/lib/bgremove'
import {
  defaultCustomPrintArea,
  getCustomSideInfo,
  invalidateCustomBBox,
} from '@/lib/custom'
import { invalidateGarmentAnatomy } from '@/lib/garmentAnatomy'
import type { CustomSideSetup, RectIn } from '@/lib/types'
import { clamp, cmToIn } from '@/lib/units'
import type { SizeId, SizeSpecCm } from '@/content/sizeChart'
import { SIZE_IDS } from '@/content/sizeChart'
import type { GeneratedSideInfo, ProductSideDef } from './types'

// ---------------------------------------------------------------------------
// Quality gates (tuned for laid-flat garment product shots)
// ---------------------------------------------------------------------------

/** Reject photos whose garment covers less than this fraction of the frame. */
const MIN_ALPHA_COVERAGE = 0.03
/** Garment bbox aspect (w/h) must land in this window to look like apparel. */
const MIN_ASPECT = 0.5
const MAX_ASPECT = 2.2
/** Same watchdog CustomSetupModal uses — never wedge on a stuck removal. */
const BG_TIMEOUT_MS = 90_000
/** A source with at least this fraction of transparent pixels is pre-cut. */
const PRECUT_TRANSPARENT_FRAC = 0.05

export type IngestPhotoErrorCode =
  | 'decode_failed'
  | 'cutout_failed'
  | 'low_coverage'
  | 'bad_aspect'

/** Typed rejection so the UI can explain exactly why a photo was refused. */
export class IngestPhotoError extends Error {
  readonly code: IngestPhotoErrorCode
  constructor(code: IngestPhotoErrorCode) {
    super(`Garment photo rejected: ${code}`)
    this.name = 'IngestPhotoError'
    this.code = code
  }
}

export interface NormalizedPhoto {
  /** Asset library id (original + cutout variants stored). */
  assetId: string
  /** Alpha-bbox width / height of the garment. */
  bboxAspect: number
  /** True when a cutout variant exists (ProductSideDef.useCutout should match). */
  hasCutout: boolean
}

// ---------------------------------------------------------------------------
// Small canvas scanners
// ---------------------------------------------------------------------------

interface AlphaScan {
  /** Bbox in SOURCE pixels (same rounding idiom as src/lib/custom.ts). */
  bbox: { x: number; y: number; w: number; h: number }
  /** Fraction of image pixels with alpha > 16. */
  coverage: number
  /** Fraction of image pixels with alpha < 240 (any real transparency). */
  transparentFrac: number
}

async function decodeToImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new IngestPhotoError('decode_failed'))
      img.src = url
    })
    if (!img.naturalWidth || !img.naturalHeight)
      throw new IngestPhotoError('decode_failed')
    return img
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

/** Downscaled (≤256px) alpha scan: bbox + coverage stats in source coords. */
function scanAlpha(img: HTMLImageElement): AlphaScan {
  const SCAN = 256
  const scale = Math.min(1, SCAN / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  let opaque = 0
  let transparent = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3]
      if (a < 240) transparent++
      if (a > 16) {
        opaque++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  const total = w * h
  if (maxX < 0) {
    return {
      bbox: { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight },
      coverage: 0,
      transparentFrac: transparent / total,
    }
  }
  const inv = 1 / scale
  return {
    bbox: {
      x: Math.floor(minX * inv),
      y: Math.floor(minY * inv),
      w: Math.ceil((maxX - minX + 1) * inv),
      h: Math.ceil((maxY - minY + 1) * inv),
    },
    coverage: opaque / total,
    transparentFrac: transparent / total,
  }
}

// ---------------------------------------------------------------------------
// normalizeGarmentPhoto
// ---------------------------------------------------------------------------

/**
 * Ingest one garment photo: store it in the asset library, cut out the
 * background, and run the quality gates.
 *
 *  - Sources that ALREADY carry transparency (supplier PNG cutouts, e.g. from
 *    WooCommerce/Printful media) skip the U²-Net pass — the original is
 *    reused as its own cutout.
 *  - When bg removal is unsupported by the browser, the photo is accepted
 *    without a cutout (hasCutout=false, full-image bbox) so admins on odd
 *    browsers are not locked out; when it is supported but FAILS, the photo
 *    is rejected (`cutout_failed`) — ingest is an admin flow and silently
 *    keeping the backdrop would poison the 2D/3D/AR previews.
 *  - Rejected photos are removed from the asset library again.
 *
 * Throws IngestPhotoError on rejection.
 */
export async function normalizeGarmentPhoto(
  file: Blob,
  opts?: {
    /** Asset display name (defaults to a File's name when available). */
    name?: string
    onProgress?: (stage: 'store' | 'cutout' | 'measure') => void
  },
): Promise<NormalizedPhoto> {
  opts?.onProgress?.('store')
  const name =
    opts?.name ?? (file instanceof File ? file.name : 'Garment photo')
  let meta
  try {
    meta = await addAsset(file, name)
  } catch {
    throw new IngestPhotoError('decode_failed')
  }

  const reject = async (code: IngestPhotoErrorCode): Promise<never> => {
    await removeAsset(meta.id).catch(() => undefined)
    throw new IngestPhotoError(code)
  }

  try {
    // Scan the STORED original (post-downscale) — that is what renders later.
    const stored = (await getAssetBlob(meta.id)) ?? file
    const originalScan = scanAlpha(await decodeToImage(stored))

    let hasCutout = false
    let scan = originalScan
    if (originalScan.transparentFrac >= PRECUT_TRANSPARENT_FRAC) {
      // Pre-cut source: reuse it as its own cutout (alpha-bbox semantics).
      await setAssetCutout(meta.id, stored)
      hasCutout = true
    } else if (isBgRemovalSupported()) {
      opts?.onProgress?.('cutout')
      let cut: Blob
      try {
        cut = await Promise.race([
          removeBackground(stored),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error('timeout')), BG_TIMEOUT_MS),
          ),
        ])
      } catch {
        return reject('cutout_failed')
      }
      await setAssetCutout(meta.id, cut)
      hasCutout = true
      opts?.onProgress?.('measure')
      scan = scanAlpha(await decodeToImage(cut))
    }
    invalidateCustomBBox(meta.id)
    invalidateGarmentAnatomy(meta.id)

    if (hasCutout && scan.coverage < MIN_ALPHA_COVERAGE)
      return reject('low_coverage')
    const aspect = scan.bbox.w / Math.max(1, scan.bbox.h)
    if (aspect < MIN_ASPECT || aspect > MAX_ASPECT) return reject('bad_aspect')

    return { assetId: meta.id, bboxAspect: aspect, hasCutout }
  } catch (err) {
    if (err instanceof IngestPhotoError && err.code !== 'decode_failed')
      throw err
    return reject(err instanceof IngestPhotoError ? err.code : 'decode_failed')
  }
}

// ---------------------------------------------------------------------------
// autoPrintArea — collar detection + industry-standard placement
// ---------------------------------------------------------------------------

/** Standard DTG/transfer placement constants, cm (customer-facing unit). */
const DROP_BELOW_COLLAR_CM = { front: 7.5, back: 10 } as const
const MAX_PRINT_W_CM = 30.5 // 12″ platen width
const MAX_PRINT_H_CM = 40.6 // 16″ platen height

/**
 * Suggest a print area for a normalized garment photo.
 *
 * Collar line = topmost bbox row. The neck dip is found by scanning the top
 * 25% of bbox rows around the horizontal centre (±12% of bbox width) for the
 * transparent notch a collar cuts into the alpha: the dip is the last such
 * row before the centre goes solid. Fully opaque tops (crew photographed
 * collar-up, or no cutout) keep the bbox top — that is the conservative
 * fallback, flagged unconfident.
 *
 * Placement: top edge `7.5 cm` (front) / `10 cm` (back) below the collar,
 * width = min(30.5 cm, 62% of garment width), height = min(40.6 cm, 55% of
 * garment height), horizontally centred. Unconfident detection falls back to
 * defaultCustomPrintArea (same defaults the manual custom flow uses).
 *
 * @param assetImage decoded photo (original or cutout — whatever `useCutout`
 *   will render)
 * @param bbox garment alpha-bbox in source pixels
 * @param halfChestCm laid-flat pit-to-pit width of the authored size
 * @returns RectIn in inches relative to the bbox top-left
 */
export function autoPrintArea(
  assetImage: HTMLImageElement | HTMLCanvasElement,
  bbox: { x: number; y: number; w: number; h: number },
  halfChestCm: number,
  side: 'front' | 'back',
): RectIn {
  const widthIn = cmToIn(halfChestCm)
  const pxPerInch = bbox.w / widthIn
  const heightIn = bbox.h / pxPerInch

  // --- neck-dip scan on a downscaled crop of the bbox ---------------------
  let collarYIn = 0
  let confident = false
  try {
    const SCAN_W = 128
    const scale = SCAN_W / bbox.w
    const w = SCAN_W
    const h = Math.max(1, Math.round(bbox.h * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(assetImage, bbox.x, bbox.y, bbox.w, bbox.h, 0, 0, w, h)
    const data = ctx.getImageData(0, 0, w, h).data

    const winHalf = Math.max(2, Math.round(w * 0.12))
    const x0 = Math.floor(w / 2 - winHalf)
    const x1 = Math.ceil(w / 2 + winHalf)
    const rows = Math.max(2, Math.floor(h * 0.25))
    let dipRow = -1
    for (let y = 0; y < rows; y++) {
      let opaque = 0
      for (let x = x0; x < x1; x++) {
        if (data[(y * w + x) * 4 + 3] > 16) opaque++
      }
      const frac = opaque / (x1 - x0)
      if (frac < 0.45) {
        dipRow = y // still inside the collar notch
      } else if (dipRow >= 0) {
        break // notch just closed — dipRow is the dip bottom
      }
    }
    if (dipRow >= 1) {
      collarYIn = (dipRow + 1) / scale / pxPerInch
      confident = true
    }
  } catch {
    confident = false
  }

  // A dip deeper than 20% of the garment reads as a scan artefact, not a
  // collar — distrust it.
  if (collarYIn > heightIn * 0.2) confident = false

  const wIn = Math.min(cmToIn(MAX_PRINT_W_CM), widthIn * 0.62)
  const hIn = Math.min(cmToIn(MAX_PRINT_H_CM), heightIn * 0.55)
  if (!confident) {
    // Same defaults the manual custom-garment flow starts from.
    return defaultCustomPrintArea(widthIn, heightIn)
  }
  const yIn = clamp(
    collarYIn + cmToIn(DROP_BELOW_COLLAR_CM[side]),
    0,
    Math.max(0, heightIn - hIn),
  )
  return { xIn: (widthIn - wIn) / 2, yIn, wIn, hIn }
}

// ---------------------------------------------------------------------------
// generateBackFromFront — reconstruct a back view when none was published
// ---------------------------------------------------------------------------

/**
 * WHY this exists: a garment with no back photo is not a small cosmetic gap.
 * The 3D preview paints a flat slab, the AR model is walkable and shows the
 * customer a bare undershirt from behind, and the Back tab is dead — so the
 * product is silently half-sellable. Some suppliers simply never publish a
 * back view in any colourway, so the choice is between reconstructing one and
 * dropping saleable references.
 *
 * WHAT it does, and what it deliberately does NOT do: mirror the front's
 * silhouette, flood it with the garment's colour, and modulate it by the
 * front's own LOW-FREQUENCY shading so the folds, the hem shadow and the
 * sleeve break survive. It never copies front detail: any printed artwork,
 * logo or label is high-frequency and is destroyed by the σ = 4.5 % blur. The
 * result is therefore provably print-free, obviously a reconstruction, and
 * stamped `origin: 'generated'` end to end.
 *
 * The mirror is honest for the garments that need it (centred plackets, crew
 * bodies) and wrong for asymmetric ones — which is what `symmetry` measures,
 * so the admin UI can escalate rather than the algorithm pretending.
 */

/** Blur σ as a fraction of garment width: wide enough to erase a chest print. */
const SHADE_SIGMA_FRAC = 0.045
/** Below this the blur grid stops shrinking — the field is low-frequency. */
const SHADE_GRID_PX = 512
/** γ < 1 compresses shading so a hard studio shadow does not read as a crease. */
const SHADE_GAMMA = 0.85
/** Clamp: a blown highlight or a backdrop bleed must not punch a hole. */
const SHADE_MIN = 0.62
const SHADE_MAX = 1.3
/** Shading quantisation (0.0027 per step over the clamp range — invisible). */
const SHADE_STEPS = 256
/** Transparent margin, fraction of the long edge. Guarantees the generated PNG
 *  reads as "pre-cut" (transparentFrac ≥ 5 %) whatever the garment's shape,
 *  and never moves the alpha bbox the print area is measured against. */
const GEN_PAD_FRAC = 0.02
/**
 * Coarse perceptual distance (Riemersma's "redmean") above which the supplier
 * swatch is distrusted in favour of the colour actually measured in the photo.
 * The swatch is a flat catalogue chip, not a measurement of the shot; when the
 * two disagree the customer is looking at the photo, so the photo wins.
 */
const SWATCH_MAX_DIST = 60

export interface GeneratedBack {
  /** PNG with real alpha — takes normalizeGarmentPhoto's pre-cut fast path. */
  blob: Blob
  /** sRGB hex actually flooded into the silhouette. */
  colorHex: string
  colorSource: 'supplier-swatch' | 'sampled'
  /** Mirror-symmetry confidence of the source, 0..1 (see GeneratedSideInfo). */
  symmetry: number
  /** Garment height in inches — the caller needs it to clamp the print area. */
  heightIn: number
  /** What the centred-placket scan measured (and whether it acted). */
  placket: PlacketFinding
}

const srgbToLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
const linearToSrgb = (c: number) =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
/** sRGB byte → linear light. Table, not pow(): this runs on every pixel. */
const SRGB_LIN = (() => {
  const t = new Float32Array(256)
  for (let i = 0; i < 256; i++) t[i] = srgbToLinear(i / 255)
  return t
})()
const relLuminance = (r: number, g: number, b: number) =>
  0.2126 * SRGB_LIN[r] + 0.7152 * SRGB_LIN[g] + 0.0722 * SRGB_LIN[b]

const hex2 = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')
const toHex = (rgb: [number, number, number]) =>
  `#${hex2(rgb[0])}${hex2(rgb[1])}${hex2(rgb[2])}`

/** Riemersma's low-cost perceptual RGB distance (0 … ~765). */
function redmean(a: [number, number, number], b: [number, number, number]): number {
  const rm = (a[0] + b[0]) / 2
  const dr = a[0] - b[0]
  const dg = a[1] - b[1]
  const db = a[2] - b[2]
  return Math.sqrt(
    (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db,
  )
}

/** One separable box pass with clamped edges (running sum, O(n)). */
function boxPass(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const norm = 1 / (2 * r + 1)
  const at = (o: number, i: number, n: number) => src[o + (i < 0 ? 0 : i > n ? n : i)]
  for (let y = 0; y < h; y++) {
    const o = y * w
    let sum = 0
    for (let k = -r; k <= r; k++) sum += at(o, k, w - 1)
    for (let x = 0; x < w; x++) {
      dst[o + x] = sum * norm
      sum += at(o, x + r + 1, w - 1) - at(o, x - r, w - 1)
    }
  }
}

/** Transpose so the vertical pass reuses boxPass (cache-friendly, tiny grids). */
function transpose(src: Float32Array, dst: Float32Array, w: number, h: number) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) dst[x * h + y] = src[y * w + x]
}

/**
 * PLACKET SUPPRESSION — why the low-pass alone is not the guarantee.
 *
 * A polo FRONT carries a button placket down the centre; a polo BACK does not.
 * A back that shows one is not a back, it is a lie a customer notices.
 *
 * Measured (real supplier photos, through this pipeline): a SELF-COLOURED
 * placket is already erased outright. Centred-column residual over the chest
 * band, in luminance — 202358 front 0.0021 → generated 0.0012; 202359 0.0048 →
 * 0.0016; the two kids' polos 0.0026/0.0017 → 0.0009/0.0017; and 171722, a
 * white polo with three BLACK buttons, 0.0213 → 0.0007. The supplier's own
 * back photos sit at 0.0005-0.0011, so those reconstructions are already
 * indistinguishable from ground truth.
 *
 * A CONTRAST placket is NOT erased. Painting a navy strip 6 % of the garment
 * width down the same 202358 photo leaves 0.0367 in the reconstruction — 30×
 * the noise floor, and a plainly visible grey stripe down the middle of the
 * "back". Contrast plackets are ordinary catalogue products, so the blur width
 * cannot be what the guarantee rests on.
 *
 * Hence this pass: on the cell grid, BEFORE the blur (a smear is far harder to
 * remove than the feature that made it), a centred vertical band consistently
 * darker or lighter than the fabric beside it is replaced by a linear
 * interpolation across it. Same navy strip, with the pass: 0.0367 → 0.0016,
 * back at the noise floor. It generalises past plackets by construction — a
 * hoodie's zip and drawstrings are the same shape of lie — and it is
 * deliberately narrow-minded, only ever touching a bounded band around the
 * centre column, so when nothing is detected the grid is not written at all
 * and the output is byte-identical to the low-pass-only version. That is the
 * case for all four Imbretex polos.
 */

/**
 * Rows scanned, as a fraction of garment height. Starts BELOW the collar: a
 * polo back has a collar and the neck opening must survive, and it is the only
 * centred feature that could otherwise be mistaken for the top of a placket.
 * Ends where a placket ends — a real one never reaches the hem.
 */
const PLACKET_BAND = { top: 0.12, bottom: 0.55 } as const
/**
 * Widest half-band that can be a placket, fraction of garment width. Anything
 * broader is body shading (or a colour-blocked panel) and must be left alone —
 * flattening it would erase the drape this reconstruction exists to keep.
 */
const PLACKET_MAX_HALF_FRAC = 0.09
/**
 * Minimum deviation from the fabric beside it, RELATIVE to that fabric's
 * luminance (relative, not absolute, so a black garment gets the same
 * sensitivity as a white one). A navy strip painted on the white 202358 scores
 * 0.97 and a red one 0.83; the real fronts in the catalogue cluster at 0.03.
 */
const PLACKET_MIN_CONTRAST = 0.18
/**
 * Fraction of scanned rows that must carry the band — and the gate that
 * actually does the discriminating, because a soft centre fold shadow can
 * reach the contrast threshold on its own (202358 measures 0.22). A trim runs
 * the whole chest; a fold, a neck label or three buttons do not.
 *
 * Swept over all 46 catalogue fronts: exactly three clear BOTH gates —
 * 145172, 180713 and 75196, i.e. the zip and drawstring lines of hooded
 * sweats, which are front-only features for the same reason a placket is. The
 * four polos this exists for sit at 0.02-0.23 row coverage and are left
 * untouched, byte for byte. The closest miss is 202357 at 0.57 (a black polo
 * whose placket line the scan can just see) — and flattening that would have
 * been right too, so the margin is one-sided.
 */
const PLACKET_MIN_ROWS = 0.6

/** What the centred-placket scan found, reported whether or not it acted. */
export interface PlacketFinding {
  /** True when the grid was actually flattened. */
  suppressed: boolean
  /** Median relative deviation at the centre column over the scanned rows. */
  contrast: number
  /** Median band width as a fraction of garment width (0 when there is none). */
  widthFrac: number
  /** Fraction of scanned rows carrying a band above the contrast threshold. */
  rowsFrac: number
}

/**
 * Find a centred vertical band in the cell grid and flatten it. `sumL` is
 * MUTATED only when one is found; the finding is returned either way so a
 * verification run can read the measurement and not just the verdict.
 *
 * Works on the alpha-weighted sums the shading field is built from: cell mean
 * = sumL/sumA, and writing back `mean × sumA` keeps partially covered cells
 * weighted exactly as before.
 */
function suppressCentrePlacket(
  sumL: Float32Array,
  sumA: Float32Array,
  cells: Float32Array,
  bw: number,
  bh: number,
): PlacketFinding {
  const none: PlacketFinding = {
    suppressed: false,
    contrast: 0,
    widthFrac: 0,
    rowsFrac: 0,
  }
  const cx = Math.round((bw - 1) / 2)
  const maxHalf = Math.max(2, Math.round(PLACKET_MAX_HALF_FRAC * bw))
  // The fabric level is read from a ring beside the centre: far enough out to
  // clear the widest band we would act on, close enough to stay on the body
  // rather than on a sleeve.
  const sideIn = Math.max(maxHalf + 1, Math.round(0.11 * bw))
  const sideOut = Math.round(0.32 * bw)
  if (sideOut <= sideIn) return none
  // Only fully covered cells: an edge cell averages in transparent area and
  // would read as a dark band exactly where the neckline narrows.
  const solid = (k: number) => cells[k] > 0 && sumA[k] >= 0.98 * cells[k]

  interface Row {
    row: number
    x0: number
    x1: number
    rel: number
    left: number
    right: number
  }
  const rows: Row[] = []
  let scanned = 0
  for (let y = Math.round(PLACKET_BAND.top * bh); y < Math.round(PLACKET_BAND.bottom * bh); y++) {
    const row = y * bw
    const mean = (x: number) => sumL[row + x] / sumA[row + x]
    let acc = 0
    let n = 0
    for (let d = sideIn; d <= sideOut; d++) {
      for (const x of [cx - d, cx + d]) {
        if (x < 0 || x >= bw || !solid(row + x)) continue
        acc += mean(x)
        n++
      }
    }
    if (n < 4) continue
    const base = acc / n
    if (!(base > 0)) continue
    scanned++
    // Anchor on the strongest deviation within ±2 cells of centre: a placket is
    // stitched on the centre line but the photo need not be pixel-centred.
    let peak = -1
    let peakD = 0
    for (let x = Math.max(0, cx - 2); x <= Math.min(bw - 1, cx + 2); x++) {
      if (!solid(row + x)) continue
      const d = mean(x) - base
      if (Math.abs(d) > Math.abs(peakD)) {
        peakD = d
        peak = x
      }
    }
    if (peak < 0 || peakD === 0) continue
    // Grow while the deviation keeps its sign and at least half its strength.
    const half = 0.5 * Math.abs(peakD)
    const sign = Math.sign(peakD)
    const grows = (x: number) =>
      x >= cx - maxHalf &&
      x <= cx + maxHalf &&
      x >= 0 &&
      x < bw &&
      solid(row + x) &&
      Math.sign(mean(x) - base) === sign &&
      Math.abs(mean(x) - base) >= half
    let x0 = peak
    let x1 = peak
    while (grows(x0 - 1)) x0--
    while (grows(x1 + 1)) x1++
    // Clipped against the cap ⇒ this is not a bounded trim but broad shading.
    if (x0 <= cx - maxHalf || x1 >= cx + maxHalf) continue
    rows.push({
      row,
      x0,
      x1,
      rel: Math.abs(peakD) / base,
      left: solid(row + x0 - 1) ? mean(x0 - 1) : base,
      right: solid(row + x1 + 1) ? mean(x1 + 1) : base,
    })
  }
  if (!scanned || !rows.length) return none

  const median = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b)
    return s[s.length >> 1]
  }
  const strong = rows.filter((r) => r.rel >= PLACKET_MIN_CONTRAST)
  const finding: PlacketFinding = {
    suppressed: false,
    contrast: median(rows.map((r) => r.rel)),
    widthFrac: strong.length ? median(strong.map((r) => (r.x1 - r.x0 + 1) / bw)) : 0,
    rowsFrac: strong.length / scanned,
  }
  if (finding.rowsFrac < PLACKET_MIN_ROWS) return finding

  // Hysteresis: once the product IS a placket product, flatten every row that
  // carries the band at half strength too, or the faint top and bottom ends
  // survive as two smudges where the strong middle used to be.
  const floor = 0.5 * PLACKET_MIN_CONTRAST
  for (const r of rows) {
    if (r.rel < floor) continue
    const span = r.x1 - r.x0 + 2
    for (let x = r.x0; x <= r.x1; x++) {
      const t = (x - r.x0 + 1) / span
      sumL[r.row + x] = (r.left * (1 - t) + r.right * t) * sumA[r.row + x]
    }
  }
  finding.suppressed = true
  return finding
}

/**
 * Three box passes ≈ a Gaussian of σ ≈ r (σ_total = √(w²−1)/2 for w = 2r+1).
 * Mutates `a` in place, using the transpose so one horizontal kernel serves
 * both directions.
 */
function blur3(a: Float32Array, w: number, h: number, r: number): Float32Array {
  const t = new Float32Array(a.length)
  for (let pass = 0; pass < 3; pass++) {
    boxPass(a, t, w, h, r)
    transpose(t, a, w, h)
    boxPass(a, t, h, w, r)
    transpose(t, a, h, w)
  }
  return a
}

/**
 * Reconstruct a back view from a front side. See the section header for the
 * rationale; the algorithm is deterministic — same photo + same colour in,
 * byte-identical PNG out.
 *
 * @param front  the front side; MUST render from a cutout (there is no
 *   silhouette to mirror otherwise) — `IngestPhotoError('cutout_failed')`.
 * @param widthIn garment laid-flat width in inches (bbox width = this).
 */
export async function generateBackFromFront(
  front: CustomSideSetup,
  widthIn: number,
  opts: { colorRgb?: [number, number, number] | null; watermark?: boolean } = {},
): Promise<GeneratedBack> {
  if (!front.useCutout) throw new IngestPhotoError('cutout_failed')
  const { img, bbox, pxPerInch } = await getCustomSideInfo(front, widthIn)
  const W = bbox.w
  const H = bbox.h
  const crop = document.createElement('canvas')
  crop.width = W
  crop.height = H
  const cctx = crop.getContext('2d', { willReadFrequently: true })!
  cctx.drawImage(img, bbox.x, bbox.y, W, H, 0, 0, W, H)
  const src = cctx.getImageData(0, 0, W, H).data

  // --- symmetry confidence -------------------------------------------------
  // Silhouette IoU against its own mirror. KNOWN BLIND SPOT: a feature that
  // does not change the outline — a chest pocket, an offset zip, a contrast
  // panel — scores ~0.99 here and still mirrors onto the wrong side. Measuring
  // the shading field's left/right agreement instead was tried and rejected:
  // it scores a plain black polo 0.49 (dark fabric photographs with large
  // relative highlight variation), so it would cry wolf on ordinary products
  // and the warning would stop meaning anything. The blind spot is covered by
  // the badge, the baked preview mark, and the admin seeing the tile — not by
  // pretending this number is more than it is. See scripts/backphoto-verify.mjs.
  let inter = 0
  let union = 0
  for (let y = 0; y < H; y++) {
    const row = y * W
    for (let x = 0; x < W; x++) {
      const a = src[(row + x) * 4 + 3] > 16
      const b = src[(row + W - 1 - x) * 4 + 3] > 16
      if (a && b) inter++
      else if (a || b) union++
    }
  }
  union += inter
  const symmetry = union > 0 ? inter / union : 0

  // --- garment colour ------------------------------------------------------
  // Median over INTERIOR pixels only: the print area is masked out (artwork is
  // not the garment) and a 2 px erosion band drops the anti-aliased rim, which
  // would otherwise drag the median toward the backdrop.
  const E = 2
  const ax0 = Math.round(front.printArea.xIn * pxPerInch)
  const ax1 = Math.round((front.printArea.xIn + front.printArea.wIn) * pxPerInch)
  const ay0 = Math.round(front.printArea.yIn * pxPerInch)
  const ay1 = Math.round((front.printArea.yIn + front.printArea.hIn) * pxPerInch)
  const sampleMedian = (skipArea: boolean): [number, number, number] | null => {
    const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)]
    let n = 0
    for (let y = E; y < H - E; y++) {
      for (let x = E; x < W - E; x++) {
        if (skipArea && x >= ax0 && x < ax1 && y >= ay0 && y < ay1) continue
        const i = (y * W + x) * 4 + 3
        if (
          src[i] <= 250 ||
          src[i - E * 4] <= 250 ||
          src[i + E * 4] <= 250 ||
          src[i - E * W * 4] <= 250 ||
          src[i + E * W * 4] <= 250
        )
          continue
        hist[0][src[i - 3]]++
        hist[1][src[i - 2]]++
        hist[2][src[i - 1]]++
        n++
      }
    }
    if (n === 0) return null
    const half = n / 2
    return [0, 1, 2].map((c) => {
      let acc = 0
      for (let v = 0; v < 256; v++) {
        acc += hist[c][v]
        if (acc >= half) return v
      }
      return 255
    }) as [number, number, number]
  }
  // A garment thinner than the erosion band, or entirely covered by its print
  // area, still has to yield a colour — retry unmasked before giving up.
  const sampled = sampleMedian(true) ?? sampleMedian(false)
  if (!sampled && !opts.colorRgb) throw new IngestPhotoError('low_coverage')
  const swatch = opts.colorRgb ?? null
  const useSwatch =
    !!swatch && (!sampled || redmean(swatch, sampled) <= SWATCH_MAX_DIST)
  const garment = (useSwatch ? swatch! : sampled!) as [number, number, number]

  // --- shading field (alpha-weighted low-pass of the front's luminance) ----
  const s = Math.min(1, SHADE_GRID_PX / Math.max(W, H))
  const bw = Math.max(1, Math.round(W * s))
  const bh = Math.max(1, Math.round(H * s))
  const sumL = new Float32Array(bw * bh)
  const sumA = new Float32Array(bw * bh)
  const cells = new Float32Array(bw * bh)
  for (let y = 0; y < H; y++) {
    const by = Math.min(bh - 1, Math.floor((y * bh) / H))
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const k = by * bw + Math.min(bw - 1, Math.floor((x * bw) / W))
      const a = src[i + 3] / 255
      sumL[k] += relLuminance(src[i], src[i + 1], src[i + 2]) * a
      sumA[k] += a
      cells[k]++
    }
  }
  // A polo front's placket goes here, BEFORE the blur — see the section above.
  const placket = suppressCentrePlacket(sumL, sumA, cells, bw, bh)
  // Blurring the WEIGHTED sums and dividing afterwards is what keeps the
  // transparent surround out of the average: without it the hem, sleeves and
  // neckline pick up a dark halo that survives the clamp and reads as burn.
  const r = Math.max(1, Math.round(SHADE_SIGMA_FRAC * bw))
  const num = blur3(sumL, bw, bh, r)
  const den = blur3(sumA.slice(), bw, bh, r) // sumA is still needed unblurred
  const field = new Float32Array(bw * bh)
  for (let k = 0; k < field.length; k++) field[k] = den[k] > 1e-4 ? num[k] / den[k] : 0
  // Reference level = median over FULLY covered cells (edge cells average in
  // transparent area and would drag the reference down).
  const solid: number[] = []
  for (let k = 0; k < field.length; k++)
    if (sumA[k] >= 0.98 * cells[k] && cells[k] > 0) solid.push(field[k])
  solid.sort((a, b) => a - b)
  const Lm = solid.length ? solid[solid.length >> 1] : 0

  // --- compose -------------------------------------------------------------
  // The output colour depends only on the shade factor, so 256 quantised steps
  // replace ~3 pow() calls per pixel with a lookup.
  const lut = new Uint8ClampedArray(SHADE_STEPS * 3)
  for (let j = 0; j < SHADE_STEPS; j++) {
    const shade = SHADE_MIN + ((SHADE_MAX - SHADE_MIN) * j) / (SHADE_STEPS - 1)
    for (let c = 0; c < 3; c++)
      lut[j * 3 + c] = Math.round(
        255 * clamp(linearToSrgb(srgbToLinear(garment[c] / 255) * shade), 0, 1),
      )
  }
  const pad = Math.round(GEN_PAD_FRAC * Math.max(W, H))
  const out = document.createElement('canvas')
  out.width = W + 2 * pad
  out.height = H + 2 * pad
  const octx = out.getContext('2d', { willReadFrequently: true })!
  const dst = octx.createImageData(out.width, out.height)
  const shadeIndex = (v: number) =>
    Math.round(
      (clamp(Lm > 0 ? Math.pow(v / Lm, SHADE_GAMMA) : 1, SHADE_MIN, SHADE_MAX) -
        SHADE_MIN) *
        ((SHADE_STEPS - 1) / (SHADE_MAX - SHADE_MIN)),
    )
  for (let y = 0; y < H; y++) {
    const gy = clamp(((y + 0.5) * bh) / H - 0.5, 0, bh - 1)
    const gy0 = Math.floor(gy)
    const gy1 = Math.min(bh - 1, gy0 + 1)
    const fy = gy - gy0
    for (let x = 0; x < W; x++) {
      const mx = W - 1 - x // the mirror: sample the front's opposite column
      const gx = clamp(((mx + 0.5) * bw) / W - 0.5, 0, bw - 1)
      const gx0 = Math.floor(gx)
      const gx1 = Math.min(bw - 1, gx0 + 1)
      const fx = gx - gx0
      const v =
        (field[gy0 * bw + gx0] * (1 - fx) + field[gy0 * bw + gx1] * fx) * (1 - fy) +
        (field[gy1 * bw + gx0] * (1 - fx) + field[gy1 * bw + gx1] * fx) * fy
      const j = shadeIndex(v) * 3
      const o = ((y + pad) * out.width + (x + pad)) * 4
      dst.data[o] = lut[j]
      dst.data[o + 1] = lut[j + 1]
      dst.data[o + 2] = lut[j + 2]
      dst.data[o + 3] = src[(y * W + mx) * 4 + 3]
    }
  }
  octx.putImageData(dst, 0, 0)
  if (opts.watermark !== false) bakePreviewMark(out, garment)

  const blob = await new Promise<Blob>((resolve, reject) =>
    out.toBlob(
      (b) => (b ? resolve(b) : reject(new IngestPhotoError('decode_failed'))),
      'image/png',
    ),
  )
  return {
    blob,
    colorHex: toHex(garment),
    colorSource: useSwatch ? 'supplier-swatch' : 'sampled',
    symmetry,
    heightIn: H / pxPerInch,
    placket,
  }
}

/** Mark opacity: a dark mark on a light garment, a light mark on a dark one. */
const MARK_ALPHA_DARK = 0.075
const MARK_ALPHA_LIGHT = 0.085

/**
 * Bake the "this is a preview" mark INTO the pixels.
 *
 * The UI badge covers every surface that has chrome; this covers the ones that
 * do not — the AR GLB/USDZ the customer opens life-size in their living room,
 * the AR poster, the downloaded mockup PNG. It is invisible in a 220 px
 * thumbnail and unmistakable at 1:1.
 *
 * POLARITY: pick the direction that actually moves the pixels the most, by
 * comparing the two achievable deltas — NOT "is this a light colour?". With
 * these alphas the crossover sits near sRGB 135, well below mid grey, so a
 * luminance test put every blank between roughly sRGB 135 and 190 (heather,
 * sand, olive — the middle of any real catalogue) on the WEAKER side: measured
 * on #b7bcc2 the mark moved 0.016 mean luminance against 0.048 on white and
 * 0.058 on black, i.e. it all but vanished on exactly the greys it has to
 * survive on. Comparing the deltas removes the cliff instead of moving it.
 *
 * `source-atop` does the clipping AND leaves the alpha channel untouched, so
 * the generated back stays an exact mirror of the front's silhouette — a
 * destination-in pass through a second canvas would thicken the anti-aliased
 * rim by a pixel.
 *
 * It can NEVER reach a physical transfer: DTF pieces are rendered from the
 * artwork alone (src/lib/dtf/pieces.ts), never from the garment photo.
 */
function bakePreviewMark(canvas: HTMLCanvasElement, garment: [number, number, number]) {
  const w = canvas.width
  const h = canvas.height
  const ctx = canvas.getContext('2d')!
  // Display-space luma, because the delta the eye judges is the one the
  // compositor produces in display space — not in linear light.
  const luma = 0.2126 * garment[0] + 0.7152 * garment[1] + 0.0722 * garment[2]
  const dark = MARK_ALPHA_DARK * luma >= MARK_ALPHA_LIGHT * (255 - luma)
  ctx.save()
  ctx.globalCompositeOperation = 'source-atop'
  ctx.fillStyle = dark
    ? `rgba(0,0,0,${MARK_ALPHA_DARK})`
    : `rgba(255,255,255,${MARK_ALPHA_LIGHT})`
  ctx.font = `600 ${Math.round(w / 34)}px system-ui, -apple-system, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.translate(w / 2, h / 2)
  ctx.rotate(-Math.PI / 6)
  const dx = 0.55 * w
  const dy = 0.35 * w
  const reach = (w + h) / 2
  const nx = Math.ceil(reach / dx)
  const ny = Math.ceil(reach / dy)
  for (let j = -ny; j <= ny; j++)
    for (let i = -nx; i <= nx; i++) ctx.fillText('APERÇU · PREVIEW', i * dx, j * dy)
  ctx.restore()
}

/**
 * Back print area derived from the front's, NOT re-detected: the generated
 * image is the front's silhouette mirrored, so the bbox is identical by
 * construction, while the collar scan `autoPrintArea` relies on needs the real
 * notch contrast the σ-blur has just removed. Mirroring x keeps an off-centre
 * chest placement on the matching shoulder; the extra drop is the standard
 * front→back difference (7.5 → 10 cm below the collar).
 */
function backAreaFromFront(area: RectIn, widthIn: number, heightIn: number): RectIn {
  const drop = cmToIn(DROP_BELOW_COLLAR_CM.back - DROP_BELOW_COLLAR_CM.front)
  return {
    wIn: area.wIn,
    hIn: area.hIn,
    xIn: clamp(widthIn - (area.xIn + area.wIn), 0, Math.max(0, widthIn - area.wIn)),
    yIn: clamp(area.yIn + drop, 0, Math.max(0, heightIn - area.hIn)),
  }
}

/**
 * Adopt an ALREADY reconstructed back image as a side def: put it through the
 * same ingest pipeline as a real photo (it carries alpha, so it takes the
 * pre-cut path — no U²-Net, no cutout_failed risk, but every quality gate still
 * runs), give it the same front-derived geometry, and carry the provenance the
 * whole app badges on.
 *
 * Used twice, deliberately: once by `generateBackSide` right after generating,
 * and once by the supplier adapter for the reconstructions
 * `scripts/generate-missing-backs.mjs` committed into the catalogue snapshot —
 * so a pre-generated back and a freshly generated one are the SAME record, and
 * neither can quietly lose its `origin: 'generated'`.
 */
export async function adoptGeneratedBack(
  front: ProductSideDef,
  image: Blob,
  halfChestCm: number,
  generatedFrom: GeneratedSideInfo,
  opts: { name: string },
): Promise<ProductSideDef> {
  const widthIn = cmToIn(halfChestCm)
  const photo = await normalizeGarmentPhoto(image, { name: opts.name })
  const side = { assetId: photo.assetId, useCutout: photo.hasCutout }
  // Height comes from the ingested image, not from the generator's report: the
  // adopted file may have been produced by an earlier run, and the print area
  // has to be clamped against the pixels actually on screen.
  const info = await getCustomSideInfo(
    { ...side, printArea: { xIn: 0, yIn: 0, wIn: 1, hIn: 1 } },
    widthIn,
  )
  return {
    ...side,
    printArea: backAreaFromFront(front.printArea, widthIn, info.bbox.h / info.pxPerInch),
    origin: 'generated',
    generatedFrom,
  }
}

/**
 * Generate a back SIDE DEF from a front one: reconstruct the image, then adopt
 * it (above) so the record is identical to a pre-generated one.
 *
 * `at` is a parameter, not a `Date.now()` call, so this module stays free of
 * ambient state and a verification run is reproducible.
 */
export async function generateBackSide(
  front: ProductSideDef,
  halfChestCm: number,
  opts: {
    name: string
    at: number
    colorRgb?: [number, number, number] | null
    watermark?: boolean
  },
): Promise<ProductSideDef> {
  const gen = await generateBackFromFront(front, cmToIn(halfChestCm), {
    colorRgb: opts.colorRgb,
    watermark: opts.watermark,
  })
  return adoptGeneratedBack(
    front,
    gen.blob,
    halfChestCm,
    {
      method: 'front-mirror-flood',
      v: 2,
      colorHex: gen.colorHex,
      colorSource: gen.colorSource,
      placketSuppressed: gen.placket.suppressed,
      symmetry: gen.symmetry,
      at: opts.at,
    },
    { name: opts.name },
  )
}

// ---------------------------------------------------------------------------
// Paste-a-table parsing (size chart editor)
// ---------------------------------------------------------------------------

const SIZE_TOKEN: Record<string, SizeId> = {
  S: 'S',
  M: 'M',
  L: 'L',
  XL: 'XL',
  '2XL': '2XL',
  XXL: '2XL',
  '3XL': '3XL',
  XXXL: '3XL',
}

/**
 * Parse pasted size-table text into cm specs. Tolerates: whitespace / `;` /
 * tab separated columns, comma decimals ("52,5"), optional leading size
 * labels (S, M, XL, XXL…), unit suffixes ("52 cm"), and header lines
 * (rows without ≥3 numbers are skipped). Unlabelled rows are assigned in
 * S→3XL order. Expected column order: halfChest, bodyLength, sleeveLength.
 */
export function parseSizeTable(text: string): Partial<Record<SizeId, SizeSpecCm>> {
  const out: Partial<Record<SizeId, SizeSpecCm>> = {}
  let cursor = 0
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const nums = (line.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) =>
      parseFloat(n.replace(',', '.')),
    )
    // Leading token before any digit may name the size (also catches "2XL").
    const label = /^\s*([0-9]?[A-Za-z]{1,4})[\s;:,\t]/.exec(rawLine)?.[1]
    const labelled = label ? SIZE_TOKEN[label.toUpperCase()] : undefined
    // "2XL" contributes a leading 2 to nums — drop it when it was the label.
    const values = labelled && /^\d/.test(label!) ? nums.slice(1) : nums
    if (values.length < 3) continue
    const size = labelled ?? SIZE_IDS[cursor]
    if (!size) break
    if (!labelled) cursor++
    else cursor = Math.max(cursor, SIZE_IDS.indexOf(size) + 1)
    out[size] = {
      halfChestCm: values[0],
      bodyLengthCm: values[1],
      sleeveLengthCm: values[2],
    }
  }
  return out
}
