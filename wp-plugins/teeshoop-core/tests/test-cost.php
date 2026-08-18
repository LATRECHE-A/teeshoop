<?php
/**
 * The direct-cost model, and the two places our numbers do not match the
 * Bible's own worked example.
 *
 * The last two describe() blocks are the ones to read first. They hold what the
 * shipped configuration produces against what chapter 1's thirty-t-shirt example
 * says the same order costs, so the gap is a measured number in a test rather
 * than an impression, and a late answer from the associate moves it visibly.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

/*
 * COMMAND LINE ONLY. `wp-content/plugins/` answers HTTP and this directory is
 * inside it; see the same block in run.php for what that cost before it was
 * there.
 */
if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

require_once __DIR__ . '/../includes/Cost.php';
require_once __DIR__ . '/../includes/Margin.php';

use Teeshoop\Core\Cost;
use Teeshoop\Core\Margin;
use Teeshoop\Core\Money;

$ts_cost_config = Cost::default_config();

describe( 'Cost — components carry their provenance', function () {
	it( 'refuses a component type the chapter does not name', function () {
		throws( fn() => Cost::component( 'marketing', 1000, Cost::REAL, 'invented' ) );
	} );

	it( 'refuses a confidence that is not one of the four', function () {
		throws( fn() => Cost::component( 'textile', 1000, 'probablement', 'invented' ) );
	} );

	it( 'gives an unknown component no amount at all', function () {
		$c = Cost::component( 'marquage', 9999, Cost::UNKNOWN, 'le Worker n’a pas répondu' );
		eq( $c['amount_ht'], 0, 'an unknown must not smuggle a figure into the total' );
		eq( $c['confidence'], Cost::UNKNOWN );
	} );

	it( 'keeps the optimistic figure only for an estimate', function () {
		$est = Cost::component( 'textile', 500, Cost::ESTIMATED, 'prix catalogue', '2026-08-18', 400 );
		eq( $est['amount_ht'], 500, 'the prudent figure is the one that counts' );
		eq( $est['best_ht'], 400 );

		$real = Cost::component( 'textile', 500, Cost::REAL, 'tarif fournisseur', '2026-08-18', 400 );
		eq( $real['best_ht'], null, 'a real cost has no optimistic variant' );
	} );
} );

describe( 'Cost — a total that says what it is worth', function () {
	it( 'tells a zero apart from a failure', function () {
		$none = Cost::total( array( Cost::component( 'sous_traite', 0, Cost::NONE, 'aucune sous-traitance' ) ) );
		$bad  = Cost::total( array( Cost::component( 'sous_traite', 0, Cost::UNKNOWN, 'non renseigné' ) ) );

		eq( $none['total_ht'], 0 );
		eq( $bad['total_ht'], 0, 'the two totals are identical, which is the trap' );
		eq( $none['unknown'], array(), 'a genuine zero is answered' );
		eq( $bad['unknown'], array( 'sous_traite' ), 'a failure is not' );
	} );

	it( 'is never complete while a component is missing entirely', function () {
		$t = Cost::total( array( Cost::component( 'textile', 9000, Cost::REAL, 'tarif' ) ) );
		truthy( ! $t['complete'] );
		eq( count( $t['absent'] ), count( Cost::COMPONENTS ) - 1 );
	} );

	it( 'is complete when every one of the ten is answered', function () {
		$lines = array();
		foreach ( array_keys( Cost::COMPONENTS ) as $type ) {
			$lines[] = Cost::component( $type, 100, Cost::REAL, 'mesuré' );
		}
		$t = Cost::total( $lines );
		truthy( $t['complete'] );
		truthy( ! $t['estimated'] );
		eq( $t['total_ht'], 100 * count( Cost::COMPONENTS ) );
	} );

	it( 'adds several lines of the same type instead of losing one', function () {
		$t = Cost::total(
			array(
				Cost::component( 'textile', 9000, Cost::REAL, 'référence A' ),
				Cost::component( 'textile', 4500, Cost::REAL, 'référence B' ),
			)
		);
		eq( $t['total_ht'], 13500, 'an order with two garments has two textile costs' );
		eq( count( $t['lines'] ), 2 );
	} );

	it( 'reports the optimistic total beside the prudent one', function () {
		$t = Cost::total(
			array(
				Cost::component( 'textile', 1000, Cost::ESTIMATED, 'prix catalogue ÷ 2', '2026-08-18', 800 ),
				Cost::component( 'emballage', 300, Cost::REAL, 'facture' ),
			)
		);
		eq( $t['total_ht'], 1300 );
		eq( $t['best_ht'], 1100 );
		truthy( $t['estimated'] );
	} );

	it( 'ignores a line that is not a component at all', function () {
		$t = Cost::total( array( 'nonsense', array( 'type' => 'inexistant', 'amount_ht' => 999999 ) ) );
		eq( $t['total_ht'], 0 );
	} );
} );

