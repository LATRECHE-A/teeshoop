<?php
/**
 * The lifecycle, the proof and the outbox, against a real WooCommerce.
 *
 * WHY NONE OF THIS CAN BE A PURE TEST. The state machine is pure and tested in
 * `test-lifecycle.php`; everything here is the seam, which is where this project
 * loses money. A custom order status that is registered on one filter and not
 * the other stores itself as `pending` with no error. A guard hooked on the
 * wrong name never runs and the file claims a protection it does not have. An
 * order in a status WooCommerce does not consider paid vanishes from the shop's
 * own takings. None of those is visible from a pure test and all three have
 * shipped in this plugin before.
 *
 * NO `declare(strict_types=1)`: this file is `require`d, and it must stay
 * requirable from `integration.php`, which `wp eval-file` eval()s.
 *
 * @package Teeshoop\Core
 */

use Teeshoop\Core\Bat;
use Teeshoop\Core\Claim;
use Teeshoop\Core\Invoice;
use Teeshoop\Core\Ledger;
use Teeshoop\Core\Lifecycle;
use Teeshoop\Core\Mail;
use Teeshoop\Core\Notify;
use Teeshoop\Core\Quote;
use Teeshoop\Core\Settlement;
use Teeshoop\Core\Vat;
use Teeshoop\Core\Waiver;

/** One printed side with real geometry AND the placement a proof states. */
function ts_lc_sides(): array {
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

/** A paid order with one personalised line. */
function ts_lc_order( int $product_id, int $qty = 6 ): \WC_Order {
	ts_ck_fill( $product_id, $qty, ts_lc_sides() );
	$order = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) ) );
	$order->set_billing_email( 'client@example.test' );
	$order->set_billing_first_name( 'Camille' );
	$order->set_billing_last_name( 'Roux' );
	$order->set_billing_company( 'Atelier Roux' );
	$order->save();
	$order->payment_complete( 'ts-lc-' . $order->get_id() );
	return wc_get_order( $order->get_id() );
}

/**
 * Every outbound HTTP call, answered by us.
 *
 * `pre_http_request` is the only seam WordPress gives for this, and it is the
 * right one: the plugin's real `wp_remote_post` runs, its headers and body are
 * built by the real code, and only the wire is replaced. A test that called a
 * mock client instead would prove that the mock works.
 *
 * @return array the calls that were made, by reference, so a case can read them.
 */
function &ts_lc_capture_http( int $status = 201, array $body = array( 'messageId' => '<abc@brevo>' ) ) {
	remove_all_filters( 'pre_http_request' );
	$GLOBALS['ts_lc_http'] = array();
	add_filter(
		'pre_http_request',
		function ( $pre, $args, $url ) use ( $status, $body ) {
			$GLOBALS['ts_lc_http'][] = array(
				'url'    => $url,
				'method' => $args['method'] ?? 'GET',
				'body'   => isset( $args['body'] ) && is_string( $args['body'] ) ? json_decode( $args['body'], true ) : null,
				'header' => $args['headers'] ?? array(),
			);
			if ( false === strpos( (string) $url, 'brevo.com' ) ) {
				// Not ours: let the design verification keep its own stub.
				return $pre;
			}
			return array(
				'headers'  => array(),
				'body'     => wp_json_encode( $body ),
				'response' => array(
					'code'    => $status,
					'message' => 'stub',
				),
				'cookies'  => array(),
				'filename' => null,
			);
		},
		10,
		3
	);
	return $GLOBALS['ts_lc_http'];
}

function ts_lc_brevo_calls(): array {
	return array_values(
		array_filter(
			(array) ( $GLOBALS['ts_lc_http'] ?? array() ),
			static fn( array $call ): bool => false !== strpos( (string) $call['url'], 'brevo.com' )
		)
	);
}

