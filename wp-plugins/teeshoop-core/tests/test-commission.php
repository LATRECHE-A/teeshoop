<?php
/**
 * The commission: what it is computed on, and when it can be paid.
 *
 * The first block is the one that matters. It holds the three bases the Bible
 * forbids against the one it requires, on the Bible's own worked example, so a
 * future "simplification" to a percentage of revenue fails with the number it
 * would have cost.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

/* COMMAND LINE ONLY. See run.php. */
if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

require_once __DIR__ . '/../includes/Commission.php';
require_once __DIR__ . '/../includes/Margin.php';

use Teeshoop\Core\Commission;
use Teeshoop\Core\Cost;
use Teeshoop\Core\Margin;
use Teeshoop\Core\Money;

$ts_com_config = Commission::default_config();

describe( 'Commission — the base the Bible requires, and the three it forbids', function () use ( $ts_com_config ) {
	it( 'pays on the contributive margin, exactly as the worked example says', function () use ( $ts_com_config ) {
		// « Marge contributive = 625 − 250 = 375 EUR · Commission 40 % = 150 EUR »
		$rate = Commission::rate( 'premiere', $ts_com_config );
		eq( $rate, 0.40 );

		$a = Commission::accrue( 37500, $rate, 75000, 75000, Cost::REAL );
		eq( $a['full_ht'], 15000 );
		eq( $a['earned_ht'], 15000, 'paid in full, earned in full' );
	} );

	it( 'would pay out more than the order earns on either forbidden base', function () {
		$margin_ht   = 37500;
		$teeshoop_ht = $margin_ht - Money::pct( $margin_ht, 0.40 );

		$on_ttc = Money::pct( 75000, 0.40 );
		$on_ht  = Money::pct( 62500, 0.40 );

		eq( $teeshoop_ht, 22500, 'what the shop keeps before fixed costs' );
		truthy( $on_ttc > $teeshoop_ht, 'a commission on the TTC exceeds the whole result' );
		truthy( $on_ht > $teeshoop_ht, 'so does one on the revenue' );
		eq( $on_ttc - 15000, 15000, 'the TTC reading doubles the payout' );
	} );

	it( 'pays nothing on a loss', function () use ( $ts_com_config ) {
		$a = Commission::accrue( -5000, 0.40, 20000, 20000 );
		eq( $a['full_ht'], 0, 'nobody takes a share of a loss' );
		eq( $a['earned_ht'], 0 );
	} );
} );

describe( 'Commission — the rate is decided, or it is undecided', function () use ( $ts_com_config ) {
	it( 'carries question 29’s four rates', function () use ( $ts_com_config ) {
		eq( Commission::rate( 'premiere', $ts_com_config ), 0.40 );
		eq( Commission::rate( 'nouvelle', $ts_com_config ), 0.25 );
		eq( Commission::rate( 'reassort', $ts_com_config ), 0.12 );
		eq( Commission::rate( 'site', $ts_com_config ), 0.00 );
	} );

	it( 'answers null on a sale type nobody chose, rather than a default', function () use ( $ts_com_config ) {
		eq( Commission::rate( '', $ts_com_config ), null );
		eq( Commission::rate( 'premières', $ts_com_config ), null, 'a misspelling must not pay 40 %' );
	} );

	it( 'refuses a stored rate of 100 % or more', function () {
		$broken = Commission::merge_config( array( 'rates' => array( 'premiere' => 1.0 ) ) );
		eq( Commission::rate( 'premiere', $broken ), null );
	} );
} );

describe( 'Commission — on money that has arrived', function () use ( $ts_com_config ) {
	it( 'earns nothing before the first cent', function () {
		$a = Commission::accrue( 37500, 0.40, 0, 75000 );
		eq( $a['earned_ht'], 0 );
		eq( $a['remaining_ht'], 15000 );
	} );

	it( 'earns its share of a deposit rather than nothing at all', function () {
		// 50 % deposit on the worked example: half of 150,00 EUR.
		$a = Commission::accrue( 37500, 0.40, 37500, 75000 );
		near( $a['collected'], 0.5, 1e-12 );
		eq( $a['earned_ht'], 7500 );
		eq( $a['remaining_ht'], 7500 );
	} );

	it( 'never earns on an overpayment we owe back', function () {
		$a = Commission::accrue( 37500, 0.40, 90000, 75000 );
		near( $a['collected'], 1.0, 1e-12 );
		eq( $a['earned_ht'], 15000 );
	} );

	it( 'never earns on an order with nothing due', function () {
		$a = Commission::accrue( 37500, 0.40, 5000, 0 );
		eq( $a['earned_ht'], 0 );
	} );

	it( 'sums the instalments back to the whole, with one rounding', function () {
		// A margin whose commission does not divide cleanly into thirds.
		$full = Commission::accrue( 33337, 0.40, 100, 100 )['full_ht'];
		$part = Commission::accrue( 33337, 0.40, 33, 100 );
		$rest = $full - $part['earned_ht'];
		eq( $part['remaining_ht'], $rest, 'what is left is what is left, not a second rounding' );
	} );

	it( 'carries the cost basis through untouched', function () {
		eq( Commission::accrue( 100, 0.4, 1, 1, Cost::ESTIMATED )['basis'], Cost::ESTIMATED );
		eq( Commission::accrue( 100, 0.4, 1, 1, Cost::REAL )['basis'], Cost::REAL );
	} );
} );