describe( 'Cost — labour is temps standard x taux horaire chargé', function () use ( $ts_cost_config ) {
	it( 'multiplies each operation by the unit the chapter names', function () use ( $ts_cost_config ) {
		// One order, 30 garments, one transfer each. 60 s of preparation plus
		// 30 x 45 s of pressing = 1 410 s = 0,391666… h at 20,00 EUR.
		$l = Cost::labour( array( 'orders' => 1, 'pieces' => 30, 'transfers' => 30 ), $ts_cost_config );
		eq( $l['seconds'], 1410 );
		eq( $l['amount_ht'], 783, '1410 / 3600 x 2000 = 783,33 cents' );
	} );

	it( 'counts transfers and not garments, because a back print is a second press', function () use ( $ts_cost_config ) {
		$one = Cost::labour( array( 'orders' => 1, 'pieces' => 10, 'transfers' => 10 ), $ts_cost_config );
		$two = Cost::labour( array( 'orders' => 1, 'pieces' => 10, 'transfers' => 20 ), $ts_cost_config );
		eq( $two['seconds'] - $one['seconds'], 450, 'ten more presses is ten more 45 s' );
	} );

	it( 'names the five operations nobody has ever timed', function () use ( $ts_cost_config ) {
		$l = Cost::labour( array( 'orders' => 1, 'pieces' => 30, 'transfers' => 30 ), $ts_cost_config );
		eq(
			$l['untimed'],
			array( 'reception', 'pelage', 'second_pressage', 'controle', 'pliage' ),
			'a labour cost built from two of seven operations must say so'
		);
	} );

	it( 'does not report an operation this order never performs as untimed', function () use ( $ts_cost_config ) {
		// A run with nothing to press is not missing a pressing time.
		$l = Cost::labour( array( 'orders' => 1, 'pieces' => 0, 'transfers' => 0 ), $ts_cost_config );
		eq( $l['untimed'], array( 'reception' ), 'only the per-order operation is outstanding' );
	} );

	it( 'costs nothing when the shop values its own time at nothing, and says so', function () {
		$free = Cost::merge_config( array( 'hourly_ht' => 0 ) );
		$l    = Cost::labour( array( 'orders' => 1, 'pieces' => 30, 'transfers' => 30 ), $free );
		eq( $l['amount_ht'], 0 );
		eq( $l['seconds'], 1410, 'the time was still spent' );
	} );
} );