function ts_lifecycle_suite( int $product_id, int $bare_id ): void {
	$saved_settings = get_option( 'teeshoop_settings', array() );

	/*
	 * CLEARED AND SET AT THE START, not only restored at the end. A case that
	 * fails throws before its own cleanup, and a leftover `mail_from` would then
	 * change what the NEXT run's Brevo assertions see.
	 */
	update_option(
		'teeshoop_settings',
		array_merge(
			(array) $saved_settings,
			array(
				'mail_from'      => 'atelier@teeshoop.test',
				'mail_from_name' => 'Teeshoop',
				'mail_atelier'   => 'atelier@teeshoop.test',
			)
		)
	);

	ts_ck_regime( Vat::STANDARD );
	ts_ck_customer_in_france();

	/*
	 * SILENCE SENDMAIL. `wp_mail` is a real path here (no Brevo key on the
	 * mirror) and this container has no MTA, so every send would print
	 * "sendmail: can't connect to remote host" into the middle of the suite's
	 * own output. `integration-checkout.php` does the same thing for the same
	 * reason, and records that a runner skipping its suite has to repeat it.
	 */
	add_filter( 'pre_wp_mail', '__return_true' );

	echo "\nCycle de vie, BAT et envois\n";

	// ── the statuses are real ────────────────────────────────────────────────

	ts_it( 'registers a status WooCommerce will actually store', function () use ( $product_id ) {
		/*
		 * THE TRAP THIS CATCHES. `WC_Abstract_Order::set_status()` validates
		 * against `wc_get_order_statuses()` and silently rewrites anything else
		 * to `pending`. A status registered as a post status but missing from
		 * that filter therefore looks registered, saves without error, and reads
		 * back as an unpaid order.
		 */
		$order = ts_lc_order( $product_id );
		$order->set_status( Lifecycle::PROOF );
		$order->save();
		ts_eq( wc_get_order( $order->get_id() )->get_status(), Lifecycle::PROOF, 'statut stocké' );
		$order->delete( true );
	} );

	ts_it( 'never teaches is_paid() to answer for our statuses', function () use ( $product_id ) {
		/*
		 * THE FIRST VERSION DID, and it cost the definitive invoice.
		 * `Ledger::follow` calls `payment_complete()` only `if ( ! $order->is_paid() )`,
		 * which is how the balance of a deposit order produces its final invoice
		 * and its commission; with « BAT envoyé » counted as paid, that order was
		 * already "paid" and the invoice was never issued at all. The ledger is
		 * the authority and the status is a label, and this is the case that
		 * keeps the label from speaking for the money.
		 */
		$order = ts_lc_order( $product_id );
		Lifecycle::transition( $order, Lifecycle::PROOF );
		$order = wc_get_order( $order->get_id() );
		ts_eq( $order->is_paid(), false, 'un statut Teeshoop se fait passer pour un statut payé' );
		ts_assert( Ledger::received( $order ) > 0, 'et pourtant l’argent est bien là, dans le registre' );
		$order->delete( true );
	} );

	ts_it( 'keeps a part-paid order out of the reports, whatever its status', function () use ( $product_id ) {
		/*
		 * `Ledger::out_of_reports` excluded only « Acompte reçu », and sending
		 * the proof moved the order out of it: a 5 472,00 EUR order sitting on a
		 * 2 736,00 EUR deposit booked its whole total the moment the customer
		 * was sent something to look at.
		 */
		$excluded = apply_filters( 'woocommerce_analytics_excluded_order_statuses', array() );
		foreach ( Lifecycle::ours() as $status ) {
			ts_assert( in_array( $status, $excluded, true ), "{$status} est compté par Analytics" );
		}
		ts_assert( in_array( 'ts-acompte', $excluded, true ), 'l’acompte a cessé d’être exclu' );
	} );

	ts_it( 'finds an order in one of our statuses when asked for any', function () use ( $product_id ) {
		// `exclude_from_search => true` would drop it out of `status => 'any'`,
		// which is how an order disappears from every admin list at once.
		$order = ts_lc_order( $product_id );
		Lifecycle::transition( $order, Lifecycle::PROOF );
		$ids = wc_get_orders(
			array(
				'status' => 'any',
				'limit'  => -1,
				'return' => 'ids',
			)
		);
		ts_assert( in_array( $order->get_id(), $ids, true ), 'commande introuvable en statut « any »' );
		$order->delete( true );
	} );

	// ── the gate ─────────────────────────────────────────────────────────────

	ts_it( 'refuses to put an order on the press without an approved BAT', function () use ( $product_id ) {
		$order    = ts_lc_order( $product_id );
		$blockers = Lifecycle::blockers( $order, Lifecycle::PRODUCTION );
		ts_assert( ! empty( $blockers ), 'aucun blocage sur une commande sans BAT' );
		ts_assert( false !== strpos( implode( ' ', $blockers ), 'BAT' ), 'le blocage ne nomme pas le BAT' );

		$moved = Lifecycle::transition( $order, Lifecycle::PRODUCTION );
		ts_eq( $moved['ok'], false, 'la transition a été acceptée' );
		ts_eq( wc_get_order( $order->get_id() )->get_status(), Lifecycle::PAID, 'le statut a bougé quand même' );
		$order->delete( true );
	} );

	ts_it( 'refuses the press just as hard when the BAT was sent and never answered', function () use ( $product_id ) {
		/*
		 * THE CASE ABOVE ONLY COVERS "NO BAT AT ALL", and that is the easy half:
		 * `Bat::refusal()` finds no version and refuses on the first line.
		 * Breaking the second branch on purpose (the one that reads the approval
		 * on the CURRENT version) left the case above green, which is how a gate
		 * ends up covering the state nobody was worried about.
		 */
		$order = ts_lc_order( $product_id );
		Bat::issue( $order );
		$order = wc_get_order( $order->get_id() );

		ts_assert( ! Bat::approved( $order ), 'un BAT sans réponse compte comme validé' );
		$blockers = Lifecycle::blockers( $order, Lifecycle::PRODUCTION );
		ts_assert( ! empty( $blockers ), 'la production est ouverte sur un BAT sans réponse' );
		ts_assert( false !== strpos( implode( ' ', $blockers ), 'version 1' ), 'le blocage ne nomme pas la version en attente' );
		$order->delete( true );
	} );

	ts_it( 'puts back a status forced past the gate, and says so on the order', function () use ( $product_id ) {
		/*
		 * THE BACKSTOP, and the one that matters. `Lifecycle::transition()` is
		 * the API, but the admin dropdown, a bulk action, WP-CLI and any other
		 * plugin all reach `set_status()` directly. This is that path.
		 */
		$order = ts_lc_order( $product_id );
		$order->set_status( Lifecycle::SHIPPED );
		$order->save();

		$fresh = wc_get_order( $order->get_id() );
		ts_eq( $fresh->get_status(), Lifecycle::PAID, 'un statut illégal a été enregistré' );

		$notes = wc_get_order_notes( array( 'order_id' => $order->get_id() ) );
		$said  = false;
		foreach ( $notes as $note ) {
			if ( false !== strpos( $note->content, 'refusé' ) ) {
				$said = true;
			}
		}
		ts_assert( $said, 'le refus n’est écrit nulle part sur la commande' );
		$order->delete( true );
	} );

	ts_it( 'refuses « Terminée » on a paid order nobody has approved', function () use ( $product_id ) {
		/*
		 * THE REALISTIC ACCIDENT, and the case that proves the EDGE check
		 * rather than the blocker check. One click of WooCommerce's own
		 * « Marquer terminée » on a paid order: the money is all in, so the
		 * settlement gate has nothing to say, and only the machine's own shape
		 * stops an unprinted order being declared delivered and the customer
		 * getting WooCommerce's "your order is complete" e-mail.
		 *
		 * Written after breaking the edge check on purpose left every other
		 * case green: they were all blocked by the money or by the proof, and
		 * none of them was actually asking whether the transition existed.
		 */
		$order = ts_lc_order( $product_id );
		ts_eq( Lifecycle::blockers( $order, Lifecycle::DELIVERED ), array(), 'ce cas doit être libre de tout blocage d’argent' );

		$order->set_status( Lifecycle::DELIVERED );
		$order->save();
		ts_eq( wc_get_order( $order->get_id() )->get_status(), Lifecycle::PAID, 'une commande payée a été déclarée livrée' );
		$order->delete( true );
	} );

	ts_it( 'sends no second « commande terminée » when it puts a delivered order back', function () use ( $product_id ) {
		/*
		 * THE ONE PLACE THE REVERT COULD MISFIRE. Putting the status back makes
		 * WooCommerce's pending transition from-equals-to, and of its own e-mail
		 * triggers only two are plain single-status hooks: `completed` and
		 * `failed`. So a refused move OUT of `completed` would re-fire the
		 * customer's "your order is complete" message. `silence_woo_email` turns
		 * that one off for the length of the revert, through WooCommerce's own
		 * public filter.
		 */
		$order  = ts_lc_order( $product_id );
		$issued = Bat::issue( $order );
		ts_lc_approve( $order, 1, (string) $issued['token'] );
		$order = wc_get_order( $order->get_id() );
		foreach ( array( Lifecycle::PRODUCTION, Lifecycle::PRINTED, Lifecycle::SHIPPED, Lifecycle::DELIVERED ) as $step ) {
			Lifecycle::transition( wc_get_order( $order->get_id() ), $step );
		}

		/*
		 * COUNTED AT THE WIRE, not at the action. WooCommerce fires
		 * `..._completed_notification` and the e-mail class decides inside its
		 * own `trigger()` whether to send, so counting the action measures
		 * whether the hook ran and not whether a customer received anything.
		 * The first version of this case did exactly that and reported a
		 * failure that was not one.
		 */
		$sent = array();
		$spy  = function ( $pre, $args ) use ( &$sent ) {
			$sent[] = isset( $args['to'] ) ? (string) $args['to'] : '';
			return true;
		};
		add_filter( 'pre_wp_mail', $spy, 1, 2 );

		$order = wc_get_order( $order->get_id() );
		$order->set_status( Lifecycle::PROOF );
		$order->save();

		remove_filter( 'pre_wp_mail', $spy, 1 );
		ts_eq( wc_get_order( $order->get_id() )->get_status(), Lifecycle::DELIVERED, 'le retour arrière n’a pas tenu' );
		ts_eq( $sent, array(), 'un message est parti pendant le retour arrière' );
		$order->delete( true );
	} );

	ts_it( 'lets WooCommerce do its own job through the same guard', function () use ( $product_id ) {
		// A guard that refused a gateway moving an order, a refund or a
		// cancellation would break the shop rather than protect it.
		$order = ts_lc_order( $product_id );
		$order->update_status( Lifecycle::CANCELLED );
		ts_eq( wc_get_order( $order->get_id() )->get_status(), Lifecycle::CANCELLED, 'annulation refusée' );
		ts_eq(
			(string) wc_get_order( $order->get_id() )->get_meta( Lifecycle::META_CANCEL_STAGE, true ),
			Lifecycle::PAID,
			'l’étape d’annulation n’est pas retenue'
		);
		$order->delete( true );
	} );

	ts_it( 'writes who and when for every transition, ours and WooCommerce’s', function () use ( $product_id ) {
		$order = ts_lc_order( $product_id );
		Lifecycle::transition( $order, Lifecycle::WAIT, array( 'reason' => 'fichier illisible' ) );
		$order = wc_get_order( $order->get_id() );
		$order->update_status( Lifecycle::CANCELLED );

		$journal = Lifecycle::journal( wc_get_order( $order->get_id() ) );
		ts_assert( count( $journal ) >= 2, 'le journal ne retient pas les deux passages' );
		$last = $journal[ count( $journal ) - 1 ];
		ts_eq( $last['to'], Lifecycle::CANCELLED, 'dernière cible' );
		ts_assert( isset( $last['at'], $last['by'], $last['by_name'] ), 'qui et quand manquent' );
		$order->delete( true );
	} );

	// ── the proof ────────────────────────────────────────────────────────────

	ts_it( 'composes a proof from the order, with the placement the studio measured', function () use ( $product_id ) {
		$order    = ts_lc_order( $product_id );
		$composed = Bat::compose( $order );
		ts_assert( $composed['ok'], 'la composition a échoué' );

		$line = $composed['doc']['lines'][0];
		ts_eq( $line['quantity'], 6, 'quantité' );
		$side = $line['sides'][0];
		ts_eq( $side['placed'], true, 'le placement n’a pas survécu jusqu’au BAT' );
		ts_eq( $side['zone_w_cm'], 30.5, 'largeur de zone' );
		ts_eq( $side['drop_cm'], 22.4, 'descente sous l’encolure' );
		ts_eq( $side['pieces'][0]['top_cm'], 5.2, 'haut du premier visuel' );

		/*
		 * THE GRADING SENTENCE IS CONDITIONAL, and this fixture declares
		 * nothing, which is a design document written before the flag existed.
		 * Saying nothing is the third answer: guessing which of the two is
		 * commoner would put a promise on the proof that half the customers
		 * would not get.
		 */
		ts_eq( $side['graded'], null, 'une grille absente doit rester absente' );
		ts_eq( count( $composed['doc']['tolerances'] ), 3, 'aucune phrase sur la mise à l’échelle' );

		$mots = implode( ' ', $composed['doc']['tolerances'] );
		ts_assert( false !== strpos( $mots, 'Sur la taille indiquée' ), 'la tolérance ne dit pas à quelle taille elle s’applique' );
		$order->delete( true );
	} );

	ts_it( 'says the right thing about grading, and nothing when nothing says', function () use ( $product_id ) {
		// `scaled` grows the marking with the garment; `fixed` presses one
		// identical transfer on every size, which is the cheaper convention.
		// Telling a `fixed` customer their marking scales promises something
		// that will not be pressed.
		$config = Bat::config();
		ts_assert( false !== strpos( implode( ' ', Bat::tolerances( $config, true ) ), 'mises à l’échelle' ), 'scaled' );
		ts_assert( false !== strpos( implode( ' ', Bat::tolerances( $config, false ) ), 'toutes les tailles commandées' ), 'fixed' );
		ts_eq( count( Bat::tolerances( $config, null ) ), 3, 'inconnu' );
	} );

	ts_it( 'freezes a version, mints a link, and moves the order to « BAT envoyé »', function () use ( $product_id ) {
		$order  = ts_lc_order( $product_id );
		$issued = Bat::issue( $order, 'Le logo est recadré au plus près de l’encre.' );
		ts_assert( $issued['ok'], 'l’émission a échoué' );
		ts_eq( $issued['version']['version'], 1, 'première version' );
		ts_assert( strlen( (string) $issued['token'] ) >= 40, 'jeton trop court' );
		ts_eq( wc_get_order( $order->get_id() )->get_status(), Lifecycle::PROOF, 'statut après émission' );

		// The digest and never the token itself: a database dump must not be a
		// set of live approvals.
		$stored = Bat::current( wc_get_order( $order->get_id() ) );
		ts_eq( count( $stored['tokens'] ), 1, 'une seule empreinte à l’émission' );
		ts_assert( $stored['tokens'][0] !== $issued['token'], 'le jeton est stocké en clair' );
		ts_eq( $stored['tokens'][0], hash( 'sha256', (string) $issued['token'] ), 'ce n’est pas l’empreinte du jeton' );
		$order->delete( true );
	} );

	ts_it( 'opens on the right token and 404s on a wrong one', function () use ( $product_id ) {
		$order  = ts_lc_order( $product_id );
		$issued = Bat::issue( $order );

		$found = Bat::locate( $order->get_id(), 1, (string) $issued['token'] );
		ts_eq( $found['state'], 'ok', 'le bon jeton n’ouvre pas' );

		$wrong = Bat::locate( $order->get_id(), 1, str_repeat( 'z', 43 ) );
		ts_eq( $wrong['state'], 'not_found', 'un jeton faux ouvre' );
		ts_assert( null === $wrong['order'], 'un jeton faux révèle la commande' );
		$order->delete( true );
	} );

	ts_it( 'records the approval against the version, with the words that were shown', function () use ( $product_id ) {
		$order  = ts_lc_order( $product_id );
		$issued = Bat::issue( $order );
		ts_lc_approve( $order, 1, (string) $issued['token'] );

		$order   = wc_get_order( $order->get_id() );
		$current = Bat::current( $order );
		ts_assert( ! empty( $current['approval'] ), 'aucune validation enregistrée' );
		ts_eq( $current['approval']['by'], 'client', 'qui a validé' );
		ts_assert( '' !== (string) $current['approval']['at'], 'aucune date' );
		ts_eq( $current['approval']['text'], $current['text'], 'le texte accepté n’est pas celui qui était affiché' );
		ts_assert( Bat::approved( $order ), 'la production reste bloquée après validation' );
		$order->delete( true );
	} );

	ts_it( 'stops an approval of version 1 from authorising version 2', function () use ( $product_id ) {
		/*
		 * THE WHOLE POINT OF VERSIONING. A proof approved for version 3 must not
		 * authorise printing version 4, and the status is not what decides:
		 * `Bat::refusal()` reads the approval on the CURRENT version.
		 */
		$order  = ts_lc_order( $product_id );
		$first  = Bat::issue( $order );
		ts_lc_approve( $order, 1, (string) $first['token'] );
		$order = wc_get_order( $order->get_id() );
		ts_assert( Bat::approved( $order ), 'la version 1 devrait être validée' );

		Bat::issue( $order, 'Nouvelle version après échange téléphonique.' );
		$order = wc_get_order( $order->get_id() );
		ts_assert( ! Bat::approved( $order ), 'la version 2 hérite de la validation de la 1' );
		ts_assert( ! empty( Lifecycle::blockers( $order, Lifecycle::PRODUCTION ) ), 'la production reste ouverte' );

		// And the old link is dead, because it names a version that is no longer
		// the current one.
		ts_eq( Bat::locate( $order->get_id(), 1, (string) $first['token'] )['state'], 'decided', 'l’ancien lien reste actif' );
		$order->delete( true );
	} );

	ts_it( 'keeps the customer’s words when they ask for changes', function () use ( $product_id ) {
		$order  = ts_lc_order( $product_id );
		$issued = Bat::issue( $order );
		$words  = 'Sur le dos, le logo est trop bas de 3 cm et le texte doit être en majuscules.';
		ts_lc_refuse( $order, 1, (string) $issued['token'], $words );

		$order   = wc_get_order( $order->get_id() );
		$current = Bat::current( $order );
		ts_eq( count( $current['changes'] ), 1, 'aucune demande enregistrée' );
		ts_eq( $current['changes'][0]['comment'], $words, 'le commentaire du client est perdu' );
		ts_eq( $order->get_status(), Lifecycle::CHANGES, 'statut après refus' );
		ts_eq( Bat::corrections( $order )['used'], 1, 'le cycle n’est pas compté' );
		$order->delete( true );
	} );

	ts_it( 'refuses a waiver with no words in it', function () use ( $product_id ) {
		// « Sauf accord écrit du client » with nothing written is not a written
		// agreement, and this is the only gate between a paid order and a press.
		$order = ts_lc_order( $product_id );
		Bat::issue( $order );
		$order = wc_get_order( $order->get_id() );

		$empty = Bat::record_waiver( $order, '   ' );
		ts_eq( $empty['ok'], false, 'une renonciation vide a été acceptée' );
		ts_assert( ! Bat::approved( wc_get_order( $order->get_id() ) ), 'la production a été ouverte' );

		$real = Bat::record_waiver( wc_get_order( $order->get_id() ), 'Courriel du 12/09 : « lancez sans BAT, je prends le risque. »' );
		ts_eq( $real['ok'], true, 'une renonciation réelle a été refusée' );
		ts_assert( Bat::approved( wc_get_order( $order->get_id() ) ), 'la renonciation n’autorise rien' );
		$order->delete( true );
	} );

	ts_it( 'walks a whole order from payment to delivery, and only in that order', function () use ( $product_id ) {
		$order  = ts_lc_order( $product_id );
		$issued = Bat::issue( $order );
		ts_lc_approve( $order, 1, (string) $issued['token'] );
		$order = wc_get_order( $order->get_id() );

		foreach ( array( Lifecycle::PRODUCTION, Lifecycle::PRINTED, Lifecycle::SHIPPED, Lifecycle::DELIVERED ) as $step ) {
			$moved = Lifecycle::transition( $order, $step );
			ts_assert( $moved['ok'], "passage refusé vers {$step} : " . $moved['reason'] );
			$order = wc_get_order( $order->get_id() );
			ts_eq( $order->get_status(), $step, "statut après {$step}" );
		}

		$journal = Lifecycle::journal( $order );
		$path    = array_column( $journal, 'to' );
		ts_assert( in_array( Lifecycle::SHIPPED, $path, true ), 'le journal a perdu l’expédition' );
		$order->delete( true );
	} );

	ts_it( 'never lets the parcel leave while the balance is outstanding', function () use ( $product_id ) {
		/*
		 * The money gate and the proof gate are two different questions and both
		 * are asked. This drives the money one by taking the receipts off an
		 * order that has passed the proof.
		 */
		$order  = ts_lc_order( $product_id );
		$issued = Bat::issue( $order );
		ts_lc_approve( $order, 1, (string) $issued['token'] );
		$order = wc_get_order( $order->get_id() );
		Lifecycle::transition( $order, Lifecycle::PRODUCTION );
		$order = wc_get_order( $order->get_id() );
		Lifecycle::transition( $order, Lifecycle::PRINTED );

		$order = wc_get_order( $order->get_id() );
		$order->update_meta_data( '_teeshoop_encaissements', wp_json_encode( array() ) );
		$order->save();

		$blockers = Lifecycle::blockers( wc_get_order( $order->get_id() ), Lifecycle::SHIPPED );
		ts_assert( ! empty( $blockers ), 'un colis peut partir sans le solde' );
		ts_assert( false !== strpos( implode( ' ', $blockers ), 'solde' ), 'le blocage ne nomme pas le solde' );
		$order->delete( true );
	} );

	// ── the outbox ───────────────────────────────────────────────────────────

	ts_it( 'refuses to send anything from production with no API key', function () use ( $product_id ) {
		/*
		 * AN UNSET SECRET DENIES EVERYTHING. Run before the key is defined,
		 * because a constant cannot be undefined again and this is the answer
		 * that matters most: a production shop with no key must not quietly
		 * fall back to a shared-hosting sendmail whose proof e-mails land in
		 * spam while the operator reads a green outbox.
		 */
		ts_assert( '' === Mail::api_key(), 'ce cas doit tourner avant que la clé existe' );
		$order = ts_lc_order( $product_id );
		$sent  = Mail::send(
			array(
				'kind'     => Notify::KIND_CONFIRM,
				'order_id' => $order->get_id(),
				'to'       => 'client@example.test',
				'subject'  => 'essai',
				'html'     => '<p>essai</p>',
				'text'     => 'essai',
			),
			'production'
		);
		ts_eq( $sent['ok'], false, 'un envoi est parti sans clé, en production' );
		ts_assert( false !== strpos( $sent['reason'], 'TEESHOOP_BREVO_KEY' ), 'le refus ne nomme pas la constante manquante' );
		$order->delete( true );
	} );

	ts_it( 'falls back to wp_mail off production, and records that it did', function () use ( $product_id ) {
		// So nobody reads a green outbox on a machine that never had a key and
		// concludes the shop can send.
		$order = ts_lc_order( $product_id );
		$sent  = Mail::send(
			array(
				'kind'     => Notify::KIND_CONFIRM,
				'order_id' => $order->get_id(),
				'to'       => 'client@example.test',
				'subject'  => 'essai',
				'html'     => '<p>essai</p>',
				'text'     => 'essai',
			),
			'local'
		);
		ts_assert( $sent['ok'], 'le repli de développement a échoué' );
		$rows = Mail::for_order( $order->get_id() );
		ts_eq( $rows[ count( $rows ) - 1 ]->transport, 'wp_mail', 'le transport n’est pas dit' );
		$order->delete( true );
	} );

	/*
	 * FROM HERE ON THERE IS A KEY. `Mail::api_key()` reads a wp-config constant,
	 * which is how the real secret is held (never an option: those are dumped by
	 * every backup and editable from the admin). A constant cannot be undefined,
	 * so the two cases above had to come first.
	 */
	if ( ! defined( 'TEESHOOP_BREVO_KEY' ) ) {
		define( 'TEESHOOP_BREVO_KEY', 'xkeysib-suite-de-verification' );
	}

	ts_it( 'sends the proof through Brevo and records the message', function () use ( $product_id ) {
		ts_lc_capture_http();
		$order  = ts_lc_order( $product_id );
		$issued = Bat::issue( $order );
		$sent   = Notify::bat( $order, $issued['version'], (string) $issued['token'] );

		ts_assert( $sent['ok'], 'l’envoi a échoué : ' . $sent['reason'] );
		$calls = ts_lc_brevo_calls();
		ts_assert( ! empty( $calls ), 'aucun appel à Brevo' );
		$last = $calls[ count( $calls ) - 1 ];
		ts_eq( $last['method'], 'POST', 'méthode' );
		ts_eq( $last['header']['api-key'], 'xkeysib-suite-de-verification', 'la clé ne part pas dans l’en-tête' );
		ts_eq( $last['body']['sender']['email'], 'atelier@teeshoop.test', 'expéditeur' );
		ts_eq( $last['body']['to'][0]['email'], 'client@example.test', 'destinataire' );
		ts_assert( false !== strpos( $last['body']['subject'], 'bon à tirer' ), 'objet' );
		ts_assert( '' !== (string) $last['body']['textContent'], 'aucune partie texte' );

		// The link is in both parts, and it is the real one.
		$url = Bat::url( $order, 1, (string) $issued['token'] );
		ts_assert( false !== strpos( $last['body']['htmlContent'], esc_url( $url ) ), 'le lien manque à la version HTML' );
		ts_assert( false !== strpos( $last['body']['textContent'], $url ), 'le lien manque à la version texte' );

		$rows = Mail::for_order( $order->get_id() );
		$bat  = array_values( array_filter( $rows, static fn( $row ): bool => Notify::KIND_BAT === $row->kind ) );
		ts_eq( count( $bat ), 1, 'une ligne d’envoi et une seule' );
		ts_eq( $bat[0]->status, Mail::SENT, 'statut de l’envoi' );
		ts_eq( $bat[0]->message_id, '<abc@brevo>', 'identifiant Brevo' );

		remove_all_filters( 'pre_http_request' );
		$order->delete( true );
	} );

	ts_it( 'records a Brevo refusal with its code, instead of losing it', function () use ( $product_id ) {
		ts_lc_capture_http( 400, array( 'message' => 'sender not verified' ) );
		$order  = ts_lc_order( $product_id );
		$issued = Bat::issue( $order );
		$sent   = Notify::bat( $order, $issued['version'], (string) $issued['token'] );

		ts_eq( $sent['ok'], false, 'un refus a été lu comme un envoi' );
		ts_assert( false !== strpos( $sent['reason'], '400' ), 'le code HTTP n’est pas repris' );
		ts_assert( false !== strpos( $sent['reason'], 'sender not verified' ), 'le message de Brevo n’est pas repris' );

		$rows = Mail::for_order( $order->get_id() );
		$bat  = array_values( array_filter( $rows, static fn( $row ): bool => Notify::KIND_BAT === $row->kind ) );
		ts_eq( $bat[0]->status, Mail::FAILED, 'l’échec n’est pas enregistré' );
		ts_assert( Mail::stuck() > 0, 'l’échec ne remonte pas dans le compteur' );

		remove_all_filters( 'pre_http_request' );
		$order->delete( true );
	} );

	ts_it( 'retries a failed proof with a new link, and never twice a sent one', function () use ( $product_id ) {
		ts_lc_capture_http( 502, array( 'message' => 'oops' ) );
		$order  = ts_lc_order( $product_id );
		$issued = Bat::issue( $order );
		$sent   = Notify::bat( $order, $issued['version'], (string) $issued['token'] );
		ts_eq( $sent['ok'], false, 'le 502 devrait échouer' );

		ts_lc_capture_http( 201 );
		$again = Mail::retry( (int) $sent['id'] );
		ts_assert( $again['ok'], 'le renvoi a échoué : ' . $again['reason'] );

		/*
		 * The retry re-rendered and minted a second link. The FIRST one still
		 * works, and that is the correction: Brevo can accept a message and
		 * still have our read time out, so a row marked failed does not mean
		 * nobody received it. Its own case is « keeps the link a customer is
		 * already holding » below.
		 */
		$order = wc_get_order( $order->get_id() );
		ts_eq( Bat::locate( $order->get_id(), 1, (string) $issued['token'] )['state'], 'ok', 'le renvoi a tué le lien déjà envoyé' );

		$rows = Mail::for_order( $order->get_id() );
		$bat  = array_values( array_filter( $rows, static fn( $row ): bool => Notify::KIND_BAT === $row->kind ) );
		ts_eq( count( $bat ), 1, 'un renvoi a créé une deuxième ligne' );
		ts_eq( $bat[0]->status, Mail::SENT, 'statut après renvoi' );

		// A row already sent is never sent again, whatever asks.
		$before = count( ts_lc_brevo_calls() );
		Mail::retry( (int) $sent['id'] );
		ts_eq( count( ts_lc_brevo_calls() ), $before, 'un message déjà parti a été renvoyé' );

		remove_all_filters( 'pre_http_request' );
		$order->delete( true );
	} );

	ts_it( 'tells the workshop as well as the customer', function () use ( $product_id ) {
		ts_lc_capture_http();
		$order  = ts_lc_order( $product_id );
		$issued = Bat::issue( $order );
		ts_lc_approve( $order, 1, (string) $issued['token'] );

		$kinds = array_column( Mail::for_order( $order->get_id() ), 'kind' );
		ts_assert( in_array( Notify::KIND_RECEIPT, $kinds, true ), 'aucun accusé au client' );
		ts_assert( in_array( Notify::KIND_WORKSHOP, $kinds, true ), 'aucune alerte à l’atelier' );

		remove_all_filters( 'pre_http_request' );
		$order->delete( true );
	} );

	ts_it( 'keeps the link a customer is already holding when a failed send is retried', function () use ( $product_id ) {
		/*
		 * BREVO CAN ACCEPT A MESSAGE AND STILL TIME OUT ON OUR SIDE. The row is
		 * then FAILED while the customer has the e-mail, and the hourly retry
		 * used to mint a token and drop the old digest, so the link they were
		 * holding stopped working. A version keeps its last few digests now, and
		 * they all die together when a newer version exists, which is the
		 * property that actually matters.
		 */
		$order  = ts_lc_order( $product_id );
		$first  = Bat::issue( $order );
		$order  = wc_get_order( $order->get_id() );
		$second = Bat::resend( $order );
		ts_assert( $second['ok'], 'le renvoi a échoué : ' . ( $second['reason'] ?? '' ) );

		ts_eq( Bat::locate( $order->get_id(), 1, (string) $second['token'] )['state'], 'ok', 'le nouveau lien n’ouvre pas' );
		ts_eq( Bat::locate( $order->get_id(), 1, (string) $first['token'] )['state'], 'ok', 'l’ancien lien a été tué par le renvoi' );

		// And both die together when a newer version exists.
		Bat::issue( wc_get_order( $order->get_id() ), 'version 2' );
		ts_eq( Bat::locate( $order->get_id(), 1, (string) $first['token'] )['state'], 'superseded', 'l’ancien lien survit à la version suivante' );
		ts_eq( Bat::locate( $order->get_id(), 1, (string) $second['token'] )['state'], 'superseded', 'le nouveau lien survit à la version suivante' );
		$order->delete( true );
	} );

	ts_it( 'never re-sends a BAT that has been answered, whichever way', function () use ( $product_id ) {
		// A retry of a failed e-mail would otherwise mail a customer a live link
		// inviting them to approve something the workshop is already pressing.
		foreach ( array( 'valider', 'modifier', 'renonciation' ) as $answer ) {
			$order  = ts_lc_order( $product_id );
			$issued = Bat::issue( $order );
			$order  = wc_get_order( $order->get_id() );

			if ( 'renonciation' === $answer ) {
				Bat::record_waiver( $order, 'Courriel du 12/09 : « lancez sans BAT, je prends le risque. »' );
			} else {
				Bat::record_decision( $order, 1, $answer, 'trop bas', '203.0.113.7', 'suite' );
			}

			$again = Bat::resend( wc_get_order( $order->get_id() ) );
			ts_eq( $again['ok'], false, "un BAT « {$answer} » a été renvoyé" );
			$order->delete( true );
		}
	} );

	ts_it( 'answers a double click once, and never counts two corrections for one', function () use ( $product_id ) {
		$order  = ts_lc_order( $product_id );
		$issued = Bat::issue( $order );
		$order  = wc_get_order( $order->get_id() );

		$first  = Bat::record_decision( $order, 1, 'modifier', 'le logo est trop bas', '203.0.113.7', 'suite' );
		$second = Bat::record_decision( wc_get_order( $order->get_id() ), 1, 'modifier', 'le logo est trop bas', '203.0.113.7', 'suite' );
		ts_assert( $first['ok'], 'le premier clic a été refusé' );
		ts_eq( $second['ok'], false, 'le deuxième clic a compté' );
		ts_eq( Bat::corrections( wc_get_order( $order->get_id() ) )['used'], 1, 'un aller-retour compté deux fois' );
		$order->delete( true );
	} );

	ts_it( 'sends no second « en route » when a shipped order’s status change is refused', function () use ( $product_id ) {
		/*
		 * OUR OWN HALF OF THE SAME TRAP. Reverting makes WooCommerce's pending
		 * transition from-equals-to and fires `woocommerce_order_status_ts-expedie`,
		 * which is OUR hook: the dispatch e-mail went out a second time.
		 * `silence_woo_email` covers WooCommerce's two and could never have
		 * covered this one.
		 */
		$order  = ts_lc_order( $product_id );
		$issued = Bat::issue( $order );
		ts_lc_approve( $order, 1, (string) $issued['token'] );
		foreach ( array( Lifecycle::PRODUCTION, Lifecycle::PRINTED, Lifecycle::SHIPPED ) as $step ) {
			Lifecycle::transition( wc_get_order( $order->get_id() ), $step );
		}
		$before = count( Mail::for_order( $order->get_id() ) );

		$order = wc_get_order( $order->get_id() );
		$order->set_status( Lifecycle::PROOF );
		$order->save();

		ts_eq( wc_get_order( $order->get_id() )->get_status(), Lifecycle::SHIPPED, 'le retour arrière n’a pas tenu' );
		ts_eq( count( Mail::for_order( $order->get_id() ) ), $before, 'un deuxième avis d’expédition est parti' );
		$order->delete( true );
	} );

	// ── the withdrawal right ─────────────────────────────────────────────────

	ts_it( 'asks for the acknowledgement only when something is personalised', function () use ( $product_id, $bare_id ) {
		/*
		 * A BLANK GARMENT KEEPS THE ORDINARY WITHDRAWAL RIGHT, and asking a
		 * customer to give up a right they keep is both false and, read by the
		 * DGCCRF, an unfair term. The exclusion is article L221-28 3° and it is
		 * about the GOOD, not about the shop.
		 */
		ts_ck_fill( $product_id, 6, ts_lc_sides() );
		ts_assert( Waiver::needed( WC()->cart ), 'un panier personnalisé ne demande pas la renonciation' );

		WC()->cart->empty_cart();
		WC()->cart->add_to_cart( $bare_id, 1 );
		WC()->cart->calculate_totals();
		ts_eq( Waiver::needed( WC()->cart ), false, 'un panier sans personnalisation la demande quand même' );
		WC()->cart->empty_cart();
	} );

	ts_it( 'refuses a personalised checkout with the box unticked', function () use ( $product_id ) {
		// `required` on an input is a browser hint and nothing more: a POST
		// built by hand carries no checkbox and no browser refused it.
		ts_ck_fill( $product_id, 6, ts_lc_sides() );
		unset( $_POST['teeshoop_renonciation'] );

		$errors = new \WP_Error();
		Waiver::classic_validate( array(), $errors );
		ts_assert( $errors->has_errors(), 'la case décochée passe' );
		ts_assert(
			false !== strpos( implode( ' ', $errors->get_error_messages() ), 'personnalisés' ),
			'le refus ne dit pas de quoi il parle'
		);

		$_POST['teeshoop_renonciation'] = '1';
		$fine = new \WP_Error();
		Waiver::classic_validate( array(), $fine );
		ts_eq( $fine->has_errors(), false, 'la case cochée est refusée' );
		unset( $_POST['teeshoop_renonciation'] );
		WC()->cart->empty_cart();
	} );

	ts_it( 'freezes the instant, the address and the exact words that were shown', function () use ( $product_id ) {
		$_POST['teeshoop_renonciation'] = '1';
		$_SERVER['REMOTE_ADDR']         = '198.51.100.9';
		$order                          = ts_lc_order( $product_id );
		unset( $_POST['teeshoop_renonciation'] );

		$record = Waiver::record( $order );
		ts_assert( null !== $record, 'aucune renonciation enregistrée' );
		ts_eq( $record['ip'], '198.51.100.9', 'adresse' );
		ts_eq( $record['text'], Waiver::text(), 'ce ne sont pas les mots affichés' );
		ts_assert( '' !== (string) $record['at'], 'aucune date' );
		// Empty until session 12 writes the terms, and recorded as empty rather
		// than as a plausible "v1" nobody could produce.
		ts_eq( $record['cgv'], '', 'la version des CGV est inventée' );
		$order->delete( true );
	} );

	ts_it( 'writes it once, whichever checkout fired', function () use ( $product_id ) {
		// Both `woocommerce_checkout_create_order` and the Store API path can
		// fire on one order, and two records saying different times would be
		// worse than one.
		$_POST['teeshoop_renonciation'] = '1';
		$order                          = ts_lc_order( $product_id );
		unset( $_POST['teeshoop_renonciation'] );

		$first = Waiver::record( $order );
		Waiver::freeze( $order );
		$order->save();
		ts_eq( Waiver::record( wc_get_order( $order->get_id() ) )['at'], $first['at'], 'la deuxième écriture a écrasé la première' );
		$order->delete( true );
	} );

	ts_it( 'puts it on the invoice, and admits when there is nothing to put', function () use ( $product_id ) {
		$_POST['teeshoop_renonciation'] = '1';
		$with                           = ts_lc_order( $product_id );
		unset( $_POST['teeshoop_renonciation'] );

		$line = Waiver::invoice_line( $with );
		ts_assert( false !== strpos( $line, 'L221-28' ), 'la mention ne cite pas l’article' );
		ts_assert( false !== strpos( $line, 'accepté le' ), 'la mention ne dit pas quand' );

		$doc = Invoice::stored( $with );
		ts_assert( null !== $doc, 'aucune facture émise' );
		ts_assert(
			in_array( $line, Invoice::mentions( $doc ), true ),
			'la mention n’est pas dans les mentions de la facture'
		);
		$with->delete( true );

		/*
		 * AND THE HONEST ANSWER WHEN IT IS MISSING. An order with a
		 * personalised line and no acknowledgement is one we cannot refuse a
		 * withdrawal on, and the invoice is where whoever handles it looks. It
		 * says so rather than printing a claim we cannot back.
		 */
		$without = ts_lc_order( $product_id );
		$absent  = Waiver::invoice_line( $without );
		ts_assert( false !== strpos( $absent, 'Aucune renonciation' ), 'une renonciation absente passe pour acquise' );
		$without->delete( true );
	} );

	// ── the SAV ──────────────────────────────────────────────────────────────

	ts_it( 'links a claim to the proof that was approved, and freezes it there', function () use ( $product_id ) {
		/*
		 * THE ONE THING THIS SCREEN EXISTS FOR. « Erreur validée dans le BAT » is
		 * a row of chapitre 5's matrix and it is decided by which version was
		 * approved and when. The order goes on moving after a claim is opened,
		 * so the answer is frozen onto the claim rather than looked up later.
		 */
		$order  = ts_lc_order( $product_id );
		$issued = Bat::issue( $order );
		ts_lc_approve( $order, 1, (string) $issued['token'] );
		$order = wc_get_order( $order->get_id() );

		$opened = Claim::open( $order, 'position', 'Le logo est 4 cm plus bas que sur le bon à tirer.', 3 );
		ts_assert( $opened['ok'], 'ouverture refusée : ' . ( $opened['reason'] ?? '' ) );
		ts_eq( $opened['claim']['bat']['version'], 1, 'la version approuvée n’est pas retenue' );
		ts_assert( '' !== (string) $opened['claim']['bat']['approved'], 'la date de validation n’est pas retenue' );
		ts_eq( $opened['claim']['stage'], Lifecycle::APPROVED, 'l’étape de la commande n’est pas retenue' );
		ts_eq( $opened['claim']['quantity'], 3, 'les pièces concernées' );

		// And it survives the order moving on.
		$order = wc_get_order( $order->get_id() );
		Lifecycle::transition( $order, Lifecycle::PRODUCTION );
		$again = Claim::all( wc_get_order( $order->get_id() ) );
		ts_eq( $again[0]['stage'], Lifecycle::APPROVED, 'l’étape a suivi la commande au lieu d’être gelée' );
		$order->delete( true );
	} );

	ts_it( 'refuses a claim with no motif and one with no description', function () use ( $product_id ) {
		// A dossier that cannot be counted or read six months later is not a
		// dossier, and chapitre 5 asks for a cause, a cost and a solution on
		// every one of them.
		$order = ts_lc_order( $product_id );
		ts_eq( Claim::open( $order, 'inconnu', 'Une description bien assez longue.' )['ok'], false, 'motif inconnu accepté' );
		ts_eq( Claim::open( $order, 'colis', 'court' )['ok'], false, 'description vide acceptée' );
		ts_eq( Claim::all( $order ), array(), 'un refus a quand même écrit une réclamation' );
		$order->delete( true );
	} );

	ts_it( 'never closes a claim on the matrix alone', function () use ( $product_id ) {
		// The matrix proposes; a person decides, in their own words. A dossier
		// closed by a dropdown is a decision nobody can explain later.
		$order = ts_lc_order( $product_id );
		Claim::open( $order, 'marquage', 'Le flocage se décolle après un lavage.' );
		$order = wc_get_order( $order->get_id() );

		ts_eq( Claim::close( $order, 1, 'teeshoop', '' )['ok'], false, 'une décision vide a été acceptée' );
		ts_eq( Claim::close( $order, 1, '', 'On refait la série.' )['ok'], false, 'une cause vide a été acceptée' );

		$done = Claim::close( wc_get_order( $order->get_id() ), 1, 'teeshoop', 'On refait les 12 pièces et on renvoie en express.' );
		ts_assert( $done['ok'], 'clôture refusée : ' . $done['reason'] );
		$claim = Claim::all( wc_get_order( $order->get_id() ) )[0];
		ts_eq( $claim['cause'], 'teeshoop', 'cause' );
		ts_assert( '' !== (string) $claim['closed_at'], 'la clôture n’est pas datée' );
		ts_eq( Claim::verdict( $claim['cause'] )['owed'], true, 'la matrice ne dit pas que nous payons' );
		$order->delete( true );
	} );

	// ── the devis as a document ──────────────────────────────────────────────

	ts_it( 'gives a devis a number from the ONE sequence, and freezes what it says', function () use ( $product_id ) {
		/*
		 * Chapitre 2: « chaque envoi crée une version [...] le client doit
		 * accepter la version exacte qu'il paie ». The number comes from
		 * `Invoice::next_number`, the same table and the same atomic idiom, in
		 * its own series: a second counter would be a second thing to get right,
		 * and this one has already been driven by six concurrent processes.
		 */
		$devis = ts_lc_devis( $product_id, 40, 1 );

		$first = Quote::issue( $devis );
		ts_assert( $first['ok'], 'établissement refusé : ' . ( $first['reason'] ?? '' ) );
		ts_eq( $first['version']['version'], 1, 'première version' );
		ts_assert( '' !== (string) $first['version']['number'], 'aucun numéro' );
		ts_assert( (int) $first['version']['total_ht'] > 0, 'aucun prix' );

		$second = Quote::issue( $devis );
		ts_eq( $second['version']['version'], 2, 'deuxième version' );
		ts_assert(
			$second['version']['number'] !== $first['version']['number'],
			'deux versions portent le même numéro'
		);
		ts_eq( count( Quote::versions( $devis ) ), 2, 'la chaîne garde les deux' );
		wp_delete_post( $devis, true );
	} );

	ts_it( 'says when a sent devis no longer describes what the shop would sell', function () use ( $product_id ) {
		// The chapter's own requirement is that a sent quote never changes
		// SILENTLY. Recalculating it in place would be exactly that failure, so
		// what moves is a sentence and never the stored number.
		$devis  = ts_lc_devis( $product_id, 40, 1 );
		$issued = Quote::issue( $devis );
		ts_eq( Quote::moved( $devis ), '', 'un devis tout juste établi a déjà bougé' );

		$config = get_option( 'teeshoop_pricing', array() );
		update_option( 'teeshoop_pricing', array_merge( (array) $config, array( 'garments' => array( 'tee' => array( 'base_ht' => 4000 ) ) ) ) );

		$moved = Quote::moved( $devis );
		ts_assert( '' !== $moved, 'une hausse du textile ne se voit pas' );
		ts_assert( false !== strpos( $moved, (string) $issued['version']['number'] ), 'la phrase ne nomme pas le devis' );
		ts_eq(
			(int) Quote::current( $devis )['total_ht'],
			(int) $issued['version']['total_ht'],
			'le devis envoyé a été réécrit'
		);

		update_option( 'teeshoop_pricing', $config );
		wp_delete_post( $devis, true );
	} );

	ts_it( 'costs a devis with the ONE engine, without writing an order', function () use ( $product_id ) {
		/*
		 * This is chapter 1's `POST /pricing/quotes/calculate`. `Costing::compute`
		 * takes a `WC_Order`, so the devis is handed to it as one, built in
		 * memory and never saved: `calculate_totals()` is deliberately not
		 * called, because WooCommerce's own implementation ends in `save()` and
		 * would write a phantom order for every quote anybody costed.
		 */
		$before = count( wc_get_orders( array( 'limit' => -1, 'status' => 'any', 'return' => 'ids' ) ) );

		$devis  = ts_lc_devis( $product_id, 40, 1 );
		$costed = Quote::costing( $devis );
		ts_assert( $costed['ok'], 'chiffrage refusé : ' . ( $costed['reason'] ?? '' ) );
		ts_assert( isset( $costed['report']['cost'] ), 'aucun coût dans le rapport' );
		// `plan` is where the recommended price, the floor and the negotiation
		// zone live; `verdict` is what the engine says about a proposed price.
		ts_assert( isset( $costed['report']['plan'] ), 'aucun plancher dans le rapport' );
		ts_assert( isset( $costed['report']['verdict'] ), 'aucun verdict dans le rapport' );

		$after = count( wc_get_orders( array( 'limit' => -1, 'status' => 'any', 'return' => 'ids' ) ) );
		ts_eq( $after, $before, 'chiffrer un devis a créé une commande' );
		wp_delete_post( $devis, true );
	} );

	ts_it( 'refuses to price a devis whose création cannot be confirmed', function () use ( $product_id ) {
		/*
		 * FAIL CLOSED, and it is a money gate. A design the Worker cannot
		 * confirm might carry far more ink than the standard face tier, so
		 * quoting the shorthand would put a price on a document the cart will
		 * then refuse to honour.
		 */
		$devis = ts_lc_devis( $product_id, 40, 1 );
		update_post_meta( $devis, '_ts_design_id', 'jamaisvuparleworker00' );

		/*
		 * A 404 AND NOT A TRANSPORT ERROR, and the difference is the test.
		 * `TEESHOOP_ALLOW_UNVERIFIED_DESIGNS` is on in this suite, as it is on
		 * every developer's machine, and it rescues exactly two reasons:
		 * `worker_not_configured` and `worker_unreachable`, which both mean "we
		 * could not ask". A 404 means "we asked and it is not there", which is
		 * a different answer and is never rescued. A test driving the first
		 * would have proved nothing about the second.
		 */
		$settings = get_option( 'teeshoop_settings', array() );
		update_option( 'teeshoop_settings', array_merge( (array) $settings, array( 'worker_url' => 'https://worker.invalid' ) ) );
		remove_all_filters( 'pre_http_request' );
		add_filter(
			'pre_http_request',
			static function () {
				return array(
					'headers'  => array(),
					'body'     => '{"error":"not found"}',
					'response' => array(
						'code'    => 404,
						'message' => 'Not Found',
					),
					'cookies'  => array(),
					'filename' => null,
				);
			},
			10,
			3
		);

		$priced = Quote::price( $devis );
		ts_eq( $priced['ok'], false, 'un devis a été chiffré sur une création non confirmée' );
		ts_assert( false !== strpos( (string) $priced['reason'], 'design_not_found' ), 'le refus ne dit pas laquelle des deux' );
		ts_eq( Quote::issue( $devis )['ok'], false, 'et une version a quand même été établie' );

		remove_all_filters( 'pre_http_request' );
		update_option( 'teeshoop_settings', $settings );
		wp_delete_post( $devis, true );
	} );

	// ── the archive copy ─────────────────────────────────────────────────────

	ts_it( 'renders an archive copy that names the version and its numbers', function () use ( $product_id ) {
		$order  = ts_lc_order( $product_id );
		$issued = Bat::issue( $order );
		// Without images: the mockups live on the Worker and this suite has no
		// Worker. The image path has its own cases in tests/test-pdf.php.
		$pdf = Bat::pdf( $issued['version'], false );

		ts_assert( str_starts_with( $pdf, '%PDF-1.' ), 'ce n’est pas un PDF' );
		ts_assert( str_ends_with( rtrim( $pdf ), '%%EOF' ), 'le PDF n’est pas terminé' );
		ts_assert( strlen( $pdf ) > 800, 'le PDF est vide' );
		$order->delete( true );
	} );

	update_option( 'teeshoop_settings', $saved_settings );
	remove_all_filters( 'pre_http_request' );
}

