<?php
/**
 * [teeshoop_studio] — the editor, embedded.
 *
 *   [teeshoop_studio product_id="123" garment="tee" height="min(85dvh, 900px)"]
 *
 * The studio is served cross-origin by the Cloudflare Worker and framed here.
 * That is a deliberate architectural choice, not a shortcut: rendering it
 * directly inside a WordPress page would mean re-solving six problems that the
 * frame boundary solves for free — Tailwind v4's unprefixed reset rewriting the
 * theme's own `a`, `h1`–`h6`, `button` and `img`; `body{overflow:hidden}` and
 * `100dvh` killing the site's scroll; ~53 MB of assets referenced at absolute
 * paths; `position:fixed` modals colliding with Elementor; three global keyboard
 * listeners swallowing keystrokes; and module-level singletons that permit only
 * one instance per document.
 *
 * The customer never visually leaves teeshoop.com, and the page we actually want
 * indexed is the product page, not the editor.
 *
 * ON THE SANDBOX. `allow-top-navigation-by-user-activation` is there so the
 * "Voir le panier" link the studio shows after a successful add can actually
 * take the customer to their basket: without it the sandbox silently swallows
 * the navigation and the buyer is stranded in a frame. The `-by-user-activation`
 * form is the point, and the reason the bare `allow-top-navigation` is not
 * used: the frame can follow a click, and can never redirect the page on its
 * own. Everything else stays as narrow as it was.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class Shortcode {

	public static function init(): void {
		add_shortcode( 'teeshoop_studio', array( self::class, 'render' ) );
	}

	public static function render( mixed $raw_atts ): string {
		$atts = shortcode_atts(
			array(
				'product_id' => 0,
				'garment'    => '',
				'height'     => 'min(85dvh, 900px)',
			),
			is_array( $raw_atts ) ? $raw_atts : array(),
			'teeshoop_studio'
		);

		$studio_url = Settings::studio_url();
		$origin     = Settings::studio_origin();

		if ( '' === $studio_url ) {
			// Never render a frame pointing nowhere, and never render one whose
			// origin we cannot verify — the bridge would have nothing to compare
			// incoming messages against. Say so to whoever can fix it.
			if ( current_user_can( 'manage_options' ) ) {
				return '<p class="teeshoop-error">' .
					esc_html__( 'Teeshoop: the studio origin is not configured, so the editor cannot be embedded.', 'teeshoop' ) .
					'</p>';
			}
			return '';
		}

		$product_id = (int) $atts['product_id'];
		if ( 0 === $product_id ) {
			$product_id = (int) get_the_ID();
		}

		/*
		 * The garment comes from the PRODUCT, not from the shortcode.
		 *
		 * It is a price input (see Product.php), and `Cart::add` reads it from
		 * the product whatever the frame says, so a shortcode attribute that
		 * disagreed would only produce a studio that draws one garment and a
		 * basket that refuses it. The attribute is kept for a studio embedded
		 * somewhere that is not a product page at all.
		 */
		$garment = sanitize_key( (string) $atts['garment'] );
		if ( '' === $garment ) {
			$garment = Product::garment_of( $product_id );
		}

		self::enqueue( $studio_url, $origin, $product_id, $garment );

		$height = preg_replace( '/[^a-zA-Z0-9\s\(\),.%\-]/', '', (string) $atts['height'] ) ?? '600px';

		// The frame is told nothing when the product is not set up, which is what
		// makes the studio show its standalone quote flow rather than a basket
		// button that would be refused at the last click. Whoever can fix it is
		// told; a visitor sees a working editor and no broken promise.
		$notice = '';
		if ( '' === $garment && current_user_can( 'manage_options' ) ) {
			$notice = '<p class="teeshoop-error">' .
				esc_html__( 'Teeshoop: this product does not declare a garment, so the studio cannot add it to a basket. Set "Teeshoop garment" on the product.', 'teeshoop' ) .
				'</p>';
		}

		return $notice . sprintf(
			'<div class="teeshoop-studio" data-teeshoop-studio style="--teeshoop-studio-height:%s">
				<iframe
					title="%s"
					class="teeshoop-studio__frame"
					src="%s"
					loading="lazy"
					allow="camera; xr-spatial-tracking; fullscreen; clipboard-write"
					sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-top-navigation-by-user-activation"
					referrerpolicy="strict-origin-when-cross-origin"></iframe>
			</div>',
			esc_attr( $height ),
			esc_attr__( 'Teeshoop design studio', 'teeshoop' ),
			esc_url( $studio_url )
		);
	}

	private static function enqueue( string $studio_url, string $origin, int $product_id, string $garment ): void {
		$handle = 'teeshoop-bridge';

		wp_enqueue_style(
			$handle,
			TEESHOOP_CORE_URL . 'assets/bridge.css',
			array(),
			VERSION
		);

		wp_enqueue_script(
			$handle,
			TEESHOOP_CORE_URL . 'assets/bridge.js',
			array(),
			VERSION,
			true
		);

		/*
		 * The nonce is what lets the parent page — and only the parent page —
		 * POST into this visitor's cart. It is intentionally NOT forwarded to the
		 * studio: the frame never needs it, and a secret that crosses an origin
		 * boundary is a secret that can leak across it.
		 */
		wp_localize_script(
			$handle,
			'TEESHOOP_BRIDGE',
			array(
				'studioOrigin' => $origin,
				'studioUrl'    => $studio_url,
				'restUrl'      => esc_url_raw( rest_url( 'teeshoop/v1/' ) ),
				'nonce'        => wp_create_nonce( 'wp_rest' ),
				'productId'    => $product_id,
				'garment'      => $garment,
				'cartUrl'      => function_exists( 'wc_get_cart_url' ) ? wc_get_cart_url() : home_url( '/' ),
				'i18n'         => array(
					'added'   => __( 'Added to your basket.', 'teeshoop' ),
					'failed'  => __( 'The item could not be added. Nothing has been charged.', 'teeshoop' ),
					'expired' => __( 'Session expired. Reload the page and try again.', 'teeshoop' ),
				),
			)
		);
	}
}
