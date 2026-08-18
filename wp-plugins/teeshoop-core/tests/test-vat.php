<?php
/**
 * The VAT regime, as a timeline.
 *
 * The point of these cases is not that 20 % of 100 is 20. It is that the shape
 * can express the two regimes a French company actually moves between, that it
 * refuses to answer for a date nobody has recorded, and that moving the timeline
 * never moves a number an invoice already carries.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

/*
 * COMMAND LINE ONLY. `wp-content/plugins/` is served by URL and this directory
 * is inside it: before the guards, GET on any of these files ran the suite to
 * the public internet and printed the figures of every failing assertion.
 */
if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

require_once __DIR__ . '/../includes/Money.php';
require_once __DIR__ . '/../includes/Pricing.php';
require_once __DIR__ . '/../includes/Vat.php';

use Teeshoop\Core\Pricing;
use Teeshoop\Core\Vat;

/** A timeline that switches from franchise to the standard regime on a date. */
function ts_vat_switching(): array {
	return Vat::merge_periods(
		array(
			array(
				'from'   => '2024-01-01',
				'regime' => Vat::FRANCHISE,
			),
			array(
				'from'   => '2026-04-01',
				'regime' => Vat::STANDARD,
			),
		)
	);
}

describe( 'Vat: the shipped timeline', function () {
	it( 'covers the day it opens and nothing before it', function () {
		$periods = Vat::default_periods();
		$pricing = Pricing::default_config();

		$open = Vat::regime( Vat::ASSUMED_FROM, $periods, $pricing );
		truthy( $open['known'], 'the timeline does not cover its own first day' );
		eq( $open['regime'], Vat::STANDARD );

		// The fifteen real orders of constat 6 are dated 2024-11-21 to
		// 2025-04-18. Nobody recorded which regime produced them, so the code
		// must say so rather than pick one.
		foreach ( array( '2024-11-21', '2025-04-18', '2026-08-17' ) as $before ) {
			$got = Vat::regime( $before, $periods, $pricing );
			truthy( ! $got['known'], "{$before} was answered for" );
			eq( $got['regime'], '' );
			eq( $got['rate'], 0.0 );
		}
	} );

	it( 'never lets "we do not know" read as "no VAT"', function () {
		$unknown = Vat::regime( '2020-01-01', Vat::default_periods(), Pricing::default_config() );
		// Both are zero, and that is exactly the trap: the caller must read
		// `known`, so the difference is carried and cannot be inferred from the
		// rate alone.
		eq( $unknown['rate'], 0.0 );
		eq( $unknown['known'], false );

		$franchise = Vat::regime( '2024-06-01', ts_vat_switching(), Pricing::default_config() );
		eq( $franchise['rate'], 0.0 );
		eq( $franchise['known'], true );
	} );

	it( 'takes the standard rate from the price config rather than restating it', function () {
		$pricing             = Pricing::default_config();
		$pricing['vat_rate'] = 0.055;
		$got                 = Vat::regime( Vat::ASSUMED_FROM, Vat::default_periods(), $pricing );
		eq( $got['rate'], 0.055, 'the timeline keeps a second copy of the rate' );
	} );
} );

