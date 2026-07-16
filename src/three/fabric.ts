/**
 * Procedural tileable fabric weave normal map, shared across custom-garment
 * caps. Purely a shading detail (perturbs the fragment normal only), so it never
 * touches geometry, UVs or inch accuracy — it just makes the soft studio light
 * read as cloth grain instead of smooth plastic/paper.
 */
import * as THREE from 'three'

let sharedCanvas: HTMLCanvasElement | null = null

/** Draw a plain-weave height field once and encode it to a tangent-space normal map. */
function weaveCanvas(): HTMLCanvasElement {
  if (sharedCanvas) return sharedCanvas
  const S = 128
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const ctx = c.getContext('2d')
  if (!ctx) return c
  const img = ctx.createImageData(S, S)
  const period = 8 // px per warp/weft thread pair
  // Plain weave: warp threads modulated over/under weft.
  const height = (x: number, y: number): number => {
    const fx = (x / period) * Math.PI * 2
    const fy = (y / period) * Math.PI * 2
    return Math.sin(fx) * Math.cos(fy) + 0.45 * Math.sin(fy) + 0.45 * Math.sin(fx)
  }
  const k = 2.4 // normal steepness — higher is flatter/subtler
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // Toroidal finite differences so the tile is seamless.
      const hL = height((x - 1 + S) % S, y)
      const hR = height((x + 1) % S, y)
      const hD = height(x, (y - 1 + S) % S)
      const hU = height(x, (y + 1) % S)
      let nx = hL - hR
      let ny = hD - hU
      let nz = k
      const len = Math.hypot(nx, ny, nz) || 1
      nx /= len
      ny /= len
      nz /= len
      const p = (y * S + x) * 4
      img.data[p] = Math.round((nx * 0.5 + 0.5) * 255)
      img.data[p + 1] = Math.round((ny * 0.5 + 0.5) * 255)
      img.data[p + 2] = Math.round((nz * 0.5 + 0.5) * 255)
      img.data[p + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  sharedCanvas = c
  return c
}

/**
 * A repeat-wrapped fabric normal texture tiled to roughly physical thread pitch.
 * `repeatX`/`repeatY` = how many tiles across the garment's width/height in
 * inches (≈ inches / 0.9 gives a ~1–2 mm weave). Dispose when the mesh unmounts.
 */
export function fabricNormalTexture(repeatX: number, repeatY: number): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(weaveCanvas())
  t.wrapS = THREE.RepeatWrapping
  t.wrapT = THREE.RepeatWrapping
  t.repeat.set(Math.max(1, repeatX), Math.max(1, repeatY))
  t.colorSpace = THREE.NoColorSpace // normal maps are raw/linear data, not sRGB
  t.anisotropy = 4
  t.needsUpdate = true
  return t
}
