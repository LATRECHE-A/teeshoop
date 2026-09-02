<?php
/**
 * The public price grid, remeasured by running the engine.
 *
 * ── WHY THIS IS A FILE AND NOT AN AFTERNOON ──────────────────────────────────
 *
 * Question 06 carries the most-quoted table in this repository: at 5, 10, 25, 50
 * and 100 pieces, what the published tariff brings in, what the order costs,
 * what its floor is, what the engine would advise, and whether it is sellable.
 * It was measured once, on 18 August 2026, by running the engine by hand.
 *
 * Then question 04 changed the film from a roll billed by the linear metre to a
 * 33 x 46 cm sheet, question 05 cut the pose time from 45 seconds to 15, and
 * question 06 moved the target margin from 55 % to 50 %. Every figure in that
 * table depends on all three, and a table nobody can re-run is a table that goes
 * stale silently and gets quoted anyway. `CLAUDE.md` forbids claiming a result
 * you have not measured; this is what makes measuring it cost one command.
 *
 *   npm run wp:cli -- eval-file wp-content/plugins/teeshoop-core/tests/demo-grille.php
 *
 * It prints the markdown rows to paste under question 06. It creates five
 * orders on the mirror and deletes them again, so it can be run twice.
 *
 * ── WHAT IT IS NOT ───────────────────────────────────────────────────────────
 *
 * Not a test: nothing here asserts, because there is no right answer to assert.
 * The point is the number, and the number is whatever the shipped code says it
 * is today. A test would have to hard-code a figure and would then be one more
 * copy of it.
 *
 * @package Teeshoop\Core
 */

/*
 * COMMAND LINE ONLY. `wp-content/plugins/` is served by URL and this directory
 * is inside it. This file CREATES ORDERS, so a version of it that answered a GET
 * would let anybody fill the shop with them. Same guard as demo-order.php.
 */
if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

use Teeshoop\Core\Cart;
use Teeshoop\Core\Costing;
use Teeshoop\Core\Money;
use Teeshoop\Core\Product;

if ( ! defined( 'TEESHOOP_ALLOW_UNVERIFIED_DESIGNS' ) ) {
	define( 'TEESHOOP_ALLOW_UNVERIFIED_DESIGNS', true );
}

/*
 * THE SAME TEE, THE SAME PURCHASE PRICE AND THE SAME ARTWORK as the measurement
 * of 18 August, so the two tables differ only by what the answers changed. The
 * 3,37 EUR is the supplier grid of 1 August 2026 and the visual is a chest
 * lockup in two pieces, which is what makes the nesting non-trivial.
 */
$saved_costing = get_option( 'teeshoop_costing', array() );
update_option(
	'teeshoop_costing',
	array_merge(
		is_array( $saved_costing ) ? $saved_costing : array(),
		array(
			'garment_supply' => array(
				'tee' => array( 'ht' => 337, 'source' => 'Tarif fournisseur textile, grille du 1er août 2026', 'on' => '2026-08-01' ),
			),
		)
	)
);

$existing = get_page_by_path( 'teeshoop-grille-demo', OBJECT, 'product' );
if ( $existing ) {
	wp_delete_post( $existing->ID, true );
}
$product = new WC_Product_Simple();
$product->set_name( 'T-shirt personnalisé (mesure de la grille)' );
$product->set_slug( 'teeshoop-grille-demo' );
$product->set_regular_price( '14.50' );
$product->set_weight( '0.18' );
$product->set_catalog_visibility( 'hidden' );
$product->save();
update_post_meta( $product->get_id(), Product::META, 'tee' );
$product_id = $product->get_id();

WC()->customer->set_shipping_country( 'FR' );
WC()->customer->set_shipping_postcode( '75011' );
WC()->customer->set_billing_country( 'FR' );
WC()->customer->set_billing_postcode( '75011' );
WC()->customer->save();

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

$made = array();
$rows = array();

