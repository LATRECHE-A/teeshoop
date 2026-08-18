<?php
/**
 * Checkout, against a real WooCommerce: VAT, carriage, minimums and the invoice.
 *
 * Required by `integration.php` rather than run on its own, so there is still
 * one entry point, one pass count and one exit code. It is a separate file only
 * because the two halves are about different seams and a thousand-line test file
 * stops being read.
 *
 * WHAT CANNOT BE CHECKED WITHOUT WOOCOMMERCE, and is therefore all here: that
 * the regime an order was taken under survives a later change to the timeline,
 * that a placed order's invoice survives WooCommerce's own recalculation, that
 * the minimum fires on the hook the block checkout actually reaches, and that
 * the totals of a real order add up to the cent.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

use Teeshoop\Core\Cart;
use Teeshoop\Core\Checkout;
use Teeshoop\Core\Invoice;
use Teeshoop\Core\Ledger;
use Teeshoop\Core\Settlement;
use Teeshoop\Core\Legal;
use Teeshoop\Core\Money;
use Teeshoop\Core\Payment;
use Teeshoop\Core\Pricing;
use Teeshoop\Core\Settings;
use Teeshoop\Core\Shipping;
use Teeshoop\Core\Vat;

/** A complete identity, invented here and nowhere else in the repository. */
function ts_ck_identity(): array {
	return array(
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
}

/** Put the shop under a regime, and make WooCommerce's own tax engine agree. */
function ts_ck_regime( string $regime ): void {
	global $wpdb;

	update_option(
		'teeshoop_vat',
		array(
			array(
				'from'       => '2020-01-01',
				'regime'     => $regime,
				'vat_number' => Vat::STANDARD === $regime ? 'FR00123456789' : '',
			),
		)
	);

	$wpdb->query( "DELETE FROM {$wpdb->prefix}woocommerce_tax_rates WHERE tax_rate_name = 'TVA'" );

	if ( Vat::FRANCHISE === $regime ) {
		update_option( 'woocommerce_calc_taxes', 'no' );
		return;
	}

	update_option( 'woocommerce_calc_taxes', 'yes' );
	// Derived from the regime rather than typed, so the harness cannot agree
	// with itself while disagreeing with the shop.
	WC_Tax::_insert_tax_rate(
		array(
			'tax_rate_country'  => 'FR',
			'tax_rate'          => number_format( (float) Settings::vat()['rate'] * 100, 4, '.', '' ),
			'tax_rate_name'     => 'TVA',
			'tax_rate_priority' => 1,
			'tax_rate_shipping' => 1,
			'tax_rate_class'    => '',
		)
	);
	WC_Cache_Helper::get_transient_version( 'shipping', true );
}

/** One delivery zone with our own method in it, as `wp teeshoop setup` writes. */
function ts_ck_zone(): int {
	foreach ( WC_Shipping_Zones::get_zones() as $existing ) {
		if ( 'Vérification' === $existing['zone_name'] ) {
			WC_Shipping_Zones::delete_zone( (int) $existing['id'] );
		}
	}
	$zone = new WC_Shipping_Zone();
	$zone->set_zone_name( 'Vérification' );
	$zone->add_location( 'FR', 'country' );
	$zone->save();
	$zone->add_shipping_method( Shipping::METHOD_ID );
	$zone->save();

	WC_Cache_Helper::get_transient_version( 'shipping', true );
	return (int) $zone->get_id();
}

function ts_ck_customer_in_france(): void {
	WC()->customer->set_shipping_country( 'FR' );
	WC()->customer->set_shipping_state( 'IDF' );
	WC()->customer->set_shipping_postcode( '93000' );
	WC()->customer->set_shipping_city( 'Bobigny' );
	WC()->customer->set_billing_country( 'FR' );
	WC()->customer->set_billing_postcode( '93000' );
	WC()->customer->set_billing_city( 'Bobigny' );
	WC()->customer->save();
}

/** Put a personalised line in the basket and price it. */
function ts_ck_fill( int $product_id, int $qty, array $sides, string $design = 'abcdefghijklmnop1234' ) {
	WC()->cart->empty_cart();
	$key = Cart::add(
		array(
			'product_id' => $product_id,
			'qty'        => $qty,
			'sides'      => $sides,
			'design_id'  => $design,
		)
	);
	if ( ! is_wp_error( $key ) ) {
		WC()->cart->calculate_totals();
	}
	return $key;
}

/** Whether any error notice is queued, and empty the queue. */
function ts_ck_errors(): array {
	$notices = wc_get_notices( 'error' );
	wc_clear_notices();
	return array_map( static fn( $n ) => is_array( $n ) ? (string) $n['notice'] : (string) $n, $notices );
}

function ts_ck_any( array $notices, string $needle ): bool {
	foreach ( $notices as $notice ) {
		if ( str_contains( $notice, $needle ) ) {
			return true;
		}
	}
	return false;
}

/**
 * The suite.
 *
 * @param int $product_id A tee, 'tee' garment, with a weight.
 * @param int $hoodie_id  A hoodie.
 * @param int $bare_id    A product declaring no garment.
 */
function ts_checkout_suite( int $product_id, int $hoodie_id, int $bare_id ): void {
	$sides  = array( array( 'id' => 'front', 'area_sq_cm' => 400 ) );
	$design = 'abcdefghijklmnop1234';

	$saved_vat     = get_option( 'teeshoop_vat', null );
	$saved_legal   = get_option( 'teeshoop_legal', array() );
	$saved_pricing = get_option( 'teeshoop_pricing', array() );
	$saved_taxes   = get_option( 'woocommerce_calc_taxes' );

	// A test run does not send mail. Without this every payment_complete tries
	// an SMTP connection the container does not have, and the failures bury the
	// output the suite exists to print.
	add_filter( 'pre_wp_mail', '__return_true' );

	update_option( 'teeshoop_legal', ts_ck_identity() );
	update_option( 'woocommerce_weight_unit', 'kg' );
	ts_ck_zone();
	ts_ck_customer_in_france();
	ts_ck_regime( Vat::STANDARD );

	echo "\nTVA, livraison, minimum et facture\n";

	// ── the regime freezes onto the order ────────────────────────────────────

	ts_it( 'freezes the regime, the rate and the price basis onto the order', function () use ( $product_id, $sides, $design ) {
		ts_ck_regime( Vat::STANDARD );
		ts_ck_fill( $product_id, 10, $sides, $design );

		$order = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) ) );
		ts_eq( $order->get_meta( Checkout::META_VAT_REGIME, true ), Vat::STANDARD, 'regime on the order' );
		ts_eq( $order->get_meta( Checkout::META_VAT_RATE, true ), '0.2000', 'rate on the order' );
		ts_eq( $order->get_meta( Checkout::META_BASIS, true ), 'ht', 'price basis' );

		// Not just the amounts: the rules that produced them. An order that
		// cannot say which rules produced it cannot be re-explained.
		$config = json_decode( (string) $order->get_meta( Checkout::META_CONFIG, true ), true );
		ts_assert( is_array( $config ) && isset( $config['garments']['tee']['base_ht'] ), 'the price config was not frozen' );
		ts_assert( '' !== (string) $order->get_meta( Checkout::META_VERSION, true ), 'no plugin version' );

		$order->delete( true );
	} );

	ts_it( 'keeps that regime when the timeline changes afterwards', function () use ( $product_id, $sides, $design ) {
		ts_ck_regime( Vat::STANDARD );
		ts_ck_fill( $product_id, 10, $sides, $design );
		$order = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) ) );

		// The company turns out to have been in franchise all along, and says so
		// by editing the timeline. Yesterday's order is not rewritten.
		ts_ck_regime( Vat::FRANCHISE );
		$reread = wc_get_order( $order->get_id() );
		ts_eq( $reread->get_meta( Checkout::META_VAT_REGIME, true ), Vat::STANDARD, 'the order followed the timeline' );
		ts_eq( $reread->get_meta( Checkout::META_VAT_RATE, true ), '0.2000', 'rate on the order' );

		$order->delete( true );
		ts_ck_regime( Vat::STANDARD );
	} );

	// ── the two regimes, end to end ──────────────────────────────────────────

	ts_it( 'charges 20 % and invoices it, under the standard regime', function () use ( $product_id, $sides, $design ) {
		ts_ck_regime( Vat::STANDARD );
		ts_ck_fill( $product_id, 25, $sides, $design );

		$quote = Pricing::quote( array( 'garment' => 'tee', 'qty' => 25, 'sides' => $sides ), Settings::pricing() );
		ts_eq( Money::from_eur( (string) WC()->cart->get_subtotal() ), $quote['total_ht'], 'cart subtotal' );

		$order = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) ) );
		$order->payment_complete( 'ts-standard' );

		$doc = Invoice::stored( wc_get_order( $order->get_id() ) );
		ts_assert( null !== $doc, 'no invoice was issued on payment' );
		ts_eq( $doc['regime'], Vat::STANDARD, 'regime on the invoice' );
		ts_assert( $doc['total_vat'] > 0, 'an assujettie invoice carries no VAT' );
		ts_eq( $doc['total_ht'] + $doc['total_vat'], $doc['total_ttc'], 'the invoice does not add up' );
		ts_eq( $doc['mention'], '', 'the 293 B mention appeared on a taxable invoice' );

		$order->delete( true );
	} );

	ts_it( 'charges nothing and prints article 293 B, under the franchise', function () use ( $product_id, $sides, $design ) {
		ts_ck_regime( Vat::FRANCHISE );
		ts_ck_fill( $product_id, 25, $sides, $design );

		$quote = Pricing::quote( array( 'garment' => 'tee', 'qty' => 25, 'sides' => $sides ), Settings::pricing() );
		ts_eq( $quote['total_vat'], 0, 'the price authority still charged VAT' );
		ts_eq( $quote['total_ttc'], $quote['total_ht'], 'TTC is not HT under the franchise' );
		// The basket total also carries carriage, so what proves the regime is
		// the tax line, which must not exist at all.
		ts_eq( Money::from_eur( (string) WC()->cart->get_total_tax() ), 0, 'the basket charged VAT' );
		ts_eq(
			Money::from_eur( (string) WC()->cart->get_total( 'edit' ) ),
			$quote['total_ht'] + Money::from_eur( (string) WC()->cart->get_shipping_total() ),
			'the basket total is not goods plus carriage'
		);

		$order = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) ) );
		$order->payment_complete( 'ts-franchise' );

		$doc = Invoice::stored( wc_get_order( $order->get_id() ) );
		ts_assert( null !== $doc, 'no invoice under the franchise' );
		ts_eq( $doc['regime'], Vat::FRANCHISE, 'regime on the invoice' );
		ts_eq( $doc['total_vat'], 0, 'VAT on a franchise invoice' );
		ts_eq( $doc['total_ht'], $doc['total_ttc'], 'HT and TTC on a franchise invoice' );
		// CGI art. 293 E, II. Mandatory, and its absence is what constat 6 says
		// may already be true of fifteen real invoices.
		ts_eq( $doc['mention'], 'TVA non applicable, article 293 B du CGI', 'the mandatory mention' );
		ts_assert( in_array( 'TVA non applicable, article 293 B du CGI', Invoice::mentions( $doc ), true ), 'the mention is not on the document' );

		// And nothing else about VAT is on it: showing a rate under the
		// franchise makes the issuer liable for it (BOFiP § 460).
		$text = implode( ' ', Invoice::mentions( $doc ) );
		ts_assert( ! str_contains( $text, '20 %' ), 'a rate leaked onto a franchise invoice' );

		$order->delete( true );
		ts_ck_regime( Vat::STANDARD );
	} );

	ts_it( 'refuses to invoice an order taken outside every known period', function () use ( $product_id, $sides, $design ) {
		ts_ck_regime( Vat::STANDARD );
		ts_ck_fill( $product_id, 10, $sides, $design );
		$order = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) ) );

		// The fifteen orders of constat 6 are exactly this: real money, taken
		// before anybody recorded a regime.
		$order->update_meta_data( Checkout::META_VAT_REGIME, 'inconnu' );
		$order->save();

		$doc = Invoice::compose( wc_get_order( $order->get_id() ) );
		ts_assert( is_wp_error( $doc ), 'an order with no regime produced an invoice' );
		ts_eq( $doc->get_error_code(), 'teeshoop_no_regime', 'refusal reason' );

		$order->delete( true );
	} );

	ts_it( 'takes an order ON the day a regime changes under the new one, and the eve under the old', function () use ( $product_id, $sides, $design ) {
		/*
		 * THE CASE THE WHOLE SHAPE EXISTS FOR. A company in franchise that
		 * crosses the threshold switches on a date, and the orders either side
		 * of that date are different documents. The pure suite checks the
		 * boundary in `Vat::at`; this checks that a REAL order, created through
		 * WooCommerce, freezes the side of the line it actually falls on.
		 */
		$today    = Settings::today();
		$tomorrow = gmdate( 'Y-m-d', strtotime( $today . ' +1 day' ) );

		// The switch is today: an order taken now is under the new regime.
		update_option(
			'teeshoop_vat',
			array(
				array( 'from' => '2020-01-01', 'regime' => Vat::FRANCHISE ),
				array( 'from' => $today, 'regime' => Vat::STANDARD ),
			)
		);
		update_option( 'woocommerce_calc_taxes', 'no' );
		ts_ck_fill( $product_id, 10, $sides, $design );
		$after = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) ) );
		ts_eq( $after->get_meta( Checkout::META_VAT_REGIME, true ), Vat::STANDARD, 'the day of the switch' );
		ts_eq( $after->get_meta( Checkout::META_VAT_NOTE, true ), '', 'the 293 B mention survived the switch' );

		// The switch is tomorrow: the same order today is still under the old one.
		update_option(
			'teeshoop_vat',
			array(
				array( 'from' => '2020-01-01', 'regime' => Vat::FRANCHISE ),
				array( 'from' => $tomorrow, 'regime' => Vat::STANDARD ),
			)
		);
		ts_ck_fill( $product_id, 10, $sides, $design );
		$eve = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) ) );
		ts_eq( $eve->get_meta( Checkout::META_VAT_REGIME, true ), Vat::FRANCHISE, 'the eve of the switch' );
		ts_eq( $eve->get_meta( Checkout::META_VAT_NOTE, true ), Vat::MENTION_FRANCHISE, 'the mention on the eve' );

		// And the operator is warned, because an order paid before the switch and
		// delivered after it is owed a rectificative invoice we do not produce.
		ts_assert(
			ts_ck_any( Vat::problems( Settings::vat_periods(), $today ), 'facture rectificative' ),
			'a pending switch is not announced'
		);

		$after->delete( true );
		$eve->delete( true );
		ts_ck_regime( Vat::STANDARD );
	} );

	ts_it( 'freezes what the price resolved to on the line, not only its inputs', function () use ( $product_id, $sides, $design ) {
		ts_ck_regime( Vat::STANDARD );
		ts_ck_fill( $product_id, 10, $sides, $design );
		$order = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) ) );
		$item  = array_values( $order->get_items() )[0];

		$quote = Pricing::quote( array( 'garment' => 'tee', 'qty' => 10, 'sides' => $sides ), Settings::pricing() );

		// An accountant asking "why 20,82 EUR" is answered by the line itself,
		// without anybody running a pricing engine.
		ts_eq( (int) $item->get_meta( '_teeshoop_unit_ht', true ), (int) $quote['unit_ht'], 'unit price on the line' );
		ts_eq( (float) $item->get_meta( '_teeshoop_discount_rate', true ), (float) $quote['discount_rate'], 'discount rate' );
		ts_eq(
			json_decode( (string) $item->get_meta( '_teeshoop_tiers', true ), true ),
			array( 'front' => 'std' ),
			'the area tier each face fell into'
		);

		$order->delete( true );
	} );

	// ── the invoice cannot be rewritten ──────────────────────────────────────

	ts_it( 'keeps an issued invoice byte for byte when WooCommerce reprices the order', function () use ( $product_id, $sides, $design ) {
		global $wpdb;
		ts_ck_regime( Vat::STANDARD );
		ts_ck_fill( $product_id, 10, $sides, $design );
		$order = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) ) );
		$order->payment_complete( 'ts-frozen' );

		$before = Invoice::stored( wc_get_order( $order->get_id() ) );
		ts_assert( null !== $before, 'no invoice to freeze' );
		$pdf_before = Invoice::pdf( $before );

		/*
		 * MEASURED ON WOOCOMMERCE 11.0.1: `calculate_taxes()` reprices a placed
		 * order at today's rate and overwrites the rate it had recorded, and the
		 * admin's own "Recalculer" button reaches it. An invoice rendered live
		 * from the order would therefore change after it was sent. This one is
		 * rendered from the snapshot and cannot.
		 */
		$rate_id = (int) $wpdb->get_var( "SELECT tax_rate_id FROM {$wpdb->prefix}woocommerce_tax_rates WHERE tax_rate_name = 'TVA' LIMIT 1" );
		ts_assert( $rate_id > 0, 'the shop has no rate to move' );
		WC_Tax::_update_tax_rate( $rate_id, array( 'tax_rate' => '5.5000' ) );
		WC_Cache_Helper::get_transient_version( 'taxes', true );
		WC_Cache_Helper::invalidate_cache_group( 'taxes' );

		$reread = wc_get_order( $order->get_id() );
		$reread->calculate_taxes();
		$reread->calculate_totals( false );
		$reread->save();

		$after = Invoice::stored( wc_get_order( $order->get_id() ) );
		ts_eq( $after['number'], $before['number'], 'the invoice number moved' );
		ts_eq( $after['total_ttc'], $before['total_ttc'], 'the invoice total moved' );
		ts_eq( $after['rate'], $before['rate'], 'the invoice rate moved' );
		ts_eq( Invoice::pdf( $after ), $pdf_before, 'the PDF changed after the order was repriced' );

		// And the order itself really did move, so the test is not vacuous.
		ts_assert(
			Money::from_eur( (string) $reread->get_total() ) !== $before['total_ttc'],
			'WooCommerce did not reprice, so this proves nothing'
		);

		$order->delete( true );
		ts_ck_regime( Vat::STANDARD );
	} );

	ts_it( 'refuses to invoice an order nobody has paid', function () use ( $product_id, $sides, $design ) {
		/*
		 * A GET on the invoice URL used to ISSUE one when there was none, and
		 * `compose` never looked at the status: anyone holding the order key,
		 * which the customer has in their order-received URL and in every
		 * e-mail, could number an invoice for an order abandoned at the payment
		 * step. A number cannot be reclaimed, only cancelled by an avoir.
		 */
		ts_ck_regime( Vat::STANDARD );
		ts_ck_fill( $product_id, 10, $sides, $design );
		$order = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) ) );
		ts_eq( $order->get_status(), 'pending', 'the fixture is already paid, so this proves nothing' );

		$refused = Invoice::issue( $order );
		ts_assert( is_wp_error( $refused ), 'an unpaid order was invoiced' );
		ts_eq( $refused->get_error_code(), 'teeshoop_not_paid', 'refusal reason' );
		ts_eq( Invoice::stored( wc_get_order( $order->get_id() ) ), null, 'and it kept a document anyway' );

		// And once it is paid, it issues.
		$order->payment_complete( 'ts-paid-later' );
		ts_assert( null !== Invoice::stored( wc_get_order( $order->get_id() ) ), 'a paid order got no invoice' );

		$order->delete( true );
	} );

	ts_it( 'dates the invoice the day it is emitted, not the day of the order', function () use ( $product_id, $sides, $design ) {
		/*
		 * The series is keyed on this date. Dating a document by its ORDER meant
		 * an order taken on 28 December and paid on 3 January was numbered into
		 * the previous year's series after that year had closed, which is not a
		 * "séquence chronologique et continue". Article 242 nonies A, I, 6° wants
		 * the date of issue anyway; the order's own date is printed beside it.
		 */
		ts_ck_regime( Vat::STANDARD );
		ts_ck_fill( $product_id, 10, $sides, $design );
		$order = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) ) );
		$order->set_date_created( '2025-12-28 10:00:00' );
		$order->save();
		$order->payment_complete( 'ts-newyear' );

		$doc = Invoice::stored( wc_get_order( $order->get_id() ) );
		ts_assert( null !== $doc, 'no invoice' );
		ts_eq( $doc['date'], Settings::today(), 'the invoice is dated the order' );
		ts_eq( $doc['order']['date'], '2025-12-28', 'the order date is not printed' );
		ts_assert(
			str_starts_with( $doc['number'], Invoice::series( Settings::today() ) . '-' ),
			'the number came out of the wrong year: ' . $doc['number']
		);

		$order->delete( true );
	} );

	ts_it( 'refuses a document whose rate does not describe its own VAT', function () use ( $product_id, $sides, $design ) {
		/*
		 * The totals assertion proves the order adds up; it says nothing about
		 * whether the VAT line is the rate the document prints. An emptied tax
		 * table gives a total_tax of zero on an order the regime says is taxable,
		 * and the invoice would announce "TVA 20 %" beside 0,00 EUR: a tax the
		 * customer would try to reclaim and that was never charged.
		 */
		ts_ck_regime( Vat::STANDARD );
		ts_ck_fill( $product_id, 10, $sides, $design );
		$order = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) ) );

		// The order really was charged 20 %. The regime frozen on it says 5,5 %,
		// which is the shape of the fault: the rate the document would print and
		// the tax the customer paid do not describe each other. Driven through
		// the meta rather than through WooCommerce's tax table so the case is
		// deterministic and does not depend on a cache being invalidated.
		ts_assert( Money::from_eur( (string) $order->get_total_tax() ) > 0, 'the fixture carries no VAT at all' );
		$order->update_meta_data( Checkout::META_VAT_RATE, '0.0550' );
		$order->save();

		$refused = Invoice::compose( wc_get_order( $order->get_id() ), 'staging' );
		ts_assert( is_wp_error( $refused ), 'a document whose rate contradicts its own VAT was composed' );
		ts_eq( $refused->get_error_code(), 'teeshoop_vat_mismatch', 'refusal reason' );

		$order->delete( true );
		ts_ck_regime( Vat::STANDARD );
	} );

	ts_it( 'says nothing about tax when nobody has recorded the regime', function () {
		/*
		 * `rate` is 0,0 when no period covers today, so a page reading only the
		 * rate announced the FRANCHISE's own sentence, "aucune taxe ne s'y
		 * ajoute", to every visitor of a shop that had simply not been told what
		 * it was: a statement about the seller's tax position, made to a
		 * customer, on no evidence.
		 */
		update_option( 'teeshoop_vat', array() );
		$bases = Settings::price_bases();
		ts_eq( $bases['known'], false, 'an empty timeline was read as known' );
		ts_eq( $bases['two'], false, 'two bases under an unknown regime' );
		ts_eq( $bases['mention'], '', 'the franchise mention was printed under an unknown regime' );

		ts_ck_regime( Vat::FRANCHISE );
		$franchise = Settings::price_bases();
		ts_eq( $franchise['known'], true, 'a real franchise is known' );
		ts_eq( $franchise['mention'], Vat::MENTION_FRANCHISE, 'a real franchise says so' );

		ts_ck_regime( Vat::STANDARD );
	} );

	// ── the numbering ────────────────────────────────────────────────────────

	ts_it( 'numbers invoices in one unbroken sequence', function () use ( $product_id, $sides, $design ) {
		ts_ck_regime( Vat::STANDARD );
		$numbers = array();
		$orders  = array();

		for ( $i = 0; $i < 4; $i++ ) {
			ts_ck_fill( $product_id, 10, $sides, $design );
			$order = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) ) );
			$order->payment_complete( 'ts-seq-' . $i );
			$doc       = Invoice::stored( wc_get_order( $order->get_id() ) );
			$numbers[] = $doc['number'];
			$orders[]  = $order;
		}

		ts_eq( count( array_unique( $numbers ) ), 4, 'two invoices share a number' );

		$series = Invoice::series( Settings::today() );
		foreach ( $numbers as $number ) {
			ts_assert( str_starts_with( $number, $series . '-' ), "number {$number} is not in this year's series" );
		}

		$tail = array_map( static fn( $n ) => (int) substr( $n, strlen( $series ) + 1 ), $numbers );
		for ( $i = 1; $i < count( $tail ); $i++ ) {
			ts_eq( $tail[ $i ], $tail[ $i - 1 ] + 1, 'a hole opened in the sequence' );
		}

		foreach ( $orders as $order ) {
			$order->delete( true );
		}
	} );

	ts_it( 'never issues a second number for the same order', function () use ( $product_id, $sides, $design ) {
		ts_ck_regime( Vat::STANDARD );
		ts_ck_fill( $product_id, 10, $sides, $design );
		$order = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) ) );
		$order->payment_complete( 'ts-once' );

		$first = Invoice::stored( wc_get_order( $order->get_id() ) )['number'];
		// Both hooks fire for the same order, and a status change fires again.
		$order->update_status( 'completed' );
		Invoice::issue( wc_get_order( $order->get_id() ) );
		$second = Invoice::stored( wc_get_order( $order->get_id() ) )['number'];

		ts_eq( $second, $first, 'a second number was consumed for one order' );
		$order->delete( true );
	} );

	ts_it( 'keeps a rehearsal out of the shop’s own series', function () {
		// Session 15 runs a full dress rehearsal, and its invoice numbers must
		// not be the ones a real customer's invoice continues from.
		$production = Invoice::series( '2026-08-18' );
		ts_assert( str_starts_with( $production, 'ESSAI' ), 'this machine is not production and issued a real series' );
		ts_eq( Invoice::format_number( 'FA2026', 7 ), 'FA2026-0007', 'the padded form' );
		ts_eq( Invoice::format_number( 'FA2026', 12345 ), 'FA2026-12345', 'past four digits it simply grows' );
	} );

	// ── the legal identity gate ──────────────────────────────────────────────

	ts_it( 'refuses an invoice in production when the legal identity is incomplete', function () use ( $product_id, $sides, $design ) {
		ts_ck_regime( Vat::STANDARD );
		update_option( 'teeshoop_legal', array() );
		ts_ck_fill( $product_id, 10, $sides, $design );
		$order = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) ) );

		$refused = Invoice::compose( $order, 'production' );
		ts_assert( is_wp_error( $refused ), 'production issued an invoice with no seller on it' );
		ts_eq( $refused->get_error_code(), 'teeshoop_no_identity', 'refusal reason' );

		// And the shop refuses to take the order at all, for the same reason.
		$problems = Checkout::selling_problems( null, 'production' );
		ts_assert(
			ts_ck_any( $problems, 'identité légale' ),
			'production would have taken an order it cannot invoice'
		);

		$order->delete( true );
		update_option( 'teeshoop_legal', ts_ck_identity() );
	} );

	ts_it( 'stamps the same document on staging instead of refusing it', function () use ( $product_id, $sides, $design ) {
		ts_ck_regime( Vat::STANDARD );
		update_option( 'teeshoop_legal', array() );
		ts_ck_fill( $product_id, 10, $sides, $design );
		$order = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) ) );

		$doc = Invoice::compose( $order, 'staging' );
		ts_assert( ! is_wp_error( $doc ), 'staging refused a document it should have stamped' );
		ts_eq( $doc['stamp'], Legal::STAMP_TEXT, 'the stamp' );
		ts_assert( ! empty( $doc['missing'] ), 'a stamped document does not say what is missing' );
		ts_assert(
			ts_ck_any( Invoice::mentions( $doc ), 'inutilisable comme facture' ),
			'the stamped document does not say so in words'
		);

		$doc['number'] = 'ESSAI2026-0001';
		$pdf           = Invoice::pdf( $doc );
		ts_assert( strlen( $pdf ) > 800, 'the stamped PDF is empty' );

		$order->delete( true );
		update_option( 'teeshoop_legal', ts_ck_identity() );
	} );

	ts_it( 'issues once the identity is filled in, in production too', function () use ( $product_id, $sides, $design ) {
		ts_ck_regime( Vat::STANDARD );
		update_option( 'teeshoop_legal', ts_ck_identity() );
		ts_ck_fill( $product_id, 10, $sides, $design );
		$order = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) ) );

		$doc = Invoice::compose( $order, 'production' );
		ts_assert( ! is_wp_error( $doc ), 'a complete identity was still refused' );
		ts_eq( $doc['stamp'], '', 'a conforming document was stamped anyway' );
		ts_eq( $doc['seller']['siret'], '12345678900017', 'the seller on the document' );

		$order->delete( true );
	} );

	// ── the money adds up ────────────────────────────────────────────────────

	ts_it( 'adds up to the cent at every quantity around a discount break', function () use ( $product_id, $sides, $design ) {
		ts_ck_regime( Vat::STANDARD );

		foreach ( array( 5, 9, 10, 24, 25, 49, 50, 100 ) as $qty ) {
			ts_ck_fill( $product_id, $qty, $sides, $design );
			$quote = Pricing::quote( array( 'garment' => 'tee', 'qty' => $qty, 'sides' => $sides ), Settings::pricing() );

			$order = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) ) );
			$order->payment_complete( 'ts-round-' . $qty );
			$order = wc_get_order( $order->get_id() );

			$goods    = Money::from_eur( (string) $order->get_subtotal() );
			$shipping = Money::from_eur( (string) $order->get_shipping_total() );
			$tax      = Money::from_eur( (string) $order->get_total_tax() );
			$total    = Money::from_eur( (string) $order->get_total() );

			ts_eq( $goods, $quote['total_ht'], "order goods at qty {$qty}" );
			ts_eq( $goods + $shipping + $tax, $total, "order totals at qty {$qty}" );

			$doc = Invoice::stored( $order );
			ts_assert( null !== $doc, "no invoice at qty {$qty}" );
			ts_eq( $doc['total_ht'] + $doc['total_vat'], $doc['total_ttc'], "invoice totals at qty {$qty}" );
			ts_eq( $doc['total_ttc'], $total, "invoice against order at qty {$qty}" );

			// And the invoice's own lines re-add to its own goods total.
			$lines = 0;
			foreach ( $doc['lines'] as $line ) {
				$lines += (int) $line['total_ht'];
			}
			ts_eq( $lines, $goods, "invoice lines at qty {$qty}" );

			$order->delete( true );
		}
	} );

	// ── the minimum order ────────────────────────────────────────────────────

	ts_it( 'refuses a basket under the piece minimum, on the hook the block also reaches', function () use ( $product_id, $sides, $design ) {
		ts_ck_regime( Vat::STANDARD );
		$config = Settings::pricing();

		ts_ck_fill( $product_id, (int) $config['min_qty'] - 1, $sides, $design );
		wc_clear_notices();
		do_action( 'woocommerce_check_cart_items' );
		$short = ts_ck_errors();
		ts_assert( ts_ck_any( $short, 'il manque' ), 'a basket under the minimum was accepted' );
		ts_assert( ts_ck_any( $short, 'Ajoutez des pièces' ), 'the refusal does not say what to do' );

		ts_ck_fill( $product_id, (int) $config['min_qty'], $sides, $design );
		wc_clear_notices();
		do_action( 'woocommerce_check_cart_items' );
		ts_eq( ts_ck_errors(), array(), 'the smallest run the shop sells was refused' );
	} );

	ts_it( 'refuses a basket under the amount minimum even when the pieces are there', function () use ( $product_id, $sides, $design, $saved_pricing ) {
		ts_ck_regime( Vat::STANDARD );
		// The shipped amount minimum almost never binds (five printed tees are
		// 72,50 EUR HT), so the RULE is exercised by raising it rather than by
		// pretending a basket is cheaper than it is.
		update_option( 'teeshoop_pricing', array_merge( (array) $saved_pricing, array( 'min_ht' => 500000 ) ) );

		ts_ck_fill( $product_id, 10, $sides, $design );
		wc_clear_notices();
		do_action( 'woocommerce_check_cart_items' );
		$short = ts_ck_errors();
		ts_assert( ts_ck_any( $short, 'hors taxes pour atteindre le minimum' ), 'the amount minimum never fired' );

		update_option( 'teeshoop_pricing', $saved_pricing );
	} );

	// ── carriage ─────────────────────────────────────────────────────────────

	ts_it( 'offers a Colissimo rate priced from the real cart weight', function () use ( $product_id, $sides, $design ) {
		ts_ck_regime( Vat::STANDARD );
		ts_ck_fill( $product_id, 5, $sides, $design );
		WC()->cart->calculate_shipping();
		WC()->cart->calculate_totals();

		$packages = WC()->shipping()->get_packages();
		ts_assert( ! empty( $packages ), 'no shipping package was built' );
		$rates = $packages[0]['rates'];
		ts_assert( ! empty( $rates ), 'no delivery option was offered' );

		$rate = array_values( $rates )[0];
		ts_assert( str_contains( $rate->get_id(), Shipping::METHOD_ID ), 'the rate is not ours' );

		$config = Shipping::config();
		// Weighed from the products, in grams, whatever unit the store displays.
		$weighed = Shipping::weigh( $packages[0] );
		ts_eq( $weighed['pieces'], 5, 'the package lost a garment' );
		ts_eq( $weighed['grams'], (int) round( wc_get_weight( 0.18, 'g' ) * 5 ), 'the package was weighed wrong' );

		$expected = Shipping::quote( $weighed['grams'], 5, $weighed['goods_ht'], $config );
		ts_eq( Money::from_eur( (string) $rate->get_cost() ), $expected['charged_ht'], 'the rate is not the grid' );
		// And the grid really was consulted: the bracket is a published one.
		ts_eq( $expected['carrier_ht'], (int) Shipping::bracket( $weighed['grams'], $config )['ht'], 'the bracket is not the grid' );

		// And what we bear is recorded on the rate, so the margin can read it.
		ts_eq( (int) $rate->get_meta_data()['_teeshoop_borne_ht'], $expected['borne_ht'], 'what we bear' );
	} );

	ts_it( 'gives the delivery away above the franco and still records its cost', function () use ( $product_id, $sides, $design ) {
		ts_ck_regime( Vat::STANDARD );
		$config = Shipping::config();

		ts_ck_fill( $product_id, 50, $sides, $design );
		WC()->cart->calculate_shipping();
		WC()->cart->calculate_totals();

		$goods = Money::from_eur( (string) WC()->cart->get_subtotal() );
		ts_assert( $goods >= (int) $config['free_from_ht'], 'the fixture is below the franco, so this proves nothing' );

		$rates = WC()->shipping()->get_packages()[0]['rates'];
		$rate  = array_values( $rates )[0];
		ts_eq( Money::from_eur( (string) $rate->get_cost() ), 0, 'the franco did not apply' );
		ts_assert( (int) $rate->get_meta_data()['_teeshoop_borne_ht'] > 0, 'a free delivery was recorded as free to us' );
		ts_eq( $rate->get_meta_data()['_teeshoop_free'], 'yes', 'the free flag' );
	} );

	ts_it( 'offers no rate at all, and says why, when a line has no weight', function () use ( $hoodie_id, $sides, $design ) {
		ts_ck_regime( Vat::STANDARD );
		$hoodie = wc_get_product( $hoodie_id );
		$hoodie->set_weight( '' );
		$hoodie->save();

		ts_ck_fill( $hoodie_id, 5, $sides, $design );
		WC()->cart->calculate_shipping();

		$rates = WC()->shipping()->get_packages()[0]['rates'];
		ts_eq( count( $rates ), 0, 'a line with no weight was shipped anyway' );
		ts_eq( Shipping::last_refusal(), Shipping::NO_WEIGHT, 'refusal reason' );

		wc_clear_notices();
		do_action( 'woocommerce_check_cart_items' );
		ts_assert( ts_ck_any( ts_ck_errors(), 'poids' ), 'the checkout did not say why there is no delivery' );

		$hoodie->set_weight( '0.5' );
		$hoodie->save();
	} );

	// ── the invariant, the coupons and the fees ──────────────────────────────

	ts_it( 'refuses an order whose lines do not add up to our own price', function () use ( $product_id, $sides, $design ) {
		ts_ck_regime( Vat::STANDARD );
		ts_ck_fill( $product_id, 10, $sides, $design );
		$order = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) ) );

		// It passes as created.
		$threw = false;
		try {
			Checkout::assert_total_block( $order );
		} catch ( \Throwable $e ) {
			$threw = true;
		}
		ts_assert( ! $threw, 'a correct order was refused' );

		// Now move one line by a cent, the way a stale price or a rogue filter
		// would. Nothing reaches a gateway at a total we cannot re-derive.
		foreach ( $order->get_items() as $item ) {
			$item->set_total( (string) ( (float) $item->get_total() - 0.01 ) );
			$item->save();
		}
		$order = wc_get_order( $order->get_id() );

		$threw = false;
		try {
			Checkout::assert_total_block( $order );
		} catch ( \Throwable $e ) {
			$threw = true;
		}
		ts_assert( $threw, 'an order a cent adrift was accepted' );

		$order->delete( true );
	} );

	ts_it( 'accepts no discount code at all', function () {
		ts_assert( ! wc_coupons_enabled(), 'a coupon could be applied over an absolute price' );
	} );

	ts_it( 'refuses a basket another extension has added a charge to', function () use ( $product_id, $sides, $design ) {
		ts_ck_regime( Vat::STANDARD );
		ts_ck_fill( $product_id, 10, $sides, $design );

		$adder = static function ( $cart ) {
			$cart->add_fee( 'Frais de dossier', 9.90, false );
		};
		add_action( 'woocommerce_cart_calculate_fees', $adder );
		WC()->cart->calculate_totals();

		wc_clear_notices();
		do_action( 'woocommerce_check_cart_items' );
		ts_assert( ts_ck_any( ts_ck_errors(), 'supplément a été ajouté' ), 'a third-party fee went through' );

		remove_action( 'woocommerce_cart_calculate_fees', $adder );
		WC()->cart->calculate_totals();
	} );

	// ── the catalogue stays where it is ──────────────────────────────────────

	ts_it( 'still refuses to sell a catalogue reference nobody has priced', function () use ( $sides, $design ) {
		$blank = new WC_Product_Simple();
		$blank->set_name( 'Référence importée sans prix' );
		$blank->set_catalog_visibility( 'hidden' );
		$blank->update_meta_data( \Teeshoop\Core\Catalogue::META_REF, 'TS-VERIF-1' );
		$blank->save();

		$id = $blank->get_id();
		ts_assert( ! wc_get_product( $id )->is_purchasable(), 'an unpriced catalogue reference became buyable' );

		$refused = Cart::add(
			array(
				'product_id' => $id,
				'qty'        => 5,
				'sides'      => $sides,
				'design_id'  => $design,
			)
		);
		ts_assert( is_wp_error( $refused ), 'the studio put an unpriced reference in the basket' );

		WC()->cart->empty_cart();
		ts_assert( false === WC()->cart->add_to_cart( $id, 5 ), 'the plain add-to-cart bought an unpriced reference' );
		ts_eq( WC()->cart->get_cart_contents_count(), 0, 'the basket kept it anyway' );

		wp_delete_post( $id, true );
	} );

	// ── the deposit, which is a state and not a checkbox ─────────────────────

	/**
	 * An order an OPERATOR made, above the deposit threshold.
	 *
	 * It cannot come from a basket: question 02 stops self-serve at 2 000 EUR HT
	 * and question 16 opens deposits at 3 000, so the only orders that can ever
	 * qualify are the ones a person makes. That is the quote path of session 06,
	 * and it is why this fixture is built with the order API rather than the
	 * cart.
	 */
	$big_order = static function ( int $product_id, int $cents_ht ): \WC_Order {
		$order = wc_create_order();
		$item  = new \WC_Order_Item_Product();
		$item->set_product( wc_get_product( $product_id ) );
		$item->set_quantity( 1 );
		$item->set_subtotal( (string) Money::to_eur( $cents_ht ) );
		$item->set_total( (string) Money::to_eur( $cents_ht ) );
		$order->add_item( $item );
		$order->set_billing_country( 'FR' );
		$order->calculate_totals( true );
		$order->save();
		return $order;
	};

	ts_it( 'offers no deposit on an order below the threshold', function () use ( $product_id, $big_order ) {
		ts_ck_regime( Vat::STANDARD );
		$config = Ledger::config();
		$order  = $big_order( $product_id, (int) $config['deposit_from_ht'] - 100 );

		ts_assert( ! Ledger::authorise( $order ), 'a small order was authorised for a deposit' );
		ts_eq( Ledger::authorised( wc_get_order( $order->get_id() ) ), null, 'and it was recorded anyway' );

		$order->delete( true );
	} );

	ts_it( 'lets a person authorise one above it, and never a rule', function () use ( $product_id, $big_order ) {
		ts_ck_regime( Vat::STANDARD );
		$config = Ledger::config();
		$order  = $big_order( $product_id, (int) $config['deposit_from_ht'] + 100000 );

		// Nothing authorises itself: until somebody says so, the order needs the
		// whole total before production, which is chapter 2 line 330.
		ts_eq( Ledger::authorised( $order ), null, 'a deposit authorised itself' );
		ts_assert( ! Ledger::stage_allows( $order, Settlement::STAGE_PRODUCTION ), 'production opened on nothing' );

		ts_assert( Ledger::authorise( $order ), 'a large order was refused a deposit' );
		$order = wc_get_order( $order->get_id() );
		// The AMOUNT, frozen, not a flag: the gate reads what was approved and
		// not what the setting says next month.
		ts_eq(
			Ledger::authorised( $order ),
			Settlement::deposit_due( Ledger::due( $order ), Ledger::config() ),
			'the authorised amount was not frozen on the order'
		);

		$order->delete( true );
	} );

	ts_it( 'starts production on the acompte and holds the parcel for the solde', function () use ( $product_id, $big_order ) {
		ts_ck_regime( Vat::STANDARD );
		$config = Ledger::config();
		$order  = $big_order( $product_id, (int) $config['deposit_from_ht'] + 100000 );
		Ledger::authorise( $order );

		$order   = wc_get_order( $order->get_id() );
		$due     = Ledger::due( $order );
		$deposit = Settlement::deposit_due( $due, $config );

		// A cent under the deposit is not a deposit.
		ts_assert( Ledger::record( $order, $deposit - 1, 'Virement bancaire', 'VIR-COURT' ), 'the short transfer was not recorded' );
		$order = wc_get_order( $order->get_id() );
		ts_eq( Ledger::state( $order ), Settlement::SHORT, 'a short transfer read as a deposit' );
		ts_assert( ! Ledger::stage_allows( $order, Settlement::STAGE_PRODUCTION ), 'production started on a short transfer' );

		// And the cent that completes it is.
		Ledger::record( $order, 1, 'Virement bancaire', 'VIR-COMPLEMENT' );
		$order = wc_get_order( $order->get_id() );
		ts_eq( Ledger::state( $order ), Settlement::DEPOSIT, 'state after the deposit' );
		ts_eq( $order->get_status(), 'ts-acompte', 'the order does not say what it is' );
		ts_assert( Ledger::stage_allows( $order, Settlement::STAGE_PRODUCTION ), 'the acompte did not open production' );
		ts_assert( ! Ledger::stage_allows( $order, Settlement::STAGE_DISPATCH ), 'the parcel left on an acompte' );

		// No FINAL invoice on a half-paid order.
		ts_assert( ! $order->is_paid(), 'WooCommerce thinks an acompte is a paid order' );
		$refused = Invoice::issue( $order );
		ts_assert( is_wp_error( $refused ), 'an acompte was invoiced as a final invoice' );
		ts_eq( $refused->get_error_code(), 'teeshoop_not_paid', 'refusal reason' );
		ts_eq( Invoice::stored( $order ), null, 'a final invoice exists on a half-paid order' );

		/*
		 * BUT A FACTURE D'ACOMPTE, WHICH THE LAW MAKES MANDATORY. Article 289,
		 * I-1-c du CGI obliges an invoice for money received before a supply of
		 * goods is made, and BOI-TVA-DECLA-30-20-10-10 § 120 says it applies to
		 * every acompte and not only to those where VAT becomes exigible.
		 */
		$acomptes = Invoice::deposits( $order );
		ts_eq( count( $acomptes ), 2, 'each receipt did not get its own acompte invoice' );
		$last = $acomptes[1];
		ts_eq( $last['kind'], Invoice::KIND_DEPOSIT, 'the document is not an acompte' );
		ts_eq( $last['total_ht'] + $last['total_vat'], $last['total_ttc'], 'the acompte does not add up' );
		ts_eq( $last['total_ttc'], 1, 'the acompte is not the money that arrived' );
		ts_assert( '' !== $last['number'], 'the acompte carries no number' );
		ts_assert( strlen( Invoice::pdf( $last ) ) > 800, 'the acompte renders no PDF' );

		// The balance opens everything, and THAT is what issues the invoice.
		Ledger::record( $order, Settlement::remaining( $due, Ledger::received( $order ) ), 'Virement bancaire', 'VIR-SOLDE' );
		$order = wc_get_order( $order->get_id() );
		ts_eq( Ledger::state( $order ), Settlement::PAID, 'state after the balance' );
		ts_assert( Ledger::stage_allows( $order, Settlement::STAGE_DISPATCH ), 'the solde did not open expedition' );
		ts_assert( $order->is_paid(), 'a fully settled order is still unpaid' );
		ts_assert( null !== Invoice::stored( $order ), 'the solde did not issue the invoice' );

		// And the ledger says how it got there.
		ts_eq( count( Ledger::receipts( $order ) ), 3, 'the receipts were not all kept' );
		ts_eq( Ledger::received( $order ), $due, 'the ledger does not add up to the order' );

		/*
		 * THE FINAL INVOICE REFERENCES THEM AND DEDUCTS THEM.
		 * BOI-TVA-DECLA-30-20-20-10 § 60: "la facture définitive doit faire
		 * référence aux différentes factures d'acomptes". And the VAT on those
		 * was already declared when they were collected, so what is left to pay
		 * is the total less what they covered.
		 */
		$final = Invoice::stored( $order );
		ts_eq( count( $final['deducted'] ), 2, 'the final invoice deducts no acompte' );
		$covered = 0;
		foreach ( $final['deducted'] as $deduction ) {
			ts_assert( '' !== $deduction['number'], 'an acompte is deducted without its number' );
			$covered += (int) $deduction['ttc'];
		}
		ts_eq( $final['net_to_pay'], $final['total_ttc'] - $covered, 'the net to pay is not the balance' );

		// Every document of the order, in one unbroken run of the same series.
		$numbers = array();
		foreach ( Invoice::documents( $order ) as $document ) {
			$numbers[] = (int) substr( (string) $document['number'], strlen( (string) $document['series'] ) + 1 );
			ts_eq( $document['series'], Invoice::series( Settings::today() ), 'a document left the shop’s series' );
		}
		ts_eq( count( $numbers ), 3, 'the order does not carry three documents' );
		sort( $numbers );
		for ( $i = 1; $i < count( $numbers ); $i++ ) {
			ts_eq( $numbers[ $i ], $numbers[ $i - 1 ] + 1, 'the documents are not consecutive' );
		}

		$order->delete( true );
	} );

	ts_it( 'never lets a status change invent the money that is missing', function () use ( $product_id, $big_order ) {
		/*
		 * A STATUS IS A LABEL A SHOP MANAGER PICKS FROM A DROPDOWN. This hook
		 * used to turn that pick into money: marking a half-paid order
		 * "Terminée" wrote the missing balance into the ledger as though it had
		 * arrived, which opens the one gate that has to hold the parcel.
		 */
		ts_ck_regime( Vat::STANDARD );
		$config = Ledger::config();
		$order  = $big_order( $product_id, (int) $config['deposit_from_ht'] + 100000 );
		Ledger::authorise( $order );
		$order = wc_get_order( $order->get_id() );

		$deposit = Settlement::deposit_due( Ledger::due( $order ), $config );
		Ledger::record( $order, $deposit, 'Virement bancaire', 'VIR-ACOMPTE' );
		$order = wc_get_order( $order->get_id() );

		$order->update_status( 'completed', 'Marquée terminée à la main.' );
		$order = wc_get_order( $order->get_id() );

		ts_eq( Ledger::received( $order ), $deposit, 'a status change wrote money into the ledger' );
		ts_eq( Ledger::state( $order ), Settlement::DEPOSIT, 'the order reads as settled' );
		ts_assert( ! Ledger::stage_allows( $order, Settlement::STAGE_DISPATCH ), 'the parcel left on a status change' );

		$order->delete( true );
	} );

	ts_it( 'issues the final invoice on an order settled in one go through the box', function () use ( $product_id, $big_order ) {
		/*
		 * Every bank transfer on an order nobody authorised a deposit for. The
		 * settlement branch used to fire only for an order already sitting at
		 * `ts-acompte`, so this one stayed `pending` for ever: never marked
		 * paid, and therefore never given the invoice the law requires.
		 */
		ts_ck_regime( Vat::STANDARD );
		$order = $big_order( $product_id, 400000 );
		ts_eq( $order->get_status(), 'pending', 'the fixture is not pending' );

		Ledger::record( $order, Ledger::due( $order ), 'Virement bancaire', 'VIR-INTEGRAL' );
		$order = wc_get_order( $order->get_id() );

		ts_assert( $order->is_paid(), 'a fully settled order was never marked paid' );
		ts_assert( null !== Invoice::stored( $order ), 'and it never got its invoice' );
		ts_eq( count( Invoice::deposits( $order ) ), 0, 'a single settlement produced an acompte invoice' );

		$order->delete( true );
	} );

	ts_it( 'refuses to number an acompte once the final invoice exists', function () use ( $product_id, $big_order ) {
		ts_ck_regime( Vat::STANDARD );
		$order = $big_order( $product_id, 400000 );
		Ledger::record( $order, Ledger::due( $order ), 'Virement bancaire', 'VIR-TOUT' );
		$order = wc_get_order( $order->get_id() );
		ts_assert( null !== Invoice::stored( $order ), 'no final invoice to test against' );

		$refused = Invoice::issue_deposit( $order, array( 'cents' => 1000, 'reference' => 'VIR-APRES', 'date' => Settings::today(), 'method' => 'Virement bancaire' ) );
		ts_assert( is_wp_error( $refused ), 'an acompte was numbered after the final invoice' );
		ts_eq( $refused->get_error_code(), 'teeshoop_already_invoiced', 'refusal reason' );

		$order->delete( true );
	} );

	ts_it( 'stops an order being edited once any money has arrived', function () use ( $product_id, $big_order ) {
		/*
		 * Not the status: a partial transfer on an order nobody authorised a
		 * deposit for leaves it `pending`, which WooCommerce considers editable,
		 * and a facture d'acompte has already been issued against those lines.
		 */
		ts_ck_regime( Vat::STANDARD );
		$order = $big_order( $product_id, 400000 );
		ts_assert( $order->is_editable(), 'an order with no money in it is already locked' );

		Ledger::record( $order, 50000, 'Virement bancaire', 'VIR-PARTIEL' );
		$order = wc_get_order( $order->get_id() );
		ts_eq( $order->get_status(), 'pending', 'the fixture moved status, so this proves nothing' );
		ts_assert( ! $order->is_editable(), 'an order holding a customer’s money could still be edited' );

		$order->delete( true );
	} );

	ts_it( 'records the same encashment once, however many times it arrives', function () use ( $product_id, $big_order ) {
		ts_ck_regime( Vat::STANDARD );
		$order = $big_order( $product_id, 400000 );

		ts_assert( Ledger::record( $order, 120000, 'Virement bancaire', 'VIR-1' ), 'the first was not recorded' );
		$order = wc_get_order( $order->get_id() );
		ts_assert( ! Ledger::record( $order, 120000, 'Virement bancaire', 'VIR-1' ), 'the same reference was recorded twice' );
		$order = wc_get_order( $order->get_id() );
		ts_eq( Ledger::received( $order ), 120000, 'the ledger after one transfer' );

		// Two genuine transfers of the same amount are still two.
		Ledger::record( $order, 120000, 'Virement bancaire', 'VIR-2' );
		$order = wc_get_order( $order->get_id() );
		ts_eq( Ledger::received( $order ), 240000, 'two real transfers were read as one' );

		$order->delete( true );
	} );

	ts_it( 'records a card payment once even though two hooks watch for it', function () use ( $product_id, $sides, $design ) {
		/*
		 * `payment_complete()` fires `woocommerce_payment_complete` AND a status
		 * transition into a paid status, and this file listens to both because
		 * BACS only ever does the second. Both firing for one payment must not
		 * put the money in twice.
		 */
		ts_ck_regime( Vat::STANDARD );
		ts_ck_fill( $product_id, 10, $sides, $design );
		$order = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) ) );
		$order->payment_complete( 'pi_verification' );

		$order = wc_get_order( $order->get_id() );
		ts_eq( count( Ledger::receipts( $order ) ), 1, 'one payment was recorded twice' );
		ts_eq( Ledger::received( $order ), Ledger::due( $order ), 'the ledger and the order disagree' );
		ts_eq( Ledger::state( $order ), Settlement::PAID, 'a completed card payment' );

		$order->delete( true );
	} );

	ts_it( 'carries the acompte status in WooCommerce’s own list', function () {
		$statuses = wc_get_order_statuses();
		ts_assert( isset( $statuses[ Ledger::STATUS ] ), 'the status is not registered' );
		// And it is NOT a paid status, which is what keeps the invoice shut.
		ts_assert( ! in_array( 'ts-acompte', wc_get_is_paid_statuses(), true ), 'an acompte counts as paid' );
	} );

	// ── the payment rail ─────────────────────────────────────────────────────

	ts_it( 'says out loud when nothing can take money', function () {
		// The mirror has no gateway configured, which is the state constat 6
		// records on the real shop too: "aucun moyen de paiement n'est activé
		// aujourd'hui". A shop in that state must not read as ready.
		$gateways = Payment::enabled();
		if ( empty( $gateways ) ) {
			ts_assert( ! Payment::ready(), 'a shop that can encash nothing reported itself ready' );
			ts_assert( ts_ck_any( Payment::problems(), 'Aucun moyen de paiement' ), 'and said nothing about it' );
			return;
		}
		foreach ( $gateways as $id => $gateway ) {
			ts_assert(
				in_array( $gateway['environment'], array( Payment::LIVE, Payment::TEST, Payment::UNCONFIGURED, Payment::UNKNOWN ), true ),
				"gateway {$id} reported an environment nobody can read"
			);
		}
	} );

	ts_it( 'sees a payment method that is switched on and cannot take a cent', function () {
		/*
		 * THE CASE THE FIRST VERSION COULD NOT SEE, and the one that matters:
		 * `get_available_payment_gateways()` is the CUSTOMER's list, so a
		 * gateway enabled without its keys is absent from it, and an alarm built
		 * on that list reported a clean shop with zero problems.
		 */
		$saved = get_option( 'woocommerce_cheque_settings', array() );
		update_option( 'woocommerce_cheque_settings', array( 'enabled' => 'yes', 'title' => 'Chèque' ) );

		$hide = static function ( $gateways ) {
			unset( $gateways['cheque'] );
			return $gateways;
		};
		add_filter( 'woocommerce_available_payment_gateways', $hide, 99 );
		WC()->payment_gateways()->init();

		$listed = Payment::enabled();
		ts_assert( isset( $listed['cheque'] ), 'a gateway that is on was not listed at all' );
		ts_eq( $listed['cheque']['offered'], false, 'it was reported as offered to the customer' );
		ts_assert( ts_ck_any( Payment::problems(), 'n’apparaît pas au paiement' ), 'and nothing was said about it' );
		ts_assert( ! Payment::ready(), 'a shop with an unusable method reported itself ready' );

		remove_filter( 'woocommerce_available_payment_gateways', $hide, 99 );
		update_option( 'woocommerce_cheque_settings', $saved );
		WC()->payment_gateways()->init();
	} );

	ts_it( 'refuses a basket that would cost nothing', function () use ( $product_id, $sides, $design, $saved_pricing ) {
		/*
		 * "Test mode that silently falls back to no payment required" is how a
		 * shop ships free orders: WooCommerce skips payment entirely when the
		 * total is zero, so a price config zeroed by a bad edit would not fail,
		 * it would quietly print and post fifty garments.
		 */
		ts_ck_regime( Vat::STANDARD );
		update_option(
			'teeshoop_pricing',
			array_merge(
				(array) $saved_pricing,
				array(
					'garments' => array( 'tee' => array( 'base_ht' => 0, 'first_side_ht' => 0, 'extra_side_ht' => 0 ) ),
					'min_qty'  => 0,
					'min_ht'   => 0,
				)
			)
		);

		ts_ck_fill( $product_id, 10, $sides, $design );
		ts_eq( Money::from_eur( (string) WC()->cart->get_subtotal() ), 0, 'the fixture did not reach a zero price' );

		$problems = Checkout::selling_problems( WC()->cart, 'staging' );
		ts_assert( ts_ck_any( $problems, 'ne coûtent rien' ), 'ten free garments would have gone through' );

		update_option( 'teeshoop_pricing', $saved_pricing );
		WC()->cart->empty_cart();
	} );

	// ── put it back ──────────────────────────────────────────────────────────

	WC()->cart->empty_cart();
	// The delivery zone goes too: left behind, it makes `wp teeshoop
	// provisionner` believe the shop already has one and skip its own.
	foreach ( WC_Shipping_Zones::get_zones() as $zone ) {
		if ( 'Vérification' === $zone['zone_name'] ) {
			WC_Shipping_Zones::delete_zone( (int) $zone['id'] );
		}
	}
	if ( null === $saved_vat ) {
		delete_option( 'teeshoop_vat' );
	} else {
		update_option( 'teeshoop_vat', $saved_vat );
	}
	update_option( 'teeshoop_legal', $saved_legal );
	update_option( 'teeshoop_pricing', $saved_pricing );
	update_option( 'woocommerce_calc_taxes', $saved_taxes );
}
