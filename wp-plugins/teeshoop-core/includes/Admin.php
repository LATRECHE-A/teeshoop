<?php
/**
 * The one screen where the facts this shop cannot invent are typed in.
 *
 * WHY IT LEADS WITH A COMPARISON. Question 17's written default says the regime
 * must be "affiché comme une hypothèse à côté du fait que la boutique en ligne
 * est aujourd'hui configurée taxes désactivées". That sentence is the design of
 * this page: at the top, what the extension assumes, beside what WooCommerce is
 * actually set to do, in the same paragraph. An operator who sees "nous
 * supposons 20 %" and "WooCommerce ne facture aucune taxe" together answers
 * question 17 in the next minute. An operator who sees either one alone does
 * not know there is a question.
 *
 * WHY IT IS EDITABLE WHERE THE REGISTER SCREEN IS NOT. `Hypotheses::screen` is
 * read-only because editing a price from a page whose subject is that the price
 * is undecided would be absurd. These are different: a SIRET is not an
 * assumption waiting for a decision, it is a fact the associate has and we do
 * not, and the only thing standing between the shop and a lawful invoice is
 * somewhere to put it.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class Admin {

	private const SLUG   = 'teeshoop-facturation';
	private const ACTION = 'teeshoop_reglages';

	public static function init(): void {
		add_action( 'admin_menu', array( self::class, 'menu' ) );
		add_action( 'admin_post_' . self::ACTION, array( self::class, 'save' ) );
	}

	public static function menu(): void {
		add_submenu_page(
			'woocommerce',
			__( 'Facturation Teeshoop', 'teeshoop' ),
			__( 'Facturation', 'teeshoop' ),
			'manage_woocommerce',
			self::SLUG,
			array( self::class, 'screen' )
		);
	}

	public static function url(): string {
		return admin_url( 'admin.php?page=' . self::SLUG );
	}

	// ── Saving ───────────────────────────────────────────────────────────────

	public static function save(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'Vous n’avez pas le droit de modifier ces réglages.', 'teeshoop' ), '', array( 'response' => 403 ) );
		}
		check_admin_referer( self::ACTION );

		// phpcs:disable WordPress.Security.NonceVerification.Missing -- checked above.
		$periods = array();
		foreach ( (array) ( $_POST['periode'] ?? array() ) as $raw ) {
			if ( ! is_array( $raw ) ) {
				continue;
			}
			$from = sanitize_text_field( wp_unslash( (string) ( $raw['from'] ?? '' ) ) );
			if ( '' === trim( $from ) ) {
				// An empty date is a row the operator left blank, not a fault.
				continue;
			}
			$periods[] = array(
				'from'       => $from,
				'regime'     => sanitize_text_field( wp_unslash( (string) ( $raw['regime'] ?? '' ) ) ),
				'vat_number' => sanitize_text_field( wp_unslash( (string) ( $raw['vat_number'] ?? '' ) ) ),
			);
		}
		// Normalised on the way in, so what is stored is what `Vat` can read: a
		// date it cannot parse is dropped here rather than at every read site.
		update_option( OPTION_VAT, Vat::merge_periods( $periods ) );

		$legal = array();
		foreach ( array_keys( Legal::fields() ) as $key ) {
			$legal[ $key ] = sanitize_text_field( wp_unslash( (string) ( $_POST['legal'][ $key ] ?? '' ) ) );
		}
		$legal['siret'] = Legal::siret( $legal['siret'] ) ?: $legal['siret'];
		update_option( OPTION_LEGAL, $legal );

		update_option(
			OPTION_INVOICE,
			array(
				// The shipped prefix, not a second copy of it: an operator who
				// clears the field gets what the extension ships, from where it
				// ships it.
				'prefix'       => strtoupper( preg_replace( '/[^A-Za-z0-9]/', '', (string) ( $_POST['facture']['prefix'] ?? '' ) ) ?? '' )
					?: Invoice::default_config()['prefix'],
				'penalty_rate' => sanitize_text_field( wp_unslash( (string) ( $_POST['facture']['penalty_rate'] ?? '' ) ) ),
			)
		);

		/*
		 * THE DELTA, OVER WHAT IS STORED, never over the merged config.
		 *
		 * `Shipping::config()` is the stored partial ALREADY merged over the
		 * shipped defaults, so writing it back put the whole Colissimo grid,
		 * the country list and the postcode exclusions into the option the
		 * first time anybody pressed Enregistrer, which they do on day one to
		 * type the SIRET. `merge_config` replaces per top-level key, so the 2026
		 * grid would then have won for ever: La Poste raises its tariff, the
		 * next release ships the new grid, and this shop silently keeps quoting
		 * last year's price and absorbing the difference on every parcel.
		 *
		 * Only the five keys this form owns are ever written. Everything else
		 * keeps resolving to what the extension ships, which is the same rule
		 * the invoice prefix follows twenty lines above.
		 */
		$posted = array();
		foreach ( Shipping::OPERATOR_KEYS as $key ) {
			if ( isset( $_POST['livraison'][ $key ] ) ) {
				$posted[ $key ] = sanitize_text_field( wp_unslash( (string) $_POST['livraison'][ $key ] ) );
			}
		}
		$stored = get_option( OPTION_SHIPPING, array() );
		update_option( OPTION_SHIPPING, Shipping::config_delta( $posted, is_array( $stored ) ? $stored : array() ) );

		$payment = get_option( OPTION_PAYMENT, array() );
		$payment = is_array( $payment ) ? $payment : array();
		if ( isset( $_POST['acompte']['deposit_from_ht'] ) ) {
			$payment['deposit_from_ht'] = Money::from_eur( sanitize_text_field( wp_unslash( (string) $_POST['acompte']['deposit_from_ht'] ) ) );
		}
		if ( isset( $_POST['acompte']['deposit_rate'] ) ) {
			// A share typed as a percentage, stored as a rate. Clamped to a real
			// share: a deposit of 120 % is not a deposit.
			$rate                    = (float) str_replace( ',', '.', sanitize_text_field( wp_unslash( (string) $_POST['acompte']['deposit_rate'] ) ) ) / 100;
			$payment['deposit_rate'] = max( 0.0, min( 1.0, $rate ) );
		}
		update_option( OPTION_PAYMENT, $payment );

		/*
		 * AND WOOCOMMERCE HAS TO BE TOLD. It caches the rates a package resolved
		 * to, in the customer's session, keyed on the package: our option is not
		 * part of that key, so every basket already open kept the old franco and
		 * the old packing until something else happened to change. Bumping the
		 * shipping transient version is how WooCommerce itself invalidates them.
		 */
		\WC_Cache_Helper::get_transient_version( 'shipping', true );
		// phpcs:enable WordPress.Security.NonceVerification.Missing

		wp_safe_redirect( add_query_arg( 'teeshoop', 'enregistre', self::url() ) );
		exit;
	}

	// ── The screen ───────────────────────────────────────────────────────────

	public static function screen(): void {
		$regime   = Settings::vat();
		$periods  = Settings::vat_periods();
		$identity = Legal::identity();
		$verdict  = Legal::verdict( $identity, (string) $regime['regime'], Legal::environment() );
		$invoice  = Invoice::config();
		$shipping = Shipping::config();

		echo '<div class="wrap">';
		echo '<h1>' . esc_html__( 'Facturation et TVA', 'teeshoop' ) . '</h1>';

		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- a display-only flag.
		if ( isset( $_GET['teeshoop'] ) && 'enregistre' === $_GET['teeshoop'] ) {
			echo '<div class="notice notice-success is-dismissible"><p>'
				. esc_html__( 'Réglages enregistrés.', 'teeshoop' ) . '</p></div>';
		}

		self::render_state( $regime, $verdict );

		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
		echo '<input type="hidden" name="action" value="' . esc_attr( self::ACTION ) . '">';
		wp_nonce_field( self::ACTION );

		self::render_periods( $periods );
		self::render_identity( $identity, $verdict );
		self::render_invoice( $invoice );
		self::render_shipping( $shipping );
		self::render_deposit( Ledger::config() );

		submit_button( __( 'Enregistrer', 'teeshoop' ) );
		echo '</form></div>';
	}

	/**
	 * The two facts, side by side. This paragraph is the point of the page.
	 */
	private static function render_state( array $regime, array $verdict ): void {
		$calc = 'yes' === get_option( 'woocommerce_calc_taxes' );

		echo '<div class="notice notice-info" style="padding:12px 14px"><p style="margin-top:0"><strong>'
			. esc_html__( 'Ce que la boutique fait aujourd’hui', 'teeshoop' ) . '</strong></p><p>';

		if ( ! $regime['known'] ) {
			echo esc_html__( 'Aucune période de TVA ne couvre la date du jour, donc l’extension ne peut pas dire si une vente porte de la TVA. Le panier refuse le paiement tant que c’est le cas.', 'teeshoop' );
		} elseif ( Vat::FRANCHISE === $regime['regime'] ) {
			printf(
				esc_html__( 'L’extension applique la franchise en base depuis le %s : aucune TVA, TTC égal HT, et la mention « %s » sur chaque facture.', 'teeshoop' ),
				esc_html( Vat::fr_date( (string) $regime['from'] ) ),
				esc_html( Vat::MENTION_FRANCHISE )
			);
		} else {
			printf(
				esc_html__( 'L’extension applique une TVA de %1$s depuis le %2$s.', 'teeshoop' ),
				esc_html( Money::number( (float) $regime['rate'] * 100, 2 ) . "\u{00A0}%" ),
				esc_html( Vat::fr_date( (string) $regime['from'] ) )
			);
		}

		echo ' ';
		echo $calc
			? esc_html__( 'WooCommerce, de son côté, calcule les taxes.', 'teeshoop' )
			: esc_html__( 'WooCommerce, de son côté, a le calcul des taxes DÉSACTIVÉ : c’est le réglage sous lequel la boutique en ligne a déjà encaissé 15 commandes, du 21 novembre 2024 au 18 avril 2025, pour 465,79 EUR.', 'teeshoop' );

		echo '</p><p>';
		esc_html_e(
			'Le régime ci-dessous est une hypothèse de notre part, pas une décision de l’associé : la question 17 lui demande si la société facture la TVA, et tant qu’elle n’a pas de réponse ces deux lignes peuvent se contredire. Elles sont côte à côte pour que la contradiction se voie.',
			'teeshoop'
		);
		echo '</p>';

		$mismatch = $regime['known'] ? Checkout::woo_tax_mismatch( $regime ) : '';
		if ( '' !== $mismatch ) {
			echo '<p><strong>' . esc_html__( 'À corriger', 'teeshoop' ) . '</strong> : ' . esc_html( $mismatch ) . '</p>';
		}

		if ( Legal::ISSUE !== $verdict['action'] ) {
			echo '<p><strong>' . esc_html__( 'Factures', 'teeshoop' ) . '</strong> : ';
			printf(
				esc_html(
					Legal::REFUSE === $verdict['action']
						/* translators: %s: a list of missing legal fields. */
						? __( 'aucune facture ne peut être émise, il manque %s à l’identité du vendeur.', 'teeshoop' )
						/* translators: %s: a list of missing legal fields. */
						: __( 'les factures sortent marquées « document non conforme » : il manque %s. Sur la boutique en production elles seraient refusées.', 'teeshoop' )
				),
				esc_html( implode( ', ', $verdict['labels'] ) )
			);
			echo '</p>';
		}

		echo '</div>';
	}

	private static function render_periods( array $periods ): void {
		// One empty row at the end, so adding a period needs no button and no
		// JavaScript: the form grows by being filled in.
		$rows = array_merge( $periods, array( array( 'from' => '', 'regime' => Vat::STANDARD, 'vat_number' => '' ) ) );

		echo '<h2>' . esc_html__( 'Le régime de TVA, par période', 'teeshoop' ) . '</h2>';
		echo '<p class="description" style="max-width:46em">' . esc_html__(
			'Une période commence à sa date et court jusqu’à la suivante. Une entreprise en franchise qui dépasse le seuil bascule à une date précise, et les factures d’avant ne changent pas : c’est pourquoi le régime est une suite de périodes et non un taux. Les seuils et les dates viennent de votre comptable ; ils ne sont écrits nulle part dans le code. Videz une date pour supprimer la période.',
			'teeshoop'
		) . '</p>';

		// The three columns do not fit a phone, and a page that scrolls sideways
		// is a page whose Enregistrer button disappears. Checked at 375 px.
		echo '<div style="overflow-x:auto;max-width:100%">';
		echo '<table class="widefat striped" style="max-width:46em"><thead><tr>';
		echo '<th scope="col">' . esc_html__( 'À partir du', 'teeshoop' ) . '</th>';
		echo '<th scope="col">' . esc_html__( 'Régime', 'teeshoop' ) . '</th>';
		echo '<th scope="col">' . esc_html__( 'TVA intracommunautaire', 'teeshoop' ) . '</th>';
		echo '</tr></thead><tbody>';

		foreach ( $rows as $i => $period ) {
			$franchise = Vat::FRANCHISE === ( $period['regime'] ?? '' );
			echo '<tr>';
			printf(
				'<td><input type="date" name="periode[%1$d][from]" value="%2$s"></td>',
				(int) $i,
				esc_attr( (string) ( $period['from'] ?? '' ) )
			);
			printf(
				'<td><select name="periode[%1$d][regime]"><option value="%2$s"%4$s>%5$s</option><option value="%3$s"%6$s>%7$s</option></select></td>',
				(int) $i,
				esc_attr( Vat::STANDARD ),
				esc_attr( Vat::FRANCHISE ),
				selected( ! $franchise, true, false ),
				esc_html__( 'Assujettie', 'teeshoop' ),
				selected( $franchise, true, false ),
				esc_html__( 'Franchise en base', 'teeshoop' )
			);
			/*
			 * NOT disabled on a franchise row, though it means nothing there. A
			 * disabled input is not submitted, so an operator switching a period
			 * from franchise to assujettie and saving would have silently
			 * cleared the number they had just typed beside it. `Vat::regime`
			 * already refuses to announce a VAT number under the franchise, so
			 * storing one costs nothing and losing one costs an invoice.
			 */
			printf(
				'<td><input type="text" name="periode[%1$d][vat_number]" value="%2$s" placeholder="FR00000000000" size="18" aria-describedby="periode-tva-%1$d">%3$s</td>',
				(int) $i,
				esc_attr( (string) ( $period['vat_number'] ?? '' ) ),
				$franchise
					? '<span class="description" id="periode-tva-' . (int) $i . '">' . esc_html__( 'sans objet en franchise', 'teeshoop' ) . '</span>'
					: ''
			);
			echo '</tr>';
		}
		echo '</tbody></table></div>';
	}

	private static function render_identity( array $identity, array $verdict ): void {
		echo '<h2>' . esc_html__( 'L’identité légale du vendeur', 'teeshoop' ) . '</h2>';
		echo '<p class="description" style="max-width:46em">' . esc_html__(
			'Obligatoire sur chaque facture (articles R. 123-237 et R. 123-238 du code de commerce, et 242 nonies A de l’annexe II au code général des impôts). Ces champs sont vides et le resteront : nous ne mettons pas d’exemple crédible à la place d’un SIRET, parce qu’un exemple crédible finit par partir chez un client.',
			'teeshoop'
		) . '</p>';

		echo '<table class="form-table" role="presentation"><tbody>';
		foreach ( Legal::fields() as $key => $label ) {
			$missing = in_array( $key, $verdict['missing'], true );
			printf(
				'<tr><th scope="row"><label for="legal-%1$s">%2$s</label></th><td>'
					. '<input type="text" id="legal-%1$s" name="legal[%1$s]" value="%3$s" class="regular-text">%4$s</td></tr>',
				esc_attr( $key ),
				esc_html( $label ),
				esc_attr( (string) ( $identity[ $key ] ?? '' ) ),
				$missing ? ' <span class="description">' . esc_html__( 'manquant', 'teeshoop' ) . '</span>' : ''
			);
		}
		echo '</tbody></table>';
	}

	private static function render_invoice( array $invoice ): void {
		$series = Invoice::series( Settings::today() );

		echo '<h2>' . esc_html__( 'Les factures', 'teeshoop' ) . '</h2>';
		echo '<table class="form-table" role="presentation"><tbody>';

		printf(
			'<tr><th scope="row"><label for="facture-prefix">%s</label></th><td>'
				. '<input type="text" id="facture-prefix" name="facture[prefix]" value="%s" size="6"> '
				. '<span class="description">%s</span></td></tr>',
			esc_html__( 'Préfixe', 'teeshoop' ),
			esc_attr( (string) $invoice['prefix'] ),
			esc_html(
				sprintf(
					/* translators: %s: an example invoice number. */
					__( 'La numérotation est continue et repart de 1 chaque année. Cette année : %s.', 'teeshoop' ),
					Invoice::format_number( $series, 1 )
				)
			)
		);

		printf(
			'<tr><th scope="row"><label for="facture-penalty">%s</label></th><td>'
				. '<input type="text" id="facture-penalty" name="facture[penalty_rate]" value="%s" size="10" placeholder="%s"> '
				. '<p class="description" style="max-width:44em">%s</p></td></tr>',
			esc_html__( 'Taux des pénalités de retard', 'teeshoop' ),
			esc_attr( (string) $invoice['penalty_rate'] ),
			esc_attr__( 'ex. 12 %', 'teeshoop' ),
			esc_html__( 'Laissé vide, la facture cite le taux légal, qui est celui de la Banque centrale européenne majoré de 10 points (article L. 441-10 du code de commerce). C’est une mention obligatoire entre professionnels, au même titre que l’indemnité de recouvrement de 40 EUR. Un taux contractuel ne peut pas descendre sous trois fois le taux d’intérêt légal.', 'teeshoop' )
		);

		if ( 'production' !== Legal::environment() ) {
			printf(
				'<tr><th scope="row">%s</th><td><p class="description" style="max-width:44em">%s</p></td></tr>',
				esc_html__( 'Série en cours', 'teeshoop' ),
				esc_html(
					sprintf(
						/* translators: 1: an environment name, 2: a series prefix. */
						__( 'Cette installation est déclarée « %1$s » et non « production », donc ses factures sortent dans la série %2$s. Une répétition générale ne consomme jamais un numéro qu’une vraie facture reprendrait ensuite.', 'teeshoop' ),
						Legal::environment(),
						$series
					)
				)
			);
		}

		echo '</tbody></table>';
	}

	private static function render_deposit( array $config ): void {
		echo '<h2>' . esc_html__( 'L’acompte', 'teeshoop' ) . '</h2>';
		echo '<p class="description" style="max-width:46em">' . esc_html__(
			'Un acompte n’est jamais automatique : il se décide commande par commande, sur la fiche de la commande, et seulement au-dessus du seuil ci-dessous. La production peut alors démarrer sur l’acompte ; l’expédition attend toujours le solde. Ces deux valeurs sont les nôtres : la Bible autorise un acompte pour « les commandes complexes ou importantes » sans jamais définir ni l’un ni l’autre, et c’est la question 16.',
			'teeshoop'
		) . '</p>';

		echo '<table class="form-table" role="presentation"><tbody>';
		printf(
			'<tr><th scope="row"><label for="acompte-seuil">%s</label></th><td>'
				. '<input type="text" id="acompte-seuil" name="acompte[deposit_from_ht]" value="%s" size="10" inputmode="decimal">'
				. ' <span class="description">%s</span></td></tr>',
			esc_html__( 'Acompte possible à partir de (EUR HT)', 'teeshoop' ),
			esc_attr( Money::number( Money::to_eur( (int) $config['deposit_from_ht'] ), 2 ) ),
			esc_html__( 'Le paiement en autonomie s’arrête avant ce seuil, donc seule une commande préparée à la main peut l’atteindre.', 'teeshoop' )
		);
		printf(
			'<tr><th scope="row"><label for="acompte-taux">%s</label></th><td>'
				. '<input type="text" id="acompte-taux" name="acompte[deposit_rate]" value="%s" size="6" inputmode="decimal"> %%</td></tr>',
			esc_html__( 'Part demandée à la commande', 'teeshoop' ),
			esc_attr( Money::number( (float) $config['deposit_rate'] * 100, 0 ) )
		);
		echo '</tbody></table>';
	}

	private static function render_shipping( array $shipping ): void {
		echo '<h2>' . esc_html__( 'La livraison', 'teeshoop' ) . '</h2>';
		echo '<p class="description" style="max-width:46em">' . esc_html__(
			'La grille est celle du tarif public Colissimo au 1er janvier 2026, relevée sur l’affiche tarifaire de La Poste. Elle est publique et vérifiable, et elle n’est pas la vôtre : la question 07 vous demande vos tarifs négociés. L’emballage et le franco ci-dessous sont nos hypothèses.',
			'teeshoop'
		) . '</p>';

		echo '<table class="form-table" role="presentation"><tbody>';
		foreach ( array(
			'packaging_piece_ht' => __( 'Emballage par pièce (EUR HT)', 'teeshoop' ),
			'packaging_order_ht' => __( 'Carton par commande (EUR HT)', 'teeshoop' ),
			'free_from_ht'       => __( 'Livraison offerte à partir de (EUR HT)', 'teeshoop' ),
		) as $key => $label ) {
			printf(
				'<tr><th scope="row"><label for="livraison-%1$s">%2$s</label></th><td>'
					. '<input type="text" id="livraison-%1$s" name="livraison[%1$s]" value="%3$s" size="10" inputmode="decimal"></td></tr>',
				esc_attr( $key ),
				esc_html( $label ),
				esc_attr( Money::number( Money::to_eur( (int) $shipping[ $key ] ), 2 ) )
			);
		}
		foreach ( array(
			'packaging_piece_g' => __( 'Poids de l’emballage par pièce (g)', 'teeshoop' ),
			'packaging_order_g' => __( 'Poids du carton (g)', 'teeshoop' ),
		) as $key => $label ) {
			printf(
				'<tr><th scope="row"><label for="livraison-%1$s">%2$s</label></th><td>'
					. '<input type="number" min="0" step="1" id="livraison-%1$s" name="livraison[%1$s]" value="%3$d"></td></tr>',
				esc_attr( $key ),
				esc_html( $label ),
				(int) $shipping[ $key ]
			);
		}
		echo '</tbody></table>';

		echo '<p class="description">' . esc_html__(
			'Les deux poids sont à zéro parce que personne n’a pesé un carton. La Poste facture au poids emballage compris, donc tant qu’ils sont à zéro nous sous-estimons la tranche et nous absorbons la différence : le client n’est jamais surfacturé, et c’est nous qui payons l’écart.',
			'teeshoop'
		) . '</p>';

		echo '<div style="overflow-x:auto;max-width:100%">';
		echo '<table class="widefat striped" style="max-width:26em"><thead><tr>';
		echo '<th scope="col">' . esc_html__( 'Jusqu’à', 'teeshoop' ) . '</th>';
		echo '<th scope="col" style="text-align:right">' . esc_html__( 'Tarif', 'teeshoop' ) . '</th>';
		echo '</tr></thead><tbody>';
		foreach ( (array) $shipping['grid'] as $row ) {
			printf(
				'<tr><td>%s</td><td style="text-align:right;font-variant-numeric:tabular-nums">%s</td></tr>',
				esc_html( Money::number( (int) $row['max_g'] / 1000, 2 ) . "\u{00A0}kg" ),
				esc_html( Money::format( (int) $row['ht'] ) )
			);
		}
		echo '</tbody></table></div>';
	}
}
