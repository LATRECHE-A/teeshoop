#!/usr/bin/env node
/**
 * THE CATALOGUE IMPORT, AGAINST A REAL WORDPRESS.
 *
 *   npm run wp:up          then   npm run verify:wp-catalogue
 *
 * It runs the real importer against the real WooCommerce in wp-local, from the
 * real Worker, over the real supplier webservice, and then asks the database
 * and the HTTP surfaces what happened. Nothing here re-implements the mapping:
 * the expected numbers come from the SUPPLIER'S OWN payload, fetched
 * independently by this script, so a bug shared between the importer and its
 * test cannot make both agree.
 *
 * WHAT IT ASSERTS, and why each one earns its place:
 *
 *   THE COUNTS. One product per reference, and one variation per SKU the
 *   supplier actually sells. Built from the cross product of colours and sizes
 *   instead, style 15009 would gain 107 variations nobody can buy.
 *
 *   VARIATION INTEGRITY. Every variation carries our own SKU, both attribute
 *   terms really exist in the taxonomy, stock is managed, and the parent's
 *   attributes are marked `variation` for colour and size and not for the rest.
 *   A variation whose attribute term is missing is selectable by nobody and
 *   makes the whole product unpurchasable, silently.
 *
 *   NO COST LEAKAGE, through every door a purchase price can leave by: the
 *   rendered product page, the public Store API, the authenticated WooCommerce
 *   REST API for products AND for variations, the variation JSON the
 *   add-to-cart form hands the browser, and the product CSV export with custom
 *   meta switched on. The supplier's own article number is checked the same
 *   way: it is a searchable fingerprint of who we buy from.
 *
 *   THE LEAK CHECK CAN FAIL. Asserting "the number is not in the page" is
 *   worthless if the number was never stored, or if the checker is looking in
 *   the wrong place. So the run first proves the cost IS in the database, and
 *   then REMOVES the seal through a temporary mu-plugin and requires the same
 *   check to report a leak. A gate that has never fired is not a gate.
 *
 *   THE SECOND RUN IS A NO-OP, and means it: not merely "reported unchanged"
 *   but `post_modified` did not move on a single product or variation.
 *
 * Exit 0 all green, 1 a failure, 2 the harness could not run (which must never
 * read as success).
 */
