<?php
/**
 * Produce real invoices, for something else to read.
 *
 * Run through `wp eval-file` by `scripts/invoice-verify.mjs`, which then opens
 * the PDFs with a reader that shares no code with this plugin. That separation
 * is the point: verifying a writer with its own reader proves only that it is
 * self-consistent, which is exactly why `scripts/dtf-verify.mjs` opens its ZIP
 * with a hand-rolled reader.
 *
 * Prints one JSON object on stdout: the document model of each scenario and its
 * PDF, base64 encoded. Nothing is written to disk, so the repository stays clean
 * and there is no path to get wrong between a container and a host.
 *
 * @package Teeshoop\Core
 */

/*
 * NO `declare(strict_types=1)` here, unlike every other file in the plugin, and
 * for the same reason integration.php says: `wp eval-file` eval()s the contents,
 * and a declare has to be the very first statement of a SCRIPT. Inside an eval
 * it is a fatal error.
 */

if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

use Teeshoop\Core\Cart;
use Teeshoop\Core\Invoice;
use Teeshoop\Core\Legal;
use Teeshoop\Core\Product;
use Teeshoop\Core\Vat;

$ts_identity = array(
	'raison_sociale'  => 'Teeshoop Vérification',
	'forme_juridique' => 'SAS',
	'capital'         => '1 000 EUR',
	'adresse'         => '1 rue de la Vérification',
	'code_postal'     => '93000',
	'ville'           => 'Bobigny',
	'siret'           => '12345678900017',
	'rcs_ville'       => 'Bobigny',
	'tva_intra'       => 'FR00123456789',
);

$ts_saved = array(
	'vat'     => get_option( 'teeshoop_vat', null ),
	'legal'   => get_option( 'teeshoop_legal', array() ),
	'taxes'   => get_option( 'woocommerce_calc_taxes' ),
	'unit'    => get_option( 'woocommerce_weight_unit' ),
);

add_filter( 'pre_wp_mail', '__return_true' );
if ( ! defined( 'TEESHOOP_ALLOW_UNVERIFIED_DESIGNS' ) ) {
	define( 'TEESHOOP_ALLOW_UNVERIFIED_DESIGNS', true );
}

include_once WC_ABSPATH . 'includes/wc-cart-functions.php';
include_once WC_ABSPATH . 'includes/class-wc-cart.php';
wc_load_cart();

update_option( 'woocommerce_weight_unit', 'kg' );

$ts_product = new WC_Product_Simple();
$ts_product->set_name( 'Tee-shirt personnalisé, coton biologique' );
$ts_product->set_regular_price( '14.50' );
$ts_product->set_catalog_visibility( 'hidden' );
$ts_product->set_weight( '0.18' );
$ts_product->update_meta_data( Product::META, 'tee' );
$ts_product->save();

