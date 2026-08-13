<?php
/**
 * Plugin Name:       Teeshoop Core
 * Description:       Joins the Teeshoop studio to WooCommerce: the server-side price authority, the add-to-cart bridge, and the design hand-off to the workshop.
 * Version:           0.1.0
 * Requires at least: 6.6
 * Requires PHP:      8.1
 * Author:            Teeshoop
 * Text Domain:       teeshoop
 * Domain Path:       /languages
 *
 * @package Teeshoop\Core
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PLUGIN IS FOR
 *
 * The studio (React, served by the Cloudflare Worker) does the drawing. WooCommerce
 * does the shop. This plugin is the only new code between them, and it owns three
 * things nobody else is allowed to own:
 *
 *   1. THE PRICE. Computed here, in PHP, from the stored config. The studio
 *      displays what it is told. A price that arrives from a browser is a
 *      suggestion from an untrusted party, and it is discarded — see Cart.php.
 *
 *   2. THE BRIDGE. The studio runs cross-origin in an iframe, so it cannot read
 *      WordPress cookies and cannot call the REST API itself. It posts a message
 *      to the parent page; the parent page — same origin, holding the nonce —
 *      makes the call. assets/bridge.js checks the sender's origin on every
 *      message, and never posts back to '*'.
 *
 *   3. THE HAND-OFF. An order line stores a design IDENTIFIER, never the artwork.
 *      Files live in R2. wp-content/uploads is readable by URL, and robots.txt is
 *      not an access control.
 *
 * The pure classes (Money, Pricing, Margin) call no WordPress function, so they
 * are tested by `php tests/run.php` with no bootstrap at all.
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

const VERSION = '0.1.0';

define( 'TEESHOOP_CORE_FILE', __FILE__ );
define( 'TEESHOOP_CORE_DIR', plugin_dir_path( __FILE__ ) );
define( 'TEESHOOP_CORE_URL', plugin_dir_url( __FILE__ ) );

/** Option holding the price config; absent keys fall back to Pricing::default_config(). */
const OPTION_PRICING = 'teeshoop_pricing';

/** Option holding the integration settings (studio origin, worker URL, …). */
const OPTION_SETTINGS = 'teeshoop_settings';

require_once __DIR__ . '/includes/Money.php';
require_once __DIR__ . '/includes/Pricing.php';
require_once __DIR__ . '/includes/Margin.php';
require_once __DIR__ . '/includes/Settings.php';
require_once __DIR__ . '/includes/Design.php';
require_once __DIR__ . '/includes/Product.php';
require_once __DIR__ . '/includes/Cart.php';
require_once __DIR__ . '/includes/Rest.php';
require_once __DIR__ . '/includes/Shortcode.php';

/**
 * Boot, but only if WooCommerce is actually there.
 *
 * Half of this plugin manipulates the Woo cart. Loading it without Woo produces
 * a fatal on a hook that does not exist, and a white screen on a shop is worse
 * than a missing feature — so it declines, loudly, in the admin only.
 */
function boot(): void {
	if ( ! class_exists( 'WooCommerce' ) ) {
		add_action(
			'admin_notices',
			static function (): void {
				echo '<div class="notice notice-error"><p><strong>Teeshoop Core</strong> — ';
				esc_html_e( 'WooCommerce is not active, so the studio cannot add anything to a cart. The plugin is idle.', 'teeshoop' );
				echo '</p></div>';
			}
		);
		return;
	}

	Product::init();
	Cart::init();
	Rest::init();
	Shortcode::init();
}
add_action( 'plugins_loaded', __NAMESPACE__ . '\\boot' );

/**
 * Declare compatibility with WooCommerce High-Performance Order Storage.
 *
 * Without this, Woo shows the shop owner a scary incompatibility warning and
 * refuses to let them enable HPOS. We never touch the orders table directly —
 * only order-item meta through the CRUD API — so the declaration is honest.
 */
add_action(
	'before_woocommerce_init',
	static function (): void {
		if ( class_exists( \Automattic\WooCommerce\Utilities\FeaturesUtil::class ) ) {
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility(
				'custom_order_tables',
				TEESHOOP_CORE_FILE,
				true
			);
		}
	}
);
