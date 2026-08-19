<?php
/**
 * The order's state machine.
 *
 * The interesting cases are all refusals. A machine that lets an order be
 * shipped before its proof is approved is the one failure this whole session
 * exists to make impossible, so most of what is asserted here is that an edge
 * does NOT exist.
 *
 * `blockers()` and `transition()` are not here: they need a real order, a real
 * ledger and a real proof, and they are asserted against all three in
 * `tests/integration-lifecycle.php`.
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
require_once __DIR__ . '/../includes/Settlement.php';
require_once __DIR__ . '/../includes/Lifecycle.php';

use Teeshoop\Core\Lifecycle;
use Teeshoop\Core\Settlement;

describe( 'Lifecycle: nothing is produced without an approved proof', function () {

	it( 'has no way into production except an approved BAT or a reprint', function () {
		/*
		 * THE ASSERTION IS THE LIST. Reading every state and checking which of
		 * them can reach the press is what makes this a proof rather than four
		 * cases somebody remembered to write. « Aucune production sans BAT »
		 * (chapitre 5) is one line of the Bible and this is what it means.
		 *
		 * Three doors, and each is a decision: the approved proof, a delivered
		 * order going back for a reprint under SAV, and a printed run that
		 * failed its own final check and returns to the press. None of them is
		 * a way past the proof, because `blockers()` asks `Bat` again on every
		 * one of them.
		 */
		$into = array();
		foreach ( Lifecycle::graph() as $from => $targets ) {
			if ( in_array( Lifecycle::PRODUCTION, $targets, true ) ) {
				$into[] = $from;
			}
		}
		sort( $into );
		$expected = array( Lifecycle::APPROVED, Lifecycle::DELIVERED, Lifecycle::PRINTED );
		sort( $expected );
		eq( $into, $expected, 'les seules portes vers la production' );
	} );

	it( 'refuses every jump a paid order could make straight to the press', function () {
		foreach ( array( Lifecycle::PAID, Lifecycle::DEPOSIT, Lifecycle::WAIT, Lifecycle::PROOF, Lifecycle::CHANGES ) as $from ) {
			foreach ( array( Lifecycle::PRODUCTION, Lifecycle::PRINTED, Lifecycle::SHIPPED, Lifecycle::DELIVERED ) as $to ) {
				eq( Lifecycle::allowed( $from, $to ), false, "{$from} -> {$to}" );
			}
		}
	} );

	it( 'refuses a parcel that was never printed and a delivery that never shipped', function () {
		eq( Lifecycle::allowed( Lifecycle::APPROVED, Lifecycle::SHIPPED ), false, 'validé -> expédié' );
		eq( Lifecycle::allowed( Lifecycle::PRODUCTION, Lifecycle::SHIPPED ), false, 'en production -> expédié' );
		eq( Lifecycle::allowed( Lifecycle::PRINTED, Lifecycle::DELIVERED ), false, 'imprimé -> livré' );
		eq( Lifecycle::allowed( Lifecycle::PROOF, Lifecycle::DELIVERED ), false, 'BAT envoyé -> livré' );
	} );

	it( 'lets a new version of the proof cancel the approval that came before it', function () {
		// An approval of version 3 authorises nothing about version 4, so the
		// order goes back to waiting for an answer. `Bat::approved()` is what
		// really decides; the status has to be able to follow.
		truthy( Lifecycle::allowed( Lifecycle::APPROVED, Lifecycle::PROOF ), 'validé -> BAT envoyé' );
	} );

	it( 'lets a delivered order be reprinted, which is the SAV case', function () {
		// Chapitre 5's decision matrix answers a Teeshoop error with a
		// « remplacement prioritaire ». Without this edge the only way to reprint
		// a delivered order is to fake a status, which is how a shop ends up
		// with orders in states nobody can explain.
		truthy( Lifecycle::allowed( Lifecycle::DELIVERED, Lifecycle::PRODUCTION ), 'livré -> en production' );
	} );

	it( 'ends at a refund, and reopens a cancellation', function () {
		eq( Lifecycle::next( Lifecycle::REFUNDED ), array(), 'un remboursement est un terminus' );
		truthy( Lifecycle::allowed( Lifecycle::CANCELLED, Lifecycle::PAID ), 'une annulation par erreur se rattrape' );
	} );

	it( 'treats a status it has never heard of as a stranger, not as a friend', function () {
		/*
		 * Any plugin may register an order status. The safe answer for one
		 * nobody modelled is WooCommerce's own terminals and nothing in our
		 * production chain: a machine that defaulted to permissive would let an
		 * unknown status be the way around every rule above.
		 */
		eq( Lifecycle::allowed( 'wc-mystere', Lifecycle::PRODUCTION ), false, 'inconnu -> production' );
		eq( Lifecycle::allowed( 'wc-mystere', Lifecycle::SHIPPED ), false, 'inconnu -> expédié' );
		truthy( Lifecycle::allowed( 'wc-mystere', Lifecycle::CANCELLED ), 'inconnu -> annulé' );
	} );

	it( 'lets an order stay where it is', function () {
		foreach ( array_keys( Lifecycle::statuses() ) as $status ) {
			truthy( Lifecycle::allowed( $status, $status ), "{$status} -> {$status}" );
		}
	} );

	it( 'names both ends and what has to happen first when it refuses', function () {
		$why = Lifecycle::refusal( Lifecycle::PAID, Lifecycle::PRODUCTION );
		truthy( str_contains( $why, 'BAT' ), 'la raison ne nomme pas le BAT' );
		truthy( str_contains( $why, 'Payée' ), 'la raison ne nomme pas l’état de départ' );
		truthy( str_contains( $why, 'En production' ), 'la raison ne nomme pas la cible' );

		$livree = Lifecycle::refusal( Lifecycle::PRINTED, Lifecycle::DELIVERED );
		truthy( str_contains( $livree, 'expédi' ), 'un « livré » refusé doit dire pourquoi' );
	} );
} );

