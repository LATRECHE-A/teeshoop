# teeshoop-core

The only new server code between the studio and the shop. WordPress keeps doing
what it does well, the studio keeps doing what it does well, and this plugin
holds the three things neither of them may own.

## What it owns

**The price.** Computed in PHP, from `Pricing.php`, on the server. The studio
displays what it is told and never computes a price a customer can pay. Two
implementations of the same rules always diverge in the end (on a tier
boundary, on a rounding mode, on the VAT basis), and the day they do, the
customer sees one number and the invoice says another.

There is no `price` field anywhere in the add-to-cart request. Not "ignored":
absent. The cart stores the customer's *choices* and re-derives the price from
them on every totals pass, so a tampered session, a replayed request, or a price
that was right last week all resolve to today's correct number.

**The editor is in the page.** Until 5 September 2026 the studio ran cross-origin
in an iframe: it could not read WordPress cookies, could not call the REST API,
and posted a message to the parent page, which held the nonce and made the call.
That whole apparatus is gone (`Shortcode.php`, `assets/bridge.js`). The editor is
now a plugin asset served from the shop's own origin (`includes/Editeur.php`,
built from `src/native/` into `assets/editeur/`), holds the nonce itself, and
calls `/wp-json/teeshoop/v1/cart` directly. The one thing that still crosses an
origin is the artwork upload to the Worker, which is why `worker/cors.ts` exists.

The rules did not move: the nonce is required explicitly (`Rest::check_nonce`),
`Cart::add` re-derives the garment from the product and the printed sides from
the stored design, and `refuse_plain_add` still refuses every add that does not
go through `Cart::add`. An editor in the page gets no more trust than one in a
frame. See `docs/decisions/2026-09-05-le-personnalisateur-est-dans-la-page.md`
for the six reasons the frame existed and the answer to each.

**The hand-off.** An order line stores a design *identifier*. Artwork lives in
R2. `wp-content/uploads` is served by URL with no access control, and
`robots.txt` is not a permission.

**The print run.** Film is bought in one format whoever is paying for it (a 33 x 46 cm
A3+ sheet since question 04 was answered on 1 September 2026; a 56 cm roll before
that), so from session 07 the unit that buys film is the LOT and not the order: everything paid
for and approved, ganged onto one set of gang sheets, one supplier order, one
delivery charge, and the bill split back so each margin report still says what
its own order cost. `Production.php` owns the queue, the calendar and the lot;
`Cost::attribute()` owns the split.

