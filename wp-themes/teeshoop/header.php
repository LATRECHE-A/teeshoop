<?php
/**
 * The document head and the masthead.
 *
 * THE NAVIGATION WORKS WITHOUT JAVASCRIPT, and that is the reason for the shape
 * of the markup rather than a preference. The list is rendered ONCE. Without a
 * script it is simply visible, stacked under the bar, and every link is
 * reachable. The inline snippet in `<head>` marks the document `has-js` before
 * any CSS is applied, which is what lets the stylesheet collapse the same list
 * into a drawer with no flash of an open menu on the way. A `<details>` element
 * would have been shorter and does not survive: overriding the closed state at
 * desktop widths depends on `::details-content`, which is not something to
 * depend on across the browsers a French shop actually gets.
 *
 * @package Teeshoop\Theme
 */

namespace Teeshoop\Theme;

defined( 'ABSPATH' ) || exit;

?><!doctype html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta name="theme-color" content="#14171a">
	<link rel="profile" href="https://gmpg.org/xfn/11">
	<?php
	/*
	 * NONCED, because the shop sends a Content Security Policy and a browser that
	 * sees a nonce in `script-src` ignores `'unsafe-inline'` entirely. An inline
	 * script without one is simply not run, and the symptom here would be a
	 * navigation that never collapses and filters that never fold, with nothing in
	 * the console a visitor would report. `Csp::nonce()` is the same value the
	 * header carries. The theme keeps working with the plugin inactive: the
	 * `class_exists` guard prints the tag unattributed, which is what a site with
	 * no policy wants anyway.
	 */
	$ts_nonce = class_exists( '\Teeshoop\Core\Csp' ) ? ' nonce="' . esc_attr( \Teeshoop\Core\Csp::nonce() ) . '"' : '';
	?>
	<script<?php echo $ts_nonce; // phpcs:ignore WordPress.Security.EscapingOutput -- escaped above. ?>>document.documentElement.className += ' has-js'</script>
	<?php wp_head(); ?>
</head>

<body <?php body_class(); ?>>
<?php wp_body_open(); ?>

<a class="ts-skip" href="#contenu"><?php esc_html_e( 'Aller au contenu', 'teeshoop' ); ?></a>

<header class="ts-mast">
	<div class="ts-mast__bar ts-wrap">
		<button
			class="ts-burger"
			type="button"
			aria-expanded="false"
			aria-controls="ts-nav"
			hidden
		><span class="ts-burger__bars" aria-hidden="true"></span><span class="ts-burger__label"><?php esc_html_e( 'Menu', 'teeshoop' ); ?></span></button>

		<?php
		/*
		 * THE LOGO SLOT. `the_custom_logo()` prints nothing at all until a file
		 * is uploaded, which is the shipped state: question 31 is unanswered and
		 * a company's logo is not something that can be defaulted. Until then the
		 * name is the mark, set in the site's own type.
		 */
		if ( has_custom_logo() ) {
			the_custom_logo();
		} else {
			printf(
				'<a class="ts-wordmark" href="%s" rel="home">%s</a>',
				esc_url( home_url( '/' ) ),
				esc_html( get_bloginfo( 'name' ) )
			);
		}
		?>

		<nav class="ts-nav" id="ts-nav" aria-label="<?php esc_attr_e( 'Navigation principale', 'teeshoop' ); ?>">
			<?php
			wp_nav_menu(
				array(
					'theme_location' => 'primaire',
					'container'      => false,
					'menu_class'     => 'ts-nav__list',
					'depth'          => 2,
					'fallback_cb'    => __NAMESPACE__ . '\\default_nav',
				)
			);
			?>
		</nav>

		<div class="ts-mast__tools">
			<a class="ts-mast__quote" href="<?php echo esc_url( quote_url() ); ?>">
				<?php esc_html_e( 'Devis', 'teeshoop' ); ?>
			</a>
			<?php if ( function_exists( 'wc_get_cart_url' ) ) : ?>
				<?php $ts_count = WC()->cart ? WC()->cart->get_cart_contents_count() : 0; ?>
				<a class="ts-mast__cart" href="<?php echo esc_url( wc_get_cart_url() ); ?>">
					<?php esc_html_e( 'Panier', 'teeshoop' ); ?>
					<?php if ( $ts_count > 0 ) : ?>
						<span class="ts-mast__cart-n ts-num"><?php echo esc_html( (string) $ts_count ); ?></span>
					<?php endif; ?>
				</a>
			<?php endif; ?>
		</div>
	</div>
</header>

<main id="contenu" class="ts-main">
