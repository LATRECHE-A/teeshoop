# Tshop Studio

A one-page custom apparel design studio for **Tshop** — customers design tees,
hoodies, or their own shipped-in garments; preview the result in 2D, true 3D,
and **augmented reality**; and hand over print-ready artwork with a quote
request. It works fully on phones and stays exact to real inches from the screen
to the press.

| 2D editor | 3D preview | AR try-on |
| --- | --- | --- |
| ![2D editor](docs/screens/editor.png) | ![3D preview](docs/screens/3d-tee.png) | ![AR try-on](docs/screens/ar.png) |

Built as a fully static site: no backend, no accounts, no tracking. Everything
— designs, uploads, AI background removal, the AR experience — runs and stays in
the visitor's browser.

## Features

**Design tool**
- Multi-layer editor: text, uploaded images, and a ~130-piece graphics library
- 12 print fonts, arched/valley curved text, outlines, letter-spacing
- Drag / resize / rotate with magenta smart guides and snapping, zoom & pan
  (mouse **and** touch pinch-zoom), undo/redo, keyboard shortcuts (`?` shows the
  cheatsheet)
- **Everything is measured in real inches.** The editor, the 3D preview, the AR
  view, and the exported print files share one geometry, so a 3″ graphic is 3″
  on the press. Print areas match industry sizes (tee 12×16″, hoodie 12×12″
  front / 12×14″ back)

**Placement guides** — put artwork exactly where it belongs
- Toggle a **1-inch grid** and **named print areas** (A4, chest, left-chest,
  upper/centre back) drawn right on the garment; A4 is highlighted as the
  affordable standard
- Every area — plus A5 and the full print area — is a one-tap **"Place in area"**
  chip that centres and fits the selected layer; artwork also **snaps to zone
  edges & centres** as you drag
- Guides are placement help only — they don't change pricing

![Placement guides](docs/screens/guides.png)

**Garments**
- Classic tee + pullover hoodie in 18 colors, front & back
- **Bring-your-own garment**: customers photograph the garment they'll ship in,
  place the print area on the photo, and design on it — in 2D, 3D, and AR

**2D / 3D preview**
- Loads in fast 2D mode by default; the highlighted toggle switches to a 3D
  studio: real garment meshes, canvas-texture decals of the live design,
  procedural studio lighting + soft contact shadows, orbit controls, camera
  snaps, turntable, and six environment scenes
- Custom garments render as a **volumetric, cloth-like shell** — the uploaded
  photo is inflated into a rounded body (distance-transform depth + fabric sheen,
  hollow neck) rather than a flat card, so the design drapes over real volume

| Custom garment (3D) | Hoodie (3D) |
| --- | --- |
| ![Volumetric custom garment](docs/screens/3d-custom.png) | ![Hoodie](docs/screens/hoodie.png) |

**Augmented reality try-on**
- **"View in AR"** in the editor generates a **QR code**; scanning it on a phone
  opens a camera-passthrough page that stands a **3D mannequin** — male or
  female, the customer's choice — wearing the design in their real space
- Device-tilt parallax plus one-finger reposition / two-finger pinch & rotate;
  **snapshot → share or download**; true world-anchoring via WebXR where the
  device supports it, with a universal camera-overlay fallback (iPhone + Android)
- Shareable AR links carry text/graphic designs anywhere; photo-based designs
  open in AR on the same device (nothing is uploaded)

![AR QR code](docs/screens/ar-qr.png)

**Works on your phone**
- A full Canva-style mobile UI: full-bleed canvas, a bottom tool-nav, slide-up
  panel and properties sheets, safe-area (notch / home-indicator) handling, and
  touch-sized controls — the entire studio is usable on a phone

| Mobile canvas | Editing on mobile |
| --- | --- |
| ![Mobile](docs/screens/mobile.png) | ![Mobile editing](docs/screens/mobile-edit.png) |

**AI background removal**
- One click cuts the subject out of any upload (U²-Net running on-device via
  onnxruntime-web; ~4.4 MB model fetched once, zero uploads)

**Save, share, order**
- Autosave + named designs (IndexedDB), design-file export/import with embedded
  images
- Share links + AR links (design compressed into the URL) for text/graphic
  designs
- Mockup PNGs and **300-DPI transparent print files** per side, with
  low-resolution warnings
- Quote request flow with size grid, quantity discounts, and email handoff

## Stack

Vite 8 (multi-page: studio + AR) · React 19 · TypeScript (strict) · Tailwind CSS
v4 · Konva (2D editor engine) · three.js + react-three-fiber + drei (3D) · raw
three.js + WebXR (AR) · zustand + zundo (state + undo) · onnxruntime-web +
U²-Net (background removal) · qrcode · idb-keyval · lz-string

## Local development

```sh
npm install
npm run dev        # http://localhost:5173  (studio) · /ar.html (AR page)
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build locally
```

Dev-only visual harnesses (not part of the build): `/dev/garments.html`,
`/dev/three.html`, `/dev/inflate.html`, `/dev/text.html`, `/dev/bgremove.html`.

Headless checks (Playwright): the full flow `node scripts/e2e-verify.mjs <url>`,
plus focused ones for the WebGL features that OS screenshots can't capture —
`node scripts/ar-verify.mjs`, `node scripts/inflate-verify.mjs`. Regenerate the
README screenshots with `node scripts/readme-shots.mjs`.

## Deploy to Cloudflare Workers

The repo is already configured (`wrangler.jsonc` serves `dist/` as static assets
with SPA fallback). The build emits both `index.html` (studio) and `ar.html`
(the AR page); the SPA fallback serves `ar.html` directly at `/ar.html`, so no
extra routing is needed. Camera + WebXR require HTTPS, which Cloudflare provides.

### Option A — one-off from your machine

```sh
npx wrangler login     # opens the browser, authorize your Cloudflare account
npm run deploy         # builds + uploads; prints https://tshop.<your-subdomain>.workers.dev
```

### Option B — auto-deploy from GitHub (recommended)

1. Cloudflare dashboard → **Compute (Workers) → Workers & Pages → Create**
2. Pick **Import a repository**, connect GitHub, choose the private `tshop` repo
3. Build settings:
   - **Build command:** `npm run build`
   - **Deploy command:** `npx wrangler deploy`
4. Deploy. Every push to `main` now builds and deploys automatically.

Custom domain later: Worker → **Settings → Domains & Routes → Add → Custom
domain** (e.g. `studio.tshop.com`).

## Configuration

- `src/config.ts` — business name, tagline, and **the quote-request email**
  (replace `orders@tshop.example` before going live)
- `src/content/pricing.ts` — base prices, per-side surcharge, quantity breaks
  (pricing is flat by design; placement zones in `src/content/zones.ts` carry
  real inch sizes if you later want area-based quoting)
- `src/content/palettes.ts` — garment colors and ink swatches

## Asset credits

- T-shirt 3D model: "shirt_baked" (pmndrs market, CC0)
- Hoodie 3D model + license: see `docs/credits/A3.md`
- AR mannequin: procedural (built in code, no external asset)
- U²-Net (u2netp) saliency model: Apache-2.0, via the rembg project
- Fonts: Google Fonts via @fontsource (OFL/Apache-2.0)
- Icon graphics: lucide (ISC)
- QR generation: `qrcode` (MIT)
- Garment flat illustrations: hand-authored for this project

Full details in `docs/credits/`.
