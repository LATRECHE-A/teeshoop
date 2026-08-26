---
name: verify
description: Run the right verification gates for what was changed in the Teeshoop repo, in the right order, and report honestly. Use before claiming any work is done, before committing anything that touches pricing, DTF geometry, the WordPress plugin, the Worker or the bundle boundary, and whenever asked to check that the project is green.
---

# Verify

This project has more gates than a fresh session will guess, and several of them exist
because the obvious check missed a real bug. Run the ones that cover what you touched.
Claiming "done" without them is the failure this skill exists to prevent.

## Always

```bash
npm run ci          # typecheck app + worker, vitest, then the pure PHP suite
npm run build       # tsc + vite; also prints the chunk sizes
npm run verify:bundle
```

`npm run ci` is nine steps: `typecheck && typecheck:worker && test && test:php &&
verify:php && verify:garments && verify:palette && verify:hypotheses && verify:couleurs`.
If PHP is missing the fourth fails loudly, which is correct: the plugin's rules are not
optional. This line said four steps for five sessions, which is how a reader comes to
believe the guards run when they do not.

**`npm run ci` green is NOT `CI green`, in both directions.** `.github/workflows/ci.yml`
enumerates its own steps rather than calling this one. It additionally runs `build:only`,
`verify:bundle` and the hypotheses `--self-test`; it used to skip `verify:palette` and
`verify:couleurs`, which session 12 added to it. Check both before saying a session is done.

**And five gates are in neither.** They need the running mirror, so they cannot go on
push, and between them they hold the whole of the shop's compliance and appearance:

```bash
npm run wp:up            # once
npm run test:wp          # the plugin against a real WooCommerce
npm run verify:seo       # what a crawler is served, over HTTP
npm run verify:consent   # what a real BROWSER writes to a visitor's machine
npm run verify:a11y      # WCAG 2.2 AA over the buying path and the legal pages
npm run verify:site      # the screenshots, and the placeholder scan
```

`verify:consent` exists because `verify:seo` cannot see the failure class it was built to
catch: it reads `Set-Cookie` headers, and a cookie written by `document.cookie` has none.
That blindness let WooCommerce write seven cookies before any choice, for four sessions,
under 459 green ticks.

`verify:bundle` scans **built output** for string literals that must not be in a customer
chunk. It needs a fresh `dist/`, so build first. It has a canary self-test and exits 2 if
it scanned nothing, because "no markers found" and "no files found" are different results.

## By what you touched

