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

use Teeshoop\Core\Content;
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

/** The family, the sub-family and the references the counting case files. */
function ts_listing_family_cleanup(): void {
	foreach ( get_posts( array( 'post_type' => 'product', 'post_status' => 'any', 's' => 'Référence du harnais', 'fields' => 'ids', 'posts_per_page' => 50 ) ) as $id ) {
		wp_delete_post( (int) $id, true );
	}
	foreach ( array( 'ts-sous-famille-harnais', 'ts-famille-harnais' ) as $slug ) {
		$term = get_term_by( 'slug', $slug, 'product_cat' );
		if ( $term instanceof \WP_Term ) {
			wp_delete_term( (int) $term->term_id, 'product_cat' );
		}
	}
}

function ts_listing_suite(): void {
	/*
	 * THE-01. The homepage tile of a family added each child's raw count to a
	 * parent count WooCommerce had already rolled up, so a reference filed under
	 * a sub-category was counted twice: 368 on the tile, 190 on the page.
	 */
	/*
	 * THE-02. « Prix croissant » sorted on a price nobody is shown, and put
	 * every unpriced reference first. Neither the control nor an old address
	 * may reach it now.
	 */
	/*
	 * THE-03. The family texts are keyed by the mirror's slugs, and production
	 * inherited others from the old site: /categorie/sweatshirts/ rendered its
	 * bare name, and the shop page lost its links to polos and sweats.
	 */
	/*
	 * THE-09. The sort posted to the current URL, so a sort chosen on page 3
	 * opened page 3 of the new order. Both listing forms submit to page one.
	 */
	ts_it(
		'says « Voir le vêtement » on a garment nothing can buy, and keeps its name containing it',
		function () {
			/*
			 * « Sélectionner les options » on an unpriced catalogue garment led to
			 * a page where no option buys anything. The accessible name must still
			 * contain the visible words (WCAG 2.5.3).
			 */
			$unpriced = ts_listing_product( 'ZZ Vêtement sans prix', false );
			$priced   = ts_listing_product( 'ZZ Vêtement avec prix', true );
			try {
				$a = wc_get_product( $unpriced );
				$b = wc_get_product( $priced );
				ts_eq( $a->add_to_cart_text(), 'Voir le vêtement', 'the button of an unpriced garment' );
				ts_assert( str_contains( $a->add_to_cart_description(), 'Voir le vêtement' ), 'its accessible name no longer contains its visible text' );
				ts_eq( $b->add_to_cart_text(), 'Sélectionner les options', 'a garment that can be bought keeps its choice of options' );
			} finally {
				ts_listing_delete( $unpriced );
				ts_listing_delete( $priced );
			}
		}
	);

	ts_it(
		'sends a sort or a filter chosen on page 3 back to the first page',
		function () {
			$kept                   = $_SERVER['REQUEST_URI'] ?? '';
			$_SERVER['REQUEST_URI'] = '/categorie/t-shirts/page/3/?orderby=date';
			$action                 = \Teeshoop\Theme\listing_action();
			$_SERVER['REQUEST_URI'] = $kept;
			ts_eq( $action, home_url( '/categorie/t-shirts/' ), 'the listing form kept the page number' );
		}
	);

	/*
	 * THE-07 and THE-12. A garment retired from the range has no price: it must
	 * not be the homepage's reference garment, and a garment out of stock must
	 * not be published to search engines as in stock.
	 */
	ts_it(
		'keeps a retired garment off the homepage, and says out of stock to search engines',
		function () {
			$make = static function ( string $name, string $price, int $order ): \WC_Product_Simple {
				$p = new WC_Product_Simple();
				$p->set_name( $name );
				$p->set_status( 'publish' );
				$p->set_catalog_visibility( 'visible' );
				$p->set_menu_order( $order );
				$p->set_regular_price( $price );
				$p->set_image_id( 1 );
				// A weight, or no piece ships and no offer is published at all.
				$p->set_weight( '0.18' );
				$p->save();
				update_post_meta( $p->get_id(), \Teeshoop\Core\Product::META, 'tee' );
				return $p;
			};
			$retired = $make( 'Vêtement retiré du harnais', '', -700 );
			$sold    = $make( 'Vêtement en vente du harnais', '9.00', -699 );
			try {
				$hero = \Teeshoop\Theme\hero_product();
				ts_assert( $hero instanceof \WC_Product, 'no reference garment at all' );
				ts_eq( $hero->get_id(), $sold->get_id(), 'the homepage described a garment the checkout refuses' );

				$sold->set_stock_status( 'outofstock' );
				$sold->save();
				$markup = \Teeshoop\Core\ProductPage::structured_data( array(), wc_get_product( $sold->get_id() ) );
				ts_assert( isset( $markup['offers'][0] ), 'no offer was published, so this proves nothing' );
				ts_eq( $markup['offers'][0]['availability'], 'https://schema.org/OutOfStock', 'an out-of-stock garment was published in stock' );
			} finally {
				wp_delete_post( $retired->get_id(), true );
				wp_delete_post( $sold->get_id(), true );
			}
		}
	);

	ts_it(
		'finds a family text and its link by the family name when the slug is the old site one',
		function () {
			// Production's own slug. An existing « Sweats » is borrowed and put back.
			$existing = null;
			foreach ( get_terms( array( 'taxonomy' => 'product_cat', 'parent' => 0, 'hide_empty' => false ) ) as $t ) {
				if ( 'Sweats' === $t->name ) {
					$existing = $t;
				}
			}
			if ( $existing ) {
				$kept_slug = $existing->slug;
				wp_update_term( $existing->term_id, 'product_cat', array( 'slug' => 'sweatshirts-harnais' ) );
				$id = (int) $existing->term_id;
			} else {
				$made = wp_insert_term( 'Sweats', 'product_cat', array( 'slug' => 'sweatshirts-harnais' ) );
				ts_assert( ! is_wp_error( $made ), 'the family could not be created' );
				$id = (int) $made['term_id'];
			}
			// A child of another family that happens to carry a family's name.
			$host  = wp_insert_term( 'Hôte du harnais', 'product_cat', array( 'slug' => 'ts-hote-harnais' ) );
			$child = wp_insert_term( 'Polos', 'product_cat', array( 'slug' => 'ts-polos-enfant-harnais', 'parent' => $host['term_id'] ) );

			try {
				$term = get_term( $id, 'product_cat' );
				ts_eq( Content::url_for( 'categorie:sweats' ), (string) get_term_link( $term ), 'the link to the family went missing' );
				ts_eq( Content::category_key( $term ), 'categorie:sweats', 'the family was not recognised by its name' );
				ts_eq(
					Content::category_key( get_term( (int) $child['term_id'], 'product_cat' ) ),
					'categorie:ts-polos-enfant-harnais',
					'a sub-category took a family text because of its name'
				);
				$tshirts = get_term_by( 'slug', 't-shirts', 'product_cat' );
				if ( $tshirts instanceof \WP_Term ) {
					ts_eq( Content::category_key( $tshirts ), 'categorie:t-shirts', 'a slug that matches must keep matching' );
				}
			} finally {
				wp_delete_term( (int) $child['term_id'], 'product_cat' );
				wp_delete_term( (int) $host['term_id'], 'product_cat' );
				if ( $existing ) {
					wp_update_term( $id, 'product_cat', array( 'slug' => $kept_slug ) );
				} else {
					wp_delete_term( $id, 'product_cat' );
				}
			}
		}
	);

	ts_it(
		'offers no sort by price, and gives an address that asks for one the default order',
		function () {
			ob_start();
			\Teeshoop\Theme\sort_control();
			$form = (string) ob_get_clean();
			ts_assert( false !== strpos( $form, 'value="date"' ), 'the sort control did not render, so it proves nothing' );
			ts_assert( false === strpos( $form, 'value="price' ), 'the control still offers a sort by price' );

			foreach ( array( 'price', 'price-desc', 'PRICE' ) as $asked ) {
				$_GET['orderby'] = $asked;
				$wp              = new \WP();
				$wp->query_vars  = array( 'orderby' => $asked );
				do_action( 'parse_request', $wp );
				$args = WC()->query->get_catalog_ordering_args();
				WC()->query->remove_ordering_args();
				ts_assert( ! isset( $_GET['orderby'] ) && ! isset( $wp->query_vars['orderby'] ), "« {$asked} » survived the request" );
				ts_assert( false === strpos( (string) $args['orderby'], 'price' ), "« {$asked} » still sorted by price" );
			}
			unset( $_GET['orderby'] );

			// A default somebody set to price in WooCommerce's settings is the same lie.
			$kept = get_option( 'woocommerce_default_catalog_orderby' );
			update_option( 'woocommerce_default_catalog_orderby', 'price' );
			$args = WC()->query->get_catalog_ordering_args();
			WC()->query->remove_ordering_args();
			update_option( 'woocommerce_default_catalog_orderby', $kept );
			ts_assert( false === strpos( (string) $args['orderby'], 'price' ), 'a default set to price still sorted by price' );
		}
	);

	ts_it(
		'counts a family once, as its own category page does, however its references are filed',
		function () {
			// A run that died before its clean-up must not fail the next one.
			ts_listing_family_cleanup();
			$parent = wp_insert_term( 'Famille du harnais', 'product_cat', array( 'slug' => 'ts-famille-harnais' ) );
			$child  = wp_insert_term( 'Sous-famille du harnais', 'product_cat', array( 'slug' => 'ts-sous-famille-harnais', 'parent' => $parent['term_id'] ) );
			foreach ( array( $child['term_id'], $child['term_id'], $parent['term_id'] ) as $n => $term_id ) {
				$p = new WC_Product_Simple();
				$p->set_name( 'Référence du harnais ' . $n );
				$p->set_status( 'publish' );
				$p->set_catalog_visibility( 'visible' );
				$p->set_category_ids( array( (int) $term_id ) );
				$p->save();
			}
			// What the deferred count at the end of an import runs.
			wc_recount_all_terms();

			$page = count( wc_get_products( array( 'category' => array( 'ts-famille-harnais' ), 'status' => 'publish', 'limit' => -1, 'return' => 'ids' ) ) );
			ts_eq( $page, 3, 'the category page itself must see the three references' );

			$tile = null;
			foreach ( \Teeshoop\Theme\top_categories() as $term ) {
				if ( 'ts-famille-harnais' === $term->slug ) {
					$tile = \Teeshoop\Theme\family_count( $term );
				}
			}
			ts_listing_family_cleanup();
			ts_eq( $tile, $page, 'the family tile and its category page disagree' );
		}
	);

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
