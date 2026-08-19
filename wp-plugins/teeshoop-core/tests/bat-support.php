<?php
/**
 * The WordPress half of scripts/bat-verify.mjs.
 *
 *   docker compose -f wp-local/docker-compose.yml run --rm wpcli \
 *     eval-file wp-content/plugins/teeshoop-core/tests/bat-support.php <mode> [args]
 *
 * Modes, each printing ONE line of JSON on stdout:
 *
 *   commande                 build a paid order with one personalised line and
 *                            return its id and the customer's e-mail
 *   bat <id> [note]          issue the proof, send it, and return the LINK the
 *                            customer would click plus what the outbox recorded
 *   etat <id>                the status, the journal, the proof and the outbox
 *   suivi <id> <numero>      record a tracking number
 *   avancer <id> <statut>    move the order through Lifecycle, and say why not
 *   message <id> <kind>      the rendered HTML of one message, for a screenshot
 *   menage                   delete every order this harness made
 *
 * IT ASSERTS NOTHING, the same rule `e2e-support.php` records: every judgement
 * is made in Node, from the JSON. A support file that decided for itself
 * whether the gate held would be the gate's second implementation.
 *
 * NOTE: no `declare(strict_types=1)`. `wp eval-file` eval()s the contents and a
 * declare must be the first statement of a script.
 *
 * @package Teeshoop\Core
 */

if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

use Teeshoop\Core\Bat;
use Teeshoop\Core\Cart;
use Teeshoop\Core\Lifecycle;
use Teeshoop\Core\Mail;
use Teeshoop\Core\Notify;
use Teeshoop\Core\Product;
use Teeshoop\Core\Settings;
use Teeshoop\Core\Waiver;

/** Marks the orders this harness owns, so `menage` can find them again. */
const TS_BAT_MARK = '_teeshoop_bat_harness';

function ts_bat_out( array $payload ) {
	echo wp_json_encode( $payload ) . "\n";
}

/** One printed side, with the placement the studio measures. */
function ts_bat_sides() {
	return array(
		array(
			'id'         => 'front',
			'area_sq_cm' => 288.0,
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
				array(
					'w_cm'         => 12.0,
					'h_cm'         => 3.2,
					'top_cm'       => 22.0,
					'center_dx_cm' => 0.0,
				),
			),
		),
	);
}

function ts_bat_product() {
	$found = get_posts(
		array(
			'post_type'      => 'product',
			'name'           => 'teeshoop-bat-tee',
			'posts_per_page' => 1,
			'fields'         => 'ids',
			'post_status'    => 'any',
		)
	);
	if ( ! empty( $found ) ) {
		return (int) $found[0];
	}
	$product = new WC_Product_Simple();
	$product->set_name( 'Tee-shirt du harnais BAT' );
	$product->set_slug( 'teeshoop-bat-tee' );
	$product->set_regular_price( '14.50' );
	$product->set_weight( '0.18' );
	$product->set_catalog_visibility( 'hidden' );
	$product->update_meta_data( Product::META, 'tee' );
	$product->save();
	return (int) $product->get_id();
}

$mode = isset( $args[0] ) ? (string) $args[0] : '';

