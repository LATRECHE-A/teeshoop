<?php
/**
 * The shop's half of the design-document gate.
 *
 * The other half is `src/lib/teeshoop/designDoc.ts`, which the Worker runs
 * before writing anything to R2, and the two must agree exactly: the shop
 * accepting what the Worker refused means costing an order the workshop will
 * never receive, and the shop refusing what the Worker accepted means a paid
 * line whose film cost silently reads as unknown.
 *
 * These cases are the SAME cases as the ones in `worker/design.test.ts`, with
 * the same numbers, on purpose. Two suites over one document, in two languages;
 * when one moves, the other fails.
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

require_once __DIR__ . '/../includes/Design.php';

use Teeshoop\Core\Design;

/** One printed side, with whatever the case under test overrides. */
function ts_design_side( array $over = array() ): array {
	return array_merge(
		array(
			'id'         => 'front',
			'area_sq_cm' => 250.0,
			'area_w_cm'  => 30.5,
			'area_h_cm'  => 40.6,
			'drop_cm'    => 22.4,
			'pieces'     => array(
				array(
					'w_cm'         => 18.0,
					'h_cm'         => 14.5,
					'top_cm'       => 5.2,
					'center_dx_cm' => -1.5,
				),
			),
		),
		$over
	);
}

/** The placement a side ends up with, after both halves of the gate. */
function ts_design_placed( array $side ): array {
	return Design::normalise_placement(
		$side,
		Design::normalise_pieces( $side['pieces'] ?? null, (float) ( $side['area_sq_cm'] ?? 0 ) )
	);
}

