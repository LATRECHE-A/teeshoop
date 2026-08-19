<?php
/**
 * The listing: the shop root and every product category.
 *
 * THE LAYOUT IS A FILTER COLUMN AND A GRID, and the column is sticky from
 * 900 px. That is the answer to the sentence chapter 04 opens on: « le catalogue
 * doit se comporter comme un moteur de recherche spécialisé, pas comme une
 * succession de centaines de pages ». A buyer narrowing 462 references should
 * not have to scroll back up to the top of the page to add a second colour.
 *
 * On a phone the same panel is one button. That is not a downgrade: it is the
 * only place the panel can go on 375 px without pushing the products off the
 * first screen, and mobile is where this is designed first.
 *
 * @package Teeshoop\Theme
 */

namespace Teeshoop\Theme;

defined( 'ABSPATH' ) || exit;

$ts_term  = is_product_taxonomy() ? get_queried_object() : null;
$ts_total = (int) wc_get_loop_prop( 'total' );
$ts_chips = applied_chips();
?>
<div class="ts-shop ts-wrap">

	<header class="ts-shop__head">
		<?php woocommerce_breadcrumb(); ?>

		<h1 class="ts-shop__title"><?php woocommerce_page_title(); ?></h1>

		<?php
		if ( $ts_term instanceof \WP_Term && '' !== trim( (string) $ts_term->description ) ) {
			printf( '<div class="ts-shop__intro">%s</div>', wp_kses_post( wpautop( $ts_term->description ) ) );
		}
		?>

		<p class="ts-shop__count">
			<?php
			if ( $ts_total > 0 ) {
				printf(
					/* translators: %s: a number of references. */
					esc_html( _n( '%s référence', '%s références', $ts_total, 'teeshoop' ) ),
					esc_html( num( (float) $ts_total ) )
				);
			} else {
				esc_html_e( 'Aucune référence', 'teeshoop' );
			}
			?>
		</p>

		<?php if ( ! empty( $ts_chips ) ) : ?>
			<ul class="ts-applied" aria-label="<?php esc_attr_e( 'Filtres appliqués', 'teeshoop' ); ?>">
				<?php foreach ( $ts_chips as $ts_chip ) : ?>
					<li class="ts-applied__item">
						<a href="<?php echo esc_url( $ts_chip['url'] ); ?>">
							<span class="screen-reader-text">
								<?php
								printf(
									/* translators: 1: the filter name, 2: the value. */
									esc_html__( 'Retirer le filtre %1$s : %2$s', 'teeshoop' ),
									esc_html( $ts_chip['label'] ),
									esc_html( $ts_chip['name'] )
								);
								?>
							</span>
							<span aria-hidden="true"><?php echo esc_html( $ts_chip['name'] ); ?></span>
						</a>
					</li>
				<?php endforeach; ?>
			</ul>
		<?php endif; ?>
	</header>

	<?php get_template_part( 'template-parts/filters' ); ?>

	<div class="ts-shop__results">
		<?php if ( $ts_total > 0 ) : ?>
			<?php woocommerce_content(); ?>
		<?php else : ?>
			<div class="ts-empty">
				<h2 class="ts-empty__title"><?php esc_html_e( 'Rien ne correspond à cette combinaison', 'teeshoop' ); ?></h2>
				<?php if ( has_filters() ) : ?>
					<?php
					/*
					 * THE SENTENCE DESCRIBES WHAT THE COUNTS ACTUALLY ARE.
					 *
					 * It used to promise "combien de références restent si vous
					 * cochez celle-là", which is true only while that facet has
					 * nothing ticked. A facet's counts ignore its own selection,
					 * deliberately, or ticking « Blanc » would show every other
					 * colour at zero and nobody could ask for two. Within one
					 * facet the operator is AND, so with Blanc ticked the number
					 * beside Noir is how many references are Noir among the other
					 * criteria, not how many are both.
					 */
					?>
					<p><?php esc_html_e( 'Retirez un critère et la liste se remplit. Les nombres à côté de chaque case comptent les références qui portent cette valeur parmi vos autres critères ; dans une même famille, cocher deux valeurs demande les deux à la fois.', 'teeshoop' ); ?></p>
					<p><a href="<?php echo esc_url( without_filters() ); ?>"><?php esc_html_e( 'Effacer les filtres', 'teeshoop' ); ?></a></p>
				<?php else : ?>
					<p><?php esc_html_e( 'Cette catégorie ne contient aucune référence publiée. L’import fournisseur la remplira ; en attendant, dites-nous ce que vous cherchez et nous le trouvons.', 'teeshoop' ); ?></p>
					<p><a href="<?php echo esc_url( quote_url() ); ?>"><?php esc_html_e( 'Demander un devis', 'teeshoop' ); ?></a></p>
				<?php endif; ?>
			</div>
		<?php endif; ?>
	</div>
</div>
