/**
 * Dev harness for the custom-garment shell — the 3-tier depth ladder, on real
 * garments.
 *
 * Case 0 is a synthetic laid-flat tee (deterministic, no network, no model):
 * it is what scripts/inflate-verify.mjs asserts the hollow invariants against.
 * Cases 1..n are REAL supplier flat-lays from public/catalog/imbretex, put
 * through the SAME background removal the app uses (u2netp, src/lib/bgremove)
 * and composited with a print, so what is measured here is what a customer
 * gets — not a hand-drawn stand-in that happens to suit the algorithm.
 *
 * Every case can be built twice: `template` (tier 1, a real garment's depth
 * field graded onto the photo) and `poisson` (tier 2, the balloon that shipped
 * before). That A/B is the whole point of the harness — the verifier renders
 * both and prints the shape statistics side by side.
 *
 * Rendering is a RAW three.js scene with preserveDrawingBuffer so the
 * framebuffer can be read back headlessly (swiftshader-safe), mirroring
 * ExtrudedGarment's materials exactly. Default view: a 2×2 grid — front,
 * three-quarter, top-down-into-the-neck, grazing-light — the four angles the
 * hollow read must survive. Exposes window.__inflate.
 *
 * NOTE for the driver: this page spawns the bg-removal Worker, so it never goes
 * network-idle. Navigate with waitUntil: 'load' and poll window.__inflate.
 */
import * as THREE from 'three'
import {
  buildInflatedShell,
  canvasToSilhouette,
  getLastSilhouetteReject,
  measureGarmentPhoto,
  type InflatedShell,
  type SilhouetteReject,
} from '@/lib/silhouette'
import { TEMPLATE_DEPTH, type TemplateId } from '@/lib/templateDepthData'
import {
  classifyShape,
  getLastShapeGuess,
  profileMask,
  SHAPE_TEMPLATE,
  type GarmentShape,
  type MaskProfile,
  type ShapeGuess,
} from '@/lib/garmentShape'
import { getLastTemplateFit, type TemplateFit } from '@/lib/templateDepth'
import { removeBackground } from '@/lib/bgremove'
import { fabricNormalTexture } from '@/three/fabric'

const WIN = 20
const HIN = 24
const PPI = 54
/** Long edge of the working composite — matches the app's renderMockup scale. */
const PHOTO_EDGE = 1000

interface Case {
  id: string
  label: string
  /** null = a synthetic drawing keyed on `id`; otherwise a supplier photo id. */
  photo: string | null
  /** Real-world laid-flat width, inches (the number the setup modal collects). */
  widthIn: number
  /**
   * What this case is FOR.
   *  garment     — must reach tier 1 with the expected donor.
   *  negative    — not a garment: must be refused and land on the balloon.
   *  untraceable — a real upload the outline tracer must refuse OUTRIGHT, so
   *                the app shows the tier-3 card. Without one of these the
   *                bottom rung of the ladder is never exercised at all.
   */
  kind: 'garment' | 'negative' | 'untraceable'
  /**
   * How the supplier photo is prepared, for the cases whose whole point is that
   * the customer's upload is not a clean flat-lay.
   *  'hanger'  — the garment still on its hanger, the hook protruding above the
   *              collar as a small DISCONNECTED component (a hook passes through
   *              the collar opening, so it touches no cloth).
   *  'bigprint'— a large dark chest graphic, i.e. artwork that the de-lighting's
   *              low-frequency shading estimate can mistake for a shadow.
   *  'raw'     — NO background removal: the JPEG as it came off the supplier,
   *              opaque corner to corner.
   */
  prep?: 'hanger' | 'bigprint' | 'raw'
}

/**
 * The positives span every garment family a print shop sells and every branch
 * of the classifier: armhole holes (vest), a hood lobe (hoods), a cuff beside
 * the hem (long sleeves), a placket that splits the silhouette (full zip), an
 * oversize body and a kid's cut at the extremes of aspect, and the short-sleeve
 * bodies that must not be mistaken for any of them.
 *
 * The negatives are the other four things a customer can plausibly upload to a
 * print shop. They are synthetic on purpose: a tote, a mug, a poster and a cap
 * drawn from primitives are unarguable about what they are, they need no
 * network and no cutout model, and they are deterministic — which is what lets
 * the verifier assert a SEPARATION rather than a single hand-picked refusal.
 */
const CASES: Case[] = [
  { id: 'synthetic', label: 'synthetic tee', photo: null, widthIn: WIN, kind: 'garment' },
  { id: 'tote', label: 'tote bag · NEGATIVE', photo: null, widthIn: 15, kind: 'negative' },
  { id: 'mug', label: 'mug · NEGATIVE', photo: null, widthIn: 5, kind: 'negative' },
  { id: 'poster', label: 'poster · NEGATIVE', photo: null, widthIn: 18, kind: 'negative' },
  { id: 'cap', label: 'cap · NEGATIVE', photo: null, widthIn: 9, kind: 'negative' },
  { id: 'person', label: 'person wearing it · NEGATIVE', photo: null, widthIn: 20, kind: 'negative' },
  {
    id: 'hanger',
    label: '190402 ON A HANGER · awkward',
    photo: '190402',
    widthIn: 20,
    kind: 'garment',
    prep: 'hanger',
  },
  {
    id: 'bigprint',
    label: '75078 + huge dark graphic · awkward',
    photo: '75078',
    widthIn: 22,
    kind: 'garment',
    prep: 'bigprint',
  },
  {
    id: 'nobg',
    label: '190402 NOT cut out · awkward',
    photo: '190402',
    widthIn: 20,
    kind: 'untraceable',
    prep: 'raw',
  },
  { id: '190402', label: 'SUPER T · tee', photo: '190402', widthIn: 20, kind: 'garment' },
  { id: '190608', label: 'POP TEE · tee', photo: '190608', widthIn: 20, kind: 'garment' },
  { id: '191052', label: 'URBAN OVERSIZE · tee', photo: '191052', widthIn: 23, kind: 'garment' },
  { id: '75369', label: 'LADY COMFORT V-NECK · tee', photo: '75369', widthIn: 18, kind: 'garment' },
  { id: '74606', label: 'KID UNISEX · tee', photo: '74606', widthIn: 15, kind: 'garment' },
  { id: '202358', label: 'LUX POLO MEN · polo', photo: '202358', widthIn: 20, kind: 'garment' },
  { id: '171722', label: 'SPIRIT MEN · polo', photo: '171722', widthIn: 20, kind: 'garment' },
  { id: '143100', label: "WOMEN'S COOL VEST · tank", photo: '143100', widthIn: 17, kind: 'garment' },
  { id: '75368', label: 'REGULAR T-SHIRT LS · long sleeve', photo: '75368', widthIn: 21, kind: 'garment' },
  { id: '145165', label: 'LADY REGULAR LS · long sleeve', photo: '145165', widthIn: 18, kind: 'garment' },
  { id: '74958', label: 'MAN LS POLO · long sleeve', photo: '74958', widthIn: 21, kind: 'garment' },
  { id: '75078', label: 'SWEATSHIRT UNISEX · crew sweat', photo: '75078', widthIn: 22, kind: 'garment' },
  { id: '180711', label: 'TOUR CREW · crew sweat', photo: '180711', widthIn: 22, kind: 'garment' },
  { id: '75079', label: 'FULL ZIP SWEATSHIRT · crew sweat', photo: '75079', widthIn: 22, kind: 'garment' },
  { id: '180712', label: 'COSY HOOD · hoodie', photo: '180712', widthIn: 23, kind: 'garment' },
  { id: '75149', label: 'KANGAROO SWEATSHIRT · hoodie', photo: '75149', widthIn: 22, kind: 'garment' },
  { id: '75196', label: 'HOODED SWEATSHIRT · hoodie', photo: '75196', widthIn: 22, kind: 'garment' },
  { id: '201270', label: 'VIBE HOOD · hoodie', photo: '201270', widthIn: 23, kind: 'garment' },
]

type Mode = 'template' | 'poisson'
/** Cloth thickness on / off. `'off'` reproduces the pre-thickness geometry, and
 *  is what every rim assertion is run against as its own negative control. */
type Rim = 'on' | 'off'

// --------------------------------------------------------------- test garments

/** A crew-neck tee silhouette (transparent bg) with an enclosed collar hole,
 * soft photo folds and a printed chest design — enough to exercise silhouette
 * + holes + decal + the photo-derived wrinkle bands. */
function drawShirt(canvas: HTMLCanvasElement) {
  canvas.width = Math.round(WIN * PPI)
  canvas.height = Math.round(HIN * PPI)
  const ctx = canvas.getContext('2d')!
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)

  const grad = ctx.createLinearGradient(0, 0, 0, h)
  grad.addColorStop(0, '#26324a')
  grad.addColorStop(1, '#1a2740')
  ctx.fillStyle = grad

  // sleeves
  const sleeve = (s: 1 | -1) => {
    ctx.save()
    ctx.translate(w / 2 + s * w * 0.34, h * 0.2)
    ctx.rotate(s * 0.5)
    ctx.beginPath()
    ctx.roundRect(-w * 0.1, 0, w * 0.2, h * 0.34, 40)
    ctx.fill()
    ctx.restore()
  }
  sleeve(1)
  sleeve(-1)

  // body
  ctx.beginPath()
  ctx.roundRect(w * 0.2, h * 0.12, w * 0.6, h * 0.8, 48)
  ctx.fill()
  // shoulders
  ctx.beginPath()
  ctx.ellipse(w / 2, h * 0.16, w * 0.3, h * 0.08, 0, 0, Math.PI * 2)
  ctx.fill()

  // Soft photographic folds (deterministic): the wrinkle normal map and the
  // mid-frequency Z band read these — a flat gradient would give them nothing.
  // source-atop keeps the blurred strokes inside the garment alpha.
  ctx.save()
  ctx.globalCompositeOperation = 'source-atop'
  ctx.filter = 'blur(9px)'
  ctx.lineCap = 'round'
  const folds: Array<[number, number, number, number, number, string]> = [
    [0.36, 0.5, 0.4, 0.9, 14, 'rgba(8,12,24,0.5)'],
    [0.5, 0.55, 0.47, 0.92, 10, 'rgba(10,14,26,0.42)'],
    [0.63, 0.48, 0.66, 0.9, 13, 'rgba(8,12,24,0.5)'],
    [0.44, 0.62, 0.38, 0.88, 7, 'rgba(120,140,190,0.28)'],
    [0.57, 0.6, 0.62, 0.86, 8, 'rgba(120,140,190,0.25)'],
    [0.3, 0.7, 0.34, 0.9, 9, 'rgba(6,10,20,0.4)'],
    [0.7, 0.68, 0.68, 0.9, 9, 'rgba(6,10,20,0.4)'],
  ]
  for (const [x0, y0, x1, y1, lw, col] of folds) {
    ctx.strokeStyle = col
    ctx.lineWidth = lw
    ctx.beginPath()
    ctx.moveTo(w * x0, h * y0)
    ctx.quadraticCurveTo(w * ((x0 + x1) / 2 + 0.03), h * ((y0 + y1) / 2), w * x1, h * y1)
    ctx.stroke()
  }
  ctx.restore()

  // enclosed crew collar hole (punch transparent) — punched AFTER the folds so
  // nothing bleeds into the opening.
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  ctx.beginPath()
  ctx.ellipse(w / 2, h * 0.15, w * 0.11, h * 0.05, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  drawPrint(ctx, w, h, 0.4)
}

/**
 * NEGATIVE CONTROL: a tote bag. Printable, plausible as an upload, and not a
 * garment either donor mesh describes — a straight-sided box with two handle
 * loops where a collar and shoulders should be. It exists to put a number on
 * the other side of the IoU gate: a threshold justified only by the garments it
 * accepts is half a calibration.
 */
