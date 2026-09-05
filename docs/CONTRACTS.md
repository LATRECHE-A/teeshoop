# Tshop Studio: Module Contracts

One-page apparel customization studio for **Tshop** (custom apparel decoration:
heat transfer + embroidery). 2D Konva editor (default) + 3D three.js preview,
in-browser background removal, dimensionally accurate print placement, save /
share / quote-request. Static site (Vite + React 19 + TS), deployed on
Cloudflare Workers static assets. **No runtime network calls** except the
site's own assets (`/models/*`, `/ort/*`).

## Non-negotiables

1. **Inches are the source of truth.** Layers store position/size in inches
   relative to the print-area center (see `src/lib/types.ts`). Pixels only at
   render time via a `pixelsPerInch` argument.
2. **`src/lib/types.ts` is law.** Implement to it exactly; never edit it or
   any file you don't own.
3. **Do not touch** `package.json`, `vite.config.ts`, `tsconfig.json`,
   `index.html`, `src/styles.css`, or another module's directory. All deps are
   preinstalled. If you're missing one, report it in your return payload
   instead of installing.
4. Your module must compile: `npx tsc --noEmit` (whole project). If files
   outside your module fail, ignore those errors; yours must be clean.
5. Licenses: every external asset/model/snippet you bring in gets a line in
   `docs/credits/<module>.md` (name, source URL, license). Only permissive
   licenses (CC0, CC-BY, MIT, ISC, Apache-2.0, OFL).
6. No `console.log` left behind; use small, typed, documented exports.

## Aesthetic tokens (for any UI/visual work)

Dark press-room studio. Chrome recedes, garment is the hero.

- bg0 `#0C0F13` (canvas backdrop) · bg1 `#12161C` (chrome) · bg2 `#181D25`
  (panels) · bg3 `#1F2630` (raised) · line `#2A323E` (borders)
- text `#EEF1F5` · text2 `#9AA5B4` · text3 `#6B7686`
- Functional CMYK inks: cyan `#35C7FF` (interactive/selection), magenta
  `#FF3D8F` (3D energy + smart guides), yellow `#FFC940` (hints, sparse),
  ok `#3ADC97`, danger `#FF5C5C`
- Signature gradient (3D toggle, primary CTA, brand only):
  `linear-gradient(135deg,#35C7FF,#7B6CFF 50%,#FF3D8F)`
- Type: Space Grotesk (display/brand), Inter (UI), JetBrains Mono (ALL
  measurements/dimensions, e.g. `12.0″ × 16.0″`)
- Motif: print registration mark (crosshair in circle) for brand/empty states.

## Shared commands

- Dev server: `npx vite --port <YOUR_PORT> --strictPort` (ports: A1=5181,
  A2=5182, A3=5183, A4=5184, A5=5185; never 5173).
- Screenshot (Chromium preinstalled, WebGL via swiftshader):
  `node scripts/shot.mjs <url> <out.png> [w] [h] [waitMs]`
- Visual modules (A1, A3) MUST iterate with screenshots ≥3 rounds and
  self-critique before finishing. Save screenshots under
  `/tmp/claude-1000/-home-LTH-tshop/575f5767-3272-4009-b6e3-b9a2dd5dd853/scratchpad/<module>/`.
- Dev harnesses live at `dev/<name>.html` + `src/dev/<name>Harness.tsx`
  (served by vite dev automatically; excluded from prod build). Import CSS via
  `import '@/styles.css'` for tokens.

## Ownership map

| Module | Owner | Paths |
|---|---|---|
| Core app, editor engine, state, rendering | main | `src/app`, `src/editor`, `src/state`, `src/lib/*` (except below), `index.html`, configs |
| A1 Garment art | agent | `src/garments/**`, `dev/garments.html`, `src/dev/garmentsHarness.tsx` |
| A2 Background removal | agent | `src/lib/bgremove/**`, `public/ort/u2netp.onnx`, `dev/bgremove.html`, `src/dev/bgremoveHarness.tsx` |
| A3 3D scene | agent | `src/three/**`, `public/models/*.glb`, `dev/three.html`, `src/dev/threeHarness.tsx` |
| A4 Arc text + smart guides + fonts | agent | `src/lib/arcText.ts`, `src/lib/smartGuides.ts`, `src/lib/fonts.ts`, `dev/text.html`, `src/dev/textHarness.tsx` |
| A5 Content (graphics/palettes/pricing/sample) | agent | `src/content/**` |

---

## A1: Garment art (`src/garments`)

Export from `src/garments/index.ts`:

```ts
import type { GarmentArt } from '@/lib/types'
export const GARMENTS: Record<'tee' | 'hoodie', GarmentArt>
```

