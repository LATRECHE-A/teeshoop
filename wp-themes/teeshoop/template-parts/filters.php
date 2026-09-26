<?php
/**
 * The filter panel.
 *
 * A PLAIN GET FORM. No script is needed to use it: the checkboxes submit, the
 * page reloads narrowed, and the URL that comes back is shareable and
 * bookmarkable. That last part is not a detail: on mistertee.fr every facet link
 * is base64 in a `data-obf` attribute on a `<span>` with no href, so a filtered
 * listing cannot be sent to a colleague, opened in a new tab or indexed
 * (checked 2026-08-19). Ours is a URL.
 *
 * With a script, `site.js` collapses the panel behind a button on a phone and
 * narrows a long facet as you type in its search box. It does NOT submit on
 * change: a form that reloads the page on every checkbox makes choosing three
 * colours three page loads, and on a listing that already answers in 200 ms the
 * button is faster than the reload it would replace.
 *
 * @package Teeshoop\Theme
 */

namespace Teeshoop\Theme;

defined( 'ABSPATH' ) || exit;

$ts_applied = applied_filters();

/*
 * The archive's own context has to survive the submission.
 *
 * A GET form posts ONLY its own fields, so on `/product-category/t-shirts/` with
 * pretty permalinks the path is preserved (the action is the same URL) but a
 * search term or an ordering choice carried in the query string is not. They are
 * re-emitted as hidden fields; without that, filtering silently drops the search
 * a buyer just typed.
 */
$ts_carry = array();
foreach ( array( 's', 'post_type', 'product_cat', 'orderby' ) as $ts_key ) {
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- reading the listing's own state.
	$ts_value = isset( $_GET[ $ts_key ] ) ? sanitize_text_field( wp_unslash( (string) $_GET[ $ts_key ] ) ) : '';
	if ( '' !== $ts_value ) {
		$ts_carry[ $ts_key ] = $ts_value;
	}
}
?>
<?php
/*
 * THE ACTION IS PAGE ONE, ALWAYS.
 *
 * `add_query_arg( array() )` returns the current request path, which on
 * `/product-category/t-shirts/page/3/` includes the page. Submitting a filter
 * from there posted to page 3 of a result set that now has one page, and the
 * buyer got a 404 with no filter panel on it and no way back except the browser
 * button. Narrowing a list always starts it again from the top.
 */
