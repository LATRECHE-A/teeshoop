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
		$est = Cost::component( 'textile', 500, Cost::ESTIMATED, 'prix catalogue', '2026-09-30', 400 );
		eq( $est['amount_ht'], 500, 'the prudent figure is the one that counts' );
		eq( $est['best_ht'], 400 );

		$real = Cost::component( 'textile', 500, Cost::REAL, 'tarif fournisseur', '2026-09-30', 400 );
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
				Cost::component( 'textile', 1000, Cost::ESTIMATED, 'prix catalogue ÷ 2', '2026-09-30', 800 ),
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
	it( 'gives every copy its own row, in the flatter orientation', function () use ( $ts_cost_config ) {
		// Two 20 x 30 pieces on a 56 cm roll: both fit flat, so each costs 20 cm
		// of roll plus the gap. 41 cm rounds up to the 10 cm billing step, and
		// the last sheet adds nothing.
		$b = Cost::prudent_length_cm(
			array( array( 'id' => 'a', 'w_cm' => 20.0, 'h_cm' => 30.0, 'qty' => 2 ) ),
			$ts_cost_config
		);
		truthy( $b['ok'] );
		near( $b['length_cm'], 50.0, 1e-9 );
	} );

	it( 'stands a banner up when its long side will not cross the laize', function () use ( $ts_cost_config ) {
		// 5 x 60 on a 56 cm roll cannot lie flat, so the row it costs is 60 cm and
		// not 5. Reading it the other way under-bounded this piece elevenfold.
		$flat = Cost::prudent_length_cm(
			array( array( 'id' => 'a', 'w_cm' => 5.0, 'h_cm' => 50.0, 'qty' => 1 ) ),
			$ts_cost_config
		);
		$tall = Cost::prudent_length_cm(
			array( array( 'id' => 'a', 'w_cm' => 5.0, 'h_cm' => 60.0, 'qty' => 1 ) ),
			$ts_cost_config
		);
		near( $flat['length_cm'], 10.0, 1e-9, '50 cm fits across, so the row is 5 cm' );
		// 60,5 cm of row, rounded up to the billing step, plus one step for the
		// second sheet the 100 cm file limit could force. A bound is allowed to
		// be loose; it is not allowed to be low.
		near( $tall['length_cm'], 80.0, 1e-9, '60 cm does not, so the row is 60 cm' );
	} );

	it( 'rounds up to the billing step, like the supplier does', function () use ( $ts_cost_config ) {
		// 12 x 9, one copy: 9,5 cm of roll, billed as 10.
		$b = Cost::prudent_length_cm(
			array( array( 'id' => 'a', 'w_cm' => 12.0, 'h_cm' => 9.0, 'qty' => 1 ) ),
			$ts_cost_config
		);
		near( $b['length_cm'], 10.0, 1e-9, 'a bound that ignored the rounding came out UNDER the packing' );
	} );

	it( 'refuses a transfer that fits on no roll instead of costing it', function () use ( $ts_cost_config ) {
		$b = Cost::prudent_length_cm(
			array(
				array( 'id' => 'ok', 'w_cm' => 10.0, 'h_cm' => 10.0, 'qty' => 1 ),
				array( 'id' => 'trop-large', 'w_cm' => 60.0, 'h_cm' => 70.0, 'qty' => 1 ),
			),
			$ts_cost_config
		);
		truthy( ! $b['ok'] );
		eq( $b['impossible'], array( 'trop-large' ) );
		near( $b['length_cm'], 0.0, 1e-9, 'no bound at all, rather than a bound on what is left' );
	} );

	it( 'grows with quantity and never shrinks', function () use ( $ts_cost_config ) {
		$prev = 0.0;
		foreach ( array( 1, 2, 5, 30 ) as $qty ) {
			$b = Cost::prudent_length_cm(
				array( array( 'id' => 'a', 'w_cm' => 18.0, 'h_cm' => 24.0, 'qty' => $qty ) ),
				$ts_cost_config
			);
			truthy( $b['length_cm'] > $prev, "the bound did not grow at qty={$qty}" );
			$prev = $b['length_cm'];
		}
	} );

	it( 'adds a billing step per extra sheet on a run past the file limit', function () {
		// A 3 m maximum file length and 100 pieces of 20 cm: several sheets, each
		// rounded up on its own, so one rounding of the whole is not enough.
		$short = Cost::merge_config( array( 'film' => array( 'width_cm' => 56.0, 'gap_cm' => 0.5, 'billing_step_cm' => 10.0, 'max_length_cm' => 300.0 ) ) );
		$b     = Cost::prudent_length_cm(
			array( array( 'id' => 'a', 'w_cm' => 30.0, 'h_cm' => 20.0, 'qty' => 100 ) ),
			$short
		);
		// 100 x 20,5 = 2 050 cm of artwork, rounded to 2 050, plus one step for
		// each of the sheets past the first.
		truthy( $b['length_cm'] >= 2050.0 );
		truthy( $b['length_cm'] <= 2050.0 + 10.0 * 10, 'and it must not run away either' );
	} );

	it( 'refuses geometry it cannot use rather than inventing a size', function () use ( $ts_cost_config ) {
		$b = Cost::prudent_length_cm(
			array(
				array( 'id' => 'a', 'w_cm' => 0.0, 'h_cm' => 24.0, 'qty' => 3 ),
				array( 'id' => 'b', 'w_cm' => 18.0, 'h_cm' => 24.0, 'qty' => 0 ),
			),
			$ts_cost_config
		);
		truthy( ! $b['ok'], 'nothing usable is not a length of zero' );
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

describe( 'Cost — a form that owns some fields must not delete the others', function () {
	it( 'keeps the billing step when the settings screen saves the film block', function () {
		/*
		 * THE DEFECT THIS PINS, found by the adversarial pass and reproduced
		 * before it was fixed: the screen owns eight of the film block's nine
		 * fields, and a merge that replaced the whole block dropped the ninth.
		 * `prudent_length_cm` then read a billing step of 0, refused, and the
		 * film became UNKNOWN on every order costed without the nesting service.
		 * Measured on thirty tees with one 28,4 x 34,1 cm transfer: 291,94 EUR
		 * of floor price, destroyed by pressing Enregistrer once.
		 */
		$saved = Cost::merge_config(
			array(
				'film' => array(
					'rate_fr_ht'  => 1700,
					'rate_es_ht'  => 900,
					'width_cm'    => 56.0,
					'delivery_ht' => 1500,
					'min_m'       => 1.0,
					'waste_rate'  => 0.05,
					'gap_cm'      => 0.5,
					'max_length_cm' => 3000.0,
				),
			)
		);

		truthy( array_key_exists( 'billing_step_cm', $saved['film'] ), 'the ninth field was deleted by a save' );

		$bound = Cost::prudent_length_cm( array( array( 'id' => 'a', 'w_cm' => 28.4, 'h_cm' => 34.1, 'qty' => 30 ) ), $saved );
		truthy( $bound['ok'], 'the bound stopped existing after a save' );
		near( $bound['length_cm'], 870.0, 1e-9 );
	} );

	it( 'merges the standard times and the payment block the same way', function () {
		$one = Cost::merge_config( array( 'times_s' => array( 'pressage' => 90 ) ) );
		eq( $one['times_s']['pressage'], 90, 'the field that was posted' );
		eq( $one['times_s']['preparation'], 60, 'and the six that were not' );

		$two = Cost::merge_config( array( 'payment' => array( 'rate' => 0.02 ) ) );
		truthy( array_key_exists( 'free_methods', $two['payment'] ), 'a transfer must still cost nothing' );
	} );

	it( 'still REPLACES the purchase prices, because clearing one must remove it', function () {
		$with  = Cost::merge_config( array( 'garment_supply' => array( 'tee' => array( 'ht' => 337 ) ) ) );
		$empty = Cost::merge_config( array( 'garment_supply' => array() ) );
		eq( $with['garment_supply']['tee']['ht'], 337 );
		eq( $empty['garment_supply'], array(), 'a deep merge here would resurrect a price somebody deleted' );
	} );
} );

describe( 'Cost — the bound when the file limit is close to the artwork', function () {
	it( 'counts the sheets from the room left after the tallest row, not from the billing step', function () {
		/*
		 * A 40 cm file limit and rows of 20 cm: the packer closes a sheet as
		 * soon as the next shelf would overflow, so every sheet but the last
		 * carries more than (limit − tallest − gap) = 19,5 cm, and there can be
		 * at most five. Clamping that divisor UP to the billing step, which is
		 * what this did, made it 10 and the count too LOW, and a bound that
		 * counts too few sheets counts too few roundings.
		 */
		$tight = Cost::merge_config(
			array( 'film' => array( 'width_cm' => 56.0, 'gap_cm' => 0.5, 'billing_step_cm' => 10.0, 'max_length_cm' => 40.0 ) )
		);
		$b = Cost::prudent_length_cm( array( array( 'id' => 'a', 'w_cm' => 20.0, 'h_cm' => 38.0, 'qty' => 4 ) ), $tight );

		truthy( $b['ok'] );
		// 4 rows of 20,5 cm = 82 cm, rounded up to 90, plus one step for each of
		// the four sheets past the first.
		near( $b['length_cm'], 130.0, 1e-9 );
	} );

	it( 'gives every transfer its own sheet when there is no room for a second row', function () {
		// A transfer as long as the whole file: one per sheet, necessarily. With
		// no room left, a division would be by zero or by a negative, and the
		// count falls back to the number of transfers.
		$tight = Cost::merge_config(
			array( 'film' => array( 'width_cm' => 56.0, 'gap_cm' => 0.5, 'billing_step_cm' => 10.0, 'max_length_cm' => 40.0 ) )
		);
		$b = Cost::prudent_length_cm( array( array( 'id' => 'a', 'w_cm' => 50.0, 'h_cm' => 39.5, 'qty' => 3 ) ), $tight );

		truthy( $b['ok'] );
		// Its row is 39,5 cm and the file is 40: no second row fits behind it,
		// so the room is exactly zero. Three rows of 40 cm, plus a step for each
		// of the two extra sheets.
		near( $b['length_cm'], 140.0, 1e-9 );
	} );

	it( 'refuses a transfer longer than a whole print file', function () {
		$tight = Cost::merge_config( array( 'film' => array( 'width_cm' => 56.0, 'max_length_cm' => 40.0 ) ) );
		$b     = Cost::prudent_length_cm( array( array( 'id' => 'long', 'w_cm' => 50.0, 'h_cm' => 45.0, 'qty' => 1 ) ), $tight );
		truthy( ! $b['ok'] );
		eq( $b['impossible'], array( 'long' ) );
	} );

	it( 'ships a print-file limit no larger than any supplier publishes', function () {
		// It shipped at 3 000 cm, which is twelve times the largest figure any
		// roll supplier in the studio's own survey publishes. Too large lets an
		// order be billed as one long file when the supplier will cut it into a
		// dozen, each rounded up: a lower cost, a lower floor, a sale nobody
		// would have authorised.
		truthy( Cost::default_config()['film']['max_length_cm'] <= 250.0 );
	} );
} );

describe( 'Cost — splitting a pooled film bill', function () use ( $ts_cost_config ) {
	it( 'hands out every cent of the bill and not one more', function () use ( $ts_cost_config ) {
		$a = Cost::attribute( array( '1042' => 2.5, '1043' => 1.8, '99' => 0.9 ), 3.9, $ts_cost_config );
		$sum = 0;
		foreach ( $a['shares'] as $share ) {
			$sum += $share['share_ht'];
		}
		eq( $sum, $a['total_ht'], 'the shares must reconcile against the supplier invoice exactly' );
	} );

	it( 'reconciles on a split that does not divide evenly', function () use ( $ts_cost_config ) {
		// Three identical orders on a bill that is not a multiple of three, so the
		// leftover cents really are handed out rather than the test passing on a
		// division that happened to come out whole.
		$a = Cost::attribute( array( 'a' => 1.0, 'b' => 1.0, 'c' => 1.0 ), 1.1, $ts_cost_config );
		truthy( 0 !== $a['total_ht'] % 3, 'a bill that divides evenly would not exercise the remainder' );
		$sum = 0;
		foreach ( $a['shares'] as $share ) {
			$sum += $share['share_ht'];
		}
		eq( $sum, $a['total_ht'] );
		eq( $a['shares']['a']['share_ht'], 1155, 'the leftover cents go to the first ids, deterministically' );
		eq( $a['shares']['c']['share_ht'], 1154 );
	} );

	it( 'charges the bigger order more, always', function () use ( $ts_cost_config ) {
		$a = Cost::attribute( array( 'petit' => 0.4, 'gros' => 6.0 ), 6.2, $ts_cost_config );
		truthy(
			$a['shares']['gros']['share_ht'] > $a['shares']['petit']['share_ht'],
			'the order that would have cost more alone must pay more in the pool'
		);
	} );

	it( 'gives the same cents whatever order the orders arrive in', function () use ( $ts_cost_config ) {
		$forwards  = Cost::attribute( array( 'a' => 1.0, 'b' => 1.0, 'c' => 1.0 ), 2.0, $ts_cost_config );
		$backwards = Cost::attribute( array( 'c' => 1.0, 'b' => 1.0, 'a' => 1.0 ), 2.0, $ts_cost_config );
		foreach ( array( 'a', 'b', 'c' ) as $id ) {
			eq( $backwards['shares'][ $id ]['share_ht'], $forwards['shares'][ $id ]['share_ht'], "order $id" );
		}
	} );

	it( 'never divides by a total weight of zero', function () {
		$free = Cost::merge_config(
			array( 'film' => array( 'rate_fr_ht' => 0, 'delivery_ht' => 0 ) )
		);
		$a = Cost::attribute( array( 'a' => 1.0, 'b' => 3.0 ), 4.0, $free );
		eq( $a['total_ht'], 0 );
		eq( $a['shares']['a']['share_ht'], 0 );
		eq( $a['shares']['b']['share_ht'], 0 );
	} );

	/*
	 * THE MEASURED CASE WHERE POOLING BUYS MORE FILM AND STILL COSTS LESS.
	 *
	 * Two 30 x 20 cm transfers cannot share a row on the roll, so the pool pays
	 * an inter-shelf gap neither order pays alone: 20 + 20 = 40 cm apart against
	 * 50 cm together (src/lib/dtf/run.test.ts measures it against the real
	 * packer). In money the run still wins by half, because two orders are two
	 * one-metre minimums and two delivery charges.
	 *
	 * This is why `attribute()` compares euros and not centimetres, and why the
	 * screen shows `worse` rather than a saving that is arithmetically true and
	 * commercially meaningless.
	 */
	it( 'prices a run that buys MORE film and finds it still cheaper', function () use ( $ts_cost_config ) {
		$a = Cost::attribute( array( '1' => 0.2, '2' => 0.2 ), 0.5, $ts_cost_config );
		eq( $a['solo_total_ht'], 6570, 'two orders bought apart: two minimums, two deliveries' );
		eq( $a['total_ht'], 3285, 'one order pooled: one minimum, one delivery' );
		eq( $a['saved_ht'], 3285 );
		eq( $a['worse'], false );
	} );

	it( 'says a run is worse rather than reporting a saving nobody made', function () {
		// No supplier minimum and no delivery charge: nothing is left to hide a
		// pool that genuinely nests worse than its parts.
		$bare = Cost::merge_config(
			array( 'film' => array( 'min_m' => 0.0, 'delivery_ht' => 0, 'waste_rate' => 0.0 ) )
		);
		$a = Cost::attribute( array( '1' => 0.2, '2' => 0.2 ), 0.5, $bare );
		eq( $a['total_ht'], 850 );
		eq( $a['solo_total_ht'], 680 );
		eq( $a['saved_ht'], -170, 'a negative saving is reported, never clamped to zero' );
		eq( $a['worse'], true );
	} );

	/*
	 * The alternative rule, published beside the one that is charged. The gap is
	 * the argument: on this pool the small order pays 19,91 EUR under the rule
	 * that charges what it would have cost alone and 8,46 EUR under the rule that
	 * charges its share of the ink — 135 % apart, on the same invoice.
	 */
	it( 'publishes what the area rule would have charged, and it is not the same', function () use ( $ts_cost_config ) {
		$a = Cost::attribute(
			array( '1042' => 2.5, '1043' => 1.8, '99' => 0.9 ),
			3.9,
			$ts_cost_config,
			'fr',
			array( '1042' => 1800.0, '1043' => 900.0, '99' => 300.0 )
		);
		eq( $a['shares']['99']['share_ht'], 1991 );
		eq( $a['shares']['99']['area_share_ht'], 846 );
		$sum = 0;
		foreach ( $a['shares'] as $share ) {
			$sum += $share['area_share_ht'];
		}
		eq( $sum, $a['total_ht'], 'the published rule has to reconcile too, or it is not a rule' );
	} );

	it( 'falls back to equal shares when no ink area was measured', function () use ( $ts_cost_config ) {
		$a = Cost::attribute( array( 'a' => 1.0, 'b' => 3.0 ), 3.5, $ts_cost_config );
		eq(
			$a['shares']['a']['area_share_ht'] + $a['shares']['b']['area_share_ht'],
			$a['total_ht']
		);
	} );

	it( 'costs the Spanish origin at the Spanish rate and nothing else', function () use ( $ts_cost_config ) {
		$fr = Cost::attribute( array( 'a' => 2.0 ), 2.0, $ts_cost_config, 'fr' );
		$es = Cost::attribute( array( 'a' => 2.0 ), 2.0, $ts_cost_config, 'es' );
		eq( $fr['origin'], 'fr' );
		eq( $es['origin'], 'es' );
		truthy( $es['total_ht'] < $fr['total_ht'], 'Spain is the cheap origin, which is why it needs evidence' );
	} );
} );
