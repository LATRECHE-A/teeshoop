# Teeshoop: engineering rules

Read this as the standing brief. It is not advice. Every rule here exists because
something in this project already went wrong, or because a French apparel business
selling personalised goods cannot afford it to.

Two people depend on this code: a developer (the user) and his associate, who owns the
machines and wrote the business brief in `docs/bible/`. Money moves through it. Garments
get printed from it. Treat it accordingly.

---

## 1. The bar

Work as a group of senior engineers would: decide, justify, verify, and write it down.
Concretely, that means the following are never acceptable, whatever the deadline.

**Never guess a number that reaches a customer, a supplier or a printer.** Derive it or
refuse. A fabricated print size is worse than no print. If you cannot derive it, say so
and stop.

**Never claim a result you have not measured.** "This is faster", "this saves film",
"this fixes it" require a number produced by running the real thing. This module's history
contains several confident claims that were wrong when measured. Assume yours might be.

**Never leave two implementations of one rule.** The moment two places compute a price, a
size or an area, they will diverge, and the day they do a customer sees one number and the
invoice says another. Delete what you replace.

**Never ship a gate that cannot fail.** A test harness once printed nine green ticks under
"0 passed" with its failure exit unreachable. When you add a check, prove it fires: break
the thing on purpose once, in the transcript, then unbreak it.

**Never narrow the task silently.** If part of the scope turns out to be blocked or wrong,
finish everything else in full and state plainly what you left out and why. Scaling down
is the user's call.

**Never paste a secret into the chat**, and never ask the user to. Tell them the exact
command (`wrangler secret put X`) or the exact file.

---

## 2. Money

- **The server computes every payable price.** `wp-plugins/teeshoop-core/includes/Pricing.php`
  is the authority. There is no `price` field in the add-to-cart request: not ignored,
  absent. The studio displays what it is told and never computes a price a customer can pay.
- **Integer cents everywhere.** No float ever holds money. `Money::from_eur` parses
  "14,50" because a French admin types a comma and reading it as 14 under-prices by a
  third with nothing looking wrong.
- **Round once, at the end, and make everything agree**: line total, order total, invoice,
  Stripe charge. Assert it, do not eyeball it.
- **The seam between correct code and WooCommerce is where money is lost.** `Pricing::quote()`
  was correct the whole time a copied `did_action(...) > 1` guard was skipping every
  recalculation after the first, so a customer who changed the quantity on the cart page
  kept the old unit price. Pure tests could not see it. Anything touching the cart or the
  order gets a test against a real WooCommerce (`npm run test:wp`), not only a pure one.
- **Never copy a framework guard you cannot explain.** That one was in every tutorial.

---

## 3. Fail closed

- An unset secret denies everything. The inversion `if (!token) return null` must never
  appear.
- A design the Worker has not confirmed refuses the cart line. A network failure is not a
  pass: "we could not ask" is not "it exists".
- Artwork that cannot be measured is refused, not nested at its padded size.
- When a probe, a fetch or a parse fails, the safe answer is the conservative one, and the
  code must be able to tell "no" from "could not look". Conflating those two once deleted a
  customer's layer from both the transfer and the price.

---

## 4. Security

- `event.origin === expected`. **Never `startsWith`**, because a prefix test passes for
  `studio.teeshoop.com.evil.tld`. Never `postMessage(…, '*')`.
- The REST nonce never crosses an origin boundary. The parent page holds it and acts.
- WordPress only rejects a *bad* cookie nonce, never a missing one. Check explicitly.
- Purchase costs, film economics and supplier credentials must never reach a customer
  bundle. Two gates enforce it and both must stay green:
  `src/app/adminBoundary.test.ts` (source import graph, dynamic imports count as edges) and
  `scripts/bundle-guard.mjs` (string literals in built output, because minification renames
  symbols).
- Open routes (`POST /api/ar`, `POST /api/design`) are open because the customer cannot
  authenticate. They stay usable and non-abusable through magic-byte checks, size and count
  caps, and a payload that must parse as the thing it claims to be. Never through obscurity.
- Anything reachable by URL is public. `robots.txt` is not a permission. An unguessable URL
  is a capability and must be treated as one.

---

## 5. Verification

- **The verify scripts are the specification.** `scripts/*-verify.mjs` run the real bundle
  in a real browser. Run the ones that cover what you touched, before you claim anything.
- **Never edit repo files while a vite-dev harness is running.** It has cost a session
  before.
- A check that scans nothing must exit non-zero. "Nothing found" and "nothing looked" are
  different results.
- Prefer a test that runs the shipped code over one that re-implements it. Verifying a
  writer with its own reader proves only self-consistency; `scripts/dtf-verify.mjs` opens
  the ZIP with a hand-rolled reader for exactly this reason.
- Before committing anything that touches money, print geometry or customer data, run an
  adversarial pass over your own diff. Use the `redteam` skill. On this project that pass
  has a much better hit rate than the tests.

---

## 6. Writing

Applies to code comments, commit messages, documentation, UI copy and anything you say to
the user.

- **No em-dashes.** Use a comma, a colon, a full stop, or parentheses. This applies to
  every character you write, including code comments and commit messages. The existing
  corpus does **not** comply: roughly 2 300 of them were written into about 190 files before
  this rule existed. They are swept in one deliberate pass (session 13, item 8) rather than
  opportunistically, because a punctuation edit spread across every feature diff is how a
  real change becomes unreviewable. Do not sweep files you happen to be passing through.
- **No emoji** in code, UI, commits or documentation. Existing verify scripts print a
  status tick; leave those alone and add no more.
- **No exclamation marks in UI copy.** Nothing we sell is exciting enough.
- **No lorem, no placeholder, no TODO shipped.** If a number is provisional, label it in
  the interface where an operator can see it.
