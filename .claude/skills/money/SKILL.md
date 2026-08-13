---
name: money
description: How money is computed, stored, tested and reconciled in Teeshoop: the server price authority, integer cents, VAT, discounts, invoicing and refunds. Use for anything touching a price, a quote, a cart total, an order total, VAT, shipping cost, a discount, an invoice, a refund, a supplier cost or a commission.
---

# Money

Every rule here is cheap to follow and expensive to discover you broke.

## The authority

`wp-plugins/teeshoop-core/includes/Pricing.php` computes every payable price, in PHP, on
the server. There is **no `price` field in the add-to-cart request**: not ignored, absent.
The cart stores the customer's choices and re-derives the price on every totals pass, so a
tampered session, a replayed request and a price that was right last week all resolve to
today's correct number.

`src/content/pricing.ts` in the studio is a **preview**. It must never be the number a
customer pays. Where the two must agree, they agree because they read the same bounds in the
same unit, not because someone kept them in sync by hand: the tier bounds were once 97 in²
and 193 in² here against 625 cm² and 1250 cm² there, which are 625,81 and 1245,16, close
enough to look identical and different enough to quote one price and invoice another.

## Representation

- **Integer cents. No float ever holds a price.** A shop that adds a surcharge to a
  discounted unit and multiplies by 47 drifts by a cent or two, and then disagrees with
  WooCommerce, the invoice and the payment processor.
- `Money::from_eur` accepts `"14,50"`, and strips ordinary, non-breaking and narrow
  non-breaking spaces. A French admin types a comma; reading it as 14 under-prices every
  garment by a third with nothing looking wrong.
- **Round once**, at the end, and then make the line total, the order total, the invoice and
  the processor's charge agree to the cent. Assert it in a test.
- Areas are cm² everywhere, on both sides of the bridge. There is deliberately no
  in² to cm² conversion in this codebase, because the obvious place to add one is also the
  obvious place to forget it and divide every print in the shop by 6,4516.

## The seam is where the money goes

`Pricing::quote()` was correct the entire time customers were losing their quantity
discount. `recompute_prices()` carried the standard `did_action(...) > 1` guard, copied from
every tutorial on `woocommerce_before_calculate_totals`. That guard exists to stop
**relative** price edits from compounding (`set_price(get_price() * 0.9)`); ours are
absolute, so it bought nothing and skipped every recalculation after the first. Quantities 9
through 50 all kept the qty-30 rate.

Consequences for how you work:

- **Never copy a framework guard you cannot explain.**
- Pure tests cannot see this class of bug. Anything touching the cart or the order needs a
  test against a real WooCommerce (`npm run test:wp`), not only against the pure function.
- The boundary quantities to test are **1, 9, 10, 24, 25, 49, 50, 100**, and the case that
  matters most is **editing the quantity on the cart page**, which is exactly where it hid.
- Assert that the displayed grid and the charged quote agree cell for cell. They are the
  same rules; if they are computed twice they will diverge.

## VAT and invoicing, France

- 20 % standard. Prices are stored HT and displayed HT and TTC depending on who is looking.
- Intra-EU B2B with a valid VAT number is exempt with reverse charge. Validate against VIES
  and **store the proof**: an unverified exemption is our liability, not the customer's.
  Build it properly or refuse it explicitly, never half.
- Invoice numbering is sequential and gapless, and must be allocated under a lock. Two
  simultaneous orders sharing a number is an accounting problem you cannot fix afterwards.
  Write the concurrency test.
- Ten-year retention. That constrains what RGPD erasure can actually delete; see the
  `france` skill.

## Discounts are costs

Free shipping over a threshold, a negotiated price, a commercial gesture: each is money we
chose not to collect, and each must reach the margin engine. A discount that appears only in
the checkout total and not in the cost model makes every margin report a lie.

The floor price comes from `Margin.php`, with the Bible's formula corrected: the constraint
is `P >= C + K/(1-c)`, not `(C+K)/(1-c)`, because commission is paid on the margin and not
on the cost. At C = 250 EUR, K = 100 EUR, c = 40 % the true floor is 416,67 EUR where the
Bible publishes 583,33 EUR. The test holds both so a future restoration says which number
moved.

## Money going out

Refunds, partial refunds, cancellations after production has started, and supplier orders
all deserve the same rigour as money coming in, and usually get less. A refund path that
rounds differently from the charge path produces a customer who is owed a cent forever.

## Before you call money work done

Reconcile one real order end to end and show the arithmetic: unit price, quantity break,
per-side charges, VAT, shipping, total, invoice, processor charge, cost, margin, commission.
Every number's provenance, in one place. If two of them disagree by a cent, that is the
finding, not a rounding detail.
