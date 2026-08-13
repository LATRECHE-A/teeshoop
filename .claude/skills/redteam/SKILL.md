---
name: redteam
description: Adversarially review your own diff before committing, in the Teeshoop repo. Required for anything touching pricing, print geometry, the cart, payment, customer data or an open route. Finds the class of defect that passes tests because the test and the code share an assumption.
---

# Red team your own work

On this project this pass has a better hit rate than the test suite. The last time it ran
over a finished, typechecked, fully green change it found six real defects, two of which
would have deleted a customer's artwork from a print.

The reason is structural: your tests encode your assumptions. A reviewer starting from the
failure rather than from the code does not share them.

## How to run it

Do not read your diff looking for mistakes. Start from a **consequence** and work backwards
to whether the code allows it. For each lens, write the chain concretely: input, then the
code path, then the wrong physical or financial output. If you cannot write the chain, it is
not a finding.

Delegate the lenses to parallel subagents when the diff is large. Give each one the diff and
one lens, tell it to verify every mechanism against the actual files before reporting, and
tell it that generic software-engineering worries are not wanted, only failures this change
enables.

## The lenses

**The press operator.** What reaches the film and the shirt? Clipped artwork. A feathered
edge cut at a threshold. A transfer placed from numbers that no longer describe where the
ink goes. Two transfers that overlap because a box shrank but a mask did not. A piece too
small for the packer's grid. A design that splits differently at S than at 3XL.

**The accountant.** Which numbers must agree and now might not? Quoted against charged.
The studio's arithmetic against the PHP authority's. The value shown before the editor
against after. Cached geometry against freshly computed. An order priced before the change
and re-priced after. Film estimated against invoiced. Anything that crosses a tier boundary
in the wrong direction.

**The attacker.** They have a browser and our public JavaScript. Origin checks, sender
identity, payload shape, the nonce, the open upload routes, the R2 read paths, the admin
gate, and anything in a customer bundle that should not be there.

**The unlucky user.** The asset fails to decode once and succeeds the next time. The
network drops mid-upload. Two tabs. A double click. Storage evicted between the preview and
the export. The design edited after the quote and before the cart.

**The maintainer in eighteen months.** What is now true only by coincidence? Which comment
is now a lie? Which cache key no longer identifies what it names? What did you leave in two
places?

## What the last pass actually found

Kept here because these are the shapes to look for, not because they are still bugs.

1. A probe returned the same value for "there is no ink here" and "I could not read this",
   so an unreadable image deleted the layer from the transfer **and** from the price. Two
   states where three were needed.
2. A cache keyed by asset id, when re-running background removal replaces the bytes under
   the same id. The new artwork was cropped to the old artwork's bounds.
3. Overlapping areas summed instead of unioned: the customer charged twice for the same
   square centimetres, and a design that fits the chest able to measure larger than the
   whole print area.
4. A partition computed on scaled values against an unscaled threshold, so the same design
   split differently at different garment sizes and broke a stated invariant.
5. One code path given an outward safety margin and a sibling path given none, on a crop
   that was now tangent to the artwork.
6. A floor that **dropped** anything below it, which was survivable while the input was
   always oversized and deleted real artwork the moment the input became tight.

Notice what they have in common: none is a logic error in the new code. Each is an
assumption that used to hold and quietly stopped holding.

## Verdicts

Rank by consequence, not by likelihood: scrap print, wrong money, degraded, cosmetic. For
each finding give the mechanism and the mitigation. Then fix them, and add the test that
would have caught each one. Report what you found even when you fixed it, because the user
needs to know what the change nearly did.
