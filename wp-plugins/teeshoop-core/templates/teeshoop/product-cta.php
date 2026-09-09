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
 * @var bool   $needs_quote
 * @var string $atelier_url    L'adresse de l'atelier, ou '' s'il ne peut pas servir.
 * @var bool   $editeur_natif  L'éditeur est dans la page : ce fichier ne pose
 *                             alors ni formulaire de quantité ni bouton
 *                             « Personnaliser », parce que l'éditeur les porte.
 */

use Teeshoop\Core\Money;
use Teeshoop\Core\Pricing;
use Teeshoop\Core\Settings;

defined( 'ABSPATH' ) || exit;

$ts_permalink = get_permalink( $product_id ) ?: home_url( '/' );
$ts_max_qty   = (int) $config['max_qty'];
$ts_discount  = (float) $quote['discount_rate'];
$ts_over_cap  = ! empty( $request['over_cap'] );
$ts_bases     = Settings::price_bases();
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
			if ( ! $ts_bases['two'] ) {
				/*
				 * ONE NUMBER UNDER THE FRANCHISE. Printing "14,50 EUR HT
				 * (14,50 EUR TTC)" states the same amount twice and invites the
				 * reader to look for a tax line that must not exist.
				 */
				printf(
					/* translators: 1: unit price at the smallest run, 2: unit price at the best break, 3: the quantity that reaches it. */
					esc_html__( '%1$s l’unité, %2$s à partir de %3$d pièces.', 'teeshoop' ),
					'<b>' . esc_html( Money::format( (int) $headline['unit']['unit_ht'] ) ) . '</b>',
					'<b>' . esc_html( Money::format( (int) $headline['best']['unit_ht'] ) ) . '</b>',
					(int) $headline['best']['qty']
				);
			} elseif ( 'ttc' === $ts_bases['lead'] ) {
				printf(
					/* translators: 1: unit price incl. VAT at the smallest run, 2: the same excl. VAT, 3: unit price incl. VAT at the best break, 4: the same excl. VAT, 5: the quantity that reaches it. */
					esc_html__( '%1$s TTC (%2$s HT) l’unité, %3$s TTC (%4$s HT) à partir de %5$d pièces.', 'teeshoop' ),
					'<b>' . esc_html( Money::format( (int) $headline['unit']['unit_ttc'] ) ) . '</b>',
					esc_html( Money::format( (int) $headline['unit']['unit_ht'] ) ),
					'<b>' . esc_html( Money::format( (int) $headline['best']['unit_ttc'] ) ) . '</b>',
					esc_html( Money::format( (int) $headline['best']['unit_ht'] ) ),
					(int) $headline['best']['qty']
				);
			} else {
				printf(
					/* translators: 1: unit price excl. VAT at the smallest run, 2: the same incl. VAT, 3: unit price excl. VAT at the best break, 4: the same incl. VAT, 5: the quantity that reaches it. */
					esc_html__( '%1$s HT (%2$s TTC) l’unité, %3$s HT (%4$s TTC) à partir de %5$d pièces.', 'teeshoop' ),
					'<b>' . esc_html( Money::format( (int) $headline['unit']['unit_ht'] ) ) . '</b>',
					esc_html( Money::format( (int) $headline['unit']['unit_ttc'] ) ),
					'<b>' . esc_html( Money::format( (int) $headline['best']['unit_ht'] ) ) . '</b>',
					esc_html( Money::format( (int) $headline['best']['unit_ttc'] ) ),
					(int) $headline['best']['qty']
				);
			}
			?>
			<span class="ts-buy__basis"><?php esc_html_e( 'Impression comprise.', 'teeshoop' ); ?></span>
		</p>
	<?php endif; ?>

	<?php
	/*
	 * ─────────────────────────────────────────────────────────────────────────
	 * UNE SEULE QUESTION, POSÉE UNE SEULE FOIS.
	 *
	 * Cette boîte demandait la quantité, les tailles et le nombre de faces,
	 * puis `CartModal`, à l'intérieur du cadre, redemandait la même grille.
	 * `Shortcode::preset` n'existait que pour masquer ce doublon, et il était
	 * abandonné dès que la série dépassait le plafond, donc le doublon
	 * réapparaissait exactement quand la commande devenait importante. Deux
	 * formulaires pour une réponse, c'est là qu'un acheteur décide que le site
	 * n'est pas fini.
	 *
	 * Quand l'éditeur est dans la page, c'est LUI qui porte la grille de
	 * tailles, le prix et le bouton d'achat : tout ce bloc disparaît. Ce qui
	 * reste au-dessus et en dessous est ce qu'un visiteur sans JavaScript doit
	 * pouvoir lire quand même, et la grille de tarifs publiée plus bas est
	 * rendue par le serveur dans les deux cas.
	 */
	if ( $editeur_natif && '' !== $atelier_url ) :
		/*
		 * ─────────────────────────────────────────────────────────────────────
		 * L'ÉDITEUR N'EST PLUS DANS CETTE FENTE : IL A SA PAGE.
		 *
		 * Ce bloc appelait `Editeur::rendre()` et posait le personnalisateur ici
		 * même. Le 9 septembre 2026 il devient un LIEN vers `/personnaliser/…`,
		 * et il faut dire pourquoi, parce qu'un document de décision daté du
		 * 5 septembre défend l'inverse.
		 *
		 * Ce document a raison sur tout ce qu'il reproche, et rien de cela n'est
		 * une propriété de « une page dédiée ». Il reproche à l'ANCIENNE page :
		 * une application React sur une AUTRE ORIGINE, dans un CADRE, qui
		 * s'ouvrait sur un t-shirt noir d'exemple au lieu du produit cliqué, dont
		 * les fichiers vivaient dans un stockage tiers cloisonné, et qui restait
		 * muette quand le Worker tombait. La page d'aujourd'hui est rendue par
		 * WordPress, sur la même origine, tient son propre nonce, s'ouvre sur le
		 * produit dont on vient, et affiche un message écrit par PHP si rien ne
		 * démarre. Les six réponses tiennent toutes.
		 *
		 * CE QU'ELLE AJOUTE, et qu'un bloc dans une colonne ne peut pas donner :
		 * la largeur de l'écran pour le canevas, une adresse que le client peut
		 * garder, et surtout DEUX ÉTAPES séparées, créer puis choisir combien et
		 * en quelles couleurs. C'est ce parcours-là qui était demandé, et il ne
		 * tient pas dans une fente à côté d'un fil d'Ariane.
		 *
		 * LA FICHE NE PERD RIEN. Ce qu'elle sait dire sans JavaScript reste
		 * au-dessus et en dessous : ce qu'est le vêtement, ce qu'il coûte à la
		 * quantité, jusqu'où on peut imprimer en centimètres, et le devis.
		 */
		?>
		<div class="ts-actions ts-actions--atelier">
			<a class="ts-cta ts-cta--atelier" href="<?php echo esc_url( $atelier_url ); ?>" data-teeshoop-atelier-link>
				<?php esc_html_e( 'Personnaliser ce vêtement', 'teeshoop' ); ?>
			</a>
			<p class="ts-actions__hint">
				<?php esc_html_e( 'Vous placez votre visuel, vous le voyez sur le vêtement, puis vous choisissez les tailles, les coloris et les quantités. Rien n’est commandé avant la dernière étape.', 'teeshoop' ); ?>
			</p>
		</div>
		<?php
	elseif ( $editeur_natif ) :
		/*
		 * L'ÉDITEUR EXISTE MAIS L'ATELIER NE PEUT PAS SERVIR CE PRODUIT.
		 * `Atelier::etat()` dit pourquoi (pas de vêtement déclaré, paquet
		 * absent). On ne pose pas de lien vers une page qui refusera : le
		 * visiteur va au devis, qui lui, aboutit.
		 */
		?>
		<p class="ts-actions__quote">
			<?php esc_html_e( 'Le personnalisateur n’est pas disponible sur cet article pour le moment. Demandez-nous un devis et joignez votre visuel : nous prenons la commande à la main.', 'teeshoop' ); ?>
		</p>
		<?php
	else :
	?>
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
				<?php
				/*
				 * The two data attributes stay on the same two numbers whatever
				 * the order, because product.js updates them by name: swapping
				 * the markup without swapping the hooks would leave the live
				 * estimate writing the TTC into the HT slot.
				 */
				$ts_lead_ttc = $ts_bases['two'] && 'ttc' === $ts_bases['lead'];
				?>
				<b data-teeshoop-total-<?php echo $ts_lead_ttc ? 'ttc' : 'ht'; ?>><?php
					echo esc_html( Money::format( (int) $quote[ $ts_lead_ttc ? 'total_ttc' : 'total_ht' ] ) );
				?></b>
				<?php if ( $ts_bases['two'] ) : ?>
					<abbr title="<?php echo esc_attr( $ts_lead_ttc ? __( 'toutes taxes comprises', 'teeshoop' ) : __( 'hors taxes', 'teeshoop' ) ); ?>"><?php
						echo esc_html( $ts_lead_ttc ? __( 'TTC', 'teeshoop' ) : __( 'HT', 'teeshoop' ) );
					?></abbr>
					<span class="ts-estimate__ttc">
						<span data-teeshoop-total-<?php echo $ts_lead_ttc ? 'ht' : 'ttc'; ?>><?php
							echo esc_html( Money::format( (int) $quote[ $ts_lead_ttc ? 'total_ht' : 'total_ttc' ] ) );
						?></span>
						<abbr title="<?php echo esc_attr( $ts_lead_ttc ? __( 'hors taxes', 'teeshoop' ) : __( 'toutes taxes comprises', 'teeshoop' ) ); ?>"><?php
							echo esc_html( $ts_lead_ttc ? __( 'HT', 'teeshoop' ) : __( 'TTC', 'teeshoop' ) );
						?></abbr>
					</span>
				<?php endif; ?>
			</p>
			<?php if ( '' !== $ts_bases['mention'] ) : ?>
				<p class="ts-estimate__basis"><?php echo esc_html( $ts_bases['mention'] ); ?></p>
			<?php endif; ?>
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

		<?php
		/*
		 * IL N'Y A PLUS DE BOUTON « PERSONNALISER », ET C'EST VOULU.
		 *
		 * Il menait à `?personnaliser=1`, une seconde page qui encadrait le
		 * studio. L'éditeur est maintenant dans cette fente-ci ; cette branche du
		 * gabarit n'est atteinte que lorsque le paquet construit est ABSENT du
		 * greffon, c'est-à-dire quand il n'y a rien à personnaliser. Un bouton
		 * qui mène à une page vide est pire qu'une phrase qui dit quoi faire :
		 * mesuré la nuit du 5 septembre, `verify:vendable` a compté cette ancre
		 * comme un chemin d'achat jusqu'à ce qu'il aille voir derrière.
		 */
		?>
		<p class="ts-actions__quote">
			<?php esc_html_e( 'Le personnalisateur n’est pas disponible sur cette page pour le moment. Demandez-nous un devis et joignez votre visuel : nous prenons la commande à la main.', 'teeshoop' ); ?>
		</p>
		<a class="ts-cta" href="#teeshoop-devis" data-teeshoop-devis-link>
			<?php esc_html_e( 'Demander un devis', 'teeshoop' ); ?>
		</a>
	</div>
	<?php endif; ?>

	<?php
	/*
	 * LE LIEN VERS LE DEVIS SURVIT À LA DISPARITION DES DEUX BOUTONS.
	 *
	 * Une commande au-delà du seuil ne se chiffre pas toute seule, et l'éditeur
	 * le dit aussi ; mais un visiteur qui arrive sur la fiche sans rien poser
	 * doit trouver le chemin du devis sans avoir à déposer un fichier d'abord.
	 */
	if ( $editeur_natif ) :
	?>
		<p class="ts-actions ts-actions--devis">
			<a class="ts-cta ts-cta--ghost" href="#teeshoop-devis" data-teeshoop-devis-link>
				<?php esc_html_e( 'Demander un devis', 'teeshoop' ); ?>
			</a>
		</p>
	<?php endif; ?>

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
	 * THE MARKER IS NOT HERE, and that is deliberate.
	 *
	 * A sentence used to be typed here saying the grid was a demonstration, and
	 * it sent the reader to question 04, which is about DTF supplier rates and
	 * settles no selling price. It is now drawn from `docs/hypotheses.json`, ONCE
	 * per page, under the price grid a few blocks below: this box shows one
	 * estimate and that block is the price list, so that is where a reader
	 * checking prices is looking. `Hypotheses::note` enforces the once-per-page
	 * rule itself, so a second call here would print nothing anyway.
	 */
	?>
</div>
