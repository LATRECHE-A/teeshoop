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
 * The pure classes (Money, Pricing, Margin, Cost, Commission) call no WordPress
 * function, so they are tested by `php tests/run.php` with no bootstrap at all.
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

/**
 * Option holding the VAT regime timeline: one entry per period, each with the
 * date it opens and the regime it carries. See includes/Vat.php for why it is a
 * timeline and not a rate.
 */
const OPTION_VAT = 'teeshoop_vat';

/**
 * Option holding the seller's legal identity. EMPTY by default and never
 * pre-filled: a plausible placeholder SIRET is a thing that ships.
 */
const OPTION_LEGAL = 'teeshoop_legal';

/** Option holding the shipping grid, the packaging cost and the franco. */
const OPTION_SHIPPING = 'teeshoop_shipping';

/** Option holding the invoice series, its counter and the payment terms. */
const OPTION_INVOICE = 'teeshoop_invoice';

/**
 * Option holding the deposit rule: from what size, and for what share. See
 * includes/Settlement.php for why a deposit is a state and not a checkbox.
 */
const OPTION_PAYMENT = 'teeshoop_payment';

/**
 * Option holding the cost model: the hourly rate, the standard times, the film
 * tariff, the provisions and the margin rules. See includes/Cost.php.
 */
const OPTION_COSTING = 'teeshoop_costing';

/** Option holding the commission rates and the acquisition delays. */
const OPTION_COMMISSION = 'teeshoop_commission';

/**
 * Option holding the workshop's schedule: lead times, capacity, slack.
 *
 * ITS OWN, and not inside the cost config, for the reason the floor rules are:
 * that one is rewritten wholesale from a literal on every save of the cost
 * screen, and a schedule stored inside it would be deleted by the first person
 * who pressed Enregistrer there.
 */
const OPTION_PRODUCTION = 'teeshoop_production';

/**
 * Option holding the scoped floor rules. ITS OWN, never inside the cost config:
 * that one is rewritten from a literal on every save and would delete them.
 */
const OPTION_PRICE_RULES = 'teeshoop_price_rules';

require_once __DIR__ . '/includes/Money.php';
require_once __DIR__ . '/includes/Pricing.php';
require_once __DIR__ . '/includes/Vat.php';
require_once __DIR__ . '/includes/Legal.php';
require_once __DIR__ . '/includes/Pdf.php';
require_once __DIR__ . '/includes/Settlement.php';
require_once __DIR__ . '/includes/Margin.php';
require_once __DIR__ . '/includes/Cost.php';
require_once __DIR__ . '/includes/Commission.php';
require_once __DIR__ . '/includes/PriceRule.php';
require_once __DIR__ . '/includes/Settings.php';
require_once __DIR__ . '/includes/Garments.php';
require_once __DIR__ . '/includes/Hypotheses.php';
require_once __DIR__ . '/includes/Design.php';
require_once __DIR__ . '/includes/Product.php';
require_once __DIR__ . '/includes/Catalogue.php';
require_once __DIR__ . '/includes/Supply.php';
require_once __DIR__ . '/includes/Taxonomy.php';
require_once __DIR__ . '/includes/Shelf.php';
require_once __DIR__ . '/includes/Importer.php';
require_once __DIR__ . '/includes/Cart.php';
require_once __DIR__ . '/includes/Shipping.php';
require_once __DIR__ . '/includes/Ledger.php';
require_once __DIR__ . '/includes/Invoice.php';
require_once __DIR__ . '/includes/Payment.php';
require_once __DIR__ . '/includes/Checkout.php';
require_once __DIR__ . '/includes/Rest.php';
require_once __DIR__ . '/includes/Shortcode.php';
require_once __DIR__ . '/includes/Compat.php';
require_once __DIR__ . '/includes/ProductPage.php';
require_once __DIR__ . '/includes/Nest.php';
require_once __DIR__ . '/includes/Costing.php';
require_once __DIR__ . '/includes/Production.php';
require_once __DIR__ . '/includes/ProductionPage.php';
require_once __DIR__ . '/includes/Purchase.php';
require_once __DIR__ . '/includes/PurchasePage.php';
require_once __DIR__ . '/includes/Waiver.php';
require_once __DIR__ . '/includes/Lifecycle.php';
require_once __DIR__ . '/includes/Mail.php';
require_once __DIR__ . '/includes/Notify.php';
require_once __DIR__ . '/includes/Bat.php';
require_once __DIR__ . '/includes/BatPage.php';
require_once __DIR__ . '/includes/Claim.php';
require_once __DIR__ . '/includes/Quote.php';
require_once __DIR__ . '/includes/Admin.php';
require_once __DIR__ . '/includes/CostAdmin.php';
require_once __DIR__ . '/includes/Cli.php';

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
				esc_html_e( 'WooCommerce n’est pas actif, le studio ne peut donc rien ajouter à un panier. L’extension est en veille.', 'teeshoop' );
				echo '</p></div>';
			}
		);
		return;
	}

	Product::init();
	Importer::init();
	Cart::init();
	Shipping::init();
	Payment::init();
	Ledger::init();
	Checkout::init();
	Invoice::init();
	Rest::init();
	Shortcode::init();
	ProductPage::init();
	Waiver::init();
	Lifecycle::init();
	Mail::init();
	Notify::init();
	Bat::init();
	Claim::init();
	Quote::init();
	Production::init();
	ProductionPage::init();
	Purchase::init();
	PurchasePage::init();
	Hypotheses::init();
	Compat::init();
	Admin::init();
	CostAdmin::init();
	Cli::init();
	add_action( 'admin_notices', __NAMESPACE__ . '\\currency_notice' );
}

