<?php
/**
 * The margin report, against a real WooCommerce order.
 *
 * The pure tests prove the formulas. They cannot prove the thing that actually
 * goes wrong here, which is the seam: an order's HT read one way by the invoice
 * and another way by the profitability screen, a discount counted twice, a
 * carriage line that is revenue on one side and cost on neither. A shop whose
 * margin engine disagrees with its own invoice is worse than one with no margin
 * engine, because it is believed.
 *
 * So the first assertion is the reconciliation, to the cent, against the ISSUED
 * document rather than against a recomputation.
 *
 * Run from integration.php, which owns the products and the bootstrap.
 *
 * @package Teeshoop\Core
 */

/* COMMAND LINE ONLY. See run.php. */
if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

use Teeshoop\Core\Cart;
use Teeshoop\Core\Commission;
use Teeshoop\Core\Cost;
use Teeshoop\Core\Costing;
use Teeshoop\Core\Invoice;
use Teeshoop\Core\Ledger;
use Teeshoop\Core\Money;
use Teeshoop\Core\Settings;
use Teeshoop\Core\Vat;

/**
 * One printed side with real transfer geometry, as the studio measures it.
 *
 * Two visuals on the chest, which is what `src/lib/ink.ts` produces for a lockup
 * with a separate line under it, and the reason the film cost is not a function
 * of the area alone.
 */
function ts_mg_sides(): array {
	return array(
		array(
			'id'         => 'front',
			'area_sq_cm' => 400.0,
			'pieces'     => array(
				array( 'w_cm' => 18.0, 'h_cm' => 14.5 ),
				array( 'w_cm' => 12.0, 'h_cm' => 3.2 ),
			),
		),
	);
}

function ts_mg_order( int $product_id, int $qty, array $sides, string $method = 'bacs' ): \WC_Order {
	ts_ck_fill( $product_id, $qty, $sides );
	$order = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => $method ) ) );
	return $order;
}

