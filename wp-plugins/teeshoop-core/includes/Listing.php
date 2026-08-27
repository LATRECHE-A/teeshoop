<?php
/**
 * The one question a listing must not ask twenty-four times.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MEASUREMENT THAT FORCED THIS FILE
 *
 * On 27/08/2026 the category page answered in 14,0 s (TTFB, throttled mobile
 * profile, docs/perf/cwv-avant.json). A server-side profile put 12,2 s of the
 * 13,8 s inside the product loop and only 1,7 s inside MySQL, so it was not a
 * query problem: it was twenty-four cards costing about half a second each of
 * PHP.
 *
 * The half second is one line of WooCommerce. `content-product.php` opens with
 * `wc_product_class()`, which calls `wc_get_product_class()`, which at
 * wc-template-functions.php:714 asks `$product->is_on_sale()`. A VARIABLE
 * product answers that by reading the price of every one of its variations, and
 * reading a variation's price means constructing the variation: one
 * `WC_Product_Variation`, one title generated through `wc_get_formatted_variation`,
 * one `get_term_by` per attribute. The reference measured, B&C #E150 /women,
 * has 159 of them and takes 807 ms.
 *
 * WooCommerce has a cache for exactly this, and it CANNOT FIRE HERE.
 * `class-wc-product-variable-data-store-cpt.php:529` only writes its transient
 * when `validate_prices_data()` accepts the result, and that function ends
 * (line 1106) with:
 *
 *     // If price is empty, we want to rebuild the data.
 *     if ( $price_data_is_empty ) { return false; }
 *
 * Every variation price in this catalogue is empty. The importer writes a
 * purchase cost (`_teeshoop_supply_cents`) and no selling price, because nobody
 * has set `blank_margin_rate`: that is question 42, `H-Q42-MARGE-TEXTILE-NU`,
 * and it is not this file's business to answer it. So WooCommerce rebuilds the
 * whole variation set on every single request, cold and warm alike. Measured
 * 807 ms cold, 777 ms warm, transient never written.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS DOES INSTEAD, AND WHY IT IS NOT A SECOND ANSWER TO THE SAME QUESTION
 *
 * It does not compute a price, guess one, or cache one. It answers two
 * questions that are TAUTOLOGIES when no variation carries a price:
 *
 *   is it on sale?      No. `WC_Product_Variable::is_on_sale()` compares three
 *                       arrays that are all empty, so it returns false. Ours
 *                       returns false, through the same filter.
 *   what is its price?  Nothing. `get_price_html()` takes the
 *                       `empty( $prices['price'] )` branch and returns the
 *                       `woocommerce_variable_empty_price_html` filter's value.
 *                       Ours returns the same, through the same two filters.
 *
 * The value is identical; only the 807 ms of arithmetic that could not change
 * it is skipped. `tests/integration.php` asserts that identity against a real
 * WooCommerce, for a priced product and an unpriced one, so the day the two
 * disagree a suite goes red rather than a price going quiet.
 *
 * THE PREDICATE IS EXACT AND CONSERVATIVE. `read_price_data` skips a variation
 * when `$variation->get_price( 'edit' )` is the empty string, and the `edit`
 * context reads the `_price` meta with no filter applied. So counting rows of
 * non-empty `_price` meta is the same test WooCommerce runs, in one query for
 * the whole page instead of one object per variation. It counts over a SUPERSET
 * of what `get_visible_children()` would return (private as well as published,
 * and out-of-stock included whatever the shop setting says), because the only
 * direction that can be wrong is skipping work that would have found a price,
 * and a superset cannot do that.
 *
 * AND IT STANDS ASIDE THE MOMENT ANYONE ELSE JOINS IN. If a filter is
 * registered on `woocommerce_variation_prices_price` or
 * `woocommerce_variation_prices_array`, a price can be injected that no `_price`
 * meta row would show, and this class refuses to answer at all: every call goes
 * to WooCommerce. Nothing in this repository registers either one; the check
 * costs one array lookup and removes the whole class of "it was right until
 * somebody added a plugin".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A PRODUCT CLASS AND NOT A TEMPLATE OVERRIDE
 *
 * Because `wc_product_class()` is called from INSIDE `content-product.php`, and
 * both this plugin (`Compat.php`) and the theme have already decided, in
 * writing, to override no WooCommerce template. `woocommerce_product_class` is
 * the factory's own documented seam (class-wc-product-factory.php:90) and it
 * reaches every caller, not only the listing: the product page paid the same
 * 807 ms in its summary and stops paying it too.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class Listing {

	/**
	 * product_id => does it have at least one variation carrying a price.
	 *
	 * Per request. A listing asks about twenty-four products and gets one query.
	 */
	private static array $priced = array();

	/** Set once the answer is known to be unusable, see `usable()`. */
	private static ?bool $usable = null;

	public static function init(): void {
		require_once __DIR__ . '/VariableProduct.php';
		add_filter( 'woocommerce_product_class', array( self::class, 'product_class' ), 10, 4 );
	}

	/**
	 * Hand back our subclass for a plain variable product, and only for that.
	 *
	 * If a third party has already replaced the class we leave it alone: theirs
	 * may not extend `WC_Product_Variable` at all, and a shop that fatals is a
	 * worse outcome than a slow one.
	 */
	public static function product_class( $classname, $product_type, $post_type, $product_id ) {
		if ( 'WC_Product_Variable' === $classname && 'variable' === $product_type ) {
			return VariableProduct::class;
		}
		return $classname;
	}

	/**
	 * Whether the shortcut may be taken at all.
	 *
	 * Two filters can put a price on a variation that has no `_price` meta, and
	 * either of them makes the row count a lie. Neither is registered anywhere in
	 * this repository; if one ever is, everything below stands down and
	 * WooCommerce answers, slowly and correctly.
	 *
	 * The regular-price and sale-price filters are deliberately NOT checked:
	 * `read_price_data` skips a variation on the ACTIVE price alone, before it
	 * looks at either of them, so neither can turn an empty price set into a
	 * non-empty one.
	 */
	private static function usable(): bool {
		if ( null === self::$usable ) {
			self::$usable = ! has_filter( 'woocommerce_variation_prices_price' )
				&& ! has_filter( 'woocommerce_variation_prices_array' );
		}
		return self::$usable;
	}

	/**
	 * Does this variable product have any variation carrying a price at all.
	 *
	 * `null` means "do not take the shortcut", which is what the caller does
	 * when a filter could be inventing prices.
	 */
	public static function has_priced_variation( int $product_id ): ?bool {
		if ( $product_id <= 0 || ! self::usable() ) {
			return null;
		}
		if ( ! array_key_exists( $product_id, self::$priced ) ) {
			self::prime( array_merge( self::loop_ids(), array( $product_id ) ) );
		}
		return self::$priced[ $product_id ] ?? null;
	}

	/**
	 * The product ids of the page being rendered, so the first card's question
	 * answers the other twenty-three at the same time.
	 *
	 * A shortcode loop or a widget has its own query and is not in here; those
	 * fall through to a one-row lookup each, which is correct and still cheap.
	 */
	private static function loop_ids(): array {
		$query = $GLOBALS['wp_query'] ?? null;
		if ( ! $query instanceof \WP_Query || empty( $query->posts ) ) {
			return array();
		}
		$ids = array();
		foreach ( $query->posts as $post ) {
			$id = is_object( $post ) ? (int) ( $post->ID ?? 0 ) : (int) $post;
			if ( $id > 0 && ! array_key_exists( $id, self::$priced ) ) {
				$ids[] = $id;
			}
		}
		return $ids;
	}

	/** One query: which of these parents have at least one priced variation. */
	private static function prime( array $ids ): void {
		global $wpdb;

		$ids = array_values( array_unique( array_filter( array_map( 'intval', $ids ) ) ) );
		if ( empty( $ids ) ) {
			return;
		}
		foreach ( $ids as $id ) {
			self::$priced[ $id ] = false;
		}

		$in = implode( ',', $ids );
		// phpcs:disable WordPress.DB.PreparedSQL.NotPrepared -- $in is a list of ints built above.
		$rows = $wpdb->get_col(
			"SELECT DISTINCT p.post_parent
			   FROM {$wpdb->posts} p
			   INNER JOIN {$wpdb->postmeta} m
				   ON m.post_id = p.ID AND m.meta_key = '_price'
			  WHERE p.post_type = 'product_variation'
				AND p.post_status IN ( 'publish', 'private' )
				AND p.post_parent IN ( {$in} )
				AND m.meta_value <> ''"
		);
		// phpcs:enable
		foreach ( (array) $rows as $parent ) {
			self::$priced[ (int) $parent ] = true;
		}
	}

	/** For the tests, which need two products measured in one process. */
	public static function forget(): void {
		self::$priced = array();
		self::$usable = null;
	}
}
