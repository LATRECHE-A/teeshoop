<?php
/**
 * The homepage.
 *
 * WHAT IT HAS TO DO, from the session brief: a first-time visitor understands in
 * five seconds what we make, for whom, from how many, how fast and at what
 * price, and there is one dominant call to action.
 *
 * WHAT IT MAY NOT DO, from chapter 00 of the associate's brief: « Il n'est pas
 * prévu de réduire le site à une petite sélection » and « La solution n'est pas
 * de cacher la majorité des produits ». A homepage that showed six hero products
 * and hid four hundred and fifty-nine would contradict the offer it is selling.
 * So the catalogue's real size is stated, counted from the shop, and the
 * categories are the way in.
 *
 * NOT ONE NUMBER ON THIS PAGE IS TYPED HERE. The price comes from
 * `Pricing::headline()`, which reads its two anchors out of the grid printed on
 * the product page; the minimum from the same config the basket refuses on; the
 * lead time from `Production::config()`; the print dimensions from
 * `Garments::areas()`, generated from the studio; the reference count from
 * WordPress. The one thing a homepage is for is making promises, and every
 * promise here is one some other file already has to keep.
 *
 * @package Teeshoop\Theme
 */

namespace Teeshoop\Theme;

defined( 'ABSPATH' ) || exit;

get_header();

$ts_products = personalisable_products( 8 );
$ts_first    = $ts_products[0] ?? null;
/*
 * ONE GARMENT FOR THE WHOLE HERO.
 *
 * The price, the "Personnaliser" button and the print zone all describe the
 * SAME product, and the drawing used to be hardcoded to the tee while the other
 * two followed whatever product sorted first. On a shop whose first
 * personalisable product is a sweat, the page offered a sweat at a sweat's price
 * beside a t-shirt's 30,5 x 40,6 cm, and a buyer who sized their logo from that
 * drawing would have paid for a reprint.
 */
$ts_garment  = $ts_first instanceof \WC_Product && class_exists( '\Teeshoop\Core\Product' )
	? \Teeshoop\Core\Product::garment_of( $ts_first->get_id() )
	: '';
$ts_headline = '' !== $ts_garment ? headline( $ts_garment ) : array();
$ts_min      = minimum();
$ts_lead     = lead_days();
$ts_cat      = catalogue_stats();
?>

<section class="ts-hero ts-wrap">
	<div class="ts-hero__text">
		<p class="ts-eyebrow"><?php esc_html_e( 'Marquage textile, imprimé en France', 'teeshoop' ); ?></p>
		<h1 class="ts-hero__title"><?php esc_html_e( 'Le textile personnalisé, pour les professionnels', 'teeshoop' ); ?></h1>

		<?php /* The associate's own promise, chapter 00, word for word. */ ?>
		<p class="ts-hero__strap">
			<?php esc_html_e( 'Vous vous occupez de votre entreprise. Teeshoop s’occupe de votre image textile, de la création à la livraison.', 'teeshoop' ); ?>
		</p>

		<p class="ts-lead">
			<?php
			printf(
				/* translators: %s: the minimum number of pieces. */
				esc_html__( 'T-shirts, polos et sweats marqués à votre logo, à partir de %s pièces. Vous dessinez en ligne et vous voyez le prix avant de commander, ou vous nous décrivez le projet et nous le chiffrons.', 'teeshoop' ),
				'<span class="ts-num">' . esc_html( num( (float) $ts_min['qty'] ) ) . '</span>'
			);
			?>
		</p>

		<div class="ts-btnrow">
			<?php if ( $ts_first instanceof \WC_Product ) : ?>
				<a class="ts-cta" href="<?php echo esc_url( studio_url( $ts_first->get_id() ) ); ?>">
					<?php esc_html_e( 'Personnaliser un vêtement', 'teeshoop' ); ?>
				</a>
			<?php endif; ?>
			<a class="ts-hero__second" href="<?php echo esc_url( quote_url() ); ?>">
				<?php esc_html_e( 'Demander un devis', 'teeshoop' ); ?>
			</a>
		</div>
	</div>

	<div class="ts-hero__media">
		<?php
		$ts_figure = '' !== $ts_garment ? print_zone_figure( $ts_garment ) : '';
		if ( '' !== $ts_figure ) {
			echo $ts_figure; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- built and escaped in print_zone_figure().
		}
		?>
	</div>
</section>

