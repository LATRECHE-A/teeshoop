<?php
/**
 * The colour facet: four hundred and forty-two names, eleven families.
 *
 * WHY THIS IS NOT THE GENERIC FACET. Every other one is a handful of words. This
 * one is the whole reason the catalogue is hard to search, and the brief is
 * explicit that « Navy », « French Navy » and « Deep Navy » may not be merged:
 * a buyer re-ordering in eighteen months needs the name they bought. So the
 * names all stay and a MEASURED colour groups them and shows them.
 *
 * The measurement is `Swatch`, taken from the colour chip the supplier ships
 * with every colourway, and failing that from the garment photograph. Nothing
 * here is typed in by hand, and a colour that could not be measured gets a chip
 * with no swatch rather than a guessed one.
 *
 * NO SCRIPT IS NEEDED. The groups are `<details>`, which open on a click and on
 * the keyboard with nothing loaded, announce their state to a screen reader for
 * free, and keep their checkboxes in the form whether they are open or shut. A
 * group holding a colour the buyer has already chosen is rendered open, so a
 * shared URL never hides its own criteria.
 *
 * COLOUR IS NEVER THE ONLY SIGNAL (WCAG 1.4.1): every swatch sits beside the
 * manufacturer's name, and the name is what the checkbox is labelled with. A
 * buyer who cannot tell two blues apart reads « Royal » and « Navy ».
 *
 * @package Teeshoop\Theme
 */

namespace Teeshoop\Theme;

defined( 'ABSPATH' ) || exit;

$ts_groups = colour_groups();
if ( empty( $ts_groups ) ) {
	return;
}

