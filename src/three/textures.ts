/**
 * Canvas → THREE texture plumbing for the 3D preview (module A3).
 *
 * DecalSource / CardSource canvases are owned by the caller; we wrap them in
 * CanvasTexture once per canvas identity and flag `needsUpdate` whenever the
 * source's `version` bumps.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

interface SourceLike {
  canvas: HTMLCanvasElement
  version: number
}

function makeCanvasTexture(canvas: HTMLCanvasElement, premultiplied = false): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas)
  /**
   * NoColorSpace for premultiplied artwork, and the shader decodes instead.
   *
   * THE TWO OPERATIONS HAVE TO HAPPEN IN THE SAME SPACE. `UNPACK_PREMULTIPLY_
   * ALPHA_WEBGL` multiplies the STORED, sRGB-ENCODED value by alpha at upload.
   * Ask three for SRGBColorSpace as well and the sampler hands the shader
   * `linear(srgb(c) x a)`; dividing that by alpha, which is what recovers the
   * straight colour, leaves `c_linear x a^1.4`. Measured against the intent: ink
   * at 50 % opacity would render at 38 % of its radiance and ink at 25 % at
   * 15 %, so a soft edge or a drop shadow would come out far too dark and a
   * faint layer would all but vanish. Sampling raw and decoding after the divide
   * is exact.
   *
   * What it costs: filtering and mip generation then happen on encoded values
   * rather than linear ones. That is a few per cent on a strong gradient INSIDE
   * the ink, against a fringe measured at up to 162 sRGB levels on every edge.
   */
  tex.colorSpace = premultiplied ? THREE.NoColorSpace : THREE.SRGBColorSpace
  tex.anisotropy = 8
  // Canvas row 0 (top) must map to v=1: default flipY=true is correct for
  // both DecalGeometry UVs and PlaneGeometry UVs. Verified with the
  // harness' "TOP" marker.
  tex.flipY = true
  /**
   * PREMULTIPLIED, for artwork.
   *
   * A print canvas holds STRAIGHT alpha and its transparent texels are
   * (0,0,0,0). Bilinear filtering and mip generation average colour and alpha
   * independently, so every edge in the artwork gets a band that is darker than
   * the ink AND darker than the shirt: measured on a white tee with the
   * calibration grid, 5 787 pixels dipping up to 162 sRGB levels below their own
   * neighbours. It is the dirty outline traced round every letter.
   *
   * Uploading premultiplied makes the filter interpolate (colour x alpha), which
   * is the only quantity that interpolates correctly; the shader then divides it
   * back out and decodes (see inkShaderChunks). All three are required:
   * premultiplying without the divide darkens the ink instead, dividing without
   * the premultiply brightens genuinely semi-transparent artwork, and doing
   * either across a colour-space boundary gets the exponent wrong (see the
   * colorSpace line above).
   */
  tex.premultiplyAlpha = premultiplied
  tex.needsUpdate = true
  return tex
}

/** Live texture view of a DecalSource/CardSource canvas. */
export function useSourceTexture(
  src: SourceLike | null | undefined,
  opts?: { premultiplied?: boolean },
): THREE.CanvasTexture | null {
  const canvas = src?.canvas ?? null
  const premultiplied = !!opts?.premultiplied
  const tex = useMemo(
    () => (canvas ? makeCanvasTexture(canvas, premultiplied) : null),
    [canvas, premultiplied],
  )
  useEffect(() => () => tex?.dispose(), [tex])
  const version = src?.version ?? 0
  useEffect(() => {
    if (tex) tex.needsUpdate = true
  }, [tex, version])
  return tex
}

/**
 * Wrap a generated tangent-space normal-map canvas (e.g. the photo-wrinkle map
 * from `buildWrinkleNormalCanvas` / `InflatedShell.normalMapCanvas`) as a
 * texture. Normal maps are raw linear data: NoColorSpace, flipY like the
 * photo it was derived from so texels stay aligned with the color map.
 */
export function useNormalMapTexture(canvas: HTMLCanvasElement | null | undefined): THREE.CanvasTexture | null {
  const tex = useMemo(() => {
    if (!canvas) return null
    const t = new THREE.CanvasTexture(canvas)
    t.colorSpace = THREE.NoColorSpace
    t.anisotropy = 4
    t.flipY = true
    t.needsUpdate = true
    return t
  }, [canvas])
  useEffect(() => () => tex?.dispose(), [tex])
  return tex
}

