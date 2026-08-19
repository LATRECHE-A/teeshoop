<?php
/**
 * What one order really cost, what it must not have been sold below, and what
 * the salesperson earned on it.
 *
 * `Cost`, `Margin` and `Commission` hold the arithmetic and know nothing about
 * WooCommerce. This is the file that reads a real order and hands them real
 * numbers: it is where the shipped garment, the stored design, the Colissimo
 * bracket, the film the nesting engine measured and the money the ledger
 * received all meet.
 *
 * ── THE RULE THAT SHAPES EVERYTHING HERE ─────────────────────────────────────
 *
 * An incomplete cost is not a small cost. Three of the ten components have no
 * value anybody has ever measured (the defect provision, the consumables, and
 * whichever of the seven workshop operations were never stopwatched), and a
 * fourth, the film, depends on a service that can be down. So the report always
 * says which components are missing, and the floor price it states is labelled
 * a MINIMUM: the real floor is at least this and possibly higher.
 *
 * That distinction is the whole safety property. A price under the minimum floor
 * is CERTAINLY below the floor and needs an exception. A price above it is not
 * proven to be above the real one, and the screen says so rather than showing a
 * green tick over an unanswered question.
 *
 * ── WHAT IS FROZEN AND WHAT IS LIVE ──────────────────────────────────────────
 *
 * The report is computed on demand and STORED on the order with the date and the
 * configuration version it was computed under. It is not recomputed on every
 * page load, for the same reason the invoice is frozen at issue: an order's
 * economics must be the same number tomorrow, and a rate the associate changes
 * next month must not silently rewrite the history of what he earned. Recomputing
 * is a button.
 *
 * ── WHERE THIS IS REACHABLE FROM, AND WHERE IT IS NOT ────────────────────────
 *
 * From two screens and nothing else: the order's "Coût, plancher et marge" panel
 * and the simulator on the "Coûts et marges" settings page. Chapter 1 also
 * specifies an HTTP surface, and none of it exists.
 *
 * NO POST /pricing/quotes/calculate. The computation the chapter describes is
 * `compute()`, but it takes a `WC_Order`, so only something already ordered can
 * be costed. A devis (`Quote.php`) cannot: it has no lines, no garment and no
 * design, because a request for a quote is a message and not yet a basket. The
 * route is worth building the day a quote becomes a document with lines, which
 * is session 06, and it should call this rather than grow a second engine.
 *
 * NO POST /pricing/quotes/{id}/approval-request. The exception itself is built
 * and is the load-bearing half: `derogation()` records a below-floor sale with
 * its reason, its approver, its validity window and the shortfall in euros, and
 * `derogation_covers()` refuses one that no longer matches the order. What does
 * not exist is the ROUND TRIP the chapter draws, where a salesperson asks and
 * somebody else approves, with the competitor, the client's importance, the
 * deadline and attachments. That needs two roles, and this shop has one: whoever
 * is at the keyboard types the approver's name. Building the request half
 * without the second role would produce an approval that approves nothing, which
 * reads on screen exactly like one that does.
 *
 * NO HISTORY OF VERSIONS. The chapter asks that every price change create a new
 * version and that a sent quote never change silently. An order keeps ONE report,
 * frozen, replaced when someone presses Recalculer; `staleness()` can tell that
 * the order, the settings or the format have moved since, which is what stops a
 * stale number being read as current, but the previous report is gone. A quote
 * that has been sent is the object that needs the version chain, and it belongs
 * with the quote document in session 06.
 *
 * NO KPIs. The chapter lists ten, from average contributive margin to the SAV
 * cost per order. Nine of them are ratios over a population of orders, and the
 * population is the fifteen real orders the live shop carried in August 2026,
 * over a demonstration catalogue on which no selling price is written at all
 * (H-Q42-MARGE-TEXTILE-NU): a margin rate averaged over that would look like
 * management information and would not be any. The tenth, estimated cost against real cost,
 * needs the real cost fed back after production, which is sessions 07 and 08.
 * `docs/ROADMAP.md` carries this under "Les exceptions assumées" with the
 * session that should treat it.
 *
 * ── NOTHING HERE EVER REACHES A CUSTOMER ─────────────────────────────────────
 *
 * Purchase prices, film rates and commissions. `scripts/php-guard.mjs` carries
 * the vocabulary as needles in every directory that renders, and question 39's
 * written default is that a customer sees the salesperson's name and never the
 * commission.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class Costing {

	/** Order meta: the stored margin report, as JSON. */
	public const META_REPORT = '_teeshoop_marge';

	/** Order meta: which kind of sale this was, for the commission. */
	public const META_SALE_TYPE = '_teeshoop_type_vente';

	/** Order meta: who sold it. A name, shown to the operator, never a rate. */
	public const META_SELLER = '_teeshoop_commercial';

	/** Order meta: an authorised sale below the floor, as JSON. */
	public const META_DEROGATION = '_teeshoop_derogation';

	/** Order meta: the date the order was delivered or closed. */
	public const META_DELIVERED = '_teeshoop_livree_le';

	/** Order meta: which kind of client this is, for a scoped floor. */
	public const META_CLIENT = '_teeshoop_type_client';

	/** Order meta: how urgent this order is, for a scoped floor. */
	public const META_URGENCE = '_teeshoop_urgence';

	/**
	 * What the report format is, so a stored one can be read years later.
	 *
	 * 2 since the scoped floors: a version 1 report was computed before the rule
	 * table existed, and "no rule applied" and "there were no rules" are
	 * different claims. The panel says which.
	 */
	public const VERSION = 3;

	// ── Configuration ────────────────────────────────────────────────────────

	public static function config(): array {
		$stored = get_option( OPTION_COSTING, array() );
		return Cost::merge_config( is_array( $stored ) ? $stored : array() );
	}

	public static function commission_config(): array {
		$stored = get_option( OPTION_COMMISSION, array() );
		return Commission::merge_config( is_array( $stored ) ? $stored : array() );
	}

	/**
	 * The scoped floor rules, normalised.
	 *
	 * ITS OWN OPTION, and that is not tidiness. `Cost::merge_config` drops any
	 * stored top-level key it does not ship a default for, and `CostAdmin::save`
	 * rewrites the cost option from a literal, so a rules key living in there
	 * would be deleted by the next press of Enregistrer on an unrelated field.
	 * That is exactly the mechanism that deleted `billing_step_cm` and 291,94 EUR
	 * of floor price, one commit ago.
	 */
	public static function rules_table(): array {
		return PriceRule::normalise_all( get_option( OPTION_PRICE_RULES, array() ) );
	}

	/**
	 * The rules the floor and the recommended price are built from.
	 *
	 * The commission rate in the PLAN is the one this order actually pays, not
	 * the highest one on the books. A floor computed at 40 % on an order that
	 * pays nobody anything would refuse a sale the shop is happy to make, and one
	 * computed at 0 % on an order that pays 40 % would authorise a sale that
	 * leaves the shop nothing. It is the same formula either way; what it is fed
	 * has to be this order's own rate.
	 */
	public static function rules( float $commission_rate, array $config ): array {
		return array(
			'target_margin_rate'    => (float) ( $config['target_margin_rate'] ?? 0 ),
			'min_contribution_rate' => (float) ( $config['min_contribution_rate'] ?? 0 ),
			'commission_rate'       => $commission_rate,
			'max_discount_rate'     => (float) ( $config['max_discount_rate'] ?? 0 ),
		);
	}

	// ── Reading an order ─────────────────────────────────────────────────────

	public static function sale_type( \WC_Order $order ): string {
		$stored = (string) $order->get_meta( self::META_SALE_TYPE, true );
		/*
		 * A SELF-SERVE ORDER PAYS NOBODY, and that is the safe default rather
		 * than a convenient one: the Bible's own table says "commande autonome
		 * du site : 0 % sauf règle d'attribution temporaire". An order nobody has
		 * claimed was not sold by anybody.
		 */
		return isset( Commission::SALE_TYPES[ $stored ] ) ? $stored : 'site';
	}

	public static function seller( \WC_Order $order ): string {
		return (string) $order->get_meta( self::META_SELLER, true );
	}

	public static function delivered_on( \WC_Order $order ): string {
		$stored = (string) $order->get_meta( self::META_DELIVERED, true );
		return 1 === preg_match( '/^\d{4}-\d{2}-\d{2}$/', $stored ) ? $stored : '';
	}

	public static function client_type( \WC_Order $order ): string {
		$stored = (string) $order->get_meta( self::META_CLIENT, true );
		return isset( PriceRule::CLIENTS[ $stored ] ) ? $stored : '';
	}

	public static function urgence( \WC_Order $order ): string {
		$stored = (string) $order->get_meta( self::META_URGENCE, true );
		return isset( PriceRule::URGENCES[ $stored ] ) ? $stored : '';
	}

	/**
	 * The day the order was placed, which is the day its rules were in force.
	 *
	 * NOT TODAY, and the difference is a whole class of defect. A rule's validity
	 * window says when the shop's policy applied; an order from June was governed
	 * by June's policy, and recomputing it in September must not price it under a
	 * rule written in August. Matching on today also meant a dated rule silently
	 * changed a floor at midnight with nothing to notice it, because no
	 * fingerprint covers the clock.
	 */
	public static function placed_on( \WC_Order $order ): string {
		$date = $order->get_date_created();
		return $date ? $date->date( 'Y-m-d' ) : Settings::today();
	}

	/**
	 * The six things a price rule may select an order on.
	 *
	 * ── THE FAMILY IS THE HARD ONE, AND IT WAS WRONG TWICE ───────────────────
	 *
	 * A catalogue line's family lives on the PARENT product and not on the
	 * variation the order item points at, so reading it off `get_product()`
	 * returns nothing for every imported line, silently. It is read off
	 * `get_product_id()`, which is the parent.
	 *
	 * And the two sources speak different languages: the importer writes
	 * tee/polo/sweat/shirt/other, the studio writes tee/hoodie/custom, and
	 * measured on the mirror not one product carries both. `Costing` translates
	 * the studio's word into the catalogue's here, once, so a rule is written in
	 * one vocabulary (`PriceRule::FAMILIES`).
	 *
	 * ── AND A MIXED ORDER HAS NO FAMILY ──────────────────────────────────────
	 *
	 * An order whose lines are not all one family reports '', which matches only
	 * rules that do not select on a family. That is the conservative reading: a
	 * thin floor written for t-shirts has not been shown to apply to a basket
	 * that is half sweatshirts, and the alternative (letting the majority decide)
	 * would let one cheap line of another family pull a whole order onto a
	 * different floor.
	 */
	public static function facts( \WC_Order $order ): array {
		$families = array();
		$garments = 0;
		$printed  = false;

		foreach ( $order->get_items() as $item ) {
			if ( ! $item instanceof \WC_Order_Item_Product ) {
				continue;
			}
			$garments += max( 1, (int) $item->get_quantity() );

			$sides = json_decode( (string) $item->get_meta( '_teeshoop_sides', true ), true );
			if ( is_array( $sides ) && array() !== $sides ) {
				$printed = true;
			}

			/*
			 * THREE SOURCES, in order of how specific they are to this line.
			 *
			 * The catalogue family sits on the PARENT product, not on the
			 * variation the item points at. The studio garment is written onto
			 * the ITEM by the cart, which is the most specific answer there is:
			 * it says what this line was priced as. And `Product::garment_of` is
			 * the product's own declaration, which the plugin already calls the
			 * authority (Cart.php) and which is the ONLY source for a line an
			 * operator added by hand in wp-admin, where no cart ever ran.
			 */
			$family = (string) get_post_meta( (int) $item->get_product_id(), Catalogue::META_FAMILY, true );
			if ( '' === $family ) {
				$family = PriceRule::family_of_garment( (string) $item->get_meta( '_teeshoop_garment', true ) );
			}
			if ( '' === $family ) {
				$family = PriceRule::family_of_garment( Product::garment_of( (int) $item->get_product_id() ) );
			}
			/*
			 * A LINE WHOSE FAMILY CANNOT BE READ COUNTS, and counts as its own
			 * unknown. Dropping it and keeping the others' family would let a
			 * rule written for t-shirts price an order containing something
			 * nobody could identify, which is the unsafe direction. It happens:
			 * a product deleted after the order, a line added by hand, an import
			 * that never ran.
			 */
			$families[ '' !== $family ? $family : '?' ] = true;
		}

		return array(
			'famille'    => 1 === count( $families ) && ! isset( $families['?'] ) ? (string) array_key_first( $families ) : '',
			/*
			 * The only thing this shop produces, and only when it produces
			 * something. See PriceRule::TECHNIQUES: a studio order IS a DTF
			 * order, derived rather than stored because nothing records a
			 * technique. An order with nothing to press is not one: saying "dtf"
			 * of a blank resale would let a marking rule set its floor.
			 */
			'technique'  => $printed ? 'dtf' : '',
			'commercial' => self::seller( $order ),
			'client'     => self::client_type( $order ),
			'urgence'    => self::urgence( $order ),
			'quantite'   => $garments,
		);
	}

	/**
	 * The transfers this order has to press, and the garments they go on.
	 *
	 * One entry per DISTINCT transfer with the quantity beside it, which is what
	 * the packer wants: thirty identical shirts are one rectangle times thirty,
	 * not thirty rectangles.
	 *
	 * `complete` is false as soon as one printed side carries no geometry. It is
	 * reported rather than worked around because the two ways of working around
	 * it are both wrong: nesting the sides we do have understates the film, and
	 * inferring a rectangle from the printed AREA invents a shape. A side of
	 * 400 cm² is one 20 × 20 transfer or four 10 × 10 ones, and those cost very
	 * different amounts of a 56 cm roll.
	 *
	 * @return array{pieces:array,garments:int,transfers:int,complete:bool,lines:int}
	 */
	public static function transfers( \WC_Order $order ): array {
		$pieces    = array();
		$garments  = 0;
		$transfers = 0;
		$poses     = 0;
		$complete  = true;
		$lines     = 0;
		$graded    = false;

		foreach ( $order->get_items() as $item ) {
			if ( ! $item instanceof \WC_Order_Item_Product ) {
				continue;
			}
			$qty       = max( 1, (int) $item->get_quantity() );
			$garments += $qty;
			++$lines;

			/*
			 * THE RECTANGLES ARE MEASURED AT ONE SIZE and this order may not be
			 * in it. `src/lib/ink.ts` measures at the priced size (M on every
			 * garment we sell), and the studio grades a print with the garment:
			 * a 3XL chest is 64 cm where an M is 52, so the same design prints
			 * 23 % larger in each direction.
			 *
			 * That is question 37, and until now it was a question about the
			 * PRICE. It is now also a question about the FILM: measured by
			 * nesting the worked order's own two visuals at both sizes, thirty
			 * garments take 1,80 m of roll at M and 2,70 m at 3XL, which is 50 %
			 * more film for the same order. We cost the M.
			 *
			 * Flagged rather than corrected here, deliberately. Correcting it
			 * means emitting one rectangle per (visual, size), which is what
			 * session 07 builds when it nests film ACROSS orders, and it means
			 * the grading factor existing in PHP as well as in the studio, which
			 * is a second implementation of one rule. A warning that names the
			 * measured size of the error is worth more than a second answer.
			 */
			$grid = json_decode( (string) $item->get_meta( '_teeshoop_size_grid', true ), true );
			if ( is_array( $grid ) ) {
				$priced = Garments::priced_size( (string) $item->get_meta( '_teeshoop_garment', true ) );
				foreach ( $grid as $size => $count ) {
					if ( (int) $count > 0 && (string) $size !== $priced ) {
						$graded = true;
					}
				}
			}

			$sides = json_decode( (string) $item->get_meta( '_teeshoop_sides', true ), true );
			if ( ! is_array( $sides ) || array() === $sides ) {
				// A line with no printed side is a blank: no transfer, and no gap
				// in what we know either.
				continue;
			}

			foreach ( $sides as $side ) {
				if ( ! is_array( $side ) ) {
					continue;
				}
				/*
				 * GARMENT-SIDES, and the reason they are counted beside the
				 * transfers is question 32. How many transfers a side prints as
				 * is an OPERATOR'S decision — the workshop screen can force a
				 * single pose on a job where handling costs more than film — so
				 * a count of transfers is not a property of the order at all.
				 * A count of sides pressed is: it does not move when the split
				 * moves, and it does not move when the marking is graded up a
				 * size either. It is therefore the one number session 07 can
				 * check a browser-measured layout against exactly.
				 */
				$poses += $qty;
				/*
				 * THE AREA IS PASSED AGAIN HERE, and it is not belt and braces
				 * for its own sake: these rectangles reached the order through
				 * an open route, and this is the last point before they become
				 * a film cost and a floor price. Re-checking a stored value
				 * against its own sibling costs nothing and closes the case
				 * where a line was written by an older build, by an importer,
				 * or by hand.
				 */
				$geometry = Design::normalise_pieces(
					$side['pieces'] ?? null,
					isset( $side['area_sq_cm'] ) ? (float) $side['area_sq_cm'] : 0.0
				);
				if ( array() === $geometry ) {
					$complete   = false;
					// Still counted as one press, so the labour is not silently
					// free as well.
					$transfers += $qty;
					continue;
				}
				foreach ( $geometry as $index => $piece ) {
					$pieces[] = array(
						'id'   => $item->get_id() . ':' . (string) ( $side['id'] ?? '' ) . ':' . $index,
						'w_cm' => (float) $piece['w_cm'],
						'h_cm' => (float) $piece['h_cm'],
						'qty'  => $qty,
					);
					$transfers += $qty;
				}
			}
		}

		return array(
			'pieces'    => $pieces,
			'garments'  => $garments,
			'transfers' => $transfers,
			'poses'     => $poses,
			'complete'  => $complete,
			'lines'     => $lines,
			'graded'    => $graded,
		);
	}

	/**
	 * What the blanks on this order cost us, itemised per line.
	 *
	 * TWO SOURCES, IN THIS ORDER, and the order is the point:
	 *
	 *   1. the article's own supplier price, stored on the variation by the
	 *      catalogue importer. It is the real price of the real article and it
	 *      carries the date the supplier gave it.
	 *   2. a purchase price typed for that studio garment in the admin screen.
	 *
	 * and when there is neither, UNKNOWN. Never a share of the selling price:
	 * the selling price is what we are trying to judge, and deriving the cost
	 * from it would make every order look exactly as profitable as the rate we
	 * assumed.
	 *
	 * @return array{lines:array,total_ht:int,unknown:int}
	 */
	public static function blanks( \WC_Order $order, array $config ): array {
		$garment_costs = (array) ( $config['garment_supply'] ?? array() );
		$lines         = array();
		$total         = 0;
		$best_total    = 0;
		$unknown       = 0;

		foreach ( $order->get_items() as $item ) {
			if ( ! $item instanceof \WC_Order_Item_Product ) {
				continue;
			}
			$qty     = max( 1, (int) $item->get_quantity() );
			$garment = (string) $item->get_meta( '_teeshoop_garment', true );

			$unit   = null;
			$source = '';
			$on     = '';
			$conf   = Cost::UNKNOWN;

			$product = $item->get_product();
			if ( $product instanceof \WC_Product ) {
				$supply = $product->get_meta( Catalogue::META_SUPPLY_CENTS, true );
				if ( is_numeric( $supply ) && (int) $supply > 0 ) {
					$unit   = (int) $supply;
					$source = sprintf(
						/* translators: %s: a supplier article reference. */
						__( 'Tarif fournisseur de l’article %s', 'teeshoop' ),
						(string) $product->get_meta( Catalogue::META_SUPPLY_SKU, true )
					);
					$on   = (string) $product->get_meta( Garments::META_SPECS_DATE, true );
					$conf = Cost::ESTIMATED;
				}
			}

			$best = null;

			if ( null === $unit && isset( $garment_costs[ $garment ] ) ) {
				$typed = $garment_costs[ $garment ];
				if ( is_array( $typed ) && isset( $typed['ht'] ) && (int) $typed['ht'] > 0 ) {
					$source = (string) ( $typed['source'] ?? __( 'Saisi à la main', 'teeshoop' ) );
					$on     = (string) ( $typed['on'] ?? '' );
					$conf   = Cost::ESTIMATED;

					if ( ! empty( $typed['catalogue'] ) ) {
						/*
						 * THE CHAPTER'S OWN RULE, and the only place in this shop
						 * where it applies: "Lorsque le seul prix disponible est
						 * un prix catalogue à diviser par 2 à 2,5, le système doit
						 * marquer le coût comme estimé et utiliser le scénario
						 * PRUDENT jusqu'à réception du tarif réel."
						 *
						 * Prudent means the SMALLER divisor, which gives the
						 * LARGER cost. Getting that the wrong way round would
						 * flag the cost as estimated and then quietly use the
						 * flattering figure, which is worse than not flagging it.
						 * The optimistic figure travels beside it so the screen
						 * can show the operator the width of what he does not
						 * know, instead of one number that looks decided.
						 */
						$scenario = Cost::from_catalogue( (int) $typed['ht'], $config );
						$unit     = $scenario['prudent'];
						$best     = $scenario['optimistic'];
						$source   = sprintf(
							/* translators: %s: where the catalogue price came from. */
							__( 'Prix catalogue divisé par 2 (scénario prudent) : %s', 'teeshoop' ),
							$source
						);
					} else {
						$unit = (int) $typed['ht'];
					}
				}
			}

			if ( null === $unit ) {
				++$unknown;
				$lines[] = array(
					'label'      => $item->get_name(),
					'qty'        => $qty,
					'unit_ht'    => 0,
					'amount_ht'  => 0,
					'confidence' => Cost::UNKNOWN,
					'source'     => __( 'Aucun prix d’achat connu pour ce vêtement', 'teeshoop' ),
					'on'         => '',
				);
				continue;
			}

			$amount  = $unit * $qty;
			$total  += $amount;
			$best_total += null === $best ? $amount : $best * $qty;
			$lines[]     = array(
				'label'      => $item->get_name(),
				'qty'        => $qty,
				'unit_ht'    => $unit,
				'amount_ht'  => $amount,
				'best_ht'    => null === $best ? null : $best * $qty,
				'confidence' => $conf,
				'source'     => $source,
				'on'         => $on,
			);
		}

		return array(
			'lines'    => $lines,
			'total_ht' => $total,
			'best_ht'  => $best_total,
			'unknown'  => $unknown,
		);
	}

	/**
	 * What the parcel costs us, from the same grid the customer was quoted on.
	 *
	 * `Shipping::quote` already separates the two numbers session 04 knew this
	 * session would need: `charged_ht`, what the buyer paid, and `borne_ht`, what
	 * the shop bore. The revenue side of the margin already contains the first,
	 * because it is a line of the order; the cost side needs the second, and it
	 * is the SAME number whether or not the franco applied. That is exactly the
	 * chapter's "livraison offerte" cost: an order over 300 EUR charges nothing
	 * for carriage and still buys the parcel.
	 */
	public static function parcel( \WC_Order $order ): array {
		$config    = Shipping::config();
		$grams     = 0;
		$pieces    = 0;
		$goods_ht  = 0;
		$weighable = true;

		foreach ( $order->get_items() as $item ) {
			if ( ! $item instanceof \WC_Order_Item_Product ) {
				continue;
			}
			$qty       = max( 1, (int) $item->get_quantity() );
			$pieces   += $qty;
			$goods_ht += Money::from_eur( (string) $item->get_subtotal() );

			$product = $item->get_product();
			$weight  = $product instanceof \WC_Product ? $product->get_weight() : '';
			if ( '' === $weight || null === $weight || ! is_numeric( $weight ) || (float) $weight <= 0 ) {
				$weighable = false;
				continue;
			}
			$grams += (int) round( (float) wc_get_weight( (float) $weight, 'g' ) * $qty );
		}

		return Shipping::quote( $grams, $pieces, $goods_ht, $config, $weighable );
	}

	// ── The report ───────────────────────────────────────────────────────────

	/**
	 * Compute everything, from the order as it stands today.
	 *
	 * Pure of side effects: it stores nothing and changes nothing. `refresh()`
	 * is what writes.
	 */
	public static function compute( \WC_Order $order ): array {
		$config     = self::config();
		$commission = self::commission_config();
		$totals     = Invoice::order_totals( $order );
		$work       = self::transfers( $order );
		$blanks     = self::blanks( $order, $config );
		$parcel     = self::parcel( $order );

		$components = array();
		$warnings   = array();

		// ── textile ──────────────────────────────────────────────────────────
		if ( array() === $blanks['lines'] ) {
			$components[] = Cost::component( 'textile', 0, Cost::NONE, __( 'Aucune ligne de vêtement', 'teeshoop' ) );
		}
		foreach ( $blanks['lines'] as $line ) {
			$components[] = Cost::component(
				'textile',
				(int) $line['amount_ht'],
				(string) $line['confidence'],
				(string) $line['source'],
				(string) $line['on'],
				isset( $line['best_ht'] ) && null !== $line['best_ht'] ? (int) $line['best_ht'] : null
			);
		}

		// ── marquage: the film, from the packer ──────────────────────────────
		$film = null;
		$nest = Nest::billed_metres( $work['pieces'], $config );

		/*
		 * A SENT LOT OUTRANKS THE ORDER'S OWN NESTING, and it is the only thing
		 * that does.
		 *
		 * Session 07 stopped buying film one order at a time. When this order's
		 * transfers were ganged with other people's onto one roll, what it cost
		 * is its share of that roll and not what it would have cost alone —
		 * `Production` records the share and `Cost::attribute()` computed it.
		 *
		 * ONLY A SENT LOT. A draft is a plan, and a plan is not a purchase: until
		 * the film is ordered the order keeps its own solo cost at the FRENCH
		 * rate, which is the dearer of the two and therefore the safe direction
		 * for a floor price. That is also what finally answers the objection
		 * `PriceRule::URGENCES` records against letting a dropdown pick the
		 * origin: a sent lot is not a tick, it is a purchase, frozen, with a date
		 * and an operator against it.
		 */
		$lot = Production::lot_of( $order );
		if ( null !== $lot && Production::DRAFT !== ( $lot['state'] ?? '' ) ) {
			$film = array(
				'origin'    => (string) ( $lot['origin'] ?? 'fr' ),
				'lot_id'    => (int) $lot['lot_id'],
				'billed_m'  => (float) ( $lot['pooled_m'] ?? 0.0 ),
				'solo_m'    => (float) ( $lot['solo_m'] ?? 0.0 ),
				'solo_ht'   => (int) ( $lot['solo_ht'] ?? 0 ),
				'amount_ht' => (int) ( $lot['share_ht'] ?? 0 ),
				'saved_ht'  => (int) ( $lot['saved_ht'] ?? 0 ),
				'orders'    => (int) ( $lot['orders'] ?? 1 ),
				'pooled'    => true,
			);
			$components[] = Cost::component(
				'marquage',
				(int) $film['amount_ht'],
				Cost::ESTIMATED,
				sprintf(
					/* translators: 1: how many orders shared the film, 2: metres of film, 3: the lot number. */
					__( 'Part de %1$d commandes imbriquées ensemble sur %2$s m de film (lot n° %3$d)', 'teeshoop' ),
					(int) $film['orders'],
					Money::number( (float) $film['billed_m'], 2 ),
					(int) $film['lot_id']
				),
				''
			);
			if ( (int) $film['saved_ht'] > 0 ) {
				$warnings[] = sprintf(
					/* translators: %s: money saved by printing this order with others. */
					__( 'Imbriquée avec d’autres commandes : %s de film économisés par rapport à un tirage seul.', 'teeshoop' ),
					Money::format( (int) $film['saved_ht'] )
				);
			} elseif ( (int) $film['saved_ht'] < 0 ) {
				$warnings[] = sprintf(
					/* translators: %s: money this order lost by being printed with others. */
					__( 'Ce lot a coûté %s de plus à cette commande qu’un tirage seul : les transferts ne s’imbriquaient pas.', 'teeshoop' ),
					Money::format( -(int) $film['saved_ht'] )
				);
			}
		} elseif ( $nest['ok'] && $work['complete'] ) {
			$film         = Cost::film( (float) $nest['billed_m'], $config );
			$components[] = Cost::component(
				'marquage',
				(int) $film['amount_ht'],
				Cost::ESTIMATED,
				sprintf(
					/* translators: 1: metres of film, 2: roll width in cm, 3: the rate per linear metre. */
					__( '%1$s m imbriqués sur laize de %2$s cm, à %3$s le mètre linéaire', 'teeshoop' ),
					Money::number( (float) $film['billed_m'], 2 ),
					Money::number( (float) ( $config['film']['width_cm'] ?? 0 ), 0 ),
					Money::format( (int) $film['rate_ht'] )
				),
				''
			);
			if ( ! empty( $film['at_minimum'] ) ) {
				$warnings[] = __( 'La commande n’atteint pas le métrage minimum du fournisseur de film : elle paie du film qu’elle n’utilise pas.', 'teeshoop' );
			}
		} else {
			/*
			 * A PRUDENT BOUND, NEVER A GUESS, and only when the geometry itself
			 * is complete: it is the length one shelf per transfer would take,
			 * which no packing can exceed. It overstates a real order badly, and
			 * that is the safe direction for a floor price. With the geometry
			 * missing there is nothing to bound either, and the component is
			 * simply unknown.
			 */
			$reason = $work['complete'] ? Nest::reason_fr( (string) $nest['reason'] ) : Nest::reason_fr( 'aucune_geometrie' );

			$bound = $work['complete'] && array() !== $work['pieces']
				? Cost::prudent_length_cm( $work['pieces'], $config )
				: array( 'ok' => false, 'length_cm' => 0.0, 'impossible' => array() );

			if ( $bound['ok'] ) {
				$film          = Cost::film( (float) $bound['length_cm'] / 100, $config );
				$film['bound'] = true;
				$components[]  = Cost::component(
					'marquage',
					(int) $film['amount_ht'],
					Cost::ESTIMATED,
					__( 'Borne haute : une bande par transfert, sans imbrication. ', 'teeshoop' ) . $reason,
					''
				);
				$warnings[] = __( 'Le métrage de film n’a pas pu être mesuré, la borne haute a été utilisée : le coût est majoré et le plancher aussi.', 'teeshoop' ) . ' ' . $reason;
			} elseif ( array() !== $bound['impossible'] ) {
				$components[] = Cost::component( 'marquage', 0, Cost::UNKNOWN, Nest::reason_fr( 'piece_impossible' ) );
				$warnings[]   = Nest::reason_fr( 'piece_impossible' );
			} elseif ( array() === $work['pieces'] && 0 === $work['transfers'] ) {
				$components[] = Cost::component( 'marquage', 0, Cost::NONE, __( 'Aucun marquage sur cette commande', 'teeshoop' ) );
			} else {
				$components[] = Cost::component( 'marquage', 0, Cost::UNKNOWN, $reason );
				$warnings[]   = $reason;
			}
		}

		// ── inbound freight ──────────────────────────────────────────────────
		$freight = Cost::freight( $blanks['total_ht'], $config );
		$components[] = Cost::component(
			'transport_in',
			$freight,
			$blanks['total_ht'] > 0 ? Cost::ESTIMATED : Cost::UNKNOWN,
			__( 'Port fournisseur textile, franco supposé (question 03)', 'teeshoop' )
		);

		// ── packaging and carriage ───────────────────────────────────────────
		$components[] = Cost::component(
			'emballage',
			(int) $parcel['packaging_ht'],
			Cost::ESTIMATED,
			__( 'Emballage par pièce et carton (question 07)', 'teeshoop' )
		);

		if ( $parcel['ok'] ) {
			$components[] = Cost::component(
				'livraison',
				(int) $parcel['carrier_ht'],
				Cost::REAL,
				sprintf(
					/* translators: %s: a parcel weight bracket in grams. */
					__( 'Grille Colissimo publique, tranche %s g', 'teeshoop' ),
					Money::number( (float) $parcel['bracket_g'], 0 )
				)
			);
			if ( ! empty( $parcel['free'] ) ) {
				$warnings[] = __( 'La livraison a été offerte : le port et l’emballage sont entièrement à notre charge sur cette commande.', 'teeshoop' );
			}
		} else {
			$components[] = Cost::component(
				'livraison',
				0,
				Cost::UNKNOWN,
				Shipping::refusal_message( (string) $parcel['reason'], Shipping::config() )
			);
		}

		// ── payment ──────────────────────────────────────────────────────────
		$method    = (string) $order->get_payment_method();
		$fee_free  = (array) ( $config['payment']['free_methods'] ?? array() );
		$basis_ttc = (int) $totals['total_ttc'];

		if ( in_array( $method, $fee_free, true ) ) {
			$components[] = Cost::component( 'paiement', 0, Cost::NONE, __( 'Virement ou chèque : aucun frais de plateforme', 'teeshoop' ) );
		} else {
			$components[] = Cost::component(
				'paiement',
				Cost::payment_fee( $basis_ttc, $config ),
				Cost::ESTIMATED,
				__( 'Frais de carte sur le montant encaissé (question 15)', 'teeshoop' )
			);
		}

		// ── consumables ──────────────────────────────────────────────────────
		$per_piece = (int) ( $config['consumables_piece_ht'] ?? 0 );
		$components[] = $per_piece > 0
			? Cost::component( 'consommables', $per_piece * $work['garments'], Cost::ESTIMATED, __( 'Consommables par pièce', 'teeshoop' ) )
			: Cost::component( 'consommables', 0, Cost::UNKNOWN, __( 'Jamais mesuré : feuilles de transfert, adhésif, nettoyage', 'teeshoop' ) );

		// ── subcontracting ───────────────────────────────────────────────────
		$components[] = Cost::component( 'sous_traite', 0, Cost::NONE, __( 'Aucune sous-traitance déclarée sur cette commande', 'teeshoop' ) );

		// ── labour ───────────────────────────────────────────────────────────
		$labour = Cost::labour(
			array(
				'orders'    => 1,
				'pieces'    => $work['garments'],
				'transfers' => $work['transfers'],
			),
			$config
		);
		$components[] = array() === $labour['untimed']
			? Cost::component(
				'main_oeuvre',
				(int) $labour['amount_ht'],
				Cost::REAL,
				sprintf(
					/* translators: %s: total minutes of workshop time. */
					__( '%s minutes d’atelier au taux horaire chargé', 'teeshoop' ),
					Money::number( $labour['seconds'] / 60, 1 )
				)
			)
			: Cost::component(
				'main_oeuvre',
				(int) $labour['amount_ht'],
				Cost::ESTIMATED,
				sprintf(
					/* translators: %d: how many workshop operations have never been timed. */
					__( 'Minoré : %d opérations d’atelier n’ont jamais été chronométrées (question 05)', 'teeshoop' ),
					count( $labour['untimed'] )
				)
			);

		// ── defect provision ─────────────────────────────────────────────────
		$defect_rate = (float) ( $config['defect_rate'] ?? 0 );
		if ( $defect_rate > 0 ) {
			$so_far = Cost::total( $components )['total_ht'];
			$components[] = Cost::component( 'defaut', Money::pct( $so_far, $defect_rate ), Cost::ESTIMATED, __( 'Provision de défaut sur le coût direct', 'teeshoop' ) );
		} else {
			$components[] = Cost::component( 'defaut', 0, Cost::UNKNOWN, __( 'Aucun taux de non-conformité connu (question 27)', 'teeshoop' ) );
		}

		// ── the totals, the plan, the verdict ────────────────────────────────
		$cost = Cost::total( $components );

		$sale_type = self::sale_type( $order );
		$rate      = Commission::rate( $sale_type, $commission );
		if ( null === $rate ) {
			$warnings[] = __( 'Le type de vente de cette commande n’est pas renseigné : aucune commission n’est calculée.', 'teeshoop' );
		}

		$facts  = self::facts( $order );
		$scoped = PriceRule::apply( self::rules( $rate ?? 0.0, $config ), self::rules_table(), $facts, self::placed_on( $order ) );

		/*
		 * A RULE CAN MAKE THE FLOOR INSOLUBLE, and then there is no floor to
		 * state. Keeping k of the price after paying c of the margin away has no
		 * solution once k ≥ 1 − c, `Margin::floor_price_rate` refuses it by
		 * throwing, and a rule that is fine against a 12 % reassort commission
		 * detonates on the first order attributed at 40 %.
		 *
		 * Caught here rather than allowed to fatal, because the thing on the
		 * other side of it is an order screen. The report then carries a NULL
		 * plan and no verdict, every reader branches on that, and nothing prints
		 * a floor of 0,00 EUR beside the words "vendable sans validation".
		 */
		$plan    = null;
		$verdict = null;
		try {
			$plan    = Margin::plan( (int) $cost['total_ht'], $scoped['rules'] );
			$verdict = Margin::verdict( (int) $totals['total_ht'], $plan );
		} catch ( \InvalidArgumentException $e ) {
			$warnings[] = sprintf(
				/* translators: 1: the minimum contribution rate, 2: the commission rate, 3: the rule that set it or a dash. */
				__( 'Aucun prix plancher n’est calculable : garder %1$s du prix de vente après avoir versé %2$s de la marge est impossible à tout prix. Règle en cause : %3$s.', 'teeshoop' ),
				Money::number( (float) $scoped['rules']['min_contribution_rate'] * 100, 2 ) . "\u{00A0}%",
				Money::number( (float) $scoped['rules']['commission_rate'] * 100, 2 ) . "\u{00A0}%",
				null === $scoped['rule'] ? __( 'aucune, ce sont les réglages généraux', 'teeshoop' ) : (string) $scoped['rule']['label']
			);
		}

		/*
		 * MONEY GIVEN BACK IS NOT MONEY EARNED, and this is the second half of
		 * "la commission est calculée sur la marge contributive ENCAISSÉE".
		 *
		 * `Ledger::received` counts receipts and knows nothing about refunds, so
		 * a fully refunded order reported a full commission on a margin the shop
		 * no longer has. WooCommerce's own two figures are used rather than a
		 * VAT division of our own: `get_total_refunded()` is TTC and
		 * `get_total_tax_refunded()` is the tax inside it, so the difference is
		 * the HT that went back, exactly, with no rounding invented here.
		 *
		 * The REVENUE block is left alone on purpose: it is what the invoice
		 * says, the invoice is a document that was issued, and a refund is a
		 * separate event. What moves is the margin the commission is computed
		 * on, and the share of the money we have actually kept.
		 */
		$refunded_ttc = Money::from_eur( (string) $order->get_total_refunded() );
		$refunded_ht  = $refunded_ttc - Money::from_eur( (string) $order->get_total_tax_refunded() );
		$kept_ttc     = max( 0, Ledger::received( $order ) - $refunded_ttc );

		/*
		 * The margin does not need a floor: it is what the order sold for minus
		 * what it cost, and both are known even when no floor can be stated.
		 */
		$margin_ht = null === $verdict
			? (int) $totals['total_ht'] - (int) $cost['total_ht']
			: (int) $verdict['margin_ht'];

		$accrued = Commission::accrue(
			$margin_ht - $refunded_ht,
			$rate ?? 0.0,
			$kept_ttc,
			(int) $totals['total_ttc'],
			$cost['complete'] && ! $cost['estimated'] ? Cost::REAL : Cost::ESTIMATED
		);

		if ( $refunded_ttc > 0 ) {
			$warnings[] = sprintf(
				/* translators: %s: an amount refunded to the customer. */
				__( '%s ont été remboursés : la marge et la commission sont calculées sur ce qui reste.', 'teeshoop' ),
				Money::format( $refunded_ttc )
			);
		}
		$state = Commission::state(
			array(
				'collected'      => $accrued['collected'],
				'delivered_on'   => self::delivered_on( $order ),
				'today'          => Settings::today(),
				'refund_pending' => 0 < (float) $order->get_total_refunded(),
				'costs_real'     => $cost['complete'] && ! $cost['estimated'],
			),
			$commission
		);

		if ( ! $cost['complete'] ) {
			$warnings[] = __( 'Le coût est incomplet : le plancher affiché est un plancher MINIMUM, le vrai est au moins celui-là.', 'teeshoop' );
		}
		if ( ! empty( $work['graded'] ) ) {
			$warnings[] = __( 'Cette commande contient des tailles autres que celle de tarification : le film est chiffré à cette taille-là. Mesuré sur une commande de trente pièces, l’imbrication réelle demande 2,70 m en 3XL contre 1,80 m en M, soit 50 % de film en plus (question 37).', 'teeshoop' );
		}
		if ( null !== $plan && $plan['raised_to_floor'] ) {
			$warnings[] = __( 'Le prix conseillé a été relevé au plancher : la marge cible et la contribution minimale se contredisent aux réglages actuels.', 'teeshoop' );
		}
		/*
		 * BELOW COST NEEDS NO FLOOR. It is the revenue against the cost, both
		 * known even when no floor can be stated, and gating it on the verdict
		 * meant the loudest fact about an order disappeared exactly when the
		 * rates were broken enough to hide it.
		 */
		if ( $margin_ht < 0 ) {
			$warnings[] = __( 'Cette commande a été vendue en dessous de son coût direct connu.', 'teeshoop' );
		}

		/*
		 * THE ONE THE CHAPTER ASKS FOR. A sale under the floor needs an
		 * exception, and an exception is only an exception while it covers this
		 * price and this floor: see `derogation_covers`. Reported here rather
		 * than only on the screen so it reaches the CLI report and anything else
		 * that reads a stored one.
		 */
		$derogation = self::derogation( $order );
		if ( null !== $verdict && $verdict['below_floor'] ) {
			$warnings[] = self::derogation_covers( $derogation, $verdict, $plan, Settings::today() )
				? sprintf(
					/* translators: %s: who authorised the sale below the floor. */
					__( 'Vendue sous le prix plancher, sous dérogation accordée par %s.', 'teeshoop' ),
					(string) $derogation['approver']
				)
				: __( 'Vendue sous le prix plancher, sans dérogation en cours : il en faut une, avec un motif, un valideur et une durée.', 'teeshoop' );
		} elseif ( null !== $verdict && $verdict['needs_approval'] ) {
			$warnings[] = __( 'La remise consentie dépasse ce qu’un commercial peut accorder seul : cette vente demandait votre accord.', 'teeshoop' );
		}

		return array(
			'version'     => self::VERSION,
			'computed_on' => Settings::today(),
			/*
			 * THE ORDER AS IT WAS WHEN THIS WAS COMPUTED.
			 *
			 * The report is frozen on purpose, so an order that is edited
			 * afterwards keeps a report describing the order it used to be:
			 * measured on the mirror, adding a line to a costed order left the
			 * panel stating the old margin, the old verdict and no demand for a
			 * derogation on a sale that had just fallen under the floor. It
			 * cannot recompute itself (that would unfreeze it), so it records
			 * what it read and the panel compares.
			 */
			'order_stamp' => self::stamp( $order ),
			'settings_stamp' => self::settings_stamp(),
			'revenue'     => $totals,
			'received_ttc' => Ledger::received( $order ),
			'refunded_ttc' => $refunded_ttc,
			'refunded_ht'  => $refunded_ht,
			'work'        => $work,
			'blanks'      => $blanks,
			'film'        => $film,
			'nest'        => $nest,
			'labour'      => $labour,
			'parcel'      => $parcel,
			'cost'        => $cost,
			'plan'        => $plan,
			'verdict'     => $verdict,
			'sale_type'   => $sale_type,
			'seller'      => self::seller( $order ),
			'commission'  => $accrued + array( 'known_rate' => null !== $rate ),
			'state'       => $state,
			'facts'       => $facts,
			'rule'        => $scoped['rule'],
			'derogation'  => $derogation,
			'covered'     => self::derogation_covers( $derogation, $verdict, $plan, Settings::today() ),
			'warnings'    => $warnings,
		);
	}

	/** Compute and store, returning the report. The only thing that writes one. */
	public static function refresh( \WC_Order $order ): array {
		$report = self::compute( $order );
		$order->update_meta_data( self::META_REPORT, wp_json_encode( $report ) );
		$order->save();
		return $report;
	}

	/**
	 * A fingerprint of everything about the order the report depends on.
	 *
	 * The modification date alone is not enough: WooCommerce does not always
	 * touch it, and `Costing::refresh` saves the order itself, which moves it.
	 * So it is the facts: what is on the order, what it costs, what has been
	 * paid, and who is said to have sold it.
	 */
	public static function stamp( \WC_Order $order ): string {
		$parts = array(
			$order->get_total(),
			$order->get_total_tax(),
			$order->get_total_refunded(),
			count( $order->get_items() ),
			self::sale_type( $order ),
			self::delivered_on( $order ),
			(string) Ledger::received( $order ),
			/*
			 * THE THREE THAT NOW MOVE THE FLOOR. The docblock above already
			 * claimed to cover "who is said to have sold it" and did not, which
			 * was harmless while the seller changed no number. It is not any
			 * more: all three are price-rule selectors, so a write to any of them
			 * that does not go through the panel would otherwise leave a stale
			 * report reading "à jour".
			 */
			self::seller( $order ),
			self::client_type( $order ),
			self::urgence( $order ),
			// The day the order was placed decides which rules were in force for
			// it, and an operator can edit an order's date.
			self::placed_on( $order ),
			/*
			 * THE LOT, because it now decides the film cost. Without this a
			 * report computed before the film was ordered went on reading « à
			 * jour » while the order's biggest cost line had been replaced by a
			 * share of somebody else's roll.
			 */
			(string) $order->get_meta( Production::META_ORDER_LOT, true ),
		);
		foreach ( $order->get_items() as $item ) {
			$parts[] = $item->get_id() . ':' . $item->get_quantity() . ':' . $item->get_subtotal();
			if ( $item instanceof \WC_Order_Item_Product ) {
				$parts[] = (string) $item->get_meta( '_teeshoop_sides', true );
			}
		}
		return md5( implode( '|', $parts ) );
	}

	/**
	 * A fingerprint of the SETTINGS a report was computed under.
	 *
	 * The order stamp catches an edited order. It cannot catch the other half,
	 * and the other half is now the bigger one: writing a price rule changes
	 * every floor it matches, and nothing about any order moves. Without this,
	 * an operator could add a rule that raises a floor by 150,00 EUR and every
	 * stored report would go on reading "à jour", with the derogation form still
	 * offering an exception measured against the floor the rule replaced.
	 */
	public static function settings_stamp(): string {
		return md5(
			(string) wp_json_encode(
				array(
					self::rules_table(),
					get_option( OPTION_COSTING, array() ),
					get_option( OPTION_COMMISSION, array() ),
					self::VERSION,
				)
			)
		);
	}

	/**
	 * Why a stored report no longer describes the order in front of us, or ''.
	 *
	 * TWO SENTENCES AND NOT ONE, because they send an operator to two different
	 * places: "the order changed" means look at the order, "the rules changed"
	 * means look at the rule table. And a report older than the rule table is a
	 * third thing again: it never consulted one.
	 */
	public static function staleness( \WC_Order $order, ?array $report ): string {
		if ( null === $report ) {
			return '';
		}
		if ( (int) ( $report['version'] ?? 1 ) < self::VERSION ) {
			return 'version';
		}
		if ( ( $report['order_stamp'] ?? '' ) !== self::stamp( $order ) ) {
			return 'commande';
		}
		if ( ( $report['settings_stamp'] ?? '' ) !== self::settings_stamp() ) {
			return 'reglages';
		}
		return '';
	}

	/** Whether a stored report still describes the order AND the rules in force. */
	public static function current( \WC_Order $order, ?array $report ): bool {
		return null !== $report && '' === self::staleness( $order, $report );
	}

	/** The stored report, or null when nobody has ever asked for one. */
	public static function stored( \WC_Order $order ): ?array {
		$raw = json_decode( (string) $order->get_meta( self::META_REPORT, true ), true );
		return is_array( $raw ) && isset( $raw['version'] ) ? $raw : null;
	}

	// ── Selling below the floor ──────────────────────────────────────────────

	/**
	 * The exception the chapter requires for a sale under the floor: "une demande
	 * d'exception avec motif, validation, durée de validité et impact affiché".
	 *
	 * All four, or it is not one. A derogation with no approver is a note, and a
	 * derogation with no expiry is a permanent discount somebody granted once.
	 *
	 * @return array|null
	 */
	public static function derogation( \WC_Order $order ): ?array {
		$raw = json_decode( (string) $order->get_meta( self::META_DEROGATION, true ), true );
		if ( ! is_array( $raw ) ) {
			return null;
		}
		foreach ( array( 'reason', 'approver', 'until', 'on' ) as $key ) {
			if ( ! isset( $raw[ $key ] ) || '' === trim( (string) $raw[ $key ] ) ) {
				return null;
			}
		}
		return array(
			'reason'    => (string) $raw['reason'],
			'approver'  => (string) $raw['approver'],
			'until'     => (string) $raw['until'],
			'on'        => (string) $raw['on'],
			'impact_ht' => (int) ( $raw['impact_ht'] ?? 0 ),
			'floor_ht'  => (int) ( $raw['floor_ht'] ?? 0 ),
			'price_ht'  => (int) ( $raw['price_ht'] ?? 0 ),
		);
	}

	/**
	 * Whether a derogation still covers this order today.
	 *
	 * IT IS CHECKED AGAINST THE FLOOR IT WAS GRANTED ON, not only against its
	 * date. An exception is an authorisation to sell at a stated price given a
	 * stated shortfall; if the cost has since been corrected upwards and the
	 * shortfall is larger, nobody has authorised the new one.
	 */
	public static function derogation_covers( ?array $derogation, ?array $verdict, ?array $plan, string $today ): bool {
		/*
		 * No plan means no floor, so nothing can be shown to be covered: an
		 * exception authorises a stated shortfall against a stated floor, and
		 * with neither there is nothing to compare. Typed nullable rather than
		 * called conditionally, because `compute()` calls it on every path and a
		 * TypeError on an order screen is not an error message.
		 */
		if ( null === $derogation || null === $verdict || null === $plan ) {
			return false;
		}
		if ( $derogation['until'] < $today ) {
			return false;
		}
		if ( (int) $verdict['price_ht'] !== (int) $derogation['price_ht'] ) {
			return false;
		}
		return (int) $plan['floor_ht'] <= (int) $derogation['floor_ht'];
	}
}