$ts_legend  = (string) ( $args['legend'] ?? __( 'Coloris', 'teeshoop' ) );
$ts_chosen  = applied_filters()['terms']['pa_couleur'] ?? array();
$ts_picked  = applied_filters()['families'];
$ts_counts  = family_counts();
$ts_swatch  = static function ( array $stops ): string {
	// Only a value this file produced may reach a style attribute. The hexes
	// come from `Swatch::hex()`, which is a sprintf of three integers, so this
	// can never fail; it is here because the day somebody stores a swatch from
	// somewhere else, it must fail closed rather than write the attribute.
	$ok = array_values( array_filter( $stops, static fn( $h ): bool => 1 === preg_match( '/^#[0-9a-f]{6}$/', (string) $h ) ) );
	if ( empty( $ok ) ) {
		return '';
	}
	$style = '--ts-sw-a:' . $ok[0];
	if ( isset( $ok[1] ) ) {
		$style .= ';--ts-sw-b:' . $ok[1];
	}
	return $style;
};
?>
<fieldset class="ts-facet ts-facet--couleur">
	<legend class="ts-facet__legend"><?php echo esc_html( $ts_legend ); ?></legend>

	<?php
	/*
	 * HIDDEN ON THE LABEL, NOT ON THE INPUT. With no script the input was hidden
	 * and its « Chercher un coloris » stayed in the accessibility tree, so a
	 * screen reader announced a search box that does not exist. `site.js`
	 * unhides this element, and the input goes with it.
	 */
	?>
	<label class="ts-facet__find" data-ts-facet-shell hidden>
		<span class="screen-reader-text"><?php esc_html_e( 'Chercher un coloris', 'teeshoop' ); ?></span>
		<input type="search" class="ts-facet__findinput" data-ts-facet-find data-ts-facet-groups placeholder="<?php esc_attr_e( 'Chercher un coloris', 'teeshoop' ); ?>">
	</label>

	<div class="ts-fam" data-ts-facet-list>
		<?php foreach ( $ts_groups as $ts_group ) : ?>
			<?php
			$ts_family = (string) $ts_group['family'];
			$ts_n      = count( $ts_group['terms'] );
			$ts_refs   = $ts_counts[ $ts_family ] ?? 0;
			?>
			<details class="ts-fam__group" <?php echo $ts_group['open'] ? 'open' : ''; ?>>
				<summary class="ts-fam__head">
					<span class="ts-fam__name"><?php echo esc_html( (string) $ts_group['label'] ); ?></span>
					<?php if ( ! empty( $ts_group['strip'] ) ) : ?>
						<span class="ts-fam__strip" aria-hidden="true">
							<?php foreach ( $ts_group['strip'] as $ts_hex ) : ?>
								<span class="ts-fam__dot" style="<?php echo esc_attr( $ts_swatch( array( $ts_hex ) ) ); ?>"></span>
							<?php endforeach; ?>
						</span>
					<?php endif; ?>
					<span class="ts-fam__n">
						<?php
						printf(
							/* translators: %s: a number of colour names. */
							esc_html( _n( '%s coloris', '%s coloris', $ts_n, 'teeshoop' ) ),
							esc_html( num( (float) $ts_n ) )
						);
						?>
					</span>
				</summary>

				<ul class="ts-fam__list">
					<?php
					/*
					 * A TICKED FAMILY IS RENDERED EVEN AT ZERO.
					 *
					 * On a listing with no results every count is zero, so the
					 * checkbox disappeared from the form; the next submission
					 * dropped it and the search silently widened to a family the
					 * buyer had not unticked. `facet_terms()` already keeps a
					 * selected COLOUR for this reason and this is the same rule.
					 */
					$ts_on = in_array( $ts_family, $ts_picked, true );
					?>
					<?php if ( '' !== $ts_family && 'refuse' !== $ts_family && ( $ts_refs > 0 || $ts_on ) ) : ?>
						<li>
							<label class="ts-chip ts-chip--all">
								<input
									type="checkbox"
									name="<?php echo esc_attr( FAMILY_PARAM ); ?>[]"
									value="<?php echo esc_attr( $ts_family ); ?>"
									<?php checked( $ts_on ); ?>
								>
								<span class="ts-chip__label">
									<?php
									printf(
										/* translators: %s: a family of colours, e.g. Bleus. */
										esc_html__( 'Tous les %s', 'teeshoop' ),
										esc_html( mb_strtolower( (string) $ts_group['label'] ) )
									);
									?>
								</span>
								<span class="ts-chip__n"><?php echo esc_html( num( (float) $ts_refs ) ); ?></span>
							</label>
						</li>
					<?php endif; ?>

					<?php foreach ( $ts_group['terms'] as $ts_term ) : ?>
						<?php $ts_style = $ts_swatch( (array) ( $ts_term['stops'] ?? array() ) ); ?>
						<li>
							<label class="ts-chip">
								<input
									type="checkbox"
									name="<?php echo esc_attr( facet_param( 'pa_couleur' ) ); ?>[]"
									value="<?php echo esc_attr( $ts_term['slug'] ); ?>"
									<?php checked( in_array( $ts_term['slug'], $ts_chosen, true ) ); ?>
								>
								<?php if ( '' !== $ts_style ) : ?>
									<span
										class="ts-chip__swatch <?php echo count( (array) $ts_term['stops'] ) > 1 ? 'ts-chip__swatch--deux' : ''; ?>"
										style="<?php echo esc_attr( $ts_style ); ?>"
										aria-hidden="true"
									></span>
								<?php endif; ?>
								<span class="ts-chip__label"><?php echo esc_html( $ts_term['name'] ); ?></span>
								<span class="ts-chip__n"><?php echo esc_html( num( (float) $ts_term['count'] ) ); ?></span>
							</label>
						</li>
					<?php endforeach; ?>
				</ul>

				<?php if ( 'refuse' === $ts_family ) : ?>
					<p class="ts-fam__why">
						<?php esc_html_e( 'Ces coloris existent et sont commandables ; nous n’avons pas pu en mesurer la teinte sur les photos du fabricant, alors nous n’en inventons pas.', 'teeshoop' ); ?>
					</p>
				<?php endif; ?>
			</details>
		<?php endforeach; ?>
	</div>

	<p class="ts-fam__source">
		<?php esc_html_e( 'Les pastilles sont mesurées sur les nuanciers du fabricant, ou à défaut sur ses photos, et les coloris sont regroupés en onze familles. Elles servent à s’y retrouver, pas à valider une teinte : demandez un échantillon avant de lancer une série.', 'teeshoop' ); ?>
	</p>
</fieldset>
