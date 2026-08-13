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

## Layout

```
teeshoop-core.php     bootstrap; declines politely if WooCommerce is absent
includes/
  Money.php           integer cents; no float ever holds a price
  Pricing.php         the price authority — pure, no WordPress calls
  Margin.php          cost, floor price, commission (the Bible, corrected)
  Settings.php        stored config + the fail-closed defaults around it
  Design.php          design-id validation and Worker verification
  Product.php         which studio garment a WooCommerce product is
  Cart.php            WooCommerce cart and order integration
  Rest.php            /wp-json/teeshoop/v1/*
  Shortcode.php       [teeshoop_studio]
assets/
  bridge.js           the postMessage bridge (runs on the WP page, not in the frame)
  bridge.css          the frame's box, and nothing else
tests/
  run.php             zero-dependency runner for the pure classes
  test-pricing.php    the price authority
  test-margin.php     the corrected floor-price formula
  integration.php     the WooCommerce seam — needs a real WP (see below)
```

`Money`, `Pricing` and `Margin` call **no WordPress function**. That is a design
rule, and `tests/run.php` enforces it by construction: the day someone reaches
for `get_option()` inside `Pricing`, the runner stops working and says so.

## Running the tests

```bash
npm run test:php        # 46 cases, pure PHP, no bootstrap, <1s
npm run wp:up           # local WordPress 7.0.3 + WooCommerce, port 8080
npm run test:wp         # 11 cases against the real cart
npm run verify:wp-e2e   # 29 assertions, real browser, real Worker, real basket
```

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
| `GET /wp-json/teeshoop/v1/quote` | public | Pure computation. Returns selling prices only — never a purchase cost, supplier name or film rate. |
| `GET /wp-json/teeshoop/v1/grid` | public | The faces × quantity table shown before the editor opens. |
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
| `worker_url` | Cloudflare Worker base URL, used to confirm a design exists. |
| `design_verify_path` | Default `/api/design/`. |

`teeshoop_pricing` (option) is a partial overlay on
`Pricing::default_config()` — set `vat_rate` alone without restating the rest.

**⚠ The shipped prices are placeholders**, the studio's demo figures converted
1:1 from dollars. The real grid is question 04 of `QUESTIONS-ASSOCIE.md`.

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
from the add-to-cart body. They are the same numbers the workshop's transfers
will be rendered from, so the invoice and the film cannot disagree, and a
replayed request cannot claim 1 cm² of ink on a full-front print. The body is
kept only as a fallback for local development, where
`TEESHOOP_ALLOW_UNVERIFIED_DESIGNS` means there is no manifest to read. Which of
the two was used is frozen onto the order line as `_teeshoop_sides_source`.

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
- Product page templates: the price grid, the quote form, and anything on the
  page around the studio frame. Session 02.
- Payment. `Pricing` computes what a line costs; nothing takes money yet.

Built and proved end to end on 2026-08-13 by `scripts/wp-e2e-verify.mjs`: the
studio's bridge client and design upload (`src/lib/teeshoop/`), the buy flow,
the garment mapping, and the size grid, which the modal now draws and the cart
reads as the quantity.
