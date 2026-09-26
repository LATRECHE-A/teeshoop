<?php
/**
 * Les modèles sauvegardés contre un vrai WordPress : les routes REST, le compte,
 * le plafond, la propriété, la relecture sur le Worker, la page devis et
 * l'effacement.
 *
 * LE WORKER EST RÉPONDU AU FIL (`pre_http_request`), comme dans
 * `integration-rgpd.php` : le vrai `wp_remote_get` part avec les vrais en-têtes
 * construits par le vrai code, et seule la réponse est remplacée.
 *
 * LE CAS QUI COMPTE LE PLUS est celui d'un autre client : un modèle relie une
 * création à une identité, et son document peut porter la photographie d'une
 * personne. Qu'un compte lise le modèle d'un autre est la faute que ces routes
 * existent pour empêcher.
 *
 * @package Teeshoop\Core
 */

if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

use Teeshoop\Core\Modeles;
use Teeshoop\Core\Privacy;
use Teeshoop\Core\Quote;

const TS_MODELES_WORKER = 'https://worker.modeles.test';

/** Un identifiant de création de la forme que le Worker frappe. */
function ts_modele_id( string $n ): string {
	return 'modeletest' . str_pad( $n, 8, '0', STR_PAD_LEFT );
}

/** Ce que l'atelier poste : l'identifiant, la preuve que le Worker lui a rendue au dépôt, un nom. */
function ts_modele_corps( string $n, string $nom, array $plus = array() ): array {
	$id = ts_modele_id( $n );
	return array_merge( array( 'design_id' => $id, 'preuve' => Modeles::preuve( $id, TEESHOOP_WORKER_TOKEN ), 'nom' => $nom ), $plus );
}

/** Le Worker au fil : le manifeste, le document, une image PNG. Le reste répond 404. */
function ts_modeles_worker(): void {
	remove_all_filters( 'pre_http_request' );
	$GLOBALS['ts_modeles_auth'] = array();
	$repond                     = static fn( int $code, string $body ): array => array(
		'response' => array(
			'code'    => $code,
			'message' => '',
		),
		'body'     => $body,
		'headers'  => array(),
		'cookies'  => array(),
	);
	add_filter(
		'pre_http_request',
		function ( $pre, $args, $url ) use ( $repond ) {
			$url = (string) $url;
			if ( 0 !== strpos( $url, TS_MODELES_WORKER ) ) {
				return $pre;
			}
			$GLOBALS['ts_modeles_auth'][] = (string) ( $args['headers']['authorization'] ?? '' );
			if ( preg_match( '#/api/design/([A-Za-z0-9_-]+)$#', $url, $m ) ) {
				return $repond( 200, (string) wp_json_encode( array( 'garment' => 'tee', 'preview' => '/r2/design/' . $m[1] . '/preview.png' ) ) );
			}
			if ( preg_match( '#/r2/design/[A-Za-z0-9_-]+/design\.json$#', $url ) ) {
				return $repond(
					200,
					(string) wp_json_encode(
						array(
							'v'         => 1,
							'garmentId' => 'tee',
							'layers'    => array(
								array( 'id' => 'c1', 'type' => 'text', 'side' => 'front', 'xIn' => 0, 'yIn' => 0, 'text' => 'Club' ),
							),
						)
					)
				);
			}
			if ( preg_match( '#/r2/design/[A-Za-z0-9_-]+/assets/png1$#', $url ) ) {
				return $repond( 200, "\x89PNG\r\n\x1a\n" . str_repeat( "\0", 16 ) );
			}
			return $repond( 404, '' );
		},
		10,
		3
	);
}

/** Un appel REST tel que l'atelier le fait : nonce du compte courant, corps JSON. */
function ts_modeles_rest( string $methode, string $route, array $corps = array(), bool $nonce = true, array $params = array() ): \WP_REST_Response {
	$req = new \WP_REST_Request( $methode, '/teeshoop/v1/' . $route );
	if ( $nonce ) {
		$req->set_header( 'x-wp-nonce', wp_create_nonce( 'wp_rest' ) );
	}
	if ( array() !== $corps ) {
		$req->set_header( 'content-type', 'application/json' );
		$req->set_body( (string) wp_json_encode( $corps ) );
	}
	foreach ( $params as $k => $v ) {
		$req->set_param( $k, $v );
	}
	return rest_ensure_response( rest_do_request( $req ) );
}

