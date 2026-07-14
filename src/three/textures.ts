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

function makeCanvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  // Canvas row 0 (top) must map to v=1: default flipY=true is correct for
  // both DecalGeometry UVs and PlaneGeometry UVs. Verified with the
  // harness' "TOP" marker.
  tex.flipY = true
  tex.needsUpdate = true
  return tex
}

/**
 * Live texture view of a DecalSource/CardSource canvas.
 * `mirrorX` flips U (u' = 1-u) — used by the custom card's back face, which
 * is a π-rotated plane: without the flip a real back photo would read
 * horizontally mirrored.
 */
export function useSourceTexture(
  src: SourceLike | null | undefined,
  mirrorX = false,
): THREE.CanvasTexture | null {
  const canvas = src?.canvas ?? null
  const tex = useMemo(() => {
    if (!canvas) return null
    const t = makeCanvasTexture(canvas)
    if (mirrorX) {
      t.repeat.x = -1
      t.offset.x = 1
    }
    return t
  }, [canvas, mirrorX])
  useEffect(() => () => tex?.dispose(), [tex])
  const version = src?.version ?? 0
  useEffect(() => {
    if (tex) tex.needsUpdate = true
  }, [tex, version])
  return tex
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
