/**
 * REGISTERING THE REVERSE PANEL onto the front's frame.
 *
 * THE DEFECT THIS EXISTS FOR. The hollow shell is ONE piece of geometry: both
 * sheets are built from the FRONT photo's silhouette (src/lib/silhouette.ts:
 * `buildMask(canvas)` runs on the front, and both sheets share its grid, its
 * content bbox and its outline), and the back sheet simply samples its texture
 * mirrored: `uv = (1 − u, v)` with u and v taken from the FRONT's bbox. That
 * is correct if and only if the back photograph has its garment in the same
 * place, at the same scale, as the front one. Nothing ever made that true.
 *
 * Measured over the 46 shipped supplier front/back pairs THROUGH THE CUTOUT the
 * app actually uses (U²-Net alpha, NOT a fuzz-trim of the JPEG, which
 * overstates it roughly fourfold on white garments shot on a white sweep and
 * reduces one full-frame tee to a 32-px sliver): after normalising width, the
 * two aspect ratios differ by a median 1.0 %, a p90 of 5.7 %, 7 of 46 over 5 %,
 * worst genuine ≈ 8 % (74956, 171723).
 *
 * A few per cent of body length is small, and it is still the whole complaint,
 * because of WHERE it lands. The mismatch is absorbed by bottom-padding the
 * shorter canvas (Scene3D / arExport), so it does not spread over the garment.
 * It accumulates entirely at the HEM. Whichever side took the pad has
 * transparent rows there: `alphaTest` discards the sheet AND its lining across
 * them so you see straight through the garment, and the rim strip (which
 * carries no alpha test, by design) shades those empty texels black around the
 * lower silhouette. A reverse that stops short with a dark edge under it is
 * exactly the "back picture is up from the front… a weird broken view of a
 * garment" a customer reported. The dev harness is worse than production, which
 * is why the screenshots never showed it plainly: it feeds UNCROPPED photos
 * (threeHarness.loadSupplierCard), so there the reverse is off by the raw
 * supplier framing rather than by the residual aspect.
 *
 * WHY IT IS FIXED HERE AND NOT IN THE UVs. The mirror is written out
 * INDEPENDENTLY in three places (the sheet, the rim's front/back ribbons and
 * the lining) and `buildInflatedShell` has no parameter through which a caller
 * could describe a back photo at all. Changing all of them means changing the
 * geometry contract that `scripts/inflate-verify.mjs` pins float-exact across
 * both depth tiers and both rim modes, and that the AR bake must reproduce
 * byte for byte. Registration is a 2-D image problem, so it is solved in 2-D
 * image space: this module hands back a canvas IN THE FRONT'S PIXEL FRAME whose
 * content is where `1 − u` already looks for it. Not one vertex, UV or index
 * changes, and the rim and lining inherit the fix because they sample the same
 * texture.
 *
 * WHAT THE OUTPUT GUARANTEES, which is the part that makes the render robust
 * rather than merely better aligned:
 *   · its alpha IS the front's alpha, mirrored, so the two sheets cut on the
 *     same isoline and no framing difference can put a hole in the garment or a
 *     black band under the rim;
 *   · every pixel inside that alpha is cloth: the back photograph where it
 *     reaches, and the garment's own measured colour where it does not.
 */
import { contentBoxOf } from '@/lib/silhouette'

/**
 * How far the two framings may disagree before we stop believing they are the
 * same garment. Beyond this the "back" is something else (75374's reverse is a
 * 32×269 sliver against a 273×353 front), and smearing it across the front's
 * outline is worse than not having one: the caller falls back to the blank
 * tinted reverse, which is at least the right colour and the right shape.
 */
