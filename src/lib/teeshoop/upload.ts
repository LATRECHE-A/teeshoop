/**
 * Putting a design somewhere that is not this browser.
 *
 * Until the customer clicks buy, their artwork exists in exactly one place: the
 * zustand document in this tab and the rasters in this tab's IndexedDB. An
 * order line in WooCommerce carries an IDENTIFIER, and `POST /api/design`
 * (worker/design.ts) is what that identifier points at. Nothing may be added to
 * a cart until this has succeeded: `Design::verify` on the WordPress side
 * refuses an id the Worker does not know, which is the difference between an
 * order the workshop cannot print and no order at all.
 *
 * WHAT GOES UP, and why each part has to:
 *
 *   the document   the layers, their geometry, the garment and its colour. The
 *                  transfers are RE-RENDERED from this later, by whatever build
 *                  is deployed then, which is why the manifest stamps an
 *                  app_version.
 *   the preview    a flattened mockup. It is what a proof email and a cart
 *                  thumbnail show, and it is the only part of the upload that
 *                  is readable without the admin token.
 *   every raster   the customer's own uploads. These are NOT derived from
 *                  anything: lose them and the order is unprintable however
 *                  much else survives. The document names them by id, so an id
 *                  without its bytes is a dangling pointer into a browser that
 *                  has since cleared its storage.
 *
 * WHAT DOES NOT GO UP: `stashedLayers`, the artwork parked for the OTHER
 * garment context (a tee design kept aside while the customer works on their
 * own garment, or the reverse). It is not part of this order, the workshop must
 * never press it, and storing a customer's unrelated draft on a server because
 * it happened to be in the same document is not ours to do.
 *
 * THE AREAS ARE MEASURED, NOT DECLARED. `sides` carries the ink area of every
 * printed side in SQUARE CENTIMETRES (`sideArtworkSqCm`'s own unit, with no
 * conversion anywhere) and it is read only after `ensureInkProbes` has
 * settled. A layer that has not been decoded measures as its full declared box,
 * so quoting before the probes land charges the customer for the transparent
 * margins of their own logo. A layer that CANNOT be measured refuses the whole
 * upload rather than being priced at its padded size.
 */
import type { Design, Layer, Side } from '@/lib/types'
import { ensureInkProbes, sideArtworkSqCm, sidePiecesCm } from '@/lib/ink'
import { ensureFont } from '@/lib/fonts'
import { DEFAULT_SIZE } from '@/content/sizeChart'
import { renderMockup, sideLayers } from '@/lib/renderDesign'
import { assetRevision, getAssetBlob, type AssetVariant } from '@/state/assets'
import { canvasToBlob } from '@/lib/download'
import { readDesignDoc } from './designDoc'
import type { BridgeSide } from './bridge'

/** Sides the studio can print. The wire ids are these, verbatim. */
const PRINTABLE_SIDES: Side[] = ['front', 'back', 'sleeve']

/**
 * The size every priced area is measured at.
 *
 * NOT the design's own base size, which is what this measured before. Base size
 * is a six-button control in the Produit panel: the same physical print
 * authored at base S and at base M measures differently, because the area is
 * read in base space, so a customer could move a 660 cm² chest print across the
 * 625 cm² tier boundary by pressing a size button. Measured on the shipped
 * config, that is 601,00 EUR against 471,00 EUR HT for fifty identical shirts.
 * Pinning the measurement to one chart size makes the number a property of the
 * garment rather than of a label.
 *
 * It is still ONE number for a run that may span S to 3XL, which is a real
 * approximation and question 37 of QUESTIONS-ASSOCIE.md.
 */
const PRICED_SIZE = DEFAULT_SIZE

/** Width of the flattened preview, px. Enough for a proof, small enough to send. */
const PREVIEW_PX = 900

/** How many upload results to remember. See `cache` below. */
const CACHE_MAX = 4

/**
 * Why an upload could not be made, in a form the interface can turn into a
 * sentence the customer can act on. The copy lives with the interface
 * (src/app/modals/cartI18n.ts); this module owns the reasons, not the words.
 */
export type UploadFailure =
  | 'no_printable_side'
  | 'unmeasurable'
  | 'missing_artwork'
  | 'preview_failed'
  | 'too_large'
  | 'rejected'
  | 'server'
  | 'network'

