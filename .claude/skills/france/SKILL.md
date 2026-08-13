---
name: france
description: The legal, fiscal and consumer rules a French e-commerce site selling personalised goods must satisfy, plus the conventions French buyers expect. Use when writing customer-facing copy or terms, handling personal data, building consent or cookie flows, invoicing, setting delivery promises, or building anything a French consumer or business buyer will see or agree to.
---

# Selling in France

Everything generated here is a **draft for a professional to review**, and must say so in
its own header. Your job is to make sure nothing is missing and that every mechanism the law
requires actually works in the code. Questions only a human can answer go into
`QUESTIONS-ASSOCIE.md`, in French.

## The withdrawal right, and why our mechanism matters

A consumer has 14 days to withdraw from a distance sale. **Personalised goods are excluded**,
which is the entire basis of this business model. The exclusion only holds if the customer
was informed and agreed **before** the order, and if we can prove it.

So this is not a checkbox, it is evidence:

- Consent captured at checkout, before payment.
- Stored with the **version of the CGV** accepted, the timestamp, and the order.
- Reproduced on the invoice.
- The CGV must therefore be **versioned and addressable**, not a page someone edits in
  place. A record pointing at "the terms" is worthless if the terms have changed since.

## Mentions légales

Required on the site and reachable from every page: company name and legal form, share
capital, registered address, RCS and SIRET, VAT number, publication director, and the host's
name and address. Leave clearly marked placeholders where the associate must supply a real
value, so a draft cannot ship as though it were complete.

## Invoicing

Sequential and gapless numbering, allocated under a lock. Our identifiers, the customer's,
the VAT breakdown, payment terms and late-payment penalties for B2B. Ten-year retention.

That retention constrains erasure: see below.

## VAT

20 % standard. Store HT, display HT and TTC according to the audience. Intra-EU B2B with a
valid number is exempt under reverse charge, validated against VIES with the proof stored.
An unverified exemption is our liability.

## RGPD, as mechanisms rather than a page

Write down what we collect, why, on what legal basis, and for how long. Then make the rights
work: access, rectification, erasure, portability, objection.

**Erasure is the hard one here, and it is the one that gets faked.** A customer's data is in
at least four places: their order in WooCommerce, their design document and rasters in R2,
their address with the carrier, and their email in Brevo. Meanwhile the invoice must be kept
for ten years for tax. So "delete my data" means: anonymise the order while keeping the
fiscal record, delete the design and the artwork, remove them from the mailing tool, and
document exactly which fields survive and why. Follow the data. An erasure that leaves the
artwork in R2 is not an erasure.

Keep a subcontractor register with the DPAs: Stripe, Brevo, Cloudflare, o2switch, and
anything added later. What each processes, and where.

## Cookies, CNIL rules

Stricter in practice than the generic banner implies:

- No non-essential cookie or tracker before consent. Not "loaded but inactive": not loaded.
- Refusing must be as easy as accepting, in one click, at the same level.
- Consent recorded, dated, and revocable from a persistent control.
- Measurement tools can be exempt only under specific conditions. If you rely on that, cite
  which and configure accordingly.

## Reviews

Fake or incentivised reviews presented as genuine are illegal. No sample testimonials, no
placeholder ratings, not even temporarily during development, because placeholders ship.

## Accessibility

Target WCAG 2.2 AA (RGAA in the French framing). Prioritise the buying path: catalogue,
product, cart, checkout. The studio's canvas editing will never be fully accessible, so say
so plainly and provide a route that is: upload artwork, request a quote, ask us to place it.

## Conventions French buyers expect

- **TTC for consumers, HT for businesses.** Both visible where both audiences read. A B2B
  buyer who sees only TTC assumes we are not set up for them.
- Decimal comma and a space before the currency: 14,50 EUR. Percentages with a space: 20 %.
- **cm, never inches**, anywhere a customer can see, including print sizes and print areas.
- Delivery in working days, from a stated cut-off, not "2-3 days".
- A visible physical address and a real phone number.
- Quantity breaks shown as a reason to order more, not as fine print.
- Copy written by a person in French, not translated from English. Ask about a term of art
  in the printing trade rather than inventing one: the associate runs the machines and knows
  the words customers actually use.
