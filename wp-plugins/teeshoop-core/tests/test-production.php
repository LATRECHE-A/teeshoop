<?php
/**
 * The workshop's calendar, and the arithmetic of a promise.
 *
 * Read the last block first. It holds what question 14's own default lead times
 * produce against question 14's own default transit and press times, and the
 * answer is that two of the three promises cannot be kept on the day they are
 * made. That is a measured contradiction between defaults nobody has confirmed,
 * not a bug to be tuned away, and it is written into `QUESTIONS-ASSOCIE.md` so
 * the associate answers a number rather than a blank.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

require_once __DIR__ . '/../includes/Cost.php';
require_once __DIR__ . '/../includes/Production.php';

use Teeshoop\Core\Cost;
use Teeshoop\Core\Production;

$ts_prod_config = Production::default_config();
$ts_prod_film   = Cost::default_config()['film'];

/*
 * THE TWO-ORIGIN TARIFF, WHICH IS NO LONGER THE ONE IN FORCE.
 *
 * Question 04's answer of 1 September 2026 names ONE supplier, in France,
 * selling sheets, so `Cost::origins()` offers one origin and `origin_for` can
 * never return 'es'. The choosing logic itself is still worth covering, because
 * a second supplier is a config change away, so the three tests that describe it
 * run on an explicit roll tariff and the test below states what SHIPS.
 */
$ts_prod_roll_film = $ts_prod_film;
$ts_prod_roll_film['billing'] = 'roll';

describe( 'Production: the French calendar', function () {
	it( 'computes Easter without the calendar extension', function () {
		// Three years checked against the published dates, one of them a leap
		// year and one where Easter falls in March.
		eq( Production::easter( 2024 ), '2024-03-31' );
		eq( Production::easter( 2026 ), '2026-04-05' );
		eq( Production::easter( 2027 ), '2027-03-28' );
	} );

	it( 'knows the eleven days of metropolitan France, movable ones included', function () {
		$h = Production::holidays( 2026 );
		eq( count( $h ), 11 );
		truthy( in_array( '2026-04-06', $h, true ), 'lundi de Pâques' );
		truthy( in_array( '2026-05-14', $h, true ), 'Ascension' );
		truthy( in_array( '2026-05-25', $h, true ), 'lundi de Pentecôte' );
		truthy( in_array( '2026-07-14', $h, true ), 'fête nationale' );
	} );

	it( 'counts no weekend and no public holiday as a working day', function () {
		eq( Production::is_working_day( '2026-08-19' ), true, 'a Wednesday' );
		eq( Production::is_working_day( '2026-08-22' ), false, 'a Saturday' );
		eq( Production::is_working_day( '2026-08-23' ), false, 'a Sunday' );
		eq( Production::is_working_day( '2026-05-01' ), false, 'fête du Travail' );
		eq( Production::is_working_day( '2026-05-14' ), false, 'Ascension, which moves' );
	} );

	it( 'starts a clock on the next working day when the proof lands on a Sunday', function () {
		eq( Production::add_working_days( '2026-08-23', 0 ), '2026-08-24' );
		eq( Production::add_working_days( '2026-08-19', 0 ), '2026-08-19' );
	} );

	it( 'steps over a bank holiday instead of through it', function () {
		// 2026-05-01 is a Friday and a public holiday: one working day after
		// Thursday the 30th is Monday the 4th, not Friday the 1st.
		eq( Production::add_working_days( '2026-04-30', 1 ), '2026-05-04' );
	} );

	it( 'counts backwards, which is how every latest-order date is derived', function () {
		eq( Production::add_working_days( '2026-05-04', -1 ), '2026-04-30' );
		eq(
			Production::add_working_days( Production::add_working_days( '2026-08-19', 12 ), -12 ),
			'2026-08-19',
			'a round trip has to land where it started'
		);
	} );

	it( 'refuses a date it cannot read rather than substituting today', function () {
		eq( Production::add_working_days( '19/08/2026', 3 ), '' );
		eq( Production::add_working_days( '2026-02-30', 1 ), '' );
		eq( Production::is_working_day( 'demain' ), false );
	} );

	it( 'measures a gap in working days', function () {
		eq( Production::working_days_between( '2026-08-19', '2026-09-04' ), 12 );
		eq( Production::working_days_between( '2026-09-04', '2026-08-19' ), -12 );
		eq( Production::working_days_between( '2026-08-19', '2026-08-19' ), 0 );
	} );
} );

