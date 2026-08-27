<?php
/**
 * The listing shortcut, held against WooCommerce's own answer.
 *
 * `Teeshoop\Core\VariableProduct` skips WooCommerce's variation sweep for a
 * reference on which no variation carries a price. The whole argument for it is
 * that the sweep cannot change the answer in that case, so the only thing worth
 * testing is exactly that: for the same product, do the two classes say the same
 * thing.
 *
 * A pure test cannot ask this. The sweep is a data store, a transient, a term
 * query and a title generator, so the two answers only exist inside a real
 * WooCommerce with real variations under a real parent.
 *
 * IT ALSO PROVES THE SHORTCUT FIRES, and that matters as much as the parity: a
 * test that only compared outputs would stay green with the whole optimisation
 * deleted. The reading used is `$wpdb->num_queries` around each call, for the
 * reason written beside it: the obvious instrument, counting variation objects
 * built, is blind under WooCommerce 11's product instance cache.
 *
 * Run from integration.php, which owns the bootstrap.
 *
 * @package Teeshoop\Core
 */

/* COMMAND LINE ONLY. See run.php. */
if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

use Teeshoop\Core\Listing;
use Teeshoop\Core\VariableProduct;

/**
 * A variable product with three variations, priced or not.
 *
 * Returns the parent id. The caller deletes it.
 */
function ts_listing_product( string $name, bool $priced ): int {
	$attribute = new WC_Product_Attribute();
	$attribute->set_id( 0 );
	$attribute->set_name( 'Taille' );
	$attribute->set_options( array( 'S', 'M', 'L' ) );
	$attribute->set_visible( true );
	$attribute->set_variation( true );

	$parent = new WC_Product_Variable();
	$parent->set_name( $name );
	$parent->set_status( 'publish' );
	$parent->set_catalog_visibility( 'visible' );
	$parent->set_attributes( array( $attribute ) );
	$parent_id = (int) $parent->save();

	foreach ( array( 'S', 'M', 'L' ) as $size ) {
		$variation = new WC_Product_Variation();
		$variation->set_parent_id( $parent_id );
		$variation->set_status( 'publish' );
		$variation->set_attributes( array( 'taille' => $size ) );
		if ( $priced ) {
			$variation->set_regular_price( '12.00' );
		}
		$variation->save();
	}
	WC_Product_Variable::sync( $parent_id );
	Listing::forget();

	return $parent_id;
}

/** Delete a parent and everything under it. */
function ts_listing_delete( int $parent_id ): void {
	global $wpdb;
	$children = $wpdb->get_col( $wpdb->prepare( "SELECT ID FROM {$wpdb->posts} WHERE post_parent = %d AND post_type = 'product_variation'", $parent_id ) );
	foreach ( $children as $child ) {
		wp_delete_post( (int) $child, true );
	}
	wp_delete_post( $parent_id, true );
}

