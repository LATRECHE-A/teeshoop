<?php
/**
 * Erasure, against a real WooCommerce, following the data.
 *
 * WHY THIS CANNOT BE A PURE TEST. An erasure is a claim about four stores at
 * once: the order in WooCommerce, a second copy of the same identity inside the
 * frozen proof, the artwork on Cloudflare, and the invoice the code de commerce
 * says we keep. Every one of those is a seam, and this repository's history is a
 * list of correct code failing at a seam: a copied `did_action` guard that ate
 * every recalculation, a harness that printed nine green ticks under "0 passed".
 * A pure test of `Privacy::erase_order()` would prove that the function calls the
 * setters it calls.
 *
 * THE WORKER IS ANSWERED THROUGH `pre_http_request`, which is the same seam
 * `integration-lifecycle.php` uses for Brevo and for the same reason: the real
 * `wp_remote_request` runs, the real headers and the real method are built by the
 * real code, and only the wire is replaced. A test that called a mock client
 * would prove that the mock works.
 *
 * THE CASE THAT MATTERS MOST IS THE ONE WHERE R2 SAYS NO. An erasure that
 * reports success while the customer's artwork is still on somebody else's disk
 * is the failure the whole session exists to avoid, and it is invisible from
 * inside PHP unless something asserts it.
 *
 * @package Teeshoop\Core
 */

if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

use Teeshoop\Core\Privacy;
use Teeshoop\Core\Quote;
use Teeshoop\Core\Waiver;
use Teeshoop\Core\Terms;
use Teeshoop\Core\Legal;

/**
 * Answer the Worker's delete route, and record what was asked.
 *
 * @param int $status what the Worker answers, or 0 to make the call fail at the
 *                    transport level, which is what an unreachable Worker does.
 */
function ts_rgpd_worker( int $status = 200 ): void {
	remove_all_filters( 'pre_http_request' );
	$GLOBALS['ts_rgpd_calls'] = array();
	add_filter(
		'pre_http_request',
		function ( $pre, $args, $url ) use ( $status ) {
			/*
			 * THE DELETE CALLS ONLY. `Design::verify()` GETs the same path shape
			 * while the cart is being filled, and recording those made the first
			 * captured call a GET, which is how the first version of this test
			 * asserted the wrong thing about the right code.
			 */
			if ( false === strpos( (string) $url, '/api/design/' ) || 'DELETE' !== ( $args['method'] ?? 'GET' ) ) {
				return $pre;
			}
			$GLOBALS['ts_rgpd_calls'][] = array(
				'url'    => (string) $url,
				'method' => (string) ( $args['method'] ?? 'GET' ),
				'auth'   => (string) ( $args['headers']['authorization'] ?? '' ),
			);
			if ( 0 === $status ) {
				return new \WP_Error( 'http_request_failed', 'injoignable' );
			}
			return array(
				'headers'  => array(),
				'body'     => wp_json_encode(
					array(
						'id'      => 'stub',
						'deleted' => 3,
						'keys'    => array(),
					)
				),
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
}

function ts_rgpd_calls(): array {
	return (array) ( $GLOBALS['ts_rgpd_calls'] ?? array() );
}

/**
 * A paid order carrying everything an erasure has to reach.
 *
 * Built through the real checkout, like every other order in this suite, so the
 * meta it carries is the meta a real order carries.
 */
function ts_rgpd_order( int $product_id, string $email ): \WC_Order {
	ts_ck_fill( $product_id, 6, ts_lc_sides() );
	$order = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) ) );
	$order->set_billing_email( $email );
	$order->set_billing_first_name( 'Camille' );
	$order->set_billing_last_name( 'Roux' );
	$order->set_billing_company( 'Atelier Roux' );
	$order->set_billing_address_1( '12 rue des Lilas' );
	$order->set_billing_postcode( '93000' );
	$order->set_billing_city( 'Bobigny' );
	$order->set_billing_phone( '0102030405' );
	$order->set_customer_ip_address( '198.51.100.9' );
	$order->update_meta_data( '_billing_siret', '12345678900011' );
	$order->save();
	$order->payment_complete( 'ts-rgpd-' . $order->get_id() );
	return wc_get_order( $order->get_id() );
}

