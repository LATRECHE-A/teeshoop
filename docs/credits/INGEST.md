# INGEST module — credits

No external assets, models, or code snippets were brought into this module.

- Icons: `lucide-react` (already a project dependency) — ISC license,
  https://lucide.dev
- Persistence: `idb-keyval` (already a project dependency) — Apache-2.0,
  https://github.com/jakearchibald/idb-keyval
- Print-placement constants (7.5 cm / 10 cm below collar, 30.5 × 40.6 cm max
  platen) are industry-standard DTG/heat-transfer placement conventions, not
  copied material.
- Size-chart prefills reuse the project's own `src/content/sizeChart.ts`
  (Stanley/Stella official flat measurements, already credited there).
- `public/catalog/imbretex/img/{202358,202359,191135,191137}-back.png` are not
  supplier photographs and are not third-party assets: they are derived, by
  `scripts/generate-missing-backs.mjs`, from the front photos already in that
  folder (same supplier provenance as every other file there) and are marked
  `origin: 'generated'` in `products.json` plus watermarked in the pixels.