const MAX_ASPECT_RATIO = 1.7
/**
 * How much anisotropy is allowed while fitting. Within this the back is simply
 * stretched to fill the front's box, which is what keeps the hem where the
 * geometry says it is; past it the fit stops and the bleed/flood below take
 * over, so a badly cropped photo costs a soft band rather than a visibly
 * stretched garment. ±26 % is four times the shipped catalogue's p90 (5.7 %)
 * and three times its worst genuine pair, so on real supplier photography this
 * clamp never binds and the fit is exact: it exists for customer uploads,
 * where the two shots are two phone pictures.
 */
const MAX_STRETCH = 1.26

/** Mean colour of the cloth (alpha ≥ ½), as a CSS hex. */
function meanColor(canvas: HTMLCanvasElement, fallback = '#242A33'): string {
  const S = 64
  const w = Math.max(1, Math.min(S, canvas.width))
  const h = Math.max(1, Math.min(S, canvas.height))
  const off = document.createElement('canvas')
  off.width = w
  off.height = h
  const ctx = off.getContext('2d', { willReadFrequently: true })
  if (!ctx) return fallback
  ctx.drawImage(canvas, 0, 0, w, h)
  const d = ctx.getImageData(0, 0, w, h).data
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue
    r += d[i]
    g += d[i + 1]
    b += d[i + 2]
    n++
  }
  if (!n) return fallback
  const hex = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v / n)))
      .toString(16)
      .padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/**
 * The front's alpha, mirrored about the canvas centre: the rear-view
 * silhouette, and the mask the reverse must carry.
 *
 * EVERY consumer needs the mirror, which is why it is not an option. The shell's
 * back sheet samples `1 − u` explicitly; the curved card's reverse face is a
 * π-rotated plane, and PlaneGeometry puts u = 0 at local −X, so the rotation
 * lands it at world +X while the front's u = 0 stays at world −X, the same
 * `1 − u` by another route. It is only invisible today because renderMockup
 * bbox-crops each side, which makes the content box full width and the two
 * placements coincide.
 */
