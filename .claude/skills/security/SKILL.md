---
name: security
description: The threat model and review method for Teeshoop, covering the postMessage bridge, the open upload routes, R2 capability URLs, the admin gate, WordPress and WooCommerce hardening, secrets and dependencies. Use when adding a route or an endpoint, handling untrusted input, touching authentication or authorisation, storing customer data, adding a dependency, or when asked to audit or harden anything.
---

# Security

`redteam` reviews a diff for consequences. This is the domain knowledge that pass draws on:
what an attacker wants here, what surfaces we expose, and what has already been found.

## Who actually attacks a small apparel shop

Not a targeted adversary. Automated and opportunistic, in roughly this order of likelihood:

- **Card testing.** A stolen card list is validated against any checkout that accepts small
  amounts. It costs us fees, chargebacks and our payment processor's patience.
- **Free file hosting.** Our upload routes are open by necessity. An unguarded one becomes
  someone's CDN for content we do not want to be serving.
- **Price and catalogue scraping.** A competitor wants our grid and, far worse, our purchase
  costs. That is the asset we most need to keep.
- **Credential stuffing** against customer accounts, and against wp-login.
- **Supply chain.** Every WordPress plugin is code we did not write, running as us, on
  shared hosting.
- **Form spam** into quote requests and contact forms.

## Our surfaces, and the rule for each

**The in-page editor** (`wp-plugins/teeshoop-core/includes/Editeur.php`, built from
`src/native/` into `assets/editeur/`). It replaced the postMessage bridge on 5 September
2026. THE POSTMESSAGE BRIDGE NO LONGER EXISTS: `Shortcode.php` and `assets/bridge.js` are
deleted, and with them the origin comparison, the `event.source` check and the whole
message table. If you find a `window.addEventListener('message'` in this repository, it is
not ours and it is a finding.

What replaced it, and the rule for each part:

- **The REST nonce** is on the page and stays there. It reaches exactly one call,
  `POST /wp-json/teeshoop/v1/cart`, as an `X-WP-Nonce` header. It is never sent to the
  Worker: the design upload carries the document, the rasters and the preview, and no
  credential of any kind. WordPress only rejects a *bad* cookie nonce, never a missing one,
  so `Rest::check_nonce` requires it explicitly. A `permission_callback` of
  `__return_true` on a route that writes is a bug, not a shortcut.
- **Everything the page hands the bundle** crosses a trust boundary and is re-read once, in
  `src/native/contexte.ts`, which is the only reader of `window.TEESHOOP_EDITEUR`. Colour
  swatches must match `/^#[0-9a-fA-F]{6}$/` before they reach a CSS custom property; a
  photo URL must be http(s) or a path that cannot start an origin (`/\` normalises to
  `//`); ids are held to `sanitize_key`'s alphabet. `src/native/` contains no `innerHTML`,
  and `src/native/dom.ts` deliberately ships no helper that would write one.
- **The artwork upload is now cross-origin**, shop page to Worker, and `worker/cors.ts` is
  what lets the page read the answer. Exact string equality against `SHOP_ORIGINS`, never
  `startsWith` (a prefix test passes for `teeshoop.com.evil.tld`), never `*`, no
  credentials, `vary: Origin` on the refusals too, and only on the two design routes:
  `/api/nest` is the film economics and `/api/fr/*` is our purchase cost, and neither has
  any business being readable from a page.

**WHAT THE FRAME USED TO BUY, AND NO LONGER DOES.** The iframe isolated the customer's
artwork from every other script on the shop page. It does not any more: the theme, any
WooCommerce plugin and any tag on that page can read the design and the same-origin
storage. Those scripts already shared the nonce's origin, so this does not widen an
attacker's reach; it widens a supply-chain incident's blast radius, and it is the price of
the change. Weigh a new plugin on a product page accordingly.

**Open routes** (`POST /api/ar`, `POST /api/design`). Open because the customer is the
author and cannot authenticate. They stay safe through magic-byte checks rather than the
client's declared content type, per-file and per-request size caps, a file count cap, and a
payload that must parse as the thing it claims to be before anything is written. Never
through obscurity. They also cost us R2 writes, so rate limiting is a cost control as much
as a security one.

**R2 read paths.** An unguessable URL is a capability. Treat it as one: 143 bits of entropy
on a design id is why the preview may be served on the id alone, and it is also why the
design document and the source rasters are behind `requireAdmin` and `private, no-store`.
The customer's original artwork is not ours to expose.

**The admin gate** (`worker/auth.ts`). One secret, two encodings: Bearer for `fetch`, Basic
for browser navigations, because a bearer challenge shows no login box and `/admin.html` is
a plain navigation. `ADMIN_TOKEN` unset denies everything; the inversion
`if (!token) return null` must never appear. `crypto.subtle.timingSafeEqual` throws on a
length mismatch, so both sides are SHA-256'd first.

**The bundle boundary.** Purchase costs and film economics must not reach a customer bundle.
Two gates, both required: `src/app/adminBoundary.test.ts` walks the source import graph
(dynamic imports count as edges, because a lazy chunk still ships and is still fetchable),
and `scripts/bundle-guard.mjs` scans built output for string literals, because minification
renames symbols and grep is unusable on chunks containing NUL bytes.

## The hole that was already found here

`caches.default` keys, including `price:{style}` which is our purchase cost, were minted on
our own origin as `/__fr-cache/…`. A raw `GET /__fr-cache/price%3A18001` returned **200**:
`run_worker_first` did not list that path, so the asset layer answered before the Worker's
404. Fixed at the source by minting keys on `CACHE_ORIGIN`, a host we never serve, plus a
404 and a route entry as defence in depth.

The lesson generalises: **a cache key that looks like a URL on an origin you serve is a
URL on an origin you serve.**

## WordPress and WooCommerce hardening

- Check **capabilities**, never roles. `current_user_can('manage_woocommerce')`, not a role
  string comparison.
- Nonces are CSRF protection, not authorisation. You need both.
- Escape on output, at the point of output: `esc_html`, `esc_attr`, `esc_url`, `wp_kses`.
  Sanitise on input. Never build SQL without `$wpdb->prepare`.
- `is_admin()` means "an admin screen is rendering", not "the user is an administrator".
  This mistake is in a great deal of published plugin code.
- Disable the file editor, XML-RPC and application passwords. `ACCES-REQUIS.md` already
  asks that application passwords stay off.
- Every plugin is attack surface. Justify each one, pin it, and know its update path.

## Payments

Keep card data out of our scope entirely: hosted fields or a redirect, so we stay in the
lightest PCI bracket and never touch a PAN. Verify webhook signatures. An order must not be
marked paid by anything except a verified webhook or a server-side confirmation, never by a
browser returning to a success URL.

## Secrets

`wrangler secret put` for the Worker, `wp-config.php` or the host's environment for
WordPress, `.dev.vars` locally and it is gitignored. Never in the repository, never in a
chat window, never in a screenshot. Anything that has been shared in clear is burned and
must be rotated. Tell the user the exact command; do not ask them to paste a value.

## How to review

For each surface, answer four questions in writing: **who can reach it**, **with what
input**, **what happens if they lie**, and **what it costs us if they succeed**. A finding
without a concrete chain from input to consequence is not a finding. Say what you tried and
what held, including the attempts that failed, because that is the part that tells the next
reviewer where you already looked.