import { execFileSync, spawn } from 'node:child_process'
import { writeFileSync, unlinkSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const COMPOSE = ['compose', '-f', 'wp-local/docker-compose.yml']
const WORKER_PORT = 8789
const WORKER_LOCAL = `http://127.0.0.1:${WORKER_PORT}`
const WORKER_FROM_DOCKER = `http://host.docker.internal:${WORKER_PORT}`
const SHOP = 'http://localhost:8080'

/**
 * How many references to import.
 *
 * The plan is the catalogue in ascending style order, so six references is 370
 * variations and includes both ends of the distribution: 00142 with 159 and
 * 01342 with 6. Enough to exercise a real product without making the gate a
 * twenty-minute job. Override with CATALOGUE_VERIFY_MAX.
 */
const MAX_REFS = Number(process.env.CATALOGUE_VERIFY_MAX ?? 6)

const results = []
const ok = (name, pass, extra = '') => {
  results.push({ name, pass, extra })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`)
  return pass
}

let worker
function done(code) {
  try { worker?.kill('SIGTERM') } catch {}
  process.exit(code)
}
const bail = (message) => {
  console.error(`\nFATAL  ${message}\n`)
  done(2)
}

const docker = (args, opts = {}) =>
  execFileSync('docker', [...COMPOSE, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  })

/** `wp …` in the mirror. Returns stdout; throws with stderr attached on failure. */
const wp = (args, opts = {}) => {
  try {
    return docker(['run', '--rm', '-T', 'wpcli', ...args], { stdio: ['ignore', 'pipe', 'pipe'], ...opts })
  } catch (err) {
    const detail = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim()
    err.message = `wp ${args.join(' ')}\n${detail}`
    throw err
  }
}

/**
 * Run PHP inside WordPress.
 *
 * Written to the shared volume rather than passed as `wp eval "…"`: these
 * snippets contain quotes, dollars and JSON, and shell-quoting them through
 * two layers of container is how a test starts asserting on a truncated string.
 */
let phpSeq = 0
function php(code) {
  const name = `ts-verify-${process.pid}-${++phpSeq}.php`
  const tmp = join(ROOT, 'wp-local', name)
  writeFileSync(tmp, `<?php\n${code}\n`)
  try {
    docker(['cp', tmp, `wp:/var/www/html/${name}`])
    return wp(['eval-file', `/var/www/html/${name}`]).trim()
  } finally {
    try { unlinkSync(tmp) } catch {}
    try { docker(['exec', '-T', 'wp', 'rm', '-f', `/var/www/html/${name}`]) } catch {}
  }
}

const phpJson = (code) => {
  const out = php(code)
  const at = out.indexOf('{')
  const start = at === -1 ? out.indexOf('[') : at
  if (start === -1) bail(`expected JSON from WordPress, got:\n${out}`)
  try {
    return JSON.parse(out.slice(start))
  } catch {
    bail(`unparsable JSON from WordPress:\n${out}`)
  }
}

/** The admin token, from .dev.vars, exactly as scripts/fr-verify.mjs reads it. */
function adminToken() {
  let text
  try {
    text = readFileSync(join(ROOT, '.dev.vars'), 'utf8')
  } catch {
    bail('.dev.vars is missing, so the Worker has no ADMIN_TOKEN and every catalogue call would 401.')
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*ADMIN_TOKEN\s*=\s*"?([^"#]*?)"?\s*$/.exec(line)
    if (m && m[1].length >= 24) return m[1]
  }
  bail('.dev.vars has no usable ADMIN_TOKEN (24 characters or more).')
}

/**
 * What the SUPPLIER says about one reference, fetched independently of the
 * plugin so a shared assumption cannot make both agree.
 *
 * Retried, and the reason is specific rather than defensive: the import that
 * runs just before this takes minutes, `wrangler dev` restarts itself whenever
 * it notices a file change, and a bare `fetch` that lands in that window fails
 * with the useless `TypeError: fetch failed`. It cost a run.
 */
async function supplierSays(ref, token) {
  let last = ''
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${WORKER_LOCAL}/api/fr/catalogue/${ref}`, {
        headers: { authorization: `Bearer ${token}` },
      })
      if (res.ok) return await res.json()
      last = `HTTP ${res.status}`
    } catch (err) {
      last = err?.cause?.code ?? err?.message ?? String(err)
    }
    await wait(2000)
  }
  bail(`the catalogue api never answered for ${ref} (${last}). Is another wrangler dev running on this machine?`)
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(url, timeoutMs, expect) {
  const until = Date.now() + timeoutMs
  for (;;) {
    try {
      const res = await fetch(url)
      if (expect(res)) return
    } catch {
      /* not up yet */
    }
    if (Date.now() > until) throw new Error(`timed out waiting for ${url}`)
    await wait(500)
  }
}

// ---------------------------------------------------------------------------

