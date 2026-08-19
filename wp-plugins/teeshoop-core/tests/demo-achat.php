<?php
/**
 * A worked supplier purchase on the mirror, from the REAL supplier.
 *
 * Not a test. It exists so the « Achats » screen can be looked at by somebody
 * who was not there, and so the seam the integration suite necessarily stubs
 * gets exercised once for real: this imports a catalogue reference through the
 * Worker, which authenticates against the live webservice, and it prices the
 * basket with the article prices the supplier published that day.
 *
 *   npx wrangler dev --port 8790 --ip 0.0.0.0
 *   npm run wp:cli -- eval-file wp-content/plugins/teeshoop-core/tests/demo-achat.php
 *
 * It needs `worker_url` pointing at that Worker (`host.docker.internal:8790`
 * from inside the container, which `wp-local/docker-compose.yml` maps) and
 * `TEESHOOP_CATALOGUE_TOKEN` in wp-config.php.
 *
 * NOTHING IS SENT TO THE SUPPLIER. It stops at a PREPARED purchase, which is
 * the screen a human confirms on. Confirming it is a human act and this script
 * is not one.
 *
 * @package Teeshoop\Core
 */

/*
 * COMMAND LINE ONLY. `wp-content/plugins/` is served by URL and this directory
 * is inside it. This file CREATES ORDERS, so a version of it that answered a
 * GET would let anybody fill the shop with them.
 */
if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

use Teeshoop\Core\Bat;
use Teeshoop\Core\Cart;
use Teeshoop\Core\Catalogue;
use Teeshoop\Core\Costing;
use Teeshoop\Core\Importer;
use Teeshoop\Core\Product;
use Teeshoop\Core\Purchase;
use Teeshoop\Core\Supply;

if ( ! defined( 'TEESHOOP_ALLOW_UNVERIFIED_DESIGNS' ) ) {
	define( 'TEESHOOP_ALLOW_UNVERIFIED_DESIGNS', true );
}

$why = Supply::unconfigured();
if ( '' !== $why ) {
	WP_CLI::error( $why );
}

$mode = Supply::mode();
if ( 'unknown' === $mode['mode'] ) {
	WP_CLI::error( 'Le Worker ne répond pas : ' . $mode['error'] );
}
WP_CLI::log( 'Compte fournisseur : ' . $mode['mode'] . ' (relevé ' . $mode['at'] . ')' );

// ── the blank, imported from the live catalogue ─────────────────────────────

$ref  = '18001';
$done = Importer::one( $ref );
if ( 'failed' === ( $done['outcome'] ?? 'failed' ) ) {
	WP_CLI::error( 'import refusé : ' . implode( ' / ', (array) ( $done['problems'] ?? array() ) ) );
}
$blank = Importer::find( $ref );
WP_CLI::log( sprintf( 'Référence %s importée (produit %d), %s.', $ref, $blank, $done['outcome'] ) );

$terms = Purchase::blank_colour_terms( $blank );
if ( array() === $terms ) {
	WP_CLI::error( 'La référence importée n’a aucun coloris.' );
}
// The colour the demo orders are drawn on, with the maker's own name for it.
$colour_term = in_array( 'Black', $terms, true ) ? 'Black' : $terms[0];

// ── the sellable product, declaring what it is printed on ───────────────────

$existing = get_page_by_path( 'teeshoop-achat-demo', OBJECT, 'product' );
if ( $existing ) {
	wp_delete_post( $existing->ID, true );
}
$product = new WC_Product_Simple();
$product->set_name( 'T-shirt personnalisé (démonstration achat)' );
$product->set_slug( 'teeshoop-achat-demo' );
$product->set_regular_price( '14.50' );
$product->set_weight( '0.18' );
$product->set_catalog_visibility( 'hidden' );
$product->save();
$product_id = $product->get_id();
update_post_meta( $product_id, Product::META, 'tee' );
update_post_meta( $product_id, Product::META_BLANK_REF, $ref );
update_post_meta( $product_id, Product::META_BLANK_COLOURS, wp_json_encode( array( 'black' => $colour_term ) ) );

WC()->customer->set_shipping_country( 'FR' );
WC()->customer->set_shipping_postcode( '75011' );
WC()->customer->set_shipping_city( 'Paris' );
WC()->customer->set_billing_country( 'FR' );
WC()->customer->set_billing_postcode( '75011' );
WC()->customer->set_billing_city( 'Paris' );
WC()->customer->save();

/** Two of the six orders of the week measured by `scripts/purchase-bench.mjs`. */
$week = array(
	array(
		'grid'    => array( 'M' => 12, 'L' => 8 ),
		'company' => 'Club omnisports de Bobigny',
		'design'  => 'demoachatdemoachat01',
	),
	array(
		'grid'    => array( 'M' => 20 ),
		'company' => 'Garage Lemoine',
		'design'  => 'demoachatdemoachat02',
	),
);

$sides = array(
	array(
		'id'         => 'front',
		'area_sq_cm' => 288.0,
		'pieces'     => array(
			array( 'w_cm' => 18.0, 'h_cm' => 14.5 ),
			array( 'w_cm' => 12.0, 'h_cm' => 3.2 ),
		),
	),
);

