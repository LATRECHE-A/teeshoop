/**
 * Cheap softness primitives for the garment SVGs.
 *
 * Headless/software rasterizers pay dearly for feGaussianBlur over large
 * regions, so body art fakes soft shadows with (a) 3 concentric strokes of
 * decreasing opacity ("layered stroke") and (b) radial-gradient ellipses.
 * Only the `shade` overlays (small, few) keep a real blur filter.
 */

const LAYERS: ReadonlyArray<readonly [number, number]> = [
  [1, 0.5],
  [1.9, 0.3],
  [3.1, 0.16],
]

function a(n: number): string {
  return String(Math.round(n * 1000) / 1000)
}

/** Layered pseudo-blurred stroke. `alpha` ≈ opacity at the core. */
export function soft(
  d: string,
  alpha: number,
  w: number,
  light = false,
  cap: 'round' | 'butt' = 'round',
): string {
  const c = light ? '255,255,255' : '0,0,0'
  return LAYERS.map(
    ([k, f]) =>
      `<path d="${d}" fill="none" stroke-linecap="${cap}" stroke="rgba(${c},${a(alpha * f)})" stroke-width="${a(w * k)}"/>`,
  ).join('\n')
}

/** Soft elliptical shadow/highlight blob via radial gradient (needs softDefs). */
export function blob(
  p: string,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rot: number,
  opacity: number,
  light = false,
): string {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(${rot} ${cx} ${cy})" fill="url(#${p}-${light ? 'wg' : 'sg'})" opacity="${a(opacity)}"/>`
}

/** Shared gradient stops for `blob` (put inside `<defs>`). */
export function softDefs(p: string): string {
  const stops = (c: string) =>
    `<stop offset="0" stop-color="${c}" stop-opacity="1"/><stop offset="0.45" stop-color="${c}" stop-opacity="0.66"/><stop offset="0.75" stop-color="${c}" stop-opacity="0.26"/><stop offset="1" stop-color="${c}" stop-opacity="0"/>`
  return `<radialGradient id="${p}-sg">${stops('#000')}</radialGradient>
<radialGradient id="${p}-wg">${stops('#fff')}</radialGradient>`
}

/** Fabric grain: feTurbulence rendered once into a small seamless tile. */
export function grainDefs(p: string, seed: number): string {
  return `<filter id="${p}-gf" x="0" y="0" width="100%" height="100%">
<feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="${seed}" stitchTiles="stitch"/>
<feColorMatrix type="matrix" values="0 0 0 0 0.62 0 0 0 0 0.62 0 0 0 0 0.62 0.35 0.35 0.35 0 0"/>
</filter>
<pattern id="${p}-gp" width="160" height="160" patternUnits="userSpaceOnUse">
<rect width="160" height="160" filter="url(#${p}-gf)"/>
</pattern>`
}

/**
 * Grain overlay rect (≤3% opacity per contract). Kept OUTSIDE the main
 * clipped group (self-clipped) — a pattern inside a clipped group knocks
 * Chromium's software rasterizer off its fast path (~5× slower).
 */
export function grainRect(p: string): string {
  return `<rect x="24" y="36" width="752" height="736" fill="url(#${p}-gp)" opacity="0.025" clip-path="url(#${p}-clip)"/>`
}
