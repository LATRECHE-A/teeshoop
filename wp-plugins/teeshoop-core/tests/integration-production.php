<?php
/**
 * Pooling the film across orders, against a real WooCommerce.
 *
 * The pure tests prove the calendar, the split and the bounds. They cannot prove
 * what actually goes wrong here, which is again the seam: an order that is in
 * two lots at once, a share that never reaches the margin report, a frozen lot
 * that quietly re-nests, a cost report that goes on reading « à jour » after the
 * film was bought. Every one of those is invisible from a pure test and every
 * one of them is money.
 *
 * ── ABOUT THE NESTING SERVICE ────────────────────────────────────────────────
 *
 * `create_lot()` asks the Worker for the shelf packing of the lot, and uses it
 * as the CEILING a browser-measured layout may not exceed. This mirror has no
 * Worker, so `pre_http_request` answers instead — with `Cost::prudent_length_cm`,
 * the bound this plugin already proves is never SHORTER than a real packing
 * (`scripts/nest-verify.mjs` re-proves it against the real packer on every run).
 * That makes it a valid ceiling and a loose one: what these cases prove is the
 * plumbing and the refusals, not the tightness of the bound. The tightness is
 * `scripts/dtf-verify.mjs`'s pooled suite, which runs the real packer.
 *
 * The layout the studio is pretending to have measured is not invented either.
 * The two orders below nest to 0,3 m and 0,2 m alone and 0,4 m together on the
 * shipped geometry, measured with the real packer in `src/lib/dtf/run.test.ts`'s
 * own harness (56 cm laize, 5 mm gap, 10 cm billing step).
 *
 * NO `declare(strict_types=1)`: required from integration.php, which is eval'd.
 *
 * @package Teeshoop\Core
 */

use Teeshoop\Core\Bat;
use Teeshoop\Core\Cost;
use Teeshoop\Core\Costing;
use Teeshoop\Core\Lifecycle;
use Teeshoop\Core\Production;
use Teeshoop\Core\Settings;

/** Order A: four garments, a chest lockup of two visuals. */
function ts_pr_sides_a(): array {
	return array(
		array(
			'id'         => 'front',
			'area_sq_cm' => 288.0,
			'pieces'     => array(
				array( 'w_cm' => 18.0, 'h_cm' => 14.5 ),
				array( 'w_cm' => 12.0, 'h_cm' => 3.2 ),
			),
		),
	);
}

/** Order B: two garments, one visual, deliberately a near-miss of A's row. */
function ts_pr_sides_b(): array {
	return array(
		array(
			'id'         => 'front',
			'area_sq_cm' => 230.0,
			'pieces'     => array( array( 'w_cm' => 17.0, 'h_cm' => 14.0 ) ),
		),
	);
}

/** A paid order with an APPROVED proof — the only thing the queue accepts. */
function ts_pr_ready( int $product_id, int $qty, array $sides, string $design ): \WC_Order {
	$GLOBALS['ts_pr_sides'] = $sides;
	ts_pr_stub_nest();
	$key = ts_ck_fill( $product_id, $qty, $sides, $design );
	if ( is_wp_error( $key ) ) {
		throw new \RuntimeException( 'panier refusé : ' . $key->get_error_message() );
	}
	if ( 0 === WC()->cart->get_cart_contents_count() ) {
		throw new \RuntimeException( 'panier vide : ' . implode( ' / ', ts_ck_errors() ) );
	}
	$order = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) ) );
	$order->set_billing_email( 'atelier@example.test' );
	$order->set_billing_company( 'Client ' . $design );
	$order->save();
	$order->payment_complete( 'ts-pr-' . $order->get_id() );
	$order  = wc_get_order( $order->get_id() );
	$issued = Bat::issue( $order );
	if ( empty( $issued['ok'] ) ) {
		throw new \RuntimeException( 'BAT refusé : ' . ( $issued['reason'] ?? '?' ) );
	}
	ts_lc_approve( $order, 1, (string) $issued['token'] );
	return wc_get_order( $order->get_id() );
}

/**
 * The layout the studio would have posted for these two orders.
 *
 * `$over` lets a case corrupt exactly one number, which is how each refusal is
 * proved to be doing something rather than passing by accident.
 */
