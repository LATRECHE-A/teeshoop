/**
 * Cheap softness primitives for the garment SVGs.
 *
 * Headless/software rasterizers pay dearly for feGaussianBlur over large
 * regions, so body art fakes soft shadows with (a) layered strokes of
 * decreasing opacity and (b) radial-gradient ellipses. Only the `shade`
 * overlays (small, few) keep a real blur filter. `d` may contain several
 * `M…` subpaths: merging same-style strokes keeps the SVGs small.
 */

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
  const c = light ? '#fff' : '#000'
  const line = (o: number, sw: number) =>
    `<path d="${d}" fill="none" stroke-linecap="${cap}" stroke="${c}" stroke-opacity="${a(o)}" stroke-width="${a(sw)}"/>`
  // faint lines don't need layering: one wider stroke reads the same
  if (alpha < 0.075) return line(alpha * 0.85, w * 1.6)
  return `${line(alpha * 0.55, w)}\n${line(alpha * 0.34, w * 2.2)}`
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
    `<stop offset="0" stop-color="${c}" stop-opacity="1"/><stop offset="0.55" stop-color="${c}" stop-opacity="0.55"/><stop offset="1" stop-color="${c}" stop-opacity="0"/>`
  return `<radialGradient id="${p}-sg">${stops('#000')}</radialGradient>
<radialGradient id="${p}-wg">${stops('#fff')}</radialGradient>`
}

/** Fabric grain: feTurbulence rendered once into a small seamless tile. */
export function grainDefs(p: string, seed: number): string {
  return `<filter id="${p}-gf" x="0" y="0" width="100%" height="100%">
<feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="${seed}" stitchTiles="stitch"/>
<feColorMatrix type="matrix" values="0 0 0 0 0.62 0 0 0 0 0.62 0 0 0 0 0.62 0.35 0.35 0.35 0 0"/>
</filter>
<pattern id="${p}-gp" width="96" height="96" patternUnits="userSpaceOnUse">
<rect width="96" height="96" filter="url(#${p}-gf)"/>
</pattern>`
}

/**
 * Grain overlay rect (≤3% opacity per contract). Kept OUTSIDE the main
 * clipped group (self-clipped): a pattern inside a clipped group knocks
 * Chromium's software rasterizer off its fast path (~5× slower).
 */
export function grainRect(p: string): string {
  return `<rect x="24" y="36" width="752" height="736" fill="url(#${p}-gp)" opacity="0.025" clip-path="url(#${p}-clip)"/>`
}
