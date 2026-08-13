<?php
/**
 * Which studio garment a WooCommerce product is.
 *
 * The studio knows `tee`, `hoodie` and `custom`. WooCommerce knows product
 * 412. Something has to join the two, and where that mapping lives decides how
 * it fails.
 *
 * IT LIVES ON THE PRODUCT, as post meta `_teeshoop_garment`. Three reasons, and
 * the third is why it is not negotiable:
 *
 *   It is a property OF the product, in the same sense as its weight. A shop
 *   manager who duplicates a t-shirt gets the mapping duplicated with it; one
 *   who exports the catalogue exports it; one who restores a backup restores
 *   it. An option holding a map of product id to garment survives none of that,
 *   and drifts silently the first time a product is added by someone who never
 *   heard of the map.
 *
 *   WordPress can query it. `meta_query` on `_teeshoop_garment` answers "which
 *   products are personalisable", which the catalogue, the sitemap and the
 *   production screen all end up wanting. A serialised option cannot be
 *   queried at all.
 *
 *   IT IS A PRICE INPUT, and therefore it must not arrive from a browser. The
 *   garment decides the blank cost: `tee` is 9,50 EUR of base and `custom` is
 *   zero, because with `custom` the customer ships their own shirt. Before this
 *   file existed `Cart::add` took the garment from the add-to-cart body and
 *   checked only that it was a garment the config knew, so a request naming
 *   `custom` on a hoodie product bought a 27,00 EUR blank for nothing. The
 *   product is the authority; the request is a claim, and a claim that
 *   disagrees is refused rather than quietly corrected, because a disagreement
 *   means the page and the studio are selling two different things.
 *
 * A product with no declared garment is not personalisable. That is a decision,
 * not an oversight: the alternative is to fall back to the request, which is
 * the hole above with a longer fuse.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class Product {

	/**
	 * Underscore-prefixed: this is machinery, not a customer-visible attribute,
	 * so it stays out of the product's public custom-field list.
	 */
	public const META = '_teeshoop_garment';

	public static function init(): void {
		add_action( 'woocommerce_product_options_general_product_data', array( self::class, 'field' ) );
		add_action( 'woocommerce_admin_process_product_object', array( self::class, 'save' ) );
	}

	/**
	 * The studio garment this product is, or '' when it is not personalisable.
	 *
	 * Never guesses. An unknown or removed garment key reads as '' rather than
	 * as the first one in the config, because pricing a hoodie as a t-shirt is
	 * worse than refusing the line.
	 */
	public static function garment_of( int $product_id ): string {
		if ( $product_id <= 0 ) {
			return '';
		}
		$raw = get_post_meta( $product_id, self::META, true );
		if ( ! is_string( $raw ) || '' === $raw ) {
			return '';
		}
		$key    = sanitize_key( $raw );
		$config = Settings::pricing();
		return isset( $config['garments'][ $key ] ) ? $key : '';
	}

	/** The choices a shop manager sees, built from the price config itself. */
	private static function choices(): array {
		$out = array( '' => __( 'Non personnalisable', 'teeshoop' ) );
		foreach ( array_keys( Settings::pricing()['garments'] ) as $key ) {
			$out[ $key ] = $key;
		}
		return $out;
	}

	/** The field on the product edit screen, under General. */
	public static function field(): void {
		woocommerce_wp_select(
			array(
				'id'          => self::META,
				'label'       => __( 'Vêtement Teeshoop', 'teeshoop' ),
				'description' => __( 'Le vêtement du studio que cet article représente. Il décide du prix du textile nu, il est donc lu ici et jamais dans la requête qui ajoute la ligne.', 'teeshoop' ),
				'desc_tip'    => true,
				'options'     => self::choices(),
			)
		);
	}

	/**
	 * Save it through the product object.
	 *
	 * `$product->update_meta_data()` rather than `update_post_meta()`: the CRUD
	 * is what keeps this working under High-Performance Order Storage and what
	 * the plugin already declares compatibility with.
	 */
	public static function save( \WC_Product $product ): void {
		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- Woo verified the product-edit nonce before this hook.
		$raw = isset( $_POST[ self::META ] ) ? sanitize_key( wp_unslash( (string) $_POST[ self::META ] ) ) : '';
		$config = Settings::pricing();
		$product->update_meta_data( self::META, isset( $config['garments'][ $raw ] ) ? $raw : '' );
	}
}