describe( 'Design::normalise_placement : where the marking goes', function () {

	it( 'carries the placement a bon à tirer states and a press is set up from', function () {
		$out = ts_design_placed( ts_design_side() );
		eq( $out['area_w_cm'], 30.5, 'largeur de zone' );
		eq( $out['area_h_cm'], 40.6, 'hauteur de zone' );
		eq( $out['drop_cm'], 22.4, 'descente sous l’encolure' );
		eq( count( $out['pieces'] ), 1, 'un transfert' );
		eq( $out['pieces'][0]['top_cm'], 5.2, 'haut du transfert' );
		eq( $out['pieces'][0]['center_dx_cm'], -1.5, 'écart à l’axe' );
	} );

	it( 'drops a placement that does not fit the print area it declares', function () {
		/*
		 * NOTHING DOWNSTREAM WOULD EVER NOTICE. A 30 cm drop inside a 40,6 cm
		 * area whose transfer is 14,5 cm tall is a print running off the hem.
		 * The film cost is unchanged, the price is unchanged, and the first
		 * thing that would catch it is a customer opening a parcel.
		 */
		$out = ts_design_placed(
			ts_design_side(
				array(
					'pieces' => array(
						array(
							'w_cm'         => 18.0,
							'h_cm'         => 14.5,
							'top_cm'       => 30.0,
							'center_dx_cm' => 0.0,
						),
					),
				)
			)
		);
		truthy( ! isset( $out['area_w_cm'] ), 'la zone ne doit pas survivre' );
		truthy( ! isset( $out['pieces'][0]['top_cm'] ), 'le placement refusé ne doit pas être stocké' );
	} );

	it( 'refuses a transfer whose centre puts it outside the area sideways', function () {
		$out = ts_design_placed(
			ts_design_side(
				array(
					'pieces' => array(
						array(
							'w_cm'         => 18.0,
							'h_cm'         => 14.5,
							'top_cm'       => 5.2,
							'center_dx_cm' => 90.0,
						),
					),
				)
			)
		);
		truthy( ! isset( $out['area_w_cm'] ), 'la zone ne doit pas survivre' );
	} );

	it( 'drops the placement and KEEPS the film geometry, because they cost different things', function () {
		// The rectangles are the film and therefore the floor price; the
		// placement is only the proof. Losing the second must never silently
		// lower the first.
		$out = ts_design_placed(
			ts_design_side(
				array(
					'area_sq_cm' => 288.0,
					'pieces'     => array(
						array(
							'w_cm'         => 18.0,
							'h_cm'         => 14.5,
							'top_cm'       => 5.2,
							'center_dx_cm' => 0.0,
						),
						array(
							'w_cm'         => 12.0,
							'h_cm'         => 3.2,
							'top_cm'       => 22.0,
							'center_dx_cm' => 90.0,
						),
					),
				)
			)
		);
		eq( count( $out['pieces'] ), 2, 'les deux rectangles restent' );
		eq( $out['pieces'][0]['w_cm'], 18.0, 'largeur du premier' );
		truthy( ! isset( $out['area_w_cm'] ), 'le placement est abandonné' );
	} );

	it( 'keeps the rectangles of a document written before the placement existed', function () {
		// Every design already stored carries no placement. Requiring one would
		// have taken the film geometry off all of them, which is a floor price
		// that silently drops on orders nobody touched.
		$out = ts_design_placed(
			array(
				'id'         => 'front',
				'area_sq_cm' => 288.0,
				'pieces'     => array(
					array(
						'w_cm' => 18.0,
						'h_cm' => 14.5,
					),
					array(
						'w_cm' => 12.0,
						'h_cm' => 3.2,
					),
				),
			)
		);
		eq( count( $out['pieces'] ), 2, 'les rectangles survivent' );
		truthy( ! isset( $out['area_w_cm'] ), 'et rien n’est inventé' );
	} );

	it( 'refuses a drop below the collar no garment could have, and keeps the rest', function () {
		$out = ts_design_placed( ts_design_side( array( 'drop_cm' => 4000.0 ) ) );
		truthy( ! isset( $out['drop_cm'] ), 'la descente absurde est refusée' );
		eq( $out['area_h_cm'], 40.6, 'le reste du placement est un fait distinct' );
	} );

	it( 'has no placement when the rectangles were refused', function () {
		// The film geometry is the input to the fit check. Without it there is
		// nothing to check a position against, so there is no position.
		$out = ts_design_placed( ts_design_side( array( 'area_sq_cm' => 2000.0 ) ) );
		eq( $out['pieces'], array(), 'les rectangles ne tiennent pas l’encre déclarée' );
		truthy( ! isset( $out['area_w_cm'] ), 'et donc aucun placement' );
	} );

	it( 'refuses a print area larger than any garment', function () {
		$out = ts_design_placed( ts_design_side( array( 'area_w_cm' => 900.0 ) ) );
		truthy( ! isset( $out['area_w_cm'] ), 'borne identique à celle du Worker' );
	} );

	it( 'tolerates the rounding both ends write, and nothing wider', function () {
		/*
		 * Six numbers are each rounded to 0,01 cm before they are written, so a
		 * comparison of sums can be a few hundredths out. The producer clamps
		 * every transfer to the area exactly, so the true tolerance is zero and
		 * this is only the rounding: 0,04 cm over passes, 0,5 cm does not.
		 */
		$near = ts_design_placed(
			ts_design_side(
				array(
					'pieces' => array(
						array(
							'w_cm'         => 18.0,
							'h_cm'         => 14.5,
							'top_cm'       => 26.14,
							'center_dx_cm' => 0.0,
						),
					),
				)
			)
		);
		truthy( isset( $near['area_w_cm'] ), '0,04 cm au-delà est du bruit d’arrondi' );

		$far = ts_design_placed(
			ts_design_side(
				array(
					'pieces' => array(
						array(
							'w_cm'         => 18.0,
							'h_cm'         => 14.5,
							'top_cm'       => 26.6,
							'center_dx_cm' => 0.0,
						),
					),
				)
			)
		);
		truthy( ! isset( $far['area_w_cm'] ), '0,5 cm au-delà est un placement faux' );
	} );
} );
