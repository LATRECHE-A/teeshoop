<?php
/**
 * Every WooCommerce page that is not an ordinary WordPress page.
 *
 * WooCommerce's template loader uses this file for the shop, the categories and
 * the product as soon as the theme declares `add_theme_support('woocommerce')`.
 * It is a THEME template, not a WooCommerce one: this theme overrides no
 * WooCommerce template at all, for the reasons written in `Compat.php` and one
 * more, that a copied template stops receiving upstream fixes on a shop two
 * people maintain.
 *
 * `woocommerce_content()` is the documented entry point, and what it renders is
 * still WooCommerce's: `content-single-product.php` on a product, so every
 * `do_action( 'woocommerce_single_product_summary' )` the plugin hooks into
 * still fires. Break that and the whole Teeshoop product page disappears.
 *
 * @package Teeshoop\Theme
 */

namespace Teeshoop\Theme;

defined( 'ABSPATH' ) || exit;

get_header();

if ( is_shop() || is_product_taxonomy() ) {
	get_template_part( 'template-parts/shop' );
} else {
	?>
	<div class="ts-wrap ts-single">
		<?php woocommerce_content(); ?>
	</div>
	<?php
}

advice_block();
get_footer();
