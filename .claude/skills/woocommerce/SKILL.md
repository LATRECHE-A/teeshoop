---
name: woocommerce
description: WooCommerce and WordPress framework discipline for the Teeshoop plugin: cart hooks, item data, order meta, HPOS, template overrides, sessions, custom statuses and product data at scale. Use when writing or changing anything in wp-plugins/teeshoop-core, when a Woo hook is involved, when adding order or product meta, when overriding a template, or when Woo behaviour is surprising.
---

# WooCommerce discipline

`wp-local` is the environment. This is the framework, and specifically the places where
correct code still produces wrong behaviour.

## The cart hooks that matter

| Hook | What it is for |
|---|---|
| `woocommerce_add_cart_item_data` | Attach our choices to the line. Also where distinctness is enforced. |
| `woocommerce_before_calculate_totals` | Set the price. Read the warning below before touching it. |
| `woocommerce_get_item_data` | What the customer sees on the cart line. |
| `woocommerce_checkout_create_order_line_item` | Persist to the order, which is the record that must survive. |

**`before_calculate_totals` runs more than once per request.** Every tutorial tells you to
guard it with `did_action(...) > 1`. That guard exists for **relative** price edits, which
compound if applied twice. Ours are **absolute**, recomputed from the stored choices, so the
guard bought nothing and skipped every recalculation after the first: a customer who typed
50 into the quantity box on the cart page crossed a discount threshold and kept paying the
old rate. There is deliberately no such guard in `Cart::recompute_prices()`, and a comment
there says why. Do not put it back.

Guard on `is_admin() && ! wp_doing_ajax()` instead, which is about *where* the code is
running rather than *how many times*.

## Cart items merge unless you stop them

WooCommerce hashes the item data to decide whether two additions are the same line. Two
different designs on the same product will merge into one line with quantity 2, and the
customer receives two of one design. `Cart::keep_items_distinct()` adds an md5 of the design
plus `microtime` for exactly this reason. Anything that adds a personalised line must not
defeat it.

## The cart session is a database row

Cart contents are serialised into the database and loaded on every request for that
customer. Whatever you attach to a line is paid for on every page view. `Design::normalise_sides()`
deliberately keeps only the fields the price depends on and drops everything else the studio
might send: layer trees, fonts, undo history. The design itself is in R2 behind an id.

## Order meta is the archive

An order must be readable in eighteen months, by someone who is not you, when the studio has
changed twice. Two kinds:

- **Visible meta** for the operator: `Design`, `Printed sides`, `Sizes`.
- **Hidden meta**, underscore-prefixed, for the machinery: `_teeshoop_design_id`,
  `_teeshoop_sides`, `_teeshoop_files`, `_teeshoop_verified`.

Store what production will need, in a form that does not require the code that wrote it.

## HPOS

High-Performance Order Storage is the default on new installs. Declare compatibility with
`FeaturesUtil::declare_compatibility`, and **never read order data from postmeta directly**.
`$order->get_meta()` and `$order->update_meta_data()` work in both worlds; `get_post_meta()`
on an order id silently returns nothing under HPOS, which reads as "the field was never
set".

## Templates

Override in the plugin, never by editing a theme: a theme is updated by someone else. Pin
the WooCommerce template version you copied, and add a check that **fails loudly** when
upstream changes, rather than silently rendering a half page after an update.

## Products at scale

Several hundred variable products with colour and size axes is our real catalogue.

- `wp_insert_post` in a loop times out on shared hosting. Batch, make progress observable,
  and make the importer resumable and idempotent, keyed by supplier SKU and never by title.
- A product with hundreds of variations breaks the admin edit screen before it affects the
  front end. Test the admin.
- Filterable attributes belong in taxonomies, not in meta. See the `perf` skill.

## Custom statuses

An order lifecycle beyond Woo's own needs registered statuses, entries in the admin list
filters, bulk actions, and email triggers. Guard the transitions so illegal ones are
impossible rather than merely unlikely: an order must not be able to reach "in production"
without an approved proof.

## Testing

Two suites, both required, for the reason above.

- `npm run test:php`: `Money`, `Pricing` and `Margin` call **no WordPress function**, which
  the runner enforces by construction. Fast, and runs in CI.
- `npm run test:wp`: the seam, against a real cart. Does not run in CI because it needs a
  database, same reason the browser harnesses do not.

`wp eval-file` eval()s the file: `declare(strict_types=1)` is fatal there, and apparent file
scope is function scope. See `wp-local` for the full story, including the harness that once
printed nine green ticks under a "0 passed" total.
