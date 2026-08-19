<?php
/**
 * Who the seller is, on paper.
 *
 * EVERY DEFAULT HERE IS THE EMPTY STRING, AND THAT IS THE FEATURE. A plausible
 * placeholder SIRET is a thing that ships: it looks filled in, it passes review,
 * and it ends up on an invoice sent to a customer and to an accountant. Question
 * 17 of QUESTIONS-ASSOCIE.md asks the associate for these facts and its written
 * default is explicit about it: "Les mentions légales restent vides plutôt que
 * remplies d'exemples crédibles, et la mise en ligne est refusée tant qu'elles
 * le sont."
 *
 * The Bible contains none of it. Grepped across all eight chapters: no SIRET, no
 * SIREN, no RCS, no forme juridique, no capital, no address beyond the word
 * Bobigny. There is nothing to derive and nothing to copy, which is why this
 * file holds a shape and no facts.
 *
 * WHAT HAPPENS WHEN IT IS INCOMPLETE depends on where the code is running, and
 * that is deliberate. On a developer's machine and on the preproduction, work has
 * to be possible: a document renders, stamped in French across the page as not
 * usable. In production it refuses outright, because an unusable invoice that
 * reaches a customer is worse than no invoice at all. `WP_ENVIRONMENT_TYPE` is
 * already set to `staging` on the preproduction, so the seam exists. Session 13b
 * turns this into the launch gate.
 *
 * The pure half (`missing`, `verdict`) calls no WordPress function and is tested
 * by `php tests/run.php`; only `identity()` and `environment()` touch WordPress.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

require_once __DIR__ . '/Vat.php';

final class Legal {

	/** The document can be issued. */
	public const ISSUE = 'issue';

	/** It renders, marked across the page as not usable. */
	public const STAMP = 'stamp';

	/** Nothing is rendered at all. */
	public const REFUSE = 'refuse';

	/** What a stamped document says, in the largest type on the page. */
	public const STAMP_TEXT = 'DOCUMENT NON CONFORME';

	/**
	 * Every field, in the order a French invoice prints them.
	 *
	 * The first six are question 17's own list. `code_postal` and `ville` are
	 * that question's "adresse" split into the parts a document needs
	 * separately. `rcs_ville` is NOT in question 17 and is legally mandatory on
	 * an invoice issued by a commercial company: the invoice must carry the
	 * registry town alongside the SIREN. It was missing from what we asked him,
	 * which is our omission and not his, so question 45 now asks for it rather
	 * than this file inventing one.
	 *
	 * @return array<string,string> key to the French label it prints under
	 */
	public static function fields(): array {
		return array(
			'raison_sociale'  => 'Raison sociale',
			'forme_juridique' => 'Forme juridique',
			'capital'         => 'Capital social',
			'adresse'         => 'Adresse',
			'code_postal'     => 'Code postal',
			'ville'           => 'Ville',
			'siret'           => 'SIRET',
			'rcs_ville'       => 'Ville du greffe (RCS)',
			'tva_intra'       => 'TVA intracommunautaire',
		);
	}

	/**
	 * The fields that must be filled in before a document may be issued.
	 *
	 * The intracommunity VAT number is required only under the standard regime.
	 * A company in franchise en base charges no VAT, so it has no number to
	 * print, and demanding one would block the very regime the shop may turn out
	 * to be under. Under franchise the law wants the article 293 B mention
	 * instead, and `Vat` supplies it.
	 *
	 * A REGIME NOBODY HAS RECORDED REQUIRES EVERYTHING. "We could not look" is
	 * not "nothing is missing", and the conservative answer for an unknown
	 * regime is the stricter list.
	 *
	 * Everything else is required whatever the regime, including `capital` and
	 * `rcs_ville`, which strictly speaking only a commercial company has. If the
	 * business is an entreprise individuelle neither exists and this list is
	 * wrong; question 45 asks, and until it is answered the safe direction is to
	 * demand the fact rather than to skip it.
	 *
	 * @return string[]
	 */
	public static function required( string $regime ): array {
		$keys = array_keys( self::fields() );
		if ( Vat::FRANCHISE === $regime ) {
			$keys = array_values( array_diff( $keys, array( 'tva_intra' ) ) );
		}
		return $keys;
	}

	/**
	 * Which required fields are empty.
	 *
	 * @return string[] keys, in the order `fields()` declares them
	 */
	public static function missing( array $identity, string $regime ): array {
		$out = array();
		foreach ( self::required( $regime ) as $key ) {
			$value = trim( (string) ( $identity[ $key ] ?? '' ) );
			if ( '' === $value ) {
				$out[] = $key;
				continue;
			}
			/*
			 * A SIRET THAT IS NOT A SIRET IS NOT A FILLED-IN FIELD.
			 *
			 * Non-empty used to be enough, so twelve digits instead of fourteen
			 * passed the production gate as a complete identity: `siret()`
			 * returned '', `siren()` returned '', and the invoice printed
			 * "SIRET 123456789000" unformatted next to an "RCS Bobigny" with no
			 * number after it. An identifier that identifies nobody, on a
			 * document an accountant keeps for ten years. The length-and-digits
			 * check already existed; nothing was asking it.
			 */
			if ( 'siret' === $key && '' === self::siret( $value ) ) {
				$out[] = $key;
			}
		}
		return $out;
	}

	/**
	 * What to do with a document, given who we are and where this is running.
	 *
	 * @param string $environment `wp_get_environment_type()`: local, development,
	 *                            staging or production.
	 *
	 * @return array{action:string,missing:string[],labels:string[]}
	 */
	public static function verdict( array $identity, string $regime, string $environment ): array {
		$missing = self::missing( $identity, $regime );
		$fields  = self::fields();

		if ( empty( $missing ) ) {
			$action = self::ISSUE;
		} else {
			/*
			 * ANYTHING THAT IS NOT PRODUCTION STAMPS, including an environment
			 * this code has never heard of. `wp_get_environment_type()` returns
			 * `production` by default when nothing is configured, so an unknown
			 * value here means somebody set one on purpose, and the useful
			 * answer for a machine that is not the shop is a document with a
			 * warning across it rather than a refusal that stops the work.
			 */
			$action = 'production' === $environment ? self::REFUSE : self::STAMP;
		}

		return array(
			'action'  => $action,
			'missing' => $missing,
			'labels'  => array_map( static fn( string $k ): string => $fields[ $k ] ?? $k, $missing ),
		);
	}

	/**
	 * A SIRET, digits only, or '' when it is not one.
	 *
	 * Fourteen digits: nine of SIREN plus five of NIC. The Luhn key is NOT
	 * checked, on purpose. La Poste's own SIREN (356000000) famously fails Luhn,
	 * several administrations' do too, and refusing to record a number the
	 * associate reads off his own Kbis because our checksum disagrees would be
	 * this plugin telling a company it does not exist. Length and digits are
	 * what catch the real mistake, which is a phone number in the wrong box.
	 */
	public static function siret( string $raw ): string {
		$digits = preg_replace( '/\D/', '', $raw ) ?? '';
		return 14 === strlen( $digits ) ? $digits : '';
	}

	/** "123 456 824 00013", which is how a SIRET is printed. */
	public static function format_siret( string $siret ): string {
		$clean = self::siret( $siret );
		if ( '' === $clean ) {
			return $siret;
		}
		return substr( $clean, 0, 3 ) . "\u{00A0}" . substr( $clean, 3, 3 ) . "\u{00A0}"
			. substr( $clean, 6, 3 ) . "\u{00A0}" . substr( $clean, 9 );
	}

	/** The SIREN inside a SIRET: the RCS number a document prints. */
	public static function siren( string $siret ): string {
		$clean = self::siret( $siret );
		return '' === $clean ? '' : substr( $clean, 0, 9 );
	}

	/**
	 * Which version of the terms is in force, or ''.
	 *
	 * EMPTY UNTIL SOMEBODY WRITES THEM, exactly like every field above and for
	 * the same reason: a plausible "v1" recorded against a customer's
	 * acknowledgement would say we can produce the document they agreed to, and
	 * we cannot. Session 12 writes the CGV and sets this; `Waiver` records
	 * whatever it says, including nothing.
	 *
	 * A DATE AND NOT A NUMBER, when it is set: two revisions in one year both
	 * called "v2" is the whole failure mode of versioning a legal document, and
	 * `2026-09-01` cannot collide with itself.
	 */
	public static function cgv_version(): string {
		$stored = get_option( OPTION_LEGAL, array() );
		return is_array( $stored ) ? trim( (string) ( $stored['cgv_version'] ?? '' ) ) : '';
	}

	// ── WordPress side ───────────────────────────────────────────────────────

	/** The stored identity, merged over empty defaults. Never a placeholder. */
	public static function identity(): array {
		$defaults = array_fill_keys( array_keys( self::fields() ), '' );
		$stored   = get_option( OPTION_LEGAL, array() );
		if ( ! is_array( $stored ) ) {
			$stored = array();
		}
		$merged = array_merge( $defaults, array_intersect_key( $stored, $defaults ) );
		return array_map( static fn( $v ): string => trim( (string) $v ), $merged );
	}

	/**
	 * Where this code is running.
	 *
	 * Wrapped so the pure half can be tested without WordPress, and so the one
	 * fallback lives in one place: a WordPress old enough not to have the
	 * function is treated as production, which is the strict direction.
	 */
	public static function environment(): string {
		return function_exists( 'wp_get_environment_type' ) ? wp_get_environment_type() : 'production';
	}
}
