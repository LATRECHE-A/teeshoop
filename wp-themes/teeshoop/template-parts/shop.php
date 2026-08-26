<?php
/**
 * The listing: the shop root and every product category.
 *
 * THE LAYOUT IS A FILTER COLUMN AND A GRID, and the column is sticky from
 * 900 px. That is the answer to chapter 04, « Catalogue et fiches produits »,
 * verbatim: « à condition que l'architecture du catalogue soit pensée comme un
 * moteur de recherche spécialisé et non comme une succession de centaines de
 * pages difficiles à parcourir ». A buyer narrowing 462 references should not
 * have to scroll back up to the top of the page to add a second colour.
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

/*
 * THE CATEGORY'S OWN COPY, and it is split in two on purpose.
 *
 * The intro is one to three sentences and sits above the grid; the rest sits
 * under it, which is what five competitors out of five do, measured. See
 * `editorial_body()` for the numbers.
 *
 * It is suppressed on a filtered or paginated view: the text describes the
 * category, and repeating a thousand words of it under eight pages of the same
 * listing is how a shop builds its own near-duplicates. Those views are
 * `noindex` anyway, and a buyer who has narrowed to three references has left
 * the reading part behind.
 */
$ts_key   = $ts_term instanceof \WP_Term ? 'categorie:' . $ts_term->slug : ( is_shop() ? 'boutique' : '' );
/*
 * A SORTED LISTING IS ONE OF THOSE VIEWS TOO, and it was missing from this
 * test. `?orderby=price` is `noindex` like a filtered one, so rendering the
 * category's 1 700 words under it costs the server the work and buys nothing.
 * The condition is « is this the canonical view of the category », and the
 * three ways of leaving it are a facet, a page number and a sort.
 */
// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- reading the URL shape of a public listing.
$ts_first = ! has_filters() && ! is_paged() && ! isset( $_GET['orderby'] );
$ts_copy  = '' !== $ts_key && $ts_first ? editorial( $ts_key ) : editorial( '' );
?>
<div class="ts-shop ts-wrap">

	<header class="ts-shop__head">
		<?php woocommerce_breadcrumb(); ?>

		<h1 class="ts-shop__title">
			<?php
			if ( '' !== $ts_copy['h1'] ) {
				echo esc_html( $ts_copy['h1'] );
			} else {
				woocommerce_page_title();
			}
			?>
		</h1>

		<?php if ( ! empty( $ts_copy['intro'] ) ) : ?>
			<div class="ts-shop__intro">
				<?php foreach ( $ts_copy['intro'] as $ts_line ) : ?>
					<p><?php echo esc_html( $ts_line ); ?></p>
				<?php endforeach; ?>
			</div>
		<?php endif; ?>

		<?php
		/*
		 * And whatever an operator typed into the term description, still, under
		 * ours. `Content::notice()` tells them on the editing screen which of
		 * the two they are looking at.
		 */
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

<?php editorial_body( $ts_copy, 'ts-edito-categorie' ); ?>
