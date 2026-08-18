<?php
/**
 * The product page's own arithmetic: the grid's columns, the headline it prints
 * above them, and the point past which the site stops pricing.
 *
 * The headline is the interesting one. "À partir de X" is the first thing a
 * competitor screenshots and the first thing a customer compares to their
 * basket, and Mistertee's is their 500-piece price, so a buyer of twenty finds
 * a 36 % gap by scrolling. The only defence against writing the same lie is to
 * assert that both anchors are cells the grid actually shows.
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

use Teeshoop\Core\Pricing;

/** The shipped defaults, because this is what a visitor is shown. */
function ts_grid_config(): array {
	return Pricing::default_config();
}

describe( 'Pricing: the grid’s quantity columns', function () {
	it( 'shows one column per real discount break, and never a decorative one', function () {
		$config = ts_grid_config();
		$qtys   = Pricing::grid_qtys( $config );

		// The smallest run the shop sells, then every break, then one doubling
		// past the last. It used to start at 1; the shipped minimum order is
		// five pieces, and a column nobody may buy is a price nobody may pay.
		eq( $qtys, array( 5, 10, 25, 50, 100 ) );

		$breaks = array_map(
			static fn( array $b ): int => (int) $b['min_qty'],
			$config['qty_breaks']
		);
		foreach ( $qtys as $qty ) {
			truthy(
				(int) $config['min_qty'] === $qty || in_array( $qty, $breaks, true ) || $qty === max( $breaks ) * 2,
				"column {$qty} is neither the minimum order, nor a break, nor the doubling"
			);
		}
	} );

	it( 'publishes no column the basket would refuse for being too small', function () {
		foreach ( array( 0, 1, 5, 12 ) as $min ) {
			$config            = ts_grid_config();
			$config['min_qty'] = $min;
			foreach ( Pricing::grid_qtys( $config ) as $qty ) {
				truthy( $qty >= max( 1, $min ), "column {$qty} is below a minimum of {$min}" );
			}
		}
	} );

	it( 'goes back to a single-piece column when the minimum is removed', function () {
		// A minimum of 0 means "no minimum", the same convention as the two
		// quote thresholds. Reading it as "everything is refused" would empty
		// the price grid the first time somebody cleared the field.
		$config            = ts_grid_config();
		$config['min_qty'] = 0;
		eq( Pricing::grid_qtys( $config ), array( 1, 10, 25, 50, 100 ) );
	} );

	it( 'follows the breaks when they change, rather than a hard-coded list', function () {
		$config               = ts_grid_config();
		$config['qty_breaks'] = array(
			array(
				'min_qty' => 5,
				'rate'    => 0.10,
			),
			array(
				'min_qty' => 20,
				'rate'    => 0.20,
			),
		);
		eq( Pricing::grid_qtys( $config ), array( 5, 20, 40 ) );
	} );

	it( 'still produces a usable column when there are no breaks at all', function () {
		$config               = ts_grid_config();
		$config['qty_breaks'] = array();
		// Not an empty table: a shop with no volume discount still has a price.
		eq( Pricing::grid_qtys( $config ), array( (int) $config['min_qty'] ) );
	} );

	it( 'never publishes a column above the shop’s own cap', function () {
		$config                = ts_grid_config();
		$config['max_qty']     = 60;
		$qtys                  = Pricing::grid_qtys( $config );
		foreach ( $qtys as $qty ) {
			truthy( $qty <= 60, "column {$qty} is past max_qty" );
		}
		truthy( ! in_array( 100, $qtys, true ), 'the doubling past the cap was published' );
	} );
} );

