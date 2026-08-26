<?php
/**
 * The conditions of sale, as dated versions rather than as a page.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A VERSION AND NOT A PAGE
 *
 * `Waiver::freeze()` writes `Legal::cgv_version()` onto every personalised order
 * at checkout, because the exclusion of the fourteen-day withdrawal right only
 * holds if we can show what the customer was told. A record that points at
 * « les conditions générales » is worth nothing eighteen months later if the
 * conditions have been edited since. So the text is not a WordPress page an
 * administrator can retype: it is a FILE PER VERSION under `data/cgv/`, named by
 * the date it takes effect, never edited once a customer has seen it, and always
 * retrievable at its own URL.
 *
 * A DATE AND NOT A NUMBER, which is `Legal::cgv_version()`'s own reasoning: two
 * revisions in one year both called v2 is the whole failure mode of versioning a
 * legal document, and `2026-09-01` cannot collide with itself.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE NUMBERS ARE FROZEN, AND THAT IS WHY THEY NEED A GUARD
 *
 * A version states a minimum order, a lead time, a tolerance and a VAT rate. The
 * shop computes all four somewhere else, and `CLAUDE.md` forbids two places
 * computing one rule. The usual answer here is `Content`'s: write a slot and
 * resolve it at render time. THAT ANSWER IS WRONG FOR A CONTRACT. A customer who
 * accepted the terms in September is owed September's terms; a page that
 * silently renders today's minimum under September's version number
 * misrepresents what they agreed to, and it does it invisibly.
 *
 * So the prose holds the figures, written out, and each version declares an
 * `accords` block: for every figure, WHERE the shop computes it and the exact
 * French fragment that must appear in the text. `checked()` compares the two.
 * When they disagree the answer is never to edit the version in force: it is to
 * publish a NEW dated version, which is exactly what the law wants anyway.
 *
 * `checked()` is pure and takes the resolved values as an argument, so the same
 * rule serves `tests/test-terms.php` (against the shipped defaults, in
 * `npm run ci`) and the shop (against the live configuration, where an operator
 * who changed a setting is told the published terms no longer match).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE IS NOT
 *
 * It is not legal advice and neither is what it serves. Every version carries
 * `PROJET` in its own header and the page prints it: these texts were drafted by
 * the people who wrote the code, they have not been read by a lawyer, and
 * question 18 of `QUESTIONS-ASSOCIE.md` asks for that reading. A draft that does
 * not say it is a draft is the one thing worse than no draft.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

require_once __DIR__ . '/Money.php';

final class Terms {

	/** The value keys a version may pin, and how each is written in French. */
	public const FORMATS = array(
		'minimum_pieces'           => 'int',
		'minimum_ht'               => 'eur',
		'tva'                      => 'pct',
		'devis_pieces'             => 'int',
		'devis_ht'                 => 'eur',
		'plafond_pieces'           => 'int',
		'delai_fabrication'        => 'int',
		'delai_transport'          => 'int',
		'franco_ht'                => 'eur',
		'bat_corrections'          => 'int',
		'bat_correction_ht'        => 'eur',
		'bat_lien_jours'           => 'int',
		'tolerance_cm'             => 'int',
		'acompte_ht'               => 'eur',
		'acompte_taux'             => 'pct',
		'conservation_devis_jours' => 'int',
	);

	/** Where the versions live, relative to the plugin root. */
	private const DIR = '/data/cgv/';

	/** Cached per request, because a page may ask twice. */
	private static array $loaded = array();

	// ── the register, pure ───────────────────────────────────────────────────

	/**
	 * Every version that exists, oldest first.
	 *
	 * READ FROM THE DIRECTORY rather than from a list in this file, so that
	 * adding a version is adding a file and cannot be half done. A name that is
	 * not a real calendar date is ignored: `2026-13-01.php` is a typo, and a
	 * typo that became a version in force would be a contract nobody can date.
	 *
	 * @return string[]
	 */
	public static function versions(): array {
		$found = glob( self::dir() . '*.php' );
		if ( false === $found ) {
			return array();
		}
		$out = array();
		foreach ( $found as $path ) {
			$name = basename( $path, '.php' );
			if ( self::is_date( $name ) ) {
				$out[] = $name;
			}
		}
		sort( $out );
		return $out;
	}

	/**
	 * The version in force on a given day, or '' when none is.
	 *
	 * `$today` is a parameter so the rule can be tested and so a version dated
	 * in the future can be committed, reviewed and merged before it applies.
	 * A version whose date has not arrived is NOT in force, which is the whole
	 * point of dating them.
	 */
	public static function in_force( string $today ): string {
		$best = '';
		foreach ( self::versions() as $version ) {
			if ( strcmp( $version, $today ) <= 0 ) {
				$best = $version;
			}
		}
		return $best;
	}

	/** Whether a string names a version we actually hold. */
	public static function exists( string $version ): bool {
		return self::is_date( $version ) && in_array( $version, self::versions(), true );
	}

	/**
	 * A version, whole.
	 *
	 * @return array{version:string,titre:string,articles:array,accords:array}|null
	 */
	public static function document( string $version ): ?array {
		if ( isset( self::$loaded[ $version ] ) ) {
			return self::$loaded[ $version ];
		}
		if ( ! self::exists( $version ) ) {
			return null;
		}
		/*
		 * NO `include` OF A PATH BUILT FROM INPUT until it has been checked
		 * against the list of versions that exist. `exists()` above is that
		 * check, and it runs first on purpose: a version string arrives from a
		 * URL.
		 */
		$doc = require self::dir() . $version . '.php';
		if ( ! is_array( $doc ) || empty( $doc['articles'] ) ) {
			return null;
		}
		$doc['version']      = $version;
		self::$loaded[ $version ] = $doc;
		return $doc;
	}

	/**
	 * Everything a version's articles say, as one string.
	 *
	 * Used by `checked()` and by the gate. Headings included, because a figure
	 * can legitimately live in one.
	 */
	public static function text( array $doc ): string {
		$out = array();
		foreach ( (array) ( $doc['articles'] ?? array() ) as $article ) {
			$out[] = (string) ( $article['titre'] ?? '' );
			foreach ( (array) ( $article['paragraphes'] ?? array() ) as $p ) {
				$out[] = (string) $p;
			}
			foreach ( (array) ( $article['liste'] ?? array() ) as $item ) {
				$out[] = (string) $item;
			}
		}
		return implode( "\n", $out );
	}

	/**
	 * Where the terms and the shop disagree.
	 *
	 * @param array $doc    a version, from `document()`.
	 * @param array $values the shop's current values, keyed as `FORMATS`.
	 *
	 * @return array<int,array{cle:string,attendu:string,texte:string,raison:string}>
	 *         empty when the published text still states what the code does.
	 */
	public static function checked( array $doc, array $values ): array {
		$text  = self::text( $doc );
		$out   = array();

		foreach ( (array) ( $doc['accords'] ?? array() ) as $accord ) {
			$key  = (string) ( $accord['cle'] ?? '' );
			$said = (string) ( $accord['texte'] ?? '' );

			if ( ! isset( self::FORMATS[ $key ] ) ) {
				$out[] = array(
					'cle'     => $key,
					'attendu' => '',
					'texte'   => $said,
					'raison'  => 'clé inconnue : ce contrôle ne sait pas d’où vient ce chiffre',
				);
				continue;
			}
			if ( ! array_key_exists( $key, $values ) ) {
				/*
				 * NOT SILENCE. A value the caller did not resolve is « we could
				 * not look », and this file's own brief says that is not the
				 * same result as « nothing is wrong ».
				 */
				$out[] = array(
					'cle'     => $key,
					'attendu' => '',
					'texte'   => $said,
					'raison'  => 'la boutique n’a pas fourni cette valeur, donc l’accord n’a pas pu être vérifié',
				);
				continue;
			}

			$expected = self::french( $values[ $key ], self::FORMATS[ $key ] );

			if ( '' === $said || ! str_contains( $said, $expected ) ) {
				$out[] = array(
					'cle'     => $key,
					'attendu' => $expected,
					'texte'   => $said,
					'raison'  => 'le fragment déclaré ne contient pas la valeur que la boutique applique',
				);
				continue;
			}
			if ( ! str_contains( $text, $said ) ) {
				$out[] = array(
					'cle'     => $key,
					'attendu' => $expected,
					'texte'   => $said,
					'raison'  => 'ce fragment n’est écrit nulle part dans le texte de cette version',
				);
			}
		}

		/*
		 * A VERSION THAT PINS NOTHING IS NOT A VERSION THAT AGREES. It is a
		 * version nobody checked, and the two must not print the same result.
		 */
		if ( empty( $doc['accords'] ) ) {
			$out[] = array(
				'cle'     => '',
				'attendu' => '',
				'texte'   => '',
				'raison'  => 'cette version n’épingle aucun chiffre, donc rien n’a été comparé',
			);
		}

		return $out;
	}

	/**
	 * A value, written the way the terms write it.
	 *
	 * The three shapes the shop actually publishes. `eur` takes integer cents,
	 * like everything else that holds money here; `pct` takes a rate in [0,1],
	 * like `Pricing`; `int` takes a count of pieces or of working days.
	 */
	public static function french( $value, string $as ): string {
		switch ( $as ) {
			case 'eur':
				return Money::format( (int) $value );
			case 'pct':
				return Money::number( ( (float) $value ) * 100, 0 ) . "\u{00A0}%";
			default:
				return Money::number( (float) $value, 0 );
		}
	}

	/** yyyy-mm-dd, and a real day. */
	private static function is_date( string $s ): bool {
		if ( ! preg_match( '/^(\d{4})-(\d{2})-(\d{2})$/', $s, $m ) ) {
			return false;
		}
		return checkdate( (int) $m[2], (int) $m[3], (int) $m[1] );
	}

	private static function dir(): string {
		return dirname( __DIR__ ) . self::DIR;
	}

	// ── the WordPress side ───────────────────────────────────────────────────

	/**
	 * The values the shop actually applies today.
	 *
	 * READ THROUGH `config()` AND NOT `default_config()`, because an operator who
	 * raised the order minimum in the admin has changed what the shop enforces,
	 * and the published terms are then wrong even though the repository is
	 * self-consistent. The pure test uses the defaults; this uses the truth.
	 *
	 * @return array<string,int|float>
	 */
	public static function live_values(): array {
		/*
		 * EACH THROUGH ITS OWN LIVE READER, and they are not all called the same
		 * thing. `Settings::pricing()` also folds the VAT timeline over the price
		 * config, which is what the shop really charges; `Ledger::config()` is
		 * where the deposit rule is read. Calling `Pricing::config()` here, which
		 * does not exist, was a guess that a fatal caught.
		 */
		$pricing    = Settings::pricing();
		$production = Production::config();
		$shipping   = Shipping::config();
		$bat        = Bat::config();
		$settlement = Ledger::config();

		return array(
			'minimum_pieces'           => (int) $pricing['min_qty'],
			'minimum_ht'               => (int) $pricing['min_ht'],
			'tva'                      => (float) $pricing['vat_rate'],
			'devis_pieces'             => (int) $pricing['quote_from_qty'],
			'devis_ht'                 => (int) $pricing['quote_from_ht'],
			'plafond_pieces'           => (int) $pricing['max_qty'],
			'delai_fabrication'        => (int) $production['lead_days']['standard'],
			'delai_transport'          => (int) $production['ship_days'],
			'franco_ht'                => (int) $shipping['free_from_ht'],
			'bat_corrections'          => (int) $bat['corrections_incluses'],
			'bat_correction_ht'        => (int) $bat['correction_ht'],
			'bat_lien_jours'           => (int) $bat['lien_jours'],
			'tolerance_cm'             => (int) $bat['tolerance_position_cm'],
			'acompte_ht'               => (int) $settlement['deposit_from_ht'],
			'acompte_taux'             => (float) $settlement['deposit_rate'],
			'conservation_devis_jours' => Quote::KEEP_DAYS,
		);
	}

	/**
	 * Today, in the shop's own timezone.
	 *
	 * `wp_date` and not `gmdate`: a version taking effect on 1 September takes
	 * effect at midnight in Paris, and a shop that read UTC would have applied
	 * it two hours early in summer. Two hours is enough for one order.
	 */
	public static function today(): string {
		return function_exists( 'wp_date' ) ? (string) wp_date( 'Y-m-d' ) : gmdate( 'Y-m-d' );
	}

	/** The version in force right now, or ''. */
	public static function current(): string {
		return self::in_force( self::today() );
	}

	/**
	 * The permalink of a version, or of the terms in general.
	 *
	 * A version is addressable as `/cgv/?v=2026-09-01`. A query argument rather
	 * than a path segment because the page is an ordinary WordPress page and a
	 * rewrite rule for a document nobody links to daily is machinery to
	 * maintain for nothing.
	 */
	public static function url( string $version = '' ): string {
		$page = get_page_by_path( Pages::CGV );
		if ( ! $page instanceof \WP_Post || 'publish' !== $page->post_status ) {
			return '';
		}
		$url = (string) get_permalink( $page );
		return '' === $version ? $url : add_query_arg( 'v', $version, $url );
	}
}