<?php /* The four facts, as a specification block. Each one is read, not written. */ ?>
<section class="ts-wrap" aria-label="<?php esc_attr_e( 'Nos conditions en quatre chiffres', 'teeshoop' ); ?>">
	<dl class="ts-facts">
		<?php if ( ! empty( $ts_headline['best'] ) ) : ?>
			<?php $ts_pair = price_pair( (int) $ts_headline['best']['unit_ht'], (int) $ts_headline['best']['unit_ttc'] ); ?>
			<div class="ts-facts__item">
				<dt class="ts-facts__term"><?php esc_html_e( 'Prix à la pièce', 'teeshoop' ); ?></dt>
				<dd class="ts-facts__value">
					<?php echo esc_html( $ts_pair['lead'] ); ?>
					<small>
						<?php
						printf(
							/* translators: 1: the quantity that reaches the price, 2: the same amount on the other tax basis. */
							esc_html__( 'la pièce dès %1$s, impression comprise %2$s', 'teeshoop' ),
							esc_html( num( (float) $ts_headline['best']['qty'] ) ),
							esc_html( $ts_pair['second'] )
						);
						?>
					</small>
				</dd>
			</div>
		<?php endif; ?>

		<div class="ts-facts__item">
			<dt class="ts-facts__term"><?php esc_html_e( 'Commande minimum', 'teeshoop' ); ?></dt>
			<dd class="ts-facts__value">
				<?php
				printf(
					/* translators: %s: a number of pieces. */
					esc_html( _n( '%s pièce', '%s pièces', (int) $ts_min['qty'], 'teeshoop' ) ),
					esc_html( num( (float) $ts_min['qty'] ) )
				);
				?>
				<small>
					<?php
					printf(
						/* translators: %s: the minimum order value. */
						esc_html__( 'et %s de commande', 'teeshoop' ),
						esc_html( eur( $ts_min['ht_cents'] ) )
					);
					?>
				</small>
			</dd>
		</div>

		<?php if ( isset( $ts_lead['standard'] ) ) : ?>
			<div class="ts-facts__item">
				<dt class="ts-facts__term"><?php esc_html_e( 'Fabrication', 'teeshoop' ); ?></dt>
				<dd class="ts-facts__value">
					<?php
					printf(
						/* translators: %s: a number of working days. */
						esc_html__( '%s jours ouvrés', 'teeshoop' ),
						esc_html( num( (float) $ts_lead['standard'] ) )
					);
					?>
					<small><?php esc_html_e( 'à partir de votre bon à tirer validé', 'teeshoop' ); ?></small>
				</dd>
			</div>
		<?php endif; ?>

		<?php
		// The same garment as the price and the button above, for the same reason.
		$ts_area = '' !== $ts_garment && class_exists( '\\Teeshoop\\Core\\Garments' )
			? \Teeshoop\Core\Garments::area_by_size( $ts_garment, 'front' )
			: array();
		$ts_ref  = '' !== $ts_garment && class_exists( '\\Teeshoop\\Core\\Garments' )
			? \Teeshoop\Core\Garments::priced_size( $ts_garment )
			: '';
		if ( isset( $ts_area[ $ts_ref ] ) ) :
			?>
			<div class="ts-facts__item">
				<dt class="ts-facts__term"><?php esc_html_e( 'Zone d’impression', 'teeshoop' ); ?></dt>
				<dd class="ts-facts__value">
					<?php
					printf(
						/* translators: 1: width in cm, 2: height in cm. */
						esc_html__( '%1$s × %2$s', 'teeshoop' ),
						esc_html( \Teeshoop\Core\Garments::cm( (float) $ts_area[ $ts_ref ]['wCm'] ) ),
						esc_html( \Teeshoop\Core\Garments::cm( (float) $ts_area[ $ts_ref ]['hCm'] ) )
					);
					?>
					<small>
						<?php
						printf(
							/* translators: %s: a garment size. */
							esc_html__( 'devant et dos, en taille %s', 'teeshoop' ),
							esc_html( $ts_ref )
						);
						?>
					</small>
				</dd>
			</div>
		<?php endif; ?>
	</dl>

	<?php
	// The admin-only marker: these figures are assumptions, not the associate's
	// answers. Printed once per request, and only to someone who can act on it.
	if ( class_exists( '\\Teeshoop\\Core\\Hypotheses' ) ) {
		\Teeshoop\Core\Hypotheses::note( \Teeshoop\Core\Hypotheses::HOME_PRICING );
	}
	?>