export class DesignUploadError extends Error {
  readonly code: UploadFailure
  /** Names the customer will recognise (a layer, an image), never an id. */
  readonly detail: string

  constructor(code: UploadFailure, detail = '') {
    super(`${code}${detail ? `: ${detail}` : ''}`)
    this.name = 'DesignUploadError'
    this.code = code
    this.detail = detail
  }
}

export interface MeasuredOrder {
  /** One entry per side that actually carries ink, in cm². */
  sides: BridgeSide[]
}

/**
 * Which stored variant each raster is drawn from. A LOOKUP, not the authority
 * on which rasters the order carries: background removal writes a second blob
 * under the same id, and a layer with `useCutout` draws that one.
 */
function assetVariants(design: Design): Map<string, AssetVariant> {
  const out = new Map<string, AssetVariant>()
  const add = (id: string, cutout: boolean): void => {
    if (!id || out.has(id)) return
    out.set(id, cutout ? 'cutout' : 'original')
  }
  for (const l of design.layers) if (l.type === 'image') add(l.assetId, l.useCutout)
  if (design.custom) {
    for (const setup of [design.custom.front, design.custom.back])
      if (setup) add(setup.assetId, setup.useCutout)
  }
  return out
}

/**
 * Every raster this order must carry, READ OUT OF THE DOCUMENT BY THE SERVER'S
 * OWN GATE.
 *
 * Not re-derived from the design. `worker/design.ts` refuses an upload whose
 * asset set differs from the document's in either direction, so the only safe
 * way to decide what to send is to ask the same function the Worker will ask.
 * Null when the document we just built is not a design at all, which is a bug
 * in this file and is caught here rather than as a 422 at the last click of a
 * purchase.
 */
function referencedAssets(
  design: Design,
  doc: Record<string, unknown>,
): { id: string; variant: AssetVariant }[] | null {
  const read = readDesignDoc(doc)
  if (!read) return null
  const variants = assetVariants(design)
  return read.assetIds.map((id) => ({ id, variant: variants.get(id) ?? 'original' }))
}

/** Human name for a layer, for an error a customer reads. */
function layerLabel(l: Layer): string {
  return l.name || l.type
}

/**
 * Warm the ink probes and measure every printed side.
 *
 * Refuses rather than guesses. An artwork whose pixels could not be read is not
 * "probably fine at its declared box": that box is the padded rectangle the
 * customer's logo was exported in, and charging it is the exact overcharge the
 * ink measurement exists to remove.
 */
export async function measureOrder(design: Design): Promise<MeasuredOrder> {
  const drawn = PRINTABLE_SIDES.filter((side) => sideLayers(design, side).length > 0)
  const layers = drawn.flatMap((side) => sideLayers(design, side))
  if (layers.length === 0) throw new DesignUploadError('no_printable_side')

  /*
   * THE FONTS TOO, and this is a price, not a rendering nicety.
   *
   * `ensureInkProbes` warms images and graphics. A text layer's ink comes from
   * canvas glyph metrics, and an unloaded webfont is silently substituted by the
   * UA default, so the measured box is the wrong face's. `renderPieces` knows
   * this and loads fonts first with a comment saying why; this was the one
   * measurement path that did not. It bites when a printed side was never
   * rendered in the editor, which is every back and sleeve of a design that was
   * just reopened: the quote is measured before the mockup loads the font and
   * the upload is measured after, so the customer is charged for a different
   * box than the one they were shown, in steps of 4,00 EUR HT per garment.
   */
  const [{ unmeasured }] = await Promise.all([
    ensureInkProbes(layers),
    Promise.all(
      [...new Set(layers.filter((l) => l.type === 'text').map((l) => l.fontFamily))].map((f) =>
        ensureFont(f),
      ),
    ),
  ] as const)
  if (unmeasured.length > 0)
    throw new DesignUploadError('unmeasurable', unmeasured.map(layerLabel).join(', '))

  const sides: BridgeSide[] = []
  for (const side of drawn) {
    // At PRICED_SIZE, never at the design's own base size. See the constant.
    const area = sideArtworkSqCm(design, side, PRICED_SIZE)
    /*
     * THE RECTANGLES TRAVEL WITH THE AREA, measured from the same clusters at
     * the same size, because the shop cannot recompute them: the ink extent of
     * an upload is read from its alpha channel, which needs a decoded image and
     * a canvas, and neither the Cloudflare Worker nor PHP has one. Measured
     * here or not at all, and "not at all" means an order whose film cost is
     * unknown (wp-plugins/teeshoop-core/includes/Costing.php says so rather
     * than guessing a length).
     */
    if (area > 0)
      sides.push({
        id: side,
        area_sq_cm: Math.round(area * 100) / 100,
        pieces: sidePiecesCm(design, side, PRICED_SIZE),
      })
  }
  if (sides.length === 0) throw new DesignUploadError('no_printable_side')
  return { sides }
}