describe( 'Production: when the film has to be bought', function () use ( $ts_prod_config, $ts_prod_film, $ts_prod_roll_film ) {
	it( 'starts the promise at the proof and not at the payment', function () use ( $ts_prod_config ) {
		// Question 14 says « à partir de la validation du bon à tirer », and it
		// is the only one of the two dates the workshop controls: a customer who
		// sat on their proof for a fortnight has not eaten our lead time.
		eq( Production::target_date( '2026-08-19', 'standard', $ts_prod_config ), '2026-09-04' );
		eq( Production::target_date( '2026-08-19', 'express', $ts_prod_config ), '2026-08-28' );
		eq( Production::target_date( '2026-08-19', 'urgent', $ts_prod_config ), '2026-08-25' );
	} );

	it( 'reads an urgency nobody set as standard', function () use ( $ts_prod_config ) {
		eq(
			Production::target_date( '2026-08-19', '', $ts_prod_config ),
			Production::target_date( '2026-08-19', 'standard', $ts_prod_config )
		);
	} );

	it( 'gives the press a whole day even for one garment, and scales past that', function () use ( $ts_prod_config ) {
		eq( Production::press_days( 0, $ts_prod_config ), 1 );
		eq( Production::press_days( 500, $ts_prod_config ), 1 );
		eq( Production::press_days( 501, $ts_prod_config ), 2 );
		eq( Production::press_days( 1000, $ts_prod_config ), 2 );
	} );

	it( 'buys in Spain when the delay allows and in France when it does not', function () use ( $ts_prod_config, $ts_prod_roll_film ) {
		$standard = Production::origin_for( '2026-08-19', '2026-09-04', 60, $ts_prod_config, $ts_prod_roll_film );
		eq( $standard['origin'], 'es', 'twelve working days is room enough for the cheap origin' );
		eq( $standard['order_by'], '2026-08-24' );
		eq( $standard['late'], false );

		$express = Production::origin_for( '2026-08-19', '2026-08-28', 60, $ts_prod_config, $ts_prod_roll_film );
		eq( $express['origin'], 'fr', 'seven days is not' );
		eq( $express['late'], false );
	} );

	it( 'schedules a late order at the fastest origin instead of dropping it', function () use ( $ts_prod_config, $ts_prod_roll_film ) {
		$late = Production::origin_for( '2026-08-19', '2026-08-21', 60, $ts_prod_config, $ts_prod_roll_film );
		eq( $late['origin'], 'fr' );
		eq( $late['late'], true );
		truthy( '' !== $late['order_by'], 'a late order still needs a date to be chased against' );
	} );

	it( 'offers ONE origin on the tariff actually in force, and it is France', function () use ( $ts_prod_config, $ts_prod_film ) {
		/*
		 * The three tests around this one describe a choice between two
		 * suppliers. There is one. Buying « in Spain » would schedule a run
		 * against a five-day transit for a saving that does not exist, and it
		 * would put every standard order three working days later than it needs
		 * to be. This is the test that fails the day somebody restores the
		 * cheaper origin without restoring a supplier to buy it from.
		 */
		eq( Cost::origins( $ts_prod_film ), array( 'fr' ) );

		$roomy = Production::origin_for( '2026-08-19', '2026-10-30', 60, $ts_prod_config, $ts_prod_film );
		eq( $roomy['origin'], 'fr', 'all the calendar in the world does not conjure a second supplier' );
		eq( $roomy['order_by_es'], '', 'and no Spanish date is offered to an operator either' );
		eq( $roomy['late'], false );
	} );

	it( 'pushes a big order onto the fast origin, because pressing it takes days', function () use ( $ts_prod_config, $ts_prod_roll_film ) {
		// 2 400 and not the 1 400 this used to say: question 23's answer raised the
		// press from 300 pieces a day to 500, so 1 400 garments are three days of
		// pressing instead of five and the slow origin fits again. The threshold
		// moved, the rule did not.
		$small = Production::origin_for( '2026-08-19', '2026-09-04', 60, $ts_prod_config, $ts_prod_roll_film );
		$big   = Production::origin_for( '2026-08-19', '2026-09-04', 2400, $ts_prod_config, $ts_prod_roll_film );
		eq( $small['origin'], 'es' );
		eq( $big['origin'], 'fr', 'five days of pressing eat the whole Spanish margin' );
	} );
} );

