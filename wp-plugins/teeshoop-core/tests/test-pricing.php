<?php
/**
 * The price authority. Every assertion here has a euro attached to it: this is
 * the number the customer is charged, and it must not move because someone
 * refactored a helper.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

require_once __DIR__ . '/../includes/Pricing.php';
require_once __DIR__ . '/../includes/Money.php';

use Teeshoop\Core\Money;
use Teeshoop\Core\Pricing;

/** A frozen config, so a change to the shipped defaults cannot break these. */
function ts_config(): array {
	return array(
		'currency'   => 'EUR',
		'vat_rate'   => 0.20,
		'garments'   => array(
			'tee'    => array(
				'base_ht'       => 1000,
				'first_side_ht' => 200,
				'extra_side_ht' => 500,
			),
			'custom' => array(
				'base_ht'       => 0,
				'first_side_ht' => 1200,
				'extra_side_ht' => 600,
			),
		),
		'area_tiers' => array(
			array(
				'max_sq_cm' => 625,
				'add_ht'    => 0,
				'label'     => 'std',
			),
			array(
				'max_sq_cm' => 1250,
				'add_ht'    => 400,
				'label'     => 'large',
			),
			array(
				'max_sq_cm' => null,
				'add_ht'    => 900,
				'label'     => 'xl',
			),
		),
		'qty_breaks' => array(
			array(
				'min_qty' => 10,
				'rate'    => 0.15,
			),
			array(
				'min_qty' => 25,
				'rate'    => 0.25,
			),
		),
		'max_qty'    => 10000,
	);
}

function ts_side( float $area, string $id = 'front' ): array {
	return array(
		'id'         => $id,
		'area_sq_cm' => $area,
	);
}

describe( 'Money', function () {
	it( 'reads a French decimal comma', function () {
		eq( Money::from_eur( '14,50' ), 1450 );
		eq( Money::from_eur( '14.50' ), 1450 );
		eq( Money::from_eur( '1 234,56' ), 123456 );
	} );

	it( 'refuses to guess at nonsense rather than inventing a price', function () {
		eq( Money::from_eur( 'gratuit' ), 0 );
		eq( Money::from_eur( '' ), 0 );
	} );

	it( 'rounds half away from zero, in cents', function () {
		eq( Money::round( 0.5 ), 1 );
		eq( Money::round( 1.5 ), 2 );
		eq( Money::round( -0.5 ), -1 );
	} );

	it( 'never drifts on the float that breaks naive money code', function () {
		// 0.1 + 0.2 !== 0.3 in binary floating point.
		eq( Money::from_eur( 0.1 ) + Money::from_eur( 0.2 ), Money::from_eur( 0.3 ) );
	} );
} );

describe( 'Pricing — the blank and the marking are separate', function () {
	it( 'prices a blank garment as the blank alone', function () {
		$q = Pricing::quote(
			array(
				'garment' => 'tee',
				'qty'     => 1,
				'sides'   => array(),
			),
			ts_config()
		);
		eq( $q['unit_ht'], 1000 );
		eq( $q['sides'], 0 );
	} );

	it( 'charges the first side, then the extra-side rate', function () {
		$config = ts_config();

		$one = Pricing::quote(
			array(
				'garment' => 'tee',
				'qty'     => 1,
				'sides'   => array( ts_side( 100 ) ),
			),
			$config
		);
		eq( $one['unit_ht'], 1200, 'blank 1000 + first side 200' );

		$two = Pricing::quote(
			array(
				'garment' => 'tee',
				'qty'     => 1,
				'sides'   => array( ts_side( 100 ), ts_side( 100, 'back' ) ),
			),
			$config
		);
		eq( $two['unit_ht'], 1700, 'plus one extra side at 500' );
	} );

	it( 'ignores sides the customer left empty', function () {
		$q = Pricing::quote(
			array(
				'garment' => 'tee',
				'qty'     => 1,
				'sides'   => array( ts_side( 100 ), ts_side( 0, 'back' ), ts_side( 0, 'sleeve_l' ) ),
			),
			ts_config()
		);
		eq( $q['sides'], 1 );
		eq( $q['unit_ht'], 1200 );
	} );

	it( 'prices a customer-supplied garment as decoration only', function () {
		$q = Pricing::quote(
			array(
				'garment' => 'custom',
				'qty'     => 1,
				'sides'   => array( ts_side( 100 ) ),
			),
			ts_config()
		);
		eq( $q['unit_ht'], 1200 );
	} );
} );

