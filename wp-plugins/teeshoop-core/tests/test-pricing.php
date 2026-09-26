<?php
/**
 * The price authority. Every assertion here has a euro attached to it: this is
 * the number the customer is charged, and it must not move because someone
 * refactored a helper.
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
	it( 'rounds a rate that lands on the half cent up, which the float product did not', function () {
		// ARG-04. 2 750 × 0,35 = 962,5 exactly; the float product was 962,4999…
		// and rounded to 962, a cent a piece too much on the 35 % tier.
		eq( Money::pct( 2750, 0.35 ), 963 );
		eq( Money::pct( 90, 0.35 ), 32 );
		eq( Money::pct( 350, 0.35 ), 123 );
		eq( Money::pct( 2210, 0.20 ), 442 );
		eq( Money::pct( 1000, 0.055 ), 55 );
		eq( Money::pct( -2750, 0.35 ), -963, 'half away from zero on a credit too' );
		eq( Money::pct( 2750, 0.0 ), 0 );
	} );

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

describe( 'Pricing: the blank and the marking are separate', function () {
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

describe( 'Pricing: area tiers', function () {
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

describe( 'Pricing: quantity breaks', function () {
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

describe( 'Pricing: totals and VAT', function () {
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

describe( 'Pricing: refuses rather than mangles', function () {
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

describe( 'Money: a number a French customer reads', function () {
	it( 'groups thousands the French way, never the locale’s way', function () {
		// number_format_i18n takes its separators from the WordPress locale, and
		// a stock WordPress is en_US: it rendered 1250 as "1,250", which a French
		// reader takes for one and a quarter. The page published that as the
		// surcharge threshold in square centimetres.
		eq( Money::number( 1250 ), "1\u{202F}250" );
		eq( Money::number( 30.5, 1 ), '30,5' );
		eq( Money::number( 0 ), '0' );
	} );

	it( 'writes money the same way, because it is the same rule', function () {
		eq( Money::format( 123456 ), "1\u{202F}234,56\u{202F}€" );
	} );
} );

describe( 'Pricing: the product-page grid', function () {
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

describe( 'Pricing: the SHIPPED defaults, not just the frozen fixture', function () {
	// The fixture above proves the model works. This block proves the numbers we
	// actually ship agree with it: the first version of default_config() folded
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

describe( 'Pricing: config merge', function () {
	it( 'lets one key be overridden without restating the rest', function () {
		$merged = Pricing::merge_config( array( 'vat_rate' => 0.055 ) );
		near( $merged['vat_rate'], 0.055 );
		truthy( isset( $merged['garments']['tee'] ), 'the default garments survived' );
	} );

	it( 'ignores a key that is not part of the schema', function () {
		$merged = Pricing::merge_config( array( 'wp_admin_password' => 'hunter2' ) );
		truthy( ! array_key_exists( 'wp_admin_password', $merged ) );
	} );

	it( 'keeps the default prices a stored garment does not restate, and never prints a face for free', function () {
		// A stored rule naming only `base_ht` replaced the whole rule, and the
		// absent `first_side_ht` was read as 0: the first face cost nothing.
		$defaults = Pricing::default_config();
		$merged   = Pricing::merge_config( array( 'garments' => array( 'tee' => array( 'base_ht' => 4000 ) ) ) );
		eq( $merged['garments']['tee']['base_ht'], 4000, 'the stored field wins' );
		eq( $merged['garments']['tee']['first_side_ht'], $defaults['garments']['tee']['first_side_ht'], 'the missing field keeps its default' );
		truthy( ! isset( $merged['garments']['hoodie'] ), 'a garment left out of the stored map stays removed' );

		$q = Pricing::quote( array( 'garment' => 'tee', 'qty' => 1, 'sides' => array( ts_side( 100 ) ) ), $merged );
		truthy( $q['unit_ht'] > 4000, 'the face is charged on top of the blank' );
	} );

	it( 'refuses a rule without its prices rather than pricing it at zero', function () {
		// A garment the defaults do not know inherits nothing, so it must say.
		throws(
			function () {
				Pricing::quote(
					array( 'garment' => 'casquette', 'qty' => 1, 'sides' => array( ts_side( 100 ) ) ),
					Pricing::merge_config( array( 'garments' => array( 'casquette' => array( 'base_ht' => 900 ) ) ) )
				);
			}
		);
	} );
} );

describe( 'Pricing: the minimum order', function () {
	it( 'refuses a basket short on pieces and says which rule bit', function () {
		$config  = Pricing::default_config();
		$verdict = Pricing::below_minimum( 4, 100000, $config );

		truthy( $verdict['below'] );
		truthy( $verdict['qty'], 'the piece count did not report itself' );
		truthy( ! $verdict['ht'], 'a rich basket was reported as short on money' );
	} );

	/*
	 * THE AMOUNT MINIMUM IS GONE, AND THE MACHINERY THAT ENFORCED IT IS NOT.
	 *
	 * Question 01's answer of 1 September 2026 is « Le minimum est de 5 pièces par
	 * commande, sans minimum obligatoire de 50 EUR HT », so the shipped config
	 * carries 0 and, by the convention every threshold in this plugin follows,
	 * that means no minimum of that kind. These two tests used to prove the
	 * amount half REFUSES; they now prove it is switched off in the shipped
	 * configuration and still works when a figure is put back.
	 */
	it( 'no longer refuses a basket on money alone, because there is no amount minimum', function () {
		$config  = Pricing::default_config();
		eq( (int) $config['min_ht'], 0, 'the amount minimum came back without anybody saying so' );

		$verdict = Pricing::below_minimum( 50, 1, $config );
		truthy( ! $verdict['below'], 'fifty pieces for one cent was refused on the amount' );
		truthy( ! $verdict['ht'] );
	} );

	it( 'still reports both when both are set and both are short', function () {
		// The rule is intact: put an amount back and it bites again. What changed
		// is the shipped value, not the arithmetic.
		$config            = Pricing::default_config();
		$config['min_ht']  = 5000;
		$verdict           = Pricing::below_minimum( 1, 1, $config );
		truthy( $verdict['qty'] && $verdict['ht'] );
	} );

	it( 'accepts exactly the minimum', function () {
		$config  = Pricing::default_config();
		$verdict = Pricing::below_minimum( (int) $config['min_qty'], (int) $config['min_ht'], $config );
		truthy( ! $verdict['below'], 'the shop refused its own stated minimum' );
	} );

	it( 'treats a minimum of 0 as no minimum, the same as every other threshold', function () {
		$config            = Pricing::default_config();
		$config['min_qty'] = 0;
		$config['min_ht']  = 0;
		truthy( ! Pricing::below_minimum( 1, 1, $config )['below'], 'clearing the fields closed the shop' );
	} );

	/*
	 * THE FINDING THIS TEST EXISTS TO RECORD, and it is a business fact rather
	 * than a defect: at the shipped tariff the amount half of the rule is very
	 * nearly dead weight. Five printed tees are 72,50 EUR HT, well past the
	 * 50,00 EUR floor, so the piece count is what actually refuses a basket. The
	 * amount only bites below 10,00 EUR a piece, and nothing here is that cheap.
	 * Question 01 now says so, because the associate is about to confirm a rule
	 * half of which does nothing.
	 */
	it( 'shows that the amount minimum almost never binds at the shipped tariff', function () {
		$config = Pricing::default_config();
		$quote  = Pricing::quote(
			array(
				'garment' => 'tee',
				'qty'     => (int) $config['min_qty'],
				'sides'   => array( ts_side( 400 ) ),
			),
			$config
		);

		truthy(
			$quote['total_ht'] > (int) $config['min_ht'],
			'the smallest run the shop sells no longer clears the amount minimum'
		);
		truthy( ! Pricing::below_minimum( (int) $config['min_qty'], $quote['total_ht'], $config )['below'] );
	} );
} );

