<?php
/**
 * The product page, before anyone opens the editor.
 *
 * A buyer landing here must be able to answer four questions without clicking
 * into the studio: what is this garment, what does it cost me at MY quantity,
 * how large can I print, and how do I get a price for two hundred of them.
 * Mistertee answers the second and hides the third; Tostadora answers neither
 * and shows a percentage instead of a euro. The third is the one we own,
 * because we bill the ink and not the box it was dropped into.
 *
 * SHIPPED BY THE PLUGIN, HOOKED, NEVER OVERRIDING A WOOCOMMERCE TEMPLATE. The
 * reasoning is in Compat.php, which also pins the hooks this file depends on.
 * The markup lives in templates/teeshoop/*.php and is loaded through
 * `wc_get_template`, so a theme can override it at `yourtheme/teeshoop/x.php`
 * and so the set of files that could leak a purchase cost stays finite and
 * greppable (scripts/php-guard.mjs).
 *
 * EVERY PRICE ON THIS PAGE COMES FROM Pricing. Not one is computed here, and
 * not one is computed in the browser. The estimator's live total is a call to
 * `GET /wp-json/teeshoop/v1/quote`; without JavaScript the same estimate is
 * produced by submitting the form, server-side, and the grid below it is
 * server-rendered either way. A second price engine in JavaScript would be one
 * more thing to disagree with the invoice.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class ProductPage {

	/** Query flag that swaps the marketing page for the editor. */
	public const STUDIO_ARG = 'personnaliser';

	/** @var array<string,array> Headline per garment, so an archive of 100 does not recompute 100 times. */
	private static array $headlines = array();

	public static function init(): void {
		add_action( 'wp', array( self::class, 'take_over' ) );

		/*
		 * The catalogue price of a personalisable product is not a price anyone
		 * pays, so it must never be printed as one. It is the blank's cost
		 * basis; what the customer pays is the blank plus the marking of each
		 * printed side, less the quantity break. Woo renders `get_price_html`
		 * on the product page, in every loop, in the cart widget and in
		 * structured data, so the substitution has to happen at the source.
		 */
		add_filter( 'woocommerce_get_price_html', array( self::class, 'price_html' ), 10, 2 );

		/*
		 * An archive's button says "Ajouter au panier" and adds a line in one
		 * click. On a personalisable product there is nothing to add yet, so it
		 * becomes a link to the page where there will be.
		 */
		add_filter( 'woocommerce_loop_add_to_cart_link', array( self::class, 'loop_link' ), 10, 2 );

		/*
		 * THE LOCK, and it does not depend on any of the rendering above.
		 *
		 * Every path that adds a line WITHOUT going through Cart::add lands
		 * here: the classic form, the `?add-to-cart=` URL, the AJAX loop
		 * button, the Store API the block cart uses, and "commander à nouveau".
		 * None of them can carry a design, so none of them may buy a
		 * personalisable product.
		 */
		add_filter( 'woocommerce_add_to_cart_validation', array( self::class, 'refuse_plain_add' ), 10, 6 );

		add_filter( 'wp_robots', array( self::class, 'robots' ) );
	}

	/**
	 * Claim the parts of the summary this plugin owns, for this request only.
	 *
	 * Registered on `wp` rather than at load: `remove_action` here would
	 * otherwise take Woo's add-to-cart off every product in the shop, including
	 * the blanks the shop may also sell. It also keeps the admin's own view of
	 * the hook table untouched, which is what Compat::check reads.
	 */
	public static function take_over(): void {
		if ( ! function_exists( 'is_product' ) || ! is_product() ) {
			return;
		}

		$product_id = (int) get_queried_object_id();
		if ( '' === Product::garment_of( $product_id ) ) {
			return;
		}

		remove_action( 'woocommerce_single_product_summary', 'woocommerce_template_single_add_to_cart', 30 );

		add_action( 'woocommerce_single_product_summary', array( self::class, 'buy_box' ), 30 );
		add_action( 'woocommerce_single_product_summary', array( self::class, 'specs' ), 35 );
		add_action( 'woocommerce_after_single_product_summary', array( self::class, 'price_grid' ), 5 );
		// Priority 12 puts the devis after WooCommerce's description tabs (10)
		// and before its up-sells (15) and related products (20). It was on
		// `woocommerce_after_single_product` first, which is the emptiest hook
		// on the page and looked like the tidy choice, but that fires below the
		// cross-sell: a buyer scrolling for a quote met four other products
		// first.
		add_action( 'woocommerce_after_single_product_summary', array( self::class, 'quote_block' ), 12 );

		if ( self::studio_requested() ) {
			add_action( 'woocommerce_before_single_product', array( self::class, 'studio' ), 5 );
		}

		self::enqueue();
	}

	private static function enqueue(): void {
		wp_enqueue_style( 'teeshoop-product', TEESHOOP_CORE_URL . 'assets/product.css', array(), VERSION );
		wp_enqueue_script( 'teeshoop-product', TEESHOOP_CORE_URL . 'assets/product.js', array(), VERSION, true );

		$config = Settings::pricing();
		wp_localize_script(
			'teeshoop-product',
			'TEESHOOP_PRODUCT',
			array(
				// Built with URL() on the other side, never by concatenating a
				// '?': with plain permalinks restUrl already carries one, and a
				// second turns every quote into a 404. Measured 2026-08-14.
				'restUrl'    => esc_url_raw( rest_url( 'teeshoop/v1/' ) ),
				'garment'    => Product::garment_of( (int) get_queried_object_id() ),
				'maxQty'     => (int) $config['max_qty'],
				'quoteFrom'  => (int) $config['quote_from_qty'],
				// Every sentence the estimator can print. product.js authors no
				// French of its own: a second place for copy is a second place
				// for it to drift out of the translator's reach.
				'i18n'       => array(
					'failed'   => __( 'Le prix n’a pas pu être calculé. Rechargez la page, puis réessayez.', 'teeshoop' ),
					'face'     => __( '%s face imprimée', 'teeshoop' ),
					'faces'    => __( '%s faces imprimées', 'teeshoop' ),
					// Both plural forms, because the noun is part of the
					// sentence: replacing only the digit printed "45 pièce".
					'one'      => __( '%s pièce, %s', 'teeshoop' ),
					'many'     => __( '%s pièces, %s', 'teeshoop' ),
					'unit'     => __( 'soit %s l’unité', 'teeshoop' ),
					'discount' => __( 'remise de %s % comprise', 'teeshoop' ),
				),
			)
		);
	}

	// -----------------------------------------------------------------------
	// What the customer asked for, read from the request and never trusted.
	// -----------------------------------------------------------------------

	/**
	 * The estimator's inputs.
	 *
	 * Nothing here is a price input in the payable sense, since `Cart::add` re-derives
	 * everything from the product and the stored design, but it still decides
	 * what a page tells a buyer, so it is bounded the same way: quantities are
	 * integers within the shop's own cap, faces cannot exceed what the garment
	 * has, and a size key that is not a size is dropped rather than echoed.
	 *
	 * @return array{qty:int,faces:int,grid:array<string,int>,mode:string}
	 */
	public static function request( string $garment, array $config ): array {
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- a public GET form that reads nothing and writes nothing.
		$max   = (int) $config['max_qty'];
		$sizes = self::size_ids( $garment );

		$grid = array();
		$raw  = isset( $_GET['tailles'] ) && is_array( $_GET['tailles'] ) ? wp_unslash( $_GET['tailles'] ) : array();
		foreach ( $raw as $size => $count ) {
			$size  = strtoupper( preg_replace( '/[^A-Za-z0-9]/', '', (string) $size ) ?? '' );
			$count = (int) $count;
			if ( '' !== $size && $count > 0 && in_array( $size, $sizes, true ) ) {
				$grid[ $size ] = min( $count, $max );
			}
		}

		$mode = ! empty( $grid ) ? 'grid' : 'single';
		if ( isset( $_GET['mode'] ) && 'grid' === $_GET['mode'] ) {
			$mode = 'grid';
		}

		$qty = 'grid' === $mode && ! empty( $grid )
			? (int) array_sum( $grid )
			: max( 1, (int) ( $_GET['qte'] ?? 1 ) );

		$faces     = max( 1, (int) ( $_GET['faces'] ?? 1 ) );
		$max_faces = Garments::printable_sides_count( $garment );
		// phpcs:enable WordPress.Security.NonceVerification.Recommended

		return array(
			'qty'   => max( 1, min( $qty, $max ) ),
			'faces' => min( $faces, $max_faces ),
			'grid'  => $grid,
			'mode'  => $mode,
		);
	}

	/** The sizes this garment is offered in, from the studio's own chart. */
	public static function size_ids( string $garment ): array {
		$out = array();
		foreach ( Garments::sizes( $garment ) as $row ) {
			$id = (string) ( $row['size'] ?? '' );
			if ( '' !== $id ) {
				$out[] = $id;
			}
		}
		return $out;
	}

	private static function studio_requested(): bool {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- a navigation flag, not an action.
		return ! empty( $_GET[ self::STUDIO_ARG ] );
	}

	/**
	 * The editor view is the same URL with a flag, and it is not the page we
	 * want indexed: the product page is. Estimator permutations are noindex for
	 * the same reason: one product, not forty near-identical URLs.
	 */
	public static function robots( array $robots ): array {
		if ( ! function_exists( 'is_product' ) || ! is_product() ) {
			return $robots;
		}
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- reading the URL shape, not acting on it.
		$noisy = self::studio_requested() || isset( $_GET['qte'], $_GET['tailles'], $_GET['faces'] ) || isset( $_GET['tailles'] ) || isset( $_GET['qte'] ) || isset( $_GET['faces'] );
		if ( $noisy ) {
			$robots['noindex'] = true;
			$robots['follow']  = true;
		}
		return $robots;
	}

	// -----------------------------------------------------------------------
	// Price display
	// -----------------------------------------------------------------------

	/** The two anchors, cached per garment for the length of the request. */
	public static function headline( string $garment ): array {
		if ( ! isset( self::$headlines[ $garment ] ) ) {
			$config = Settings::pricing();
			self::$headlines[ $garment ] = isset( $config['garments'][ $garment ] )
				? Pricing::headline( $garment, $config )
				: array();
		}
		return self::$headlines[ $garment ];
	}

	/**
	 * Replace the catalogue price with one a customer can actually reach.
	 *
	 * "À partir de X" with no quantity beside it is the lie Mistertee prints:
	 * their headline is the 500-piece price, so a buyer of twenty finds a 36 %
	 * gap by scrolling. The quantity is therefore part of the sentence, and both
	 * the figure and the quantity come out of `Pricing::headline`, which reads
	 * them from the grid printed further down the same page.
	 */
	public static function price_html( string $html, $product ): string {
		if ( ! $product instanceof \WC_Product ) {
			return $html;
		}
		$garment = Product::garment_of( $product->get_id() );
		if ( '' === $garment ) {
			return $html;
		}

		$headline = self::headline( $garment );
		if ( empty( $headline['best'] ) ) {
			return $html;
		}

		$best = $headline['best'];

		return sprintf(
			'<span class="teeshoop-price">%s <span class="teeshoop-price__ttc">%s</span> <span class="teeshoop-price__from">%s</span></span>',
			esc_html( Money::format( (int) $best['unit_ht'] ) . ' HT' ),
			esc_html( sprintf( '(%s TTC)', Money::format( (int) $best['unit_ttc'] ) ) ),
			esc_html(
				sprintf(
					/* translators: %d: the quantity at which that unit price is reached. */
					__( 'l’unité dès %d pièces, impression comprise', 'teeshoop' ),
					(int) $best['qty']
				)
			)
		);
	}

	/** The archive button opens the page instead of buying an undesigned garment. */
	public static function loop_link( string $html, $product ): string {
		if ( ! $product instanceof \WC_Product || '' === Product::garment_of( $product->get_id() ) ) {
			return $html;
		}
		return sprintf(
			'<a href="%s" class="button teeshoop-loop-cta">%s</a>',
			esc_url( $product->get_permalink() ),
			esc_html__( 'Personnaliser', 'teeshoop' )
		);
	}

	// -----------------------------------------------------------------------
	// The lock
	// -----------------------------------------------------------------------

	/**
	 * Refuse any add-to-cart for a personalisable product that carries no design.
	 *
	 * `Cart::add` calls `WC_Cart::add_to_cart()` directly, and that method does
	 * NOT apply this filter on WooCommerce 11.0.1 (the filter lives in the form
	 * handler, the AJAX handler, the Store API controller and the reorder path).
	 * So the studio's own path is untouched and needs no exemption. The
	 * `teeshoop` key is still checked, because the reorder path and the session
	 * restore both pass `$cart_item_data` and a future Woo may pass it here too.
	 *
	 * "Commander à nouveau" is refused on purpose and is the interesting case:
	 * `woocommerce_order_again_cart_item_data` defaults to an empty array, so a
	 * reorder of a personalised line would put a plain garment in the basket at
	 * the catalogue price, with no artwork for the workshop and no way for
	 * anyone to notice. Réassort is a real feature and it is session 06's; until
	 * it exists, refusing is the honest answer.
	 *
	 * @param bool  $passed         Validation so far.
	 * @param int   $product_id     Product being added.
	 * @param int   $quantity       Quantity.
	 * @param int   $variation_id   Variation, if any.
	 * @param array $variations     Variation attributes.
	 * @param array $cart_item_data Item data, when the caller passes it.
	 */
	public static function refuse_plain_add( $passed, $product_id, $quantity = 0, $variation_id = 0, $variations = array(), $cart_item_data = array() ) {
		if ( ! $passed ) {
			return $passed;
		}
		if ( is_array( $cart_item_data ) && isset( $cart_item_data['teeshoop'] ) ) {
			return $passed;
		}
		if ( '' === Product::garment_of( (int) $product_id ) ) {
			return $passed;
		}

		if ( function_exists( 'wc_add_notice' ) ) {
			wc_add_notice(
				sprintf(
					'%s <a href="%s">%s</a>',
					esc_html__( 'Ce vêtement se commande une fois votre visuel placé.', 'teeshoop' ),
					esc_url( get_permalink( (int) $product_id ) ?: home_url( '/' ) ),
					esc_html__( 'Personnaliser', 'teeshoop' )
				),
				'error'
			);
		}
		return false;
	}

	// -----------------------------------------------------------------------
	// Blocks
	// -----------------------------------------------------------------------

	/** The editor, when the customer asked for it. */
	public static function studio(): void {
		$product_id = (int) get_queried_object_id();
		echo '<div class="teeshoop-studio-view">';
		printf(
			'<p class="teeshoop-studio-view__back"><a href="%s">%s</a></p>',
			esc_url( get_permalink( $product_id ) ?: home_url( '/' ) ),
			esc_html__( 'Revenir à la fiche produit', 'teeshoop' )
		);
		// Shortcode::render carries its own one-per-page guard, so a product
		// whose description also holds [teeshoop_studio] gets one editor, not
		// two megabytes of WebGL twice.
		echo do_shortcode( '[teeshoop_studio product_id="' . (int) $product_id . '"]' );
		echo '</div>';
	}

	/** Quantity, faces, the live total and the two ways forward. */
	public static function buy_box(): void {
		$product_id = (int) get_queried_object_id();
		$garment    = Product::garment_of( $product_id );
		$config     = Settings::pricing();
		$request    = self::request( $garment, $config );

		$quote = Pricing::quote(
			array(
				'garment' => $garment,
				'qty'     => $request['qty'],
				'sides'   => Pricing::standard_sides( $request['faces'] ),
			),
			$config
		);

		wc_get_template(
			'teeshoop/product-cta.php',
			array(
				'product_id'  => $product_id,
				'garment'     => $garment,
				'config'      => $config,
				'request'     => $request,
				'quote'       => $quote,
				'headline'    => self::headline( $garment ),
				'sizes'       => self::size_ids( $garment ),
				'max_faces'   => Garments::printable_sides_count( $garment ),
				'studio_url'  => self::studio_url( $product_id, $request ),
				'needs_quote' => Pricing::needs_quote( $request['qty'], (int) $quote['total_ht'], $config ),
			),
			'',
			TEESHOOP_CORE_DIR . 'templates/'
		);
	}

	/** Colours, sizes, print areas: the facts, in centimetres. */
	public static function specs(): void {
		$product_id = (int) get_queried_object_id();
		$garment    = Product::garment_of( $product_id );

		wc_get_template(
			'teeshoop/product-specs.php',
			array(
				'product_id'  => $product_id,
				'garment'     => $garment,
				'areas'       => Garments::areas( $garment ),
				'priced_size' => Garments::priced_size( $garment ),
				'colors'      => Garments::colors(),
				'sizes'       => Garments::sizes( $garment ),
				'brand_ref'   => Garments::brand_ref( $garment ),
				'material'    => (string) get_post_meta( $product_id, Garments::META_MATERIAL, true ),
				'weight_gsm'  => (int) get_post_meta( $product_id, Garments::META_WEIGHT, true ),
				'brand'       => (string) get_post_meta( $product_id, Garments::META_BRAND, true ),
				'brand_code'  => (string) get_post_meta( $product_id, Garments::META_BRAND_REF, true ),
				'specs_date'  => (string) get_post_meta( $product_id, Garments::META_SPECS_DATE, true ),
			),
			'',
			TEESHOOP_CORE_DIR . 'templates/'
		);
	}

	/** Faces by quantity, HT and TTC, straight from the price authority. */
	public static function price_grid(): void {
		$garment = Product::garment_of( (int) get_queried_object_id() );
		$config  = Settings::pricing();
		$qtys    = Pricing::grid_qtys( $config );

		wc_get_template(
			'teeshoop/product-price-grid.php',
			array(
				'garment'  => $garment,
				'config'   => $config,
				'qtys'     => $qtys,
				'rows'     => Pricing::grid( $garment, $qtys, range( 1, Garments::printable_sides_count( $garment ) ), $config ),
				'std_area' => Pricing::std_area_sq_cm( $config ),
				'request'  => self::request( $garment, $config ),
			),
			'',
			TEESHOOP_CORE_DIR . 'templates/'
		);
	}

	/** The devis path, for the jobs the self-serve page should not price alone. */
	public static function quote_block(): void {
		$product_id = (int) get_queried_object_id();
		$garment    = Product::garment_of( $product_id );
		$config     = Settings::pricing();

		wc_get_template(
			'teeshoop/product-quote.php',
			array(
				'product_id' => $product_id,
				'garment'    => $garment,
				'config'     => $config,
				'request'    => self::request( $garment, $config ),
				'sizes'      => self::size_ids( $garment ),
			),
			'',
			TEESHOOP_CORE_DIR . 'templates/'
		);
	}

	/**
	 * The link into the editor, carrying what the buyer already told this page.
	 *
	 * Tostadora's one real advantage is that its editor opens on the garment and
	 * the design the buyer clicked, so nothing is chosen twice. The size grid a
	 * B2B buyer fills in here is exactly that: retyping it in the studio's
	 * add-to-cart panel would be the page throwing away work.
	 *
	 * It is a PRE-FILL and nothing more. `Cart::add` re-derives the garment from
	 * the product and the printed areas from the stored design, so a tampered
	 * link changes what a form shows and never what an invoice says.
	 */
	public static function studio_url( int $product_id, array $request ): string {
		$args = array( self::STUDIO_ARG => 1 );

		if ( 'grid' === $request['mode'] && ! empty( $request['grid'] ) ) {
			$args['tailles'] = $request['grid'];
		} elseif ( $request['qty'] > 1 ) {
			$args['qte'] = $request['qty'];
		}

		return add_query_arg( $args, get_permalink( $product_id ) ?: home_url( '/' ) );
	}
}