function drawTote(canvas: HTMLCanvasElement) {
  canvas.width = Math.round(15 * PPI)
  canvas.height = Math.round(17 * PPI)
  const ctx = canvas.getContext('2d')!
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#3a4152'
  // Body: a straight-sided box filling the lower three quarters.
  ctx.beginPath()
  ctx.roundRect(w * 0.08, h * 0.3, w * 0.84, h * 0.66, 18)
  ctx.fill()
  // Two handle loops, drawn as thick arcs so the mask has enclosed holes.
  ctx.strokeStyle = '#3a4152'
  ctx.lineWidth = w * 0.055
  for (const s of [-1, 1] as const) {
    ctx.beginPath()
    ctx.arc(w / 2 + s * w * 0.22, h * 0.31, w * 0.13, Math.PI, 0)
    ctx.stroke()
  }
  drawPrint(ctx, w, h, 0.55)
}

/**
 * NEGATIVE: a mug. Straight sides, a flat lid and a flat base, and a C handle
 * on ONE side — the only case in the set that is strongly asymmetric, and the
 * one whose handle encloses a hole that is neither an armhole nor a collar.
 */
function drawMug(canvas: HTMLCanvasElement) {
  canvas.width = Math.round(5 * PPI * 2)
  canvas.height = Math.round(4.5 * PPI * 2)
  const ctx = canvas.getContext('2d')!
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#cfd4dc'
  ctx.beginPath()
  ctx.roundRect(w * 0.08, h * 0.06, w * 0.6, h * 0.88, 14)
  ctx.fill()
  ctx.strokeStyle = '#cfd4dc'
  ctx.lineWidth = w * 0.075
  ctx.beginPath()
  ctx.arc(w * 0.68, h * 0.5, h * 0.24, -Math.PI / 2, Math.PI / 2)
  ctx.stroke()
  drawPrint(ctx, w * 0.62, h, 0.5)
}

/**
 * NEGATIVE: a flat poster. The degenerate case — a rectangle, no openings, no
 * taper, nothing above the "shoulders" because there are none. If any gate ever
 * lets a garment template onto this, the gate is not a gate.
 */
function drawPoster(canvas: HTMLCanvasElement) {
  canvas.width = Math.round(18 * PPI)
  canvas.height = Math.round(24 * PPI)
  const ctx = canvas.getContext('2d')!
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#e7e2d6'
  // Inset, i.e. photographed and cut out rather than filling the frame — a
  // full-bleed rectangle is refused one gate earlier (no cutout at all), which
  // would make this a test of `canvasToSilhouette` instead of the shape gate.
  ctx.fillRect(w * 0.06, h * 0.04, w * 0.88, h * 0.92)
  drawPrint(ctx, w, h, 0.42)
}

/**
 * NEGATIVE: a five-panel cap, front on. A dome over a brim: widest at the very
 * bottom like a long sleeve is, but with no neck, no shoulder line and no
 * torso — the case that proves the tells are read together and not one at a
 * time.
 */
function drawCap(canvas: HTMLCanvasElement) {
  canvas.width = Math.round(9 * PPI)
  canvas.height = Math.round(6 * PPI)
  const ctx = canvas.getContext('2d')!
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#2f3a4c'
  // Brim: a wide shallow ellipse across the bottom.
  ctx.beginPath()
  ctx.ellipse(w / 2, h * 0.8, w * 0.49, h * 0.19, 0, 0, Math.PI * 2)
  ctx.fill()
  // Crown: a dome sitting on it.
  ctx.beginPath()
  ctx.ellipse(w / 2, h * 0.8, w * 0.33, h * 0.72, 0, Math.PI, Math.PI * 2)
  ctx.fill()
  drawPrint(ctx, w * 0.7, h, 0.62)
}

/**
 * NEGATIVE: a person, standing, arms at their sides.
 *
 * The case the other four cannot make, and the likeliest wrong upload there is —
 * a customer photographs a friend WEARING the shirt. A tote, a mug, a poster and
 * a cap are each refused because they lack a collar, cloth at the top, or a
 * shoulder line; a person has all three (a head is narrower than the shoulders
 * it sits on, it is solid, and the shoulders arrive high), so every structural
 * tell reads "garment" on it. If anything refuses it, it is the template FIT —
 * and if nothing does, the customer gets a t-shirt's depth field wrapped around
 * a body, which is why this case is in the set whatever the answer turns out to
 * be.
 */