Hand-crafted, professional flat product illustrations as SVG strings
(CustomInk-editor grade: soft realistic shading, seams, ribbing, drape. NOT
clipart). Front + back for: **tee** (unisex heavy cotton) and **hoodie**
(pullover, kangaroo pocket, drawstrings, front pouch must sit BELOW the print
area).

Rules:
- viewBox `0 0 800 800`; garment visually centered at (400,400).
- `pxPerInch = 25` for BOTH garments (real-size honesty: hoodie draws bigger;
  a 29″-long tee = 725px so everything fits the viewBox with margin).
  tee `widthIn = 21.5` (~537px), hoodie `widthIn = 23` (~575px).
- `body` svg: single `__COLOR__` token as the body fill (may appear multiple
  times). Shading/seam strokes must read on BOTH white and black garments
  (pair dark strokes ~14% opacity with light strokes ~8%).
- Subtle fabric texture via `feTurbulence` (≤3% opacity).
- `shade` svg: ONLY shading meant to darken prints (transparent elsewhere,
  black shapes with low alpha ≤ 0.22 + soft blur). Same viewBox, aligns 1:1.
- Print areas (`printAreaPx` must equal `printAreasIn` × pxPerInch):
  tee front 12×16″ (top edge ≈3″ below collar seam), tee back 12×16″ (top ≈4″
  below collar), hoodie front 12×12″ (bottom must clear the pocket), hoodie
  back 12×14″. Horizontally centered (x = 400 − w/2).
- No external images/hrefs inside the SVGs. Keep each svg ≤ ~14 KB.
- Gradients/filters: prefix every `id` with `t-f-`, `t-b-`, `h-f-`, `h-b-`
  (front/back per garment) so multiple svgs can coexist in one page.