/** A devis request, as the public form would have written it. */
function ts_lc_devis( int $product_id, int $qty, int $faces ): int {
	$post_id = wp_insert_post(
		array(
			'post_type'   => Quote::POST_TYPE,
			'post_status' => 'ts-recu',
			'post_title'  => 'Demande du harnais',
		),
		true
	);
	foreach (
		array(
			'_ts_societe'    => 'Atelier Roux',
			'_ts_contact'    => 'Camille Roux',
			'_ts_email'      => 'camille@example.test',
			'_ts_product_id' => $product_id,
			'_ts_garment'    => 'tee',
			'_ts_qty'        => $qty,
			'_ts_faces'      => $faces,
			'_ts_tailles'    => wp_json_encode( array( 'M' => $qty ) ),
			'_ts_design_id'  => '',
		) as $key => $value
	) {
		update_post_meta( $post_id, $key, $value );
	}
	return (int) $post_id;
}

/** Approve, the way the customer's own POST does. */
function ts_lc_approve( \WC_Order $order, int $version, string $token ): void {
	ts_lc_decide( $order, $version, $token, 'valider', '' );
}

/** Ask for changes, the way the customer's own POST does. */
function ts_lc_refuse( \WC_Order $order, int $version, string $token, string $comment ): void {
	ts_lc_decide( $order, $version, $token, 'modifier', $comment );
}

/**
 * The customer's decision, through the shipped code.
 *
 * `Bat::decide()` reads `$_POST` and `$_SERVER` and ends in `exit`, which is
 * right for a request handler and impossible to call from a suite. So the
 * decision itself lives in `Bat::record_decision()` and this calls THAT: the
 * rules, the record, the transition and the events are the real ones. What is
 * not covered here is the routing and the headers, which a browser drives in
 * `scripts/bat-verify.mjs`.
 */
function ts_lc_decide( \WC_Order $order, int $version, string $token, string $choice, string $comment ): void {
	$found = Bat::locate( $order->get_id(), $version, $token );
	if ( 'ok' !== $found['state'] ) {
		throw new \RuntimeException( 'le BAT n’est pas décidable : ' . $found['state'] );
	}
	$done = Bat::record_decision( $found['order'], $version, $choice, $comment, '203.0.113.7', 'suite' );
	if ( empty( $done['ok'] ) ) {
		throw new \RuntimeException( (string) $done['reason'] );
	}
}
