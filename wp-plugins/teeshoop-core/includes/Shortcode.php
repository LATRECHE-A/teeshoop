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
				'garment'    => 'tee',
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

		self::enqueue( $studio_url, $origin, $product_id, (string) $atts['garment'] );

		$height = preg_replace( '/[^a-zA-Z0-9\s\(\),.%\-]/', '', (string) $atts['height'] ) ?? '600px';

		return sprintf(
			'<div class="teeshoop-studio" data-teeshoop-studio style="--teeshoop-studio-height:%s">
				<iframe
					title="%s"
					class="teeshoop-studio__frame"
					src="%s"
					loading="lazy"
					allow="camera; xr-spatial-tracking; fullscreen; clipboard-write"
					sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
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
