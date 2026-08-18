<?php
/**
 * The screens the associate maintains the cost model from, and the panel that
 * says what one order really earned.
 *
 * He is the one who will keep these numbers current, and he is not a developer,
 * so every figure the engine uses is on one page with the question that settles
 * it written beside it. A rate that lives only in a config array is a rate that
 * is never corrected.
 *
 * ── WHY THE SIMULATOR IS A FORM AND NOT JAVASCRIPT ───────────────────────────
 *
 * The page has to let an operator change a rate and watch the floor move, which
 * is the fastest way to understand what these settings do. Doing that live in
 * the browser would mean a second implementation of the floor-price formula, in
 * another language, and the day the two disagreed the screen would teach the
 * wrong number. So the form posts and the server answers with `Margin::plan`,
 * the same call the order panel makes. One formula, one answer.
 *
 * ── WHAT IS ON SCREEN AND WHAT IS NOT ────────────────────────────────────────
 *
 * Both readings of question 06 are printed side by side, deliberately: "taux de
 * marge" and "taux de marque" name different ratios in French commerce and the
 * Bible's formula is the second while its word is the first. An operator who
 * sees only one of them cannot tell us which he meant. See Margin.php.
 *
 * Nothing here is ever shown to a customer. This is `manage_woocommerce` only,
 * and `scripts/php-guard.mjs` keeps the vocabulary out of every rendering
 * directory.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class CostAdmin {

	private const SLUG           = 'teeshoop-couts';
	private const ACTION_SAVE    = 'teeshoop_couts';
	private const ACTION_REFRESH = 'teeshoop_marge_recalcul';
	private const ACTION_DEROG   = 'teeshoop_derogation';
	private const ACTION_ORDER   = 'teeshoop_marge_commande';

	/**
	 * The example the simulator opens on: the Bible's own thirty-t-shirt order,
	 * 250,00 EUR of direct cost.
	 *
	 * A REAL example rather than a round number, and labelled as the chapter's,
	 * so the page has honest content before anybody types anything. An empty
	 * simulator would be a form with no answer in it, which teaches nothing.
	 */
	private const EXAMPLE_COST_HT = 25000;

	public static function init(): void {
		add_action( 'admin_menu', array( self::class, 'menu' ) );
		add_action( 'admin_post_' . self::ACTION_SAVE, array( self::class, 'save' ) );
		add_action( 'admin_post_' . self::ACTION_REFRESH, array( self::class, 'handle_refresh' ) );
		add_action( 'admin_post_' . self::ACTION_DEROG, array( self::class, 'handle_derogation' ) );
		add_action( 'admin_post_' . self::ACTION_ORDER, array( self::class, 'handle_order_facts' ) );
		add_action( 'add_meta_boxes', array( self::class, 'meta_box' ) );
	}

	public static function menu(): void {
		add_submenu_page(
			'woocommerce',
			__( 'Coûts et marges Teeshoop', 'teeshoop' ),
			__( 'Coûts et marges', 'teeshoop' ),
			'manage_woocommerce',
			self::SLUG,
			array( self::class, 'screen' )
		);
	}

	public static function url(): string {
		return admin_url( 'admin.php?page=' . self::SLUG );
	}

	// ── Small conversions, in one place ──────────────────────────────────────

	/** A rate stored as 0.55, shown to a human as 55. */
	private static function pct_out( float $rate ): string {
		return Money::number( $rate * 100, 2 );
	}

	/**
	 * A percentage a human typed, back to a rate.
	 *
	 * `Money::from_eur` and not a cast, because it is the one parser in this
	 * plugin that accepts the comma a French admin types. "12,5" read by a cast
	 * is 12, which is a hundredfold error in a commission rate.
	 */
	private static function pct_in( mixed $raw, float $fallback ): float {
		$text = trim( (string) $raw );
		if ( '' === $text ) {
			return $fallback;
		}
		// Two divisions by a hundred and not one by ten thousand, because they
		// are two different conversions: `from_eur` returns hundredths of what
		// was typed, and a percentage is a hundredth of a rate.
		return Money::from_eur( $text ) / 100 / 100;
	}

	/**
	 * Money a human typed, in cents, with a fallback for an empty or unreadable
	 * field.
	 *
	 * The fallback is what makes an accidental blank harmless. `Money::from_eur`
	 * answers 0 for both "" and "abc", and a silent 0 in the hourly rate would
	 * make the shop's own labour free on every order costed afterwards, with
	 * nothing on the screen looking wrong. An operator who really means zero
	 * types a zero, which parses.
	 */
	private static function money_in( mixed $raw, int $fallback ): int {
		$text = trim( (string) $raw );
		if ( '' === $text ) {
			return $fallback;
		}
		return is_numeric( str_replace( array( ' ', ',', "\u{00A0}", "\u{202F}" ), array( '', '.', '', '' ), $text ) )
			? Money::from_eur( $text )
			: $fallback;
	}

	/** A whole number a human typed, clamped, with a fallback. */
	private static function int_in( mixed $raw, int $fallback, int $min = 0, int $max = PHP_INT_MAX ): int {
		$text = trim( (string) $raw );
		if ( '' === $text || ! is_numeric( str_replace( ',', '.', $text ) ) ) {
			return $fallback;
		}
		return max( $min, min( $max, (int) round( (float) str_replace( ',', '.', $text ) ) ) );
	}

	private static function float_in( mixed $raw, float $fallback, float $min = 0.0 ): float {
		$text = trim( (string) $raw );
		if ( '' === $text ) {
			return $fallback;
		}
		$value = (float) str_replace( ',', '.', $text );
		return is_finite( $value ) && $value >= $min ? $value : $fallback;
	}

	// ── Saving ───────────────────────────────────────────────────────────────

	public static function save(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'Vous n’avez pas le droit de modifier ces réglages.', 'teeshoop' ), '', array( 'response' => 403 ) );
		}
		check_admin_referer( self::ACTION_SAVE );

		// phpcs:disable WordPress.Security.NonceVerification.Missing -- checked above.
		$posted   = isset( $_POST['couts'] ) && is_array( $_POST['couts'] ) ? wp_unslash( $_POST['couts'] ) : array();
		$defaults = Cost::default_config();

		$times = array();
		foreach ( array_keys( Cost::OPERATIONS ) as $op ) {
			$times[ $op ] = self::int_in( $posted['times'][ $op ] ?? '', (int) $defaults['times_s'][ $op ], 0, 3600 );
		}

		$film = array(
			'rate_fr_ht'    => self::money_in( $posted['film']['rate_fr_ht'] ?? '', (int) $defaults['film']['rate_fr_ht'] ),
			'rate_es_ht'    => self::money_in( $posted['film']['rate_es_ht'] ?? '', (int) $defaults['film']['rate_es_ht'] ),
			'width_cm'      => self::float_in( $posted['film']['width_cm'] ?? '', (float) $defaults['film']['width_cm'], 1.0 ),
			'delivery_ht'   => self::money_in( $posted['film']['delivery_ht'] ?? '', (int) $defaults['film']['delivery_ht'] ),
			'min_m'         => self::float_in( $posted['film']['min_m'] ?? '', (float) $defaults['film']['min_m'] ),
			'waste_rate'    => self::pct_in( $posted['film']['waste_rate'] ?? '', (float) $defaults['film']['waste_rate'] ),
			'gap_cm'        => self::float_in( $posted['film']['gap_cm'] ?? '', (float) $defaults['film']['gap_cm'] ),
			'max_length_cm' => self::float_in( $posted['film']['max_length_cm'] ?? '', (float) $defaults['film']['max_length_cm'], 10.0 ),
		);

		/*
		 * A GARMENT ROW IS ONLY WRITTEN WHEN A PRICE WAS TYPED.
		 *
		 * An empty field must clear the row rather than store a zero: zero is a
		 * purchase price, and a garment we buy for nothing would be the most
		 * profitable thing in the catalogue. With the row absent, `Costing`
		 * reports the textile as UNKNOWN, which is what it is.
		 */
		$supply = array();
		foreach ( (array) ( $posted['garment'] ?? array() ) as $key => $row ) {
			$key   = sanitize_key( (string) $key );
			$cents = Money::from_eur( (string) ( $row['ht'] ?? '' ) );
			if ( '' === $key || $cents <= 0 ) {
				continue;
			}
			$supply[ $key ] = array(
				'ht'     => $cents,
				'source' => sanitize_text_field( (string) ( $row['source'] ?? '' ) ),
				'on'     => self::iso_date( (string) ( $row['on'] ?? '' ) ),
			);
		}

		update_option(
			OPTION_COSTING,
			array(
				'hourly_ht'             => self::money_in( $posted['hourly_ht'] ?? '', (int) $defaults['hourly_ht'] ),
				'times_s'               => $times,
				'film'                  => $film,
				'freight_ht'            => self::money_in( $posted['freight_ht'] ?? '', (int) $defaults['freight_ht'] ),
				'freight_free_from_ht'  => self::money_in( $posted['freight_free_from_ht'] ?? '', (int) $defaults['freight_free_from_ht'] ),
				'payment'               => array(
					'rate'         => self::pct_in( $posted['payment']['rate'] ?? '', (float) $defaults['payment']['rate'] ),
					'fixed_ht'     => self::money_in( $posted['payment']['fixed_ht'] ?? '', (int) $defaults['payment']['fixed_ht'] ),
					'free_methods' => $defaults['payment']['free_methods'],
				),
				'defect_rate'           => self::pct_in( $posted['defect_rate'] ?? '', 0.0 ),
				'consumables_piece_ht'  => self::money_in( $posted['consumables_piece_ht'] ?? '', (int) $defaults['consumables_piece_ht'] ),
				'target_margin_rate'    => self::pct_in( $posted['target_margin_rate'] ?? '', (float) $defaults['target_margin_rate'] ),
				'min_contribution_rate' => self::pct_in( $posted['min_contribution_rate'] ?? '', (float) $defaults['min_contribution_rate'] ),
				'max_discount_rate'     => self::pct_in( $posted['max_discount_rate'] ?? '', (float) $defaults['max_discount_rate'] ),
				'garment_supply'        => $supply,
			)
		);

		$com_defaults = Commission::default_config();
		$rates        = array();
		foreach ( array_keys( Commission::SALE_TYPES ) as $type ) {
			$rates[ $type ] = self::pct_in(
				$_POST['commissions']['rates'][ $type ] ?? '',
				(float) $com_defaults['rates'][ $type ]
			);
		}

		update_option(
			OPTION_COMMISSION,
			array(
				'rates'                 => $rates,
				'attribution_days'      => self::int_in( $_POST['commissions']['attribution_days'] ?? '', (int) $com_defaults['attribution_days'], 0, 3650 ),
				'definitive_after_days' => self::int_in( $_POST['commissions']['definitive_after_days'] ?? '', (int) $com_defaults['definitive_after_days'], 0, 365 ),
			)
		);
		// phpcs:enable

		wp_safe_redirect( add_query_arg( 'teeshoop', 'enregistre', self::url() ) );
		exit;
	}

	/** A date input, or '' when it is not a real calendar day. */
	private static function iso_date( string $raw ): string {
		$raw = trim( $raw );
		if ( 1 !== preg_match( '/^\d{4}-\d{2}-\d{2}$/', $raw ) ) {
			return '';
		}
		$date = \DateTimeImmutable::createFromFormat( '!Y-m-d', $raw, new \DateTimeZone( 'UTC' ) );
		return $date && $date->format( 'Y-m-d' ) === $raw ? $raw : '';
	}

	// ── The settings screen ──────────────────────────────────────────────────

	public static function screen(): void {
		$config     = Costing::config();
		$commission = Costing::commission_config();

		echo '<div class="wrap">';
		echo '<h1>' . esc_html__( 'Coûts et marges', 'teeshoop' ) . '</h1>';

		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- a display-only flag.
		if ( isset( $_GET['teeshoop'] ) && 'enregistre' === $_GET['teeshoop'] ) {
			echo '<div class="notice notice-success is-dismissible"><p>'
				. esc_html__( 'Réglages enregistrés.', 'teeshoop' ) . '</p></div>';
		}

		self::render_intro( $config );
		self::render_simulator( $config, $commission );

		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
		echo '<input type="hidden" name="action" value="' . esc_attr( self::ACTION_SAVE ) . '">';
		wp_nonce_field( self::ACTION_SAVE );

		self::render_margins( $config );
		self::render_labour( $config );
		self::render_film( $config );
		self::render_other( $config );
		self::render_garments( $config );
		self::render_commissions( $commission );

		submit_button( __( 'Enregistrer', 'teeshoop' ) );
		echo '</form></div>';
	}

	private static function render_intro( array $config ): void {
		echo '<div class="notice notice-info" style="padding:12px 14px"><p style="margin-top:0"><strong>'
			. esc_html__( 'Ce que cette page décide', 'teeshoop' ) . '</strong></p><p>';
		esc_html_e(
			'Chaque commande est chiffrée à partir de ces valeurs : ce qu’elle nous coûte réellement, le prix en dessous duquel elle ne doit pas être vendue, et ce que le commercial gagne. Aucune de ces valeurs n’a été confirmée par vous : ce sont les hypothèses écrites dans QUESTIONS-ASSOCIE.md, et la question qui tranche chacune est indiquée à côté.',
			'teeshoop'
		);
		echo '</p><p>';
		esc_html_e(
			'Trois postes de coût n’ont aucune valeur mesurée : la provision de défaut, les consommables et cinq des sept opérations d’atelier. Tant qu’ils sont vides, le plancher affiché sur une commande est un plancher MINIMUM : le vrai est au moins celui-là, et probablement plus haut.',
			'teeshoop'
		);
		echo '</p>';

		if ( ! Nest::configured() ) {
			echo '<p><strong>' . esc_html__( 'Imbrication du film', 'teeshoop' ) . '</strong> : '
				. esc_html__( 'le service qui mesure le métrage réel n’est pas joignable, il manque l’adresse du Worker ou la constante TEESHOOP_WORKER_TOKEN dans wp-config.php. Les commandes sont chiffrées sur une borne haute (un transfert par bande, sans imbrication), donc plus cher que la réalité.', 'teeshoop' )
				. '</p>';
		}
		echo '</div>';
	}

	/**
	 * The panel that makes the settings legible: change a rate above, press the
	 * button, watch the floor move.
	 */
	private static function render_simulator( array $config, array $commission ): void {
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- a read-only simulation of values already on this page.
		$direct_ht  = isset( $_GET['cout'] ) ? Money::from_eur( sanitize_text_field( wp_unslash( (string) $_GET['cout'] ) ) ) : self::EXAMPLE_COST_HT;
		$type     = isset( $_GET['vente'] ) ? sanitize_key( wp_unslash( (string) $_GET['vente'] ) ) : 'premiere';
		$price_in = isset( $_GET['prix'] ) ? sanitize_text_field( wp_unslash( (string) $_GET['prix'] ) ) : '';
		// phpcs:enable

		$direct_ht = max( 0, $direct_ht );
		$rate    = Commission::rate( $type, $commission ) ?? 0.0;

		try {
			$plan = Margin::plan( $direct_ht, Costing::rules( $rate, $config ) );
		} catch ( \InvalidArgumentException $e ) {
			echo '<div class="notice notice-error"><p><strong>' . esc_html__( 'Ces réglages n’ont pas de solution', 'teeshoop' ) . '</strong><br>'
				. esc_html__( 'La contribution minimale demandée est supérieure à ce qui reste après la commission : aucun prix, si élevé soit-il, ne peut la laisser. Baissez la contribution minimale ou le taux de commission.', 'teeshoop' )
				. '</p></div>';
			return;
		}

		$price   = '' === $price_in ? $plan['recommended_ht'] : Money::from_eur( $price_in );
		$verdict = Margin::verdict( max( 0, $price ), $plan );

		echo '<h2>' . esc_html__( 'Simulateur', 'teeshoop' ) . '</h2>';
		echo '<p class="description" style="max-width:46em">' . esc_html__(
			'Le coût proposé par défaut est celui de l’exemple chiffré du chapitre 1 de votre document : une commande de 30 t-shirts à 250,00 EUR de coût direct. Changez un taux plus bas, enregistrez, et revenez : le plancher aura bougé.',
			'teeshoop'
		) . '</p>';

		echo '<form method="get" action="' . esc_url( admin_url( 'admin.php' ) ) . '" style="margin-bottom:1em">';
		echo '<input type="hidden" name="page" value="' . esc_attr( self::SLUG ) . '">';
		echo '<label style="margin-right:1em">' . esc_html__( 'Coût direct HT', 'teeshoop' )
			. ' <input type="text" name="cout" size="8" value="' . esc_attr( Money::number( Money::to_eur( $direct_ht ), 2 ) ) . '" inputmode="decimal"> EUR</label>';
		echo '<label style="margin-right:1em">' . esc_html__( 'Type de vente', 'teeshoop' ) . ' <select name="vente">';
		foreach ( Commission::SALE_TYPES as $key => $label ) {
			printf(
				'<option value="%s"%s>%s</option>',
				esc_attr( $key ),
				selected( $key, $type, false ),
				esc_html( $label )
			);
		}
		echo '</select></label>';
		echo '<label style="margin-right:1em">' . esc_html__( 'Prix proposé HT', 'teeshoop' )
			. ' <input type="text" name="prix" size="8" value="' . esc_attr( '' === $price_in ? '' : $price_in ) . '" placeholder="' . esc_attr( Money::number( Money::to_eur( (int) $plan['recommended_ht'] ), 2 ) ) . '" inputmode="decimal"> EUR</label>';
		submit_button( __( 'Calculer', 'teeshoop' ), 'secondary', '', false );
		echo '</form>';

		self::render_plan_table( $plan, $verdict, $config, $rate );
	}

	/** The four numbers the chapter says a salesperson must see. */
	private static function render_plan_table( array $plan, array $verdict, array $config, float $rate ): void {
		$mark_up = Margin::mark_up_price( (int) $plan['direct_ht'], (float) $config['target_margin_rate'] );

		echo '<div style="overflow-x:auto;max-width:100%"><table class="widefat striped" style="max-width:52em"><tbody>';

		self::row( __( 'Coût direct', 'teeshoop' ), Money::format( (int) $plan['direct_ht'] ), __( 'La somme des dix postes du chapitre 1.', 'teeshoop' ) );
		self::row(
			__( 'Prix conseillé', 'teeshoop' ),
			Money::format( (int) $plan['recommended_ht'] ),
			$plan['raised_to_floor']
				? __( 'Relevé au plancher : votre marge cible donne un prix INFÉRIEUR au plancher, les deux réglages se contredisent.', 'teeshoop' )
				: sprintf(
					/* translators: %s: a percentage, e.g. "55,00 %". */
					__( 'Coût ÷ (1 − %s), la formule du chapitre 1.', 'teeshoop' ),
					self::pct_out( (float) $config['target_margin_rate'] ) . "\u{00A0}%"
				)
		);
		self::row(
			__( 'Si « taux de marge » voulait dire marge sur le coût', 'teeshoop' ),
			Money::format( $mark_up ),
			__( 'Autre lecture du même pourcentage, question 06. Ce n’est PAS le prix appliqué : c’est l’écart que votre réponse va trancher.', 'teeshoop' )
		);
		self::row(
			__( 'Remise possible sans validation', 'teeshoop' ),
			Money::format( (int) $plan['recommended_ht'] - (int) $plan['free_from_ht'] ),
			sprintf(
				/* translators: %s: the lowest price needing no approval. */
				__( 'Jusqu’à %s. En dessous, il faut votre accord.', 'teeshoop' ),
				Money::format( (int) $plan['free_from_ht'] )
			)
		);
		self::row(
			__( 'Prix plancher', 'teeshoop' ),
			Money::format( (int) $plan['floor_ht'] ),
			sprintf(
				/* translators: %s: a percentage of the selling price. */
				__( 'Le prix le plus bas qui laisse encore %s du prix de vente APRÈS commission. En dessous, il faut une dérogation.', 'teeshoop' ),
				self::pct_out( (float) $config['min_contribution_rate'] ) . "\u{00A0}%"
			)
		);
		self::row( __( 'Zone de négociation', 'teeshoop' ), Money::format( (int) $plan['zone_ht'] ), __( 'Entre le prix conseillé et le plancher.', 'teeshoop' ) );

		echo '</tbody></table></div>';

		echo '<h3>' . esc_html__( 'Au prix proposé', 'teeshoop' ) . '</h3>';
		echo '<div style="overflow-x:auto;max-width:100%"><table class="widefat striped" style="max-width:52em"><tbody>';
		self::row( __( 'Prix de vente HT', 'teeshoop' ), Money::format( (int) $verdict['price_ht'] ), self::verdict_sentence( $verdict ) );
		self::row( __( 'Remise', 'teeshoop' ), Money::format( (int) $verdict['discount_ht'] ), Money::number( (float) $verdict['discount_rate'] * 100, 1 ) . "\u{00A0}%" );
		self::row( __( 'Marge contributive', 'teeshoop' ), Money::format( (int) $verdict['margin_ht'] ), Money::number( (float) $verdict['margin_rate'] * 100, 1 ) . "\u{00A0}%" );
		self::row(
			__( 'Commission', 'teeshoop' ),
			Money::format( (int) $verdict['commission'] ),
			sprintf(
				/* translators: %s: a commission rate as a percentage. */
				__( '%s de la marge contributive, versée à mesure des encaissements.', 'teeshoop' ),
				self::pct_out( $rate ) . "\u{00A0}%"
			)
		);
		self::row( __( 'Ce qui reste à Teeshoop', 'teeshoop' ), Money::format( (int) $verdict['teeshoop_ht'] ), __( 'Avant frais fixes et impôt.', 'teeshoop' ) );
		echo '</tbody></table></div>';
	}

	private static function verdict_sentence( array $verdict ): string {
		if ( ! empty( $verdict['below_cost'] ) ) {
			return __( 'Sous le coût direct : cette vente perd de l’argent avant même la commission.', 'teeshoop' );
		}
		if ( ! empty( $verdict['below_floor'] ) ) {
			return __( 'Sous le plancher : une dérogation motivée, validée et datée est nécessaire.', 'teeshoop' );
		}
		if ( ! empty( $verdict['needs_approval'] ) ) {
			return __( 'Au-dessus du plancher, mais la remise dépasse ce qu’un commercial peut accorder seul.', 'teeshoop' );
		}
		return __( 'Vendable sans validation.', 'teeshoop' );
	}

	private static function row( string $label, string $value, string $note = '' ): void {
		echo '<tr><th scope="row" style="width:16em">' . esc_html( $label ) . '</th>';
		echo '<td style="width:8em;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap">' . esc_html( $value ) . '</td>';
		echo '<td class="description">' . esc_html( $note ) . '</td></tr>';
	}

	private static function field( string $name, string $value, string $unit = '', int $size = 8 ): string {
		return sprintf(
			'<input type="text" name="%s" value="%s" size="%d" inputmode="decimal" style="text-align:right;font-variant-numeric:tabular-nums">%s',
			esc_attr( $name ),
			esc_attr( $value ),
			$size,
			'' === $unit ? '' : ' ' . esc_html( $unit )
		);
	}

	private static function section( string $title, string $intro ): void {
		echo '<h2>' . esc_html( $title ) . '</h2>';
		echo '<p class="description" style="max-width:46em">' . esc_html( $intro ) . '</p>';
	}

	private static function render_margins( array $config ): void {
		self::section(
			__( 'Marges et remises', 'teeshoop' ),
			__( 'Question 06. La marge cible est une marge SUR LE PRIX DE VENTE : à 55 %, un coût de 100 EUR se vend 222,22 EUR. La contribution minimale est la part du prix qui doit rester après la commission ; elle ne peut pas dépasser 100 % moins le taux de commission, sinon aucun prix ne convient.', 'teeshoop' )
		);
		echo '<table class="form-table" role="presentation"><tbody>';
		self::input_row( __( 'Marge cible', 'teeshoop' ), 'couts[target_margin_rate]', self::pct_out( (float) $config['target_margin_rate'] ), '%' );
		self::input_row( __( 'Contribution minimale', 'teeshoop' ), 'couts[min_contribution_rate]', self::pct_out( (float) $config['min_contribution_rate'] ), '%' );
		self::input_row( __( 'Remise maximale sans validation', 'teeshoop' ), 'couts[max_discount_rate]', self::pct_out( (float) $config['max_discount_rate'] ), '%' );
		echo '</tbody></table>';
	}

	private static function render_labour( array $config ): void {
		self::section(
			__( 'La main-d’œuvre', 'teeshoop' ),
			__( 'Question 05. Le chapitre 1 est formel : le temps du dirigeant et de ses proches n’est pas gratuit, sans quoi toutes les petites commandes paraissent rentables. Une opération à 0 seconde n’est pas gratuite, elle n’a jamais été chronométrée, et la commande est alors chiffrée en dessous de son coût réel.', 'teeshoop' )
		);
		echo '<table class="form-table" role="presentation"><tbody>';
		self::input_row( __( 'Taux horaire chargé', 'teeshoop' ), 'couts[hourly_ht]', Money::number( Money::to_eur( (int) $config['hourly_ht'] ), 2 ), 'EUR' );
		echo '</tbody></table>';

		echo '<div style="overflow-x:auto;max-width:100%"><table class="widefat striped" style="max-width:46em"><thead><tr>';
		echo '<th scope="col">' . esc_html__( 'Opération', 'teeshoop' ) . '</th>';
		echo '<th scope="col">' . esc_html__( 'Compté par', 'teeshoop' ) . '</th>';
		echo '<th scope="col">' . esc_html__( 'Secondes', 'teeshoop' ) . '</th>';
		echo '<th scope="col">' . esc_html__( 'État', 'teeshoop' ) . '</th>';
		echo '</tr></thead><tbody>';

		$per_fr = array(
			'order'    => __( 'commande', 'teeshoop' ),
			'piece'    => __( 'vêtement', 'teeshoop' ),
			'transfer' => __( 'transfert', 'teeshoop' ),
		);

		foreach ( Cost::OPERATIONS as $key => $op ) {
			$seconds = (int) ( $config['times_s'][ $key ] ?? 0 );
			echo '<tr>';
			echo '<th scope="row">' . esc_html( $op['label'] ) . '</th>';
			echo '<td>' . esc_html( $per_fr[ $op['per'] ] ) . '</td>';
			echo '<td>' . self::field( 'couts[times][' . $key . ']', (string) $seconds, 's', 5 ) . '</td>';
			echo '<td class="description">' . esc_html(
				0 === $seconds
					? __( 'Jamais chronométrée', 'teeshoop' )
					: __( 'Mesurée', 'teeshoop' )
			) . '</td>';
			echo '</tr>';
		}
		echo '</tbody></table></div>';
	}

	private static function render_film( array $config ): void {
		$film = (array) $config['film'];
		self::section(
			__( 'Le film', 'teeshoop' ),
			__( 'Question 04. Le tarif et la laize vont ensemble : 17,00 EUR le mètre linéaire DE 56 cm est un seul tarif, et changer l’un sans l’autre chiffre le film sur un rouleau qui n’est pas le vôtre. Le métrage n’est pas saisi : il est mesuré en imbriquant les visuels réels de la commande.', 'teeshoop' )
		);
		echo '<table class="form-table" role="presentation"><tbody>';
		self::input_row( __( 'Tarif France, par mètre linéaire', 'teeshoop' ), 'couts[film][rate_fr_ht]', Money::number( Money::to_eur( (int) $film['rate_fr_ht'] ), 2 ), 'EUR' );
		self::input_row( __( 'Tarif Espagne, par mètre linéaire', 'teeshoop' ), 'couts[film][rate_es_ht]', Money::number( Money::to_eur( (int) $film['rate_es_ht'] ), 2 ), 'EUR' );
		self::input_row( __( 'Laize du rouleau', 'teeshoop' ), 'couts[film][width_cm]', Money::number( (float) $film['width_cm'], 1 ), 'cm' );
		self::input_row( __( 'Livraison du film, par commande', 'teeshoop' ), 'couts[film][delivery_ht]', Money::number( Money::to_eur( (int) $film['delivery_ht'] ), 2 ), 'EUR' );
		self::input_row( __( 'Métrage minimum facturé', 'teeshoop' ), 'couts[film][min_m]', Money::number( (float) $film['min_m'], 2 ), 'm' );
		self::input_row( __( 'Provision de perte', 'teeshoop' ), 'couts[film][waste_rate]', self::pct_out( (float) $film['waste_rate'] ), '%' );
		self::input_row( __( 'Écart entre deux motifs', 'teeshoop' ), 'couts[film][gap_cm]', Money::number( (float) $film['gap_cm'], 2 ), 'cm' );
		self::input_row( __( 'Longueur maximale d’un fichier', 'teeshoop' ), 'couts[film][max_length_cm]', Money::number( (float) $film['max_length_cm'], 0 ), 'cm' );
		echo '</tbody></table>';
	}

	private static function render_other( array $config ): void {
		self::section(
			__( 'Les autres coûts directs', 'teeshoop' ),
			__( 'Questions 03, 07, 15 et 27. La provision de défaut et les consommables sont à zéro parce que personne ne les a mesurés : tant qu’ils y sont, le plancher est un minimum.', 'teeshoop' )
		);
		echo '<table class="form-table" role="presentation"><tbody>';
		self::input_row( __( 'Port fournisseur textile', 'teeshoop' ), 'couts[freight_ht]', Money::number( Money::to_eur( (int) $config['freight_ht'] ), 2 ), 'EUR' );
		self::input_row( __( 'Franco fournisseur', 'teeshoop' ), 'couts[freight_free_from_ht]', Money::number( Money::to_eur( (int) $config['freight_free_from_ht'] ), 2 ), 'EUR' );
		self::input_row( __( 'Frais de paiement, taux', 'teeshoop' ), 'couts[payment][rate]', self::pct_out( (float) $config['payment']['rate'] ), '%' );
		self::input_row( __( 'Frais de paiement, fixe', 'teeshoop' ), 'couts[payment][fixed_ht]', Money::number( Money::to_eur( (int) $config['payment']['fixed_ht'] ), 2 ), 'EUR' );
		self::input_row( __( 'Consommables par vêtement', 'teeshoop' ), 'couts[consumables_piece_ht]', Money::number( Money::to_eur( (int) $config['consumables_piece_ht'] ), 2 ), 'EUR' );
		self::input_row( __( 'Provision de défaut', 'teeshoop' ), 'couts[defect_rate]', self::pct_out( (float) $config['defect_rate'] ), '%' );
		echo '</tbody></table>';
	}

	private static function render_garments( array $config ): void {
		$supply   = (array) ( $config['garment_supply'] ?? array() );
		$garments = (array) Settings::pricing()['garments'];

		self::section(
			__( 'Prix d’achat des vêtements du studio', 'teeshoop' ),
			__( 'Question 03. Un article du catalogue fournisseur porte déjà son prix d’achat réel et n’a pas besoin de cette table. Les vêtements du studio, eux, ne sont rattachés à aucune référence : sans prix ici, leur coût textile est INCONNU et la commande n’a pas de plancher chiffrable.', 'teeshoop' )
		);

		echo '<div style="overflow-x:auto;max-width:100%"><table class="widefat striped" style="max-width:52em"><thead><tr>';
		echo '<th scope="col">' . esc_html__( 'Vêtement', 'teeshoop' ) . '</th>';
		echo '<th scope="col">' . esc_html__( 'Prix d’achat HT', 'teeshoop' ) . '</th>';
		echo '<th scope="col">' . esc_html__( 'D’où vient ce prix', 'teeshoop' ) . '</th>';
		echo '<th scope="col">' . esc_html__( 'Valable au', 'teeshoop' ) . '</th>';
		echo '</tr></thead><tbody>';

		foreach ( array_keys( $garments ) as $key ) {
			$row = is_array( $supply[ $key ] ?? null ) ? $supply[ $key ] : array();
			echo '<tr>';
			echo '<th scope="row"><code>' . esc_html( (string) $key ) . '</code></th>';
			echo '<td>' . self::field( 'couts[garment][' . $key . '][ht]', isset( $row['ht'] ) ? Money::number( Money::to_eur( (int) $row['ht'] ), 2 ) : '', 'EUR' ) . '</td>';
			printf(
				'<td><input type="text" name="couts[garment][%s][source]" value="%s" size="28" placeholder="%s"></td>',
				esc_attr( (string) $key ),
				esc_attr( (string) ( $row['source'] ?? '' ) ),
				esc_attr__( 'Devis fournisseur, facture, tarif négocié…', 'teeshoop' )
			);
			printf(
				'<td><input type="date" name="couts[garment][%s][on]" value="%s"></td>',
				esc_attr( (string) $key ),
				esc_attr( (string) ( $row['on'] ?? '' ) )
			);
			echo '</tr>';
		}
		echo '</tbody></table></div>';
		echo '<p class="description" style="max-width:46em">' . esc_html__( 'Videz le prix pour retirer la ligne. Un prix d’achat vide vaut « inconnu », jamais « gratuit ».', 'teeshoop' ) . '</p>';
	}

	private static function render_commissions( array $commission ): void {
		self::section(
			__( 'Les commissions', 'teeshoop' ),
			__( 'Question 29. La commission porte sur la marge contributive réellement encaissée, jamais sur le chiffre d’affaires : sur l’exemple du chapitre 1, la même commande paie 150 EUR sur la marge et 300 EUR sur le TTC, alors qu’elle ne rapporte que 225 EUR avant frais fixes.', 'teeshoop' )
		);
		echo '<table class="form-table" role="presentation"><tbody>';
		foreach ( Commission::SALE_TYPES as $key => $label ) {
			self::input_row( $label, 'commissions[rates][' . $key . ']', self::pct_out( (float) ( $commission['rates'][ $key ] ?? 0 ) ), '%' );
		}
		self::input_row( __( 'Durée d’attribution d’un client', 'teeshoop' ), 'commissions[attribution_days]', (string) (int) $commission['attribution_days'], __( 'jours', 'teeshoop' ) );
		self::input_row( __( 'Délai avant commission définitive', 'teeshoop' ), 'commissions[definitive_after_days]', (string) (int) $commission['definitive_after_days'], __( 'jours après livraison', 'teeshoop' ) );
		echo '</tbody></table>';
	}

	private static function input_row( string $label, string $name, string $value, string $unit ): void {
		$id = 'ts-' . md5( $name );
		printf(
			'<tr><th scope="row"><label for="%s">%s</label></th><td><input type="text" id="%s" name="%s" value="%s" size="10" inputmode="decimal" style="text-align:right;font-variant-numeric:tabular-nums"> %s</td></tr>',
			esc_attr( $id ),
			esc_html( $label ),
			esc_attr( $id ),
			esc_attr( $name ),
			esc_attr( $value ),
			esc_html( $unit )
		);
	}

	// ── The order panel ──────────────────────────────────────────────────────

	public static function meta_box(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}
		/*
		 * BOTH SCREENS, the same reason as Ledger::meta_box: an order lives at
		 * `woocommerce_page_wc-orders` under HPOS and at `shop_order` on the
		 * legacy storage, and `wc_get_page_screen_id()` is only loaded for admin
		 * requests. Registering on a screen that never renders costs nothing.
		 */
		$screens = array( 'shop_order', 'woocommerce_page_wc-orders' );
		if ( function_exists( 'wc_get_page_screen_id' ) ) {
			$screens[] = wc_get_page_screen_id( 'shop-order' );
		}

		foreach ( array_unique( $screens ) as $screen ) {
			add_meta_box(
				'teeshoop-marge',
				__( 'Rentabilité de la commande', 'teeshoop' ),
				array( self::class, 'render_meta_box' ),
				$screen,
				'normal',
				'default'
			);
		}
	}

	/** @param \WP_Post|\WC_Order $post_or_order */
	public static function render_meta_box( $post_or_order ): void {
		$order = $post_or_order instanceof \WC_Order ? $post_or_order : wc_get_order( $post_or_order->ID ?? 0 );
		if ( ! $order instanceof \WC_Order ) {
			return;
		}

		$report = Costing::stored( $order );

		self::render_order_facts( $order );

		if ( null === $report ) {
			echo '<p>' . esc_html__( 'Cette commande n’a jamais été chiffrée. Le calcul interroge le service d’imbrication pour mesurer le film réellement nécessaire, ce qui prend quelques secondes.', 'teeshoop' ) . '</p>';
			self::render_refresh_button( $order, __( 'Chiffrer cette commande', 'teeshoop' ) );
			return;
		}

		self::render_report( $order, $report );
		self::render_refresh_button( $order, __( 'Recalculer', 'teeshoop' ) );
	}

	private static function render_refresh_button( \WC_Order $order, string $label ): void {
		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '" style="margin-top:1em">';
		echo '<input type="hidden" name="action" value="' . esc_attr( self::ACTION_REFRESH ) . '">';
		echo '<input type="hidden" name="commande" value="' . esc_attr( (string) $order->get_id() ) . '">';
		wp_nonce_field( self::ACTION_REFRESH );
		submit_button( $label, 'secondary', '', false );
		echo '</form>';
	}

	/** Who sold it, what kind of sale it was, and when it was delivered. */
	private static function render_order_facts( \WC_Order $order ): void {
		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '" style="margin-bottom:1.4em">';
		echo '<input type="hidden" name="action" value="' . esc_attr( self::ACTION_ORDER ) . '">';
		echo '<input type="hidden" name="commande" value="' . esc_attr( (string) $order->get_id() ) . '">';
		wp_nonce_field( self::ACTION_ORDER );

		echo '<p style="display:flex;flex-wrap:wrap;gap:1em;align-items:flex-end;margin:0 0 .6em">';

		echo '<label>' . esc_html__( 'Type de vente', 'teeshoop' ) . '<br><select name="type_vente">';
		$current = Costing::sale_type( $order );
		foreach ( Commission::SALE_TYPES as $key => $label ) {
			printf( '<option value="%s"%s>%s</option>', esc_attr( $key ), selected( $key, $current, false ), esc_html( $label ) );
		}
		echo '</select></label>';

		printf(
			'<label>%s<br><input type="text" name="commercial" value="%s" size="20"></label>',
			esc_html__( 'Commercial', 'teeshoop' ),
			esc_attr( Costing::seller( $order ) )
		);
		printf(
			'<label>%s<br><input type="date" name="livree_le" value="%s"></label>',
			esc_html__( 'Livrée le', 'teeshoop' ),
			esc_attr( Costing::delivered_on( $order ) )
		);
		submit_button( __( 'Enregistrer', 'teeshoop' ), 'secondary', '', false );
		echo '</p>';
		echo '<p class="description">' . esc_html__( 'Le type de vente décide du taux de commission ; la date de livraison ouvre le délai de contestation au bout duquel elle devient définitive. Ni l’un ni l’autre n’apparaît jamais sur un document client.', 'teeshoop' ) . '</p>';
		echo '</form>';
	}

	private static function render_report( \WC_Order $order, array $report ): void {
		$cost    = (array) $report['cost'];
		$plan    = (array) $report['plan'];
		$verdict = (array) $report['verdict'];

		foreach ( (array) $report['warnings'] as $warning ) {
			echo '<div class="notice notice-warning inline" style="margin:.4em 0"><p>' . esc_html( (string) $warning ) . '</p></div>';
		}

		echo '<h4 style="margin-bottom:.4em">' . esc_html__( 'Ce que la commande a coûté', 'teeshoop' ) . '</h4>';
		echo '<div style="overflow-x:auto;max-width:100%"><table class="widefat striped"><thead><tr>';
		echo '<th scope="col">' . esc_html__( 'Poste', 'teeshoop' ) . '</th>';
		echo '<th scope="col" style="text-align:right">' . esc_html__( 'Montant HT', 'teeshoop' ) . '</th>';
		echo '<th scope="col">' . esc_html__( 'Fiabilité', 'teeshoop' ) . '</th>';
		echo '<th scope="col">' . esc_html__( 'Source', 'teeshoop' ) . '</th>';
		echo '</tr></thead><tbody>';

		foreach ( (array) $cost['lines'] as $line ) {
			echo '<tr>';
			echo '<th scope="row">' . esc_html( (string) $line['label'] ) . '</th>';
			echo '<td style="text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap">'
				. esc_html( Cost::UNKNOWN === $line['confidence'] ? __( 'inconnu', 'teeshoop' ) : Money::format( (int) $line['amount_ht'] ) )
				. '</td>';
			echo '<td>' . esc_html( self::confidence_fr( (string) $line['confidence'] ) ) . '</td>';
			echo '<td class="description">' . esc_html( (string) $line['source'] . ( '' !== (string) $line['on'] ? ' (' . (string) $line['on'] . ')' : '' ) ) . '</td>';
			echo '</tr>';
		}

		echo '<tr><th scope="row"><strong>' . esc_html__( 'Coût direct connu', 'teeshoop' ) . '</strong></th>';
		echo '<td style="text-align:right;font-variant-numeric:tabular-nums"><strong>' . esc_html( Money::format( (int) $cost['total_ht'] ) ) . '</strong></td>';
		echo '<td colspan="2" class="description">' . esc_html(
			$cost['complete']
				? __( 'Les dix postes sont renseignés.', 'teeshoop' )
				: sprintf(
					/* translators: %d: how many cost components are missing. */
					__( 'Incomplet : %d poste(s) sans valeur. Le coût réel est plus élevé.', 'teeshoop' ),
					count( (array) $cost['unknown'] ) + count( (array) $cost['absent'] )
				)
		) . '</td></tr>';
		echo '</tbody></table></div>';

		echo '<h4 style="margin-bottom:.4em">' . esc_html__( 'Ce qu’elle rapporte', 'teeshoop' ) . '</h4>';
		echo '<div style="overflow-x:auto;max-width:100%"><table class="widefat striped"><tbody>';

		self::row( __( 'Vendue HT', 'teeshoop' ), Money::format( (int) $report['revenue']['total_ht'] ), __( 'Marchandises, port et remises, hors taxes. Le même total que la facture.', 'teeshoop' ) );
		self::row(
			__( 'Prix conseillé', 'teeshoop' ),
			Money::format( (int) $plan['recommended_ht'] ),
			__( 'Ce que cette commande aurait dû être vendue au taux de marge cible.', 'teeshoop' )
		);
		self::row(
			$cost['complete'] ? __( 'Prix plancher', 'teeshoop' ) : __( 'Prix plancher minimum', 'teeshoop' ),
			Money::format( (int) $plan['floor_ht'] ),
			$cost['complete']
				? __( 'En dessous, une dérogation est nécessaire.', 'teeshoop' )
				: __( 'Calculé sur un coût incomplet : le vrai plancher est au moins celui-là.', 'teeshoop' )
		);
		self::row( __( 'Marge contributive', 'teeshoop' ), Money::format( (int) $verdict['margin_ht'] ), self::verdict_sentence( $verdict ) );
		self::row(
			__( 'Commission', 'teeshoop' ),
			Money::format( (int) $report['commission']['earned_ht'] ),
			sprintf(
				/* translators: 1: total commission if fully paid, 2: state of the commission. */
				__( 'Sur %1$s au total, %2$s', 'teeshoop' ),
				Money::format( (int) $report['commission']['full_ht'] ),
				self::state_fr( (string) $report['state']['state'], (array) $report['state']['open'] )
			)
		);
		self::row( __( 'Ce qui reste à Teeshoop', 'teeshoop' ), Money::format( (int) $verdict['margin_ht'] - (int) $report['commission']['full_ht'] ), __( 'Marge contributive moins la commission, avant frais fixes.', 'teeshoop' ) );

		echo '</tbody></table></div>';

		echo '<p class="description">' . esc_html(
			sprintf(
				/* translators: %s: a date. */
				__( 'Chiffrée le %s. Les montants sont figés à cette date : recalculez après avoir changé un tarif.', 'teeshoop' ),
				(string) $report['computed_on']
			)
		) . '</p>';

		if ( ! empty( $verdict['below_floor'] ) ) {
			self::render_derogation( $order, $report );
		}
	}

	private static function confidence_fr( string $confidence ): string {
		$map = array(
			Cost::REAL      => __( 'réel', 'teeshoop' ),
			Cost::ESTIMATED => __( 'estimé', 'teeshoop' ),
			Cost::NONE      => __( 'néant', 'teeshoop' ),
			Cost::UNKNOWN   => __( 'inconnu', 'teeshoop' ),
		);
		return $map[ $confidence ] ?? $confidence;
	}

	private static function state_fr( string $state, array $open ): string {
		if ( Commission::DEFINITIVE === $state ) {
			return __( 'définitive.', 'teeshoop' );
		}
		if ( Commission::NONE === $state ) {
			return __( 'rien n’est encore acquis.', 'teeshoop' );
		}
		return __( 'provisoire : ', 'teeshoop' ) . strtolower( implode( ', ', array_map( 'strval', $open ) ) ) . '.';
	}

	/**
	 * The exception the chapter requires below the floor: motive, approver,
	 * validity and displayed impact.
	 */
	private static function render_derogation( \WC_Order $order, array $report ): void {
		$existing = Costing::derogation( $order );
		$covers   = Costing::derogation_covers( $existing, (array) $report['verdict'], (array) $report['plan'], Settings::today() );
		$impact   = (int) $report['plan']['floor_ht'] - (int) $report['verdict']['price_ht'];

		echo '<h4 style="margin-bottom:.4em">' . esc_html__( 'Dérogation', 'teeshoop' ) . '</h4>';

		if ( null !== $existing ) {
			echo '<p>' . esc_html(
				sprintf(
					/* translators: 1: approver, 2: date granted, 3: expiry date, 4: the motive. */
					__( 'Accordée par %1$s le %2$s, valable jusqu’au %3$s. Motif : %4$s', 'teeshoop' ),
					$existing['approver'],
					$existing['on'],
					$existing['until'],
					$existing['reason']
				)
			) . '</p>';
			if ( ! $covers ) {
				echo '<div class="notice notice-error inline"><p>' . esc_html__( 'Cette dérogation ne couvre plus la commande : elle a expiré, ou le prix ou le plancher ont changé depuis. Il en faut une nouvelle.', 'teeshoop' ) . '</p></div>';
			}
		}

		echo '<p>' . esc_html(
			sprintf(
				/* translators: %s: how far below the floor the order was sold. */
				__( 'Cette commande est %s en dessous du plancher. C’est ce que la vente coûte à Teeshoop par rapport au minimum qu’elle s’est fixé.', 'teeshoop' ),
				Money::format( max( 0, $impact ) )
			)
		) . '</p>';

		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
		echo '<input type="hidden" name="action" value="' . esc_attr( self::ACTION_DEROG ) . '">';
		echo '<input type="hidden" name="commande" value="' . esc_attr( (string) $order->get_id() ) . '">';
		wp_nonce_field( self::ACTION_DEROG );
		echo '<p style="display:flex;flex-wrap:wrap;gap:1em;align-items:flex-end">';
		printf(
			'<label style="flex:1 1 22em">%s<br><input type="text" name="motif" required maxlength="240" style="width:100%%" value=""></label>',
			esc_html__( 'Motif', 'teeshoop' )
		);
		printf(
			'<label>%s<br><input type="text" name="valideur" required maxlength="80" value="%s"></label>',
			esc_html__( 'Validé par', 'teeshoop' ),
			esc_attr( wp_get_current_user()->display_name )
		);
		printf(
			'<label>%s<br><input type="date" name="jusquau" required value="%s"></label>',
			esc_html__( 'Valable jusqu’au', 'teeshoop' ),
			esc_attr( gmdate( 'Y-m-d', strtotime( Settings::today() . ' +7 days' ) ?: time() ) )
		);
		submit_button( __( 'Enregistrer la dérogation', 'teeshoop' ), 'secondary', '', false );
		echo '</p></form>';
	}

	// ── Handlers ─────────────────────────────────────────────────────────────

	private static function order_from_request(): ?\WC_Order {
		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- every caller checks first.
		$id    = isset( $_POST['commande'] ) ? absint( wp_unslash( $_POST['commande'] ) ) : 0;
		$order = $id > 0 ? wc_get_order( $id ) : null;
		return $order instanceof \WC_Order ? $order : null;
	}

	private static function back( \WC_Order $order, string $result ): void {
		wp_safe_redirect( add_query_arg( 'teeshoop', $result, $order->get_edit_order_url() ) );
		exit;
	}

	public static function handle_refresh(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'Vous n’avez pas le droit de chiffrer une commande.', 'teeshoop' ), '', array( 'response' => 403 ) );
		}
		check_admin_referer( self::ACTION_REFRESH );
		$order = self::order_from_request();
		if ( null === $order ) {
			wp_die( esc_html__( 'Commande introuvable.', 'teeshoop' ), '', array( 'response' => 404 ) );
		}
		Costing::refresh( $order );
		self::back( $order, 'chiffree' );
	}

	public static function handle_order_facts(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'Vous n’avez pas le droit de modifier cette commande.', 'teeshoop' ), '', array( 'response' => 403 ) );
		}
		check_admin_referer( self::ACTION_ORDER );
		$order = self::order_from_request();
		if ( null === $order ) {
			wp_die( esc_html__( 'Commande introuvable.', 'teeshoop' ), '', array( 'response' => 404 ) );
		}

		// phpcs:disable WordPress.Security.NonceVerification.Missing -- checked above.
		$type = sanitize_key( wp_unslash( (string) ( $_POST['type_vente'] ?? '' ) ) );
		if ( isset( Commission::SALE_TYPES[ $type ] ) ) {
			$order->update_meta_data( Costing::META_SALE_TYPE, $type );
		}
		$order->update_meta_data( Costing::META_SELLER, sanitize_text_field( wp_unslash( (string) ( $_POST['commercial'] ?? '' ) ) ) );
		$order->update_meta_data( Costing::META_DELIVERED, self::iso_date( sanitize_text_field( wp_unslash( (string) ( $_POST['livree_le'] ?? '' ) ) ) ) );
		// phpcs:enable
		$order->save();

		self::back( $order, 'enregistre' );
	}

	public static function handle_derogation(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'Vous n’avez pas le droit d’accorder une dérogation.', 'teeshoop' ), '', array( 'response' => 403 ) );
		}
		check_admin_referer( self::ACTION_DEROG );
		$order = self::order_from_request();
		if ( null === $order ) {
			wp_die( esc_html__( 'Commande introuvable.', 'teeshoop' ), '', array( 'response' => 404 ) );
		}

		// phpcs:disable WordPress.Security.NonceVerification.Missing -- checked above.
		$reason   = sanitize_text_field( wp_unslash( (string) ( $_POST['motif'] ?? '' ) ) );
		$approver = sanitize_text_field( wp_unslash( (string) ( $_POST['valideur'] ?? '' ) ) );
		$until    = self::iso_date( sanitize_text_field( wp_unslash( (string) ( $_POST['jusquau'] ?? '' ) ) ) );
		// phpcs:enable

		/*
		 * ALL FOUR OR NONE. The chapter asks for a motive, a validation, a
		 * validity period and a displayed impact; three of them is not an
		 * exception, it is a note. Refusing here rather than storing a partial
		 * one is what makes `Costing::derogation` able to say "there is none".
		 */
		if ( '' === $reason || '' === $approver || '' === $until ) {
			self::back( $order, 'derogation-incomplete' );
		}

		/*
		 * RECOMPUTED, never read from the form. The impact and the floor are what
		 * makes the authorisation specific: a derogation granted on a 42,00 EUR
		 * shortfall does not authorise a 400,00 EUR one, and a browser must not
		 * be able to say which it was.
		 */
		$report = Costing::compute( $order );

		$order->update_meta_data(
			Costing::META_DEROGATION,
			wp_json_encode(
				array(
					'reason'    => $reason,
					'approver'  => $approver,
					'until'     => $until,
					'on'        => Settings::today(),
					'price_ht'  => (int) $report['verdict']['price_ht'],
					'floor_ht'  => (int) $report['plan']['floor_ht'],
					'impact_ht' => max( 0, (int) $report['plan']['floor_ht'] - (int) $report['verdict']['price_ht'] ),
				)
			)
		);
		$order->save();

		$order->add_order_note(
			sprintf(
				/* translators: 1: approver, 2: the motive, 3: expiry date. */
				__( 'Vente sous le prix plancher autorisée par %1$s. Motif : %2$s. Valable jusqu’au %3$s.', 'teeshoop' ),
				$approver,
				$reason,
				$until
			)
		);

		Costing::refresh( $order );
		self::back( $order, 'derogation' );
	}
}
