<?php
/**
 * The seller's identity, and what an incomplete one does to a document.
 *
 * The interesting assertions are the negative ones: that nothing here invents a
 * SIRET, that a missing field is reported rather than skipped, and that the same
 * incompleteness refuses in production and stamps everywhere else.
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
require_once __DIR__ . '/../includes/Pricing.php';
require_once __DIR__ . '/../includes/Vat.php';
require_once __DIR__ . '/../includes/Legal.php';

use Teeshoop\Core\Legal;
use Teeshoop\Core\Vat;

/** A complete identity, entirely invented, and never anywhere but in this test. */
function ts_legal_complete(): array {
	return array(
		'raison_sociale'  => 'Société de vérification',
		'forme_juridique' => 'SAS',
		'capital'         => '1 000 EUR',
		'adresse'         => '1 rue du Test',
		'code_postal'     => '93000',
		'ville'           => 'Bobigny',
		'siret'           => '12345678900017',
		'rcs_ville'       => 'Bobigny',
		'tva_intra'       => 'FR00123456789',
	);
}

describe( 'Legal: nothing is filled in by default', function () {
	it( 'ships every field empty rather than plausible', function () {
		// A placeholder SIRET is a thing that ships. There is exactly one way to
		// be sure it does not: never write one.
		$empty = array_fill_keys( array_keys( Legal::fields() ), '' );
		eq( Legal::missing( $empty, Vat::STANDARD ), array_keys( Legal::fields() ) );
	} );

	it( 'reports every missing field, not the first', function () {
		$partial = array_merge( ts_legal_complete(), array( 'siret' => '', 'capital' => '' ) );
		eq( Legal::missing( $partial, Vat::STANDARD ), array( 'capital', 'siret' ) );
	} );

	it( 'treats whitespace as empty', function () {
		$partial = array_merge( ts_legal_complete(), array( 'ville' => "   \n" ) );
		eq( Legal::missing( $partial, Vat::STANDARD ), array( 'ville' ) );
	} );
} );

describe( 'Legal: what the regime changes', function () {
	it( 'does not demand a VAT number from a company in franchise', function () {
		$no_vat = array_merge( ts_legal_complete(), array( 'tva_intra' => '' ) );
		eq( Legal::missing( $no_vat, Vat::FRANCHISE ), array() );
		eq( Legal::missing( $no_vat, Vat::STANDARD ), array( 'tva_intra' ) );
	} );

	it( 'demands everything when nobody has recorded the regime', function () {
		// "We could not look" is not "nothing is missing". An unknown regime
		// takes the stricter list.
		$no_vat = array_merge( ts_legal_complete(), array( 'tva_intra' => '' ) );
		eq( Legal::missing( $no_vat, '' ), array( 'tva_intra' ) );
	} );
} );

describe( 'Legal: the environment decides what an incomplete identity does', function () {
	it( 'refuses in production and stamps everywhere else', function () {
		$empty = array_fill_keys( array_keys( Legal::fields() ), '' );

		eq( Legal::verdict( $empty, Vat::STANDARD, 'production' )['action'], Legal::REFUSE );
		foreach ( array( 'staging', 'development', 'local' ) as $env ) {
			eq( Legal::verdict( $empty, Vat::STANDARD, $env )['action'], Legal::STAMP, $env );
		}
	} );

	it( 'treats an environment it has never heard of as not production', function () {
		// `wp_get_environment_type()` answers `production` when nothing is set,
		// so a value this code does not know means somebody chose it, and a
		// machine that is not the shop should be able to work.
		$empty = array_fill_keys( array_keys( Legal::fields() ), '' );
		eq( Legal::verdict( $empty, Vat::STANDARD, 'preprod-2' )['action'], Legal::STAMP );
	} );

	it( 'issues in every environment once the identity is complete', function () {
		foreach ( array( 'production', 'staging', 'local' ) as $env ) {
			$verdict = Legal::verdict( ts_legal_complete(), Vat::STANDARD, $env );
			eq( $verdict['action'], Legal::ISSUE, $env );
			eq( $verdict['missing'], array() );
		}
	} );

	it( 'names the missing fields in French, for the person who can fill them', function () {
		$partial = array_merge( ts_legal_complete(), array( 'rcs_ville' => '' ) );
		eq( Legal::verdict( $partial, Vat::STANDARD, 'production' )['labels'], array( 'Ville du greffe (RCS)' ) );
	} );
} );

describe( 'Legal: the identifiers', function () {
	it( 'accepts fourteen digits however they were typed, and nothing else', function () {
		eq( Legal::siret( '123 456 789 00017' ), '12345678900017' );
		eq( Legal::siret( '12345678900017' ), '12345678900017' );
		eq( Legal::siret( '123456789' ), '', 'a SIREN is not a SIRET' );
		eq( Legal::siret( '' ), '' );
		eq( Legal::siret( '01 42 00 00 00' ), '', 'a phone number in the wrong box' );
	} );

	it( 'does not refuse a real number because a checksum disagrees', function () {
		// La Poste's own SIREN, 356000000, fails the Luhn key. Refusing it would
		// be this plugin telling a company it does not exist.
		eq( Legal::siret( '35600000000048' ), '35600000000048' );
	} );

	it( 'prints a SIRET the way a document prints it', function () {
		eq( Legal::format_siret( '12345678900017' ), "123\u{00A0}456\u{00A0}789\u{00A0}00017" );
		eq( Legal::siren( '12345678900017' ), '123456789' );
		eq( Legal::siren( 'pas un siret' ), '' );
	} );
} );
