<?php
/**
 * The workshop's day: what is ready to print, when it has to be bought, and
 * which orders are printed on the same film.
 *
 * Until this file, nesting was a property of one order. The Bible says
 * otherwise in as many words — « Chaque commande est divisée en lots homogènes »
 * and « Le DTF peut être commandé en France pour les urgences ou en Espagne pour
 * les délais standards » — and so does `worker/design.ts`, which stores the
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
 * INTERNAL target — the date the workshop plans against — and it is called
 * « date cible » everywhere an operator can read it, never « date de
 * livraison ». It becomes a promise the day the associate answers and the site
 * publishes it, and not before. Printing it to a customer before then would be
 * inventing a commitment out of a default value.
 *
 * ── FREEZING ─────────────────────────────────────────────────────────────────
 *
 * A lot that has been sent to the printer is frozen: its orders cannot leave, no
 * order can join, and the layout cannot be re-nested. Re-nesting a sent lot
 * silently is how two customers get each other's shirt — the film that arrives
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
	 * because this end has to refuse a body the other end would refuse anyway —
	 * and because a bound that only exists downstream is a bound nobody applied
	 * when the downstream call fails.
	 */
	private const MAX_PIECES    = 512;
	private const MAX_INSTANCES = 20000;
	private const MAX_PIECE_CM  = 200;
	/**
	 * No print run is two kilometres of film. A sanity bound, not a policy: at
	 * the shipped tariff it is thirty-four thousand euros of one order.
	 */
	private const MAX_RUN_M     = 2000;
	/** Transfers one side may split into — `MAX_SIDE_PIECES` in designDoc.ts. */
	private const MAX_SIDE_PIECES = 32;

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
			 * WORKING DAYS from the moment the proof is approved to the moment
			 * the parcel is handed over. Question 14's written default, verbatim:
			 * « Standard 12 jours ouvrés, express 7 jours, urgence 4 jours
			 * (France uniquement) ».
			 *
			 * The keys are `PriceRule::URGENCES`, the vocabulary the cost screen
			 * already uses, so an order ticked urgent there is the same order this
			 * schedules. Adding a fourth word here without adding it there would
			 * silently schedule it as standard.
			 */
			'lead_days'     => array(
				'standard' => 12,
				'express'  => 7,
				'urgent'   => 4,
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
			 * Pieces one person can press in a working day. Question 23's written
			 * default, which the chapter itself warns about: « La cadence annoncée
			 * de 30 secondes pour deux t-shirts doit être testée en conditions
			 * complètes ». Nothing here has been timed.
			 */
			'press_per_day' => 300,

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
	 * this file is derived — the promise is fixed and the work is subtracted
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
		$es = self::latest_order_on( $target_on, $garments, 'es', $config, $film );
		$fr = self::latest_order_on( $target_on, $garments, 'fr', $config, $film );
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
	 * urgent order is two days late before anyone touches it. Express (7 days) has
	 * exactly one day of slack, which is the buffer itself, so a single late
	 * courier eats it. Only standard (12 days) has real room, and it is the only
	 * one the cheap origin fits inside at all.
	 *
	 * This is not a bug to fix by lowering a number until it passes. It is the
	 * arithmetic of four defaults nobody has confirmed, and it is written into
	 * `QUESTIONS-ASSOCIE.md` under question 14 so the answer lands on a measured
	 * contradiction rather than on a blank.
	 *
	 * @return array<string,array{days:int,fr:int,es:int}> urgency => slack.
	 */
	public static function feasibility( array $config, array $film ): array {
		$out = array();
		foreach ( array_keys( (array) ( $config['lead_days'] ?? array() ) ) as $urgency ) {
			$days = (int) $config['lead_days'][ $urgency ];
			// One garment, so the press contributes its floor of one day and the
			// answer describes the promise rather than any particular order.
			$fixed = (int) ( $config['ship_days'] ?? 0 )
				+ self::press_days( 1, $config )
				+ (int) ( $config['buffer_days'] ?? 0 );
			$out[ $urgency ] = array(
				'days' => $days,
				'fr'   => $days - $fixed - (int) ( $film['days_fr'] ?? 0 ),
				'es'   => $days - $fixed - (int) ( $film['days_es'] ?? 0 ),
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
	 * and nothing else — the money that actually landed and the proof that is
	 * actually approved, both read from records rather than from a status. An
	 * order already in a lot is excluded: it has been scheduled once and putting
	 * it in a second lot would press it twice.
	 *
	 * `$today` is a PARAMETER. Nothing here reads the clock, so the screen, the
	 * REST route and the tests all see the same day, and a run can be replayed.
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
				'limit'   => 200,
				'orderby' => 'date',
				'order'   => 'ASC',
				'type'    => 'shop_order',
			)
		);

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
	 * to press. Only the last is silent — the other two are visible on the screen
	 * through `blocked()` and `lot_of()`, because an order that simply disappears
	 * is an order nobody chases.
	 */
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
	 * Ink area of the whole order, cm2 — the witness the shop checks a reported
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
	 * The blanks this order needs, one row per line — the picking list's source.
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
	 * SO THE SHOP DOES NOT TRUST IT — IT BOUNDS IT. Four checks, none of which
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
			 * garment-sides — that is a side that will not be pressed — or more
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
				return $fail( sprintf( 'La commande %s ne peut pas tenir sur %.2f m de film : son encre en demande %.2f m au minimum.', $order->get_order_number(), $posted['solo_m'], $floor_m ) );
			}

			/*
			 * 4. GEOMETRY, for an order whose marking does not scale with the
			 * garment.
			 *
			 * The invariant is the document's own: the transfer rectangles must
			 * be big enough to hold the ink they claim to carry, which is what
			 * `Design::normalise_pieces` already enforces at the cart. It holds
			 * whatever the operator does to the split — merging two visuals
			 * makes the boxes BIGGER, never smaller — so it is a real check and
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

			$members[ (string) $id ] = array(
				'id'          => $id,
				'ref'         => (string) $order->get_order_number(),
				'customer'    => trim( $order->get_billing_company() ?: ( $order->get_billing_first_name() . ' ' . $order->get_billing_last_name() ) ),
				'urgency'     => $urgency,
				'bat'         => $approved,
				'designs'     => self::designs( $order ),
				'lines'       => self::lines( $order ),
				'garments'    => (int) $work['garments'],
				'transfers'   => (int) $work['transfers'],
				'graded'      => (bool) $work['graded'],
				'target_on'   => $target,
				'order_by'    => $plan[ 'es' === $origin ? 'order_by_es' : 'order_by_fr' ],
				/*
				 * A LOT MAY NOT PUSH AN ORDER PAST ITS OWN DATE. Buying French
				 * film is always allowed — it is faster — but dragging an order
				 * into the Spanish lot is deciding on the customer's behalf that
				 * five more days are acceptable. This is where that is refused,
				 * and the operator sees which order refused it.
				 */
				'late'        => $plan[ 'es' === $origin ? 'order_by_es' : 'order_by_fr' ] < $today,
			);
		}

		// 2. FLOOR, over the whole lot.
		$total_ink   = array_sum( $ink );
		$lot_floor_m = self::minimum_length_m( $total_ink, $width );
		if ( $read['pooled_m'] + 1e-9 < $lot_floor_m ) {
			return $fail( sprintf( 'Le lot ne peut pas tenir sur %.2f m de film : l’encre qu’il porte en demande %.2f m au minimum.', $read['pooled_m'], $lot_floor_m ) );
		}

		// 3. CEILING, asked of the packer that will print it.
		$bound = Nest::billed_metres( $pieces, $cost );
		if ( ! $bound['ok'] ) {
			return $fail( 'Le métrage du lot n’a pas pu être vérifié : ' . Nest::reason_fr( $bound['reason'] ) . ' Aucun lot n’est créé sur un chiffrage invérifiable.' );
		}
		if ( $read['pooled_m'] > $bound['billed_m'] + 1e-9 ) {
			return $fail( sprintf( 'La planche annonce %.2f m alors que l’imbrication en bandes droites des mêmes transferts en fait %.2f m. Une planche ne peut pas être plus longue que ça.', $read['pooled_m'], $bound['billed_m'] ) );
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

		$lot_id = wp_insert_post(
			array(
				'post_type'   => self::POST_TYPE,
				'post_status' => 'publish',
				'post_title'  => sprintf( 'Lot %s · %s', $today, 'es' === $origin ? 'Espagne' : 'France' ),
			),
			true
		);
		if ( is_wp_error( $lot_id ) || 0 === (int) $lot_id ) {
			return $fail( 'Le lot n’a pas pu être enregistré.' );
		}
		$record['lot_id'] = (int) $lot_id;
		update_post_meta( (int) $lot_id, self::META_LOT, wp_json_encode( $record ) );

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
	 * It is also the moment the origin becomes EVIDENCE. Until now every order in
	 * this project is costed at the French film rate whatever anybody ticked,
	 * because « a dropdown is not evidence about which roll was bought »
	 * (`PriceRule::URGENCES`). A sent lot is that evidence: it records which
	 * origin the film was actually ordered from, it cannot be edited afterwards,
	 * and the report is recomputed against it. A DRAFT lot is not evidence and
	 * changes no cost.
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

		$lot['state']   = self::SENT;
		$lot['sent_on'] = '' !== $today ? $today : Settings::today();
		$lot['sent_by'] = get_current_user_id();
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
			'orders'   => $out,
			'layout'   => array(
				'pooled_m'   => $pooled,
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

	/** ISO date as a French one. Display only. */
	public static function fr_date( string $iso ): string {
		return 1 === preg_match( '/^(\d{4})-(\d{2})-(\d{2})$/', $iso, $m ) ? "$m[3]/$m[2]/$m[1]" : $iso;
	}

	// ── the REST surface the studio talks to ─────────────────────────────────

	/**
	 * `wc-teeshoop/v1`, and the prefix is the whole point.
	 *
	 * The workshop tool is the admin studio, which runs on the Worker's origin
	 * and therefore has no WordPress cookie and no REST nonce — the same problem
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

	/** GET /production/queue — what could go on a press today. */
	public static function rest_queue( \WP_REST_Request $request ): \WP_REST_Response {
		$today  = self::read_date( (string) $request->get_param( 'today' ) );
		$config = self::config();
		$film   = (array) ( Costing::config()['film'] ?? array() );

		return new \WP_REST_Response(
			array(
				'today'  => $today,
				'orders' => self::queue( $today ),
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

	/** GET /production/lots — the recent lots, newest first. */
	public static function rest_lots( \WP_REST_Request $request ): \WP_REST_Response {
		$limit = (int) $request->get_param( 'limit' );
		return new \WP_REST_Response(
			array( 'lots' => self::lots( $limit > 0 ? min( 100, $limit ) : 30 ) )
		);
	}

	/** POST /production/lots — create one from a chosen set and a measured layout. */
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

	/** POST /production/lots/{id}/etat — order the film, receive it, close it. */
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
