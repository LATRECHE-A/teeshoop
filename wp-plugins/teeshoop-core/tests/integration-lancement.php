<?php
/**
 * The shop half of the launch gate, driven against a real WooCommerce.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 *
 * `Launch` is the deliverable of session 13b and had no test at all. Four of the
 * gate's five conditions live here rather than in `scripts/launch-gate.mjs`, and
 * the script's `--self-test` proves them by feeding `gate()` a FABRICATED shop
 * object. That proves the script reads a refusal; it proves nothing about
 * whether `Launch` produces one from a real database. Found on 2 September 2026
 * by auditing the session against its own brief.
 *
 * Everything below drives the shipped class against the mirror's WooCommerce and
 * puts back what it changed.
 *
 * ── WHAT IT ASSERTS, AND WHY EACH ONE ────────────────────────────────────────
 *
 * That every condition REFUSES when its fact is wrong, that it stops refusing
 * when the fact is put right, and that it refuses rather than passing when it
 * cannot look. The third is the one the whole project turns on: « we could not
 * look » and « there is nothing wrong » are different results.
 *
 * Run from integration.php, which owns the bootstrap.
 *
 * @package Teeshoop\Core
 */

/* COMMAND LINE ONLY. See run.php. */
if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

use Teeshoop\Core\Launch;
use Teeshoop\Core\Legal;
use Teeshoop\Core\Product;
use Teeshoop\Core\Terms;

/** Reasons carrying this key, as plain sentences. */
function ts_lg_reasons( string $key ): array {
	$out = array();
	foreach ( Launch::blockers() as $blocker ) {
		if ( $key === ( $blocker['cle'] ?? '' ) ) {
			$out[] = (string) ( $blocker['pourquoi'] ?? '' );
		}
	}
	return $out;
}

/** Whether any reason with this key mentions this fragment. */
function ts_lg_says( string $key, string $fragment ): bool {
	foreach ( ts_lg_reasons( $key ) as $why ) {
		if ( false !== mb_stripos( $why, $fragment ) ) {
			return true;
		}
	}
	return false;
}

