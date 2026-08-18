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

	/** What the report format is, so a stored one can be read years later. */
	public const VERSION = 1;

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

			if ( null === $unit && isset( $garment_costs[ $garment ] ) ) {
				$typed = $garment_costs[ $garment ];
				if ( is_array( $typed ) && isset( $typed['ht'] ) && (int) $typed['ht'] > 0 ) {
					$unit   = (int) $typed['ht'];
					$source = (string) ( $typed['source'] ?? __( 'Saisi à la main', 'teeshoop' ) );
					$on     = (string) ( $typed['on'] ?? '' );
					$conf   = Cost::ESTIMATED;
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
			$lines[] = array(
				'label'      => $item->get_name(),
				'qty'        => $qty,
				'unit_ht'    => $unit,
				'amount_ht'  => $amount,
				'confidence' => $conf,
				'source'     => $source,
				'on'         => $on,
			);
		}

		return array(
			'lines'    => $lines,
			'total_ht' => $total,
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
				(string) $line['on']
			);
		}

		// ── marquage: the film, from the packer ──────────────────────────────
		$film = null;
		$nest = Nest::billed_metres( $work['pieces'], $config );

		if ( $nest['ok'] && $work['complete'] ) {
			$film         = Cost::film( (float) $nest['billed_m'], $config );
			$components[] = Cost::component(
				'marquage',
				(int) $film['amount_ht'],
				Cost::ESTIMATED,
				sprintf(
					/* translators: 1: metres of film, 2: rate per metre in euros. */
					__( '%1$s m imbriqués sur laize de %2$s cm, tarif au mètre linéaire', 'teeshoop' ),
					Money::number( (float) $film['billed_m'], 2 ),
					Money::number( (float) ( $config['film']['width_cm'] ?? 0 ), 0 )
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

		$plan = Margin::plan( (int) $cost['total_ht'], self::rules( $rate ?? 0.0, $config ) );
		$verdict = Margin::verdict( (int) $totals['total_ht'], $plan );

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

		$accrued = Commission::accrue(
			(int) $verdict['margin_ht'] - $refunded_ht,
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
		if ( $plan['raised_to_floor'] ) {
			$warnings[] = __( 'Le prix conseillé a été relevé au plancher : la marge cible et la contribution minimale se contredisent aux réglages actuels.', 'teeshoop' );
		}
		if ( $verdict['below_cost'] ) {
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
		if ( $verdict['below_floor'] ) {
			$warnings[] = self::derogation_covers( $derogation, $verdict, $plan, Settings::today() )
				? sprintf(
					/* translators: %s: who authorised the sale below the floor. */
					__( 'Vendue sous le prix plancher, sous dérogation accordée par %s.', 'teeshoop' ),
					(string) $derogation['approver']
				)
				: __( 'Vendue sous le prix plancher, sans dérogation en cours : il en faut une, avec un motif, un valideur et une durée.', 'teeshoop' );
		} elseif ( $verdict['needs_approval'] ) {
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
		);
		foreach ( $order->get_items() as $item ) {
			$parts[] = $item->get_id() . ':' . $item->get_quantity() . ':' . $item->get_subtotal();
			if ( $item instanceof \WC_Order_Item_Product ) {
				$parts[] = (string) $item->get_meta( '_teeshoop_sides', true );
			}
		}
		return md5( implode( '|', $parts ) );
	}

	/** Whether a stored report still describes the order in front of us. */
	public static function current( \WC_Order $order, ?array $report ): bool {
		return null !== $report && isset( $report['order_stamp'] ) && $report['order_stamp'] === self::stamp( $order );
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
	public static function derogation_covers( ?array $derogation, array $verdict, array $plan, string $today ): bool {
		if ( null === $derogation ) {
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