/**
 * The JSON the Worker stores and the studio reopens.
 *
 * `v` is a schema marker on an artefact that will be re-read long after this
 * build is gone. Everything else is the live document, minus what this order is
 * not (see the header), plus the measured areas so the line can be re-priced
 * from the design alone.
 */
function buildDocument(design: Design, sides: BridgeSide[]): Record<string, unknown> {
  return {
    v: 1,
    ...design,
    stashedLayers: [],
    custom: design.garmentId === 'custom' ? design.custom : null,
    sides,
  }
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_SIG = [0xff, 0xd8, 0xff]
const startsWith = (b: Uint8Array, sig: number[]): boolean => sig.every((v, i) => b[i] === v)

/**
 * A raster the Worker will accept, from a raster the browser accepted.
 *
 * `addAsset` stores the ORIGINAL bytes when an image is small enough and not an
 * SVG or a WebP, and the file pickers take `image/*`, so a 512 px GIF or AVIF
 * reaches IndexedDB with its own magic bytes intact. The Worker decides format
 * by the bytes rather than by what the client calls the file (correctly: that
 * is what stops R2 becoming generic hosting), and rejects anything that is not
 * PNG or JPEG with a 415. Re-encoding here is what keeps a legitimate customer
 * upload from being refused at the last step of a purchase.
 *
 * PNG and JPEG pass through UNTOUCHED. Re-encoding a 6 MB photo to PNG for no
 * reason would triple the upload on the connection least able to carry it.
 */
async function sendableRaster(blob: Blob): Promise<Blob> {
  const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer())
  if (startsWith(head, PNG_SIG) || startsWith(head, JPEG_SIG)) return blob

  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    ctx.drawImage(bitmap, 0, 0)
    // PNG, never JPEG: these are the formats that carry transparency, and a
    // cutout flattened onto white prints as a white box on a coloured shirt.
    return await canvasToBlob(canvas, 'image/png')
  } finally {
    bitmap.close()
  }
}

/** The flattened proof. Front unless the front is bare and another side is not. */
function previewSide(design: Design): Side {
  return PRINTABLE_SIDES.find((s) => sideLayers(design, s).length > 0) ?? 'front'
}

export interface UploadedDesign {
  id: string
  /** What was actually sent, bytes. Measured, so a slow upload can be explained. */
  bytes: number
  sides: BridgeSide[]
}

/**
 * Everything the upload depends on, as one string.
 *
 * NOT a hash. The document is a few kilobytes of geometry (rasters are
 * referenced by id, never inlined), so hashing it would buy nothing but a
 * dependency on `crypto.subtle` and a second code path for the browsers that
 * lack it. The asset REVISION is in the key because background removal rewrites
 * a cutout's bytes under the same id: without it, re-cutting an image and
 * clicking buy again would resell the first cut.
 */
function cacheKey(doc: Record<string, unknown>, assets: { id: string; variant: AssetVariant }[]): string {
  const revs = assets.map((a) => `${a.id}:${a.variant}:${assetRevision(a.id, a.variant)}`).join('|')
  return JSON.stringify(doc) + ' ' + revs
}

/**
 * The last few uploads, keyed by their inputs.
 *
 * Two jobs, and the second is the one that matters. It stops a design that has
 * not changed from being re-sent. The customer who adds to the basket, goes to
 * look at the cart, comes back and adds a second size should not pay for the
 * upload twice. And because the PROMISE is cached rather than the result, a
 * double click resolves both handlers from one request instead of writing two
 * designs and, through `Cart::keep_items_distinct`, two cart lines.
 *
 * Bounded because the keys hold the document: a session spent nudging a layer
 * would otherwise accumulate one copy per keystroke.
 */
const cache: { key: string; promise: Promise<UploadedDesign> }[] = []