function drawPerson(canvas: HTMLCanvasElement) {
  canvas.width = 560
  canvas.height = 1460
  const ctx = canvas.getContext('2d')!
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  const cx = w / 2
  ctx.fillStyle = '#7a6a5c'
  // head + neck
  ctx.beginPath()
  ctx.ellipse(cx, h * 0.075, w * 0.14, h * 0.062, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.roundRect(cx - w * 0.058, h * 0.115, w * 0.116, h * 0.045, 10)
  ctx.fill()
  // torso: shoulders out to the deltoids, waist in, hips out again
  ctx.beginPath()
  ctx.moveTo(cx - w * 0.3, h * 0.185)
  ctx.quadraticCurveTo(cx - w * 0.33, h * 0.28, cx - w * 0.22, h * 0.4)
  ctx.quadraticCurveTo(cx - w * 0.19, h * 0.47, cx - w * 0.24, h * 0.55)
  ctx.lineTo(cx + w * 0.24, h * 0.55)
  ctx.quadraticCurveTo(cx + w * 0.19, h * 0.47, cx + w * 0.22, h * 0.4)
  ctx.quadraticCurveTo(cx + w * 0.33, h * 0.28, cx + w * 0.3, h * 0.185)
  ctx.quadraticCurveTo(cx, h * 0.145, cx - w * 0.3, h * 0.185)
  ctx.fill()
  // arms hanging just clear of the torso, and legs with daylight between them
  ctx.lineCap = 'round'
  ctx.lineWidth = w * 0.1
  ctx.strokeStyle = '#7a6a5c'
  for (const s of [-1, 1] as const) {
    ctx.beginPath()
    ctx.moveTo(cx + s * w * 0.28, h * 0.215)
    ctx.quadraticCurveTo(cx + s * w * 0.36, h * 0.36, cx + s * w * 0.32, h * 0.52)
    ctx.stroke()
  }
  ctx.lineWidth = w * 0.15
  for (const s of [-1, 1] as const) {
    ctx.beginPath()
    ctx.moveTo(cx + s * w * 0.13, h * 0.54)
    ctx.quadraticCurveTo(cx + s * w * 0.16, h * 0.76, cx + s * w * 0.13, h * 0.96)
    ctx.stroke()
  }
  // Soft photographic modelling so the de-lighting has a gradient to read.
  ctx.save()
  ctx.globalCompositeOperation = 'source-atop'
  const g = ctx.createLinearGradient(0, 0, w, 0)
  g.addColorStop(0, 'rgba(0,0,0,0.35)')
  g.addColorStop(0.42, 'rgba(255,255,255,0.18)')
  g.addColorStop(1, 'rgba(0,0,0,0.3)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  ctx.restore()
  drawPrint(ctx, w, h * 0.62, 0.3)
}

/**
 * The garment still on its HANGER: the hook drawn above the collar as its own
 * component, because that is what a cutout of that photo really contains — a
 * hook passes through the collar OPENING and so touches no cloth at all. It
 * therefore lands in `canvasToSilhouette`'s "small foreign loop" bucket and is
 * ignored for tracing, while still being part of the alpha bbox the row profile
 * is measured over — which is exactly the trap: every structural tell is a
 * fraction of the garment's own height, and the hook makes that height bigger.
 */
function withHanger(src: HTMLCanvasElement): HTMLCanvasElement {
  const hook = Math.round(src.height * 0.11)
  const c = document.createElement('canvas')
  c.width = src.width
  c.height = src.height + hook
  const ctx = c.getContext('2d')!
  ctx.drawImage(src, 0, hook)
  ctx.strokeStyle = '#8d93a0'
  ctx.lineWidth = Math.max(3, Math.round(src.width * 0.012))
  ctx.lineCap = 'round'
  const cx = c.width / 2
  ctx.beginPath()
  ctx.arc(cx, hook * 0.3, hook * 0.24, Math.PI * 0.85, Math.PI * 2.1)
  ctx.moveTo(cx, hook * 0.3)
  ctx.lineTo(cx, hook * 0.93) // stops short of the cloth: a separate component
  ctx.stroke()
  return c
}

/**
 * A LARGE, DARK chest graphic — the artwork most likely to be mistaken for
 * shading. De-lighting estimates the photo's lighting with a wide blur
 * (photoLight.shadeRadius = 8.5 % of the long edge), and a print this size is
 * wider than that blur, so it enters the estimate as if it were a shadow: the
 * correction then tries to brighten the customer's own ink. The same low
 * frequencies drive the mid-band that displaces Z, so the print can also emboss
 * itself into the cloth as relief.
 */
function withBigPrint(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = src.width
  c.height = src.height
  const ctx = c.getContext('2d')!
  ctx.drawImage(src, 0, 0)
  ctx.save()
  ctx.globalCompositeOperation = 'source-atop' // stay inside the garment alpha
  ctx.fillStyle = '#101216'
  ctx.beginPath()
  ctx.roundRect(c.width * 0.24, c.height * 0.24, c.width * 0.52, c.height * 0.38, c.width * 0.04)
  ctx.fill()
  ctx.fillStyle = '#f2f4f8'
  ctx.font = `900 ${Math.round(c.width * 0.11)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('HEAVY', c.width * 0.5, c.height * 0.43)
  ctx.restore()
  return c
}

/** The stand-in customer artwork: a star + wordmark on the chest. */
function drawPrint(ctx: CanvasRenderingContext2D, w: number, h: number, atY: number) {
  ctx.save()
  ctx.translate(w / 2, h * atY)
  ctx.fillStyle = '#ffc940'
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? w * 0.12 : w * 0.05
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = `800 ${Math.round(w * 0.085)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('TSHOP', 0, h * 0.13)
  ctx.restore()
}

/** Fetch a supplier flat-lay, cut it out with the app's own u2netp pipeline,
 *  and composite the print — i.e. exactly what renderMockup produces.
 *  `raw` skips the cutout entirely: an opaque JPEG, which is what a customer
 *  uploads when background removal is unsupported or was switched off. */
async function loadSupplierGarment(id: string, raw = false): Promise<HTMLCanvasElement> {
  const res = await fetch(`/catalog/imbretex/img/${id}-front.jpg`)
  if (!res.ok) throw new Error(`photo ${id}: HTTP ${res.status}`)
  const blob = await res.blob()
  const cut = raw ? blob : await removeBackground(blob)
  const bmp = await createImageBitmap(cut)
  const scale = Math.min(1, PHOTO_EDGE / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(2, Math.round(bmp.width * scale))
  canvas.height = Math.max(2, Math.round(bmp.height * scale))
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  drawPrint(ctx, canvas.width, canvas.height, 0.42)
  return canvas
}

/** Front alpha silhouette flooded with a fabric tone (blank back). */
function silhouetteCanvas(src: HTMLCanvasElement, fill: string): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = src.width
  c.height = src.height
  const ctx = c.getContext('2d')!
  ctx.drawImage(src, 0, 0)
  ctx.globalCompositeOperation = 'source-in'
  ctx.fillStyle = fill
  ctx.fillRect(0, 0, c.width, c.height)
  return c
}

function tex(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  t.flipY = true
  t.needsUpdate = true
  return t
}

function normalTex(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = THREE.NoColorSpace
  t.anisotropy = 4
  t.flipY = true
  t.needsUpdate = true
  return t
}

function gradientEnv(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = 32
  c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, 128)
  g.addColorStop(0, '#eef3fb')
  g.addColorStop(0.5, '#aab6c6')
  g.addColorStop(1, '#3a3630')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 32, 128)
  const t = new THREE.CanvasTexture(c)
  t.mapping = THREE.EquirectangularReflectionMapping
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// -------------------------------------------------------------- shape metrics

interface ShapeStats {
  /** Where the depth actually lives, as a fraction of garment height from the
   *  top (weighted by z⁴ so the peak dominates). A Poisson balloon puts it on
   *  the medial axis, i.e. mid-torso; a garment carries it at the chest. */
  peakFromTop: number
  /** Mean depth over the shoulder band (6–18 % from the top), relative to the
   *  deepest point. A Poisson solution vanishes quadratically at the boundary,
   *  so its shoulders are paper; a real garment's shoulders are the top of a
   *  torso and carry most of its depth. */
  shoulderFill: number
  /** Fraction of the chest row's width that is within 15 % of that row's
   *  deepest point. A cloth cross-section is flat-topped; a dome is not. */
  chestFlat: number
  /** Deepest point, inches (front sheet only). */
  zMax: number
  /**
   * ROW-TO-ROW ROUGHNESS of the depth field, as a fraction of its own peak.
   *
   * This is not a nicety, it is the thing that decides whether a transplanted
   * garment reads as cloth. Normals are computed FROM this field, so a step
   * between two vertically adjacent rows becomes a crease with a hard black
   * shadow in it — and the depth field of a real garment mesh has no such
   * steps, which is why the donor's own numbers are printed as the reference
   * every shell is measured against.
   *
   * `maxSlope` is the steepest |dz/dy| and `rmsCurv` the RMS |d²z/dy²|, both in
   * units of (peak depth) per (garment height) so a 96-row template and a
   * 130-row shell are directly comparable — a raw per-row difference would just
   * measure the grid.
   *
   * MEASURED OVER THE GARMENT'S BODY, NOT ITS RIM. Requiring only that the
   * vertical neighbours be inside the mask is not enough: at the silhouette the
   * depth ramps from zero to full over a couple of rows, and that ramp is the
   * outline rather than an artefact — a real garment's shoulder is still thick
   * at its seam, so a transplanted field is SUPPOSED to rise there faster than
   * a balloon whose solution vanishes quadratically at the boundary. Reading it
   * anyway put the rim ramp on top of every number and buried the thing being
   * looked for. So the window is: all four neighbours inside AND the depth
   * already past a quarter of the peak.
   */
  maxSlope: number
  rmsCurv: number
}

/** Shape statistics of a (z field, coverage) pair on a regular grid. */
function shapeStats(z: Float32Array, inside: Uint8Array, gx: number, gy: number, zScale = 1): ShapeStats {
  const rowMax = new Float32Array(gy)
  const rowSpan = new Int32Array(gy)
  let zMax = 0
  for (let j = 0; j < gy; j++) {
    let m = 0
    let n = 0
    for (let i = 0; i < gx; i++) {
      const k = j * gx + i
      if (!inside[k]) continue
      n++
      if (z[k] > m) m = z[k]
    }
    rowMax[j] = m
    rowSpan[j] = n
    if (m > zMax) zMax = m
  }
  let num = 0
  let den = 0
  for (let j = 0; j < gy; j++) {
    const w = Math.pow(rowMax[j], 4)
    num += w * j
    den += w
  }
  const peakFromTop = den > 0 ? num / den / Math.max(1, gy - 1) : 0
  // Chest row: the widest row in the upper-middle third, i.e. below the
  // shoulders and above the hem taper — where a garment is fullest.
  let chestRow = Math.round(gy * 0.42)
  let best = -1
  for (let j = Math.round(gy * 0.3); j <= Math.round(gy * 0.6); j++) {
    if (rowSpan[j] > best) {
      best = rowSpan[j]
      chestRow = j
    }
  }
  let flat = 0
  let span = 0
  const thr = rowMax[chestRow] * 0.85
  for (let i = 0; i < gx; i++) {
    const k = chestRow * gx + i
    if (!inside[k]) continue
    span++
    if (z[k] >= thr) flat++
  }
  let shSum = 0
  let shN = 0
  for (let j = Math.round(gy * 0.06); j <= Math.round(gy * 0.18); j++) {
    for (let i = 0; i < gx; i++) {
      const k = j * gx + i
      if (!inside[k]) continue
      shSum += z[k]
      shN++
    }
  }
  // Row-to-row roughness over interior points only (both vertical neighbours
  // inside), normalised by the field's own peak so tiers and templates compare.
  let maxRowStep = 0
  let sq = 0
  let nRough = 0
  const bodyFloor = 0.25 * zMax
  for (let j = 1; j < gy - 1; j++) {
    for (let i = 1; i < gx - 1; i++) {
      const k = j * gx + i
      if (!inside[k] || !inside[k - gx] || !inside[k + gx] || !inside[k - 1] || !inside[k + 1]) continue
      if (z[k] < bodyFloor || z[k - gx] < bodyFloor || z[k + gx] < bodyFloor) continue
      const step = Math.abs(z[k + gx] - z[k])
      if (step > maxRowStep) maxRowStep = step
      const d2 = z[k - gx] - 2 * z[k] + z[k + gx]
      sq += d2 * d2
      nRough++
    }
  }
  // dy = 1 / (gy − 1) of the garment's height, so a per-row difference becomes
  // a slope by multiplying by (gy − 1) and a second difference by its square.
  const R = Math.max(1, gy - 1)
  const norm = zMax > 0 ? zMax : 1
  return {
    peakFromTop,
    shoulderFill: shN > 0 && zMax > 0 ? shSum / shN / zMax : 0,
    chestFlat: span > 0 ? flat / span : 0,
    zMax: zMax * zScale,
    maxSlope: (maxRowStep * R) / norm,
    rmsCurv: ((nRough > 0 ? Math.sqrt(sq / nRough) : 0) * R * R) / norm,
  }
}

/** The same statistics read straight off a baked template — the reference the
 *  shell is trying to reproduce, decoded here so the harness never depends on
 *  templateDepth.ts's internals. */
function templateStats(id: TemplateId): ShapeStats {
  const blob = TEMPLATE_DEPTH[id]
  const bin = atob(blob.front)
  const n = blob.w * blob.h
  const z = new Float32Array(n)
  const inside = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const b = bin.charCodeAt(i)
    if (b === 0) continue
    inside[i] = 1
    z[i] = (b - 1) / 254
  }
  return shapeStats(z, inside, blob.w, blob.h)
}

// ------------------------------------------------------- calibration readout

/**
 * The row profile the classifier actually sees, flattened to plain arrays.
 *
 * Thresholds in garmentShape.ts are the one part of this pipeline that is pure
 * calibration, and calibrating them against imagined silhouettes is how a
 * classifier ends up believing every supplier photo is a flat-lay. This dumps
 * the real thing — per row, normalised to the garment's own box, so a photo and
 * a template are directly comparable.
 */
interface ProfileDump {
  h: number
  top: number
  bottom: number
  /** Outer extent per row (r1 − l0), in cells. */
  outer: number[]
  /** Body-run width per row (b1 − b0), in cells. */
  body: number[]
  /** Cells of cloth per row — outer extent minus the air between runs. */
  area: number[]
  /** Runs per row. */
  runs: number[]
  /** Topmost row per column, over the garment's own column span. */
  topEdge: number[]
  maxW: number
  bodyW: number
  cx: number
}

function dumpProfile(p: MaskProfile): ProfileDump {
  const outer: number[] = []
  const body: number[] = []
  const area: number[] = []
  const runs: number[] = []
  for (let y = p.top; y <= p.bottom; y++) {
    outer.push(p.r1[y] - p.l0[y])
    body.push(p.b1[y] - p.b0[y])
    area.push(p.rowArea[y])
    runs.push(p.runs[y])
  }
  return {
    h: p.h,
    top: p.top,
    bottom: p.bottom,
    outer,
    body,
    area,
    runs,
    topEdge: Array.from(p.topEdge),
    maxW: p.maxW,
    bodyW: p.bodyW,
    cx: p.cx,
  }
}

/** Coverage grid of a baked template, as `profileMask` wants it. */
function templateProfile(id: TemplateId): ProfileDump | null {
  const blob = TEMPLATE_DEPTH[id]
  const bin = atob(blob.front)
  const cov = new Uint8Array(blob.w * blob.h)
  for (let i = 0; i < cov.length; i++) cov[i] = bin.charCodeAt(i) === 0 ? 0 : 1
  const p = profileMask(cov, blob.w, blob.h, blob.w, 0)
  return p ? dumpProfile(p) : null
}

// ------------------------------------------------------------------ the scene

const PANEL_W = 580
const PANEL_H = 440
const CANVAS_W = PANEL_W * 2
const CANVAS_H = PANEL_H * 2

const renderer = new THREE.WebGLRenderer({ alpha: false, antialias: true, preserveDrawingBuffer: true })
renderer.setPixelRatio(1)
renderer.setSize(CANVAS_W, CANVAS_H)
renderer.setClearColor(0x0c0f13, 1)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05
const root = document.getElementById('root')!
root.style.position = 'relative'
root.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.environment = gradientEnv()

const hemi = new THREE.HemisphereLight(0xf2f5ff, 0x30302c, 0.5)
scene.add(hemi)
const key = new THREE.DirectionalLight(0xffffff, 2.2)
key.position.set(-6, 10, 12)
scene.add(key)
// Grazing key: nearly in the sheet plane, raking across the folds.
const grazeKey = new THREE.DirectionalLight(0xfff2df, 3.2)
grazeKey.position.set(28, 12, 2.5)
grazeKey.visible = false
scene.add(grazeKey)
const fill = new THREE.DirectionalLight(0xbcd3ff, 0.5)
fill.position.set(8, 4, -6)
scene.add(fill)

const group = new THREE.Group()
scene.add(group)

// ------------------------------------------------------------- build + rebuild

interface Built {
  caseId: string
  mode: Mode
  garment: HTMLCanvasElement
  shell: InflatedShell | null
  wIn: number
  hIn: number
  buildMs: number
  coldMs: number
  stats: ShapeStats | null
  guess: ShapeGuess | null
  fit: TemplateFit | null
  /** Which trace gate refused, when no shell was built at all (tier 3). */
  reject: SilhouetteReject | null
}

let current: Built | null = null
/** Named part meshes for debug toggling from __inflate.setPart(). */
let parts: Record<string, THREE.Mesh> = {}
const owned: Array<{ dispose(): void }> = []
const photoCache = new Map<string, HTMLCanvasElement>()

/**
 * Zero every 4-connected component of `a` (cells ≥ T) smaller than a tenth of
 * the largest — MIN_COMPONENT, the rule `buildMask` applies before it measures
 * anything at all.
 *
 * The caller keeps the RAW alpha wherever the question is "where do the
 * materials cut", because the sheets are alpha-tested against the raw composite
 * and the rim has to sit on that same cut. The filtered copy is for the two
 * questions that are about the GARMENT: how big is it (the bounding box the
 * sheets span) and what is inside it (the exterior flood).
 */
function eraseIslands(a: Float32Array, w: number, h: number, T: number): Float32Array {
  const out = a.slice()
  const label = new Int32Array(a.length).fill(-1)
  const q = new Int32Array(a.length)
  const size: number[] = []
  for (let s = 0; s < a.length; s++) {
    if (a[s] < T || label[s] >= 0) continue
    const id = size.length
    let n = 0
    let qh = 0
    let qt = 0
    label[s] = id
    q[qt++] = s
    while (qh < qt) {
      const k = q[qh++]
      n++
      const x = k % w
      const push = (kk: number) => {
        if (a[kk] >= T && label[kk] < 0) {
          label[kk] = id
          q[qt++] = kk
        }
      }
      if (x > 0) push(k - 1)
      if (x < w - 1) push(k + 1)
      if (k >= w) push(k - w)
      if (k + w < a.length) push(k + w)
    }
    size.push(n)
  }
  const biggest = size.length ? Math.max(...size) : 0
  for (let i = 0; i < out.length; i++) if (label[i] >= 0 && size[label[i]] < 0.1 * biggest) out[i] = 0
  return out
}

/**
 * The composite's alpha content bbox in ITS OWN pixels — the rectangle the
 * shell's sheets span. Measured the way silhouette.ts measures it (a 200 px
 * working copy, alpha ≥ 128, detached islands erased first) so the two agree to
 * within a working pixel, which is a fraction of one grid cell.
 *
 * THE ISLANDS ARE WHY THIS IS NOT JUST `getImageData` AND A LOOP. `buildMask`
 * drops components under 10 % of the largest and re-derives its bbox from what
 * survived, so on the hanger case the sheets span the GARMENT and stop below the
 * hook. Measuring the raw alpha instead adds the hook's 11 % of height to the
 * top of every grid this harness builds, and everything downstream — the
 * coverage mask the shape statistics use, the isoline the rim gate cuts — is
 * then a row-map out of register with the depth it is describing. It showed up
 * as 1.94 in of "unclosed seam" on geometry that had closed correctly.
 */
function alphaBBox(src: HTMLCanvasElement): {
  x: number
  y: number
  w: number
  h: number
  /** Source pixels per working pixel — what turns the bbox back into the
   *  working-grid cell size the sheet's vertex spacing is derived from. */
  sx: number
  sy: number
} {
  const full = { x: 0, y: 0, w: src.width, h: src.height, sx: 1, sy: 1 }
  const scale = Math.min(1, 200 / Math.max(src.width, src.height))
  const W = Math.max(2, Math.round(src.width * scale))
  const H = Math.max(2, Math.round(src.height * scale))
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return full
  ctx.drawImage(src, 0, 0, W, H)
  const d = ctx.getImageData(0, 0, W, H).data
  const raw = new Float32Array(W * H)
  for (let i = 0; i < raw.length; i++) raw[i] = d[i * 4 + 3] / 255
  const a = eraseIslands(raw, W, H, 128 / 255)
  let x0 = W
  let x1 = -1
  let y0 = H
  let y1 = -1
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (a[y * W + x] < 128 / 255) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  if (x1 < 0) return full
  const sx = src.width / W
  const sy = src.height / H
  return { x: x0 * sx, y: y0 * sy, w: (x1 - x0 + 1) * sx, h: (y1 - y0 + 1) * sy, sx, sy }
}

function clearScene() {
  group.clear()
  parts = {}
  for (const d of owned.splice(0)) d.dispose()
  const s = current?.shell
  if (s) {
    for (const g of [
      s.front,
      s.back,
      s.interior,
      s.interiorFront,
      s.liningFront,
      s.liningBack,
      s.rimFront,
      s.rimBack,
    ])
      g?.dispose()
  }
}

/**
 * Sample the composite's alpha onto the sheet grid so the shape statistics only
 * see cloth.
 *
 * THE SUB-RECT IS THE POINT. The sheets span the alpha CONTENT BBOX, not the
 * canvas — a cutout leaves transparent margins on every supplier photo — so
 * scaling the whole canvas into the grid puts the mask a margin's width out of
 * register with the depth it is supposed to be masking. Every "interior" test
 * downstream then picks up rim and off-garment vertices, and the roughness
 * numbers measure the misregistration rather than the shell: it made two of the
 * twenty cases report a maxSlope of ~120 when a box-filtered field cannot
 * exceed ~10 arithmetically, which is what gave the bug away.
 */
function coverageGrid(garment: HTMLCanvasElement, gx: number, gy: number): Uint8Array {
  const box = alphaBBox(garment)
  const c = document.createElement('canvas')
  c.width = gx
  c.height = gy
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(garment, box.x, box.y, box.w, box.h, 0, 0, gx, gy)
  const d = ctx.getImageData(0, 0, gx, gy).data
  const out = new Uint8Array(gx * gy)
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3] >= 128 ? 1 : 0
  return out
}

