<?php
/**
 * Cost, floor price, commission — and the Bible formula that is wrong.
 *
 * The last describe() block is the one that matters: it holds the corrected
 * formula against the Bible's own worked example, so if anyone ever "restores"
 * the original formula the test says which number moved and by how much.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

require_once __DIR__ . '/../includes/Margin.php';

use Teeshoop\Core\Margin;

describe( 'Margin — cost', function () {
	it( 'adds the components it is given', function () {
		$c = Margin::cost(
			array(
				'blanks'    => 25000,
				'film'      => 4200,
				'labour'    => 6000,
				'packaging' => 800,
				'shipping'  => 1500,
				'other'     => 0,
			)
		);
		eq( $c['total_ht'], 37500 );
		eq( $c['missing'], array() );
	} );

	it( 'names the components nobody filled in, instead of looking complete', function () {
		$c = Margin::cost( array( 'blanks' => 25000 ) );
		eq( $c['total_ht'], 25000 );
		eq( $c['missing'], array( 'film', 'labour', 'packaging', 'shipping', 'other' ) );
	} );

	it( 'treats an explicit zero as answered, not as missing', function () {
		$c = Margin::cost(
			array(
				'blanks'    => 25000,
				'film'      => 0,
				'labour'    => 0,
				'packaging' => 0,
				'shipping'  => 0,
				'other'     => 0,
			)
		);
		eq( $c['missing'], array() );
	} );
} );

describe( 'Margin — recommended price', function () {
	it( 'hits the target margin rate exactly', function () {
		// 250 € cost at a 60 % target margin → 625 €, the Bible's own example.
		$price = Margin::recommended_price( 25000, 0.60 );
		eq( $price, 62500 );

		$out = Margin::outcome( $price, 25000, 0.40, 0 );
		near( $out['margin_rate'], 0.60, 1e-9 );
	} );

	it( 'refuses an impossible target instead of dividing by zero', function () {
		throws( fn() => Margin::recommended_price( 25000, 1.0 ) );
		throws( fn() => Margin::recommended_price( 25000, 1.5 ) );
		throws( fn() => Margin::recommended_price( 25000, -0.1 ) );
	} );

	it( 'returns the cost itself at a zero target', function () {
		eq( Margin::recommended_price( 25000, 0.0 ), 25000 );
	} );
} );

describe( 'Margin — commission', function () {
	it( 'reproduces the Bible worked example', function () {
		// « Marge contributive = 625 − 250 = 375 EUR · Commission 40 % = 150 EUR »
		$out = Margin::outcome( 62500, 25000, 0.40, 0 );
		eq( $out['margin_ht'], 37500 );
		eq( $out['commission'], 15000 );
		eq( $out['teeshoop_ht'], 22500 );
	} );

	it( 'reproduces the Bible discounted example', function () {
		// « Nouvelle marge = 300 EUR · Commission = 120 EUR »
		$out = Margin::outcome( 55000, 25000, 0.40, 0 );
		eq( $out['margin_ht'], 30000 );
		eq( $out['commission'], 12000 );
	} );

	it( 'pays no commission on a loss', function () {
		$out = Margin::outcome( 20000, 25000, 0.40, 30000 );
		eq( $out['margin_ht'], -5000 );
		eq( $out['commission'], 0, 'nobody earns a share of a loss' );
		truthy( $out['below_cost'] );
		truthy( $out['below_floor'] );
	} );

	it( 'costs the salesperson more than the shop, which is the whole point', function () {
		$full     = Margin::outcome( 62500, 25000, 0.40, 0 );
		$discount = Margin::outcome( 55000, 25000, 0.40, 0 );

		$shop_loss = $full['teeshoop_ht'] - $discount['teeshoop_ht'];
		$rep_loss  = $full['commission'] - $discount['commission'];

		// A 75 € discount costs the shop 45 € and the salesperson 30 € — but as a
		// share of what each was getting, the salesperson gives up the most.
		truthy(
			$rep_loss / $full['commission'] >= $shop_loss / $full['teeshoop_ht'],
			'discounting must bite the salesperson at least as hard'
		);
	} );
} );

describe( 'Margin — the floor price, corrected', function () {
	it( 'leaves exactly the minimum contribution after commission', function () {
		// This is the property the floor is FOR. C = 250 €, K = 100 €, c = 40 %.
		$floor = Margin::floor_price( 25000, 10000, 0.40 );
		$out   = Margin::outcome( $floor, 25000, 0.40, $floor );

		eq( $out['teeshoop_ht'], 10000, 'selling at the floor must leave exactly K' );
		truthy( ! $out['below_floor'] );
	} );

	it( 'is NOT what the Bible formula gives — and the gap is the bug', function () {
		$cost       = 25000;
		$min_contrib = 10000;
		$commission = 0.40;

		$correct = Margin::floor_price( $cost, $min_contrib, $commission );
		// The Bible: (C_total + contribution minimale) / (1 − taux commission)
		$bible   = (int) round( ( $cost + $min_contrib ) / ( 1 - $commission ) );

		eq( $correct, 41667, 'C + K/(1−c) = 250 + 166,67' );
		eq( $bible, 58333, 'the published formula' );

		// Selling at the Bible's floor leaves far more than the minimum, so the
		// shop refuses deals it would happily have taken.
		$at_bible = Margin::outcome( $bible, $cost, $commission, $correct );
		truthy( $at_bible['teeshoop_ht'] > $min_contrib * 1.9, 'the published floor massively overshoots' );
	} );

	it( 'never sits below cost, whatever the commission rate', function () {
		foreach ( array( 0.0, 0.1, 0.25, 0.4, 0.6, 0.9 ) as $rate ) {
			$floor = Margin::floor_price( 25000, 10000, $rate );
			truthy( $floor >= 25000, "floor fell below cost at c={$rate}" );
		}
	} );

	it( 'rises with the commission rate, because the shop must still keep K', function () {
		$prev = 0;
		foreach ( array( 0.0, 0.1, 0.25, 0.4, 0.6, 0.9 ) as $rate ) {
			$floor = Margin::floor_price( 25000, 10000, $rate );
			truthy( $floor > $prev, "floor did not rise at c={$rate}" );
			$prev = $floor;
		}
	} );

	it( 'equals cost plus the target when nobody takes a commission', function () {
		eq( Margin::floor_price( 25000, 10000, 0.0 ), 35000 );
	} );

	it( 'refuses a commission rate of 100 % instead of dividing by zero', function () {
		throws( fn() => Margin::floor_price( 25000, 10000, 1.0 ) );
		throws( fn() => Margin::floor_price( 25000, 10000, -0.2 ) );
	} );

	it( 'leaves a negotiation zone between the recommended price and the floor', function () {
		$cost        = 25000;
		$recommended = Margin::recommended_price( $cost, 0.60 );
		$floor       = Margin::floor_price( $cost, 10000, 0.40 );
		truthy( $recommended > $floor, 'there must be room to negotiate' );
	} );
} );