function remember(key: string, promise: Promise<UploadedDesign>): Promise<UploadedDesign> {
  cache.push({ key, promise })
  while (cache.length > CACHE_MAX) cache.shift()
  // A failed upload must be retryable, so it does not stay in the cache.
  promise.catch(() => {
    const i = cache.findIndex((e) => e.key === key)
    if (i >= 0) cache.splice(i, 1)
  })
  return promise
}

/** Turn a Worker refusal into a reason, without inventing one it did not give. */
function failureFor(status: number): UploadFailure {
  if (status === 413) return 'too_large'
  if (status === 415 || status === 422 || status === 400) return 'rejected'
  return 'server'
}

async function send(
  doc: Record<string, unknown>,
  sides: BridgeSide[],
  parts: { id: string; blob: Blob }[],
  preview: Blob,
): Promise<UploadedDesign> {
  const form = new FormData()
  const docBlob = new Blob([JSON.stringify(doc)], { type: 'application/json' })
  form.append('design', docBlob, 'design.json')
  form.append('preview', preview, 'preview.png')
  let bytes = docBlob.size + preview.size
  for (const part of parts) {
    form.append(`asset:${part.id}`, part.blob, part.id)
    bytes += part.blob.size
  }

  let res: Response
  try {
    // Same origin as the studio: the Worker serves both, so there is no CORS
    // preflight and nothing for the iframe sandbox to permit beyond scripts.
    res = await fetch('/api/design', { method: 'POST', body: form })
  } catch {
    throw new DesignUploadError('network')
  }

  if (!res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as { error?: unknown }
      if (typeof body.error === 'string') detail = body.error
    } catch {
      /* a refusal without a JSON body is still a refusal */
    }
    throw new DesignUploadError(failureFor(res.status), detail)
  }

  const body = (await res.json().catch(() => null)) as { id?: unknown } | null
  const id = body && typeof body.id === 'string' ? body.id : ''
  if (!id) throw new DesignUploadError('server', 'the upload returned no identifier')
  return { id, bytes, sides }
}

/**
 * Store this design and get the identifier the cart line will carry.
 *
 * Idempotent: the same design uploaded twice returns the first id without
 * touching the network, and two calls racing each other share one request.
 */
export async function uploadDesign(design: Design): Promise<UploadedDesign> {
  const { sides } = await measureOrder(design)
  const doc = buildDocument(design, sides)
  const assets = referencedAssets(design, doc)
  if (!assets) throw new DesignUploadError('rejected', 'design document')

  const key = cacheKey(doc, assets)
  const hit = cache.find((e) => e.key === key)
  if (hit) return hit.promise

  return remember(
    key,
    (async () => {
      const parts: { id: string; blob: Blob }[] = []
      const missing: string[] = []
      for (const asset of assets) {
        const blob = await getAssetBlob(asset.id, asset.variant)
        if (!blob) {
          // The document names an image whose bytes are gone from this browser
          // (cleared storage, a design imported from a link, another device).
          // Refused HERE rather than by the Worker's 422, because only this
          // side knows which layer the customer has to replace.
          const layer = design.layers.find((l) => l.type === 'image' && l.assetId === asset.id)
          missing.push(layer ? layerLabel(layer) : asset.id)
          continue
        }
        try {
          parts.push({ id: asset.id, blob: await sendableRaster(blob) })
        } catch {
          // Stored bytes that will not decode. Same conclusion as bytes that
          // are not there at all: this order cannot be printed as drawn.
          const layer = design.layers.find((l) => l.type === 'image' && l.assetId === asset.id)
          missing.push(layer ? layerLabel(layer) : asset.id)
        }
      }
      if (missing.length > 0) throw new DesignUploadError('missing_artwork', missing.join(', '))

      let preview: Blob
      try {
        const canvas = await renderMockup(design, previewSide(design), PREVIEW_PX)
        preview = await canvasToBlob(canvas, 'image/png')
      } catch {
        throw new DesignUploadError('preview_failed')
      }

      return send(doc, sides, parts, preview)
    })(),
  )
}

/** Test seam: forget every remembered upload. */
export function resetUploadCacheForTests(): void {
  cache.length = 0
}

/** Test seam: the document shape is what the Worker gates on, so it is asserted. */
export const __buildDocumentForTests = buildDocument
/** Test seam: which rasters an order carries is a "the order is printable" rule. */
export const __referencedAssetsForTests = referencedAssets
