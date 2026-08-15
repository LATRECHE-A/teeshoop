<?php
/**
 * The shop's own vocabulary: French categories and filterable attributes.
 *
 * GLOBAL ATTRIBUTES, NOT PER-PRODUCT ONES, and that is the whole point of this
 * file. WooCommerce lets a product carry local attributes, which is one less
 * table and no setup at all; it also means "Noir" on one product and "Noir" on
 * another are two unrelated strings, so nothing can filter, nothing can be
 * counted, and the navigation session 09 builds would have nothing to hang off.
 * A global attribute is a taxonomy: 442 colour terms shared by 463 products,
 * queryable, countable, and addressable by URL.
 *
 * WHAT THIS COSTS, MEASURED on the full catalogue rather than estimated: 615
 * terms and 13 699 term relationships for 462 products and 26 399 articles.
 *
 * The estimate written here first was 55 000 relationships, "two per variation,
 * colour and size". That was wrong, and wrong in an instructive direction: a
 * VARIATION does not carry terms at all. WooCommerce stores its chosen colour
 * and size as post meta (`attribute_pa_couleur`), and only the PARENT product is
 * joined to the taxonomy. So the cost scales with products and their attribute
 * values, not with the article count, which is why 26 399 articles cost 13 699
 * rows and not four times that.
 *
 * THE SIZE ORDER IS OURS. WooCommerce sorts attribute terms alphabetically
 * unless told otherwise, which puts 2XL before S and XS after XL. The supplier's
 * own `sku_size_order` cannot fix it because it is per style and not comparable
 * across them ("S" is 1, 2 or 3 depending on where the style's run starts), so
 * the attribute is set to `menu_order` and every term gets a rank from
 * `Catalogue::size_rank()`.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class Taxonomy {

	/** Cache of attribute slug → taxonomy name, for one request. */
	private static array $taxonomies = array();

	/**
	 * Cache of "taxonomy\nterm name" → [id, slug], for one process.
	 *
	 * MEASURED, not defensive. `get_term_by( 'name', … )` is not cached by
	 * WordPress — every call is a `WP_Term_Query` — and the catalogue asks for
	 * the same names over and over: "Black" is a colourway on 358 of the 463
	 * styles and "M" is a size on nearly all of them. Profiling one style's
	 * import put 69 of its 541 queries in `get_term_by` alone, and a full run is
	 * 463 styles. The cache is per process, so a cron slot that ends releases it
	 * and the next one re-reads; nothing here can serve a stale term across
	 * requests.
	 */
	private static array $terms = array();

	/**
	 * Create the attributes the catalogue needs, once.
	 *
	 * Idempotent: an attribute that exists is left alone. Returns the list of
	 * slugs it had to create, so the importer can say what it changed.
	 */
	public static function ensure_attributes(): array {
		$existing = array();
		foreach ( wc_get_attribute_taxonomies() as $tax ) {
			$existing[ $tax->attribute_name ] = true;
		}

		$created = array();
		foreach ( Catalogue::ATTRIBUTES as $slug => $spec ) {
			if ( isset( $existing[ $slug ] ) ) {
				continue;
			}
			$result = wc_create_attribute(
				array(
					'name'         => $spec['label'],
					'slug'         => $slug,
					// Sizes must sort by our rank; everything else reads better
					// alphabetically, and a colour list in creation order is a
					// list nobody can scan.
					'order_by'     => 'taille' === $slug ? 'menu_order' : 'name',
					'has_archives' => false,
					'type'         => 'select',
				)
			);
			if ( is_wp_error( $result ) ) {
				continue;
			}
			$created[] = $slug;
		}

		if ( ! empty( $created ) ) {
			/*
			 * WooCommerce caches the attribute list in a transient and
			 * registers the taxonomies from it on `init`, which already ran.
			 * Without both of these an attribute created in this process exists
			 * in the database and does not exist to `wp_set_object_terms`, so
			 * every term assignment in the same run silently does nothing.
			 */
			delete_transient( 'wc_attribute_taxonomies' );
			\WC_Cache_Helper::invalidate_cache_group( 'woocommerce-attributes' );
			self::register_now();
		}

		return $created;
	}

	/**
	 * Register the attribute taxonomies in THIS process.
	 *
	 * WooCommerce does this on `init`; a WP-CLI command that creates an
	 * attribute afterwards has to do it itself or work with taxonomies that are
	 * not there yet.
	 */
	public static function register_now(): void {
		foreach ( wc_get_attribute_taxonomies() as $tax ) {
			$name = wc_attribute_taxonomy_name( $tax->attribute_name );
			if ( taxonomy_exists( $name ) ) {
				continue;
			}
			register_taxonomy(
				$name,
				array( 'product', 'product_variation' ),
				array(
					'hierarchical' => false,
					'show_ui'      => false,
					'query_var'    => true,
					'rewrite'      => false,
					'public'       => true,
					'label'        => $tax->attribute_label,
				)
			);
		}
	}

	/** `couleur` → `pa_couleur`, memoised. */
	public static function taxonomy( string $slug ): string {
		if ( ! isset( self::$taxonomies[ $slug ] ) ) {
			self::$taxonomies[ $slug ] = wc_attribute_taxonomy_name( $slug );
		}
		return self::$taxonomies[ $slug ];
	}

	/**
	 * Term ids for a list of term NAMES, creating what is missing.
	 *
	 * Matches on the name and not on a slug computed from it: "Off White" and
	 * "off-white" would be two terms otherwise, and the supplier's colour names
	 * carry accents, slashes and parentheses that several different names
	 * sanitise to the same slug. `get_term_by('name')` is the identity here, and
	 * the slug is only ever a URL.
	 *
	 * Both the id and the slug come back, because WooCommerce needs each in a
	 * different place: a product's attribute options are term IDS, while a
	 * variation's chosen attribute is a term SLUG. Getting that backwards
	 * produces a variation that exists and can never be selected.
	 *
	 * @param string   $slug  Attribute slug, e.g. 'couleur'.
	 * @param string[] $names Term names, as the supplier writes them.
	 * @return array<string,array{id:int,slug:string}> Keyed by name, in order.
	 */
	public static function terms( string $slug, array $names ): array {
		$taxonomy = self::taxonomy( $slug );
		if ( ! taxonomy_exists( $taxonomy ) ) {
			return array();
		}

		$out = array();
		foreach ( $names as $name ) {
			$name = trim( (string) $name );
			if ( '' === $name || isset( $out[ $name ] ) ) {
				continue;
			}

			$memo = $taxonomy . "\n" . $name;
			if ( isset( self::$terms[ $memo ] ) ) {
				$out[ $name ] = self::$terms[ $memo ];
				continue;
			}

			$term = get_term_by( 'name', $name, $taxonomy );
			if ( ! $term instanceof \WP_Term ) {
				$made = wp_insert_term( $name, $taxonomy );
				if ( is_wp_error( $made ) ) {
					/*
					 * Two different names can sanitise to the same slug —
					 * "Off White" and "off/white" both give "off-white" — and
					 * WordPress refuses the second. `term_exists` in the error
					 * data is the term that won; re-reading by id keeps the
					 * import going with a real term instead of dropping a
					 * colour and silently shortening the product's range.
					 */
					$data = $made->get_error_data();
					$id   = is_array( $data ) ? (int) ( $data['term_id'] ?? 0 ) : (int) $data;
					$term = $id > 0 ? get_term( $id, $taxonomy ) : null;
					if ( ! $term instanceof \WP_Term ) {
						continue;
					}
				} else {
					$term = get_term( (int) $made['term_id'], $taxonomy );
					if ( ! $term instanceof \WP_Term ) {
						continue;
					}
				}
			}

			if ( 'taille' === $slug ) {
				self::rank_size( (int) $term->term_id, $taxonomy, $name );
			}

			$out[ $name ]        = array(
				'id'   => (int) $term->term_id,
				'slug' => (string) $term->slug,
			);
			self::$terms[ $memo ] = $out[ $name ];
		}

		return $out;
	}

	/**
	 * Give a size term its position, in the term meta WooCommerce reads.
	 *
	 * Written only when it differs, because this runs for every size of every
	 * style: 26 399 variations would otherwise mean 26 399 pointless writes.
	 */
	private static function rank_size( int $term_id, string $taxonomy, string $name ): void {
		$key     = 'order_' . $taxonomy;
		$want    = (string) Catalogue::size_rank( $name );
		$current = get_term_meta( $term_id, $key, true );
		if ( (string) $current !== $want ) {
			update_term_meta( $term_id, $key, $want );
		}
	}

	/**
	 * The product category term for a path like ['T-shirts', 'Manches courtes'].
	 *
	 * Creates each level under the previous one and returns the DEEPEST term id,
	 * which is the only one to assign: WooCommerce and WordPress both walk the
	 * ancestors themselves for archives and breadcrumbs, and assigning both
	 * levels makes every parent archive count its children twice.
	 */
	public static function category_id( array $path ): int {
		$parent = 0;
		foreach ( $path as $name ) {
			$name = trim( (string) $name );
			if ( '' === $name ) {
				continue;
			}
			$term = get_term_by( 'name', $name, 'product_cat' );
			if ( $term instanceof \WP_Term && (int) $term->parent === $parent ) {
				$parent = (int) $term->term_id;
				continue;
			}
			$made = wp_insert_term( $name, 'product_cat', array( 'parent' => $parent ) );
			if ( is_wp_error( $made ) ) {
				$existing = $made->get_error_data();
				if ( is_int( $existing ) ) {
					$parent = $existing;
					continue;
				}
				if ( is_array( $existing ) && isset( $existing['term_id'] ) ) {
					$parent = (int) $existing['term_id'];
					continue;
				}
				return $parent;
			}
			$parent = (int) $made['term_id'];
		}
		return $parent;
	}
}
