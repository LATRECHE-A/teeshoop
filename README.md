# Tshop Studio

A one-page custom apparel design studio for **Tshop** — customers design tees,
hoodies, or their own shipped-in garments, preview the result in 2D and true
3D, and hand over print-ready artwork with a quote request.

| 2D editor | 3D preview | Hoodie |
| --- | --- | --- |
| ![2D editor](docs/screens/editor.png) | ![3D preview](docs/screens/3d-tee.png) | ![Hoodie](docs/screens/hoodie.png) |

Built as a fully static site: no backend, no accounts, no tracking. Everything
(designs, uploads, AI background removal) runs and stays in the visitor's
browser.

## Features

**Design tool**
- Multi-layer editor: text, uploaded images, and a ~130-piece graphics library
- 12 print fonts, arched/valley curved text, outlines, letter-spacing
- Drag / resize / rotate with magenta smart guides and snapping, zoom & pan,
  undo/redo, keyboard shortcuts (`?` shows the cheatsheet)
- **Everything is measured in real inches.** The editor, the 3D preview, and
  the exported print files share one geometry, so a 3″ graphic is 3″ on the
  press. Print areas match industry sizes (tee 12×16″, hoodie 12×12″ front /
  12×14″ back)

**Garments**
- Classic tee + pullover hoodie in 18 colors, front & back
- **Bring-your-own garment**: customers photograph the garment they'll ship
  in, place the print area on the photo, and design on it — in 2D and 3D

**AI background removal**
- One click cuts the subject out of any upload (U²-Net running on-device via
  onnxruntime-web; ~4.6 MB model fetched once, zero uploads)

**2D / 3D**
- Loads in fast 2D mode by default; the highlighted toggle switches to a 3D
  studio: real garment meshes, canvas-texture decals of the live design,
  procedural studio lighting, orbit controls, camera snaps, turntable
- Custom garments render as a curved photo-card with the design in place

**Save, share, order**
- Autosave + named designs (IndexedDB), design-file export/import with
  embedded images
- Share links (design compressed into the URL) for text/graphic designs
- Mockup PNGs and **300-DPI transparent print files** per side, with
  low-resolution warnings
- Quote request flow with size grid, quantity discounts, and email handoff

## Stack

Vite 8 · React 19 · TypeScript (strict) · Tailwind CSS v4 · Konva (2D editor
engine) · three.js + react-three-fiber + drei (3D) · zustand + zundo (state +
undo) · onnxruntime-web + U²-Net (background removal) · idb-keyval · lz-string

## Local development

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build locally
```

Dev-only visual harnesses (not part of the build): `/dev/garments.html`,
`/dev/three.html`, `/dev/text.html`, `/dev/bgremove.html`.

## Deploy to Cloudflare Workers

The repo is already configured (`wrangler.jsonc` serves `dist/` as static
assets with SPA fallback). Two ways to ship it:

### Option A — one-off from your machine

```sh
npx wrangler login     # opens the browser, authorize your Cloudflare account
npm run deploy         # builds + uploads; prints https://tshop.<your-subdomain>.workers.dev
```

### Option B — auto-deploy from GitHub (recommended)

1. Cloudflare dashboard → **Compute (Workers) → Workers & Pages → Create**
2. Pick **Import a repository**, connect GitHub, choose the private
   `tshop` repo
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
- `src/content/palettes.ts` — garment colors and ink swatches

## Asset credits

- T-shirt 3D model: "shirt_baked" (pmndrs market, CC0)
- Hoodie 3D model + license: see `docs/credits/A3.md`
- U²-Net (u2netp) saliency model: Apache-2.0, via the rembg project
- Fonts: Google Fonts via @fontsource (OFL/Apache-2.0)
- Icon graphics: lucide (ISC)
- Garment flat illustrations: hand-authored for this project

Full details in `docs/credits/`.