if ( 'commande' === $mode ) {
	if ( ! defined( 'TEESHOOP_ALLOW_UNVERIFIED_DESIGNS' ) ) {
		define( 'TEESHOOP_ALLOW_UNVERIFIED_DESIGNS', true );
	}
	// The mail settings this harness needs, and nothing else: without an
	// expedition address `Mail` refuses every send by name, which is correct
	// and would make every assertion below about the wrong thing.
	$settings = Settings::all();
	update_option(
		'teeshoop_settings',
		array_merge(
			$settings,
			array(
				'mail_from'      => 'atelier@teeshoop.test',
				'mail_from_name' => 'Teeshoop',
				'mail_atelier'   => 'atelier@teeshoop.test',
			)
		)
	);

	include_once WC_ABSPATH . 'includes/wc-cart-functions.php';
	include_once WC_ABSPATH . 'includes/class-wc-cart.php';
	wc_load_cart();
	WC()->cart->empty_cart();

	$product_id = ts_bat_product();
	$added      = Cart::add(
		array(
			'product_id' => $product_id,
			'qty'        => 12,
			'garment'    => 'tee',
			'sides'      => ts_bat_sides(),
			'design_id'  => 'harnaisbat0123456789',
			'size_grid'  => array(
				'M' => 6,
				'L' => 6,
			),
		)
	);
	if ( is_wp_error( $added ) ) {
		ts_bat_out(
			array(
				'ok'    => false,
				'error' => $added->get_error_code() . ': ' . $added->get_error_message(),
			)
		);
		return;
	}
	WC()->cart->calculate_totals();

	// The customer ticks the box. This is the real field the classic checkout
	// posts, read by the real handler.
	$_POST['teeshoop_renonciation'] = '1';
	$_SERVER['REMOTE_ADDR']         = '198.51.100.4';

	$order = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) ) );
	unset( $_POST['teeshoop_renonciation'] );

	/*
	 * THE COLOUR AND THE PER-SIDE MOCKUPS, STOOD IN FOR.
	 *
	 * Both normally come out of the design manifest, which means a Worker, and
	 * this container has none: `Design::verify` is running under
	 * TEESHOOP_ALLOW_UNVERIFIED_DESIGNS and there is no manifest to read. That
	 * seam is proved where it can be, in `integration-lifecycle.php`, by
	 * answering the real `wp_remote_get` with a real manifest. Here the harness
	 * writes what the manifest would have written, so the proof page has a
	 * colour to print and an image to show.
	 */
	foreach ( $order->get_items() as $item ) {
		if ( '' !== (string) $item->get_meta( '_teeshoop_design_id', true ) ) {
			$item->update_meta_data( '_teeshoop_couleur', 'navy' );
			$item->save();
		}
	}

	$order->set_billing_first_name( 'Camille' );
	$order->set_billing_last_name( 'Roux' );
	$order->set_billing_company( 'Atelier Roux' );
	$order->set_billing_email( 'camille@example.test' );
	$order->update_meta_data( TS_BAT_MARK, '1' );
	$order->save();
	$order->payment_complete( 'harnais-' . $order->get_id() );

	$order = wc_get_order( $order->get_id() );
	ts_bat_out(
		array(
			'ok'          => true,
			'order_id'    => $order->get_id(),
			'number'      => $order->get_order_number(),
			'status'      => $order->get_status(),
			'email'       => $order->get_billing_email(),
			'total'       => $order->get_total(),
			'renonciation' => Waiver::record( $order ),
			'facture'     => Waiver::invoice_line( $order ),
		)
	);
	return;
}

if ( 'bat' === $mode ) {
	$order = wc_get_order( (int) ( $args[1] ?? 0 ) );
	if ( ! $order instanceof WC_Order ) {
		ts_bat_out(
			array(
				'ok'    => false,
				'error' => 'no such order',
			)
		);
		return;
	}
	$issued = Bat::issue( $order, (string) ( $args[2] ?? '' ) );
	if ( empty( $issued['ok'] ) ) {
		ts_bat_out(
			array(
				'ok'    => false,
				'error' => (string) $issued['reason'],
			)
		);
		return;
	}
	$sent = Notify::bat( wc_get_order( $order->get_id() ), $issued['version'], (string) $issued['token'] );

	ts_bat_out(
		array(
			'ok'       => true,
			'version'  => (int) $issued['version']['version'],
			'url'      => Bat::url( $order, (int) $issued['version']['version'], (string) $issued['token'] ),
			'expires'  => (string) $issued['version']['expires_at'],
			'status'   => wc_get_order( $order->get_id() )->get_status(),
			'sent'     => (bool) $sent['ok'],
			'why'      => (string) $sent['reason'],
			'transport' => ts_bat_last_transport( $order->get_id(), Notify::KIND_BAT ),
		)
	);
	return;
}

function ts_bat_last_transport( $order_id, $kind ) {
	$rows = array_values(
		array_filter(
			Mail::for_order( (int) $order_id ),
			static function ( $row ) use ( $kind ) {
				return (string) $row->kind === $kind;
			}
		)
	);
	return empty( $rows ) ? '' : (string) $rows[ count( $rows ) - 1 ]->transport;
}

