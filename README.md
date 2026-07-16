# Tshop Studio

A one-page custom apparel design studio for **Tshop** — customers design tees,
hoodies, or their own shipped-in garments; preview the result in 2D, true 3D,
and **augmented reality**; and hand over print-ready artwork with a quote
request. It works fully on phones and stays exact to real inches from the screen
to the press.

| 2D editor | 3D preview | AR try-on |
| --- | --- | --- |
| ![2D editor](docs/screens/editor.png) | ![3D preview](docs/screens/3d-tee.png) | ![AR try-on](docs/screens/ar.png) |

The studio is a static browser app — designs, uploads, and AI background removal
all run and stay in the visitor's browser. The **only** server-side piece is a
tiny Cloudflare Worker + R2 bucket that briefly hosts a design's 3D model so a
scanned QR opens it in AR on any phone (see [Augmented reality](#augmented-reality-try-on)).

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
  front / 12×14″ back, sleeve 4×4″)

**Placement guides** — put artwork exactly where it belongs
- Toggle a **1-inch grid** and **named print areas** (A4, chest, left-chest,
  upper/centre back) drawn right on the garment; A4 is highlighted as the
  affordable standard
- Every area — plus A5 and the full print area — is a one-tap **"Place in area"**
  chip that centres and fits the selected layer; artwork also **snaps to zone
  edges & centres** as you drag

![Placement guides](docs/screens/guides.png)

**Garments & sides**
- Classic tee + pullover hoodie in 18 colors, with **front, back and sleeve**
  print sides
- **Bring-your-own garment**: customers photograph the garment they'll ship in,
  place the print area on the photo, and design on it — in 2D, 3D, and AR

| Sleeve print side | Placement chips |
| --- | --- |
| ![Sleeve](docs/screens/sleeve.png) | ![Guides](docs/screens/guides.png) |

**2D / 3D preview**
- Loads in fast 2D mode by default; the highlighted toggle switches to a 3D
  studio: real garment meshes with a **cloth sheen**, canvas-texture decals of
  the live design, procedural studio lighting + soft contact shadows, orbit
  controls, camera snaps, turntable, and six environment scenes
- Custom garments render as a **rounded, cloth-like body** — the uploaded photo
  is inflated into a torso-centred dome (per-row half-ellipse cross-section +
  distance-field depth, baked ambient occlusion, a woven-cloth normal grain, and
  a hollow neck) so the design drapes over real volume instead of a flat card

| Custom garment (3D) | Hoodie (3D) |
| --- | --- |
| ![Volumetric custom garment](docs/screens/3d-custom.png) | ![Hoodie](docs/screens/hoodie.png) |

**Augmented reality try-on**
- **"View in AR"** in the editor bakes the design onto the garment in 3D — the
  **real tee/hoodie mesh** (the same one you see in the preview), or a male/female
  mannequin for ship-your-own garments — exports it to **glTF (GLB) + USDZ**,
  uploads it to the blob store, and shows a **QR of a short link**. Because the
  model lives server-side, the QR is small (so it scans reliably) and works
  **cross-device** — any phone, including for photo/custom-garment designs
- Scanning opens a lightweight viewer page with a spinning 3D preview and a
  **"View in your space"** button that launches the phone's **native AR** —
  Scene Viewer on Android, Quick Look on iOS — planting the life-size garment on
  your real floor, with the OS's own screenshot & share

![AR QR code](docs/screens/ar-qr.png)

**Works on your phone**
- A full Canva-style mobile UI: full-bleed canvas, a bottom tool-nav, slide-up
  tool sheets, safe-area (notch / home-indicator) handling, and touch-sized
  controls
- Tapping a layer shows a slim **selection bar** (edit · duplicate · delete) that
  never covers the artwork — so you can drag it freely — and **"Edit"** expands
  the full properties sheet only when you want it

| Mobile canvas | Editing on mobile |
| --- | --- |
| ![Mobile](docs/screens/mobile.png) | ![Mobile editing](docs/screens/mobile-edit.png) |

**AI background removal**
- One click cuts the subject out of any upload (U²-Net running on-device via
  onnxruntime-web; ~4.4 MB model fetched once, zero uploads)

**Save, share, order**
- Autosave + named designs (IndexedDB), design-file export/import with embedded
  images, share links (design compressed into the URL) for text/graphic designs
- Mockup PNGs and **300-DPI transparent print files** per side, with
  low-resolution warnings
- Quote request flow with size grid, quantity discounts, and email handoff.
  Pricing is flat per side by default, with **optional area-aware tiers** wired
  in (A4-and-under is the standard price; larger prints step up) — see
  [Configuration](#configuration)

## Stack

Vite 8 (multi-page: studio + AR viewer) · React 19 · TypeScript (strict) ·
Tailwind CSS v4 · Konva (2D editor engine) · three.js + react-three-fiber + drei
(3D) · three GLTFExporter / USDZExporter / GLTFLoader (AR models) · zustand +
zundo (state + undo) · onnxruntime-web + U²-Net (background removal) · qrcode ·
idb-keyval · lz-string · Cloudflare Worker + R2 (AR model store)

## Local development

```sh
npm install
npm run dev        # http://localhost:5173  (studio)
npm run build      # typecheck (app + worker) + production build into dist/
npm run preview    # serve the production build locally
```

Note: the **AR upload/QR flow needs the Cloudflare Worker + R2 binding**, which
plain `npm run dev` doesn't run. Use `npx wrangler dev` (below) to exercise it
locally; everything else works under `npm run dev`.

Dev-only visual harnesses (not part of the build): `/dev/garments.html`,
`/dev/three.html`, `/dev/inflate.html`, `/dev/text.html`, `/dev/bgremove.html`.

Headless checks (Playwright): the full flow `node scripts/e2e-verify.mjs <url>`,
plus focused ones for the WebGL/AR features that OS screenshots can't capture —
`node scripts/inflate-verify.mjs` (3D volume), `node scripts/ar-verify.mjs`
(GLB/USDZ export), and `node scripts/ar-worker-verify.mjs` (the Worker + R2
round-trip via `wrangler dev`). Regenerate the README screenshots with
`node scripts/readme-shots.mjs`.

## Deploy to Cloudflare Workers

The repo is configured (`wrangler.jsonc`) as a Worker that serves `dist/` as
static assets (SPA fallback) **plus** three dynamic routes for AR:
`POST /api/ar` (store a model), `GET /r2/ar/{id}.{ext}` (serve it with the right
MIME), and `GET /v/{id}` (the viewer page). Camera + native AR require HTTPS,
which Cloudflare provides.

**One-time setup — create the R2 bucket + an expiry rule** (models are private
per-design and should not accumulate forever):

```sh
npx wrangler login
npx wrangler r2 bucket create tshop-ar
# Auto-delete stored models after 30 days (R2 has no per-object TTL):
npx wrangler r2 bucket lifecycle add tshop-ar expire-ar ar/ --expire-days 30 -y
```

### Option A — one-off from your machine

```sh
npm run deploy         # builds + uploads; prints https://tshop.<subdomain>.workers.dev
```

### Option B — auto-deploy from GitHub (recommended)

1. Cloudflare dashboard → **Compute (Workers) → Workers & Pages → Create**
2. Pick **Import a repository**, connect GitHub, choose the private `tshop` repo
3. Build settings:
   - **Build command:** `npm run build`
   - **Deploy command:** `npx wrangler deploy`
4. Deploy. Every push to `main` now builds and deploys automatically.

To test the Worker + R2 locally before deploying: `npx wrangler dev` (uses a
simulated local R2 bucket — no cloud account needed).

Custom domain later: Worker → **Settings → Domains & Routes → Add → Custom
domain** (e.g. `studio.tshop.com`).

## Configuration

- `src/config.ts` — business name, tagline, and **the quote-request email**
  (replace `orders@tshop.example` before going live)
- `src/content/pricing.ts` — base prices, per-side surcharge, quantity breaks,
  and the **area tiers** (`areaTiers`). Prints up to A4 are the standard price;
  A3 and oversize step up. Remove `areaTiers` from a garment's rule to make it
  flat again — no other change needed. Zone inch-sizes come from
  `src/content/zones.ts`
- `src/content/palettes.ts` — garment colors and ink swatches

## Asset credits

- T-shirt 3D model: "shirt_baked" (pmndrs market, CC0)
- Hoodie 3D model + license: see `docs/credits/A3.md`
- AR mannequin + flat sleeve: procedural (built in code, no external asset)
- U²-Net (u2netp) saliency model: Apache-2.0, via the rembg project
- Fonts: Google Fonts via @fontsource (OFL/Apache-2.0)
- Icon graphics: lucide (ISC)
- QR generation: `qrcode` (MIT)
- Garment flat illustrations: hand-authored for this project

Full details in `docs/credits/`.
