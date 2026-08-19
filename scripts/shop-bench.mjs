#!/usr/bin/env node
/**
 * The filter budget, measured.
 *
 *   node scripts/shop-bench.mjs [category-url]
 *
 * Chapter 04 of the associate's brief sets one performance number and it is the
 * only one in the chapter: « filtres en moins d'une seconde sur les pages
 * courantes », with an explicit ban on running heavy WordPress meta queries on
 * every click. Ten facets were built on top of that sentence, so the sentence
 * has to be checked rather than hoped for.
 *
 * Two things are measured, because they fail differently:
 *
 *   THE WHOLE PAGE, over HTTP, warm, median of N. That is what a buyer waits.
 *   THE FACET ARITHMETIC ALONE, inside WordPress, with the query log on. That
 *   is the part this session added, and it is the part that grows with the
 *   catalogue.
 *
 * AND THE SCALE, because this mirror holds a partial import and production will
 * not. `--echelle=N` inserts N synthetic references into a temporary category,
 * gives each one a realistic handful of terms drawn from the taxonomy that is
 * already there, measures the same facet arithmetic over them, and deletes them
 * again. It is benchmark data and it never reaches a customer surface: it exists
 * so the sentence "it will still be fast with four hundred and sixty-two" is a
 * measurement instead of an extrapolation from twelve.
 *
 * Exit: 0 measured and inside budget - 1 over budget - 2 nothing was measured.
 */
import { execFileSync } from 'node:child_process'

const ARGS = process.argv.slice(2)
const URL_ = ARGS.find((a) => a.startsWith('http')) || 'http://localhost:8080/product-category/t-shirts/'
const BUDGET_MS = 1000
const RUNS = 15
const WARMUP = 3
const COMPOSE = ['compose', '-f', 'wp-local/docker-compose.yml', 'run', '--rm', '-T', 'wpcli']

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

async function timePage(url) {
  const ms = []
  for (let i = 0; i < WARMUP + RUNS; i++) {
    const t0 = performance.now()
    const res = await fetch(url, { cache: 'no-store' })
    await res.text()
    if (i >= WARMUP) ms.push(performance.now() - t0)
    if (!res.ok) throw new Error(`${url} answered ${res.status}`)
  }
  return median(ms)
}

/*
 * The facet arithmetic on its own, inside a real WordPress.
 *
 * `SAVEQUERIES` has to be defined before WordPress runs a single query, which
 * is why it goes through `wp --exec` and not through a `define()` inside the
 * evaluated code: by the time `wp eval` runs, WordPress has already booted and
 * `$wpdb` has stopped logging. The count is then a DELTA around the call, so
 * only what the facets add is attributed to them.
 */
const PHP = `
$theme = get_template_directory();
if ( ! function_exists( 'Teeshoop\\\\Theme\\\\facet_terms' ) ) { WP_CLI::error( 'le thème Teeshoop n’est pas actif' ); }
global $wpdb;
$before_n = count( (array) $wpdb->queries );
$before_t = array_sum( array_map( fn( $q ) => (float) $q[1], (array) $wpdb->queries ) );
$t0 = microtime( true );
$rows = 0;
foreach ( array_keys( Teeshoop\\Theme\\facet_taxonomies() ) as $tax ) {
  $rows += count( Teeshoop\\Theme\\facet_terms( $tax ) );
}
$ms = ( microtime( true ) - $t0 ) * 1000;
$after_n = count( (array) $wpdb->queries );
$after_t = array_sum( array_map( fn( $q ) => (float) $q[1], (array) $wpdb->queries ) );
$products = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type='product' AND post_status='publish'" );
$terms = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->term_relationships}" );
echo json_encode( array(
  'ms' => round( $ms, 1 ),
  'queries' => $after_n - $before_n,
  'query_ms' => round( ( $after_t - $before_t ) * 1000, 1 ),
  'facet_values' => $rows,
  'products' => $products,
  'term_rows' => $terms,
) );
`