if ( 'etat' === $mode ) {
	$order = wc_get_order( (int) ( $args[1] ?? 0 ) );
	if ( ! $order instanceof WC_Order ) {
		ts_bat_out(
			array(
				'ok'    => false,
				'error' => 'no such order',
			)
		);
		return;
	}
	$current = Bat::current( $order );
	$mail    = array();
	foreach ( Mail::for_order( $order->get_id() ) as $row ) {
		$mail[] = array(
			'kind'   => (string) $row->kind,
			'status' => (string) $row->status,
			'to'     => (string) $row->recipient,
			'error'  => (string) $row->last_error,
		);
	}

	ts_bat_out(
		array(
			'ok'         => true,
			'status'     => $order->get_status(),
			'journal'    => array_map(
				static function ( $entry ) {
					return array(
						'to'     => (string) $entry['to'],
						'by'     => (string) $entry['by_name'],
						'reason' => (string) $entry['reason'],
					);
				},
				Lifecycle::journal( $order )
			),
			'approuve'   => Bat::approved( $order ),
			'refus'      => Bat::refusal( $order ),
			'version'    => null === $current ? 0 : (int) $current['version'],
			'validation' => null === $current ? null : ( $current['approval'] ?? null ),
			'modifs'     => null === $current ? array() : (array) ( $current['changes'] ?? array() ),
			'corrections' => Bat::corrections( $order ),
			'mail'       => $mail,
			'bloquants'  => array(
				'production' => Lifecycle::blockers( $order, Lifecycle::PRODUCTION ),
				'expedition' => Lifecycle::blockers( $order, Lifecycle::SHIPPED ),
			),
		)
	);
	return;
}

if ( 'suivi' === $mode ) {
	$order = wc_get_order( (int) ( $args[1] ?? 0 ) );
	$order->update_meta_data( Notify::META_TRACKING, (string) ( $args[2] ?? '' ) );
	$order->save();
	ts_bat_out(
		array(
			'ok'    => true,
			'suivi' => Notify::tracking( wc_get_order( $order->get_id() ) ),
		)
	);
	return;
}

if ( 'avancer' === $mode ) {
	$order  = wc_get_order( (int) ( $args[1] ?? 0 ) );
	$moved  = Lifecycle::transition( $order, (string) ( $args[2] ?? '' ), array( 'source' => 'harnais' ) );
	$fresh  = wc_get_order( $order->get_id() );
	ts_bat_out(
		array(
			'ok'     => (bool) $moved['ok'],
			'reason' => (string) $moved['reason'],
			'status' => $fresh->get_status(),
		)
	);
	return;
}

if ( 'message' === $mode ) {
	/*
	 * The rendered HTML of one message, so the harness can put it in a browser
	 * and photograph it.
	 *
	 * `render` AND NEVER `rebuild`. The two share one composer, so this is the
	 * message the customer actually receives; but `rebuild` mints a new approval
	 * link, and asking it for a preview killed the live link the harness was
	 * about to click. That is what the split exists for.
	 */
	$built = Notify::render(
		(string) ( $args[2] ?? '' ),
		(int) ( $args[1] ?? 0 ),
		// A token of the right SHAPE and no power at all, so the photograph shows
		// the address a customer really sees rather than a truncated one. It is
		// spelled out rather than random, because a screenshot carrying something
		// that looks like a live capability is a screenshot somebody tries.
		'jeton-de-demonstration-sans-aucune-valeur'
	);
	ts_bat_out(
		array(
			'ok'      => (bool) $built['ok'],
			'error'   => (string) ( $built['reason'] ?? '' ),
			'subject' => empty( $built['ok'] ) ? '' : (string) $built['message']['subject'],
			'html'    => empty( $built['ok'] ) ? '' : (string) $built['message']['html'],
			'text'    => empty( $built['ok'] ) ? '' : (string) $built['message']['text'],
		)
	);
	return;
}

if ( 'menage' === $mode ) {
	$gone = 0;
	foreach ( wc_get_orders( array( 'limit' => -1, 'status' => 'any' ) ) as $order ) {
		if ( '' !== (string) $order->get_meta( TS_BAT_MARK, true ) ) {
			$order->delete( true );
			++$gone;
		}
	}
	ts_bat_out(
		array(
			'ok'       => true,
			'supprimes' => $gone,
		)
	);
	return;
}

ts_bat_out(
	array(
		'ok'    => false,
		'error' => 'unknown mode: ' . $mode,
	)
);