- Comments explain **why**, not what. The what is on the line below. A comment that
  restates the code is noise; a comment that records the reasoning, the measurement or the
  bug that forced the shape is the most valuable thing in the file.
- Commit messages explain the decision and the evidence, not the diff. They are read by
  someone trying to understand why the code is like this, eighteen months from now.
- Customer-facing copy is **French**, written the way a person writes, not the way a
  machine translates. If unsure of a term of art in the trade, ask rather than invent.
- Numbers in French prose use the comma: 14,50 EUR, 0,5 mm.

---

## 7. Interfaces

The product must not look like it was generated. These are banned outright.

- Gradient heroes, glassmorphism, everything centered, uniform `rounded-lg` on every
  element, drop shadows used as decoration.
- Emoji as icons, as bullets or as section markers.
- Animation that serves nothing: scroll-triggered fades on every block, hover effects that
  move layout, confetti, spinners where a skeleton belongs or the reverse.
- Badge and pill soup. Icons that carry no meaning. A dark-mode toggle nobody asked for.
- Copy in the register of "Transform your workflow", "Powered by AI", "✨ Effortless".
- Fabricated content: fake reviews, invented ratings, sample testimonials. In France fake
  reviews are also illegal.

What is required instead.

- **Real content, always.** If the data does not exist yet, build the empty state, do not
  fill it with plausible fiction.
- **A type scale that is actually used**, and a palette where semantic colour (good,
  warning, critical) is separate from the brand accent.
- **Every state designed**: loading, empty, error, partial, too-many. The error says what
  went wrong and what to do about it, with no apology and no vagueness.
- **A control says what will happen, and the confirmation says it happened.** "Ajouter au
  panier", then "Ajouté au panier". Not "Success!".
- **Keyboard and focus states from the start.** Retrofitting them is miserable and session
  12 will fail without them.
- **Mobile first**, checked at 375 px before anything else. Screenshots in the transcript.
- **Tabular figures wherever digits line up in a column.** Prices, quantities, dimensions.
- French e-commerce conventions: TTC for consumers and HT for business, both visible where
  both audiences read; delivery in working days; a physical address; **cm is the
  customer-facing unit** (`src/lib/units.ts`), never inches.

---

## 8. This codebase

- **The studio** (`src/`) is React + TypeScript, 2D Konva and 3D three.js, served by a
  Cloudflare Worker (`worker/`). It is now the ADMIN and standalone tool: since
  5 September 2026 the customer's customiser is `src/native/`, built into
  `wp-plugins/teeshoop-core/assets/editeur/` and served by WordPress itself, in the product
  page, with no iframe. `scripts/editeur-guard.mjs` is the gate on what it may carry.
- **The shop** is WordPress 7.0.3 + WooCommerce 11.0.1 on o2switch, plus our plugin
  `wp-plugins/teeshoop-core/`, which owns three things neither of them may: the price, the
  customiser in the product page (`includes/Editeur.php`), and the design hand-off. Its
  README is the contract.
- **A local mirror** of the exact production versions runs in docker: `npm run wp:up`,
  `npm run wp:cli`, `npm run test:wp`. **Docker and PHP are both available on this
  machine.** Before declaring WordPress work blocked on hosting access, check this: only
  deployment needs o2switch, not development.
- `src/lib/dtf/**` is admin-only and gated. `src/lib/ink.ts` is customer-safe and is the
  one measurement both the film cost and the customer price read.
- The associate's brief is vendored at `docs/bible/` so it is greppable. It was largely
  LLM-generated and he says to expect errors: one wrong formula has already been found and
  corrected in `Margin.php`, with both versions kept side by side in the test. **When you
  find another, correct it in code with a test that holds both, and add the question to
  `QUESTIONS-ASSOCIE.md`.** Do not silently follow a formula you believe is wrong, and do
  not silently override one you believe is right.
- The plan is `docs/ROADMAP.md`; the executable sessions are in `prompts/` (untracked).

---

## 9. Skills

Ten project skills in `.claude/skills/` carry the detail this file only states. Load the one
that matches before you start, not after you are stuck.

| Skill | Reach for it when |
|---|---|
| `verify` | Before claiming anything is done. Knows which of the harnesses cover what you touched. |
| `redteam` | Before committing anything touching money, print geometry, the cart, payment, customer data or an open route. |
| `security` | Adding a route, handling untrusted input, touching auth, storing customer data, adding a dependency. |
| `money` | Any price, quote, total, VAT, discount, invoice, refund, supplier cost or commission. |
| `woocommerce` | Any Woo hook, order or product meta, template override, custom status, or Woo behaving surprisingly. |
| `wp-local` | Anything in the plugin, or anyone claiming WordPress work is blocked on hosting access. |
| `perf` | Before optimising, when adding a dependency or a plugin, when a speed claim needs a number. |
| `ui-bar` | Any page, template, modal, email or user-facing string. |
| `france` | Customer-facing terms, personal data, consent, invoicing, delivery promises. |
| `observability` | Anything whose silent failure costs money or stalls an order. Monitoring, backups, runbooks. |

## 10. Working

- Commit in reviewable increments, with a message that explains the decision. Push. Confirm
  CI. A session that ends with uncommitted work has not ended.
- Decide the routine judgement calls yourself and state the assumption. Ask only when two
  readings lead to materially different work, or when the answer is the user's or the
  associate's to give (business rules, prices, legal facts, money leaving the business).
- Questions only the associate can answer go in `QUESTIONS-ASSOCIE.md`, in French.
- Access and credentials the user must provide go in `ACCES-REQUIS.md`.
- Report outcomes faithfully. If tests fail, say so with the output. If a step was skipped,
  say that. When something is done and verified, say it plainly without hedging.