/**
 * Wrap a generated occlusion canvas (`InflatedShell.occlusionCanvas`, the
 * photo's own form shading, kept back from the de-lighting) as an `aoMap`.
 *
 * NoColorSpace, like the normal map and for the same reason: three reads
 * channel R and multiplies it into linear radiance, so an sRGB decode would
 * bend the curve and darken every mid-tone. flipY matches the colour map it
 * shares UVs with.
 */
export function useOcclusionTexture(canvas: HTMLCanvasElement | null | undefined): THREE.CanvasTexture | null {
  const tex = useMemo(() => {
    if (!canvas) return null
    const t = new THREE.CanvasTexture(canvas)
    t.colorSpace = THREE.NoColorSpace
    t.anisotropy = 4
    t.flipY = true
    t.needsUpdate = true
    return t
  }, [canvas])
  useEffect(() => () => tex?.dispose(), [tex])
  return tex
}

/**
 * The garment's OWN colour: the alpha-weighted mean of a cutout photo.
 *
 * WHY MEASURE IT RATHER THAN PICK ONE. The blank reverse of a custom garment
 * used to be flooded with a fixed dark slate, which is a fine colour for a
 * navy tee and a lie about a white polo, a yellow hoodie or a red vest, and it
 * is the surface a customer sees the moment they orbit past 90°. There is no
 * constant that is right here, and there is no need for one: the front photo of
 * the same physical garment is on screen, so the back's colour is a measurement.
 *
 * Alpha-weighted so the background never contributes, and mean rather than
 * modal because a mean of the cloth is stable under the print composited on top
 * (artwork covers a small fraction of the garment) while a histogram peak jumps
 * between the shirt and a large logo. Sampled at 64 px: the answer is one
 * colour, and a bigger read only costs time.
 *
 * DETERMINISM: a fixed-size downscale and a sum. Same canvas ⇒ same hex.
 */
export function garmentTint(canvas: HTMLCanvasElement, fallback: string): string {
  const SCAN = 64
  if (!canvas.width || !canvas.height) return fallback
  const scale = Math.min(1, SCAN / Math.max(canvas.width, canvas.height))
  const w = Math.max(1, Math.round(canvas.width * scale))
  const h = Math.max(1, Math.round(canvas.height * scale))
  const off = document.createElement('canvas')
  off.width = w
  off.height = h
  const ctx = off.getContext('2d', { willReadFrequently: true })
  if (!ctx) return fallback
  ctx.drawImage(canvas, 0, 0, w, h)
  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(0, 0, w, h).data
  } catch {
    return fallback
  }
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a < 128) continue
    r += data[i]
    g += data[i + 1]
    b += data[i + 2]
    n++
  }
  if (n < 8) return fallback
  const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/**
 * Blend a hex colour toward `target` by `t`. Two uses, both on the blank
 * reverse: toward white for the LINING (the inside of a panel reads lighter and
 * flatter than its outside face, whatever colour the cloth is), and toward
 * black for the EMISSIVE floor that keeps a dark garment's back from going to
 * pitch while leaving a white one alone.
 */
export function mixHex(hex: string, target: string, t: number): string {
  const a = /^#?([0-9a-f]{6})$/i.exec(hex)
  const b = /^#?([0-9a-f]{6})$/i.exec(target)
  if (!a || !b) return hex
  const va = parseInt(a[1], 16)
  const vb = parseInt(b[1], 16)
  const ch = (sh: number) => {
    const ca = (va >> sh) & 255
    const cb = (vb >> sh) & 255
    return Math.round(ca + (cb - ca) * t)
  }
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`
}

/**
 * A texture of the source's ALPHA SILHOUETTE flooded with a solid color
 * (used for the blank reverse + thickness rim of custom-garment cards).
 * Redraws when the source version bumps.
 */
export function useSilhouetteTexture(
  src: SourceLike | null | undefined,
  fill: string,
): THREE.CanvasTexture | null {
  const source = src?.canvas ?? null
  const silhouette = useMemo(() => (source ? document.createElement('canvas') : null), [source])
  const tex = useMemo(() => (silhouette ? makeCanvasTexture(silhouette) : null), [silhouette])
  useEffect(() => () => tex?.dispose(), [tex])
  const version = src?.version ?? 0
  useEffect(() => {
    if (!source || !silhouette || !tex) return
    silhouette.width = source.width
    silhouette.height = source.height
    const ctx = silhouette.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, silhouette.width, silhouette.height)
    ctx.drawImage(source, 0, 0)
    ctx.globalCompositeOperation = 'source-in'
    ctx.fillStyle = fill
    ctx.fillRect(0, 0, silhouette.width, silhouette.height)
    ctx.globalCompositeOperation = 'source-over'
    tex.needsUpdate = true
  }, [source, silhouette, tex, fill, version])
  return tex
}