/*
 * THE WORKER IS TURNED OFF FOR THE CART PHASE, and only for it.
 *
 * `Cart::add` asks `GET /api/design/{id}` whether the design exists, which is
 * right and is what stops an unprintable order being paid for. These two
 * designs were never uploaded, because this script invents them, so the real
 * Worker answers 404 and the cart refuses. With no address configured,
 * `Design::verify` falls back to the development allowance instead. The
 * catalogue above was imported with the Worker ON, which is the part that had to
 * be real.
 */
$settings = get_option( 'teeshoop_settings', array() );
$worker   = is_array( $settings ) ? ( $settings['worker_url'] ?? '' ) : '';
update_option( 'teeshoop_settings', array_merge( (array) $settings, array( 'worker_url' => '' ) ) );

$made = array();
foreach ( $week as $one ) {
	WC()->cart->empty_cart();
	$key = Cart::add(
		array(
			'product_id' => $product_id,
			'qty'        => array_sum( $one['grid'] ),
			'sides'      => $sides,
			'design_id'  => $one['design'],
			'size_grid'  => $one['grid'],
		)
	);
	if ( is_wp_error( $key ) ) {
		WP_CLI::error( 'panier refusé : ' . $key->get_error_message() );
	}
	WC()->cart->calculate_totals();

	$order = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) ) );
	$order->set_billing_company( $one['company'] );
	$order->set_billing_email( 'atelier@example.test' );
	$order->set_billing_address_1( '12 rue de la Fabrique' );
	$order->set_billing_postcode( '75011' );
	$order->set_billing_city( 'Paris' );
	$order->set_billing_country( 'FR' );
	$order->save();
	$order->payment_complete( 'demo-achat-' . $order->get_id() );

	/*
	 * THE COLOUR THE DESIGN WAS DRAWN ON, and the blank it was sold as.
	 *
	 * A real sale takes both from the design manifest the Worker confirmed:
	 * `Cart::add` reads the colour there and freezes the matching supplier term
	 * beside it. This script invents its designs, so the manifest is bypassed by
	 * the development allowance and carries no colour; the two fields are
	 * therefore written here, with exactly the values that path would have
	 * produced. Writing only the first would leave a line sold with no supplier
	 * colour, which the basket then refuses by name, correctly.
	 */
	$order = wc_get_order( $order->get_id() );
	foreach ( $order->get_items() as $item ) {
		$item->update_meta_data( '_teeshoop_couleur', 'black' );
		$item->update_meta_data( '_teeshoop_blank_colour', $colour_term );
		$item->save();
	}
	$order = wc_get_order( $order->get_id() );

	$issued = Bat::issue( $order );
	if ( empty( $issued['ok'] ) ) {
		WP_CLI::error( 'BAT refusé : ' . ( $issued['reason'] ?? '?' ) );
	}
	$found = Bat::locate( $order->get_id(), 1, (string) $issued['token'] );
	if ( 'ok' !== $found['state'] ) {
		WP_CLI::error( 'BAT non décidable : ' . $found['state'] );
	}
	Bat::record_decision( $found['order'], 1, 'valider', '', '203.0.113.7', 'démonstration' );

	$made[] = $order->get_id();
	WP_CLI::log( sprintf( 'Commande %d : %d pièces pour %s.', $order->get_id(), array_sum( $one['grid'] ), $one['company'] ) );
}

// Back on: everything below asks the supplier and the packer for real.
update_option( 'teeshoop_settings', array_merge( (array) $settings, array( 'worker_url' => $worker ) ) );

/*
 * The report has to exist BEFORE the purchase, or there is no assumption for the
 * purchase to be compared against and the screen says « jamais chiffrée ».
 */
foreach ( $made as $id ) {
	Costing::refresh( wc_get_order( $id ) );
}

// ── the basket, and a purchase nobody has sent ──────────────────────────────

$basket = Purchase::basket( $made );
if ( ! $basket['complete'] ) {
	foreach ( $basket['unresolved'] as $bad ) {
		WP_CLI::warning( $bad['order_ref'] . ' : ' . $bad['why'] );
	}
	WP_CLI::error( 'Le panier n’est pas identifiable.' );
}

foreach ( $basket['rows'] as $row ) {
	WP_CLI::log(
		sprintf(
			'  %s %-4s x%-3d  %s HT  (stock %s au %s)',
			$row['sku'],
			$row['size'],
			$row['qty'],
			Teeshoop\Core\Money::format( (int) $row['amount_ht'] ),
			null === $row['stock'] ? '?' : $row['stock'],
			$row['stock_at']
		)
	);
}

$prepared = Purchase::prepare( $made );
if ( empty( $prepared['ok'] ) ) {
	WP_CLI::error( 'préparation refusée : ' . $prepared['reason'] );
}

WP_CLI::success(
	sprintf(
		'Commande fournisseur %d préparée, %d pièces, %s HT. Rien n’a été envoyé.',
		(int) $prepared['id'],
		(int) $basket['garments'],
		Teeshoop\Core\Money::format( (int) $basket['total_ht'] )
	)
);
WP_CLI::log( 'Écran : /wp-admin/admin.php?page=teeshoop-achats&achat=' . (int) $prepared['id'] );
