<?php
/**
 * The price authority.
 *
 * There is exactly ONE implementation of the selling price, it is this file,
 * and it runs on the server. The studio displays what this returns; it never
 * computes a price a customer can pay. Two implementations of the same rules
 * always diverge in the end — on a tier boundary, on a rounding mode, on the
 * VAT basis — and the day they do, the customer sees one number and the
 * invoice says another.
 *
 * The studio's own src/content/pricing.ts stays where it is: it is a *preview*
 * for the editor's UI, in placeholder dollars, and the plan is explicit that it
 * must not be ported as-is. Anything payable comes from here.
 *
 * Pure by construction: no WordPress function is called anywhere in this file,
 * so it can be unit-tested with `php tests/run.php` and no bootstrap. The
 * WordPress-facing wiring (options, REST, cart) lives in the other classes.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

require_once __DIR__ . '/Money.php';

final class Pricing {

	/**
	 * Shipped defaults, in cents HT.
	 *
	 * ⚠ THESE NUMBERS ARE PLACEHOLDERS AND ARE NOT THE BUSINESS'S PRICES.
	 * They are the studio's demo figures converted 1:1 from dollars to euros so
	 * the plumbing can be tested end to end. The real grid is question 04 of
	 * QUESTIONS-ASSOCIE.md and lands in the `teeshoop_pricing` option — which is
	 * why every one of them is configurable and none is hard-coded at a call
	 * site.
	 */
	public static function default_config(): array {
		return array(
			'currency'   => 'EUR',

			// French standard rate. Printed textile is not a reduced-rate good.
			'vat_rate'   => 0.20,

			/*
			 * A garment is priced as: the blank + the marking of each printed
			 * side. The studio's model folded the first side's marking into the
			 * base, which made a BLANK garment cost exactly as much as a printed
			 * one — fine for a demo, wrong for a shop that also resells blanks.
			 */
			'garments'   => array(
				'tee'    => array(
					'base_ht'       => 950,
					'first_side_ht' => 500,
					'extra_side_ht' => 600,
				),
				'hoodie' => array(
					'base_ht'       => 2700,
					'first_side_ht' => 500,
					'extra_side_ht' => 600,
				),
				// The customer ships their own garment: decoration only, and the
				// blank costs us nothing.
				'custom' => array(
					'base_ht'       => 0,
					'first_side_ht' => 1200,
					'extra_side_ht' => 600,
				),
			),

			/*
			 * Surcharge by printed area, per side. A4 ≈ 625 cm², A3 ≈ 1250 cm².
			 * The area that counts is the INK, not the layer rectangle — see the
			 * trim work in the DTF module. Passing the rectangle here is what
			 * makes a customer pay for transparent margins.
			 */
			'area_tiers' => array(
				array(
					'max_sq_cm' => 625,
					'add_ht'    => 0,
					'label'     => 'std',
				),
				array(
					'max_sq_cm' => 1250,
					'add_ht'    => 400,
					'label'     => 'large',
				),
				array(
					'max_sq_cm' => null, // no upper bound
					'add_ht'    => 900,
					'label'     => 'xl',
				),
			),

			/*
			 * Quantity breaks, highest reached wins. Applied to the whole unit
			 * price (blank + marking) because both actually get cheaper with
			 * volume: the supplier has its own tiers, and film nests better the
			 * more pieces share a sheet.
			 */
			'qty_breaks' => array(
				array(
					'min_qty' => 10,
					'rate'    => 0.15,
				),
				array(
					'min_qty' => 25,
					'rate'    => 0.25,
				),
				array(
					'min_qty' => 50,
					'rate'    => 0.35,
				),
			),

			/** Hard cap; a "quantity" past this is a data-entry accident or an attack. */
			'max_qty'    => 10000,

			/*
			 * Where self-serve stops and a devis begins.
			 *
			 * ATTENTION: THIS IS OUR ASSUMPTION, NOT THE ASSOCIATE'S RULE.
			 * Question 02 of QUESTIONS-ASSOCIE.md is blocking and unanswered, and
			 * its published default (the one we committed to acting on in the
			 * absence of an answer) is "prix public et paiement en autonomie
			 * jusqu'à 250
			 * pièces ou 2 000 EUR hors taxes ; au-delà, passage obligatoire par
			 * un devis". These two numbers are that sentence, and nothing else.
			 *
			 * The Bible specifies no threshold at all: chapter 2 names four
			 * parcours (achat autonome, devis commercial, grand compte,
			 * réassort) and never says which one an order falls into. So there
			 * was nothing to derive and the honest thing is to say whose number
			 * this is, in the file where it is read.
			 *
			 * Either at 0 disables that side of the rule.
			 */
			'quote_from_qty' => 250,
			'quote_from_ht'  => 200000,
		);
	}

	/**
	 * Merge a stored partial config over the defaults.
	 *
	 * Shallow per top-level key on purpose: a partially-filled `garments` map
	 * must not silently inherit a default garment the admin thought they had
	 * removed, but `vat_rate` alone must be settable without restating the whole
	 * structure.
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

	/**
	 * The surcharge tier a printed area falls into.
	 *
	 * Tiers are matched in declaration order, and a tier with a null bound
	 * catches everything left. An area past the last bounded tier falls back to
	 * the last tier rather than to zero: an oversize print must never come out
	 * cheaper than an A3 because someone forgot the catch-all row.
	 */
	public static function area_tier( float $sq_cm, array $config ): array {
		$tiers = $config['area_tiers'];
		if ( empty( $tiers ) ) {
			return array(
				'add_ht' => 0,
				'label'  => 'flat',
			);
		}
		foreach ( $tiers as $tier ) {
			if ( null === $tier['max_sq_cm'] || $sq_cm <= (float) $tier['max_sq_cm'] ) {
				return $tier;
			}
		}
		return $tiers[ count( $tiers ) - 1 ];
	}

	/**
	 * Whether this run is past the point where the site should price it alone.
	 *
	 * Two independent triggers, quantity and amount, because they catch
	 * different jobs: 400 plain tees is a production question, and 30 hoodies
	 * with four faces is a money question. Either one is enough.
	 *
	 * A threshold of 0 means "no threshold", not "everything needs a quote".
	 * Reading it the other way would take the shop offline the first time
	 * someone cleared the field.
	 */
	public static function needs_quote( int $qty, int $total_ht, array $config ): bool {
		$from_qty = (int) ( $config['quote_from_qty'] ?? 0 );
		$from_ht  = (int) ( $config['quote_from_ht'] ?? 0 );

		if ( $from_qty > 0 && $qty > $from_qty ) {
			return true;
		}
		if ( $from_ht > 0 && $total_ht > $from_ht ) {
			return true;
		}
		return false;
	}

	/**
	 * `$count` printed sides, each at the cheapest area tier.
	 *
	 * The convention (a positive area small enough to land in the first tier)
	 * used to be written inline inside `grid()`. It is a shared assumption
	 * between the grid, the product page's estimator and the REST route, so it
	 * is written once: a second copy that used 0 instead of 1 would drop every
	 * side (`quote()` ignores sides with no area) and quote a blank garment as
	 * though it were printed.
	 */
	public static function standard_sides( int $count ): array {
		$sides = array();
		for ( $i = 0; $i < max( 0, $count ); $i++ ) {
			$sides[] = array(
				'id'         => 'side_' . $i,
				'area_sq_cm' => 1.0,
			);
		}
		return $sides;
	}

	/** The discount rate for a quantity — the highest break reached, or 0. */
	public static function qty_discount( int $qty, array $config ): float {
		$rate = 0.0;
		foreach ( $config['qty_breaks'] as $break ) {
			if ( $qty >= (int) $break['min_qty'] && (float) $break['rate'] > $rate ) {
				$rate = (float) $break['rate'];
			}
		}
		return $rate;
	}

	/**
	 * Quote a run.
	 *
	 * $input:
	 *   garment  string  key into $config['garments']
	 *   qty      int     clamped to [1, max_qty]
	 *   sides    array   one entry per PRINTED side:
	 *                      id         string  'front' | 'back' | 'sleeve_l' | …
	 *                      area_sq_cm float   printed INK area, cm² (0 ⇒ side ignored)
	 *
	 * Sides with no area are dropped rather than charged: an empty back is not a
	 * printed back, and the studio sends all four sides whether or not they carry
	 * anything.
	 *
	 * Returns cents throughout, plus a `lines` breakdown the product page and the
	 * cart both render. `total_ht` is authoritative; `unit_ttc` is for display
	 * and may differ from `total_ttc / qty` by a cent.
	 *
	 * @throws \InvalidArgumentException on an unknown garment — never priced as free.
	 */
	public static function quote( array $input, array $config ): array {
		$garment_key = (string) ( $input['garment'] ?? '' );
		if ( ! isset( $config['garments'][ $garment_key ] ) ) {
			throw new \InvalidArgumentException( 'unknown_garment' );
		}
		$rule = $config['garments'][ $garment_key ];

		$qty = (int) ( $input['qty'] ?? 1 );
		$qty = max( 1, min( $qty, (int) $config['max_qty'] ) );

		$sides = array();
		foreach ( (array) ( $input['sides'] ?? array() ) as $side ) {
			$area = (float) ( $side['area_sq_cm'] ?? 0 );
			if ( $area > 0 && is_finite( $area ) ) {
				$sides[] = array(
					'id'         => (string) ( $side['id'] ?? '' ),
					'area_sq_cm' => $area,
				);
			}
		}

		$lines = array();

		$subtotal_ht = (int) $rule['base_ht'];
		if ( $subtotal_ht > 0 ) {
			$lines[] = array(
				'kind'   => 'blank',
				'label'  => $garment_key,
				'amount' => $subtotal_ht,
			);
		}

		foreach ( $sides as $index => $side ) {
			$marking = 0 === $index ? (int) $rule['first_side_ht'] : (int) $rule['extra_side_ht'];
			$tier    = self::area_tier( $side['area_sq_cm'], $config );
			$amount  = $marking + (int) $tier['add_ht'];

			$subtotal_ht += $amount;
			$lines[]      = array(
				'kind'       => 'side',
				'label'      => $side['id'],
				'area_sq_cm' => $side['area_sq_cm'],
				'tier'       => $tier['label'],
				'amount'     => $amount,
			);
		}

		$discount_rate = self::qty_discount( $qty, $config );
		$discount_ht   = Money::pct( $subtotal_ht, $discount_rate );
		$unit_ht       = $subtotal_ht - $discount_ht;

		if ( $discount_ht > 0 ) {
			$lines[] = array(
				'kind'   => 'discount',
				'label'  => 'qty_' . $qty,
				'rate'   => $discount_rate,
				'amount' => -$discount_ht,
			);
		}

		$total_ht  = $unit_ht * $qty;
		$vat_rate  = (float) $config['vat_rate'];
		$total_vat = Money::pct( $total_ht, $vat_rate );

		return array(
			'currency'      => $config['currency'],
			'garment'       => $garment_key,
			'qty'           => $qty,
			'sides'         => count( $sides ),
			'vat_rate'      => $vat_rate,
			'discount_rate' => $discount_rate,
			'unit_ht'       => $unit_ht,
			'unit_ttc'      => $unit_ht + Money::pct( $unit_ht, $vat_rate ),
			'total_ht'      => $total_ht,
			'total_vat'     => $total_vat,
			'total_ttc'     => $total_ht + $total_vat,
			// Derived here so the product page, the studio's basket panel and
			// the cart all read the same verdict rather than each comparing
			// against its own copy of the threshold.
			'needs_quote'   => self::needs_quote( $qty, $total_ht, $config ),
			'lines'         => $lines,
		);
	}

	/**
	 * The price grid the product page shows BEFORE the editor opens.
	 *
	 * Mistertee's best idea: a customer who wants "50 tees, one colour, front
	 * only" gets a number in three clicks without drawing anything. Building it
	 * from the same quote() as the cart is what stops the grid from becoming a
	 * second, drifting price list.
	 *
	 * `$side_counts` is how many sides are printed (1 = front only, 2 = front and
	 * back, …); each is priced at the standard area tier, which is what the grid
	 * says in its footnote.
	 */
	public static function grid( string $garment, array $qtys, array $side_counts, array $config ): array {
		$rows = array();
		foreach ( $side_counts as $count ) {
			$cells = array();
			foreach ( $qtys as $qty ) {
				$sides   = self::standard_sides( $count );
				$quote   = self::quote(
					array(
						'garment' => $garment,
						'qty'     => $qty,
						'sides'   => $sides,
					),
					$config
				);
				$cells[] = array(
					'qty'           => $qty,
					'unit_ht'       => $quote['unit_ht'],
					'unit_ttc'      => $quote['unit_ttc'],
					'total_ht'      => $quote['total_ht'],
					'total_ttc'     => $quote['total_ttc'],
					'discount_rate' => $quote['discount_rate'],
					/*
					 * CARRIED, because the grid was publishing prices the cart
					 * refuses. A hoodie at 100 pieces is 2 080,00 EUR HT, past
					 * the 2 000 EUR self-serve threshold, so the whole
					 * 100-piece column of its public price list quoted a unit
					 * price that `Cart::add` answers with a 409. The quote 20
					 * lines above already knows; it was simply being thrown
					 * away.
					 */
					'needs_quote'   => $quote['needs_quote'],
				);
			}
			$rows[] = array(
				'sides' => $count,
				'cells' => $cells,
			);
		}
		return $rows;
	}

	/**
	 * The quantity columns the grid shows, derived from the discount breaks.
	 *
	 * NOT a hand-picked list of round numbers. Every column is either 1, the
	 * price of buying one, which a customer compares first, or a quantity at
	 * which the price actually changes, plus one doubling past the last break so
	 * the table does not stop at the moment it becomes interesting.
	 *
	 * A decorative column is worse than no column: it invites the reader to
	 * infer a break that is not there. With the shipped breaks (10, 25, 50) this
	 * returns 1, 10, 25, 50, 100.
	 */
	public static function grid_qtys( array $config ): array {
		$qtys = array( 1 );
		$last = 0;

		foreach ( (array) ( $config['qty_breaks'] ?? array() ) as $break ) {
			$min = (int) ( $break['min_qty'] ?? 0 );
			if ( $min > 1 ) {
				$qtys[] = $min;
				$last   = max( $last, $min );
			}
		}

		if ( $last > 0 ) {
			$qtys[] = $last * 2;
		}

		$qtys = array_values( array_unique( $qtys ) );
		sort( $qtys );

		$max = (int) ( $config['max_qty'] ?? PHP_INT_MAX );
		return array_values(
			array_filter(
				$qtys,
				static fn( int $q ): bool => $q >= 1 && $q <= $max
			)
		);
	}

	/**
	 * The two prices a headline may quote, taken FROM the grid it sits above.
	 *
	 * "À partir de X" is the first thing a competitor screenshots and the first
	 * thing a customer checks against their basket. Mistertee's headline is
	 * their 500-unit price, so a buyer of twenty discovers a 36 % gap by
	 * scrolling; that is a lie that scales, and the only defence is to derive
	 * the number rather than choose it.
	 *
	 * So both anchors are read out of `grid()`'s own single-side row: `unit` is
	 * the cell at quantity 1, `best` is the cheapest cell there is, and `best`
	 * carries the quantity that reaches it so the claim is checkable on the page
	 * it is printed on.
	 *
	 * Returns array() when the grid is empty rather than a zero, because a
	 * headline of 0,00 EUR is a price and 'no headline' is not.
	 */
	public static function headline( string $garment, array $config ): array {
		$rows = self::grid( $garment, self::grid_qtys( $config ), array( 1 ), $config );
		if ( empty( $rows ) || empty( $rows[0]['cells'] ) ) {
			return array();
		}

		$cells = $rows[0]['cells'];
		$unit  = null;
		$best  = null;

		foreach ( $cells as $cell ) {
			if ( 1 === (int) $cell['qty'] ) {
				$unit = $cell;
			}
			/*
			 * A cell the cart would refuse cannot be a headline.
			 *
			 * "9,42 EUR à partir de 100 pièces" is a promise, and on a hoodie a
			 * hundred pieces is past the self-serve threshold: the customer
			 * would reach the basket and be told to ask for a quote instead.
			 * Anchoring on a quantity we will actually sell is the whole point
			 * of deriving the anchor rather than choosing it.
			 */
			if ( ! empty( $cell['needs_quote'] ) ) {
				continue;
			}
			if ( null === $best || $cell['unit_ht'] < $best['unit_ht'] ) {
				$best = $cell;
			}
		}

		if ( null === $best ) {
			// Every quantity on the grid needs a quote. There is no self-serve
			// price to announce, so none is announced.
			return array();
		}

		return array(
			'unit' => $unit ?? $cells[0],
			'best' => $best,
		);
	}

	/**
	 * The printed area the grid's prices assume, cm², or null when unbounded.
	 *
	 * The grid prices every side at the cheapest area tier, so the table needs a
	 * footnote saying up to what size that holds. Reading the bound out of the
	 * config is what stops the footnote and the tier from drifting apart.
	 */
	public static function std_area_sq_cm( array $config ): ?float {
		$tiers = $config['area_tiers'] ?? array();
		if ( empty( $tiers ) ) {
			return null;
		}
		$first = $tiers[0];
		return null === $first['max_sq_cm'] ? null : (float) $first['max_sq_cm'];
	}
}
