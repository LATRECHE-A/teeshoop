# teeshoop-core

The only new server code between the studio and the shop. WordPress keeps doing
what it does well, the studio keeps doing what it does well, and this plugin
holds the three things neither of them may own.

## What it owns

**The price.** Computed in PHP, from `Pricing.php`, on the server. The studio
displays what it is told and never computes a price a customer can pay. Two
implementations of the same rules always diverge in the end — on a tier
boundary, on a rounding mode, on the VAT basis — and the day they do, the
customer sees one number and the invoice says another.

There is no `price` field anywhere in the add-to-cart request. Not "ignored" —
absent. The cart stores the customer's *choices* and re-derives the price from
them on every totals pass, so a tampered session, a replayed request, or a price
that was right last week all resolve to today's correct number.

**The bridge.** The studio runs cross-origin in an iframe, so it cannot read
WordPress cookies and cannot call the REST API itself. It posts a message to the
parent page; the parent page — same origin, holding the nonce — makes the call.
The nonce never crosses the origin boundary.

**The hand-off.** An order line stores a design *identifier*. Artwork lives in
R2. `wp-content/uploads` is served by URL with no access control, and
`robots.txt` is not a permission.

**The catalogue.** 463 references and 26 399 articles arrive here from the
supplier, through our own Worker, on a nightly cron. What our supplier charges
us is stored on the variation and leaves by no door: not the REST API, not the
CSV export, not the variation JSON the browser gets. `docs/CATALOGUE.md` is the
operating manual; `includes/Catalogue.php` argues the modelling.

## Layout

```
teeshoop-core.php     bootstrap; declines politely if WooCommerce is absent
includes/
  Money.php           integer cents; no float ever holds a price
  Pricing.php         the price authority. Pure, no WordPress calls
  Margin.php          cost, floor price, commission (the Bible, corrected)
  Settings.php        stored config + the fail-closed defaults around it
  Garments.php        print areas, size chart and colours, in cm. Generated
  Design.php          design-id validation and Worker verification
  Product.php         which studio garment a WooCommerce product is
  Cart.php            WooCommerce cart and order integration
  ProductPage.php     the fiche produit: hooks, blocks and the add-to-cart lock
  Compat.php          the pinned WooCommerce surface, and the loud failure
  Quote.php           the devis: a record with a state
  Rest.php            /wp-json/teeshoop/v1/*
  Shortcode.php       [teeshoop_studio]
  Cli.php             wp teeshoop provisionner | verifier
data/
  garments.json       GENERATED from the studio. Do not edit; see below
templates/teeshoop/
  product-cta.php     quantity, faces, the live estimate, the two ways on
  product-specs.php   print zones in cm, the garment, the size guide
  product-price-grid.php   faces by quantity, HT and TTC
  product-quote.php   the devis form
assets/
  bridge.js           the postMessage bridge (runs on the WP page, not in the frame)
  bridge.css          the frame's box, and nothing else
  product.css         the fiche produit. Scoped under `ts-`, restyles nothing else
  product.js          the live estimate. Contains no price and no French
tests/
  run.php             zero-dependency runner for the pure classes
  test-pricing.php    the price authority
  test-grid.php       the grid's columns, the headline, the devis threshold
  test-margin.php     the corrected floor-price formula
  integration.php     the WooCommerce seam. Needs a real WP (see below)
```

## The product page

Shipped by the plugin, hooked, and **overriding no WooCommerce template**.
`Compat.php` records why, measured on 11.0.1: the templates a product page most
wants to change are the ones that move (add-to-cart is at @version 10.2.0,
10.9.0 and 10.5.2 against 3.6.0 for the wrapper); `content-single-product.php`
is not reachable through `woocommerce_locate_template` at all, because it loads
through `wc_get_template_part`, which never calls `wc_locate_template`; and
production runs Woodmart, which ships its own copies, so a plugin filter would
be a priority war with a paid theme over a wrapper `<div>`.

The coupling is therefore to hook names and priorities, and that is what
`Compat::check()` pins. It reports through an admin notice, through
`wp teeshoop verifier`, and in `tests/integration.php`. It cannot live in
`tests/run.php`, which runs with no WordPress at all.

**Every price on the page is `Pricing`'s.** The grid is `Pricing::grid()`, whose
cells the PHP suite asserts against `Pricing::quote()`; the estimator's live
total is a call to `GET /quote`, and without JavaScript the same form submits as
a GET and WordPress renders the same figure. `product.js` contains no
arithmetic and authors no French: both come from PHP.

