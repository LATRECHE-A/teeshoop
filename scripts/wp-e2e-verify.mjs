#!/usr/bin/env node
/**
 * The whole loop, once, for real: studio to WooCommerce cart line.
 *
 *   npm run wp:up          then   npm run verify:wp-e2e
 *
 * It boots the REAL pieces and drives them the way a customer would:
 *
 *   1. builds the studio (so what is tested is the shipped bundle, minified,
 *      with the shop origin allow-list baked in as it will be in production),
 *   2. serves it from `wrangler dev`, which is also the Worker that stores the
 *      design, so `POST /api/design` and the studio are one origin,
 *   3. points the local WordPress at both and gives it a product page carrying
 *      `[teeshoop_studio]`,
 *   4. opens that page in Chromium, uploads a raster with transparent margins
 *      through the studio's own file input, adds it to the design, sets a size
 *      grid of 25 and clicks "Ajouter au panier",
 *   5. then asks the database what happened.
 *
 * WHAT IT ASSERTS, and why each one is here rather than in a unit test:
 *
 *   THE LINE EXISTS, in the visitor's own stored WooCommerce session, read out
 *   of `wp_woocommerce_sessions` by the cookie the browser is holding. Not in a
 *   cart WP-CLI made for itself.
 *
 *   THE DESIGN ID VERIFIES. `GET /api/design/{id}` returns a manifest whose
 *   sides are the cart line's sides. An order line pointing at artwork nobody
 *   can open is the failure the whole hand-off exists to prevent, and it is
 *   discovered after the customer has paid.
 *
 *   THE PRICE IS `Pricing::quote()`'s, to the cent, for those sides and that
 *   quantity, in three places that must agree: what the studio DISPLAYED, what
 *   WooCommerce stored on the line, and what the cart subtotal says. The
 *   product's own catalogue price is 99,99 EUR precisely so a leak is loud.
 *
 *   THE AREAS CAME FROM THE DESIGN, not from the add-to-cart request
 *   (`sides_source`). That is what makes the invoice and the film the same
 *   measurement.
 *
 *   A FABRICATED ID IS REFUSED, with the Worker really answering 404 and
 *   `TEESHOOP_ALLOW_UNVERIFIED_DESIGNS` really undefined, which is the
 *   production configuration and cannot be exercised anywhere else.
 *
 *   THE PRIVATE HALF STAYS PRIVATE. The preview is readable with the id; the
 *   design document is not.
 *
 * It follows the shape of scripts/dtf-verify.mjs (spawn the real thing, assert
 * in Node, exit non-zero and loudly) and the plain PASS/FAIL of
 * scripts/e2e-verify.mjs rather than that file's ticks, because CLAUDE.md says
 * to add no more of them.
 *
 * Env:
 *   WP_E2E_OUT_DIR=/abs/dir    write screenshots there
 *   WP_E2E_SKIP_BUILD=1        reuse dist/ (only if it was built by this script)
 */
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import { chromium } from 'playwright'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const WORKER_PORT = 8788
/** What the BROWSER loads, and therefore what bridge.js compares origins against. */
const STUDIO_ORIGIN = `http://localhost:${WORKER_PORT}`
/**
 * What PHP calls. Different string, same server: WordPress is in a container
 * and `localhost` there is the container. `host.docker.internal` is provided by
 * `extra_hosts` in wp-local/docker-compose.yml, and step 0 refuses to continue
 * without it rather than letting every design fail verification for the one
 * reason that is not a bug.
 */
const WORKER_FROM_DOCKER = `http://host.docker.internal:${WORKER_PORT}`
const SHOP = 'http://localhost:8080'
const SHOP_ORIGIN = SHOP
const COMPOSE = ['compose', '-f', 'wp-local/docker-compose.yml']
const OUT = process.env.WP_E2E_OUT_DIR
/** Crossed on purpose: 25 is a quantity break, so the discount path is exercised. */
const ORDER_QTY = 25

