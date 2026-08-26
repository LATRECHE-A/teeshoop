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
		'takes a person out of a proof without taking the proof apart',
		function () {
			$before = wp_json_encode(
				array(
					'customer' => array(
						'nom'     => 'Camille Roux',
						'email'   => 'camille@example.test',
						'societe' => 'Atelier Roux',
					),
					'lines'    => array( array( 'garment' => 'tee', 'quantity' => 6 ) ),
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
		}
	);

	remove_all_filters( 'pre_http_request' );
	update_option( 'teeshoop_settings', $saved_settings );
}
