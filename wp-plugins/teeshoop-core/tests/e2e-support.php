<?php
/**
 * The WordPress half of scripts/wp-e2e-verify.mjs.
 *
 *   docker compose -f wp-local/docker-compose.yml run --rm wpcli \
 *     eval-file wp-content/plugins/teeshoop-core/tests/e2e-support.php <mode> [args]
 *
 * Three modes, each printing ONE line of JSON on stdout so the harness can read
 * it without parsing prose:
 *
 *   setup <studio_origin> <worker_url>   configure the integration and make a
 *                                        product page carrying the shortcode
 *   cart <customer_id>                   what the visitor's stored session
 *                                        holds, and what Pricing::quote() says
 *                                        it should cost
 *   refuse <product_id> <design_id>      the fail-closed path, with a design id
 *                                        the Worker has never seen
 *
 * It lives here rather than in scripts/ because it has to be inside the plugin
 * directory the container bind-mounts, and it is deliberately NOT named
 * test-*.php: tests/run.php globs that pattern and must stay bootstrap-free.
 *
 * IT ASSERTS NOTHING. Every judgement is made in the harness, in Node, from the
 * JSON below. A support file that decided for itself whether the price was
 * right would be the price engine's third implementation.
 *
 * NOTE: no `declare(strict_types=1)`, unlike the rest of the plugin. `wp
 * eval-file` eval()s the contents and a declare must be the first statement of
 * a script; inside an eval it is a fatal error. Same reason integration.php
 * does without it.
 *
 * @package Teeshoop\Core
 */

use Teeshoop\Core\Cart;
use Teeshoop\Core\Money;
use Teeshoop\Core\Pricing;
use Teeshoop\Core\Product;
use Teeshoop\Core\Settings;

/** The slug is fixed so the harness can be run twice without piling up products. */
const TS_E2E_SLUG = 'teeshoop-e2e-tee';

function ts_e2e_out( array $payload ) {
	echo wp_json_encode( $payload ) . "\n";
}

/**
 * A theme that renders WooCommerce the way production does.
 *
 * The shipped default is Twenty Twenty-Five, an FSE theme, and WooCommerce's
 * BLOCK product template puts the description through `wp_kses_post` after
 * expanding shortcodes. `iframe` is not an allowed tag there, so the studio
 * came out as an empty `<div class="teeshoop-studio">`: rendered, sanitised
 * away, and silent about it. teeshoop.com runs Woodmart, which is a classic
 * theme, so the mirror should be on one too. Twenty Twenty-One is the nearest
 * bundled equivalent.
 *
 * Worth carrying into session 02: on a block theme the studio cannot live in a
 * product description at all, whatever the shortcode does.
 */
function ts_e2e_classic_theme() {
	$active = wp_get_theme();
	if ( ! $active->is_block_theme() ) {
		return array( 'theme' => $active->get_stylesheet(), 'switched' => false );
	}
	$classic = wp_get_theme( 'twentytwentyone' );
	if ( ! $classic->exists() ) {
		return array( 'theme' => $active->get_stylesheet(), 'switched' => false, 'need_classic' => true );
	}
	switch_theme( 'twentytwentyone' );
	return array( 'theme' => 'twentytwentyone', 'switched' => true );
}

function ts_e2e_setup( string $studio_origin, string $worker_url ) {
	$theme = ts_e2e_classic_theme();

	/*
	 * A French shop, because that is what is being mirrored.
	 *
	 * WooCommerce ships as a USD store, and it renders the price the plugin
	 * hands it with the STORE's symbol: a 384,25 EUR line came out as $384.25
	 * on the cart page. Same digits, wrong money, all the way to the invoice.
	 * The plugin now says so in the admin; the mirror should simply be right.
	 */
	update_option( 'woocommerce_currency', 'EUR' );
	update_option( 'woocommerce_default_country', 'FR:IDF' );
	update_option( 'woocommerce_currency_pos', 'right_space' );
	update_option( 'woocommerce_price_decimal_sep', ',' );
	update_option( 'woocommerce_price_thousand_sep', ' ' );

	update_option(
		'teeshoop_settings',
		array(
			'studio_origin'      => $studio_origin,
			'studio_path'        => '/',
			'worker_url'         => $worker_url,
			'design_verify_path' => '/api/design/',
		)
	);

	$existing = get_page_by_path( TS_E2E_SLUG, OBJECT, 'product' );
	$product  = $existing ? wc_get_product( $existing->ID ) : new WC_Product_Simple();

	$product->set_name( 'Tee de vérification' );
	$product->set_slug( TS_E2E_SLUG );
	$product->set_status( 'publish' );
	$product->set_catalog_visibility( 'hidden' );
	// A catalogue price that must NEVER be charged: every assertion downstream
	// compares against Pricing::quote(), so a leak of this number is visible.
	$product->set_regular_price( '99.99' );
	// The short description: WooCommerce's classic summary template runs it
	// through `do_shortcode`, and it puts the editor high on the page where a
	// personalisation tool belongs rather than inside the description tab.
	$product->set_short_description( '[teeshoop_studio]' );
	$product->set_description( 'Un t-shirt personnalisable, pour la vérification de bout en bout.' );
	$product->update_meta_data( Product::META, 'tee' );
	$product->save();

	ts_e2e_out(
		array(
			'theme'           => $theme['theme'],
			'theme_switched'  => (bool) ( $theme['switched'] ?? false ),
			'need_classic'    => (bool) ( $theme['need_classic'] ?? false ),
			'product_id'      => $product->get_id(),
			'url'             => get_permalink( $product->get_id() ),
			'cart_url'        => wc_get_cart_url(),
			'garment'         => Product::garment_of( $product->get_id() ),
			'catalogue_price' => (float) $product->get_regular_price(),
			'studio_origin'   => Settings::studio_origin(),
			'worker_url'      => Settings::get( 'worker_url' ),
			'unverified_ok'   => Settings::allow_unverified_designs(),
		)
	);
}

