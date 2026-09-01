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

/*
 * THE ROLL, WHICH IS NO LONGER WHAT THE SHOP BUYS.
 *
 * Question 04's answer of 1 September 2026 moved the tariff from a roll billed
 * per linear metre to a 33 x 46 cm sheet billed at 3,00 EUR, so
 * `Cost::default_config()` above now bills sheets. The roll branch is still in
 * the engine, because the HT/TTC question can still move that sheet price by a
 * fifth and a supplier who bills sheets today can bill metres in six months,
 * and code nothing exercises is code nobody can trust when it is needed. So the
 * blocks that describe roll arithmetic run on this, explicitly, and the sheet
 * blocks run on what ships.
 */
$ts_roll_config = $ts_cost_config;
$ts_roll_config['film']['billing']         = 'roll';
$ts_roll_config['film']['width_cm']        = 56.0;
$ts_roll_config['film']['max_length_cm']   = 100.0;
$ts_roll_config['film']['billing_step_cm'] = 10.0;

describe( 'Cost: components carry their provenance', function () {
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

describe( 'Cost: a total that says what it is worth', function () {
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

describe( 'Cost: labour is temps standard x taux horaire chargé', function () use ( $ts_cost_config ) {
	it( 'multiplies each operation by the unit the chapter names', function () use ( $ts_cost_config ) {
		// One order, 30 garments, one transfer each. 60 s of preparation plus
		// 30 x 15 s of pressing = 510 s = 0,141666… h at 20,00 EUR.
		$l = Cost::labour( array( 'orders' => 1, 'pieces' => 30, 'transfers' => 30 ), $ts_cost_config );
		eq( $l['seconds'], 510 );
		eq( $l['amount_ht'], 283, '510 / 3600 x 2000 = 283,33 cents' );
	} );

	it( 'counts transfers and not garments, because a back print is a second press', function () use ( $ts_cost_config ) {
		$one = Cost::labour( array( 'orders' => 1, 'pieces' => 10, 'transfers' => 10 ), $ts_cost_config );
		$two = Cost::labour( array( 'orders' => 1, 'pieces' => 10, 'transfers' => 20 ), $ts_cost_config );
		eq( $two['seconds'] - $one['seconds'], 150, 'ten more presses is ten more 15 s' );
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
		eq( $l['seconds'], 510, 'the time was still spent' );
	} );
} );

describe( 'Cost: the film, from a measured length', function () use ( $ts_roll_config ) {
	it( 'reproduces the chapter formula term by term', function () use ( $ts_roll_config ) {
		// 4 m nested, France: 4 x 17,00 = 68,00 ; perte 5 % = 0,2 m = 3,40 ;
		// livraison 15,00. Total 86,40.
		$f = Cost::film( 4.0, $ts_roll_config, 'fr' );
		eq( $f['metres_ht'], 6800 );
		eq( $f['waste_ht'], 340 );
		eq( $f['delivery_ht'], 1500 );
		eq( $f['amount_ht'], 8640 );
	} );

	it( 'charges the provision on the film and not on the courier', function () use ( $ts_roll_config ) {
		$f = Cost::film( 4.0, $ts_roll_config, 'fr' );
		$naive = Money::round( ( $f['metres_ht'] + $f['delivery_ht'] ) * 0.05 );
		truthy( $f['waste_ht'] < $naive, 'a 5 % provision on a delivery charge is not a film loss' );
	} );

	it( 'bills the supplier minimum on a run shorter than it, and says it did', function () use ( $ts_roll_config ) {
		$f = Cost::film( 0.3, $ts_roll_config, 'fr' );
		near( $f['billed_m'], 1.0, 1e-9 );
		truthy( $f['at_minimum'], 'the shop is paying for film it did not use' );

		$g = Cost::film( 4.0, $ts_roll_config, 'fr' );
		truthy( ! $g['at_minimum'] );
	} );

	it( 'is cheaper in Spain, which is the whole point of the two rates', function () use ( $ts_roll_config ) {
		$fr = Cost::film( 4.0, $ts_roll_config, 'fr' );
		$es = Cost::film( 4.0, $ts_roll_config, 'es' );
		eq( $fr['amount_ht'] - $es['amount_ht'], 3360, '4,2 m billed at 17,00 against 9,00' );
	} );

	it( 'treats an unknown origin as France, the expensive one', function () use ( $ts_roll_config ) {
		$x = Cost::film( 4.0, $ts_roll_config, 'zz' );
		eq( $x['amount_ht'], Cost::film( 4.0, $ts_roll_config, 'fr' )['amount_ht'] );
	} );
} );

describe( 'Cost: the settings screen can express the tariff the shop pays', function () {
	/*
	 * THE DEFECT THIS PINS. The film form owned eight ROLL fields and none of the
	 * three that decide a sheet bill, so the supplier raising an A3+ from 3,00 to
	 * 3,50 EUR was a code change, and the one geometry field it did own could be
	 * edited alone and desynchronise the sheet count from the packer's billing
	 * step. Found by the adversarial pass over this session's own diff.
	 */
	it( 'writes a sheet tariff that Cost::film can actually use', function () {
		$saved = Cost::merge_config(
			array(
				'film' => array(
					'billing'       => 'sheet',
					'sheet_ht'      => 350,
					'min_sheets'    => 1,
					'width_cm'      => 33.0,
					'max_length_cm' => 46.0,
					// The screen derives this from the height; a form that did not
					// would leave the config in the state that refuses.
					'billing_step_cm' => 46.0,
				),
			)
		);
		$f = Cost::film( 1.0, $saved );
		truthy( $f['ok'], 'un tarif saisi à l’écran doit être exploitable' );
		eq( $f['billed_sheets'], 3, '1,00 m sur des feuilles de 46 cm' );
		eq( $f['rate_ht'], 350, 'le prix saisi est celui qui est appliqué' );
	} );

	it( 'refuses a height changed without its billing step, which is the trap', function () {
		// Exactly what an operator does when the supplier changes format and the
		// form lets them touch one field. The engine refuses rather than counting
		// sheets against a step that is not a sheet.
		$half = Cost::merge_config( array( 'film' => array( 'max_length_cm' => 60.0 ) ) );
		truthy( ! Cost::film( 1.0, $half )['ok'] );
	} );
} );

describe( 'Cost: a film tariff that does not hold together refuses', function () use ( $ts_cost_config ) {
	/*
	 * THE DEFECT THIS PINS, found by the adversarial pass. `merge_config` merges
	 * the film block PER KEY, deliberately, because a whole-block replace once
	 * deleted `billing_step_cm` and 291,94 EUR of floor price with it. The
	 * consequence after question 04's answer: a film block SAVED BEFORE
	 * 1 September 2026 carries the roll's geometry and no `billing` key, so it
	 * inherits `sheet` from the defaults and the engine prices 56 x 100 cm
	 * « sheets » at the A3+ price.
	 *
	 * Measured: four nested metres came to 27,60 EUR instead of 86,40, a 68 %
	 * under-cost, straight into a floor price that authorises sales.
	 */
	it( 'REFUSES a config saved before the tariff changed, instead of quoting it cheap', function () {
		$saved = Cost::merge_config(
			array(
				'film' => array(
					'rate_fr_ht'    => 1700,
					'rate_es_ht'    => 900,
					'width_cm'      => 56.0,
					'delivery_ht'   => 1500,
					'min_m'         => 1.0,
					'waste_rate'    => 0.05,
					'gap_cm'        => 0.5,
					'max_length_cm' => 100.0,
				),
			)
		);
		eq( $saved['film']['billing'], 'sheet', 'le mode est bien hérité des défauts, ce qui est la cause' );

		$f = Cost::film( 4.0, $saved );
		truthy( ! $f['ok'], 'un tarif incohérent a été chiffré au lieu d’être refusé' );
		eq( $f['amount_ht'], 0, 'un refus ne porte pas de montant' );
		truthy( '' !== (string) $f['why'], 'un refus sans raison ne se corrige pas' );
	} );

	it( 'refuses a sheet with no price, and a sheet with no dimensions', function () {
		$free = Cost::merge_config( array( 'film' => array( 'sheet_ht' => 0 ) ) );
		truthy( ! Cost::film( 1.0, $free )['ok'], 'une feuille gratuite est un tarif non renseigné' );

		$flat = Cost::merge_config( array( 'film' => array( 'width_cm' => 0.0 ) ) );
		truthy( ! Cost::film( 1.0, $flat )['ok'] );
	} );

	it( 'refuses a billing step that is not the sheet height', function () use ( $ts_cost_config ) {
		// The load-bearing equality: the sheet count is the length divided by the
		// sheet height, and that is only the invoice if the packer bills whole
		// sheets. The settings screen owns `max_length_cm` and not the step, so
		// an operator can break exactly this.
		$skew = Cost::merge_config( array( 'film' => array( 'max_length_cm' => 60.0 ) ) );
		truthy( ! Cost::film( 1.0, $skew )['ok'], 'une hauteur modifiée seule a été acceptée' );
		truthy( Cost::film( 1.0, $ts_cost_config )['ok'], 'et le tarif livré, lui, passe' );
	} );

	it( 'refuses a roll with no rate rather than treating film as free', function () {
		$free = Cost::merge_config( array( 'film' => array( 'billing' => 'roll', 'rate_fr_ht' => 0 ) ) );
		$f    = Cost::film( 4.0, $free );
		truthy( ! $f['ok'] );
		eq( $f['amount_ht'], 0 );
	} );
} );

describe( 'Cost: what fits on a sheet, which is now a question about the garment', function () use ( $ts_cost_config, $ts_roll_config ) {
	/*
	 * THE DEFECT THIS PINS, and it was found by the adversarial pass and not by
	 * any test here. Question 04's answer made the film a 33 x 46 cm sheet. The
	 * print zones this shop PUBLISHES did not move, and measured against
	 * data/garments.json on 1 September 2026 a full front or back print fits at
	 * S, M and L on both garments and fits in NO orientation from XL upward,
	 * where the zone reaches 37,5 x 50 cm.
	 *
	 * The cost engine could not see it: it measures every line at the priced
	 * size, M, whatever sizes were ordered. So the shop would have taken the
	 * money and the workshop would have found out at the press.
	 */
	it( 'refuses a transfer that fits no sheet in either orientation', function () use ( $ts_cost_config ) {
		// The published tee front at 3XL, to the millimetre.
		truthy( ! Cost::fits_sheet( 37.5, 50.0, $ts_cost_config ), 'un dos de 3XL tient sur une feuille A3+' );
		// The same zone at L, which does fit, standing up.
		truthy( Cost::fits_sheet( 32.6, 43.5, $ts_cost_config ) );
		// And lying across: 46 is the long side of the sheet.
		truthy( Cost::fits_sheet( 45.0, 30.0, $ts_cost_config ), 'une pièce couchée sur la feuille est une pose' );
		truthy( ! Cost::fits_sheet( 34.0, 47.0, $ts_cost_config ), 'un millimètre de trop dans les deux sens' );
	} );

	it( 'answers the same question the same way on a roll', function () use ( $ts_roll_config ) {
		// The very transfer the sheet refuses fitted the 56 cm roll, which is
		// how this got past every check until the format changed.
		truthy( Cost::fits_sheet( 37.5, 50.0, $ts_roll_config ), 'le rouleau de 56 cm prenait ce dos' );
	} );

	it( 'names the transfers that cannot be printed, and only those', function () use ( $ts_cost_config ) {
		$bad = Cost::unplaceable(
			array(
				array( 'id' => 'coeur', 'w_cm' => 9.5, 'h_cm' => 7.2, 'qty' => 30 ),
				array( 'id' => 'dos-3xl', 'w_cm' => 37.5, 'h_cm' => 50.0, 'qty' => 1 ),
				array( 'id' => 'manche', 'w_cm' => 12.5, 'h_cm' => 12.5, 'qty' => 2 ),
			),
			$ts_cost_config
		);
		eq( $bad, array( 'dos-3xl' ) );
	} );

	it( 'treats geometry it cannot read as unprintable, never as fine', function () use ( $ts_cost_config ) {
		eq(
			Cost::unplaceable(
				array(
					array( 'id' => 'zero', 'w_cm' => 0.0, 'h_cm' => 10.0, 'qty' => 1 ),
					array( 'id' => 'absente', 'qty' => 1 ),
				),
				$ts_cost_config
			),
			array( 'zero', 'absente' ),
			'une géométrie illisible doit refuser, pas passer'
		);
		// A quantity of zero is not a transfer at all, so it is not a refusal.
		eq( Cost::unplaceable( array( array( 'id' => 'aucune', 'w_cm' => 99.0, 'h_cm' => 99.0, 'qty' => 0 ) ), $ts_cost_config ), array() );
	} );

	it( 'refuses a config with no sheet at all rather than accepting everything', function () {
		$blind = Cost::merge_config( array( 'film' => array( 'width_cm' => 0.0 ) ) );
		truthy( ! Cost::fits_sheet( 5.0, 5.0, $blind ), 'une feuille sans largeur accepte tout' );
	} );
} );

describe( 'Cost: the film when the supplier sells sheets', function () use ( $ts_cost_config, $ts_roll_config ) {
	it( 'is what the shop ships, and it is not a roll', function () use ( $ts_cost_config ) {
		eq( $ts_cost_config['film']['billing'], 'sheet', 'question 04 was answered with a sheet' );
		eq( Cost::film( 1.0, $ts_cost_config )['unit_fr'], 'feuille' );
	} );

	it( 'charges a whole sheet for a corner of one, because that is what you buy', function () use ( $ts_cost_config ) {
		// 10 cm of a 46 cm sheet. One sheet at 3,00 EUR, 5 % provision = 0,15,
		// delivery 15,00. Nothing is pro-rated: a quarter sheet is a sheet.
		$f = Cost::film( 0.10, $ts_cost_config );
		eq( $f['billed_sheets'], 1 );
		eq( $f['metres_ht'], 300 );
		eq( $f['waste_ht'], 15 );
		eq( $f['delivery_ht'], 1500 );
		eq( $f['amount_ht'], 1815 );
	} );

	it( 'counts sheets by ceiling and never by rounding', function () use ( $ts_cost_config ) {
		// A hair over two sheets is three sheets. Rounding to the nearest would
		// give two, and a film cost rounded DOWN is a floor price rounded down,
		// which authorises a sale nobody would have signed.
		eq( Cost::film( 0.92, $ts_cost_config )['billed_sheets'], 2, '2 x 0,46 exactly' );
		eq( Cost::film( 0.93, $ts_cost_config )['billed_sheets'], 3 );
		eq( Cost::film( 1.37, $ts_cost_config )['billed_sheets'], 3 );
		eq( Cost::film( 1.38, $ts_cost_config )['billed_sheets'], 3, 'and exactly three is still three' );
	} );

	it( 'says when an order is paying the supplier minimum', function () use ( $ts_cost_config ) {
		$tiny = Cost::film( 0.0, $ts_cost_config );
		eq( $tiny['billed_sheets'], 1, 'you cannot buy a third of a sheet' );
		truthy( $tiny['at_minimum'] );
		truthy( ! Cost::film( 1.0, $ts_cost_config )['at_minimum'] );
	} );

	it( 'keeps the loss provision in cents rather than buying a whole extra sheet', function () use ( $ts_cost_config ) {
		// 5 % of two sheets is a tenth of a sheet. Rounded up to a whole one it
		// would be a 50 % provision on a small order and 5 % on a large one.
		$f = Cost::film( 0.90, $ts_cost_config );
		eq( $f['billed_sheets'], 2 );
		eq( $f['waste_ht'], 30, '5 % of 6,00 EUR' );
		truthy( $f['waste_ht'] < $ts_cost_config['film']['sheet_ht'], 'a provision is money, not paper' );
	} );

	it( 'ignores the origin, because there is one supplier and he is in France', function () use ( $ts_cost_config ) {
		eq(
			Cost::film( 2.0, $ts_cost_config, 'es' )['amount_ht'],
			Cost::film( 2.0, $ts_cost_config, 'fr' )['amount_ht']
		);
		eq( Cost::film( 2.0, $ts_cost_config, 'es' )['origin'], 'fr', 'and it says so rather than agreeing with the caller' );
	} );

	it( 'describes ONE sheet as geometry and as a price, never two different ones', function () use ( $ts_cost_config ) {
		/*
		 * `width_cm` and `max_length_cm` are what the packer packs into and what
		 * `film()` divides a length by to get a sheet count. If they drifted from
		 * the 33 x 46 the sheet price is quoted for, the shop would be nesting on
		 * one sheet and invoiced for another.
		 */
		$film = $ts_cost_config['film'];
		near( $film['width_cm'], 33.0, 1e-9 );
		near( $film['max_length_cm'], 46.0, 1e-9 );
		near( $film['billing_step_cm'], $film['max_length_cm'], 1e-9, 'a sheet bills whole or the length and the count disagree' );
		eq( $film['sheet_ht'], 300 );
	} );

	it( 'bounds an unmeasurable order in whole sheets', function () use ( $ts_cost_config ) {
		// Four 20 x 38 cm transfers. Each row is 38,5 cm and a sheet leaves
		// 46 − 38 − 0,5 = 7,5 cm of room behind the tallest, so at most four
		// sheets, and the bound is four whole sheets rather than a strip.
		$b = Cost::prudent_length_cm(
			array( array( 'id' => 'a', 'w_cm' => 20.0, 'h_cm' => 38.0, 'qty' => 4 ) ),
			$ts_cost_config
		);
		truthy( $b['ok'] );
		near( $b['length_cm'], 4 * 46.0, 1e-9 );
		eq( Cost::film( $b['length_cm'] / 100, $ts_cost_config )['billed_sheets'], 4, 'the bound divides back to whole sheets' );
	} );

	it( 'refuses a transfer taller than a sheet instead of costing it', function () use ( $ts_cost_config, $ts_roll_config ) {
		// A 30 x 50 cm back print fits a 56 cm roll and fits no A3+ sheet. It is
		// unplaceable now, and that is new: the shop refuses the order rather
		// than quoting a sheet the workshop cannot print.
		$piece = array( array( 'id' => 'dos', 'w_cm' => 30.0, 'h_cm' => 50.0, 'qty' => 1 ) );
		truthy( Cost::prudent_length_cm( $piece, $ts_roll_config )['ok'], 'it did fit the roll' );

		$b = Cost::prudent_length_cm( $piece, $ts_cost_config );
		truthy( ! $b['ok'] );
		eq( $b['impossible'], array( 'dos' ) );
	} );

	it( 'still splits a pooled bill, and a pool of two small orders is one sheet', function () use ( $ts_cost_config ) {
		// Two orders of 10 cm each. Apart: two sheets and two deliveries. Pooled
		// into 20 cm: one sheet and one delivery. The saving is real and it is
		// almost all the courier, which is what the bench says too.
		$a = Cost::attribute( array( '1' => 0.10, '2' => 0.10 ), 0.20, $ts_cost_config );
		eq( $a['solo_total_ht'], 3630 );
		eq( $a['total_ht'], 1815 );
		eq( $a['saved_ht'], 1815 );
		eq( $a['worse'], false );
		eq( $a['shares']['1']['share_ht'] + $a['shares']['2']['share_ht'], $a['total_ht'], 'the split reconciles to the cent' );
	} );
} );

describe( 'Cost: the prudent length is a bound, not a nesting', function () use ( $ts_roll_config ) {
	it( 'gives every copy its own row, in the flatter orientation', function () use ( $ts_roll_config ) {
		// Two 20 x 30 pieces on a 56 cm roll: both fit flat, so each costs 20 cm
		// of roll plus the gap. 41 cm rounds up to the 10 cm billing step, and
		// the last sheet adds nothing.
		$b = Cost::prudent_length_cm(
			array( array( 'id' => 'a', 'w_cm' => 20.0, 'h_cm' => 30.0, 'qty' => 2 ) ),
			$ts_roll_config
		);
		truthy( $b['ok'] );
		near( $b['length_cm'], 50.0, 1e-9 );
	} );

	it( 'stands a banner up when its long side will not cross the laize', function () use ( $ts_roll_config ) {
		// 5 x 60 on a 56 cm roll cannot lie flat, so the row it costs is 60 cm and
		// not 5. Reading it the other way under-bounded this piece elevenfold.
		$flat = Cost::prudent_length_cm(
			array( array( 'id' => 'a', 'w_cm' => 5.0, 'h_cm' => 50.0, 'qty' => 1 ) ),
			$ts_roll_config
		);
		$tall = Cost::prudent_length_cm(
			array( array( 'id' => 'a', 'w_cm' => 5.0, 'h_cm' => 60.0, 'qty' => 1 ) ),
			$ts_roll_config
		);
		near( $flat['length_cm'], 10.0, 1e-9, '50 cm fits across, so the row is 5 cm' );
		/*
		 * 60,5 cm of row, rounded up to the billing step. 70 and not the 80 this
		 * asserted before: the room divisor said the 100 cm file limit could
		 * force a second sheet, and session 13b added the bound that says one
		 * transfer never needs two. A bound is allowed to be loose; it is not
		 * allowed to be low, and this one moved down towards the truth rather
		 * than under it.
		 */
		near( $tall['length_cm'], 70.0, 1e-9, '60 cm does not, so the row is 60 cm' );
	} );

	it( 'rounds up to the billing step, like the supplier does', function () use ( $ts_roll_config ) {
		// 12 x 9, one copy: 9,5 cm of roll, billed as 10.
		$b = Cost::prudent_length_cm(
			array( array( 'id' => 'a', 'w_cm' => 12.0, 'h_cm' => 9.0, 'qty' => 1 ) ),
			$ts_roll_config
		);
		near( $b['length_cm'], 10.0, 1e-9, 'a bound that ignored the rounding came out UNDER the packing' );
	} );

	it( 'refuses a transfer that fits on no roll instead of costing it', function () use ( $ts_roll_config ) {
		$b = Cost::prudent_length_cm(
			array(
				array( 'id' => 'ok', 'w_cm' => 10.0, 'h_cm' => 10.0, 'qty' => 1 ),
				array( 'id' => 'trop-large', 'w_cm' => 60.0, 'h_cm' => 70.0, 'qty' => 1 ),
			),
			$ts_roll_config
		);
		truthy( ! $b['ok'] );
		eq( $b['impossible'], array( 'trop-large' ) );
		near( $b['length_cm'], 0.0, 1e-9, 'no bound at all, rather than a bound on what is left' );
	} );

	it( 'grows with quantity and never shrinks', function () use ( $ts_roll_config ) {
		$prev = 0.0;
		foreach ( array( 1, 2, 5, 30 ) as $qty ) {
			$b = Cost::prudent_length_cm(
				array( array( 'id' => 'a', 'w_cm' => 18.0, 'h_cm' => 24.0, 'qty' => $qty ) ),
				$ts_roll_config
			);
			truthy( $b['length_cm'] > $prev, "the bound did not grow at qty={$qty}" );
			$prev = $b['length_cm'];
		}
	} );

	it( 'adds a billing step per extra sheet on a run past the file limit', function () {
		// A 3 m maximum file length and 100 pieces of 20 cm: several sheets, each
		// rounded up on its own, so one rounding of the whole is not enough.
		$short = Cost::merge_config( array( 'film' => array( 'billing' => 'roll', 'width_cm' => 56.0, 'gap_cm' => 0.5, 'billing_step_cm' => 10.0, 'max_length_cm' => 300.0 ) ) );
		$b     = Cost::prudent_length_cm(
			array( array( 'id' => 'a', 'w_cm' => 30.0, 'h_cm' => 20.0, 'qty' => 100 ) ),
			$short
		);
		// 100 x 20,5 = 2 050 cm of artwork, rounded to 2 050, plus one step for
		// each of the sheets past the first.
		truthy( $b['length_cm'] >= 2050.0 );
		truthy( $b['length_cm'] <= 2050.0 + 10.0 * 10, 'and it must not run away either' );
	} );

	it( 'refuses geometry it cannot use rather than inventing a size', function () use ( $ts_roll_config ) {
		$b = Cost::prudent_length_cm(
			array(
				array( 'id' => 'a', 'w_cm' => 0.0, 'h_cm' => 24.0, 'qty' => 3 ),
				array( 'id' => 'b', 'w_cm' => 18.0, 'h_cm' => 24.0, 'qty' => 0 ),
			),
			$ts_roll_config
		);
		truthy( ! $b['ok'], 'nothing usable is not a length of zero' );
	} );
} );

describe( 'Cost: the small charges', function () use ( $ts_cost_config ) {
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

describe( 'Cost: against the Bible’s own thirty-t-shirt example', function () use ( $ts_cost_config ) {
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

		eq( $ours['amount_ht'], 283 );
		eq( $bible - $ours['amount_ht'], 4217, 'a 42,17 EUR hole in a 250,00 EUR cost' );

		/*
		 * Where it goes. At 20,00 EUR the hour, 45,00 EUR is 2 h 15 for thirty
		 * garments, i.e. 270 s a piece; question 05's two timed operations account
		 * for 17 s of that. The five untimed ones are the other 253 s, and they
		 * are exactly the operations the chapter lists and nobody has stopwatched.
		 *
		 * THE HOLE GREW WHEN HE ANSWERED, from 37,17 EUR to 42,17. His « 30
		 * secondes pour un devant + derrière » is three times faster than the
		 * written default, so the two timed operations now account for less of
		 * the chapter's own 45,00 EUR, not more. The answer made the labour line
		 * righter and the total wronger, and it is the same answer that asks for
		 * the missing chronometry.
		 */
		$implied_s = (int) round( $bible / $ts_cost_config['hourly_ht'] * 3600 );
		eq( $implied_s, 8100 );
		eq( (int) round( ( $implied_s - $ours['seconds'] ) / 30 ), 253 );
	} );

	it( 'moves the floor price by 72,29 EUR, which is what the missing times are worth', function () use ( $ts_cost_config ) {
		// THE SHIPPED RULES, not a copy of them: the point of this test is what
		// the missing chronometry costs on the shop's own margin policy, and a
		// literal target here went on saying 55 % after his answer moved it.
		$rules = array(
			'target_margin_rate'    => $ts_cost_config['target_margin_rate'],
			'min_contribution_rate' => $ts_cost_config['min_contribution_rate'],
			'commission_rate'       => 0.40,
			'max_discount_rate'     => $ts_cost_config['max_discount_rate'],
		);

		$with_ours  = Margin::plan( 25000 - 4217, $rules );
		$with_bible = Margin::plan( 25000, $rules );

		eq( $with_bible['floor_ht'] - $with_ours['floor_ht'], 7229 );
	} );
} );

describe( 'Cost: a form that owns some fields must not delete the others', function () {
	it( 'keeps the billing step when the settings screen saves the film block', function () {
		/*
		 * THE DEFECT THIS PINS, found by the adversarial pass and reproduced
		 * before it was fixed: the screen owns eight of the film block's nine
		 * fields, and a merge that replaced the whole block dropped the ninth.
		 * `prudent_length_cm` then read a billing step of 0, refused, and the
		 * film became UNKNOWN on every order costed without the nesting service.
		 * Measured on thirty tees with one 28,4 x 34,1 cm transfer: 291,94 EUR
		 * of floor price, destroyed by pressing Enregistrer once. That euro
		 * figure was measured under the roll tariff of session 05 and has not
		 * been re-measured under the sheet tariff; the defect it pins is the
		 * deleted field, which does not depend on what a metre costs.
		 *
		 * 874 and not the 870 this asserted before: the field that survives the
		 * save is the SHIPPED billing step, and question 04's answer made that
		 * the sheet height. The bound rounds 867 cm of rows up to whole steps,
		 * which is now 19 x 46 rather than 87 x 10.
		 */
		$saved = Cost::merge_config(
			array(
				'film' => array(
					'billing'     => 'roll',
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
		near( $bound['length_cm'], 874.0, 1e-9 );
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

describe( 'Cost: the bound when the file limit is close to the artwork', function () {
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
			array( 'film' => array( 'billing' => 'roll', 'width_cm' => 56.0, 'gap_cm' => 0.5, 'billing_step_cm' => 10.0, 'max_length_cm' => 40.0 ) )
		);
		$b = Cost::prudent_length_cm( array( array( 'id' => 'a', 'w_cm' => 20.0, 'h_cm' => 38.0, 'qty' => 4 ) ), $tight );

		truthy( $b['ok'] );
		/*
		 * 4 rows of 20,5 cm = 82 cm, rounded up to 90, plus one step for each of
		 * the sheets past the first. THREE and not four: session 13b added the
		 * second bound, that there are never more sheets than rows, and here it
		 * is the tighter of the two (4 rows against ceil(82 / 19,5) = 5).
		 */
		near( $b['length_cm'], 120.0, 1e-9 );

		/*
		 * AND THE ROOM DIVISOR IS STILL THE ONE UNDER TEST. Where two rows fit
		 * on a sheet the row count stops binding and the divisor is back in
		 * charge: ten rows of 10,5 cm with 29,5 cm of room is four sheets, not
		 * ten. Clamping that divisor to the billing step, which is the defect
		 * this whole block exists for, would count three and bill three
		 * roundings instead of four.
		 */
		$many = Cost::prudent_length_cm( array( array( 'id' => 'b', 'w_cm' => 10.0, 'h_cm' => 25.0, 'qty' => 10 ) ), $tight );
		truthy( $many['ok'] );
		near( $many['length_cm'], 140.0, 1e-9 );
	} );

	it( 'gives every transfer its own sheet when there is no room for a second row', function () {
		// A transfer as long as the whole file: one per sheet, necessarily. With
		// no room left, a division would be by zero or by a negative, and the
		// count falls back to the number of transfers.
		$tight = Cost::merge_config(
			array( 'film' => array( 'billing' => 'roll', 'width_cm' => 56.0, 'gap_cm' => 0.5, 'billing_step_cm' => 10.0, 'max_length_cm' => 40.0 ) )
		);
		$b = Cost::prudent_length_cm( array( array( 'id' => 'a', 'w_cm' => 50.0, 'h_cm' => 39.5, 'qty' => 3 ) ), $tight );

		truthy( $b['ok'] );
		// Its row is 39,5 cm and the file is 40: no second row fits behind it,
		// so the room is exactly zero. Three rows of 40 cm, plus a step for each
		// of the two extra sheets.
		near( $b['length_cm'], 140.0, 1e-9 );
	} );

	it( 'refuses a transfer longer than a whole print file', function () {
		$tight = Cost::merge_config( array( 'film' => array( 'billing' => 'roll', 'width_cm' => 56.0, 'max_length_cm' => 40.0 ) ) );
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

describe( 'Cost: splitting a pooled film bill', function () use ( $ts_roll_config ) {
	it( 'hands out every cent of the bill and not one more', function () use ( $ts_roll_config ) {
		$a = Cost::attribute( array( '1042' => 2.5, '1043' => 1.8, '99' => 0.9 ), 3.9, $ts_roll_config );
		$sum = 0;
		foreach ( $a['shares'] as $share ) {
			$sum += $share['share_ht'];
		}
		eq( $sum, $a['total_ht'], 'the shares must reconcile against the supplier invoice exactly' );
	} );

	it( 'reconciles on a split that does not divide evenly', function () use ( $ts_roll_config ) {
		// Three identical orders on a bill that is not a multiple of three, so the
		// leftover cents really are handed out rather than the test passing on a
		// division that happened to come out whole.
		$a = Cost::attribute( array( 'a' => 1.0, 'b' => 1.0, 'c' => 1.0 ), 1.1, $ts_roll_config );
		truthy( 0 !== $a['total_ht'] % 3, 'a bill that divides evenly would not exercise the remainder' );
		$sum = 0;
		foreach ( $a['shares'] as $share ) {
			$sum += $share['share_ht'];
		}
		eq( $sum, $a['total_ht'] );
		eq( $a['shares']['a']['share_ht'], 1155, 'the leftover cents go to the first ids, deterministically' );
		eq( $a['shares']['c']['share_ht'], 1154 );
	} );

	it( 'charges the bigger order more, always', function () use ( $ts_roll_config ) {
		$a = Cost::attribute( array( 'petit' => 0.4, 'gros' => 6.0 ), 6.2, $ts_roll_config );
		truthy(
			$a['shares']['gros']['share_ht'] > $a['shares']['petit']['share_ht'],
			'the order that would have cost more alone must pay more in the pool'
		);
	} );

	it( 'gives the same cents whatever order the orders arrive in', function () use ( $ts_roll_config ) {
		$forwards  = Cost::attribute( array( 'a' => 1.0, 'b' => 1.0, 'c' => 1.0 ), 2.0, $ts_roll_config );
		$backwards = Cost::attribute( array( 'c' => 1.0, 'b' => 1.0, 'a' => 1.0 ), 2.0, $ts_roll_config );
		foreach ( array( 'a', 'b', 'c' ) as $id ) {
			eq( $backwards['shares'][ $id ]['share_ht'], $forwards['shares'][ $id ]['share_ht'], "order $id" );
		}
	} );

	it( 'never divides by a total weight of zero', function () {
		$free = Cost::merge_config(
			array( 'film' => array( 'billing' => 'roll', 'rate_fr_ht' => 0, 'delivery_ht' => 0 ) )
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
	it( 'prices a run that buys MORE film and finds it still cheaper', function () use ( $ts_roll_config ) {
		$a = Cost::attribute( array( '1' => 0.2, '2' => 0.2 ), 0.5, $ts_roll_config );
		eq( $a['solo_total_ht'], 6570, 'two orders bought apart: two minimums, two deliveries' );
		eq( $a['total_ht'], 3285, 'one order pooled: one minimum, one delivery' );
		eq( $a['saved_ht'], 3285 );
		eq( $a['worse'], false );
	} );

	it( 'says a run is worse rather than reporting a saving nobody made', function () {
		// No supplier minimum and no delivery charge: nothing is left to hide a
		// pool that genuinely nests worse than its parts.
		$bare = Cost::merge_config(
			array( 'film' => array( 'billing' => 'roll', 'width_cm' => 56.0, 'max_length_cm' => 100.0, 'billing_step_cm' => 10.0, 'min_m' => 0.0, 'delivery_ht' => 0, 'waste_rate' => 0.0 ) )
		);
		$a = Cost::attribute( array( '1' => 0.2, '2' => 0.2 ), 0.5, $bare );
		eq( $a['total_ht'], 850 );
		eq( $a['solo_total_ht'], 680 );
		eq( $a['saved_ht'], -170, 'a negative saving is reported, never clamped to zero' );
		eq( $a['worse'], true );
	} );

	/*
	 * The alternative rule, published beside the one that is charged. The gap is
	 * the argument: on this pool the small order pays 14,65 EUR under the rule
	 * that charges the film it requires and 8,46 EUR under the rule that charges
	 * its share of the ink, 73 % apart, on the same invoice. Its ink is dense and
	 * its film is not, which is exactly the difference the two rules disagree
	 * about and exactly what a margin report has to see.
	 */
	it( 'publishes what the area rule would have charged, and it is not the same', function () use ( $ts_roll_config ) {
		$a = Cost::attribute(
			array( '1042' => 2.5, '1043' => 1.8, '99' => 0.9 ),
			3.9,
			$ts_roll_config,
			'fr',
			array( '1042' => 1800.0, '1043' => 900.0, '99' => 300.0 )
		);
		eq( $a['shares']['99']['share_ht'], 1465 );
		eq( $a['shares']['99']['area_share_ht'], 846 );
		$sum = 0;
		foreach ( $a['shares'] as $share ) {
			$sum += $share['area_share_ht'];
		}
		eq( $sum, $a['total_ht'], 'the published rule has to reconcile too, or it is not a rule' );
	} );

	it( 'falls back to equal shares when no ink area was measured', function () use ( $ts_roll_config ) {
		$a = Cost::attribute( array( 'a' => 1.0, 'b' => 3.0 ), 3.5, $ts_roll_config );
		eq(
			$a['shares']['a']['area_share_ht'] + $a['shares']['b']['area_share_ht'],
			$a['total_ht']
		);
	} );

	/*
	 * THE CORRECTION THE BENCH FORCED, kept as a test so it cannot come back.
	 *
	 * Weighting by each order's stand-alone BILL is the textbook proportional
	 * rule and it collapses under this supplier's one-metre minimum: two orders
	 * that both fall under it have the identical stand-alone bill however
	 * different they are, so the rule charged them the same. Weighted by the film
	 * they actually require, the order needing five times the film pays five
	 * times the share.
	 */
	it( 'does not charge a small order like a big one just because both hit the minimum', function () use ( $ts_roll_config ) {
		$a = Cost::attribute( array( 'petite' => 0.2, 'grosse' => 1.0 ), 1.1, $ts_roll_config );
		eq( $a['shares']['petite']['solo_ht'], $a['shares']['grosse']['solo_ht'], 'both would have paid the same minimum alone' );
		$ratio = $a['shares']['grosse']['share_ht'] / max( 1, $a['shares']['petite']['share_ht'] );
		truthy( $ratio > 4.5 && $ratio < 5.5, "five times the film should be about five times the share, got {$ratio}" );
	} );

	it( 'costs the Spanish origin at the Spanish rate and nothing else', function () use ( $ts_roll_config ) {
		$fr = Cost::attribute( array( 'a' => 2.0 ), 2.0, $ts_roll_config, 'fr' );
		$es = Cost::attribute( array( 'a' => 2.0 ), 2.0, $ts_roll_config, 'es' );
		eq( $fr['origin'], 'fr' );
		eq( $es['origin'], 'es' );
		truthy( $es['total_ht'] < $fr['total_ht'], 'Spain is the cheap origin, which is why it needs evidence' );
	} );
} );
