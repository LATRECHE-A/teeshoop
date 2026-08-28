# DTF module: credits & data sources

No external code, assets, fonts or models were brought into this module.
The nesting engine (`src/lib/dtf/nesting.ts`) is an original shelf/FFDH
implementation written for this repo: no packing library used. The
fixed-format binner reuses that same packer once per candidate format
(greedy, one sheet at a time); no third-party bin-packing code.

Since 2026-07-26 there is a second, original packer: `src/lib/dtf/trueshape.ts`,
a semi-discrete bottom-left-fill on a column-profile raster of the artwork's own
alpha mask. Also written from scratch: no MAXRECTS/skyline library, no NFP
library (SVGnest, Deepnest, libnest2d), no jagua-rs/sparrow WASM. It keeps the
shelf packer as its restart #0, so its answer is never worse than the old one.
The ZIP writer (`src/lib/zip.ts`) is likewise dependency-free: store-only with
streaming CRC-32 and ZIP64, no JSZip.

**Prior art consulted but not used** (no code taken, listed for honesty):
Jylänki, *A Thousand Ways to Pack the Bin* (rectangle packing survey);
Gardeyn & Wauters, *sparrow* (arXiv:2509.13329, MIT) and `jagua-rs`, the current
state of the art in irregular strip packing, 87–93 % density on garment-shaped
instances after 20 CPU-minutes, which is the honest ceiling to compare against;
Sato et al., *EJOR* 2022 (`S0377221721008936`) for the semi-discrete raster BLF
family this implementation belongs to.

## How the data is structured

Since 2026-07-26 a supplier is `SupplierProfile → processes[] → DtfProcess`,
where a process is `dtf` or `uvdtf` and carries its own geometry, its own
billing model (`roll` = per linear metre, `fixed` = per catalogue sheet) and
its own **structured** guidelines (`DtfGuidelines`), the numbers
`src/lib/dtf/preflight.ts` checks artwork against. The previous free-text
`fileFormat` / flat-roll shape is migrated on load (see "Migration" below).

Profiles are runtime-editable and persisted in localStorage
(`tshop:dtf:suppliers`). Prices move; treat everything below as "read on the
date given", not as a contract.

## Sources (public pages, read July 2026)

| Supplier | Source | Data used |
|---|---|---|
| DTF Plus | https://dtfplus.eu (product, FAQ and prepress pages) | **DTF** : rouleau 58 cm imprimables, 250 cm max par fichier, ≥ 200 DPI, PDF ou PNG transparent, CMJN ou RVB, trait mini 1,0 mm couleur / 0,5 mm blanc, polices vectorisées, minimum 1 lm, presse 130 °C / 6–8 s / pression forte, blanc auto choke 0,15 mm. **UV-DTF** : rouleau 30 cm (28 cm imprimables), 100 cm max, ≥ 250 DPI, couche blanche réduite de 0,15 mm vs la couleur, minimum 0,5 lm, séchage 24–48 h. Tarifs DTF €/lm 8,00 / 7,00 / 6,00 / 5,50, **port UPS 9 € standard / 12 € express**, franco ≥ 20 lm, TVA 0 % (autoliquidation) |
| OhMyDTF | https://ohmydtf.com (pages produits, livraison et FAQ) | Impression à **Ennery (95), Île-de-France** → J+1 impression, Chronopost 24 h, **franco de port dès 50 €**, 60+ lavages à 40 °C, détail jusqu'à **0,6 mm (1,75 pt)**. **Vend au FORMAT FIXE, pas au mètre** : DTF = 10 × 10 cm « cœur », A4, A3, A2, 1 m, 2 m ; UV-DTF = A5, A4, A3, 50 × 100 cm. Fichiers DTF : .ai / .psd / .pdf / .tiff ; UV-DTF : .png |
| Royal DTF | https://fr.royaldtf.com (page tarifs) | Feuilles 56 × 100 cm facturées au métré, 300 DPI, paliers 9,90 → 6,00 €/m, commande minimum 49 €, DHL Express |
| Pressink | https://pressink.fr (page tarifs) | Laize 56 cm, 300 DPI mini, PNG transparent, paliers 15,99 → 7,20 €/m, port 5,90 € franco dès 50 €, production française |

