<?php
/**
 * The buy box: how many, on how many faces, what that costs, and the two ways on.
 *
 * It sits in WooCommerce's add-to-cart slot because that is where a buyer's eye
 * already is, and because on a personalisable garment "Ajouter au panier" is not
 * yet a true sentence: there is nothing to add until a visual has been placed.
 *
 * IT WORKS WITHOUT JAVASCRIPT. The form is a GET to this same page, so pressing
 * the button reloads it with the estimate recomputed on the server. `product.js`
 * then hides that button and updates the figures in place. Every amount below
 * came from Pricing, on the server, in this request.
 *
 * @package Teeshoop\Core
 *
 * @var int    $product_id
 * @var string $garment
 * @var array  $config
 * @var array  $request     qty, faces, grid, mode, as read from the URL.
 * @var array  $quote       Pricing::quote for exactly those inputs.
 * @var array  $headline    The two anchor cells, from Pricing::headline.
 * @var array  $sizes       Size ids this garment is offered in.
 * @var int    $max_faces
 * @var string $studio_url
 * @var bool   $needs_quote
 */

use Teeshoop\Core\Money;

defined( 'ABSPATH' ) || exit;

$ts_permalink = get_permalink( $product_id ) ?: home_url( '/' );
$ts_max_qty   = (int) $config['max_qty'];
$ts_discount  = (float) $quote['discount_rate'];
?>
<div class="ts-buy" data-teeshoop-buy>

	<?php if ( ! empty( $headline['unit'] ) && ! empty( $headline['best'] ) && (int) $headline['unit']['unit_ht'] > (int) $headline['best']['unit_ht'] ) : ?>
		<p class="ts-buy__anchors">
			<?php
			printf(
				/* translators: 1: unit price at quantity one, 2: unit price at the best break, 3: the quantity that reaches it. */
				esc_html__( '%1$s l’unité à la pièce, %2$s à partir de %3$d pièces.', 'teeshoop' ),
				'<b>' . esc_html( Money::format( (int) $headline['unit']['unit_ht'] ) ) . '</b>',
				'<b>' . esc_html( Money::format( (int) $headline['best']['unit_ht'] ) ) . '</b>',
				(int) $headline['best']['qty']
			);
			?>
			<span class="ts-buy__basis"><?php esc_html_e( 'Hors taxes, impression comprise.', 'teeshoop' ); ?></span>
		</p>
	<?php endif; ?>

	<form class="ts-buy__form" method="get" action="<?php echo esc_url( $ts_permalink ); ?>" data-teeshoop-estimator>

		<?php if ( $max_faces > 1 ) : ?>
			<fieldset class="ts-field">
				<legend class="ts-field__legend"><?php esc_html_e( 'Faces imprimées', 'teeshoop' ); ?></legend>
				<div class="ts-seg">
					<?php for ( $ts_f = 1; $ts_f <= $max_faces; $ts_f++ ) : ?>
						<label class="ts-seg__item">
							<input type="radio" name="faces" value="<?php echo esc_attr( (string) $ts_f ); ?>" <?php checked( $ts_f, (int) $request['faces'] ); ?>>
							<span><?php echo esc_html( sprintf( _n( '%d face', '%d faces', $ts_f, 'teeshoop' ), $ts_f ) ); ?></span>
						</label>
					<?php endfor; ?>
				</div>
			</fieldset>
		<?php endif; ?>

		<fieldset class="ts-field">
			<legend class="ts-field__legend"><?php esc_html_e( 'Quantité', 'teeshoop' ); ?></legend>

			<?php if ( ! empty( $sizes ) ) : ?>
				<div class="ts-seg ts-seg--modes">
					<label class="ts-seg__item">
						<input type="radio" name="mode" value="single" <?php checked( 'single', $request['mode'] ); ?> data-teeshoop-mode>
						<span><?php esc_html_e( 'Une seule taille', 'teeshoop' ); ?></span>
					</label>
					<label class="ts-seg__item">
						<input type="radio" name="mode" value="grid" <?php checked( 'grid', $request['mode'] ); ?> data-teeshoop-mode>
						<span><?php esc_html_e( 'Plusieurs tailles', 'teeshoop' ); ?></span>
					</label>
				</div>
			<?php endif; ?>

			<div class="ts-qty" data-teeshoop-pane="single" <?php echo 'single' === $request['mode'] ? '' : 'hidden'; ?>>
				<label class="ts-qty__label" for="ts-qte"><?php esc_html_e( 'Nombre de pièces', 'teeshoop' ); ?></label>
				<input
					class="ts-qty__input"
					id="ts-qte"
					type="number"
					name="qte"
					inputmode="numeric"
					min="1"
					max="<?php echo esc_attr( (string) $ts_max_qty ); ?>"
					step="1"
					value="<?php echo esc_attr( (string) ( 'grid' === $request['mode'] ? 1 : (int) $request['qty'] ) ); ?>">
			</div>

			<?php if ( ! empty( $sizes ) ) : ?>
				<div class="ts-sizes" data-teeshoop-pane="grid" <?php echo 'grid' === $request['mode'] ? '' : 'hidden'; ?>>
					<p class="ts-sizes__intro"><?php esc_html_e( 'Un seul visuel, une seule commande. Indiquez combien de pièces par taille.', 'teeshoop' ); ?></p>
					<div class="ts-sizes__grid">
						<?php foreach ( $sizes as $ts_size ) : ?>
							<label class="ts-sizes__cell">
								<span class="ts-sizes__name"><?php echo esc_html( $ts_size ); ?></span>
								<input
									type="number"
									name="tailles[<?php echo esc_attr( $ts_size ); ?>]"
									inputmode="numeric"
									min="0"
									max="<?php echo esc_attr( (string) $ts_max_qty ); ?>"
									step="1"
									aria-label="<?php echo esc_attr( sprintf( __( 'Quantité en taille %s', 'teeshoop' ), $ts_size ) ); ?>"
									value="<?php echo esc_attr( (string) (int) ( $request['grid'][ $ts_size ] ?? 0 ) ); ?>">
							</label>
						<?php endforeach; ?>
					</div>
					<p class="ts-sizes__total">
						<?php esc_html_e( 'Total', 'teeshoop' ); ?>
						<b data-teeshoop-grid-total><?php echo esc_html( (string) (int) array_sum( $request['grid'] ) ); ?></b>
						<?php esc_html_e( 'pièces', 'teeshoop' ); ?>
					</p>
				</div>
			<?php endif; ?>

			<button type="submit" class="ts-recalc" data-teeshoop-recalc><?php esc_html_e( 'Recalculer le prix', 'teeshoop' ); ?></button>
		</fieldset>
	</form>

	<output class="ts-estimate" data-teeshoop-estimate aria-live="polite">
		<?php
		/*
		 * ONE node for the whole sentence, not a number inside a fixed noun.
		 *
		 * The first version wrapped only the figure and left "pièce" in the
		 * template, so the live estimate read "45 pièce, 1 face imprimée": the
		 * page loads at quantity one, and JavaScript replaced the digit while
		 * the singular stayed put. Plurals are part of the sentence, so the
		 * sentence is what gets replaced.
		 */
		?>
		<p class="ts-estimate__for" data-teeshoop-for>
			<?php
			echo esc_html(
				sprintf(
					/* translators: 1: quantity, 2: an already-assembled "N faces imprimées". */
					_n( '%1$s pièce, %2$s', '%1$s pièces, %2$s', (int) $quote['qty'], 'teeshoop' ),
					number_format_i18n( (int) $quote['qty'] ),
					sprintf(
						/* translators: %d: a number of printed faces. */
						_n( '%d face imprimée', '%d faces imprimées', (int) $request['faces'], 'teeshoop' ),
						(int) $request['faces']
					)
				)
			);
			?>
		</p>
		<p class="ts-estimate__total">
			<b data-teeshoop-total-ht><?php echo esc_html( Money::format( (int) $quote['total_ht'] ) ); ?></b>
			<abbr title="<?php esc_attr_e( 'hors taxes', 'teeshoop' ); ?>"><?php esc_html_e( 'HT', 'teeshoop' ); ?></abbr>
			<span class="ts-estimate__ttc">
				<span data-teeshoop-total-ttc><?php echo esc_html( Money::format( (int) $quote['total_ttc'] ) ); ?></span>
				<abbr title="<?php esc_attr_e( 'toutes taxes comprises', 'teeshoop' ); ?>"><?php esc_html_e( 'TTC', 'teeshoop' ); ?></abbr>
			</span>
		</p>
		<p class="ts-estimate__unit">
			<span data-teeshoop-unit>
				<?php
				printf(
					/* translators: %s: unit price excl. VAT. */
					esc_html__( 'soit %s l’unité', 'teeshoop' ),
					esc_html( Money::format( (int) $quote['unit_ht'] ) )
				);
				?>
			</span>
			<span data-teeshoop-discount>
				<?php if ( $ts_discount > 0 ) : ?>
					<?php
					printf(
						/* translators: %s: discount percentage already applied. */
						esc_html__( 'remise de %s comprise', 'teeshoop' ),
						esc_html( number_format_i18n( $ts_discount * 100 ) . "\u{00A0}%" )
					);
					?>
				<?php endif; ?>
			</span>
		</p>
	</output>

	<div class="ts-actions" data-teeshoop-actions>
		<p class="ts-actions__quote" data-teeshoop-needs-quote <?php echo $needs_quote ? '' : 'hidden'; ?>>
			<?php
			printf(
				/* translators: 1: a quantity, 2: an amount excl. VAT. */
				esc_html__( 'Au-delà de %1$d pièces ou de %2$s hors taxes, nous chiffrons la commande à la main : le tissu, la production et le transport ne se calculent plus seuls, et le prix est en général meilleur que le tarif public.', 'teeshoop' ),
				(int) $config['quote_from_qty'],
				esc_html( Money::format( (int) $config['quote_from_ht'] ) )
			);
			?>
		</p>

		<a class="ts-cta <?php echo $needs_quote ? 'ts-cta--ghost' : ''; ?>" href="<?php echo esc_url( $studio_url ); ?>" data-teeshoop-personnaliser>
			<?php esc_html_e( 'Personnaliser ce vêtement', 'teeshoop' ); ?>
		</a>
		<a class="ts-cta <?php echo $needs_quote ? '' : 'ts-cta--ghost'; ?>" href="#teeshoop-devis" data-teeshoop-devis-link>
			<?php esc_html_e( 'Demander un devis', 'teeshoop' ); ?>
		</a>
	</div>

	<p class="ts-note">
		<?php
		$ts_std = \Teeshoop\Core\Pricing::std_area_sq_cm( $config );
		if ( null !== $ts_std ) {
			printf(
				/* translators: %s: the largest printed area covered by the base price, in square centimetres. */
				esc_html__( 'Estimation pour une impression jusqu’à %s cm² par face. Le prix définitif est calculé sur la surface réellement imprimée, une fois votre visuel placé : les marges transparentes d’un logo ne sont pas facturées.', 'teeshoop' ),
				esc_html( number_format_i18n( $ts_std ) )
			);
		} else {
			esc_html_e( 'Le prix définitif est calculé sur la surface réellement imprimée, une fois votre visuel placé : les marges transparentes d’un logo ne sont pas facturées.', 'teeshoop' );
		}
		?>
	</p>

	<?php if ( current_user_can( 'manage_woocommerce' ) ) : ?>
		<p class="ts-admin-note">
			<?php esc_html_e( 'Visible par vous seul : la grille tarifaire est encore une grille de démonstration. Les vrais tarifs sont la question 04 du document de questions à l’associé, et se règlent dans l’option teeshoop_pricing.', 'teeshoop' ); ?>
		</p>
	<?php endif; ?>
</div>