describe( 'Vat: franchise en base', function () {
	it( 'charges nothing and carries the mention the law requires', function () {
		$got = Vat::regime( '2025-06-30', ts_vat_switching(), Pricing::default_config() );
		eq( $got['regime'], Vat::FRANCHISE );
		eq( $got['rate'], 0.0 );
		eq( $got['mention'], 'TVA non applicable, article 293 B du CGI' );
		/*
		 * A PERIOD CARRIES NO VAT NUMBER AT ALL. The number belongs to the
		 * company and lives once, in the legal identity; it had a second home
		 * here, and the invoice printed one copy while the checks policed the
		 * other.
		 */
		truthy( ! array_key_exists( 'vat_number', $got ), 'the regime still carries a VAT number' );
	} );

	it( 'makes TTC equal HT through the price authority, with no special case', function () {
		$config             = Pricing::default_config();
		$franchise          = $config;
		$franchise['vat_rate'] = Vat::regime( '2025-06-30', ts_vat_switching(), $config )['rate'];

		$quote = Pricing::quote(
			array(
				'garment' => 'tee',
				'qty'     => 25,
				'sides'   => array( array( 'id' => 'front', 'area_sq_cm' => 400 ) ),
			),
			$franchise
		);
		eq( $quote['total_vat'], 0 );
		eq( $quote['total_ttc'], $quote['total_ht'] );
		eq( $quote['unit_ttc'], $quote['unit_ht'] );
		truthy( $quote['total_ht'] > 0, 'the fixture priced nothing at all' );
	} );

	it( 'prints no mention under the standard regime', function () {
		$got = Vat::regime( '2026-04-01', ts_vat_switching(), Pricing::default_config() );
		eq( $got['regime'], Vat::STANDARD );
		eq( $got['mention'], '' );
	} );
} );

describe( 'Vat: the switch date', function () {
	it( 'switches ON the date and not the day before', function () {
		$periods = ts_vat_switching();
		$pricing = Pricing::default_config();

		$eve = Vat::regime( '2026-03-31', $periods, $pricing );
		$day = Vat::regime( '2026-04-01', $periods, $pricing );

		eq( $eve['regime'], Vat::FRANCHISE );
		eq( $eve['rate'], 0.0 );
		eq( $day['regime'], Vat::STANDARD );
		eq( $day['rate'], (float) $pricing['vat_rate'] );
		// The whole reason the shape is a timeline: two orders one day apart are
		// two different documents.
		truthy( $eve['mention'] !== $day['mention'], 'both sides of the switch print the same mention' );
	} );

	it( 'stays on the last period for every date after it', function () {
		$periods = ts_vat_switching();
		foreach ( array( '2026-04-02', '2027-01-01', '2099-12-31' ) as $later ) {
			eq( Vat::regime( $later, $periods, Pricing::default_config() )['regime'], Vat::STANDARD, $later );
		}
	} );

	it( 'resolves the same way whatever order the periods arrive in', function () {
		$forward  = ts_vat_switching();
		$backward = array_reverse( $forward );
		foreach ( array( '2024-06-01', '2026-03-31', '2026-04-01', '2030-01-01' ) as $date ) {
			eq(
				Vat::at( $date, $backward )['regime'] ?? '',
				Vat::at( $date, $forward )['regime'] ?? '',
				"unsorted timeline at {$date}"
			);
		}
	} );
} );