function statsFor(shell: InflatedShell, garment: HTMLCanvasElement): ShapeStats | null {
  const pos = shell.front.attributes.position as THREE.BufferAttribute
  // The sheet is a row-major regular grid with Y constant along a row, so the
  // row length is where Y first changes — no need to know GX.
  const total = pos.count
  const y0 = pos.getY(0)
  let gx = 1
  while (gx < total && pos.getY(gx) === y0) gx++
  const gy = Math.floor(total / gx)
  if (gx < 4 || gy < 4 || gx * gy !== total) return null
  const z = new Float32Array(total)
  for (let i = 0; i < total; i++) z[i] = pos.getZ(i)
  return shapeStats(z, coverageGrid(garment, gx, gy), gx, gy)
}

/** The composite a case is built from — the synthetic drawing, or the supplier
 *  photo through the app's own cutout. Cached per page load. */
async function garmentCanvas(spec: Case): Promise<HTMLCanvasElement> {
  let garment = photoCache.get(spec.id)
  if (!garment) {
    garment = document.createElement('canvas')
    const draw: Record<string, (c: HTMLCanvasElement) => void> = {
      tote: drawTote,
      mug: drawMug,
      poster: drawPoster,
      cap: drawCap,
      person: drawPerson,
    }
    if (spec.photo) {
      garment = await loadSupplierGarment(spec.photo, spec.prep === 'raw')
      if (spec.prep === 'hanger') garment = withHanger(garment)
      if (spec.prep === 'bigprint') garment = withBigPrint(garment)
    } else (draw[spec.id] ?? drawShirt)(garment)
    photoCache.set(spec.id, garment)
  }
  return garment
}

/** Row profile + classification of one case, without building anything. */
async function measure(caseId: string) {
  const spec = CASES.find((c) => c.id === caseId) ?? CASES[0]
  const m = measureGarmentPhoto(await garmentCanvas(spec))
  if (!m) return null
  return {
    id: spec.id,
    label: spec.label,
    kind: spec.kind,
    armholes: m.armholes,
    structure: m.structure,
    guess: classifyShape(m.profile, m.armholes),
    profile: dumpProfile(m.profile),
    raw: dumpProfile(m.raw),
  }
}

/**
 * Build one shell without mounting it — for the invariant and determinism
 * probes, which need two shells side by side and no scene state.
 */
async function rawShell(spec: Case, mode: Mode, rim: Rim = 'on'): Promise<InflatedShell | null> {
  const garment = await garmentCanvas(spec)
  const wIn = spec.widthIn
  const hIn = (wIn * garment.height) / garment.width
  const sil = canvasToSilhouette(garment, wIn, hIn)
  return sil
    ? buildInflatedShell(garment, sil, wIn, hIn, { forcePoisson: mode === 'poisson', rim })
    : null
}

function dropShell(s: InflatedShell | null) {
  for (const g of [
    s?.front,
    s?.back,
    s?.interior,
    s?.interiorFront,
    s?.liningFront,
    s?.liningBack,
    s?.rimFront,
    s?.rimBack,
  ])
    g?.dispose()
}

/**
 * Compare two shells attribute by attribute, exactly.
 *
 * THE HARD INVARIANT LIVES HERE. Swapping the Poisson balloon for a template's
 * depth field is allowed to move Z and nothing else: the sheets' X/Y vertex
 * positions and their UVs are what make a print land on the right square inch,
 * and they are frozen in the photo's own frame. Comparing the two modes of the
 * SAME photo is the direct measurement of that claim — no tolerance, no epsilon,
 * float for float. Run with the same mode twice it measures determinism instead,
 * where every component including Z must match.
 *
 * Run with the same mode and `rimA/rimB` set to 'on'/'off' it measures the third
 * form of the same claim: that ADDING cloth thickness moved Z and nothing else.
 * The rim geometries then exist on one side only, which the caller sees as
 * `other` — the sheets and linings are what the comparison is about.
 */
async function diffModes(caseId: string, a: Mode, b: Mode, rimA: Rim = 'on', rimB: Rim = rimA) {
  const spec = CASES.find((c) => c.id === caseId) ?? CASES[0]
  const sa = await rawShell(spec, a, rimA)
  const sb = await rawShell(spec, b, rimB)
  const out = { ok: !!sa && !!sb, verts: 0, xy: 0, uv: 0, z: 0, maxDz: 0, other: 0 }
  if (sa && sb) {
    // The rim is in this list because the SAME claim covers it: its isoline is
    // cut from the alpha and nothing else, so its X/Y and UVs must be identical
    // across tiers (and its vertex COUNT must be too — the closed/open branch is
    // topological, so a numeric branch that flipped between tiers would show up
    // here as `other`).
    const sheets: Array<[keyof InflatedShell, string]> = [
      ['front', 'front'],
      ['back', 'back'],
      ['liningFront', 'liningFront'],
      ['liningBack', 'liningBack'],
      ['rimFront', 'rimFront'],
      ['rimBack', 'rimBack'],
    ]
    for (const [key] of sheets) {
      const ga = sa[key] as THREE.BufferGeometry | undefined
      const gb = sb[key] as THREE.BufferGeometry | undefined
      if (!ga || !gb) {
        if (ga || gb) out.other++
        continue
      }
      const pa = ga.attributes.position as THREE.BufferAttribute
      const pb = gb.attributes.position as THREE.BufferAttribute
      const ua = ga.attributes.uv as THREE.BufferAttribute
      const ub = gb.attributes.uv as THREE.BufferAttribute
      if (pa.count !== pb.count) {
        out.other++
        continue
      }
      out.verts += pa.count
      for (let i = 0; i < pa.count; i++) {
        if (pa.getX(i) !== pb.getX(i) || pa.getY(i) !== pb.getY(i)) out.xy++
        const dz = pa.getZ(i) - pb.getZ(i)
        if (dz !== 0) {
          out.z++
          if (Math.abs(dz) > out.maxDz) out.maxDz = Math.abs(dz)
        }
        if (ua.getX(i) !== ub.getX(i) || ua.getY(i) !== ub.getY(i)) out.uv++
      }
    }
  }
  dropShell(sa)
  dropShell(sb)
  return out
}

async function build(caseId: string, mode: Mode, shape?: GarmentShape, rim: Rim = 'on'): Promise<void> {
  const spec = CASES.find((c) => c.id === caseId) ?? CASES[0]
  const garment = await garmentCanvas(spec)
  const wIn = spec.widthIn
  const hIn = (wIn * garment.height) / garment.width

  // Cold pass first: it is dominated by JIT and by the first getImageData on a
  // fresh canvas, neither of which a user editing a design ever pays again.
  const t0 = performance.now()
  const silCold = canvasToSilhouette(garment, wIn, hIn)
  const cold = silCold
    ? buildInflatedShell(garment, silCold, wIn, hIn, { shape, forcePoisson: mode === 'poisson', rim })
    : null
  const coldMs = performance.now() - t0
  dropShell(cold)

  // Then two warm passes, reported as their MINIMUM.
  //
  // A single warm sample is not a measurement of this code, it is a
  // measurement of whatever else the machine was doing: the same photo timed
  // 371 ms in one run of scripts/inflate-verify.mjs and 1443 ms in the next,
  // under a headless swiftshader renderer that was also encoding PNGs. The
  // minimum of a few passes is the standard answer — the fastest pass is the
  // one with the least foreign interference in it, and no amount of noise can
  // make a pass faster than the work actually takes.
  let buildMs = Infinity
  let shell: InflatedShell | null = null
  let reject: SilhouetteReject | null = null
  for (let i = 0; i < 2; i++) {
    const t1 = performance.now()
    const sil = canvasToSilhouette(garment, wIn, hIn)
    reject = getLastSilhouetteReject()
    const built = sil
      ? buildInflatedShell(garment, sil, wIn, hIn, { shape, forcePoisson: mode === 'poisson', rim })
      : null
    buildMs = Math.min(buildMs, performance.now() - t1)
    if (shell) dropShell(shell)
    shell = built
  }

  clearScene()
  current = {
    caseId: spec.id,
    mode,
    garment,
    shell,
    wIn,
    hIn,
    buildMs,
    coldMs,
    stats: shell ? statsFor(shell, garment) : null,
    // Tier 2 was forced, so any classification / fit on record belongs to an
    // earlier build and would read as this one's.
    guess: mode === 'poisson' ? null : getLastShapeGuess(),
    fit: mode === 'poisson' ? null : getLastTemplateFit(),
    reject,
  }
  if (shell) mount(shell, garment, wIn, hIn)
  syncApi()
  render()
  updateLabel(spec)
}