/**
 * Read the visitor's own cart out of the session table.
 *
 * The browser holds a `wp_woocommerce_session_*` cookie whose first field is
 * the customer id; the harness passes it in. Reading the stored session is what
 * makes this an assertion about the CUSTOMER's basket rather than about a fresh
 * one WP-CLI would otherwise create for itself.
 */
function ts_e2e_cart( string $customer_id ) {
	$handler = new WC_Session_Handler();
	$session = $handler->get_session( $customer_id );
	if ( empty( $session ) ) {
		ts_e2e_out( array( 'found' => false, 'reason' => 'no session for ' . $customer_id ) );
		return;
	}

	$cart   = maybe_unserialize( $session['cart'] ?? 'a:0:{}' );
	$totals = maybe_unserialize( $session['cart_totals'] ?? 'a:0:{}' );
	$config = Settings::pricing();
	$lines  = array();

	foreach ( (array) $cart as $key => $item ) {
		if ( empty( $item['teeshoop'] ) ) {
			continue;
		}
		$data  = $item['teeshoop'];
		$qty   = (int) $item['quantity'];
		$quote = Pricing::quote(
			array(
				'garment' => (string) ( $data['garment'] ?? '' ),
				'qty'     => $qty,
				'sides'   => (array) ( $data['sides'] ?? array() ),
			),
			$config
		);

		$lines[] = array(
			'key'          => $key,
			'product_id'   => (int) $item['product_id'],
			'qty'          => $qty,
			'garment'      => (string) ( $data['garment'] ?? '' ),
			'design_id'    => (string) ( $data['design_id'] ?? '' ),
			'sides'        => array_values( (array) ( $data['sides'] ?? array() ) ),
			'sides_source' => (string) ( $data['sides_source'] ?? '' ),
			'size_grid'    => (array) ( $data['size_grid'] ?? array() ),
			'verified'     => (bool) ( $data['verified'] ?? false ),
			'files'        => (array) ( $data['files'] ?? array() ),
			// What WooCommerce actually stored for this line, and what the price
			// authority says it should be. The harness compares them.
			'stored'       => array(
				'line_subtotal' => isset( $item['line_subtotal'] ) ? (float) $item['line_subtotal'] : null,
				'line_total'    => isset( $item['line_total'] ) ? (float) $item['line_total'] : null,
			),
			'expected'     => array(
				'unit_ht'   => $quote['unit_ht'],
				'total_ht'  => $quote['total_ht'],
				'total_ttc' => $quote['total_ttc'],
				'unit_eur'  => (float) $quote['unit_ht'] / 100,
				'total_eur' => (float) $quote['total_ht'] / 100,
				'display'   => array(
					'unit_ht'   => Money::format( $quote['unit_ht'] ),
					'total_ht'  => Money::format( $quote['total_ht'] ),
					'total_ttc' => Money::format( $quote['total_ttc'] ),
				),
			),
		);
	}

	ts_e2e_out(
		array(
			'found'        => true,
			'lines'        => $lines,
			'other_lines'  => count( (array) $cart ) - count( $lines ),
			'cart_totals'  => array(
				'subtotal' => isset( $totals['subtotal'] ) ? (float) $totals['subtotal'] : null,
				'total'    => isset( $totals['total'] ) ? (float) $totals['total'] : null,
			),
		)
	);
}

/**
 * The fail-closed path, run for real.
 *
 * `TEESHOOP_ALLOW_UNVERIFIED_DESIGNS` is NOT defined here, unlike in
 * integration.php: this container's wp-config does not set it, so `Design::verify`
 * really asks the Worker and really refuses on a 404. That is the behaviour
 * production has, and the only place it can be exercised end to end.
 */
function ts_e2e_refuse( int $product_id, string $design_id ) {
	include_once WC_ABSPATH . 'includes/wc-cart-functions.php';
	include_once WC_ABSPATH . 'includes/class-wc-cart.php';
	wc_load_cart();
	WC()->cart->empty_cart();

	$result = Cart::add(
		array(
			'product_id' => $product_id,
			'qty'        => 5,
			'garment'    => 'tee',
			'sides'      => array( array( 'id' => 'front', 'area_sq_cm' => 400 ) ),
			'design_id'  => $design_id,
		)
	);

	ts_e2e_out(
		array(
			'refused'       => is_wp_error( $result ),
			'code'          => is_wp_error( $result ) ? $result->get_error_code() : '',
			'cart_count'    => WC()->cart->get_cart_contents_count(),
			'unverified_ok' => Settings::allow_unverified_designs(),
		)
	);

	WC()->cart->empty_cart();
}

$mode = isset( $args[0] ) ? (string) $args[0] : '';

if ( 'setup' === $mode ) {
	ts_e2e_setup( (string) ( $args[1] ?? '' ), (string) ( $args[2] ?? '' ) );
} elseif ( 'cart' === $mode ) {
	ts_e2e_cart( (string) ( $args[1] ?? '' ) );
} elseif ( 'refuse' === $mode ) {
	ts_e2e_refuse( (int) ( $args[1] ?? 0 ), (string) ( $args[2] ?? '' ) );
} else {
	ts_e2e_out( array( 'error' => 'unknown mode ' . $mode ) );
	exit( 2 );
}