describe( 'Pricing — area tiers', function () {
	it( 'places an area on the tier boundary in the CHEAPER tier', function () {
		$config = ts_config();
		eq( Pricing::area_tier( 625.0, $config )['label'], 'std' );
		eq( Pricing::area_tier( 625.01, $config )['label'], 'large' );
		eq( Pricing::area_tier( 1250.0, $config )['label'], 'large' );
		eq( Pricing::area_tier( 1250.01, $config )['label'], 'xl' );
	} );

	it( 'charges an oversize print the top tier, never zero', function () {
		$q = Pricing::quote(
			array(
				'garment' => 'tee',
				'qty'     => 1,
				'sides'   => array( ts_side( 99999 ) ),
			),
			ts_config()
		);
		eq( $q['unit_ht'], 1000 + 200 + 900 );
	} );

	it( 'falls back to the last tier when the catch-all row is missing', function () {
		// A misconfigured admin must not make big prints free.
		$config               = ts_config();
		$config['area_tiers'] = array(
			array(
				'max_sq_cm' => 625,
				'add_ht'    => 0,
				'label'     => 'std',
			),
			array(
				'max_sq_cm' => 1250,
				'add_ht'    => 400,
				'label'     => 'large',
			),
		);
		eq( Pricing::area_tier( 9999.0, $config )['label'], 'large' );
	} );

	it( 'prices each side on its own tier', function () {
		$q = Pricing::quote(
			array(
				'garment' => 'tee',
				'qty'     => 1,
				'sides'   => array( ts_side( 100 ), ts_side( 1000, 'back' ) ),
			),
			ts_config()
		);
		eq( $q['unit_ht'], 1000 + 200 + ( 500 + 400 ) );
	} );
} );

describe( 'Pricing — quantity breaks', function () {
	it( 'applies the break exactly at its threshold, not one unit later', function () {
		$config = ts_config();
		eq( Pricing::qty_discount( 9, $config ), 0.0 );
		near( Pricing::qty_discount( 10, $config ), 0.15 );
		near( Pricing::qty_discount( 24, $config ), 0.15 );
		near( Pricing::qty_discount( 25, $config ), 0.25 );
		near( Pricing::qty_discount( 10000, $config ), 0.25, 1e-9, 'past the last break' );
	} );

	it( 'takes the best break, whatever order they are declared in', function () {
		$config               = ts_config();
		$config['qty_breaks'] = array_reverse( $config['qty_breaks'] );
		near( Pricing::qty_discount( 30, $config ), 0.25 );
	} );

	it( 'never charges more per unit for ordering more', function () {
		$config = ts_config();
		$prev   = PHP_INT_MAX;
		for ( $qty = 1; $qty <= 120; $qty++ ) {
			$q = Pricing::quote(
				array(
					'garment' => 'tee',
					'qty'     => $qty,
					'sides'   => array( ts_side( 100 ) ),
				),
				$config
			);
			truthy( $q['unit_ht'] <= $prev, "unit price rose at qty {$qty}" );
			$prev = $q['unit_ht'];
		}
	} );
} );

describe( 'Pricing — totals and VAT', function () {
	it( 'bills the total as the unit price times the quantity', function () {
		$q = Pricing::quote(
			array(
				'garment' => 'tee',
				'qty'     => 47,
				'sides'   => array( ts_side( 100 ) ),
			),
			ts_config()
		);
		eq( $q['total_ht'], $q['unit_ht'] * 47 );
	} );

	it( 'derives VAT from the total, and the three numbers agree', function () {
		$q = Pricing::quote(
			array(
				'garment' => 'tee',
				'qty'     => 13,
				'sides'   => array( ts_side( 100 ), ts_side( 800, 'back' ) ),
			),
			ts_config()
		);
		eq( $q['total_ttc'], $q['total_ht'] + $q['total_vat'] );
		eq( $q['total_vat'], Money::pct( $q['total_ht'], 0.20 ) );
	} );

	it( 'keeps every amount an integer number of cents', function () {
		$q = Pricing::quote(
			array(
				'garment' => 'tee',
				'qty'     => 33,
				'sides'   => array( ts_side( 700 ) ),
			),
			ts_config()
		);
		foreach ( array( 'unit_ht', 'unit_ttc', 'total_ht', 'total_vat', 'total_ttc' ) as $key ) {
			truthy( is_int( $q[ $key ] ), "{$key} is not an int" );
		}
		foreach ( $q['lines'] as $line ) {
			truthy( is_int( $line['amount'] ), 'a breakdown line is not an int' );
		}
	} );

	it( 'breaks down to exactly the unit price', function () {
		$q = Pricing::quote(
			array(
				'garment' => 'tee',
				'qty'     => 30,
				'sides'   => array( ts_side( 100 ), ts_side( 1300, 'back' ) ),
			),
			ts_config()
		);
		$sum = 0;
		foreach ( $q['lines'] as $line ) {
			$sum += $line['amount'];
		}
		eq( $sum, $q['unit_ht'], 'the breakdown must add up to what is charged' );
	} );
} );