function mount(shell: InflatedShell, garment: HTMLCanvasElement, wIn: number, hIn: number) {
  const SHEEN = new THREE.Color('#dfe6f2')
  const fabricN = fabricNormalTexture(wIn / 0.9, hIn / 0.9)
  const photoN = shell.normalMapCanvas ? normalTex(shell.normalMapCanvas) : null
  // The de-lit albedo is what ExtrudedGarment samples; falling back to the raw
  // composite keeps the harness honest when the photo needed no correction.
  const frontTex = tex(shell.albedoCanvas ?? garment)
  const blankTex = tex(silhouetteCanvas(garment, '#242A33'))
  const blankLiningTex = tex(silhouetteCanvas(garment, '#aab3c0'))
  owned.push(fabricN, frontTex, blankTex, blankLiningTex)
  if (photoN) owned.push(photoN)

  const addPart = (name: string, mesh: THREE.Mesh) => {
    parts[name] = mesh
    group.add(mesh)
    owned.push(mesh.material as THREE.Material)
  }

  addPart(
    'front',
    new THREE.Mesh(
      shell.front,
      new THREE.MeshPhysicalMaterial({
        map: frontTex,
        vertexColors: true,
        normalMap: photoN ?? fabricN,
        normalScale: photoN ? new THREE.Vector2(0.6, 0.6) : new THREE.Vector2(0.35, 0.35),
        alphaTest: 0.45,
        roughness: 0.86,
        metalness: 0,
        sheen: 0.55,
        sheenRoughness: 0.85,
        sheenColor: SHEEN,
        side: THREE.FrontSide,
      }),
    ),
  )
  addPart(
    'back',
    new THREE.Mesh(
      shell.back,
      new THREE.MeshPhysicalMaterial({
        map: blankTex,
        vertexColors: true,
        normalMap: fabricN,
        normalScale: new THREE.Vector2(0.35, 0.35),
        alphaTest: 0.45,
        roughness: 0.92,
        metalness: 0,
        sheen: 0.35,
        sheenColor: SHEEN,
        emissive: new THREE.Color('#232932'),
        side: THREE.FrontSide,
      }),
    ),
  )

  // Cloth thickness: the sheets' own textures, minus the normal map (a 3-px
  // band does not need a wrinkle map) and minus the ALPHA TEST (the rim is the
  // cut, not a surface with a cut in it) — exactly as ExtrudedGarment mounts it.
  if (shell.rimFront)
    addPart(
      'rimFront',
      new THREE.Mesh(
        shell.rimFront,
        new THREE.MeshPhysicalMaterial({
          map: frontTex,
          vertexColors: true,
          roughness: 0.86,
          metalness: 0,
          sheen: 0.55,
          sheenRoughness: 0.85,
          sheenColor: SHEEN,
          side: THREE.FrontSide,
        }),
      ),
    )
  if (shell.rimBack)
    addPart(
      'rimBack',
      new THREE.Mesh(
        shell.rimBack,
        new THREE.MeshPhysicalMaterial({
          map: blankTex,
          vertexColors: true,
          roughness: 0.92,
          metalness: 0,
          sheen: 0.35,
          sheenColor: SHEEN,
          emissive: new THREE.Color('#232932'),
          side: THREE.FrontSide,
        }),
      ),
    )

  const liningMat = (map: THREE.Texture) =>
    new THREE.MeshStandardMaterial({
      map,
      color: '#adadad', // ≈0.42 linear — matches ExtrudedGarment LINING_TINT
      vertexColors: true,
      normalMap: fabricN,
      normalScale: new THREE.Vector2(0.3, 0.3),
      alphaTest: 0.45,
      roughness: 0.95,
      metalness: 0,
      envMapIntensity: 0.5,
      side: THREE.FrontSide,
    })
  // Blank-back lining floods lighter than the outside face: the unprinted
  // reverse of the fabric must stay legible through the neck. (#aab3c0 matches
  // ExtrudedGarment BLANK_LINING.)
  if (shell.liningFront) addPart('liningFront', new THREE.Mesh(shell.liningFront, liningMat(frontTex)))
  if (shell.liningBack) addPart('liningBack', new THREE.Mesh(shell.liningBack, liningMat(blankLiningTex)))

  const interiorMat = () =>
    new THREE.MeshStandardMaterial({
      color: '#14181F',
      emissive: '#0E1218',
      roughness: 0.95,
      metalness: 0,
      side: THREE.FrontSide,
    })
  if (shell.interior) addPart('interior', new THREE.Mesh(shell.interior, interiorMat()))
  if (shell.interiorFront) addPart('interiorFront', new THREE.Mesh(shell.interiorFront, interiorMat()))
}

// ------------------------------------------- rim: geometric measurement (A1–A4)

/**
 * The composite's alpha resampled onto the SHEET GRID with each cell centred
 * exactly on a vertex.
 *
 * This is a deliberate SECOND implementation of what the rim strip cuts its
 * isoline from. Asserting the rim against the very code that built it would
 * only prove it is self-consistent; measuring it against an independently
 * derived isoline is what makes "the rim is where the alpha cuts" a claim and
 * not a tautology. The alignment matters more than it looks: a bbox-aligned
 * downsample (what `coverageGrid` above does, correctly, for a different job)
 * puts cell centres half a cell off the vertices, which biases the whole
 * isoline by ~0.06 in — the same size as the cloth thickness under test.
 *
 * The alpha here is RAW — islands and all — because this is the alpha the
 * SHEETS are cut by, and the isoline read off it has to be the same curve the
 * rim was welded to. What must not be raw is the bounding box (`alphaBBox`
 * erases islands, so the grid lines up with the sheets) and the exterior flood
 * (`eraseIslands` before `gridExterior`, so a hanger's hook cannot bridge the
 * collar opening to the outside and turn an opening into a seam that failed to
 * close).
 */
function vertexAlphaGrid(src: HTMLCanvasElement, cols: number, rows: number): Float32Array | null {
  const box = alphaBBox(src)
  const stepX = (box.w - box.sx) / Math.max(1, cols - 1)
  const stepY = (box.h - box.sy) / Math.max(1, rows - 1)
  if (!(stepX > 0) || !(stepY > 0)) return null
  const c = document.createElement('canvas')
  c.width = cols
  c.height = rows
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(src, 0.5 - box.x / stepX, 0.5 - box.y / stepY, src.width / stepX, src.height / stepY)
  const d = ctx.getImageData(0, 0, cols, rows).data
  const a = new Float32Array(cols * rows)
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] / 255
  return a
}

/**
 * Which below-isovalue cells are OUTSIDE the garment, by flood fill from a
 * transparent ring padded around the grid. An enclosed hole (collar, armhole)
 * is unreachable and therefore reads as not-exterior — the same topological
 * distinction silhouette.ts makes, reached by a different route (grid alpha vs
 * the eroded working mask), so the two agreeing means something.
 *
 * The cloth is ERODED by one cell before the flood, mirroring `buildMask`.
 * Without it a one-cell notch in the outline (the hoodie's hood/shoulder
 * junction has several) is a diagonal chokepoint a 4-connected flood cannot
 * pass, so a piece of the OUTER contour reads as an enclosed hole and the two
 * implementations disagree about topology on 12 of 180712's 600 crossings.
 */
function gridExterior(A: Float32Array, cols: number, rows: number, T: number): Uint8Array {
  const W2 = cols + 2
  const H2 = rows + 2
  const open = new Uint8Array(W2 * H2).fill(1)
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const c = A[j * cols + i] < T
      const l = i > 0 && A[j * cols + i - 1] < T
      const r = i + 1 < cols && A[j * cols + i + 1] < T
      const u = j > 0 && A[(j - 1) * cols + i] < T
      const d = j + 1 < rows && A[(j + 1) * cols + i] < T
      open[(j + 1) * W2 + i + 1] = c || l || r || u || d ? 1 : 0
    }
  const seen = new Uint8Array(W2 * H2)
  const q = new Int32Array(W2 * H2)
  let qh = 0
  let qt = 0
  seen[0] = 1
  q[qt++] = 0
  while (qh < qt) {
    const k = q[qh++]
    const x = k % W2
    const y = (k / W2) | 0
    if (x > 0 && open[k - 1] && !seen[k - 1]) (seen[k - 1] = 1), (q[qt++] = k - 1)
    if (x < W2 - 1 && open[k + 1] && !seen[k + 1]) (seen[k + 1] = 1), (q[qt++] = k + 1)
    if (y > 0 && open[k - W2] && !seen[k - W2]) (seen[k - W2] = 1), (q[qt++] = k - W2)
    if (y < H2 - 1 && open[k + W2] && !seen[k + W2]) (seen[k + W2] = 1), (q[qt++] = k + W2)
  }
  const out = new Uint8Array(cols * rows)
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) out[j * cols + i] = seen[(j + 1) * W2 + i + 1]
  return out
}

const pct = (a: number[], p: number): number => {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]
}

interface RimStats {
  ok: boolean
  mode: Mode
  rim: Rim
  /** Isoline crossings whose outboard cell is EXTERIOR — the closed outer
   *  contour, where a laid-flat garment's two panels MUST meet. Gap in inches. */
  seamP50: number
  seamP90: number
  seamP99: number
  seamMax: number
  seamN: number
  /** Crossings on horizontal grid edges only: the left/right outline, i.e. a
   *  true Z-tangency and the strictest form of the same claim. */
  sideP50: number
  sideP99: number
  sideN: number
  /** Crossings whose outboard cell is NOT exterior — collar / armhole / cuff.
   *  These must STAY OPEN: the median gap is reported as a fraction of the
   *  garment's own depth. */
  cutP50: number
  cutN: number
  depthIn: number
  frontVerts: number
  frontTris: number
  rimVerts: number
  rimTris: number
  /** Rim triangles whose front face points INTO the cloth, by the alpha's own
   *  account: Scene Viewer culls those, and the slot reopens in AR while the
   *  preview looks fine. Must be zero. */
  badWinding: number
  /** Triangles the alpha cannot judge because both sides of them are cloth —
   *  inside a one-cell notch. Reported rather than asserted, because that is a
   *  limit of the probe and not of the rim. */
  outwardMiss: number
  /** Triangles whose face normal disagrees with the strip's own authored vertex
   *  normal. Shading only (the normal is averaged over the segments meeting at a
   *  crossing, so a staircase corner disagrees with both of them by
   *  construction); reported, never asserted. */
  normalDisagree: number
  degenerate: number
  /** Ends of the rim ribbon — places where the strip simply STOPS. Zero on a
   *  garment whose whole outline carries cloth thickness. */
  rimOpenEnds: number
  /** …and how much outline that leaves bare, inches. */
  rimGapIn: number
}

/**
 * Where the two sheets actually END — measured on the sheets, at the alpha cut,
 * with no renderer involved.
 *
 * This is the cheap gate that runs on every case: the serration the rim exists
 * to remove is an OPEN SLOT between two independently alpha-tested surfaces, so
 * the honest measurement of it is the 3-D distance between them at the exact
 * isovalue their materials cut on, split by whether that piece of outline is a
 * seam (must close) or an opening (must not).
 */
