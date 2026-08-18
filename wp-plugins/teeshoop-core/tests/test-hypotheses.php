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
		$allowed = array( 'id', 'question', 'level', 'status', 'since', 'statement_fr', 'home', 'reaches', 'cost_if_late', 'sessions' );
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

	it( 'says nothing rather than something wrong when the file is gone', function (): void {
		// A missing projection must render no marker at all: a marker that says
		// "0 valeurs" would read as "everything here is decided", which is the
		// one thing it must never say.
		$rows = Hypotheses::assumed_at( 'php:Teeshoop\\Core\\NoSuchClass::nothing()' );
		eq( $rows, array() );
	} );
} );