function ts_margin_suite( int $product_id ): void {
	$saved_costing    = get_option( 'teeshoop_costing', array() );
	$saved_commission = get_option( 'teeshoop_commission', array() );

	ts_ck_regime( Vat::STANDARD );
	ts_ck_customer_in_france();

	/*
	 * A purchase price for the studio tee, typed exactly as an operator would on
	 * the "Coûts et marges" screen. Without it the textile is UNKNOWN, which is
	 * the shipped state and its own test below.
	 */
	update_option(
		'teeshoop_costing',
		array(
			'garment_supply' => array(
				'tee' => array(
					'ht'     => 337,
					'source' => 'Tarif fournisseur de vérification',
					'on'     => '2026-08-01',
				),
			),
		)
	);

	echo "\nCoût, plancher et commission\n";

	// ── the reconciliation ───────────────────────────────────────────────────

	ts_it( 'reports the same HT as the invoice it will be checked against', function () use ( $product_id ) {
		$order = ts_mg_order( $product_id, 12, ts_mg_sides() );
		$order->payment_complete( 'ts-marge-1' );

		$issued = Invoice::issue( wc_get_order( $order->get_id() ) );
		ts_assert( ! is_wp_error( $issued ), 'the order could not be invoiced at all' );

		$doc    = Invoice::stored( wc_get_order( $order->get_id() ) );
		$report = Costing::compute( wc_get_order( $order->get_id() ) );

		ts_eq( (int) $report['revenue']['total_ht'], (int) $doc['total_ht'], 'the report and the invoice disagree on the HT' );
		ts_eq( (int) $report['revenue']['total_ttc'], (int) $doc['total_ttc'], 'and on the TTC' );

		// And the margin really is that revenue minus that cost, with nothing
		// rounded twice on the way.
		ts_eq(
			(int) $report['verdict']['margin_ht'],
			(int) $doc['total_ht'] - (int) $report['cost']['total_ht'],
			'the margin is not the difference it claims to be'
		);

		$order->delete( true );
	} );

	// ── the cost is built from the order, not from a constant ────────────────

	ts_it( 'costs the blanks from the purchase price, times the real quantity', function () use ( $product_id ) {
		$order  = ts_mg_order( $product_id, 12, ts_mg_sides() );
		$report = Costing::compute( $order );

		ts_eq( (int) $report['blanks']['total_ht'], 337 * 12, 'twelve tees at 3,37 EUR' );
		ts_eq( (int) $report['blanks']['unknown'], 0, 'no line was left without a purchase price' );

		$textile = 0;
		foreach ( $report['cost']['lines'] as $line ) {
			if ( 'textile' === $line['type'] ) {
				$textile += (int) $line['amount_ht'];
			}
		}
		ts_eq( $textile, 337 * 12, 'the textile component is the blanks total' );

		$order->delete( true );
	} );

	ts_it( 'counts one press per transfer and not one per garment', function () use ( $product_id ) {
		$order  = ts_mg_order( $product_id, 12, ts_mg_sides() );
		$report = Costing::compute( $order );

		// Two visuals on one side, twelve garments: 24 transfers, not 12.
		ts_eq( (int) $report['work']['transfers'], 24, 'transfers' );
		ts_eq( (int) $report['work']['garments'], 12, 'garments' );
		ts_assert( (bool) $report['work']['complete'], 'the geometry should be complete' );
		ts_eq( count( $report['work']['pieces'] ), 2, 'two distinct transfers, each with a quantity' );

		$order->delete( true );
	} );

	ts_it( 'costs the film from a length, and says which length it used', function () use ( $product_id ) {
		$order  = ts_mg_order( $product_id, 12, ts_mg_sides() );
		$report = Costing::compute( $order );

		ts_assert( is_array( $report['film'] ), 'no film cost at all' );
		ts_assert( (float) $report['film']['billed_m'] > 0, 'a printed order with no film' );

		/*
		 * WHICHEVER of the two states this mirror is in, the report has to
		 * describe the one it is in. With the nesting service reachable the film
		 * is a packing and `bound` is absent; without it, it is the prudent
		 * bound and `bound` says so. What must never happen is a report that
		 * used the bound and does not admit it, because the bound overstates the
		 * cost and therefore the floor.
		 */
		ts_eq(
			! empty( $report['film']['bound'] ),
			! (bool) $report['nest']['ok'],
			'the report does not say which length it used'
		);

		$marking = 0;
		foreach ( $report['cost']['lines'] as $line ) {
			if ( 'marquage' === $line['type'] ) {
				$marking += (int) $line['amount_ht'];
			}
		}
		ts_eq( $marking, (int) $report['film']['amount_ht'], 'the marking component is the film cost' );

		$order->delete( true );
	} );

	ts_it( 'charges the carriage we bear even when the customer paid none', function () use ( $product_id ) {
		// Small enough to be under the 300,00 EUR franco: the buyer pays for the
		// parcel and so do we, and the two must both appear.
		$order  = ts_mg_order( $product_id, 6, ts_mg_sides() );
		$report = Costing::compute( $order );

		$carriage = 0;
		foreach ( $report['cost']['lines'] as $line ) {
			if ( 'livraison' === $line['type'] ) {
				$carriage += (int) $line['amount_ht'];
			}
		}
		ts_eq( $carriage, (int) $report['parcel']['carrier_ht'], 'the carriage cost is what the grid says' );
		ts_assert( $carriage > 0, 'a shipped order that costs us nothing to ship' );

		$order->delete( true );
	} );

	ts_it( 'charges no card fee on a transfer', function () use ( $product_id ) {
		$order  = ts_mg_order( $product_id, 6, ts_mg_sides(), 'bacs' );
		$report = Costing::compute( $order );

		foreach ( $report['cost']['lines'] as $line ) {
			if ( 'paiement' === $line['type'] ) {
				ts_eq( (int) $line['amount_ht'], 0, 'a bank transfer costs no platform fee' );
				ts_eq( (string) $line['confidence'], Cost::NONE, 'and that zero is answered, not missing' );
			}
		}
		$order->delete( true );
	} );

	// ── what is missing is said ──────────────────────────────────────────────

	ts_it( 'never calls a cost complete while three components are unmeasured', function () use ( $product_id ) {
		$order  = ts_mg_order( $product_id, 12, ts_mg_sides() );
		$report = Costing::compute( $order );

		ts_assert( ! (bool) $report['cost']['complete'], 'the shipped configuration cannot produce a complete cost' );
		ts_assert(
			in_array( 'consommables', (array) $report['cost']['unknown'], true )
				&& in_array( 'defaut', (array) $report['cost']['unknown'], true ),
			'the two unmeasured provisions must be named'
		);

		$order->delete( true );
	} );

	ts_it( 'reports the textile as unknown when no purchase price is set, and not as free', function () use ( $product_id ) {
		update_option( 'teeshoop_costing', array( 'garment_supply' => array() ) );

		$order  = ts_mg_order( $product_id, 12, ts_mg_sides() );
		$report = Costing::compute( $order );

		ts_eq( (int) $report['blanks']['total_ht'], 0, 'nothing costed' );
		ts_assert( in_array( 'textile', (array) $report['cost']['unknown'], true ), 'the textile must be UNKNOWN, not zero' );

		$order->delete( true );

		update_option(
			'teeshoop_costing',
			array( 'garment_supply' => array( 'tee' => array( 'ht' => 337, 'source' => 'Tarif fournisseur de vérification', 'on' => '2026-08-01' ) ) )
		);
	} );

	ts_it( 'costs an order whose design carries no geometry as unknown film', function () use ( $product_id ) {
		// A side with an area and no pieces: exactly what an order taken before
		// the studio started recording the rectangles looks like.
		$order  = ts_mg_order( $product_id, 12, array( array( 'id' => 'front', 'area_sq_cm' => 400.0 ) ) );
		$report = Costing::compute( $order );

		ts_assert( ! (bool) $report['work']['complete'], 'the geometry is not complete and the report says otherwise' );
		ts_assert( in_array( 'marquage', (array) $report['cost']['unknown'], true ), 'the film must be UNKNOWN' );
		ts_eq( (int) $report['work']['transfers'], 12, 'the presses are still counted, so the labour is not free too' );

		$order->delete( true );
	} );

	ts_it( 'says so when the order is not in the size the film was measured at', function () use ( $product_id ) {
		// Six garments spread over three sizes, only two of them at M. The
		// rectangles were measured at M and the film is costed on them, which
		// understates a run of large sizes by up to half. Question 37.
		WC()->cart->empty_cart();
		$key = Cart::add(
			array(
				'product_id' => $product_id,
				'qty'        => 6,
				'sides'      => ts_mg_sides(),
				'design_id'  => 'abcdefghijklmnop1234',
				'size_grid'  => array( 'M' => 2, 'XL' => 2, '3XL' => 2 ),
			)
		);
		ts_assert( ! is_wp_error( $key ), 'the size grid was refused' );
		WC()->cart->calculate_totals();
		$order  = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) ) );
		$report = Costing::compute( $order );

		ts_assert( (bool) $report['work']['graded'], 'the report did not notice the sizes' );
		$said = false;
		foreach ( (array) $report['warnings'] as $warning ) {
			if ( str_contains( (string) $warning, 'question 37' ) ) {
				$said = true;
			}
		}
		ts_assert( $said, 'a graded order must say the film is costed at one size' );

		$order->delete( true );
	} );

	ts_it( 'says nothing about sizes on an order that is entirely in the priced one', function () use ( $product_id ) {
		WC()->cart->empty_cart();
		Cart::add(
			array(
				'product_id' => $product_id,
				'qty'        => 6,
				'sides'      => ts_mg_sides(),
				'design_id'  => 'abcdefghijklmnop1234',
				'size_grid'  => array( 'M' => 6 ),
			)
		);
		WC()->cart->calculate_totals();
		$order  = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) ) );
		$report = Costing::compute( $order );

		ts_assert( ! (bool) $report['work']['graded'], 'a warning that fires on every order is a warning nobody reads' );

		$order->delete( true );
	} );

	// ── the floor, the verdict and the exception ─────────────────────────────

	ts_it( 'finds that the published tariff clears its own floor at no quantity', function () use ( $product_id ) {
		/*
		 * THIS IS A FINDING, NOT A REGRESSION, and it is why the assertion is
		 * shaped the way it is.
		 *
		 * At the shipped demonstration tariff, a purchase price of 3,37 EUR and
		 * question 06's rates (55 % target, 25 % minimum contribution), a run of
		 * twelve tees sells at 147,84 EUR HT against a recommended 214,04 EUR and
		 * a floor of 128,43 EUR. It is above the floor with the film really
		 * nested and BELOW it when the nesting service is unreachable and the
		 * prudent bound is used, which is the state of this mirror. Either way it
		 * is past the 15 % a salesperson may give away unaided.
		 *
		 * So what is asserted is the thing that is true in both states: the
		 * engine refuses to call this sale free. The measured table, at every
		 * quantity on the public grid, is in QUESTIONS-ASSOCIE.md, because which
		 * of the two numbers moves is his decision and not ours.
		 */
		$order  = ts_mg_order( $product_id, 12, ts_mg_sides() );
		$report = Costing::compute( $order );

		ts_assert( (int) $report['plan']['floor_ht'] > (int) $report['cost']['total_ht'], 'a floor at or under cost is not a floor' );
		ts_assert(
			(bool) $report['verdict']['below_floor'] || (bool) $report['verdict']['needs_approval'],
			'the shipped tariff cleared its own floor, which it has never done: re-measure before changing this test'
		);
		ts_assert(
			(bool) $report['verdict']['below_floor'] === ( (int) $report['revenue']['total_ht'] < (int) $report['plan']['floor_ht'] ),
			'the verdict does not describe its own numbers'
		);

		ts_eq( (string) $report['sale_type'], 'site', 'an unclaimed order was sold by nobody' );
		ts_eq( (int) $report['commission']['full_ht'], 0, 'and pays no commission' );

		$order->delete( true );
	} );

	ts_it( 'refuses to record a derogation that does not name all four things', function () use ( $product_id ) {
		$order = ts_mg_order( $product_id, 12, ts_mg_sides() );

		$order->update_meta_data( Costing::META_DEROGATION, wp_json_encode( array( 'reason' => 'concurrence', 'approver' => '', 'until' => '2030-01-01', 'on' => Settings::today() ) ) );
		$order->save();
		ts_eq( Costing::derogation( wc_get_order( $order->get_id() ) ), null, 'a derogation with no approver is a note' );

		$order->delete( true );
	} );

	ts_it( 'stops honouring a derogation once the floor has moved under it', function () use ( $product_id ) {
		$order  = ts_mg_order( $product_id, 12, ts_mg_sides() );
		$report = Costing::compute( $order );

		$granted = array(
			'reason'    => 'Client stratégique',
			'approver'  => 'Le dirigeant',
			'until'     => '2099-01-01',
			'on'        => Settings::today(),
			'price_ht'  => (int) $report['verdict']['price_ht'],
			'floor_ht'  => (int) $report['plan']['floor_ht'],
			'impact_ht' => 0,
		);
		$order->update_meta_data( Costing::META_DEROGATION, wp_json_encode( $granted ) );
		$order->save();

		$stored = Costing::derogation( wc_get_order( $order->get_id() ) );
		ts_assert(
			Costing::derogation_covers( $stored, $report['verdict'], $report['plan'], Settings::today() ),
			'the derogation it was granted on does not cover it'
		);

		// The cost is corrected upwards, so the floor rises: nobody authorised
		// the larger shortfall.
		$higher = $report['plan'];
		$higher['floor_ht'] = (int) $higher['floor_ht'] + 1;
		ts_assert(
			! Costing::derogation_covers( $stored, $report['verdict'], $higher, Settings::today() ),
			'a derogation must not stretch to cover a floor nobody showed the approver'
		);

		$order->delete( true );
	} );

	// ── the commission is on money that arrived ──────────────────────────────

	ts_it( 'pays a share of a deposit and the rest on the balance', function () use ( $product_id ) {
		$order = ts_mg_order( $product_id, 12, ts_mg_sides() );
		$order->update_meta_data( Costing::META_SALE_TYPE, 'premiere' );
		$order->save();

		$before = Costing::compute( wc_get_order( $order->get_id() ) );
		ts_eq( (int) $before['commission']['earned_ht'], 0, 'nothing has been paid, nothing is earned' );
		ts_assert( (int) $before['commission']['full_ht'] > 0, 'a first order at 40 % earns something eventually' );

		$half = (int) round( Ledger::due( wc_get_order( $order->get_id() ) ) / 2 );
		Ledger::record( wc_get_order( $order->get_id() ), $half, 'virement', 'ts-acompte-marge' );

		$mid = Costing::compute( wc_get_order( $order->get_id() ) );
		ts_assert( (int) $mid['commission']['earned_ht'] > 0, 'a deposit earns nothing at all' );
		ts_assert(
			(int) $mid['commission']['earned_ht'] < (int) $mid['commission']['full_ht'],
			'a deposit earned the whole commission'
		);
		ts_eq( (string) $mid['state']['state'], Commission::PROVISIONAL, 'a half-paid order has a provisional commission' );

		$order->delete( true );
	} );

	ts_it( 'never makes a commission definitive on estimated costs', function () use ( $product_id ) {
		$order = ts_mg_order( $product_id, 12, ts_mg_sides() );
		$order->update_meta_data( Costing::META_SALE_TYPE, 'premiere' );
		$order->update_meta_data( Costing::META_DELIVERED, '2020-01-01' );
		$order->save();
		$order->payment_complete( 'ts-marge-2' );

		$report = Costing::compute( wc_get_order( $order->get_id() ) );
		ts_eq( (string) $report['state']['state'], Commission::PROVISIONAL, 'paid, delivered long ago, and still not definitive' );
		ts_assert( ! empty( $report['state']['open'] ), 'and it must say why' );

		$order->delete( true );
	} );

	// ── the report is stored, not recomputed on every look ───────────────────

	ts_it( 'freezes the report until somebody asks for a new one', function () use ( $product_id ) {
		$order = ts_mg_order( $product_id, 12, ts_mg_sides() );

		$first = Costing::refresh( $order );
		$cost_before = (int) $first['cost']['total_ht'];

		// The hourly rate doubles. A stored report must not change under it.
		update_option(
			'teeshoop_costing',
			array(
				'hourly_ht'      => 4000,
				'garment_supply' => array( 'tee' => array( 'ht' => 337, 'source' => 'Tarif fournisseur de vérification', 'on' => '2026-08-01' ) ),
			)
		);

		$stored = Costing::stored( wc_get_order( $order->get_id() ) );
		ts_eq( (int) $stored['cost']['total_ht'], $cost_before, 'the stored report moved when a rate did' );

		$fresh = Costing::refresh( wc_get_order( $order->get_id() ) );
		ts_assert( (int) $fresh['cost']['total_ht'] > $cost_before, 'recomputing did not pick the new rate up' );

		$order->delete( true );
		update_option(
			'teeshoop_costing',
			array( 'garment_supply' => array( 'tee' => array( 'ht' => 337, 'source' => 'Tarif fournisseur de vérification', 'on' => '2026-08-01' ) ) )
		);
	} );

	// ── the guard that matters most ──────────────────────────────────────────

	ts_it( 'never lets a purchase price or a commission onto an order the customer sees', function () use ( $product_id ) {
		$order = ts_mg_order( $product_id, 12, ts_mg_sides() );
		Costing::refresh( $order );

		$order = wc_get_order( $order->get_id() );
		foreach ( $order->get_items() as $item ) {
			foreach ( $item->get_formatted_meta_data() as $meta ) {
				ts_assert(
					! str_contains( strtolower( (string) $meta->display_key ), 'commission' )
						&& ! str_contains( strtolower( (string) $meta->display_key ), 'marge' ),
					'a line displays margin material to the customer'
				);
			}
		}

		// The report lives on the ORDER, under an underscore key, so it is never
		// in the formatted meta a customer's order page renders.
		ts_assert( str_starts_with( Costing::META_REPORT, '_' ), 'the report meta key is public' );

		$order->delete( true );
	} );

	update_option( 'teeshoop_costing', is_array( $saved_costing ) ? $saved_costing : array() );
	update_option( 'teeshoop_commission', is_array( $saved_commission ) ? $saved_commission : array() );
}