The quantity columns are **derived from the discount breaks**, so a column can
never imply a break that does not exist, and `Pricing::headline()` reads both
its anchors out of the grid printed below it.

`ProductPage::refuse_plain_add` is the lock, and it does not depend on any of
the rendering: every path that reaches `WC_Cart` without going through
`Cart::add` (the classic form, `?add-to-cart=`, the AJAX loop button, the Store
API, "commander à nouveau") is refused for a personalisable product, because
none of them can carry a design and all of them would charge the catalogue price
of a blank.

## data/garments.json is generated

Print areas in cm, the official flat measurements and the colour list, produced
from the studio's own definitions by `node scripts/gen-garment-data.mjs`.
`src/content/garmentData.test.ts` fails when the committed file and the modules
disagree, and `npm run verify:garments` says so in CI. Do not hand-edit it: a
print size typed twice is a print size that diverges, and the customer discovers
the divergence when the workshop crops their logo.

Fabric composition and grammage are **not** in it. They exist nowhere in this
project for `tee` and `hoodie`, so the page renders the empty state and reads
them from product meta (`_teeshoop_material`, `_teeshoop_weight_gsm`) when a
catalogue import has set them.

`Money`, `Pricing` and `Margin` call **no WordPress function**. That is a design
rule, and `tests/run.php` enforces it by construction: the day someone reaches
for `get_option()` inside `Pricing`, the runner stops working and says so.

## Running the tests

```bash
npm run test:php        # 64 cases, pure PHP, no bootstrap, <1s
npm run wp:up           # local WordPress 7.0.3 + WooCommerce, port 8080
npm run wp:cli teeshoop provisionner   # rebuild the shop from the repository
npm run test:wp         # 17 cases against the real cart
npm run verify:wp-e2e   # 40 assertions, real browser, real Worker, real basket
npm run verify:php      # no purchase cost, supplier name or film rate in a template
npm run verify:product  # 18 assertions, real browser, the buy box's own controls
```

**`verify:product` exists because of one defect.** `Array.prototype.slice.call(
params.keys() )` returns an empty array (a `URLSearchParams` iterator has no
`length`), so the loop that cleared stale sizes off the Personnaliser link never
ran once: a buyer who put 3 into M and then back to 0 carried `tailles[M]=3`
into the studio, and three garments nobody ordered arrived at the basket panel
as sizes to press. No PHP test, no WooCommerce test and no end-to-end assertion
could see it, because none of them touches that control. A browser can.

**WooCommerce ships new installs in "coming soon" mode**, and with
`store_pages_only` it replaces every product page with a launch banner for
anyone not logged in. The page still answers 200 and still enqueues our CSS and
JavaScript in the head; only the body is gone. `wp teeshoop provisionner` turns
it off.

**Pretty permalinks are load-bearing, not cosmetic.** WooCommerce builds a cart
only for what it calls a frontend request, and decides that by looking for the
REST prefix in `REQUEST_URI`. On the plain structure a fresh WordPress ships
with, `/index.php?rest_route=/teeshoop/v1/cart` contains no `wp-json`, so Woo
loaded a cart and everything worked; on production's pretty permalinks it does
not, and every add-to-cart answered 503. `Rest::add_to_cart` now calls
`wc_load_cart()` itself, and the e2e asserts the mirror is on pretty permalinks
so nobody can turn a red run green by reverting the structure.

The pure tests run in CI. The integration test does not — it needs a database
and a live WooCommerce, same reason the Playwright harnesses stay out.

`verify:wp-e2e` (`scripts/wp-e2e-verify.mjs`) is the one that covers the seam
this plugin exists to hold: it builds the studio, serves it from `wrangler dev`,
drives a real Chromium through a real purchase, and then asks the database what
happened. It expects the mirror on a CLASSIC theme, because WooCommerce's block
product template runs the description through `wp_kses_post` and `iframe` is not
an allowed tag there, so on Twenty Twenty-Five the studio renders as an empty
`div`. teeshoop.com runs Woodmart, which is classic; the harness switches the
mirror to Twenty Twenty-One and says so.