- Harness: grid of both garments × front/back × [#FFFFFF, #191C20, #C0272D,
  #1F2A44] on bg0, plus print-area outlines. Screenshot-iterate ≥3 rounds;
  final screenshot path in your report.

## A2: Background removal (`src/lib/bgremove`)

In-browser salient-object background removal. Model: **U²-Net small
(`u2netp.onnx`, ~4.6 MB, Apache-2.0)**. Download once into
`public/ort/u2netp.onnx` (commit it) from
`https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx`
(mirror: huggingface `tomjackson2023/rembg`). Runtime: `onnxruntime-web`
(preinstalled), **wasm EP, `numThreads = 1`** (no COOP/COEP), simd ok,
`ort.env.wasm.wasmPaths = '/ort/'` (wasm files are auto-copied to `/ort/` by
vite config, already wired, don't touch config).

Export from `src/lib/bgremove/index.ts`:

```ts
export function isBgRemovalSupported(): boolean
export function preloadBgModel(onProgress?: (pct: number) => void): Promise<void>
export interface RemoveBgProgress { stage: 'model' | 'inference' | 'compositing'; pct?: number }
export function removeBackground(source: Blob, opts?: { onProgress?: (p: RemoveBgProgress) => void }): Promise<Blob> // PNG with alpha
export function alphaBoundingBox(source: Blob): Promise<{ x: number; y: number; w: number; h: number } | null> // px in source coords; null if no alpha
```

- Run inference in a module **Web Worker** (`new Worker(new URL(...), {type:'module'})`);
  main thread must stay responsive. Fall back to main thread if no
  OffscreenCanvas.
- Pre/post: letterbox-resize to 320×320, normalize mean (.485,.456,.406) /
  std (.229,.224,.225), take output d0, bilinear-upsample mask to source size,
  smoothstep the mask (lo .05, hi .95), 1px feather, multiply into alpha.
- Downscale sources larger than 2048px on the long edge before compositing.
- Harness: pick-a-file input + before/after side-by-side + timing readout.
- Report inference time for a ~1500px photo in your return payload.

## A3: 3D preview (`src/three`)

Export from `src/three/index.tsx`:

```ts
export type { Garment3DProps } from '@/lib/types'
export default function Garment3D(props: Garment3DProps): JSX.Element
```

- `public/models/tee.glb` already committed (CC0 "shirt_baked" from pmndrs
  market, ~1 MB). Inspect it; recolor via `material.color` (baked light
  texture). **Hoodie**: hunt a CC0/CC-BY hoodie/sweatshirt GLB (github raw,
  poly.pizza, market.pmnd.rs assets CDN…), validate it loads, normalize
  (center, reasonable polycount, neutral/light recolorable material) →
  `public/models/hoodie.glb` + credit line. If after a serious hunt (~15 min)
  nothing works, return `hoodieModel: 'missing'` and make the component render
  a classy "3D for hoodies is coming soon" state (branded empty state w/
  registration-mark motif) while tee/custom still work.
- Design textures arrive as `DecalSource` canvases (transparent print-area
  render). Apply via drei `<Decal>` on the mesh, front at +z / back at −z
  (rotated π). On `version` change: `texture.needsUpdate = true`.
  `THREE.CanvasTexture`, `colorSpace = SRGBColorSpace`, `anisotropy 8`,
  decal depth thin (scale z ≈ 0.15 of width) so it never bleeds through.
- **Dimensional mapping**: mesh scaled so its bounding-box width =
  `garmentWidthIn` × unitsPerInch (pick unitsPerInch so garment ≈ 2.2 world
  units tall). Decal size = `wIn/hIn × unitsPerInch`; decal center Y =
  garment visual center − `areaOffsetYIn × unitsPerInch`. Keep a per-model
  fudge in `src/three/calibration.ts` and calibrate visually vs the 2D art
  (harness shows a labeled grid decal for this).
- Custom garments: `CardSource` composites → a gently curved "card" mesh
  (cylindrical bend ~12°, double-sided pair front/back, alphaTest cutout,
  slight thickness illusion). Missing back → render front silhouette in
  neutral `#242A33` with the same alpha (looks like the blank reverse).
- Stage: fully procedural studio lighting, drei `<Environment resolution={512}>`
  (256 on a phone) with `<Lightformer>` softboxes (NO preset/network HDR), a
  shadow-casting key, TWO opposed shadowless rims per scene and an optional
  hemisphere fill, **Neutral (KHR PBR neutral) tone mapping, not ACES** (ACES
  pulls saturated colour toward the white point, so a red garment previewed here
  came out a different red from the one the customer picked and the one the press
  will print), `<ContactShadows>` over a lit ground disc, dark backdrop consistent
  with bg0, NO idle sway (a `<Float>` with a random phase used to hang the
  garment here; it made two renders of one design incomparable and is gone),
  OrbitControls (rotate/zoom/pan, damped, min/max distance + polar clamp),
  `dpr [1, 1.75]` on desktop and `[1, 1.25]` on a phone.
  `viewRequest` animates camera to front/back/¾ when nonce changes.
  `autoRotate` prop toggles slow turntable. Call `onReady` after first frame.
- WebGL-context-lost → branded error card with "Reload 3D" button.
  No WebGL → `isWebGLAvailable()` guard export (named export) so the app can
  fall back gracefully.
- Harness (`dev/three.html`): renders Garment3D with a generated test decal
  (grid + "TSHOP 12×16" label), buttons for color/garment/view snaps.
  Screenshot-iterate ≥3 rounds (verify decal position vs 2D art proportions,
  lighting quality, no decal bleed-through). WebGL in headless Chromium works
  via the flags already in `scripts/shot.mjs`.

## A4: Arc text, smart guides, fonts (`src/lib`)

`src/lib/arcText.ts`:

```ts
export interface ArcTextConfig {
  text: string; fontFamily: string; fontSizePx: number; letterSpacingPx: number
  curve: number // -100..100, 0 straight, + arcs up
  fill: string; stroke?: string | null; strokeWidthPx?: number
}
export function measureArcText(ctx2d: CanvasRenderingContext2D, cfg: ArcTextConfig): { width: number; height: number }
export function drawArcText(ctx2d: CanvasRenderingContext2D, cfg: ArcTextConfig): void
```

- Draws CENTERED on the origin (bbox spans −w/2..w/2, −h/2..h/2). Single line
  (caller strips newlines). curve → total sweep = `curve × 1.8°` (cap 180°),
  radius from arc length; per-glyph placement tangent to the arc; positive
  curve = text bends upward (ends drop), i.e. baseline on a circle below.
  |curve| < 2 falls back to straight rendering. Stroke drawn UNDER fill per
  glyph. letterSpacing measured along the arc. Must be deterministic (measure
  + draw agree): the same code path runs in the live editor, texture
  renders, and 300-DPI export.

`src/lib/smartGuides.ts` (pure math):

```ts
export interface SnapInput { x: number; y: number; w: number; h: number } // moving bbox
export interface SnapTargets { xs: number[]; ys: number[] } // candidate guide lines
export interface SnapResult { dx: number; dy: number; vLines: number[]; hLines: number[] }
export function computeSnap(box: SnapInput, targets: SnapTargets, tolerance: number): SnapResult
```

Snap box edges AND center to targets; nearest wins per axis; return the
matched lines for drawing.

`src/lib/fonts.ts`:

```ts
import type { FontDef } from '@/lib/types'
export const FONTS: FontDef[] // exactly these families, in this display order:
// Anton, Archivo Black, Bebas Neue, Oswald, Russo One, Alfa Slab One (block)
// Bangers, Righteous, Monoton? NO, not installed. Use: Bangers, Righteous (display)
// Permanent Marker, Pacifico, Lobster (script), Special Elite (retro)
export function ensureFont(family: string): Promise<void> // document.fonts.load, cached, resolves even on failure (after timeout 3s)
export function allFontsReady(): Promise<void>
```

The `@fontsource/<pkg>/400.css` side-effect imports live in
`src/lib/fontFaces.ts` since 5 September 2026, and `ensureFont` pulls that module
in on first use: this file is reached from `ink.ts`, so importing them here put
thirteen families in every customer's first load for screens that write no text
(27,73 ko of stylesheet down to 4,42). Order matters and is enforced there:
`document.fonts.load()` resolves happily with zero faces when no `@font-face`
rule exists, and the canvas then measures the fallback. They're
preinstalled; Oswald also 600). Categories: block: Anton, Archivo Black,
Bebas Neue, Oswald, Russo One, Alfa Slab One · display: Bangers, Righteous ·
script: Permanent Marker, Pacifico, Lobster · retro: Special Elite.

Harness: canvas drawing arc text at curves −90/−45/0/45/90 with stroke, in
several fonts + measure-box overlays proving the bbox is tight. Screenshot to
verify.

## A5: Content (`src/content`)

- `graphics.ts`: `export const GRAPHIC_CATEGORIES: { id: string; name: string }[]`
  and `export const GRAPHICS: GraphicDef[]` (see types). ~120 curated icons
  from the **`lucide`** package (vanilla, preinstalled: build svg strings
  from its icon node data; stroke = color, strokeWidth 2, fill none unless the
  shape needs it) across categories: sports, music, nature, animals, tech,
  food, symbols. PLUS a `badges` category of 8–10 hand-authored FILL-based
  print shapes (circle badge, star burst, ribbon banner, shield, varsity arch
  frame, paw, heart, lightning bolt, crown, flame): these must look like real
  screen-print clipart, not icons. Every id stable + kebab-case. Verify every
  lucide import compiles.
- `palettes.ts`: `export const GARMENT_COLORS: { id: string; name: string; hex: string }[]`,
  exactly: white #FFFFFF, black #191C20, heather #B7BCC2, charcoal #3E434A,
  navy #1F2A44, royal #2454B5, red #C0272D, maroon #6E2231, forest #1E4634,
  kelly #2E8B47, sand #D9CBB2, brown #5B4636, purple #5B3B8C, pink #F3A6C0,
  sky #A8CFE8, orange #E8722A, gold #F2B32C, mint #BFE3D0.
  Also `export const INK_COLORS: string[]`, 16 print-ink hexes for text/
  graphics fills (white, black, grays, CMYK-ish brights, metallic-ish gold/
  silver approximations).
- `pricing.ts`: **SUPPRIMÉ le 5 septembre 2026.** Il portait `PRICING`,
  `QTY_BREAKS`, `areaTiers` et une fonction `quote()` qui chiffrait dans le
  navigateur, en dollars. Un client l'atteignait chaque fois que la poignée de
  main avec la boutique échouait, et les montants pouvaient contredire la
  facture. L'autorité est
  `wp-plugins/teeshoop-core/includes/Pricing.php`, seule, et l'éditeur intégré
  lui demande le prix par `GET /wp-json/teeshoop/v1/quote`. Ce contrat est
  conservé ici parce qu'un lecteur du studio d'origine tombera dessus, et il
  doit trouver la raison plutôt qu'un fichier absent.
- `sampleDesign.ts`: `export function makeSampleDesign(): Design`, a genuinely
  tasteful first-load design on a **black tee**: arced "TSHOP" (Anton, white,
  curve ≈ 35, ~2.2″ tall), a badge graphic from YOUR registry between/below,
  small tracking-heavy subline (Oswald, e.g. "CUSTOM APPAREL · EST. 2019"),
  maybe a small back-side element. Only pinned fonts + your graphic ids +
  INK_COLORS. Layer positions/sizes in inches, front area 12×16.
- No dev harness needed; everything must typecheck.

---

## Return payload (every agent)

```json
{ "module": "A1", "status": "ok" | "partial", "files": ["..."],
  "notes": "gotchas, calibration values, anything the integrator must know",
  "screenshots": ["/abs/path.png"], "missingDeps": [], "credits": "written to docs/credits/<module>.md" }
```
