---
name: wp-local
description: Work against the local WordPress 7.0.3 + WooCommerce mirror in the Teeshoop repo. Use for anything touching wp-plugins/teeshoop-core, the cart, orders, checkout, product templates or WP-CLI, and whenever someone believes WordPress work is blocked on hosting access.
---

# Local WordPress

**Docker and PHP are both available on this machine.** Before saying WordPress work is
blocked on o2switch, check that assumption: only *deployment* needs the host. Development
and verification run here, against the same versions as production.

`wp-local/docker-compose.yml` pins **WordPress 7.0.3** and **WooCommerce 11.0.1**, which is
what teeshoop.com runs. It bind-mounts `wp-plugins/teeshoop-core` into the container, so
editing the plugin in the repo edits the running site. Named volumes hold WordPress and the
database, so nothing lands in git.

```bash
npm run wp:up     # start (port 8080)
npm run wp:down   # stop
npm run wp:cli    # docker compose run --rm wpcli <args>
npm run test:php  # 46 pure cases, no bootstrap, under a second, runs in CI
npm run test:wp   # 9 cases against a real WooCommerce cart, does not run in CI
```

`WORDPRESS_CONFIG_EXTRA` sets `WP_DEBUG` on with `WP_DEBUG_DISPLAY` off, so notices land in
the log where they can be read rather than in the middle of a JSON response where they
corrupt it.

## Both suites exist for a reason

`tests/run.php` covers `Money`, `Pricing` and `Margin`, which call **no WordPress
function**. That is a design rule the runner enforces by construction: the day someone
reaches for `get_option()` inside `Pricing`, the runner stops working and says so.

`tests/integration.php` covers the seam. It exists because `recompute_prices()` once carried
the standard `did_action(...) > 1` guard, copied from every tutorial on
`woocommerce_before_calculate_totals`. That guard is for *relative* price edits; ours are
absolute, so it bought nothing and skipped every recalculation after the first. Quantities 9
through 50 all kept the qty-30 rate. `Pricing::quote()` was correct throughout. Pure tests
could not see it and never will.

## WP-CLI gotchas that have already cost time

`wp eval-file` **eval()s** the file. Two consequences, both of which produced silently wrong
results before:

- `declare(strict_types=1)` is a fatal error there ("must be the very first statement"). The
  integration suite deliberately omits it and says why in its header.
- Apparent file scope is **function** scope. `$pass = 0` at the top is a local, while
  `global $pass` binds the real global. The harness once printed nine green ticks under a
  "0 passed" total with `exit(1)` unreachable, so a genuine failure would have exited 0 and
  read as CI success. Counters go through `$GLOBALS[...]`, and running nothing at all exits 2.

Shell note: run `docker compose` from `wp-local/`, or pass `-f wp-local/docker-compose.yml`.
Running it from the repo root gives "no configuration file provided: not found".

## Talking to the Worker from inside the container

The container cannot reach `127.0.0.1` on the host. Start the Worker on all interfaces and
use the docker bridge:

```bash
npx wrangler dev --port 8791 --ip 0.0.0.0 --local
# then, in WordPress settings: worker_url = http://172.17.0.1:8791
```

Clear `worker_url` again when you are done, or the next `npm run test:wp` will point at a
dev server that is gone.

## Fail-closed opt-out

`TEESHOOP_ALLOW_UNVERIFIED_DESIGNS` in `wp-config.php` lets local work proceed without the
Worker. **Production must never define it.** If you turn it on to unblock yourself, turn it
off before you verify anything about design verification.