describe( 'Money: a field nobody could read is not a field holding zero', function () {
	it( 'reads what a French admin actually types', function () {
		eq( Money::parse_eur( '14,50' ), 1450 );
		eq( Money::parse_eur( '14.50' ), 1450 );
		eq( Money::parse_eur( '1 234,56' ), 123456 );
		eq( Money::parse_eur( "1\u{202F}234,56" ), 123456 );
	} );

	it( 'accepts the unit the screen prints beside the field', function () {
		/*
		 * THE DEFECT THIS PINS. The cost screen prints "%" as a label next to
		 * the input, which is what invites retyping it into the input. Read
		 * leniently, "25 %" was 0,00: on the Bible's own 250,00 EUR cost the
		 * floor fell from 428,57 EUR to 250,00 EUR, and an order at 260,00 EUR
		 * went from needing a derogation to reading "vendable sans validation".
		 */
		eq( Money::parse_eur( '25 %' ), 2500 );
		eq( Money::parse_eur( '25%' ), 2500 );
		eq( Money::parse_eur( '14,50 €' ), 1450 );
	} );

	it( 'answers null on a field it cannot read, and 0 only on a typed zero', function () {
		eq( Money::parse_eur( '' ), null );
		eq( Money::parse_eur( '   ' ), null );
		eq( Money::parse_eur( 'gratuit' ), null );
		eq( Money::parse_eur( '12,50,50' ), null );
		eq( Money::parse_eur( '0' ), 0, 'somebody who means zero types a zero' );
		eq( Money::parse_eur( '0,00' ), 0 );
	} );

	it( 'keeps from_eur reading an unparseable value as zero, for the machine-written ones', function () {
		eq( Money::from_eur( 'gratuit' ), 0 );
		eq( Money::from_eur( '' ), 0 );
		eq( Money::from_eur( '14,50' ), 1450 );
	} );
} );

