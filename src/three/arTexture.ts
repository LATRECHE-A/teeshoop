/**
 * Power-of-two canvas → texture helpers, shared by the AR exporter
 * (src/lib/arExport.ts) and the worn-custom-garment builder
 * (src/three/wornCustom.ts).
 *
 * Both the GLB/USDZ export AND the live 3D preview go through the SAME builder,
 * so textures are authored power-of-two ≤ 2048 here — mandatory for Android
 * Scene Viewer / Filament and harmless for the WebGL2 preview.
 */
import * as THREE from 'three'

/** Scene Viewer / Quick Look texture ceiling. */
export const MAX_TEX = 2048

/** Nearest power-of-two (mobile GPUs mip cleanly only on POT). */
export function nearestPow2(n: number): number {
  return Math.pow(2, Math.round(Math.log2(Math.max(1, n))))
}

/** Redraw a canvas at power-of-two dimensions (≤ MAX_TEX). */
export function potCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const w = Math.min(MAX_TEX, Math.max(64, nearestPow2(src.width)))
  const h = Math.min(MAX_TEX, Math.max(64, nearestPow2(src.height)))
  if (w === src.width && h === src.height) return src
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) return src
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, w, h)
  return c
}

/** A POT sRGB CanvasTexture (flipY=true — correct for PlaneGeometry + the
 *  inflated-shell UVs, verified against the harness "TOP" marker). */
export function canvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(potCanvas(canvas))
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  tex.needsUpdate = true
  return tex
}
