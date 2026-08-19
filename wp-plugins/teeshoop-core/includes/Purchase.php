<?php
/**
 * What the workshop has to buy, from whom, at what cost, and whether it left.
 *
 * `Production.php` made the LOT the unit that buys film. This file does the
 * other half of the same run: the blanks. Same shape, same reasons, and one
 * difference that decides everything below.
 *
 * ── A BASKET IS DERIVED, NEVER ENTERED ───────────────────────────────────────
 *
 * Every quantity here is traceable to an order line and to a size grid, and
 * `aggregate()` proves it: each row carries the (order, line, size) claims that
 * built it, and their quantities sum to the row's. Ordering the wrong size or
 * the wrong colour is the most expensive mistake this whole system can make,
 * because the film is already printed when the blanks arrive and the run is
 * scrap. So nothing here is typed by a human and nothing is approximated: a
 * line whose article cannot be resolved is REFUSED by name and blocks the
 * purchase, rather than being bought at the nearest size.
 *
 * ── THE DIFFERENCE WITH FILM: WE DO NOT KNOW HOW LONG IT TAKES ───────────────
 *
 * A lot knows the date its film must be ordered, because question 04's default
 * gives the film a transit time. Nothing gives the blanks one. The brief has no
 * textile lead time in any of its eight chapters (« peut livrer rapidement »,
 * said of one supplier with no figure, is the whole of it), the supplier
 * publishes none, and this shop has never placed a supplier order to measure. So
 * this file computes no blank-side deadline at all and says so on the screen.
 * Inventing one would put a date on a customer's parcel nobody has ever kept.
 *
 * What the supplier DOES publish is the restock date of what is out of stock,
 * and that is read and shown, because it is a fact.
 *
 * ── STOCK IS AN OBSERVATION, WITH A TIMESTAMP ────────────────────────────────
 *
 * Chapter 05: « Le stock affiché par une API n'est pas une garantie absolue. Le
 * système doit enregistrer la date de consultation, puis confirmer la commande
 * fournisseur. » Every quantity this file reads carries the moment the supplier
 * published it, and a reading older than `STOCK_TRUST_HOURS` stops supporting
 * any claim of availability, here or on a product page.
 *
 * ── SENDING IS ONE ACT, AND IT IS NEVER RETRIED ──────────────────────────────
 *
 * There is no way to ask this supplier whether an order already exists
 * (VERIFIED 2026-08-19). So `send()` writes SENDING before it calls, and a
 * process that dies in between leaves a record that says « envoi incertain »
 * and refuses to send again. A blind retry is a second delivery, paid twice,
 * and the shop cannot tell it happened until the boxes arrive.
 *
 * ── SECOND SOURCE ────────────────────────────────────────────────────────────
 *
 * Chapter 06: « Adaptateur par fournisseur. Le domaine métier ne doit pas
 * dépendre des noms de champs [de tel ou tel fournisseur]. » The cost engine
 * already asks what a blank costs rather than what one supplier charges. What
 * this file adds is the discriminator: every basket row carries the adapter its
 * article came from, rows are grouped by it, and only an adapter with a
 * transmission path may be sent. A second adapter's rows come out of the same
 * basket and are exported instead of transmitted, with nothing to change here.
 *
 * (The brief names its three candidate suppliers in that sentence. They are not
 * repeated here: `scripts/php-guard.mjs` keeps every supplier name out of this
 * plugin, and a quotation is as much a name as a variable is.)
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

require_once __DIR__ . '/Money.php';

final class Purchase {

	// ── the record ───────────────────────────────────────────────────────────

	/** Non-public post type holding one supplier order. */
	public const POST_TYPE = 'ts_achat';

	/** Post meta: the whole purchase record, JSON. */
	public const META_ORDER = '_teeshoop_achat';

	/** ORDER meta: the purchases this order's blanks were bought on, JSON list. */
	public const META_ORDER_PART = '_teeshoop_achat_part';

	/** Prepared, nothing has left. Anything may still change. */
	public const PREPARED = 'prepare';

	/** The document is in flight, or the process died holding it. See `send()`. */
	public const SENDING = 'envoi';

	/** The supplier accepted it and gave it a number. */
	public const SENT = 'envoye';

	/** The supplier refused it, and nothing exists on their side. */
	public const REFUSED = 'refuse';

	/**
	 * It left and no usable answer came back. It MAY have been created.
	 *
	 * This state exists so nobody has to choose between two wrong answers. A
	 * failure would invite a retry and buy the blanks twice; a success would
	 * leave the workshop waiting for a delivery that was never ordered.
	 */
	public const UNCERTAIN = 'incertain';

	/** The blanks arrived and were checked in against the document. */
	public const RECEIVED = 'recu';

	/** In the order they are lived, with the French an operator reads. */
	public static function states(): array {
		return array(
			self::PREPARED  => 'Préparée',
			self::SENDING   => 'Envoi en cours',
			self::SENT      => 'Commandée',
			self::REFUSED   => 'Refusée',
			self::UNCERTAIN => 'Envoi incertain',
			self::RECEIVED  => 'Reçue',
		);
	}

	/** A purchase in one of these has spent money and may not be sent again. */
	public static function spent( string $state ): bool {
		return in_array( $state, array( self::SENDING, self::SENT, self::UNCERTAIN, self::RECEIVED ), true );
	}

	/** The shop's named lock, for the read-modify-write that builds a purchase. */
	private const LOCK = 'teeshoop_achat';

	// ── the numbers that are assumed ─────────────────────────────────────────

	/**
	 * How old a stock reading may be and still support a claim of availability.
	 *
	 * Hours. Question 11 is unanswered, so this is ours: the supplier rebuilds
	 * the snapshot continuously (its timestamp moved between two runs one minute
	 * apart, MEASURED 2026-08-19), and chapter 04 asks for stock « plusieurs fois
	 * par jour si l'API le permet ». One day is the point past which a number we
	 * have not refreshed says nothing about a warehouse: a whole trading day of
	 * other people's orders has gone through it.
	 *
	 * Beyond it the shop stops saying « Disponible » and says « Délai à
	 * confirmer » instead, which is true whatever the warehouse holds.
	 */
	public const STOCK_TRUST_HOURS = 24;

	/**
	 * How often the sweep runs, hours.
	 *
	 * Six times a day, which is chapter 04's « plusieurs fois par jour », and it
	 * is affordable because the whole catalogue's stock is ONE upstream call
	 * (the Worker's supplier module, `loadStockAll`): MEASURED 46 591 rows in
	 * 674 ms. It is deliberately well inside `STOCK_TRUST_HOURS`, so a single
	 * missed run does not make the shop start lying.
	 */
	public const STOCK_REFRESH_HOURS = 4;

	// ── the adapter an article came from ─────────────────────────────────────

	/**
	 * Adapters whose articles this shop can TRANSMIT an order to.
	 *
	 * A code, never a name: `scripts/php-guard.mjs` keeps supplier identity out
	 * of this plugin entirely, and `Catalogue::public_ref()` records what it
	 * costs when it leaks. The code names the adapter that fetched the article,
	 * which is what decides whether an order can be sent at all; who is at the
	 * end of it is the Worker's business and nobody else's.
	 */
	public const TRANSMITTABLE = array( Supply::SOURCE );

	// ── the basket ───────────────────────────────────────────────────────────

	/**
	 * One purchase basket for a set of orders.
	 *
	 * @param int[]  $order_ids
	 * @param string $today ISO date; defaults to the shop's own today.
	 *
	 * @return array{
	 *   ok:bool, complete:bool, orders:array, rows:array, unresolved:array,
	 *   garments:int, blanks_ht:int, freight_ht:int, total_ht:int,
	 *   sources:array, stock:array, reason:string
	 * }
	 */
	public static function basket( array $order_ids, string $today = '' ): array {
		$today = '' !== $today ? $today : Settings::today();
		$ids   = array_values( array_unique( array_map( 'intval', $order_ids ) ) );
		sort( $ids );

		if ( array() === $ids ) {
			return self::empty_basket( 'Aucune commande n’a été choisie.' );
		}

		$claims  = array();
		$refused = array();
		$orders  = array();

		foreach ( $ids as $id ) {
			$order = wc_get_order( $id );
			if ( ! $order instanceof \WC_Order ) {
				return self::empty_basket( sprintf( 'La commande %d est introuvable.', $id ) );
			}
			$orders[ $id ] = array(
				'id'       => $id,
				'ref'      => (string) $order->get_order_number(),
				'customer' => trim( $order->get_billing_company() ?: ( $order->get_billing_first_name() . ' ' . $order->get_billing_last_name() ) ),
				'garments' => 0,
			);
			foreach ( $order->get_items() as $item ) {
				if ( ! $item instanceof \WC_Order_Item_Product ) {
					continue;
				}
				$read = self::articles_for( $order, $item );
				$orders[ $id ]['garments'] += (int) $read['garments'];
				foreach ( $read['claims'] as $claim ) {
					$claims[] = $claim;
				}
				foreach ( $read['refused'] as $one ) {
					$refused[] = $one;
				}
			}
		}

		$basket           = self::aggregate( $claims, $refused, Costing::config() );
		$basket['orders'] = self::per_order( $orders, $basket );
		$basket['stock']  = self::stock_verdict( $basket['rows'], $today );
		$basket['reason'] = '';
		return $basket;
	}

	/** The shape every failure and every empty answer has to have. */
	private static function empty_basket( string $reason ): array {
		return array(
			'ok'         => false,
			'complete'   => false,
			'orders'     => array(),
			'rows'       => array(),
			'unresolved' => array(),
			'garments'   => 0,
			'blanks_ht'  => 0,
			'freight_ht' => 0,
			'total_ht'   => 0,
			'sources'    => array(),
			'stock'      => array(
				'trusted' => false,
				'at'      => '',
				'short'   => array(),
			),
			'reason'     => $reason,
		);
	}

	/**
	 * One order line, read into claims on articles.
	 *
	 * TWO WAYS A LINE CAN NAME AN ARTICLE, and only one of them exists on this
	 * shop today:
	 *
	 *   1. the ordered product IS a catalogue variation, so it carries the
	 *      article number the importer wrote. Nothing to resolve.
	 *   2. the ordered product is a studio garment, and the blank it is printed
	 *      on is declared on the product (`Product::META_BLANK_REF`) with a
	 *      colour map. The article is then LOOKED UP among the variations the
	 *      importer wrote, by colour term and size name.
	 *
	 * Anything else is refused, by name, with the sentence an operator needs to
	 * fix it. There is no third way, and in particular no arithmetic on the
	 * supplier's article numbering: it is `styleNr . colourCode . one digit` with
	 * the same size-to-digit map in every colour, so a reference and a size could
	 * be turned into an article number by concatenation. That number would be a
	 * guess, and it would be a guess about what the workshop presses.
	 *
	 * PUBLIC, because `Costing::blanks()` needs the same answer. Until session 08
	 * the cost engine could only cost a blank whose WooCommerce product WAS the
	 * catalogue article, so every studio order came back « aucun prix d'achat
	 * connu » and its floor price was a minimum. The declaration on the product
	 * is what closes that, and there is exactly one function that reads it.
	 *
	 * @return array{garments:int,claims:array,refused:array}
	 */
	public static function articles_for( \WC_Order $order, \WC_Order_Item_Product $item ): array {
		$qty      = max( 1, (int) $item->get_quantity() );
		$claims   = array();
		$refused  = array();
		$order_id = $order->get_id();

		$reject = static function ( string $why, string $size = '' ) use ( $order, $item, $qty ) {
			return array(
				'order_id'  => $order->get_id(),
				'order_ref' => (string) $order->get_order_number(),
				'item_id'   => $item->get_id(),
				'label'     => (string) $item->get_name(),
				'garment'   => (string) $item->get_meta( '_teeshoop_garment', true ),
				'colour'    => (string) $item->get_meta( '_teeshoop_couleur', true ),
				'size'      => $size,
				'qty'       => $qty,
				'why'       => $why,
			);
		};

		$product = $item->get_product();
		if ( ! $product instanceof \WC_Product ) {
			return array(
				'garments' => $qty,
				'claims'   => array(),
				'refused'  => array( $reject( 'Le produit de cette ligne n’existe plus dans la boutique.' ) ),
			);
		}

		// 1. The line already IS a catalogue article.
		$own = (string) $product->get_meta( Catalogue::META_SUPPLY_SKU, true );
		if ( '' !== $own ) {
			$claims[] = self::claim( $order, $item, $product, $own, '', $qty );
			return array(
				'garments' => $qty,
				'claims'   => $claims,
				'refused'  => array(),
			);
		}

		// 2. A studio garment, with its blank declared on the product.
		$grid = json_decode( (string) $item->get_meta( '_teeshoop_size_grid', true ), true );
		$grid = is_array( $grid ) ? array_filter( array_map( 'intval', $grid ), static fn( $n ) => $n > 0 ) : array();
		if ( array() === $grid ) {
			/*
			 * A LINE WITH NO SIZE GRID CANNOT BE BOUGHT, and that is a fact about
			 * the order rather than a limitation here: nobody knows which sizes
			 * to order. It is refused with its quantity so the workshop can see
			 * how many garments are waiting on a phone call.
			 */
			return array(
				'garments' => $qty,
				'claims'   => array(),
				'refused'  => array( $reject( 'Cette ligne ne porte aucune grille de tailles : impossible de savoir quelles tailles acheter.' ) ),
			);
		}

		$ref = Product::blank_ref_of( $item->get_product_id() );
		if ( '' === $ref ) {
			return array(
				'garments' => $qty,
				'claims'   => array(),
				'refused'  => array( $reject( 'Aucun textile nu n’est déclaré sur ce produit : renseignez la référence du catalogue sur sa fiche.' ) ),
			);
		}

		$blank_id = self::blank_product_id( $ref );
		if ( 0 === $blank_id ) {
			return array(
				'garments' => $qty,
				'claims'   => array(),
				'refused'  => array( $reject( sprintf( 'La référence %s déclarée sur ce produit n’est pas dans le catalogue importé.', $ref ) ) ),
			);
		}

		$studio_colour = (string) $item->get_meta( '_teeshoop_couleur', true );
		$map           = Product::blank_colours_of( $item->get_product_id() );
		$term          = (string) ( $map[ $studio_colour ] ?? '' );
		if ( '' === $term ) {
			return array(
				'garments' => $qty,
				'claims'   => array(),
				'refused'  => array( $reject( sprintf( 'Le coloris « %s » n’est associé à aucun coloris du fournisseur sur ce produit.', self::colour_name( $studio_colour ) ) ) ),
			);
		}

		$garments = 0;
		foreach ( $grid as $size => $count ) {
			$garments      += (int) $count;
			$variation_id   = self::variation_of( $blank_id, $term, (string) $size );
			if ( 0 === $variation_id ) {
				$refused[] = $reject(
					sprintf( 'Le fournisseur ne vend pas la taille %s en %s pour la référence %s.', $size, $term, $ref ),
					(string) $size
				);
				continue;
			}
			$variation = wc_get_product( $variation_id );
			$sku       = $variation instanceof \WC_Product ? (string) $variation->get_meta( Catalogue::META_SUPPLY_SKU, true ) : '';
			if ( '' === $sku ) {
				$refused[] = $reject(
					sprintf( 'L’article %s en %s n’a pas de référence fournisseur enregistrée.', $size, $term ),
					(string) $size
				);
				continue;
			}
			$claims[] = self::claim( $order, $item, $variation, $sku, (string) $size, (int) $count );
		}

		return array(
			'garments' => $garments,
			'claims'   => $claims,
			'refused'  => $refused,
		);
	}

	/**
	 * One claim on one article: everything `aggregate()` needs and nothing else.
	 *
	 * The unit cost comes from the variation the importer wrote, which is the
	 * price the supplier published for that exact article, with the date it was
	 * read. A cost of zero is a MISSING figure and not a free garment: the CSV
	 * writes 0 when it has nothing, and `Catalogue::variations()` already refuses
	 * to publish a price on it.
	 */
	private static function claim(
		\WC_Order $order,
		\WC_Order_Item_Product $item,
		\WC_Product $article,
		string $sku,
		string $size,
		int $qty
	): array {
		$cents = $article->get_meta( Catalogue::META_SUPPLY_CENTS, true );
		$stock = $article->get_stock_quantity();
		return array(
			'order_id'   => $order->get_id(),
			'order_ref'  => (string) $order->get_order_number(),
			'item_id'    => $item->get_id(),
			'sku'        => $sku,
			'source'     => self::source_of( $article ),
			'label'      => (string) $article->get_name(),
			'colour'     => self::attribute_of( $article, 'couleur' ),
			'size'       => '' !== $size ? $size : self::attribute_of( $article, 'taille' ),
			'qty'        => $qty,
			'unit_ht'    => is_numeric( $cents ) && (int) $cents > 0 ? (int) $cents : null,
			'stock'      => null === $stock ? null : (int) $stock,
			'stock_at'   => (string) $article->get_meta( Catalogue::META_STOCK_AT, true ),
		);
	}

	/**
	 * Claims folded into one row per article, with the arithmetic that has to
	 * hold.
	 *
	 * PURE, and separated from `basket()` for exactly that: this is where the
	 * quantities and the money are decided, and it can be tested against
	 * hand-written claims without a WordPress, a WooCommerce or a supplier.
	 *
	 * THREE INVARIANTS, asserted rather than assumed:
	 *   - a row's quantity is the sum of the claims that made it (`from`);
	 *   - the basket's quantity is the sum of its rows plus what it refused;
	 *   - the money is `sum(unit x qty)`, computed in integer cents, once.
	 *
	 * A row whose unit cost is unknown does NOT contribute a zero: the basket is
	 * marked incomplete and refuses to be sent, because a total that silently
	 * omits an article is a total somebody will compare with an invoice.
	 *
	 * @param array $claims  Rows from `claim()`.
	 * @param array $refused Rows from `articles_for()`'s rejections.
	 * @param array $config  The cost configuration, passed rather than fetched:
	 *                       it is the only thing here that would need a
	 *                       WordPress, and a rule about money that cannot be
	 *                       tested without one does not get tested.
	 */
	public static function aggregate( array $claims, array $refused, array $config ): array {
		$rows    = array();
		$sources = array();

		foreach ( $claims as $c ) {
			$sku = (string) $c['sku'];
			if ( ! isset( $rows[ $sku ] ) ) {
				$rows[ $sku ] = array(
					'sku'      => $sku,
					'source'   => (string) $c['source'],
					'label'    => (string) $c['label'],
					'colour'   => (string) $c['colour'],
					'size'     => (string) $c['size'],
					'qty'      => 0,
					'unit_ht'  => $c['unit_ht'],
					'stock'    => $c['stock'],
					'stock_at' => (string) $c['stock_at'],
					'from'     => array(),
				);
			}
			$rows[ $sku ]['qty'] += (int) $c['qty'];
			$rows[ $sku ]['from'][] = array(
				'order_id'  => (int) $c['order_id'],
				'order_ref' => (string) $c['order_ref'],
				'item_id'   => (int) $c['item_id'],
				'size'      => (string) $c['size'],
				'qty'       => (int) $c['qty'],
			);
			$sources[ (string) $c['source'] ] = true;
		}

		$blanks   = 0;
		$garments = 0;
		$unknown  = 0;
		foreach ( $rows as $sku => $row ) {
			$garments += (int) $row['qty'];
			if ( null === $row['unit_ht'] ) {
				++$unknown;
				$rows[ $sku ]['amount_ht'] = null;
				continue;
			}
			$amount                    = (int) $row['unit_ht'] * (int) $row['qty'];
			$rows[ $sku ]['amount_ht'] = $amount;
			$blanks                   += $amount;
		}

		/*
		 * SORTED BY ARTICLE, so two runs of the same basket produce the same
		 * document. The supplier stores our reference and a human compares two
		 * printouts; a row order that moved with the iteration of a hash map
		 * would make identical baskets look different.
		 */
		ksort( $rows );
		$rows = array_values( $rows );

		foreach ( $rows as $i => $row ) {
			$sum = 0;
			foreach ( $row['from'] as $one ) {
				$sum += (int) $one['qty'];
			}
			// Not defensive: this is the traceability requirement, checked where
			// it is produced rather than trusted where it is read.
			if ( $sum !== (int) $row['qty'] ) {
				$broken = self::empty_basket( sprintf( 'Incohérence interne sur l’article %s : %d pièces réparties pour %d commandées.', $row['sku'], $sum, $row['qty'] ) );
				unset( $broken['stock'] );
				$broken['unresolved'] = array_values( $refused );
				return $broken;
			}
			unset( $i );
		}

		$freight  = Cost::freight( $blanks, $config );
		$complete = array() === $refused && 0 === $unknown && array() !== $rows;

		$refused_qty = 0;
		foreach ( $refused as $one ) {
			$refused_qty += (int) $one['qty'];
		}

		return array(
			'ok'          => array() !== $rows,
			'complete'    => $complete,
			'orders'      => array(),
			'rows'        => $rows,
			'unresolved'  => array_values( $refused ),
			'garments'    => $garments,
			'refused_qty' => $refused_qty,
			'blanks_ht'   => $blanks,
			'freight_ht'  => $freight,
			'total_ht'    => $blanks + $freight,
			'sources'     => array_keys( $sources ),
			/*
			 * NO `stock` KEY, AND ITS ABSENCE IS THE POINT.
			 *
			 * This function is arithmetic on claims; the verdict on the supplier's
			 * shelf is `stock_verdict()`, which `basket()` calls beside it. An
			 * empty placeholder here read as « rien ne manque » to any caller that
			 * did not know the difference, and one did: `scripts/purchase-bench.mjs`
			 * printed « tout est en stock » over a table showing zero L and zero XL
			 * against sixteen and four ordered. A missing key is an error; a
			 * reassuring default is a lie with a tick beside it.
			 */
			'reason'      => '',
		);
	}

	/**
	 * Each order's share of the basket, and the two deltas that matter.
	 *
	 * ── THE FREIGHT IS SPLIT, NOT REPEATED ───────────────────────────────────
	 *
	 * `Costing::compute()` charges every order its own inbound freight, because
	 * until this file every order was its own supplier order. Buying six orders'
	 * blanks together means ONE charge, and the same largest-remainder allocator
	 * the film uses splits it, weighted by what each order's blanks cost. That is
	 * the analogue of `Cost::attribute()` and it is deliberately the same
	 * function: two allocators would disagree on a cent, and the day a supplier
	 * invoice is reconciled against the sum of the orders, that cent is a bug
	 * report.
	 *
	 * ── AND THE DELTA AGAINST WHAT THE MARGIN ENGINE ASSUMED ─────────────────
	 *
	 * Chapter 01 asks for « coût estimé contre coût réel » and makes a
	 * commission recoverable when « la marge réelle est inférieure à la marge
	 * estimée ». The report frozen on the order says what its blanks were
	 * assumed to cost; this basket says what they cost at the moment they are
	 * bought. A supplier who raises a t-shirt by 8 cents moves nothing anybody
	 * would notice, and moves every floor price in the shop.
	 *
	 * The third number, what the supplier actually INVOICED, is not here and
	 * cannot be: this webservice publishes no invoice. What would close it is
	 * the supplier's document, entered or fetched at reception.
	 */
	private static function per_order( array $orders, array $basket ): array {
		$blanks = array();
		foreach ( array_keys( $orders ) as $id ) {
			$blanks[ (string) $id ] = 0;
		}
		foreach ( $basket['rows'] as $row ) {
			if ( null === $row['unit_ht'] ) {
				continue;
			}
			foreach ( $row['from'] as $one ) {
				$key             = (string) $one['order_id'];
				$blanks[ $key ]  = ( $blanks[ $key ] ?? 0 ) + (int) $row['unit_ht'] * (int) $one['qty'];
			}
		}

		$config = Costing::config();
		$share  = Cost::allocate( (int) $basket['freight_ht'], $blanks );

		$out = array();
		foreach ( $orders as $id => $row ) {
			$key      = (string) $id;
			$order    = wc_get_order( $id );
			$assumed  = $order instanceof \WC_Order ? self::assumed( $order ) : array( 'blanks_ht' => null, 'freight_ht' => null );
			$mine     = (int) ( $blanks[ $key ] ?? 0 );
			$solo     = Cost::freight( $mine, $config );
			$freight  = (int) ( $share[ $key ] ?? 0 );

			$out[] = array(
				'id'               => (int) $id,
				'ref'              => (string) $row['ref'],
				'customer'         => (string) $row['customer'],
				'garments'         => (int) $row['garments'],
				'blanks_ht'        => $mine,
				'freight_ht'       => $freight,
				'solo_freight_ht'  => $solo,
				'freight_saved_ht' => $solo - $freight,
				'assumed_ht'       => $assumed['blanks_ht'],
				/*
				 * NULL AND ZERO ARE DIFFERENT ANSWERS. An order whose report has
				 * never been computed has no assumption to compare against, and
				 * printing a delta equal to the whole basket would read as a
				 * supplier who doubled his prices.
				 */
				'delta_ht'         => null === $assumed['blanks_ht'] ? null : $mine - (int) $assumed['blanks_ht'],
				'assumed_freight_ht' => $assumed['freight_ht'],
			);
		}
		return $out;
	}

	/**
	 * What the frozen margin report assumed this order's blanks and inbound
	 * freight would cost, or null when it has never been computed.
	 *
	 * Read from the report stored on the order, never recomputed: the point of
	 * the comparison is what we BELIEVED when we quoted, and recomputing it here
	 * would compare today's belief with today's price and always agree.
	 *
	 * @return array{blanks_ht:?int,freight_ht:?int}
	 */
	public static function assumed( \WC_Order $order ): array {
		$raw = json_decode( (string) $order->get_meta( Costing::META_REPORT, true ), true );
		/*
		 * `cost.lines`, and the path is worth stating because the obvious one is
		 * wrong. `Costing::compute()` returns the components already totalled by
		 * `Cost::total()`, under `cost`, and nothing sits at `components` on the
		 * report itself. Reading the wrong path produced a null assumption on
		 * every order, which on screen is « jamais chiffrée » beside a report
		 * that plainly exists: the integration suite is what found it.
		 */
		$lines = is_array( $raw ) && is_array( $raw['cost']['lines'] ?? null ) ? $raw['cost']['lines'] : null;
		if ( null === $lines ) {
			return array(
				'blanks_ht'  => null,
				'freight_ht' => null,
			);
		}
		$blanks  = null;
		$freight = null;
		foreach ( $lines as $component ) {
			if ( ! is_array( $component ) ) {
				continue;
			}
			$type = (string) ( $component['type'] ?? '' );
			/*
			 * AN UNKNOWN COMPONENT CARRIES NO AMOUNT (see `Cost::component`), so
			 * counting it as zero would turn « nous ne savons pas » into « c'était
			 * gratuit » and produce a delta equal to the whole basket.
			 */
			if ( Cost::UNKNOWN === (string) ( $component['confidence'] ?? '' ) ) {
				continue;
			}
			if ( 'textile' === $type ) {
				$blanks = (int) $blanks + (int) ( $component['amount_ht'] ?? 0 );
			} elseif ( 'transport_in' === $type ) {
				$freight = (int) $freight + (int) ( $component['amount_ht'] ?? 0 );
			}
		}
		return array(
			'blanks_ht'  => $blanks,
			'freight_ht' => $freight,
		);
	}

	// ── stock ────────────────────────────────────────────────────────────────

	/**
	 * Whether this basket may be believed, and what is short.
	 *
	 * THREE ANSWERS AND NOT TWO. « Il y en a », « il n'y en a pas assez » and
	 * « ce que nous savons est trop vieux pour le dire » are different facts, and
	 * the third is the one a shop gets wrong: a badge that says « Disponible »
	 * from a reading taken yesterday is not optimistic, it is false.
	 *
	 * @param array  $rows  Basket rows.
	 * @param string $today ISO date, the shop's own.
	 */
	public static function stock_verdict( array $rows, string $today ): array {
		$oldest  = '';
		$short   = array();
		$trusted = array() !== $rows;

		foreach ( $rows as $row ) {
			$at = (string) ( $row['stock_at'] ?? '' );
			if ( '' === $at || null === $row['stock'] ) {
				$trusted = false;
				continue;
			}
			if ( '' === $oldest || $at < $oldest ) {
				$oldest = $at;
			}
			if ( ! self::fresh( $at, $today ) ) {
				$trusted = false;
			}
			if ( (int) $row['stock'] < (int) $row['qty'] ) {
				$short[] = array(
					'sku'    => (string) $row['sku'],
					'colour' => (string) $row['colour'],
					'size'   => (string) $row['size'],
					'want'   => (int) $row['qty'],
					'have'   => (int) $row['stock'],
				);
			}
		}

		return array(
			'trusted' => $trusted,
			'at'      => $oldest,
			'short'   => $short,
		);
	}

	/**
	 * Is a supplier stock timestamp young enough to support a claim?
	 *
	 * ── THE TIMESTAMP IS NOT UTC, AND ASSUMING IT WAS COST AN HOUR ───────────
	 *
	 * MEASURED 2026-08-19: one Worker response carried its own `request_date_time`
	 * of `14:49:09`, stamped in UTC by `worker/…`'s `stamp()`, beside a supplier
	 * `export_data_date` of `16:49:10` for the same instant. The supplier writes
	 * his own wall clock, which is central European time, the same as the shop's.
	 * WordPress sets PHP's default timezone to UTC, so `strtotime()` on that
	 * string reads it two hours into the past in summer and one in winter. Under
	 * a 24-hour window that never quite breaks anything, which is exactly why it
	 * would have stayed: it just makes every reading look older than it is, and
	 * one day the window is four hours and it starts refusing fresh stock.
	 *
	 * So the string is parsed in the SHOP's timezone, explicitly.
	 *
	 * @param string $at  Supplier timestamp, `Y-m-d H:i:s`.
	 * @param string $now '' for the real clock, a date for the end of that day,
	 *                    or a full timestamp. The tests need a fixed instant, and
	 *                    a test that cannot fix the clock is a test that fails at
	 *                    midnight.
	 */
	public static function fresh( string $at, string $now = '' ): bool {
		$read = self::moment( $at );
		if ( null === $read ) {
			return false;
		}
		$then = '' === trim( $now )
			? time()
			: ( 1 === preg_match( '/^\d{4}-\d{2}-\d{2}$/', trim( $now ) )
				? self::moment( trim( $now ) . ' 23:59:59' )
				: self::moment( $now ) );
		if ( null === $then ) {
			return false;
		}
		/*
		 * A READING FROM THE FUTURE IS NOT A FRESH READING. Two clocks are
		 * involved and one of them is not ours; a supplier timestamp ahead of us
		 * means one of the two is wrong, and « we cannot tell » is the only
		 * answer that is true either way. An hour of slack, because the two
		 * clocks are also on two sides of a daylight-saving boundary twice a year.
		 */
		if ( $read > $then + 3600 ) {
			return false;
		}
		return ( $then - $read ) <= self::STOCK_TRUST_HOURS * 3600;
	}

	/**
	 * `Y-m-d H:i:s` in the shop's own timezone, as a unix timestamp, or null.
	 *
	 * `wp_timezone()` under WordPress, PHP's own outside it. Strict parsing:
	 * `DateTimeImmutable::createFromFormat` accepts a great deal that is not a
	 * date, and a string this could not read must come back as « we do not know »
	 * rather than as the epoch, which is a reading forty years old and would read
	 * on every screen as « trop ancien » instead of « illisible ».
	 */
	private static function moment( string $value ): ?int {
		$value = trim( $value );
		if ( '' === $value ) {
			return null;
		}
		$zone = function_exists( 'wp_timezone' ) ? wp_timezone() : new \DateTimeZone( date_default_timezone_get() );
		$when = \DateTimeImmutable::createFromFormat( 'Y-m-d H:i:s', $value, $zone );
		if ( false === $when || array() !== array_filter( (array) \DateTimeImmutable::getLastErrors() ) ) {
			return null;
		}
		return $when->getTimestamp();
	}

	// ── resolving an article ─────────────────────────────────────────────────

	/** The imported catalogue product carrying this reference, or 0. */
	public static function blank_product_id( string $ref ): int {
		$ref = trim( $ref );
		if ( '' === $ref ) {
			return 0;
		}
		$found = get_posts(
			array(
				'post_type'      => 'product',
				'post_status'    => 'any',
				'numberposts'    => 2,
				'fields'         => 'ids',
				'meta_key'       => Catalogue::META_REF, // phpcs:ignore WordPress.DB.SlowMetaQuery.SlowMetaQuery -- the importer indexes on this key and there is no other way to reach a reference.
				'meta_value'     => $ref, // phpcs:ignore WordPress.DB.SlowMetaQuery.SlowMetaQuery
			)
		);
		/*
		 * TWO MATCHES IS NOT ONE. The importer keys on this reference and cannot
		 * produce a duplicate, so two means the shop has been edited by hand or
		 * a product was cloned. Picking the first would attach the workshop's
		 * purchases to whichever WordPress returned today.
		 */
		return 1 === count( $found ) ? (int) $found[0] : 0;
	}

	/**
	 * The variation of `$blank_id` in this colour term and this size name, or 0.
	 *
	 * Uses WooCommerce's own matcher, which is what add-to-cart uses, rather than
	 * walking the children: a style runs to 366 variations and a purchase screen
	 * that loaded them all would read the whole catalogue to buy twelve t-shirts.
	 *
	 * MATCHED ON THE NAME, EXACTLY. Term slugs are computed from names and
	 * several supplier colour names sanitise to the same slug, which is why
	 * `Taxonomy::terms()` matches on the name too. No normalisation, no
	 * case-folding, no nearest match: a size that is not sold is refused.
	 */
	public static function variation_of( int $blank_id, string $colour_term, string $size_name ): int {
		$parent = wc_get_product( $blank_id );
		if ( ! $parent instanceof \WC_Product_Variable ) {
			return 0;
		}
		$colour = get_term_by( 'name', $colour_term, Taxonomy::taxonomy( 'couleur' ) );
		$size   = get_term_by( 'name', $size_name, Taxonomy::taxonomy( 'taille' ) );
		if ( ! $colour instanceof \WP_Term || ! $size instanceof \WP_Term ) {
			return 0;
		}
		$store = \WC_Data_Store::load( 'product' );
		$match = $store->find_matching_product_variation(
			$parent,
			array(
				'attribute_' . Taxonomy::taxonomy( 'couleur' ) => $colour->slug,
				'attribute_' . Taxonomy::taxonomy( 'taille' )  => $size->slug,
			)
		);
		return (int) $match;
	}

	/**
	 * Every colour term name a blank product actually has, in shop order.
	 *
	 * Read from the PARENT's attribute rather than from its variations: the
	 * attribute is one row, the variations are up to 366 objects, and the product
	 * edit screen renders this on every load.
	 *
	 * @return string[]
	 */
	public static function blank_colour_terms( int $blank_id ): array {
		$terms = wp_get_post_terms( $blank_id, Taxonomy::taxonomy( 'couleur' ), array( 'fields' => 'names' ) );
		if ( is_wp_error( $terms ) || ! is_array( $terms ) ) {
			return array();
		}
		$terms = array_values( array_filter( array_map( 'strval', $terms ), static fn( $t ) => '' !== trim( $t ) ) );
		sort( $terms );
		return $terms;
	}

	/** A variation's chosen term NAME for one of our attributes, or ''. */
	private static function attribute_of( \WC_Product $article, string $slug ): string {
		$value = $article->get_attribute( Taxonomy::taxonomy( $slug ) );
		return is_string( $value ) ? trim( $value ) : '';
	}

	/**
	 * Which adapter wrote this article.
	 *
	 * An article imported before the field existed carries nothing, and reads as
	 * the one adapter that has ever run. That is a fact and not a fallback: every
	 * article in this shop was written by it, and a second adapter cannot produce
	 * an empty value because it writes its own code as it writes the article.
	 */
	private static function source_of( \WC_Product $article ): string {
		$code = (string) $article->get_meta( Catalogue::META_SUPPLY_SOURCE, true );
		return '' !== $code ? $code : Supply::SOURCE;
	}

	// ── the record, and the one act that spends money ────────────────────────

	public static function init(): void {
		add_action( 'init', array( self::class, 'register' ) );
	}

	/**
	 * The post type holding a purchase.
	 *
	 * Not public, not queryable, no archive: it is a filing cabinet, and the one
	 * screen that reads it asks for `manage_woocommerce`. A supplier order names
	 * our article numbers and our purchase prices, which `Shelf.php` seals out of
	 * every other surface for the same reason.
	 */
	public static function register(): void {
		register_post_type(
			self::POST_TYPE,
			array(
				'label'           => __( 'Achats Teeshoop', 'teeshoop' ),
				'public'          => false,
				'show_ui'         => false,
				'show_in_rest'    => false,
				'publicly_queryable' => false,
				'exclude_from_search' => true,
				'supports'        => array( 'title' ),
				'capability_type' => 'shop_order',
				'map_meta_cap'    => true,
			)
		);
	}

	/** One purchase record by id, or null. */
	public static function get( int $id ): ?array {
		$post = get_post( $id );
		if ( ! $post || self::POST_TYPE !== $post->post_type ) {
			return null;
		}
		$raw = json_decode( (string) get_post_meta( $id, self::META_ORDER, true ), true );
		return is_array( $raw ) ? $raw : null;
	}

	/** The most recent purchases, newest first. */
	public static function recent( int $limit = 20 ): array {
		$ids = get_posts(
			array(
				'post_type'   => self::POST_TYPE,
				'post_status' => 'any',
				'numberposts' => $limit,
				'orderby'     => 'ID',
				'order'       => 'DESC',
				'fields'      => 'ids',
			)
		);
		$out = array();
		foreach ( $ids as $id ) {
			$one = self::get( (int) $id );
			if ( null !== $one ) {
				$out[] = $one;
			}
		}
		return $out;
	}

	/**
	 * The part of an order's purchase that decides its cost, for `Costing::stamp()`.
	 *
	 * Three fields: which purchase, whether it has left, and for how much. The
	 * rest of the record moves for reasons that change no number, and a report
	 * that goes stale when the workshop ticks « reçue » teaches an operator to
	 * ignore the word.
	 */
	public static function cost_stamp( \WC_Order $order ): string {
		$part = self::part_of( $order );
		if ( null === $part ) {
			return '';
		}
		return implode(
			'|',
			array(
				(string) ( $part['purchase_id'] ?? '' ),
				self::PREPARED === ( $part['state'] ?? '' ) ? 'prepare' : 'achete',
				(string) (int) ( $part['freight_ht'] ?? 0 ),
			)
		);
	}

	/** The purchase this order's blanks are on, or null. */
	public static function part_of( \WC_Order $order ): ?array {
		$raw = json_decode( (string) $order->get_meta( self::META_ORDER_PART, true ), true );
		return is_array( $raw ) && isset( $raw['purchase_id'] ) ? $raw : null;
	}

	/**
	 * Freeze a basket into a purchase nobody has sent yet.
	 *
	 * IT REFUSES AN INCOMPLETE BASKET. A purchase with one line the shop could
	 * not resolve is a delivery that arrives short, on a run whose film is
	 * already bought; the missing line has to be fixed on the product, not
	 * ordered around.
	 *
	 * IT REFUSES AN ORDER THAT IS ALREADY ON ONE. Buying the same blanks twice
	 * costs exactly as much as buying them once and produces a delivery nobody
	 * expected.
	 *
	 * @param int[] $order_ids
	 * @return array{ok:bool,reason:string,id?:int,purchase?:array}
	 */
	public static function prepare( array $order_ids, string $today = '' ): array {
		$today  = '' !== $today ? $today : Settings::today();
		$basket = self::basket( $order_ids, $today );

		$fail = static fn( string $why ): array => array(
			'ok'     => false,
			'reason' => $why,
		);

		if ( ! $basket['ok'] ) {
			return $fail( '' !== $basket['reason'] ? $basket['reason'] : 'Ce panier ne contient aucun article.' );
		}
		if ( ! $basket['complete'] ) {
			return $fail( 'Ce panier a des lignes non résolues : rien n’est préparé tant qu’un article n’est pas identifié.' );
		}

		$sources = array_values( array_diff( $basket['sources'], self::TRANSMITTABLE ) );
		if ( array() !== $sources ) {
			return $fail( 'Ce panier mélange des articles venus de plusieurs sources : préparez une commande par source.' );
		}

		if ( ! Invoice::lock( self::LOCK ) ) {
			return $fail( 'Une autre commande fournisseur est en cours de préparation. Réessayez dans un instant.' );
		}

		foreach ( $basket['orders'] as $row ) {
			$order = wc_get_order( (int) $row['id'] );
			if ( ! $order instanceof \WC_Order ) {
				Invoice::unlock( self::LOCK );
				return $fail( sprintf( 'La commande %d est introuvable.', (int) $row['id'] ) );
			}
			$part = self::part_of( $order );
			if ( null !== $part ) {
				Invoice::unlock( self::LOCK );
				return $fail( sprintf( 'Les textiles de la commande %s sont déjà sur la commande fournisseur n° %d.', $row['ref'], (int) $part['purchase_id'] ) );
			}
		}

		$id = wp_insert_post(
			array(
				'post_type'   => self::POST_TYPE,
				'post_status' => 'publish',
				'post_title'  => sprintf( 'Achat textile %s', $today ),
			),
			true
		);
		if ( is_wp_error( $id ) || 0 === (int) $id ) {
			Invoice::unlock( self::LOCK );
			return $fail( 'La commande fournisseur n’a pas pu être enregistrée.' );
		}

		$record = array(
			'version'     => 1,
			'purchase_id' => (int) $id,
			'state'       => self::PREPARED,
			'created_on'  => $today,
			'created_by'  => get_current_user_id(),
			'key'         => self::key( (int) $id ),
			'source'      => (string) ( $basket['sources'][0] ?? Supply::SOURCE ),
			'rows'        => $basket['rows'],
			'orders'      => $basket['orders'],
			'garments'    => (int) $basket['garments'],
			'blanks_ht'   => (int) $basket['blanks_ht'],
			'freight_ht'  => (int) $basket['freight_ht'],
			'total_ht'    => (int) $basket['total_ht'],
			'stock'       => $basket['stock'],
			'sent_on'     => '',
			'sent_by'     => 0,
			'answer'      => null,
		);

		/*
		 * THE RECORD IS THE PURCHASE. A post with no record is worse than no
		 * post: the orders below would be pinned to an id that reads back as
		 * nothing, and they could never be put on another purchase.
		 */
		$encoded = wp_json_encode( $record );
		if ( false === $encoded || false === update_post_meta( (int) $id, self::META_ORDER, $encoded ) ) {
			wp_delete_post( (int) $id, true );
			Invoice::unlock( self::LOCK );
			return $fail( 'La commande fournisseur n’a pas pu être enregistrée : aucune commande n’y a été rattachée.' );
		}

		foreach ( $record['orders'] as $row ) {
			$order = wc_get_order( (int) $row['id'] );
			if ( ! $order instanceof \WC_Order ) {
				continue;
			}
			$order->update_meta_data(
				self::META_ORDER_PART,
				wp_json_encode(
					array(
						'purchase_id'      => (int) $id,
						'state'            => self::PREPARED,
						'blanks_ht'        => (int) $row['blanks_ht'],
						'freight_ht'       => (int) $row['freight_ht'],
						'solo_freight_ht'  => (int) $row['solo_freight_ht'],
						'freight_saved_ht' => (int) $row['freight_saved_ht'],
						'orders'           => count( $record['orders'] ),
					)
				)
			);
			$order->save();
		}

		Invoice::unlock( self::LOCK );

		return array(
			'ok'       => true,
			'reason'   => '',
			'id'       => (int) $id,
			'purchase' => $record,
		);
	}

	/**
	 * Our key for one purchase, and the supplier's own reference for it.
	 *
	 * `TS-A{id}-{8 hex}`, inside the 32 characters the supplier allows. The id
	 * makes it findable from either side; the random tail makes it unguessable,
	 * so a repeated document cannot be forged from a purchase number.
	 *
	 * GENERATED ONCE, AT PREPARATION. A key minted at send time would be a new
	 * key for every attempt, which is the opposite of what an idempotency key is
	 * for.
	 */
	private static function key( int $id ): string {
		return sprintf( 'TS-A%d-%s', $id, strtoupper( bin2hex( random_bytes( 4 ) ) ) );
	}

	/**
	 * Undo a preparation. Only while nothing has left.
	 *
	 * @return array{ok:bool,reason:string}
	 */
	public static function discard( int $id ): array {
		$record = self::get( $id );
		if ( null === $record ) {
			return array(
				'ok'     => false,
				'reason' => 'Cette commande fournisseur n’existe pas.',
			);
		}
		if ( self::PREPARED !== $record['state'] ) {
			return array(
				'ok'     => false,
				'reason' => 'Cette commande fournisseur est partie ou a pu partir : elle ne peut plus être annulée ici.',
			);
		}
		foreach ( $record['orders'] as $row ) {
			$order = wc_get_order( (int) $row['id'] );
			if ( $order instanceof \WC_Order ) {
				$order->delete_meta_data( self::META_ORDER_PART );
				$order->save();
			}
		}
		wp_delete_post( $id, true );
		return array(
			'ok'     => true,
			'reason' => '',
		);
	}

	/**
	 * Send it. The one call in this plugin that spends money.
	 *
	 * ── THE ORDER OF OPERATIONS IS THE WHOLE DESIGN ──────────────────────────
	 *
	 * SENDING is written and saved BEFORE the request goes out. A process that
	 * dies while the supplier is answering leaves a record that says « envoi
	 * incertain », and this function refuses to run again on it. That costs a
	 * phone call to the supplier; the alternative costs a second delivery, paid
	 * for, on a run whose film is already bought.
	 *
	 * ── AND THE MODE IS A BELIEF THAT HAS TO STILL BE TRUE ───────────────────
	 *
	 * `$expect_mode` is the word the operator saw on the screen when they
	 * confirmed. The Worker reads the account's real mode and refuses if it has
	 * changed since. An account switched from test to live between the screen and
	 * the click is exactly the accident question 22 is worried about.
	 *
	 * @param int    $id
	 * @param string $expect_mode 'test' or 'live', as it was shown to the operator.
	 * @return array{ok:bool,reason:string,state?:string}
	 */
	public static function send( int $id, string $expect_mode, string $today = '' ): array {
		$today  = '' !== $today ? $today : Settings::today();
		$record = self::get( $id );
		if ( null === $record ) {
			return array(
				'ok'     => false,
				'reason' => 'Cette commande fournisseur n’existe pas.',
			);
		}
		if ( self::PREPARED !== $record['state'] ) {
			return array(
				'ok'     => false,
				'reason' => sprintf( 'Cette commande fournisseur est déjà à l’état « %s ». Rien n’a été renvoyé.', self::states()[ $record['state'] ] ?? $record['state'] ),
			);
		}
		if ( ! in_array( $expect_mode, array( 'test', 'live' ), true ) ) {
			return array(
				'ok'     => false,
				'reason' => 'Le mode du compte fournisseur n’a pas été confirmé.',
			);
		}
		if ( ! in_array( (string) $record['source'], self::TRANSMITTABLE, true ) ) {
			return array(
				'ok'     => false,
				'reason' => 'Cette source ne peut pas recevoir de commande automatiquement : exportez le panier et passez-la à la main.',
			);
		}

		$lines = array();
		foreach ( $record['rows'] as $row ) {
			$lines[] = array(
				'sku'     => (string) $row['sku'],
				'qty'     => (int) $row['qty'],
				'lineRef' => substr( (string) $row['size'], 0, 16 ),
			);
		}
		if ( array() === $lines ) {
			return array(
				'ok'     => false,
				'reason' => 'Cette commande fournisseur n’a aucune ligne.',
			);
		}

		// DURABLE BEFORE THE CALL. See the docblock.
		$record['state']        = self::SENDING;
		$record['attempted_on'] = $today;
		$record['attempted_by'] = get_current_user_id();
		self::store( $id, $record );

		$answer = Supply::place_order( (string) $record['key'], $expect_mode, $lines );

		$record['answer']  = $answer;
		$record['sent_on'] = $today;
		$record['sent_by'] = get_current_user_id();

		if ( 'accepted' === ( $answer['outcome'] ?? '' ) ) {
			$record['state'] = self::SENT;
		} elseif ( 'rejected' === ( $answer['outcome'] ?? '' ) ) {
			/*
			 * A REFUSAL PUTS THE ORDERS BACK. The supplier created nothing, so
			 * the blanks are still to buy, and leaving the orders pinned to a
			 * dead purchase would strand them exactly as a discarded lot once
			 * stranded paid orders out of production.
			 */
			$record['state'] = self::REFUSED;
		} else {
			$record['state'] = self::UNCERTAIN;
		}

		self::store( $id, $record );
		self::stamp_orders( $record );

		if ( self::SENT === $record['state'] ) {
			return array(
				'ok'     => true,
				'reason' => '',
				'state'  => $record['state'],
			);
		}
		if ( self::REFUSED === $record['state'] ) {
			return array(
				'ok'     => false,
				'state'  => $record['state'],
				'reason' => 'Le fournisseur a refusé la commande : ' . self::answer_fr( $answer ),
			);
		}
		return array(
			'ok'     => false,
			'state'  => $record['state'],
			'reason' => 'Le fournisseur n’a pas répondu. La commande a PEUT-ÊTRE été créée : vérifiez chez le fournisseur avant toute nouvelle tentative. Rien ne sera renvoyé automatiquement.',
		);
	}

	/** Mark the blanks as arrived and checked in. */
	public static function receive( int $id, string $today = '' ): array {
		$record = self::get( $id );
		if ( null === $record ) {
			return array(
				'ok'     => false,
				'reason' => 'Cette commande fournisseur n’existe pas.',
			);
		}
		if ( ! in_array( (string) $record['state'], array( self::SENT, self::UNCERTAIN ), true ) ) {
			return array(
				'ok'     => false,
				'reason' => 'Seule une commande partie peut être reçue.',
			);
		}
		$record['state']       = self::RECEIVED;
		$record['received_on'] = '' !== $today ? $today : Settings::today();
		$record['received_by'] = get_current_user_id();
		self::store( $id, $record );
		self::stamp_orders( $record );
		return array(
			'ok'     => true,
			'reason' => '',
		);
	}

	/** Write the record back. */
	private static function store( int $id, array $record ): void {
		$encoded = wp_json_encode( $record );
		if ( false !== $encoded ) {
			update_post_meta( $id, self::META_ORDER, $encoded );
		}
	}

	/**
	 * Carry the purchase's state onto its orders, and redo their cost reports.
	 *
	 * The freight share only becomes a real cost once the purchase has left, for
	 * the same reason a draft lot changes no film cost: until then nothing has
	 * been bought and the order still owes its own carriage.
	 */
	private static function stamp_orders( array $record ): void {
		foreach ( $record['orders'] as $row ) {
			$order = wc_get_order( (int) $row['id'] );
			if ( ! $order instanceof \WC_Order ) {
				continue;
			}
			if ( self::REFUSED === $record['state'] ) {
				$order->delete_meta_data( self::META_ORDER_PART );
				$order->save();
				Costing::refresh( $order );
				continue;
			}
			$part = self::part_of( $order );
			$part = is_array( $part ) ? $part : array( 'purchase_id' => (int) $record['purchase_id'] );
			$part['state']   = (string) $record['state'];
			$part['sent_on'] = (string) $record['sent_on'];
			$order->update_meta_data( self::META_ORDER_PART, wp_json_encode( $part ) );
			$order->save();
			Costing::refresh( $order );
		}
	}

	/** The supplier's answer, in a sentence an operator can act on. */
	public static function answer_fr( array $answer ): string {
		$parts = array();
		$message = trim( (string) ( $answer['message'] ?? '' ) );
		if ( '' !== $message ) {
			$parts[] = $message;
		}
		foreach ( (array) ( $answer['lines'] ?? array() ) as $line ) {
			if ( ! is_array( $line ) ) {
				continue;
			}
			$parts[] = sprintf( 'article %s : %s', (string) ( $line['sku'] ?? '' ), (string) ( $line['message'] ?? '' ) );
		}
		return array() === $parts ? 'aucun détail fourni.' : implode( ' · ', $parts );
	}

	/** The French name of a studio colour, or the id when it is not one. */
	private static function colour_name( string $id ): string {
		foreach ( (array) ( Garments::all()['colors'] ?? array() ) as $colour ) {
			if ( is_array( $colour ) && (string) ( $colour['id'] ?? '' ) === $id ) {
				return (string) ( $colour['name'] ?? $id );
			}
		}
		return '' !== $id ? $id : '(sans coloris)';
	}
}