| Touched | Also run |
|---|---|
| `src/lib/dtf/**`, `src/lib/ink.ts`, `src/lib/renderDesign.ts`, `src/dev/dtfHarness.tsx` | `node scripts/dtf-verify.mjs` (five suites: shelf packer, per-visual split, ink trim, true-shape packer, ZIP export). `node scripts/dtf-bench.mjs` if you changed packing or geometry. |
| `wp-plugins/teeshoop-core/**` | `npm run test:php` and `npm run test:wp` (needs `npm run wp:up`). See the `wp-local` skill. A NEW file in `includes/` must load in a bare PHP process with only `ABSPATH` and `TEESHOOP_TEST` defined, or `verify:hypotheses` exits 2 without naming it; guard it `defined( 'ABSPATH' ) \|\| defined( 'TEESHOOP_TEST' ) \|\| exit;` like its neighbours. A new file in `tests/` must carry the `PHP_SAPI` 404 guard, because that directory answers HTTP. |
| `wp-themes/teeshoop/**`, any customer-facing page, template, string or CSS | `npm run verify:site` (257 assertions and 39 screenshots, **look at them**), `npm run verify:seo`, `npm run verify:a11y`. None of the three is in any CI job. A colour change means `npm run verify:palette`; a page added means a row in `scripts/seo-verify.mjs` PAGES, `scripts/site-shots.mjs` PAGES and `scripts/a11y-verify.mjs` PAGES, or the page is checked by nothing. |
| `Consent.php`, anything that could write to a visitor's machine, any script enqueued on the front end | `npm run verify:consent`. Cookies, localStorage, sessionStorage AND IndexedDB, in a real browser, before and after a choice. Do not reason about this: a tracker that writes from JavaScript is invisible to every HTTP-level check. |
| `Legal.php`, `Terms.php`, `Privacy.php`, `LegalPage.php`, `Host.php`, `Pages.php`, `data/cgv/**` | `npm run test:php` (the terms agree with the code), `npm run test:wp` (the erasure reaches every store), `npm run verify:a11y` and `npm run verify:seo` (the four pages are in both lists). A published CGV version is **never edited**: publish a new dated file. |
| `Waiver.php`, the checkout, `Checkout.php` | `npm run test:wp` AND `npm run verify:wp-e2e`. The mirror runs the BLOCK checkout, so the classic path's integration cases do not exercise what customers meet; the e2e harness is the only thing that drives the real one. It had been red and unrun for two sessions. |
| Anything imported by `src/main.tsx`, or `src/app/adminSlots.tsx` | `npx vitest run src/app/adminBoundary.test.ts` plus the bundle guard. Dynamic imports count as edges. |
| `worker/**` | `npx vitest run worker/` and, for route changes, a live `wrangler dev` run with curl. |
| `src/three/**`, garment rendering | **`npm run verify:render` first**: it is the only check here that looks at a rendered frame, and every defect session 10 found was living where the geometry suites do not look (a camera framing a placeholder, no shadow pixel in any render, a black tee darker than the page behind it). ONE of its assertions is known red (`tee-black-night` separates from its backdrop by 7,66 levels where 8 are asked) and the header says why, so read the run rather than the exit code. It used to be two: the other was the determinism gate, and that one was the scene-picker GPU leak, now fixed and guarded by `npm run verify:leak`. Then `scripts/fabric-verify.mjs`, `scripts/parity-verify.mjs`, `scripts/grading-verify.mjs`, `scripts/board-verify.mjs`, `scripts/inflate-verify.mjs`, `scripts/ar-verify.mjs`, `scripts/backreg-verify.mjs` as applicable, and `scripts/3d-shots.mjs` + `scripts/stage-shots.mjs` + `scripts/worn-qa.mjs` for the proof sheets. Look at the images: `npm run verify:mockups` renders the product-page set and is the one that catches a change you cannot see in a number. |
| The stage rig, the scene rigs, any material or light (`src/three/Stage.tsx`, `src/scenes/**`, `src/three/calibration.ts`) | The above, and **look at the hoodie**. Its fleece has no UV set and no procedural drape to break up a specular lobe, so a sheen calibrated on the tee's jersey turns it to wet latex, which passes every numeric gate in `render-verify` (a glossy garment has a WIDER luminance range, not a narrower one). Board mode reads the same scene config and is a customer-facing view: `scripts/board-verify.mjs`. |
| Catalogue import, the importer, the supplier client, the shop taxonomy | `npm run verify:wp-catalogue` (needs `npm run wp:up`) |
| Catalogue or supplier code | `scripts/catalog-verify.mjs`, `scripts/fr-verify.mjs`. |
| Checkout, cart, order | `npm run test:wp`, then a real order through the local WordPress. |
| The cost engine, the floor price, commissions (`Cost.php`, `Margin.php`, `Commission.php`, `PriceRule.php`, `Costing.php`, `Nest.php`, `CostAdmin.php`) | `npm run test:php` and `npm run test:wp`. The integration half reconciles the report against the ISSUED invoice, not against a recomputation. |
| `POST /api/nest`, `src/lib/dtf/nesting.ts`, `Cost::prudent_length_cm`, `src/lib/ink.ts`'s piece rectangles | `npm run verify:nest`. Boots a real `wrangler dev` and a real `php`; needs `ADMIN_TOKEN` in `.dev.vars`. It proves the gate, that the route's answer IS `nestRoll`'s, and that PHP's fallback bound is above the real packing. Out of CI for the usual reason: it spawns a server. |

## Rules while verifying

**Never edit repo files while a vite-dev harness is running.** The browser harnesses
(`dtf-verify`, `dtf-bench`, `catalog-verify`, the shot scripts) spawn vite. Editing under
them produces results that describe neither the old code nor the new. It has cost a session
before.

**Playwright Chromium is installed** at `~/.cache/ms-playwright`. The browser harnesses run
here. There is no excuse for reasoning about a render instead of producing one.

**A green run of the wrong suite is not evidence.** If you changed piece geometry and only
ran the unit tests, say that in the report.

## Reporting

State what you ran, what passed, and what you did not run and why. If something failed,
paste the output. Never soften a failure into "mostly passing".

If you added a new gate, prove it is not vacuous: break the thing it guards once, show it
firing, then unbreak it. A check that cannot fail is worse than no check, because it reads
as coverage.