Keep both. The pure tests cannot see the bug that actually shipped here:
`recompute_prices()` carried the standard `did_action(...) > 1` guard, which
skipped every `calculate_totals` after the first, so a customer who changed the
quantity on the cart page crossed a discount threshold and kept the old unit
price. `Pricing::quote()` was correct throughout. **The seam between correct
code and WooCommerce is where the money is lost.**

## REST

| Route | Auth | Notes |
|---|---|---|
| `GET /wp-json/teeshoop/v1/quote` | public | Pure computation. Returns selling prices only, never a purchase cost, supplier name or film rate. `faces=N` is shorthand for N sides at the standard area tier, so a browser never has to know that convention. |
| `GET /wp-json/teeshoop/v1/grid` | public | The faces × quantity table shown before the editor opens. Columns derived from the discount breaks. |
| `POST /wp-json/teeshoop/v1/cart` | `X-WP-Nonce` | Adds a personalised line. The nonce is checked explicitly: WordPress only rejects a *bad* cookie nonce, not a missing one, so without this any site could POST into a visitor's basket through their browser. |

## The postMessage contract

This is what the studio side has to implement. `bridge.js` already holds up its
end.

Studio → page:

| `type` | Payload | Effect |
|---|---|---|
| `teeshoop:ready` | — | Page replies with `teeshoop:context`. |
| `teeshoop:quote` | `garment`, `qty`, `sides[]`, `requestId` | Page replies `teeshoop:quote-result`. |
| `teeshoop:add-to-cart` | `garment`, `qty`, `sides[]`, `designId`, `sizeGrid`, `requestId` | Page replies `teeshoop:cart-result`, echoing the id. |
| `teeshoop:resize` | `height` (px) | Frame is resized, clamped to 320–4000. |

Page → studio: `teeshoop:context`, `teeshoop:quote-result`, `teeshoop:cart-result`.

A side is `{ id, area_sq_cm }`, where `id` is one of the studio's own printable
sides: `front`, `back`, `sleeve`. (`sleeve_l` and `sleeve_r` are accepted and
labelled too, for the day the studio grows a second sleeve position; it has one
today and inventing a left/right distinction it does not model would put a
side on a picking list that nobody chose.)

Both request types carry a `requestId` and both replies echo it. For quotes it
stops two answers in flight from swapping. For the cart it is stronger than
that: the studio refuses to start a second add while one is running, so a reply
that cannot be matched would have to be guessed at, and what is being guessed
at is whether a basket now holds a paid line.

The studio's half is `src/lib/teeshoop/bridge.ts`. It does not know which page
framed it and does not ask: it offers `teeshoop:ready` to every origin on its
build-time allow-list (`VITE_TEESHOOP_SHOP_ORIGINS`), the browser delivers only
to the one that matches, and whichever answers is locked in for the session.

The area that counts is the **ink**, not the layer rectangle — sending the
rectangle is what makes a customer pay for transparent margins. `sideArtworkSqCm`
in `src/lib/ink.ts` is the producer, and it already returns **square
centimetres**: the studio used to work in square inches and no conversion between
the two existed anywhere, so the obvious way to wire this up divided every print
in the shop by 6,4516 and priced it flat forever. There is now nothing to
convert. The studio's tier bounds are the same two numbers as `Pricing::area_tier`'s,
in the same unit, for the same reason.

Every inbound message is checked three ways before it is acted on: `event.origin`
must equal the configured studio origin (compared with `===`, never
`startsWith` — a prefix test passes for `https://studio.teeshoop.com.evil.tld`),
`event.source` must be our own frame's `contentWindow`, and the payload must be
an object with a known `type`. Replies always name the studio origin explicitly;
`*` would broadcast cart totals to whatever document happens to occupy the frame.

## Which product is which garment

`_teeshoop_garment` on the product, set from a field under General on the
product edit screen (`Product.php`). A product that declares none is not
personalisable, and the shortcode says so to anyone who can fix it.

It lives on the product rather than in an option holding a map because it is a
property of the product: duplicate a t-shirt and the mapping is duplicated,
export the catalogue and it is exported, restore a backup and it is restored. A
map in an option survives none of that and drifts the first time a product is
added by someone who never heard of it. It is also queryable, which "which
products are personalisable" eventually needs.

Above all **it is a price input**, so it must not arrive from a browser. It
decides the cost of the blank: `tee` is 9,50 EUR and `custom` is zero, because
with `custom` the customer ships their own garment. `Cart::add` reads it from
the product; a request naming a different garment is refused rather than
corrected, because a disagreement means the page and the studio are selling two
different things.