describe( 'Commission — the four conditions of the acquisition rule', function () use ( $ts_com_config ) {
	$settled = array(
		'collected'      => 1.0,
		'delivered_on'   => '2026-07-01',
		'today'          => '2026-08-18',
		'refund_pending' => false,
		'costs_real'     => true,
	);

	it( 'is definitive only when all four are satisfied', function () use ( $settled, $ts_com_config ) {
		$s = Commission::state( $settled, $ts_com_config );
		eq( $s['state'], Commission::DEFINITIVE );
		eq( $s['open'], array() );
	} );

	it( 'is nothing at all before the first encaissement', function () use ( $settled, $ts_com_config ) {
		$s = Commission::state( array( 'collected' => 0.0 ) + $settled, $ts_com_config );
		eq( $s['state'], Commission::NONE );
	} );

	it( 'names each condition that is still open', function () use ( $settled, $ts_com_config ) {
		foreach ( array(
			array( 'collected' => 0.5 ),
			array( 'delivered_on' => '' ),
			array( 'refund_pending' => true ),
			array( 'costs_real' => false ),
		) as $broken ) {
			$s = Commission::state( $broken + $settled, $ts_com_config );
			eq( $s['state'], Commission::PROVISIONAL, 'a broken condition must not be definitive' );
			eq( count( $s['open'] ), 1 );
		}
	} );

	it( 'holds the contestation delay open until the thirtieth day', function () use ( $settled, $ts_com_config ) {
		$day29 = Commission::state( array( 'delivered_on' => '2026-07-20', 'today' => '2026-08-18' ) + $settled, $ts_com_config );
		$day30 = Commission::state( array( 'delivered_on' => '2026-07-19', 'today' => '2026-08-18' ) + $settled, $ts_com_config );

		eq( $day29['state'], Commission::PROVISIONAL, '29 days is not 30' );
		eq( $day30['state'], Commission::DEFINITIVE );
	} );

	it( 'never lets an unreadable delivery date settle a commission', function () use ( $settled, $ts_com_config ) {
		$s = Commission::state( array( 'delivered_on' => '20 juillet' ) + $settled, $ts_com_config );
		eq( $s['state'], Commission::PROVISIONAL );
	} );

	it( 'never lets a delivery date in the future settle one either', function () use ( $settled, $ts_com_config ) {
		$s = Commission::state( array( 'delivered_on' => '2026-12-01', 'today' => '2026-08-18' ) + $settled, $ts_com_config );
		eq( $s['state'], Commission::PROVISIONAL );
	} );
} );

describe( 'Commission — dates and attribution', function () use ( $ts_com_config ) {
	it( 'tells an unreadable date from a zero-day difference', function () {
		eq( Commission::days_between( '2026-08-18', '2026-08-18' ), 0 );
		eq( Commission::days_between( '2026-13-01', '2026-08-18' ), null, 'there is no thirteenth month' );
		eq( Commission::days_between( '2026-02-30', '2026-08-18' ), null, 'nor a thirtieth of February' );
		eq( Commission::days_between( '', '2026-08-18' ), null );
	} );

	it( 'keeps a customer attributed for twelve months and not thirteen', function () use ( $ts_com_config ) {
		truthy( Commission::attributed( '2026-08-18', '2027-08-18', $ts_com_config ), 'the last day counts' );
		truthy( ! Commission::attributed( '2026-08-18', '2027-08-19', $ts_com_config ) );
		truthy( ! Commission::attributed( '2027-01-01', '2026-08-18', $ts_com_config ), 'a first order in the future attributes nobody' );
	} );
} );

describe( 'Commission — discounting bites the salesperson hardest', function () {
	it( 'reproduces the Bible’s own 30 EUR against 45 EUR', function () {
		$plan = Margin::plan(
			25000,
			array(
				'target_margin_rate'  => 0.60,
				'min_contribution_ht' => 10000,
				'commission_rate'     => 0.40,
				'max_discount_rate'   => 0.15,
			)
		);

		$full     = Margin::verdict( 62500, $plan );
		$discount = Margin::verdict( 55000, $plan );

		eq( $full['commission'] - $discount['commission'], 3000, 'the rep loses 30,00 EUR' );
		eq( $full['teeshoop_ht'] - $discount['teeshoop_ht'], 4500, 'the shop loses 45,00 EUR' );
	} );
} );
