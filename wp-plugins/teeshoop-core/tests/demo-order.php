<?php
/**
 * A worked order on the mirror: created, paid, invoiced and costed.
 *
 * Not a test. It exists so a claim about this shop's economics can be checked
 * by somebody who was not there: `wp teeshoop marge <id>` prints the report and
 * this is what put the order under it.
 *
 * @package Teeshoop\Core
 */

/*
 * COMMAND LINE ONLY. `wp-content/plugins/` is served by URL and this directory
 * is inside it. This file CREATES AN ORDER, so a version of it that answered a
 * GET would let anybody fill the shop with them. Same guard as run.php, and for
 * a worse reason.
 */
if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}
use Teeshoop\Core\Cart;
use Teeshoop\Core\Costing;
use Teeshoop\Core\Invoice;
use Teeshoop\Core\Ledger;
use Teeshoop\Core\Product;
use Teeshoop\Core\Settings;

if ( ! defined( 'TEESHOOP_ALLOW_UNVERIFIED_DESIGNS' ) ) {
	define( 'TEESHOOP_ALLOW_UNVERIFIED_DESIGNS', true );
}

$settings = get_option( 'teeshoop_settings', array() );
$worker   = is_array( $settings ) ? ( $settings['worker_url'] ?? '' ) : '';
update_option( 'teeshoop_settings', array_merge( is_array( $settings ) ? $settings : array(), array( 'worker_url' => '' ) ) );

update_option(
	'teeshoop_costing',
	array(
		'garment_supply' => array(
			'tee' => array( 'ht' => 337, 'source' => 'Tarif fournisseur textile, grille du 1er août 2026', 'on' => '2026-08-01' ),
		),
	)
);

// The product.
$existing = get_page_by_path( 'teeshoop-marge-demo', OBJECT, 'product' );
if ( $existing ) {
	wp_delete_post( $existing->ID, true );
}
$product = new WC_Product_Simple();
$product->set_name( 'T-shirt personnalisé (démonstration marge)' );
$product->set_slug( 'teeshoop-marge-demo' );
$product->set_regular_price( '14.50' );
$product->set_weight( '0.18' );
$product->set_catalog_visibility( 'hidden' );
$product->save();
update_post_meta( $product->get_id(), Product::META, 'tee' );
$product_id = $product->get_id();

// The customer.
WC()->customer->set_shipping_country( 'FR' );
WC()->customer->set_shipping_postcode( '75011' );
WC()->customer->set_shipping_city( 'Paris' );
WC()->customer->set_billing_country( 'FR' );
WC()->customer->set_billing_postcode( '75011' );
WC()->customer->set_billing_city( 'Paris' );
WC()->customer->save();

// A design with real transfer geometry: a chest lockup and a line under it.
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

WC()->cart->empty_cart();
$key = Cart::add( array( 'product_id' => $product_id, 'qty' => 30, 'sides' => $sides, 'design_id' => 'demomargedemomarge01' ) );
if ( is_wp_error( $key ) ) {
	WP_CLI::error( 'panier refusé : ' . $key->get_error_message() );
}
WC()->cart->calculate_totals();

$order = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => 'stripe' ) ) );
$order->set_billing_first_name( 'Atelier' );
$order->set_billing_last_name( 'Bobigny' );
$order->set_billing_email( 'atelier@example.test' );
$order->set_billing_address_1( '12 rue de la Fabrique' );
$order->set_billing_postcode( '75011' );
$order->set_billing_city( 'Paris' );
$order->set_billing_country( 'FR' );
$order->update_meta_data( Costing::META_SALE_TYPE, 'premiere' );
$order->update_meta_data( Costing::META_SELLER, 'Karim B.' );
$order->save();

$order->payment_complete( 'demo-marge-' . $order->get_id() );
Invoice::issue( wc_get_order( $order->get_id() ) );

// Put the Worker back so the film is really nested.
update_option( 'teeshoop_settings', array_merge( is_array( $settings ) ? $settings : array(), array( 'worker_url' => $worker ) ) );

$report = Costing::refresh( wc_get_order( $order->get_id() ) );
WP_CLI::success( 'commande ' . $order->get_id() . ' créée, payée, facturée et chiffrée.' );
