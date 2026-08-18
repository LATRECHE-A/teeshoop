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

/*
 * COMMAND LINE ONLY.
 *
 * `wp-content/plugins/` is served by URL and this directory is inside it.
 * Before this line, GET /wp-content/plugins/teeshoop-core/tests/run.php
 * answered 200 and ran the whole suite to the public internet: it names the
 * floor-price and commission rules, it prints the expected and actual figures
 * of any assertion that fails, and on shared hosting it burns the CPU of
 * whoever asks. The customer bundle is guarded against exactly this leak by
 * scripts/bundle-guard.mjs; the same material was reachable in PHP, and an
 * unguessable path is not an access control.
 *
 * PHP_SAPI rather than a WP_CLI check, because `php tests/run.php` runs with no
 * WordPress at all while the two integration files run under wp-cli, which is
 * also CLI. It must come after any `declare`, which has to be the first
 * statement of a script.
 */
if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

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

describe( 'Margin — "taux de marge" names the other ratio', function () {
	it( 'shows how far apart the two readings of question 06 are', function () {
		// The Bible's formula, which its own example confirms, is the taux de
		// MARQUE: margin over selling price.
		$marque = Margin::recommended_price( 25000, 0.55 );
		// What the words "taux de marge" normally mean: a mark-up on the cost.
		$marge  = Margin::mark_up_price( 25000, 0.55 );

		eq( $marque, 55556, '250,00 / (1 − 0,55)' );
		eq( $marge, 38750, '250,00 x 1,55' );
		eq( $marque - $marge, 16806, '168,06 EUR on one order, on the same answer' );
	} );

	it( 'agrees with itself at zero and diverges everywhere else', function () {
		eq( Margin::recommended_price( 25000, 0.0 ), Margin::mark_up_price( 25000, 0.0 ) );
		foreach ( array( 0.1, 0.3, 0.55, 0.8 ) as $rate ) {
			truthy(
				Margin::recommended_price( 25000, $rate ) > Margin::mark_up_price( 25000, $rate ),
				"the two readings coincided at {$rate}, which they must not"
			);
		}
	} );

	it( 'lets a mark-up exceed 100 %, which a margin rate never can', function () {
		eq( Margin::mark_up_price( 10000, 1.5 ), 25000 );
		throws( fn() => Margin::recommended_price( 10000, 1.5 ) );
		throws( fn() => Margin::mark_up_price( 10000, -0.1 ) );
	} );
} );

describe( 'Margin — the floor when the contribution is a rate', function () {
	it( 'leaves exactly that share of the price after commission', function () {
		$floor = Margin::floor_price_rate( 25000, 0.25, 0.40 );
		$out   = Margin::outcome( $floor, 25000, 0.40, $floor );

		eq( $floor, 42857, '250,00 / (1 − 0,25/0,60)' );
		// 25 % of 428,57 is 107,14, and that is what is left.
		near( $out['teeshoop_ht'] / $floor, 0.25, 1e-4, 'selling at the floor keeps exactly k' );
	} );

	it( 'sits between the corrected absolute floor and the published one', function () {
		$published = (int) round( ( 25000 + 10000 ) / ( 1 - 0.40 ) );
		$absolute  = Margin::floor_price( 25000, 10000, 0.40 );
		$by_rate   = Margin::floor_price_rate( 25000, 0.25, 0.40 );

		eq( $published, 58333 );
		eq( $absolute, 41667 );
		eq( $by_rate, 42857 );
		truthy( $absolute < $by_rate && $by_rate < $published, 'the three floors, in order' );
	} );

	it( 'refuses the combination that has no solution instead of returning a negative price', function () {
		// k = 25 % of the price while paying away 80 % of the margin: impossible
		// at any price. The unguarded division returns a negative number, and a
		// negative floor is below every price there is.
		throws( fn() => Margin::floor_price_rate( 25000, 0.25, 0.80 ) );
		near( 25000 / ( 1 - 0.25 / ( 1 - 0.80 ) ), -100000.0, 1e-3, 'this is what the naive form gives: a floor of −1 000,00 EUR' );
	} );

	it( 'refuses the exact boundary too', function () {
		// k = 1 − c divides by zero.
		throws( fn() => Margin::floor_price_rate( 25000, 0.60, 0.40 ) );
		// One notch inside it is enormous but finite.
		truthy( Margin::floor_price_rate( 25000, 0.59, 0.40 ) > 1000000 );
	} );

	it( 'rises with both rates', function () {
		$prev = 0;
		foreach ( array( 0.0, 0.1, 0.25, 0.4 ) as $k ) {
			$floor = Margin::floor_price_rate( 25000, $k, 0.40 );
			truthy( $floor > $prev, "the floor did not rise at k={$k}" );
			$prev = $floor;
		}
		truthy( Margin::floor_price_rate( 25000, 0.25, 0.50 ) > Margin::floor_price_rate( 25000, 0.25, 0.40 ) );
	} );

	it( 'is the cost itself when nothing has to be kept', function () {
		eq( Margin::floor_price_rate( 25000, 0.0, 0.40 ), 25000 );
	} );
} );

