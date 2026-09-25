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
 *      whose product declares a garment, which is what puts the editor in its
 *      add-to-cart slot,
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
import { NODE, WRANGLER } from './bin.mjs'

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

  // --- 1. the two bundles, built as they ship ----------------------------
  /*
   * L'ÉDITEUR EST TOUJOURS RECONSTRUIT, MÊME AVEC `WP_E2E_SKIP_BUILD`.
   *
   * `dist/` est lourd et le sauter fait gagner une minute ; le paquet de
   * l'éditeur se construit en une demi-seconde et il EST ce que la boutique
   * sert, parce que le greffon est monté dans le conteneur. Le sauter, ce
   * serait tester le paquet d'avant contre le code d'aujourd'hui, ce qui est
   * exactement la rouille que `scripts/editeur-guard.mjs` existe pour attraper.
   */
  console.log('building the in-page editor into the plugin ...')
  try {
    // npm est npm.cmd sous Windows ; execFileSync ne le lance pas sans shell,
    // et les arguments sont constants, donc le shell n'interprète rien.
    execFileSync('npm', ['run', 'build:editeur'], {
      stdio: ['ignore', 'ignore', 'inherit'],
      shell: process.platform === 'win32',
    })
  } catch {
    bail('npm run build:editeur failed')
  }

  if (process.env.WP_E2E_SKIP_BUILD === '1') {
    console.log('reusing dist/ (WP_E2E_SKIP_BUILD=1)')
  } else {
    console.log(`building the studio with the shop origin ${SHOP_ORIGIN} allowed ...`)
    try {
      // npm est npm.cmd sous Windows ; execFileSync ne le lance pas sans shell,
      // et les arguments sont constants, donc le shell n'interprète rien.
      execFileSync('npm', ['run', 'build'], {
        stdio: ['ignore', 'ignore', 'inherit'],
        env: { ...process.env, VITE_TEESHOOP_SHOP_ORIGINS: SHOP_ORIGIN },
        shell: process.platform === 'win32',
      })
    } catch {
      bail('npm run build failed')
    }
  }

  // --- 2. the Worker: the studio's origin AND the design store ------------
  console.log(`starting wrangler dev on ${STUDIO_ORIGIN} ...`)
  /*
   * ── `SHOP_ORIGINS` EST DONNÉ AU WORKER, PAS SEULEMENT AU PAQUET ─────────
   *
   * Ce harnais passait l'origine de la boutique à `npm run build`, ce qui règle
   * la liste blanche du STUDIO, et laissait le Worker prendre la sienne dans
   * `wrangler.jsonc`. Depuis que ce fichier y porte les origines de production,
   * le Worker répondait
   * `frame-ancestors https://teeshoop.com ...`, le navigateur refusait
   * d'encadrer `http://localhost:8788` depuis `http://localhost:8080`
   * (ERR_BLOCKED_BY_RESPONSE), le cadre restait vide, et le harnais mourait sur
   * « canvas jamais visible » après quatre-vingt-dix secondes, sans jamais dire
   * pourquoi. Mesuré le 5 septembre 2026, et il était rouge depuis le jour où
   * ces origines ont été écrites.
   *
   * Les deux réglages sont la même décision et doivent venir de la même
   * variable, sinon ils divergent une deuxième fois.
   */
  worker = spawn(
    NODE,
    [
      WRANGLER,
      'dev',
      '--ip',
      '0.0.0.0',
      '--port',
      String(WORKER_PORT),
      '--log-level',
      'warn',
      '--var',
      `SHOP_ORIGINS:${SHOP_ORIGIN}`,
    ],
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
        'and so is ours. Activate it, or the nearest bundled equivalent:\n' +
        '  npm run wp:cli theme activate teeshoop\n' +
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
  /*
   * THE BROWSER HAS TO RESOLVE THE WORKER TOO, now that the cart shows the
   * design's own proof image.
   *
   * The plugin reaches the Worker from INSIDE the container, at
   * host.docker.internal, and that name means nothing on the host where this
   * browser runs. On production the two are the same public address, so the
   * split is the mirror's, not the shop's. Mapping the name is what makes the
   * cart assertion measure the image LOADING rather than merely appearing in
   * the markup, and it keeps "no page errors of ours" a real check instead of
   * one with a hole cut in it.
   */
  browser = await chromium.launch({
    args: ['--host-resolver-rules=MAP host.docker.internal 127.0.0.1'],
  })
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
  /*
   * CE QUE L'ÉDITEUR A VRAIMENT ENVOYÉ AU PANIER, et pas ce qu'il croit avoir
   * envoyé. La matrice coloris x taille est la seule chose que `Cart::add` lise
   * pour savoir quoi acheter chez le fournisseur : une régression qui la
   * laisserait tomber donnerait un panier au bon prix, une facture juste, et un
   * bon de commande sans coloris. Rien plus haut dans la pile ne le verrait.
   */
  let cartRequest = null
  page.on('response', async (res) => {
    if (!res.url().includes('teeshoop/v1/cart')) return
    const body = await res.text().catch(() => '')
    cartReplies.push(`HTTP ${res.status()} ${body.slice(0, 300)}`)
    if (cartRequest === null) {
      try {
        cartRequest = JSON.parse(res.request().postData() ?? 'null')
      } catch {
        cartRequest = 'illisible'
      }
    }
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
  /*
   * ── L'ÉDITEUR EST DANS LA PAGE, PLUS DANS UN CADRE ──────────────────────
   *
   * Ce bloc pilotait un `frameLocator` : il ouvrait le panneau « Imports » du
   * studio, cliquait une vignette, refermait le panneau (parce que le studio
   * encadré est presque toujours dans sa disposition mobile, quelle que soit la
   * taille de l'écran), puis ouvrait « Commander ». Rien de tout ça n'existe
   * plus : la fiche produit porte l'éditeur, et il n'a ni panneau, ni cadre, ni
   * poignée de main à réussir avant de pouvoir vendre.
   *
   * Ce que le harnais vérifie N'A PAS BOUGÉ, et c'est le point : la ligne est
   * dans la session du visiteur, la création se vérifie contre le Worker, les
   * surfaces viennent du document stocké, le prix est celui de `Pricing::quote`
   * aux trois endroits qui doivent s'accorder, un identifiant fabriqué est
   * refusé, et la moitié privée reste privée.
   */
  ok('and no studio iframe at all', (await page.locator('iframe.teeshoop-studio__frame').count()) === 0)

  /*
   * ── L'ÉDITEUR A SA PAGE, ET LE HARNAIS SUIT LE MÊME LIEN QUE LE CLIENT ───
   *
   * Depuis le 9 septembre 2026 la fiche produit ne porte plus le
   * personnalisateur dans sa fente d'achat : elle porte un lien vers
   * `/personnaliser/{produit}/` (`includes/Atelier.php`, et la justification
   * est dans `templates/teeshoop/product-cta.php`). Le harnais CLIQUE ce lien
   * au lieu de connaître l'adresse : c'est le chemin du client, et un harnais
   * qui composerait l'URL lui-même passerait encore le jour où le lien
   * disparaît de la fiche, c'est-à-dire le jour où plus personne ne trouve
   * l'atelier.
   *
   * L'ÉDITEUR EN LIGNE RESTE UN CAS VALABLE et il n'est pas retiré :
   * `Editeur::rendre()` est toujours ce qui pose le point de montage, et un
   * produit que l'atelier ne peut pas servir n'a pas de lien. Le harnais prend
   * donc celui des deux qui est là.
   */
  const lienAtelier = page.locator('[data-teeshoop-atelier-link]')
  // Compté sur la FICHE, avant de la quitter : c'est là que la double question
  // pouvait exister, et l'assertion plus bas ne pourrait plus le voir après.
  const estimateursSurLaFiche = await page.locator('[data-teeshoop-estimator]').count()
  if ((await page.locator('[data-teeshoop-editeur]').count()) === 0) {
    if (!ok('the product page offers a way into the customiser', (await lienAtelier.count()) === 1))
      bail('the product page carries neither the editor nor a link to it')
    await lienAtelier.first().click()
    await page.waitForLoadState('domcontentloaded')
  }
  const editeur = page.locator('[data-teeshoop-editeur]')
  ok('exactly one editor is mounted where the customiser lives', (await editeur.count()) === 1)
  await editeur.scrollIntoViewIfNeeded()

  /*
   * LE BANDEAU DE CONSENTEMENT EST ÉCARTÉ AVANT TOUT CLIC.
   *
   * Il est en `position: fixed` au-dessus de la page et il avale le premier
   * clic sur la moitié basse de l'écran. Ce n'est pas une gêne de harnais : un
   * client le voit aussi, et le refus est un choix légitime que la suite doit
   * pouvoir traverser. « Tout refuser » plutôt que « Tout accepter », parce que
   * c'est le chemin où le moins de choses sont chargées.
   */
  for (const label of ['Tout refuser', 'Tout accepter']) {
    const bouton = page.getByRole('button', { name: label })
    if ((await bouton.count()) > 0) {
      await bouton.first().click({ timeout: 5000 }).catch(() => {})
      break
    }
  }
  await page.waitForTimeout(500)

  // Le canevas est le signe que l'éditeur a démarré : `Editeur::rendre()` pose
  // d'abord un message de secours, et le script ne le remplace que s'il est en
  // état de vendre.
  await page.locator('.tshop-ed canvas').first().waitFor({ timeout: 60000 }).catch(() => {})
  if (
    !ok(
      'the editor started, on this product, with no handshake',
      (await editeur.getAttribute('data-teeshoop-editeur-etat')) === 'pret',
      `état ${await editeur.getAttribute('data-teeshoop-editeur-etat')}` +
        (fixture.editeur_pret ? '' : ' (assets/editeur absent: npm run build:editeur)'),
    )
  )
    bail('the native editor never started, so nothing below can be tested')
  await shot('wp-e2e-1-product-page')

  /*
   * IL OUVRE SUR LE PRODUIT CLIQUÉ, ET SUR RIEN D'AUTRE.
   *
   * Le cadre restaurait le dernier brouillon du visiteur ou chargeait
   * `makeSampleDesign()`, un t-shirt noir portant « TSHOP » en arche. C'est
   * l'assertion que cette nuit existe pour rendre possible, et elle se lit sur
   * la création elle-même : le bon vêtement, et zéro calque.
   */
  const auDepart = await page.evaluate(() => window.teeshoopEditeur?.creationActuelle?.() ?? null)
  ok(
    'the editor opens on THIS product, with an empty design',
    auDepart !== null && auDepart.garmentId === fixture.garment && auDepart.layers.length === 0,
    JSON.stringify({ garment: auDepart?.garmentId, calques: auDepart?.layers?.length }),
  )

  // A customer's own artwork, mostly transparent margin. It exercises the
  // raster upload, the magic-byte gate and the ink measurement at once.
  await page.setInputFiles('.tshop-ed__fichier', {
    name: 'logo-client.png',
    mimeType: 'image/png',
    buffer: paddedLogoPng(),
  })
  await page.locator('[data-teeshoop="taille-visuel"]').waitFor({ timeout: 20000 })
  const boiteEditeur = await editeur.boundingBox()
  console.log(`editor: ${Math.round(boiteEditeur?.width ?? 0)} x ${Math.round(boiteEditeur?.height ?? 0)} px`)
  await shot('wp-e2e-2-artwork-placed')

  /*
   * ── LE GRADIENT SUIT-IL LA FICHE DU FABRICANT ? ─────────────────────────
   *
   * `Editeur::contexte()` publie la série du fabricant sur la page, et
   * `src/native/editeur.ts` la pose sur la création. Les deux bouts sont testés
   * séparément ; entre les deux il y a `wp_localize_script`, qui transforme
   * tout en chaîne de caractères, et c'est là que ça se casse en silence.
   *
   * Lu sur la création que l'éditeur tient vraiment, à travers l'accesseur
   * qu'il expose, et non dans une variable de débogage : c'est le même objet
   * que celui qui sera déposé.
   *
   * La fiche est celle du Gildan Heavy Cotton, la référence dont la série
   * s'écarte le plus de la charte du studio : 71,12 / 50,8 = 1,400 contre
   * 64 / 52 = 1,2308. Un éditeur qui graderait encore par sa propre charte ne
   * porterait tout simplement pas ce champ.
   */
  const published = await page.evaluate(() => window.TEESHOOP_EDITEUR?.sizeChart ?? null)
  ok(
    "the product page publishes the maker's series to the editor",
    published !== null && Object.keys(published).length >= 2,
    JSON.stringify(published),
  )
  const applied = await page.evaluate(
    () => window.teeshoopEditeur?.creationActuelle?.()?.shopSizeChart ?? null,
  )
  ok(
    "the editor grades by the maker's series, not by its own chart",
    Boolean(applied) &&
      applied.garmentId === fixture.garment &&
      Math.abs(Number(applied.halfChestCm?.['3XL']) - Number(fixture.size_chart?.['3XL'])) < 0.001,
    JSON.stringify(applied),
  )
  if (applied) {
    const k = Number(applied.halfChestCm['3XL']) / Number(applied.halfChestCm.M)
    console.log(`grading 3XL/M: ${k.toFixed(4)} from the maker, 1.2308 from the studio chart`)
    ok("and the factor is the maker's, measurably not the studio's", Math.abs(k - 1.4) < 0.001, k.toFixed(4))
  }

  /*
   * ── DEUX ÉTAPES, ET LA SECONDE EST FERMÉE TANT QU'IL N'Y A RIEN À VENDRE ──
   *
   * Le passage n'est pas décoratif : `src/native/editeur.ts` refuse l'étape 2
   * sans calque, et le contrôle DIT pourquoi au lieu de rester inerte. Les deux
   * moitiés comptent, donc l'état fermé est lu avant le dépôt du visuel, plus
   * haut, et ici on vérifie qu'il s'est ouvert.
   */
  const valider = page.locator('[data-teeshoop="valider-creation"]')
  ok(
    'the step that asks for quantities opens once artwork is placed',
    (await valider.count()) === 1 && !(await valider.isDisabled()),
  )
  await valider.click()
  await page.locator('.tshop-ed__grille').waitFor({ timeout: 20000 })

  /*
   * UNE SEULE QUESTION, POSÉE UNE SEULE FOIS.
   *
   * La boîte d'achat demandait la quantité, les tailles et le nombre de faces,
   * puis `CartModal` redemandait la même grille dans le cadre. Il n'y a plus
   * qu'une grille sur la page, et c'est celle de l'éditeur.
   */
  ok(
    'the size breakdown is asked for exactly once, on one screen',
    estimateursSurLaFiche === 0 &&
      (await page.locator('[data-teeshoop-estimator]').count()) === 0 &&
      (await page.locator('.tshop-ed__qte').count()) > 0,
    `${await page.locator('.tshop-ed__qte').count()} cases de quantité, ` +
      `${estimateursSurLaFiche} formulaire(s) d'estimation sur la fiche`,
  )

  /*
   * ET ELLE PORTE LE COLORIS EN PLUS DE LA TAILLE. Avant le 9 septembre 2026,
   * trois coloris demandaient trois lignes de panier, et `Pricing::qty_discount`
   * s'appliquant par ligne, le client payait plus cher POUR AVOIR CHOISI
   * PLUSIEURS COULEURS. La grille est ce qui supprime cela, donc sa deuxième
   * dimension est une assertion et pas un détail d'écran.
   */
  ok(
    'and the grid has a colour dimension, not only sizes',
    (await page.locator('.tshop-ed__grille tbody .tshop-ed__coloris').count()) >= 1,
    `${await page.locator('.tshop-ed__grille tbody tr').count()} ligne(s) de coloris`,
  )

  const qtyField = page.getByLabel('Quantité en M').first()
  await qtyField.fill(String(ORDER_QTY))
  await page.locator('[data-teeshoop="price"]').waitFor({ timeout: 30000 })
  const shownTtc = await settledText(page.locator('[data-teeshoop="total-ttc"]'))
  const shownHt = await settledText(page.locator('[data-teeshoop="total-ht"]'))
  ok('the editor shows a price it was given', shownTtc.length > 0, `${shownTtc}`)
  await shot('wp-e2e-3-price')

  const addButton = page.locator('[data-teeshoop="add-to-cart"]')
  await addButton.waitFor({ state: 'visible', timeout: 20000 })
  // Reported before clicking, because "the click timed out" is not a diagnosis:
  // a disabled button and a button under a fixed banner look the same outside.
  const buyState = await addButton.evaluate((el) => ({
    disabled: el.hasAttribute('disabled'),
    label: (el.textContent ?? '').trim(),
  }))
  if (!ok('the add button is offered', !buyState.disabled, JSON.stringify(buyState))) {
    await shot('wp-e2e-x-disabled')
    bail(`the buy button is disabled: ${JSON.stringify(buyState)}`)
  }
  const startedAt = Date.now()
  await addButton.scrollIntoViewIfNeeded()
  await addButton.click({ timeout: 20000 })
  const outcome = await Promise.race([
    page.locator('[data-teeshoop="cart-done"]').waitFor({ timeout: 120000 }).then(() => 'done'),
    page.locator('[data-teeshoop="cart-error"]').waitFor({ timeout: 120000 }).then(() => 'error'),
  ]).catch(() => 'timeout')
  if (outcome !== 'done') {
    const why = await page.locator('[data-teeshoop="cart-error"]').textContent().catch(() => '')
    await shot('wp-e2e-x-failed')
    bail(
      `add to cart ${outcome}: ${why || 'no message'}` +
        (cartReplies.length ? `\n  shop answered: ${cartReplies.join(' | ')}` : '\n  the shop was never asked'),
    )
  }
  ok('the editor reports the line was added', true, `${Math.round((Date.now() - startedAt) / 100) / 10} s`)
  await shot('wp-e2e-4-added')

  /*
   * LA MATRICE EST DANS LE CORPS, ET SA SOMME EST `size_grid`.
   *
   * `Cart::add` lit `matrix` en priorité et en déduit la grille par
   * `flatten_matrix` ; il ne retombe sur `size_grid` que si la matrice est vide.
   * Les deux voyagent donc ensemble et doivent totaliser la même chose : si
   * elles divergent, la quantité facturée vient de l'une et ce que l'atelier
   * presse vient de l'autre. C'est le genre d'écart qu'aucun test pur ne peut
   * voir, parce qu'il naît entre deux objets construits au même endroit.
   */
  const corps = cartRequest
  const matrice = corps && typeof corps === 'object' ? corps.matrix : null
  const sommeMatrice =
    matrice && typeof matrice === 'object'
      ? Object.values(matrice).reduce(
          (s, cases) => s + Object.values(cases ?? {}).reduce((t, n) => t + Number(n), 0),
          0,
        )
      : -1
  const sommeGrille =
    corps && typeof corps === 'object' && corps.size_grid
      ? Object.values(corps.size_grid).reduce((t, n) => t + Number(n), 0)
      : -2
  ok(
    'the request carries the colour x size matrix, and size_grid is its sum',
    sommeMatrice > 0 && sommeMatrice === sommeGrille && sommeMatrice === Number(corps.qty),
    JSON.stringify({ matrix: matrice, size_grid: corps?.size_grid, qty: corps?.qty }),
  )

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
    'the editor displayed that same number',
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
    'WooCommerce charges the VAT the editor promised',
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
  /*
   * AND SHOWS IT. The flattened proof has been on the line since this suite was
   * written and nothing read it back: the buyer saw the supplier's photograph of
   * a blank shirt in the cart, at the checkout, and in their account.
   *
   * The obvious filter is the wrong one on this shop. Both pages are BLOCKS, so
   * `templates/cart/cart.php` never runs and `woocommerce_cart_item_thumbnail`
   * is never applied; the lines come from the Store API, and the filter that
   * reaches them is `woocommerce_store_api_cart_item_images`. Asserting on the
   * rendered page rather than on the hook is what tells those two apart.
   */
  ok(
    'the cart page shows the customer their own design',
    cartHtml.includes(`/r2/design/${line.design_id}/preview.png`),
    `expected the proof for ${line.design_id} in the cart markup`,
  )
  // …and that it is an image and not a broken one. A src in the markup is a
  // claim; naturalWidth is the browser saying it decoded.
  const proofLoaded = await page.evaluate(
    (id) =>
      Array.from(document.images).some(
        (im) => im.src.includes(`/r2/design/${id}/preview.png`) && im.naturalWidth > 0,
      ),
    line.design_id,
  )
  ok('and the image really loads', proofLoaded)
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

    /*
     * THE WITHDRAWAL WAIVER, which is REQUIRED and which this harness had never
     * ticked.
     *
     * `Waiver` was added in session 06 and puts a required checkbox on both
     * checkouts: on personalised goods the customer acknowledges losing the
     * right of withdrawal BEFORE the order, because that right is lost at the
     * conclusion of the contract and not at the proof. The block checkout
     * refuses to submit without it and says so in French, in red, on the page.
     *
     * So this assertion has been FAILING SINCE SESSION 06 and everything after
     * it (the order status, the design surviving the checkout, the delivery
     * line, the totals adding up, the frozen VAT regime, the invoice) has been
     * skipped for four sessions, because they are all inside `if (orderId > 0)`.
     * Nobody read the tail. Found on 2026-08-19 by running it.
     *
     * Located by its LABEL rather than by an id: the block checkout generates
     * the id from the field key and the classic one does not, so a selector
     * would have to know which checkout it is on, and the sentence is the thing
     * a customer actually reads.
     */
    const waiver = page.getByLabel(/droit de rétractation/i)
    if ((await waiver.count()) > 0) await waiver.first().check({ timeout: 5000 }).catch(() => {})

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
       * THE RENONCIATION, WHICH THIS HARNESS HAS BEEN TICKING SINCE SESSION 06
       * AND NEVER ASSERTED ON.
       *
       * The mirror runs the BLOCK checkout, so `Waiver::freeze_block` is the
       * live half, and it was the untested one: the classic path had four
       * integration cases and this one had none. It is the shop's only defence
       * against a fourteen-day withdrawal on a printed garment, and a defence
       * whose only evidence is that somebody clicked a checkbox in a browser is
       * not one.
       *
       * The version matters as much as the date. It was recorded as the empty
       * string for four sessions because `Legal::cgv_version()` read an option
       * with no writer, so an order could say WHEN the customer accepted and
       * not WHICH terms they accepted.
       */
      const waiver = placed.renonciation ?? {}
      ok('the order really carries a personalised line to waive over', waiver.applies === true)
      ok('the renonciation was recorded at all', (waiver.at ?? '') !== '', waiver.at ?? 'rien')
      ok(
        'it holds the exact sentence the customer was shown, not a note that a box existed',
        waiver.text === waiver.expected_text,
        (waiver.text ?? '').slice(0, 60),
      )
      ok(
        'it names the version of the conditions in force, and that version is one we can produce',
        (waiver.cgv ?? '') !== '' && waiver.cgv === waiver.expected_cgv,
        `${waiver.cgv} vs ${waiver.expected_cgv}`,
      )
      ok(
        'and it was taken no later than the order it belongs to',
        Date.parse(waiver.at ?? '') <= Date.parse(waiver.created ?? '') + 2000,
        `${waiver.at} <= ${waiver.created}`,
      )
      /*
       * NAMED FOR WHAT IT TESTS. It said « it does not carry a forwarded
       * address » and only checked the field was non-empty, which is true of a
       * forwarded one too. What can be asserted from out here is that an address
       * was recorded at all; that it is REMOTE_ADDR and never a header is a
       * property of `Waiver::freeze` and is stated there.
       */
      ok('an address was recorded with it', (waiver.ip ?? '') !== '', waiver.ip ?? 'rien')

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