describe( 'Pricing: the headline above the grid', function () {
	it( 'quotes two prices that both exist as cells in the grid it sits above', function () {
		$config   = ts_grid_config();
		$headline = Pricing::headline( 'tee', $config );
		$rows     = Pricing::grid( 'tee', Pricing::grid_qtys( $config ), array( 1 ), $config );

		truthy( ! empty( $headline['unit'] ), 'no unit anchor' );
		truthy( ! empty( $headline['best'] ), 'no best anchor' );

		foreach ( array( 'unit', 'best' ) as $which ) {
			$found = false;
			foreach ( $rows[0]['cells'] as $cell ) {
				if ( $cell['qty'] === $headline[ $which ]['qty']
					&& $cell['unit_ht'] === $headline[ $which ]['unit_ht'] ) {
					$found = true;
				}
			}
			truthy( $found, "the {$which} anchor is not a cell of the printed grid" );
		}
	} );

	it( 'names the quantity that reaches the cheaper price', function () {
		$config   = ts_grid_config();
		$headline = Pricing::headline( 'tee', $config );
		eq( (int) $headline['unit']['qty'], (int) $config['min_qty'] );
		truthy(
			(int) $headline['best']['qty'] > (int) $config['min_qty'],
			'the cheap anchor is the smallest run the shop sells'
		);
	} );

	it( 'names the LOWEST quantity that reaches it, not the largest column', function () {
		// The shipped breaks stop at 50, so 50 and 100 cost the same. Announcing
		// "9,42 € à partir de 100 pièces" when 50 already reaches it would be
		// true and still misleading, which is exactly Mistertee's headline.
		$config = ts_grid_config();
		$rows   = Pricing::grid( 'tee', Pricing::grid_qtys( $config ), array( 1 ), $config );
		$best   = Pricing::headline( 'tee', $config )['best'];

		foreach ( $rows[0]['cells'] as $cell ) {
			if ( $cell['unit_ht'] === $best['unit_ht'] ) {
				truthy(
					$cell['qty'] >= $best['qty'],
					"quantity {$cell['qty']} reaches the same price as the announced {$best['qty']}"
				);
			}
		}
	} );

	it( 'agrees with the quote the cart will charge at that quantity', function () {
		$config   = ts_grid_config();
		$headline = Pricing::headline( 'tee', $config );

		foreach ( array( 'unit', 'best' ) as $which ) {
			$quote = Pricing::quote(
				array(
					'garment' => 'tee',
					'qty'     => $headline[ $which ]['qty'],
					'sides'   => Pricing::standard_sides( 1 ),
				),
				$config
			);
			eq( $headline[ $which ]['unit_ht'], $quote['unit_ht'], "{$which} anchor vs quote" );
			eq( $headline[ $which ]['unit_ttc'], $quote['unit_ttc'], "{$which} anchor TTC vs quote" );
		}
	} );

	it( 'returns nothing rather than zero when there is no grid to read', function () {
		$config               = ts_grid_config();
		$config['qty_breaks'] = array();
		$config['max_qty']    = 0;
		// A headline of 0,00 EUR is a price. "No headline" is not, and the
		// template renders nothing rather than an invented figure.
		eq( Pricing::headline( 'tee', $config ), array() );
	} );
} );

describe( 'Pricing: standard sides', function () {
	it( 'produces sides the quote actually counts', function () {
		$config = ts_grid_config();
		foreach ( array( 1, 2, 3 ) as $faces ) {
			$quote = Pricing::quote(
				array(
					'garment' => 'tee',
					'qty'     => 1,
					'sides'   => Pricing::standard_sides( $faces ),
				),
				$config
			);
			eq( $quote['sides'], $faces, "{$faces} faces asked for" );
		}
	} );

	it( 'puts every side in the cheapest area tier', function () {
		$config = ts_grid_config();
		$quote  = Pricing::quote(
			array(
				'garment' => 'tee',
				'qty'     => 1,
				'sides'   => Pricing::standard_sides( 2 ),
			),
			$config
		);
		foreach ( $quote['lines'] as $line ) {
			if ( 'side' === $line['kind'] ) {
				eq( $line['tier'], $config['area_tiers'][0]['label'], 'a standard side landed in another tier' );
			}
		}
	} );

	it( 'returns nothing for zero or a negative count, rather than one side', function () {
		eq( Pricing::standard_sides( 0 ), array() );
		eq( Pricing::standard_sides( -3 ), array() );
	} );
} );

