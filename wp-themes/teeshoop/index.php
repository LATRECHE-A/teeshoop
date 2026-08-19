<?php
/**
 * The fallback WordPress asks for when nothing more specific matches.
 *
 * On this site that is the blog archive and the date archives, neither of which
 * is a selling page. It stays deliberately plain.
 *
 * @package Teeshoop\Theme
 */

namespace Teeshoop\Theme;

defined( 'ABSPATH' ) || exit;

get_header();
?>
<div class="ts-wrap ts-prose">
	<?php if ( have_posts() ) : ?>
		<h1 class="ts-prose__title"><?php echo esc_html( wp_get_document_title() ); ?></h1>
		<ul class="ts-postlist">
			<?php
			while ( have_posts() ) :
				the_post();
				?>
				<li class="ts-postlist__item">
					<h2 class="ts-postlist__title"><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h2>
					<p class="ts-postlist__date"><?php echo esc_html( get_the_date() ); ?></p>
					<?php the_excerpt(); ?>
				</li>
				<?php
			endwhile;
			?>
		</ul>
		<?php the_posts_pagination( array( 'class' => 'ts-pager' ) ); ?>
	<?php else : ?>
		<div class="ts-empty">
			<h1 class="ts-empty__title"><?php esc_html_e( 'Rien à afficher ici', 'teeshoop' ); ?></h1>
			<p><?php esc_html_e( 'Cette page ne contient aucun article. Le catalogue, lui, est en ligne.', 'teeshoop' ); ?></p>
			<p><a href="<?php echo esc_url( function_exists( 'wc_get_page_permalink' ) ? (string) wc_get_page_permalink( 'shop' ) : home_url( '/' ) ); ?>"><?php esc_html_e( 'Voir le catalogue', 'teeshoop' ); ?></a></p>
		</div>
	<?php endif; ?>
</div>
<?php
get_footer();