function ts_pr_layout( int $a, int $b, array $over = array() ): array {
	$layout = array(
		'pooled_m'     => 0.4,
		'sheets'       => 1,
		'packer'       => 'trueshape',
		'interlock_cm' => 2.0,
		'restarts'     => 12,
		'flip'         => false,
		'orders'       => array(
			(string) $a => array(
				'solo_m' => 0.3,
				'poses'  => 4,
				'pieces' => array(
					array( 'key' => 'front~1', 'w_cm' => 18.0, 'h_cm' => 14.5, 'qty' => 4 ),
					array( 'key' => 'front~2', 'w_cm' => 12.0, 'h_cm' => 3.2, 'qty' => 4 ),
				),
			),
			(string) $b => array(
				'solo_m' => 0.2,
				'poses'  => 2,
				'pieces' => array(
					array( 'key' => 'front', 'w_cm' => 17.0, 'h_cm' => 14.0, 'qty' => 2 ),
				),
			),
		),
	);
	return array_replace_recursive( $layout, $over );
}

/**
 * Answer the Worker: the design lookup and `POST /api/nest`. See the header.
 *
 * The manifest carries `$GLOBALS['ts_pr_sides']`, which is what the studio would
 * have uploaded for the design being added. It has to: `Cart::add` prefers the
 * SERVER's copy of the printed sides over the request's, deliberately, so that
 * the film and the invoice measure the same thing. A stub that answered with no
 * sides would be simulating a design that prints nothing, and the cart is right
 * to refuse it.
 */
function ts_pr_stub_nest( bool $reachable = true ): void {
	remove_all_filters( 'pre_http_request' );
	add_filter(
		'pre_http_request',
		function ( $pre, $args, $url ) use ( $reachable ) {
			/*
			 * The design lookup, because setting `worker_url` at all turns it on:
			 * with no Worker configured `Design::verify` falls through to the dev
			 * allowance, and the moment an address exists it really asks. So the
			 * stub answers that too, with what a real manifest carries.
			 */
			if ( str_contains( (string) $url, '/api/design/' ) ) {
				return array(
					'headers'  => array(),
					'body'     => wp_json_encode(
						array(
							'id'          => substr( (string) $url, strrpos( (string) $url, '/' ) + 1 ),
							'garment'     => 'tee',
							'color'       => 'blanc',
							'sides'       => $GLOBALS['ts_pr_sides'] ?? array(),
							'preview'     => '/r2/design/x/preview.png',
							'previews'    => array(),
							'print_file'  => '/r2/design/x/design.json',
							'app_version' => 'test',
						)
					),
					'response' => array( 'code' => 200 ),
					'cookies'  => array(),
					'filename' => null,
				);
			}
			if ( ! str_contains( (string) $url, '/api/nest' ) ) {
				return array(
					'headers'  => array(),
					'body'     => '{}',
					'response' => array( 'code' => 200 ),
					'cookies'  => array(),
					'filename' => null,
				);
			}
			if ( ! $reachable ) {
				return new \WP_Error( 'http_request_failed', 'injoignable' );
			}
			$body   = json_decode( (string) ( $args['body'] ?? '{}' ), true );
			$pieces = is_array( $body['pieces'] ?? null ) ? $body['pieces'] : array();
			$bound  = Cost::prudent_length_cm( $pieces, Costing::config() );
			return array(
				'headers'  => array(),
				'body'     => wp_json_encode(
					array(
						'billed_m'     => $bound['ok'] ? $bound['length_cm'] / 100 : 0.0,
						'sheets'       => 1,
						'total_pieces' => count( $pieces ),
						'unplaceable'  => $bound['impossible'],
						'utilization'  => 0.5,
					)
				),
				'response' => array( 'code' => 200 ),
				'cookies'  => array(),
				'filename' => null,
			);
		},
		10,
		3
	);
}

