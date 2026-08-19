<?php
/**
 * The footer: what a French buyer is entitled to find on every page.
 *
 * THE LEGAL IDENTITY IS EMPTY AND THE FOOTER SAYS SO. Question 17 has not been
 * answered, `Legal::identity()` ships blank on purpose, and this template will
 * not invent a SIRET, a share capital or a street. `Legal` already models this
 * exactly: an invoice with an incomplete identity is REFUSED in production and
 * merely stamped « DOCUMENT NON CONFORME » anywhere else. A page cannot refuse
 * to render, so it does the other half: it prints the fields it has and names
 * the ones it does not, in the interface, where whoever can fix it will see it
 * on the first load rather than in a formal notice from the DGCCRF.
 *
 * @package Teeshoop\Theme
 */

namespace Teeshoop\Theme;

defined( 'ABSPATH' ) || exit;

$ts_identity = legal_identity();
$ts_lead     = lead_days();
$ts_min      = minimum();

?>
</main>

<footer class="ts-foot">
	<div class="ts-wrap ts-foot__grid">

		<section class="ts-foot__col">
			<h2 class="ts-foot__title"><?php esc_html_e( 'Commander', 'teeshoop' ); ?></h2>
			<ul class="ts-foot__list">
				<?php foreach ( top_categories() as $ts_term ) : ?>
					<li><a href="<?php echo esc_url( (string) get_term_link( $ts_term ) ); ?>"><?php echo esc_html( $ts_term->name ); ?></a></li>
				<?php endforeach; ?>
				<li><a href="<?php echo esc_url( quote_url() ); ?>"><?php esc_html_e( 'Demander un devis', 'teeshoop' ); ?></a></li>
			</ul>
		</section>

		<section class="ts-foot__col">
			<h2 class="ts-foot__title"><?php esc_html_e( 'Nos conditions', 'teeshoop' ); ?></h2>
			<ul class="ts-foot__list">
				<li>
					<?php
					printf(
						/* translators: 1: minimum number of pieces, 2: minimum order value, before tax. */
						esc_html__( 'Commande minimum : %1$s pièces et %2$s', 'teeshoop' ),
						'<span class="ts-num">' . esc_html( num( (float) $ts_min['qty'] ) ) . '</span>',
						'<span class="ts-num">' . esc_html( eur( $ts_min['ht_cents'] ) ) . '</span>'
					);
					?>
				</li>
				<?php if ( isset( $ts_lead['standard'] ) ) : ?>
					<li>
						<?php
						printf(
							/* translators: %s: number of working days. */
							esc_html__( 'Fabrication en %s jours ouvrés après validation du bon à tirer', 'teeshoop' ),
							'<span class="ts-num">' . esc_html( (string) (int) $ts_lead['standard'] ) . '</span>'
						);
						?>
					</li>
				<?php endif; ?>
				<li><?php esc_html_e( 'Livraison Colissimo en France métropolitaine', 'teeshoop' ); ?></li>
				<li><?php echo esc_html( tax_basis_note() ); ?></li>
			</ul>
		</section>

		<section class="ts-foot__col">
			<h2 class="ts-foot__title"><?php esc_html_e( 'L’atelier', 'teeshoop' ); ?></h2>

			<?php
			$ts_shown = array_intersect_key(
				$ts_identity,
				array_flip( array( 'raison_sociale', 'forme_juridique', 'capital', 'adresse', 'code_postal', 'ville', 'siret', 'rcs_ville', 'tva_intra' ) )
			);

			if ( ! empty( $ts_shown ) ) :
				$ts_labels = class_exists( '\\Teeshoop\\Core\\Legal' ) ? \Teeshoop\Core\Legal::fields() : array();
				?>
				<address class="ts-foot__address">
					<?php if ( isset( $ts_shown['raison_sociale'] ) ) : ?>
						<span class="ts-foot__name"><?php echo esc_html( $ts_shown['raison_sociale'] ); ?></span>
					<?php endif; ?>
					<?php if ( isset( $ts_shown['adresse'] ) ) : ?>
						<span><?php echo esc_html( $ts_shown['adresse'] ); ?></span>
					<?php endif; ?>
					<?php if ( isset( $ts_shown['code_postal'] ) || isset( $ts_shown['ville'] ) ) : ?>
						<span>
							<?php echo esc_html( trim( ( $ts_shown['code_postal'] ?? '' ) . ' ' . ( $ts_shown['ville'] ?? '' ) ) ); ?>
						</span>
					<?php endif; ?>
				</address>
				<dl class="ts-foot__legal">
					<?php foreach ( array( 'siret', 'tva_intra', 'rcs_ville', 'forme_juridique', 'capital' ) as $ts_key ) : ?>
						<?php if ( isset( $ts_shown[ $ts_key ] ) ) : ?>
							<dt><?php echo esc_html( $ts_labels[ $ts_key ] ?? $ts_key ); ?></dt>
							<dd class="ts-num"><?php echo esc_html( $ts_shown[ $ts_key ] ); ?></dd>
						<?php endif; ?>
					<?php endforeach; ?>
				</dl>
			<?php endif; ?>

			<?php
			$ts_missing = class_exists( '\\Teeshoop\\Core\\Legal' )
				? \Teeshoop\Core\Legal::missing( legal_identity() + array_fill_keys( array_keys( \Teeshoop\Core\Legal::fields() ), '' ), '' )
				: array();
			if ( ! empty( $ts_missing ) ) :
				?>
				<p class="ts-foot__gap" role="note">
					<?php
					printf(
						/* translators: %s: comma-separated list of the missing legal fields, in French. */
						esc_html__( 'Identité légale non renseignée : %s. Ces mentions sont obligatoires sur un site marchand français ; elles seront publiées dès que l’exploitant les aura fournies.', 'teeshoop' ),
						esc_html(
							implode(
								', ',
								array_map(
									static function ( string $key ): string {
										$labels = \Teeshoop\Core\Legal::fields();
										return mb_strtolower( $labels[ $key ] ?? $key );
									},
									$ts_missing
								)
							)
						)
					);
					?>
				</p>
			<?php endif; ?>
		</section>

		<?php
		/*
		 * A column with a heading and nothing under it is worse than no column.
		 * These four pages are session 12's, and none of them exists yet: the
		 * terms of sale need a lawyer (question 18) and the privacy policy needs
		 * a named data controller (question 19). The heading appears the day a
		 * page does.
		 */
		$ts_links = array();
		foreach (
			array(
				'contact'          => __( 'Nous contacter', 'teeshoop' ),
				'mentions-legales' => __( 'Mentions légales', 'teeshoop' ),
				'cgv'              => __( 'Conditions générales de vente', 'teeshoop' ),
				'confidentialite'  => __( 'Données personnelles', 'teeshoop' ),
			) as $ts_slug => $ts_label
		) {
			$ts_url = page_url( $ts_slug );
			if ( '' !== $ts_url ) {
				$ts_links[ $ts_url ] = $ts_label;
			}
		}
		?>
		<?php if ( ! empty( $ts_links ) ) : ?>
			<section class="ts-foot__col">
				<h2 class="ts-foot__title"><?php esc_html_e( 'Nous écrire', 'teeshoop' ); ?></h2>
				<ul class="ts-foot__list">
					<?php foreach ( $ts_links as $ts_url => $ts_label ) : ?>
						<li><a href="<?php echo esc_url( $ts_url ); ?>"><?php echo esc_html( $ts_label ); ?></a></li>
					<?php endforeach; ?>
				</ul>
			</section>
		<?php endif; ?>
	</div>

	<div class="ts-wrap ts-foot__base">
		<p class="ts-foot__copy">
			<?php
			printf(
				/* translators: 1: current year, 2: site name. */
				esc_html__( '%1$s %2$s', 'teeshoop' ),
				esc_html( wp_date( 'Y' ) ),
				esc_html( get_bloginfo( 'name' ) )
			);
			?>
		</p>
	</div>
</footer>

<?php wp_footer(); ?>
</body>
</html>