describe( 'Pricing — refuses rather than mangles', function () {
	it( 'throws on an unknown garment instead of pricing it free', function () {
		throws(
			function () {
				Pricing::quote(
					array(
						'garment' => 'ceci-nest-pas-un-tshirt',
						'qty'     => 1,
						'sides'   => array(),
					),
					ts_config()
				);
			}
		);
	} );

	it( 'clamps a hostile or absurd quantity', function () {
		$config = ts_config();
		foreach ( array( 0, -5, -1 ) as $bad ) {
			$q = Pricing::quote(
				array(
					'garment' => 'tee',
					'qty'     => $bad,
					'sides'   => array(),
				),
				$config
			);
			eq( $q['qty'], 1, "qty {$bad}" );
		}
		$q = Pricing::quote(
			array(
				'garment' => 'tee',
				'qty'     => 999999999,
				'sides'   => array(),
			),
			$config
		);
		eq( $q['qty'], 10000 );
	} );

	it( 'drops a NaN or infinite area rather than propagating it into the total', function () {
		$q = Pricing::quote(
			array(
				'garment' => 'tee',
				'qty'     => 1,
				'sides'   => array(
					array(
						'id'         => 'front',
						'area_sq_cm' => INF,
					),
					array(
						'id'         => 'back',
						'area_sq_cm' => NAN,
					),
				),
			),
			ts_config()
		);
		eq( $q['sides'], 0 );
		eq( $q['unit_ht'], 1000 );
	} );
} );

describe( 'Pricing — the product-page grid', function () {
	it( 'agrees cell for cell with the quote the cart will use', function () {
		$config = ts_config();
		$grid   = Pricing::grid( 'tee', array( 1, 10, 25 ), array( 1, 2 ), $config );

		eq( count( $grid ), 2 );
		foreach ( $grid as $row ) {
			foreach ( $row['cells'] as $cell ) {
				$sides = array();
				for ( $i = 0; $i < $row['sides']; $i++ ) {
					$sides[] = ts_side( 1.0, 'side_' . $i );
				}
				$quote = Pricing::quote(
					array(
						'garment' => 'tee',
						'qty'     => $cell['qty'],
						'sides'   => $sides,
					),
					$config
				);
				eq( $cell['unit_ht'], $quote['unit_ht'], "grid cell {$row['sides']}×{$cell['qty']}" );
			}
		}
	} );

	it( 'prices two sides above one, at every quantity', function () {
		$grid = Pricing::grid( 'tee', array( 1, 10, 25, 50 ), array( 1, 2, 3 ), ts_config() );
		for ( $r = 1; $r < count( $grid ); $r++ ) {
			foreach ( $grid[ $r ]['cells'] as $i => $cell ) {
				truthy(
					$cell['unit_ht'] > $grid[ $r - 1 ]['cells'][ $i ]['unit_ht'],
					"row {$r} cell {$i} is not dearer than the row above"
				);
			}
		}
	} );
} );

describe( 'Pricing — the SHIPPED defaults, not just the frozen fixture', function () {
	// The fixture above proves the model works. This block proves the numbers we
	// actually ship agree with it — the first version of default_config() folded
	// the first side's marking into the base, which is exactly the flaw the model
	// was written to remove, and nothing caught it.
	it( 'prices a blank strictly below the same garment printed', function () {
		$config = Pricing::default_config();
		foreach ( array( 'tee', 'hoodie' ) as $garment ) {
			$blank = Pricing::quote(
				array(
					'garment' => $garment,
					'qty'     => 1,
					'sides'   => array(),
				),
				$config
			);
			$one = Pricing::quote(
				array(
					'garment' => $garment,
					'qty'     => 1,
					'sides'   => array( ts_side( 100 ) ),
				),
				$config
			);
			truthy(
				$blank['unit_ht'] < $one['unit_ht'],
				"{$garment}: a blank costs as much as a printed one"
			);
		}
	} );

	it( 'declares an area tier with no upper bound, so nothing prices at zero', function () {
		$tiers  = Pricing::default_config()['area_tiers'];
		$last   = $tiers[ count( $tiers ) - 1 ];
		eq( $last['max_sq_cm'], null, 'the last tier must be the catch-all' );
		truthy( $last['add_ht'] > 0 );
	} );

	it( 'quotes every shipped garment without throwing', function () {
		$config = Pricing::default_config();
		foreach ( array_keys( $config['garments'] ) as $garment ) {
			$q = Pricing::quote(
				array(
					'garment' => $garment,
					'qty'     => 10,
					'sides'   => array( ts_side( 300 ), ts_side( 900, 'back' ) ),
				),
				$config
			);
			truthy( $q['unit_ht'] > 0, "{$garment} quoted at zero" );
		}
	} );
} );

describe( 'Pricing — config merge', function () {
	it( 'lets one key be overridden without restating the rest', function () {
		$merged = Pricing::merge_config( array( 'vat_rate' => 0.055 ) );
		near( $merged['vat_rate'], 0.055 );
		truthy( isset( $merged['garments']['tee'] ), 'the default garments survived' );
	} );

	it( 'ignores a key that is not part of the schema', function () {
		$merged = Pricing::merge_config( array( 'wp_admin_password' => 'hunter2' ) );
		truthy( ! array_key_exists( 'wp_admin_password', $merged ) );
	} );
} );