function ts_production_suite( int $product_id ): void {
	echo "\n\033[2mProduction : imbrication entre commandes\033[0m\n";

	// `Settings` has no writer: it reads the option, so the option is what a test
	// sets. `worker.invalid` never resolves, which is deliberate — every call is
	// answered by the filter below and one that escaped it would fail loudly
	// rather than reach something real.
	$stored                = get_option( \Teeshoop\Core\OPTION_SETTINGS, array() );
	$stored['worker_url']  = 'https://worker.invalid';
	update_option( \Teeshoop\Core\OPTION_SETTINGS, $stored );
	if ( ! defined( 'TEESHOOP_WORKER_TOKEN' ) ) {
		define( 'TEESHOOP_WORKER_TOKEN', 'jeton-de-test' );
	}

	$today = '2026-08-19';

	ts_it( 'lists only orders whose money is in and whose proof is approved', function () use ( $product_id, $today ) {
		ts_pr_stub_nest();
		$ready   = ts_pr_ready( $product_id, 4, ts_pr_sides_a(), 'aaaaaaaaaaaaaaaa0001' );
		// Paid, but nobody has approved anything.
		ts_ck_fill( $product_id, 3, ts_pr_sides_a(), 'aaaaaaaaaaaaaaaa0002' );
		$unapproved = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) ) );
		$unapproved->payment_complete( 'ts-pr-open' );

		$ids = array_column( Production::queue( $today ), 'id' );
		ts_assert( in_array( $ready->get_id(), $ids, true ), 'une commande prête est absente de la file' );
		ts_assert(
			! in_array( $unapproved->get_id(), $ids, true ),
			'une commande sans BAT validé est entrée en production'
		);
	} );

	ts_it( 'dates each order against the proof, not against the payment', function () use ( $product_id, $today ) {
		ts_pr_stub_nest();
		$order = ts_pr_ready( $product_id, 4, ts_pr_sides_a(), 'aaaaaaaaaaaaaaaa0003' );
		$row   = null;
		foreach ( Production::queue( $today ) as $candidate ) {
			if ( $candidate['id'] === $order->get_id() ) {
				$row = $candidate;
			}
		}
		ts_assert( null !== $row, 'la commande n’est pas dans la file' );
		ts_eq( $row['bat']['version'], 1, 'la version du BAT n’est pas tracée' );
		ts_eq( $row['bat']['by'], 'client', 'le BAT a été validé par le client' );
		ts_eq(
			$row['target_on'],
			Production::target_date( $row['approved_on'], 'standard', Production::config() ),
			'la date cible ne part pas de la validation du BAT'
		);
		ts_assert( $row['ink_sq_cm'] > 0, 'la surface d’encre n’a pas été relevée' );
		ts_assert( array() !== $row['pieces'], 'la géométrie des transferts est absente' );
	} );

	ts_it( 'pools two orders, reconciles the split and reports the saving', function () use ( $product_id, $today ) {
		ts_pr_stub_nest();
		$a = ts_pr_ready( $product_id, 4, ts_pr_sides_a(), 'aaaaaaaaaaaaaaaa0010' );
		$b = ts_pr_ready( $product_id, 2, ts_pr_sides_b(), 'aaaaaaaaaaaaaaaa0011' );

		$made = Production::create_lot(
			array( $a->get_id(), $b->get_id() ),
			'fr',
			ts_pr_layout( $a->get_id(), $b->get_id() ),
			$today
		);
		ts_assert( $made['ok'], 'le lot a été refusé : ' . $made['reason'] );

		$bill = $made['lot']['bill'];
		$sum  = 0;
		foreach ( $bill['shares'] as $share ) {
			$sum += $share['share_ht'];
		}
		ts_eq( $sum, $bill['total_ht'], 'les parts ne totalisent pas la facture du lot' );
		ts_assert( $bill['saved_ht'] > 0, 'aucune économie mesurée sur un lot qui en fait une' );
		ts_eq( $bill['worse'], false, 'ce lot est annoncé comme plus cher que ses parties' );

		// And both orders now carry their own share.
		foreach ( array( $a, $b ) as $order ) {
			$part = Production::lot_of( wc_get_order( $order->get_id() ) );
			ts_assert( null !== $part, 'la commande ne porte pas sa part de lot' );
			ts_eq( $part['lot_id'], $made['lot']['lot_id'], 'mauvais lot sur la commande' );
			ts_assert( $part['share_ht'] > 0, 'part nulle' );
			ts_assert( $part['solo_ht'] >= $part['share_ht'], 'la part dépasse le coût en solo' );
		}
	} );

	ts_it( 'refuses to put an order in a second lot', function () use ( $product_id, $today ) {
		ts_pr_stub_nest();
		$a    = ts_pr_ready( $product_id, 4, ts_pr_sides_a(), 'aaaaaaaaaaaaaaaa0020' );
		$b    = ts_pr_ready( $product_id, 2, ts_pr_sides_b(), 'aaaaaaaaaaaaaaaa0021' );
		$one  = Production::create_lot( array( $a->get_id(), $b->get_id() ), 'fr', ts_pr_layout( $a->get_id(), $b->get_id() ), $today );
		ts_assert( $one['ok'], $one['reason'] );
		$two = Production::create_lot( array( $a->get_id() ), 'fr', ts_pr_layout( $a->get_id(), $b->get_id(), array( 'orders' => array( (string) $b->get_id() => null ) ) ), $today );
		ts_eq( $two['ok'], false, 'une commande a été mise dans deux lots' );
	} );

	ts_it( 'refuses a layout that has lost a garment-side', function () use ( $product_id, $today ) {
		ts_pr_stub_nest();
		$a = ts_pr_ready( $product_id, 4, ts_pr_sides_a(), 'aaaaaaaaaaaaaaaa0030' );
		$b = ts_pr_ready( $product_id, 2, ts_pr_sides_b(), 'aaaaaaaaaaaaaaaa0031' );
		// Three poses declared where the order needs four: one garment would come
		// off the press with nothing on its chest, and the cost would look right.
		$short = ts_pr_layout( $a->get_id(), $b->get_id() );
		$short['orders'][ (string) $a->get_id() ]['poses'] = 3;
		$made = Production::create_lot( array( $a->get_id(), $b->get_id() ), 'fr', $short, $today );
		ts_eq( $made['ok'], false, 'une pose manquante est passée' );
		ts_assert( str_contains( $made['reason'], 'poses' ), 'la raison ne dit pas ce qui manque : ' . $made['reason'] );
	} );

	ts_it( 'lets the operator force a single pose without the lot refusing it', function () use ( $product_id, $today ) {
		/*
		 * QUESTION 32 IS AN OPERATOR'S DECISION, and an earlier version of the
		 * gate above made it impossible: it compared the transfers on the film
		 * against the transfers the order was measured with, so a job pressed as
		 * one transfer per side — which the workshop screen offers, for a run
		 * where handling costs more than film — was refused as a corrupted
		 * layout.
		 */
		ts_pr_stub_nest();
		$a      = ts_pr_ready( $product_id, 4, ts_pr_sides_a(), 'aaaaaaaaaaaaaaaa0032' );
		$b      = ts_pr_ready( $product_id, 2, ts_pr_sides_b(), 'aaaaaaaaaaaaaaaa0033' );
		$merged = ts_pr_layout( $a->get_id(), $b->get_id() );
		// One transfer for the whole chest instead of two, and it is BIGGER,
		// because merging two visuals boxes the empty space between them.
		$merged['orders'][ (string) $a->get_id() ]['pieces'] = array(
			array( 'key' => 'front', 'w_cm' => 18.0, 'h_cm' => 22.0, 'qty' => 4 ),
		);
		$made = Production::create_lot( array( $a->get_id(), $b->get_id() ), 'fr', $merged, $today );
		ts_assert( $made['ok'], 'une pose unique a été refusée : ' . $made['reason'] );
	} );

	ts_it( 'refuses a layout carrying less ink than the order was charged for', function () use ( $product_id, $today ) {
		ts_pr_stub_nest();
		$a      = ts_pr_ready( $product_id, 4, ts_pr_sides_a(), 'aaaaaaaaaaaaaaaa0034' );
		$b      = ts_pr_ready( $product_id, 2, ts_pr_sides_b(), 'aaaaaaaaaaaaaaaa0035' );
		$tiny   = ts_pr_layout( $a->get_id(), $b->get_id() );
		$tiny['orders'][ (string) $a->get_id() ]['pieces'] = array(
			array( 'key' => 'front', 'w_cm' => 2.0, 'h_cm' => 2.0, 'qty' => 4 ),
		);
		$made = Production::create_lot( array( $a->get_id(), $b->get_id() ), 'fr', $tiny, $today );
		ts_eq( $made['ok'], false, 'une planche portant une autre création a été acceptée' );
	} );

	ts_it( 'refuses a length no amount of ink could fit on', function () use ( $product_id, $today ) {
		ts_pr_stub_nest();
		$a    = ts_pr_ready( $product_id, 4, ts_pr_sides_a(), 'aaaaaaaaaaaaaaaa0040' );
		$b    = ts_pr_ready( $product_id, 2, ts_pr_sides_b(), 'aaaaaaaaaaaaaaaa0041' );
		$made = Production::create_lot(
			array( $a->get_id(), $b->get_id() ),
			'fr',
			ts_pr_layout( $a->get_id(), $b->get_id(), array( 'pooled_m' => 0.05 ) ),
			$today
		);
		ts_eq( $made['ok'], false, 'une longueur physiquement impossible a été acceptée' );
	} );

	ts_it( 'refuses a length longer than the packer’s own straight-strip answer', function () use ( $product_id, $today ) {
		ts_pr_stub_nest();
		$a    = ts_pr_ready( $product_id, 4, ts_pr_sides_a(), 'aaaaaaaaaaaaaaaa0050' );
		$b    = ts_pr_ready( $product_id, 2, ts_pr_sides_b(), 'aaaaaaaaaaaaaaaa0051' );
		$made = Production::create_lot(
			array( $a->get_id(), $b->get_id() ),
			'fr',
			ts_pr_layout( $a->get_id(), $b->get_id(), array( 'pooled_m' => 90.0 ) ),
			$today
		);
		ts_eq( $made['ok'], false, 'une planche plus longue que la borne a été acceptée' );
	} );

	ts_it( 'creates no lot at all when the packer cannot be asked', function () use ( $product_id, $today ) {
		$a = ts_pr_ready( $product_id, 4, ts_pr_sides_a(), 'aaaaaaaaaaaaaaaa0060' );
		$b = ts_pr_ready( $product_id, 2, ts_pr_sides_b(), 'aaaaaaaaaaaaaaaa0061' );
		ts_pr_stub_nest( false );
		$made = Production::create_lot( array( $a->get_id(), $b->get_id() ), 'fr', ts_pr_layout( $a->get_id(), $b->get_id() ), $today );
		ts_eq( $made['ok'], false, '« on n’a pas pu demander » a été lu comme « c’est bon »' );
		ts_pr_stub_nest();
		ts_assert( null === Production::lot_of( wc_get_order( $a->get_id() ) ), 'la commande porte une part de lot jamais créé' );
	} );

	ts_it( 'moves the film cost of an order onto its lot, but only once the film is bought', function () use ( $product_id, $today ) {
		ts_pr_stub_nest();
		$a = ts_pr_ready( $product_id, 4, ts_pr_sides_a(), 'aaaaaaaaaaaaaaaa0070' );
		$b = ts_pr_ready( $product_id, 2, ts_pr_sides_b(), 'aaaaaaaaaaaaaaaa0071' );

		$before = Costing::refresh( wc_get_order( $a->get_id() ) );
		$solo   = null;
		foreach ( $before['cost']['lines'] as $line ) {
			if ( 'marquage' === $line['type'] ) {
				$solo = $line;
			}
		}
		ts_assert( null !== $solo, 'aucune ligne de marquage avant le lot' );

		$made = Production::create_lot( array( $a->get_id(), $b->get_id() ), 'fr', ts_pr_layout( $a->get_id(), $b->get_id() ), $today );
		ts_assert( $made['ok'], $made['reason'] );

		// A DRAFT changes nothing: a plan is not a purchase.
		$draft = Costing::refresh( wc_get_order( $a->get_id() ) );
		$draft_line = null;
		foreach ( $draft['cost']['lines'] as $line ) {
			if ( 'marquage' === $line['type'] ) {
				$draft_line = $line;
			}
		}
		ts_eq( $draft_line['amount_ht'], $solo['amount_ht'], 'un lot en brouillon a changé le coût d’une commande' );

		$sent = Production::send_lot( (int) $made['lot']['lot_id'], $today );
		ts_assert( $sent['ok'], $sent['reason'] );

		$after = Costing::stored( wc_get_order( $a->get_id() ) );
		$share = null;
		foreach ( $after['cost']['lines'] as $line ) {
			if ( 'marquage' === $line['type'] ) {
				$share = $line;
			}
		}
		ts_assert( null !== $share, 'la ligne de marquage a disparu' );
		ts_assert( $share['amount_ht'] < $solo['amount_ht'], 'la part du lot n’est pas moins chère que le tirage seul' );
		ts_eq( (bool) ( $after['film']['pooled'] ?? false ), true, 'le rapport ne dit pas que le film a été mutualisé' );
		ts_eq( (int) $after['film']['lot_id'], (int) $made['lot']['lot_id'], 'le rapport ne nomme pas le lot' );
	} );

	ts_it( 'makes a report stale the moment its order joins a lot', function () use ( $product_id, $today ) {
		ts_pr_stub_nest();
		$a      = ts_pr_ready( $product_id, 4, ts_pr_sides_a(), 'aaaaaaaaaaaaaaaa0080' );
		$b      = ts_pr_ready( $product_id, 2, ts_pr_sides_b(), 'aaaaaaaaaaaaaaaa0081' );
		$report = Costing::refresh( wc_get_order( $a->get_id() ) );
		ts_eq( Costing::current( wc_get_order( $a->get_id() ), $report ), true, 'le rapport neuf est déjà périmé' );

		$made = Production::create_lot( array( $a->get_id(), $b->get_id() ), 'fr', ts_pr_layout( $a->get_id(), $b->get_id() ), $today );
		ts_assert( $made['ok'], $made['reason'] );
		ts_eq(
			Costing::staleness( wc_get_order( $a->get_id() ), $report ),
			'commande',
			'un rapport calculé avant le lot se dit encore à jour'
		);
	} );

	ts_it( 'freezes a lot the moment its film is ordered', function () use ( $product_id, $today ) {
		ts_pr_stub_nest();
		$a    = ts_pr_ready( $product_id, 4, ts_pr_sides_a(), 'aaaaaaaaaaaaaaaa0090' );
		$b    = ts_pr_ready( $product_id, 2, ts_pr_sides_b(), 'aaaaaaaaaaaaaaaa0091' );
		$made = Production::create_lot( array( $a->get_id(), $b->get_id() ), 'fr', ts_pr_layout( $a->get_id(), $b->get_id() ), $today );
		ts_assert( $made['ok'], $made['reason'] );
		$lot_id = (int) $made['lot']['lot_id'];

		ts_assert( Production::send_lot( $lot_id, $today )['ok'], 'le film n’a pas pu être commandé' );
		ts_eq( Production::send_lot( $lot_id, $today )['ok'], false, 'un lot a été commandé deux fois' );
		ts_eq( Production::lot( $lot_id )['state'], Production::SENT, 'l’état du lot n’a pas été gelé' );
		ts_eq( Production::frozen( Production::lot( $lot_id )['state'] ), true, 'un lot expédié se dit modifiable' );

		// And it only ever moves forward.
		ts_eq( Production::advance_lot( $lot_id, Production::DRAFT )['ok'], false, 'un lot est revenu en brouillon' );
		ts_eq( Production::advance_lot( $lot_id, Production::DONE )['ok'], false, 'un lot a sauté une étape' );
		ts_assert( Production::advance_lot( $lot_id, Production::RECEIVED )['ok'], 'la réception du film a été refusée' );
		ts_eq( Production::lot_of( wc_get_order( $a->get_id() ) )['state'], Production::RECEIVED, 'la commande ignore où en est son lot' );
	} );

	ts_it( 'never puts an order already in a lot back in the queue', function () use ( $product_id, $today ) {
		ts_pr_stub_nest();
		$a    = ts_pr_ready( $product_id, 4, ts_pr_sides_a(), 'aaaaaaaaaaaaaaaa0100' );
		$b    = ts_pr_ready( $product_id, 2, ts_pr_sides_b(), 'aaaaaaaaaaaaaaaa0101' );
		$made = Production::create_lot( array( $a->get_id(), $b->get_id() ), 'fr', ts_pr_layout( $a->get_id(), $b->get_id() ), $today );
		ts_assert( $made['ok'], $made['reason'] );
		$ids = array_column( Production::queue( $today ), 'id' );
		ts_assert( ! in_array( $a->get_id(), $ids, true ), 'une commande déjà imbriquée reviendrait sur une seconde planche' );
	} );

	remove_all_filters( 'pre_http_request' );
}
