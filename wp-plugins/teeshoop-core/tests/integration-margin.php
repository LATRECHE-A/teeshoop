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
use Teeshoop\Core\CostAdmin;
use Teeshoop\Core\Product;
use const Teeshoop\Core\OPTION_PRICE_RULES;
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
			/*
			 * THE INK, AND IT HAS TO FIT IN THE RECTANGLES. 18 x 14,5 and
			 * 12 x 3,2 box 299,4 cm², so an ink union of 288 cm² is a design
			 * that could exist. An earlier version of this fixture said 400 cm²
			 * of ink inside 299 cm² of transfers, which is not a garment, and
			 * the consistency check in Design::normalise_pieces refused it, as
			 * it is meant to.
			 */
			'area_sq_cm' => 288.0,
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
	$saved_rules      = get_option( OPTION_PRICE_RULES, array() );

	/*
	 * CLEARED AT THE START AND NOT ONLY AT THE END. A test that fails throws
	 * before its own cleanup, and a price rule left in the option then changes
	 * the floor of every order the NEXT run computes: one broken assertion would
	 * otherwise be followed by two mystifying ones about numbers that moved for
	 * no visible reason. Found exactly that way.
	 */
	update_option( OPTION_PRICE_RULES, array() );

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

	ts_it( 'costs a catalogue price at the prudent end, and reports the other one', function () use ( $product_id ) {
		/*
		 * The chapter: "Lorsque le seul prix disponible est un prix catalogue à
		 * diviser par 2 à 2,5, le système doit marquer le coût comme estimé et
		 * utiliser le scénario prudent." Prudent is the SMALLER divisor and so
		 * the LARGER cost: a 12,00 EUR catalogue price is costed at 6,00 EUR and
		 * not at 4,80 EUR, and the 4,80 EUR travels beside it so the screen can
		 * show the width of what nobody has confirmed.
		 */
		update_option(
			'teeshoop_costing',
			array(
				'garment_supply' => array(
					'tee' => array( 'ht' => 1200, 'source' => 'Tarif public', 'on' => '2026-08-01', 'catalogue' => true ),
				),
			)
		);

		$order  = ts_mg_order( $product_id, 10, ts_mg_sides() );
		$report = Costing::compute( $order );

		ts_eq( (int) $report['blanks']['total_ht'], 6000, 'ten garments at the prudent half of 12,00 EUR' );
		ts_eq( (int) $report['blanks']['best_ht'], 4800, 'and at the optimistic 2,5 divisor' );
		ts_assert(
			(int) $report['cost']['best_ht'] < (int) $report['cost']['total_ht'],
			'the report must carry both ends, or the estimate looks like a measurement'
		);
		ts_assert( (bool) $report['cost']['estimated'], 'a catalogue price is not a tariff' );

		$order->delete( true );

		// Back to a real purchase price for the rest of the suite.
		update_option(
			'teeshoop_costing',
			array( 'garment_supply' => array( 'tee' => array( 'ht' => 337, 'source' => 'Tarif fournisseur de vérification', 'on' => '2026-08-01' ) ) )
		);
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
		$order  = ts_mg_order( $product_id, 12, array( array( 'id' => 'front', 'area_sq_cm' => 288.0 ) ) );
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

	ts_it( 'the published tariff clears its own floor, which it did not until 4 September 2026', function () use ( $product_id ) {
		/*
		 * CE TEST A ÉTÉ RETOURNÉ, ET LA MESURE EST DANS LE MESSAGE DE COMMIT.
		 *
		 * Il assertait l'INVERSE : « le tarif publié ne franchit son plancher à
		 * aucune quantité », avec un commentaire disant que c'était un CONSTAT et
		 * pas une régression, et une phrase d'échec demandant de re-mesurer avant
		 * de le changer. Cela a été fait le 4 septembre 2026 :
		 * `tests/integration-grille.php` a mesuré 102 des 219 colonnes publiées
		 * sous leur plancher, sur les vraies références, à la surface que la
		 * grille promet ; le tarif a été dérivé du plancher lui-même
		 * (docs/decisions/2026-09-04-le-tarif-derive-du-plancher.md).
		 *
		 * Ce qui est asserté maintenant est la propriété que ce changement a
		 * achetée, et elle est plus forte que l'ancienne : une douzaine de
		 * t-shirts ne se vend PAS sous son plancher. La première assertion, elle,
		 * n'a pas bougé : un plancher au niveau du coût ou en dessous n'est pas
		 * un plancher, quel que soit le tarif.
		 */
		$order  = ts_mg_order( $product_id, 12, ts_mg_sides() );
		$report = Costing::compute( $order );

		ts_assert( (int) $report['plan']['floor_ht'] > (int) $report['cost']['total_ht'], 'a floor at or under cost is not a floor' );
		ts_assert(
			! (bool) $report['verdict']['below_floor'],
			'le tarif publié est repassé sous son plancher : relancez « npm run verify:grille », qui dit quelle colonne et de combien'
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

	// ── the scoped floors ────────────────────────────────────────────────────

	ts_it( 'reads the six facts a rule can select an order on', function () use ( $product_id ) {
		$order = ts_mg_order( $product_id, 12, ts_mg_sides() );
		$order->update_meta_data( Costing::META_SELLER, 'Karim B.' );
		$order->update_meta_data( Costing::META_CLIENT, 'professionnel' );
		$order->update_meta_data( Costing::META_URGENCE, 'standard' );
		$order->save();

		$facts = Costing::facts( wc_get_order( $order->get_id() ) );
		ts_eq( $facts['famille'], 'tee', 'the studio garment, in the catalogue’s vocabulary' );
		ts_eq( $facts['technique'], 'dtf', 'the only thing the studio produces' );
		ts_eq( $facts['commercial'], 'Karim B.', 'the seller' );
		ts_eq( $facts['client'], 'professionnel', 'the client type' );
		ts_eq( $facts['urgence'], 'standard', 'the urgency' );
		ts_eq( $facts['quantite'], 12, 'the garments' );

		$order->delete( true );
	} );

	ts_it( 'moves the floor of the orders a rule names, and says which rule did it', function () use ( $product_id ) {
		$order = ts_mg_order( $product_id, 12, ts_mg_sides() );
		$before = Costing::compute( $order );
		ts_eq( $before['rule'], null, 'nothing applies before a rule exists' );

		update_option(
			OPTION_PRICE_RULES,
			array(
				array(
					'id'                    => 'r-tee',
					'label'                 => 'T-shirts en volume',
					'active'                => true,
					'famille'               => 'tee',
					'qty_min'               => 10,
					'min_contribution_rate' => '15',
				),
			)
		);

		$after = Costing::compute( wc_get_order( $order->get_id() ) );
		ts_eq( $after['rule']['label'], 'T-shirts en volume', 'the report must name the rule that priced it' );
		ts_assert(
			(int) $after['plan']['floor_ht'] < (int) $before['plan']['floor_ht'],
			'a thinner contribution must lower the floor, which is what a rule is for'
		);
		ts_eq(
			(int) $after['plan']['recommended_ht'],
			(int) $before['plan']['recommended_ht'],
			'and it must not touch the target margin it said nothing about'
		);

		update_option( OPTION_PRICE_RULES, array() );
		$order->delete( true );
	} );

	ts_it( 'leaves an order the rule does not name exactly where it was', function () use ( $product_id ) {
		$order  = ts_mg_order( $product_id, 12, ts_mg_sides() );
		$before = Costing::compute( $order );

		update_option(
			OPTION_PRICE_RULES,
			array(
				array( 'id' => 'r-sweat', 'label' => 'Sweats', 'active' => true, 'famille' => 'sweat', 'min_contribution_rate' => '5' ),
			)
		);

		$after = Costing::compute( wc_get_order( $order->get_id() ) );
		ts_eq( $after['rule'], null, 'a rule for another family must not apply' );
		ts_eq( (int) $after['plan']['floor_ht'], (int) $before['plan']['floor_ht'], 'and the floor must not move' );

		update_option( OPTION_PRICE_RULES, array() );
		$order->delete( true );
	} );

	ts_it( 'marks every stored report stale the moment a rule is written', function () use ( $product_id ) {
		/*
		 * THE HALF AN ORDER-ONLY CHECK COULD NEVER CATCH. Writing a rule changes
		 * the floor of every order it matches and touches no order at all, so a
		 * freshness check built on the order alone goes on saying "à jour" while
		 * the derogation form offers an exception against a floor that has been
		 * replaced.
		 */
		$order  = ts_mg_order( $product_id, 12, ts_mg_sides() );
		$report = Costing::refresh( $order );
		ts_assert( Costing::current( wc_get_order( $order->get_id() ), $report ), 'a fresh report describes its own order' );

		update_option(
			OPTION_PRICE_RULES,
			array( array( 'id' => 'r-x', 'label' => 'Une règle', 'active' => true, 'min_contribution_rate' => '30' ) )
		);

		ts_eq( Costing::staleness( wc_get_order( $order->get_id() ), $report ), 'reglages', 'and it must say WHICH kind of stale' );
		ts_assert( ! Costing::current( wc_get_order( $order->get_id() ), $report ), 'a report computed under other rules is not current' );

		update_option( OPTION_PRICE_RULES, array() );
		$order->delete( true );
	} );

	ts_it( 'reports no floor at all rather than dying, when a rule has no solution', function () use ( $product_id ) {
		$order = ts_mg_order( $product_id, 12, ts_mg_sides() );
		$order->update_meta_data( Costing::META_SALE_TYPE, 'premiere' );
		$order->save();

		// 65 % kept after 40 % of the margin is commissioned: impossible at any
		// price. Margin::plan throws, and an order screen is on the other side.
		update_option(
			OPTION_PRICE_RULES,
			array( array( 'id' => 'r-imp', 'label' => 'Impossible', 'active' => true, 'min_contribution_rate' => '65' ) )
		);

		$report = Costing::compute( wc_get_order( $order->get_id() ) );
		ts_eq( $report['plan'], null, 'no plan rather than a fatal' );
		ts_eq( $report['verdict'], null, 'and no verdict either' );
		ts_assert( (int) $report['cost']['total_ht'] > 0, 'the cost is still worth reading' );
		ts_eq( (bool) $report['covered'], false, 'nothing can be shown to be covered without a floor' );

		$said = false;
		foreach ( (array) $report['warnings'] as $warning ) {
			if ( str_contains( (string) $warning, 'Impossible' ) ) {
				$said = true;
			}
		}
		ts_assert( $said, 'the warning must name the rule in question' );

		// And it survives being stored and read back, which is what the screen does.
		Costing::refresh( wc_get_order( $order->get_id() ) );
		ts_eq( Costing::stored( wc_get_order( $order->get_id() ) )['plan'], null, 'and it survives being stored and read back' );

		update_option( OPTION_PRICE_RULES, array() );
		$order->delete( true );
	} );

	ts_it( 'never lets a rule survive a save of the cost settings', function () {
		/*
		 * THROUGH THE REAL HANDLER, not through update_option. The mechanism that
		 * deleted `billing_step_cm` and 291,94 EUR of floor price was `save()`
		 * rewriting an option from a literal, and a test that writes the option
		 * itself could never have caught it: it would agree with itself while the
		 * shipped code did something else. `persist()` is `save()` minus the
		 * redirect, so this drives the code the screen drives.
		 */
		update_option(
			OPTION_PRICE_RULES,
			array( array( 'id' => 'r-keep', 'label' => 'À garder', 'active' => true, 'min_contribution_rate' => '30' ) )
		);

		// Exactly what the form posts when somebody changes the hourly rate.
		CostAdmin::persist(
			array(
				'couts' => array(
					'hourly_ht' => '25,00',
					'film'      => array( 'rate_fr_ht' => '17,00' ),
				),
			)
		);

		$rules = Costing::rules_table();
		ts_eq( count( $rules ), 1, 'saving the cost settings deleted the rules' );
		ts_eq( $rules[0]['label'], 'À garder', 'and the rule is intact' );
		ts_eq( Costing::config()['hourly_ht'], 2500, 'while the field that was posted really moved' );
		ts_assert(
			array_key_exists( 'billing_step_cm', Costing::config()['film'] ),
			'and the film key the form does not render is still there'
		);

		update_option( OPTION_PRICE_RULES, array() );
		update_option(
			'teeshoop_costing',
			array( 'garment_supply' => array( 'tee' => array( 'ht' => 337, 'source' => 'Tarif fournisseur de vérification', 'on' => '2026-08-01' ) ) )
		);
	} );

	ts_it( 'keeps an apostrophe in a rule name through two saves', function () {
		// WordPress addslashes every superglobal. Stored raw, "Réassort d'un
		// client" grows a backslash on every save until a selector containing one
		// matches nothing at all.
		$post = array(
			'regles' => array(
				array( 'label' => "Réassort d'un client", 'active' => '1', 'famille' => 'tee', 'min_contribution_rate' => '15' ),
			),
		);
		CostAdmin::persist( $post );
		$once = Costing::rules_table();
		ts_eq( $once[0]['label'], "Réassort d'un client", 'the name came back changed after one save' );

		// The second save posts back what the screen rendered, id and all.
		CostAdmin::persist(
			array(
				'regles' => array(
					array(
						'id'                    => $once[0]['id'],
						'label'                 => $once[0]['label'],
						'active'                => '1',
						'famille'               => 'tee',
						'min_contribution_rate' => '15',
					),
				),
			)
		);
		$twice = Costing::rules_table();
		ts_eq( $twice[0]['label'], "Réassort d'un client", 'nor after two' );
		ts_eq( $twice[0]['id'], $once[0]['id'], 'and the identity a frozen report names must not move' );

		update_option( OPTION_PRICE_RULES, array() );
	} );

	ts_it( 'reads a hand-added line the cart never touched, and refuses to guess when it cannot', function () use ( $product_id ) {
		/*
		 * A product an operator adds in wp-admin carries its garment on the
		 * PRODUCT and not on the order item, because no cart ran. Missed, the
		 * line resolves to nothing; dropped, the other lines' family stands and a
		 * rule written for t-shirts prices an order containing something else.
		 */
		$hoodie = new WC_Product_Simple();
		$hoodie->set_name( 'Sweat ajouté à la main' );
		$hoodie->set_regular_price( '32.00' );
		$hoodie->save();
		update_post_meta( $hoodie->get_id(), Product::META, 'hoodie' );

		$order = ts_mg_order( $product_id, 12, ts_mg_sides() );
		$item  = new WC_Order_Item_Product();
		$item->set_product( $hoodie );
		$item->set_quantity( 2 );
		$order->add_item( $item );
		$order->save();

		$facts = Costing::facts( wc_get_order( $order->get_id() ) );
		ts_eq( $facts['famille'], '', 'a basket of two families has no family, so no family rule may price it' );
		ts_eq( $facts['quantite'], 14, 'and every garment still counts' );

		$order->delete( true );
		wp_delete_post( $hoodie->get_id(), true );
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

	ts_it( 'takes a refund off the margin and off the commission', function () use ( $product_id ) {
		$order = ts_mg_order( $product_id, 12, ts_mg_sides() );
		$order->update_meta_data( Costing::META_SALE_TYPE, 'premiere' );
		$order->save();
		$order->payment_complete( 'ts-marge-refund' );

		$before = Costing::compute( wc_get_order( $order->get_id() ) );
		ts_assert( (int) $before['commission']['earned_ht'] > 0, 'a paid first order earns something' );

		// Give a quarter of it back.
		$refund = wc_create_refund(
			array(
				'order_id' => $order->get_id(),
				'amount'   => Money::to_eur( (int) round( Ledger::due( wc_get_order( $order->get_id() ) ) / 4 ) ),
				'reason'   => 'Vérification',
			)
		);
		ts_assert( ! is_wp_error( $refund ), 'the refund could not be created' );

		$after = Costing::compute( wc_get_order( $order->get_id() ) );
		ts_assert( (int) $after['refunded_ttc'] > 0, 'the report did not see the refund' );
		ts_assert(
			(int) $after['commission']['earned_ht'] < (int) $before['commission']['earned_ht'],
			'money given back was still earning a commission'
		);
		ts_eq(
			(int) $after['revenue']['total_ht'],
			(int) $before['revenue']['total_ht'],
			'the invoice is a document that was issued; a refund is a separate event'
		);

		$order->delete( true );
	} );

	ts_it( 'says a stored report no longer describes the order it was computed from', function () use ( $product_id ) {
		$order  = ts_mg_order( $product_id, 12, ts_mg_sides() );
		$report = Costing::refresh( $order );

		ts_assert( Costing::current( wc_get_order( $order->get_id() ), $report ), 'a fresh report must describe its own order' );

		// The kind of sale is an input to the floor price, through the
		// commission rate. Changing it without recomputing left the panel
		// showing one rate's floor beside another rate's commission.
		$order = wc_get_order( $order->get_id() );
		$order->update_meta_data( Costing::META_SALE_TYPE, 'premiere' );
		$order->save();

		ts_assert(
			! Costing::current( wc_get_order( $order->get_id() ), $report ),
			'the report claims to describe an order that has changed under it'
		);

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
	update_option( OPTION_PRICE_RULES, is_array( $saved_rules ) ? $saved_rules : array() );
}
