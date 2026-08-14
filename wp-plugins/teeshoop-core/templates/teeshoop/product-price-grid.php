<?php
/**
 * Faces by quantity: the whole price list, before anyone opens the editor.
 *
 * This is Mistertee's best idea and their table is the most transparent thing
 * in the French market: a buyer who wants "fifty tees, front only" gets a number
 * without an account, an editor session or an email. Two things are fixed here.
 * Theirs is TTC only, on a site whose customers are companies, so a professional
 * has to divide by 1,2 to read their own budget. And their columns are round
 * numbers rather than the quantities at which the price actually moves.
 *
 * Every cell is `Pricing::grid()`, which is `Pricing::quote()` per cell, which
 * is what the cart charges. `tests/test-pricing.php` asserts the agreement cell
 * for cell and `tests/integration.php` asserts it again against a real basket
 * and a real order, because a grid that disagrees with the checkout is a support
 * ticket that arrives once per visitor.
 *
 * @package Teeshoop\Core
 *
 * @var string     $garment
 * @var array      $config
 * @var int[]      $qtys
 * @var array      $rows      One row per face count, cells in $qtys order.
 * @var float|null $std_area  Largest area the base price covers, cm².
 * @var array      $request   What the estimator above is currently showing.
 */

use Teeshoop\Core\Money;

defined( 'ABSPATH' ) || exit;

if ( empty( $rows ) ) {
	return;
}
?>
<section class="ts-pricing" id="teeshoop-tarifs">
	<h2 class="ts-pricing__title"><?php esc_html_e( 'Le prix par quantité', 'teeshoop' ); ?></h2>
	<p class="ts-pricing__lead">
		<?php esc_html_e( 'Prix à la pièce, impression comprise. Hors taxes en gras, toutes taxes comprises en dessous.', 'teeshoop' ); ?>
	</p>

	<div class="ts-table__scroll">
		<table class="ts-table ts-table--pricing">
			<thead>
				<tr>
					<th scope="col"><?php esc_html_e( 'Faces imprimées', 'teeshoop' ); ?></th>
					<?php foreach ( $qtys as $ts_qty ) : ?>
						<th scope="col" class="ts-num">
							<?php
							echo esc_html(
								sprintf(
									/* translators: %s: a quantity. */
									_n( '%s pièce', '%s pièces', (int) $ts_qty, 'teeshoop' ),
									Money::number( (float) $ts_qty )
								)
							);
							?>
						</th>
					<?php endforeach; ?>
				</tr>
			</thead>
			<tbody>
				<?php foreach ( $rows as $ts_row ) : ?>
					<tr>
						<th scope="row">
							<?php
							echo esc_html(
								sprintf(
									/* translators: %d: a number of printed faces. */
									_n( '%d face', '%d faces', (int) $ts_row['sides'], 'teeshoop' ),
									(int) $ts_row['sides']
								)
							);
							?>
						</th>
						<?php foreach ( $ts_row['cells'] as $ts_cell ) : ?>
							<td class="ts-num">
								<?php if ( ! empty( $ts_cell['needs_quote'] ) ) : ?>
									<?php
									/*
									 * A CELL THE CART WOULD REFUSE IS NOT A PRICE.
									 *
									 * A hoodie at a hundred pieces is 2 080,00 EUR
									 * HT, past the self-serve threshold, so the
									 * whole hundred-piece column of its public
									 * price list quoted a unit price that
									 * `Cart::add` answers with a 409. The quote
									 * behind every cell already knew; it was
									 * simply being thrown away.
									 */
									?>
									<a class="ts-table__quote" href="#teeshoop-devis"><?php esc_html_e( 'sur devis', 'teeshoop' ); ?></a>
								<?php else : ?>
									<b><?php echo esc_html( Money::format( (int) $ts_cell['unit_ht'] ) ); ?></b>
									<span class="ts-table__ttc"><?php echo esc_html( Money::format( (int) $ts_cell['unit_ttc'] ) ); ?></span>
									<?php if ( (float) $ts_cell['discount_rate'] > 0 ) : ?>
										<span class="ts-table__off">
											<?php
											echo esc_html(
												sprintf(
													/* translators: %s: a discount percentage. */
													__( '-%s', 'teeshoop' ),
													Money::number( (float) $ts_cell['discount_rate'] * 100 ) . "\u{00A0}%"
												)
											);
											?>
										</span>
									<?php endif; ?>
								<?php endif; ?>
							</td>
						<?php endforeach; ?>
					</tr>
				<?php endforeach; ?>
			</tbody>
		</table>
	</div>

	<p class="ts-note">
		<?php
		if ( null !== $std_area ) {
			printf(
				/* translators: %s: an area in square centimetres. */
				esc_html__( 'Ces prix valent pour une impression jusqu’à %s cm² par face.', 'teeshoop' ),
				esc_html( Money::number( $std_area ) )
			);
		}

		$ts_extra = array();
		foreach ( (array) $config['area_tiers'] as $ts_i => $ts_tier ) {
			if ( 0 === $ts_i || (int) $ts_tier['add_ht'] <= 0 ) {
				continue;
			}
			$ts_extra[] = null === $ts_tier['max_sq_cm']
				? sprintf(
					/* translators: %s: a surcharge amount. */
					__( 'au-delà, %s par face', 'teeshoop' ),
					Money::format( (int) $ts_tier['add_ht'] )
				)
				: sprintf(
					/* translators: 1: an area in square centimetres, 2: a surcharge amount. */
					__( 'jusqu’à %1$s cm², %2$s par face', 'teeshoop' ),
					Money::number( (float) $ts_tier['max_sq_cm'] ),
					Money::format( (int) $ts_tier['add_ht'] )
				);
		}

		if ( ! empty( $ts_extra ) ) {
			echo ' ';
			printf(
				/* translators: %s: a list of area surcharges, already assembled. */
				esc_html__( 'Pour une face plus grande, un supplément s’ajoute : %s.', 'teeshoop' ),
				esc_html( implode( ' ; ', $ts_extra ) )
			);
		}
		?>
	</p>
	<p class="ts-note">
		<?php esc_html_e( 'La surface retenue est celle de l’encre, pas celle du fichier : les marges transparentes autour d’un logo ne sont jamais facturées.', 'teeshoop' ); ?>
	</p>
	<p class="ts-note">
		<?php
		printf(
			/* translators: 1: a quantity, 2: an amount excl. VAT. */
			esc_html__( 'Au-delà de %1$s pièces ou de %2$s hors taxes, la commande est chiffrée à la main : les cellules concernées portent la mention « sur devis ».', 'teeshoop' ),
			esc_html( Money::number( (float) $config['quote_from_qty'] ) ),
			esc_html( Money::format( (int) $config['quote_from_ht'] ) )
		);
		?>
	</p>

	<?php if ( current_user_can( 'manage_woocommerce' ) ) : ?>
		<p class="ts-admin-note">
			<?php esc_html_e( 'Visible par vous seul : grille de démonstration. Les colonnes sont déduites des paliers de remise enregistrés, elles ne sont pas choisies à la main. Les vrais tarifs sont la question 04 du document de questions à l’associé.', 'teeshoop' ); ?>
		</p>
	<?php endif; ?>
</section>
