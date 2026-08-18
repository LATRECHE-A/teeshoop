<?php
/**
 * What an order actually costs us, itemised, with the provenance of every line.
 *
 * This is the Bible's chapter 1 "Modèle de coût détaillé" made executable. The
 * chapter's own instruction is the design of this file: a cost is never a
 * constant buried in code and never a per-logo guess, it is a component with an
 * amount, a source, a date and a confidence, and the report says which of them
 * nobody has filled in yet.
 *
 * ── WHY CONFIDENCE HAS FOUR VALUES AND NOT TWO ───────────────────────────────
 *
 * `REAL` and `ESTIMATED` are the chapter's own distinction ("lorsque le seul
 * prix disponible est un prix catalogue à diviser par 2 à 2,5, le système doit
 * marquer le coût comme estimé et utiliser le scénario prudent"). The other two
 * exist because this project has already paid for conflating them:
 *
 *   NONE     this component is genuinely zero on this order. No subcontracting
 *            was used; the customer shipped their own garment.
 *   UNKNOWN  we could not compute it. The Worker did not answer, the garment is
 *            not joined to a supplier reference, nobody has timed the operation.
 *
 * A zero and a failure add up to the same total and mean opposite things. An
 * order whose film cost is UNKNOWN has no floor price, because a floor derived
 * from a cost that is missing a component is a floor that is too low, and a
 * floor that is too low is worse than no floor: it authorises the sale.
 * `total()` refuses to call itself complete, and `Margin` refuses to state a
 * floor on an incomplete cost.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────────────
 *
 * No selling price. `Pricing.php` is the price authority and this file never
 * touches it: they meet in `Costing.php`, which reads what an order was sold
 * for and asks this what it cost. Two files that both computed a price would
 * eventually disagree, and the customer would see one number and the invoice
 * another.
 *
 * No supplier identity and no per-supplier tariff table. The film rate here is
 * one configurable number per origin, because `scripts/php-guard.mjs` keeps
 * supplier names and film economics out of this plugin entirely: the surveyed
 * supplier profiles live in the studio's admin-only module, behind the bundle
 * split, and they are not what we pay.
 *
 * Pure by construction: no WordPress function is called anywhere in this file,
 * so it runs under `php tests/run.php` with no bootstrap. Everything is integer
 * cents HT unless the name says otherwise.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

require_once __DIR__ . '/Money.php';

final class Cost {

	// ── Confidence ───────────────────────────────────────────────────────────

	/** A real tariff, a real invoice, a real measurement. */
	public const REAL = 'reel';

	/** Derived from a catalogue price or an unconfirmed rate. Prudent scenario. */
	public const ESTIMATED = 'estime';

	/** Genuinely zero on this order. Answered, not forgotten. */
	public const NONE = 'neant';

	/** We could not compute it. NOT zero. See the header. */
	public const UNKNOWN = 'inconnu';

	// ── The components the chapter names ─────────────────────────────────────

	/**
	 * The ten direct-cost components of "Coût direct", in the chapter's own
	 * order, each with the French label an operator reads.
	 *
	 * The list is CLOSED. A cost that does not fit one of these rows belongs in
	 * `autres` with a source that says what it was, not in a new key nobody
	 * totals. The chapter's own sentence is the test of membership: "tout ce qui
	 * disparaît si la commande n'existe pas".
	 */
	public const COMPONENTS = array(
		'textile'      => 'Textile',
		'marquage'     => 'Marquage',
		'transport_in' => 'Transport fournisseur',
		'emballage'    => 'Emballage',
		'livraison'    => 'Livraison client',
		'paiement'     => 'Frais de paiement',
		'consommables' => 'Consommables',
		'sous_traite'  => 'Sous-traitance',
		'main_oeuvre'  => 'Main-d’œuvre',
		'defaut'       => 'Provision de défaut',
	);

	/**
	 * The standard operations of a run, in the chapter's own order.
	 *
	 * "Les temps standards sont à mesurer sur des séries réelles : réception,
	 * tri, préparation, pressage, pelage, second pressage, contrôle, pliage et
	 * emballage." Every one of them is here so the admin screen can show the
	 * operator which ones have never been timed, which is most of them.
	 *
	 * `per` says what the time is multiplied by:
	 *   order     once per order, whatever its size
	 *   piece     once per garment
	 *   transfer  once per transfer pressed (a garment with a chest logo and a
	 *             back print is two presses, and the split into visuals means a
	 *             single side can be more than one)
	 */
	public const OPERATIONS = array(
		'reception'      => array( 'label' => 'Réception et tri', 'per' => 'order' ),
		'preparation'    => array( 'label' => 'Préparation', 'per' => 'order' ),
		'pressage'       => array( 'label' => 'Pressage', 'per' => 'transfer' ),
		'pelage'         => array( 'label' => 'Pelage', 'per' => 'transfer' ),
		'second_pressage' => array( 'label' => 'Second pressage', 'per' => 'transfer' ),
		'controle'       => array( 'label' => 'Contrôle', 'per' => 'piece' ),
		'pliage'         => array( 'label' => 'Pliage et emballage', 'per' => 'piece' ),
	);

	/**
	 * Shipped defaults.
	 *
	 * ⚠ EVERY FIGURE HERE IS AN ASSUMPTION AND NOT THE BUSINESS'S NUMBER. Each
	 * one has a row in `docs/hypotheses.json` naming the question of
	 * `QUESTIONS-ASSOCIE.md` that settles it, and `scripts/hypotheses-guard.mjs`
	 * fails when this file and that register stop agreeing.
	 *
	 * The values that are ZERO are zero on purpose and they are not oversights:
	 * they are operations nobody has timed and provisions nobody has costed.
	 * Question 05 gives exactly two standard times and question 27 gives no
	 * defect rate at all. Putting a plausible figure in an untimed row would
	 * make a floor price out of an invention, so the row stays at zero, the
	 * report counts it as UNKNOWN rather than as answered, and the admin screen
	 * says so where the person who can measure it will see it.
	 */
	public static function default_config(): array {
		return array(
			/*
			 * Question 05's written default: "20 EUR de l'heure chargé".
			 *
			 * The chapter is emphatic that this is not optional: "La main-d'oeuvre
			 * ne doit pas être considérée comme gratuite parce que le dirigeant ou
			 * les proches produisent." A shop that costs its own time at zero
			 * concludes that every small order is profitable, and then discovers
			 * at scale that none of them were.
			 */
			'hourly_ht'     => 2000,

			/*
			 * Standard times, SECONDS, per the unit named in OPERATIONS.
			 *
			 * Question 05's default gives two of the seven: "45 secondes par pose
			 * de transfert, 60 secondes de préparation par commande". The five
			 * others have never been timed on a real series and are therefore 0,
			 * which `labour()` reports as UNTIMED rather than as free.
			 */
			'times_s'       => array(
				'reception'       => 0,
				'preparation'     => 60,
				'pressage'        => 45,
				'pelage'          => 0,
				'second_pressage' => 0,
				'controle'        => 0,
				'pliage'          => 0,
			),

			/*
			 * The film.
			 *
			 * Question 04's written default, which is the Bible's own order of
			 * magnitude: "17 EUR hors taxes le mètre linéaire en 56 cm en France
			 * (48 h), 9 EUR hors taxes en Espagne (5 jours), 15 EUR de livraison
			 * par commande, 1 mètre minimum, 5 % de perte prévue".
			 *
			 * This is the FIRST executable home those two figures have had. Until
			 * this file they existed only as a sentence in docs/ROADMAP.md, while
			 * the studio's DTF module costed on surveyed public tariffs that are
			 * far lower (the cheapest French roll tariff in that table is 5,45 EUR
			 * the linear metre). The two are not in conflict: those are advertised
			 * prices for a walk-up order and this is what the associate says he
			 * pays. But only one of them may drive a floor price, and it is this
			 * one, because it is the one he named.
			 *
			 * `width_cm` is the roll's PRINTABLE width and it is what the nesting
			 * engine packs into. 56 is the Bible's figure for the laize being
			 * quoted, so rate and width belong to each other: change one and the
			 * other is no longer the same tariff.
			 */
			'film'          => array(
				'rate_fr_ht'     => 1700,
				'rate_es_ht'     => 900,
				'width_cm'       => 56.0,
				'delivery_ht'    => 1500,
				'min_m'          => 1.0,
				'waste_rate'     => 0.05,
				/*
				 * Space between two transfers on the sheet, cm. Not question 04's:
				 * it is the studio's own nesting default, and it is here so the
				 * cost is computed on the same geometry the workshop will print.
				 */
				'gap_cm'         => 0.5,
				/*
				 * Billing granularity, cm. 10 = 0,1 mètre linéaire, which is what
				 * roll suppliers invoice. It is here rather than only in the
				 * nesting request because the prudent bound has to round the same
				 * way: a bound that ignored the rounding came out BELOW the packed
				 * length on a small order, which is the one direction a bound may
				 * never take. Found by scripts/nest-verify.mjs.
				 */
				'billing_step_cm' => 10.0,
				/*
				 * The longest single file the supplier's printer accepts, cm.
				 * Nobody has told us; 30 m is a working figure and question 04 now
				 * asks for the real one. It only ever moves the cost by the edge
				 * margins and the billing rounding of one extra sheet, and it
				 * moves it UP when it is too small, which is the safe direction.
				 */
				'max_length_cm'  => 3000.0,
			),

			/*
			 * Inbound freight from the textile supplier. Question 03's written
			 * default: "plus 8 EUR hors taxes de port en dessous de 200 EUR de
			 * commande".
			 */
			'freight_ht'    => 800,
			'freight_free_from_ht' => 20000,

			/*
			 * Card processing. Stripe's published rate for European cards, which
			 * is 1,5 % + 0,25 EUR, and question 15's written default is Stripe.
			 *
			 * It is charged on the amount actually taken, which is TTC: the
			 * processor does not know what part of a payment is our VAT, and it
			 * bills on the whole of it. Reading it as a percentage of the HT would
			 * understate the fee by the VAT rate, which is a fifth of it.
			 */
			'payment'       => array(
				'rate'         => 0.015,
				'fixed_ht'     => 25,
				/*
				 * Methods that cost nothing to receive. A transfer and a cheque
				 * carry no platform fee, and charging one against them would
				 * overstate the cost of exactly the orders a business customer
				 * places. WooCommerce's own gateway ids.
				 */
				'free_methods' => array( 'bacs', 'cheque', 'cod' ),
			),

			/*
			 * Provision for defects, as a share of the direct cost.
			 *
			 * ZERO, AND THE ZERO IS A REFUSAL. The chapter lists "provision de
			 * défaut" among the direct costs and gives no rate. Its worked example
			 * bills "paiement et provision SAV : 16 EUR" as ONE line, so the two
			 * cannot be separated from it either. Question 27 asks the associate
			 * for his real non-conformity rate.
			 *
			 * A zero here errs in the UNSAFE direction (a floor that is too low),
			 * which is exactly why `total()` reports it as an unanswered component
			 * rather than swallowing it: an incomplete cost is visible, and an
			 * invented one is not.
			 */
			'defect_rate'   => 0.0,

			/*
			 * Consumables per garment: transfer sheets, tape, cleaning. Never
			 * measured, same rule as the untimed operations.
			 */
			'consumables_piece_ht' => 0,

			/*
			 * Turning a supplier's CATALOGUE price into a purchase price.
			 *
			 * The chapter: "Lorsque le seul prix disponible est un prix catalogue à
			 * diviser par 2 à 2,5, le système doit marquer le coût comme estimé et
			 * utiliser le scénario prudent." Dividing by the SMALLER number gives
			 * the LARGER cost, so the prudent divisor is 2 and 2,5 is the
			 * optimistic one. Getting that backwards would flag the cost as
			 * estimated and then use the flattering figure, which is worse than
			 * not flagging it at all.
			 */
			'catalogue_divisor_prudent'    => 2.0,
			'catalogue_divisor_optimistic' => 2.5,

			/*
			 * The margin rules. Question 06's written default: "Marge cible 55 %
			 * sur textile et marquage, contribution minimale 25 % du prix hors
			 * taxes, remise maximale de 15 % sans validation de votre part."
			 *
			 * `target_margin_rate` IS THE TAUX DE MARQUE, margin over selling
			 * price, which is the ratio the Bible's formula and its worked
			 * example use whatever the chapter calls it. See the second finding
			 * at the top of Margin.php: read as the words normally mean, the same
			 * 55 % prices a 250 EUR cost 168,06 EUR lower.
			 *
			 * `min_contribution_rate` is a share of the price, which is question
			 * 06's own wording and NOT the Bible's absolute contribution. The two
			 * are different formulas with different failure modes; both are in
			 * Margin.php and this is the one in force.
			 */
			'target_margin_rate'    => 0.55,
			'min_contribution_rate' => 0.25,
			'max_discount_rate'     => 0.15,

			/*
			 * What a blank costs us, per studio garment, when the order line is
			 * not a catalogue article that carries its own supplier price.
			 *
			 * EMPTY, and empty is a refusal rather than an oversight. `tee`,
			 * `hoodie` and `custom` are the studio's demonstration garments; they
			 * are joined to no supplier reference, so nothing in this repository
			 * knows what one costs. An invented figure here would produce a floor
			 * price, a margin and a commission that all look computed, on a
			 * purchase price nobody ever paid.
			 *
			 * Fill a row from the admin screen and every order costed after it
			 * uses it. The shape is `garment => ['ht' => int, 'source' => string,
			 * 'on' => 'YYYY-MM-DD']`, because a purchase price with no source and
			 * no date cannot be defended six months later, which is the whole
			 * point of the chapter's cost model.
			 */
			'garment_supply' => array(),
		);
	}

	/**
	 * Merge a stored partial over the defaults, shallow per top-level key.
	 *
	 * Same rule as `Pricing::merge_config` and for the same reason: a partly
	 * filled `times_s` must not silently inherit a default time the operator
	 * thought they had cleared, while `hourly_ht` alone must be settable.
	 */
	public static function merge_config( array $stored ): array {
		$config = self::default_config();
		foreach ( $stored as $key => $value ) {
			if ( array_key_exists( $key, $config ) ) {
				$config[ $key ] = $value;
			}
		}
		return $config;
	}

	// ── Components ───────────────────────────────────────────────────────────

	/**
	 * One line of the cost model.
	 *
	 * `source` and `on` are not decoration. The chapter requires a cost to carry
	 * where it came from and when it was valid, because the whole point of the
	 * engine is that a floor price can be defended six months later: "prix
	 * d'achat HT ; date de validité ; coefficient de risque en cas de prix
	 * estimé". A component with an empty source is a number somebody typed.
	 *
	 * @param string $type    one of COMPONENTS.
	 * @param int    $amount  cents HT, the PRUDENT figure when estimated.
	 * @param string $conf    one of REAL, ESTIMATED, NONE, UNKNOWN.
	 * @param string $source  where it came from, in French, for an operator.
	 * @param string $on      the date it was valid, YYYY-MM-DD, or ''.
	 * @param ?int   $best    the optimistic figure when estimated, else null.
	 *
	 * @throws \InvalidArgumentException on an unknown type or confidence.
	 */
	public static function component( string $type, int $amount, string $conf, string $source, string $on = '', ?int $best = null ): array {
		if ( ! isset( self::COMPONENTS[ $type ] ) ) {
			throw new \InvalidArgumentException( 'unknown_component:' . $type );
		}
		if ( ! in_array( $conf, array( self::REAL, self::ESTIMATED, self::NONE, self::UNKNOWN ), true ) ) {
			throw new \InvalidArgumentException( 'unknown_confidence:' . $conf );
		}
		/*
		 * An UNKNOWN component carries no amount at all. Letting a caller pass
		 * one would produce a total that both counts a figure and declares it
		 * unavailable, and whichever of the two a reader believed would be wrong
		 * half the time.
		 */
		return array(
			'type'       => $type,
			'label'      => self::COMPONENTS[ $type ],
			'amount_ht'  => self::UNKNOWN === $conf ? 0 : $amount,
			'best_ht'    => self::ESTIMATED === $conf && null !== $best ? $best : null,
			'confidence' => $conf,
			'source'     => $source,
			'on'         => $on,
		);
	}

	/**
	 * Total a set of components, and say what the total is worth.
	 *
	 * Returns:
	 *   total_ht    the prudent total, cents. UNKNOWN components add nothing.
	 *   best_ht     the same total with every estimate at its optimistic figure.
	 *   complete    false when any component is UNKNOWN or absent entirely.
	 *   estimated   true when any component is ESTIMATED.
	 *   unknown     the types we could not compute.
	 *   absent      the types nobody supplied a component for at all.
	 *   lines       the components, in the chapter's order.
	 *
	 * `complete` is the one the floor price gates on. It is deliberately NOT
	 * "estimated is fine": an estimate is a number with a stated risk, and an
	 * unknown is no number at all.
	 */
	public static function total( array $components ): array {
		$by_type = array();
		foreach ( $components as $line ) {
			if ( ! is_array( $line ) || ! isset( $line['type'] ) ) {
				continue;
			}
			$type = (string) $line['type'];
			if ( ! isset( self::COMPONENTS[ $type ] ) ) {
				continue;
			}
			/*
			 * Several lines of the same type ADD UP rather than replace: an order
			 * with two garment references has two textile costs, each with its own
			 * supplier and its own date, and flattening them would throw away the
			 * provenance that is the point of the model.
			 */
			$by_type[ $type ][] = $line;
		}

		$total     = 0;
		$best      = 0;
		$unknown   = array();
		$absent    = array();
		$estimated = false;
		$lines     = array();

		foreach ( self::COMPONENTS as $type => $label ) {
			if ( ! isset( $by_type[ $type ] ) ) {
				$absent[] = $type;
				continue;
			}
			foreach ( $by_type[ $type ] as $line ) {
				$lines[] = $line;
				if ( self::UNKNOWN === $line['confidence'] ) {
					$unknown[] = $type;
					continue;
				}
				$amount = (int) $line['amount_ht'];
				$total += $amount;
				$best  += null === $line['best_ht'] ? $amount : (int) $line['best_ht'];
				if ( self::ESTIMATED === $line['confidence'] ) {
					$estimated = true;
				}
			}
		}

		return array(
			'total_ht'  => $total,
			'best_ht'   => $best,
			'complete'  => empty( $unknown ) && empty( $absent ),
			'estimated' => $estimated,
			'unknown'   => array_values( array_unique( $unknown ) ),
			'absent'    => $absent,
			'lines'     => $lines,
		);
	}

	// ── The formulas the chapter gives ───────────────────────────────────────

	/**
	 * Labour: `temps standard × taux horaire chargé`, the chapter's own formula.
	 *
	 * $work counts the units the OPERATIONS are multiplied by:
	 *   orders     usually 1
	 *   pieces     garments
	 *   transfers  presses (one per transfer, not one per garment)
	 *
	 * Returns the seconds, the money, and the operations that have never been
	 * timed. That last list is why this returns an array rather than an int: a
	 * labour cost built from two timed operations out of seven is not a labour
	 * cost, and the caller has to be able to say so.
	 */
	public static function labour( array $work, array $config ): array {
		$hourly  = (int) ( $config['hourly_ht'] ?? 0 );
		$times   = (array) ( $config['times_s'] ?? array() );
		$counts  = array(
			'order'    => max( 0, (int) ( $work['orders'] ?? 0 ) ),
			'piece'    => max( 0, (int) ( $work['pieces'] ?? 0 ) ),
			'transfer' => max( 0, (int) ( $work['transfers'] ?? 0 ) ),
		);

		$seconds = 0;
		$untimed = array();
		$detail  = array();

		foreach ( self::OPERATIONS as $key => $op ) {
			$each  = max( 0, (int) ( $times[ $key ] ?? 0 ) );
			$count = $counts[ $op['per'] ];
			if ( 0 === $each ) {
				/*
				 * Only an operation this order actually PERFORMS counts as
				 * untimed. A run with no transfers to press is not missing a
				 * pressing time, and reporting it as missing would make every
				 * blank-only order look incomplete for ever.
				 */
				if ( $count > 0 ) {
					$untimed[] = $key;
				}
				continue;
			}
			$seconds += $each * $count;
			$detail[] = array(
				'op'      => $key,
				'label'   => $op['label'],
				'each_s'  => $each,
				'count'   => $count,
				'total_s' => $each * $count,
			);
		}

		return array(
			'seconds'   => $seconds,
			'amount_ht' => Money::round( $seconds / 3600 * $hourly ),
			'hourly_ht' => $hourly,
			'untimed'   => $untimed,
			'detail'    => $detail,
		);
	}

	/**
	 * The film, from the length the nesting engine actually measured.
	 *
	 * The chapter's formula, term for term:
	 *
	 *     Coût DTF commande = mètres linéaires nécessaires x tarif au mètre
	 *                        + livraison DTF
	 *                        + provision de perte
	 *
	 * The provision is a share of the METRES and not of the money, because what
	 * is lost is film: a misprint costs a length of roll, and it costs it at the
	 * same tariff. Applying the same 5 % to the delivery charge instead would be
	 * charging a provision on a courier.
	 *
	 * `$nested_m` is what `nestRoll` billed for this order and nothing else. It
	 * is never derived from an area here: a length inferred by dividing an area
	 * by the roll width would be a second, worse packer, and the number the
	 * supplier bills is a packing, not a quotient.
	 *
	 * @param float  $nested_m billed linear metres from the nesting engine.
	 * @param string $origin   'fr' or 'es'.
	 */
	public static function film( float $nested_m, array $config, string $origin = 'fr' ): array {
		$film = (array) ( $config['film'] ?? array() );
		$rate = (int) ( 'es' === $origin ? ( $film['rate_es_ht'] ?? 0 ) : ( $film['rate_fr_ht'] ?? 0 ) );

		$min     = (float) ( $film['min_m'] ?? 0 );
		$billed  = max( $min, max( 0.0, $nested_m ) );
		$waste_m = $billed * (float) ( $film['waste_rate'] ?? 0 );

		$metres_ht   = Money::round( $billed * $rate );
		$waste_ht    = Money::round( $waste_m * $rate );
		$delivery_ht = (int) ( $film['delivery_ht'] ?? 0 );

		return array(
			'origin'      => $origin,
			'rate_ht'     => $rate,
			'nested_m'    => $nested_m,
			'billed_m'    => $billed,
			'waste_m'     => $waste_m,
			'metres_ht'   => $metres_ht,
			'waste_ht'    => $waste_ht,
			'delivery_ht' => $delivery_ht,
			'amount_ht'   => $metres_ht + $waste_ht + $delivery_ht,
			/*
			 * True when the order was too small to reach the supplier's minimum,
			 * so the shop is paying for film it did not use. The admin panel says
			 * so, because it is the single most useful thing to know about a small
			 * order's economics: it is why two small runs pressed together cost
			 * less than the same two runs a week apart.
			 */
			'at_minimum'  => $nested_m < $min,
		);
	}

	/**
	 * The longest the packer can possibly make this set of pieces, cm billed.
	 *
	 * THIS IS NOT A NESTING. It is the length a nesting is guaranteed not to
	 * exceed, and it exists for one case: `src/lib/dtf/nesting.ts` could not be
	 * reached, so the choice is between no cost at all and a cost that is
	 * certainly not too low.
	 *
	 * ── WHY IT IS A BOUND, term by term ──────────────────────────────────────
	 *
	 * The packer lays pieces in shelves and a shelf is as tall as its tallest
	 * member. For a run of identical pieces it picks the orientation with the
	 * smaller total, so its cost per run never exceeds the cost of giving every
	 * copy its own shelf in the FLATTER orientation. That flatter orientation is
	 * available only when the piece's long side fits across the roll; a 5 × 60 cm
	 * banner on a 56 cm roll has to stand up, and then the row it costs is 60 cm,
	 * not 5. Getting that backwards is what an earlier version of this function
	 * did, and it under-bounded that banner elevenfold.
	 *
	 * Then two roundings the packer applies and a bound must apply too: each
	 * sheet's length is rounded UP to the billing step, and a long order is split
	 * across sheets. Σ⌈xₛ⌉ ≤ ⌈Σxₛ⌉ + (N−1), so one rounding of the whole plus one
	 * step per extra sheet covers it. The sheet count is bounded by the packer's
	 * own rule for closing a sheet: it only opens a new one when the next shelf
	 * would overflow, so every sheet but the last is full to within one shelf.
	 *
	 * `scripts/nest-verify.mjs` re-proves the whole thing on every run, in both
	 * languages, against the real packer over a corpus of real orders. It is what
	 * found the missing rounding.
	 *
	 * ── IT CAN REFUSE ────────────────────────────────────────────────────────
	 *
	 * A transfer whose SHORTER side is wider than the roll fits on no sheet in
	 * any orientation. The packer reports it as unplaceable and so does this: an
	 * order containing one has no bound and no cost, because it also has no way
	 * of being printed.
	 *
	 * A caller that uses this MUST mark the resulting component ESTIMATED. It
	 * overstates a real order badly (measured on the sample corpus: +14 % to
	 * +827 %), so it is a stopgap for a broken link and never a substitute for
	 * asking.
	 *
	 * @return array{ok:bool,length_cm:float,impossible:array<int,string>}
	 */
	public static function prudent_length_cm( array $pieces, array $config ): array {
		$film  = (array) ( $config['film'] ?? array() );
		$gap   = (float) ( $film['gap_cm'] ?? 0 );
		$width = (float) ( $film['width_cm'] ?? 0 );
		$step  = (float) ( $film['billing_step_cm'] ?? 0 );
		$max   = (float) ( $film['max_length_cm'] ?? 0 );

		$refuse = static function ( array $impossible ): array {
			return array(
				'ok'         => false,
				'length_cm'  => 0.0,
				'impossible' => $impossible,
			);
		};

		if ( $width <= 0 || $step <= 0 || $max <= 0 ) {
			return $refuse( array() );
		}

		$raw        = 0.0;
		$tallest    = 0.0;
		$impossible = array();

		foreach ( $pieces as $piece ) {
			$w   = (float) ( $piece['w_cm'] ?? 0 );
			$h   = (float) ( $piece['h_cm'] ?? 0 );
			$qty = (int) ( $piece['qty'] ?? 0 );
			$id  = (string) ( $piece['id'] ?? '?' );
			if ( ! is_finite( $w ) || ! is_finite( $h ) || $w <= 0 || $h <= 0 || $qty <= 0 ) {
				continue;
			}

			$short = min( $w, $h );
			$long  = max( $w, $h );

			// Neither orientation gets it across the roll, or down a sheet.
			if ( $short > $width || $short > $max ) {
				$impossible[] = $id;
				continue;
			}

			// Lying flat is only allowed when the long side fits the laize.
			$row = $long <= $width ? $short : $long;
			if ( $row > $max ) {
				$impossible[] = $id;
				continue;
			}

			$raw    += $qty * ( $row + $gap );
			$tallest = max( $tallest, $row );
		}

		if ( array() !== $impossible ) {
			return $refuse( $impossible );
		}
		if ( $raw <= 0 ) {
			return $refuse( array() );
		}

		/*
		 * The packer only opens a new sheet when the next shelf would overflow,
		 * so every sheet but the last carries more than `room` of artwork. Hence
		 * (N − 1) × room < raw, hence N ≤ ⌈raw / room⌉ for any positive raw.
		 */
		$room   = max( $step, $max - $tallest - $gap );
		$sheets = max( 1, (int) ceil( $raw / $room ) );

		return array(
			'ok'         => true,
			'length_cm'  => ceil( $raw / $step ) * $step + ( $sheets - 1 ) * $step,
			'impossible' => array(),
		);
	}

	/**
	 * Card processing on the amount actually taken.
	 *
	 * TTC in, because that is what the processor bills on. The result is a direct
	 * cost of the order and therefore HT for our purposes: payment fees carry
	 * their own VAT treatment, which is exemption, so the fee we pay IS the fee
	 * that enters the cost.
	 */
	public static function payment_fee( int $paid_ttc, array $config ): int {
		$p = (array) ( $config['payment'] ?? array() );
		if ( $paid_ttc <= 0 ) {
			return 0;
		}
		return Money::pct( $paid_ttc, (float) ( $p['rate'] ?? 0 ) ) + (int) ( $p['fixed_ht'] ?? 0 );
	}

	/**
	 * Inbound freight from the textile supplier: a flat charge under a threshold.
	 *
	 * 0 disables the charge and 0 as the threshold means "always free", the same
	 * convention every other threshold in this plugin uses, so clearing a field
	 * never turns a cost on by accident.
	 */
	public static function freight( int $supplier_order_ht, array $config ): int {
		$free_from = (int) ( $config['freight_free_from_ht'] ?? 0 );
		if ( $free_from > 0 && $supplier_order_ht >= $free_from ) {
			return 0;
		}
		return (int) ( $config['freight_ht'] ?? 0 );
	}

	/**
	 * A supplier catalogue price turned into a purchase price, both scenarios.
	 *
	 * The chapter's rule, and the reason the prudent figure is the one that
	 * drives the floor: until the real tariff arrives, the number we can defend
	 * is the one that assumes the worse discount.
	 *
	 * @return array{prudent:int,optimistic:int}
	 */
	public static function from_catalogue( int $catalogue_ht, array $config ): array {
		$prudent    = (float) ( $config['catalogue_divisor_prudent'] ?? 1 );
		$optimistic = (float) ( $config['catalogue_divisor_optimistic'] ?? 1 );
		return array(
			'prudent'    => $prudent > 0 ? Money::round( $catalogue_ht / $prudent ) : $catalogue_ht,
			'optimistic' => $optimistic > 0 ? Money::round( $catalogue_ht / $optimistic ) : $catalogue_ht,
		);
	}
}
