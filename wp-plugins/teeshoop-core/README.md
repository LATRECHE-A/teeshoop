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
npm run test:wp         # 9 cases against the real cart
```

The pure tests run in CI. The integration test does not — it needs a database
and a live WooCommerce, same reason the Playwright harnesses stay out.

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
| `teeshoop:add-to-cart` | `garment`, `qty`, `sides[]`, `designId`, `sizeGrid` | Page replies `teeshoop:cart-result`. |
| `teeshoop:resize` | `height` (px) | Frame is resized, clamped to 320–4000. |

Page → studio: `teeshoop:context`, `teeshoop:quote-result`, `teeshoop:cart-result`.

A side is `{ id: 'front' | 'back' | 'sleeve_l' | 'sleeve_r', area_sq_cm: number }`.
The area that counts is the **ink**, not the layer rectangle — sending the
rectangle is what makes a customer pay for transparent margins.

Every inbound message is checked three ways before it is acted on: `event.origin`
must equal the configured studio origin (compared with `===`, never
`startsWith` — a prefix test passes for `https://studio.teeshoop.com.evil.tld`),
`event.source` must be our own frame's `contentWindow`, and the payload must be
an object with a known `type`. Replies always name the studio origin explicitly;
`*` would broadcast cart totals to whatever document happens to occupy the frame.

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

Local development opts out in `wp-config.php`:

```php
define( 'TEESHOOP_ALLOW_UNVERIFIED_DESIGNS', true );
```

Production must not define it.

## Not built yet

- The Worker's `/api/design/{id}` endpoint the verification calls.
- The R2 upload path from the studio (`design_id` has no producer yet).
- An admin screen for the pricing config — it is set through the option.
- The size-grid UI. The server accepts and prices one; nothing draws it.
- Product page templates and the quote form.
