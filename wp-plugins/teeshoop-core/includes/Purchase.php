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
 * ── HOW LONG THE BLANKS TAKE, ANSWERED ON 1 SEPTEMBER 2026 ──────────────────
 *
 * A lot has always known the date its film must be ordered, because question 04
 * gives the film a transit time. Nothing gave the blanks one: the brief has no
 * textile lead time in any of its eight chapters (« peut livrer rapidement »,
 * said of one supplier with no figure, is the whole of it), the supplier
 * publishes none, and this shop had never placed a supplier order to measure. So
 * this file computed no blank-side deadline at all and said so on the screen.
 *
 * Question 46's answer: « le délai réel habituel est d'environ 24 heures. Le
 * moteur de planification retient jusqu'à 2 jours ouvrés de sécurité pour une
 * promesse client normale. » Two numbers, and the second is the one that
 * schedules. `Production::blank_deadline_for()` walks it back exactly as the
 * film's is walked back, and the date is on the per-order table.
 *
 * WHAT IT DID NOT CHANGE, and this is the part worth reading. Session 07
 * measured six incompressible working days between an approved proof and a
 * parcel WITHOUT the blanks. Adding two would give eight and would be wrong:
 * film and blanks are ordered on the same day and travel at the same time, so
 * the constraint is whichever arrives LAST. Two against the film's two, so the
 * maximum is two and the work stays at six. Measured, not reasoned about:
 * `Production::feasibility()` takes the max and `tests/test-production.php`
 * holds it.
 *
 * HE ALSO SAYS WHERE IT STOPS APPLYING: « Si le produit n'est pas immédiatement
 * disponible ou est en réapprovisionnement : délai à confirmer. » What the
 * supplier DOES publish is the restock date of what is out of stock, and that is
 * read (`Supply::deliveries()`) and shown beside every short line, because it is
 * his fact and not our estimate.
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

	/**
	 * He created the order AND refused some lines. The run is short.
	 *
	 * A state of its own because the two facts it replaces are not the same:
	 * money has moved and blanks are coming, AND the workshop is about to press
	 * a job it does not have every garment for. This used to report as SENT and
	 * the per-line refusals were stored and then hidden by the screen, so the
	 * shortage was discovered when the cartons were opened, next to film already
	 * printed.
	 */
	public const PARTIAL = 'partielle';

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
			self::PARTIAL   => 'Commandée en partie',
			self::REFUSED   => 'Refusée',
			self::UNCERTAIN => 'Envoi incertain',
			self::RECEIVED  => 'Reçue',
		);
	}

	/** A purchase in one of these has spent money and may not be sent again. */
	public static function spent( string $state ): bool {
		return in_array( $state, array( self::SENDING, self::SENT, self::PARTIAL, self::UNCERTAIN, self::RECEIVED ), true );
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

		/*
		 * AND WHEN THE SUPPLIER SAYS THE MISSING ONES COME BACK.
		 *
		 * Asked only when something is actually short, because it is a request
		 * over the network for a screen that usually has nothing to say. It is
		 * the only date in this file: nobody has measured how long the supplier
		 * takes to deliver (question 46), so the basket reports what HE announces
		 * and computes nothing of its own.
		 */
		if ( array() !== $basket['stock']['short'] ) {
			/*
			 * NARROWED TO THE REFERENCES THAT ARE SHORT, not the whole feed. The
			 * unnarrowed answer is 9 552 announcements, about a megabyte of JSON,
			 * and a basket is short in one or two references: fetching everything
			 * to read four rows would put a megabyte through a shared-hosting
			 * PHP every time an operator opened a screen.
			 *
			 * The reference is the leading five digits of an article number,
			 * which is the supplier's own construction and is the one place this
			 * plugin relies on it: it does not GUESS an article number from a
			 * reference, it reads the reference off an article the importer
			 * already wrote.
			 */
			$refs = array();
			foreach ( $basket['stock']['short'] as $one ) {
				$ref = substr( (string) $one['sku'], 0, 5 );
				if ( 1 === preg_match( '/^\d{5}$/', $ref ) ) {
					$refs[ $ref ] = true;
				}
			}
			$announced = array();
			// Cast: PHP turns a numeric string array key back into an int.
			foreach ( array_keys( $refs ) as $ref ) {
				$announced += Supply::deliveries( (string) $ref );
			}
			foreach ( $basket['stock']['short'] as $i => $one ) {
				$basket['stock']['short'][ $i ]['back_on'] = (string) ( $announced[ $one['sku'] ]['date'] ?? '' );
				$basket['stock']['short'][ $i ]['back_qty'] = (int) ( $announced[ $one['sku'] ]['qty'] ?? 0 );
			}
		}

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

		/*
		 * `$count` IS THE SIZE'S OWN QUANTITY on a per-size refusal, and the whole
		 * line's only on a whole-line one. It used to be the line's either way, so
		 * a line of « 12 M et 8 L et 5 2XL » with only the 2XL unavailable told the
		 * operator that twenty-five garments were blocked instead of five, on the
		 * screen where he decides whether to wait for a restock or re-cut the run.
		 */
		$reject = static function ( string $why, string $size = '', ?int $count = null ) use ( $order, $item, $qty ) {
			return array(
				'order_id'  => $order->get_id(),
				'order_ref' => (string) $order->get_order_number(),
				'item_id'   => $item->get_id(),
				'label'     => (string) $item->get_name(),
				'garment'   => (string) $item->get_meta( '_teeshoop_garment', true ),
				'colour'    => (string) $item->get_meta( '_teeshoop_couleur', true ),
				'size'      => $size,
				'qty'       => null === $count ? $qty : $count,
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
		/*
		 * ── LA MATRICE D'ABORD, LA GRILLE ENSUITE ───────────────────────────
		 *
		 * Depuis le 9 septembre 2026 une ligne porte une matrice coloris vers
		 * taille vers quantité : une seule création peut être commandée en
		 * plusieurs coloris, ce qui est ce qu'un acheteur demande et ce que la
		 * facturation par ligne rendait plus cher qu'un coloris unique.
		 *
		 * `_teeshoop_size_grid` reste écrit à côté, agrégé par taille, parce que
		 * tout ce qui PRESSE regarde la taille et pas le coloris. Ici, où l'on
		 * ACHÈTE, la grille seule ne suffit pas : elle dit « dix M » sans dire
		 * lesquels sont noirs. Une ligne antérieure n'en a pas, et le coloris
		 * unique gelé sur la ligne fait alors office de matrice à une entrée.
		 */
		$matrix = json_decode( (string) $item->get_meta( '_teeshoop_matrix', true ), true );
		$matrix = is_array( $matrix ) ? $matrix : array();

		$grid = json_decode( (string) $item->get_meta( '_teeshoop_size_grid', true ), true );
		$grid = is_array( $grid ) ? array_filter( array_map( 'intval', $grid ), static fn( $n ) => $n > 0 ) : array();
		if ( array() === $grid && array() === $matrix ) {
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

		/*
		 * WHAT WAS SOLD, NOT WHAT THE PRODUCT SAYS TODAY.
		 *
		 * `Cart::persist_to_order` freezes the reference and the supplier colour
		 * term on the line at the moment of sale. Reading them from the product
		 * here instead meant that changing a discontinued reference on a product
		 * page changed what the workshop buys for orders ALREADY SOLD, whose film
		 * may already be printed. The adversarial pass reproduced it on the
		 * mirror: 00142 changed to 00517, « Navy » resolving on both because
		 * `pa_couleur` is one global taxonomy, twenty polos bought for a t-shirt
		 * run, nothing refused anywhere.
		 *
		 * A LINE OLDER THAN THE FREEZE HAS NEITHER, and falls back to the product,
		 * because that is the only thing there is. It is the ONLY case where this
		 * reads the product, and it says so on the claim so a screen can too.
		 */
		$frozen_ref    = (string) $item->get_meta( '_teeshoop_blank_ref', true );
		$frozen_colour = (string) $item->get_meta( '_teeshoop_blank_colour', true );
		$from_product  = '' === $frozen_ref;

		$ref = '' !== $frozen_ref ? $frozen_ref : Product::blank_ref_of( $item->get_product_id() );
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
		/*
		 * THE TWO FIELDS ARE READ TOGETHER, and the reason is a real difference.
		 * An empty frozen colour on a line that HAS a frozen reference means the
		 * product had no mapping for that colour when it was sold, which is a
		 * refusal. Falling back to the product's map because the field happens to
		 * be empty would resolve it from a mapping added afterwards, which is the
		 * same substitution the freeze exists to prevent, arriving by the back
		 * door. Only a line with no frozen reference at all, sold before session
		 * 08, reads the product for either field.
		 */
		$term = $from_product
			? (string) ( Product::blank_colours_of( $item->get_product_id() )[ $studio_colour ] ?? '' )
			: $frozen_colour;

		/*
		 * ── LE PLAN : UN TERME FOURNISSEUR ET UNE GRILLE PAR COLORIS ────────
		 *
		 * `_teeshoop_blank_colours` est la carte gelée à la vente, coloris du
		 * studio vers coloris du fournisseur, et elle est gelée pour exactement
		 * la raison racontée sous `_teeshoop_blank_ref` : la fiche produit peut
		 * avoir changé depuis, et acheter d'après elle a déjà coûté vingt polos
		 * achetés pour une série de t-shirts.
		 *
		 * UNE LIGNE ANTÉRIEURE À LA MATRICE n'a ni matrice ni carte : elle a un
		 * coloris unique et une grille, ce qui est exactement une matrice à une
		 * entrée. Elle emprunte donc le même chemin, sans branche à part, parce
		 * qu'une seconde branche est une seconde chance de diverger.
		 */
		$frozen_terms = json_decode( (string) $item->get_meta( '_teeshoop_blank_colours', true ), true );
		$frozen_terms = is_array( $frozen_terms ) ? $frozen_terms : array();

		$plan = array();
		if ( array() !== $matrix ) {
			foreach ( $matrix as $colour_id => $sizes ) {
				if ( ! is_array( $sizes ) ) {
					continue;
				}
				$sizes = array_filter( array_map( 'intval', $sizes ), static fn( $n ) => $n > 0 );
				if ( array() === $sizes ) {
					continue;
				}
				$colour_id = (string) $colour_id;
				$plan[ $colour_id ] = array(
					'term'  => $from_product
						? (string) ( Product::blank_colours_of( $item->get_product_id() )[ $colour_id ] ?? '' )
						: (string) ( $frozen_terms[ $colour_id ] ?? '' ),
					'sizes' => $sizes,
				);
			}
		}

		if ( array() === $plan ) {
			$plan = array(
				$studio_colour => array(
					'term'  => $term,
					'sizes' => $grid,
				),
			);
		}

		$garments = 0;
		foreach ( $plan as $studio_colour_id => $row ) {
			$term = (string) $row['term'];
			if ( '' === $term ) {
				/*
				 * UN COLORIS SANS TERME FOURNISSEUR EST REFUSÉ EN ÉTANT NOMMÉ,
				 * et sa quantité est la sienne, pas celle de la ligne : sur une
				 * ligne de trois coloris dont un seul manque, dire que tout est
				 * bloqué envoie l'atelier attendre un réassort dont il n'a pas
				 * besoin.
				 */
				$refused[] = $reject(
					sprintf( 'Le coloris « %s » n’est associé à aucun coloris du fournisseur sur ce produit.', self::colour_name( (string) $studio_colour_id ) ),
					'',
					(int) array_sum( $row['sizes'] )
				);
				$garments += (int) array_sum( $row['sizes'] );
				continue;
			}

			foreach ( $row['sizes'] as $size => $count ) {
				$garments      += (int) $count;
				$variation_id   = self::variation_of( $blank_id, $term, (string) $size );
				if ( -1 === $variation_id ) {
					$refused[] = $reject(
						sprintf( 'La référence %s vend plusieurs articles en %s taille %s : le coloris ne désigne pas un article unique.', $ref, $term, $size ),
						(string) $size,
						(int) $count
					);
					continue;
				}
				if ( 0 === $variation_id ) {
					$refused[] = $reject(
						sprintf( 'Le fournisseur ne vend pas la taille %s en %s pour la référence %s.', $size, $term, $ref ),
						(string) $size,
						(int) $count
					);
					continue;
				}
				$variation = wc_get_product( $variation_id );
				$sku       = $variation instanceof \WC_Product ? (string) $variation->get_meta( Catalogue::META_SUPPLY_SKU, true ) : '';
				if ( '' === $sku ) {
					$refused[] = $reject(
						sprintf( 'L’article %s en %s n’a pas de référence fournisseur enregistrée.', $size, $term ),
						(string) $size,
						(int) $count
					);
					continue;
				}
				$claims[] = self::claim( $order, $item, $variation, $sku, (string) $size, (int) $count, $from_product );
			}
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
		int $qty,
		bool $from_product = false
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
			/*
			 * TRUE when the line predates the freeze and the blank had to be read
			 * from the product as it stands today. It is not an error, it is the
			 * only thing there is for an order taken before session 08; the screen
			 * says so rather than presenting it as what was sold.
			 */
			'from_product' => $from_product,
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
					'from_product' => ! empty( $c['from_product'] ),
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
				/*
				 * WHEN THE BLANKS MUST LEAVE, since question 46 was answered on
				 * 1 September 2026. This file computed no blank-side deadline at
				 * all until then, and said so on the screen, because nobody had
				 * measured how long the textile supplier takes. '' still means
				 * « we cannot say »: no approved proof, no clock, no date.
				 */
				'blank_by'         => $order instanceof \WC_Order
					? Production::blank_deadline_for( $order, (int) $row['garments'] )
					: '',
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
	 * How a supplier stock timestamp stands against the clock. FOUR answers.
	 *
	 * `fresh` the reading supports a claim · `stale` it is too old to · `future`
	 * the two clocks disagree · `unknown` there is no readable reading at all.
	 *
	 * FOUR AND NOT TWO, because the screen has to say something different about
	 * each and the first version could not. It collapsed everything but `fresh`
	 * into « trop ancien », and the first time the workshop screen was actually
	 * LOOKED AT, it said « trop ancien » about a reading four minutes old: the
	 * mirror's WordPress runs on UTC, the supplier writes central European time,
	 * so his stamp read two hours into the future and the future guard fired. The
	 * guard was right and the word was a lie.
	 *
	 * @return string one of fresh, stale, future, unknown
	 */
	public static function freshness( string $at, string $now = '' ): string {
		$read = self::moment( $at );
		if ( null === $read ) {
			return 'unknown';
		}
		$then = '' === trim( $now )
			? time()
			: ( 1 === preg_match( '/^\d{4}-\d{2}-\d{2}$/', trim( $now ) )
				? self::moment( trim( $now ) . ' 23:59:59' )
				: self::moment( $now ) );
		if ( null === $then ) {
			return 'unknown';
		}
		/*
		 * ── ON NE PEUT PAS ÊTRE PLUS TARD QUE MAINTENANT ────────────────────
		 *
		 * Une date nue est étendue à 23:59:59 pour que « ce relevé était-il frais
		 * le 3 septembre » se réponde sur la journée entière. Mais l'appelant
		 * réel passe la date d'AUJOURD'HUI (`basket()` prend `Settings::today()`),
		 * et un âge se mesure contre un instant, pas contre la fin d'un jour :
		 * mesuré le 5 septembre 2026 à 00 h 06, un relevé pris une heure plus tôt
		 * était daté du 4 et comparé au 5 à 23 h 59, donc lu comme vieux de
		 * 24 h 53 et déclaré périmé. Pendant la première heure de chaque nuit, la
		 * boutique annonçait « stock trop vieux pour être cru » sur un relevé
		 * d'une heure, et l'acheteur commandait à l'aveugle.
		 *
		 * Le plafond ne change rien à une date passée, dont la fin de journée est
		 * déjà derrière nous. Il ne fait que refuser un « maintenant » situé dans
		 * l'avenir.
		 */
		$then = min( $then, time() );
		/*
		 * A READING FROM THE FUTURE IS NOT A FRESH READING. Two clocks are
		 * involved and one of them is not ours; a stamp ahead of us means one of
		 * the two is wrong, and « nous ne savons pas » is the only answer true
		 * either way. An hour of slack, because the two also sit on either side
		 * of a daylight-saving boundary twice a year.
		 */
		if ( $read > $then + 3600 ) {
			return 'future';
		}
		return ( $then - $read ) <= self::STOCK_TRUST_HOURS * 3600 ? 'fresh' : 'stale';
	}

	/** Whether a reading may support a claim of availability at all. */
	public static function fresh( string $at, string $now = '' ): bool {
		return 'fresh' === self::freshness( $at, $now );
	}

	/**
	 * The zone the SUPPLIER writes his timestamps in.
	 *
	 * ── MEASURED, AND NOT THE SHOP'S SETTING ────────────────────────────────
	 *
	 * On 2026-08-19 one response carried our own `request_date_time` of
	 * `14:49:09`, written in UTC, beside an `export_data_date` of `16:49:10` for
	 * the same instant. He writes central European wall-clock time.
	 *
	 * This used to read `wp_timezone()`, which is the SHOP's setting, on the
	 * argument that the two are the same zone. They are not the same THING: a
	 * WordPress installed with no timezone chosen runs on UTC, which is what
	 * both the mirror and a fresh o2switch site do, and every stock reading then
	 * looked two hours into the future in summer and one in winter. The
	 * timestamp belongs to the supplier, so it is read in his zone, and his zone
	 * is a fact we measured rather than a preference anybody can change.
	 *
	 * Both this and Paris are UTC+1/+2 on the same dates, so the string names a
	 * zone without naming a country we may not name here.
	 */
	private const SUPPLIER_TZ = 'Europe/Paris';

	/**
	 * Une observation de stock, comme horodatage unix, ou null.
	 *
	 * ── DEUX ÉCRITURES, PARCE QUE LA BOUTIQUE EN PORTE DEUX ─────────────────
	 *
	 * `Y-m-d H:i:s` sans zone est ce que l'ANCIEN service publiait, et c'est ce
	 * que portent les 46 572 déclinaisons déjà importées : il est lu dans la
	 * zone du fournisseur, mesurée, pour la raison que `SUPPLIER_TZ` raconte.
	 *
	 * ISO 8601 AVEC DÉCALAGE est ce que `Supply::to_entry()` écrit depuis le
	 * 9 septembre 2026, et il n'a besoin d'aucune hypothèse : l'instant est
	 * dans la chaîne. Sans cette seconde lecture, chaque article réimporté
	 * depuis cette date rendait « illisible », donc « Délai à confirmer » sur
	 * la fiche et « relevé non cru » au panier d'achat, sur un stock lu à la
	 * seconde. Trouvé en remettant la suite d'intégration au vert.
	 *
	 * STRICT DANS LES DEUX CAS : `createFromFormat` accepte beaucoup de choses
	 * qui ne sont pas des dates, et une chaîne qu'on ne sait pas lire doit
	 * revenir « on ne sait pas » plutôt que l'époque, qui est une lecture
	 * vieille de quarante ans et s'afficherait « trop ancien » au lieu
	 * d'« illisible ».
	 */
	private static function moment( string $value ): ?int {
		$value = trim( $value );
		if ( '' === $value ) {
			return null;
		}

		$when = \DateTimeImmutable::createFromFormat( 'Y-m-d H:i:s', $value, new \DateTimeZone( self::SUPPLIER_TZ ) );
		if ( false !== $when && array() === array_filter( (array) \DateTimeImmutable::getLastErrors() ) ) {
			return $when->getTimestamp();
		}

		$when = \DateTimeImmutable::createFromFormat( \DateTimeInterface::ATOM, $value );
		if ( false !== $when && array() === array_filter( (array) \DateTimeImmutable::getLastErrors() ) ) {
			return $when->getTimestamp();
		}

		return null;
	}

	// ── resolving an article ─────────────────────────────────────────────────

	/** The imported catalogue product carrying this reference, or 0. */
	/**
	 * Comment nommer un article à un CLIENT, sans rien lui apprendre sur nos achats.
	 *
	 * Le coloris et la taille, qui sont les deux choses qu'il a choisies et les
	 * deux seules qui l'aident à corriger. Jamais le numéro d'article, jamais la
	 * référence du grossiste, jamais la référence publique non plus : elle est
	 * sans danger mais elle ne veut rien dire pour quelqu'un qui vient de cliquer
	 * sur « noir, taille M ».
	 *
	 * Vide quand la déclinaison ne dit ni l'un ni l'autre : l'appelant écrit
	 * alors « cet article », qui est vague mais vrai, plutôt qu'un identifiant
	 * qui serait précis et interdit.
	 */
	private static function customer_label( \WC_Product $variation ): string {
		$couleur = self::attribute_of( $variation, 'couleur' );
		$taille  = self::attribute_of( $variation, 'taille' );
		if ( '' !== $couleur && '' !== $taille ) {
			return sprintf( 'le %1$s en taille %2$s', $couleur, $taille );
		}
		if ( '' !== $couleur ) {
			return sprintf( 'le coloris %s', $couleur );
		}
		if ( '' !== $taille ) {
			return sprintf( 'la taille %s', $taille );
		}
		return '';
	}

	/**
	 * Les numéros d'article du fournisseur pour une matrice coloris/taille.
	 *
	 * ─────────────────────────────────────────────────────────────────────────
	 * POURQUOI CETTE MÉTHODE EST ICI ET PAS DANS `Cart`
	 *
	 * Parce que la résolution « référence plus coloris plus taille donne un
	 * article » existe déjà, dans `articles_for()`, et qu'une seconde copie
	 * dériverait le jour où l'une des deux apprend une règle que l'autre
	 * ignore. `Cart` a besoin de la MÊME réponse à l'ajout au panier que
	 * l'atelier à l'achat : si les deux ne désignaient pas le même article, la
	 * boutique vendrait ce qu'elle ne commanderait pas.
	 *
	 * Un coloris ou une taille qu'on ne sait pas résoudre n'est PAS dans le
	 * retour, et l'appelant le voit en comparant les tailles. On ne met pas de
	 * code inventé : `articles_for()` refusera cette case en la nommant, ce qui
	 * est visible, alors qu'un code faux serait une commande fournisseur fausse.
	 *
	 * @param array<string,array<string,int>> $matrix coloris => taille => quantité.
	 * @param array<string,string>            $terms  coloris du studio => coloris du fournisseur.
	 * @return array<string,int> numéro d'article => quantité totale demandée.
	 */
	public static function codes_for_matrix( int $product_id, array $matrix, array $terms, ?array &$labels = null ): array {
		$labels = array();
		$ref = Product::blank_ref_of( $product_id );
		if ( '' === $ref ) {
			return array();
		}
		$blank_id = self::blank_product_id( $ref );
		if ( 0 === $blank_id ) {
			return array();
		}

		$map = array() !== $terms ? $terms : Product::blank_colours_of( $product_id );
		$out = array();

		foreach ( $matrix as $colour => $sizes ) {
			$term = (string) ( $map[ (string) $colour ] ?? '' );
			if ( '' === $term || ! is_array( $sizes ) ) {
				continue;
			}
			foreach ( $sizes as $size => $count ) {
				$count = (int) $count;
				if ( $count < 1 ) {
					continue;
				}
				$variation_id = self::variation_of( $blank_id, $term, (string) $size );
				if ( $variation_id <= 0 ) {
					continue;
				}
				$variation = wc_get_product( $variation_id );
				$sku       = $variation instanceof \WC_Product ? (string) $variation->get_meta( Catalogue::META_SUPPLY_SKU, true ) : '';
				if ( '' === $sku ) {
					continue;
				}
				$out[ $sku ] = ( $out[ $sku ] ?? 0 ) + $count;
				/*
				 * ET UNE ÉTIQUETTE QU'UN CLIENT PEUT LIRE, remplie ici parce que
				 * c'est ici qu'on tient la déclinaison et qu'une seconde
				 * résolution serait une seconde chance de désigner un autre
				 * article que celui qu'on achète.
				 *
				 * ELLE EXISTE PARCE QUE LE NUMÉRO D'ARTICLE EST SCELLÉ. Un refus
				 * de disponibilité s'affiche au panier et en caisse ; il disait
				 * « l'article 015421122 n'est plus référencé », c'est-à-dire la
				 * clé d'approvisionnement que `Shelf::SEALED` retire de REST, de
				 * l'export CSV et de la fiche, composée à l'exécution donc
				 * invisible à `scripts/php-guard.mjs`. Trouvé par la passe
				 * adversariale du 9 septembre 2026, reproduit de bout en bout par
				 * la vraie route.
				 */
				$labels[ $sku ] = self::customer_label( $variation );
			}
		}

		return $out;
	}

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
	 * The variation of `$blank_id` in this colour term and this size name.
	 *
	 * Returns the id, 0 when there is none, and **-1 when there is more than
	 * one**, which is the answer this used to be unable to give.
	 *
	 * ── WHY AMBIGUITY IS ITS OWN ANSWER ─────────────────────────────────────
	 *
	 * It used `WC_Data_Store::find_matching_product_variation`, which is what
	 * add-to-cart uses and which returns THE FIRST match. Two articles of one
	 * style can carry the same colour name and size: `Catalogue::variations()`
	 * has a comment about exactly that, because two of the supplier's colour
	 * names can reduce to the same public suffix and it appends a number rather
	 * than dropping the second. The attribute TERMS are the names, so both
	 * variations then answer to the same pair, and the workshop bought whichever
	 * WordPress returned that day: a coin flip between two colourways, silent,
	 * on a run whose film is already printed.
	 *
	 * A single query on the two chosen attributes, asking for two, is exact and
	 * cheap. `numberposts => 2` is the whole trick: it costs nothing and it is
	 * the difference between « one article » and « an article ».
	 *
	 * MATCHED ON THE NAME, EXACTLY. Term slugs are computed from names and
	 * several supplier colour names sanitise to the same slug, which is why
	 * `Taxonomy::terms()` matches on the name too. No normalisation, no
	 * case-folding, no nearest match: a size that is not sold is refused.
	 */
	public static function variation_of( int $blank_id, string $colour_term, string $size_name ): int {
		$colour = get_term_by( 'name', $colour_term, Taxonomy::taxonomy( 'couleur' ) );
		$size   = get_term_by( 'name', $size_name, Taxonomy::taxonomy( 'taille' ) );
		if ( ! $colour instanceof \WP_Term || ! $size instanceof \WP_Term ) {
			return 0;
		}

		$found = get_posts(
			array(
				'post_type'   => 'product_variation',
				'post_parent' => $blank_id,
				'post_status' => 'any',
				'numberposts' => 2,
				'fields'      => 'ids',
				'orderby'     => 'ID',
				'order'       => 'ASC',
				// phpcs:ignore WordPress.DB.SlowMetaQuery.SlowMetaQuery -- the attribute pair IS the identity of a variation; there is no other way to reach it.
				'meta_query'  => array(
					array(
						'key'   => 'attribute_' . Taxonomy::taxonomy( 'couleur' ),
						'value' => $colour->slug,
					),
					array(
						'key'   => 'attribute_' . Taxonomy::taxonomy( 'taille' ),
						'value' => $size->slug,
					),
				),
			)
		);

		if ( count( $found ) > 1 ) {
			return -1;
		}
		return 1 === count( $found ) ? (int) $found[0] : 0;
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

	/**
	 * How long after an attempt a record may still honestly say « envoi en cours ».
	 *
	 * `Supply::TIMEOUT` is forty seconds, so a request that started five minutes
	 * ago is not in flight: either it came back and this process wrote the
	 * outcome, or the process is gone. Generous, because the only cost of being
	 * generous is that the screen says « envoi en cours » for a few minutes
	 * longer than it had to.
	 */
	private const SENDING_DEADLINE_S = 300;

	/**
	 * One purchase record by id, or null.
	 *
	 * ── IT RESOLVES A SEND THAT NOBODY CAME BACK FROM ────────────────────────
	 *
	 * `send()` writes SENDING before it calls, deliberately, so a process that
	 * dies holding the request leaves a trace. It left more than a trace: nothing
	 * could move that record afterwards. `send()` refuses a state that is not
	 * PREPARED, `discard()` refuses one that is not PREPARED, `receive()` refuses
	 * one that is not SENT or UNCERTAIN, so the purchase was stuck for ever, its
	 * orders were pinned to it for ever and could never be bought, and the
	 * workshop screen went on counting them as bought. Found by an adversarial
	 * pass that reproduced the death rather than reasoning about it.
	 *
	 * A stale SENDING IS an uncertain send, and that is not a downgrade: it is
	 * the same fact said accurately. « Nous avons envoyé et nous ne savons pas ce
	 * qui est arrivé » is exactly what UNCERTAIN means, and UNCERTAIN has the
	 * actions a human needs.
	 *
	 * The promotion is written once, here, rather than left to a cron: a record
	 * nobody opens costs nothing, and the moment somebody opens it they need it
	 * to be true.
	 */
	public static function get( int $id ): ?array {
		$post = get_post( $id );
		if ( ! $post || self::POST_TYPE !== $post->post_type ) {
			return null;
		}
		$raw = json_decode( (string) get_post_meta( $id, self::META_ORDER, true ), true );
		if ( ! is_array( $raw ) ) {
			return null;
		}

		if ( self::SENDING === ( $raw['state'] ?? '' ) ) {
			$since = (int) ( $raw['attempted_at'] ?? 0 );
			/*
			 * NO TIMESTAMP MEANS THE ATTEMPT PREDATES THIS FIELD, which is a
			 * record already stuck. Treating it as expired is the only reading
			 * that lets anybody act on it.
			 */
			if ( 0 === $since || ( time() - $since ) > self::SENDING_DEADLINE_S ) {
				$raw['state']  = self::UNCERTAIN;
				$raw['answer'] = is_array( $raw['answer'] ?? null ) ? $raw['answer'] : array(
					'outcome' => 'unknown',
					'message' => 'Le processus qui envoyait cette commande n’est jamais revenu. Elle a peut-être été créée chez le fournisseur.',
					'lines'   => array(),
				);
				self::store( $id, $raw );
				self::stamp_orders( $raw );
			}
		}

		return $raw;
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
				/*
				 * EVERY ORDER OR NONE. An order that could not be pinned is an
				 * order this purchase will buy blanks for and which nothing
				 * records as bought: it stays in the queue, gets put on a second
				 * purchase, and its garments are bought twice. `send_lot()` makes
				 * the same refusal for the same reason.
				 */
				wp_delete_post( (int) $id, true );
				foreach ( $record['orders'] as $undo ) {
					$other = wc_get_order( (int) $undo['id'] );
					if ( $other instanceof \WC_Order ) {
						$other->delete_meta_data( self::META_ORDER_PART );
						$other->save();
					}
				}
				Invoice::unlock( self::LOCK );
				return $fail( sprintf( 'La commande %d a disparu pendant la préparation : rien n’a été enregistré.', (int) $row['id'] ) );
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
		/*
		 * UNDER THE SAME LOCK AS THE SEND TRANSITION. Without it, a discard that
		 * arrived while a send was in flight read PREPARED (the send had not yet
		 * written SENDING) and DELETED the record of a document already on the
		 * wire: the delivery arrives against a purchase that no longer exists,
		 * the orders are unpinned and can be bought a second time, and nothing
		 * anywhere records that anything was ever sent.
		 */
		if ( ! Invoice::lock( self::LOCK ) ) {
			return array(
				'ok'     => false,
				'reason' => 'Une autre opération est en cours sur les achats. Réessayez dans un instant.',
			);
		}
		$record = self::get( $id );
		if ( null === $record ) {
			Invoice::unlock( self::LOCK );
			return array(
				'ok'     => false,
				'reason' => 'Cette commande fournisseur n’existe pas.',
			);
		}
		if ( self::PREPARED !== $record['state'] ) {
			Invoice::unlock( self::LOCK );
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
		Invoice::unlock( self::LOCK );
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

		/*
		 * ── OÙ LE FOURNISSEUR LIVRE, ET POURQUOI C'EST ICI QUE ÇA SE LIT ─────
		 *
		 * Le nouveau service exige l'adresse de livraison DANS le document de
		 * commande : `Supply::place_order()` refuse sans elle, champ par champ.
		 * Cet appelant, le seul du greffon, ne la passait pas, donc tout envoi
		 * revenait « refusé, adresse incomplète » sans qu'un octet parte. Trouvé
		 * en remettant la suite d'intégration au vert le 9 septembre 2026 : les
		 * tests purs ne pouvaient pas le voir, puisqu'ils appellent
		 * `place_order()` avec une adresse en main.
		 *
		 * Elle est LUE et jamais écrite à la main : `Legal::identity()` est
		 * l'identité que la boutique imprime déjà sur ses factures, donc il n'y
		 * a pas deux adresses de la même entreprise dans ce dépôt. Le pays vient
		 * de WooCommerce, qui est l'endroit où un exploitant le règle.
		 *
		 * ELLE FERME : une adresse incomplète refuse l'envoi en nommant ce qui
		 * manque. Une commande fournisseur est de l'argent qui part vers un
		 * carton qui doit arriver quelque part, et deviner une ligne d'adresse
		 * ferait livrer à une adresse que personne n'a validée.
		 */
		$ship = self::ship_to();
		if ( ! $ship['ok'] ) {
			return array(
				'ok'     => false,
				'reason' => $ship['error'],
			);
		}

		/*
		 * ── THE TRANSITION IS LOCKED, AND THE SUPPLIER CALL IS NOT ───────────
		 *
		 * `prepare()`, which spends nothing, took this lock from the start;
		 * `send()`, the one call in the plugin that spends money, took none. Two
		 * submits of the confirmation form, a double click or two operators,
		 * both read PREPARED at the check above and both reached the write below:
		 * two documents, two deliveries, paid twice, and the idempotency key on
		 * both is the SAME, so the duplicate is recognisable only to a human
		 * reading the supplier's screen. Found by four independent readings of the
		 * adversarial pass, which is what a hole this shape looks like.
		 *
		 * The lock covers the re-read, the check and the SENDING write, and is
		 * released BEFORE the call: holding it across forty seconds of supplier
		 * network would make every other purchase screen block on one slow order.
		 * Once SENDING is stored, the state machine is the guard: nothing else
		 * can enter this branch.
		 */
		if ( ! Invoice::lock( self::LOCK ) ) {
			return array(
				'ok'     => false,
				'reason' => 'Une autre commande fournisseur est en cours d’envoi. Rien n’a été envoyé ; réessayez dans un instant.',
			);
		}

		$fresh = self::get( $id );
		if ( null === $fresh || self::PREPARED !== $fresh['state'] ) {
			Invoice::unlock( self::LOCK );
			return array(
				'ok'     => false,
				'reason' => 'Cette commande fournisseur vient de partir. Rien n’a été renvoyé.',
			);
		}
		$record = $fresh;

		// DURABLE BEFORE THE CALL. See the docblock.
		$record['state']        = self::SENDING;
		$record['attempted_on'] = $today;
		// A DATE CANNOT SAY WHETHER A REQUEST IS STILL IN FLIGHT. See `get()`.
		$record['attempted_at'] = time();
		$record['attempted_by'] = get_current_user_id();
		self::store( $id, $record );
		Invoice::unlock( self::LOCK );

		$answer = Supply::place_order( (string) $record['key'], $expect_mode, $lines, $ship['ship'] );

		$record['answer']  = $answer;
		$record['sent_on'] = $today;
		$record['sent_by'] = get_current_user_id();

		if ( 'accepted' === ( $answer['outcome'] ?? '' ) ) {
			$record['state'] = self::SENT;
		} elseif ( 'partial' === ( $answer['outcome'] ?? '' ) ) {
			// Money has moved and the run is short. Both, and neither hidden.
			$record['state'] = self::PARTIAL;
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
		if ( self::PARTIAL === $record['state'] ) {
			return array(
				'ok'     => false,
				'state'  => $record['state'],
				'reason' => 'Le fournisseur a accepté la commande MAIS refusé des lignes : la série sera incomplète. ' . self::answer_fr( $answer ),
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

	/**
	 * L'adresse où le fournisseur doit livrer : la nôtre, telle qu'elle est
	 * déclarée une fois pour toute la boutique.
	 *
	 * `Legal::identity()` PLUTÔT QU'UN RÉGLAGE À PART. C'est déjà l'adresse que
	 * la facture porte et que le portail de mise en ligne refuse de laisser
	 * vide ; en ouvrir une seconde ferait deux adresses de la même entreprise
	 * dans le même dépôt, et le jour où elles diffèrent les cartons partent à
	 * l'ancienne.
	 *
	 * REFUSE PLUTÔT QUE DE COMPLÉTER. Un champ vide nomme le champ et arrête
	 * l'envoi : le fournisseur, lui, refuserait la commande de toute façon
	 * (`Supply::place_order()` liste les cinq champs), et un refus lu chez lui
	 * coûte un aller-retour là où le nôtre coûte une phrase.
	 *
	 * @return array{ok:bool,ship:array<string,string>,error:string}
	 */
	private static function ship_to(): array {
		$identity = Legal::identity();

		/*
		 * Le pays vient de WooCommerce et pas d'un littéral : c'est le seul
		 * endroit où un exploitant règle le pays de la boutique, et l'atelier
		 * peut déménager sans que ce fichier le sache. `get_base_country()`
		 * rend déjà les deux lettres ISO que le service attend.
		 */
		$country = function_exists( 'WC' ) && WC()->countries instanceof \WC_Countries
			? strtoupper( trim( (string) WC()->countries->get_base_country() ) )
			: '';

		$ship = array(
			'name'         => trim( (string) ( $identity['raison_sociale'] ?? '' ) ),
			'address'      => trim( (string) ( $identity['adresse'] ?? '' ) ),
			'zip'          => trim( (string) ( $identity['code_postal'] ?? '' ) ),
			'city'         => trim( (string) ( $identity['ville'] ?? '' ) ),
			'country_code' => $country,
		);

		$labels = array(
			'name'         => 'la raison sociale',
			'address'      => 'l’adresse',
			'zip'          => 'le code postal',
			'city'         => 'la ville',
			'country_code' => 'le pays de la boutique (réglages WooCommerce)',
		);

		$missing = array();
		foreach ( $ship as $field => $value ) {
			if ( '' === $value ) {
				$missing[] = $labels[ $field ];
			}
		}

		if ( array() !== $missing ) {
			return array(
				'ok'    => false,
				'ship'  => array(),
				'error' => 'L’adresse de livraison de la boutique est incomplète (' . implode( ', ', $missing ) . ') : rien n’a été transmis au fournisseur. Complétez l’identité légale dans les réglages Teeshoop.',
			);
		}

		return array(
			'ok'    => true,
			'ship'  => $ship,
			'error' => '',
		);
	}

	/**
	 * A human has checked with the supplier: nothing was created. Release it.
	 *
	 * THE ONLY WAY OUT OF « ENVOI INCERTAIN », and it has to be a human act
	 * because the shop cannot find out: this webservice publishes no route that
	 * lists orders (VERIFIED 2026-08-19). Without it, a lost answer stranded its
	 * orders for ever: they could never be put on another purchase, so their
	 * blanks could never be bought, on a run whose film may already be ordered.
	 *
	 * It records WHO said so and WHEN, because the assertion is the evidence. If
	 * they were wrong, a delivery arrives against an order the shop has bought
	 * twice, and the record has to be able to say whose reading that was.
	 *
	 * @return array{ok:bool,reason:string}
	 */
	public static function abandon( int $id, string $today = '' ): array {
		$record = self::get( $id );
		if ( null === $record ) {
			return array(
				'ok'     => false,
				'reason' => 'Cette commande fournisseur n’existe pas.',
			);
		}
		if ( self::UNCERTAIN !== $record['state'] ) {
			return array(
				'ok'     => false,
				'reason' => 'Seul un envoi incertain peut être déclaré non reçu par le fournisseur.',
			);
		}
		$record['state']         = self::REFUSED;
		$record['abandoned_on']  = '' !== $today ? $today : Settings::today();
		$record['abandoned_by']  = get_current_user_id();
		$record['answer']        = array(
			'outcome' => 'rejected',
			'message' => 'Déclarée non reçue par le fournisseur, après vérification par un opérateur.',
			'lines'   => array(),
		);
		self::store( $id, $record );
		self::stamp_orders( $record );
		return array(
			'ok'     => true,
			'reason' => '',
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
		if ( ! in_array( (string) $record['state'], array( self::SENT, self::PARTIAL, self::UNCERTAIN ), true ) ) {
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
			/*
			 * REBUILT FROM THE RECORD'S OWN ROW, never from a bare id. A pin that
			 * had been lost was rebuilt with nothing but `purchase_id`, and
			 * `Costing::compute()` then read its missing `freight_ht` as a share
			 * of ZERO: that order's inbound carriage vanished from its margin
			 * report and the shares stopped summing to the supplier's bill. The
			 * row already carries every figure the pin needs.
			 */
			$part = self::part_of( $order );
			$part = is_array( $part ) ? $part : array(
				'purchase_id'      => (int) $record['purchase_id'],
				'blanks_ht'        => (int) ( $row['blanks_ht'] ?? 0 ),
				'freight_ht'       => (int) ( $row['freight_ht'] ?? 0 ),
				'solo_freight_ht'  => (int) ( $row['solo_freight_ht'] ?? 0 ),
				'freight_saved_ht' => (int) ( $row['freight_saved_ht'] ?? 0 ),
				'orders'           => count( (array) $record['orders'] ),
			);
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
