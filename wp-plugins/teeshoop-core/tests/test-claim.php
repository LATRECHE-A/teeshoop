<?php
/**
 * Chapitre 5's decision matrix, as code.
 *
 * The rows that matter are the two the Bible itself leaves open. « Pas de
 * gratuité automatique, geste éventuel » and « pas de reprise standard, solution
 * commerciale possible » are decisions, not entitlements, and a table that
 * reported either of them as owed or as not owed would be answering a question
 * the associate has not been asked.
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

require_once __DIR__ . '/../includes/Claim.php';

use Teeshoop\Core\Claim;

describe( 'Claim: who pays, according to chapitre 5', function () {

	it( 'makes Teeshoop pay for its own mistakes and for its supplier’s', function () {
		eq( Claim::verdict( 'teeshoop' )['owed'], true, 'erreur Teeshoop' );
		eq( Claim::verdict( 'fournisseur' )['owed'], true, 'défaut fournisseur' );
		eq( Claim::verdict( 'transport' )['owed'], true, 'dommage transport' );
	} );

	it( 'refuses to decide the two the Bible leaves to a human', function () {
		// « geste éventuel » and « solution commerciale possible » are the only
		// two rows with no answer in them, and both are recorded as unknown
		// rather than resolved in whichever direction happens to be convenient.
		eq( Claim::verdict( 'bat' )['owed'], null, 'erreur validée dans le BAT' );
		eq( Claim::verdict( 'taille' )['owed'], null, 'mauvaise taille commandée' );
	} );

	it( 'costs us nothing when the garment was simply worn out', function () {
		eq( Claim::verdict( 'entretien' )['owed'], false, 'usure ou entretien' );
	} );

	it( 'treats a cause nobody has chosen as unknown, never as a refusal', function () {
		/*
		 * "We have not decided" and "the customer is wrong" are different
		 * answers, and only one of them is ours to give before somebody has
		 * looked at the dossier.
		 */
		eq( Claim::verdict( '' )['owed'], null, 'aucune cause' );
		eq( Claim::verdict( 'quelque-chose' )['owed'], null, 'une cause inconnue' );
	} );

	it( 'answers every cause it publishes, and publishes every cause it answers', function () {
		// A cause on the dropdown with no row in the matrix would be an option
		// that silently produces "à qualifier" for ever.
		foreach ( array_keys( Claim::causes() ) as $cause ) {
			$verdict = Claim::verdict( $cause );
			truthy( '' !== $verdict['solution'], "aucune solution pour {$cause}" );
			truthy( 'À qualifier' !== $verdict['solution'], "{$cause} n’est pas dans la matrice" );
			truthy( '' !== $verdict['note'], "aucune consigne pour {$cause}" );
		}
	} );

	it( 'keeps the eleven motifs of the chapter', function () {
		$motifs = Claim::motifs();
		eq( count( $motifs ), 11, 'les motifs du chapitre 5' );
		foreach ( array( 'quantite', 'taille', 'couleur', 'marquage', 'position', 'colis', 'delai', 'autre' ) as $key ) {
			truthy( isset( $motifs[ $key ] ), "motif {$key} manquant" );
		}
	} );
} );
