# DTF module — credits & data sources

No external code, assets, fonts or models were brought into this module.
The nesting engine (`src/lib/dtf/nesting.ts`) is an original shelf/FFDH
implementation written for this repo — no packing library used. The
fixed-format binner reuses that same packer once per candidate format
(greedy, one sheet at a time); no third-party bin-packing code.

## How the data is structured

Since 2026-07-26 a supplier is `SupplierProfile → processes[] → DtfProcess`,
where a process is `dtf` or `uvdtf` and carries its own geometry, its own
billing model (`roll` = per linear metre, `fixed` = per catalogue sheet) and
its own **structured** guidelines (`DtfGuidelines`) — the numbers
`src/lib/dtf/preflight.ts` checks artwork against. The previous free-text
`fileFormat` / flat-roll shape is migrated on load (see "Migration" below).

Profiles are runtime-editable and persisted in localStorage
(`tshop:dtf:suppliers`). Prices move; treat everything below as "read on the
date given", not as a contract.

## Sources (public pages, read July 2026)

| Supplier | Source | Data used |
|---|---|---|
| DTF Plus | https://dtfplus.eu — product, FAQ and prepress pages | **DTF** : rouleau 58 cm imprimables, 250 cm max par fichier, ≥ 200 DPI, PDF ou PNG transparent, CMJN ou RVB, trait mini 1,0 mm couleur / 0,5 mm blanc, polices vectorisées, minimum 1 lm, presse 130 °C / 6–8 s / pression forte, blanc auto choke 0,15 mm. **UV-DTF** : rouleau 30 cm (28 cm imprimables), 100 cm max, ≥ 250 DPI, couche blanche réduite de 0,15 mm vs la couleur, minimum 0,5 lm, séchage 24–48 h. Tarifs DTF €/lm 8,00 / 7,00 / 6,00 / 5,50, port UPS 8 €, franco ≥ 20 lm, TVA 0 % (autoliquidation) |
| OhMyDTF | https://ohmydtf.com — pages produits, livraison et FAQ | Impression à **Ennery (95), Île-de-France** → J+1 impression, Chronopost 24 h, **franco de port dès 50 €**, 60+ lavages à 40 °C, détail jusqu'à **0,6 mm (1,75 pt)**. **Vend au FORMAT FIXE, pas au mètre** : DTF = 10 × 10 cm « cœur », A4, A3, A2, 1 m, 2 m ; UV-DTF = A5, A4, A3, 50 × 100 cm. Fichiers DTF : .ai / .psd / .pdf / .tiff ; UV-DTF : .png |
| Royal DTF | https://fr.royaldtf.com — page tarifs | Feuilles 56 × 100 cm facturées au métré, 300 DPI, paliers 9,90 → 6,00 €/m, commande minimum 49 €, DHL Express |
| Pressink | https://pressink.fr — page tarifs | Laize 56 cm, 300 DPI mini, PNG transparent, paliers 15,99 → 7,20 €/m, port 5,90 € franco dès 50 €, production française |

Industry spacing floor (≥ 0,6 cm between designs; defaults 0,8 cm gap /
1,0 cm edge margin) from common DTF gang-sheet prep guidelines, not from any
one supplier.

## Numbers that are NOT confirmed (best-effort placeholders)

These are encoded so the tool works end-to-end; **confirm with the supplier
before ordering**. Each one is an estimate or an inference, never a quote.