describe( 'Production: parameters', function () {
	it( 'keeps the lead times a partial save did not mention', function () {
		$c = Production::merge_config( array( 'lead_days' => array( 'urgent' => 6 ) ) );
		eq( $c['lead_days']['urgent'], 6 );
		eq( $c['lead_days']['standard'], 12, 'a partial save must not delete the keys it is silent about' );
		eq( $c['press_per_day'], 500 );
	} );

	it( 'ignores a key it does not know and a value that is not a number', function () {
		$c = Production::merge_config( array( 'cadence' => 9, 'ship_days' => 'vite' ) );
		eq( isset( $c['cadence'] ), false );
		eq( $c['ship_days'], 2 );
	} );
} );

describe( 'Production: the promise that cannot be kept', function () use ( $ts_prod_config, $ts_prod_film ) {
	/*
	 * FOUR DEFAULTS, NONE CONFIRMED, AND THEY CONTRADICT EACH OTHER.
	 *
	 * Question 14's default urgency is 4 working days from an approved proof to a
	 * parcel. The work in between, at question 14's and question 04's own other
	 * defaults, is 2 days of Colissimo + 1 day of pressing + 1 day of slack +
	 * 2 days of French film transit = 6 working days. Every urgent order is two
	 * days late before anybody touches it, and express has exactly one day of
	 * slack, which is the buffer itself.
	 *
	 * The numbers are asserted rather than described so that a late answer from
	 * the associate moves a test rather than a paragraph.
	 */
	it( 'measures two days of impossibility in the urgent promise', function () use ( $ts_prod_config, $ts_prod_film ) {
		$f = Production::feasibility( $ts_prod_config, $ts_prod_film );
		eq( $f['urgent']['fr'], -2, 'four days promised, six days of work' );
		eq( $f['urgent']['es'], -5 );
	} );

	it( 'leaves express one day of slack in France and none at all in Spain', function () use ( $ts_prod_config, $ts_prod_film ) {
		$f = Production::feasibility( $ts_prod_config, $ts_prod_film );
		eq( $f['express']['fr'], 1 );
		eq( $f['express']['es'], -2 );
	} );

	it( 'leaves the standard promise real room, which is why Spain is reachable', function () use ( $ts_prod_config, $ts_prod_film ) {
		$f = Production::feasibility( $ts_prod_config, $ts_prod_film );
		eq( $f['standard']['fr'], 6 );
		eq( $f['standard']['es'], 3 );
	} );
} );