function ts_rgpd_suite( int $product_id ): void {
	$saved_settings = get_option( 'teeshoop_settings', array() );

	ts_it(
		'the register describes every store, and names a mechanism or says there is none',
		function () {
			$rows = Privacy::register();
			ts_assert( count( $rows ) >= 8, 'le registre des traitements est trop court pour cette boutique' );
			foreach ( $rows as $row ) {
				foreach ( array( 'cle', 'nom', 'finalite', 'base', 'personnes', 'donnees', 'destinataires', 'duree', 'mecanisme' ) as $key ) {
					ts_assert( ! empty( $row[ $key ] ), 'traitement « ' . $row['cle'] . ' » : ' . $key . ' manquant' );
				}
				foreach ( (array) $row['destinataires'] as $who ) {
					ts_assert(
						isset( Privacy::processors()[ $who ] ),
						'traitement « ' . $row['cle'] . ' » : destinataire « ' . $who . ' » absent du registre des sous-traitants'
					);
				}
			}
		}
	);

	ts_it(
		'the terms in force can be produced, which is what the waiver record points at',
		function () {
			$version = Legal::cgv_version();
			ts_assert( '' !== $version, 'aucune version des CGV en vigueur' );
			ts_assert( null !== Terms::document( $version ), 'la version enregistrée sur les commandes ne se charge pas' );
			$bad = Terms::checked( Terms::document( $version ), Terms::live_values() );
			ts_eq( $bad, array(), 'les CGV publiées ne disent plus ce que la boutique applique' );
		}
	);

	ts_it(
		'refuses to erase anything when the artwork cannot be removed',
		function () use ( $product_id ) {
			ts_rgpd_worker( 0 );
			update_option(
				'teeshoop_settings',
				array_merge( (array) get_option( 'teeshoop_settings', array() ), array( 'worker_url' => 'https://worker.test' ) )
			);
			if ( ! defined( 'TEESHOOP_WORKER_TOKEN' ) ) {
				define( 'TEESHOOP_WORKER_TOKEN', 'jeton-de-test' );
			}

			$order = ts_rgpd_order( $product_id, 'refus@example.test' );
			$ids   = Privacy::design_ids_of_order( $order );
			ts_assert( count( $ids ) > 0, 'la commande de test ne porte aucune création, le cas ne prouve rien' );

			$result = Privacy::erase_order( $order );

			ts_assert( false === $result['removed'], 'un effacement a été annoncé alors que la création est toujours en ligne' );
			ts_assert( count( $result['messages'] ) > 0, 'aucun message n’explique pourquoi la demande reste ouverte' );

			$fresh = wc_get_order( $order->get_id() );
			ts_eq( $fresh->get_billing_last_name(), 'Roux', 'la commande a été vidée alors que la création n’a pas pu l’être' );
			ts_eq(
				count( Privacy::design_ids_of_order( $fresh ) ),
				count( $ids ),
				'l’index des créations a été effacé, donc plus personne ne peut finir le travail'
			);

			$calls = ts_rgpd_calls();
			ts_assert( count( $calls ) > 0, 'le service n’a même pas été appelé' );
			ts_eq( $calls[0]['method'], 'DELETE', 'la méthode employée' );
			ts_assert( str_starts_with( $calls[0]['auth'], 'Bearer ' ), 'l’appel de suppression n’était pas authentifié' );
		}
	);

	ts_it(
		'erases the order and keeps the invoice when the artwork is really gone',
		function () use ( $product_id ) {
			ts_rgpd_worker( 200 );
			$order = ts_rgpd_order( $product_id, 'efface@example.test' );

			// A withdrawal waiver, as the checkout would have written it.
			$_POST[ 'teeshoop_renonciation' ] = '1';
			Waiver::freeze( $order );
			$order->save();

			// DON-11 : la référence de paiement survit, pour qu'un remboursement dû passe par la passerelle.
			$order->set_transaction_id( 'pi_verification_harnais' );
			$order->save();

			// The proof, issued by the real code, so the blob this test scrubs is
			// the blob a real order carries.
			\Teeshoop\Core\Bat::issue( $order );

			$invoice = \Teeshoop\Core\Invoice::issue( wc_get_order( $order->get_id() ) );
			ts_assert(
				! is_wp_error( $invoice ),
				'la facture de test n’a pas pu être émise : ' . ( is_wp_error( $invoice ) ? $invoice->get_error_code() . ' ' . $invoice->get_error_message() : '' )
			);

			$fresh  = wc_get_order( $order->get_id() );
			$result = Privacy::erase_order( $fresh );

			ts_assert( true === $result['removed'], 'rien n’a été effacé' );
			ts_assert( true === $result['retained'], 'la conservation de la facture n’a pas été annoncée' );

			$after = wc_get_order( $order->get_id() );

			ts_eq( $after->get_billing_last_name(), '', 'le nom est resté sur la commande' );
			ts_eq( $after->get_billing_email(), '', 'l’adresse est restée sur la commande' );
			ts_eq( $after->get_billing_address_1(), '', 'l’adresse postale est restée' );
			ts_eq( $after->get_customer_ip_address(), '', 'l’adresse IP est restée' );
			ts_eq( $after->get_transaction_id(), 'pi_verification_harnais', 'la référence de paiement a été effacée : plus de remboursement par la passerelle' );
			ts_eq( (string) $after->get_meta( '_billing_siret', true ), '', 'le SIRET est resté' );
			ts_eq( count( Privacy::design_ids_of_order( $after ) ), 0, 'la commande pointe encore vers une création' );

			/*
			 * THE SECOND COPY, which is the one an obvious implementation
			 * forgets. The proof holds the customer's name, company and e-mail
			 * inside one JSON blob that no WooCommerce property and no
			 * WooCommerce meta list mentions.
			 */
			$bat = (string) $after->get_meta( '_teeshoop_bat', true );
			ts_assert( '' !== $bat, 'la commande de test ne porte pas de bon à tirer, le cas ne prouve rien' );
			ts_assert( false === strpos( $bat, 'Roux' ), 'le nom du client est resté dans le bon à tirer' );
			ts_assert( false === strpos( $bat, 'efface@example.test' ), 'l’adresse du client est restée dans le bon à tirer' );

			/*
			 * THE WAIVER KEEPS WHAT IT IS FOR. Its whole purpose is to prove what
			 * the customer was told before they paid; erasing the sentence would
			 * destroy the shop's only defence against a withdrawal request while
			 * the invoice, which the same request cannot remove, still shows the
			 * sale happened.
			 */
			$waiver = Waiver::record( $after );
			ts_assert( null !== $waiver, 'la renonciation a été supprimée avec le reste' );
			ts_eq( $waiver['ip'], '', 'l’adresse IP est restée dans la renonciation' );
			ts_eq( $waiver['text'], Waiver::text(), 'la phrase acceptée a été perdue' );
			ts_eq( $waiver['cgv'], Legal::cgv_version(), 'la version des CGV acceptée a été perdue' );

			/*
			 * AND THE INVOICE SURVIVES, buyer included. A facture whose buyer is
			 * redacted is not an accounting document, and the ten years of
			 * article L123-22 apply whether or not the customer asks.
			 */
			// Stored as JSON, like every frozen document in this plugin.
			$document = (string) $after->get_meta( \Teeshoop\Core\Invoice::META_DOC, true );
			ts_assert( '' !== $document, 'la facture figée a disparu de la commande' );
			ts_assert( false !== strpos( $document, 'Roux' ), 'la facture a été caviardée, elle n’est plus une pièce comptable' );
			ts_assert( false !== strpos( $document, '12 rue des Lilas' ), 'l’adresse de facturation a disparu de la facture' );

			$said = implode( ' ', $result['messages'] );
			ts_assert( false !== strpos( $said, 'L123-22' ), 'la personne n’est pas informée de ce qui est conservé ni pourquoi' );
		}
	);

	ts_it(
		'says nothing happened when it is asked a second time',
		function () use ( $product_id ) {
			ts_rgpd_worker( 200 );
			$order = ts_rgpd_order( $product_id, 'deuxfois@example.test' );
			Privacy::erase_order( wc_get_order( $order->get_id() ) );
			$again = Privacy::erase_order( wc_get_order( $order->get_id() ) );
			ts_assert( false === $again['removed'], 'un second passage prétend avoir effacé quelque chose' );
		}
	);

	ts_it(
		'reaches an order somebody put in the bin',
		function () use ( $product_id ) {
			/*
			 * `wc_get_order_statuses()` never contains `trash`, and binning an
			 * order is one click on the orders list. An erasure that did not look
			 * there answered « les coordonnées ont été effacées » over an order it
			 * had never opened, and the same defect was fixed for quote requests
			 * in this session and not for orders.
			 *
			 * WHAT IS ASSERTED IS THAT IT WAS REACHED, and not what WooCommerce
			 * does with the address row of a trashed order: measured on this
			 * mirror, `$order->delete(false)` removes that row itself, which is
			 * WooCommerce's business and could change. The sentinel this file
			 * writes is ours.
			 */
			ts_rgpd_worker( 200 );
			$order = ts_rgpd_order( $product_id, 'corbeille@example.test' );
			$id    = $order->get_id();
			$order->delete( false );

			$r = Privacy::erase_orders( 'corbeille@example.test' );
			ts_assert( true === $r['items_removed'], 'la commande à la corbeille n’a pas été vue' );

			global $wpdb;
			$stamp = $wpdb->get_var(
				$wpdb->prepare(
					"SELECT meta_value FROM {$wpdb->prefix}wc_orders_meta WHERE order_id = %d AND meta_key = %s",
					$id,
					Privacy::META_ERASED
				)
			);
			ts_assert( '' !== (string) $stamp, 'la commande à la corbeille n’a pas été effacée' );
		}
	);

	ts_it(
		'removes the SIRET under every key the two checkouts write it to',
		function () use ( $product_id ) {
			ts_rgpd_worker( 200 );
			$order = ts_rgpd_order( $product_id, 'siret@example.test' );
			$order->update_meta_data( '_wc_billing/teeshoop/siret', '99988877700099' );
			$order->update_meta_data( '_wc_shipping/teeshoop/siret', '99988877700099' );
			$order->save();

			Privacy::erase_order( wc_get_order( $order->get_id() ) );

			$after = wc_get_order( $order->get_id() );
			foreach ( array( '_billing_siret', '_wc_billing/teeshoop/siret', '_wc_shipping/teeshoop/siret' ) as $key ) {
				ts_eq( (string) $after->get_meta( $key, true ), '', 'le SIRET est resté sous ' . $key );
			}
		}
	);

	ts_it(
		'takes the customer’s own words out of the order note as well as out of the blob',
		function () use ( $product_id ) {
			/*
			 * `Claim::open` writes the description twice: into the JSON and into
			 * an order note, verbatim. Free text on a claim is where a person
			 * writes their name, their address and their telephone number. The
			 * scrub emptied the JSON and the note kept the sentence.
			 */
			ts_rgpd_worker( 200 );
			$order = ts_rgpd_order( $product_id, 'note@example.test' );
			$mark  = 'REPERECLAMATION Camille Durand 12 avenue Jean Jaures';
			\Teeshoop\Core\Claim::open( wc_get_order( $order->get_id() ), 'position', $mark, 3 );

			$before = wc_get_order_notes( array( 'order_id' => $order->get_id() ) );
			$seen   = false;
			foreach ( $before as $note ) {
				$seen = $seen || str_contains( (string) $note->content, $mark );
			}
			ts_assert( $seen, 'la note de test n’a pas été écrite, le cas ne prouve rien' );

			Privacy::erase_order( wc_get_order( $order->get_id() ) );

			$after = wc_get_order_notes( array( 'order_id' => $order->get_id() ) );
			$left  = false;
			$kept  = false;
			foreach ( $after as $note ) {
				$left = $left || str_contains( (string) $note->content, $mark );
				$kept = $kept || str_starts_with( (string) $note->content, 'Réclamation ouverte' );
			}
			ts_assert( ! $left, 'les mots du client sont restés dans une note de commande' );
			ts_assert( $kept, 'la note a été supprimée au lieu d’être vidée, l’historique du SAV est perdu' );
		}
	);

	ts_it(
		'removes the design line meta a customer can see, whose key is accented',
		function () use ( $product_id ) {
			ts_rgpd_worker( 200 );
			$order = ts_rgpd_order( $product_id, 'accent@example.test' );

			$visible = false;
			foreach ( $order->get_items() as $item ) {
				$visible = $visible || '' !== (string) $item->get_meta( 'Création', true );
			}
			ts_assert( $visible, 'la ligne ne porte pas la clé visible, le cas ne prouve rien' );

			Privacy::erase_order( wc_get_order( $order->get_id() ) );

			foreach ( wc_get_order( $order->get_id() )->get_items() as $item ) {
				ts_eq(
					(string) $item->get_meta( 'Création', true ),
					'',
					'la création reste affichée sur la ligne, sur l’écran de commande et dans les courriels'
				);
			}
		}
	);

	ts_it(
		'drops a waiver frozen on a draft whose personalised line has since gone',
		function () use ( $product_id ) {
			/*
			 * The Store API keeps one checkout-draft order per session and reuses
			 * it: personalised line, box ticked, record frozen, payment fails, the
			 * customer replaces the item with a blank garment and pays. `freeze()`
			 * is idempotent on its sentinel, so the record survived on an order
			 * with nothing personalised in it, invisible to the invoice and
			 * reported to the customer by the article 15 export as a right they
			 * gave up.
			 */
			$order = ts_rgpd_order( $product_id, 'brouillon@example.test' );
			$_POST['teeshoop_renonciation'] = '1';
			Waiver::freeze( $order );
			$order->save();
			unset( $_POST['teeshoop_renonciation'] );
			ts_assert( null !== Waiver::record( wc_get_order( $order->get_id() ) ), 'la renonciation de test n’a pas été écrite' );

			// The personalised line goes, as a basket edit would remove it.
			$fresh = wc_get_order( $order->get_id() );
			foreach ( $fresh->get_items() as $item ) {
				$item->delete_meta_data( '_teeshoop_design_id' );
				$item->save();
			}
			$fresh = wc_get_order( $order->get_id() );
			ts_assert( ! Waiver::applies( $fresh ), 'la commande porte encore une ligne personnalisée' );

			Waiver::freeze_block( $fresh );
			$fresh->save();

			ts_eq(
				Waiver::record( wc_get_order( $order->get_id() ) ),
				null,
				'une renonciation survit sur une commande qui ne contient rien de personnalisé'
			);
		}
	);

	ts_it(
		'never issues an invoice for an order whose buyer has been erased',
		function () use ( $product_id ) {
			/*
			 * THE ORDER OF EVENTS THAT PRODUCES A FACTURE WITH NO BUYER, and it is
			 * an ordinary one. An order waits on-hold for a transfer, so it is
			 * unpaid and has no invoice, so there is nothing fiscal to weigh
			 * against an erasure. The customer asks; we empty the buyer. The
			 * transfer then arrives, an operator moves the order to processing,
			 * and the invoice hook fires on an order whose name and address are
			 * blank, consuming a number out of a sequence that cannot give it
			 * back.
			 */
			ts_rgpd_worker( 200 );

			// Built without payment_complete: this case needs an order that has
			// no invoice yet, which is what an unpaid one is.
			ts_ck_fill( $product_id, 6, ts_lc_sides() );
			$order = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) ) );
			$order->set_billing_email( 'facture-apres@example.test' );
			$order->set_billing_first_name( 'Camille' );
			$order->set_billing_last_name( 'Roux' );
			$order->set_billing_address_1( '12 rue des Lilas' );
			$order->set_status( 'on-hold' );
			$order->save();

			$fresh = wc_get_order( $order->get_id() );
			ts_assert( ! $fresh->is_paid(), 'la commande de test est déjà payée, le cas ne prouve rien' );
			ts_assert( count( Privacy::design_ids_of_order( $fresh ) ) > 0, 'la commande de test ne porte aucune création' );

			Privacy::erase_order( $fresh );

			$after = wc_get_order( $order->get_id() );
			ts_eq( $after->get_billing_last_name(), '', 'l’effacement n’a rien fait, le cas ne prouve rien' );

			/*
			 * THE PAYMENT IS WHAT MAKES IT DANGEROUS, so the payment is what is
			 * exercised. While the order is unpaid `Invoice::issue` already
			 * refuses, for its own older reason; the moment the transfer is
			 * confirmed that guard opens and `on_status` fires by itself.
			 */
			$after->payment_complete( 'ts-rgpd-apres-' . $after->get_id() );

			$paid = wc_get_order( $order->get_id() );
			ts_assert( $paid->is_paid(), 'la commande n’est pas passée au payé, le cas ne prouve rien' );
			ts_eq(
				(string) $paid->get_meta( \Teeshoop\Core\Invoice::META_NUMBER, true ),
				'',
				'le passage au paiement a numéroté une facture sans acheteur, et le numéro ne se rend pas'
			);

			$doc = \Teeshoop\Core\Invoice::issue( $paid );
			ts_assert( is_wp_error( $doc ), 'une facture a été émise pour une commande sans acheteur' );
			ts_eq( $doc->get_error_code(), 'teeshoop_order_erased', 'le refus n’est pas celui attendu' );
		}
	);

	ts_it(
		'reaches an order placed from an account whose billing address is somebody else’s',
		function () use ( $product_id ) {
			/*
			 * `wc_get_orders(['customer' => 'a@b'])` matches the BILLING e-mail
			 * alone. A customer who typed a work address at checkout, or who
			 * ordered for a colleague, has orders their own account e-mail does
			 * not find. WooCommerce's own exporter appends the user id; ours did
			 * not, so WooCommerce answered with the order and we answered with
			 * nothing about the same person.
			 */
			ts_rgpd_worker( 200 );
			$uid = wp_insert_user(
				array(
					'user_login' => 'ts-rgpd-compte',
					'user_email' => 'compte@example.test',
					'user_pass'  => wp_generate_password(),
				)
			);
			ts_assert( ! is_wp_error( $uid ), 'le compte de test n’a pas été créé' );

			$order = ts_rgpd_order( $product_id, 'facturation-autre@example.test' );
			$order->set_customer_id( (int) $uid );
			$order->save();

			$r = Privacy::erase_orders( 'compte@example.test' );
			ts_assert( true === $r['items_removed'], 'la commande du compte n’a pas été trouvée par son adresse de compte' );

			$after = wc_get_order( $order->get_id() );
			ts_eq( $after->get_billing_email(), '', 'l’adresse de facturation est restée' );
			ts_eq( (int) $after->get_customer_id(), 0, 'la commande pointe encore vers le compte' );

			wp_delete_user( (int) $uid );
		}
	);

	ts_it(
		'ends the request rather than looping when nothing can be erased',
		function () use ( $product_id ) {
			/*
			 * WordPress calls an eraser page after page until `done`, and this
			 * one re-reads page 1 every time because erasing is what advances the
			 * window. When nothing CAN be erased, the window never moves: with
			 * `count < 20` as the only test, the admin screen would go round the
			 * same orders for ever and an operator would see a request that never
			 * finishes instead of a reason.
			 */
			ts_rgpd_worker( 0 );
			ts_rgpd_order( $product_id, 'boucle@example.test' );

			$r = Privacy::erase_orders( 'boucle@example.test' );
			ts_assert( false === $r['items_removed'], 'quelque chose a été effacé alors que le service refuse' );
			ts_assert( true === $r['done'], 'la demande se rappellerait indéfiniment sur les mêmes commandes' );
			ts_assert( count( $r['messages'] ) > 0, 'la demande s’arrête sans dire pourquoi' );
		}
	);

	ts_it(
		'stops matching the address once the order is erased, which is what ends the loop',
		function () use ( $product_id ) {
			ts_rgpd_worker( 200 );
			ts_rgpd_order( $product_id, 'plusla@example.test' );

			$avant = wc_get_orders(
				array(
					'limit'    => 5,
					'customer' => 'plusla@example.test',
					'status'   => array_keys( wc_get_order_statuses() ),
				)
			);
			ts_eq( count( $avant ), 1, 'la commande de test est introuvable, le cas ne prouve rien' );

			$r = Privacy::erase_orders( 'plusla@example.test' );
			ts_assert( true === $r['items_removed'], 'rien n’a été effacé' );
			ts_assert( true === $r['done'], 'une seule commande et la demande se croit incomplète' );

			$apres = wc_get_orders(
				array(
					'limit'    => 5,
					'customer' => 'plusla@example.test',
					'status'   => array_keys( wc_get_order_statuses() ),
				)
			);
			ts_eq( count( $apres ), 0, 'la commande répond encore à son ancienne adresse' );
		}
	);

	ts_it(
		'never tells a customer their data was erased when it was not',
		function () {
			/*
			 * WHAT WORDPRESS DOES, read from core rather than assumed:
			 * `wp_privacy_process_personal_data_erasure_page` calls
			 * `_wp_privacy_completed_request()` and fires
			 * `wp_privacy_personal_data_erased` as soon as the LAST eraser
			 * reports `done`, and `_wp_privacy_send_erasure_fulfillment_notification`
			 * is hooked to that. Session 12 made an unfinished erasure report
			 * `done` to stop it looping for ever, which traded an infinite loop
			 * for a letter saying « your request has been completed » about data
			 * still on somebody's disk. This is the half that stops the letter.
			 */
			$hook  = 'wp_privacy_personal_data_erased';
			// A COPY, because `remove_action` mutates the `WP_Hook` object in place.
			$saved = isset( $GLOBALS['wp_filter'][ $hook ] ) ? clone $GLOBALS['wp_filter'][ $hook ] : null;

			ts_assert(
				(bool) has_action( $hook, '_wp_privacy_send_erasure_fulfillment_notification' ),
				'WordPress n’envoie pas d’accusé d’effacement ici, le cas ne prouve rien'
			);

			// A real request post, as the privacy screen creates one.
			$request_id = wp_insert_post(
				array(
					'post_type'   => 'user_request',
					'post_name'   => 'remove_personal_data',
					'post_title'  => 'ouverte@example.test',
					'post_status' => 'request-completed',
				),
				true
			);
			ts_assert( ! is_wp_error( $request_id ), 'la demande de test n’a pas été créée' );

			/*
			 * TWO REQUESTS, AS THE ADMIN SCREEN MAKES THEM (DON-01). The first
			 * eraser fails in its own ajax request; the LAST eraser, a later
			 * request where nothing of the first survives in memory, is where
			 * WordPress closes and writes the letter. The earlier version of this
			 * case ran both halves in one process and so shared the bug.
			 */
			Privacy::hold_request_open();
			Privacy::hold_open( array( 'done' => true ), 1, 'ouverte@example.test', 1, (int) $request_id );

			// …the next request, a fresh process: the closing action carries only
			// WordPress's letter and what `Privacy::init()` registers, and the
			// eraser that runs there raised nothing.
			$GLOBALS['wp_filter'][ $hook ] = new \WP_Hook();
			add_action( $hook, '_wp_privacy_send_erasure_fulfillment_notification', 10 );
			Privacy::init();
			Privacy::hold_open( array( 'done' => true ), 4, 'ouverte@example.test', 1, (int) $request_id );

			$lettres = 0;
			$compte  = static function ( $pre ) use ( &$lettres ) {
				++$lettres;
				return true;
			};
			add_filter( 'pre_wp_mail', $compte, 1 );
			update_post_meta( (int) $request_id, '_wp_user_request_confirmed_timestamp', time() );
			do_action( $hook, (int) $request_id );
			remove_filter( 'pre_wp_mail', $compte, 1 );

			ts_eq( $lettres, 0, 'l’accusé d’effacement est parti alors que la demande n’a pas pu être exécutée' );
			ts_eq(
				get_post_status( (int) $request_id ),
				'request-confirmed',
				'la demande a été close alors qu’il restait quelque chose à faire'
			);

			// And a later pass that erases everything closes it normally.
			Privacy::hold_open( array( 'done' => true ), 1, 'ouverte@example.test', 1, (int) $request_id );
			ts_eq( get_post_meta( (int) $request_id, Privacy::META_UNFINISHED, true ), '', 'un nouveau passage hérite de l’échec de l’ancien' );

			wp_delete_post( (int) $request_id, true );

			/*
			 * PUT BACK FROM THE COPY. `$wp_filter` holds a `WP_Hook` OBJECT and
			 * `remove_action` mutates it in place, so restoring a reference taken
			 * beforehand restored the already emptied object; the clone above is
			 * the state before this case.
			 */
			if ( null !== $saved ) {
				$GLOBALS['wp_filter'][ $hook ] = $saved;
			}
		}
	);

	ts_it(
		'closes a request normally when everything really was erased',
		function () use ( $product_id ) {
			/*
			 * THE OTHER DIRECTION, because a hold that never lifts would leave
			 * every request open for ever and an operator would stop reading them.
			 */
			$hook = 'wp_privacy_personal_data_erased';

			ts_rgpd_worker( 200 );
			ts_rgpd_order( $product_id, 'close@example.test' );

			$r = Privacy::erase_orders( 'close@example.test' );
			ts_assert( true === $r['items_removed'], 'rien n’a été effacé, le cas ne prouve rien' );

			$request_id = wp_insert_post(
				array(
					'post_type'   => 'user_request',
					'post_name'   => 'remove_personal_data',
					'post_title'  => 'close@example.test',
					'post_status' => 'request-completed',
				),
				true
			);
			Privacy::hold_open( array( 'done' => true ), 1, 'close@example.test', 1, (int) $request_id );
			Privacy::reopen_if_unfinished( (int) $request_id );
			ts_assert(
				(bool) has_action( $hook, '_wp_privacy_send_erasure_fulfillment_notification' ),
				'un effacement réussi empêche quand même l’accusé de partir'
			);
			ts_eq( get_post_status( (int) $request_id ), 'request-completed', 'un effacement réussi a été rouvert' );
			wp_delete_post( (int) $request_id, true );
		}
	);

	ts_it(
		'blanks an address in the outbox without losing the row',
		function () {
			global $wpdb;
			$table = $wpdb->prefix . 'teeshoop_mail';
			$wpdb->insert(
				$table,
				array(
					'created_at' => gmdate( 'Y-m-d H:i:s' ),
					'kind'       => 'confirmation',
					'order_id'   => 0,
					'recipient'  => 'sortie@example.test',
					'subject'    => 'Votre commande',
					'status'     => 'echec',
					'attempts'   => 3,
					'transport'  => 'brevo',
				)
			);
			$id = (int) $wpdb->insert_id;
			ts_assert( $id > 0, 'la ligne de test n’a pas été écrite' );

			$done = Privacy::forget_recipient( 'sortie@example.test' );
			ts_assert( $done > 0, 'aucune ligne anonymisée' );

			$row = $wpdb->get_row( $wpdb->prepare( "SELECT recipient, status, attempts FROM {$table} WHERE id = %d", $id ), ARRAY_A );
			ts_assert( is_array( $row ), 'la ligne a été supprimée au lieu d’être anonymisée' );
			ts_eq( $row['recipient'], '', 'l’adresse est restée dans le journal d’envoi' );
			ts_eq( (int) $row['attempts'], 3, 'le compteur d’échecs a été perdu, l’écran ne verra plus l’envoi bloqué' );

			$wpdb->delete( $table, array( 'id' => $id ) );
		}
	);

	ts_it(
		'erases the orders before WooCommerce anonymises the address it finds them by',
		function () {
			// DON-10. WooCommerce's eraser ran first and ours found no order afterwards.
			$keys = array_keys( apply_filters( 'wp_privacy_personal_data_erasers', array() ) );
			$ours = array_search( 'teeshoop-commandes', $keys, true );
			$woo  = array_search( 'woocommerce-customer-orders', $keys, true );
			ts_assert( false !== $ours && false !== $woo, 'both erasers must be registered, or this proves nothing' );
			ts_assert( $ours < $woo, 'the Teeshoop orders eraser runs after WooCommerce has anonymised the address' );
		}
	);

	ts_it(
		'takes a person out of a proof without taking the proof apart',
		function () {
			$before = wp_json_encode(
				array(
					'customer' => array(
						'nom'     => 'Camille Roux',
						'email'   => 'camille@example.test',
						'societe' => 'Atelier Roux',
					),
					'lines'    => array( array( 'garment' => 'tee', 'quantity' => 6, 'name' => 'B&C #E150 T-Shirt à personnaliser' ) ),
					'approval' => array(
						'at' => '2026-08-01T10:00:00+00:00',
						'ip' => '198.51.100.9',
						'ua' => 'Mozilla/5.0',
						'by' => 'client',
					),
				)
			);
			$after = json_decode( Privacy::scrub_bat( $before ), true );

			ts_eq( $after['customer']['nom'], '', 'le nom est resté' );
			ts_eq( $after['customer']['email'], '', 'l’adresse est restée' );
			ts_eq( $after['approval']['ip'], '', 'l’adresse IP est restée' );
			ts_eq( $after['approval']['ua'], '', 'le navigateur est resté' );
			ts_eq( $after['approval']['at'], '2026-08-01T10:00:00+00:00', 'la date de validation a été perdue' );
			ts_eq( $after['approval']['by'], 'client', 'qui a validé a été perdu' );
			ts_eq( (int) $after['lines'][0]['quantity'], 6, 'la commande elle-même a été abîmée' );
			// DON-09 : le vêtement validé garde son nom, qui n'est pas une personne.
			ts_eq( $after['lines'][0]['name'], 'B&C #E150 T-Shirt à personnaliser', 'la preuve ne dit plus quel vêtement a été validé' );
		}
	);

	ts_it(
		'deletes the artwork of an expired quote request before the request, and keeps the request when it cannot',
		function () {
			/*
			 * DON-06. The daily purge deleted the post and nothing else: the
			 * artwork stayed on R2 with nothing left pointing at it, while the
			 * register promised the person it was deleted.
			 */
			update_option(
				'teeshoop_settings',
				array_merge( (array) get_option( 'teeshoop_settings', array() ), array( 'worker_url' => 'https://worker.test' ) )
			);
			if ( ! defined( 'TEESHOOP_WORKER_TOKEN' ) ) {
				define( 'TEESHOOP_WORKER_TOKEN', 'jeton-de-test' );
			}
			$design = 'purgedevis0000000001';
			$id     = ts_rgpd_old_quote( 'ts-refuse', $design );

			ts_rgpd_worker( 0 );
			Quote::purge();
			ts_assert( null !== get_post( $id ), 'la demande a été supprimée alors que sa création est toujours en ligne' );
			ts_assert(
				in_array( $design, array_map( static fn( array $c ): string => basename( $c['url'] ), ts_rgpd_calls() ), true ),
				'la purge n’a même pas demandé la suppression de la création'
			);

			ts_rgpd_worker( 200 );
			Quote::purge();
			ts_eq( get_post( $id ), null, 'le lendemain, la création partie, la demande devait partir aussi' );
			ts_eq( count( ts_rgpd_calls() ), 1, 'une seule suppression de création' );
		}
	);

	ts_it(
		'keeps an accepted quote, and counts a sent version as the last exchange',
		function () {
			/*
			 * DON-07. The purge took accepted quotes, the firm offer an order was
			 * made from, and ignored a version sent after the last edit, deleting
			 * such a request months before its three years.
			 */
			ts_rgpd_worker( 200 );
			$accepted = ts_rgpd_old_quote( 'ts-accepte', '' );
			$binned   = ts_rgpd_old_quote( 'ts-accepte', '' );
			wp_trash_post( $binned );
			ts_rgpd_age( $binned );
			$answered = ts_rgpd_old_quote( 'ts-envoye', '' );
			$sent_at  = gmdate( 'c', time() - 30 * DAY_IN_SECONDS );
			update_post_meta( $answered, Quote::META_VERSIONS, wp_json_encode( array( array( 'version' => 1, 'number' => 'ESSAIDE-1', 'date' => substr( $sent_at, 0, 10 ), 'at' => $sent_at ) ) ) );
			$silent = ts_rgpd_old_quote( 'ts-refuse', '' );

			Quote::purge();

			ts_assert( null !== get_post( $accepted ), 'un devis accepté a été supprimé comme une demande restée sans suite' );
			ts_assert( null !== get_post( $binned ), 'et un devis accepté mis à la corbeille aussi' );
			ts_assert( null !== get_post( $answered ), 'une demande à laquelle un devis a répondu il y a un mois a été supprimée' );
			ts_eq(
				get_post( $answered )->post_modified_gmt,
				gmdate( 'Y-m-d H:i:s', (int) strtotime( $sent_at ) ),
				'et sa date de dernier échange n’a pas été rattrapée'
			);
			ts_eq( get_post( $silent ), null, 'la demande vraiment périmée est restée' );

			foreach ( array( $accepted, $binned, $answered ) as $id ) {
				wp_delete_post( $id, true );
			}
		}
	);

	remove_all_filters( 'pre_http_request' );
	update_option( 'teeshoop_settings', $saved_settings );
}

/** A quote request last touched four years ago, past the three of the retention. */
function ts_rgpd_old_quote( string $status, string $design ): int {
	$id = wp_insert_post(
		array(
			'post_type'   => Quote::POST_TYPE,
			'post_status' => $status,
			'post_title'  => 'Demande périmée du harnais',
		),
		true
	);
	update_post_meta( $id, '_ts_email', 'perime@example.test' );
	update_post_meta( $id, '_ts_design_id', $design );
	ts_rgpd_age( $id );
	return (int) $id;
}

function ts_rgpd_age( int $id ): void {
	global $wpdb;
	$old = gmdate( 'Y-m-d H:i:s', time() - 4 * YEAR_IN_SECONDS );
	$wpdb->update( $wpdb->posts, array( 'post_modified' => $old, 'post_modified_gmt' => $old ), array( 'ID' => $id ) );
	clean_post_cache( $id );
}
