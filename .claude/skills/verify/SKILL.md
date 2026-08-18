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

`npm run ci` is `typecheck && typecheck:worker && test && test:php`. If PHP is missing the
last step fails loudly, which is correct: the plugin's rules are not optional.

`verify:bundle` scans **built output** for string literals that must not be in a customer
chunk. It needs a fresh `dist/`, so build first. It has a canary self-test and exits 2 if
it scanned nothing, because "no markers found" and "no files found" are different results.

## By what you touched

| Touched | Also run |
|---|---|
| `src/lib/dtf/**`, `src/lib/ink.ts`, `src/lib/renderDesign.ts`, `src/dev/dtfHarness.tsx` | `node scripts/dtf-verify.mjs` (five suites: shelf packer, per-visual split, ink trim, true-shape packer, ZIP export). `node scripts/dtf-bench.mjs` if you changed packing or geometry. |
| `wp-plugins/teeshoop-core/**` | `npm run test:php` and `npm run test:wp` (needs `npm run wp:up`). See the `wp-local` skill. |
| Anything imported by `src/main.tsx`, or `src/app/adminSlots.tsx` | `npx vitest run src/app/adminBoundary.test.ts` plus the bundle guard. Dynamic imports count as edges. |
| `worker/**` | `npx vitest run worker/` and, for route changes, a live `wrangler dev` run with curl. |
| `src/three/**`, garment rendering | `scripts/3d-shots.mjs`, `scripts/fabric-verify.mjs`, `scripts/worn-qa.mjs`, `scripts/backreg-verify.mjs` as applicable. Look at the images. |
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