| Impression-DTF | https://impression-dtf.com | Production française, encres OEKO-TEX, laize 56 cm, **300 DPI minimum**, PNG (fond transparent recommandé) / PDF / AI / PSD, **aucun minimum de commande**, port offert dès 100 € HT. Tarif indexé sur le DÉLAI et non la quantité : 5,45 € HT/ml en éco 72–96 h, 6,54 € en standard 48 h, 8,72 € en express 24 h |

## Edge margin and inter-design spacing: what suppliers actually publish

Read 2026-07-26, primary sources. This is the sweep that killed the old
`gapCm 0,8 / marginCm 1,0` defaults, which were house inventions costing ≈ 4 %
of every roll before a single line of packer code ran.

**Most suppliers publish nothing at all.** DTF+, OhMyDTF, Pressink, Royal DTF,
DTF a Profesionales, NextDayDTF and TshirtDeal state no edge margin, no bleed,
no safe zone and no inter-design gap. DTF+'s entire DTF spec is six lines
(58 cm width, ≤ 250 cm length, ≥ 200 DPI, CMYK/RGB, 1,0 mm colour / 0,5 mm white
line, fonts outlined). Do not let the tool pretend otherwise: that is what
`marginSource` / `gapSource` are for.

Four EU printers do publish a figure:

| Supplier | Between designs | Edge | Exact quote |
|---|---|---|---|
| DTF-Blitz (DE) | **5 mm** | **0** | « Mindestens 5 mm Abstand zwischen den Motiven » + « Ein zusätzlicher Beschnitt muss nicht berücksichtigt werden » |
| DTF-Profis (DE) | **4 mm** | 5–10 mm *pour découpe manuelle* | « Mindestens 4 mm Abstand zwischen Motiven. Für manuelles Schneiden: 5–10 mm Randabstand. » |
| ZebraTransfers (DE) | 10–20 mm | not published | « etwa 1 bis 2 cm Platz » (confort de découpe, pas une exigence machine) |
| Tissus Print (FR) | 10 mm | **5 mm** | « Laissez 5 mm minimum de marge intérieure à partir du bord final » |

Therefore the shipped defaults are:

- `gapCm = 0,5`, the strictest **published** EU minimum. **4 mm is the absolute
  floor** (DTF-Profis); never go below it.
- `marginCm = 0` wherever the supplier quotes a **printable** width: those 58 cm
  *are* the safe area, and DTF-Blitz says explicitly that no bleed is needed.
  `marginSource: 'printable-width'` marks these, and the modal says so.
- `marginCm = 0,3` (3 mm industry safe zone) only where the supplier publishes
  neither a margin nor a printable width. `marginSource: 'house'`.
- `marginEndCm = 0` on rolls: the two short edges are a scissor cut, not a
  printer edge. They were previously charged the full margin, burning 2 cm of
  film per sheet for nothing.

⚠ **The zero side margin at DTF+ is an inference, not a quote.** If their film
is 60 cm and the RIP left-justifies a 58 cm file with a feed margin, the
right-hand column clips. Order one 1 lm test sheet with an edge-to-edge 5 mm
calibration grid before switching production to it. Same for the 5 mm gap: DTF+
publishes none, so it is borrowed from DTF-Blitz.

## Numbers that are NOT confirmed (best-effort placeholders)

These are encoded so the tool works end-to-end; **confirm with the supplier
before ordering**. Each one is an estimate or an inference, never a quote.