async function rimStats(caseId: string, mode: Mode, rim: Rim): Promise<RimStats | null> {
  const spec = CASES.find((c) => c.id === caseId) ?? CASES[0]
  const garment = await garmentCanvas(spec)
  const shell = await rawShell(spec, mode, rim)
  if (!shell) return null
  try {
    const fp = shell.front.attributes.position as THREE.BufferAttribute
    const bp = shell.back.attributes.position as THREE.BufferAttribute
    const total = fp.count
    const y0 = fp.getY(0)
    let cols = 1
    while (cols < total && fp.getY(cols) === y0) cols++
    const rows = Math.floor(total / cols)
    if (cols < 4 || rows < 4 || cols * rows !== total) return null
    const T = 0.45
    const A = vertexAlphaGrid(garment, cols, rows)
    if (!A) return null
    const outside = gridExterior(eraseIslands(A, cols, rows, T), cols, rows, T)
    const zF = new Float32Array(total)
    const zB = new Float32Array(total)
    for (let i = 0; i < total; i++) {
      zF[i] = fp.getZ(i)
      zB[i] = bp.getZ(i)
    }
    const seam: number[] = []
    const side: number[] = []
    const cut: number[] = []
    /** Walk two cells along the edge, away from the cloth, and ask the flood. */
    const classify = (cell: number, gap: number, isSide: boolean) => {
      if (outside[cell]) {
        seam.push(gap)
        if (isSide) side.push(gap)
      } else cut.push(gap)
    }
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i
        const a0 = A[k]
        if (i + 1 < cols) {
          const a1 = A[k + 1]
          if (a0 >= T !== a1 >= T) {
            const t = (T - a0) / (a1 - a0)
            const gap = Math.abs(zF[k] + (zF[k + 1] - zF[k]) * t - (zB[k] + (zB[k + 1] - zB[k]) * t))
            const oi = a0 >= T ? Math.min(cols - 1, i + 2) : Math.max(0, i - 1)
            classify(j * cols + oi, gap, true)
          }
        }
        if (j + 1 < rows) {
          const a1 = A[k + cols]
          if (a0 >= T !== a1 >= T) {
            const t = (T - a0) / (a1 - a0)
            const gap = Math.abs(
              zF[k] + (zF[k + cols] - zF[k]) * t - (zB[k] + (zB[k + cols] - zB[k]) * t),
            )
            const oj = a0 >= T ? Math.min(rows - 1, j + 2) : Math.max(0, j - 1)
            classify(oj * cols + i, gap, false)
          }
        }
      }
    }

    // WINDING. Scene Viewer culls back faces aggressively, so a rim triangle
    // wound the wrong way reopens the slot in AR while looking perfect in a
    // DoubleSide-tolerant preview. The claim is therefore stated the way the
    // cull states it: the face normal must point at the side of the cut where
    // there is NO CLOTH, and that is asked of the ALPHA — the same alpha the
    // materials cut on — rather than of the strip's own authored normals.
    //
    // The first version of this gate compared the face normal against the
    // vertex normal instead, and it was wrong: that normal is AVERAGED over the
    // segments meeting at a crossing, so wherever the outline turns through
    // more than a right angle in one cell (every staircase corner, and both
    // sides of a one-cell notch) the average points somewhere between two
    // segments and disagrees with each of them. It reported 353 "inverted"
    // triangles on the mug and 28 on the synthetic tee while the alpha said
    // every one of them faced out — a property of the reference, not of the
    // geometry. That comparison is still computed, as `normalDisagree`, because
    // a shading normal fighting its own face is worth seeing; it just is not
    // what decides whether AR shows a hole.
    const sampleA = (X: number, Y: number): number => {
      const gi = THREE.MathUtils.clamp((X / shell.contentWIn + 0.5) * (cols - 1), 0, cols - 1)
      const gj = THREE.MathUtils.clamp((0.5 - Y / shell.contentHIn) * (rows - 1), 0, rows - 1)
      const x0 = Math.min(cols - 2, Math.floor(gi))
      const yy0 = Math.min(rows - 2, Math.floor(gj))
      const tx = gi - x0
      const ty = gj - yy0
      const i0 = yy0 * cols + x0
      return (
        (A[i0] * (1 - tx) + A[i0 + 1] * tx) * (1 - ty) +
        (A[i0 + cols] * (1 - tx) + A[i0 + cols + 1] * tx) * ty
      )
    }
    const cellIn = Math.min(shell.contentWIn / (cols - 1), shell.contentHIn / (rows - 1))
    /** Mean alpha along a ray from a point, half a cell per step out to three
     *  cells: one sample is not enough to tell "outside" from "one-cell notch",
     *  and a profile is. */
    const rayA = (x: number, y: number, dx: number, dy: number): number => {
      let s = 0
      for (let k = 1; k <= 6; k++) s += sampleA(x + dx * cellIn * 0.5 * k, y + dy * cellIn * 0.5 * k)
      return s / 6
    }
    /** Alpha difference below which the two sides of a face are the same cloth
     *  and the probe simply cannot say which way is out (a one-cell notch). */
    const OUTWARD_EPS = 0.02
    let rimVerts = 0
    let rimTris = 0
    let badWinding = 0
    let outwardMiss = 0
    let normalDisagree = 0
    let degenerate = 0
    for (const g of [shell.rimFront, shell.rimBack]) {
      if (!g) continue
      const p = g.attributes.position as THREE.BufferAttribute
      const nAttr = g.attributes.normal as THREE.BufferAttribute
      const idx = g.index!
      rimVerts += p.count
      rimTris += idx.count / 3
      for (let t = 0; t < idx.count; t += 3) {
        const ia = idx.getX(t)
        const ib = idx.getX(t + 1)
        const ic = idx.getX(t + 2)
        const ax = p.getX(ia)
        const ay = p.getY(ia)
        const az = p.getZ(ia)
        const ux = p.getX(ib) - ax
        const uy = p.getY(ib) - ay
        const uz = p.getZ(ib) - az
        const vx = p.getX(ic) - ax
        const vy = p.getY(ic) - ay
        const vz = p.getZ(ic) - az
        const nx = uy * vz - uz * vy
        const ny = uz * vx - ux * vz
        const nz = ux * vy - uy * vx
        const L = Math.hypot(nx, ny, nz)
        if (!(L > 1e-12)) {
          degenerate++
          continue
        }
        const hLen = Math.hypot(nx, ny)
        // A rim face with no outward direction at all is lying flat, which the
        // strip's construction cannot produce.
        if (!(hLen > 1e-9)) {
          badWinding++
          continue
        }
        const hx = nx / hLen
        const hy = ny / hLen
        const cxp = (ax + p.getX(ib) + p.getX(ic)) / 3
        const cyp = (ay + p.getY(ib) + p.getY(ic)) / 3
        const out = rayA(cxp, cyp, hx, hy)
        const inn = rayA(cxp, cyp, -hx, -hy)
        if (out > inn + OUTWARD_EPS) badWinding++
        else if (!(inn > out + OUTWARD_EPS)) outwardMiss++
        // The rim's own authored outward normal is the one with the least Z:
        // ring 1 of a bridge and ring 2 of a skirt are exactly (n̂x, n̂y, 0),
        // while ring 0 is welded to the sheet and mostly points at the camera.
        let best = -1
        let bz = Infinity
        for (const iv of [ia, ib, ic]) {
          const z = Math.abs(nAttr.getZ(iv))
          if (z < bz) {
            bz = z
            best = iv
          }
        }
        if (hx * nAttr.getX(best) + hy * nAttr.getY(best) <= 0) normalDisagree++
      }
    }

    // RIBBON CLOSURE — the one thing nothing else here can see.
    //
    // The strip is cut from a marching-squares isoline, and an isoline can only
    // be CLIPPED by the grid it lives on. That grid spans the alpha's own
    // bounding box, so it clips exactly where a laid-flat garment is flattest:
    // wherever the cut RUNS ALONG the bbox — the hem across the bottom of every
    // flat-lay, the outer edge of a sleeve at its widest — the boundary cell is
    // half cloth and no edge of it crosses. Every other gate here is blind to
    // it: the seam gap is measured on the SHEETS, which converge everywhere with
    // or without a strip, and the rendered probe localises the seam at grazing
    // azimuths, i.e. the SIDE of the garment, the one part of the outline that
    // is interior to the bbox. Measured with the grid unpadded: 4–14 open ends
    // and 3.5–20.7 in of a 39–55 in outline bare, on all 18 supplier photos.
    //
    // An open end is exact and needs no isoline: a strip edge that spans the
    // ROLL (its two vertices share x and y) and belongs to exactly ONE triangle.
    // rimFront and rimBack are built from the same crossings and the same quads,
    // so one of them answers for both.
    let rimOpenEnds = 0
    let rimGapIn = 0
    if (shell.rimFront) {
      const rp = shell.rimFront.attributes.position as THREE.BufferAttribute
      const ridx = shell.rimFront.index!
      const use = new Map<string, number>()
      const key = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`)
      for (let t = 0; t < ridx.count; t += 3) {
        const v = [ridx.getX(t), ridx.getX(t + 1), ridx.getX(t + 2)]
        for (let e = 0; e < 3; e++) {
          const k = key(v[e], v[(e + 1) % 3])
          use.set(k, (use.get(k) ?? 0) + 1)
        }
      }
      const ends: Array<[number, number]> = []
      for (const [k, n] of use) {
        if (n !== 1) continue
        const [a, b] = k.split(':').map(Number)
        if (Math.hypot(rp.getX(a) - rp.getX(b), rp.getY(a) - rp.getY(b)) > 1e-6) continue
        const X = rp.getX(a)
        const Y = rp.getY(a)
        if (!ends.some(([u, v]) => Math.abs(u - X) < 1e-3 && Math.abs(v - Y) < 1e-3)) ends.push([X, Y])
      }
      rimOpenEnds = ends.length
      // How much outline that leaves bare. The two ends of one break are the two
      // ends closest to each other, so pair them SHORTEST FIRST across the whole
      // set: walking the list in order and taking each one's nearest free partner
      // hands a corner's end to a break on the far side of the shape the moment
      // its real partner has already been consumed.
      const pairs = []
      for (let i = 0; i < ends.length; i++)
        for (let j = i + 1; j < ends.length; j++)
          pairs.push([Math.hypot(ends[i][0] - ends[j][0], ends[i][1] - ends[j][1]), i, j])
      pairs.sort((a, b) => a[0] - b[0])
      const paired = new Set<number>()
      for (const [d, i, j] of pairs) {
        if (paired.has(i) || paired.has(j)) continue
        paired.add(i)
        paired.add(j)
        rimGapIn += d
      }
    }

    return {
      ok: true,
      mode,
      rim,
      seamP50: pct(seam, 0.5),
      seamP90: pct(seam, 0.9),
      seamP99: pct(seam, 0.99),
      seamMax: seam.length ? Math.max(...seam) : 0,
      seamN: seam.length,
      sideP50: pct(side, 0.5),
      sideP99: pct(side, 0.99),
      sideN: side.length,
      cutP50: pct(cut, 0.5),
      cutN: cut.length,
      depthIn: shell.depthIn,
      frontVerts: total,
      frontTris: (shell.front.index?.count ?? 0) / 3,
      rimVerts,
      rimTris,
      badWinding,
      outwardMiss,
      normalDisagree,
      degenerate,
      rimOpenEnds,
      rimGapIn,
    }
  } finally {
    dropShell(shell)
  }
}

// ---------------------------------------- rim: rendered measurement (B1–B5)

/**
 * Part identities, as flat colours with only 0 and 255 components.
 *
 * Both extremes are fixed points of every transfer function three can put in
 * the way, so the identity survives colour management byte-exactly whatever the
 * renderer decides to do — which is the whole point of an ID pass. The two
 * interior catch planes share one identity because nothing below distinguishes
 * them: they are "something that is not cloth", and that is all the seam test
 * asks.
 */
const ID_COLOR: Record<string, number> = {
  front: 0xff0000,
  back: 0x00ff00,
  rimFront: 0x0000ff,
  rimBack: 0x00ffff,
  liningFront: 0xff00ff,
  liningBack: 0xffff00,
  interior: 0xffffff,
  interiorFront: 0xffffff,
}
/** 3-bit id read straight out of the framebuffer: (r,g,b) thresholded at 128. */
const ID_BG = 0
const ID_FRONT = 4
const ID_BACK = 2
const ID_RIM_F = 1
const ID_RIM_B = 3
const ID_LIN_F = 5
const ID_LIN_B = 6
const ID_INTERIOR = 7
const isRim = (v: number): boolean => v === ID_RIM_F || v === ID_RIM_B
/** The inside of the garment: only ever legitimately seen through an OPENING. */
const isInside = (v: number): boolean => v === ID_LIN_F || v === ID_LIN_B || v === ID_INTERIOR
/** What the outer silhouette is made of. The interior catch planes are excluded
 *  on purpose: they sit ~1.5 in behind the back sheet, so at a grazing azimuth
 *  a plane whose own outline is `Silhouette.outer` projects PAST the garment and
 *  would otherwise be mistaken for the silhouette it is hiding behind. */
const isCloth = (v: number): boolean => v !== ID_BG && v !== ID_INTERIOR

const ID_PX = 1024
/** The content height fills this much of the frame, so px/in is exact and
 *  analytic under an orthographic camera: pxPerIn = 1024·0.86 / contentHIn. */
const ID_FILL = 0.86

let idRenderer: THREE.WebGLRenderer | null = null
let idTarget: THREE.WebGLRenderTarget | null = null

/** Alpha of the composite carried in the GREEN channel — the one texture every
 *  ID material alpha-tests through (`alphaMap` reads green), so the cut is the
 *  production cut and the identity is a plain material colour. */
function alphaAsGreen(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = src.width
  c.height = src.height
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(src, 0, 0)
  const img = ctx.getImageData(0, 0, c.width, c.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    d[i] = d[i + 1] = d[i + 2] = d[i + 3]
    d[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return c
}

/**
 * Widest front↔back boundary still treated as one seam, inches. Anything wider
 * on a scanline is not a seam being looked at edge-on, it is two unrelated
 * regions, and averaging it in would report the width of the garment.
 */
const SEAM_MAX_IN = 1.5

interface AzimuthStats {
  deg: number
  /** Scanlines carrying a measurable front↔back boundary. Zero at moderate
   *  azimuths, where the back panel is entirely back-facing and never drawn. */
  rows: number
  /** Projected width of that boundary, inches — THE SLOT. On a closed shell it
   *  is the rim's own 0.06 in of cloth seen edge-on; before the fix it is the
   *  0.25–0.55 in of nothing the two sheets left between them. */
  wP50: number
  wP90: number
  wP99: number
  /** Fraction of those scanlines where the slot shows LINING or INTERIOR — i.e.
   *  you are looking THROUGH the garment's edge into its own cavity, which is
   *  the defect stated exactly. */
  openFrac: number
  /** Fraction where a RIM pixel sits in the boundary. B1 cannot be passed by
   *  adding a strip without converging; this cannot be passed by converging
   *  without a strip. Together they pin the fix. */
  rimFrac: number
  /** Scanlines where an identity appears in more than one run across the
   *  boundary: cloth → rim → cloth is monotone, cloth|lining|cloth|lining is
   *  the stack of surfaces resolving in stripes. */
  alt: number
  /** RMS second difference of the OUTER silhouette, px: the staircase itself. */
  rough: number
}

/**
 * Render the shell as flat part identities and measure the seam on screen.
 *
 * WHY THE BOUNDARY IS ALWAYS A SEAM AND NEVER AN APEX. The measurement is "the
 * extreme screen-x of the front sheet against the extreme screen-x of the back
 * sheet", which only means the seam while each of those extremes IS a cut edge.
 * Both sheets are FrontSide, so at azimuth θ > 0 only their +X halves survive
 * the cull, and under u = X·cos θ − Z·sin θ that half of the front sheet runs
 * from its apex (u = −sin θ·zApex, the far left) to its +X seam, while that half
 * of the back sheet runs from the same seam out to its own apex on the far
 * right. The two regions therefore meet AT the seam at every azimuth, and each
 * apex projects to the opposite end of its own region — it can never overtake
 * the boundary being measured.
 *
 * What does break down is the other end: below ~70° the back sheet's normals
 * never tilt far enough to face the camera at all and it is simply not drawn, so
 * there is no boundary and `rows` reports 0 (measured: 0–134 rows at ±60°
 * against 466–877 at ±75° and ±85°). Those azimuths are dropped by the caller's
 * row threshold, and their silhouette roughness — which needs no boundary — is
 * what speaks for the moderate angles.
 */
async function rimProbe(
  caseId: string,
  mode: Mode,
  rim: Rim,
  shotDeg?: number,
): Promise<{
  pxPerIn: number
  azimuths: AzimuthStats[]
  /** Pixels whose identity flips under a ⅓-px camera jitter and that are not
   *  within 1 px of an identity boundary — i.e. coplanar surfaces resolving per
   *  pixel, which is what z-fighting looks like in an ID pass. */
  flips: number
  covered: number
  dataUrl?: string
} | null> {
  const spec = CASES.find((c) => c.id === caseId) ?? CASES[0]
  const garment = await garmentCanvas(spec)
  const shell = await rawShell(spec, mode, rim)
  if (!shell) return null
  if (!idRenderer) {
    idRenderer = new THREE.WebGLRenderer({ alpha: false, antialias: false, preserveDrawingBuffer: true })
    idRenderer.setPixelRatio(1)
    idRenderer.setSize(ID_PX, ID_PX)
    // No tone mapping and no output encode: an identity that has been through a
    // transfer function is not an identity.
    idRenderer.toneMapping = THREE.NoToneMapping
    idRenderer.outputColorSpace = THREE.LinearSRGBColorSpace
    idRenderer.setClearColor(0x000000, 1)
    idTarget = new THREE.WebGLRenderTarget(ID_PX, ID_PX, {
      type: THREE.UnsignedByteType,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: true,
    })
  }
  const renderer = idRenderer
  const target = idTarget!
  const scene = new THREE.Scene()
  const owns: Array<{ dispose(): void }> = []
  const alphaTex = new THREE.CanvasTexture(alphaAsGreen(garment))
  alphaTex.colorSpace = THREE.NoColorSpace
  alphaTex.anisotropy = 8
  alphaTex.flipY = true
  owns.push(alphaTex)
  const geos: Record<string, THREE.BufferGeometry | null | undefined> = {
    front: shell.front,
    back: shell.back,
    rimFront: shell.rimFront,
    rimBack: shell.rimBack,
    liningFront: shell.liningFront,
    liningBack: shell.liningBack,
    interior: shell.interior,
    interiorFront: shell.interiorFront,
  }
  for (const [name, geo] of Object.entries(geos)) {
    if (!geo) continue
    // Cut exactly the way production cuts. The catch planes carry no texture
    // there either; the RIM is opaque there, because it is the cut rather than
    // a surface with a cut in it, and an ID pass that alpha-tested it would
    // report a defect the shipped shell does not have.
    const opaque = name.startsWith('interior') || name.startsWith('rim')
    const mat = new THREE.MeshBasicMaterial({
      color: ID_COLOR[name],
      alphaMap: opaque ? null : alphaTex,
      alphaTest: opaque ? 0 : 0.45,
      transparent: false,
      side: THREE.FrontSide,
      toneMapped: false,
    })
    owns.push(mat)
    scene.add(new THREE.Mesh(geo, mat))
  }

  const frameIn = shell.contentHIn / ID_FILL
  const pxPerIn = ID_PX / frameIn
  const span = Math.max(shell.contentHIn, shell.contentWIn)
  const R = 10 * span
  /**
   * THE NEAR/FAR PAIR IS PART OF THE MEASUREMENT, not boilerplate.
   *
   * A render target's depth attachment is a 16-bit renderbuffer, and under an
   * orthographic camera depth is LINEAR, so the whole range is spread evenly:
   * 0.01 … 4000 in resolves 0.061 in per unit and the rim's 0.007 in lead over
   * the lining it is supposed to occlude falls inside a single one. The probe
   * then reported the lining filling the seam on 79–100 % of the scanlines of a
   * shell whose geometry puts the rim in front of it everywhere — a defect in
   * the instrument, read as a defect in the garment. Wrapped tightly around the
   * object (±0.75 of its own size, which clears the interior catch planes at
   * ±1.5 in with room to spare) the same 16 bits resolve 0.0005 in.
   */
  const half = 0.75 * span
  const cam = new THREE.OrthographicCamera(
    -frameIn / 2,
    frameIn / 2,
    frameIn / 2,
    -frameIn / 2,
    R - half,
    R + half,
  )
  const buf = new Uint8Array(ID_PX * ID_PX * 4)
  const ids = new Uint8Array(ID_PX * ID_PX)
  const shoot = (deg: number, jitterPx = 0): void => {
    const th = (deg * Math.PI) / 180
    cam.position.set(Math.sin(th) * R, 0, Math.cos(th) * R)
    cam.up.set(0, 1, 0)
    cam.lookAt(0, 0, 0)
    if (jitterPx) {
      // Slide the camera inside its own film plane, so the scene is sampled at a
      // different sub-pixel phase and nothing else changes.
      const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0)
      const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1)
      cam.position.addScaledVector(right, (jitterPx / pxPerIn) * -1)
      cam.position.addScaledVector(up, (jitterPx / pxPerIn) * -1)
      cam.updateMatrixWorld(true)
    }
    cam.updateProjectionMatrix()
    renderer.setRenderTarget(target)
    renderer.clear()
    renderer.render(scene, cam)
    renderer.readRenderTargetPixels(target, 0, 0, ID_PX, ID_PX, buf)
    renderer.setRenderTarget(null)
    for (let i = 0, p = 0; i < ids.length; i++, p += 4)
      ids[i] = (buf[p] >= 128 ? 4 : 0) | (buf[p + 1] >= 128 ? 2 : 0) | (buf[p + 2] >= 128 ? 1 : 0)
  }

  const measure = (deg: number): AzimuthStats => {
    shoot(deg)
    // Under u = X·cos θ − Z·sin θ the front sheet (+Z) is pushed left for a
    // positive azimuth and right for a negative one, so which side of the
    // boundary each panel is on is known analytically, not guessed.
    const frontLeft = deg > 0
    let rows = 0
    let open = 0
    let rimHit = 0
    let alt = 0
    const w: number[] = []
    const edgeL: number[] = []
    const edgeR: number[] = []
    const maxPx = SEAM_MAX_IN * pxPerIn
    for (let y = 0; y < ID_PX; y++) {
      const row = y * ID_PX
      let fMin = -1
      let fMax = -1
      let bMin = -1
      let bMax = -1
      let cMin = -1
      let cMax = -1
      for (let x = 0; x < ID_PX; x++) {
        const v = ids[row + x]
        if (!isCloth(v)) continue
        if (cMin < 0) cMin = x
        cMax = x
        if (v === ID_FRONT) {
          if (fMin < 0) fMin = x
          fMax = x
        } else if (v === ID_BACK) {
          if (bMin < 0) bMin = x
          bMax = x
        }
      }
      if (cMin < 0) continue
      edgeL.push(cMin)
      edgeR.push(cMax)
      if (fMin < 0 || bMin < 0) continue
      const xF = frontLeft ? fMax : fMin
      const xB = frontLeft ? bMin : bMax
      // The two panels must not overlap in x (that is a different view, not a
      // seam) and must be near each other.
      if (frontLeft ? xF > xB : xF < xB) continue
      const gapPx = Math.abs(xB - xF)
      if (gapPx > maxPx) continue
      rows++
      w.push(gapPx / pxPerIn)
      const lo = Math.min(xF, xB)
      const hi = Math.max(xF, xB)
      let sawInside = false
      let sawRim = false
      for (let x = Math.max(0, lo - 1); x <= Math.min(ID_PX - 1, hi + 1); x++) {
        const v = ids[row + x]
        if (isInside(v)) sawInside = true
        if (isRim(v)) sawRim = true
      }
      if (sawInside) open++
      if (sawRim) rimHit++
      const seen = new Set<number>()
      let prev = -1
      for (let x = Math.max(0, lo - 3); x <= Math.min(ID_PX - 1, hi + 3); x++) {
        const v = ids[row + x]
        if (v === prev) continue
        if (seen.has(v)) {
          alt++
          break
        }
        seen.add(v)
        prev = v
      }
    }
    // Silhouette staircase: RMS second difference of the outer edge, dropping
    // the top/bottom 5 % of rows and any row whose edge jumps more than 8 px (a
    // genuine sleeve or hem corner, not aliasing).
    const rms = (e: number[]): number => {
      const lo = Math.floor(e.length * 0.05)
      const hi = Math.ceil(e.length * 0.95)
      let s = 0
      let n = 0
      for (let i = lo + 1; i < hi - 1; i++) {
        if (Math.abs(e[i] - e[i - 1]) > 8 || Math.abs(e[i + 1] - e[i]) > 8) continue
        const d2 = e[i - 1] - 2 * e[i] + e[i + 1]
        s += d2 * d2
        n++
      }
      return n ? Math.sqrt(s / n) : 0
    }
    return {
      deg,
      rows,
      wP50: pct(w, 0.5),
      wP90: pct(w, 0.9),
      wP99: pct(w, 0.99),
      openFrac: rows ? open / rows : 0,
      rimFrac: rows ? rimHit / rows : 0,
      alt,
      rough: (rms(edgeL) + rms(edgeR)) / 2,
    }
  }

  // Grazing on both sides. Below ~55° the back panel is entirely back-facing
  // (its slope never reaches tan θ) and is simply not drawn, so there is no
  // boundary to measure and `rows` reports 0 — the silhouette roughness is
  // still measured there, and is the number that speaks for the moderate
  // angles.
  const azimuths = [-85, -75, -60, 60, 75, 85].map(measure)

  // Sub-pixel jitter: pixels whose identity flips WITHOUT being near a boundary
  // are coplanar surfaces resolving per pixel — the signature of the rim
  // z-fighting the sheet it is welded to.
  shoot(60)
  const a = ids.slice()
  shoot(60, 1 / 3)
  let flips = 0
  let covered = 0
  const near = (arr: Uint8Array, x: number, y: number): boolean => {
    const v = arr[y * ID_PX + x]
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx
        const yy = y + dy
        if (xx < 0 || yy < 0 || xx >= ID_PX || yy >= ID_PX) continue
        if (arr[yy * ID_PX + xx] !== v) return true
      }
    return false
  }
  for (let y = 1; y < ID_PX - 1; y++)
    for (let x = 1; x < ID_PX - 1; x++) {
      const i = y * ID_PX + x
      if (a[i] === ID_BG && ids[i] === ID_BG) continue
      covered++
      if (a[i] === ids[i]) continue
      if (near(a, x, y) || near(ids, x, y)) continue
      flips++
    }

  let dataUrl: string | undefined
  if (shotDeg !== undefined) {
    shoot(shotDeg)
    const c = document.createElement('canvas')
    c.width = ID_PX
    c.height = ID_PX
    const ctx = c.getContext('2d')!
    const img = ctx.createImageData(ID_PX, ID_PX)
    // readRenderTargetPixels hands back bottom-up rows.
    for (let y = 0; y < ID_PX; y++) {
      const src = (ID_PX - 1 - y) * ID_PX * 4
      img.data.set(buf.subarray(src, src + ID_PX * 4), y * ID_PX * 4)
    }
    for (let p = 3; p < img.data.length; p += 4) img.data[p] = 255
    ctx.putImageData(img, 0, 0)
    dataUrl = c.toDataURL('image/png')
  }

  for (const o of owns) o.dispose()
  dropShell(shell)
  return { pxPerIn, azimuths, flips, covered, dataUrl }
}

// --- cameras / views ---------------------------------------------------------

type ViewName = 'front' | 'threequarter' | 'side' | 'top' | 'graze'
const camera = new THREE.PerspectiveCamera(30, PANEL_W / PANEL_H, 0.1, 500)

/**
 * Free azimuth for evidence capture, degrees, or null for the named views.
 *
 * The five named views are the ones every case is judged on and their framing is
 * fixed on purpose. Cloth thickness, though, is an effect that only exists near
 * the grazing end, so the screenshots that argue for it have to be taken at
 * stated angles rather than at "side" — this is the knob that lets a capture
 * script name one. Nothing asserted reads it.
 */
let azimuthDeg: number | null = null

/** Frame the garment the same way whatever its real size. */
function aimCamera(name: ViewName) {
  const h = current?.hIn ?? HIN
  const d = h * 1.96
  if (azimuthDeg !== null) {
    const th = (azimuthDeg * Math.PI) / 180
    camera.position.set(Math.sin(th) * d, h * 0.03, Math.cos(th) * d)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
    return
  }
  if (name === 'front' || name === 'graze') {
    camera.position.set(name === 'graze' ? d * 0.11 : 0, name === 'graze' ? -h * 0.04 : 0, d)
    camera.lookAt(0, 0, 0)
  } else if (name === 'side') {
    camera.position.set(d * 0.98, 0, h * 0.12)
    camera.lookAt(0, 0, 0)
  } else if (name === 'top') {
    // Down into the neck: 45° above + in front of the collar, close crop.
    camera.position.set(0, h * 1.08, h * 0.83)
    camera.lookAt(0, h * 0.25, 0)
  } else {
    camera.position.set(-d * 0.62, h * 0.08, d * 0.78)
    camera.lookAt(0, 0, 0)
  }
  camera.updateProjectionMatrix()
}

function renderPanel(name: ViewName, x: number, y: number, w: number, h: number) {
  grazeKey.visible = name === 'graze'
  key.visible = name !== 'graze'
  hemi.intensity = name === 'graze' ? 0.3 : 0.5
  camera.aspect = w / h
  aimCamera(name)
  renderer.setViewport(x, y, w, h)
  renderer.setScissor(x, y, w, h)
  renderer.render(scene, camera)
}

let mode: 'grid' | ViewName = 'grid'

function render() {
  renderer.setScissorTest(true)
  if (mode === 'grid') {
    renderPanel('front', 0, PANEL_H, PANEL_W, PANEL_H)
    renderPanel('threequarter', PANEL_W, PANEL_H, PANEL_W, PANEL_H)
    renderPanel('top', 0, 0, PANEL_W, PANEL_H)
    renderPanel('graze', PANEL_W, 0, PANEL_W, PANEL_H)
  } else {
    renderPanel(mode, 0, 0, CANVAS_W, CANVAS_H)
  }
  renderer.setScissorTest(false)
}

// --- labels + readout (DOM, outside the GL readback) -------------------------

const label = (text: string, left: number, top: number) => {
  const el = document.createElement('div')
  el.textContent = text
  el.style.cssText =
    `position:absolute;left:${left}px;top:${top}px;color:#9AA5B4;` +
    'font:600 11px/1.4 monospace;letter-spacing:0.08em;pointer-events:none;' +
    'text-transform:uppercase;background:rgba(12,15,19,0.55);padding:2px 6px;border-radius:3px'
  root.appendChild(el)
  return el
}
label('front', 8, 8)
label('three-quarter', PANEL_W + 8, 8)
label('top — into the neck', 8, PANEL_H + 8)
label('grazing light', PANEL_W + 8, PANEL_H + 8)
const info = label('', 8, CANVAS_H - 44)
info.style.color = '#EEF1F5'
info.style.textTransform = 'none'
info.style.maxWidth = CANVAS_W - 16 + 'px'