describe( 'Vat: reading what was stored', function () {
	it( 'falls back to the shipped default only when nothing was stored', function () {
		eq( Vat::merge_periods( null ), Vat::default_periods() );
		eq( Vat::merge_periods( 'not an array' ), Vat::default_periods() );

		/*
		 * An EMPTY list is a decision, not an absence. Restoring 20 % over an
		 * operator who has just removed every period would charge VAT they had
		 * deliberately deleted, which is the same class of mistake as the fifteen
		 * orders taken with taxes switched off.
		 */
		eq( Vat::merge_periods( array() ), array() );
		eq( Vat::at( '2026-08-18', array() ), null );
	} );

	it( 'drops a period it cannot read rather than guessing at it', function () {
		$periods = Vat::merge_periods(
			array(
				array( 'from' => '2026-02-30', 'regime' => Vat::STANDARD ), // no such day
				array( 'from' => 'bientot', 'regime' => Vat::STANDARD ),
				array( 'from' => '2026-01-01', 'regime' => 'micro' ),       // no such regime
				array( 'from' => '2026-01-01' ),
				'not a period',
				array( 'from' => '2026-01-01', 'regime' => Vat::FRANCHISE ),
			)
		);
		eq( count( $periods ), 1 );
		eq( $periods[0]['regime'], Vat::FRANCHISE );
	} );

	it( 'accepts a rate override on a standard period and refuses one on a franchise period', function () {
		$periods = Vat::merge_periods(
			array(
				array( 'from' => '2020-01-01', 'regime' => Vat::FRANCHISE, 'rate' => 0.20 ),
				array( 'from' => '2027-01-01', 'regime' => Vat::STANDARD, 'rate' => 0.10, 'vat_number' => 'FR40123456824' ),
			)
		);
		truthy( ! isset( $periods[0]['rate'] ), 'a franchise period kept a rate' );
		eq( $periods[1]['rate'], 0.10 );

		$pricing = Pricing::default_config();
		eq( Vat::regime( '2021-01-01', $periods, $pricing )['rate'], 0.0 );
		eq( Vat::regime( '2027-06-01', $periods, $pricing )['rate'], 0.10 );
	} );

	it( 'refuses a rate override that is not a rate', function () {
		foreach ( array( 1.0, 1.5, -0.2, 'vingt' ) as $bad ) {
			$periods = Vat::merge_periods( array( array( 'from' => '2027-01-01', 'regime' => Vat::STANDARD, 'rate' => $bad ) ) );
			truthy( ! isset( $periods[0]['rate'] ), 'accepted a rate of ' . var_export( $bad, true ) );
		}
	} );

	it( 'normalises a VAT number the way a human types it', function () {
		eq( Vat::vat_number( ' fr40 123 456 824 ' ), 'FR40123456824' );
		eq( Vat::vat_number( '' ), '' );
		eq( strlen( Vat::vat_number( str_repeat( 'A', 40 ) ) ), 20 );
	} );

	it( 'reads and writes only real calendar dates', function () {
		eq( Vat::iso_date( '2026-02-29' ), '' );
		eq( Vat::iso_date( '2024-02-29' ), '2024-02-29' );
		eq( Vat::iso_date( '2026-13-01' ), '' );
		eq( Vat::iso_date( '18/08/2026' ), '' );
		eq( Vat::fr_date( '2026-08-18' ), '18/08/2026' );
		eq( Vat::fr_date( 'jamais' ), '' );
	} );
} );

describe( 'Vat: what the operator is told', function () {
	it( 'says so when there is no timeline at all', function () {
		$problems = Vat::problems( array(), '2026-08-18' );
		eq( count( $problems ), 1 );
		truthy( str_contains( $problems[0], 'Aucune période' ), 'the message does not name the fault' );
	} );

	it( 'says so when the timeline starts after today', function () {
		$periods  = Vat::merge_periods( array( array( 'from' => '2027-01-01', 'regime' => Vat::STANDARD ) ) );
		$problems = Vat::problems( $periods, '2026-08-18' );
		truthy( count( $problems ) >= 1 );
		truthy( str_contains( $problems[0], '01/01/2027' ), 'the message does not name the date' );
	} );

	it( 'warns about a switch that has not happened yet, because of the délivrance rule', function () {
		/*
		 * For a supply of goods the tax is due at the DELIVERY, not at the
		 * invoice. An order paid before a switch and delivered after it needs a
		 * rectificative invoice, and the site does not produce one, so the only
		 * honest thing is to say so while there is time to ask an accountant.
		 */
		$periods  = Vat::merge_periods(
			array(
				array( 'from' => '2020-01-01', 'regime' => Vat::FRANCHISE ),
				array( 'from' => '2027-01-01', 'regime' => Vat::STANDARD ),
			)
		);
		$problems = Vat::problems( $periods, '2026-08-18' );
		eq( count( $problems ), 1 );
		truthy( str_contains( $problems[0], 'facture rectificative' ), 'the warning does not say what is owed' );
	} );

	it( 'is silent on a timeline that is complete and settled', function () {
		eq( Vat::problems( ts_vat_switching(), '2026-08-18' ), array() );
		eq( Vat::problems( Vat::default_periods(), Vat::ASSUMED_FROM ), array() );
	} );
} );