describe( 'Cost — the film, from a measured length', function () use ( $ts_cost_config ) {
	it( 'reproduces the chapter formula term by term', function () use ( $ts_cost_config ) {
		// 4 m nested, France: 4 x 17,00 = 68,00 ; perte 5 % = 0,2 m = 3,40 ;
		// livraison 15,00. Total 86,40.
		$f = Cost::film( 4.0, $ts_cost_config, 'fr' );
		eq( $f['metres_ht'], 6800 );
		eq( $f['waste_ht'], 340 );
		eq( $f['delivery_ht'], 1500 );
		eq( $f['amount_ht'], 8640 );
	} );

	it( 'charges the provision on the film and not on the courier', function () use ( $ts_cost_config ) {
		$f = Cost::film( 4.0, $ts_cost_config, 'fr' );
		$naive = Money::round( ( $f['metres_ht'] + $f['delivery_ht'] ) * 0.05 );
		truthy( $f['waste_ht'] < $naive, 'a 5 % provision on a delivery charge is not a film loss' );
	} );

	it( 'bills the supplier minimum on a run shorter than it, and says it did', function () use ( $ts_cost_config ) {
		$f = Cost::film( 0.3, $ts_cost_config, 'fr' );
		near( $f['billed_m'], 1.0, 1e-9 );
		truthy( $f['at_minimum'], 'the shop is paying for film it did not use' );

		$g = Cost::film( 4.0, $ts_cost_config, 'fr' );
		truthy( ! $g['at_minimum'] );
	} );

	it( 'is cheaper in Spain, which is the whole point of the two rates', function () use ( $ts_cost_config ) {
		$fr = Cost::film( 4.0, $ts_cost_config, 'fr' );
		$es = Cost::film( 4.0, $ts_cost_config, 'es' );
		eq( $fr['amount_ht'] - $es['amount_ht'], 3360, '4,2 m billed at 17,00 against 9,00' );
	} );

	it( 'treats an unknown origin as France, the expensive one', function () use ( $ts_cost_config ) {
		$x = Cost::film( 4.0, $ts_cost_config, 'zz' );
		eq( $x['amount_ht'], Cost::film( 4.0, $ts_cost_config, 'fr' )['amount_ht'] );
	} );
} );

describe( 'Cost — the prudent length is a bound, not a nesting', function () use ( $ts_cost_config ) {
	it( 'is one shelf per piece, which is the worst a shelf packer can do', function () use ( $ts_cost_config ) {
		// Two 20 x 30 pieces: laid flat each costs 20 cm of roll plus the gap.
		$len = Cost::prudent_length_cm(
			array( array( 'w_cm' => 20.0, 'h_cm' => 30.0, 'qty' => 2 ) ),
			$ts_cost_config
		);
		near( $len, 2 * ( 20.0 + 0.5 ), 1e-9 );
	} );

	it( 'cuts a piece wider than the roll into the strips it needs', function () use ( $ts_cost_config ) {
		// 120 cm wide on a 56 cm roll is three strips, each still 10 cm tall.
		$len = Cost::prudent_length_cm(
			array( array( 'w_cm' => 120.0, 'h_cm' => 10.0, 'qty' => 1 ) ),
			$ts_cost_config
		);
		near( $len, 3 * ( 10.0 + 0.5 ), 1e-9 );
	} );

	it( 'grows with quantity and never shrinks', function () use ( $ts_cost_config ) {
		$prev = 0.0;
		foreach ( array( 1, 2, 5, 30 ) as $qty ) {
			$len = Cost::prudent_length_cm(
				array( array( 'w_cm' => 18.0, 'h_cm' => 24.0, 'qty' => $qty ) ),
				$ts_cost_config
			);
			truthy( $len > $prev, "the bound did not grow at qty={$qty}" );
			$prev = $len;
		}
	} );

	it( 'ignores geometry it cannot use rather than inventing a size', function () use ( $ts_cost_config ) {
		$len = Cost::prudent_length_cm(
			array(
				array( 'w_cm' => 0.0, 'h_cm' => 24.0, 'qty' => 3 ),
				array( 'w_cm' => 18.0, 'h_cm' => 24.0, 'qty' => 0 ),
			),
			$ts_cost_config
		);
		near( $len, 0.0, 1e-9 );
	} );
} );

