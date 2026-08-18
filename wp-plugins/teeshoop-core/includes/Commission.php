<?php
/**
 * What a salesperson earns, on money that has actually arrived.
 *
 * The Bible states the base twice and both times as an exclusion: "La commission
 * est calculée sur la marge contributive encaissée, jamais sur le TTC et
 * idéalement jamais sur le seul chiffre d'affaires" (chapter 1), and "commission
 * commerciale calculée uniquement sur l'encaissement réel" (chapter 2). Three
 * bases are therefore forbidden and one is required, and the difference between
 * them on a single order is most of what a salesperson gets paid.
 *
 * On the chapter's own worked example: 750 EUR TTC, 625 EUR HT, 250 EUR of cost,
 * 375 EUR of contributive margin. At 40 %, commission on the TTC would be
 * 300 EUR, on the HT 250 EUR, and on the margin 150 EUR. The shop's whole result
 * before fixed costs is 225 EUR, so two of those three readings pay out more
 * than the order earns.
 *
 * ── WHY THE COMMISSION IS A STATE AND NOT AN AMOUNT ──────────────────────────
 *
 * "La commission devient provisoire à l'encaissement, puis définitive lorsque :
 * le délai de contestation interne est passé ; aucun remboursement significatif
 * n'est en cours ; les coûts réels ont été renseignés ; la commande a été livrée
 * ou clôturée." Four conditions, all four of which can be false on an order that
 * has been paid in full. So an amount alone cannot be paid out, and this file
 * returns the amount WITH the state and with the conditions that are still open.
 *
 * ── THE ONE THING THE BIBLE DOES NOT SAY, AND WE HAD TO DECIDE ───────────────
 *
 * What a PARTIAL payment earns. An order can sit on a deposit for weeks
 * (Settlement.php), and "sur l'encaissement réel" has two readings: nothing
 * until the whole thing has arrived, or a share of the margin proportional to
 * what has. We take the second, pro-rata on the TTC actually received, because
 * the first makes the commission a step function that pays 0 EUR on a 3 000 EUR
 * deposit and the entire amount on the last cent. Question 29 now asks him to
 * confirm it, and `accrue()` is one line to change if he says otherwise.
 *
 * Pro-rata on the TTC received against the TTC due, applied to an HT margin: the
 * ratio is dimensionless, and it is the only ratio we can observe, because a
 * customer transfers one amount and does not tell us which part of the order it
 * is for.
 *
 * ── WHAT NEVER LEAVES THIS BUILDING ──────────────────────────────────────────
 *
 * Nothing here is ever rendered to a customer. The Bible lists "commercial et
 * commission estimée" among a devis's mandatory contents, which read literally
 * prints our cost structure on a document the buyer negotiates from. Question 39
 * settles it and the written default is that the name appears and the commission
 * does not; `scripts/php-guard.mjs` carries the word itself as a needle in every
 * directory that renders, so a template that started to would fail the build.
 *
 * Pure by construction: no WordPress function is called here.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

require_once __DIR__ . '/Money.php';
require_once __DIR__ . '/Cost.php';

final class Commission {

	/**
	 * The Bible's five kinds of sale, with the French label an operator picks.
	 *
	 * "participation uniquement à la production : rémunération séparée selon un
	 * barème de production" is the fifth, and it is here with a rate of zero
	 * rather than absent: a production-only involvement is a real answer to
	 * "who sold this", and leaving it out would force an operator to pick one of
	 * the four that pay.
	 */
	public const SALE_TYPES = array(
		'premiere'   => 'Première commande apportée et suivie',
		'nouvelle'   => 'Nouvelle commande avec action de vente',
		'reassort'   => 'Réassort simple',
		'site'       => 'Commande autonome du site',
		'production' => 'Participation à la production seule',
	);

	/** The states of the Bible's acquisition rule. */
	public const NONE        = 'aucune';
	public const PROVISIONAL = 'provisoire';
	public const DEFINITIVE  = 'definitive';

	/**
	 * The Bible's five reprise cases, verbatim in meaning.
	 *
	 * Only the last one is a FORMULA: if the real margin comes in under the
	 * estimate, recomputing on the real margin is automatic and needs nobody's
	 * judgement, which is why `accrue()` takes the cost basis as an argument. The
	 * other four are decisions with amounts a person has to enter, and the Bible
	 * gives no scale for any of them. Listing them here rather than inventing
	 * four formulas is the honest shape: "Les règles doivent être écrites dans le
	 * contrat et appliquées de façon transparente", and the contract is question
	 * 30.
	 */
	public const REPRISE = array(
		'remboursement' => 'Le client a été remboursé',
		'non_chiffre'   => 'Prestation promise et non chiffrée',
		'remise'        => 'Remise appliquée sans autorisation',
		'saisie'        => 'Erreur de saisie imputable au commercial',
		'marge_reelle'  => 'Marge réelle inférieure à la marge estimée',
	);

	/**
	 * Shipped defaults, question 29's written answer.
	 *
	 * "40 % sur la première commande, 25 % sur une nouvelle commande, 12 % sur un
	 * réassort, 0 % sur une commande passée seule sur le site ; attribution du
	 * client pendant 12 mois ; commission définitive 30 jours après livraison
	 * sans litige."
	 *
	 * The Bible gives ranges for two of them (20 to 30 % for a new order, 10 to
	 * 15 % for a reassort) and question 29's default picks the middle of each.
	 * A range is not a rate, and a commission that is computed live in front of
	 * the person it pays cannot be a range.
	 */
	public static function default_config(): array {
		return array(
			'rates'            => array(
				'premiere'   => 0.40,
				'nouvelle'   => 0.25,
				'reassort'   => 0.12,
				'site'       => 0.00,
				'production' => 0.00,
			),
			/** How long a customer stays attributed to the rep who brought them. */
			'attribution_days' => 365,
			/** Days after delivery before a provisional commission becomes definitive. */
			'definitive_after_days' => 30,
		);
	}

	/**
	 * Merge a stored partial over the defaults, with `rates` merging key by key.
	 *
	 * `rates` is a fixed set of five named rates and not a collection, so a form
	 * that posts four of them must not delete the fifth. See the same note, and
	 * the 291,94 EUR it cost, above `Cost::PARAMETER_MAPS`.
	 */
	public static function merge_config( array $stored ): array {
		$config = self::default_config();
		foreach ( $stored as $key => $value ) {
			if ( ! array_key_exists( $key, $config ) ) {
				continue;
			}
			$config[ $key ] = ( 'rates' === $key && is_array( $value ) )
				? array_merge( $config[ $key ], $value )
				: $value;
		}
		return $config;
	}

	/**
	 * The rate for a kind of sale, or NULL when the kind is not one we know.
	 *
	 * Null and not zero, and not a default. An order whose sale type is missing
	 * or misspelt has an UNDECIDED commission, and the screen has to say so; a
	 * silent 0 would look like a settled answer, and a silent 40 % would pay one.
	 */
	public static function rate( string $sale_type, array $config ): ?float {
		$rates = (array) ( $config['rates'] ?? array() );
		if ( ! isset( self::SALE_TYPES[ $sale_type ] ) || ! isset( $rates[ $sale_type ] ) ) {
			return null;
		}
		$rate = (float) $rates[ $sale_type ];
		return ( $rate >= 0 && $rate < 1 ) ? $rate : null;
	}

	/**
	 * The share of the order that has actually been paid, in [0, 1].
	 *
	 * An overpayment is clamped rather than allowed to pay a commission on money
	 * we owe back, and an order with no total due earns nothing rather than
	 * dividing by zero.
	 */
	public static function collected_share( int $received_ttc, int $total_ttc ): float {
		if ( $total_ttc <= 0 || $received_ttc <= 0 ) {
			return 0.0;
		}
		return min( 1.0, $received_ttc / $total_ttc );
	}

	/**
	 * What is owed to the salesperson today, and what will be owed in full.
	 *
	 * $margin_ht is the CONTRIBUTIVE margin: what the order was sold for HT minus
	 * its real direct costs. Never the revenue, never the price. A negative
	 * margin earns nothing: nobody takes a share of a loss, and the shop that
	 * paid one would be paying twice for the same mistake.
	 *
	 * @param int    $margin_ht    contributive margin, cents HT.
	 * @param float  $rate         the rate for this kind of sale.
	 * @param int    $received_ttc what has arrived.
	 * @param int    $total_ttc    what is due in total.
	 * @param string $basis        'reel' or 'estime': whether $margin_ht was
	 *                             computed on real costs or on estimates. Carried
	 *                             through untouched, because a commission on an
	 *                             estimated margin can never be definitive.
	 */
	public static function accrue( int $margin_ht, float $rate, int $received_ttc, int $total_ttc, string $basis = Cost::ESTIMATED ): array {
		$full  = $margin_ht > 0 ? Money::pct( $margin_ht, $rate ) : 0;
		$share = self::collected_share( $received_ttc, $total_ttc );

		return array(
			'rate'          => $rate,
			'margin_ht'     => $margin_ht,
			'basis'         => $basis,
			'full_ht'       => $full,
			'collected'     => $share,
			/*
			 * Rounded once, at the end, from the full amount rather than by
			 * commissioning a pro-rated margin. Two roundings on the same money
			 * is how a ledger of instalments stops summing to the total.
			 */
			'earned_ht'     => Money::round( $full * $share ),
			'remaining_ht'  => $full - Money::round( $full * $share ),
		);
	}

	/**
	 * Where a commission stands, against the Bible's four conditions.
	 *
	 * $facts:
	 *   collected        float in [0, 1] from `accrue`.
	 *   delivered_on     'YYYY-MM-DD' or '' when it has not been.
	 *   today            'YYYY-MM-DD'.
	 *   refund_pending   bool.
	 *   costs_real       bool: have the real costs been entered.
	 *
	 * Returns the state and the conditions still open, in French, so a screen can
	 * say WHY a commission is not payable instead of only that it is not.
	 */
	public static function state( array $facts, array $config ): array {
		$collected = (float) ( $facts['collected'] ?? 0 );
		$open      = array();

		if ( $collected <= 0 ) {
			return array(
				'state' => self::NONE,
				'open'  => array( 'Aucun encaissement' ),
			);
		}

		if ( $collected < 1.0 ) {
			$open[] = 'Solde non encaissé';
		}

		$delivered_on = (string) ( $facts['delivered_on'] ?? '' );
		if ( '' === $delivered_on ) {
			$open[] = 'Commande non livrée ou non clôturée';
		} else {
			$days = self::days_between( $delivered_on, (string) ( $facts['today'] ?? '' ) );
			$wait = (int) ( $config['definitive_after_days'] ?? 0 );
			if ( null === $days ) {
				$open[] = 'Date de livraison illisible';
			} elseif ( $days < $wait ) {
				$open[] = sprintf( 'Délai de contestation en cours (%d jour(s) restant(s))', $wait - $days );
			}
		}

		if ( ! empty( $facts['refund_pending'] ) ) {
			$open[] = 'Remboursement en cours';
		}
		if ( empty( $facts['costs_real'] ) ) {
			$open[] = 'Coûts réels non renseignés';
		}

		return array(
			'state' => empty( $open ) ? self::DEFINITIVE : self::PROVISIONAL,
			'open'  => $open,
		);
	}

	/**
	 * Whole days from one ISO date to another, or null when either is not one.
	 *
	 * Its own function because "illisible" and "zero days" must not be the same
	 * answer: a date the shop cannot parse would otherwise make every commission
	 * instantly definitive.
	 */
	public static function days_between( string $from, string $to ): ?int {
		$a = \DateTimeImmutable::createFromFormat( '!Y-m-d', $from, new \DateTimeZone( 'UTC' ) );
		$b = \DateTimeImmutable::createFromFormat( '!Y-m-d', $to, new \DateTimeZone( 'UTC' ) );
		if ( ! $a || ! $b || $a->format( 'Y-m-d' ) !== $from || $b->format( 'Y-m-d' ) !== $to ) {
			return null;
		}
		return (int) $a->diff( $b )->format( '%r%a' );
	}

	/**
	 * Whether a customer is still attributed to the rep who brought them.
	 *
	 * Question 29's default: twelve months from the first order. The Bible asks
	 * the question ("Pendant combien de temps un commercial reste-t-il
	 * propriétaire de son client") and answers none of it, so this is ours until
	 * he says otherwise, and it is one number in one place.
	 */
	public static function attributed( string $first_order_on, string $today, array $config ): bool {
		$days = self::days_between( $first_order_on, $today );
		if ( null === $days ) {
			return false;
		}
		return $days >= 0 && $days <= (int) ( $config['attribution_days'] ?? 0 );
	}
}