</section>

<?php /* The catalogue, at its real size. */ ?>
<section class="ts-section ts-wrap" aria-labelledby="ts-catalogue-title">
	<div class="ts-section__head">
		<p class="ts-eyebrow"><?php esc_html_e( 'Le catalogue', 'teeshoop' ); ?></p>
		<h2 id="ts-catalogue-title">
			<?php
			printf(
				/* translators: %s: number of published references. */
				esc_html( _n( '%s référence, prête à marquer', '%s références, prêtes à marquer', $ts_cat['references'], 'teeshoop' ) ),
				esc_html( num( (float) $ts_cat['references'] ) )
			);
			?>
		</h2>
		<p class="ts-lead">
			<?php esc_html_e( 'Des marques que vos salariés connaissent, avec leur grammage, leur matière, leurs coloris et leurs tailles. Vous filtrez, vous comparez, et vous nous demandez le prix de la quantité qui vous intéresse.', 'teeshoop' ); ?>
		</p>
	</div>

	<?php $ts_terms = top_categories(); ?>
	<?php if ( empty( $ts_terms ) ) : ?>
		<div class="ts-empty">
			<h3 class="ts-empty__title"><?php esc_html_e( 'Le catalogue n’est pas encore importé', 'teeshoop' ); ?></h3>
			<p><?php esc_html_e( 'Aucune famille de produits n’est publiée sur cette boutique. L’import fournisseur remplit les catégories ; tant qu’il n’a pas tourné, il n’y a rien d’honnête à montrer ici.', 'teeshoop' ); ?></p>
		</div>
	<?php else : ?>
		<ul class="ts-families">
			<?php foreach ( $ts_terms as $ts_term ) : ?>
				<li class="ts-families__item">
					<a class="ts-families__link" href="<?php echo esc_url( (string) get_term_link( $ts_term ) ); ?>">
						<span class="ts-families__name"><?php echo esc_html( $ts_term->name ); ?></span>
						<span class="ts-families__n ts-num">
							<?php
							printf(
								/* translators: %s: number of references in this family. */
								esc_html( _n( '%s référence', '%s références', (int) $ts_term->count, 'teeshoop' ) ),
								esc_html( num( (float) $ts_term->count ) )
							);
							?>
						</span>
					</a>
				</li>
			<?php endforeach; ?>
		</ul>

		<?php if ( ! $ts_cat['priced'] ) : ?>
			<?php /* Read from the shop, not stated: the day a margin rate is set the listing starts showing prices and this sentence has to stop denying they exist. */ ?>
			<p class="ts-note ts-note--strong">
				<?php esc_html_e( 'Les tarifs des textiles nus ne sont pas encore publiés. Le catalogue se consulte librement ; pour un prix, dites-nous la référence, la quantité et les tailles.', 'teeshoop' ); ?>
			</p>
		<?php endif; ?>
	<?php endif; ?>
</section>

<?php /* What can actually be designed and bought online today. */ ?>
<section class="ts-section ts-wrap" id="personnaliser" aria-labelledby="ts-custom-title">
	<div class="ts-section__head">
		<p class="ts-eyebrow"><?php esc_html_e( 'En autonomie', 'teeshoop' ); ?></p>
		<h2 id="ts-custom-title"><?php esc_html_e( 'À personnaliser et à commander en ligne', 'teeshoop' ); ?></h2>
		<p class="ts-lead">
			<?php esc_html_e( 'Vous déposez votre visuel, vous le placez, vous voyez le prix à votre quantité, et vous payez. Le bon à tirer arrive ensuite : rien n’est imprimé avant que vous l’ayez validé.', 'teeshoop' ); ?>
		</p>
	</div>

	<?php if ( empty( $ts_products ) ) : ?>
		<div class="ts-empty">
			<h3 class="ts-empty__title"><?php esc_html_e( 'Aucun vêtement n’est encore ouvert à la personnalisation en ligne', 'teeshoop' ); ?></h3>
			<p>
				<?php esc_html_e( 'Un vêtement devient personnalisable quand une fiche produit déclare sur quel modèle du studio elle est imprimée. Aucune ne le fait pour l’instant.', 'teeshoop' ); ?>
			</p>
			<p><a href="<?php echo esc_url( quote_url() ); ?>"><?php esc_html_e( 'Demander un devis', 'teeshoop' ); ?></a></p>
		</div>
	<?php else : ?>
		<ul class="ts-grid">
			<?php foreach ( $ts_products as $ts_product ) : ?>
				<li class="ts-card">
					<a class="ts-card__media" href="<?php echo esc_url( (string) get_permalink( $ts_product->get_id() ) ); ?>">
						<?php echo wp_kses_post( $ts_product->get_image( 'woocommerce_thumbnail' ) ); ?>
					</a>
					<h3 class="ts-card__title">
						<a href="<?php echo esc_url( (string) get_permalink( $ts_product->get_id() ) ); ?>">
							<?php echo esc_html( $ts_product->get_name() ); ?>
						</a>
					</h3>
					<?php
					// `ProductPage::price_html()` has already replaced the catalogue
					// price with the range a customer can actually reach, so this is
					// the same sentence the product page and the cart print.
					echo wp_kses_post( $ts_product->get_price_html() );
					?>
				</li>
			<?php endforeach; ?>
		</ul>
	<?php endif; ?>