## Settings

`teeshoop_settings` (option):

| Key | Meaning |
|---|---|
| `studio_origin` | `https://studio.teeshoop.com`. **A security parameter.** Empty ⇒ the shortcode refuses to render rather than accepting messages from anywhere. |
| `studio_path` | Path within that origin, default `/`. |
| `worker_url` | Cloudflare Worker base URL. **It is now a browser-facing origin as well as a server-facing one**: the catalogue stores each colour photo as a path and the shop renders `worker_url + path` in an `<img src>`, so an address only the server can resolve (`host.docker.internal`, a private hostname) leaves every colour photo broken for customers while the importer works perfectly. It must be an address a visitor's browser can reach. |
| `design_verify_path` | Default `/api/design/`. |

`teeshoop_pricing` (option) is a partial overlay on
`Pricing::default_config()` — set `vat_rate` alone without restating the rest.

**⚠ The shipped prices are placeholders**, the studio's demo figures converted
1:1 from dollars. The real grid is question 04 of `QUESTIONS-ASSOCIE.md`.

`blank_margin_rate` is the exception: it is `null`, and null is a refusal rather
than a placeholder. Until somebody sets it, the importer writes no price and the
catalogue is browsable but not purchasable. Question 42.

Constants, in `wp-config.php` and never in an option:

| Constant | Meaning |
|---|---|
| `TEESHOOP_CATALOGUE_TOKEN` | Bearer token for our Worker's catalogue routes. Absent ⇒ the importer refuses. It is a constant because options are dumped by every backup and editable from the admin, and this one opens a route that returns our purchase price for the whole catalogue. |
| `TEESHOOP_ALLOW_UNVERIFIED_DESIGNS` | Development only. Never on production. |

## The catalogue

| Command | |
|---|---|
| `wp teeshoop catalogue importer` | Import or refresh. Idempotent, resumable. |
| `wp teeshoop catalogue importer --duree=1800` | Do half an hour and stop cleanly. A cron slot. |
| `wp teeshoop catalogue etat` | Where the current pass got to. |
| `wp teeshoop catalogue purger` | Remove every imported reference. Local mirror only. |

One style is one **variable** product; every article the supplier sells is one
variation, built from the SKU list and never from the cross product of colours
and sizes (that would invent 3 481 garments nobody can buy). Colour and size are
global attributes, so they can be filtered on; brand, material, sleeve, neck,
audience and certification are global attributes too, for the same reason.

Idempotent **by comparison, not by hash**: every field is read back and compared,
and `save()` only runs when something differs. Two bugs found by insisting on
that, both invisible to a hash: `_global_unique_id` became an internal meta key
in WooCommerce 9.2, so reading it back always returned `''`; and a taxonomy
attribute's options come back sorted by term name, not in the order they were
written, so a sequence comparison found a difference every single night and
re-saved every variation's attribute summary.