describe( 'Pricing: where self-serve stops', function () {
	it( 'lets the shipped threshold through and refuses one piece past it', function () {
		$config = ts_grid_config();
		$from   = (int) $config['quote_from_qty'];

		truthy( ! Pricing::needs_quote( $from, 0, $config ), "{$from} pieces should still be self-serve" );
		truthy( Pricing::needs_quote( $from + 1, 0, $config ), 'one piece past the threshold was accepted' );
	} );

	it( 'triggers on the amount as well as on the count', function () {
		$config = ts_grid_config();
		$from   = (int) $config['quote_from_ht'];

		truthy( ! Pricing::needs_quote( 1, $from, $config ), 'exactly the amount threshold was refused' );
		truthy( Pricing::needs_quote( 1, $from + 1, $config ), 'a cent past the amount threshold was accepted' );
	} );

	it( 'reads a zero threshold as “no threshold”, never as “everything”', function () {
		// The opposite reading takes the shop offline the first time somebody
		// clears the field, which is the expensive direction.
		$config                   = ts_grid_config();
		$config['quote_from_qty'] = 0;
		$config['quote_from_ht']  = 0;
		truthy( ! Pricing::needs_quote( 100000, 100000000, $config ), 'a cleared threshold blocked everything' );
	} );

	it( 'is the same verdict the quote carries, so the page and the cart cannot differ', function () {
		$config = ts_grid_config();
		foreach ( array( 1, 249, 250, 251, 400 ) as $qty ) {
			$quote = Pricing::quote(
				array(
					'garment' => 'tee',
					'qty'     => $qty,
					'sides'   => Pricing::standard_sides( 1 ),
				),
				$config
			);
			eq(
				$quote['needs_quote'],
				Pricing::needs_quote( $qty, (int) $quote['total_ht'], $config ),
				"quote payload vs needs_quote at {$qty}"
			);
		}
	} );
} );

describe( 'Pricing: a cell the cart would refuse is not a price', function () {
	it( 'marks the cells the self-serve threshold puts out of reach', function () {
		// A hoodie at a hundred pieces is 2 080,00 EUR HT, past the 2 000 EUR
		// threshold, so the whole hundred-piece column of its public price list
		// used to quote a unit price Cart::add answers with a 409.
		$config = ts_grid_config();
		$rows   = Pricing::grid( 'hoodie', array( 1, 100 ), array( 1 ), $config );

		$cheap = $rows[0]['cells'][0];
		$dear  = $rows[0]['cells'][1];

		truthy( ! $cheap['needs_quote'], 'one hoodie was put out of self-serve reach' );
		truthy( $dear['needs_quote'], 'a hundred hoodies were published as a self-serve price' );
	} );

	it( 'agrees with needs_quote for every cell it prints', function () {
		$config = ts_grid_config();
		foreach ( array( 'tee', 'hoodie', 'custom' ) as $garment ) {
			$qtys = Pricing::grid_qtys( $config );
			$rows = Pricing::grid( $garment, $qtys, array( 1, 2 ), $config );
			foreach ( $rows as $row ) {
				foreach ( $row['cells'] as $cell ) {
					eq(
						$cell['needs_quote'],
						Pricing::needs_quote( (int) $cell['qty'], (int) $cell['total_ht'], $config ),
						"{$garment} {$row['sides']}×{$cell['qty']}"
					);
				}
			}
		}
	} );

	it( 'never anchors the headline on a quantity the cart refuses', function () {
		$config   = ts_grid_config();
		$headline = Pricing::headline( 'hoodie', $config );

		truthy( ! empty( $headline['best'] ), 'a hoodie has no self-serve headline at all' );
		truthy( ! $headline['best']['needs_quote'], 'the headline promises a price the cart refuses' );

		$quote = Pricing::quote(
			array(
				'garment' => 'hoodie',
				'qty'     => (int) $headline['best']['qty'],
				'sides'   => Pricing::standard_sides( 1 ),
			),
			$config
		);
		truthy( ! $quote['needs_quote'], 'the announced quantity needs a quote' );
	} );

	it( 'announces nothing rather than an unreachable price when every column needs a quote', function () {
		$config                  = ts_grid_config();
		$config['quote_from_ht'] = 1;
		eq( Pricing::headline( 'tee', $config ), array() );
	} );
} );

describe( 'Pricing: the grid’s footnote', function () {
	it( 'reads its area bound from the tier table rather than restating it', function () {
		$config = ts_grid_config();
		eq( Pricing::std_area_sq_cm( $config ), (float) $config['area_tiers'][0]['max_sq_cm'] );
	} );

	it( 'says “no bound” rather than zero when the first tier is unbounded', function () {
		$config                             = ts_grid_config();
		$config['area_tiers'][0]['max_sq_cm'] = null;
		eq( Pricing::std_area_sq_cm( $config ), null );
	} );
} );
