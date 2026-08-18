<?php
/**
 * A floor that is not the same everywhere.
 *
 * The Bible's chapter 1 asks for it in one sentence and means six: "Le système
 * doit pouvoir définir un plancher : par catégorie ; par technique ; par
 * commercial ; par taille de commande ; par type de client ; par niveau
 * d'urgence." Its data model names the entity `price_rule` and gives it a
 * scope, selectors, the two rates it sets, a validity window, a priority and an
 * active flag. This is that, and nothing more than that.
 *
 * ── THE ONE THING IN THIS ENGINE THAT CAN LOWER A FLOOR ──────────────────────
 *
 * Everything else in the cost model can only push the floor UP or refuse to
 * state one. A rule can pull it down, deliberately, which is what it is for: a
 * high-volume family really does need a thinner minimum contribution. That
 * makes three properties non-negotiable, and they are the reason this file
 * looks the way it does.
 *
 *   IT IS ALWAYS TRACEABLE. `apply()` returns WHICH rule won, the report
 *   freezes it, and the order panel prints it. A floor nobody can explain is a
 *   floor nobody can audit.
 *
 *   A TIE IS BROKEN TOWARDS THE STRICTER RULE. Priority is the operator's tool
 *   and it wins first. When two rules are equally prioritised and equally
 *   specific, picking "the first one written" would make an arbitrary choice
 *   between two floors; picking the higher minimum contribution makes the safe
 *   one. The floor depends on that rate alone (see `Margin::floor_price_rate`),
 *   so "higher k" and "higher floor" are the same sentence.
 *
 *   A RULE OVERRIDES ONLY WHAT IT SETS. An empty field is not a zero. A rule
 *   that names a target margin and leaves the contribution blank keeps the
 *   shop's contribution, because a blank field storing 0 % would silently take
 *   the floor down to the bare cost.
 *
 * ── WHAT A SELECTOR MEANS ────────────────────────────────────────────────────
 *
 * An EMPTY selector matches everything, which is what makes a general rule
 * writable. A non-empty one must equal the order's fact exactly. An order whose
 * fact is UNKNOWN (a mixed-family order has no single family) therefore matches
 * only rules that do not select on it, which is the conservative reading: a
 * rule written for t-shirts has not been shown to apply to a basket that is
 * half sweatshirts.
 *
 * Pure by construction: no WordPress function is called here, so it runs under
 * `php tests/run.php` with no bootstrap.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

require_once __DIR__ . '/Money.php';

final class PriceRule {

	/**
	 * The equality selectors, with the French label the screen shows.
	 *
	 * The size of the order is not here because it is a RANGE and not an
	 * equality, and the chapter's own model agrees: it gives `quantity_min et
	 * max` beside the rest.
	 */
	public const SELECTORS = array(
		'famille'    => 'Famille de produits',
		'technique'  => 'Technique',
		'commercial' => 'Commercial',
		'client'     => 'Type de client',
		'urgence'    => 'Niveau d’urgence',
	);

	/**
	 * The families a rule may name, in ONE vocabulary.
	 *
	 * There were two, and they were disjoint. The catalogue importer writes
	 * `_teeshoop_family` with tee/polo/sweat/shirt/other; the studio writes
	 * `_teeshoop_garment` with tee/hoodie/custom; measured on the mirror, not one
	 * product carries both. So "famille = sweat" would have matched nothing the
	 * studio sells and "famille = hoodie" nothing the catalogue imports, though
	 * they are the same garment, and a rule written against either would have sat
	 * in the table doing nothing for ever.
	 *
	 * `Costing::facts()` maps the studio's word onto the catalogue's before it
	 * asks, and this list is the catalogue's, plus the one thing the catalogue
	 * has no word for: a garment the customer sends us.
	 */
	public const FAMILIES = array(
		'tee'    => 'T-shirts',
		'polo'   => 'Polos',
		'sweat'  => 'Sweats et capuches',
		'shirt'  => 'Chemises',
		'other'  => 'Autres textiles',
		'custom' => 'Vêtement fourni par le client',
	);

	/**
	 * The techniques a rule may name.
	 *
	 * ONE, and that is not a placeholder. The Bible names six (DTF, flocage,
	 * vinyle, sublimation, broderie, sous-traitance) and this shop produces one:
	 * the studio emits DTF transfers and the cost model has a single `marquage`
	 * component computed from film metres. A rule naming a technique the shop
	 * cannot produce would match nothing for ever, so the screen offers the one
	 * it can and says why. Question 12 opens the others.
	 */
	public const TECHNIQUES = array( 'dtf' => 'DTF' );

	/**
	 * The kinds of client a rule may name.
	 *
	 * NOT INVENTED, but not confirmed either. Chapter 1 asks for a floor "par
	 * type de client" and never enumerates them; these four are the ones the
	 * corpus already uses. `particulier` and `professionnel` are question 01's
	 * own distinction, `collectivite` is question 15's "mandat administratif
	 * (mairies, écoles, hôpitaux)", and `grand_compte` is question 16's. Nothing
	 * on an order carries one today, so the field starts empty and an empty
	 * field matches only rules that do not select on it.
	 */
	public const CLIENTS = array(
		'particulier'  => 'Particulier',
		'professionnel' => 'Professionnel',
		'grand_compte' => 'Grand compte',
		'collectivite' => 'Collectivité',
	);

	/**
	 * The urgency levels a rule may name, from the chapter's own "Express et
	 * urgence" section and question 14.
	 *
	 * IT SELECTS A FLOOR AND NOTHING ELSE. It was going to choose the film's
	 * country too, since the chapter says France for a hurry and Spain for the
	 * standard, and that would have been a cost of 9,00 EUR the linear metre
	 * instead of 17,00 whenever somebody ticked "standard": 44 % off the film on
	 * a twelve-metre order, off the direct cost, and off the floor. A dropdown is
	 * not evidence about which roll was bought. The origin stays where a purchase
	 * can be recorded against it.
	 */
	public const URGENCES = array(
		'standard' => 'Standard',
		'express'  => 'Express',
		'urgent'   => 'Urgent',
	);

	/**
	 * The studio's word for a garment, in the catalogue's vocabulary.
	 *
	 * A hoodie is a sweat: the catalogue has one family for both and the studio
	 * has one garment for the hooded one. `custom` has no catalogue family
	 * because the customer's own shirt was never bought from anybody, so it
	 * keeps its own word. Anything else is unknown, which matches no rule that
	 * selects on a family.
	 *
	 * HERE AND NOT IN `Costing`, so it can be tested without a WordPress: a
	 * broken hoodie mapping makes every sweat rule silently not apply, and the
	 * only test that touched it went through the one key where the map is the
	 * identity.
	 */
	public static function family_of_garment( string $garment ): string {
		$map = array(
			'tee'    => 'tee',
			'hoodie' => 'sweat',
			'custom' => 'custom',
		);
		return $map[ $garment ] ?? '';
	}

	/**
	 * How many rules a shop may hold.
	 *
	 * Not a performance limit: fifty rules is already more than anybody can hold
	 * in their head, and a hundred overlapping floors is not a pricing policy,
	 * it is a way to lose track of one. The screen says so when the list is
	 * full.
	 */
	public const MAX_RULES = 50;

	/**
	 * Clean one rule as it comes out of a form or an option, or null.
	 *
	 * Null for a row that names nothing and sets nothing, which is how the
	 * screen's always-present empty row disappears again instead of being
	 * stored as a rule that matches every order and changes nothing.
	 */
	public static function normalise( mixed $raw ): ?array {
		if ( ! is_array( $raw ) ) {
			return null;
		}

		$rule = array(
			'id'       => self::text( $raw['id'] ?? '', 40 ),
			'label'    => self::text( $raw['label'] ?? '', 80 ),
			'priority' => max( 0, min( 999, (int) ( $raw['priority'] ?? 0 ) ) ),
			'active'   => ! empty( $raw['active'] ),
			'from'     => self::date( $raw['from'] ?? '' ),
			'to'       => self::date( $raw['to'] ?? '' ),
			'qty_min'  => max( 0, (int) ( $raw['qty_min'] ?? 0 ) ),
			'qty_max'  => max( 0, (int) ( $raw['qty_max'] ?? 0 ) ),
		);

		foreach ( array_keys( self::SELECTORS ) as $key ) {
			$rule[ $key ] = self::text( $raw[ $key ] ?? '', 40 );
		}

		/*
		 * NULL AND NOT ZERO for a rate the operator left blank. A rule that sets
		 * neither rate is still a rule (it can carry a validity window and a
		 * label while somebody decides), but a blank stored as 0 % would take
		 * the floor of everything it matches down to the bare cost.
		 */
		$rule['target_margin_rate']    = self::rate( $raw['target_margin_rate'] ?? null );
		$rule['min_contribution_rate'] = self::rate( $raw['min_contribution_rate'] ?? null );

		/*
		 * A NAME IS NOT A CRITERION AND NOT A RATE. Counting the label as one
		 * meant that typing a name into the always-present empty block and
		 * saving stored a live rule with no selectors and no rates, which then
		 * outranked, and silenced, every rule that actually cut a floor.
		 */
		$sets     = null !== $rule['target_margin_rate'] || null !== $rule['min_contribution_rate'];
		$selects  = false;
		foreach ( array_keys( self::SELECTORS ) as $key ) {
			$selects = $selects || '' !== $rule[ $key ];
		}
		$selects = $selects || $rule['qty_min'] > 0 || $rule['qty_max'] > 0;

		return ( $sets || $selects ) ? $rule : null;
	}

	/** A stored list, cleaned, capped and in the order it was written. */
	public static function normalise_all( mixed $raw ): array {
		if ( ! is_array( $raw ) ) {
			return array();
		}
		$out = array();
		foreach ( $raw as $row ) {
			$rule = self::normalise( $row );
			if ( null !== $rule ) {
				$out[] = $rule;
			}
			if ( count( $out ) >= self::MAX_RULES ) {
				break;
			}
		}
		return $out;
	}

	/**
	 * Whether one rule applies to one order today.
	 *
	 * @param array  $rule  a normalised rule.
	 * @param array  $facts the order's own facts, from `Costing::facts()`.
	 * @param string $today YYYY-MM-DD.
	 */
	public static function matches( array $rule, array $facts, string $today ): bool {
		if ( empty( $rule['active'] ) ) {
			return false;
		}
		if ( '' !== (string) $rule['from'] && $today < (string) $rule['from'] ) {
			return false;
		}
		if ( '' !== (string) $rule['to'] && $today > (string) $rule['to'] ) {
			return false;
		}

		$qty = (int) ( $facts['quantite'] ?? 0 );
		if ( (int) $rule['qty_min'] > 0 && $qty < (int) $rule['qty_min'] ) {
			return false;
		}
		if ( (int) $rule['qty_max'] > 0 && $qty > (int) $rule['qty_max'] ) {
			return false;
		}

		foreach ( array_keys( self::SELECTORS ) as $key ) {
			$want = (string) $rule[ $key ];
			if ( '' === $want ) {
				continue;
			}
			/*
			 * An order whose fact is UNKNOWN matches no rule that selects on it.
			 * A mixed-family basket has no family, and a rule written for
			 * t-shirts has not been shown to apply to it.
			 */
			if ( self::same( $want, (string) ( $facts[ $key ] ?? '' ) ) ) {
				continue;
			}
			return false;
		}

		return true;
	}

	/**
	 * The rule that wins, or null when none applies.
	 *
	 * Priority first, because that is the operator's tool. Then specificity,
	 * because a rule that names four things is a more considered statement than
	 * one that names one. Then the STRICTER of the two, which is the safe way to
	 * settle an arbitrary choice; `$base_contribution` is what a rule that sets
	 * no contribution is effectively asking for. Then the order it was written
	 * in, so the answer is total and never depends on a sort's stability.
	 */
	public static function best( array $rules, array $facts, string $today, float $base_contribution ): ?array {
		$winner = null;
		$best   = null;
		$index  = 0;

		foreach ( $rules as $rule ) {
			++$index;
			if ( ! self::matches( $rule, $facts, $today ) ) {
				continue;
			}
			/*
			 * A RULE THAT SETS NO RATE CANNOT WIN, because winning is all it
			 * would do. Specificity is compared before the rates are, so a rule
			 * naming three selectors and deciding nothing outranked one naming a
			 * single family and cutting the floor: measured on the worked
			 * example, 750,00 EUR became 428,57 EUR, decided by a rule that
			 * changes no number. A rule with both fields blank is a scope
			 * somebody was still thinking about, and it now suppresses nothing.
			 */
			if ( ! self::decides( $rule ) ) {
				continue;
			}
			$here = array(
				'priority'     => (int) ( $rule['priority'] ?? 0 ),
				'specificity'  => self::specificity( $rule ),
				'contribution' => null === ( $rule['min_contribution_rate'] ?? null )
					? $base_contribution
					: (float) $rule['min_contribution_rate'],
				// Earlier wins, so the comparison is written on a value that
				// grows the other way.
				'written'      => -$index,
			);

			/*
			 * SPELT OUT rather than compared as two arrays. PHP will compare
			 * arrays with `>`, key by key, and the result depends on key order
			 * and on both operands having the same keys: a total order that
			 * decides a floor price is not a thing to leave to that.
			 */
			if ( null === $best || self::outranks( $here, $best ) ) {
				$best   = $here;
				$winner = $rule;
			}
		}

		return $winner;
	}

	/** Strictly better, on the four criteria in order. */
	private static function outranks( array $a, array $b ): bool {
		foreach ( array( 'priority', 'specificity', 'contribution', 'written' ) as $key ) {
			if ( $a[ $key ] > $b[ $key ] ) {
				return true;
			}
			if ( $a[ $key ] < $b[ $key ] ) {
				return false;
			}
		}
		return false;
	}

	/** Whether a rule changes any rate at all. One that does not decides nothing. */
	public static function decides( array $rule ): bool {
		return null !== ( $rule['target_margin_rate'] ?? null ) || null !== ( $rule['min_contribution_rate'] ?? null );
	}

	/** How many things a rule names. Ties are settled towards the considered one. */
	public static function specificity( array $rule ): int {
		$n = 0;
		foreach ( array_keys( self::SELECTORS ) as $key ) {
			if ( '' !== (string) $rule[ $key ] ) {
				++$n;
			}
		}
		if ( (int) $rule['qty_min'] > 0 || (int) $rule['qty_max'] > 0 ) {
			++$n;
		}
		return $n;
	}

	/**
	 * The rates in force for this order, and which rule set them.
	 *
	 * `$base` is `Costing::rules()`: the shop's global rates with this order's
	 * own commission rate already in it. A rule replaces at most the two rates
	 * the chapter gives it, never the commission (which is the salesperson's
	 * contract, not a pricing policy) and never the discount ceiling.
	 *
	 * @return array{rules:array,rule:?array}
	 */
	public static function apply( array $base, array $rules, array $facts, string $today ): array {
		$rule = self::best( $rules, $facts, $today, (float) ( $base['min_contribution_rate'] ?? 0 ) );
		if ( null === $rule ) {
			return array(
				'rules' => $base,
				'rule'  => null,
			);
		}

		$out = $base;
		if ( null !== ( $rule['target_margin_rate'] ?? null ) ) {
			$out['target_margin_rate'] = (float) $rule['target_margin_rate'];
		}
		if ( null !== ( $rule['min_contribution_rate'] ?? null ) ) {
			$out['min_contribution_rate'] = (float) $rule['min_contribution_rate'];
		}

		return array(
			'rules' => $out,
			/*
			 * FROZEN WITH ITS RATES, not merely with its id. A report has to stay
			 * explainable after the rule that produced it has been edited or
			 * deleted, and an id alone points at nothing then.
			 */
			'rule'  => array(
				'id'                    => (string) $rule['id'],
				'label'                 => (string) $rule['label'],
				'target_margin_rate'    => $rule['target_margin_rate'] ?? null,
				'min_contribution_rate' => $rule['min_contribution_rate'] ?? null,
			),
		);
	}

	/**
	 * Whether a set of rates has no solution: keeping `k` of the price after
	 * paying `c` of the margin away is impossible once k ≥ 1 − c.
	 *
	 * Checked against the HIGHEST commission rate the shop pays, because a rule
	 * that is fine against a 12 % reassort and impossible against a 40 % first
	 * order breaks the day one is attributed.
	 *
	 * REPORTED, NOT REFUSED. The screen names such a rule twice, in its own block
	 * and at the top of the section, and `Costing` reports no floor at all rather
	 * than a wrong one. Refusing to store it would throw away what the operator
	 * typed while they work out which of the two numbers to move, and the two
	 * places it is named are what stop it being silent.
	 */
	public static function insoluble( float $min_contribution_rate, float $commission_rate ): bool {
		return $min_contribution_rate >= 1 - $commission_rate;
	}

	/**
	 * Every rule that cannot work against the commission rates in force.
	 *
	 * Returns the labels, so the screen can name them rather than say that
	 * something somewhere is wrong.
	 */
	public static function impossible( array $rules, array $base, float $worst_commission ): array {
		$bad = array();
		foreach ( $rules as $rule ) {
			$k = null === ( $rule['min_contribution_rate'] ?? null )
				? (float) ( $base['min_contribution_rate'] ?? 0 )
				: (float) $rule['min_contribution_rate'];
			if ( self::insoluble( $k, $worst_commission ) ) {
				$bad[] = '' !== (string) $rule['label'] ? (string) $rule['label'] : (string) $rule['id'];
			}
		}
		return $bad;
	}

	// ── Reading a form field ─────────────────────────────────────────────────

	private static function text( mixed $raw, int $max ): string {
		$text = trim( (string) $raw );
		return '' === $text ? '' : mb_substr( $text, 0, $max );
	}

	/** A real calendar day, or '' for "no bound". */
	private static function date( mixed $raw ): string {
		$text = trim( (string) $raw );
		if ( 1 !== preg_match( '/^\d{4}-\d{2}-\d{2}$/', $text ) ) {
			return '';
		}
		$date = \DateTimeImmutable::createFromFormat( '!Y-m-d', $text, new \DateTimeZone( 'UTC' ) );
		return $date && $date->format( 'Y-m-d' ) === $text ? $text : '';
	}

	/**
	 * A rate the operator typed as a percentage, or NULL when the field is
	 * empty or unreadable.
	 *
	 * `Money::parse_eur` is the shop's one parser that accepts a French comma
	 * and says when it could not read a field. Null is the answer that leaves
	 * the shop's own rate in force; a silent 0 would be a floor at the cost.
	 */
	private static function rate( mixed $raw ): ?float {
		if ( is_float( $raw ) || is_int( $raw ) ) {
			$value = (float) $raw;
			return ( $value >= 0 && $value < 1 ) ? $value : null;
		}
		$cents = Money::parse_eur( (string) $raw );
		if ( null === $cents ) {
			return null;
		}
		$rate = $cents / 100 / 100;
		return ( $rate >= 0 && $rate < 1 ) ? $rate : null;
	}

	/**
	 * Selectors compare on meaning, not on how somebody typed it.
	 *
	 * `mb_strtolower` and not `strcasecmp`, which folds ASCII only: a rule
	 * written for "Éric" against an order reading "éric" compared as two
	 * different salespeople and matched nothing, for ever, with nothing on
	 * either screen to say so. French names are exactly where that bites.
	 */
	private static function same( string $a, string $b ): bool {
		// No empty-string guard: `$a` is non-empty by the time this is called
		// (matches() skips empty selectors), so an empty fact simply differs.
		// A clause that can never change an answer is not a safety net, it is a
		// sentence claiming a check that is not happening.
		return mb_strtolower( trim( $a ), 'UTF-8' ) === mb_strtolower( trim( $b ), 'UTF-8' );
	}
}
