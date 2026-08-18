<?php
/**
 * Carriage: the grid, the packaging, the franco, and the three refusals.
 *
 * The cases that matter are the ones where a wrong answer costs money quietly:
 * a parcel that falls off the end of the grid and is quoted at the top bracket
 * anyway, a line with no weight that ships as if it were light, and a free
 * delivery that forgets it still cost a stamp.
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
require_once __DIR__ . '/../includes/Shipping.php';

use Teeshoop\Core\Shipping;

function ts_ship_config(): array {
	return Shipping::default_config();
}

describe( 'Shipping: the Colissimo brackets', function () {
	it( 'charges the bracket a parcel falls into, at its upper bound', function () {
		$config = ts_ship_config();
		// Every bound is inclusive: 250 g is still the 250 g bracket.
		eq( Shipping::bracket( 250, $config )['ht'], 549 );
		eq( Shipping::bracket( 251, $config )['ht'], 759 );
		eq( Shipping::bracket( 1, $config )['ht'], 549 );
		eq( Shipping::bracket( 30000, $config )['ht'], 3959 );
	} );

	it( 'refuses a parcel past the last bracket instead of quoting the last one', function () {
		$config = ts_ship_config();
		// La Poste stops at 30 kg. Falling back to 39,59 EUR would sell a
		// delivery that cannot happen.
		eq( Shipping::bracket( 30001, $config ), null );
		eq( Shipping::bracket( 90000, $config ), null );
		eq( Shipping::max_parcel_g( $config ), 30000 );
	} );

	it( 'rises with weight and never dips', function () {
		$config = ts_ship_config();
		$last   = 0;
		foreach ( $config['grid'] as $row ) {
			truthy( (int) $row['ht'] > $last, 'bracket ' . $row['max_g'] . ' is not dearer than the one below' );
			$last = (int) $row['ht'];
		}
	} );
} );

describe( 'Shipping: what the customer pays and what we bear', function () {
	it( 'adds the carton once and the bagging per piece', function () {
		$config = ts_ship_config();
		$quote  = Shipping::quote( 400, 3, 10000, $config );

		truthy( $quote['ok'] );
		eq( $quote['packaging_ht'], (int) $config['packaging_order_ht'] + 3 * (int) $config['packaging_piece_ht'] );
		eq( $quote['carrier_ht'], 759, '400 g is the 500 g bracket' );
		eq( $quote['borne_ht'], $quote['carrier_ht'] + $quote['packaging_ht'] );
		eq( $quote['charged_ht'], $quote['borne_ht'], 'below the franco the customer pays the lot' );
	} );

	it( 'still records the cost of a delivery it gives away', function () {
		$config = ts_ship_config();
		$free   = Shipping::quote( 400, 3, (int) $config['free_from_ht'], $config );

		truthy( $free['free'], 'the franco did not fire at exactly the threshold' );
		eq( $free['charged_ht'], 0 );
		// The Bible counts livraison offerte as a direct cost. A free delivery
		// whose cost was never recorded is a margin nobody can reconstruct.
		truthy( $free['borne_ht'] > 0, 'a free delivery was recorded as costing nothing' );
		eq( $free['borne_ht'], Shipping::quote( 400, 3, 0, $config )['borne_ht'] );
	} );

	it( 'fires the franco AT the threshold and not one cent before', function () {
		$config = ts_ship_config();
		$from   = (int) $config['free_from_ht'];
		truthy( ! Shipping::quote( 400, 1, $from - 1, $config )['free'], 'one cent short was given away' );
		truthy( Shipping::quote( 400, 1, $from, $config )['free'], 'exactly the threshold was charged' );
	} );

	it( 'treats a franco of 0 as no franco at all', function () {
		$config                 = ts_ship_config();
		$config['free_from_ht'] = 0;
		truthy( ! Shipping::quote( 400, 1, 999999999, $config )['free'], 'clearing the field gave everything away' );
	} );

	it( 'counts the packing towards the parcel weight when somebody has weighed it', function () {
		$config = ts_ship_config();
		eq( Shipping::quote( 240, 1, 0, $config )['parcel_g'], 240, 'unweighed packing must add nothing' );

		$config['packaging_order_g'] = 300;
		$config['packaging_piece_g'] = 20;
		$quote                       = Shipping::quote( 240, 2, 0, $config );
		eq( $quote['parcel_g'], 580, '240 g of garment, a 300 g carton and two 20 g bags' );
		/*
		 * AND THAT CHANGES THE BRACKET, which is the whole reason the weight is
		 * a setting rather than an afterthought. The same 240 g of garment is
		 * 7,59 EUR bare and 9,29 EUR packed, because La Poste brackets on
		 * "emballage et contenu compris". Shipped at zero, we absorb that 3,80
		 * EUR rather than overcharge for it; question 07 asks him to weigh one.
		 */
		eq( $quote['carrier_ht'], 929 );
		eq( Shipping::quote( 240, 2, 0, ts_ship_config() )['carrier_ht'], 549 );
	} );
} );

describe( 'Shipping: the three refusals', function () {
	it( 'refuses rather than guesses when a line has no weight', function () {
		$config = ts_ship_config();
		$quote  = Shipping::quote( 0, 5, 10000, $config, false );

		truthy( ! $quote['ok'] );
		eq( $quote['reason'], Shipping::NO_WEIGHT );
		eq( $quote['charged_ht'], 0 );
		// WooCommerce returns 0 for a product whose weight was never set, so
		// "we could not look" would otherwise ship in the cheapest bracket.
		truthy( Shipping::quote( 0, 5, 10000, $config, true )['ok'], 'a genuinely weightless basket must still quote' );
	} );

	it( 'refuses a basket heavier than one parcel', function () {
		$config = ts_ship_config();
		$quote  = Shipping::quote( 45000, 200, 100000, $config );
		truthy( ! $quote['ok'] );
		eq( $quote['reason'], Shipping::TOO_HEAVY );
		eq( $quote['charged_ht'], 0 );
		// The packing was still bought, and the refusal says so.
		truthy( $quote['packaging_ht'] > 0 );
	} );

	it( 'delivers to metropolitan France and not to the DOM', function () {
		$config = ts_ship_config();
		truthy( Shipping::serves( 'FR', '93000', $config ), 'Bobigny' );
		truthy( Shipping::serves( 'FR', '20000', $config ), 'la Corse est métropolitaine' );
		truthy( ! Shipping::serves( 'FR', '97400', $config ), 'La Réunion' );
		truthy( ! Shipping::serves( 'FR', '98000', $config ), 'Monaco et les collectivités' );
		truthy( ! Shipping::serves( 'BE', '1000', $config ), 'la Belgique' );
		truthy( ! Shipping::serves( 'CH', '1200', $config ), 'la Suisse' );

		// An empty postcode is "they have not said yet", not "they are abroad".
		truthy( Shipping::serves( 'FR', '', $config ) );
		truthy( Shipping::serves( '', '', $config ) );
	} );
} );

describe( 'Shipping: reading what was stored', function () {
	it( 'lets one key be overridden without restating the grid', function () {
		$config = Shipping::merge_config( array( 'free_from_ht' => 12345 ) );
		eq( $config['free_from_ht'], 12345 );
		eq( $config['grid'], Shipping::default_config()['grid'] );
	} );

	it( 'ignores a key that is not part of the schema', function () {
		$config = Shipping::merge_config( array( 'gratuit_partout' => true ) );
		truthy( ! array_key_exists( 'gratuit_partout', $config ) );
	} );
} );