foreach ( array( 5, 10, 25, 50, 100 ) as $qty ) {
	WC()->cart->empty_cart();
	$key = Cart::add(
		array(
			'product_id' => $product_id,
			'qty'        => $qty,
			'sides'      => $sides,
			'design_id'  => 'demogrilledemogrille',
		)
	);
	if ( is_wp_error( $key ) ) {
		WP_CLI::warning( sprintf( '%d pièces : panier refusé (%s)', $qty, $key->get_error_message() ) );
		continue;
	}
	WC()->cart->calculate_totals();

	$order = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) ) );
	$order->set_billing_first_name( 'Mesure' );
	$order->set_billing_last_name( 'Grille' );
	$order->set_billing_email( 'grille@example.test' );
	$order->set_billing_address_1( '12 rue de la Fabrique' );
	$order->set_billing_postcode( '75011' );
	$order->set_billing_city( 'Paris' );
	$order->set_billing_country( 'FR' );
	$order->save();
	$made[] = $order->get_id();

	$report = Costing::refresh( wc_get_order( $order->get_id() ) );

	/*
	 * NO PLAN MEANS NO FLOOR, and it is printed as such rather than as zero.
	 * `Cli::margin_report` learned this the hard way: reading a null plan's
	 * fields yields 0, every verdict test yields false, and the report comes out
	 * green and empty.
	 */
	$has_plan = is_array( $report['plan'] ?? null );

	$verdict = 'vendable sans validation';
	if ( ! $has_plan ) {
		$verdict = '**aucun plancher calculable**';
	} elseif ( ! empty( $report['verdict']['below_cost'] ) ) {
		$verdict = '**sous le coût direct**';
	} elseif ( ! empty( $report['verdict']['below_floor'] ) ) {
		$gap     = (int) $report['plan']['floor_ht'] - (int) $report['revenue']['total_ht'];
		$verdict = sprintf( '**sous le plancher de %s**', Money::format( $gap ) );
	} elseif ( ! empty( $report['verdict']['needs_approval'] ) ) {
		$verdict = 'remise au-delà de l’autonomie';
	}

	/*
	 * GOODS AND DELIVERY, SEPARATELY. `Invoice::order_totals` puts shipping in
	 * `total_ht`, which is right for a verdict (the customer pays it and the
	 * floor is compared against it) and misleading in a price table: at five
	 * pieces the delivery is a sixth of the line, and the same column in the
	 * August measurement did not carry one. A table that quietly changes what it
	 * counts is worse than one that is out of date.
	 */
	$rows[] = sprintf(
		'| %d | %s | %s | %s | %s%s | %s | %s | %s |',
		$qty,
		Money::format( (int) $report['revenue']['goods_ht'] - (int) $report['revenue']['discount_ht'] ),
		Money::format( (int) $report['revenue']['shipping_ht'] ),
		Money::format( (int) $report['revenue']['total_ht'] ),
		Money::format( (int) $report['cost']['total_ht'] ),
		empty( $report['cost']['complete'] ) ? ' *(incomplet)*' : '',
		$has_plan ? Money::format( (int) $report['plan']['floor_ht'] ) : 'aucun',
		$has_plan ? Money::format( (int) $report['plan']['recommended_ht'] ) : 'aucun',
		$verdict
	);

	$film = is_array( $report['film'] ?? null ) ? $report['film'] : array();
	WP_CLI::log(
		sprintf(
			'  %3d pièces : film %s, %d transfert(s)',
			$qty,
			'sheet' === ( $film['billing'] ?? '' ) && null !== ( $film['billed_sheets'] ?? null )
				? $film['billed_sheets'] . ' feuille(s)'
				: Money::number( (float) ( $film['billed_m'] ?? 0 ), 2 ) . ' m',
			(int) ( $report['work']['transfers'] ?? 0 )
		)
	);
}

WP_CLI::log( '' );
WP_CLI::log( '| Quantité | Marquage HT | Livraison HT | Encaissé HT | Coût direct | Prix plancher | Prix conseillé | Verdict |' );
WP_CLI::log( '|---|---|---|---|---|---|---|---|' );
foreach ( $rows as $row ) {
	WP_CLI::log( $row );
}
WP_CLI::log( '' );

// Leave the mirror as it was found.
WC()->cart->empty_cart();
foreach ( $made as $id ) {
	$order = wc_get_order( $id );
	if ( $order instanceof WC_Order ) {
		$order->delete( true );
	}
}
wp_delete_post( $product_id, true );
update_option( 'teeshoop_costing', is_array( $saved_costing ) ? $saved_costing : array() );

WP_CLI::success( sprintf( '%d ligne(s) mesurées, %d commande(s) et le produit de mesure supprimés.', count( $rows ), count( $made ) ) );
