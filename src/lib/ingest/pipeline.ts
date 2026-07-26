/**
 * INGEST — photo normalization + automatic print-area suggestion.
 *
 * Dependency-free canvas math: everything works on downscaled ImageData
 * scans, mirroring the alpha-bbox conventions of src/lib/custom.ts so the
 * resulting ProductSideDef maps 1:1 onto the custom-garment pipeline.
 */
import { addAsset, getAssetBlob, removeAsset, setAssetCutout } from '@/state/assets'
import { isBgRemovalSupported, removeBackground } from '@/lib/bgremove'
import { defaultCustomPrintArea, invalidateCustomBBox } from '@/lib/custom'
import type { RectIn } from '@/lib/types'
import { clamp, cmToIn } from '@/lib/units'
import type { SizeId, SizeSpecCm } from '@/content/sizeChart'
import { SIZE_IDS } from '@/content/sizeChart'

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