describe( 'Cost — the small charges', function () use ( $ts_cost_config ) {
	it( 'takes the card fee on what was actually charged, which is TTC', function () use ( $ts_cost_config ) {
		// 750,00 EUR TTC at 1,5 % + 0,25 EUR = 11,50 EUR.
		eq( Cost::payment_fee( 75000, $ts_cost_config ), 1150 );

		$on_ht = Cost::payment_fee( 62500, $ts_cost_config );
		truthy( $on_ht < 1150, 'reading the fee off the HT understates it by the VAT' );
	} );

	it( 'charges nothing on an order nobody has paid', function () use ( $ts_cost_config ) {
		eq( Cost::payment_fee( 0, $ts_cost_config ), 0 );
	} );

	it( 'drops the inbound freight above the supplier franco', function () use ( $ts_cost_config ) {
		eq( Cost::freight( 19999, $ts_cost_config ), 800 );
		eq( Cost::freight( 20000, $ts_cost_config ), 0, 'exactly at the threshold is free' );
	} );

	it( 'reads a franco of zero as always free, like every other threshold here', function () {
		$c = Cost::merge_config( array( 'freight_free_from_ht' => 0 ) );
		eq( Cost::freight( 100, $c ), 800, 'no threshold means the charge always applies' );
	} );

	it( 'uses the SMALLER divisor for the prudent catalogue scenario', function () use ( $ts_cost_config ) {
		$e = Cost::from_catalogue( 1000, $ts_cost_config );
		eq( $e['prudent'], 500, 'divided by 2, the more expensive reading' );
		eq( $e['optimistic'], 400 );
		truthy( $e['prudent'] > $e['optimistic'], 'flagging a cost estimated and then using the flattering figure is worse than not flagging it' );
	} );
} );

describe( 'Cost — against the Bible’s own thirty-t-shirt example', function () use ( $ts_cost_config ) {
	/*
	 * « Commande de 30 t-shirts : textile 90 ; DTF et livraison 65 ;
	 *   main-d'oeuvre valorisée 45 ; emballage 9 ; transport fournisseur 10 ;
	 *   livraison client 15 ; paiement et provision SAV 16 ; coût total 250. »
	 */
	it( 'agrees with the example’s own arithmetic', function () {
		eq( 9000 + 6500 + 4500 + 900 + 1000 + 1500 + 1600, 25000, 'the published total adds up' );
	} );

	it( 'costs the labour at a fifth of what the example does, and the gap is the untimed work', function () use ( $ts_cost_config ) {
		$ours  = Cost::labour( array( 'orders' => 1, 'pieces' => 30, 'transfers' => 30 ), $ts_cost_config );
		$bible = 4500;

		eq( $ours['amount_ht'], 783 );
		eq( $bible - $ours['amount_ht'], 3717, 'a 37,17 EUR hole in a 250,00 EUR cost' );

		/*
		 * Where it goes. At 20,00 EUR the hour, 45,00 EUR is 2 h 15 for thirty
		 * garments, i.e. 270 s a piece; question 05's two timed operations account
		 * for 47 s of that. The five untimed ones are the other 223 s, and they
		 * are exactly the operations the chapter lists and nobody has stopwatched.
		 */
		$implied_s = (int) round( $bible / $ts_cost_config['hourly_ht'] * 3600 );
		eq( $implied_s, 8100 );
		eq( (int) round( ( $implied_s - $ours['seconds'] ) / 30 ), 223 );
	} );

	it( 'moves the floor price by 63,72 EUR, which is what the missing times are worth', function () use ( $ts_cost_config ) {
		$rules = array(
			'target_margin_rate'    => 0.55,
			'min_contribution_rate' => 0.25,
			'commission_rate'       => 0.40,
			'max_discount_rate'     => 0.15,
		);

		$with_ours  = Margin::plan( 25000 - 3717, $rules );
		$with_bible = Margin::plan( 25000, $rules );

		eq( $with_bible['floor_ht'] - $with_ours['floor_ht'], 6372 );
	} );
} );