$ts_action = listing_action();
?>
<form class="ts-filters" method="get" action="<?php echo esc_url( $ts_action ); ?>">
	<?php foreach ( $ts_carry as $ts_key => $ts_value ) : ?>
		<input type="hidden" name="<?php echo esc_attr( $ts_key ); ?>" value="<?php echo esc_attr( $ts_value ); ?>">
	<?php endforeach; ?>

	<button type="button" class="ts-filters__toggle" aria-expanded="false" aria-controls="ts-filters-body">
		<?php esc_html_e( 'Filtrer', 'teeshoop' ); ?>
	</button>

	<div class="ts-filters__body" id="ts-filters-body">

		<?php
		/*
		 * Sub-categories first, because chapter 04 puts « catégorie » at the top
		 * of its thirteen and because it is the only facet that changes the page
		 * rather than the query. Rendered as links, not checkboxes: a category is
		 * a place, and a place has a URL a buyer can keep.
		 */
		$ts_here = is_tax( 'product_cat' ) ? get_queried_object() : null;
		$ts_kids = get_terms(
			array(
				'taxonomy'   => 'product_cat',
				'parent'     => $ts_here instanceof \WP_Term ? $ts_here->term_id : 0,
				'hide_empty' => true,
				'orderby'    => 'name',
				'exclude'    => array( (int) get_option( 'default_product_cat', 0 ) ),
			)
		);
		if ( is_array( $ts_kids ) && ! empty( $ts_kids ) ) :
			?>
			<fieldset class="ts-facet">
				<legend class="ts-facet__legend"><?php esc_html_e( 'Catégorie', 'teeshoop' ); ?></legend>
				<ul class="ts-facet__list ts-facet__list--short">
					<?php foreach ( $ts_kids as $ts_kid ) : ?>
						<?php
						/*
						 * NO NUMBER ON A CATEGORY CHIP, and that is deliberate.
						 * It printed `$term->count`, which is the whole shop's
						 * count for that term and does not move when a facet is
						 * ticked, sitting in the same row as counts that do. Two
						 * numbers in the same panel meaning different things is
						 * worse than one number missing; the category's own count
						 * is at the top of the page it leads to.
						 */
						?>
						<li>
							<a class="ts-chip" href="<?php echo esc_url( (string) get_term_link( $ts_kid ) ); ?>">
								<?php echo esc_html( $ts_kid->name ); ?>
							</a>
						</li>
					<?php endforeach; ?>
				</ul>
			</fieldset>
		<?php endif; ?>

		<?php
		/*
		 * Grammage, in grams per square metre. Chapter 04 puts it third, ahead of
		 * brand, and it is the right call for this buyer: « Le client type est un
		 * professionnel qui compare des grammages, pas un particulier qui achète
		 * un motif. » The bounds are the catalogue's real extremes, read from the
		 * shop, so the placeholders are never a range nothing falls inside.
		 */
		$ts_bounds = weight_bounds();
		if ( null !== $ts_bounds ) :
			?>
			<fieldset class="ts-facet">
				<legend class="ts-facet__legend"><?php esc_html_e( 'Grammage', 'teeshoop' ); ?></legend>
				<div class="ts-facet__range">
					<label class="ts-facet__rangelabel">
						<span class="screen-reader-text"><?php esc_html_e( 'Grammage minimum, en grammes par mètre carré', 'teeshoop' ); ?></span>
						<input
							type="number"
							name="g_min"
							inputmode="numeric"
							min="<?php echo esc_attr( (string) $ts_bounds['min'] ); ?>"
							max="<?php echo esc_attr( (string) $ts_bounds['max'] ); ?>"
							step="1"
							placeholder="<?php echo esc_attr( (string) $ts_bounds['min'] ); ?>"
							value="<?php echo esc_attr( $ts_applied['weight']['min'] > 0 ? (string) $ts_applied['weight']['min'] : '' ); ?>"
						>
					</label>
					<span aria-hidden="true">–</span>
					<label class="ts-facet__rangelabel">
						<span class="screen-reader-text"><?php esc_html_e( 'Grammage maximum, en grammes par mètre carré', 'teeshoop' ); ?></span>
						<input
							type="number"
							name="g_max"
							inputmode="numeric"
							min="<?php echo esc_attr( (string) $ts_bounds['min'] ); ?>"
							max="<?php echo esc_attr( (string) $ts_bounds['max'] ); ?>"
							step="1"
							placeholder="<?php echo esc_attr( (string) $ts_bounds['max'] ); ?>"
							value="<?php echo esc_attr( $ts_applied['weight']['max'] > 0 ? (string) $ts_applied['weight']['max'] : '' ); ?>"
						>
					</label>
					<span class="ts-facet__unit"><?php esc_html_e( 'g/m²', 'teeshoop' ); ?></span>
				</div>
			</fieldset>
		<?php endif; ?>

		<?php foreach ( facet_taxonomies() as $ts_tax => $ts_legend ) : ?>
			<?php
			if ( 'pa_couleur' === $ts_tax ) {
				get_template_part( 'template-parts/facet', 'couleur', array( 'legend' => $ts_legend ) );
				continue;
			}
			$ts_terms = facet_terms( $ts_tax );
			if ( empty( $ts_terms ) ) {
				continue;
			}
			$ts_chosen = $ts_applied['terms'][ $ts_tax ] ?? array();
			$ts_long   = count( $ts_terms ) > 12;
			?>
			<fieldset class="ts-facet">
				<legend class="ts-facet__legend"><?php echo esc_html( $ts_legend ); ?></legend>

				<?php if ( $ts_long ) : ?>
					<?php /* A search box over the options, because « Coloris » is four hundred terms long and the brief forbids merging « Navy », « French Navy » and « Deep Navy » into one. It filters the list in place; without a script the whole list is simply there. */ ?>
					<?php /* Hidden on the LABEL, not on the input: with no script a hidden input still leaves its « Chercher dans » in the accessibility tree, and a screen reader announces a search box that is not there. `site.js` unhides this element and the input goes with it. */ ?>
					<label class="ts-facet__find" data-ts-facet-shell hidden>
						<span class="screen-reader-text">
							<?php
							printf(
								/* translators: %s: the name of a filter, e.g. Coloris. */
								esc_html__( 'Chercher dans %s', 'teeshoop' ),
								esc_html( mb_strtolower( $ts_legend ) )
							);
							?>
						</span>
						<input type="search" class="ts-facet__findinput" data-ts-facet-find placeholder="<?php esc_attr_e( 'Chercher', 'teeshoop' ); ?>">
					</label>
				<?php endif; ?>

				<ul class="ts-facet__list <?php echo $ts_long ? '' : 'ts-facet__list--short'; ?>">
					<?php foreach ( $ts_terms as $ts_term ) : ?>
						<li>
							<label class="ts-chip">
								<input
									type="checkbox"
									name="<?php echo esc_attr( facet_param( $ts_tax ) ); ?>[]"
									value="<?php echo esc_attr( $ts_term['slug'] ); ?>"
									<?php checked( in_array( $ts_term['slug'], $ts_chosen, true ) ); ?>
								>
								<span class="ts-chip__label"><?php echo esc_html( $ts_term['name'] ); ?></span>
								<span class="ts-chip__n"><?php echo esc_html( num( (float) $ts_term['count'] ) ); ?></span>
							</label>
						</li>
					<?php endforeach; ?>
				</ul>
			</fieldset>
		<?php endforeach; ?>

		<div class="ts-filters__actions">
			<button type="submit" class="ts-cta"><?php esc_html_e( 'Afficher les résultats', 'teeshoop' ); ?></button>
			<?php if ( has_filters() ) : ?>
				<a class="ts-filters__clear" href="<?php echo esc_url( without_filters() ); ?>">
					<?php esc_html_e( 'Tout effacer', 'teeshoop' ); ?>
				</a>
			<?php endif; ?>
		</div>

		<?php
		/*
		 * The five facets chapter 04 asks for and this shop cannot honestly offer:
		 * availability, the blank's price, the lead time, the technique and the
		 * sector. Written on the panel rather than left as a gap, because a buyer
		 * looking for "disponible" needs to know where the answer is, and because
		 * a silent omission is how a missing feature becomes a forgotten one.
		 */
		?>
		<p class="ts-filters__gap">
			<?php esc_html_e( 'Pas encore filtrables : la disponibilité, qui est indiquée en toutes lettres sur chaque fiche et se lit article par article ; le prix du textile nu, qui n’est pas encore publié ; le délai, la technique de marquage et le secteur d’activité, dont nous n’avons pas encore la donnée. Dites-nous ce que vous cherchez et nous le trouvons.', 'teeshoop' ); ?>
		</p>
	</div>
</form>