/** Put a run in the basket, make an order, and return its frozen document. */
function ts_probe_order( int $product_id, string $regime, string $environment, array $identity, int $lines = 1 ): array {
	global $wpdb;

	update_option(
		'teeshoop_vat',
		array( array( 'from' => '2020-01-01', 'regime' => $regime, 'vat_number' => 'FR00123456789' ) )
	);
	$wpdb->query( "DELETE FROM {$wpdb->prefix}woocommerce_tax_rates WHERE tax_rate_name = 'TVA'" );
	if ( Vat::FRANCHISE === $regime ) {
		update_option( 'woocommerce_calc_taxes', 'no' );
	} else {
		update_option( 'woocommerce_calc_taxes', 'yes' );
		WC_Tax::_insert_tax_rate(
			array(
				'tax_rate_country'  => 'FR',
				'tax_rate'          => number_format( (float) \Teeshoop\Core\Settings::vat()['rate'] * 100, 4, '.', '' ),
				'tax_rate_name'     => 'TVA',
				'tax_rate_priority' => 1,
				'tax_rate_shipping' => 1,
				'tax_rate_class'    => '',
			)
		);
	}
	update_option( 'teeshoop_legal', $identity );

	// A delivery zone with our own method in it, so the invoice carries a
	// carriage line: an invoice layout that has never rendered one has never
	// been checked.
	foreach ( WC_Shipping_Zones::get_zones() as $existing ) {
		if ( 'Sonde facture' === $existing['zone_name'] ) {
			WC_Shipping_Zones::delete_zone( (int) $existing['id'] );
		}
	}
	$zone = new WC_Shipping_Zone();
	$zone->set_zone_name( 'Sonde facture' );
	$zone->add_location( 'FR', 'country' );
	$zone->save();
	$zone->add_shipping_method( \Teeshoop\Core\Shipping::METHOD_ID );
	$zone->save();
	WC_Cache_Helper::get_transient_version( 'shipping', true );

	WC()->customer->set_billing_country( 'FR' );
	WC()->customer->set_billing_company( 'Association Sportive de Bobigny' );
	WC()->customer->set_billing_first_name( 'Camille' );
	WC()->customer->set_billing_last_name( 'Durand' );
	WC()->customer->set_billing_address_1( '12 avenue Jean Jaurès' );
	WC()->customer->set_billing_postcode( '93000' );
	WC()->customer->set_billing_city( 'Bobigny' );
	WC()->customer->set_shipping_country( 'FR' );
	WC()->customer->set_shipping_postcode( '93000' );
	WC()->customer->set_shipping_city( 'Bobigny' );
	WC()->customer->save();

	WC()->cart->empty_cart();
	/*
	 * `$lines` distinct designs, so the tall-document case is rendered. With one
	 * line the table is short, the totals sit high and the mandatory mentions
	 * always fit; on a dozen lines they used to be drawn off the bottom of the
	 * sheet, which is a non-conforming invoice and was invisible to a probe that
	 * only ever ordered one thing.
	 */
	for ( $ts_i = 1; $ts_i < $lines; $ts_i++ ) {
		Cart::add(
			array(
				'product_id' => $product_id,
				'qty'        => 5,
				'sides'      => array( array( 'id' => 'front', 'area_sq_cm' => 120 + $ts_i ) ),
				'design_id'  => sprintf( 'probe%04dabcdefghij', $ts_i ),
			)
		);
	}
	Cart::add(
		array(
			'product_id' => $product_id,
			// Ten pieces, deliberately: at twenty-five the run passes the franco
			// and the carriage line is zero, so the layout that renders a
			// charged delivery would never be exercised.
			'qty'        => 10,
			'sides'      => array( array( 'id' => 'front', 'area_sq_cm' => 400 ), array( 'id' => 'back', 'area_sq_cm' => 900 ) ),
			'design_id'  => 'abcdefghijklmnop1234',
			'size_grid'  => array( 'M' => 4, 'L' => 4, 'XL' => 2 ),
		)
	);
	WC()->cart->calculate_shipping();
	WC()->cart->calculate_totals();
	// The customer picks the only option there is, so the order carries it.
	WC()->session->set( 'chosen_shipping_methods', array( \Teeshoop\Core\Shipping::METHOD_ID . ':' . $zone->get_id() ) );
	WC()->cart->calculate_totals();

	$order = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) ) );
	$order->set_billing_company( 'Association Sportive de Bobigny' );
	$order->update_meta_data( '_billing_siret', '98765432100011' );
	$order->set_date_paid( time() );
	$order->save();

	WC()->cart->calculate_shipping();
	WC()->cart->calculate_totals();

	$doc = Invoice::compose( wc_get_order( $order->get_id() ), $environment );
	if ( is_wp_error( $doc ) ) {
		$out = array( 'error' => $doc->get_error_code() . ': ' . $doc->get_error_message() );
		$order->delete( true );
		WC_Shipping_Zones::delete_zone( (int) $zone->get_id() );
		return $out;
	}

	$doc['number'] = Invoice::format_number( Invoice::series( $doc['date'] ), 1 );
	$out           = array(
		'doc' => $doc,
		'pdf' => base64_encode( Invoice::pdf( $doc ) ),
	);
	$order->delete( true );
	WC_Shipping_Zones::delete_zone( (int) $zone->get_id() );
	return $out;
}

$ts_out = array(
	'standard'  => ts_probe_order( $ts_product->get_id(), Vat::STANDARD, 'production', $ts_identity ),
	'franchise' => ts_probe_order( $ts_product->get_id(), Vat::FRANCHISE, 'production', $ts_identity ),
	'stamped'   => ts_probe_order( $ts_product->get_id(), Vat::STANDARD, 'staging', array() ),
	// A dozen lines, which is the corporate order this shop wants and the shape
	// that used to push the mandatory mentions off the bottom of the page.
	'long'      => ts_probe_order( $ts_product->get_id(), Vat::STANDARD, 'production', $ts_identity, 12 ),
	'refused'   => ts_probe_order( $ts_product->get_id(), Vat::STANDARD, 'production', array() ),
	'mentions'  => array(
		'franchise' => Vat::MENTION_FRANCHISE,
		'stamp'     => Legal::STAMP_TEXT,
	),
);

wp_delete_post( $ts_product->get_id(), true );
WC()->cart->empty_cart();

update_option( 'teeshoop_legal', $ts_saved['legal'] );
update_option( 'woocommerce_calc_taxes', $ts_saved['taxes'] );
update_option( 'woocommerce_weight_unit', $ts_saved['unit'] );
if ( null === $ts_saved['vat'] ) {
	delete_option( 'teeshoop_vat' );
} else {
	update_option( 'teeshoop_vat', $ts_saved['vat'] );
}

echo "\n===TEESHOOP-INVOICE-JSON===\n";
echo wp_json_encode( $ts_out );
echo "\n";
