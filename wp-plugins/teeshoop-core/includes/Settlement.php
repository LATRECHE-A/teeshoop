<?php
/**
 * What an order has actually been paid, and what that allows.
 *
 * WHY THIS IS NOT A BOOLEAN. WooCommerce knows one thing about money: paid or
 * not. The Bible's chapter 2 needs three, because it puts "7. paiement partiel"
 * in the order lifecycle and then says "commande importante : acompte possible,
 * solde avant expédition ou avant production selon le risque". An order can be
 * half paid, and half paid is a state a workshop is allowed to act on.
 *
 * ── THE CONTRADICTION, AND HOW IT IS RESOLVED ────────────────────────────────
 *
 * The same chapter carries two sentences that cannot both be read as absolutes:
 *
 *   line 139  "commande importante : acompte possible, solde avant expédition
 *              ou avant production selon le risque"
 *   line 330  "une commande non payée ne peut pas passer en production"
 *
 * An order paid at 50 % is not paid. Taken literally the acceptance criterion
 * forbids exactly the path the payment rule permits, and there is no way to
 * guess which the associate meant. CLAUDE.md says what to do with a brief that
 * contradicts itself: correct it in code with a test that holds both readings,
 * and put the question to him.
 *
 * The reconciliation that makes both sentences true at once is that the gate is
 * PER STAGE and per ORDER, not global:
 *
 *   an order on which nobody authorised a deposit must be paid in full before
 *   production, which is line 330, and that is every self-serve order;
 *
 *   an order on which somebody authorised one may enter production on the
 *   deposit, which is line 139, and it still may not be dispatched until the
 *   balance has arrived, which is the "solde avant expédition" half of the same
 *   sentence.
 *
 * So a deposit is never a state an order drifts into: a human has to have said
 * so, which is also what question 16's written default requires ("acompte de
 * 50 % possible au-dessus de 3 000 EUR hors taxes APRÈS VOTRE VALIDATION").
 * `tests/test-settlement.php` holds both readings side by side.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────────
 *
 * No échéancier (an instalment plan with dates), no payment terms, no dunning.
 * Question 16's default is explicit that there is "aucun paiement à échéance au
 * lancement", and the Bible's one door to deferred payment, "client récurrent
 * fiable : conditions dérogatoires validées", names neither the terms nor the
 * approver nor the eligibility test. There is nothing there to build.
 *
 * ── ONE WARNING FOR WHOEVER BUILDS REFUNDS ───────────────────────────────────
 *
 * "Solde" means two opposite things in the Bible, twenty-one lines apart, and
 * the money flows in opposite directions:
 *
 *   line 139  "solde avant expédition"          what the CUSTOMER still owes us
 *   line 160  "remboursement du solde non engagé"  what WE still hold of theirs
 *
 * Everything in this file uses the first sense, and `remaining()` is named for
 * it deliberately. Session 06 builds cancellations against the second, and
 * reading one field for both is how a refund goes out backwards.
 *
 * Pure by construction: no WordPress function is called here, so it is tested by
 * `php tests/run.php` with no bootstrap. The order-facing half, which owns the
 * ledger on the order and the status an operator sees, is `Ledger.php`.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

require_once __DIR__ . '/Money.php';

final class Settlement {

	/** Nothing has arrived. */
	public const NOTHING = 'attente';

	/** Enough for the deposit that was authorised, and not the whole thing. */
	public const DEPOSIT = 'acompte';

	/** The whole thing, or more. */
	public const PAID = 'paye';

	/** Some money arrived but it is short of the authorised deposit. */
	public const SHORT = 'insuffisant';

	/**
	 * What a deposit commits the customer to, in the letters that decide it.
	 *
	 * A CONSTANT AND NOT COPY, like the article 293 B mention, because the WORD
	 * is what qualifies the money in French law and silence is a litigation
	 * risk rather than a safe harbour. Article L. 214-1 du code de la
	 * consommation presumes an advance payment to be des ARRHES, which either
	 * party may walk away from (the buyer forfeiting them, the seller returning
	 * double), and article 1590 du code civil is where that comes from. That
	 * presumption is switched off here by L. 214-3, which excludes "les ventes
	 * de produits dont la fabrication est entreprise sur commande spéciale de
	 * l'acheteur", and this shop sells nothing else. So there is no default at
	 * all, in either direction, and the qualification is whatever the documents
	 * say. They say acompte, and they say what it binds.
	 *
	 * The same sentence has to appear on the quote (session 06) and in the
	 * conditions de vente (session 12). It lives here so those two read it
	 * rather than retyping it into a third and a fourth wording.
	 */
	public const COMMITMENT_FR = 'Le versement de cet acompte vaut engagement ferme d’achat : la fabrication étant lancée sur commande, la commande ne peut plus être annulée. Le solde est exigible avant expédition.';

	/** The workshop starts pressing. */
	public const STAGE_PRODUCTION = 'production';

	/** The parcel leaves. */
	public const STAGE_DISPATCH = 'expedition';

	public static function default_config(): array {
		return array(
			/*
			 * Where a deposit becomes possible at all, in cents HT of the whole
			 * order (goods plus carriage, less any discount).
			 *
			 * ATTENTION: OURS, NOT THE ASSOCIATE'S. Question 16's written default
			 * is "100 % avant production ; acompte de 50 % possible au-dessus de
			 * 3 000 EUR hors taxes après votre validation". The Bible authorises
			 * an acompte for "les commandes complexes ou importantes" and never
			 * defines either word, never gives a percentage and never gives a
			 * threshold, so there was nothing to derive and these two numbers are
			 * that sentence and nothing else.
			 *
			 * AND THE TWO ASSUMPTIONS DO NOT MEET. Question 02 stops self-serve
			 * at 2 000 EUR HT; this opens at 3 000. No basket a customer fills
			 * alone can ever reach it, so today a deposit is only reachable on an
			 * order an operator made, which is the quote path of session 06. That
			 * is coherent, deposits are for large quoted jobs, and it is worth
			 * him knowing that the two figures he is being asked to confirm never
			 * overlap. Question 16 says so.
			 *
			 * 0 disables it, the same convention as every other threshold here.
			 */
			'deposit_from_ht' => 300000,

			/*
			 * The share of the order the deposit is, applied to the amount the
			 * customer actually settles, which is the TTC total.
			 *
			 * THE TWO BASES ARE DIFFERENT ON PURPOSE AND THAT IS WORTH SAYING
			 * OUT LOUD, because mixing them silently is how this project has lost
			 * money before. The THRESHOLD is hors taxes, because that is how
			 * question 16 words it and how every other threshold in this plugin
			 * is worded. The AMOUNT is toutes taxes comprises, because a deposit
			 * is money a customer transfers and they transfer what they owe.
			 */
			'deposit_rate'    => 0.5,
		);
	}

	/** Merge a stored partial over the shipped defaults, per top-level key. */
	public static function merge_config( array $stored ): array {
		$config = self::default_config();
		foreach ( $stored as $key => $value ) {
			if ( array_key_exists( $key, $config ) ) {
				$config[ $key ] = $value;
			}
		}
		return $config;
	}

	/**
	 * Whether an order is large enough for a deposit to be offered at all.
	 *
	 * At exactly the threshold, yes: "au-dessus de 3 000 EUR" is read the same
	 * way as every other threshold in this plugin, which is that the boundary
	 * belongs to the side it opens. `Pricing::needs_quote` reads its own the
	 * other way (strictly past), because that one CLOSES a door and this one
	 * OPENS one, and both are stated where they are read.
	 */
	public static function deposit_possible( int $order_ht, array $config ): bool {
		$from = (int) ( $config['deposit_from_ht'] ?? 0 );
		return $from > 0 && $order_ht >= $from;
	}

	/**
	 * The deposit an order of this size carries, in cents of its TTC total.
	 *
	 * Rounded once, half up, so the customer settles the extra cent first and
	 * the balance below is exact: deposit + balance is the total, always, with
	 * no third rounding anywhere.
	 */
	public static function deposit_due( int $total_ttc, array $config ): int {
		$rate = (float) ( $config['deposit_rate'] ?? 0 );
		if ( $rate <= 0 || $rate >= 1 ) {
			return $total_ttc;
		}
		return min( $total_ttc, Money::pct( $total_ttc, $rate ) );
	}

	/** What is left after what has arrived. Never negative. */
	public static function remaining( int $total_ttc, int $received ): int {
		return max( 0, $total_ttc - $received );
	}

	/** Money that arrived and should not have. Reported, never refused. */
	public static function overpaid( int $total_ttc, int $received ): int {
		return max( 0, $received - $total_ttc );
	}

	/** The sum of a ledger, in cents. */
	public static function received( array $ledger ): int {
		$sum = 0;
		foreach ( $ledger as $entry ) {
			$sum += (int) ( $entry['cents'] ?? 0 );
		}
		return $sum;
	}

	/**
	 * Where an order stands.
	 *
	 * `SHORT` exists because "some money arrived" and "the deposit arrived" are
	 * different facts and only one of them opens production. A transfer that
	 * lands 200 EUR under the deposit must not read as a deposit, and it must
	 * not read as nothing either: the money is there and somebody has to chase
	 * the difference.
	 */
	public static function state( int $total_ttc, int $received, bool $authorised, array $config ): string {
		if ( $received <= 0 ) {
			return self::NOTHING;
		}
		if ( $received >= $total_ttc ) {
			return self::PAID;
		}
		if ( ! $authorised ) {
			return self::SHORT;
		}
		return $received >= self::deposit_due( $total_ttc, $config ) ? self::DEPOSIT : self::SHORT;
	}

	/**
	 * What a stage costs before it may start, in cents.
	 *
	 * This is the reconciliation described at the top of the file, expressed as
	 * one number per stage rather than as a boolean anywhere.
	 */
	public static function required_for( string $stage, int $total_ttc, bool $authorised, array $config ): int {
		if ( self::STAGE_DISPATCH === $stage ) {
			// "solde avant expédition". Both readings of the chapter agree here,
			// and nothing leaves the workshop against a promise.
			return $total_ttc;
		}
		if ( self::STAGE_PRODUCTION === $stage ) {
			return $authorised ? self::deposit_due( $total_ttc, $config ) : $total_ttc;
		}
		// A stage nobody has defined costs everything. "We do not know what this
		// one needs" and "this one needs nothing" are different answers, and only
		// one of them is safe to give a workshop.
		return $total_ttc;
	}

	/** Whether an order may enter a stage. */
	public static function stage_allows( string $stage, int $total_ttc, int $received, bool $authorised, array $config ): bool {
		return $received >= self::required_for( $stage, $total_ttc, $authorised, $config );
	}

	/**
	 * Add a receipt to a ledger.
	 *
	 * IDEMPOTENT ON THE REFERENCE, because the same encashment arrives twice.
	 * The Bible says so in as many words about the rail this runs on: "les
	 * webhooks doivent être idempotents : un même événement reçu deux fois ne
	 * doit pas doubler une facture, une commande ou une commission". A gateway
	 * retries, a status transition fires again, an operator double-clicks. The
	 * reference is the transaction id where there is one and the operator's own
	 * wording where there is not, and a second entry carrying a reference the
	 * ledger already has is dropped rather than added.
	 *
	 * An amount that is not positive is dropped too: a refund is not a negative
	 * encashment, it is a different document, and this plugin issues none.
	 *
	 * @return array the ledger, with the entry appended or not.
	 */
	public static function record( array $ledger, int $cents, string $method, string $reference, string $date ): array {
		if ( $cents <= 0 ) {
			return $ledger;
		}
		$reference = trim( $reference );
		if ( '' !== $reference ) {
			foreach ( $ledger as $entry ) {
				if ( trim( (string) ( $entry['reference'] ?? '' ) ) === $reference ) {
					return $ledger;
				}
			}
		}

		$ledger[] = array(
			'date'      => $date,
			'cents'     => $cents,
			'method'    => $method,
			'reference' => $reference,
		);
		return $ledger;
	}

	/**
	 * A ledger read back out of storage, with anything unreadable dropped.
	 *
	 * The same discipline as `Vat::merge_periods`: an entry this cannot read is
	 * not counted as zero, it is not counted at all, and the sum is then a sum
	 * of what is really there rather than a number that quietly includes a
	 * corrupted row as nothing.
	 */
	public static function normalise( mixed $raw ): array {
		if ( ! is_array( $raw ) ) {
			return array();
		}
		$out = array();
		foreach ( $raw as $entry ) {
			if ( ! is_array( $entry ) ) {
				continue;
			}
			$cents = (int) ( $entry['cents'] ?? 0 );
			if ( $cents <= 0 ) {
				continue;
			}
			$out[] = array(
				'date'      => (string) ( $entry['date'] ?? '' ),
				'cents'     => $cents,
				'method'    => (string) ( $entry['method'] ?? '' ),
				'reference' => (string) ( $entry['reference'] ?? '' ),
			);
		}
		return $out;
	}
}