const results = []
const ok = (name, pass, extra = '') => {
  results.push({ name, pass, extra })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`)
  return pass
}

let browser
let worker
function done(code) {
  try { browser?.close() } catch {}
  try { worker?.kill('SIGTERM') } catch {}
  process.exit(code)
}
const bail = (message) => {
  console.error(`\nFATAL  ${message}\n`)
  done(1)
}

// ---------------------------------------------------------------------------
// A raster with transparent margins, written here so nothing is downloaded
// ---------------------------------------------------------------------------
// It has to be a real PNG (the Worker decides format by the bytes) and it has
// to be MOSTLY EMPTY, because that is what a customer's logo actually looks
// like and it is what `sideArtworkSqCm` exists to stop charging for.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (buf) => {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function paddedLogoPng(size = 512, inkFrac = 0.3) {
  const rgba = Buffer.alloc(size * size * 4)
  const lo = Math.round((size * (1 - inkFrac)) / 2)
  const hi = size - lo
  for (let y = lo; y < hi; y++)
    for (let x = lo; x < hi; x++) {
      const i = (y * size + x) * 4
      rgba[i] = 0xd1
      rgba[i + 1] = 0x1f
      rgba[i + 2] = 0x4e
      rgba[i + 3] = 0xff
    }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const stride = size * 4 + 1
  const raw = Buffer.alloc(stride * size)
  for (let y = 0; y < size; y++) rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4)
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------------------------------------------------------------------------
// Talking to the container
// ---------------------------------------------------------------------------

function docker(args, opts = {}) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })
}

/** The last line of stdout that parses as JSON. wp-cli and compose both chat. */
function lastJson(text) {
  for (const line of text.trim().split('\n').reverse()) {
    const t = line.trim()
    if (!t.startsWith('{')) continue
    try {
      return JSON.parse(t)
    } catch {
      /* keep looking */
    }
  }
  return null
}

function support(...args) {
  const out = docker([
    ...COMPOSE,
    'run', '--rm', '-T', 'wpcli',
    'eval-file', 'wp-content/plugins/teeshoop-core/tests/e2e-support.php',
    ...args,
  ])
  const json = lastJson(out)
  if (!json) bail(`e2e-support.php ${args[0]} printed no JSON:\n${out}`)
  return json
}

const waitFor = (url, ms = 60000) =>
  new Promise((res, rej) => {
    const start = Date.now()
    const tick = async () => {
      try {
        await fetch(url)
        return res()
      } catch {
        /* not up yet */
      }
      if (Date.now() - start > ms) return rej(new Error(`${url} never answered`))
      setTimeout(tick, 400)
    }
    tick()
  })

/** Poll a locator until its text stops changing, so a stale quote is never read. */
async function settledText(locator, timeoutMs = 20000) {
  const start = Date.now()
  let last = null
  for (;;) {
    const now = await locator.textContent().catch(() => null)
    if (now && now.trim() && now === last) return now.trim()
    last = now
    if (Date.now() - start > timeoutMs) return (now ?? '').trim()
    await new Promise((r) => setTimeout(r, 300))
  }
}

const eur = (n) => (Math.round(n * 100) / 100).toFixed(2)

// ---------------------------------------------------------------------------

try {
  // --- 0. the local shop -------------------------------------------------
  console.log('booting wp-local ...')
  try {
    docker([...COMPOSE, 'up', '-d'], { stdio: ['ignore', 'pipe', 'inherit'] })
  } catch (e) {
    bail(`docker compose up failed. Is docker running?\n${e.message}`)
  }
  await waitFor(SHOP, 90000).catch(() => bail(`${SHOP} never answered. Try: npm run wp:up`))

  // --- 1. the studio, built as it ships ----------------------------------
  if (process.env.WP_E2E_SKIP_BUILD === '1') {
    console.log('reusing dist/ (WP_E2E_SKIP_BUILD=1)')
  } else {
    console.log(`building the studio with the shop origin ${SHOP_ORIGIN} allowed ...`)
    try {
      execFileSync('npm', ['run', 'build'], {
        stdio: ['ignore', 'ignore', 'inherit'],
        env: { ...process.env, VITE_TEESHOOP_SHOP_ORIGINS: SHOP_ORIGIN },
      })
    } catch {
      bail('npm run build failed')
    }
  }

  // --- 2. the Worker: the studio's origin AND the design store ------------
  console.log(`starting wrangler dev on ${STUDIO_ORIGIN} ...`)
  worker = spawn(
    'npx',
    ['wrangler', 'dev', '--ip', '0.0.0.0', '--port', String(WORKER_PORT), '--log-level', 'warn'],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  )
  await waitFor(`${STUDIO_ORIGIN}/api/design/aaaaaaaaaaaaaaaa`, 90000).catch(() =>
    bail('wrangler dev never answered. Is port 8788 already taken?'),
  )

  // The plugin verifies designs from INSIDE the container, so the container has
  // to be able to reach the Worker. Checked before a browser is started,
  // because the symptom otherwise is a refused cart line that looks like a bug
  // in the code being tested.
  const reach = docker([
    ...COMPOSE, 'exec', '-T', 'wp', 'php', '-r',
    `$c=stream_context_create(['http'=>['ignore_errors'=>true,'timeout'=>5]]);` +
      `echo @file_get_contents('${WORKER_FROM_DOCKER}/api/design/aaaaaaaaaaaaaaaa',false,$c)===false?'NO':'YES';`,
  ]).trim()
  if (!reach.endsWith('YES'))
    bail(
      `WordPress cannot reach the Worker at ${WORKER_FROM_DOCKER}.\n` +
        'wp-local/docker-compose.yml maps host.docker.internal for this; run\n' +
        '  npm run wp:up\n' +
        'to recreate the container with it.',
    )
  ok('wordpress can reach the worker', true, WORKER_FROM_DOCKER)

  // --- 3. the product page ------------------------------------------------
  const fixture = support('setup', STUDIO_ORIGIN, WORKER_FROM_DOCKER)
  if (fixture.need_classic)
    bail(
      'the mirror is on a block theme, whose product template strips the studio\n' +
        'iframe through wp_kses_post. teeshoop.com runs Woodmart, a classic theme,\n' +
        'so the mirror should be on one too. Install the nearest bundled equivalent:\n' +
        '  npm run wp:cli theme install twentytwentyone --activate',
    )
  if (!fixture.product_id) bail(`setup produced no product: ${JSON.stringify(fixture)}`)
  if (fixture.theme_switched) console.log(`switched the mirror to ${fixture.theme} (classic, like production)`)
  ok('product declares its garment', fixture.garment === 'tee', `product ${fixture.product_id}`)
  ok(
    'designs are verified for real (production configuration)',
    fixture.unverified_ok === false,
    'TEESHOOP_ALLOW_UNVERIFIED_DESIGNS is not defined',
  )
  /*
   * PRETTY PERMALINKS, LIKE PRODUCTION, and this is an assertion rather than a
   * setting because the difference is load-bearing.
   *
   * WooCommerce decides whether to build a cart by looking for the REST prefix
   * in REQUEST_URI. With the PLAIN structure a fresh WordPress ships with,
   * `/index.php?rest_route=/teeshoop/v1/cart` does not contain `wp-json`, so
   * Woo treats the add-to-cart call as a frontend request and loads a cart. On
   * pretty permalinks it does not, and every add answered 503. This suite
   * verified the whole buy flow green against the one configuration where the
   * bug is invisible. teeshoop.com runs pretty permalinks.
   */
  ok(
    'the shop uses pretty permalinks, like production',
    typeof fixture.permalinks === 'string' && fixture.permalinks !== '',
    fixture.permalinks === '' ? 'plain: run `npm run wp:cli teeshoop provisionner`' : fixture.permalinks,
  )

  console.log(`product page: ${fixture.url}`)

  // --- 4. the customer ----------------------------------------------------
  browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(`[page] ${e.message.slice(0, 200)}`))
  page.on('frameattached', () => {})
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console] ${m.text().slice(0, 200)}`)
  })

  // Measured from the header the browser actually sent: Playwright reports
  // requestBodySize 0 for a multipart upload, which would have made a slow
  // design look free.
  let upload = null
  // The REST answer behind the studio's message. The customer-facing copy says
  // only that nothing was charged, which is right for a customer and useless
  // for a harness: a failed run cost a debugging cycle to learn the code.
  const cartReplies = []
  page.on('response', async (res) => {
    if (!res.url().includes('teeshoop/v1/cart')) return
    const body = await res.text().catch(() => '')
    cartReplies.push(`HTTP ${res.status()} ${body.slice(0, 300)}`)
  })

  page.on('requestfinished', (req) => {
    if (req.method() !== 'POST' || !req.url().endsWith('/api/design')) return
    const timing = req.timing()
    req
      .headerValue('content-length')
      .then((len) => {
        upload = {
          bytes: Number(len) || 0,
          ms: Math.round(timing.responseEnd - timing.requestStart),
        }
      })
      .catch(() => {})
  })

  if (OUT) mkdirSync(OUT, { recursive: true })
  const shot = (n) =>
    OUT ? page.screenshot({ path: `${OUT}/${n}.png`, timeout: 15000 }).catch(() => {}) : Promise.resolve()

  await page.goto(fixture.url, { waitUntil: 'domcontentloaded', timeout: 45000 })
  const frameEl = page.locator('iframe.teeshoop-studio__frame')
  ok('the product page carries exactly one studio', (await frameEl.count()) === 1)
  await frameEl.scrollIntoViewIfNeeded()
  const studio = page.frameLocator('iframe.teeshoop-studio__frame')

  await studio.locator('canvas').first().waitFor({ timeout: 90000 })
  await page.waitForTimeout(2500)

  // The handshake succeeded if and only if the studio is offering the SHOP's
  // route to buying rather than its standalone quote-by-email flow.
  const order = studio.getByRole('button', { name: 'Commander' })
  await order.waitFor({ timeout: 20000 }).catch(() => {})
  if (!ok('the studio handshook with the shop', await order.isVisible().catch(() => false)))
    bail('the studio never connected to the shop, so nothing below can be tested')
  await shot('wp-e2e-1-product-page')

  // A customer's own artwork, mostly transparent margin. It exercises the
  // raster upload, the magic-byte gate and the ink measurement at once.
  await studio.getByRole('button', { name: 'Imports' }).click()
  // `[multiple]` picks the Imports panel's input; EditorCanvas has a
  // single-file one of its own for drops onto the stage.
  await studio
    .locator('input[type=file][multiple]')
    .setInputFiles({ name: 'logo-client.png', mimeType: 'image/png', buffer: paddedLogoPng() })
  const thumb = studio.locator('button.checkerboard').first()
  await thumb.waitFor({ timeout: 20000 })
  await thumb.click()
  // Close the panel again. The frame is a column inside the theme's layout, so
  // it is under the studio's `md` breakpoint even on a 1440 px page: the tool
  // panel opens as a sheet with a full-frame scrim, and the scrim swallows every
  // other click. Worth knowing: framed, the studio is nearly always in its
  // mobile layout, whatever the visitor's screen says.
  await studio.getByRole('button', { name: 'Imports' }).click()
  await page.waitForTimeout(1200)
  const frameBox = await frameEl.boundingBox()
  console.log(`studio frame: ${Math.round(frameBox?.width ?? 0)} x ${Math.round(frameBox?.height ?? 0)} px`)
  await shot('wp-e2e-2-artwork-placed')

  await order.click()
  const price = studio.locator('[data-teeshoop="price"]')
  await price.waitFor({ timeout: 30000 })

  const qtyField = studio.getByLabel(`Quantité en M`)
  await qtyField.fill(String(ORDER_QTY))
  const shownTtc = await settledText(studio.locator('[data-teeshoop="total-ttc"]'))
  const shownHt = await settledText(studio.locator('[data-teeshoop="total-ht"]'))
  ok('the studio shows a price it was given', shownTtc.length > 0, `${shownTtc} TTC`)
  await shot('wp-e2e-3-cart-modal')

  const addButton = studio.locator('[data-teeshoop="add-to-cart"]')
  await addButton.waitFor({ state: 'visible', timeout: 20000 })
  // Reported before clicking, because "the click timed out" is not a diagnosis:
  // a disabled button, a button under the mobile scrim and a button pushed out
  // of the frame all look the same from the outside.
  const buyState = await addButton.evaluate((el) => ({
    disabled: el.hasAttribute('disabled'),
    label: (el.textContent ?? '').trim(),
    top: Math.round(el.getBoundingClientRect().top),
    frameH: window.innerHeight,
  }))
  if (!ok('the add button is offered', !buyState.disabled, JSON.stringify(buyState))) {
    await shot('wp-e2e-x-disabled')
    bail(`the buy button is disabled: ${JSON.stringify(buyState)}`)
  }
  // Put the FRAME at the top of the window first. The studio's modals are
  // `position: fixed` inside the frame, so once the frame has grown toward the
  // window height its lower part sits below the fold until the page itself
  // scrolls. A visitor does that without thinking; Playwright's
  // scrollIntoViewIfNeeded only scrolls the nearest container, so it reported
  // "element is outside of the viewport" for a button a person can plainly see.
  const startedAt = Date.now()
  await frameEl.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await addButton.scrollIntoViewIfNeeded()
  await addButton.click({ timeout: 20000 })
  const outcome = await Promise.race([
    studio.locator('[data-teeshoop="cart-done"]').waitFor({ timeout: 120000 }).then(() => 'done'),
    studio.locator('[data-teeshoop="cart-error"]').waitFor({ timeout: 120000 }).then(() => 'error'),
  ]).catch(() => 'timeout')
  if (outcome !== 'done') {
    const why = await studio.locator('[data-teeshoop="cart-error"]').textContent().catch(() => '')
    await shot('wp-e2e-x-failed')
    bail(
      `add to cart ${outcome}: ${why || 'no message'}` +
        (cartReplies.length ? `\n  shop answered: ${cartReplies.join(' | ')}` : '\n  the shop was never asked'),
    )
  }
  ok('the studio reports the line was added', true, `${Math.round((Date.now() - startedAt) / 100) / 10} s`)
  await shot('wp-e2e-4-added')

  if (upload)
    console.log(
      `design upload: ${(upload.bytes / 1024).toFixed(0)} KiB of request body in ${upload.ms} ms`,
    )
  else console.log('design upload: not observed (served from the idempotency cache?)')

  // --- 5. what the database actually holds --------------------------------
  const cookies = await context.cookies()
  const sessionCookie = cookies.find((c) => c.name.startsWith('wp_woocommerce_session_'))
  if (!sessionCookie) bail('the browser holds no WooCommerce session cookie')
  // Split on ONE pipe, not two. WooCommerce's own docs say the cookie is
  // `id||expiry||expiring||hash`, and the cookie this shop actually set has
  // single separators. Everything before the first pipe is the id either way.
  const customerId = decodeURIComponent(sessionCookie.value).split('|')[0]

  const cart = support('cart', customerId)
  if (!cart.found) bail(`no stored session for ${customerId}: ${cart.reason}`)
  if (!ok('one personalised line in the visitor’s own cart', cart.lines.length === 1, `${cart.lines.length} line(s)`))
    bail('nothing to assert against')

  const line = cart.lines[0]
  ok('the line carries a well-formed design id', /^[A-Za-z0-9_-]{16,64}$/.test(line.design_id), line.design_id)
  ok('the line is the product’s garment', line.garment === fixture.garment, line.garment)
  ok('the size grid set the quantity', line.qty === ORDER_QTY, `qty ${line.qty}`)
  ok('the design was verified against the worker', line.verified === true)
  ok(
    'the printed areas came from the stored design, not the request',
    line.sides_source === 'design',
    line.sides_source,
  )
  ok(
    'the artwork was measured by its ink, not its box',
    line.sides.length > 0 && line.sides.every((s) => s.area_sq_cm > 0),
    line.sides.map((s) => `${s.id} ${Math.round(s.area_sq_cm)} cm²`).join(' + '),
  )

  // THE PRICE, in the three places that must agree.
  ok(
    'WooCommerce stored Pricing::quote()’s number',
    line.stored.line_subtotal !== null &&
      eur(line.stored.line_subtotal) === eur(line.expected.total_eur),
    `${eur(line.stored.line_subtotal)} vs ${eur(line.expected.total_eur)}`,
  )
  ok(
    'the cart subtotal agrees with it',
    cart.cart_totals.subtotal !== null &&
      eur(cart.cart_totals.subtotal) === eur(line.expected.total_eur),
    `${eur(cart.cart_totals.subtotal)}`,
  )
  ok(
    'the studio displayed that same number',
    shownTtc === line.expected.display.total_ttc && shownHt.includes(line.expected.display.total_ht),
    `shown ${shownTtc} / server ${line.expected.display.total_ttc}`,
  )
  /*
   * VAT, from both engines, compared.
   *
   * The studio prints "TVA 20 % incluse" over `Pricing`'s own `total_ttc`, and
   * WooCommerce charges what its tax tables say. Nothing reconciled the two:
   * the mirror shipped with taxes enabled and no rates, so the panel said
   * 326,10 EUR and the cart charged 271,75 EUR, 54,35 EUR apart, under a
   * caption the invoice would have contradicted.
   */
  ok(
    'WooCommerce charges the VAT the studio promised',
    cart.cart_totals.total !== null &&
      eur(cart.cart_totals.total) === eur(line.expected.total_ttc / 100),
    `charged ${eur(cart.cart_totals.total)} vs quoted ${eur(line.expected.total_ttc / 100)}`,
  )
  ok(
    'the catalogue price never reached the line',
    eur(line.stored.line_subtotal) !== eur(fixture.catalogue_price * line.qty),
    `catalogue would have been ${eur(fixture.catalogue_price * line.qty)}`,
  )

  // --- 6. the design really is on the server ------------------------------
  const manifestRes = await fetch(`${STUDIO_ORIGIN}/api/design/${line.design_id}`)
  ok('GET /api/design/{id} finds it', manifestRes.status === 200, `HTTP ${manifestRes.status}`)
  const manifest = manifestRes.status === 200 ? await manifestRes.json() : {}
  ok(
    'the manifest’s sides are the line’s sides',
    JSON.stringify(manifest.sides ?? []) === JSON.stringify(line.sides),
    JSON.stringify(manifest.sides ?? []),
  )
  ok(
    'the customer’s raster went up with it',
    Array.isArray(manifest.assets) && manifest.assets.length === 1,
    `${manifest.assets?.length ?? 0} asset(s)`,
  )
  const previewRes = await fetch(`${STUDIO_ORIGIN}/r2/design/${line.design_id}/preview.png`)
  ok(
    'the preview is readable with the id alone',
    previewRes.status === 200 && (previewRes.headers.get('content-type') ?? '').includes('image/png'),
    `HTTP ${previewRes.status}`,
  )
  const docRes = await fetch(`${STUDIO_ORIGIN}/r2/design/${line.design_id}/design.json`)
  ok('the design document is NOT', docRes.status !== 200, `HTTP ${docRes.status}`)

  // --- 6a. a design that prints nothing is refused before it can be priced --
  // The open upload route with the `sides` key removed. That document verified,
  // and `Cart::add` then priced the line as an unprinted blank: a tee run of 50
  // fell from 926,50 EUR to 308,50 EUR HT and a `custom` garment came to zero,
  // while the stored artwork was still there for the workshop to press.
  {
    const form = new FormData()
    const noSides = {
      v: 1,
      id: 'crafted',
      garmentId: 'tee',
      colorId: 'black',
      layers: [{ id: 'a', type: 'text', side: 'front', text: 'GRATUIT' }],
    }
    form.append('design', new Blob([JSON.stringify(noSides)]), 'design.json')
    form.append('preview', new Blob([paddedLogoPng(8, 1)], { type: 'image/png' }), 'preview.png')
    const res = await fetch(`${STUDIO_ORIGIN}/api/design`, { method: 'POST', body: form })
    ok('a design with no printed side is refused', res.status === 422, `HTTP ${res.status}`)
  }

  // --- 6b. the plugin's own test suite is not a public URL -----------------
  // `wp-content/plugins/` is served by URL. Before the CLI guards,
  // GET …/teeshoop-core/tests/run.php answered 200 and ran the whole suite to
  // the internet, naming the floor-price and commission rules and printing the
  // figures of any assertion that failed. bundle-guard.mjs makes the same
  // promise about the JavaScript; nothing was making it about the PHP.
  //
  // The list is READ FROM DISK, not typed here. It used to be five names, so a
  // sixth test file was covered by nothing and nobody would have noticed: the
  // suite would have gone on reporting five green ticks about five files while
  // the new one answered 200. A check that scans a hard-coded list scans
  // whatever it was told about last year.
  const testFiles = readdirSync(join(ROOT, 'wp-plugins/teeshoop-core/tests')).filter((f) =>
    f.endsWith('.php'),
  )
  ok('there are plugin test files to check at all', testFiles.length > 0, `${testFiles.length} found`)
  for (const file of testFiles) {
    const url = `${SHOP}/wp-content/plugins/teeshoop-core/tests/${file}`
    const res = await fetch(url)
    const body = await res.text()
    ok(
      `tests/${file} is not served over HTTP`,
      res.status !== 200 && body.length === 0,
      `HTTP ${res.status}, ${body.length} bytes`,
    )
  }

  // --- 7. an id the worker has never seen ---------------------------------
  const fabricated = 'ZZZZfabricatedZZZZ123456'
  const refusal = support('refuse', String(fixture.product_id), fabricated)
  ok('a fabricated design id is refused', refusal.refused === true, refusal.code)
  ok('and the cart is untouched', refusal.cart_count === 0)
  ok(
    'the refusal is the Worker’s 404, not a missing configuration',
    refusal.code === 'teeshoop_design_design_not_found',
    refusal.code,
  )

  // --- 8. and the customer can see it -------------------------------------
  await page.goto(fixture.cart_url, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForTimeout(3000)
  const cartHtml = await page.content()
  ok('the cart page names the design', cartHtml.includes(line.design_id))
  // A personalised line has no catalogue price, so nothing may be struck
  // through beside it. WooCommerce read the product's untouched regular price
  // as a sale and printed "99,99 EUR 15,37 EUR, Save 2 115,50 EUR" on a line
  // that was never on sale. In France an invented reference price is a
  // pratique commerciale trompeuse, not a rendering detail.
  const catalogueFr = fixture.catalogue_price.toFixed(2).replace('.', ',')
  ok(
    'the cart page invents no discount',
    !cartHtml.includes(catalogueFr) && !/<del[\s>]/.test(cartHtml),
    `catalogue price ${catalogueFr}`,
  )
  await shot('wp-e2e-5-cart-page')

  // --- 9. and then they pay for it ----------------------------------------
  /*
   * THE CHECKOUT FORM, FOR REAL, and not `WC_Checkout::create_order()` called
   * from WP-CLI. Three things only exist on this path: WooCommerce's own
   * validation, `Checkout::assert_total` on
   * `woocommerce_checkout_order_processed`, and the delivery rate the customer
   * is actually offered. A suite that builds its order in PHP exercises none of
   * them, and the seam between correct code and WooCommerce is where the money
   * goes.
   *
   * Virement, because it is the one core gateway that needs no keys and because
   * it behaves like a real French payment: the order lands `on-hold` and
   * becomes `processing` only when the shop confirms the funds. BACS never
   * calls `payment_complete()`, so this also proves the invoice is issued by the
   * status listener and not only by the one every tutorial hooks.
   */
  await page.goto(fixture.checkout_url, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForTimeout(2500)

  /*
   * WHICHEVER CHECKOUT THE SHOP HAS, and this mirror has the BLOCK one, which
   * is WooCommerce's default for new installs and the path where
   * `woocommerce_checkout_create_order` never fires at all. Testing only the
   * classic shortcode would have exercised the one branch this shop does not
   * use, and left the order-meta fallback that exists precisely for the block
   * unproven.
   */
  const isBlock = (await page.locator('.wc-block-checkout, [data-block-name="woocommerce/checkout"]').count()) > 0
  const isClassic = (await page.locator('form.checkout').count()) > 0
  ok('the checkout page renders a form we can fill', isBlock || isClassic, isBlock ? 'block' : isClassic ? 'classic' : 'neither')

  if (isBlock || isClassic) {
    const fill = async (selectors, value) => {
      for (const selector of [].concat(selectors)) {
        const field = page.locator(selector).first()
        if ((await field.count()) > 0) {
          await field.click({ timeout: 5000 }).catch(() => {})
          await field.fill(value, { timeout: 5000 }).catch(() => {})
          return true
        }
      }
      return false
    }

    // The block puts the SHIPPING address first and copies it to billing; the
    // classic form is billing-first. Both id shapes are tried.
    await fill(['#email', '#billing_email'], 'verification@example.invalid')
    await fill(['#shipping-first_name', '#billing-first_name', '#billing_first_name'], 'Camille')
    await fill(['#shipping-last_name', '#billing-last_name', '#billing_last_name'], 'Durand')
    await fill(['#shipping-company', '#billing-company', '#billing_company'], 'Association Sportive de Bobigny')
    await fill(['#shipping-address_1', '#billing-address_1', '#billing_address_1'], '12 avenue Jean Jaurès')
    await fill(['#shipping-postcode', '#billing-postcode', '#billing_postcode'], '93000')
    await fill(['#shipping-city', '#billing-city', '#billing_city'], 'Bobigny')
    await fill(['#shipping-phone', '#billing-phone', '#billing_phone'], '0100000000')

    const country = page.locator('#billing_country')
    if ((await country.count()) > 0) await country.selectOption('FR').catch(() => {})

    // The delivery total, as the customer reads it, before anything is paid.
    await page.waitForTimeout(4000)
    const shippingShown = await page
      .locator('.wc-block-components-totals-shipping, .woocommerce-shipping-totals')
      .first()
      .innerText()
      .catch(() => '')
    /*
     * Named, not priced. This run is 25 pieces, which is 384,25 EUR HT and past
     * the 300 EUR franco, so the customer is shown "livraison offerte" and no
     * amount: demanding a digit here asserted the opposite of what the shop is
     * supposed to do. What matters end to end is that OUR method is the one
     * offered and that the free delivery still records what it cost us, which
     * the order assertions below check. The charged branch is exercised by
     * tests/test-shipping.php and by the invoice probe, both at ten pieces.
     */
    ok(
      'the checkout offers our own Colissimo delivery',
      /Colissimo/i.test(shippingShown),
      shippingShown.replace(/\s+/g, ' ').slice(0, 90) || '(nothing rendered)',
    )

    for (const selector of [
      '#radio-control-wc-payment-method-options-bacs',
      '#payment_method_bacs',
    ]) {
      const radio = page.locator(selector)
      if ((await radio.count()) > 0) await radio.check({ timeout: 5000 }).catch(() => {})
    }
    const terms = page.locator('#terms')
    if ((await terms.count()) > 0) await terms.check().catch(() => {})

    await shot('wp-e2e-6-checkout')

    const placeOrder = page
      .locator('.wc-block-components-checkout-place-order-button, #place_order')
      .first()
    ok('there is a button to pay with', (await placeOrder.count()) > 0)
    await placeOrder.click({ timeout: 15000 }).catch(() => {})
    await page.waitForURL(/order-received|commande-recue/, { timeout: 60000 }).catch(() => {})
    await page.waitForTimeout(2500)
    await shot('wp-e2e-7-order-received')

    const received = page.url()
    const orderId = Number((received.match(/order-received\/(\d+)/) ?? [])[1] ?? 0)
    ok('the order was placed through the real checkout', orderId > 0, received.slice(0, 110))

    if (orderId > 0) {
      const placed = support('order', String(orderId))
      ok('it landed on hold, because a transfer has not arrived yet', placed.status === 'on-hold', placed.status)
      ok('no invoice yet, because nothing has been paid', placed.invoice.number === '', placed.invoice.number)
      ok(
        'the personalised line survived the checkout with its design',
        placed.lines.length === 1 && placed.lines[0].design_id === line.design_id,
        placed.lines[0]?.design_id,
      )
      ok(
        'the order carries a delivery line, and what it costs us',
        placed.shipping.length === 1 && placed.shipping[0].borne_ht > 0,
        JSON.stringify(placed.shipping[0] ?? {}),
      )
      ok(
        'the goods, the delivery and the tax add up to what the customer pays',
        Math.round((placed.totals.subtotal + placed.totals.shipping + placed.totals.tax) * 100) ===
          Math.round(placed.totals.total * 100),
        `${placed.totals.subtotal} + ${placed.totals.shipping} + ${placed.totals.tax} vs ${placed.totals.total}`,
      )
      ok(
        'and it remembers the rules it was taken under, not just the amounts',
        placed.frozen.regime !== '' && placed.frozen.rate !== '' && placed.frozen.basis === 'ht' && placed.frozen.config,
        JSON.stringify(placed.frozen),
      )

      /*
       * AND A GET MAY NOT NUMBER AN INVOICE. This route used to issue one when
       * there was none, so anyone holding the order key, which the customer has
       * in their order-received URL and in every e-mail, could spend a number
       * out of a legally continuous fiscal sequence on an order abandoned at
       * the payment step.
       */
      const early = await page.request.get(
        `${SHOP}/wp-admin/admin-post.php?action=teeshoop_facture&order_id=${orderId}&key=${placed.key ?? ''}`,
      )
      ok('an unpaid order refuses to hand out an invoice', early.status() !== 200, `HTTP ${early.status()}`)
      const stillNone = support('order', String(orderId))
      ok('and the request numbered nothing', stillNone.invoice.number === '', stillNone.invoice.number)

      // The shop confirms the transfer arrived.
      const paid = support('order', String(orderId), 'confirmer')
      ok('confirming the transfer moves it to processing', paid.status === 'processing', paid.status)
      ok('and THAT is what issues the invoice', /^\w+\d{4}-\d{4,}$/.test(paid.invoice.number), paid.invoice.number)
      ok(
        'the invoice total is the order total, to the cent',
        paid.invoice.total === Math.round(paid.totals.total * 100),
        `${paid.invoice.total} vs ${Math.round(paid.totals.total * 100)}`,
      )
      ok('and it renders as a real PDF', paid.invoice.pdf_size > 1200, `${paid.invoice.pdf_size} bytes`)

      // The customer can fetch it with the order key alone, logged out.
      const invoiceRes = await page.request.get(paid.invoice.url)
      const invoiceBody = await invoiceRes.body()
      ok(
        'the customer can download it with their own order key',
        invoiceRes.status() === 200 && invoiceBody.subarray(0, 5).toString() === '%PDF-',
        `HTTP ${invoiceRes.status()}, ${invoiceBody.length} bytes`,
      )
      // And nobody else can. The key is the capability; the id is not.
      const stolen = await page.request.get(paid.invoice.url.replace(/&key=[^&]+/, '&key=wc_order_deadbeef'))
      ok('and nobody else can, with the wrong key', stolen.status() !== 200, `HTTP ${stolen.status()}`)
    }
  }

  /*
   * WooCommerce's own block bundle logs React development warnings on the
   * checkout page, and they are not ours: they come out of
   * `assets/client/blocks/`. Ours would name a file of ours. Filtering by
   * origin rather than by message keeps this assertion able to fail: a warning
   * from our own code still trips it.
   */
  const ours = errors.filter((e) => !/assets\/client\/blocks\//.test(e))
  ok('no page errors of ours', ours.length === 0, ours.slice(0, 3).join(' | '))
} catch (e) {
  console.error('\nFATAL ', e?.stack || e?.message || e)
  results.push({ name: 'harness completed', pass: false, extra: String(e?.message || e) })
}

// ---------------------------------------------------------------------------

const failed = results.filter((r) => !r.pass)
console.log('')
if (results.length === 0) {
  // "Nothing found" and "nothing looked" are different results.
  console.error('wp-e2e: NO ASSERTIONS RAN. A pass here would mean nothing.')
  done(2)
}
if (failed.length) {
  console.error(`wp-e2e FAILED: ${failed.length} of ${results.length} assertions`)
  for (const f of failed) console.error(`  - ${f.name}${f.extra ? '  ' + f.extra : ''}`)
  done(1)
}
console.log(`wp-e2e PASS: ${results.length} assertions`)
if (process.env.WP_E2E_SKIP_BUILD !== '1')
  console.log(
    `note: dist/ now allows ${SHOP_ORIGIN} as a shop origin. Run npm run build before deploying.`,
  )
done(0)