Measured, 2026-08-14, local mirror: 0,24 s per variation on creation (148 queries
each, which is WooCommerce's own cost), 5 ms per variation to re-verify an
unchanged one. The first full run: 463 references listed in 11 calls and 0,5 s,
then 26 127 variations and 731 photographs written in 5 794 s.

Two leaks the adversarial pass found by measuring the running shop rather than
reading the code, both of which the guards were structurally unable to see:

**The public reference gave back the sealed one.** It was
`{styleNr}-{colourCode}-{size}`, and the supplier's article number is
`styleNr . colourCode . one digit`, so `00142-000-XS` published beside a sealed
`001420000` was the whole procurement key bar one digit, on every product page
and in the public Store API. The size-to-digit map is identical across a style's
colours, so one confirmed article number opened all 366 of them. The leak check
stayed green because it searched for the nine-digit literal, which is not a
substring of the hyphenated form. The reference is now the maker's own article
code (E150, 64000, 61-212-0), which is also what a buyer of blanks searches for,
and the gate greps for the supplier's style number too.

**The supplier named itself in our product descriptions.** On close-out styles it
writes its own stock announcements into the description, and two product pages
published "CLOSE-OUT: ce style est retiré de la collection *(our wholesaler)*".
`php-guard` reads repository files; that string only ever existed in `wp_posts`.
Those bullets are dropped by their marker rather than by the name, because
writing the name into the plugin to filter it would put it exactly where the
boundary forbids, and would miss the next note.

A third defect the full run found, which the six-reference gate could not:
WooCommerce 9.2 makes `set_global_unique_id()` throw when another product
already carries that barcode, and the supplier's data has 4 collisions in
21 479 barcodes. Letting it escape lost three references entirely. The barcode
is written on its own now, so a refusal costs the barcode and not the garment.

## Fail-closed

A design id that the Worker has not confirmed is **refused**. An unverified id
produces an order the workshop cannot print — discovered after the customer has
paid. A network failure to the Worker is not a pass either: "we could not ask"
is not "it exists".

Two more inputs stopped arriving from the browser once the studio could actually
call this:

**The garment** is the product's (above), never the request's. Before that, a
request naming `custom` on a hoodie product bought a 27,00 EUR blank for
nothing, because the only check was that the config knew the key.
`Pricing::quote()` was correct throughout; it answered exactly what it was
asked. `tests/integration.php` holds the case, and it fails when the request is
trusted again.

**The printed areas** come from the design manifest the Worker confirmed, not
from the add-to-cart body, so a replayed request cannot claim 1 cm² of ink on a
full-front print and the number that was billed is the number stored beside the
artwork. The body is kept only as a fallback for local development, where
`TEESHOOP_ALLOW_UNVERIFIED_DESIGNS` means there is no manifest to read, and a
CONFIRMED design that declares no printed side is refused rather than priced as
a blank. Which of the two sources was used is frozen onto the order line as
`_teeshoop_sides_source`.

They are the areas at size M (`PRICED_SIZE` in `src/lib/teeshoop/upload.ts`),
one figure for a run that may span S to 3XL. That is a deliberate
approximation, not an identity: artwork is graded with the garment, so a 500 cm²
chest print at M is 757 cm² at 3XL and crosses a tier the line was not billed
for. Question 37 of `QUESTIONS-ASSOCIE.md`, with the numbers.

Local development opts out in `wp-config.php`:

```php
define( 'TEESHOOP_ALLOW_UNVERIFIED_DESIGNS', true );
```

Production must not define it.

## The design hand-off, end to end

Built 2026-08-13 (`worker/design.ts`):

| | |
|---|---|
| `POST /api/design` | The studio uploads the design document plus every raster it references. Open, like `POST /api/ar` — the customer is the author and cannot authenticate. Returns `{ id }`. |
| `GET /api/design/{id}` | The manifest. This is what `Design::verify` calls; 404 is what makes an unverifiable id refuse the cart line. |
| `GET /r2/design/{id}/preview.png` | Open on the id (~143 bits). A BAT email and a cart thumbnail carry no token. |
| `GET /r2/design/{id}/design.json`, `…/assets/*` | **Admin only.** The customer's original artwork; the only thing that needs it is the workshop. |

What is stored is the **source**, never the nested gang sheets: a layout depends
on the supplier, the roll, the quantity and which other orders are ganged with
it, none of which is known at add-to-cart. The rasters, by contrast, exist
nowhere else — lose them and the order is unprintable whatever else survives.

An upload whose design references artwork that did not arrive is refused (422),
and so is artwork the design never mentions — the first is an order the workshop
cannot fill, the second is R2 as a dead drop. The manifest is written **last**,
so a half-written upload can never verify as complete.

Proved against a live Worker + local WordPress on 2026-08-13: a real id verifies
and prices (25 units, 271,75 €), a fabricated one is refused with
`design_not_found` and the cart is untouched.

## Not built yet

- An admin screen for the pricing config. It is set through the option.
- An admin screen for the integration settings (studio origin, Worker URL). Same.
- Payment. `Pricing` computes what a line costs; nothing takes money yet.
- The quote DOCUMENT: its versions, its acceptance token, its PDF and the BAT.
  `Quote.php` holds the request and its state; the document belongs to session
  06, when there is a payment to attach it to.
- Réassort. "Commander à nouveau" is deliberately REFUSED on a personalisable
  product rather than silently producing a plain garment at the catalogue price
  (`woocommerce_order_again_cart_item_data` defaults to an empty payload).

Built and proved end to end on 2026-08-13 by `scripts/wp-e2e-verify.mjs`: the
studio's bridge client and design upload (`src/lib/teeshoop/`), the buy flow,
the garment mapping, and the size grid, which the modal now draws and the cart
reads as the quantity.