| Where | Value | Why it is uncertain |
|---|---|---|
| `ohmydtf` VAT basis | TTC | **Unresolved contradiction**: the product pages say « Prix unitaire H.T. », the CGV say prices are TTC. A 17 % swing that moves OhMyDTF from 6th to 2nd on delivered cost. Ask for a sample invoice before quoting. |
| `ohmydtf` / `uvdtf` prices | A5 6,50 € · A4 11 € · A3 18 € · 50 × 100 45 € | Format list confirmed; the price grid is an estimate. |
| `ohmydtf` shipping | 4,90 € below the 50 € franco | Only the free-shipping threshold (50 €) is confirmed. |
| `ohmydtf` volume discount | 2 m at 26 € from 50 units | Discounts may require the **same file** repeated — 5 different sheets could stay at the 1–4 tier. Contrast DTF Print, which applies tiers across different files. |
| `minTextPt` (all profiles) | 8 pt (10 pt en UV-DTF) | **House floor, not a supplier figure.** Nobody publishes a minimum point size; OhMyDTF's 1,75 pt is a *stroke* figure. The real binding rule is the 1,0 mm minimum stem width — which implies ≈32 pt regular / ≈20 pt bold and would reject a lot of legitimate artwork, so this check stays advisory. |
| `gapCm` / `marginCm` (all profiles) | 0,8 cm / 1,0 cm | **Assumptions, not supplier requirements.** 4 of 6 suppliers publish no required gap and only Tissus Print publishes a margin (1 cm). DcomDTF's 3 mm gap is the only published spacing figure. These two numbers set nesting efficiency directly — confirm per supplier. |
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

**DTF+ is B2B-only and requires a valid EU VAT number.** Without one the cheapest
supplier by 35–53 % is simply unavailable. Their CGV also exclude colour variation
as grounds for complaint, so colour control is ours.

### The 20 lm cliff (implemented as `thresholdTip()`)

The 6 €/lm tier break and the free-shipping threshold both land at 20 lm, so:

    19,9 lm → 7,00 €/lm + 8 € port = 147,30 €
    20,0 lm → 6,00 €/lm + port offert = 120,00 €

**20 lm costs less in absolute euros than 19,9 lm, for more film.** `thresholdTip()`
detects this generically (it tests every tier break and free-shipping threshold, not
a hard-coded supplier) and the cost panel surfaces it. Never order 15–19,9 lm here.

### Delivered cost to Paris, EUR HT per m² of film (2026-07)

Normalised as `€/lm ÷ (width/100)` for rolls and `price ÷ (w × h / 10 000)` for sheets.

| Supplier | Small (~1 m²) | Medium (~5 m²) | Best batched |
|---|---|---|---|
| **DTF+** (roll, PL) | **20,69** | **13,45** | **10,34 @ 20 lm · 9,48 @ 50 lm** |
| Tissus Print (roll) | 33,98 | 21,97 | 15,52 |
| Sherpa (hybride) | 44,02 | 23,49 | 12,25 (compte pro requis) |
| DcomDTF (hybride) | 31,84 | 26,67 | pas de dégressif réel |
| DTF Print (fixe) | ~33,04 | 25,00 | 13,10 (TTC → HT calculé) |
| OhMyDTF (fixe) | ~34,82 | 26,79 | 23,21 |

- Best quality evidence: **Sherpa** — OEKO-TEX cert. CQ 1380/1, ISO 15025, and the only
  supplier publishing a named ICC profile (PSO Coated V3).
- Best speed to Paris: **OhMyDTF** — 35 km away, Chronopost J+1, no rush surcharge.
- **Never route gang sheets through A4/A3/cœur formats: 2–11× the €/m² of a metre.**
- Colour space has **no safe universal default**: CMYK for OhMyDTF-textile/DcomDTF/
  Sherpa/DTF Print, but sRGB *required* by Tissus Print, and RGB for OhMyDTF UV-DTF.
- Tier ladders must not be read as "last matching row": Tissus Print's is non-monotonic
  (prepaid packages mixed into the pay-as-you-go grid), so pricing takes the **cheapest**
  applicable rate.
- DcomDTF and Sherpa are **hybrid** (roll *and* sheets, with ladders that cross over).
  The current model gives each supplier one process per billing mode; pricing both paths
  and picking the cheaper is not yet automated.

## Migration (v1 → v2)

`loadSuppliers()` detects the old flat shape (no `processes`, a top-level
`printableWidthCm` + `priceTiers`) and rebuilds it as a single `dtf` roll
process, keeping the admin's edited widths, DPI, tiers, shipping and minimums,
and folding the old free-text `fileFormat` into `notes`. Exception: a supplier
we have since restructured as **fixed format** (OhMyDTF) cannot be mapped —
roll tiers are not per-sheet prices — so that profile falls back to the shipped
default instead of producing a wrong roll. Payloads that are neither valid v2
nor recognisable v1 fall back to the defaults; nothing throws, nothing is
silently half-written.
