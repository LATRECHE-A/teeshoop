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

	/**
	 * One studio per page.
	 *
	 * A WooCommerce product renders its description in more than one place
	 * depending on the theme (the tab, the summary, a block pattern), so a
	 * shortcode pasted into both the description and the short description came
	 * out THREE times on Twenty Twenty-Five. Each copy is a full WebGL studio
	 * booting, and only the first can talk to bridge.js, which binds to the
	 * first container on the page. The rest are megabytes of dead weight.
	 */
	private static bool $rendered = false;

	public static function init(): void {
		add_shortcode( 'teeshoop_studio', array( self::class, 'render' ) );
	}

	public static function render( mixed $raw_atts ): string {
		if ( self::$rendered ) {
			return current_user_can( 'manage_options' )
				? '<p class="teeshoop-error">' .
					esc_html__( 'Teeshoop : le studio est déjà présent sur cette page. Seul le premier est affiché ; un second éditeur se chargerait entièrement sans pouvoir atteindre le panier.', 'teeshoop' ) .
					'</p>'
				: '';
		}
		self::$rendered = true;

		return self::frame( $raw_atts );
	}

	private static function frame( mixed $raw_atts ): string {
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
					esc_html__( 'Teeshoop : l’origine du studio n’est pas configurée, l’éditeur ne peut donc pas être intégré.', 'teeshoop' ) .
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
		 * basket that refuses it at the last click of a purchase, after the
		 * customer has already paid the upload. The declaration therefore WINS;
		 * the attribute is the fallback for a studio embedded somewhere that is
		 * not a product page at all.
		 */
		$declared = Product::garment_of( $product_id );
		$garment  = '' !== $declared ? $declared : sanitize_key( (string) $atts['garment'] );

		self::enqueue( $studio_url, $origin, $product_id, $garment );

		$height = preg_replace( '/[^a-zA-Z0-9\s\(\),.%\-]/', '', (string) $atts['height'] ) ?? '600px';

		// The frame is told nothing when the product is not set up, which is what
		// makes the studio show its standalone quote flow rather than a basket
		// button that would be refused at the last click. Whoever can fix it is
		// told; a visitor sees a working editor and no broken promise.
		$notice = '';
		if ( '' === $garment && current_user_can( 'manage_options' ) ) {
			$notice = '<p class="teeshoop-error">' .
				esc_html__( 'Teeshoop : cet article ne déclare aucun vêtement, le studio ne peut donc pas l’ajouter au panier. Renseignez « Vêtement Teeshoop » sur la fiche produit.', 'teeshoop' ) .
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
			esc_attr__( 'Studio de création Teeshoop', 'teeshoop' ),
			esc_url( $studio_url )
		);
	}

	/**
	 * The quantity and size breakdown the product page collected, or nothing.
	 *
	 * Read through `ProductPage::request`, which is the one place that parses
	 * these query arguments: a second parser would be a second set of bounds,
	 * and the two would disagree about what counts as a size the first time one
	 * of them was edited.
	 */
	private static function preset( string $garment ): array {
		if ( '' === $garment || ! class_exists( __NAMESPACE__ . '\\ProductPage' ) ) {
			return array();
		}

		$request = ProductPage::request( $garment, Settings::pricing() );
		$preset  = array();

		if ( 'grid' === $request['mode'] && ! empty( $request['grid'] ) ) {
			$preset['sizeGrid'] = $request['grid'];
			$preset['qty']      = (int) array_sum( $request['grid'] );
		} elseif ( $request['qty'] > 1 ) {
			$preset['qty'] = (int) $request['qty'];
		}

		return $preset;
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
				/*
				 * What the buyer typed on the product page before clicking
				 * Personnaliser, so the studio's basket panel opens on it
				 * instead of asking again.
				 *
				 * It is validated here, on the server, against the sizes the
				 * garment actually has, and it is a PRE-FILL: `Cart::add`
				 * re-derives the garment from the product and the printed areas
				 * from the stored design, and reprices on every totals pass. A
				 * hand-edited link changes what a form shows and never what an
				 * invoice says.
				 */
				'preset'       => self::preset( $garment ),
				'cartUrl'      => function_exists( 'wc_get_cart_url' ) ? wc_get_cart_url() : home_url( '/' ),
				'i18n'         => array(
					'added'   => __( 'Ajouté au panier.', 'teeshoop' ),
					'failed'  => __( 'L’article n’a pas pu être ajouté. Rien n’a été facturé.', 'teeshoop' ),
					'expired' => __( 'Votre session a expiré. Rechargez la page, puis réessayez.', 'teeshoop' ),
				),
			)
		);
	}
}
