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
  Vat.php             the regime as a timeline of dated periods, pure
  Legal.php           the seller's identity, empty by default, gated on the env
  Shipping.php        the Colissimo grid, packaging, the franco; pure
  shipping/           the WooCommerce method, one directory down on purpose
  Invoice.php         the number, the frozen document, the PDF
  Pdf.php             a single-purpose PDF writer; pure
  Checkout.php        the gates between a basket and an order
  Settlement.php      what an order has been paid and what that allows; pure
  Ledger.php          the receipts on the order, and the acompte status
  Payment.php         which account a gateway would charge, and the alarms
  Admin.php           the one screen where the facts nobody can invent go
  Pricing.php         the price authority. Pure, no WordPress calls
  Margin.php          recommended price, floor price, the negotiation zone and
                      the verdict on a proposed price (the Bible, three
                      corrections). Pure
  Cost.php            the ten direct-cost components, labour, film and the
                      prudent length bound. Pure
  Commission.php      rates by kind of sale, accrual on money received, and the
                      Bible's four conditions for a definitive one. Pure
  PriceRule.php       the floor by perimeter: which rule applies to an order,
                      and what a rule may change. Pure
  Costing.php         one ORDER: its cost, its floor, its commission, its
                      derogation. The file where the four above meet WooCommerce
  Nest.php            asks the Worker how many linear metres of film an order
                      needs. Fails closed; never packs anything itself
  CostAdmin.php       the two screens the associate maintains it all from
  Settings.php        stored config + the fail-closed defaults around it
  Garments.php        print areas, size chart and colours, in cm. Generated
  Design.php          design-id validation and Worker verification
  Product.php         which studio garment a WooCommerce product is
  Cart.php            WooCommerce cart and order integration
  ProductPage.php     the fiche produit: hooks, blocks and the add-to-cart lock
  Compat.php          the pinned WooCommerce surface, and the loud failure
  Quote.php           the devis: a record with a state
  Catalogue.php       supplier style -> WooCommerce product. Pure. Argues the
                      mapping, the 366-variation trade-off and the image cost
  Supply.php          the HTTP client to our own Worker. The only file allowed
                      to name a supplier route, and it fails closed
  Importer.php        the idempotent, resumable, lockable import pass
  Taxonomy.php        pa_couleur and pa_taille, and the size ordering Woo needs
  Shelf.php           what an imported reference does once published: the seal
                      on the purchase price, and the colour photo swap
  Rest.php            /wp-json/teeshoop/v1/*
  Shortcode.php       [teeshoop_studio]
  Cli.php             wp teeshoop provisionner | verifier | marge
                         | catalogue importer | catalogue etat | catalogue purger
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
  test-margin.php     the three corrected formulas, and the boundary where an
                      exception becomes required
  test-cost.php       the cost model, and the two places our numbers do not
                      match the Bible's own worked example
  test-commission.php the base the Bible requires and the three it forbids
  test-pricerule.php  the scoped floors: which rule wins, and the ways one must
                      not silently lower a floor
  test-catalogue.php  the supplier mapping: sizes, families, grammage, the
                      guards that refuse a payload about another style
  integration.php     the WooCommerce seam. Needs a real WP (see below)
  integration-margin.php  the costing against a real order, reconciled against
                      the ISSUED invoice rather than a recomputation
  demo-order.php      builds one worked order the session report quotes
  e2e-support.php     fixtures the browser-side gates load into a real shop
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
npm run test:php        # 177 cases, pure PHP, no bootstrap, <1s
npm run wp:up           # local WordPress 7.0.4 + WooCommerce, port 8080
npm run wp:cli teeshoop provisionner   # rebuild the shop from the repository
npm run test:wp         # 45 cases against the real cart, including a concurrency race
npm run verify:wp-e2e   # 66 assertions, real browser, real Worker, from artwork to invoice
npm run verify:invoice  # renders real invoices, reads them back with poppler
npm run verify:php      # no purchase cost, supplier name or film rate in a template
npm run verify:product  # 18 assertions, real browser, the buy box's own controls
```

**The mirror needs four things doing once, and none is in the repository**
because both live in the docker volume rather than in git:

```bash
npm run wp:cli config set WP_ENVIRONMENT_TYPE local --type=constant
npm run wp:cli plugin install woocommerce-gateway-stripe --version=10.8.5 --activate
```

The first because `WORDPRESS_CONFIG_EXTRA` only applies when `wp-config.php` is
CREATED, so adding a line to `docker-compose.yml` does nothing to a volume that
already exists, silently. Without it WordPress answers `production` and the
invoice gate refuses to render the very documents the mirror exists to develop.
The second is the payment rail; it takes no licence key and no account to
install. The last two because WordPress and WooCommerce install in en_US, so the
checkout said "Checkout", "Subtotal" and "FREE" over amounts written 461,10 €:
half of what a French customer reads was never rendered anywhere anybody looked.
HPOS should be on, as it is in production: `wp wc hpos sync` then
`wp wc hpos enable`.

**`verify:invoice` opens the PDF with something that is not `Pdf.php`.** A
hand-rolled file format checked by its own writer proves only that it is
self-consistent: the same wrong offset table produces the same wrong answer
twice and both agree. So the documents are produced by `wp eval-file` against a
real WooCommerce and read back by a Node reader written from the PDF
specification, plus poppler's `pdftotext` when the machine has it. On its first
run it found the mandatory professional mentions being truncated with an
ellipsis, which is a non-conforming invoice.

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
drives a real Chromium from an upload all the way through the checkout to a
downloaded invoice, and then asks the database what happened. It fills whichever
checkout the shop has; on this mirror that is the BLOCK, which matters, because
`woocommerce_checkout_create_order` never fires there and a suite that only
drove the classic shortcode would leave the order-meta fallback unproven. It
pays by virement, because BACS never calls `payment_complete()` for a non-zero
order: the invoice has to be issued by the status listener as well, and this is
where that is proved. It expects the mirror on a CLASSIC theme, because WooCommerce's block
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
1:1 from dollars. Every one of them has a row in `docs/hypotheses.json` with the
question that settles it: the garment tariffs are question 06 (the margin rate)
fed by question 03 (the real purchase grids), the surcharge and discount ladders
are question 08, the VAT rate is question 17 and the self-serve thresholds are
question 02. This paragraph used to send the reader to question 04, which is
about DTF supplier rates and settles none of them.

`scripts/hypotheses-guard.mjs` fails the build when one of those values acquires
a second copy, when its home moves, or when a Bloquant question loses its row.
The shop's own admin marker is drawn from the same register, so it cannot point
at the wrong question either.

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

## Taking money

**The VAT regime is a timeline, not a rate.** `Vat.php` holds a list of periods,
each with the date it opens and the regime it carries. A company in franchise en
base charges nothing and must print "TVA non applicable, article 293 B du CGI";
the day it crosses the threshold it starts charging, and invoices issued before
that day do not change. A single constant cannot express any of that, and the
shop's own history is the reason it matters: 15 real orders were taken with
WooCommerce's tax calculation switched off and nobody has said whether that was
a franchise or an omission.

No threshold is written anywhere in this plugin. The thresholds and the dates are
the accountant's answer. `Settings::pricing()` points `vat_rate` at the regime in
force, which is the entire franchise implementation: every TTC figure the shop
prints comes from `Pricing::quote()` on that config.

**Carriage is three numbers.** What La Poste charges, what the customer pays, and
what we bear. They are different the moment a delivery is free, and the Bible
counts "livraison offerte" as a direct cost, so `Shipping::quote()` returns all
three and the order keeps them on its shipping line.

**The invoice freezes at issue.** Measured on WooCommerce 11.0.1:
`$order->calculate_taxes()` reprices a placed order at today's rate and
overwrites the rate it had recorded, and the admin's "Recalculer" button reaches
it. So the whole document, seller identity included, is written to order meta the
moment it is issued, and the PDF renders from that snapshot. There is no HTML
version: a screen copy and a PDF copy of one legal document are two
implementations of one rule.

The number is allocated in a single SQL statement against
`{prefix}teeshoop_sequence`. `tests/concurrency.php` races six processes for 150
numbers; a read-then-write version of the same code collided 48 times.

**Each acompte gets its own invoice, because the law says so.** This file argued
the opposite for an afternoon, on the belief that an advance payment for goods
obliges nothing until delivery. It was wrong twice: CGI art. 289, I-1-c covers
"les livraisons de biens OU les prestations de services", BOI-TVA-DECLA-30-20-10-10
§ 120 says the obligation applies to every acompte "et non pas pour les seules
opérations pour lesquelles ces versements entraînent l'exigibilité de la TVA",
and since 1 January 2023 the VAT is exigible on collection anyway (CGI art. 269,
2-a). So a receipt that leaves a balance issues a facture d'acompte, numbered
from the SAME continuous series (BOI-TVA-DECLA-30-20-20-10 § 60 extends the
numbering obligation to them), and the final invoice states the whole operation
and deducts each acompte by its number and date, as § 60 requires. The layout of
that deduction is the standard one and is prescribed by no text we could find;
question 16 asks the accountant to confirm it.

**A deposit is a state, not a checkbox.** WooCommerce knows one thing about
money, paid or not; chapter 2 of the Bible puts "7. paiement partiel" in its
lifecycle and its own data model asks for a `payments` table. So each receipt is
a row on the order, with its date, its means and its reference, and what an order
may DO is derived from the sum: `Settlement::stage_allows()`.

That is also where the chapter contradicts itself. It permits "acompte possible,
solde avant expédition" and then states "une commande non payée ne peut pas
passer en production", and a half-paid order is not paid. The reading that makes
both true is per order: an order nobody authorised a deposit for needs the whole
total before production, which is every self-serve order; one somebody did may
start on the deposit and still may not be dispatched. Both readings are asserted
in `tests/test-settlement.php`, so whichever way question 16 comes back, one of
the two cases is already right.

**The seller's identity ships empty.** Nine fields, all `''`, and no placeholder
will ever be added: a plausible SIRET is a thing that ships. In production an
incomplete identity refuses both the document and the sale; anywhere else it
renders stamped, in French, across the page.

## Not handled, and that is a decision

Each of these was considered in session 04 and left out on purpose. None is an
oversight, and none is blocked on code.

- **Refunds and credit notes (avoirs).** WooCommerce can refund; this plugin
  issues no avoir, and a French invoice may never be cancelled by deletion or
  renumbering. An avoir is its own numbered document referencing the original.
  It needs question 27's answer (what the policy actually is) before it can be
  built, and it belongs with the SAV work of session 06.
- **Partial shipments.** One order, one parcel, one invoice. A run split across
  two deliveries would need either two invoices or one invoice and a delivery
  note, and the choice is the accountant's. Nothing today can produce a partial
  shipment, because production does not exist until session 07.
- **Refunds and credit notes after a deposit.** The Bible's own cancellation
  policy says "après commande fournisseur ou préparation spécifique :
  remboursement du solde non engagé", so authorising a deposit creates an
  obligation this plugin cannot discharge: it issues no avoir and makes no
  refund. Until session 06 that is done by hand.
- **An échéancier.** An order is settled in one or two payments, never on a
  calendar: question 16's default says "aucun paiement à échéance au lancement",
  and the Bible's one door to deferred payment, "client récurrent fiable :
  conditions dérogatoires validées", names neither the terms, the approver nor
  the eligibility test.
- **Paying a balance by card.** WooCommerce has no concept of a remaining
  balance anywhere: every pay surface charges `$order->get_total()`, the whole
  total, again. Measured on a 240,00 order with 120,00 banked. So a deposit
  order is deliberately NOT made payable and the balance arrives by transfer,
  which is what a French B2B deposit is anyway.
- **Intra-EU B2B exemption and VIES.** The shop delivers to metropolitan France
  only (question 35), so no intra-EU supply can be made through it and no
  exemption may be granted. Building an unreachable VIES check would be building
  something that can never be exercised and will be wrong the day it is needed.
- **Mandat administratif.** Public buyers cannot pre-pay, which is incompatible
  with paying at the order. Question 15's default handles it offline.
- **Electronic invoicing (Factur-X).** Receiving became mandatory for every
  company on 1 September 2026 and that is a démarche, not code; issuing does not
  bite on a PME until 1 September 2027, and the target format depends on the
  platform the associate chooses. Constat 7 of `QUESTIONS-ASSOCIE.md`.
- **A monthly accounting export.** Question 24's default promises one. The
  documents exist and are queryable; the export itself is session 13.
- **Discount codes.** Coupons are switched off entirely
  (`woocommerce_coupons_enabled`). The unit price already carries the quantity
  discount, and no promotional policy exists to implement.

## What an order costs, and what it must not be sold below

`Pricing.php` says what a customer pays. This says what it cost us, and the two
never touch: they meet in `Costing.php`, which reads the order's own facts and
asks the cost engine what they add up to. Two files that both computed a price
would eventually disagree, and the customer would see one number and the invoice
another.

**Ten components, each with a source, a date and a confidence.** The confidence
has FOUR values and not two, and that is the whole safety property:

| | |
|---|---|
| `reel` | a real tariff, a real invoice, a real measurement |
| `estime` | derived from a catalogue price or an unconfirmed rate; the PRUDENT figure is the one used |
| `neant` | genuinely zero on this order: no subcontracting, no card fee on a transfer |
| `inconnu` | we could not compute it. NOT zero |

A zero and a failure add up to the same total and mean opposite things. So
`Cost::total()` refuses to call itself complete while any component is unknown,
and the floor price the order screen shows is then labelled a **minimum**: the
real one is at least that and probably higher. A price under the minimum floor is
CERTAINLY below the floor. A price above it is not proven to be above the real
one, and the screen says so rather than showing a tick over an unanswered
question.

**The film is measured, not typed.** The Bible: the DTF cost "dépend de la
surface occupée sur une laize de 56 cm, de l'imbrication". That is a packing, and
this repository already has one, in TypeScript, and it is the one the workshop's
gang sheets come out of. So `Nest.php` asks it over HTTP (`POST /api/nest`,
admin-gated) instead of a second packer growing here. The per-transfer rectangles
are measured in the browser, because an ink extent comes off a decoded image's
alpha channel and neither PHP nor a Worker has a canvas; they travel with the
design and land on the order line beside the printed area.

When the packer cannot be reached, the cost falls back to a **proved upper
bound** (one shelf per transfer, in the flatter orientation the packer would
pick, rounded up the way the supplier bills) and says it did. Never an estimate,
and never a length inferred by dividing an area by the roll width: a length is a
packing, not a quotient. `scripts/nest-verify.mjs` re-proves the bound on every
run against the real packer, in both languages.

**The commission is on the contributive margin collected.** Never the revenue,
never the TTC: on the Bible's own worked example those two pay 250 EUR and
300 EUR against a result before fixed costs of 225 EUR. A partial payment earns
its share pro rata, which is the one thing the Bible does not say and question 29
now asks.

**The floor is not the same everywhere.** Chapter 1 asks for it in one
sentence and means six: a floor definable by product family, by technique, by
salesperson, by order size, by client type and by urgency. `PriceRule.php` is
that, stored in its own option (never in the cost config, which is rewritten
from a literal on every save and would delete it), edited as one stacked block
per rule.

A rule is the ONLY thing in this engine that can LOWER a floor, which is what it
is for and why it is built the way it is:

- it overrides only the rates it sets, because a blank field is not a zero;
- a tie between two equally specific, equally prioritised rules goes to the
  STRICTER one, because picking the first-written would be an arbitrary choice
  between two floor prices;
- an order whose fact is unknown (a basket spanning two families has no family)
  matches only rules that do not select on it;
- the winning rule is frozen into the report with its rates and named on the
  panel, so a floor is always explainable after the rule has been edited away;
- and every block on the screen prints the floor it produces on the page's own
  worked example. That one line is what makes the screen safe: a contribution
  typed "0,25" instead of "25" is 0,25 %, it reads back as exactly what was
  typed, and the only thing that shows it is the floor beside it collapsing from
  428,57 EUR to 251,05 EUR.

A rule can also make the floor INSOLUBLE (keeping k of the price after paying c
of the margin has no solution once k ≥ 1 − c). The formula throws, `Costing`
catches, and the report carries no plan and no verdict at all rather than a
floor of 0,00 EUR beside the words "vendable sans validation".

**Selling under the floor takes an exception**, with all four of the parts the
chapter names: a motive, an approver, a validity window and a displayed impact.
Three of them is a note, not an exception, so `Costing::derogation()` returns null
unless all four are there. And a derogation stops covering an order the moment
the price or the floor moves under it, because what was authorised was a stated
shortfall and not a category of them.

**Nothing here ever reaches a customer.** `scripts/php-guard.mjs` carries the
vocabulary as needles in every directory that renders, question 39's written
default is that a devis names the salesperson and never the commission, and the
register's own projection into `data/` withholds these rows and carries only
their count.

## Not built yet

- An admin screen for the pricing config. It is set through the option.
- An admin screen for the integration settings (studio origin, Worker URL). Same.
  The facturation screen (`Admin.php`) covers VAT, the legal identity, the
  invoice series and the carriage settings.
- The quote DOCUMENT: its versions, its acceptance token, its PDF and the BAT.
  `Quote.php` holds the request and its state; the document belongs to session
  06, when there is a payment to attach it to. **The costing is not attached to
  a devis request either, and that is why**: a request carries a garment and a
  quantity and no design, so it has no transfer geometry, so its largest cost
  component would be unknown. A floor price built on that is a number with its
  biggest term missing. The estimated/known flag reaches the margin report and
  both admin screens today; it reaches a quote when there is a quote with a
  design on it.
- Réassort. "Commander à nouveau" is deliberately REFUSED on a personalisable
  product rather than silently producing a plain garment at the catalogue price
  (`woocommerce_order_again_cart_item_data` defaults to an empty payload).

Built and proved end to end on 2026-08-13 by `scripts/wp-e2e-verify.mjs`: the
studio's bridge client and design upload (`src/lib/teeshoop/`), the buy flow,
the garment mapping, and the size grid, which the modal now draws and the cart
reads as the quantity.