function ts_listing_suite(): void {
	global $wpdb;

	$unpriced = ts_listing_product( 'Banc de listing, sans prix', false );
	$priced   = ts_listing_product( 'Banc de listing, avec prix', true );

	/*
	 * THE PREMISE, ASSERTED RATHER THAN ASSUMED, AND IN BOTH ITS SHAPES.
	 *
	 * "No price" reaches the database two different ways and the shortcut has to
	 * survive both. A variation saved through the WooCommerce API with no price
	 * gets NO `_price` row at all; the catalogue importer writes a row and leaves
	 * it empty (measured on the mirror: 159 rows under B&C #E150 /women, every
	 * value empty). So two of these three are given the importer's shape on
	 * purpose. If a future WooCommerce writes '0' instead, this assertion is what
	 * goes red, rather than a page quietly going slow again.
	 */
	$kids = array_map( 'intval', $wpdb->get_col( $wpdb->prepare( "SELECT ID FROM {$wpdb->posts} WHERE post_parent = %d AND post_type = 'product_variation' ORDER BY ID", $unpriced ) ) );
	update_post_meta( $kids[0], '_price', '' );
	update_post_meta( $kids[1], '_price', '' );
	Listing::forget();

	$shapes = array(
		'rows_present_and_empty' => (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$wpdb->postmeta} m INNER JOIN {$wpdb->posts} p ON p.ID = m.post_id WHERE p.post_parent = %d AND m.meta_key = '_price' AND m.meta_value = ''", $unpriced ) ),
		'rows_with_a_price'      => (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$wpdb->postmeta} m INNER JOIN {$wpdb->posts} p ON p.ID = m.post_id WHERE p.post_parent = %d AND m.meta_key = '_price' AND m.meta_value <> ''", $unpriced ) ),
		'variations'             => count( $kids ),
	);
	ts_it(
		'sees no price whether the meta row is missing or present and empty',
		function () use ( $shapes, $unpriced ) {
			ts_eq( $shapes['variations'], 3, 'variations created' );
			ts_eq( $shapes['rows_present_and_empty'], 2, 'variations carrying an empty _price row' );
			ts_eq( $shapes['rows_with_a_price'], 0, 'variations carrying a price' );
			ts_eq( Listing::has_priced_variation( $unpriced ), false, 'the shortcut\'s own predicate' );
		}
	);

	// -------------------------------------------------------------------
	// The class actually swaps in. Without this every parity assertion below
	// would be comparing WooCommerce against itself.
	// -------------------------------------------------------------------
	ts_it(
		'wc_get_product hands back our variable product, not WooCommerce\'s',
		function () use ( $unpriced ) {
			$product = wc_get_product( $unpriced );
			ts_assert( $product instanceof VariableProduct, 'expected Teeshoop\\Core\\VariableProduct, got ' . get_class( $product ) );
			ts_assert( $product instanceof WC_Product_Variable, 'it must still be a WC_Product_Variable' );
			ts_eq( $product->get_type(), 'variable', 'the product type WooCommerce reports' );
		}
	);

	// -------------------------------------------------------------------
	// Parity, unpriced: the case the shortcut exists for.
	// -------------------------------------------------------------------
	/*
	 * THE INSTRUMENT IS THE QUERY COUNTER, and that is a correction.
	 *
	 * The obvious counter, one `woocommerce_product_class` call per variation
	 * built, reads zero for BOTH classes and would have made this assertion
	 * vacuous: WooCommerce 11 ships `product_instance_caching`, so a variation
	 * already built once in this process is handed back from
	 * `ProductCache` without the factory filter firing at all. Measured before
	 * this comment was written. `$wpdb->num_queries` cannot be fooled that way,
	 * and the difference it reports is the one the page actually pays.
	 */
	$ours = wc_get_product( $unpriced );
	Listing::has_priced_variation( $unpriced ); // prime, outside the window

	$before      = $wpdb->num_queries;
	$our_sale    = $ours->is_on_sale();
	$our_html    = $ours->get_price_html();
	$our_queries = $wpdb->num_queries - $before;

	wc_set_loop_prop( 'loop', 0 );
	$our_class = wc_get_product_class( '', $ours );

	$reference   = new WC_Product_Variable( $unpriced );
	delete_transient( 'wc_var_prices_' . $unpriced );
	$before      = $wpdb->num_queries;
	$ref_sale    = $reference->is_on_sale();
	$ref_html    = $reference->get_price_html();
	$ref_queries = $wpdb->num_queries - $before;

	wc_set_loop_prop( 'loop', 0 );
	$ref_class = wc_get_product_class( '', $reference );

	ts_it(
		'says the same thing as WooCommerce about a reference with no price',
		function () use ( $our_sale, $ref_sale, $our_html, $ref_html ) {
			ts_eq( $our_sale, $ref_sale, 'is_on_sale' );
			ts_eq( $our_sale, false, 'a reference with no price is not on sale' );
			ts_eq( $our_html, $ref_html, 'get_price_html' );
			ts_eq( $our_html, '', 'a reference with no price prints no price' );
		}
	);

	ts_it(
		'produces the same <li> classes, so the markup is untouched',
		function () use ( $our_class, $ref_class ) {
			ts_eq( implode( ' ', $our_class ), implode( ' ', $ref_class ), 'wc_get_product_class' );
			ts_assert( in_array( 'product-type-variable', $our_class, true ), 'the variable type class survives' );
			ts_assert( ! in_array( 'sale', $our_class, true ), 'nothing unpriced may be marked as on sale' );
		}
	);

	/*
	 * THE PROOF THAT ANY OF THIS IS DOING ANYTHING.
	 *
	 * Delete the two overrides and every assertion above still passes; this one
	 * is what goes red. Three variations is the smallest case there is and it
	 * already costs WooCommerce several queries; the reference measured on the
	 * mirror has 159 and costs 807 ms.
	 */
	ts_it(
		'answers both questions without asking the database anything',
		function () use ( $our_queries, $ref_queries ) {
			ts_eq( $our_queries, 0, 'queries our class ran to answer both' );
			ts_assert( $ref_queries >= 3, "WooCommerce ran {$ref_queries} queries for the same two answers" );
		}
	);

	// -------------------------------------------------------------------
	// Parity, priced: the case the shortcut must keep its hands off.
	// -------------------------------------------------------------------
	ts_it(
		'stands aside entirely once a variation carries a price',
		function () use ( $priced ) {
			Listing::forget();
			delete_transient( 'wc_var_prices_' . $priced );
			$ours = wc_get_product( $priced );
			$our_sale = $ours->is_on_sale();
			$our_html = $ours->get_price_html();

			Listing::forget();
			delete_transient( 'wc_var_prices_' . $priced );
			$reference = new WC_Product_Variable( $priced );
			ts_eq( $our_sale, $reference->is_on_sale(), 'is_on_sale on a priced reference' );
			ts_eq( $our_html, $reference->get_price_html(), 'get_price_html on a priced reference' );
			ts_assert( '' !== $our_html, 'a priced reference must print a price, and printed: ' . var_export( $our_html, true ) );
		}
	);

	// -------------------------------------------------------------------
	// And it refuses to answer at all when something else could be putting a
	// price on a variation that has no _price row.
	// -------------------------------------------------------------------
	ts_it(
		'refuses the shortcut when a filter could be inventing prices',
		function () use ( $unpriced ) {
			Listing::forget();
			ts_eq( Listing::has_priced_variation( $unpriced ), false, 'with no filter registered' );

			$inject = static function ( $price ) {
				return '' === $price ? '9.99' : $price;
			};
			add_filter( 'woocommerce_variation_prices_price', $inject );
			Listing::forget();
			ts_eq( Listing::has_priced_variation( $unpriced ), null, 'with woocommerce_variation_prices_price registered' );

			/*
			 * And the value that comes out is WooCommerce's, injected price and
			 * all, rather than our empty answer. This is the assertion that
			 * would catch a stand-down that stood down in name only.
			 */
			$product = wc_get_product( $unpriced );
			delete_transient( 'wc_var_prices_' . $unpriced );
			$html = $product->get_price_html();
			remove_filter( 'woocommerce_variation_prices_price', $inject );
			Listing::forget();

			ts_assert( '' !== $html, 'the injected price must reach the page, and instead nothing was printed' );
			ts_assert( false !== strpos( wp_strip_all_tags( $html ), '9,99' ), 'expected 9,99 in ' . wp_strip_all_tags( $html ) );
		}
	);

	ts_listing_delete( $unpriced );
	ts_listing_delete( $priced );
	Listing::forget();

	ts_it(
		'leaves nothing behind',
		function () use ( $unpriced, $priced ) {
			global $wpdb;
			$left = (int) $wpdb->get_var(
				$wpdb->prepare(
					"SELECT COUNT(*) FROM {$wpdb->posts} WHERE ID IN ( %d, %d ) OR post_parent IN ( %d, %d )",
					$unpriced,
					$priced,
					$unpriced,
					$priced
				)
			);
			ts_eq( $left, 0, 'rows left by this suite' );
		}
	);
}