| Where | Value | Why it is uncertain |
|---|---|---|
| `ohmydtf` VAT basis | TTC | **Unresolved contradiction**: the product pages say « Prix unitaire H.T. », the CGV say prices are TTC. A 17 % swing that moves OhMyDTF from 6th to 2nd on delivered cost. Ask for a sample invoice before quoting. |
| `ohmydtf` / `uvdtf` prices | A5 6,50 € · A4 11 € · A3 18 € · 50 × 100 45 € | Format list confirmed; the price grid is an estimate. |
| `ohmydtf` shipping | 4,90 € below the 50 € franco | Only the free-shipping threshold (50 €) is confirmed. |
| `ohmydtf` volume discount | 2 m at 26 € from 50 units | Discounts may require the **same file** repeated: 5 different sheets could stay at the 1–4 tier. Contrast DTF Print, which applies tiers across different files. |
| `minTextPt` (all profiles) | 8 pt (10 pt en UV-DTF) | **House floor, not a supplier figure.** Nobody publishes a minimum point size; OhMyDTF's 1,75 pt is a *stroke* figure. The real binding rule is the 1,0 mm minimum stem width, which implies ≈32 pt regular / ≈20 pt bold and would reject a lot of legitimate artwork, so this check stays advisory. |
| `gapCm` / `marginCm` (all profiles) | 0,5 cm / 0 or 0,3 cm | See the spacing section above. The gap is DTF-Blitz's published 5 mm applied everywhere; the 0 side margin is **inferred** from suppliers quoting a printable width. Both set nesting efficiency directly. Confirm per supplier, and test-print before trusting the 0. |
| `billingStepCm` (all roll profiles) | 10 cm (0,1 lm) | **Unverified for every supplier.** If one bills whole linear metres (100), every packing gain under 1 m evaporates and the packer should be optimising whole metres instead of centimetres. Now per-process and editable, so it can be corrected without a code change. |
| `impressiondtf` max length | 100 cm | Not published. Kept prudently low: a too-long file comes back rejected, a too-short one only costs a sheet split. |
| `impressiondtf` shipping | 0 € encoded | Only the « offerte dès 100 € HT » franco is published; the cost below it is unknown. Encoded as 0, which **under**-states small orders. Do not quote from it. |
| `impressiondtf` tier quantity | 5,45 €/ml from 1 lm | Their grid is indexed on **delay**, not quantity, and every price is « à partir de ». The éco 72–96 h rate is encoded; switch the tier by hand for a rush order. |
| Who cuts the transfers | assumed: we do | Only DcomDTF (« pas d'échenillage, pas de découpe ») and Sherpa (UV contour-cut) are explicit. If a supplier does contour-cut, the required gap changes. |
| `dtfplus` rounding granularity | whole/part linear metres unknown | Whether part-metres are billed up is not published; on a 2 lm order forced rounding could add 20–40 %. |
| `royaldtf` / `pressink` `printsFrom`, `daysToParis` | « UE (DHL Express) », « France », 1–3 j | Lead times are marketing claims, not measured. |
| `pressink` max length | 250 cm | Not documented; kept as the prudent value from the previous profile. |
| `royaldtf` / `pressink` line + text minima | house floors (1,0 / 0,5 mm) | Neither publishes stroke minima; the DTF-industry floor is used. |

### Corrected 2026-07-26 after a primary-source sweep

| Was | Now | Note |
|---|---|---|
| OhMyDTF A4 14 € / A3 15,60 € / A2 24 € / 2 m 56 € | **A4 4,90 € · A3 7,20 € · A2 13,30 € · 1 m 17 € · 2 m 32 € · cœur 2,50 €** | The old figures were interpolations and were ~3× too high. |
| OhMyDTF formats at ISO A-series | **A4 21 × 28 · A3 28 × 42 · A2 42 × 56 cm** | **Nobody's "A4/A3/A2" are ISO sizes.** Always template to the supplier's own cm or artwork overflows. |
| OhMyDTF width 55 cm | **56 cm**, max length 200 cm | |
| DTF+ UV line minima 0,5 / 0,65 mm | **1,0 mm couleur / 0,8 mm blanc** | 0,5 mm is the *standard DTF* white minimum, not the UV one. |
| DTF+ UV tiers 12 / 10,50 / 9 €/lm | **9,00 (≥0,5) · 8,00 (≥3) · 7,50 (≥5) · 7,00 (≥10)** | Published grid. |
| DTF+ `printsFrom` « UE » | **Rzeszów, Pologne** | UPS Standard 2–4 j to Paris, Express 1–2 j at 12 €. |
| DTF+ shipping | free from **20 linear metres** (not a euro threshold) | See the cliff below. |

### Corrected 2026-07-26 (second sweep, spacing + geometry)

| Was | Now | Note |
|---|---|---|
| `BASE_GUIDELINES` gap 0,8 cm / margin 1,0 cm | **gap 0,5 · marge côtés 0,3 (0 si laize imprimable) · marge bouts 0** | House inventions with no supplier backing; see the spacing section. |
| OhMyDTF A2 42 × 56, 1 m 56 × 100, 2 m 56 × 200 | **A2 40 × 57 · 1 m 55 × 100 · 2 m 55 × 200** | Relevé sur `/collections/all`. **A live bug**: a 56 cm file laid on a 55 cm sheet was being clipped in silence. |
| OhMyDTF `printableWidthCm` 56 | **55** | Same cause. |
| DTF+ `shippingEur` 8 | **9** (12 en express) | Their pricing block no longer shows 8 €. |
| single `edgeMarginCm` | **`edgeMarginSideCm` + `edgeMarginEndCm`** | Physically different constraints: a laize limit versus a scissor cut. The end margin was being charged twice per sheet on rolls. |
| `BILLING_STEP_CM` hard-coded at 10 | **`DtfProcess.billingStepCm`** | Per supplier, and editable in the admin panel. |
| nothing | **Impression-DTF added** | Cheapest verified €/m² (9,73 HT), French production, OEKO-TEX, and **no intracommunity VAT number required**, which is the blocker on DTF+. |
| Royal DTF / Pressink tariffs | flagged **non re-verified** in `notes` | Royal's tariff page 404s and Pressink no longer publishes a grid. Do not quote a client from them. |

**DTF+ is B2B-only and requires a valid EU VAT number.** Without one the cheapest
supplier by 35–53 % is simply unavailable. Their CGV also exclude colour variation
as grounds for complaint, so colour control is ours. Impression-DTF is now the
default recommendation precisely because it undercuts DTF+ **without** that gate.

### The 20 lm cliff (implemented as `thresholdTip()`)

The 6 €/lm tier break and the free-shipping threshold both land at 20 lm, so:

    19,9 lm → 7,00 €/lm + 9 € port = 148,30 €
    20,0 lm → 6,00 €/lm + port offert = 120,00 €

**20 lm costs less in absolute euros than 19,9 lm, for more film.** `thresholdTip()`
detects this generically (it tests every tier break and free-shipping threshold, not
a hard-coded supplier) and the cost panel surfaces it. Never order 15–19,9 lm here.

### Delivered cost to Paris, EUR HT per m² of film (2026-07)

Normalised as `€/lm ÷ (width/100)` for rolls and `price ÷ (w × h / 10 000)` for sheets.

| Supplier | Small (~1 m²) | Medium (~5 m²) | Best batched |
|---|---|---|---|
| **Impression-DTF** (roll, FR) | **9,73** (éco) | **9,73** | **9,73** (franco dès 100 € HT ≈ 18,3 lm) |
| **DTF+** (roll, PL) | **20,69** | **13,45** | **10,34 @ 20 lm · 9,48 @ 50 lm** |
| Tissus Print (roll) | 33,98 | 21,97 | 15,52 |
| Sherpa (hybride) | 44,02 | 23,49 | 12,25 (compte pro requis) |
| DcomDTF (hybride) | 31,84 | 26,67 | pas de dégressif réel |
| DTF Print (fixe) | ~33,04 | 25,00 | 13,10 (TTC → HT calculé) |
| OhMyDTF (fixe) | ~34,82 | 26,79 | 23,21 |

- Best quality evidence: **Sherpa**, OEKO-TEX cert. CQ 1380/1, ISO 15025, and the only
  supplier publishing a named ICC profile (PSO Coated V3).
- Best speed to Paris: **OhMyDTF**, 35 km away, Chronopost J+1, no rush surcharge.
- **Never route gang sheets through A4/A3/cœur formats: 2–11× the €/m² of a metre.**
- Colour space has **no safe universal default**: CMYK for OhMyDTF-textile/DcomDTF/
  Sherpa/DTF Print, but sRGB *required* by Tissus Print, and RGB for OhMyDTF UV-DTF.
- Tier ladders must not be read as "last matching row": Tissus Print's is non-monotonic
  (prepaid packages mixed into the pay-as-you-go grid), so pricing takes the **cheapest**
  applicable rate.
- DcomDTF and Sherpa are **hybrid** (roll *and* sheets, with ladders that cross over).
  The current model gives each supplier one process per billing mode; pricing both paths
  and picking the cheaper is not yet automated.

## Nesting: what the true-shape packer is actually worth

Measured by `scripts/dtf-bench.mjs`, which drives the **shipped bundle** in a
headless browser (not a transcription of it), on a 58 cm roll with the
researched 5 mm gap and 0 margins, 12 restarts. `basket` is the studio's own
sample design rendered through `renderPiece`, masks and all.

| instance | bbox fill | shelf | strips (jeu 0) | jeu 2 cm | max fill | + 180°/270° |
|---|---|---|---|---|---|---|
| rects | 100 % | 690,0 | 640,0 | 640,0 | **640,0** | 640,0 |
| logos | 67 % | 380,0 | 380,0 | 380,0 | **340,0** | 340,0 |
| apparel | 67 % | 660,0 | 580,0 | 560,0 | **560,0** | 540,0 |
| concave | 51 % | 610,0 | 610,0 | 610,0 | **560,0** | 490,0 |
| basket (real) | 30 % | 340,0 | 320,0 | 280,0 | **240,0** | 190,0 |
| **TOTAL cm** | | **2680,0** | | | **2340,0 (−12,7 %)** | **2200,0 (−6,0 % de plus)** |

Ink coverage on the real basket goes 27 % → the packer's honest ceiling; box
coverage passes 100 % because interlocked bounding boxes *overlap*, which is the
point (the UI therefore leads with the ink figure and labels the other "boîtes").

Cost: 240–470 ms at 12 restarts, 520–1010 ms at 24 (was 49–184 ms before the
rung sweep below: the max-fill end of the slider now genuinely searches more).
It runs in a Web Worker (`src/lib/dtf/nestWorker.ts`) with an inline fallback,
but the packer itself stays a pure synchronous function so the verification
scripts exercise the same code path with no Worker in sight.

**180°/270° are worth a real 6,0 %** and are therefore offered, but OFF by
default and always will be: a transfer pressed upside down is scrap. The
operator opts in per order, the cutting plan arrows each piece's "up", and the
manifest records whether flips were allowed (a layout cannot be reproduced
without knowing).

`restarts` is a **count, never a time budget.** A wall-clock budget would give
different layouts on different machines, and the manifest is an order-tracking
artefact: "the re-export moved everything" is a support nightmare.

### The interlock slider must be monotone, and was not

Greedy bottom-left-fill is **not monotone in the dip allowance**: more freedom
walks into different local optima. Measured on the benchmark before the fix, at
12 restarts:

    logos    jeu 2 cm 380,0 cm → maximum 340,0 cm   (fine)
    logos    jeu 0    370,0 cm → jeu 2 cm 380,0 cm  (+2,7 % for asking for MORE fill)
    concave  jeu 5 cm 350,0 cm → jeu 8 cm 380,0 cm  (+8,6 %)
    concave  jeu 12   350,0 cm → maximum 360,0 cm   (+2,9 %)

An operator who drags the slider to « Remplissage max » and is handed **more**
film stops trusting the feature, so `maxInterlockCm` is now a CEILING that the
packer *sweeps*: every rung of `INTERLOCK_STOPS_CM` at or below it, each with
the full set of insertion orderings. The rung set only grows with the ceiling
and the orderings do not depend on it, so the candidate set at a higher stop is
a superset of the one at every lower stop: monotonicity is a property of the
search space, not a hope, and `scripts/dtf-bench.mjs` fails the build if any
instance's ladder ever climbs.

Two consequences worth knowing:

- **The slider has 6 stops, not 10** (`0 · 1 · 2 · 5 · 12 cm · maximum`). The
  guarantee is stated over exactly the rung set, so a stop the packer does not
  sweep would reintroduce the anomaly. Every extra rung also multiplies the
  search, which is why the list is short.
- **Rung 0 packs bounding boxes**, exactly as a ceiling of 0 does. With
  true-shape profiles a zero dip only puts a piece above the *ink* in the
  columns it spans, so a neighbour whose ink stops early can still overhang it,
  and « bandes droites » has to mean straight rows. That makes the two profile
  sets different searches, so a ceiling above 0 runs both; without it the logo
  set packed into 370 cm at ceiling 0 and 380 cm at ceiling 2.

### The outer half-gap belongs to the sheet edge

`gapCm` is implemented as a half-gap inflation on all four sides of every piece,
so two touching inflated boxes are exactly `gapCm` apart. The outermost pieces
have **no neighbour past the sheet edge**, so that outer half must be swallowed
by the margin, which is what the shelf packer's `usableW = width − 2·side +
gap` has always done. The true-shape packer did not, and was therefore `gapCm`
narrower *and* `gapCm` shorter per sheet than the packer it is supposed to beat:
on a 58 cm roll at a 5 mm gap, three 19 cm pieces (19·3 + 0,5·2 = 58,0 cm on the
nose) fitted **two** per row instead of three, and a piece exactly the printable
width was reported unplaceable. Fixed by putting the cell-grid origin half a gap
outside the usable area; `scripts/dtf-verify.mjs` asserts both cases.

### Fixed formats: cheapest per piece ≠ cheapest

The greedy binner buys, each round, the format with the best € per piece placed
on that one sheet. That is myopic in two different ways, and both cost real
money at OhMyDTF:

- 19 back prints ≈ 4 × 4 cm + 19 chest prints ≈ 21 × 23 cm → five 10 × 10
  « cœur » sheets at 0,63 €/pièce and *then still* a 2 m sheet: **44,50 €**,
  when the 2 m sheet alone holds the whole order for **32 €**;
- a 48-transfer mixed order → **three 1 m sheets, 51 €**, when one 2 m plus one
  1 m holds the same order for **49 €**.

`nestFixedWith` therefore runs the same greedy over a handful of **restricted
catalogues**, each one a decision a human would make out loud, and keeps the
cheapest bill: the whole catalogue (always a candidate, so this can never be
worse than the plain greedy), each format **on its own** (the first case), and
**nothing smaller than F** for each F (the second: only a plan that still has
both big formats but no small ones finds 2 m + 1 m). Cost is ≤ 2F+1 greedy
passes with F ≈ 6, duplicate catalogues dropped.

## Export: one archive, not N downloads

Browsers throttle, reorder and silently **drop** bursts of programmatic
downloads, so a 12-sheet order regularly arrived incomplete with nothing saying
which planche was missing. The export is now one named `.zip` (order name +
date + supplier/process + sheet count) holding, under a single folder, every
print PNG, every cutting-plan PNG, `manifeste.json` and a human-readable
`LISEZ-MOI.txt`. Sheets are rendered one at a time and each canvas is released
the instant its PNG blob exists: a 58 × 250 cm sheet at 300 dpi is 202 M px
≈ 800 MB of backing store, and a 12-sheet order is over a gigabyte of PNG.

`scripts/dtf-verify.mjs` opens the produced archive **in Node with its own
reader** (not `src/lib/zip.ts`: verifying a writer with its own reader proves
only self-consistency), recomputes every member's CRC-32 from the stored bytes,
and checks each PNG's IHDR against the pixel size its sheet's cm geometry and
DPI imply. Independently cross-checked with `unzip -t` and Python's `zipfile`:
store-only, EFS (UTF-8) flag set on every member, `testzip()` clean, and an
accented order name (« Commande Été 2026 — Résidence / n°7 » ) surviving intact
into the folder name, the member paths, the archive comment and the `.zip`
filename.

**The export REFUSES rather than ship a hole.** `renderSheet` skips a placement
it has no pixels for, right for a live preview, catastrophic for an export,
because the archive still looks complete (right sheet count, right file names, a
plausible manifest) while one transfer is simply not on the film and nobody
finds out until the press. Measured: dropping one of eight artwork sources used
to produce a 4,19 MiB archive instead of a 5,38 MiB one, silently. `buildOrderZip`
now checks every placement's `sourceKey` against both source maps up front and
throws a named list; the modal turns that into « Export impossible ».

**The cutting-plan legend states what is actually drawn.** `drawGuides` keys off
`shelfYsCm`, so only a *shelf*-packed sheet carries full-width corridors and
vertical trims. The true-shape packer at interlock 0 was inheriting the shelf
legend (« couper les lignes bleues, puis les verticales ») on a plan that
draws neither. It now gets its own wording, and the harness compares the legend
against the sheets' actual row data on all four modes.

## Migration (v1 → v2)

`loadSuppliers()` detects the old flat shape (no `processes`, a top-level
`printableWidthCm` + `priceTiers`) and rebuilds it as a single `dtf` roll
process, keeping the admin's edited widths, DPI, tiers, shipping and minimums,
and folding the old free-text `fileFormat` into `notes`. Exception: a supplier
we have since restructured as **fixed format** (OhMyDTF) cannot be mapped:
roll tiers are not per-sheet prices, so that profile falls back to the shipped
default instead of producing a wrong roll. Payloads that are neither valid v2
nor recognisable v1 fall back to the defaults; nothing throws, nothing is
silently half-written.