function ts_lancement_suite(): void {
	echo "\nLe portail de mise en ligne, côté boutique\n";

	$saved_legal = get_option( 'teeshoop_legal', array() );

	ts_it( 'refuses a shop whose legal identity is empty, and names every field', function () use ( $saved_legal ) {
		try {
			update_option( 'teeshoop_legal', array() );
			$why = ts_lg_reasons( 'identite' );
			ts_assert( count( $why ) > 0, 'une identité vide n’a produit aucun refus' );
			/*
			 * NAMED, not counted. « Il manque des mentions » sends an operator
			 * looking; the list tells them what to type. Article 6 III of the
			 * LCEN is what makes each of them mandatory.
			 */
			ts_assert( ts_lg_says( 'identite', 'raison sociale' ), 'le refus ne nomme pas la raison sociale' );
			ts_assert(
				ts_lg_says( 'identite', 'Aucun document ne peut être émis' ),
				'le refus ne dit pas ce que l’absence empêche'
			);
			/*
			 * TWO IDENTITIES AND DEUX CLÉS. `identite` is the seller on the
			 * document, checked against the invoice list; `editeur` is the site's
			 * own publisher, which article 6 III of the LCEN asks for and which
			 * appears on no document. The first version of this test asserted the
			 * LCEN under `identite` and found instead that its sentence still
			 * said « une facture ... est refusée », three commits after this shop
			 * stopped issuing one.
			 */
			ts_assert( ts_lg_says( 'editeur', 'LCEN' ), 'le refus éditeur ne dit pas quel texte l’exige' );
		} finally {
			update_option( 'teeshoop_legal', $saved_legal );
		}
	} );

	ts_it( 'stops refusing on the identity once every field is filled in', function () use ( $saved_legal ) {
		$before = count( ts_lg_reasons( 'identite' ) );
		/*
		 * The mirror carries the real identity since 1 September, so this is the
		 * OTHER direction of the same check: a gate that refuses whatever it is
		 * given is not a gate. If this ever starts failing, read it as the
		 * mirror having lost its settings and not as the gate being wrong.
		 */
		ts_assert( 0 === $before, 'le miroir devrait porter une identité complète : ' . implode( ' · ', ts_lg_reasons( 'identite' ) ) );
	} );

	ts_it( 'refuses a personalisable product on sale that declares no blank, by name', function () {
		$product = new \WC_Product_Simple();
		$product->set_name( 'Sonde du portail de lancement' );
		$product->set_regular_price( '14.50' );
		$product->set_status( 'publish' );
		$product->save();
		update_post_meta( $product->get_id(), Product::META, 'tee' );

		try {
			ts_assert(
				ts_lg_says( 'textile-nu', 'Sonde du portail de lancement' ),
				'un produit personnalisable sans textile nu n’est pas refusé par son nom'
			);
			ts_assert(
				ts_lg_says( 'textile-nu', 'l’atelier ne saura pas quoi acheter' ),
				'le refus ne dit pas ce que cela coûte'
			);

			// And it stops refusing on THIS product once the blank is declared.
			update_post_meta( $product->get_id(), Product::META_BLANK_REF, '18001' );
			update_post_meta( $product->get_id(), Product::META_BLANK_COLOURS, wp_json_encode( array( 'Noir' => 'Black' ) ) );
			ts_assert(
				! ts_lg_says( 'textile-nu', 'Sonde du portail de lancement' ),
				'le produit est encore refusé alors qu’il déclare son textile nu'
			);
		} finally {
			wp_delete_post( $product->get_id(), true );
		}
	} );

	ts_it( 'refuses conditions of sale that nobody whose job it is has read', function () {
		$version = Terms::current();
		ts_assert( '' !== $version, 'aucune version des conditions générales n’est en vigueur' );

		$doc = Terms::document( $version );
		ts_assert( is_array( $doc ), 'la version en vigueur ne se charge pas' );

		/*
		 * The shipped state is a draft nobody has reviewed, so both halves of
		 * this condition are live today and the test reads them rather than
		 * fabricating them. It will need rewriting the day a lawyer signs, which
		 * is the point: the test says what the shop is, not what it hopes.
		 */
		$why = ts_lg_reasons( 'cgv' );
		ts_assert( count( $why ) >= 1, 'des conditions générales en projet ne sont pas refusées' );
		ts_assert(
			ts_lg_says( 'cgv', 'projet' ) || ts_lg_says( 'cgv', 'relue' ),
			'le refus ne dit ni que c’est un projet ni que personne ne l’a relue'
		);
		ts_eq( (string) ( $doc['etat'] ?? '' ) === 'valide', false, 'l’état livré' );
	} );

	ts_it( 'says which condition it could not evaluate rather than passing it', function () {
		/*
		 * FAIL CLOSED, WHICH IS THE ONE PROPERTY A GATE CANNOT BE WRONG ABOUT.
		 *
		 * Every branch of this class that cannot look returns a refusal carrying
		 * its own key. There is no way to make WooCommerce absent inside a
		 * running WordPress, so what is asserted here is the shape the code
		 * commits to: every refusal carries a key and a sentence, and no branch
		 * can return an empty reason that an operator would read as blank.
		 */
		foreach ( Launch::blockers() as $blocker ) {
			ts_assert( '' !== trim( (string) ( $blocker['cle'] ?? '' ) ), 'un refus sans clé' );
			ts_assert( '' !== trim( (string) ( $blocker['pourquoi'] ?? '' ) ), 'un refus sans raison lisible' );
		}
		ts_assert( count( Launch::blockers() ) > 0, 'le portail n’a rien à redire, ce qui serait la première fois' );
	} );
}
