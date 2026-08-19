<?php
/**
 * Search results.
 *
 * A single result list, and the search box repeated at the top so a term can be
 * corrected without going back. WordPress's own search is what runs it: chapter
 * 04 asks for synonyms and usage matching ("polo chantier" finding workwear
 * polos), which needs a search engine and is not something a template can fake.
 * That gap is stated to the visitor rather than hidden.
 *
 * @package Teeshoop\Theme
 */

namespace Teeshoop\Theme;

defined( 'ABSPATH' ) || exit;

get_header();
$ts_found = (int) ( $GLOBALS['wp_query']->found_posts ?? 0 );
?>
<div class="ts-wrap ts-prose">
	<h1 class="ts-prose__title">
		<?php
		printf(
			/* translators: %s: the search term. */
			esc_html__( 'Recherche : %s', 'teeshoop' ),
			esc_html( get_search_query() )
		);
		?>
	</h1>

	<?php get_search_form(); ?>

	<?php if ( $ts_found > 0 ) : ?>
		<p class="ts-shop__count">
			<?php
			printf(
				/* translators: %s: a number of results. */
				esc_html( _n( '%s résultat', '%s résultats', $ts_found, 'teeshoop' ) ),
				esc_html( num( (float) $ts_found ) )
			);
			?>
		</p>
		<ul class="ts-postlist">
			<?php
			while ( have_posts() ) :
				the_post();
				?>
				<li class="ts-postlist__item">
					<h2 class="ts-postlist__title"><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h2>
					<?php the_excerpt(); ?>
				</li>
				<?php
			endwhile;
			?>
		</ul>
		<?php the_posts_pagination( array( 'class' => 'ts-pager' ) ); ?>
	<?php else : ?>
		<div class="ts-empty">
			<h2 class="ts-empty__title"><?php esc_html_e( 'Aucun résultat pour ce mot', 'teeshoop' ); ?></h2>
			<p><?php esc_html_e( 'La recherche cherche le mot exact : elle ne connaît pas encore les synonymes ni les usages, donc « polo chantier » ne trouve pas les polos de travail. Passez par les familles et les filtres, ou dites-nous ce qu’il vous faut.', 'teeshoop' ); ?></p>
			<p><a href="<?php echo esc_url( quote_url() ); ?>"><?php esc_html_e( 'Demander un devis', 'teeshoop' ); ?></a></p>
		</div>
	<?php endif; ?>
</div>
<?php
get_footer();