let facets = null
try {
  const out = execFileSync(
    'docker',
    [...COMPOSE, '--exec=define("SAVEQUERIES", true);', 'eval', PHP],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  facets = JSON.parse(out.slice(out.indexOf('{')))
} catch (e) {
  console.error('could not measure the facet arithmetic inside WordPress:')
  console.error(String(e.stderr || e).slice(0, 600))
}

const plain = await timePage(URL_)
const sep = URL_.includes('?') ? '&' : '?'
const filtered = await timePage(`${URL_}${sep}f_couleur[]=white&f_taille[]=m`)
const heavy = await timePage(`${URL_}${sep}f_couleur[]=white&f_taille[]=m&f_marque[]=b-c&g_min=140&g_max=200`)

const rows = [
  ['sans filtre', plain],
  ['deux facettes', filtered],
  ['trois facettes et un grammage', heavy],
]

console.log(`\n${URL_}   median of ${RUNS} requests, warm\n`)
for (const [label, ms] of rows) {
  console.log(`  ${label.padEnd(32)} ${ms.toFixed(0).padStart(6)} ms   ${ms <= BUDGET_MS ? 'sous le budget' : 'AU-DESSUS DU BUDGET'}`)
}
console.log(`\n  budget du chapitre 04 : ${BUDGET_MS} ms`)

if (facets) {
  console.log(
    `\n  le calcul des facettes seul : ${facets.ms} ms, ${facets.queries} requêtes SQL ` +
      `(${facets.query_ms} ms passées dans MySQL), ${facets.facet_values} valeurs rendues.`,
  )
  console.log(
    `  mesuré sur ${facets.products} produits publiés et ${facets.term_rows} relations de termes. ` +
      `La production en portera 462 et 13 699.`,
  )
}

/*
 * The same arithmetic over a catalogue the size of the real one.
 *
 * The products are created, measured and destroyed inside one WP-CLI call, so a
 * crash between the two leaves at most one temporary category behind and never
 * a half-published catalogue. Nothing is ever left `publish` after this returns.
 */
const scaleArg = ARGS.find((a) => a.startsWith('--echelle'))
if (scaleArg) {
  const n = Number(scaleArg.split('=')[1] || 462)
  const SCALE_PHP = `
$n = ${n};
$slug = 'teeshoop-bench-echelle';
$cat = wp_insert_term( 'Banc d’essai', 'product_cat', array( 'slug' => $slug ) );
$cat_id = is_wp_error( $cat ) ? (int) get_term_by( 'slug', $slug, 'product_cat' )->term_id : (int) $cat['term_id'];

$pools = array();
foreach ( array_keys( Teeshoop\\Theme\\facet_taxonomies() ) as $tax ) {
  $terms = get_terms( array( 'taxonomy' => $tax, 'hide_empty' => false, 'fields' => 'ids', 'number' => 200 ) );
  $pools[ $tax ] = is_array( $terms ) ? $terms : array();
}

$made = array();
for ( $i = 0; $i < $n; $i++ ) {
  $id = wp_insert_post( array(
    'post_type' => 'product', 'post_status' => 'publish',
    'post_title' => 'Banc essai ' . $i, 'post_name' => 'banc-essai-' . $i,
  ) );
  if ( ! $id || is_wp_error( $id ) ) { continue; }
  $made[] = (int) $id;
  wp_set_object_terms( $id, array( $cat_id ), 'product_cat' );
  update_post_meta( $id, '_teeshoop_weight_gsm', 140 + ( $i % 12 ) * 15 );
  foreach ( $pools as $tax => $ids ) {
    if ( empty( $ids ) ) { continue; }
    // A realistic spread: many colours, one brand, the full size run.
    $take = ( 'pa_couleur' === $tax ) ? 12 : ( ( 'pa_taille' === $tax ) ? 8 : 1 );
    $slice = array();
    for ( $k = 0; $k < $take; $k++ ) { $slice[] = $ids[ ( $i * 7 + $k * 3 ) % count( $ids ) ]; }
    wp_set_object_terms( $id, array_values( array_unique( $slice ) ), $tax );
  }
}

global $wpdb;
$rels = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->term_relationships}" );
$_GET = array();
$before_n = count( (array) $wpdb->queries );
$t0 = microtime( true );
$values = 0;
foreach ( array_keys( Teeshoop\\Theme\\facet_taxonomies() ) as $tax ) { $values += count( Teeshoop\\Theme\\facet_terms( $tax ) ); }
$ms = ( microtime( true ) - $t0 ) * 1000;
$queries = count( (array) $wpdb->queries ) - $before_n;

foreach ( $made as $id ) { wp_delete_post( $id, true ); }
wp_delete_term( $cat_id, 'product_cat' );
$left = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_name LIKE %s", 'banc-essai-%' ) );

echo json_encode( array( 'made' => count( $made ), 'rels' => $rels, 'ms' => round( $ms, 1 ), 'queries' => $queries, 'values' => $values, 'left_behind' => $left ) );
`
  try {
    const out = execFileSync(
      'docker',
      [...COMPOSE, '--exec=define("SAVEQUERIES", true);', 'eval', SCALE_PHP],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000 },
    )
    const sc = JSON.parse(out.slice(out.indexOf('{')))
    console.log(
      `\n  à l'échelle : ${sc.made} références synthétiques, ${sc.rels} relations de termes, ` +
        `${sc.ms} ms pour les ${sc.values} valeurs de facettes en ${sc.queries} requêtes.`,
    )
    if (sc.left_behind > 0) {
      console.error(`  ATTENTION : ${sc.left_behind} produit(s) de banc d'essai n'ont pas été supprimés.`)
      process.exit(1)
    }
    console.log('  les produits du banc d’essai ont tous été supprimés.')
    if (sc.ms > BUDGET_MS) {
      console.error(`\nshop-bench: ${sc.ms} ms à l'échelle dépasse le budget de ${BUDGET_MS} ms.`)
      process.exit(1)
    }
  } catch (e) {
    console.error('la mesure à l’échelle a échoué :')
    console.error(String(e.stderr || e).slice(0, 800))
    process.exit(1)
  }
}

const worst = Math.max(...rows.map((r) => r[1]))
if (!facets && rows.length === 0) {
  console.error('shop-bench: rien n’a été mesuré.')
  process.exit(2)
}
if (worst > BUDGET_MS) {
  console.error(`\nshop-bench: ${worst.toFixed(0)} ms dépasse le budget de ${BUDGET_MS} ms.`)
  process.exit(1)
}
console.log('\nshop-bench PASS')
