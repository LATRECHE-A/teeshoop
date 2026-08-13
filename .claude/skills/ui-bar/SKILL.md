---
name: ui-bar
description: The design and copy bar for anything a Teeshoop customer or operator sees. Use before building or changing a page, a template, a modal, an email or any user-facing string, in the studio, in WordPress or in a transactional message.
---

# The bar for anything a person sees

teeshoop.com competes with mistertee.fr and tostadora.fr for French buyers who have already
seen a dozen sites like ours. An interface that reads as generated loses before the price is
compared. This is the standard, and it is not negotiable per screen.

## Look at the real thing first

Before designing a page, open the competitors' equivalent and write down what they do and
where it is weak. Our openings so far: the B2B path (quantity pricing, quotes, samples,
SIRET on the invoice) is buried on both. Do not design in a vacuum and do not copy either.

## Banned

- Gradient heroes. Glassmorphism. Everything centered. The same border radius on every
  element. Drop shadows as decoration rather than as elevation.
- Emoji as icons, bullets or section markers, anywhere.
- Animation that serves nothing: scroll-triggered fades on every block, hover effects that
  shift layout, confetti, a spinner where content could stream in.
- Badge and pill soup. Icons with no meaning. A theme toggle nobody asked for.
- Numbered markers (01 / 02 / 03) on content that is not a sequence.
- Copy in the register of "Transform your workflow", "Effortless", "Powered by AI".
- Lorem, placeholder images, sample testimonials, invented ratings. Fake reviews are also
  illegal in France.

## Required

**Real content or an honest empty state.** If the data does not exist yet, design the empty
state. Never fill a layout with plausible fiction, because plausible fiction gets shipped.

**A type scale that is used.** Pick it, then stay on it. Running text near 65 characters.
Headings balanced. Uppercase labels get letter-spacing. Digits that line up in a column get
`font-variant-numeric: tabular-nums`, which on this site means every price, quantity and
dimension.

**A palette where semantic colour is separate from the brand accent.** Good, warning and
critical are not the accent hue. A neutral that was chosen, not inherited: a pure mid-grey
reads as unconsidered.

**Every state designed.** Loading, empty, error, partial, too many. An error says what went
wrong and what to do, with no apology and no vagueness. "Le fichier dépasse 12 Mo" beats
"Une erreur est survenue".

**A control that says what will happen, and a confirmation that says it happened.**
"Ajouter au panier", then "Ajouté au panier". Never "Succès" and never an exclamation mark.

**Keyboard and focus from the start.** Visible focus, logical order, escape closes, the
whole buying path operable without a mouse. Session 12 audits this and retrofitting it is
miserable.

**Mobile first.** Design at 375 px, then widen. Screenshots at 375, 768 and 1440 in the
transcript for any page you build.

## French e-commerce conventions

- **TTC for consumers, HT for business.** Both visible where both audiences read. A B2B
  buyer who sees only TTC assumes we are not set up for them.
- **cm is the customer-facing unit.** `src/lib/units.ts` says so. Never inches, anywhere a
  customer can see, including print sizes and print areas.
- Numbers with a comma: 14,50 EUR, 25 cm, 0,5 mm. Currency after the number.
- Delivery in working days, from a stated cut-off.
- A physical address, a real phone number, and legal identifiers reachable from every page.
- Quantity breaks presented as a reason to order more, not as fine print.

## Copy

Written in French, by a person, for a French SME buying twenty-five polos or a consumer
buying one t-shirt. Name things by what the buyer recognises, not by how the system is
built. Active voice. Specific beats clever. No exclamation marks. No em-dashes.

If you are unsure of a term of art in the printing trade, ask rather than invent one. The
associate runs the machines and knows the vocabulary customers use.

## Before you call a screen done

Check it against this list explicitly, and say in your report which items you verified
rather than assuming. Then screenshot it.
