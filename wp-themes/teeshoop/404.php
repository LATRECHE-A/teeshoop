<?php
/**
 * A page that does not exist.
 *
 * It says what happened and offers the two things a visitor who landed here
 * actually wants: the catalogue, and a person. No apology and no joke.
 *
 * @package Teeshoop\Theme
 */

namespace Teeshoop\Theme;

defined( 'ABSPATH' ) || exit;

get_header();
?>
<div class="ts-wrap ts-prose">
	<div class="ts-empty">
		<h1 class="ts-empty__title"><?php esc_html_e( 'Cette page n’existe pas', 'teeshoop' ); ?></h1>
		<p><?php esc_html_e( 'L’adresse demandée ne correspond à rien sur ce site. Elle a peut-être changé, ou le lien qui vous a amené ici est incomplet.', 'teeshoop' ); ?></p>
		<p>
			<a href="<?php echo esc_url( function_exists( 'wc_get_page_permalink' ) ? (string) wc_get_page_permalink( 'shop' ) : home_url( '/' ) ); ?>"><?php esc_html_e( 'Voir le catalogue', 'teeshoop' ); ?></a>
			<?php if ( '' !== quote_url() ) : ?>
				<span aria-hidden="true"> · </span>
				<a href="<?php echo esc_url( quote_url() ); ?>"><?php esc_html_e( 'Nous dire ce que vous cherchez', 'teeshoop' ); ?></a>
			<?php endif; ?>
		</p>
	</div>
</div>
<?php
get_footer();