The LAYOUT is measured in the admin studio, because a transfer's extent is its
ink and ink lives in an alpha channel, which neither PHP nor a Worker can read.
So the shop does not trust it, it bounds it: the garment-sides must match, the
length must be at least the artwork over the roll width and at most what the
packer makes of the same pieces, and the transfers must be big enough to hold
the ink the order was charged for. An unreachable packer refuses the lot.

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
  Quote.php           the devis: a record with a state, then a document with
                      lines, a number, a version per send, and a costing that
                      calls the ONE engine
  Lifecycle.php       where an order is, what may happen next, and the guard
                      that refuses everything else. The status is a label; the
                      record is the authority
  Bat.php             le bon a tirer: composed from the design, frozen per
                      version, approved on a capability URL, archived as a PDF
  BatPage.php         the whole HTML document a customer approves on. No theme,
                      no script, two forms
  Waiver.php          the withdrawal right, and the acknowledgement the law
                      wants BEFORE the order rather than at the proof
  Claim.php           une reclamation, and chapitre 5's decision matrix
  Mail.php            the outbox, then Brevo. A failed send is visible
  Notify.php          what the shop writes to people, and when
  Catalogue.php       supplier style -> WooCommerce product. Pure. Argues the
                      mapping, the 366-variation trade-off and the image cost
  Supply.php          the HTTP client to our own Worker. The only file allowed
                      to name a supplier route, and it fails closed
  Importer.php        the idempotent, resumable, lockable import pass
  Taxonomy.php        pa_couleur and pa_taille, and the size ordering Woo needs
  Shelf.php           what an imported reference does once published: the seal
                      on the purchase price, and the colour photo swap
  Rest.php            /wp-json/teeshoop/v1/*
  Editeur.php         the customiser, in the product page: the container, the
                      two assets, and the context the page hands the bundle.
                      Replaced Shortcode.php and its iframe on 05/09/2026
  Url.php             scheme://host[:port] of a configured URL, once. Three
                      copies of this had drifted apart by one allow-list
  Swatch.php          the colour of a garment, measured. Pure: no WordPress and
                      no GD, so tests/run.php exercises every branch of it
  Colours.php         where the images come from and where the verdict goes
  Cli.php             wp teeshoop provisionner | verifier | marge
                         | catalogue importer | catalogue etat | catalogue purger
                         | couleurs mesurer | couleurs reclasser
                         | couleurs etat | couleurs oublier
assets/
  tokens.css          THE PALETTE, THE TYPE SCALE AND THE SPACING, once, on :root.
                      Custom property declarations and nothing else: this file
                      loads on a shop whose theme we may not own, and a single
                      rule that styled an element would be this plugin restyling
                      someone else's page. Every colour pair carries its measured
                      contrast ratio in the comment beside it
  components.css      the shared pieces: the button, the table, the note, the
                      form field, the message, the tabular figures. Split out of
                      product.css in session 09 so the THEME can load them without
                      also loading the buy box and the size grid
  product.css         the product page's own blocks, and only those
data/
  garments.json       GENERATED from the studio. Do not edit; see below
templates/teeshoop/
  product-cta.php     quantity, faces, the live estimate, the two ways on
  product-specs.php   print zones in cm, the garment, the size guide
  product-price-grid.php   faces by quantity, HT and TTC
  product-quote.php   the devis form
assets/
  editeur/            THE BUILT CUSTOMISER, from src/native/. Versioned, because a
                      WordPress plugin is deployed by copying its directory, and
                      `scripts/editeur-guard.mjs` rebuilds it into a temp dir and
                      byte-compares so it cannot rot. The entry carries a content
                      hash in its name: WordPress's `?ver=` query would make the
                      lazy chunk import a SECOND copy of the module
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

## The theme is ours too

Since session 09 the shop runs `wp-themes/teeshoop`, a classic theme in this
repository. The decision and its three rejected alternatives are written at the
top of its `functions.php`, and two things about it matter here.

**It overrides no WooCommerce template either**, for the reasons in `Compat.php`
plus one more: a copied template stops receiving upstream fixes. `woocommerce.php`
is a THEME template, not a Woo one, and it calls `woocommerce_content()`, so every
`do_action( 'woocommerce_single_product_summary' )` this plugin hooks still fires.

**It computes no price.** Every figure on every page comes back through
`Pricing`, `Production::config()`, `Garments` or `Settings::price_pair()`. That
last one is new and exists because four places now print the same sentence: the
decision about whether to write "HT", "TTC", both or neither belongs to
`Settings::price_bases()`, and the WRITING of it belongs beside it. It used to be
inline in `ProductPage::price_html`, which was fine while there was one caller.

`wp teeshoop provisionner` creates the two pages the theme links to, `devis` and
`entreprises`, by slug, and prefers `teeshoop` over Twenty Twenty-One when it has
to get a mirror off a block theme.

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
npm run verify:bat      # 62 assertions, real browser, one order from payment to delivery
```

**`verify:bat` covers the half a PHP suite cannot reach**: a page served from
`admin-post.php` with no theme and no script, whether its buttons post where they
say they do, whether the approval a browser sends is the one the database
records, and whether the whole thing works at 375 px. It found two things on its
first run. A preview of the proof e-mail was minting a new approval token and
killing the live link, so reading and re-sending are now two functions
(`Notify::render` touches nothing, `Notify::rebuild` mints, and the names carry
it). And the proof headed itself "19 Aout 2026", because WordPress's fr_FR
abbreviated month is capitalised and a French month name is not.

**Its mail assertions are stronger than "sent", not weaker.** The container has
no Brevo key and no MTA, so every message fails at `wp_mail`. What the run proves
is that a message which does NOT reach the customer is visible: the row exists,
it was attempted rather than left queued, and the failure carries a reason.
Brevo's own request, its header, its body and its refusals are asserted in
`tests/integration-lifecycle.php` against the real `wp_remote_post`, with only
the wire replaced (`pre_http_request`).

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

The pure tests run in CI. The integration test does not: it needs a database
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
`div`. teeshoop.com runs Woodmart, which is classic, and `wp-themes/teeshoop`
is classic too; the harness switches the mirror to ours, with Twenty Twenty-One
behind it, and says which one it picked.

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

And one namespace that is not customer-facing at all.

| Route | Auth | Notes |
|---|---|---|
| `GET /wp-json/wc-teeshoop/v1/production/queue` | `manage_woocommerce` | What could go on a press today, with the roll geometry to nest it on and the deadline arithmetic. Returns customers, dates and film. |
| `GET·POST /wp-json/wc-teeshoop/v1/production/lots` | `manage_woocommerce` | Read the recent runs, or record one from a chosen set of orders and a measured layout. Every refusal names the order it is about. |
| `POST /wp-json/wc-teeshoop/v1/production/lots/{id}/etat` | `manage_woocommerce` | Order the film, receive it, close the run. Frozen from the first of those onwards. |

**The `wc-` prefix is the whole reason that namespace is not `teeshoop/v1`.** The
admin studio runs on the Worker's origin, so it has no WordPress cookie and no
REST nonce, exactly like the customer studio; what it does have is the
WooCommerce consumer key the catalogue importer already uses. WooCommerce
authenticates by key only for routes that look like its own, and `wc-` is its
documented opt-in for third parties. It also keeps the two surfaces visibly
apart: `teeshoop/v1` is public and returns selling prices.

Two more endpoints are customer-reachable and neither is REST. They are
`admin-post.php` actions, the same shape `Invoice::serve` uses, because both have
to work for somebody who is not logged in and holds no nonce.

| Action | Auth | Notes |
|---|---|---|
| `?action=teeshoop_bat` | a per-VERSION token | The proof. 32 random bytes, stored as a SHA-256 digest and compared with `hash_equals`, minted per version and dead the moment a newer one exists. A shop manager gets in without it, because they can already read the order, and the page they get draws no buttons. |
| `?action=teeshoop_bat_decision` | the same token, in the POST | Approve, or ask for changes. There is no operator path here at all: an approval is always the customer's own act. |

**The order key was the obvious token for the proof and is the wrong one.** It is
already in every WooCommerce e-mail and in the order-received URL, so it proves
"has seen this order". Approving a proof is a commitment, not a look.

A version keeps its last **three** token digests, not one. A re-send used to mint
a token and drop the old digest, on the argument that a retry only runs when the
first message did not arrive; that argument is wrong in the one case that
matters, because Brevo can accept and deliver a message and still have our read
time out. They all die together the moment a newer version exists, which is the
property that matters.

## The outbox has five states, and three of them exist because two were not enough

| State | Meaning |
|---|---|
| `queued` | Inserted, and nothing has come back. A row **stuck** here is the worst case and is counted and retried: it means the process did not survive the send, and "we do not know whether it went" is worse than "it did not go". |
| `sending` | Claimed by a retry, on the wire now. One conditional UPDATE, so the hourly cron and an operator pressing Réessayer cannot both send. |
| `sent` | The transport took it. Never retried, whatever asks. |
| `failed` | It did not go, and the row says why in the provider's own words. Retried. |
| `abandoned` | It did not go and it never will: nothing can rebuild it. Internal alerts compose their text at the moment of the event, so a retry has nothing to make one from. Without this state one such row kept the "a customer never got their proof" banner on every admin screen for ever, and a permanent banner is a banner nobody reads. |

**The row never holds the message.** A retry re-renders from the order, which is
a security property before it is an economy: the proof e-mail carries a
capability URL, so a table of rendered bodies would be a table of live approval
links in every backup. `Notify::rebuild` mints a new link and `Notify::render`
does not, and the names carry the difference.

## The postMessage contract

This is what the studio side has to implement. `bridge.js` already holds up its
end.

Studio → page:

| `type` | Payload | Effect |
|---|---|---|
| `teeshoop:ready` | (none) | Page replies with `teeshoop:context`. |
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

The area that counts is the **ink**, not the layer rectangle. Sending the
rectangle is what makes a customer pay for transparent margins. `sideArtworkSqCm`
in `src/lib/ink.ts` is the producer, and it already returns **square
centimetres**: the studio used to work in square inches and no conversion between
the two existed anywhere, so the obvious way to wire this up divided every print
in the shop by 6,4516 and priced it flat forever. There is now nothing to
convert. The studio's tier bounds are the same two numbers as `Pricing::area_tier`'s,
in the same unit, for the same reason.

Every inbound message is checked three ways before it is acted on: `event.origin`
must equal the configured studio origin (compared with `===`, never
`startsWith`: a prefix test passes for `https://studio.teeshoop.com.evil.tld`),
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
decides the cost of the blank: `tee` contributes 13,00 EUR and `custom` zero, because
with `custom` the customer ships their own garment. `Cart::add` reads it from
the product; a request naming a different garment is refused rather than
corrected, because a disagreement means the page and the studio are selling two
different things.

### And which blank it is printed on

Two more fields on the same screen, from session 08, in the same file and for
the same argument: `_teeshoop_blank_ref` is the CATALOGUE REFERENCE this product
is printed on, and `_teeshoop_blank_colours` maps the studio's colour ids onto
the maker's own colour names.

Before them, no order in this shop could name a supplier article: the imported
catalogue's 26 399 articles have no selling price yet, so nobody can buy one,
and the three studio garments were attached to no reference at all. Every
purchase basket was therefore a list of lines reading « aucune référence », and
the cost engine could only price a blank with a figure somebody typed on the
costs screen.

The reference is the one an operator already knows and the importer already
writes on the parent product (`Catalogue::META_REF`), so it resolves by lookup.
The colour has to be mapped by hand because « Blanc » is not a colour a supplier
sells and the brief says in as many words that « Navy », « French Navy » and
« Deep Navy » must not be merged without a rule. The SIZE matches by exact name
and nothing else: no case folding, no nearest match.

Nothing is derived from the supplier's article numbering. It is
`styleNr . colourCode . one digit` with the same size-to-digit map in every
colour, so a reference plus a size could be turned into an article number by
concatenation; that number would be a guessed procurement key, and
`Catalogue::variations()` already records what it cost to publish one.

A colour with no entry, or a size the supplier does not sell in that colour, is
REFUSED by name and blocks the purchase. Ordering the wrong size is the most
expensive mistake in this system: the film is printed before the boxes arrive.

## Settings

`teeshoop_settings` (option):

| Key | Meaning |
|---|---|
| `studio_origin` | `https://studio.teeshoop.com`. **A security parameter.** Empty ⇒ the shortcode refuses to render rather than accepting messages from anywhere. |
| `studio_path` | Path within that origin, default `/`. |
| `worker_url` | Cloudflare Worker base URL. **It is now a browser-facing origin as well as a server-facing one**: the catalogue stores each colour photo as a path and the shop renders `worker_url + path` in an `<img src>`, so an address only the server can resolve (`host.docker.internal`, a private hostname) leaves every colour photo broken for customers while the importer works perfectly. It must be an address a visitor's browser can reach. |
| `design_verify_path` | Default `/api/design/`. |
| `mail_from`, `mail_from_name`, `mail_reply_to` | Who the shop writes as. **Empty is a refusal, not a default**: Brevo will not send from an address nobody has verified in their account, and a plausible `contact@teeshoop.com` here would produce a 400 on the first real proof e-mail with nothing on screen to explain it. |
| `mail_atelier` | Where the workshop's own alerts go. Falls back to the site administrator rather than to nowhere. |

`teeshoop_pricing` (option) is a partial overlay on
`Pricing::default_config()`: set `vat_rate` alone without restating the rest.

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
| `TEESHOOP_BREVO_KEY` | Transactional e-mail, **in production and nowhere else**. Absent in production sends nothing and records every message as failed, naming this constant. Everywhere else the key is ignored and the message goes through `wp_mail`, which is what the preproduction's `pre_wp_mail` circuit-breaker can stop: a `wp_remote_post` to api.brevo.com is not `wp_mail`, and the preproduction is a full copy of production with real customers on it. A constant and not an option for the same reason as the two above: it can send mail as us, to anybody. |

## The catalogue

| Command | |
|---|---|
| `wp teeshoop catalogue importer` | Import or refresh. Idempotent, resumable. |
| `wp teeshoop catalogue importer --duree=1800` | Do half an hour and stop cleanly. A cron slot. |
| `wp teeshoop catalogue etat` | Where the current pass got to. |
| `wp teeshoop catalogue purger` | Remove every imported reference. Local mirror only. |
| `wp teeshoop couleurs mesurer` | Measure a colour value for every colour name. |
| `wp teeshoop couleurs mesurer --recommencer` | All of them again. For when an IMAGE changed. |
| `wp teeshoop couleurs reclasser` | Re-decide every family from what is already measured, no fetch. For when a BOUNDARY changed. |
| `wp teeshoop couleurs etat --refus` | What is known, and what is not, with the reasons. |
| `wp teeshoop couleurs etat --releve` | The reviewable record, to stdout. Not `--json`, which WP-CLI takes for its own `--format`. |
| `wp teeshoop couleurs oublier` | Forget every measurement. |

**The colours have a value and nobody typed it in.** The supplier ships 442 colour
names and no hexadecimal. It does ship, per colourway, a flat colour chip
(`sku_color_swatch_url`, measured at 99,2 % to 100 % uniform) and a photograph of
the garment. The chip is the value, the photograph is an independent check on it
and the fallback, and both end at `Swatch::centre()`. A colour that cannot be
measured gets NO swatch and a recorded reason: the filter shows it by name, with
no dot, because a colour missing from the filter is a reference nobody can reach.
`docs/COULEURS.md` is the method; `npm run verify:couleurs` holds the record and
the code together by running the code.

**An image that could not be fetched is not a colour that was refused**, and the
code carries the difference (`reachable`) rather than inferring it. Without it a
Worker outage during `couleurs mesurer --recommencer` writes « photo non
récupérée » onto all 442 terms, deletes every swatch on the way, and the next
pass skips them all as already answered. The family boundaries are a pure
function of the stored OKLab, so moving one costs `couleurs reclasser` and a
second, not a seventeen-minute re-fetch: a boundary that is expensive to apply is
a boundary nobody applies.

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
produces an order the workshop cannot print, discovered after the customer has
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
| `POST /api/design` | The studio uploads the design document plus every raster it references. Open, like `POST /api/ar`: the customer is the author and cannot authenticate. Returns `{ id }`. |
| `GET /api/design/{id}` | The manifest. This is what `Design::verify` calls; 404 is what makes an unverifiable id refuse the cart line. |
| `GET /r2/design/{id}/preview.png` | Open on the id (~143 bits). A BAT email and a cart thumbnail carry no token. |
| `GET /r2/design/{id}/design.json`, `…/assets/*` | **Admin only.** The customer's original artwork; the only thing that needs it is the workshop. |

What is stored is the **source**, never the nested gang sheets: a layout depends
on the supplier, the roll, the quantity and which other orders are ganged with
it, none of which is known at add-to-cart. The rasters, by contrast, exist
nowhere else: lose them and the order is unprintable whatever else survives.

An upload whose design references artwork that did not arrive is refused (422),
and so is artwork the design never mentions: the first is an order the workshop
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
surface occupée sur une laize de 56 cm, de l'imbrication". The laize it names is
no longer the one bought (question 04's answer is a 33 x 46 cm sheet) but the
sentence's point stands: it is a packing, and
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

## Buying the blanks

`Purchase.php` is to garments what `Production.php` is to film: the unit that
buys is the run, not the order. `Purchase::basket()` derives a basket from a set
of orders and their size grids, `prepare()` freezes it, `send()` transmits it
once, and `PurchasePage.php` is where a human confirms. The decision behind all
of it, with the options that were not taken and their failure modes, is
`docs/ACHATS.md`.

Four properties are worth knowing before touching it.

**Every quantity is traceable and the code proves it.** Each basket row carries
the (order, line, size) claims that built it, and `aggregate()` refuses a basket
whose row quantity is not the sum of its claims. That is not defensive coding,
it is the requirement: a quantity nobody can trace is a size somebody guessed.

**`aggregate()` answers nothing about stock, deliberately.** It used to return a
placeholder verdict, and `scripts/purchase-bench.mjs` read it and printed « tout
est en stock » over a table showing zero L and zero XL against sixteen and four
ordered. The verdict is `stock_verdict()` and a caller has to ask for it. A
missing key is an error; a reassuring default is a lie with a tick beside it.

**Sending writes SENDING before it calls, and never retries.** There is no way
to ask this supplier whether an order exists, so a process that dies holding the
request leaves « envoi incertain » and the send refuses to run again. Three
outcomes, not two: accepted, refused (the orders go back, nothing was created)
and uncertain (the orders stay pinned, their blanks may be on their way).

**The inbound carriage is split, not repeated.** `Costing::compute()` charges an
order its own carriage until its blanks are bought, and then its share of one
document, allocated by `Cost::allocate()`, which is the same largest-remainder
function the film uses. Two allocators would disagree on a cent, and that cent
is what a supplier invoice fails to reconcile against.

## Stock is an observation with a date

`_teeshoop_stock_at` on the variation holds the timestamp the SUPPLIER published
with the quantity, not the moment we copied it. `wp teeshoop stock rafraichir`
sweeps the whole catalogue from one snapshot (one upstream call, measured at
46 591 articles in 674 ms) six times a day and writes both.

An article the snapshot did not mention keeps its old date and goes stale by
itself. A sweep that stamped everything it did not see would turn an article the
supplier has withdrawn into one the shop claims is available.

`Shelf::availability` is the only place the shop speaks about supplier stock to
a customer, and it never prints a figure: « Disponible » under 24 hours with
stock, « Délai allongé » under 24 hours without, and « Délai à confirmer » for
anything older or unknown. The third is not a degraded version of the other two.

The supplier's timestamp is in HIS wall clock, which is ours, and WordPress sets
PHP's default timezone to UTC. `Purchase::fresh` parses it in the shop's
timezone explicitly; `strtotime` would read every reading two hours into the
past in summer.

## Not built yet

- **A blank declared on any product.** `Product::META_BLANK_REF` and its colour map are the
  field that lets a purchase basket resolve an article, and nothing fills them in: on the
  real shop every basket line comes back « aucun textile nu n'est déclaré sur ce produit ».
  It is a saisie per sellable product, not a code task, and `docs/ROADMAP.md` and
  `ACCES-REQUIS.md` both list it.
- **A supplier order that can actually leave.** `FR_CUSTOMER_NR` is unset (the associate's)
  and `FR_ORDER_TOKEN` is unset (ours to generate), so `POST /api/fr/order` answers 503 then
  401. Both refusals are explicit on the purchase screen.
- **The path back from a purchase served in part.** The state and the refused lines exist;
  re-ordering just the missing sizes does not, and the orders stay pinned. `docs/ROADMAP.md`
  carries the exception and what would close it.
- **The supplier's invoice.** The cost reconciliation compares assumed against
  at-purchase; his interface publishes no invoice, so the third number is absent and the
  screen says so.
- An admin screen for the pricing config. It is set through the option.
- An admin screen for the integration settings (studio origin, Worker URL). Same.
  The facturation screen (`Admin.php`) covers VAT, the legal identity, the
  invoice series and the carriage settings.
- The devis's CUSTOMER-FACING half: a page the prospect opens, an acceptance
  token, a PDF. Session 06 built the document (lines, a number from the invoice
  sequence, a version frozen per send, and the costing) because the chapter's
  version rule and its `POST /pricing/quotes/calculate` both needed it. What is
  left is the part `QUESTIONS-ASSOCIE.md` records that we BUY: the relance
  cadence, the open-tracking status, the pipeline screen.
- `POST /pricing/quotes/{id}/approval-request`. The exception it would carry is
  built and load-bearing (reason, approver, validity window, shortfall, and it
  stops covering the order when the floor moves); what is missing is the round
  trip, a salesperson asking and somebody else approving. That needs two roles
  and the shop has one, so the request half would produce an approval that
  approves nothing and looks on screen exactly like one that does.
- Réassort. "Commander à nouveau" is deliberately REFUSED on a personalisable
  product rather than silently producing a plain garment at the catalogue price
  (`woocommerce_order_again_cart_item_data` defaults to an empty payload).
- A cost model for any technique other than DTF. Embroidery, flocking, vinyl and
  sublimation are named by Bible chapter 1 with all their drivers and none of
  their numbers, so nothing is costed and nothing is guessed. Registered as
  `H-Q12-COUT-PAR-TECHNIQUE`; the header of `Cost.php` says what would receive
  it and warns that `Costing::facts()` calls every printed order DTF today.
- An express or urgency supplement. Urgency reaches the FLOOR only, through a
  `PriceRule` scope. Registered as `H-Q14-AUCUN-SUPPLEMENT-URGENCE`. What
  session 07 changed is the other half of that sentence: an order is no longer
  costed at the French rate *whatever it is marked*, it is costed at the rate of
  the origin its film was actually bought from, and only once a lot has been
  SENT. `PriceRule::URGENCES` refuses to let a dropdown choose the country
  because a tick is not evidence; a frozen, dated, signed purchase is.
- Any promise of a delivery date. The workshop now plans against a target date
  per order, and it is internal: nothing on the site announces a lead time
  (`H-Q14-UN-COLIS-MAXIMUM`), and the screens call it « date cible » for that
  reason. Two of the three default lead times are shorter than the work they
  contain, which is measured in `tests/test-production.php` and written into
  question 14.
- The chapter's pricing API (`POST /pricing/quotes/calculate`,
  `POST /pricing/quotes/{id}/approval-request`), a version kept per price
  change, and its ten KPIs. Reasons and the session that should treat each are
  in `docs/ROADMAP.md` under "Les exceptions assumées"; `Costing.php`'s header
  says the same thing beside the code that would serve them.

Built and proved end to end on 2026-08-13 by `scripts/wp-e2e-verify.mjs`: the
studio's bridge client and design upload (`src/lib/teeshoop/`), the buy flow,
the garment mapping, and the size grid, which the modal now draws and the cart
reads as the quantity.