// ---------------------------------------------------------------------------
// La matrice : une création, plusieurs coloris, plusieurs tailles, un prix
// ---------------------------------------------------------------------------

describe(
	'Pricing::quote_matrix',
	static function (): void {

		it(
			'facture trois coloris exactement comme un seul, ce qui n’était pas le cas',
			static function (): void {
				/*
				 * LE DÉFAUT, CHIFFRÉ, PUIS SA CORRECTION.
				 *
				 * Avec la configuration gelée ci-dessus (t-shirt, une face, nu à
				 * 10,00 EUR, marquage 2,00 EUR, paliers 15 % à 10 et 25 % à 25) :
				 *
				 *   trente pièces sur UNE ligne         -> 25 %, 9,00 l’unité, 270,00
				 *   trente pièces sur TROIS lignes de 10 -> 15 %, 10,20 l’unité, 306,00
				 *
				 * soit 36,00 EUR payés par le client pour avoir choisi trois
				 * couleurs. La matrice rend le premier nombre.
				 */
				$config = ts_config();
				$sides  = array( ts_side( 300.0 ) );

				$un = Pricing::quote(
					array(
						'garment' => 'tee',
						'qty'     => 30,
						'sides'   => $sides,
					),
					$config
				);

				$trois = Pricing::quote_matrix(
					array(
						'garment' => 'tee',
						'sides'   => $sides,
						'cells'   => array(
							array(
								'colour' => 'noir',
								'size'   => 'M',
								'qty'    => 10,
							),
							array(
								'colour' => 'blanc',
								'size'   => 'M',
								'qty'    => 10,
							),
							array(
								'colour' => 'bleu',
								'size'   => 'M',
								'qty'    => 10,
							),
						),
					),
					$config
				);

				truthy( $trois['ok'], 'chiffré' );
				eq( $trois['qty'], 30, 'la quantité est celle de la création entière' );
				eq( $trois['discount_rate'], 0.25, 'le palier est celui des 30 pièces' );
				eq( $trois['total_ht'], $un['total_ht'], 'trois coloris coûtent le prix d’un' );
				eq( $trois['total_ttc'], $un['total_ttc'], 'et le TTC suit' );

				/*
				 * ET L'ANCIEN COMPORTEMENT EST GARDÉ À CÔTÉ, comme la Bible
				 * l'exige pour toute formule corrigée : trois appels séparés
				 * donnent bien le nombre plus élevé, donc le test échouerait si
				 * quelqu'un remettait la remise par ligne.
				 */
				$ligne  = Pricing::quote(
					array(
						'garment' => 'tee',
						'qty'     => 10,
						'sides'   => $sides,
					),
					$config
				);
				$ancien = $ligne['total_ht'] * 3;
				truthy( $ancien > $trois['total_ht'], 'l’ancien découpage coûtait plus cher' );
				eq( $ancien - $trois['total_ht'], 3600, '36,00 EUR d’écart sur cette commande' );
			}
		);

		it(
			'fait franchir le palier à dix pièces réparties sur trois coloris',
			static function (): void {
				/*
				 * Le cas qui fait le plus de mal : quatre plus trois plus trois.
				 * Aucune ligne n'atteignait dix, donc aucune remise ne se
				 * déclenchait, alors que le panier compte bien dix pièces pour
				 * la commande minimale. Deux règles, deux portées, sur la même
				 * quantité.
				 */
				$config = ts_config();
				$m      = Pricing::quote_matrix(
					array(
						'garment' => 'tee',
						'sides'   => array( ts_side( 300.0 ) ),
						'cells'   => array(
							array(
								'colour' => 'noir',
								'size'   => 'M',
								'qty'    => 4,
							),
							array(
								'colour' => 'blanc',
								'size'   => 'L',
								'qty'    => 3,
							),
							array(
								'colour' => 'bleu',
								'size'   => 'XL',
								'qty'    => 3,
							),
						),
					),
					$config
				);
				eq( $m['qty'], 10, 'dix pièces' );
				eq( $m['discount_rate'], 0.15, 'et le palier des dix est atteint' );
			}
		);

		it(
			'donne à chaque case le textile nu de son propre article',
			static function (): void {
				/*
				 * Mesuré chez le fournisseur le 9 septembre 2026 : sur BC01B le
				 * 3XL coûte 4,30 EUR d’achat quand le M coûte 3,45. Deux nus
				 * distincts dans une même création, et la remise reste celle de
				 * la quantité totale.
				 */
				$config = ts_config();
				$m      = Pricing::quote_matrix(
					array(
						'garment' => 'tee',
						'sides'   => array( ts_side( 300.0 ) ),
						'cells'   => array(
							array(
								'colour'   => 'noir',
								'size'     => 'M',
								'qty'      => 20,
								'blank_ht' => 1000,
							),
							array(
								'colour'   => 'noir',
								'size'     => '3XL',
								'qty'      => 10,
								'blank_ht' => 1500,
							),
						),
					),
					$config
				);

				truthy( $m['ok'], 'chiffré' );
				truthy( ! $m['uniform_unit'], 'deux prix unitaires, et l’écran doit le dire' );
				eq( $m['qty'], 30, 'trente pièces' );
				eq( $m['discount_rate'], 0.25, 'un seul palier, celui du total' );

				// 12,00 remisé de 25 % = 9,00 ; 17,00 remisé de 25 % = 12,75.
				eq( $m['cells'][0]['unit_ht'], 900, 'le M à 9,00' );
				eq( $m['cells'][1]['unit_ht'], 1275, 'le 3XL à 12,75' );
				eq( $m['total_ht'], 900 * 20 + 1275 * 10, 'et le total est leur somme' );
				eq( $m['total_vat'], Money::pct( $m['total_ht'], 0.20 ), 'la TVA porte sur le total, une fois' );
			}
		);

		it(
			'refuse au-delà du plafond au lieu de raboter',
			static function (): void {
				$config = ts_config();
				$m      = Pricing::quote_matrix(
					array(
						'garment' => 'tee',
						'sides'   => array( ts_side( 300.0 ) ),
						'cells'   => array(
							array(
								'colour' => 'noir',
								'size'   => 'M',
								'qty'    => 9000,
							),
							array(
								'colour' => 'blanc',
								'size'   => 'M',
								'qty'    => 2000,
							),
						),
					),
					$config
				);
				truthy( ! $m['ok'], 'refusé' );
				eq( $m['reason'], 'over_cap', 'et pour la bonne raison' );
				eq( $m['qty'], 11000, 'en disant la quantité demandée' );
			}
		);

		it(
			'ignore une case vide et refuse une matrice entièrement vide',
			static function (): void {
				$config = ts_config();
				$m      = Pricing::quote_matrix(
					array(
						'garment' => 'tee',
						'sides'   => array( ts_side( 300.0 ) ),
						'cells'   => array(
							array(
								'colour' => 'noir',
								'size'   => 'M',
								'qty'    => 5,
							),
							array(
								'colour' => 'blanc',
								'size'   => 'M',
								'qty'    => 0,
							),
							array(
								'colour' => '',
								'size'   => 'M',
								'qty'    => 3,
							),
						),
					),
					$config
				);
				eq( $m['qty'], 5, 'la case à zéro et la case sans coloris ne comptent pas' );
				eq( count( $m['cells'] ), 1, 'et ne sont pas facturées' );

				$vide = Pricing::quote_matrix(
					array(
						'garment' => 'tee',
						'sides'   => array( ts_side( 300.0 ) ),
						'cells'   => array(),
					),
					$config
				);
				truthy( ! $vide['ok'], 'refusée' );
				eq( $vide['reason'], 'empty', 'et pour la bonne raison' );
			}
		);

		it(
			'donne exactement le même total que quote() quand toutes les cases partagent le nu',
			static function (): void {
				/*
				 * L'INVARIANT QUI AUTORISE DEUX POINTS D'ENTRÉE SANS DEUX RÈGLES.
				 *
				 * Le panier chiffre une ligne par `quote()` avec la quantité de
				 * la ligne ; l'éditeur chiffre la matrice par `quote_matrix()`
				 * pour pouvoir montrer chaque case. Tant que les cases partagent
				 * un textile nu, les deux DOIVENT rendre le même total, sinon le
				 * client voit un nombre dans l’éditeur et en paie un autre au
				 * panier. Ce test est la seule chose qui l’empêche, et il balaie
				 * les deux paliers plus les bords.
				 */
				$config = ts_config();
				foreach ( array( 1, 4, 9, 10, 11, 24, 25, 26, 60, 500 ) as $n ) {
					foreach ( array( array( ts_side( 300.0 ) ), array( ts_side( 300.0 ), ts_side( 900.0, 'back' ) ) ) as $sides ) {
						$ref = Pricing::quote(
							array(
								'garment' => 'tee',
								'qty'     => $n,
								'sides'   => $sides,
							),
							$config
						);
						// Réparti sur autant de cases que possible, ce qui est le
						// cas qui cassait : la remise doit rester celle du total.
						$cells = array();
						$left  = $n;
						foreach ( array( 'noir', 'blanc', 'bleu', 'rouge' ) as $i => $c ) {
							$take = ( 3 === $i ) ? $left : intdiv( $n, 4 );
							if ( $take > 0 ) {
								$cells[] = array(
									'colour' => $c,
									'size'   => 'M',
									'qty'    => $take,
								);
								$left -= $take;
							}
						}
						$m = Pricing::quote_matrix(
							array(
								'garment' => 'tee',
								'sides'   => $sides,
								'cells'   => $cells,
							),
							$config
						);
						truthy( $m['ok'], 'chiffré à ' . $n );
						eq( $m['qty'], $n, 'quantité à ' . $n );
						eq( $m['total_ht'], $ref['total_ht'], 'total HT à ' . $n . ' pièces, ' . count( $sides ) . ' face(s)' );
						eq( $m['total_ttc'], $ref['total_ttc'], 'total TTC à ' . $n );
						eq( $m['total_vat'], $ref['total_vat'], 'TVA à ' . $n );
						eq( $m['discount_rate'], $ref['discount_rate'], 'palier à ' . $n );
						eq( $m['needs_quote'], $ref['needs_quote'], 'seuil de devis à ' . $n );
						truthy( $m['uniform_unit'], 'un seul prix unitaire à ' . $n );
					}
				}
			}
		);

		it(
			'refuse un nu venu de la requête, négatif ou fractionnaire',
			static function (): void {
				/*
				 * `blank_ht` est en centimes entiers et résolu sur le serveur. Un
				 * flottant ou un négatif ne peut venir que d'un chemin qui n'est
				 * pas prévu, et retomber sur le tarif de la famille est le seul
				 * comportement qui ne fasse pas fixer son prix par l'appelant.
				 */
				$config = ts_config();
				$m      = Pricing::quote_matrix(
					array(
						'garment' => 'tee',
						'sides'   => array( ts_side( 300.0 ) ),
						'cells'   => array(
							array(
								'colour'   => 'noir',
								'size'     => 'M',
								'qty'      => 30,
								'blank_ht' => -5000,
							),
						),
					),
					$config
				);
				$ref = Pricing::quote(
					array(
						'garment' => 'tee',
						'qty'     => 30,
						'sides'   => array( ts_side( 300.0 ) ),
					),
					$config
				);
				eq( $m['total_ht'], $ref['total_ht'], 'le nu négatif est ignoré, la famille s’applique' );
			}
		);
	}
);
