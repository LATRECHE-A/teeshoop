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
	<meta name="theme-color" content="#010050">
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
		 * THE LOGO, IN THREE STEPS, AND THE MIDDLE ONE IS NEW.
		 *
		 * Question 31 is answered: « conserver le logo actuel ». The file is
		 * his, 300 x 54, two colours on a transparent ground, taken from
		 * /wp-content/uploads/2025/05/Sans-titre-300-x-54-px.png and shipped in
		 * `assets/images/` so that an installation which has never been
		 * configured still shows the right mark. That was the hole: the theme
		 * registered the slot, nothing filled it, and every environment we
		 * control rendered the site's NAME in text where a logo belongs.
		 *
		 *   1. what an admin uploaded, if any: the Customizer always wins;
		 *   2. the file we ship, which is what makes step 1 optional;
		 *   3. the wordmark, only if somebody deleted the file.
		 *
		 * WIDTH AND HEIGHT ARE WRITTEN OUT because this is the first element in
		 * the masthead: without them the bar reflows the moment the PNG lands,
		 * and the whole page under it moves. `fetchpriority` for the same
		 * reason, it is above the fold on every page of the site.
		 */
		$ts_logo = get_template_directory() . '/assets/images/logo-teeshoop.png';
		if ( has_custom_logo() ) {
			the_custom_logo();
		} elseif ( file_exists( $ts_logo ) ) {
			printf(
				'<a class="ts-logo" href="%s" rel="home"><img src="%s" width="300" height="54" alt="%s" fetchpriority="high" decoding="async"></a>',
				esc_url( home_url( '/' ) ),
				esc_url( get_template_directory_uri() . '/assets/images/logo-teeshoop.png' ),
				esc_attr( get_bloginfo( 'name' ) )
			);
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