describe( 'Lifecycle: what a target needs beyond the edge', function () {

	it( 'asks for the proof AND the money before the press', function () {
		eq( Lifecycle::needs( Lifecycle::PRODUCTION ), array( 'bat', 'production' ), 'production' );
		eq( Lifecycle::needs( Lifecycle::PRINTED ), array( 'bat', 'production' ), 'imprimé' );
	} );

	it( 'asks for the proof again before the parcel, and not only for the balance', function () {
		/*
		 * `completed -> ts-prod -> ts-imprime -> ts-expedie` is the reprint path,
		 * and a reprint of a superseded proof is exactly the mistake this chain
		 * exists to stop. Relying on "production implies it" would leave that
		 * door open.
		 */
		eq( Lifecycle::needs( Lifecycle::SHIPPED ), array( 'bat', 'dispatch' ), 'expédié' );
	} );

	it( 'asks for nothing extra to send a proof or record a change', function () {
		eq( Lifecycle::needs( Lifecycle::PROOF ), array(), 'BAT envoyé' );
		eq( Lifecycle::needs( Lifecycle::CHANGES ), array(), 'modifications' );
		eq( Lifecycle::needs( Lifecycle::CANCELLED ), array(), 'annulation' );
	} );

	it( 'speaks the settlement module’s own vocabulary', function () {
		// One name per stage across the whole plugin, so the money gate and the
		// lifecycle cannot drift into asking two different questions.
		eq( Lifecycle::stage( 'production' ), Settlement::STAGE_PRODUCTION, 'production' );
		eq( Lifecycle::stage( 'dispatch' ), Settlement::STAGE_DISPATCH, 'expédition' );
		eq( Lifecycle::stage( 'bat' ), '', 'le BAT n’est pas une question d’argent' );
	} );
} );

describe( 'Lifecycle: the statuses themselves', function () {

	it( 'keeps every slug inside the twenty characters a post status has', function () {
		/*
		 * `wp_posts.post_status` is VARCHAR(20) and the `wc-` prefix is part of
		 * it. A longer slug is silently truncated on write and then never
		 * matches on read, which is an order that reads as `pending` for ever.
		 */
		foreach ( Lifecycle::ours() as $slug ) {
			truthy( strlen( 'wc-' . $slug ) <= 20, "wc-{$slug} dépasse 20 caractères" );
		}
	} );

	it( 'has a French label for every state the machine can be in', function () {
		$labels = Lifecycle::statuses();
		foreach ( array_keys( Lifecycle::graph() ) as $status ) {
			truthy( isset( $labels[ $status ] ) && '' !== $labels[ $status ], "aucun libellé pour {$status}" );
		}
	} );

	it( 'points every edge at a state that exists', function () {
		// A target with no row of its own is a dead end nobody meant to write,
		// and it would read on screen as a state an order can never leave.
		$graph = Lifecycle::graph();
		foreach ( $graph as $from => $targets ) {
			foreach ( $targets as $to ) {
				truthy( isset( $graph[ $to ] ), "{$from} mène à {$to}, qui n’existe pas" );
			}
		}
	} );
} );