describe( 'Margin — the plan a salesperson negotiates inside', function () {
	$rules = array(
		'target_margin_rate'    => 0.55,
		'min_contribution_rate' => 0.25,
		'commission_rate'       => 0.40,
		'max_discount_rate'     => 0.15,
	);

	it( 'gives the four numbers the chapter asks for', function () use ( $rules ) {
		$plan = Margin::plan( 25000, $rules );
		eq( $plan['recommended_ht'], 55556 );
		eq( $plan['floor_ht'], 42857 );
		eq( $plan['zone_ht'], 12699 );
		eq( $plan['free_from_ht'], 47223, '15 % off 555,56 is 472,23, still above the floor' );
		eq( $plan['binding'], 'remise' );
		truthy( ! $plan['raised_to_floor'] );
	} );

	it( 'raises a recommended price that would sit under its own floor, and says it did', function () {
		// A 40 % target with a 25 % contribution after a 40 % commission: the
		// target price is 416,67 and the floor is 428,57. Publishing the target
		// would invite a salesperson to negotiate down from a price that already
		// needs a derogation.
		$plan = Margin::plan(
			25000,
			array(
				'target_margin_rate'    => 0.40,
				'min_contribution_rate' => 0.25,
				'commission_rate'       => 0.40,
				'max_discount_rate'     => 0.15,
			)
		);
		eq( $plan['by_target_ht'], 41667 );
		eq( $plan['floor_ht'], 42857 );
		eq( $plan['recommended_ht'], 42857 );
		truthy( $plan['raised_to_floor'], 'two settings that contradict each other must be visible' );
		eq( $plan['zone_ht'], 0, 'there is nothing to negotiate' );
		eq( $plan['binding'], 'plancher' );
	} );

	it( 'takes the discount cap off the recommended price, not off the offer', function () use ( $rules ) {
		$plan = Margin::plan( 25000, $rules );
		// Read the other way, every price is within 15 % of itself and the cap
		// never binds.
		truthy( $plan['free_from_ht'] < $plan['recommended_ht'] );
		eq( $plan['free_from_ht'], $plan['recommended_ht'] - (int) round( $plan['recommended_ht'] * 0.15 ) );
	} );

	it( 'still names the floor as the binding constraint when it bites first', function () {
		$plan = Margin::plan(
			25000,
			array(
				'target_margin_rate'    => 0.55,
				'min_contribution_rate' => 0.25,
				'commission_rate'       => 0.40,
				'max_discount_rate'     => 0.50,
			)
		);
		eq( $plan['binding'], 'plancher' );
		eq( $plan['free_from_ht'], $plan['floor_ht'] );
	} );

	it( 'accepts an absolute minimum contribution as well as a rate', function () {
		$abs = Margin::plan( 25000, array( 'target_margin_rate' => 0.60, 'min_contribution_ht' => 10000, 'commission_rate' => 0.40 ) );
		eq( $abs['floor_basis'], 'absolute' );
		eq( $abs['floor_ht'], 41667 );

		$rate = Margin::plan( 25000, array( 'target_margin_rate' => 0.60, 'min_contribution_rate' => 0.25, 'commission_rate' => 0.40 ) );
		eq( $rate['floor_basis'], 'rate' );
	} );
} );

describe( 'Margin — the boundary where an exception becomes required', function () {
	$plan = Margin::plan(
		25000,
		array(
			'target_margin_rate'    => 0.55,
			'min_contribution_rate' => 0.25,
			'commission_rate'       => 0.40,
			'max_discount_rate'     => 0.15,
		)
	);

	it( 'sells freely at and above the discount cap', function () use ( $plan ) {
		$at = Margin::verdict( $plan['free_from_ht'], $plan );
		truthy( $at['ok'], 'exactly at the cap is still free' );
		truthy( ! $at['needs_approval'] );
		truthy( ! $at['below_floor'] );
	} );

	it( 'asks for approval one cent below it', function () use ( $plan ) {
		$below = Margin::verdict( $plan['free_from_ht'] - 1, $plan );
		truthy( ! $below['ok'] );
		truthy( $below['needs_approval'] );
		truthy( ! $below['below_floor'], 'this is a discount, not a derogation' );
	} );

	it( 'is still only an approval at the floor itself', function () use ( $plan ) {
		$at = Margin::verdict( $plan['floor_ht'], $plan );
		truthy( ! $at['below_floor'], 'selling AT the floor is allowed; the floor is the floor' );
		truthy( $at['needs_approval'] );
	} );

	it( 'becomes an exception one cent under the floor', function () use ( $plan ) {
		$under = Margin::verdict( $plan['floor_ht'] - 1, $plan );
		truthy( $under['below_floor'] );
		truthy( ! $under['needs_approval'], 'a derogation is not an approval; it is a different authority' );
	} );

	it( 'reports the discount in euros and as a share of the recommended price', function () use ( $plan ) {
		$v = Margin::verdict( 50000, $plan );
		eq( $v['discount_ht'], 5556 );
		near( $v['discount_rate'], 5556 / 55556, 1e-9 );
	} );

	it( 'never reports a negative discount above the recommended price', function () use ( $plan ) {
		$v = Margin::verdict( 90000, $plan );
		eq( $v['discount_ht'], 0 );
		near( $v['discount_rate'], 0.0, 1e-12 );
		truthy( $v['ok'] );
	} );
} );