function updateLabel(spec: Case) {
  const s = current?.shell
  const st = current?.stats
  info.textContent =
    `${spec.label} · ${current?.mode} · ${current?.buildMs.toFixed(0)} ms · ` +
    (s
      ? `${s.depthSource}/${s.shape}→${s.depthTemplate ?? '—'} iou ${s.templateIoU.toFixed(3)} · depth ${s.depthIn.toFixed(2)}in · ` +
        `peak ${st ? st.peakFromTop.toFixed(3) : '—'} shoulder ${st ? st.shoulderFill.toFixed(3) : '—'} ` +
        `chestFlat ${st ? st.chestFlat.toFixed(3) : '—'} · ` +
        `albedo ${s.albedoCanvas ? 'de-lit' : 'as-shot'} (spread ${(s.albedoSpread ?? 0).toFixed(3)})`
      : 'no shell (CustomCard fallback)')
}

// --- probe API for scripts/inflate-verify.mjs --------------------------------

interface InflateApi {
  ok: boolean
  hasHoles: boolean
  hasLinings: boolean
  hasNormalMap: boolean
  buildMs: number
  cases: Array<{ id: string; label: string; kind: Case['kind'] }>
  templates: Record<TemplateId, ShapeStats>
  templateProfiles: Record<TemplateId, ProfileDump | null>
  shapeTemplate: Record<GarmentShape, TemplateId>
  /** Resolves once the first (synchronous, network-free) case is on screen. */
  ready: Promise<void>
  build(caseId: string, mode: Mode, shape?: GarmentShape, rim?: Rim): Promise<void>
  measure(caseId: string): Promise<unknown>
  diffModes(caseId: string, a: Mode, b: Mode, rimA?: Rim, rimB?: Rim): Promise<unknown>
  /** Front↔back separation at the sheets' own alpha cut, split by topology. */
  rimStats(caseId: string, mode: Mode, rim: Rim): Promise<RimStats | null>
  /** The same seam, rendered as part identities and measured on screen. */
  rimProbe(caseId: string, mode: Mode, rim: Rim, shotDeg?: number): Promise<unknown>
  setView(name: ViewName | 'grid'): void
  /** Evidence only: override the named views' azimuth, or null to restore. */
  setAzimuth(deg: number | null): void
  setPart(name: string, visible: boolean): void
  probe(): unknown
}

