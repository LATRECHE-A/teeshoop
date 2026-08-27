<?php
/**
 * A variable product that does not spend 800 ms proving it has no price.
 *
 * The whole reasoning, the measurement and the two WooCommerce line numbers this
 * depends on are in `Listing.php`. Read that first; this file is only the two
 * methods.
 *
 * BOTH OVERRIDES ARE PURE SHORT CIRCUITS. Each one returns exactly what its
 * parent returns, through exactly the same filters, in the one case where the
 * parent's answer is fixed in advance: a reference on which no variation carries
 * a price. Anything else, including any doubt, calls the parent.
 *
 * KEPT OUT OF `includes/`, one directory below the rest, for exactly the reason
 * `includes/shipping/colissimo.php` is: it extends a class that does not exist
 * until WooCommerce has loaded, and `scripts/hypotheses-guard.mjs` requires
 * every file in `includes/` in a bare PHP process with no WordPress at all. A
 * class extending a missing parent is a fatal there, and the register check
 * would stop saying "the values agree" and start saying "php could not read the
 * plugin". The guard's glob is not recursive, so one directory down is enough.
 *
 * Loaded by `Listing::init()`, which runs only inside `Teeshoop\Core\boot()`,
 * which runs only when WooCommerce is loaded. It must not be required from the
 * top of the plugin file either: `WC_Product_Variable` would not exist yet and
 * the shop would be a white page.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

class VariableProduct extends \WC_Product_Variable {

	/**
	 * Is any variation on sale.
	 *
	 * The parent (class-wc-product-variable.php:592) reads every variation's
	 * price and then evaluates
	 *
	 *     $prices['regular_price'] !== $prices['sale_price']
	 *         && $prices['sale_price'] === $prices['price']
	 *
	 * With no priced variation all three are the empty array, so the first
	 * comparison is false and the answer is false whatever the second says. This
	 * returns that false without building the variations, through the same
	 * `woocommerce_product_is_on_sale` filter and only in the `view` context the
	 * parent filters in.
	 */
	public function is_on_sale( $context = 'view' ) {
		if ( false === Listing::has_priced_variation( $this->get_id() ) ) {
			return 'view' === $context
				? apply_filters( 'woocommerce_product_is_on_sale', false, $this )
				: false;
		}
		return parent::is_on_sale( $context );
	}

	/**
	 * The price to print.
	 *
	 * The parent (class-wc-product-variable.php:168) branches on
	 * `empty( $prices['price'] )` and, when it is empty, returns
	 *
	 *     apply_filters( 'woocommerce_get_price_html',
	 *         apply_filters( 'woocommerce_variable_empty_price_html', '', $this ),
	 *         $this )
	 *
	 * having built every variation to discover that. This is that expression,
	 * with both filters kept so anything hooking either still runs, and with the
	 * `$price` argument ignored exactly as the parent ignores it on that branch.
	 */
	public function get_price_html( $price = '' ) {
		if ( false === Listing::has_priced_variation( $this->get_id() ) ) {
			$empty = apply_filters( 'woocommerce_variable_empty_price_html', '', $this );
			return apply_filters( 'woocommerce_get_price_html', $empty, $this );
		}
		return parent::get_price_html( $price );
	}
}