/**
 * Say so when WooCommerce and the price authority disagree about the currency.
 *
 * `Pricing` works in cents of `config['currency']`, which is EUR, and hands
 * WooCommerce a bare number. WooCommerce renders that number with the STORE's
 * currency symbol. Set the store to dollars and a 384,25 EUR line prints as
 * $384.25: the same digits, the wrong money, on the page and then on the
 * invoice. Nothing throws and nothing looks broken.
 *
 * Found on the local mirror, which ships as a USD store, on 2026-08-14.
 * Admin-only and non-blocking: it is a configuration mistake, and the person
 * who can fix it is the only one who needs to read it.
 */
function currency_notice(): void {
	if ( ! current_user_can( 'manage_woocommerce' ) || ! function_exists( 'get_woocommerce_currency' ) ) {
		return;
	}
	$shop  = get_woocommerce_currency();
	$ours  = (string) Settings::pricing()['currency'];
	if ( $shop === $ours ) {
		return;
	}
	printf(
		'<div class="notice notice-error"><p><strong>Teeshoop Core</strong> : %s</p></div>',
		esc_html(
			sprintf(
				/* translators: 1: WooCommerce store currency, 2: the price config's currency */
				__( 'WooCommerce est réglé en %1$s alors que les lignes personnalisées sont calculées en %2$s. Les mêmes chiffres seront affichés et facturés dans la mauvaise devise tant que les deux ne concordent pas.', 'teeshoop' ),
				$shop,
				$ours
			)
		)
	);
}
add_action( 'plugins_loaded', __NAMESPACE__ . '\\boot' );

/**
 * Leave nothing running behind us.
 *
 * The daily purge of quote requests is scheduled on `init` and must stop when
 * the plugin does: a cron event whose callback no longer exists fires every day
 * for ever and is invisible in the admin.
 */
register_deactivation_hook(
	__FILE__,
	static function (): void {
		foreach ( array( 'teeshoop_purge_devis', Mail::cron() ) as $hook ) {
			$next = wp_next_scheduled( $hook );
			if ( $next ) {
				wp_unschedule_event( $next, $hook );
			}
		}
	}
);

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
