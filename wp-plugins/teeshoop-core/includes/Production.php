<?php
/**
 * The workshop's day: what is ready to print, when it has to be bought, and
 * which orders are printed on the same film.
 *
 * Until this file, nesting was a property of one order. The Bible says
 * otherwise in as many words, « Chaque commande est divisée en lots homogènes »
 * and « Le DTF peut être commandé en France pour les urgences ou en Espagne pour
 * les délais standards », and so does `worker/design.ts`, which stores the
 * SOURCE of every order rather than a frozen layout, deliberately, so that the
 * layout can be decided later over several orders at once.
 *
 * ── WHAT A LOT IS ────────────────────────────────────────────────────────────
 *
 * A lot (« lot d'impression ») is a set of orders whose film is bought together.
 * It has one origin, one supplier order, one delivery charge, and one gang-sheet
 * layout. Its bill is split back across its orders by `Cost::attribute()`, so
 * each margin report still says what its own order cost.
 *
 * ── THE STATUS IS A LABEL. THE RECORD IS THE AUTHORITY. ──────────────────────
 *
 * `Lifecycle`'s own rule, applied here. This file NEVER asks an order what its
 * status is to decide whether it may be printed: it asks
 * `Lifecycle::blockers( $order, Lifecycle::PRODUCTION )`, which asks `Ledger`
 * how much money actually landed and `Bat` whether the CURRENT version of the
 * proof is actually approved. A queue built on `get_status()` is a queue a
 * dropdown can fill with unpaid, unapproved work.
 *
 * ── THE CALENDAR LIVES HERE AND ONLY HERE ────────────────────────────────────
 *
 * Working days, French public holidays, the lead time per urgency, the film's
 * own transit and the press's capacity are all in the first half of this file,
 * which calls no WordPress function and is tested by `php tests/run.php`. The
 * studio does no date arithmetic at all: it receives the dates this file
 * computed and compares them as strings. A second calendar in TypeScript would
 * be a second answer to « quand faut-il commander le film », and the day the
 * two disagreed the shop would plan against one and the workshop against the
 * other.
 *
 * ── THE TARGET DATE IS NOT A PROMISE ─────────────────────────────────────────
 *
 * Nothing on this site announces a delivery date. `H-Q14-UN-COLIS-MAXIMUM` says
 * so and it is still true after this session: question 14 has not been answered,
 * so no lead time has been agreed with anybody. What this file computes is an
 * INTERNAL target: the date the workshop plans against, and it is called
 * « date cible » everywhere an operator can read it, never « date de
 * livraison ». It becomes a promise the day the associate answers and the site
 * publishes it, and not before. Printing it to a customer before then would be
 * inventing a commitment out of a default value.
 *
 * ── FREEZING ─────────────────────────────────────────────────────────────────
 *
 * A lot that has been sent to the printer is frozen: its orders cannot leave, no
 * order can join, and the layout cannot be re-nested. Re-nesting a sent lot
 * silently is how two customers get each other's shirt, the film that arrives
 * was cut from the layout that was sent, and a screen showing a different one is
 * a screen that will be trusted.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

require_once __DIR__ . '/Money.php';

final class Production {

	// ── the lot, as a record ─────────────────────────────────────────────────

	/** Non-public post type holding one lot. */
	public const POST_TYPE = 'ts_lot';

	/** Post meta: the whole lot record, JSON. */
	public const META_LOT = '_teeshoop_lot';

	/** ORDER meta: this order's place in a lot, JSON. Read by `Costing`. */
	public const META_ORDER_LOT = '_teeshoop_lot_part';

	/**
	 * Bounds on a posted layout. They are the Worker's own
	 * (`worker/nest.ts`: MAX_PIECES, MAX_INSTANCES, MAX_PIECE_CM), restated here
	 * because this end has to refuse a body the other end would refuse anyway, and
	 * because a bound that only exists downstream is a bound nobody applied when
	 * the downstream call fails.
	 */
	private const MAX_PIECES    = 512;
	private const MAX_INSTANCES = 20000;
	private const MAX_PIECE_CM  = 200;
	/**
	 * No print run is two kilometres of film. A sanity bound, not a policy: at
	 * the shipped tariff it is thirty-four thousand euros of one order.
	 */
	private const MAX_RUN_M     = 2000;
	/** Transfers one side may split into: `MAX_SIDE_PIECES` in designDoc.ts. */
	private const MAX_SIDE_PIECES = 32;

	/** The shop's named lock, for the read-modify-write that builds a lot. */
	private const LOCK = 'teeshoop_lot';

	/**
	 * Orders one call to `queue()` will look at.
	 *
	 * Far above a real day: question 23's cadence is 300 garments, so five hundred
	 * ORDERS waiting on a press is a workshop in a different kind of trouble. It
	 * exists so one screen cannot read a year of orders, and it is reported when
	 * it bites.
	 */
	private const QUEUE_MAX = 500;

	/** Whether the last `queue()` hit the cap. Read by the screen and by REST. */
	private static bool $truncated = false;

	/** True when the last queue was cut short. Never let a cap be silent. */
	public static function queue_truncated(): bool {
		return self::$truncated;
	}

	/** Being assembled. Nothing has been bought; anything may still change. */
	public const DRAFT = 'brouillon';

	/** The film has been ordered. FROZEN. */
	public const SENT = 'envoye';

	/** The film has arrived and been checked in. */
	public const RECEIVED = 'recu';

	/** Pressed and closed. */
	public const DONE = 'termine';

	/** In the order they are lived, with the French an operator reads. */
	public static function states(): array {
		return array(
			self::DRAFT    => 'Brouillon',
			self::SENT     => 'Film commandé',
			self::RECEIVED => 'Film reçu',
			self::DONE     => 'Terminé',
		);
	}

	/** A lot in one of these has bought film and may no longer be re-nested. */
	public static function frozen( string $state ): bool {
		return self::DRAFT !== $state;
	}

	// ── the parameters ───────────────────────────────────────────────────────

	/**
	 * Everything the schedule is computed from, and not one of them is confirmed.
	 *
	 * Each has a row in `docs/hypotheses.json` naming the question it is waiting
	 * on. They are gathered here rather than spread through the code for the same
	 * reason the cost parameters are gathered in `Cost::default_config()`: a
	 * number that decides when a customer's parcel leaves has to be findable.
	 */
	public static function default_config(): array {
		return array(
			/*
			 * WORKING DAYS from the moment the proof is approved. Question 14's
			 * answer of 1 September 2026, verbatim: « À partir de la validation
			 * du BAT : standard 7 jours ; express 4 jours selon disponibilité ;
			 * urgent 2 à 3 jours selon disponibilité. » The written default was
			 * 12 / 7 / 4, so all three got shorter and the standard lost five days.
			 *
			 * THREE THINGS HIS SENTENCE DOES NOT SAY, and each of them changes
			 * the arithmetic:
			 *
			 *   1. OUVRÉS OR CALENDAIRES. Read as working days, which is the unit
			 *      every other duration in this file uses and the one the site
			 *      publishes. Read as calendar days, seven is about five working
			 *      days and the standard becomes infeasible by one:
			 *      `feasibility()` measures six working days of incompressible
			 *      work. The question is back to him.
			 *   2. WHICH END. Article 8 of the conditions in force says the
			 *      fabrication delay runs « entre la validation du bon à tirer et
			 *      la remise du colis au transporteur », then announces the
			 *      carrier's own two days on top. `feasibility()` reads the
			 *      stricter thing, that the PARCEL IS DELIVERED on the last day,
			 *      and it is left strict on purpose: the workshop aiming two days
			 *      earlier than the published sentence is the safe direction.
			 *   3. « SELON DISPONIBILITÉ », twice, on the only two that are
			 *      impossible. Express at 4 is two working days short and urgent
			 *      at 3 is three. Neither is published and neither becomes
			 *      sellable by being written here.
			 *
			 * URGENT TAKES THE LONGER END of « 2 à 3 », because this is a promise
			 * and the longer of two promises is the one that can be kept.
			 *
			 * The standard now has ONE working day of slack where it had six, and
			 * that day is the workshop buffer itself, so a courier one day late
			 * consumes it entirely. Measured by `Production::feasibility()`, held
			 * by `tests/test-production.php`.
			 *
			 * The keys are `PriceRule::URGENCES`, the vocabulary the cost screen
			 * already uses, so an order ticked urgent there is the same order this
			 * schedules. Adding a fourth word here without adding it there would
			 * silently schedule it as standard.
			 */
			'lead_days'     => array(
				'standard' => 7,
				'express'  => 4,
				'urgent'   => 3,
			),

			/*
			 * Carrier transit, working days. Question 14's default names Colissimo
			 * and gives no transit time; two working days is what Colissimo
			 * publishes for metropolitan France and it is the number the shipping
			 * grid was built from, but nobody has held us to it.
			 */
			'ship_days'     => 2,

			/*
			 * Slack between the film arriving and the press starting.
			 *
			 * The Bible's own routing algorithm lists a « buffer » among its
			 * inputs, and it is the cheapest insurance in the whole schedule: one
			 * day of slack moves a run from Spain to France when the deadline is
			 * tight, and the difference is a few euros of film against a missed
			 * date. Zero would mean planning for a courier that is never late.
			 */
			'buffer_days'   => 1,

			/*
			 * Working days between a supplier order for BLANKS and their arrival
			 * at the workshop.
			 *
			 * Question 46's answer of 1 September 2026: « le délai réel habituel
			 * est d'environ 24 heures. Le moteur de planification retient jusqu'à
			 * 2 jours ouvrés de sécurité pour une promesse client normale. » Two
			 * numbers, as the question anticipated, and this is the second: what
			 * the schedule PROMISES on, not what the supplier usually does.
			 *
			 * It lives here beside `ship_days` and not with the film, because
			 * this is the schedule and both are a third party's duration. The
			 * film's two transit times live with the film TARIFF because question
			 * 04 quotes a rate and a delay in one sentence; there is no textile
			 * tariff block for this one to belong to.
			 *
			 * HE ALSO SAYS WHEN IT DOES NOT APPLY, and the shop already draws
			 * that line: « Si le produit n'est pas immédiatement disponible ou
			 * est en réapprovisionnement : délai à confirmer. » `Purchase`
			 * distinguishes available, uncertain and restocking, and the deadline
			 * below is only stated for a basket whose stock reading supports it.
			 */
			'blank_days'    => 2,

			/*
			 * Pieces the workshop can press in a working day.
			 *
			 * Question 23's answer of 1 September 2026: « Capacité de travail à
			 * retenir actuellement : environ 500 pièces par jour. » The written
			 * default was 300 WITH ONE PERSON, and the answer gives no headcount,
			 * so what changed may be the rate or may be the staff. It matters to
			 * question 05, whose hourly rate is charged per person: if 500 is two
			 * people, the labour cost of an order doubles and this figure did not
			 * say so. The question is back to him.
			 *
			 * The chapter's own warning still stands and is still unanswered:
			 * « La cadence annoncée de 30 secondes pour deux t-shirts doit être
			 * testée en conditions complètes. » Nothing here has been timed.
			 */
			'press_per_day' => 500,

			/*
			 * Above this many garments in ONE lot, an operator has to say yes.
			 * Question 23's default asks for exactly that (« alerte automatique et
			 * validation manuelle au-delà de 500 pièces »), and a lot is the right
			 * unit for it rather than an order: what saturates a press is the day's
			 * work, not whose name is on it.
			 */
			'manual_above'  => 500,
		);
	}

	/** The stored parameters merged over the defaults, key by key. */
	public static function merge_config( array $stored ): array {
		$out = self::default_config();
		foreach ( $stored as $key => $value ) {
			if ( ! array_key_exists( $key, $out ) ) {
				continue;
			}
			// `lead_days` is a map and a partial save must not delete the keys it
			// did not mention. Cost.php was bitten by exactly this and says so.
			if ( 'lead_days' === $key && is_array( $value ) ) {
				foreach ( $value as $k => $v ) {
					if ( array_key_exists( $k, $out['lead_days'] ) && is_numeric( $v ) ) {
						$out['lead_days'][ $k ] = max( 0, (int) $v );
					}
				}
				continue;
			}
			if ( is_numeric( $value ) ) {
				$out[ $key ] = max( 0, (int) $value );
			}
		}
		return $out;
	}

	// ── the calendar, pure ───────────────────────────────────────────────────

	/**
	 * Easter Sunday, Gregorian, as `Y-m-d`.
	 *
	 * The anonymous Gregorian algorithm (Meeus/Jones/Butcher). It is here rather
	 * than `easter_date()` because that function is in the `calendar` extension,
	 * which o2switch does not necessarily load, and a schedule that silently
	 * loses four public holidays promises dates it will miss by a day each time.
	 */
	public static function easter( int $year ): string {
		$a = $year % 19;
		$b = intdiv( $year, 100 );
		$c = $year % 100;
		$d = intdiv( $b, 4 );
		$e = $b % 4;
		$f = intdiv( $b + 8, 25 );
		$g = intdiv( $b - $f + 1, 3 );
		$h = ( 19 * $a + $b - $d - $g + 15 ) % 30;
		$i = intdiv( $c, 4 );
		$k = $c % 4;
		$l = ( 32 + 2 * $e + 2 * $i - $h - $k ) % 7;
		$m = intdiv( $a + 11 * $h + 22 * $l, 451 );
		$month = intdiv( $h + $l - 7 * $m + 114, 31 );
		$day   = ( ( $h + $l - 7 * $m + 114 ) % 31 ) + 1;
		return sprintf( '%04d-%02d-%02d', $year, $month, $day );
	}

	/**
	 * The eleven French public holidays of a year, as `Y-m-d`.
	 *
	 * Metropolitan France only: Alsace-Moselle has two more and the overseas
	 * departments have their own, and the workshop is in Bobigny. Four of the
	 * eleven move with Easter, which is why the algorithm above exists.
	 *
	 * @return array<int,string>
	 */
	public static function holidays( int $year ): array {
		$easter = new \DateTimeImmutable( self::easter( $year ), new \DateTimeZone( 'UTC' ) );
		$after  = static fn( int $days ): string => $easter->modify( "+{$days} days" )->format( 'Y-m-d' );
		return array(
			sprintf( '%04d-01-01', $year ), // Jour de l'an
			$after( 1 ),                    // Lundi de Pâques
			sprintf( '%04d-05-01', $year ), // Fête du Travail
			sprintf( '%04d-05-08', $year ), // Victoire 1945
			$after( 39 ),                   // Ascension
			$after( 50 ),                   // Lundi de Pentecôte
			sprintf( '%04d-07-14', $year ), // Fête nationale
			sprintf( '%04d-08-15', $year ), // Assomption
			sprintf( '%04d-11-01', $year ), // Toussaint
			sprintf( '%04d-11-11', $year ), // Armistice 1918
			sprintf( '%04d-12-25', $year ), // Noël
		);
	}

	/** Monday to Friday, minus the eleven. */
	public static function is_working_day( string $iso ): bool {
		$d = self::date( $iso );
		if ( null === $d ) {
			return false;
		}
		if ( (int) $d->format( 'N' ) >= 6 ) {
			return false;
		}
		return ! in_array( $d->format( 'Y-m-d' ), self::holidays( (int) $d->format( 'Y' ) ), true );
	}

	/**
	 * `$days` working days after `$iso`, as `Y-m-d`.
	 *
	 * Zero returns the SAME day when it is a working day and the next working day
	 * when it is not, which is the answer a workshop wants: a proof approved on a
	 * Sunday starts its clock on Monday, and counting from Sunday would give the
	 * whole schedule a free day nobody worked.
	 *
	 * Negative counts backwards, which is how every "latest date to order" in
	 * this file is derived, the promise is fixed and the work is subtracted
	 * from it.
	 */
	public static function add_working_days( string $iso, int $days ): string {
		$d = self::date( $iso );
		if ( null === $d ) {
			return '';
		}
		$step = $days < 0 ? -1 : 1;
		$left = abs( $days );
		// A calendar with no working days at all would loop for ever. Eleven
		// holidays and two weekend days cannot fill more than nine consecutive
		// calendar days, so this bound is far above anything real and exists only
		// so a corrupt date can never hang a request.
		$guard = 0;
		while ( ! self::is_working_day( $d->format( 'Y-m-d' ) ) && $guard++ < 40 ) {
			$d = $d->modify( ( $days < 0 ? '-' : '+' ) . '1 day' );
		}
		while ( $left > 0 && $guard++ < 4000 ) {
			$d = $d->modify( ( $step < 0 ? '-' : '+' ) . '1 day' );
			if ( self::is_working_day( $d->format( 'Y-m-d' ) ) ) {
				--$left;
			}
		}
		return $d->format( 'Y-m-d' );
	}

	/** Working days between two dates, counting neither end twice. Negative when late. */
	public static function working_days_between( string $from, string $to ): int {
		$a = self::date( $from );
		$b = self::date( $to );
		if ( null === $a || null === $b ) {
			return 0;
		}
		$sign = $a <= $b ? 1 : -1;
		if ( $sign < 0 ) {
			[ $a, $b ] = array( $b, $a );
		}
		$n = 0;
		$guard = 0;
		while ( $a->format( 'Y-m-d' ) < $b->format( 'Y-m-d' ) && $guard++ < 4000 ) {
			$a = $a->modify( '+1 day' );
			if ( self::is_working_day( $a->format( 'Y-m-d' ) ) ) {
				++$n;
			}
		}
		return $sign * $n;
	}

	/** A `Y-m-d` string as a date, or null. Never a "today" fallback: see `queue()`. */
	private static function date( string $iso ): ?\DateTimeImmutable {
		if ( 1 !== preg_match( '/^\d{4}-\d{2}-\d{2}$/', $iso ) ) {
			return null;
		}
		try {
			$d = new \DateTimeImmutable( $iso, new \DateTimeZone( 'UTC' ) );
		} catch ( \Exception $e ) {
			return null;
		}
		return $d->format( 'Y-m-d' ) === $iso ? $d : null;
	}

	// ── the schedule, pure ───────────────────────────────────────────────────

	/**
	 * The date the workshop is planning against, `Y-m-d`, or '' when it cannot
	 * be derived.
	 *
	 * The clock starts at the PROOF APPROVAL and not at the payment, because
	 * that is where question 14 starts it (« à partir de la validation du bon à
	 * tirer ») and because it is the only one of the two the workshop controls.
	 * An order whose customer sat on their proof for a fortnight has not eaten a
	 * fortnight of our lead time.
	 */
	public static function target_date( string $approved_on, string $urgency, array $config ): string {
		$days = $config['lead_days'][ $urgency ] ?? $config['lead_days']['standard'] ?? 0;
		return self::add_working_days( $approved_on, (int) $days );
	}

	/** Working days of pressing this many garments needs, at least one. */
	public static function press_days( int $garments, array $config ): int {
		$rate = max( 1, (int) ( $config['press_per_day'] ?? 1 ) );
		return max( 1, (int) ceil( max( 0, $garments ) / $rate ) );
	}

	/**
	 * The last day the film may be ORDERED from `$origin` and the target still
	 * hold, `Y-m-d`.
	 *
	 * Subtracted from the target, in this order, because that is the order the
	 * work happens in: hand-over, carrier, press, slack, film transit.
	 *
	 * @param array $film `Cost::default_config()['film']`, for `days_fr`/`days_es`.
	 */
	public static function latest_order_on(
		string $target_on,
		int $garments,
		string $origin,
		array $config,
		array $film
	): string {
		$transit = (int) ( $film[ 'es' === $origin ? 'days_es' : 'days_fr' ] ?? 0 );
		$back    = (int) ( $config['ship_days'] ?? 0 )
			+ self::press_days( $garments, $config )
			+ (int) ( $config['buffer_days'] ?? 0 )
			+ $transit;
		return self::add_working_days( $target_on, -$back );
	}

	/**
	 * The last day the BLANKS may be ordered and the target still hold, `Y-m-d`.
	 *
	 * The same walk back as `latest_order_on()`, with question 46's supply time
	 * where the film's transit is. Film and blanks are ordered on the same day
	 * and travel in parallel, so the workshop's real constraint is whichever
	 * arrives LAST, and this is the other half of that comparison.
	 *
	 * `Purchase.php` computed no blank-side deadline at all until 1 September
	 * 2026 and said so on the screen, because nobody had ever measured one.
	 */
	public static function latest_blank_order_on( string $target_on, int $garments, array $config ): string {
		$back = (int) ( $config['ship_days'] ?? 0 )
			+ self::press_days( $garments, $config )
			+ (int) ( $config['buffer_days'] ?? 0 )
			+ (int) ( $config['blank_days'] ?? 0 );
		return self::add_working_days( $target_on, -$back );
	}

	/**
	 * Which origin this order's film should be bought from, and by when.
	 *
	 * The chapter's rule, made arithmetic: Spain when the delay allows, France
	 * when it does not. Spain is tried FIRST because it is half the price, and it
	 * is only taken when its own slower calendar still lands on the target date.
	 *
	 * WHEN NEITHER HOLDS, the answer is France and `late` is true. It is not «
	 * refuse to schedule »: the order still has to be printed, the fastest origin
	 * is its best remaining chance, and an order that vanishes from the queue
	 * because it is already late is an order nobody chases.
	 *
	 * @return array{origin:string,order_by:string,late:bool,order_by_fr:string,order_by_es:string}
	 */
	public static function origin_for(
		string $today,
		string $target_on,
		int $garments,
		array $config,
		array $film
	): array {
		$fr = self::latest_order_on( $target_on, $garments, 'fr', $config, $film );
		/*
		 * ONLY THE ORIGINS THE TARIFF IN FORCE CAN BE BOUGHT FROM.
		 *
		 * Preferring the cheaper origin whenever the calendar allows only means
		 * something while two suppliers exist. Question 04's answer of
		 * 1 September 2026 names ONE, in France, selling sheets, so
		 * `Cost::origins()` returns one origin and the branch below never runs:
		 * scheduling a run against a Spanish transit time that nothing can be
		 * bought from would put an order two days later than it needs to be, for
		 * a saving that no longer exists.
		 */
		$es = in_array( 'es', Cost::origins( $film ), true )
			? self::latest_order_on( $target_on, $garments, 'es', $config, $film )
			: '';
		$out = array(
			'order_by_es' => $es,
			'order_by_fr' => $fr,
		);
		if ( '' !== $es && $es >= $today ) {
			return $out + array(
				'origin'   => 'es',
				'order_by' => $es,
				'late'     => false,
			);
		}
		return $out + array(
			'origin'   => 'fr',
			'order_by' => $fr,
			'late'     => '' === $fr || $fr < $today,
		);
	}

	/**
	 * How many working days of slack each promised lead time actually has, per
	 * origin. A NEGATIVE number is a promise that cannot be kept on the day it is
	 * made, whatever the workshop does.
	 *
	 * ── WHAT IT FOUND THE FIRST TIME IT RAN ──────────────────────────────────
	 *
	 * Question 14's default urgency, 4 working days, is impossible against
	 * question 14's own other defaults. The work between an approved proof and a
	 * parcel is 2 days of Colissimo + 1 day of pressing + 1 day of slack + 2 days
	 * of French film transit = 6 working days. Four minus six is MINUS TWO: every
	 * urgent order is two days late before anyone touches it.
	 *
	 * ── AND WHAT THE BLANKS ADDED, WHICH IS NOTHING ──────────────────────────
	 *
	 * Those 6 days did NOT count the blanks arriving, because until question 46
	 * was answered nobody knew how long that took. The obvious thing to do with
	 * the answer, adding it, is wrong: film and blanks are ordered on the same
	 * day and travel at the same time, so the constraint is whichever arrives
	 * LAST and not the sum. Question 46 gives 2 working days and question 04's
	 * French film gives 2, so the maximum is 2 and the incompressible work stays
	 * at SIX. Adding by hand would have produced 8 and made every promise look
	 * two days worse than it is.
	 *
	 * It does bite on the slow film origin in reverse: there the film's 5 days
	 * dominate the blanks' 2, so nothing changes there either. The blanks only
	 * become the constraint if the textile supplier is slower than the film, and
	 * the answer says he is not.
	 *
	 * This is not a bug to fix by lowering a number until it passes. It is the
	 * arithmetic of defaults, and it is written into `QUESTIONS-ASSOCIE.md` under
	 * question 14 so the answer lands on a measured contradiction rather than on
	 * a blank.
	 *
	 * @return array<string,array{days:int,fr:int,es:int,blank_days:int}> urgency => slack.
	 */
	public static function feasibility( array $config, array $film ): array {
		$out   = array();
		$blank = (int) ( $config['blank_days'] ?? 0 );
		foreach ( array_keys( (array) ( $config['lead_days'] ?? array() ) ) as $urgency ) {
			$days = (int) $config['lead_days'][ $urgency ];
			// One garment, so the press contributes its floor of one day and the
			// answer describes the promise rather than any particular order.
			$fixed = (int) ( $config['ship_days'] ?? 0 )
				+ self::press_days( 1, $config )
				+ (int) ( $config['buffer_days'] ?? 0 );
			/*
			 * MAX AND NOT SUM. The two supply lines run in parallel from the same
			 * approval, so the workshop waits for the later of them once, not for
			 * both in turn.
			 */
			$out[ $urgency ] = array(
				'days'       => $days,
				'fr'         => $days - $fixed - max( (int) ( $film['days_fr'] ?? 0 ), $blank ),
				'es'         => $days - $fixed - max( (int) ( $film['days_es'] ?? 0 ), $blank ),
				'blank_days' => $blank,
			);
		}
		return $out;
	}

	// ── the queue, WordPress ─────────────────────────────────────────────────

	public static function init(): void {
		add_action( 'init', array( self::class, 'register' ) );
		add_action( 'rest_api_init', array( self::class, 'register_rest' ) );
	}

	/** The lot post type. Non-public: it names customers and their artwork. */
	public static function register(): void {
		register_post_type(
			self::POST_TYPE,
			array(
				'labels'              => array(
					'name'          => __( 'Lots d’impression', 'teeshoop' ),
					'singular_name' => __( 'Lot d’impression', 'teeshoop' ),
				),
				/*
				 * Anything reachable by URL is public, and a lot holds order
				 * numbers, customer names and the geometry of their artwork. The
				 * screen that reads it is `ProductionPage`, behind
				 * `manage_woocommerce`.
				 */
				'public'              => false,
				'publicly_queryable'  => false,
				'exclude_from_search' => true,
				'has_archive'         => false,
				'rewrite'             => false,
				'show_ui'             => false,
				'show_in_menu'        => false,
				'show_in_rest'        => false,
				'supports'            => array( 'title' ),
				'capability_type'     => 'shop_order',
				'map_meta_cap'        => true,
			)
		);
	}

	/** The stored parameters, merged over the shipped ones. */
	public static function config(): array {
		$stored = get_option( OPTION_PRODUCTION, array() );
		return self::merge_config( is_array( $stored ) ? $stored : array() );
	}

	/**
	 * Everything that could go on a press today, oldest deadline first.
	 *
	 * WHAT MAKES AN ORDER READY is `Lifecycle::blockers( $order, PRODUCTION )`
	 * and nothing else, the money that actually landed and the proof that is
	 * actually approved, both read from records rather than from a status. An
	 * order already in a lot is excluded: it has been scheduled once and putting
	 * it in a second lot would press it twice.
	 *
	 * `$today` is a PARAMETER. Nothing here reads the clock, so the screen, the
	 * REST route and the tests all see the same day, and a run can be replayed.
	 *
	 * IT CAN BE TRUNCATED AND IT SAYS SO. The query is capped, because a shop that
	 * has been running a year should not read every order it ever took to draw one
	 * screen. A cap that is silent is worse than no cap: the workshop would see a
	 * queue, believe it was the queue, and never print what fell off the end.
	 * `queue_truncated()` is what the screen and the REST answer read to say it.
	 *
	 * @return array<int,array>
	 */
	public static function queue( string $today = '' ): array {
		$today  = '' !== $today ? $today : Settings::today();
		$config = self::config();
		$film   = (array) ( Costing::config()['film'] ?? array() );

		$orders = wc_get_orders(
			array(
				/*
				 * The statuses an order can be sitting in with an approved proof
				 * and the money in. It is a NARROWING of the query, never the
				 * gate: `blockers()` below is what decides, and every one of these
				 * is re-tested by it. Querying every order in the shop instead
				 * would read the whole table to throw almost all of it away.
				 */
				'status'  => array(
					Lifecycle::APPROVED,
					Lifecycle::PRODUCTION,
					Lifecycle::PAID,
					Lifecycle::DEPOSIT,
				),
				/*
				 * One more than the cap, so the truncation can be DETECTED rather
				 * than assumed. Oldest first, because the oldest deadline is the
				 * one that matters and a cap must never drop the urgent end.
				 */
				'limit'   => self::QUEUE_MAX + 1,
				'orderby' => 'date',
				'order'   => 'ASC',
				'type'    => 'shop_order',
			)
		);

		self::$truncated = count( $orders ) > self::QUEUE_MAX;
		$orders          = array_slice( $orders, 0, self::QUEUE_MAX );

		$out = array();
		foreach ( $orders as $order ) {
			if ( ! $order instanceof \WC_Order ) {
				continue;
			}
			$row = self::queue_row( $order, $today, $config, $film );
			if ( null !== $row ) {
				$out[] = $row;
			}
		}

		usort(
			$out,
			static function ( array $a, array $b ): int {
				if ( $a['order_by'] !== $b['order_by'] ) {
					return strcmp( $a['order_by'], $b['order_by'] );
				}
				return $a['id'] <=> $b['id'];
			}
		);
		return $out;
	}

	/**
	 * One order as the workshop sees it, or null when it is not printable.
	 *
	 * Null covers three different things and they are not the same: the order is
	 * blocked (unpaid, unapproved), it is already in a lot, or it carries nothing
	 * to press. Only the last is silent, the other two are visible on the screen
	 * through `blocked()` and `lot_of()`, because an order that simply disappears
	 * is an order nobody chases.
	 */
	/**
	 * The last day THIS order's blanks may be ordered, `Y-m-d`, or '' if unknown.
	 *
	 * '' has one meaning and it is the honest one: the proof is not approved, so
	 * the clock question 14 starts (« à partir de la validation du bon à tirer »)
	 * has not started, and there is no date to compute. The purchase screen says
	 * that rather than printing a deadline derived from nothing.
	 *
	 * It exists here and not in `Purchase.php` because it is the same walk back
	 * as the film's and it must stay the same walk back: two schedules would
	 * disagree the first time somebody changed the buffer.
	 */
	public static function blank_deadline_for( \WC_Order $order, int $garments ): string {
		$approved = self::approval( Bat::current( $order ) );
		if ( '' === $approved['on'] ) {
			return '';
		}
		$urgency = Costing::urgence( $order );
		$urgency = '' !== $urgency ? $urgency : 'standard';
		$config  = self::config();
		$target  = self::target_date( $approved['on'], $urgency, $config );
		return '' === $target ? '' : self::latest_blank_order_on( $target, $garments, $config );
	}

	private static function queue_row( \WC_Order $order, string $today, array $config, array $film ): ?array {
		$blockers = Lifecycle::blockers( $order, Lifecycle::PRODUCTION );
		if ( array() !== $blockers ) {
			return null;
		}
		if ( null !== self::lot_of( $order ) ) {
			return null;
		}

		$work = Costing::transfers( $order );
		if ( array() === $work['pieces'] ) {
			return null;
		}

		$version  = Bat::current( $order );
		$approved = self::approval( $version );
		if ( '' === $approved['on'] ) {
			return null;
		}

		$urgency = Costing::urgence( $order );
		$urgency = '' !== $urgency ? $urgency : 'standard';
		$target  = self::target_date( $approved['on'], $urgency, $config );
		$plan    = self::origin_for( $today, $target, (int) $work['garments'], $config, $film );

		return array(
			'id'        => $order->get_id(),
			'ref'       => (string) $order->get_order_number(),
			'customer'  => trim( $order->get_billing_company() ?: ( $order->get_billing_first_name() . ' ' . $order->get_billing_last_name() ) ),
			'urgency'   => $urgency,
			'approved_on' => $approved['on'],
			'bat'       => array(
				'version' => $approved['version'],
				'by'      => $approved['by'],
			),
			'target_on' => $target,
			'origin'    => $plan['origin'],
			'order_by'  => $plan['order_by'],
			'order_by_fr' => $plan['order_by_fr'],
			'order_by_es' => $plan['order_by_es'],
			'late'      => $plan['late'],
			'garments'  => (int) $work['garments'],
			'transfers' => (int) $work['transfers'],
			/*
			 * FALSE MEANS A SIDE WHOSE GEOMETRY COULD NOT BE READ. `transfers()`
			 * emits no rectangle for it and counts it anyway, so a lot built on
			 * `pieces` alone would nest less film than it prints. The screen
			 * refuses to add such an order to a lot rather than costing it short.
			 */
			'complete'  => (bool) $work['complete'],
			'pieces'    => $work['pieces'],
			'ink_sq_cm' => self::ink_sq_cm( $order ),
			'designs'   => self::designs( $order ),
			'lines'     => self::lines( $order ),
		);
	}

	/**
	 * When and how the CURRENT proof was cleared, or ''.
	 *
	 * A WAIVER IS NOT AN APPROVAL and this is the one place that difference is
	 * recorded. `Bat::refusal()` returns '' for both, deliberately, because both
	 * authorise production; but the traceability chain a customer disputes runs
	 * « this is not what I approved », and « nobody approved it, the workshop
	 * waived the proof » is a different answer that the press sheet has to be
	 * able to give.
	 *
	 * @return array{on:string,version:int,by:string}
	 */
	public static function approval( ?array $version ): array {
		$none = array(
			'on'      => '',
			'version' => 0,
			'by'      => '',
		);
		if ( null === $version ) {
			return $none;
		}
		if ( ! empty( $version['changes'] ) ) {
			return $none;
		}
		$no = (int) ( $version['version'] ?? 0 );
		if ( ! empty( $version['approval']['at'] ) ) {
			return array(
				'on'      => substr( (string) $version['approval']['at'], 0, 10 ),
				'version' => $no,
				'by'      => 'client',
			);
		}
		if ( ! empty( $version['waiver']['at'] ) ) {
			return array(
				'on'      => substr( (string) $version['waiver']['at'], 0, 10 ),
				'version' => $no,
				'by'      => 'atelier',
			);
		}
		return $none;
	}

	/**
	 * Ink area of the whole order, cm2, the witness the shop checks a reported
	 * layout against.
	 *
	 * It is the measured area the CUSTOMER was charged for, times the garments,
	 * so the two cannot drift: an order that paid for 1 200 cm2 of ink needs at
	 * least 1 200 cm2 of film. See `Cost::minimum_run_length_cm`.
	 */
	public static function ink_sq_cm( \WC_Order $order ): float {
		$total = 0.0;
		foreach ( $order->get_items() as $item ) {
			if ( ! $item instanceof \WC_Order_Item_Product ) {
				continue;
			}
			$qty   = max( 1, (int) $item->get_quantity() );
			$sides = json_decode( (string) $item->get_meta( '_teeshoop_sides', true ), true );
			if ( ! is_array( $sides ) ) {
				continue;
			}
			foreach ( $sides as $side ) {
				if ( is_array( $side ) && isset( $side['area_sq_cm'] ) ) {
					$total += (float) $side['area_sq_cm'] * $qty;
				}
			}
		}
		return $total;
	}

	/** Every design id this order carries, in line order, deduplicated. */
	public static function designs( \WC_Order $order ): array {
		$out = array();
		foreach ( $order->get_items() as $item ) {
			if ( ! $item instanceof \WC_Order_Item_Product ) {
				continue;
			}
			$id = (string) $item->get_meta( '_teeshoop_design_id', true );
			if ( '' !== $id && ! in_array( $id, $out, true ) ) {
				$out[] = $id;
			}
		}
		return $out;
	}

	/**
	 * The blanks this order needs, one row per line, the picking list's source.
	 *
	 * The SKU comes from the WooCommerce product, which is where the catalogue
	 * importer put the supplier's own reference. A picking list built from the
	 * garment word alone ("tee, blanc") sends someone to a shelf holding four
	 * brands of white t-shirt.
	 */
	public static function lines( \WC_Order $order ): array {
		$out = array();
		foreach ( $order->get_items() as $item ) {
			if ( ! $item instanceof \WC_Order_Item_Product ) {
				continue;
			}
			$product = $item->get_product();
			$sizes   = json_decode( (string) $item->get_meta( '_teeshoop_size_grid', true ), true );
			$out[]   = array(
				'item_id'   => $item->get_id(),
				'design_id' => (string) $item->get_meta( '_teeshoop_design_id', true ),
				'garment'   => (string) $item->get_meta( '_teeshoop_garment', true ),
				'colour'    => (string) $item->get_meta( '_teeshoop_couleur', true ),
				'sku'       => $product ? (string) $product->get_sku() : '',
				'label'     => (string) $item->get_name(),
				'qty'       => max( 1, (int) $item->get_quantity() ),
				'sizes'     => is_array( $sizes ) ? array_map( 'intval', $sizes ) : array(),
			);
		}
		return $out;
	}

	// ── the lot, WordPress ───────────────────────────────────────────────────

	/**
	 * The part of an order's lot that decides its cost, for `Costing::stamp()`.
	 *
	 * Three fields and no more: whether the film was bought, at which origin, and
	 * for how much. The rest of the record moves for reasons that change no
	 * number, and a report that goes stale when the workshop ticks « film reçu »
	 * teaches an operator to ignore the word.
	 */
	public static function cost_stamp( \WC_Order $order ): string {
		$lot = self::lot_of( $order );
		if ( null === $lot ) {
			return '';
		}
		return implode(
			'|',
			array(
				(string) ( $lot['lot_id'] ?? '' ),
				self::DRAFT === ( $lot['state'] ?? '' ) ? 'brouillon' : 'achete',
				(string) ( $lot['origin'] ?? '' ),
				(string) (int) ( $lot['share_ht'] ?? 0 ),
			)
		);
	}

	/** The lot record this order belongs to, or null. */
	public static function lot_of( \WC_Order $order ): ?array {
		$raw = json_decode( (string) $order->get_meta( self::META_ORDER_LOT, true ), true );
		return is_array( $raw ) && isset( $raw['lot_id'] ) ? $raw : null;
	}

	/** One lot record by id, or null. */
	public static function lot( int $lot_id ): ?array {
		$post = get_post( $lot_id );
		if ( ! $post || self::POST_TYPE !== $post->post_type ) {
			return null;
		}
		$raw = json_decode( (string) get_post_meta( $lot_id, self::META_LOT, true ), true );
		return is_array( $raw ) ? $raw : null;
	}

	/** The most recent lots, newest first. */
	public static function lots( int $limit = 30 ): array {
		$posts = get_posts(
			array(
				'post_type'      => self::POST_TYPE,
				'post_status'    => 'any',
				'numberposts'    => $limit,
				'orderby'        => 'ID',
				'order'          => 'DESC',
				'fields'         => 'ids',
			)
		);
		$out = array();
		foreach ( $posts as $id ) {
			$lot = self::lot( (int) $id );
			if ( null !== $lot ) {
				$out[] = $lot;
			}
		}
		return $out;
	}

	// ── building a lot, and freezing it ──────────────────────────────────────

	/**
	 * Assemble a lot from a set of orders and the layout the studio measured.
	 *
	 * ── WHY THE LAYOUT IS MEASURED IN A BROWSER AND NOT HERE ─────────────────
	 *
	 * The same reason `worker/nest.ts` exists and the same reason it only packs
	 * rectangles. A transfer's extent is its INK, which lives in the alpha
	 * channel of a decoded image, and neither PHP nor a Cloudflare Worker has a
	 * canvas. The true-shape packer needs those alpha masks, and the gang sheets
	 * themselves are hundreds of megabytes of pixels at 300 DPI. Both belong in
	 * the admin bundle, which is where the code that renders them already lives.
	 *
	 * SO THE SHOP DOES NOT TRUST IT: IT BOUNDS IT. Four checks, none of which
	 * needs a tolerance anybody chose:
	 *
	 *   1. POSES. The garment-sides the studio says it pressed for an order must
	 *      equal the garment-sides that order has. It is the strong check and the
	 *      only exact one, because it is the only quantity that moves with
	 *      neither the grading (a 3XL transfer is bigger, not more numerous) nor
	 *      the split (question 32 lets the workshop force a single pose). The
	 *      transfers themselves are bounded, not counted: never fewer than the
	 *      poses, never more than a document may declare per side.
	 *   2. FLOOR. The billed length must be at least the posted artwork area
	 *      divided by the roll's printable width. You cannot print a square metre
	 *      of ink on less than a square metre of film. A length that is too short
	 *      under-costs every order in the lot and lowers every floor price.
	 *   3. CEILING. The billed length must be no more than what the SHELF packer
	 *      makes of the same pieces, asked of the Worker over `POST /api/nest`.
	 *      That bound is exact rather than generous: `nestShapeRoll` keeps the
	 *      shelf result as its own restart #0, so the layout it returns can never
	 *      be longer.
	 *   4. INK. For an order whose design does not scale with the garment, the
	 *      posted transfers must be big enough to hold the ink the order was
	 *      charged for. That is the document's own invariant rather than a
	 *      tolerance, and it holds under any split: merging two visuals makes the
	 *      boxes bigger, never smaller. A graded order is exempt from this one
	 *      and only this one (question 37).
	 *   5. THE DATE. An order that holds its target date on French film and does
	 *      not hold it in this lot is refused by name. An order that is late
	 *      whatever anybody does is not: it still has to be printed.
	 *   6. THE ROLL. The layout must have been packed on the film being bought,
	 *      at no less than the workshop's spacing. A wider sheet is a SHORTER
	 *      one, so no other check here can see it.
	 *
	 * WHEN THE WORKER CANNOT BE REACHED THE LOT IS REFUSED. « We could not ask »
	 * is not « it passed », and a lot created without its ceiling is a lot whose
	 * film cost nobody bounded.
	 *
	 * @param int[]  $order_ids
	 * @param string $origin    'fr' or 'es'.
	 * @param array  $layout    what the studio measured; see `read_layout`.
	 *
	 * @return array{ok:bool,reason:string,lot?:array}
	 */
	public static function create_lot( array $order_ids, string $origin, array $layout, string $today = '' ): array {
		$today  = '' !== $today ? $today : Settings::today();
		$config = self::config();
		$cost   = Costing::config();
		$film   = (array) ( $cost['film'] ?? array() );
		$width  = (float) ( $film['width_cm'] ?? 0 );

		$fail = static fn( string $why ): array => array(
			'ok'     => false,
			'reason' => $why,
		);

		if ( ! in_array( $origin, array( 'fr', 'es' ), true ) ) {
			return $fail( 'L’origine du film doit être la France ou l’Espagne.' );
		}
		if ( $width <= 0 ) {
			return $fail( 'La laize du rouleau n’est pas renseignée : rien ne peut être imbriqué.' );
		}

		$ids = array_values( array_unique( array_map( 'intval', $order_ids ) ) );
		sort( $ids );
		if ( count( $ids ) < 1 ) {
			return $fail( 'Un lot contient au moins une commande.' );
		}

		$read = self::read_layout( $layout, $ids );
		if ( ! $read['ok'] ) {
			return $fail( $read['reason'] );
		}

		$orders   = array();
		$garments = 0;
		$members  = array();
		$solo_m   = array();
		$ink      = array();
		$pieces   = array();

		foreach ( $ids as $id ) {
			$order = wc_get_order( $id );
			if ( ! $order instanceof \WC_Order ) {
				return $fail( sprintf( 'La commande %d n’existe pas.', $id ) );
			}
			$blockers = Lifecycle::blockers( $order, Lifecycle::PRODUCTION );
			if ( array() !== $blockers ) {
				return $fail( sprintf( 'La commande %s ne peut pas être produite : %s', $order->get_order_number(), implode( ' ', $blockers ) ) );
			}
			if ( null !== self::lot_of( $order ) ) {
				return $fail( sprintf( 'La commande %s est déjà dans un lot.', $order->get_order_number() ) );
			}

			$work = Costing::transfers( $order );
			if ( ! $work['complete'] ) {
				return $fail( sprintf( 'La géométrie de la commande %s est incomplète : un côté n’a pas pu être mesuré, donc le lot serait chiffré sous ce qu’il imprime.', $order->get_order_number() ) );
			}

			$posted = $read['orders'][ (string) $id ];

			// 1. COUNT.
			if ( $posted['poses'] !== (int) $work['poses'] ) {
				return $fail(
					sprintf(
						'La commande %s demande %d poses et la planche en porte %d : le lot ne décrit pas cette commande.',
						$order->get_order_number(),
						(int) $work['poses'],
						$posted['poses']
					)
				);
			}
			/*
			 * And the transfers are BOUNDED rather than counted, because how many
			 * a side prints as is the operator's decision (question 32: the
			 * workshop can force a single pose on a job where handling costs more
			 * than film). What cannot happen either way is fewer transfers than
			 * garment-sides, that is a side that will not be pressed, or more
			 * than the document format allows per side.
			 */
			if ( $posted['copies'] < $posted['poses'] || $posted['copies'] > $posted['poses'] * self::MAX_SIDE_PIECES ) {
				return $fail(
					sprintf(
						'La commande %s porte %d transferts pour %d poses : ce n’est pas une découpe possible.',
						$order->get_order_number(),
						$posted['copies'],
						$posted['poses']
					)
				);
			}

			// 2. FLOOR, per order.
			$floor_m = self::minimum_length_m( $posted['area_sq_cm'], $width );
			if ( $posted['solo_m'] + 1e-9 < $floor_m ) {
				return $fail( sprintf( 'La commande %s ne peut pas tenir sur %s m de film : son encre en demande %s m au minimum.', $order->get_order_number(), Money::number( $posted['solo_m'], 2 ), Money::number( $floor_m, 2 ) ) );
			}

			/*
			 * 4. GEOMETRY, for an order whose marking does not scale with the
			 * garment.
			 *
			 * The invariant is the document's own: the transfer rectangles must
			 * be big enough to hold the ink they claim to carry, which is what
			 * `Design::normalise_pieces` already enforces at the cart. It holds
			 * whatever the operator does to the split, merging two visuals
			 * makes the boxes BIGGER, never smaller, so it is a real check and
			 * not a tolerance. A layout nesting a different, smaller design fails
			 * it; one nesting a bigger design costs more film, which is the safe
			 * direction and needs no check.
			 *
			 * A GRADED order is exempt, and only from this one. Its real
			 * transfers are physically different per garment size from the single
			 * set measured at the pricing size, so a size run below M legitimately
			 * carries less ink than the order records (question 37). The pose
			 * count above still holds it.
			 */
			$stored_ink = self::ink_sq_cm( $order );
			if ( ! $work['graded'] && $stored_ink > 0 && $posted['area_sq_cm'] < $stored_ink * 0.99 ) {
				return $fail(
					sprintf(
						'Les visuels imbriqués pour la commande %s portent moins de surface que l’encre enregistrée sur elle. La planche ne vient pas de cette création.',
						$order->get_order_number()
					)
				);
			}

			$orders[ $id ] = $order;
			$garments     += (int) $work['garments'];
			$solo_m[ (string) $id ] = $posted['solo_m'];
			$ink[ (string) $id ]    = $posted['area_sq_cm'];
			foreach ( $posted['pieces'] as $n => $piece ) {
				$pieces[] = array(
					'id'   => $id . '/' . $n,
					'w_cm' => $piece['w_cm'],
					'h_cm' => $piece['h_cm'],
					'qty'  => $piece['qty'],
				);
			}

			$version  = Bat::current( $order );
			$approved = self::approval( $version );
			$urgency  = Costing::urgence( $order );
			$urgency  = '' !== $urgency ? $urgency : 'standard';
			$target   = self::target_date( $approved['on'], $urgency, $config );
			$plan     = self::origin_for( $today, $target, (int) $work['garments'], $config, $film );

			$order_by = $plan[ 'es' === $origin ? 'order_by_es' : 'order_by_fr' ];
			$late     = '' === $order_by || $order_by < $today;

			/*
			 * A LOT MAY NOT PUSH AN ORDER PAST ITS OWN DATE, and the difference
			 * between refusing and warning is who decided.
			 *
			 * An order that is already late whatever we do still has to be
			 * printed, and refusing it would leave it unprintable as well as
			 * late. But an order that WOULD hold its date on French film and
			 * misses it on Spanish is not late: somebody has just decided, on the
			 * customer's behalf, that five more days are acceptable in order to
			 * save half the film. That is refused here, by name, because it is a
			 * commercial decision wearing a technical one's clothes.
			 *
			 * The other direction is never refused: moving work to France is
			 * always faster and only ever costs us money.
			 */
			if ( $late && ! ( '' === $plan['order_by_fr'] || $plan['order_by_fr'] < $today ) ) {
				return $fail(
					sprintf(
						'La commande %s tient sa date cible avec du film français, et ne la tient pas avec ce lot : il faudrait commander le film avant le %s. Achetez ce lot en France, ou sortez cette commande.',
						$order->get_order_number(),
						self::fr_date( $order_by )
					)
				);
			}

			$members[ (string) $id ] = array(
				'id'          => $id,
				'ref'         => (string) $order->get_order_number(),
				'customer'    => trim( $order->get_billing_company() ?: ( $order->get_billing_first_name() . ' ' . $order->get_billing_last_name() ) ),
				'urgency'     => $urgency,
				/*
				 * THE WORD, not the slug. The press sheet is read by a human and
				 * `PriceRule::URGENCES` is where the shop's three levels are
				 * named; sending only `urgent` put a database key on a document an
				 * operator works from.
				 */
				'urgency_label' => PriceRule::URGENCES[ $urgency ] ?? $urgency,
				'bat'         => $approved,
				'designs'     => self::designs( $order ),
				'lines'       => self::lines( $order ),
				'garments'    => (int) $work['garments'],
				'transfers'   => (int) $work['transfers'],
				'graded'      => (bool) $work['graded'],
				'target_on'   => $target,
				'order_by'    => $order_by,
				/* Already late before this lot existed. Printed anyway, and said. */
				'late'        => $late,
			);
		}

		// 2. FLOOR, over the whole lot.
		$total_ink   = array_sum( $ink );
		$lot_floor_m = self::minimum_length_m( $total_ink, $width );
		if ( $read['pooled_m'] + 1e-9 < $lot_floor_m ) {
			return $fail( sprintf( 'Le lot ne peut pas tenir sur %s m de film : l’encre qu’il porte en demande %s m au minimum.', Money::number( $read['pooled_m'], 2 ), Money::number( $lot_floor_m, 2 ) ) );
		}

		/*
		 * 6. THE ROLL. A layout packed wider than the film being bought puts every
		 * transfer in that outer band outside the roll, and nothing else here can
		 * see it: a wider sheet is a SHORTER one, so the floor passes more easily
		 * and the ceiling, which only refuses a layout that is too long, never
		 * fires. The studio adopts the shop's geometry when a run is queued and
		 * then hands it back, so this compares what was measured against what is
		 * paid for rather than trusting either.
		 *
		 * The spacing is checked with it because the two are one setting: film
		 * packed at 0 mm between transfers is film the workshop cannot cut apart,
		 * and it is also a shorter sheet.
		 */
		/*
		 * THE ORIGIN HAS TO BE ONE THE TARIFF CAN BE BOUGHT FROM. The workshop
		 * screen still offers a choice, and `Cost::origins()` is one entry long
		 * since question 04's answer named a single supplier. A lot recorded as
		 * Spanish whose bill is French is a purchase record that does not
		 * describe the purchase.
		 */
		if ( ! in_array( $origin, Cost::origins( $film ), true ) ) {
			return $fail( 'Cette origine de film ne peut pas être achetée avec le tarif en vigueur, qui n’a qu’un fournisseur.' );
		}
		$geometry = self::film_geometry_reason( $read['layout'], $film );
		if ( '' !== $geometry ) {
			return $fail( $geometry );
		}

		// 3. CEILING, asked of the packer that will print it.
		$bound = Nest::billed_metres( $pieces, $cost );
		if ( ! $bound['ok'] ) {
			return $fail( 'Le métrage du lot n’a pas pu être vérifié : ' . Nest::reason_fr( $bound['reason'] ) . ' Aucun lot n’est créé sur un chiffrage invérifiable.' );
		}
		if ( $read['pooled_m'] > $bound['billed_m'] + 1e-9 ) {
			return $fail( sprintf( 'La planche annonce %s m alors que l’imbrication en bandes droites des mêmes transferts en fait %s m. Une planche ne peut pas être plus longue que ça.', Money::number( $read['pooled_m'], 2 ), Money::number( $bound['billed_m'], 2 ) ) );
		}

		$bill = Cost::attribute( $solo_m, $read['pooled_m'], $cost, $origin, $ink );

		$warnings = array();
		foreach ( $members as $m ) {
			if ( $m['late'] ) {
				$warnings[] = sprintf( 'La commande %s ne tient plus sa date cible avec cette origine (film à commander avant le %s).', $m['ref'], self::fr_date( $m['order_by'] ) );
			}
		}
		if ( $garments > (int) $config['manual_above'] ) {
			$warnings[] = sprintf( '%d vêtements dans un seul lot : au-delà de %d, la question 23 demande une validation manuelle avant lancement.', $garments, (int) $config['manual_above'] );
		}
		if ( $bill['worse'] ) {
			$warnings[] = 'Ce lot coûte plus cher que les mêmes commandes achetées séparément. Vérifiez avant de commander le film.';
		}

		$order_by = '';
		foreach ( $members as $m ) {
			if ( '' === $order_by || $m['order_by'] < $order_by ) {
				$order_by = $m['order_by'];
			}
		}

		$record = array(
			'version'   => 1,
			'state'     => self::DRAFT,
			'origin'    => $origin,
			'created_on' => $today,
			'created_by' => get_current_user_id(),
			'sent_on'   => '',
			'order_by'  => $order_by,
			'garments'  => $garments,
			'members'   => array_values( $members ),
			'layout'    => $read['layout'],
			'bill'      => $bill,
			'bound_m'   => $bound['billed_m'],
			'floor_m'   => $lot_floor_m,
			'warnings'  => $warnings,
		);

		/*
		 * ONE LOT AT A TIME. The "already in a lot" check above and the write
		 * below are separated by a Worker round trip of up to ten seconds, so two
		 * admin tabs, or a double click, could both pass the check and both write
		 * a lot naming the same orders: the second write wins on the order meta,
		 * the first lot keeps a member that no longer points at it, and the film
		 * of those orders is paid for twice. The lock is the one the invoice
		 * sequence already uses.
		 */
		if ( ! Invoice::lock( self::LOCK ) ) {
			return $fail( 'Un autre lot est en cours de constitution. Réessayez dans un instant.' );
		}
		foreach ( $orders as $id => $order ) {
			if ( null !== self::lot_of( wc_get_order( $id ) ) ) {
				Invoice::unlock( self::LOCK );
				return $fail( sprintf( 'La commande %s vient d’être mise dans un autre lot.', $order->get_order_number() ) );
			}
		}

		$lot_id = wp_insert_post(
			array(
				'post_type'   => self::POST_TYPE,
				'post_status' => 'publish',
				'post_title'  => sprintf( 'Lot %s · %s', $today, 'es' === $origin ? 'Espagne' : 'France' ),
			),
			true
		);
		if ( is_wp_error( $lot_id ) || 0 === (int) $lot_id ) {
			Invoice::unlock( self::LOCK );
			return $fail( 'Le lot n’a pas pu être enregistré.' );
		}
		$record['lot_id'] = (int) $lot_id;
		/*
		 * THE RECORD IS THE LOT. The post is only somewhere to hang it, so a post
		 * that exists with no record is worse than no post at all: `lot()` returns
		 * null for it, the orders below would still be pinned to its id, and the
		 * queue would exclude them for ever with nothing to undo. `wp_json_encode`
		 * returns false on a value it cannot encode and `update_post_meta` returns
		 * false when the write fails; both are checked, and the post goes with the
		 * failure.
		 */
		$encoded = wp_json_encode( $record );
		if ( false === $encoded || false === update_post_meta( (int) $lot_id, self::META_LOT, $encoded ) ) {
			wp_delete_post( (int) $lot_id, true );
			Invoice::unlock( self::LOCK );
			return $fail( 'Le lot n’a pas pu être enregistré : aucune commande n’y a été rattachée.' );
		}

		foreach ( $orders as $id => $order ) {
			$share = $bill['shares'][ (string) $id ] ?? array();
			$order->update_meta_data(
				self::META_ORDER_LOT,
				wp_json_encode(
					array(
						'lot_id'        => (int) $lot_id,
						'state'         => self::DRAFT,
						'origin'        => $origin,
						'pooled_m'      => $read['pooled_m'],
						'solo_m'        => $share['solo_m'] ?? 0.0,
						'solo_ht'       => $share['solo_ht'] ?? 0,
						'share_ht'      => $share['share_ht'] ?? 0,
						'saved_ht'      => $share['saved_ht'] ?? 0,
						'area_share_ht' => $share['area_share_ht'] ?? 0,
						'orders'        => count( $ids ),
					)
				)
			);
			$order->save();
		}

		Invoice::unlock( self::LOCK );

		return array(
			'ok'     => true,
			'reason' => '',
			'lot'    => $record,
		);
	}

	/**
	 * Order the film: the lot is frozen and every member's cost report is redone.
	 *
	 * FREEZING IS THE POINT. From here the film that will arrive was cut from
	 * THIS layout, so re-nesting it silently is how two customers get each
	 * other's shirt. Nothing may join, nothing may leave, and the layout is the
	 * one in the record.
	 *
	 * IT IS ALSO THE MOMENT THE ORIGIN STARTS TO COUNT, and it is worth being
	 * precise about what that is worth. `PriceRule::URGENCES` refuses to let an
	 * urgency dropdown pick the film's country because a tick is not evidence
	 * about which roll was bought. What a sent lot records is stronger than a
	 * tick and weaker than an invoice: ONE declaration for a whole run, made by a
	 * named user on a dated act that also freezes the layout, and defaulting to
	 * France, the dearer origin, so that choosing the cheap one is deliberate.
	 * It is not proof of purchase, and the day a supplier invoice can be attached
	 * to a run that is what should decide. Until then this is the best evidence
	 * the shop has, and a DRAFT lot is not evidence at all: it changes no cost.
	 *
	 * @return array{ok:bool,reason:string}
	 */
	public static function send_lot( int $lot_id, string $today = '' ): array {
		$lot = self::lot( $lot_id );
		if ( null === $lot ) {
			return array(
				'ok'     => false,
				'reason' => 'Ce lot n’existe pas.',
			);
		}
		if ( self::DRAFT !== $lot['state'] ) {
			return array(
				'ok'     => false,
				'reason' => 'Le film de ce lot a déjà été commandé.',
			);
		}

		/*
		 * EVERY MEMBER, OR NONE. Skipping a member that could not be read looked
		 * defensive and is the opposite: that order keeps no share, so its report
		 * costs its own film in full while the others have already split the same
		 * roll between them, and the same metres are paid for twice. A run is one
		 * purchase; sending it is one act.
		 */
		$orders = array();
		foreach ( $lot['members'] as $member ) {
			$order = wc_get_order( (int) $member['id'] );
			if ( ! $order instanceof \WC_Order ) {
				return array(
					'ok'     => false,
					'reason' => sprintf( 'La commande %d de ce lot est introuvable : rien n’a été commandé.', (int) $member['id'] ),
				);
			}
			$part = self::lot_of( $order );
			if ( null === $part || (int) $part['lot_id'] !== $lot_id ) {
				return array(
					'ok'     => false,
					'reason' => sprintf( 'La commande %s ne porte plus sa part de ce lot : rien n’a été commandé.', $order->get_order_number() ),
				);
			}
			$orders[] = array( $order, $part );
		}

		/*
		 * THE BILL IS SPLIT AT THE MOMENT OF PURCHASE, not at the moment of
		 * planning. A draft can sit for a day, and the tariff, the roll width or
		 * the delivery charge can be edited on the cost screen in between; the
		 * shares written at draft time would then describe a purchase at last
		 * week's prices, and nothing would say so, because a draft deliberately
		 * changes no cost and therefore raises no staleness anywhere.
		 *
		 * Re-splitting uses the SAME measured lengths: the layout is what it is,
		 * only the tariff can have moved.
		 *
		 * ── EXCEPT THAT THE GEOMETRY CAN MOVE TOO, AND THEN IT IS SCRAP ──────
		 *
		 * The paragraph above anticipated a TARIFF changing under a draft. On
		 * 1 September 2026 the answer to question 04 changed the FILM: a 56 cm
		 * roll became a 33 x 46 cm sheet. A draft nested on the roll is a plate
		 * 56 cm wide, and re-pricing it on sheets buys film that plate cannot be
		 * printed on. `create_lot` refuses a mismatched laize; nothing repeated
		 * that at the moment the money is actually spent, which is here.
		 *
		 * Found by the adversarial pass over this session's own diff.
		 */
		$film_now = (array) ( Costing::config()['film'] ?? array() );
		$geometry = self::film_geometry_reason( (array) ( $lot['layout'] ?? array() ), $film_now );
		if ( '' !== $geometry ) {
			return array(
				'ok'     => false,
				'reason' => 'Le film a changé depuis que ce brouillon a été préparé. ' . $geometry . ' Défaites le lot et reprenez l’imbrication : la planche ne s’imprimerait pas.',
			);
		}

		/*
		 * AND AN ORIGIN THAT CAN NO LONGER BE BOUGHT FROM. `Cost::origins()` is
		 * one entry long on the tariff in force, and a draft can carry 'es' from
		 * before it was. Sending it would record a Spanish purchase whose bill is
		 * French.
		 */
		if ( ! in_array( (string) $lot['origin'], Cost::origins( $film_now ), true ) ) {
			return array(
				'ok'     => false,
				'reason' => 'Ce lot a été préparé pour une origine de film qui n’est plus disponible. Défaites-le et reprenez-le : le tarif en vigueur n’a qu’un fournisseur.',
			);
		}

		$solo = array();
		$ink  = array();
		foreach ( (array) ( $lot['layout']['orders'] ?? array() ) as $id => $row ) {
			$solo[ (string) $id ] = (float) ( $row['solo_m'] ?? 0 );
			$ink[ (string) $id ]  = (float) ( $row['area_sq_cm'] ?? 0 );
		}
		$bill = array() !== $solo
			? Cost::attribute( $solo, (float) ( $lot['layout']['pooled_m'] ?? 0 ), Costing::config(), (string) $lot['origin'], $ink )
			: $lot['bill'];

		$lot['bill']    = $bill;
		$lot['state']   = self::SENT;
		$lot['sent_on'] = '' !== $today ? $today : Settings::today();
		$lot['sent_by'] = get_current_user_id();
		update_post_meta( $lot_id, self::META_LOT, wp_json_encode( $lot ) );

		foreach ( $orders as [ $order, $part ] ) {
			$share            = $bill['shares'][ (string) $order->get_id() ] ?? array();
			$part['solo_ht']  = (int) ( $share['solo_ht'] ?? $part['solo_ht'] ?? 0 );
			$part['share_ht'] = (int) ( $share['share_ht'] ?? $part['share_ht'] ?? 0 );
			$part['saved_ht'] = (int) ( $share['saved_ht'] ?? $part['saved_ht'] ?? 0 );
			$part['area_share_ht'] = (int) ( $share['area_share_ht'] ?? $part['area_share_ht'] ?? 0 );
			$part['state']   = self::SENT;
			$part['sent_on'] = $lot['sent_on'];
			$order->update_meta_data( self::META_ORDER_LOT, wp_json_encode( $part ) );
			$order->save();
			// The share only reaches the margin engine once the film is bought.
			Costing::refresh( $order );
		}

		return array(
			'ok'     => true,
			'reason' => '',
		);
	}

	/**
	 * Undo a draft: the orders go back into the queue.
	 *
	 * WITHOUT THIS AN ORDER COULD JOIN A LOT AND NEVER LEAVE ONE. The queue
	 * excludes anything already in a lot, deliberately, so a draft built from the
	 * wrong selection stranded paid, approved orders out of production with no way
	 * back. Only a DRAFT can be undone: past that the film is bought, and the
	 * layout that was sent is the one that will arrive.
	 *
	 * @return array{ok:bool,reason:string}
	 */
	public static function discard_lot( int $lot_id ): array {
		$lot = self::lot( $lot_id );
		if ( null === $lot ) {
			return array(
				'ok'     => false,
				'reason' => 'Ce lot n’existe pas.',
			);
		}
		if ( self::DRAFT !== $lot['state'] ) {
			return array(
				'ok'     => false,
				'reason' => 'Le film de ce lot a été commandé : il ne peut plus être défait.',
			);
		}
		foreach ( $lot['members'] as $member ) {
			$order = wc_get_order( (int) $member['id'] );
			if ( ! $order instanceof \WC_Order ) {
				continue;
			}
			$part = self::lot_of( $order );
			if ( null === $part || (int) $part['lot_id'] !== $lot_id ) {
				continue;
			}
			$order->delete_meta_data( self::META_ORDER_LOT );
			$order->save();
			// The order pays for its own film again from this moment.
			Costing::refresh( $order );
		}
		wp_delete_post( $lot_id, true );
		return array(
			'ok'     => true,
			'reason' => '',
		);
	}

	/** Move a frozen lot along. Never back to draft: the film is bought. */
	public static function advance_lot( int $lot_id, string $state ): array {
		$lot = self::lot( $lot_id );
		if ( null === $lot ) {
			return array(
				'ok'     => false,
				'reason' => 'Ce lot n’existe pas.',
			);
		}
		$forward = array(
			self::SENT     => self::RECEIVED,
			self::RECEIVED => self::DONE,
		);
		if ( ! isset( $forward[ $lot['state'] ] ) || $forward[ $lot['state'] ] !== $state ) {
			return array(
				'ok'     => false,
				'reason' => 'Un lot ne peut avancer que d’une étape, et jamais revenir en arrière : le film est acheté.',
			);
		}
		$lot['state'] = $state;
		update_post_meta( $lot_id, self::META_LOT, wp_json_encode( $lot ) );
		foreach ( $lot['members'] as $member ) {
			$order = wc_get_order( (int) $member['id'] );
			if ( ! $order instanceof \WC_Order ) {
				continue;
			}
			$part = self::lot_of( $order );
			if ( null === $part || (int) $part['lot_id'] !== $lot_id ) {
				continue;
			}
			$part['state'] = $state;
			$order->update_meta_data( self::META_ORDER_LOT, wp_json_encode( $part ) );
			$order->save();
		}
		return array(
			'ok'     => true,
			'reason' => '',
		);
	}

	/**
	 * The shortest film a set of artwork can possibly be printed on, metres.
	 *
	 * Not a tolerance and not an estimate: area divided by width. It is the one
	 * bound the shop can state about a layout it did not compute, and it bounds
	 * the BILLED length too, since billing rounds a raw extent up and never down.
	 *
	 * THE AREA IS THE TRANSFER BOXES, not the ink inside them. It is called with
	 * `$posted['area_sq_cm']`, the sum of the rectangles the studio says it
	 * nested, which is larger than the ink and therefore a HIGHER floor: a bound
	 * on how short a length may be gets stronger as the area gets bigger, so the
	 * conservative direction is the one taken. It also makes the check a
	 * self-consistency test of the layout's own numbers, which is what lets it
	 * hold for a graded order whose real ink nobody here can know.
	 */
	public static function minimum_length_m( float $area_sq_cm, float $width_cm ): float {
		if ( $width_cm <= 0 || $area_sq_cm <= 0 ) {
			return 0.0;
		}
		return $area_sq_cm / $width_cm / 100;
	}

	/**
	 * Read what the studio says it nested, or say which rule the body broke.
	 *
	 * Bounded exactly like `worker/nest.ts` bounds its own body, and for the same
	 * reason: these numbers decide a cost, so a shape nobody checked is a cost
	 * nobody checked. A reason rather than an empty result, because « this lot
	 * needs no film » and « we could not read your request » must never be the
	 * same answer.
	 *
	 * @param int[] $ids
	 * @return array{ok:bool,reason:string,pooled_m?:float,orders?:array,layout?:array}
	 */
	public static function read_layout( array $layout, array $ids ): array {
		$fail = static fn( string $why ): array => array(
			'ok'     => false,
			'reason' => $why,
		);

		$pooled = isset( $layout['pooled_m'] ) && is_numeric( $layout['pooled_m'] ) ? (float) $layout['pooled_m'] : -1.0;
		if ( ! is_finite( $pooled ) || $pooled <= 0 || $pooled > self::MAX_RUN_M ) {
			return $fail( 'La planche n’annonce aucune longueur utilisable.' );
		}

		$width = isset( $layout['width_cm'] ) && is_numeric( $layout['width_cm'] ) ? (float) $layout['width_cm'] : 0.0;
		$gap   = isset( $layout['gap_cm'] ) && is_numeric( $layout['gap_cm'] ) ? (float) $layout['gap_cm'] : -1.0;
		if ( ! is_finite( $width ) || $width <= 0 || ! is_finite( $gap ) || $gap < 0 ) {
			return $fail( 'La planche ne dit pas sur quelle laize elle a été imbriquée.' );
		}

		$raw = $layout['orders'] ?? null;
		if ( ! is_array( $raw ) ) {
			return $fail( 'La planche ne dit pas ce qu’elle contient pour chaque commande.' );
		}

		$out = array();
		foreach ( $ids as $id ) {
			$key = (string) $id;
			if ( ! isset( $raw[ $key ] ) || ! is_array( $raw[ $key ] ) ) {
				return $fail( sprintf( 'La planche ne dit rien de la commande %d.', $id ) );
			}
			$row  = $raw[ $key ];
			$solo = isset( $row['solo_m'] ) && is_numeric( $row['solo_m'] ) ? (float) $row['solo_m'] : -1.0;
			if ( ! is_finite( $solo ) || $solo <= 0 || $solo > self::MAX_RUN_M ) {
				return $fail( sprintf( 'La planche n’annonce pas ce que la commande %d aurait coûté seule.', $id ) );
			}
			$pieces = is_array( $row['pieces'] ?? null ) ? $row['pieces'] : array();
			if ( array() === $pieces || count( $pieces ) > self::MAX_PIECES ) {
				return $fail( sprintf( 'La planche décrit %d transferts pour la commande %d.', count( $pieces ), $id ) );
			}
			$clean  = array();
			$copies = 0;
			$area   = 0.0;
			foreach ( $pieces as $piece ) {
				if ( ! is_array( $piece ) ) {
					return $fail( sprintf( 'Un transfert de la commande %d n’est pas lisible.', $id ) );
				}
				$w   = isset( $piece['w_cm'] ) && is_numeric( $piece['w_cm'] ) ? (float) $piece['w_cm'] : 0.0;
				$h   = isset( $piece['h_cm'] ) && is_numeric( $piece['h_cm'] ) ? (float) $piece['h_cm'] : 0.0;
				$qty = isset( $piece['qty'] ) && is_numeric( $piece['qty'] ) ? (int) $piece['qty'] : 0;
				if ( ! is_finite( $w ) || ! is_finite( $h ) || $w <= 0 || $h <= 0
					|| $w > self::MAX_PIECE_CM || $h > self::MAX_PIECE_CM
					|| $qty <= 0 || $qty > self::MAX_INSTANCES ) {
					return $fail( sprintf( 'Un transfert de la commande %d n’a pas des dimensions plausibles.', $id ) );
				}
				$clean[] = array(
					'key'  => isset( $piece['key'] ) ? substr( (string) $piece['key'], 0, 120 ) : '',
					'w_cm' => $w,
					'h_cm' => $h,
					'qty'  => $qty,
				);
				$copies += $qty;
				$area   += $w * $h * $qty;
			}
			/*
			 * The poses are DECLARED, not derived from the pieces, because they
			 * are the thing being checked: a layout that had lost a side would
			 * derive the wrong number from its own wrong pieces and check out.
			 */
			$poses = isset( $row['poses'] ) && is_numeric( $row['poses'] ) ? (int) $row['poses'] : 0;
			if ( $poses <= 0 || $poses > self::MAX_INSTANCES ) {
				return $fail( sprintf( 'La planche ne dit pas combien de poses elle porte pour la commande %d.', $id ) );
			}
			$out[ $key ] = array(
				'solo_m'     => $solo,
				'pieces'     => $clean,
				'copies'     => $copies,
				'poses'      => $poses,
				'area_sq_cm' => $area,
			);
		}

		foreach ( array_keys( $raw ) as $key ) {
			if ( ! in_array( (int) $key, $ids, true ) ) {
				return $fail( sprintf( 'La planche contient la commande %s, qui n’est pas dans ce lot.', (string) $key ) );
			}
		}

		return array(
			'ok'       => true,
			'reason'   => '',
			'pooled_m' => $pooled,
			'width_cm' => $width,
			'gap_cm'   => $gap,
			'orders'   => $out,
			'layout'   => array(
				'pooled_m'   => $pooled,
				'width_cm'   => $width,
				'gap_cm'     => $gap,
				'billing_step_cm' => isset( $layout['billing_step_cm'] ) && is_numeric( $layout['billing_step_cm'] ) ? (float) $layout['billing_step_cm'] : 0.0,
				'sheets'     => isset( $layout['sheets'] ) ? max( 0, (int) $layout['sheets'] ) : 0,
				'packer'     => 'trueshape' === ( $layout['packer'] ?? '' ) ? 'trueshape' : 'shelf',
				'interlock_cm' => isset( $layout['interlock_cm'] ) ? (float) $layout['interlock_cm'] : 0.0,
				'restarts'   => isset( $layout['restarts'] ) ? max( 1, (int) $layout['restarts'] ) : 1,
				'flip'       => ! empty( $layout['flip'] ),
				'app_version' => isset( $layout['app_version'] ) ? substr( (string) $layout['app_version'], 0, 40 ) : '',
				'orders'     => $out,
			),
		);
	}

	/**
	 * Why this plate cannot be printed on this film, or '' when it can.
	 *
	 * ONE RULE, TWO MOMENTS. `create_lot` asks it of the film in force the day
	 * the plate is nested, and `send_lot` asks it again of the film in force the
	 * day the money is actually spent, because a week can pass in between and the
	 * laize is an editable field on the cost screen. Two copies of this
	 * comparison is how the second one comes to be missing, which is exactly what
	 * the adversarial pass of session 13b found.
	 */
	public static function film_geometry_reason( array $layout, array $film ): string {
		$width = (float) ( $film['width_cm'] ?? 0 );
		$plate = (float) ( $layout['width_cm'] ?? 0 );
		if ( $width > 0 && $plate > 0 && abs( $plate - $width ) > 0.01 ) {
			return sprintf(
				'La planche a été imbriquée sur une laize de %s cm alors que le film fait %s cm.',
				Money::number( $plate, 1 ),
				Money::number( $width, 1 )
			);
		}

		/*
		 * The spacing is one setting with the laize: film packed at 0 mm between
		 * transfers is film the workshop cannot cut apart, and it is also a
		 * shorter sheet, so no length check would see it.
		 */
		$gap  = (float) ( $film['gap_cm'] ?? 0 );
		$kept = (float) ( $layout['gap_cm'] ?? 0 );
		if ( $kept + 0.001 < $gap ) {
			return sprintf(
				'La planche laisse %s cm entre les transferts alors que l’atelier en demande %s.',
				Money::number( $kept, 2 ),
				Money::number( $gap, 2 )
			);
		}

		if ( 'sheet' !== (string) ( $film['billing'] ?? 'roll' ) ) {
			return '';
		}

		/*
		 * A SHEET EDGE IS A PHYSICAL CUT. Under the roll tariff a longer file was
		 * simply a longer cut and the length of the plate was nobody's business
		 * but the packer's. Question 04's answer made the film a 33 x 46 cm
		 * sheet, and every 46 cm became a real edge: a plate packed longer than
		 * one sheet is a plate the press cuts through, and it is discovered with
		 * several customers' garments already pulled off the shelf.
		 *
		 * The studio's length field is editable on purpose (an operator may pack
		 * tighter) and clamps against the SUPPLIER PROFILE's own maximum, metres
		 * long on a roll process, not against the film the shop buys. Nothing
		 * compared the two.
		 *
		 * The report carries no per-sheet length, so this compares the only thing
		 * it can: the plate divided by the number of sheets the packer says it
		 * made. Six sheets of 46 cm pass; one continuous plate of the same ink
		 * does not. A report
		 * that does not say how many sheets it made counts as one, which is the
		 * conservative reading and the one that refuses.
		 */
		$max = (float) ( $film['max_length_cm'] ?? 0 );
		$n   = max( 1, (int) ( $layout['sheets'] ?? 0 ) );
		$avg = (float) ( $layout['pooled_m'] ?? 0 ) * 100 / $n;
		if ( $max > 0 && $avg > $max + 0.01 ) {
			return sprintf(
				'La planche fait %s cm en %d feuille(s), soit %s cm par feuille, alors que le film n’en fait que %s. Chaque bord de feuille couperait dans un transfert.',
				Money::number( (float) ( $layout['pooled_m'] ?? 0 ) * 100, 1 ),
				$n,
				Money::number( $avg, 1 ),
				Money::number( $max, 1 )
			);
		}

		/*
		 * And the step the plate was billed on has to be the step the shop pays:
		 * `Cost::film()` divides by the sheet height, so a plate packed to a
		 * different step is counted in sheets it was not cut into.
		 */
		$step = (float) ( $film['billing_step_cm'] ?? 0 );
		$took = (float) ( $layout['billing_step_cm'] ?? 0 );
		if ( $step > 0 && $took > 0 && abs( $took - $step ) > 0.01 ) {
			return sprintf(
				'La planche a été découpée par pas de %s cm alors que la feuille achetée en fait %s.',
				Money::number( $took, 1 ),
				Money::number( $step, 1 )
			);
		}

		return '';
	}

	/** ISO date as a French one. Display only. */
	public static function fr_date( string $iso ): string {
		return 1 === preg_match( '/^(\d{4})-(\d{2})-(\d{2})$/', $iso, $m ) ? "$m[3]/$m[2]/$m[1]" : $iso;
	}

	// ── the REST surface the studio talks to ─────────────────────────────────

	/**
	 * `wc-teeshoop/v1`, and the prefix is the whole point.
	 *
	 * The workshop tool is the admin studio, which runs on the Worker's origin
	 * and therefore has no WordPress cookie and no REST nonce, the same problem
	 * the customer studio has, for the same reason. What it DOES have is the
	 * WooCommerce consumer key and secret the catalogue importer already uses
	 * (`src/lib/ingest/woo.ts`).
	 *
	 * WooCommerce authenticates a REST request by key only when the route looks
	 * like one of its own: `WC_REST_Authentication::is_request_to_rest_api()`
	 * matches `wc/` and, expressly for third parties, `wc-`. So a namespace
	 * beginning `wc-` is WooCommerce's own documented opt-in, and it is the
	 * reason this is not `teeshoop/v1` beside the public routes. It also keeps
	 * the two surfaces visibly apart: `teeshoop/v1` is public and returns selling
	 * prices, this one is admin-only and returns customers, deadlines and film.
	 */
	private const REST_NS = 'wc-teeshoop/v1';

	public static function register_rest(): void {
		$admin = array( self::class, 'may_manage' );

		register_rest_route(
			self::REST_NS,
			'/production/queue',
			array(
				'methods'             => \WP_REST_Server::READABLE,
				'callback'            => array( self::class, 'rest_queue' ),
				'permission_callback' => $admin,
			)
		);

		register_rest_route(
			self::REST_NS,
			'/production/lots',
			array(
				array(
					'methods'             => \WP_REST_Server::READABLE,
					'callback'            => array( self::class, 'rest_lots' ),
					'permission_callback' => $admin,
				),
				array(
					'methods'             => \WP_REST_Server::CREATABLE,
					'callback'            => array( self::class, 'rest_create_lot' ),
					'permission_callback' => $admin,
				),
			)
		);

		register_rest_route(
			self::REST_NS,
			'/production/lots/(?P<id>\d+)',
			array(
				'methods'             => \WP_REST_Server::DELETABLE,
				'callback'            => array( self::class, 'rest_discard_lot' ),
				'permission_callback' => $admin,
			)
		);

		register_rest_route(
			self::REST_NS,
			'/production/lots/(?P<id>\d+)/etat',
			array(
				'methods'             => \WP_REST_Server::CREATABLE,
				'callback'            => array( self::class, 'rest_lot_state' ),
				'permission_callback' => $admin,
			)
		);
	}

	/**
	 * The one permission, spelled out rather than `is_user_logged_in`.
	 *
	 * Everything behind it is shop-internal: customer names, deadlines, our film
	 * economics and the share each order is charged. `manage_woocommerce` is the
	 * capability the cost screens already use, so there is one answer to "who may
	 * see what an order costs us".
	 */
	public static function may_manage(): bool|\WP_Error {
		if ( current_user_can( 'manage_woocommerce' ) ) {
			return true;
		}
		return new \WP_Error(
			'teeshoop_forbidden',
			__( 'Cette route est réservée à l’atelier.', 'teeshoop' ),
			array( 'status' => rest_authorization_required_code() )
		);
	}

	/** GET /production/queue: what could go on a press today. */
	public static function rest_queue( \WP_REST_Request $request ): \WP_REST_Response {
		$today  = self::read_date( (string) $request->get_param( 'today' ) );
		$config = self::config();
		$film   = (array) ( Costing::config()['film'] ?? array() );

		return new \WP_REST_Response(
			array(
				'today'     => $today,
				'orders'    => self::queue( $today ),
				/*
				 * Reported rather than assumed. A studio that nested "the queue"
				 * while the queue was cut short would leave the tail of the
				 * workshop's day unprinted with nothing saying so.
				 */
				'truncated' => Production::queue_truncated(),
				/*
				 * The geometry the studio must nest on. It is sent rather than
				 * assumed because the roll the shop is quoted on is a stored
				 * setting: a studio packing 58 cm while the shop pays for 56 would
				 * produce a layout the supplier cannot print and a cost nobody
				 * can reconcile.
				 */
				'film'   => array(
					'width_cm'        => (float) ( $film['width_cm'] ?? 0 ),
					'gap_cm'          => (float) ( $film['gap_cm'] ?? 0 ),
					'max_length_cm'   => (float) ( $film['max_length_cm'] ?? 0 ),
					'billing_step_cm' => (float) ( $film['billing_step_cm'] ?? 10 ),
					'days_fr'         => (int) ( $film['days_fr'] ?? 0 ),
					'days_es'         => (int) ( $film['days_es'] ?? 0 ),
				),
				'capacity' => array(
					'press_per_day' => (int) $config['press_per_day'],
					'manual_above'  => (int) $config['manual_above'],
				),
				/*
				 * Sent so the screen can say it out loud. Two of the three
				 * promised lead times cannot be kept at these defaults, and an
				 * operator planning a day is exactly who needs to know.
				 */
				'feasibility' => self::feasibility( $config, $film ),
			)
		);
	}

	/** GET /production/lots: the recent lots, newest first. */
	public static function rest_lots( \WP_REST_Request $request ): \WP_REST_Response {
		$limit = (int) $request->get_param( 'limit' );
		return new \WP_REST_Response(
			array( 'lots' => self::lots( $limit > 0 ? min( 100, $limit ) : 30 ) )
		);
	}

	/** POST /production/lots: create one from a chosen set and a measured layout. */
	public static function rest_create_lot( \WP_REST_Request $request ): \WP_REST_Response|\WP_Error {
		$body = $request->get_json_params();
		if ( ! is_array( $body ) ) {
			return new \WP_Error( 'teeshoop_bad_body', __( 'Requête incorrecte.', 'teeshoop' ), array( 'status' => 400 ) );
		}
		$made = self::create_lot(
			array_map( 'intval', (array) ( $body['orders'] ?? array() ) ),
			(string) ( $body['origin'] ?? '' ),
			is_array( $body['layout'] ?? null ) ? $body['layout'] : array(),
			self::read_date( (string) ( $body['today'] ?? '' ) )
		);
		if ( ! $made['ok'] ) {
			return new \WP_Error( 'teeshoop_lot_refuse', $made['reason'], array( 'status' => 422 ) );
		}
		return new \WP_REST_Response( array( 'lot' => $made['lot'] ), 201 );
	}

	/** POST /production/lots/{id}/etat: order the film, receive it, close it. */
	public static function rest_lot_state( \WP_REST_Request $request ): \WP_REST_Response|\WP_Error {
		$id    = (int) $request->get_param( 'id' );
		$body  = $request->get_json_params();
		$state = is_array( $body ) ? (string) ( $body['state'] ?? '' ) : '';

		$done = self::SENT === $state
			? self::send_lot( $id, self::read_date( is_array( $body ) ? (string) ( $body['today'] ?? '' ) : '' ) )
			: self::advance_lot( $id, $state );

		if ( ! $done['ok'] ) {
			return new \WP_Error( 'teeshoop_lot_etat', $done['reason'], array( 'status' => 409 ) );
		}
		return new \WP_REST_Response( array( 'lot' => self::lot( $id ) ) );
	}

	/** DELETE /production/lots/{id}: undo a draft, freeing its orders. */
	public static function rest_discard_lot( \WP_REST_Request $request ): \WP_REST_Response|\WP_Error {
		$done = self::discard_lot( (int) $request->get_param( 'id' ) );
		if ( ! $done['ok'] ) {
			return new \WP_Error( 'teeshoop_lot_defait', $done['reason'], array( 'status' => 409 ) );
		}
		return new \WP_REST_Response( array( 'ok' => true ) );
	}

	/**
	 * A date from a request, or today.
	 *
	 * A PARAMETER AND NOT A CONVENIENCE: every schedule in this module is a pure
	 * function of the day it is asked about, which is what lets a run be replayed
	 * and a test assert a date. It is only ever read from an admin request, so
	 * the worst an operator can do with it is plan against the wrong Tuesday.
	 */
	private static function read_date( string $raw ): string {
		return null !== self::date( $raw ) ? $raw : Settings::today();
	}
}