async function main() {
  const token = adminToken()

  // --- 0. the mirror ------------------------------------------------------
  try {
    docker(['ps', '--services', '--filter', 'status=running'], { stdio: ['ignore', 'pipe', 'pipe'] })
  } catch {
    bail('docker compose is not answering. Run `npm run wp:up`.')
  }
  const wpVersion = wp(['core', 'version']).trim().split('\n').pop()
  if (!/^\d/.test(wpVersion)) bail(`the mirror is not answering: ${wpVersion}`)

  // --- 1. the Worker ------------------------------------------------------
  console.log(`starting wrangler dev on ${WORKER_LOCAL} ...`)
  worker = spawn(
    'npx',
    ['wrangler', 'dev', '--ip', '0.0.0.0', '--port', String(WORKER_PORT), '--log-level', 'warn'],
    { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] },
  )
  await waitFor(`${WORKER_LOCAL}/api/fr/state`, 90000, (r) => r.status === 401 || r.status === 200).catch(
    () => bail(`wrangler dev never answered on ${WORKER_PORT}. Is the port taken?`),
  )
  ok('the worker refuses /api/fr without a token', (await fetch(`${WORKER_LOCAL}/api/fr/state`)).status === 401)

  // --- 2. point WordPress at it -------------------------------------------
  // Output is swallowed: `wp config set` echoes the value it wrote, and that
  // value is a secret. Failure still surfaces, as a thrown exception.
  try {
    wp(['config', 'set', 'TEESHOOP_CATALOGUE_TOKEN', token, '--type=constant'], { stdio: 'ignore' })
  } catch {
    bail('could not write TEESHOOP_CATALOGUE_TOKEN into the mirror wp-config.php.')
  }
  wp(['teeshoop', 'provisionner', `--worker=${WORKER_FROM_DOCKER}`], { stdio: 'ignore' })

  const reach = php(
    `$r = wp_remote_get( '${WORKER_FROM_DOCKER}/api/fr/state', array( 'timeout' => 10, 'headers' => array( 'authorization' => 'Bearer ' . TEESHOOP_CATALOGUE_TOKEN ) ) );
     echo is_wp_error( $r ) ? 'NO ' . $r->get_error_message() : 'HTTP ' . wp_remote_retrieve_response_code( $r );`,
  )
  if (!reach.includes('HTTP 200')) {
    bail(
      `WordPress cannot reach the Worker at ${WORKER_FROM_DOCKER} (${reach}).\n` +
        'wp-local/docker-compose.yml maps host.docker.internal for this; run `npm run wp:up`.',
    )
  }
  ok('wordpress reaches the catalogue api', true, WORKER_FROM_DOCKER)

  // --- 3. a clean slate ----------------------------------------------------
  wp(['teeshoop', 'catalogue', 'purger'], { stdio: 'ignore' })

  /*
   * ESTABLISH the shipped state; do not assume it.
   *
   * Step 10 asserts that a catalogue with no margin rate is browsable and not
   * purchasable — the state this repository ships. Step 11 then sets a rate to
   * exercise the priced path and clears it again at the end. A run interrupted
   * between those two leaves the rate behind, and the next run's step 10 fails
   * on state its own predecessor created. A gate whose result depends on how
   * the last one ended is a gate that will be believed when it is wrong.
   */
  php(
    `$c = get_option( 'teeshoop_pricing', array() );
     if ( is_array( $c ) && array_key_exists( 'blank_margin_rate', $c ) ) {
       unset( $c['blank_margin_rate'] );
       update_option( 'teeshoop_pricing', $c );
     }`,
  )

  // --- 4. the import -------------------------------------------------------
  console.log(`importing ${MAX_REFS} reference(s) ...`)
  const first = wp(['teeshoop', 'catalogue', 'importer', `--max=${MAX_REFS}`, '--recommencer'])
  const refs = [...first.matchAll(/^\s+\d+\/\d+\s+(\d{4,6})\s+(\w+)/gm)].map((m) => ({ ref: m[1], outcome: m[2] }))
  if (refs.length !== MAX_REFS) bail(`the importer reported ${refs.length} references, expected ${MAX_REFS}:\n${first}`)
  ok('every planned reference was created', refs.every((r) => r.outcome === 'created'), refs.map((r) => r.ref).join(' '))

  // --- 5. what the SUPPLIER says, fetched independently ---------------------
  const expected = new Map()
  for (const { ref } of refs) {
    const body = await supplierSays(ref, token)
    const colours = new Set(body.style.colourways.map((c) => c.code))
    // The same rule the importer follows, restated here on purpose: a SKU whose
    // colour is not in the colourway list cannot be offered.
    const sellable = body.style.skus.filter((s) => colours.has(s.colourCode))
    expected.set(ref, {
      skus: sellable.length,
      cross: body.style.colourways.length * body.style.sizes.length,
      costs: Object.fromEntries(
        sellable.map((s) => [s.sku, Math.round((body.prices?.prices?.[s.sku]?.cost ?? 0) * 100)]),
      ),
      brand: body.style.brand,
    })
  }

  // --- 6. counts and integrity ---------------------------------------------
  const shop = phpJson(
    `$out = array( 'products' => array(), 'attributes' => array() );
     foreach ( wc_get_attribute_taxonomies() as $t ) { $out['attributes'][] = $t->attribute_name; }
     $ids = get_posts( array( 'post_type' => 'product', 'post_status' => 'any', 'numberposts' => -1, 'fields' => 'ids', 'meta_key' => '_teeshoop_ref' ) );
     foreach ( $ids as $id ) {
       $p = wc_get_product( $id );
       $row = array(
         'ref' => (string) $p->get_meta( '_teeshoop_ref', true ),
         'type' => $p->get_type(),
         'status' => $p->get_status(),
         'sku' => $p->get_sku(),
         'name' => $p->get_name(),
         'image' => (int) $p->get_image_id(),
         'cats' => wp_get_object_terms( $id, 'product_cat', array( 'fields' => 'names' ) ),
         'variation_attrs' => array(), 'plain_attrs' => array(),
         'children' => 0, 'bad_terms' => 0, 'unmanaged' => 0, 'no_sku' => 0, 'costs' => array(), 'photos' => 0,
       );
       foreach ( $p->get_attributes() as $tax => $a ) { if ( $a->get_variation() ) { $row['variation_attrs'][] = $tax; } else { $row['plain_attrs'][] = $tax; } }
       foreach ( $p->get_children() as $cid ) {
         $v = wc_get_product( $cid );
         if ( ! $v ) { continue; }
         $row['children']++;
         if ( '' === $v->get_sku() ) { $row['no_sku']++; }
         if ( true !== $v->get_manage_stock() ) { $row['unmanaged']++; }
         if ( '' !== (string) $v->get_meta( '_teeshoop_colour_photo', true ) ) { $row['photos']++; }
         foreach ( array( 'pa_couleur', 'pa_taille' ) as $tax ) {
           $slug = $v->get_attribute( $tax );
           if ( '' === $slug || ! get_term_by( 'slug', $slug, $tax ) ) { $row['bad_terms']++; }
         }
         $supply = (string) $v->get_meta( '_teeshoop_supply_sku', true );
         $cents  = (string) $v->get_meta( '_teeshoop_supply_cents', true );
         if ( '' !== $supply ) { $row['costs'][ $supply ] = $cents; }
       }
       $out['products'][] = $row;
     }
     echo wp_json_encode( $out );`,
  )

  ok('one product per reference', shop.products.length === MAX_REFS, `${shop.products.length}`)
  for (const slug of ['couleur', 'taille', 'marque', 'matiere']) {
    ok(`global attribute ${slug} exists`, shop.attributes.includes(slug))
  }

  let totalVariations = 0
  let totalPhantom = 0
  for (const p of shop.products) {
    const want = expected.get(p.ref)
    if (!want) { ok(`unexpected product ${p.ref}`, false); continue }
    totalVariations += p.children
    totalPhantom += want.cross - want.skus
    ok(`${p.ref} is a published variable product`, p.type === 'variable' && p.status === 'publish', `${p.type}/${p.status}`)
    ok(`${p.ref} has one variation per sellable sku`, p.children === want.skus, `${p.children} of ${want.skus}`)
    ok(`${p.ref} varies on colour and size only`,
      p.variation_attrs.sort().join(',') === 'pa_couleur,pa_taille', p.variation_attrs.join(','))
    ok(`${p.ref} keeps its other attributes filterable`, p.plain_attrs.length > 0, p.plain_attrs.join(','))
    ok(`${p.ref} every variation resolves both terms`, p.bad_terms === 0, `${p.bad_terms} broken`)
    ok(`${p.ref} every variation has our own sku`, p.no_sku === 0)
    ok(`${p.ref} every variation manages stock`, p.unmanaged === 0, `${p.unmanaged} unmanaged`)
    ok(`${p.ref} is filed under a french category`, p.cats.length === 1 && p.cats[0].length > 0, p.cats.join(','))
    ok(`${p.ref} names its brand in the title`, p.name.startsWith(want.brand), p.name)
    ok(`${p.ref} carries a per-colour photo on its variations`, p.photos === p.children, `${p.photos}/${p.children}`)

    // The costs really are stored, and they really are the supplier's.
    const mismatched = Object.entries(want.costs).filter(
      ([sku, cents]) => cents > 0 && String(p.costs[sku] ?? '') !== String(cents),
    )
    ok(`${p.ref} stores the supplier price for every sku`, mismatched.length === 0,
      mismatched.length ? `${mismatched.length} wrong, e.g. ${mismatched[0][0]}` : `${Object.keys(p.costs).length} kept`)
  }
  console.log(
    `\n  ${totalVariations} variations across ${shop.products.length} products; ` +
      `${totalPhantom} colour/size combinations the supplier does not sell were not created\n`,
  )

  // --- 7. the cost must not leave ------------------------------------------
  const sample = shop.products.find((p) => Object.values(p.costs).some((c) => Number(c) > 0))
  if (!sample) bail('no imported variation carries a purchase price, so a leak test would pass by being empty.')
  const [sampleSupplySku, sampleCents] = Object.entries(sample.costs).find(([, c]) => Number(c) > 0)
  ok('a purchase price really is stored', Number(sampleCents) > 0, `${sample.ref}: ${sampleCents} cents`)

  /*
   * WHAT COUNTS AS A LEAK, and both obvious needles are wrong.
   *
   * The bare cents figure ("430") is three digits and occurs by chance in any
   * large document. So does the price written with a French decimal comma:
   * MEASURED on this shop's own REST output, "4,30" matched inside
   * `"variations":[3024,3025]`, because a JSON list of post ids is nothing but
   * digit-comma-digit. A check that fails on a clean shop gets marked flaky and
   * then gets deleted, which is worse than not having it.
   *
   * So two sets. The EXACT one, used everywhere: the two meta KEYS and the
   * supplier's nine-digit article number, none of which can occur by accident.
   * And for surfaces a human reads, the price formatted the way this shop's own
   * `Money::format()` formats money — a narrow no-break space and a euro sign —
   * which is what a template that printed our cost would actually emit, and
   * which no id list can produce.
   */
  const money = php(`echo \\Teeshoop\\Core\\Money::format( ${Number(sampleCents)} );`).trim()
  const needles = ['_teeshoop_supply_cents', '_teeshoop_supply_sku', sampleSupplySku]
  const rendered = [...needles, money]
  const sniff = (haystack, set = needles) => set.filter((n) => haystack.includes(n))

  const permalink = php(`echo get_permalink( ${JSON.stringify(sample.ref)} ? wc_get_product_id_by_sku( '${sample.ref}' ) : 0 );`)
  const pageHtml = await (await fetch(permalink)).text()
  ok('the rendered product page carries no purchase price', sniff(pageHtml, rendered).length === 0,
    sniff(pageHtml, rendered).join(' ') || `${pageHtml.length} bytes`)

  const storeApi = await (await fetch(`${SHOP}/wp-json/wc/store/v1/products?per_page=20`)).text()
  ok('the public store api carries no purchase price', sniff(storeApi, rendered).length === 0,
    sniff(storeApi, rendered).join(' ') || `${storeApi.length} bytes`)

  const restCheck = () =>
    php(
      `wp_set_current_user( 1 );
       $out = '';
       foreach ( array( '/wc/v3/products', '/wc/v3/products/' . wc_get_product_id_by_sku( '${sample.ref}' ) . '/variations' ) as $route ) {
         $req = new WP_REST_Request( 'GET', $route );
         $req->set_param( 'per_page', 100 );
         $res = rest_do_request( $req );
         $out .= wp_json_encode( rest_get_server()->response_to_data( $res, false ) );
       }
       /*
        * The CSV exporter is an ADMIN-only include: WooCommerce loads it from
        * admin/class-wc-admin-exporters.php, which never runs under WP-CLI, so
        * constructing it here is a fatal. Loading the three files by hand is
        * what the shop own Export button ends up doing, and it is the surface
        * that actually needs testing: that button is one click away from any
        * shop manager, and its "export custom meta" checkbox is what would put
        * our purchase price in a spreadsheet.
        *
        * NOTE FOR WHOEVER EDITS THIS PHP: it lives in a JavaScript template
        * literal. A backtick or a dollar-brace in here silently becomes
        * JavaScript. One backtick in this very comment cost a run.
        */
       if ( ! class_exists( 'WC_Product_CSV_Exporter' ) ) {
         require_once WC_ABSPATH . 'includes/export/abstract-wc-csv-exporter.php';
         require_once WC_ABSPATH . 'includes/export/abstract-wc-csv-batch-exporter.php';
         require_once WC_ABSPATH . 'includes/export/class-wc-product-csv-exporter.php';
       }
       $exporter = new WC_Product_CSV_Exporter();
       // The method names are WooCommerce 11.0.1's, checked against the class
       // rather than remembered: 'set_product_types' is the name everyone
       // writes and it does not exist, and calling it is a fatal, not a warning.
       $exporter->set_product_types_to_export( array( 'variable', 'variation' ) );
       $exporter->enable_meta_export( true );
       $exporter->set_limit( 1000 );
       $exporter->generate_file();
       $csv = (string) $exporter->get_file();
       if ( strlen( $csv ) < 200 ) { throw new RuntimeException( 'the CSV export produced ' . strlen( $csv ) . ' bytes, so grepping it proves nothing' ); }
       $out .= $csv;
       $p = wc_get_product( wc_get_product_id_by_sku( '${sample.ref}' ) );
       $out .= wp_json_encode( $p->get_available_variations() );
       echo $out;`,
    )

  const sealed = restCheck()
  ok('the authenticated rest api, the csv export and the variation json carry no purchase price',
    sniff(sealed).length === 0, sniff(sealed).join(' ') || `${sealed.length} bytes`)

  // --- 8. prove the leak check can fail ------------------------------------
  const MU = 'ts-verify-unseal.php'
  const muPath = join(ROOT, 'wp-local', MU)
  /*
   * EVERY filter, not the two that were easiest to name.
   *
   * The point of this step is to prove each door is actually held shut by our
   * code and not by luck. Unhooking a subset proves it for that subset and
   * leaves the others exactly as unproven as they were before the test existed:
   * the variation JSON in particular strips the keys itself, so if that filter
   * were deleted tomorrow nothing here would notice.
   */
  const SEAL = [
    ['woocommerce_rest_prepare_product_object', 'strip_rest'],
    ['woocommerce_rest_prepare_product_variation_object', 'strip_rest'],
    ['woocommerce_product_export_skip_meta_keys', 'skip_export'],
    ['woocommerce_available_variation', 'variation_json'],
  ]
  writeFileSync(
    muPath,
    `<?php\n// Temporary, written by scripts/wp-catalogue-verify.mjs. Removes the seal so\n` +
      `// the leak check has something to find. Deleted before the script exits.\n` +
      `add_action( 'plugins_loaded', static function () {\n` +
      SEAL.map(
        ([hook, fn]) =>
          `  remove_filter( '${hook}', array( 'Teeshoop\\\\Core\\\\Shelf', '${fn}' ), 10 );\n`,
      ).join('') +
      `}, 99 );\n`,
  )
  let unsealed = ''
  try {
    docker(['exec', '-T', 'wp', 'mkdir', '-p', '/var/www/html/wp-content/mu-plugins'])
    docker(['cp', muPath, `wp:/var/www/html/wp-content/mu-plugins/${MU}`])
    unsealed = restCheck()
  } finally {
    try { docker(['exec', '-T', 'wp', 'rm', '-f', `/var/www/html/wp-content/mu-plugins/${MU}`]) } catch {}
    try { unlinkSync(muPath) } catch {}
  }
  ok('with the seal removed, the same check finds the price', sniff(unsealed).length > 0,
    `found ${sniff(unsealed).join(' ') || 'nothing'}`)

  const resealed = restCheck()
  ok('and the seal is back on', sniff(resealed).length === 0)

  // --- 9. the second run changes nothing -----------------------------------
  const before = phpJson(
    `$ids = get_posts( array( 'post_type' => array( 'product', 'product_variation' ), 'post_status' => 'any', 'numberposts' => -1, 'fields' => 'ids' ) );
     $out = array(); foreach ( $ids as $id ) { $out[ (string) $id ] = get_post_field( 'post_modified_gmt', $id ); }
     echo wp_json_encode( $out );`,
  )
  const second = wp(['teeshoop', 'catalogue', 'importer', '--recommencer', `--max=${MAX_REFS}`, '--discret'])
  const counts = /(\d+) créé\(s\), (\d+) modifié\(s\), (\d+) inchangé\(s\), (\d+) en échec, (\d+) dépublié/.exec(second)
  if (!counts) {
    // The summary is the assertion. When it is missing the interesting thing is
    // what came out INSTEAD, so print it: the first time this fired, the answer
    // was nothing at all, because the flag asking for a terse run was `--quiet`
    // and that is WP-CLI's own global switch for "print no logs".
    bail(`could not read the second run's summary. The command printed:\n---\n${second || '(nothing)'}\n---`)
  }
  ok('the second run creates nothing', Number(counts[1]) === 0, `created ${counts[1]}`)
  ok('the second run changes nothing', Number(counts[2]) === 0, `updated ${counts[2]}`)
  ok('the second run reports every reference unchanged', Number(counts[3]) === MAX_REFS, `unchanged ${counts[3]}`)
  ok('the second run says so out loud', /Rien n’a changé/.test(second))

  const after = phpJson(
    `$ids = get_posts( array( 'post_type' => array( 'product', 'product_variation' ), 'post_status' => 'any', 'numberposts' => -1, 'fields' => 'ids' ) );
     $out = array(); foreach ( $ids as $id ) { $out[ (string) $id ] = get_post_field( 'post_modified_gmt', $id ); }
     echo wp_json_encode( $out );`,
  )
  const moved = Object.keys(after).filter((id) => before[id] !== after[id])
  ok('and not one row was actually touched', moved.length === 0,
    moved.length ? `${moved.length} post(s) re-saved, e.g. ${moved[0]}` : `${Object.keys(after).length} posts checked`)

  // --- 10. the shipped state: browsable, and honest about not being buyable --
  const unpriced = phpJson(
    `$id = wc_get_product_id_by_sku( '${sample.ref}' );
     $p  = wc_get_product( $id );
     $v  = wc_get_product( (int) $p->get_children()[0] );
     echo wp_json_encode( array(
       'rate'        => Teeshoop\\Core\\Settings::pricing()['blank_margin_rate'],
       'price'       => (string) $v->get_price(),
       'purchasable' => (bool) $v->is_purchasable(),
     ) );`,
  )
  ok('with no margin rate the catalogue is browsable and not purchasable',
    unpriced.rate === null && unpriced.price === '' && unpriced.purchasable === false,
    `rate ${JSON.stringify(unpriced.rate)}, price ${JSON.stringify(unpriced.price)}`)
  ok('and the page says why instead of "choose another combination"',
    pageHtml.includes('tarif n’est pas encore publié'))

  /*
   * --- 11. and now with a price, because the unpriced state hides things -----
   *
   * `get_available_variations()` returns an EMPTY ARRAY for a product with no
   * purchasable variation — measured, 2 bytes of JSON — so every assertion made
   * about that surface above was true of nothing. The rate is a local test
   * value and nothing else: the real one is question 42, and the shop ships
   * with none. Left cleared at the end, so the mirror matches what is shipped.
   */
  const RATE = 0.45
  php(
    `$c = get_option( 'teeshoop_pricing', array() );
     $c = is_array( $c ) ? $c : array();
     $c['blank_margin_rate'] = ${RATE};
     update_option( 'teeshoop_pricing', $c );`,
  )
  wp(['teeshoop', 'catalogue', 'importer', '--recommencer', `--max=${MAX_REFS}`, '--discret'])

  const priced = phpJson(
    `$id = wc_get_product_id_by_sku( '${sample.ref}' );
     $p  = wc_get_product( $id );
     $v  = wc_get_product( (int) $p->get_children()[0] );
     $json = $p->get_available_variations();
     if ( function_exists( 'wc_load_cart' ) ) { wc_load_cart(); }
     $key = WC()->cart ? WC()->cart->add_to_cart( $id, 2, $v->get_id(), $v->get_attributes() ) : '';
     $qty = 0;
     foreach ( WC()->cart ? WC()->cart->get_cart() : array() as $line ) { $qty += (int) $line['quantity']; }
     echo wp_json_encode( array(
       'cents'       => (int) $v->get_meta( '_teeshoop_supply_cents', true ),
       'price'       => (string) $v->get_price(),
       'purchasable' => (bool) $v->is_purchasable(),
       'json_count'  => count( $json ),
       'json'        => wp_json_encode( $json ),
       'in_cart'     => $qty,
     ) );`,
  )

  // The price is the cost through the Bible's own formula, to the cent.
  const expectedPrice = (Math.round(priced.cents / (1 - RATE)) / 100).toFixed(2)
  ok('a priced variation costs cost / (1 - taux), to the cent',
    priced.price === expectedPrice, `${priced.price} for ${priced.cents} cents at ${RATE}`)
  ok('a priced variation is purchasable', priced.purchasable === true)
  ok('the variation json is no longer empty, so grepping it means something',
    priced.json_count > 0, `${priced.json_count} variations, ${priced.json.length} bytes`)
  ok('and it still carries no purchase price', sniff(priced.json).length === 0,
    sniff(priced.json).join(' ') || 'clean')
  ok('a variation really adds to the cart', priced.in_cart === 2, `${priced.in_cart} in cart`)

  // --- 12. what the heaviest product costs to render ------------------------
  const heaviest = phpJson(
    `global $wpdb;
     $row = $wpdb->get_row( "SELECT post_parent AS id, COUNT(*) AS n FROM {$wpdb->posts}
        WHERE post_type='product_variation' AND post_status='publish' GROUP BY post_parent ORDER BY n DESC LIMIT 1" );
     $id = (int) $row->id;
     wc_delete_product_transients( $id );
     $t0 = microtime( true ); wc_get_product( $id )->get_variation_prices( true ); $cold = ( microtime( true ) - $t0 ) * 1000;
     $t0 = microtime( true ); wc_get_product( $id )->get_variation_prices( true ); $warm = ( microtime( true ) - $t0 ) * 1000;
     echo wp_json_encode( array(
       'name' => wc_get_product( $id )->get_name(),
       'children' => (int) $row->n,
       'ajax_threshold' => (int) apply_filters( 'woocommerce_ajax_variation_threshold', 30, wc_get_product( $id ) ),
       'cold_ms' => round( $cold, 1 ), 'warm_ms' => round( $warm, 1 ),
     ) );`,
  )
  console.log(
    `\n  heaviest product: ${heaviest.name}, ${heaviest.children} variations · ` +
      `price range ${heaviest.cold_ms} ms cold, ${heaviest.warm_ms} ms warm ` +
      `(woo switches to ajax above ${heaviest.ajax_threshold})\n`,
  )

  // Back to the shipped default, so the mirror is not left in a state the
  // repository does not describe.
  php(
    `$c = get_option( 'teeshoop_pricing', array() );
     if ( is_array( $c ) ) { unset( $c['blank_margin_rate'] ); update_option( 'teeshoop_pricing', $c ); }`,
  )

  // --- report ---------------------------------------------------------------
  const failed = results.filter((r) => !r.pass)
  console.log('')
  if (results.length === 0) {
    console.error('the harness asserted nothing at all, which is not a pass.')
    done(2)
  }
  if (failed.length > 0) {
    console.error(`${failed.length} of ${results.length} checks failed:`)
    for (const f of failed) console.error(`  ${f.name}  ${f.extra}`)
    done(1)
  }
  console.log(`${results.length} checks passed.`)
  done(0)
}

main().catch((err) => bail(err?.stack ?? String(err)))
