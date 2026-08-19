<?php
/**
 * TEMPORARY: reproduction of the "stuck SENDING" claim. Delete after reading.
 */

use Teeshoop\Core\Costing;
use Teeshoop\Core\Importer;
use Teeshoop\Core\Product;
use Teeshoop\Core\Purchase;

function ts_repro_freight( \WC_Order $order ): int {
	$report = Costing::refresh( $order );
	$sum    = 0;
	foreach ( $report['cost']['lines'] as $line ) {
		if ( 'transport_in' === $line['type'] ) {
			$sum += (int) $line['amount_ht'];
		}
	}
	return $sum;
}

function ts_repro_suite( int $product_id ): void {
	echo "\nREPRO: a purchase whose process died during send()\n";

	$GLOBALS['ts_ac_made'] = array();
	add_filter( 'pre_wp_mail', '__return_true' );

	ts_ac_forget_blank();
	$GLOBALS['ts_ac_entry'] = ts_ac_entry();
	Importer::one( '18001' );
	update_post_meta( $product_id, Product::META_BLANK_REF, '18001' );
	update_post_meta( $product_id, Product::META_BLANK_COLOURS, wp_json_encode( array( 'white' => 'White', 'black' => 'Black' ) ) );

	$a = ts_ac_order( $product_id, array( 'M' => 12, 'L' => 8 ), 'white', 'rrrrrrrrrrrrrrrr1111' );
	$b = ts_ac_order( $product_id, array( 'M' => 6, 'S' => 4 ), 'black', 'rrrrrrrrrrrrrrrr2222' );
	Costing::refresh( $a );
	Costing::refresh( $b );

	$prepared = Purchase::prepare( array( $a->get_id(), $b->get_id() ) );
	ts_it( 'prepares a purchase for two orders', function () use ( $prepared ) {
		ts_assert( ! empty( $prepared['ok'] ), 'préparation refusée : ' . ( $prepared['reason'] ?? '' ) );
	} );
	$id = (int) $prepared['id'];

	// What order A would pay alone, and what its pooled share would be.
	$solo_a  = 0;
	$share_a = 0;
	foreach ( $prepared['purchase']['orders'] as $row ) {
		if ( (int) $row['id'] === $a->get_id() ) {
			$solo_a  = (int) $row['solo_freight_ht'];
			$share_a = (int) $row['freight_ht'];
		}
	}

	// The report as the operator last saw it, before the send attempt.
	$freight_before = ts_repro_freight( wc_get_order( $a->get_id() ) );
	$stamp_before   = Costing::stamp( wc_get_order( $a->get_id() ) );
	$fresh_before   = Costing::current( wc_get_order( $a->get_id() ), Costing::stored( wc_get_order( $a->get_id() ) ) );

	/*
	 * THE DEATH. The document leaves, and this process never comes back: the
	 * filter throws where `wp_remote_post` would have blocked for up to 40 s.
	 * Everything after Purchase.php:1268 is simply never executed.
	 */
	ts_ac_stub();
	add_filter(
		'pre_http_request',
		function ( $pre, $args, $url ) {
			if ( str_ends_with( (string) $url, '/order' ) ) {
				throw new \RuntimeException( 'process killed mid-send' );
			}
			return $pre;
		},
		5,
		3
	);
	$died = false;
	try {
		Purchase::send( $id, 'test' );
	} catch ( \Throwable $e ) {
		$died = true;
	}
	ts_ac_stub();
	wp_cache_flush();

	ts_it( 'leaves the record at SENDING, not at « envoi incertain »', function () use ( $died, $id ) {
		ts_assert( $died, 'le processus n’est pas mort là où le test le voulait' );
		$record = Purchase::get( $id );
		ts_assert( Purchase::SENDING === $record['state'], 'état ' . $record['state'] . ' au lieu de ' . Purchase::SENDING );
		ts_assert( 'Envoi en cours' === Purchase::states()[ $record['state'] ], 'l’écran dit ' . Purchase::states()[ $record['state'] ] );
	} );

	ts_it( 'refuses send(), discard() and receive() on it: no operator action exists', function () use ( $id ) {
		$again = Purchase::send( $id, 'test' );
		ts_assert( empty( $again['ok'] ), 'un second envoi a été accepté' );
		$drop = Purchase::discard( $id );
		ts_assert( empty( $drop['ok'] ), 'discard() a accepté un envoi bloqué : ' . $drop['reason'] );
		$got = Purchase::receive( $id );
		ts_assert( empty( $got['ok'] ), 'receive() a accepté un envoi bloqué : ' . $got['reason'] );
		ts_assert( null !== Purchase::get( $id ), 'le dossier a disparu' );
	} );

	ts_it( 'leaves every order pinned, and its part still reading « prepare »', function () use ( $a, $b ) {
		foreach ( array( $a, $b ) as $order ) {
			$part = Purchase::part_of( wc_get_order( $order->get_id() ) );
			ts_assert( null !== $part, 'la commande a été détachée' );
			ts_assert( Purchase::PREPARED === $part['state'], 'la part dit ' . $part['state'] );
		}
	} );

	ts_it( 'charges each order its own flat freight instead of its share', function () use ( $a, $b, $id, $solo_a, $share_a, $freight_before ) {
		$now = ts_repro_freight( wc_get_order( $a->get_id() ) );
		echo "      solo={$solo_a} part={$share_a} rapport_avant={$freight_before} rapport_apres={$now}\n";
		ts_assert( $now === $solo_a, 'le rapport facture ' . $now . ' alors que le port seul est ' . $solo_a );
		ts_assert( $now > $share_a, 'aucune sur-facturation : ' . $now . ' contre ' . $share_a );
		$total = ts_repro_freight( wc_get_order( $a->get_id() ) ) + ts_repro_freight( wc_get_order( $b->get_id() ) );
		$engaged = (int) Purchase::get( $id )['freight_ht'];
		echo "      somme des ports facturés aux commandes = {$total}, port réellement engagé = {$engaged}\n";
	} );

	ts_it( 'never marks the reports stale, so they go on reading « à jour »', function () use ( $a, $stamp_before, $fresh_before ) {
		$order = wc_get_order( $a->get_id() );
		ts_assert( $fresh_before, 'le rapport n’était déjà pas à jour avant l’envoi' );
		ts_assert( $stamp_before === Costing::stamp( $order ), 'l’empreinte a bougé' );
		ts_assert( Costing::current( $order, Costing::stored( $order ) ), 'le rapport se dit périmé' );
	} );

	ts_it( 'drops the lot from « Lots à approvisionner » (the exact test that screen makes)', function () use ( $a, $b ) {
		foreach ( array( $a, $b ) as $order ) {
			ts_assert( null !== Purchase::part_of( wc_get_order( $order->get_id() ) ), 'la commande n’est plus comptée comme achetée' );
		}
	} );

	// What the pooled state would have charged, for the comparison.
	$record          = Purchase::get( $id );
	$record['state'] = Purchase::SENT;
	$record['sent_on'] = '2026-08-19';
	update_post_meta( $id, Purchase::META_ORDER, wp_json_encode( $record ) );
	foreach ( $record['orders'] as $row ) {
		$order = wc_get_order( (int) $row['id'] );
		$part  = Purchase::part_of( $order );
		$part['state'] = Purchase::SENT;
		$order->update_meta_data( Purchase::META_ORDER_PART, wp_json_encode( $part ) );
		$order->save();
	}
	ts_it( 'and the same purchase, once it says SENT, charges the share', function () use ( $a, $share_a ) {
		$now = ts_repro_freight( wc_get_order( $a->get_id() ) );
		echo "      une fois « envoyée » : {$now}\n";
		ts_assert( $now === $share_a, 'part attendue ' . $share_a . ', obtenue ' . $now );
	} );

	// ── cleaning up ──────────────────────────────────────────────────────────
	remove_all_filters( 'pre_http_request' );
	foreach ( $GLOBALS['ts_ac_made'] ?? array() as $made ) {
		$order = wc_get_order( $made );
		if ( $order instanceof \WC_Order ) {
			$order->delete( true );
		}
	}
	$GLOBALS['ts_ac_made'] = array();
	foreach ( get_posts( array( 'post_type' => Purchase::POST_TYPE, 'post_status' => 'any', 'numberposts' => 100, 'fields' => 'ids' ) ) as $one ) {
		wp_delete_post( (int) $one, true );
	}
	delete_post_meta( $product_id, Product::META_BLANK_REF );
	delete_post_meta( $product_id, Product::META_BLANK_COLOURS );
	ts_ac_forget_blank();
}
