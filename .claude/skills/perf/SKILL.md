---
name: perf
description: Performance budgets, measurement method and the known costs of the Teeshoop stack (a customiser served in the product page by WordPress itself, a heavy 3D studio behind the admin gate, WooCommerce on shared hosting, a Cloudflare Worker with a subrequest budget). Use before optimising anything, when a page or a build feels slow, when adding a dependency or a plugin, and whenever a speed claim needs a number behind it.
---

# Performance

The rule that outranks every technique here: **measure before, measure after, same method
both times, and publish both numbers.** This project's history contains confident
performance claims that were wrong when measured.

## What already happened, so you do not undo it

**First paint was cut 58 %** by discovering that React, react-dom, scheduler and zustand
were all inside the chunk named `three`, pulled in by `@react-three/fiber`'s dependencies.
1.1 MB of WebGL was therefore eager on every first paint. Splitting them into their own
`react` chunk in `manualChunks` took first paint from 1 956 153 raw / 571 678 gzip to
780 801 / 237 249, and three.js now loads only when 3D opens. Verified in a real browser on
the production build, not inferred from the bundler's report.

The generalisation: **a chunk's name tells you what someone intended, not what is in it.**
Read the build output after any dependency change.

**The Cloudflare subrequest budget is 50 per request, and the Cache API counts toward it.**
A catalogue scan hit it and returned 502s that read exactly like bad credentials, which cost
a session of debugging the wrong thing. `worker/falkross.ts` solves it with block caching.
Any new loop that fetches per item needs this checked before it is written.

## Budgets

Set them per page type, hold to them, and fail loudly rather than drifting.

| | Target |
|---|---|
| Catalogue and product pages, mobile 4G | LCP under 2,5 s, INP under 200 ms, CLS under 0,1 |
| The customiser, interactive in the product page | under 3 s on a mid-range phone profile |
| Its first load, compressed | under 130 ko. Measured 114 385 o on 05/09/2026, against 246 473 for the framed studio. `npm run verify:editeur` prints it |
| 3D preview frame time | 16 ms on a mid-range phone, and it must degrade rather than stutter |
| Customer JS on a product page | the `three` chunk must not be in it |

## How to measure, specifically here

- **Throttled mobile profile**, not this machine. A workstation makes everything look fine.
- **Measure the customiser as part of the product page.** It is a plugin asset in that
  page since 5 September 2026, not a frame with its own document, so there is no longer a
  separate number to read: what the customer waits for IS the product page's LCP and INP.
  `npm run verify:editeur` gives the compressed weight of the first load and of what stays
  behind a click; `npm run bench:cwv` gives the page.
- **Real device class for 3D.** Frame time on a desktop GPU tells you nothing about the
  phone the customer is holding.
- Playwright Chromium is installed and the harnesses in `scripts/` already boot the real
  bundle. There is never a reason to reason about a render instead of producing one.
- The user's global `web-perf` skill drives Chrome DevTools for Core Web Vitals; use it for
  the metrics and this file for what they mean on this stack.

## WordPress on shared hosting

o2switch is shared hosting: no root, PHP limits, and real cron only if it was enabled.

- **Object cache** and **page cache**, with the exclusions right. Caching a personalised
  cart, a logged-in page or the checkout is how a shop shows one customer another customer's
  basket. Test the exclusions, do not assume the plugin got them right.
- **Autoloaded options** grow silently and are loaded on every single request. Check the
  size, and never store anything large as an autoloaded option.
- **`meta_query` on a large catalogue does not scale.** Several hundred variable products
  with dozens of variations each is enough to make a filtered archive page unusable. Use
  taxonomies for anything a customer filters on, and lookup tables for anything else.
- **A variable product with hundreds of variations breaks the admin screen before it breaks
  the front end.** Test both.
- Image sizes: generate what the templates use and no more, and serve modern formats.

## Do not let a plugin touch the studio

Performance plugins minify, defer, concatenate and inline. The customiser is an ES module
with content-hashed chunk names, deliberately code-split, and it must be excluded
explicitly. Two symptoms, both production-only: concatenating it into another file breaks
`import()` and the advanced view never opens, and appending a cache-busting query to the
entry makes the browser load the module TWICE, which mounts a second editor over the first.
That second one is not hypothetical, it is what WordPress's own `?ver=` did on 5 September
2026 before the hash moved into the filename.

## Reporting

Before and after, same method, in the transcript. Say what you did not measure. A percentage
without an absolute number is not a result: "23 % faster" means nothing next to "LCP 3,1 s
to 2,4 s on a throttled Moto G profile".