describe( 'Production: reading a layout the shop did not compute', function () {
	$layout = static function ( array $over = array() ): array {
		return array_merge(
			array(
				'pooled_m' => 4.0,
				/*
				 * The geometry the layout was packed on. Without it the shop
				 * cannot tell that a run it is buying 56 cm of film for was
				 * nested 58 cm wide, and a wider sheet is a SHORTER one, so no
				 * other bound can see it either.
				 */
				'width_cm' => 56.0,
				'gap_cm'   => 0.5,
				'orders'   => array(
					'12' => array(
						'solo_m' => 2.5,
						'poses'  => 10,
						'pieces' => array( array( 'key' => 'front', 'w_cm' => 20.0, 'h_cm' => 25.0, 'qty' => 10 ) ),
					),
				),
			),
			$over
		);
	};

	it( 'reads a well-formed layout and totals its copies and its area', function () use ( $layout ) {
		$r = Production::read_layout( $layout(), array( 12 ) );
		eq( $r['ok'], true, $r['reason'] );
		eq( $r['orders']['12']['copies'], 10 );
		near( $r['orders']['12']['area_sq_cm'], 5000.0, 1e-9 );
	} );

	it( 'refuses a layout that will not say which roll it was packed on', function () use ( $layout ) {
		$mute = $layout();
		unset( $mute['width_cm'] );
		eq( Production::read_layout( $mute, array( 12 ) )['ok'], false );
		eq( Production::read_layout( $layout( array( 'width_cm' => 0 ) ), array( 12 ) )['ok'], false );
		eq( Production::read_layout( $layout( array( 'gap_cm' => -1 ) ), array( 12 ) )['ok'], false );
	} );

	it( 'refuses a length that is not a length', function () use ( $layout ) {
		eq( Production::read_layout( $layout( array( 'pooled_m' => 0 ) ), array( 12 ) )['ok'], false );
		eq( Production::read_layout( $layout( array( 'pooled_m' => 'quatre' ) ), array( 12 ) )['ok'], false );
		eq( Production::read_layout( $layout( array( 'pooled_m' => 99999 ) ), array( 12 ) )['ok'], false );
	} );

	it( 'refuses a transfer with implausible dimensions instead of costing it', function () use ( $layout ) {
		$bad = $layout();
		$bad['orders']['12']['pieces'][0]['w_cm'] = 0;
		eq( Production::read_layout( $bad, array( 12 ) )['ok'], false );
		$huge = $layout();
		$huge['orders']['12']['pieces'][0]['h_cm'] = 500;
		eq( Production::read_layout( $huge, array( 12 ) )['ok'], false );
	} );

	it( 'refuses a layout that is silent about an order in the lot', function () use ( $layout ) {
		eq( Production::read_layout( $layout(), array( 12, 13 ) )['ok'], false );
	} );

	it( 'refuses a layout that will not say how many poses it carries', function () use ( $layout ) {
		// Derived from the pieces it would be worthless: a layout that had lost a
		// side would derive the wrong number from its own wrong pieces and pass.
		$mute = $layout();
		unset( $mute['orders']['12']['poses'] );
		eq( Production::read_layout( $mute, array( 12 ) )['ok'], false );
	} );

	it( 'refuses a layout carrying an order that is NOT in the lot', function () use ( $layout ) {
		// The dangerous direction: extra transfers on the film that nobody in
		// this lot is paying for, and that somebody will press onto a garment.
		$extra = $layout();
		$extra['orders']['99'] = $extra['orders']['12'];
		eq( Production::read_layout( $extra, array( 12 ) )['ok'], false );
	} );

	it( 'never lets a layout choose the packer it claims to be', function () use ( $layout ) {
		$r = Production::read_layout( $layout( array( 'packer' => 'magique' ) ), array( 12 ) );
		eq( $r['layout']['packer'], 'shelf', 'an unknown packer reads as the conservative one' );
	} );
} );

describe( 'Production: the floor a reported length must clear', function () {
	it( 'is the artwork divided by the roll, in metres', function () {
		near( Production::minimum_length_m( 5600.0, 56.0 ), 1.0, 1e-9 );
		near( Production::minimum_length_m( 28000.0, 56.0 ), 5.0, 1e-9 );
	} );

	it( 'refuses to invent a bound it cannot derive', function () {
		eq( Production::minimum_length_m( 0.0, 56.0 ), 0.0 );
		eq( Production::minimum_length_m( 5600.0, 0.0 ), 0.0 );
	} );
} );

describe( 'Production: a lot that has bought film is frozen', function () {
	it( 'calls every state but the draft frozen', function () {
		eq( Production::frozen( Production::DRAFT ), false );
		eq( Production::frozen( Production::SENT ), true );
		eq( Production::frozen( Production::RECEIVED ), true );
		eq( Production::frozen( Production::DONE ), true );
	} );

	it( 'names every state in French for an operator', function () {
		$states = Production::states();
		eq( count( $states ), 4 );
		foreach ( $states as $slug => $label ) {
			truthy( '' !== $label, "state $slug has no label" );
		}
	} );
} );

describe( 'Production: a waiver is not an approval', function () {
	it( 'records who cleared the proof, because a dispute turns on it', function () {
		$approved = Production::approval(
			array( 'version' => 3, 'approval' => array( 'at' => '2026-08-17T09:30:00+00:00' ) )
		);
		eq( $approved['by'], 'client' );
		eq( $approved['on'], '2026-08-17' );
		eq( $approved['version'], 3 );

		$waived = Production::approval(
			array( 'version' => 3, 'waiver' => array( 'at' => '2026-08-17T09:30:00+00:00' ) )
		);
		eq( $waived['by'], 'atelier', 'the workshop waived it; nobody approved anything' );
	} );

	it( 'clears nothing while the customer is asking for changes', function () {
		$asked = Production::approval(
			array(
				'version'  => 3,
				'approval' => array( 'at' => '2026-08-17T09:30:00+00:00' ),
				'changes'  => array( array( 'at' => '2026-08-19T10:00:00+00:00' ) ),
			)
		);
		eq( $asked['on'], '' );
	} );

	it( 'clears nothing when there is no proof at all', function () {
		eq( Production::approval( null )['on'], '' );
		eq( Production::approval( array( 'version' => 1 ) )['on'], '' );
	} );
} );
