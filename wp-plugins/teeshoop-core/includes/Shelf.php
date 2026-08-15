<?php
/**
 * What an imported reference does once it is on the shelf.
 *
 * Two jobs, and the first one is the reason this file exists.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. THE PURCHASE PRICE LEAVES BY NO DOOR
 *
 * It is stored on the variation as post meta, which is the right place for it:
 * it is a property of that article, it survives an export of the catalogue, and
 * a query can find it. It is also, by default, a field WooCommerce is perfectly
 * happy to hand out.
 *
 * An underscore prefix is NOT the seal. It makes WordPress call the meta
 * "protected", which hides it from the product editor's custom-field box and
 * from nothing else. `WC_Data::get_meta_data()` returns it, so the REST API
 * returns it, so a read-only WooCommerce key (the kind you hand to an
 * analytics tool or a stock plugin) reads our margin on every article we sell.
 * Two such keys already exist on the production shop.
 *
 * So the doors are closed one by one, and every one of them is a real door
 * somebody has opened by accident on a real shop:
 *
 *   · `wc/v3/products` and `wc/v3/products/{id}/variations`, the authenticated
 *     REST API. The filters below strip the meta from the response.
 *   · The product CSV exporter, whose "export custom meta" checkbox is one
 *     click away in the admin.
 *   · `woocommerce_available_variation`, the JSON the add-to-cart form sends to
 *     the browser for every variation. It carries a fixed set of keys today;
 *     the filter below adds one (the colour photo) and is where a future "just
 *     pass the meta through" would land, so the stripping is asserted there too.
 *   · The order-item display, for the day a line does carry it.
 *
 * The supplier's own article number goes out the same doors for a different
 * reason: it is a searchable fingerprint of who we buy from, which is exactly
 * what `scripts/php-guard.mjs` exists to keep off a customer surface.
 *
 * WHAT IS NOT DEFENDED HERE, deliberately: anyone with `manage_woocommerce` can
 * read the database. This is a boundary against the shop's own outward-facing
 * surfaces and against integrations, not against its administrators.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 2. THE COLOUR PHOTO, WITHOUT AN ATTACHMENT
 *
 * 4 241 per-colour photographs are not copied into the media library (the
 * arithmetic is in Catalogue.php). WooCommerce swaps the product image when a
 * variation is chosen by reading an `image` object out of the variation JSON,
 * and it never checks that there is an attachment behind it. So the URL stored
 * on the variation is injected into that object and the photo swaps, at no
 * disk cost, on both the inline and the AJAX path.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class Shelf {

	/**
	 * Meta that must never leave the shop.
	 *
	 * Listed here rather than pattern-matched on a prefix: a prefix rule would
	 * quietly cover a future key nobody thought about, which sounds like a
	 * feature until the key that needed covering is the one that got renamed.
	 */
	private const SEALED = array(
		Catalogue::META_SUPPLY_CENTS,
		Catalogue::META_SUPPLY_SKU,
		/*
		 * The style number belongs here for the same reason as the article
		 * number, and it was missed. The article number is
		 * `styleNr . colourCode . one digit`, so anything that publishes the
		 * style number publishes most of the sealed value. It was going out
		 * through `meta_data` on every REST product and every CSV export while
		 * the seal beside it held.
		 */
		Catalogue::META_REF,
	);

	public static function init(): void {
		foreach ( array( 'product', 'product_variation' ) as $type ) {
			add_filter( "woocommerce_rest_prepare_{$type}_object", array( self::class, 'strip_rest' ), 10, 1 );
		}

		// The CSV exporter's own list of keys to skip. It exists precisely so a
		// plugin can keep its private meta out of a file somebody e-mails.
		add_filter( 'woocommerce_product_export_skip_meta_keys', array( self::class, 'skip_export' ), 10, 1 );

		add_filter( 'woocommerce_available_variation', array( self::class, 'variation_json' ), 10, 3 );

		// Order-item meta is displayed by key unless something hides it. No
		// order line carries these today; this is here so that the day one
		// does, it does not print our margin on a customer's invoice.
		add_filter( 'woocommerce_hidden_order_itemmeta', array( self::class, 'hide_order_itemmeta' ), 10, 1 );

		add_action( 'wp', array( self::class, 'unpriced_notice' ) );
	}

	/**
	 * Say why an imported reference cannot be bought yet, instead of letting
	 * WooCommerce call it unavailable.
	 *
	 * Until somebody sets `blank_margin_rate` (question 42) the importer writes
	 * no price, and a variable product whose variations have no price is not
	 * purchasable. WooCommerce's variation script then answers every colour and
	 * size with "Désolé, ce produit n'est pas disponible. Veuillez choisir une
	 * autre combinaison." That is false twice over: the garment exists, and
	 * choosing a different combination will not help.
	 *
	 * So the add-to-cart form is replaced by the true statement. This is the
	 * shipped default state of the catalogue, not an edge case, and a shop's
	 * default state has to be legible.
	 */
	public static function unpriced_notice(): void {
		if ( ! function_exists( 'is_product' ) || ! is_product() ) {
			return;
		}
		$product = wc_get_product( (int) get_queried_object_id() );
		if ( ! $product instanceof \WC_Product ) {
			return;
		}
		// Imported references only. A shop manager's own unpriced product is
		// their business and WooCommerce's message is the right one for it.
		if ( '' === (string) $product->get_meta( Catalogue::META_REF, true ) || $product->is_purchasable() ) {
			return;
		}

		remove_action( 'woocommerce_single_product_summary', 'woocommerce_template_single_add_to_cart', 30 );
		add_action(
			'woocommerce_single_product_summary',
			static function (): void {
				/*
				 * A way forward, or no instruction at all.
				 *
				 * "Écrivez-nous" with nowhere to write is worse than saying
				 * nothing: it asks the buyer to do something and then makes them
				 * hunt for how. So the sentence only invites contact when there
				 * is somewhere to send them, and otherwise states the fact and
				 * stops. A real contact route for the catalogue is session 09's.
				 */
				$contact = get_page_by_path( 'contact' );
				$url     = $contact instanceof \WP_Post ? get_permalink( $contact ) : '';

				echo '<p class="teeshoop-unpriced">';
				if ( '' === $url ) {
					esc_html_e(
						'Cette référence est au catalogue, son tarif n’est pas encore publié.',
						'teeshoop'
					);
				} else {
					printf(
						'%s <a href="%s">%s</a>',
						esc_html__(
							'Cette référence est au catalogue, son tarif n’est pas encore publié.',
							'teeshoop'
						),
						esc_url( $url ),
						esc_html__( 'Demandez-nous un prix pour votre quantité et vos tailles.', 'teeshoop' )
					);
				}
				echo '</p>';
			},
			30
		);
	}

	/**
	 * Remove the sealed keys from a REST representation.
	 *
	 * `meta_data` is a list of WC_Meta_Data objects, so this filters on each
	 * one's key and reindexes: leaving holes in the array turns a JSON list into
	 * a JSON object, which breaks every client that expected a list.
	 *
	 * @param mixed $response WP_REST_Response, per the filter's contract.
	 */
	public static function strip_rest( $response ) {
		if ( ! $response instanceof \WP_REST_Response ) {
			return $response;
		}
		$data = $response->get_data();
		if ( ! is_array( $data ) || ! isset( $data['meta_data'] ) || ! is_array( $data['meta_data'] ) ) {
			return $response;
		}

		$kept = array();
		foreach ( $data['meta_data'] as $meta ) {
			$key = is_object( $meta ) && method_exists( $meta, 'get_data' )
				? (string) ( $meta->get_data()['key'] ?? '' )
				: (string) ( is_array( $meta ) ? ( $meta['key'] ?? '' ) : '' );
			if ( in_array( $key, self::SEALED, true ) ) {
				continue;
			}
			$kept[] = $meta;
		}

		$data['meta_data'] = $kept;
		$response->set_data( $data );
		return $response;
	}

	/** @param mixed $keys Array of meta keys the exporter will not write. */
	public static function skip_export( $keys ): array {
		return array_merge( is_array( $keys ) ? $keys : array(), self::SEALED );
	}

	/** @param mixed $keys Order item meta keys the admin and the e-mails hide. */
	public static function hide_order_itemmeta( $keys ): array {
		return array_merge( is_array( $keys ) ? $keys : array(), self::SEALED );
	}

	/**
	 * The variation JSON the browser gets: add the colour photo, remove nothing
	 * it should not have had.
	 *
	 * The `image` shape is WooCommerce's own. `srcset` and `sizes` are set to ''
	 * on purpose rather than left out: the variation script writes whatever is
	 * there onto the <img>, and a stale srcset from the previous colour would
	 * make the browser fetch the wrong picture at the wrong width.
	 *
	 * @param mixed $data      The variation array Woo built.
	 * @param mixed $product   The parent product.
	 * @param mixed $variation The variation.
	 */
	public static function variation_json( $data, $product, $variation ): array {
		if ( ! is_array( $data ) ) {
			return array();
		}
		foreach ( self::SEALED as $key ) {
			unset( $data[ $key ] );
		}

		if ( ! $variation instanceof \WC_Product_Variation ) {
			return $data;
		}
		$photo = (string) $variation->get_meta( Catalogue::META_COLOUR_PHOTO, true );
		if ( '' === $photo ) {
			return $data;
		}

		$src = self::photo_url( $photo );
		if ( '' === $src ) {
			return $data;
		}

		/*
		 * `false`, NOT 0, AND THE DIFFERENCE IS WHETHER THE PHOTO IS VISIBLE.
		 *
		 * WooCommerce's variation script writes each of these onto the <img>
		 * through `wc_set_variation_attr`, which removes the attribute when the
		 * value is EXACTLY `false` and sets it otherwise (verified in
		 * add-to-cart-variation.js:825-837 on 11.0.1). A zero therefore renders
		 * as `width="0" height="0"`: the colour is selected, the right photo is
		 * fetched, and the customer sees nothing at all. We do not know these
		 * dimensions (the file is on the Worker and was never measured here),
		 * and `false` is how you say that to this script.
		 *
		 * `srcset` and `sizes` are '' rather than false on purpose: they must be
		 * CLEARED, not left alone, or the browser keeps the previous colour's
		 * candidate list and fetches the wrong picture at the wrong width.
		 */
		$alt = $variation->get_name();
		$data['image'] = array_merge(
			is_array( $data['image'] ?? null ) ? $data['image'] : array(),
			array(
				'src'                   => $src,
				'full_src'              => $src,
				'thumb_src'             => $src,
				'gallery_thumbnail_src' => $src,
				'srcset'                => '',
				'sizes'                 => '',
				'alt'                   => $alt,
				'title'                 => $alt,
				'caption'               => '',
				'src_w'                 => false,
				'src_h'                 => false,
				'full_src_w'            => false,
				'full_src_h'            => false,
			)
		);

		return $data;
	}

	/**
	 * A stored photo path, resolved against the Worker.
	 *
	 * Stored as a path and not as a full URL, so moving the Worker to another
	 * host is one setting and not 26 399 database rows. Anything that is not a
	 * path we wrote is refused rather than printed: this string ends up in a
	 * `src`, and a stored value is only as trustworthy as everything that has
	 * ever been able to write to it.
	 */
	public static function photo_url( string $path ): string {
		if ( ! str_starts_with( $path, '/media/' ) || str_contains( $path, '..' ) ) {
			return '';
		}
		$base = rtrim( Settings::get( 'worker_url' ), '/' );
		return '' === $base ? '' : $base . $path;
	}
}
