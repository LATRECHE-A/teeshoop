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
				<?php if ( null !== $ts_min ) : ?>
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
				<?php endif; ?>
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
				<?php $ts_tax = tax_basis_note(); ?>
				<?php if ( '' !== $ts_tax ) : ?>
					<li><?php echo esc_html( $ts_tax ); ?></li>
				<?php endif; ?>
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
		 * A column with a heading and nothing under it is worse than no column,
		 * so the heading appears the day a page does.
		 *
		 * THE LIST IS NOT TYPED HERE ANY MORE. It used to be four slugs written
		 * into this template, and session 12 added a fifth page that the footer
		 * therefore did not link to: `accessibilite` was published, reachable and
		 * invisible. `Pages::live()` is the one place that knows which legal
		 * pages exist and which are published, and `Consent`, the CLI command
		 * that creates them and this template all read it.
		 *
		 * The theme degrades on its own if the plugin is not there: no plugin,
		 * no legal pages, no column, which is the same outcome as before.
		 */
		$ts_links = class_exists( '\Teeshoop\Core\Pages' ) ? \Teeshoop\Core\Pages::live() : array();
		$ts_titles = class_exists( '\Teeshoop\Core\Pages' ) ? \Teeshoop\Core\Pages::all() : array();
		?>
		<?php if ( ! empty( $ts_links ) ) : ?>
			<section class="ts-foot__col">
				<h2 class="ts-foot__title"><?php esc_html_e( 'Informations légales', 'teeshoop' ); ?></h2>
				<ul class="ts-foot__list ts-foot__list--legal">
					<?php foreach ( $ts_links as $ts_slug => $ts_url ) : ?>
						<li><a href="<?php echo esc_url( $ts_url ); ?>"><?php echo esc_html( $ts_titles[ $ts_slug ] ?? $ts_slug ); ?></a></li>
					<?php endforeach; ?>
				</ul>
			</section>
		<?php endif; ?>
	</div>

	<?php
	/*
	 * THE MARKER THAT SAYS THESE FIGURES ARE ASSUMPTIONS, on every page.
	 *
	 * The lead time and the order minimum are printed in this footer, so they
	 * are on every page of the site, and the minimum is question 01's default
	 * while the lead time is question 14's. `Hypotheses::note()` draws once per
	 * request and only for somebody with `manage_woocommerce`, so on the
	 * homepage the facts block has already claimed it and this is a no-op, and
	 * everywhere else this is the only place it can appear.
	 */
	if ( class_exists( '\Teeshoop\Core\Hypotheses' ) ) {
		echo '<div class="ts-wrap ts-foot__marker">';
		\Teeshoop\Core\Hypotheses::note( \Teeshoop\Core\Hypotheses::HOME_PRICING );
		echo '</div>';
	}
	?>

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

		<?php
		/*
		 * THE WAY BACK TO THE CHOICE, ON EVERY PAGE.
		 *
		 * Withdrawing a consent has to be as available as giving it, and the
		 * CNIL is explicit that it must be reachable at any time. It is a plain
		 * link that reloads the page with the panel open, so it works with no
		 * script, exactly like the panel itself. The date is printed beside it
		 * because a visitor who cannot see what they chose, or when, has no
		 * reason to believe the control does anything.
		 */
		if ( class_exists( '\Teeshoop\Core\Consent' ) && ! empty( \Teeshoop\Core\Consent::offered() ) ) :
			$ts_decided = \Teeshoop\Core\Consent::decided_on();
			?>
			<p class="ts-foot__consent">
				<?php
				/*
				 * `rel="nofollow"`, because this link is on EVERY page and adds
				 * `?cookies=1` to the URL it is on: followed, it would offer a
				 * crawler a twin of the whole site from the one control that is
				 * guaranteed to be everywhere. `Seo::robots()` marks that flag
				 * noindex as well, so a twin that is fetched anyway drops out.
				 */
				?>
				<a rel="nofollow" href="<?php echo esc_url( \Teeshoop\Core\Consent::reopen_url() ); ?>">
					<?php esc_html_e( 'Traceurs et mesure d’audience', 'teeshoop' ); ?>
				</a>
				<?php if ( '' !== $ts_decided ) : ?>
					<span class="ts-foot__consent-date">
						<?php
						printf(
							/* translators: %s: the date the visitor last recorded a choice. */
							esc_html__( 'votre choix du %s', 'teeshoop' ),
							esc_html( wp_date( 'j F Y', (int) strtotime( $ts_decided ) ) )
						);
						?>
					</span>
				<?php endif; ?>
			</p>
		<?php endif; ?>
	</div>
</footer>

<?php wp_footer(); ?>
</body>
</html>
