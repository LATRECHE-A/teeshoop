<?php
/**
 * The shop's copy of the register of assumed values.
 *
 * These tests deliberately do NOT re-check what `scripts/hypotheses-guard.mjs`
 * checks: that the register agrees with the code is the guard's job, and it does
 * it by running both implementations. What is checked here is the half the guard
 * cannot see, because it lives in PHP: that the shop can read its copy, that the
 * copy is a FILTERED projection and not the whole register, and that the filter
 * still holds the boundary `scripts/php-guard.mjs` protects.
 *
 * @package Teeshoop\Core
 */

/*
 * COMMAND LINE ONLY. `wp-content/plugins/` is served by URL and this directory
 * is inside it: before the guards, GET on any of these files ran the suite to
 * the public internet and printed the figures of every failing assertion.
 *
 * A file whose first statement is a `require_once` of a class guarded on
 * ABSPATH answers 200 with an empty body rather than a fatal, which looks
 * harmless and is not: it confirms the path exists, and it becomes a live suite
 * the day somebody reorders the requires.
 */
if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

require_once __DIR__ . '/../includes/Hypotheses.php';

use Teeshoop\Core\Hypotheses;

describe( 'Hypotheses: the shop\'s copy of the register', function (): void {

	it( 'reads rows, and does not silently read none', function (): void {
		$rows = Hypotheses::rows();
		truthy( count( $rows ) > 0, 'the projection at ' . Hypotheses::path() . ' is empty or unreadable' );
	} );

	it( 'carries only what the shop owns', function (): void {
		foreach ( Hypotheses::rows() as $row ) {
			truthy(
				str_starts_with( (string) $row['home'], 'php:Teeshoop' )
					|| str_starts_with( (string) $row['home'], 'phpconst:Teeshoop' )
					|| str_contains( (string) $row['home'], 'wp-plugins/' ),
				$row['id'] . ' is homed outside the plugin and should not have crossed'
			);
		}
	} );

	/*
	 * WHY THERE IS NO NEEDLE TEST HERE, deliberately.
	 *
	 * The register carries rows about film economics and about what a blank
	 * costs us, and none of them may enter this directory. The obvious test is
	 * to list those words and assert the projection is free of them, and it was
	 * written that way first. It was wrong twice over: it duplicates
	 * `scripts/php-guard.mjs`, which already scans every .json under
	 * wp-plugins/ for exactly that list, and spelling the words here made THIS
	 * file fail that guard, which would have needed an exemption to protect a
	 * duplicate check.
	 *
	 * The guard was made to fire on this exact file before that test was
	 * removed: a film rate written into the projection produced a `[film-cost]`
	 * hit on it and a non-zero exit. The boundary is
	 * covered once, by the tool that owns it, and what is asserted here is the
	 * thing the guard cannot know: which rows the projection is allowed to
	 * carry at all.
	 */
	it( 'holds every field an admin screen renders, and no field it does not', function (): void {
		/*
		 * `answered` and `answer_fr` joined in session 13b. They are in
		 * `$allowed` and not in `$needed` because they are null on every row the
		 * associate has not settled, and `isset()` reads a null as absent: a row
		 * with no answer is the normal case, not a defect.
		 */
		$allowed = array( 'id', 'question', 'level', 'status', 'since', 'answered', 'answer_fr', 'statement_fr', 'home', 'reaches', 'cost_if_late', 'sessions' );
		$needed  = array( 'id', 'question', 'level', 'status', 'statement_fr', 'home', 'reaches', 'cost_if_late' );
		foreach ( Hypotheses::rows() as $row ) {
			foreach ( array_keys( $row ) as $key ) {
				truthy( in_array( $key, $allowed, true ), ( $row['id'] ?? '?' ) . " brought {$key} across, which the shop does not display" );
			}
			foreach ( $needed as $key ) {
				truthy( isset( $row[ $key ] ), ( $row['id'] ?? '?' ) . " has no {$key}" );
			}
		}
	} );

	it( 'finds what the price authority is still assuming', function (): void {
		$rows = Hypotheses::assumed_at( Hypotheses::HOME_PRICING );
		truthy( count( $rows ) > 0, 'no assumption is attached to the price config, which cannot be right today' );
		foreach ( $rows as $row ) {
			eq( $row['status'], 'assumption', $row['id'] . ' is not an assumption' );
		}
	} );

	/*
	 * The marker used to name question 04, which is about DTF supplier rates.
	 * The selling grid is questions 03, 06 and 08. A pointer to the wrong
	 * question is worse than none, because it is followed.
	 */
	it( 'names the questions that actually settle the price, not the film rate', function (): void {
		$list = Hypotheses::question_list( Hypotheses::assumed_at( Hypotheses::HOME_PRICING ) );
		truthy( str_contains( $list, '06' ), 'the margin question is missing from the marker' );
		truthy( str_contains( $list, '17' ), 'the VAT question is missing from the marker' );
		truthy( ! str_contains( $list, '04' ), 'the marker still sends the reader to the supplier film question' );
	} );

	it( 'sorts and deduplicates the question numbers it prints', function (): void {
		$rows = array(
			array( 'question' => 'Q17' ),
			array( 'question' => 'Q06' ),
			array( 'question' => 'Q06' ),
			array( 'question' => 'Q02' ),
		);
		eq( Hypotheses::question_list( $rows ), '02, 06, 17' );
	} );

	it( 'knows the difference between reading nothing and reading a file that is not there', function (): void {
		// The shipped projection is present, so this is true. It is asserted
		// because the whole point of the flag is that an empty list is not
		// evidence of an empty register, and a flag nothing checks is a comment.
		truthy( Hypotheses::readable(), 'the shipped projection did not read as readable' );
	} );

	/*
	 * The register describes what the extension SHIPS. What a shop charges is the
	 * stored option merged over it, and the continuous integration guard runs with
	 * no WordPress and no database, so it can never see that option. Mapping a
	 * row's home onto the config key an option would overwrite is what lets the
	 * one screen that DOES run inside WordPress say which sentences have been
	 * overtaken.
	 */
	it( 'maps a row home onto the config key a stored setting would overwrite', function (): void {
		eq( Hypotheses::config_key( Hypotheses::HOME_PRICING . '#garments.tee.base_ht+garments.tee.first_side_ht' ), 'garments' );
		eq( Hypotheses::config_key( Hypotheses::HOME_PRICING . '#vat_rate' ), 'vat_rate' );
		eq( Hypotheses::config_key( Hypotheses::HOME_PRICING . '#area_tiers' ), 'area_tiers' );
		// A row homed anywhere else is not something a price setting can overtake.
		eq( Hypotheses::config_key( 'phpconst:Teeshoop\\Core\\Quote::KEEP_DAYS' ), '' );
		eq( Hypotheses::config_key( 'anchor:wp-plugins/teeshoop-core/includes/Cart.php#check_cart_items' ), '' );
	} );

	it( 'finds a config key for every price row the shop carries', function (): void {
		$priced = Hypotheses::assumed_at( Hypotheses::HOME_PRICING );
		truthy( count( $priced ) > 0 );
		foreach ( $priced as $row ) {
			truthy( '' !== Hypotheses::config_key( (string) $row['home'] ), $row['id'] . ' has no config key' );
		}
	} );

	it( 'returns nothing for a home nobody registered', function (): void {
		$rows = Hypotheses::assumed_at( 'php:Teeshoop\\Core\\NoSuchClass::nothing()' );
		eq( $rows, array() );
	} );
} );
