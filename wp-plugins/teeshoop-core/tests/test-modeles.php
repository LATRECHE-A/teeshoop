<?php
/**
 * Les règles des modèles sauvegardés, sans WordPress : le type de vêtement, la
 * liste relue comme une donnée venue d'ailleurs, la preuve de création, et le
 * plafond de cinq.
 *
 * Ce qui touche le compte et le Worker est dans `tests/integration-modeles.php`.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

require_once __DIR__ . '/../includes/Design.php';
require_once __DIR__ . '/../includes/Modeles.php';

use Teeshoop\Core\Modeles;

/** Un modèle bien formé, dont seul l'identifiant change. */
function ts_modele( string $n, string $garment = 'tee' ): array {
	return array(
		'id'      => 'modele-de-test-' . str_pad( $n, 4, '0', STR_PAD_LEFT ),
		'nom'     => 'Modèle ' . $n,
		'garment' => $garment,
		'apercu'  => '',
		'cree'    => '2026-09-26T08:00:00+00:00',
	);
}

describe( 'Modeles : le type d’un vêtement', function () {

	it( 'range le t-shirt et le sweat parmi les hauts', function () {
		eq( Modeles::famille( 'tee' ), 'haut', 't-shirt' );
		eq( Modeles::famille( 'hoodie' ), 'haut', 'sweat' );
	} );

	it( 'laisse un vêtement inconnu seul dans son type, qui est le sens prudent', function () {
		eq( Modeles::famille( 'custom' ), 'custom', 'vêtement du client' );
		eq( Modeles::famille( 'bandana' ), 'bandana', 'vêtement pas encore dans l’atelier' );
	} );

	it( 'ne propose sur un sweat que les modèles des hauts', function () {
		$liste = array( ts_modele( '1', 'tee' ), ts_modele( '2', 'custom' ), ts_modele( '3', 'hoodie' ) );
		eq( array_column( Modeles::pour( $liste, 'hoodie' ), 'id' ), array( ts_modele( '1' )['id'], ts_modele( '3' )['id'] ), 'modèles d’un haut' );
		eq( count( Modeles::pour( $liste, '' ) ), 3, 'sans vêtement, toute la liste' );
	} );
} );

describe( 'Modeles : la liste stockée est relue, pas crue', function () {

	it( 'écarte une entrée dont l’identifiant n’est pas celui d’une création', function () {
		$lue = Modeles::normaliser( array( ts_modele( '1' ), array( 'id' => 'court', 'nom' => 'x' ), 'pas un tableau', null ) );
		eq( count( $lue ), 1, 'une seule entrée valide' );
	} );

	it( 'rend une liste vide pour une méta qui n’est pas une liste', function () {
		eq( Modeles::normaliser( '' ), array(), 'chaîne vide' );
		eq( Modeles::normaliser( false ), array(), 'méta absente' );
	} );

	it( 'borne le nom et refuse un aperçu qui n’a pas la forme de ceux du Worker', function () {
		$m           = ts_modele( '1' );
		$m['nom']    = str_repeat( 'é', Modeles::NOM_MAX + 20 );
		$m['apercu'] = 'https://ailleurs.example/image.png';
		$lue         = Modeles::normaliser( array( $m ) )[0];
		eq( mb_strlen( $lue['nom'] ), Modeles::NOM_MAX, 'nom borné' );
		eq( $lue['apercu'], '', 'aperçu étranger refusé' );
	} );
} );

describe( 'Modeles : la preuve de création', function () {

	it( 'calcule la preuve que le Worker remet au dépôt, au bit près', function () {
		// Le même vecteur que `worker/design.test.ts` : les deux bouts doivent
		// tomber sur les mêmes octets, sinon aucun modèle ne s'enregistre.
		eq(
			Modeles::preuve( 'modeletest00000001', 'a-token-long-enough-to-be-accepted-abcdefgh' ),
			'78a7b7ae12e6d90896185650cd2bf1521e2456eb8850dc2acdea71e7e4190057',
			'vecteur partagé avec le Worker'
		);
	} );

	it( 'ne rend rien sans jeton, pour que rien ne s’enregistre (fermé par défaut)', function () {
		eq( Modeles::preuve( 'modeletest00000001', '' ), '', 'sans jeton' );
	} );

	it( 'change avec la création : une preuve ne vaut que pour la sienne', function () {
		truthy(
			Modeles::preuve( 'modeletest00000001', 'jeton' ) !== Modeles::preuve( 'modeletest00000002', 'jeton' ),
			'deux créations, deux preuves'
		);
	} );
} );

describe( 'Modeles : cinq par compte', function () {

	it( 'refuse le sixième au lieu de retirer un ancien sans le dire', function () {
		$liste = array();
		for ( $i = 1; $i <= Modeles::MAX; $i++ ) {
			$liste = Modeles::ajouter( $liste, ts_modele( (string) $i ) );
		}
		eq( count( $liste ), Modeles::MAX, 'cinq modèles' );
		eq( Modeles::ajouter( $liste, ts_modele( '99' ) ), 'plein', 'le sixième est refusé' );
	} );

	it( 'renomme une création déjà enregistrée au lieu de lui donner une seconde place', function () {
		$liste   = Modeles::ajouter( array(), ts_modele( '1' ) );
		$m       = ts_modele( '1' );
		$m['nom'] = 'Nouveau nom';
		$liste   = Modeles::ajouter( $liste, $m );
		eq( count( $liste ), 1, 'toujours une seule place' );
		eq( $liste[0]['nom'], 'Nouveau nom', 'le nom a changé' );
	} );

	it( 'accepte de renommer même quand la liste est pleine', function () {
		$liste = array();
		for ( $i = 1; $i <= Modeles::MAX; $i++ ) {
			$liste = Modeles::ajouter( $liste, ts_modele( (string) $i ) );
		}
		$m        = ts_modele( '3' );
		$m['nom'] = 'Renommé';
		$liste    = Modeles::ajouter( $liste, $m );
		truthy( is_array( $liste ), 'un renommage n’est pas un sixième modèle' );
	} );

	it( 'met le plus récent en tête', function () {
		$liste = Modeles::ajouter( Modeles::ajouter( array(), ts_modele( '1' ) ), ts_modele( '2' ) );
		eq( $liste[0]['id'], ts_modele( '2' )['id'], 'le dernier enregistré est le premier de la liste' );
	} );
} );
