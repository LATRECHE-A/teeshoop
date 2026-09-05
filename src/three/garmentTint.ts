/**
 * La couleur moyenne d'un vêtement, lue sur son propre canevas.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI ELLE A QUITTÉ `src/three/textures.ts`
 *
 * Ce fichier-là mélange des crochets React (`useMemo`, `useEffect`) et des
 * fonctions pures. `src/lib/arExport.ts` n'en voulait QUE celle-ci, et
 * l'empaqueteur le sait (aucun morceau construit ne porte React), mais un
 * parcours du graphe des sources voit l'arête et ne peut pas savoir qu'elle
 * disparaîtra : `scripts/editeur-guard.mjs` a donc rapporté React comme
 * atteignable depuis l'éditeur de la boutique, le 5 septembre 2026.
 *
 * Une garde qui doit croire l'empaqueteur sur parole n'est pas une garde. La
 * fonction pure est ici, `textures.ts` la réexporte pour ses appelants React, et
 * l'arête a disparu parce qu'elle n'existe plus, pas parce qu'on a assoupli le
 * contrôle.
 */
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
