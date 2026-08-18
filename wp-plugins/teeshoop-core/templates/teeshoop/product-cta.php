<?php
/**
 * The buy box: how many, in which sizes, on how many faces, what that costs,
 * and the two ways on.
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
 * THE SINGLE-SIZE PANE ASKS WHICH SIZE, and that is not a nicety. It used to ask
 * only "how many", and the answer travelled into the studio as a bare count,
 * where the basket panel turned it into forty garments in whatever size the 3D
 * preview happened to be showing. A count is not a size.
 *
 * @package Teeshoop\Core
 *
 * @var int    $product_id
 * @var string $garment
 * @var array  $config
 * @var array  $request     qty, typed, over_cap, faces, grid, mode.
 * @var array  $quote       Pricing::quote for exactly those inputs.
 * @var array  $headline    The two anchor cells, from Pricing::headline.
 * @var array  $sizes       Size ids this garment is offered in.
 * @var string $size        The size a single-size run is in.
 * @var int    $max_faces
 * @var string $studio_url
 * @var bool   $needs_quote
 */

use Teeshoop\Core\Money;
use Teeshoop\Core\Pricing;

defined( 'ABSPATH' ) || exit;

$ts_permalink = get_permalink( $product_id ) ?: home_url( '/' );
$ts_max_qty   = (int) $config['max_qty'];
$ts_discount  = (float) $quote['discount_rate'];
$ts_over_cap  = ! empty( $request['over_cap'] );
?>
<div class="ts-buy" data-teeshoop-buy>

	<?php if ( ! empty( $headline['unit'] ) && ! empty( $headline['best'] ) && (int) $headline['unit']['unit_ht'] > (int) $headline['best']['unit_ht'] ) : ?>
		<p class="ts-buy__anchors">
			<?php
			/*
			 * BOTH BASES IN THE SENTENCE A CONSUMER READS FIRST.
			 *
			 * This paragraph is the largest type on the page. Printing HT alone
			 * with "hors taxes" underneath is mistertee.fr's mistake in reverse
			 * (they print TTC only, on a site selling to companies), and it
			 * leaves a consumer multiplying by 1,2 to find their own number.
			 */
			printf(
				/* translators: 1: unit price excl. VAT at quantity one, 2: the same incl. VAT, 3: unit price excl. VAT at the best break, 4: the same incl. VAT, 5: the quantity that reaches it. */
				esc_html__( '%1$s HT (%2$s TTC) l’unité à la pièce, %3$s HT (%4$s TTC) à partir de %5$d pièces.', 'teeshoop' ),
				'<b>' . esc_html( Money::format( (int) $headline['unit']['unit_ht'] ) ) . '</b>',
				esc_html( Money::format( (int) $headline['unit']['unit_ttc'] ) ),
				'<b>' . esc_html( Money::format( (int) $headline['best']['unit_ht'] ) ) . '</b>',
				esc_html( Money::format( (int) $headline['best']['unit_ttc'] ) ),
				(int) $headline['best']['qty']
			);
			?>
			<span class="ts-buy__basis"><?php esc_html_e( 'Impression comprise.', 'teeshoop' ); ?></span>
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
				<div class="ts-qty__row">
					<label class="ts-qty__field">
						<span class="ts-qty__label"><?php esc_html_e( 'Nombre de pièces', 'teeshoop' ); ?></span>
						<input
							class="ts-qty__input"
							type="number"
							name="qte"
							inputmode="numeric"
							min="1"
							max="<?php echo esc_attr( (string) $ts_max_qty ); ?>"
							step="1"
							value="<?php echo esc_attr( (string) ( 'grid' === $request['mode'] ? 1 : (int) $request['typed'] ) ); ?>">
					</label>

					<?php if ( ! empty( $sizes ) ) : ?>
						<label class="ts-qty__field">
							<span class="ts-qty__label"><?php esc_html_e( 'Taille', 'teeshoop' ); ?></span>
							<select class="ts-qty__select" name="taille">
								<?php foreach ( $sizes as $ts_s ) : ?>
									<option value="<?php echo esc_attr( $ts_s ); ?>" <?php selected( $ts_s, $size ); ?>><?php echo esc_html( $ts_s ); ?></option>
								<?php endforeach; ?>
							</select>
						</label>
					<?php endif; ?>
				</div>
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
						<b data-teeshoop-grid-total><?php echo esc_html( Money::number( (float) array_sum( $request['grid'] ) ) ); ?></b>
						<?php esc_html_e( 'pièces', 'teeshoop' ); ?>
					</p>
				</div>
			<?php endif; ?>

			<button type="submit" class="ts-recalc" data-teeshoop-recalc><?php esc_html_e( 'Recalculer le prix', 'teeshoop' ); ?></button>
		</fieldset>
	</form>

	<?php if ( $ts_over_cap ) : ?>
		<?php
		/*
		 * PAST THE CAP THE PAGE STOPS PRICING RATHER THAN QUIETLY REDUCING.
		 *
		 * Clamping printed two numbers on one screen: "Total 30 000 pièces" in
		 * the size pane and "10 000 pièces, 94 200,00 EUR HT" in the estimate,
		 * for a run the cart refuses outright. The cart already refuses to clamp
		 * for the same reason; so does this.
		 */
		?>
		<p class="ts-msg ts-msg--bad" role="status">
			<?php
			printf(
				/* translators: 1: the quantity the customer asked for, 2: the largest quantity one order accepts. */
				esc_html__( 'Vous avez indiqué %1$s pièces. Au-delà de %2$s sur une seule commande, nous chiffrons à la main plutôt que d’afficher un prix approximatif.', 'teeshoop' ),
				esc_html( Money::number( (float) $request['typed'] ) ),
				esc_html( Money::number( (float) $ts_max_qty ) )
			);
			?>
		</p>
	<?php else : ?>
		<output class="ts-estimate" data-teeshoop-estimate aria-live="polite">
			<?php
			/*
			 * ONE node for the whole sentence, not a number inside a fixed noun.
			 *
			 * The first version wrapped only the figure and left "pièce" in the
			 * template, so the live estimate read "45 pièce, 1 face imprimée":
			 * the page loads at quantity one, and JavaScript replaced the digit
			 * while the singular stayed put.
			 */
			?>
			<p class="ts-estimate__for" data-teeshoop-for>
				<?php
				echo esc_html(
					sprintf(
						/* translators: 1: quantity, 2: an already-assembled "N faces imprimées". */
						_n( '%1$s pièce, %2$s', '%1$s pièces, %2$s', (int) $quote['qty'], 'teeshoop' ),
						Money::number( (float) $quote['qty'] ),
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
				<span data-teeshoop-unit><?php
					printf(
						/* translators: %s: unit price excl. VAT. */
						esc_html__( 'soit %s l’unité', 'teeshoop' ),
						esc_html( Money::format( (int) $quote['unit_ht'] ) )
					);
				?></span><?php
				// Printed with no whitespace around it, because the separator is
				// a CSS ::before on :not(:empty) and a newline inside the span is
				// content: the estimate opened with a dangling middle dot on
				// every first view until the buyer touched a control.
				?><span data-teeshoop-discount><?php
					if ( $ts_discount > 0 ) {
						printf(
							/* translators: %s: discount percentage already applied. */
							esc_html__( 'remise de %s comprise', 'teeshoop' ),
							esc_html( Money::number( $ts_discount * 100 ) . "\u{00A0}%" )
						);
					}
				?></span>
			</p>
		</output>
	<?php endif; ?>

	<div class="ts-actions" data-teeshoop-actions>
		<p class="ts-actions__quote" data-teeshoop-needs-quote <?php echo ( $needs_quote || $ts_over_cap ) ? '' : 'hidden'; ?>>
			<?php
			printf(
				/* translators: 1: a quantity, 2: an amount excl. VAT. */
				esc_html__( 'Au-delà de %1$s pièces ou de %2$s hors taxes, nous chiffrons la commande à la main : à cette taille, le tissu, la production et le transport se négocient, et le tarif public ne les décrit plus.', 'teeshoop' ),
				esc_html( Money::number( (float) $config['quote_from_qty'] ) ),
				esc_html( Money::format( (int) $config['quote_from_ht'] ) )
			);
			?>
		</p>

		<?php $ts_devis_first = $needs_quote || $ts_over_cap; ?>
		<a class="ts-cta <?php echo $ts_devis_first ? 'ts-cta--ghost' : ''; ?>" href="<?php echo esc_url( $studio_url ); ?>" data-teeshoop-personnaliser>
			<?php esc_html_e( 'Personnaliser ce vêtement', 'teeshoop' ); ?>
		</a>
		<a class="ts-cta <?php echo $ts_devis_first ? '' : 'ts-cta--ghost'; ?>" href="#teeshoop-devis" data-teeshoop-devis-link>
			<?php esc_html_e( 'Demander un devis', 'teeshoop' ); ?>
		</a>
	</div>

	<p class="ts-note">
		<?php
		$ts_std = Pricing::std_area_sq_cm( $config );
		if ( null !== $ts_std ) {
			printf(
				/* translators: %s: the largest printed area covered by the base price, in square centimetres. */
				esc_html__( 'Estimation pour une impression jusqu’à %s cm² par face. Le prix définitif est calculé sur la surface réellement imprimée, une fois votre visuel placé : les marges transparentes d’un logo ne sont pas facturées, et une face plus grande coûte le supplément indiqué sous la grille.', 'teeshoop' ),
				esc_html( Money::number( $ts_std ) )
			);
		} else {
			esc_html_e( 'Le prix définitif est calculé sur la surface réellement imprimée, une fois votre visuel placé : les marges transparentes d’un logo ne sont pas facturées.', 'teeshoop' );
		}
		?>
	</p>

	<?php
	/*
	 * ONE MARKER, DRAWN FROM THE REGISTER. It draws nothing for a visitor:
 * `Hypotheses::note` checks the capability itself.
	 *
	 * This note used to be a sentence typed here, and it sent the reader to
	 * question 04, which is about DTF supplier rates. The selling grid is
	 * questions 03, 06 and 08. `Hypotheses` reads which values on this page are
	 * still assumed and names their real questions, so the pointer cannot be
	 * wrong and cannot go stale.
	 */
	Teeshoop\Core\Hypotheses::note( Teeshoop\Core\Hypotheses::HOME_PRICING );
	?>
</div>
