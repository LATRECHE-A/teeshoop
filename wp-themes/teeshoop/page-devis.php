<?php
/**
 * The quote page, one click from anywhere.
 *
 * WHY THIS PAGE EXISTS. Both competitors bury this, and that is our opening.
 * On tostadora.fr there is no quote path at all: the nav item addressed to
 * companies ("Entreprises") leads to a product listing whose CTA is the same
 * self-serve editor a consumer uses, and the FAQ answers "commandez dès 1
 * article". On mistertee.fr the quote path is real and one click away, but the
 * form collects a single free-text box with a twenty-character minimum and an
 * optional file: no quantity, no product, no deadline, no size breakdown, no
 * company field. The page then has to tell the buyer in prose what to type.
 * (Both read on 2026-08-19.)
 *
 * THE FORM IS THE PLUGIN'S, NOT A COPY. It is exactly the template the product
 * page renders, `teeshoop/product-quote.php`, with `product_id` set to 0. There
 * is therefore one set of fields, one HMAC stamp, one honeypot, one rate limit,
 * one privacy notice and one handler, and no chance of the standalone page
 * drifting from the one attached to a product. `Quote::submit()` already treats
 * a product id of 0 correctly: no garment, no size list, and no self-serve
 * estimate frozen onto the record, which is right, because there is no product
 * to estimate.
 *
 * @package Teeshoop\Theme
 */

namespace Teeshoop\Theme;

defined( 'ABSPATH' ) || exit;

get_header();

$ts_min  = minimum();
$ts_lead = lead_days();
?>
<div class="ts-wrap ts-devispage">
	<div class="ts-devispage__intro">
		<p class="ts-eyebrow"><?php esc_html_e( 'Entreprises, associations, collectivités', 'teeshoop' ); ?></p>
		<h1 class="ts-prose__title"><?php the_title(); ?></h1>

		<?php
		// Whatever the page itself says, above the form. Empty by default, and
		// that is fine: the form and the block below already say everything a
		// buyer needs. Nothing here is a placeholder waiting to be filled.
		while ( have_posts() ) :
			the_post();
			the_content();
		endwhile;
		?>

		<ul class="ts-checks">
			<li><?php esc_html_e( 'Un chiffrage écrit, avec le détail par référence, par coloris et par taille.', 'teeshoop' ); ?></li>
			<li><?php esc_html_e( 'Une facture au nom de votre société, avec votre SIRET et votre numéro de TVA.', 'teeshoop' ); ?></li>
			<?php if ( isset( $ts_lead['standard'] ) ) : ?>
				<li>
					<?php
					printf(
						/* translators: %s: a number of working days. */
						esc_html__( 'Une date de fabrication, en jours ouvrés, comptée à partir de votre bon à tirer validé, %s jours en standard.', 'teeshoop' ),
						'<span class="ts-num">' . esc_html( num( (float) $ts_lead['standard'] ) ) . '</span>'
					);
					?>
				</li>
			<?php endif; ?>
			<li><?php esc_html_e( 'Un bon à tirer avant impression, avec la position du marquage en centimètres.', 'teeshoop' ); ?></li>
			<?php if ( null !== $ts_min ) : ?>
				<li>
					<?php
					if ( $ts_min['has_ht'] ) {
						printf(
							/* translators: 1: minimum pieces, 2: minimum order value. */
							esc_html__( 'À partir de %1$s pièces et %2$s. Au-delà, le tarif baisse par paliers et le devis les applique.', 'teeshoop' ),
							'<span class="ts-num">' . esc_html( num( (float) $ts_min['qty'] ) ) . '</span>',
							'<span class="ts-num">' . esc_html( eur( $ts_min['ht_cents'] ) ) . '</span>'
						);
					} else {
						printf(
							/* translators: %s: minimum pieces. */
							esc_html__( 'À partir de %s pièces. Au-delà, le tarif baisse par paliers et le devis les applique.', 'teeshoop' ),
							'<span class="ts-num">' . esc_html( num( (float) $ts_min['qty'] ) ) . '</span>'
						);
					}
					?>
				</li>
			<?php endif; ?>
		</ul>

		<p class="ts-note">
			<?php esc_html_e( 'Nous ne demandons pas d’échantillon payant pour établir un devis. Si vous voulez toucher la matière avant de commander une série, dites-le dans votre message : nous vous répondons avec ce que cela coûte, avant de l’envoyer.', 'teeshoop' ); ?>
		</p>
	</div>

	<div class="ts-devispage__form">
		<?php
		/*
		 * A WAY BACK TO AN EMPTY FORM.
		 *
		 * `Quote::back()` sends a success to `?devis=ok`, and the plugin's
		 * template replaces the whole form with the confirmation. On a product
		 * page that is harmless, because the buy box and the estimator are still
		 * there. Here the form IS the page, and that URL is the one that lands in
		 * the buyer's history the instant their first request succeeds: the
		 * address bar offers it ahead of the clean one from then on, and it is
		 * what they forward to a colleague. So the confirmation gets a link to
		 * the page without the flag.
		 */
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- reading our own redirect result.
		$ts_sent = isset( $_GET['devis'] ) && 'ok' === sanitize_key( wp_unslash( (string) $_GET['devis'] ) );

		/*
		 * The plugin's own template, loaded the way the plugin loads it, so a
		 * theme override at `yourtheme/teeshoop/product-quote.php` would still
		 * win here as it does on a product page.
		 */
		if ( function_exists( 'wc_get_template' ) && class_exists( '\\Teeshoop\\Core\\Quote' ) && defined( 'TEESHOOP_CORE_DIR' ) ) {
			wc_get_template(
				'teeshoop/product-quote.php',
				array(
					'product_id' => 0,
					'garment'    => '',
					'config'     => pricing_config(),
					'request'    => array(
						'faces' => 1,
						'grid'  => array(),
						// The shop's own minimum, so the quantity box opens on a
						// number that can actually be ordered rather than on 0.
						'typed' => null !== $ts_min ? $ts_min['qty'] : 1,
					),
					'sizes'      => array(),
				),
				'',
				// A global constant defined with define(), so it is not in the
				// plugin's namespace however much it looks like it.
				TEESHOOP_CORE_DIR . 'templates/'
			);
		} else {
			?>
			<div class="ts-empty">
				<h2 class="ts-empty__title"><?php esc_html_e( 'Le formulaire n’est pas disponible', 'teeshoop' ); ?></h2>
				<p><?php esc_html_e( 'L’extension qui reçoit les demandes de devis n’est pas active sur cette boutique. Rien de ce que vous écririez ici ne serait enregistré.', 'teeshoop' ); ?></p>
			</div>
			<?php
		}
		?>

		<?php if ( $ts_sent ) : ?>
			<p class="ts-note ts-note--strong">
				<a href="<?php echo esc_url( remove_query_arg( array( 'devis', 'raison', 'reprise' ) ) ); ?>">
					<?php esc_html_e( 'Envoyer une autre demande', 'teeshoop' ); ?>
				</a>
			</p>
		<?php endif; ?>
	</div>
</div>
<?php
get_footer();
