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
 * rule serves two callers. `tests/test-terms.php` runs it against the SHIPPED
 * DEFAULTS, inside `npm run ci`, which catches a repository that has drifted from
 * itself. `Admin::render_terms()` runs it against the LIVE configuration, on the
 * screen where every one of those figures is changed, which catches the operator
 * who has just made a published contract wrong. The second was missing for a day
 * and this docblock claimed it existed.
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
/*
 * `live_values()` reads the late-payment rate from here, because the conditions
 * promise there is not one and that promise has to be checked against the value
 * an operator can type. Declared rather than left to the plugin bootstrap: a
 * dependency that resolves only because something else loaded first breaks the
 * day somebody reorders the list.
 */
require_once __DIR__ . '/Invoice.php';

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
		/*
		 * A VALUE THE TERMS PROMISE IS ABSENT, which is a different claim from a
		 * value they state. Article 14 says « Aucun taux contractuel plus bas
		 * n'est prévu », so the invoice must cite the statutory rate. The billing
		 * screen has a « Taux des pénalités de retard » field whose own help text
		 * invites a number, and one typed there makes `Invoice::mentions()` print
		 * « au taux de 12 % l'an » on a document the same buyer receives, beside
		 * conditions saying there is no such rate. Two of our own documents
		 * contradicting each other about the same debt.
		 */
		'penalites_contractuelles' => 'vide',
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

	/**
	 * The version that must agree with what the shop does today: the newest.
	 *
	 * NOT « every version », which is what `tests/test-terms.php` used to assert
	 * and what stopped being possible the day a second version existed. A
	 * superseded version is a contract somebody accepted; comparing it with a
	 * shop that has legitimately moved on since is comparing two different
	 * moments and calling the difference a defect. What must be true of a
	 * superseded version is that it has not been TOUCHED, which is
	 * `fingerprint()` and `frozen_fingerprints()` below.
	 *
	 * The newest and not the one in force, so the check is the same on any day:
	 * a version dated in the future is the one about to bind, it is the one being
	 * reviewed, and it is exactly the one worth comparing with the code.
	 */
	public static function newest(): string {
		$all = self::versions();
		return array() === $all ? '' : (string) end( $all );
	}

	/** Every version but the newest: accepted, superseded, and unchangeable. */
	public static function superseded(): array {
		$all = self::versions();
		return count( $all ) < 2 ? array() : array_slice( $all, 0, -1 );
	}

	/**
	 * The fingerprint of a version file, byte for byte.
	 *
	 * THE WHOLE FILE and not the rendered text, because a superseded version is
	 * frozen in every respect: its articles, its pinned figures, and the comments
	 * that explain why it says what it says. A reviewer asked eighteen months
	 * later what a buyer agreed to reads this file, and a file whose reasoning
	 * was quietly rewritten answers a different question.
	 */
	public static function fingerprint( string $version ): string {
		if ( ! self::exists( $version ) ) {
			return '';
		}
		$raw = file_get_contents( self::dir() . $version . '.php' );
		return false === $raw ? '' : hash( 'sha256', $raw );
	}

	/**
	 * The recorded fingerprints of the versions that are no longer in force.
	 *
	 * A version joins this list the day it is superseded, and the check FAILS on
	 * a superseded version that is not in it. Fail closed: forgetting to record
	 * one has to be louder than recording the wrong one, because a missing entry
	 * is a contract nothing is watching.
	 *
	 * @return array<string,string>
	 */
	public static function frozen_fingerprints(): array {
		$path = self::dir() . 'figees.php';
		if ( ! is_readable( $path ) ) {
			return array();
		}
		$read = require $path;
		return is_array( $read ) ? $read : array();
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

			/*
			 * ZERO IS AN ABSENCE AND NOT A VALUE, and the published copy already
			 * knew it: `Content::slots()` drops the sentence of a threshold that
			 * has been cleared, because « Nous imprimons à partir de 0 pièces »
			 * is both false and absurd. The terms had no such rule, so a shop
			 * whose amount minimum was cleared would have had to publish « à
			 * partir de 0,00 € hors taxes » in a contract to keep this check
			 * green.
			 *
			 * Question 01's answer of 1 September 2026 is what needed it: « Le
			 * minimum est de 5 pièces par commande, sans minimum obligatoire de
			 * 50 EUR HT. » A cleared threshold is now checked the same way as
			 * `penalites_contractuelles`: the version must carry a sentence
			 * SAYING there is none, which is a promise a buyer can rely on, and
			 * silence is still refused.
			 */
			$absent = 'vide' === self::FORMATS[ $key ]
				|| ( is_numeric( $values[ $key ] ) && 0.0 === (float) $values[ $key ] );
			if ( $absent ) {
				$expected = 'vide' === self::FORMATS[ $key ] ? $expected : '';
			}

			/*
			 * A `vide` value is a promise that there is nothing to state. The
			 * fragment must be in the text, and the value must be empty; a value
			 * that has been filled in is the divergence, not a mismatched number.
			 */
			if ( $absent ) {
				if ( '' !== $expected ) {
					$out[] = array(
						'cle'     => $key,
						'attendu' => $expected,
						'texte'   => $said,
						'raison'  => 'le texte publié annonce qu’aucune valeur n’est fixée, et la boutique en applique une',
					);
					continue;
				}
				/*
				 * AND THE FRAGMENT MUST NOT STATE A FIGURE. The first version of
				 * this rule only asked that the declared fragment be present in
				 * the text, and the two tests below caught it within a minute: an
				 * operator who clears the free-delivery threshold makes the shop
				 * charge carriage on every basket, and « offerte à partir de
				 * 300,00 € hors taxes » is still written in the contract and
				 * still present in the text, so the check went green on the exact
				 * defect it exists for. An absence has to be pinned by a sentence
				 * ABOUT the absence, and a sentence about an absence carries no
				 * digits.
				 */
				if ( 1 === preg_match( '/\d/', $said ) ) {
					$out[] = array(
						'cle'     => $key,
						'attendu' => '',
						'texte'   => $said,
						'raison'  => 'la boutique n’applique plus aucune valeur ici, et le texte publié en annonce encore une',
					);
					continue;
				}
				if ( ! str_contains( $text, $said ) ) {
					$out[] = array(
						'cle'     => $key,
						'attendu' => '',
						'texte'   => $said,
						'raison'  => 'ce fragment n’est écrit nulle part dans le texte de cette version',
					);
				}
				continue;
			}

			if ( '' === $said || ! self::states( $said, $expected ) ) {
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
	 * Whether a fragment really states a value, rather than merely containing it.
	 *
	 * `str_contains` WAS WRONG AND THE CONSEQUENCE WAS MONEY.
	 *
	 * « 0,00 EUR » is a substring of « 300,00 EUR ». So an operator who cleared
	 * the « livraison offerte à partir de » field, which `Shipping` then reads as
	 * no franco at all, left the published conditions promising free delivery
	 * above three hundred euros while every basket was charged carriage, and this
	 * check reported nothing. « 0 % » is a substring of « 20 % », so the day the
	 * shop moves to the franchise en base the terms would keep publishing a
	 * twenty per cent rate while the invoice printed « TVA non applicable ».
	 * Both measured by running `Terms::checked()` over the real classes.
	 *
	 * A DIGIT MAY NOT TOUCH THE MATCH. The value has to sit on a boundary at both
	 * ends: nothing that is part of the same number may be adjacent to it. That
	 * is what separates « 300,00 EUR » from the « 0,00 EUR » inside it, and it
	 * costs one regular expression rather than a second way of writing numbers.
	 */
	public static function states( string $fragment, string $value ): bool {
		if ( '' === $value ) {
			return false;
		}
		$digit = '\d\x{202F}\x{00A0},.';
		$re    = '/(?<![' . $digit . '])' . preg_quote( $value, '/' ) . '(?![' . $digit . '])/u';
		return 1 === preg_match( $re, $fragment );
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
			case 'vide':
				return trim( (string) $value );
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
			'penalites_contractuelles' => (string) ( Invoice::config()['penalty_rate'] ?? '' ),
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