function ts_modeles_suite(): void {
	$reglages = get_option( 'teeshoop_settings', array() );
	update_option( 'teeshoop_settings', array_merge( is_array( $reglages ) ? $reglages : array(), array( 'worker_url' => TS_MODELES_WORKER ) ) );
	// Le jeton serveur n'est pas défini sur le miroir ; il l'est pour ce processus.
	if ( ! defined( 'TEESHOOP_WORKER_TOKEN' ) ) {
		define( 'TEESHOOP_WORKER_TOKEN', 'jeton-de-test-modeles' );
	}
	ts_modeles_worker();

	$suffixe = wp_generate_password( 6, false );
	$a       = wp_insert_user( array( 'user_login' => 'ts-modeles-a-' . $suffixe, 'user_email' => "ts-modeles-a-{$suffixe}@teeshoop.invalid", 'user_pass' => wp_generate_password( 24 ) ) );
	$b       = wp_insert_user( array( 'user_login' => 'ts-modeles-b-' . $suffixe, 'user_email' => "ts-modeles-b-{$suffixe}@teeshoop.invalid", 'user_pass' => wp_generate_password( 24 ) ) );
	ts_assert( is_int( $a ) && is_int( $b ), 'les deux comptes de test n’ont pas pu être créés : rien ne serait prouvé' );

	ts_it(
		'refuses a visitor without an account, and an account without a nonce',
		function () use ( $a ): void {
			wp_set_current_user( 0 );
			ts_eq( ts_modeles_rest( 'GET', 'modeles' )->get_status(), 401, 'sans compte' );
			wp_set_current_user( $a );
			ts_eq( ts_modeles_rest( 'GET', 'modeles', array(), false )->get_status(), 403, 'sans nonce' );
		}
	);

	ts_it(
		'refuses a design whose id is known but whose proof of creation is not, before asking the Worker',
		function () use ( $b ): void {
			/*
			 * L'identifiant circule (lien de partage, adresse de l'aperçu). Sans
			 * la preuve, un autre compte enregistrerait la création d'autrui et
			 * relirait ses images originales à travers la boutique.
			 */
			wp_set_current_user( $b );
			$GLOBALS['ts_modeles_auth'] = array();
			$id                        = ts_modele_id( '1' );
			foreach (
				array(
					'sans preuve'                     => array( 'design_id' => $id, 'nom' => 'Volé' ),
					'preuve d’une autre création'     => array( 'design_id' => $id, 'preuve' => Modeles::preuve( ts_modele_id( '7' ), TEESHOOP_WORKER_TOKEN ), 'nom' => 'Volé' ),
					'preuve qui n’est pas une chaîne' => array( 'design_id' => $id, 'preuve' => array( 'x' ), 'nom' => 'Volé' ),
				) as $cas => $corps
			) {
				$r = ts_modeles_rest( 'POST', 'modeles', $corps );
				ts_eq( $r->get_status(), 403, $cas );
				ts_eq( $r->get_data()['code'] ?? '', 'teeshoop_modele_preuve', "{$cas} : le refus dit pourquoi" );
			}
			ts_eq( Modeles::lister( $b ), array(), 'rien n’est enregistré' );
			ts_eq( $GLOBALS['ts_modeles_auth'], array(), 'et le Worker n’a pas été appelé' );
		}
	);

	ts_it(
		'saves a model the Worker confirms, under the garment the Worker states',
		function () use ( $a ): void {
			wp_set_current_user( $a );
			$r = ts_modeles_rest( 'POST', 'modeles', ts_modele_corps( '1', 'Club', array( 'garment' => 'hoodie' ) ) );
			ts_eq( $r->get_status(), 201, 'enregistré : ' . wp_json_encode( $r->get_data() ) );
			$m = $r->get_data()['modeles'][0] ?? array();
			ts_eq( $m['garment'] ?? '', 'tee', 'le vêtement vient du Worker, pas du navigateur' );
			ts_eq( $m['apercu'] ?? '', TS_MODELES_WORKER . '/r2/design/' . ts_modele_id( '1' ) . '/preview.png', 'aperçu en adresse complète' );
		}
	);

	ts_it(
		'refuses a sixth model, and renames a saved one instead of taking a second place',
		function () use ( $a ): void {
			wp_set_current_user( $a );
			for ( $i = 2; $i <= Modeles::MAX; $i++ ) {
				ts_eq( ts_modeles_rest( 'POST', 'modeles', ts_modele_corps( (string) $i, "Modèle {$i}" ) )->get_status(), 201, "modèle {$i}" );
			}
			$plein = ts_modeles_rest( 'POST', 'modeles', ts_modele_corps( '99', 'De trop' ) );
			ts_eq( $plein->get_status(), 409, 'le sixième est refusé' );
			ts_eq( $plein->get_data()['code'] ?? '', 'teeshoop_modele_plein', 'et le refus dit pourquoi' );
			$renomme = ts_modeles_rest( 'POST', 'modeles', ts_modele_corps( '1', 'Club 2026' ) );
			ts_eq( $renomme->get_status(), 201, 'un renommage passe même plein' );
			ts_eq( $renomme->get_data()['total'] ?? 0, Modeles::MAX, 'toujours cinq places' );
		}
	);

	ts_it(
		'lists the models of the same kind of garment only',
		function () use ( $a ): void {
			wp_set_current_user( $a );
			ts_eq( count( ts_modeles_rest( 'GET', 'modeles', array(), true, array( 'garment' => 'hoodie' ) )->get_data()['modeles'] ), Modeles::MAX, 'un modèle de t-shirt se réapplique sur un sweat' );
			ts_eq( count( ts_modeles_rest( 'GET', 'modeles', array(), true, array( 'garment' => 'custom' ) )->get_data()['modeles'] ), 0, 'pas sur un vêtement d’un autre type' );
		}
	);

	ts_it(
		'lets no other account read, delete or open a model in the workshop',
		function () use ( $a, $b ): void {
			wp_set_current_user( $b );
			$id = ts_modele_id( '1' );
			ts_eq( ts_modeles_rest( 'GET', "modeles/{$id}/document" )->get_status(), 404, 'lecture du document par un autre compte' );
			ts_eq( ts_modeles_rest( 'GET', "modeles/{$id}/fichier/png1" )->get_status(), 404, 'lecture d’une image par un autre compte' );
			ts_eq( ts_modeles_rest( 'DELETE', "modeles/{$id}" )->get_status(), 404, 'suppression par un autre compte' );
			ts_assert( Modeles::possede( $a, $id ), 'le modèle doit toujours être au premier compte' );
			ts_assert( ! Modeles::possede( $b, $id ), 'et à lui seul' );
		}
	);

	ts_it(
		'reads the document and an image back through the Worker, with the server token',
		function () use ( $a ): void {
			wp_set_current_user( $a );
			$id                        = ts_modele_id( '1' );
			$GLOBALS['ts_modeles_auth'] = array();
			$doc                       = ts_modeles_rest( 'GET', "modeles/{$id}/document" );
			ts_eq( $doc->get_status(), 200, 'document relu' );
			ts_eq( $doc->get_data()['document']['layers'][0]['text'] ?? '', 'Club', 'les calques du modèle' );
			$img = ts_modeles_rest( 'GET', "modeles/{$id}/fichier/png1" );
			ts_eq( $img->get_status(), 200, 'image relue' );
			ts_eq( $img->get_data()['type'] ?? '', 'image/png', 'type lu dans les octets' );
			ts_assert( str_starts_with( (string) base64_decode( (string) ( $img->get_data()['base64'] ?? '' ) ), "\x89PNG" ), 'les octets de l’image' );
			ts_assert(
				array() !== $GLOBALS['ts_modeles_auth'] && array_unique( $GLOBALS['ts_modeles_auth'] ) === array( 'Bearer ' . TEESHOOP_WORKER_TOKEN ),
				'chaque appel au Worker porte le jeton serveur : ' . wp_json_encode( $GLOBALS['ts_modeles_auth'] )
			);
		}
	);

	ts_it(
		'deletes a model of its own account',
		function () use ( $a ): void {
			wp_set_current_user( $a );
			$id = ts_modele_id( '2' );
			ts_eq( ts_modeles_rest( 'DELETE', "modeles/{$id}" )->get_status(), 200, 'supprimé' );
			ts_assert( ! Modeles::possede( $a, $id ), 'il n’est plus dans le compte' );
		}
	);

	ts_it(
		'opens the quote page on a personalisable product, and offers the list without one',
		function () use ( $a ): void {
			wp_set_current_user( $a );
			$pid = wp_insert_post( array( 'post_type' => 'product', 'post_status' => 'publish', 'post_title' => 'T-shirt de test des modèles' ) );
			update_post_meta( $pid, '_teeshoop_garment', 'tee' );
			$brouillon = wp_insert_post( array( 'post_type' => 'product', 'post_status' => 'draft', 'post_title' => 'Brouillon' ) );
			update_post_meta( $brouillon, '_teeshoop_garment', 'tee' );

			$sur = Quote::page_args( (int) $pid, 5 );
			ts_eq( $sur['product_id'], (int) $pid, 'l’article demandé' );
			ts_assert( $sur['grille'] && array() !== $sur['sizes'], 'les quantités par taille sont proposées' );
			ts_assert( '' !== $sur['atelier_url'], 'le bouton Personnalisation a une adresse' );
			ts_assert( is_array( $sur['modeles'] ) && count( $sur['modeles'] ) > 0, 'les modèles du client sont proposés' );

			ts_eq( Quote::page_args( (int) $brouillon, 5 )['product_id'], 0, 'un brouillon ne s’ouvre pas' );
			$sans = Quote::page_args( 0, 5 );
			ts_assert( isset( $sans['choix'][ (int) $pid ] ), 'sans article, la liste propose ceux qu’on peut personnaliser' );
			ts_assert( ! isset( $sans['choix'][ (int) $brouillon ] ), 'et pas un brouillon' );

			wp_delete_post( $pid, true );
			wp_delete_post( $brouillon, true );
		}
	);

	ts_it(
		'exports and erases the models of an account on a privacy request',
		function () use ( $a ): void {
			$email  = (string) get_userdata( $a )->user_email;
			$export = Privacy::export_modeles( $email );
			ts_assert( count( $export['data'] ) > 0, 'l’export porte les modèles' );
			$efface = Privacy::erase_modeles( $email );
			ts_assert( true === $efface['items_removed'], 'l’effacement annonce ce qu’il a retiré' );
			ts_eq( Modeles::lister( $a ), array(), 'plus aucun modèle dans le compte' );
		}
	);

	wp_set_current_user( 0 );
	require_once ABSPATH . 'wp-admin/includes/user.php';
	wp_delete_user( $a );
	wp_delete_user( $b );
	remove_all_filters( 'pre_http_request' );
	update_option( 'teeshoop_settings', $reglages );
}