const api: InflateApi = {
  ok: false,
  hasHoles: false,
  hasLinings: false,
  hasNormalMap: false,
  buildMs: 0,
  cases: CASES.map((c) => ({ id: c.id, label: c.label, kind: c.kind })),
  templates: { tee: templateStats('tee'), hoodie: templateStats('hoodie') },
  templateProfiles: { tee: templateProfile('tee'), hoodie: templateProfile('hoodie') },
  shapeTemplate: SHAPE_TEMPLATE,
  ready: Promise.resolve(),
  build,
  measure,
  diffModes,
  rimStats,
  rimProbe,
  setView(name) {
    mode = name
    render()
  },
  setAzimuth(deg) {
    azimuthDeg = deg
    render()
  },
  setPart(name, visible) {
    if (parts[name]) parts[name].visible = visible
    render()
  },
  probe() {
    render()
    const shell = current?.shell ?? null
    const g = shell?.front
    let zMin = 0
    let zMax = 0
    let curvature = 0
    let liningInside = true
    if (g) {
      g.computeBoundingBox()
      zMin = g.boundingBox!.min.z
      zMax = g.boundingBox!.max.z
      // Fraction of front-face normals that actually tilt off +Z. A flat plateau
      // is ~all (0,0,1) → ~0; a real dome tilts most of them.
      const n = g.attributes.normal as THREE.BufferAttribute
      let tilted = 0
      for (let i = 0; i < n.count; i++) if (Math.abs(n.getZ(i)) < 0.985) tilted++
      curvature = tilted / Math.max(1, n.count)
      // Hollow invariant: the front lining must sit between its sheet and the
      // mid-plane at every vertex (never poke through either).
      const lf = shell?.liningFront?.attributes.position as THREE.BufferAttribute | undefined
      const fp = g.attributes.position as THREE.BufferAttribute
      if (lf) {
        for (let i = 0; i < lf.count; i++) {
          const zs = fp.getZ(i)
          const zl = lf.getZ(i)
          if (zl < -1e-4 || zl > zs + 1e-4) {
            liningInside = false
            break
          }
        }
      }
    }
    const gl = renderer.domElement
    const c = document.createElement('canvas')
    c.width = gl.width
    c.height = gl.height
    const ctx = c.getContext('2d')!
    ctx.drawImage(gl, 0, 0)
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    // Count pixels that differ from the #0c0f13 clear color (the garment).
    let cov = 0
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i] - 12) + Math.abs(d[i + 1] - 15) + Math.abs(d[i + 2] - 19) > 24) cov++
    }
    return {
      ok: !!shell,
      caseId: current?.caseId ?? '',
      mode: current?.mode ?? 'template',
      verts: g ? (g.attributes.position as THREE.BufferAttribute).count : 0,
      zMin,
      zMax,
      curvature,
      liningInside,
      buildMs: current?.buildMs ?? 0,
      coldMs: current?.coldMs ?? 0,
      guess: current?.guess ?? null,
      fit: current?.fit ?? null,
      reject: current?.reject ?? null,
      thickness: shell?.depthIn ?? 0,
      depthSource: shell?.depthSource ?? 'none',
      shape: shell?.shape ?? 'none',
      donor: shell?.depthTemplate ?? null,
      iou: shell?.templateIoU ?? 0,
      structure: shell?.structure ?? null,
      delit: !!shell?.albedoCanvas,
      delitSpread: shell?.albedoSpread ?? 0,
      stats: current?.stats ?? null,
      coverage: cov / (c.width * c.height),
      dataUrl: gl.toDataURL('image/png'),
    }
  },
}

function syncApi() {
  const s = current?.shell
  api.ok = !!s
  api.hasHoles = !!s?.interior
  api.hasLinings = !!s?.liningFront && !!s?.liningBack
  api.hasNormalMap = !!s?.normalMapCanvas
  api.buildMs = current?.buildMs ?? 0
}

// Case 0 is synchronous and network-free, so the API is usable immediately.
api.ready = build('synthetic', 'template')
;(window as unknown as { __inflate?: InflateApi }).__inflate = api