</section>

<?php /* Who it is for, in the associate's own words. */ ?>
<section class="ts-section ts-wrap" aria-labelledby="ts-sectors-title">
	<div class="ts-section__head">
		<p class="ts-eyebrow"><?php esc_html_e( 'Pour qui', 'teeshoop' ); ?></p>
		<h2 id="ts-sectors-title"><?php esc_html_e( 'Trois façons de travailler avec nous', 'teeshoop' ); ?></h2>
	</div>

	<div class="ts-sectors">
		<?php foreach ( sectors() as $ts_sector ) : ?>
			<article class="ts-sector">
				<h3 class="ts-sector__title"><?php echo esc_html( $ts_sector['title'] ); ?></h3>
				<p class="ts-sector__needs"><?php echo esc_html( $ts_sector['needs'] ); ?></p>
				<p class="ts-sector__answer"><?php echo esc_html( $ts_sector['answer'] ); ?></p>
			</article>
		<?php endforeach; ?>
	</div>

	<?php $ts_pro = page_url( 'entreprises' ); ?>
	<?php if ( '' !== $ts_pro ) : ?>
		<p class="ts-section__more">
			<a href="<?php echo esc_url( $ts_pro ); ?>"><?php esc_html_e( 'Ce que nous demandons et ce que nous fournissons aux entreprises', 'teeshoop' ); ?></a>
		</p>
	<?php endif; ?>
</section>

<?php /* A real sequence, so it is numbered. */ ?>
<section class="ts-section ts-wrap" aria-labelledby="ts-steps-title">
	<div class="ts-section__head">
		<p class="ts-eyebrow"><?php esc_html_e( 'Le déroulé', 'teeshoop' ); ?></p>
		<h2 id="ts-steps-title"><?php esc_html_e( 'De votre logo au carton', 'teeshoop' ); ?></h2>
	</div>

	<ol class="ts-steps">
		<li class="ts-steps__item">
			<h3 class="ts-steps__title"><?php esc_html_e( 'Vous choisissez le vêtement', 'teeshoop' ); ?></h3>
			<p><?php esc_html_e( 'La matière, le grammage, le coloris et les tailles. Chaque fiche dit jusqu’où on peut imprimer, en centimètres.', 'teeshoop' ); ?></p>
		</li>
		<li class="ts-steps__item">
			<h3 class="ts-steps__title"><?php esc_html_e( 'Vous placez votre visuel', 'teeshoop' ); ?></h3>
			<p><?php esc_html_e( 'Dans l’éditeur, sur le devant, le dos ou la manche. Le prix se met à jour pendant que vous placez, à votre quantité.', 'teeshoop' ); ?></p>
		</li>
		<li class="ts-steps__item">
			<h3 class="ts-steps__title"><?php esc_html_e( 'Vous validez le bon à tirer', 'teeshoop' ); ?></h3>
			<p><?php esc_html_e( 'Nous vous envoyons une maquette par face imprimée, avec les dimensions et la hauteur sous l’encolure. Rien ne part en production avant votre accord.', 'teeshoop' ); ?></p>
		</li>
		<li class="ts-steps__item">
			<h3 class="ts-steps__title"><?php esc_html_e( 'Nous imprimons et nous livrons', 'teeshoop' ); ?></h3>
			<p><?php esc_html_e( 'Transfert DTF pressé dans notre atelier, contrôle pièce par pièce, expédition en Colissimo suivi.', 'teeshoop' ); ?></p>
		</li>
	</ol>
</section>

<?php
advice_block();
get_footer();
