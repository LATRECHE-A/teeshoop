<?php
/**
 * WooCommerce cart integration.
 *
 * The rule this file exists to enforce: A PRICE THAT ARRIVES FROM A BROWSER IS
 * NEVER CHARGED. What the cart stores is the *inputs* — garment, printed sides
 * and their areas, design id — and the price is recomputed from them, from the
 * server's own config, on every single totals pass. So a tampered session, a
 * replayed request, or a price that was correct last week and is not correct
 * today all resolve to today's correct number rather than to whatever was
 * cached.
 *
 * It also means the customer's own quantity controls keep working: Woo owns the
 * quantity, quantity drives the discount tier, and the unit price follows.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class Cart {

	/** Key under which our payload rides in the cart item. */
	private const KEY = 'teeshoop';

	public static function init(): void {
		add_filter( 'woocommerce_add_cart_item_data', array( self::class, 'keep_items_distinct' ), 10, 3 );
		add_action( 'woocommerce_before_calculate_totals', array( self::class, 'recompute_prices' ), 20 );
		add_filter( 'woocommerce_get_item_data', array( self::class, 'show_in_cart' ), 10, 2 );
		add_action( 'woocommerce_checkout_create_order_line_item', array( self::class, 'persist_to_order' ), 10, 4 );
	}

	/**
	 * Add a personalised line to the cart.
	 *
	 * $payload:
	 *   product_id int
	 *   qty        int
	 *   garment    string
	 *   sides      array   already normalised by Design::normalise_sides()
	 *   design_id  string
	 *   size_grid  array   ['M' => 10, 'L' => 15, …] optional
	 *
	 * Returns the cart item key, or a WP_Error. Nothing here trusts a price.
	 *
	 * @return string|\WP_Error
	 */
	public static function add( array $payload ) {
		$product_id = (int) ( $payload['product_id'] ?? 0 );
		$product    = $product_id > 0 ? wc_get_product( $product_id ) : null;

		if ( ! $product || ! $product->is_purchasable() ) {
			return new \WP_Error( 'teeshoop_bad_product', __( 'This product cannot be personalised.', 'teeshoop' ), array( 'status' => 400 ) );
		}

		$design_id = (string) ( $payload['design_id'] ?? '' );
		$check     = Design::verify( $design_id );
		if ( ! $check['ok'] ) {
			return new \WP_Error(
				'teeshoop_design_' . $check['reason'],
				__( 'The artwork for this order could not be confirmed. Nothing has been added to the basket.', 'teeshoop' ),
				array( 'status' => 422 )
			);
		}

		$sides   = Design::normalise_sides( $payload['sides'] ?? array() );
		$garment = sanitize_key( (string) ( $payload['garment'] ?? '' ) );
		$config  = Settings::pricing();

		if ( ! isset( $config['garments'][ $garment ] ) ) {
			return new \WP_Error( 'teeshoop_bad_garment', __( 'Unknown garment.', 'teeshoop' ), array( 'status' => 400 ) );
		}

		$qty = max( 1, min( (int) ( $payload['qty'] ?? 1 ), (int) $config['max_qty'] ) );

		$size_grid = self::normalise_size_grid( $payload['size_grid'] ?? array() );
		if ( ! empty( $size_grid ) ) {
			// The grid IS the quantity when it is present — a customer who typed
			// "10 M, 15 L" ordered 25 garments, whatever the qty field said.
			$qty = array_sum( $size_grid );
			$qty = max( 1, min( $qty, (int) $config['max_qty'] ) );
		}

		$data = array(
			'garment'   => $garment,
			'sides'     => $sides,
			'design_id' => $design_id,
			'size_grid' => $size_grid,
			'verified'  => (bool) ( $check['meta']['verified'] ?? false ),
			'files'     => array(
				'print' => (string) ( $check['meta']['print_file'] ?? '' ),
				'preview' => (string) ( $check['meta']['preview'] ?? '' ),
			),
		);

		$key = WC()->cart->add_to_cart( $product_id, $qty, 0, array(), array( self::KEY => $data ) );

		return false === $key
			? new \WP_Error( 'teeshoop_cart_refused', __( 'WooCommerce refused the line.', 'teeshoop' ), array( 'status' => 409 ) )
			: $key;
	}

	/**
	 * Give every personalised line its own cart row.
	 *
	 * Without this, WooCommerce merges two lines of the same product by bumping
	 * the quantity — so a customer who designed two different fronts would end up
	 * with two of whichever they made first. The design id alone is not enough to
	 * key on: the same design ordered in two different size grids is two lines.
	 */
	public static function keep_items_distinct( array $data, int $product_id, int $variation_id ): array {
		if ( isset( $data[ self::KEY ] ) ) {
			$data['teeshoop_unique'] = md5( wp_json_encode( $data[ self::KEY ] ) . microtime() );
		}
		return $data;
	}

	/**
	 * Recompute every personalised line's price, from its inputs.
	 *
	 * Runs on `woocommerce_before_calculate_totals`, which fires on the cart page,
	 * at checkout, and again when the order is created — so there is no window in
	 * which a stale price could be taken.
	 *
	 * The `is_admin() && ! wp_doing_ajax()` guard is the standard Woo one: without
	 * it this also runs while a shop manager edits an existing order in the admin,
	 * silently repricing a line the customer already paid.
	 */
	public static function recompute_prices( \WC_Cart $cart ): void {
		if ( is_admin() && ! wp_doing_ajax() ) {
			return;
		}

		/*
		 * There is deliberately NO `did_action(...) > 1` guard here.
		 *
		 * That guard is the standard snippet for this hook, and it is wrong for
		 * this plugin. It exists to stop RELATIVE price changes — `set_price(
		 * get_price() * 0.9 )` — from compounding when Woo recalculates twice in
		 * one request. What we do is absolute: the price is derived from the
		 * line's stored inputs and the server's config, so running it ten times
		 * gives the same answer as running it once.
		 *
		 * With the guard in place, only the FIRST calculate_totals of a request
		 * took effect — so a customer who changed the quantity on the cart page
		 * crossed a discount threshold and kept the old unit price. Measured
		 * 2026-08-12: qty 9 → 50 all stayed at the qty-30 rate.
		 */
		$config = Settings::pricing();

		foreach ( $cart->get_cart() as $item ) {
			if ( empty( $item[ self::KEY ] ) || ! isset( $item['data'] ) ) {
				continue;
			}
			$data = $item[ self::KEY ];

			try {
				$quote = Pricing::quote(
					array(
						'garment' => (string) ( $data['garment'] ?? '' ),
						'qty'     => (int) $item['quantity'],
						'sides'   => (array) ( $data['sides'] ?? array() ),
					),
					$config
				);
			} catch ( \InvalidArgumentException $e ) {
				// A garment that no longer exists in the config. Leave the product's
				// own price rather than charging zero, and say so in the log.
				self::log( 'unknown garment in cart: ' . ( $data['garment'] ?? '?' ) );
				continue;
			}

			// Woo wants a unit price in the store's currency, excl. tax when the
			// store is configured to enter prices excl. tax — which is the setting
			// this shop uses, because its customers are businesses.
			$item['data']->set_price( (string) Money::to_eur( $quote['unit_ht'] ) );
		}
	}

	/** What the customer sees on the cart and checkout pages. */
	public static function show_in_cart( array $rows, array $item ): array {
		if ( empty( $item[ self::KEY ] ) ) {
			return $rows;
		}
		$data = $item[ self::KEY ];

		$sides = array();
		foreach ( (array) ( $data['sides'] ?? array() ) as $side ) {
			$sides[] = self::side_label( (string) $side['id'] );
		}
		if ( ! empty( $sides ) ) {
			$rows[] = array(
				'key'   => __( 'Printed sides', 'teeshoop' ),
				'value' => implode( ', ', $sides ),
			);
		}

		if ( ! empty( $data['size_grid'] ) ) {
			$parts = array();
			foreach ( $data['size_grid'] as $size => $count ) {
				$parts[] = $count . ' × ' . strtoupper( $size );
			}
			$rows[] = array(
				'key'   => __( 'Sizes', 'teeshoop' ),
				'value' => implode( ' · ', $parts ),
			);
		}

		if ( ! empty( $data['design_id'] ) ) {
			$rows[] = array(
				'key'   => __( 'Design', 'teeshoop' ),
				'value' => '<code>' . esc_html( $data['design_id'] ) . '</code>',
			);
		}

		return $rows;
	}

	/**
	 * Freeze the line onto the order.
	 *
	 * The design id and the printed sides are what the workshop works from, so
	 * they are stored as visible meta. The R2 paths are stored with a leading
	 * underscore — hidden from the customer's order view, present for the
	 * production screen.
	 */
	public static function persist_to_order( \WC_Order_Item_Product $line, string $cart_item_key, array $values, \WC_Order $order ): void {
		if ( empty( $values[ self::KEY ] ) ) {
			return;
		}
		$data = $values[ self::KEY ];

		$line->add_meta_data( __( 'Design', 'teeshoop' ), (string) ( $data['design_id'] ?? '' ), true );

		$sides = array();
		foreach ( (array) ( $data['sides'] ?? array() ) as $side ) {
			$sides[] = self::side_label( (string) $side['id'] );
		}
		if ( ! empty( $sides ) ) {
			$line->add_meta_data( __( 'Printed sides', 'teeshoop' ), implode( ', ', $sides ), true );
		}

		if ( ! empty( $data['size_grid'] ) ) {
			$parts = array();
			foreach ( $data['size_grid'] as $size => $count ) {
				$parts[] = $count . ' × ' . strtoupper( $size );
			}
			$line->add_meta_data( __( 'Sizes', 'teeshoop' ), implode( ' · ', $parts ), true );
		}

		// Hidden: the production hand-off.
		$line->add_meta_data( '_teeshoop_design_id', (string) ( $data['design_id'] ?? '' ), true );
		$line->add_meta_data( '_teeshoop_sides', wp_json_encode( $data['sides'] ?? array() ), true );
		$line->add_meta_data( '_teeshoop_files', wp_json_encode( $data['files'] ?? array() ), true );
		$line->add_meta_data( '_teeshoop_verified', ! empty( $data['verified'] ) ? 'yes' : 'no', true );
	}

	/**
	 * A size grid: uppercase size keys to positive whole counts.
	 *
	 * "10 M, 15 L, 5 XL on one line" is the thing neither Mistertee nor Tostadora
	 * does — both make the customer re-enter the editor per size. It is worth
	 * getting the validation right rather than trusting the field.
	 */
	private static function normalise_size_grid( mixed $raw ): array {
		if ( ! is_array( $raw ) ) {
			return array();
		}
		$out = array();
		foreach ( $raw as $size => $count ) {
			$size  = strtoupper( preg_replace( '/[^A-Za-z0-9]/', '', (string) $size ) ?? '' );
			$count = (int) $count;
			if ( '' !== $size && $count > 0 && strlen( $size ) <= 4 ) {
				$out[ $size ] = $count;
			}
			if ( count( $out ) >= 12 ) {
				break;
			}
		}
		return $out;
	}

	private static function side_label( string $id ): string {
		$labels = array(
			'front'    => __( 'Front', 'teeshoop' ),
			'back'     => __( 'Back', 'teeshoop' ),
			'sleeve_l' => __( 'Left sleeve', 'teeshoop' ),
			'sleeve_r' => __( 'Right sleeve', 'teeshoop' ),
		);
		return $labels[ $id ] ?? ucfirst( str_replace( '_', ' ', $id ) );
	}

	private static function log( string $message ): void {
		if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
			error_log( '[teeshoop] ' . $message ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		}
	}
}