function frontMask(front: HTMLCanvasElement): HTMLCanvasElement | null {
  const c = document.createElement('canvas')
  c.width = front.width
  c.height = front.height
  const ctx = c.getContext('2d')
  if (!ctx) return null
  ctx.translate(c.width, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(front, 0, 0)
  return c
}

export interface RegisteredBack {
  /** The reverse composite (photo + design), in the front's pixel frame. */
  canvas: HTMLCanvasElement
  /** The same for the BARE reverse (CardSource.photo); null when none was given.
   *  Both go through one transform, or the shell would measure its light and its
   *  folds somewhere other than where it paints them. */
  photo: HTMLCanvasElement | null
}

/**
 * Redraw `back` (and its bare twin) into the front's frame so the shell's
 * existing back-sheet UVs land on the garment.
 *
 * Returns null when the pair cannot be registered: no readable alpha on one of
 * them, or framings too far apart to be the same garment (see
 * MAX_ASPECT_RATIO). Callers should then use the blank tinted reverse.
 */
export function registerBackPanel(
  front: HTMLCanvasElement,
  back: HTMLCanvasElement,
  backPhoto?: HTMLCanvasElement | null,
): RegisteredBack | null {
  const W = front.width
  const H = front.height
  if (!W || !H || !back.width || !back.height) return null
  const fb = contentBoxOf(front)
  const bb = contentBoxOf(back)
  if (!fb || !bb) return null

  // Front content box, in front pixels.
  const fx = fb.x0 * W
  const fy = fb.y0 * H
  const fw = (fb.x1 - fb.x0) * W
  const fh = (fb.y1 - fb.y0) * H
  // Back content box, in back pixels.
  const bx = bb.x0 * back.width
  const by = bb.y0 * back.height
  const bw = (bb.x1 - bb.x0) * back.width
  const bh = (bb.y1 - bb.y0) * back.height
  if (!(fw > 1 && fh > 1 && bw > 1 && bh > 1)) return null

  // Width always matches: that is the dimension `wIn` is defined against, and
  // the one the size chart and every print measurement are hung from.
  const sx = fw / bw
  const aspect = fh / bh / sx
  if (aspect > MAX_ASPECT_RATIO || aspect < 1 / MAX_ASPECT_RATIO) return null
  // The clamp may only ever leave the box UNDER-filled, never over-filled. When
  // the reverse is proportionally taller than the front (aspect < 1) the clamp
  // holds sy above the exact fit, which would draw the garment past the bottom
  // of the front's box, and the trim would then cut its HEM off, which is the
  // very failure this module exists to remove. Under-filling costs a soft band
  // the bleed and the flood already cover.
  const sy = Math.min(sx * Math.min(MAX_STRETCH, Math.max(1 / MAX_STRETCH, aspect)), fh / bh)

  // DESTINATION = the front's content box mirrored about the canvas centre,
  // because that is precisely the rect the reverse is read through: the shell's
  // back sheet runs uv.x = 1 − u over u ∈ [minX/W, (maxX+1)/W], and the card's
  // π rotation comes to the same thing. Vertically there is never a mirror (v
  // is the front's own rows), and the anchor is the TOP: both photographs hang
  // from the shoulder, so registering shoulder-to-shoulder is what makes the
  // collar, the armholes and the side seams meet at the rim.
  const dx = W - (fx + fw)
  const dy = fy

  const mask = frontMask(front)
  if (!mask) return null
  const tint = meanColor(backPhoto ?? back)

  const draw = (source: HTMLCanvasElement): HTMLCanvasElement | null => {
    const out = document.createElement('canvas')
    out.width = W
    out.height = H
    const ctx = out.getContext('2d')
    if (!ctx) return null
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    // 1. flood the whole silhouette with the garment's own colour, the last
    //    resort, so a framing difference can never put a hole in the garment.
    ctx.drawImage(mask, 0, 0)
    ctx.globalCompositeOperation = 'source-in'
    ctx.fillStyle = tint
    ctx.fillRect(0, 0, W, H)
    // From here on, SOURCE-ATOP: it paints only where the flood already is and
    // leaves the destination's alpha untouched, so the panel's alpha stays
    // EXACTLY the front's. The obvious alternative (draw normally, then
    // `destination-in` the mask to trim) multiplies the two alphas and
    // therefore SQUARES them across the matte's feather: a 130/255 edge texel
    // comes back as 66, which is under the sheets' 0.45 alphaTest, so the
    // reverse would cut a fraction of a feather inside the front's outline all
    // the way round. scripts/backreg-verify.mjs caught exactly that.
    ctx.globalCompositeOperation = 'source-atop'
    // 2. a slightly enlarged copy of the same photograph under it, so that where
    //    the fit was clamped the gap is filled by MORE PHOTOGRAPH rather than by
    //    a flat colour. Two things downstream care, and both are measurement
    //    rather than looks: `photoLight.delight` bails below FLAT_SPREAD, so a
    //    zero-variance band can switch the reverse's de-lighting off while the
    //    front's stays on; and `wrinkleNormalFrom` saturates its ±1 height clamp
    //    on any step over 70 luminance levels, which would emboss the flood's
    //    own edge into the cloth as a ridge. A 6 % scale of the same pixels has
    //    neither problem.
    const bleed = 0.06
    ctx.drawImage(
      source,
      bx,
      by,
      bw,
      bh,
      dx - bw * sx * bleed * 0.5,
      dy,
      bw * sx * (1 + bleed),
      bh * sy * (1 + bleed),
    )
    // 3. the photograph itself, where it belongs. Nothing it carries outside the
    //    front's outline is drawn: there is no geometry out there to carry it,
    //    and drawing it is what put a second, wider outline round the garment.
    ctx.drawImage(source, bx, by, bw, bh, dx, dy, bw * sx, bh * sy)
    return out
  }

  const canvas = draw(back)
  if (!canvas) return null
  return { canvas, photo: backPhoto ? draw(backPhoto) : null }
}
