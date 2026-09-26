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
	 * A rate of 100 % or more has no meaning in any field on this page, and two
	 * of them together can make the floor price insoluble.
	 */
	private const MAX_RATE = 0.99;

	/**
	 * A percentage a human typed, back to a rate in [0, MAX_RATE].
	 *
	 * `Money::parse_eur` and not a cast, because it is the one parser in this
	 * plugin that accepts the comma a French admin types AND says when it could
	 * not read the field at all. "12,5" read by a cast is 12, a hundredfold
	 * error in a commission rate; "25 %" read leniently is 0,00, which took the
	 * floor price of the Bible's own 250,00 EUR example from 428,57 EUR to
	 * 250,00 EUR and turned an order that needed a derogation into one that read
	 * "vendable sans validation".
	 *
	 * And the result is CLAMPED. `Margin::floor_price_rate` refuses an insoluble
	 * combination by throwing, which is right for a formula and fatal for a
	 * screen: typing 100 into the target margin turned every order page into a
	 * blank 500. `save()` refuses the insoluble pair as well, with a sentence.
	 */
	private static function pct_in( mixed $raw, float $fallback ): float {
		$cents = Money::parse_eur( (string) $raw );
		if ( null === $cents ) {
			return $fallback;
		}
		// Two divisions by a hundred and not one by ten thousand, because they
		// are two different conversions: the parser returns hundredths of what
		// was typed, and a percentage is a hundredth of a rate.
		return max( 0.0, min( self::MAX_RATE, $cents / 100 / 100 ) );
	}

	/**
	 * Money a human typed, in cents, with a fallback for an empty or unreadable
	 * field.
	 *
	 * The fallback is what makes an accidental blank harmless: a silent 0 in the
	 * hourly rate would make the shop's own labour free on every order costed
	 * afterwards, with nothing on the screen looking wrong. An operator who
	 * really means zero types a zero, which parses.
	 */
	private static function money_in( mixed $raw, int $fallback ): int {
		return Money::parse_eur( (string) $raw ) ?? $fallback;
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

		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- checked above.
		wp_safe_redirect( add_query_arg( 'teeshoop', self::persist( wp_unslash( $_POST ) ), self::url() ) );
		exit;
	}

	/**
	 * Write what the form posted, and answer with the flag the screen shows.
	 *
	 * SPLIT FROM `save()` so it can be driven by a test. The mechanism that
	 * deleted `billing_step_cm` and 291,94 EUR of floor price was this function
	 * rewriting an option from a literal, and the test that was supposed to
	 * cover it called `update_option` directly and could never have caught it.
	 * A test that re-implements the thing it checks proves only that it agrees
	 * with itself.
	 *
	 * `$post` arrives ALREADY UNSLASHED, once, at the boundary.
	 */
	public static function persist( array $post ): string {
		$posted = isset( $post['couts'] ) && is_array( $post['couts'] ) ? $post['couts'] : array();

		/*
		 * THE FALLBACK IS WHAT IS IN FORCE, NOT WHAT SHIPPED.
		 *
		 * Every reader below falls back when a field cannot be read, and reading
		 * back the shipped default meant a single mistyped character silently
		 * undid a setting somebody had deliberately changed: typing nonsense into
		 * the minimum contribution took it from the 35 % in force to the 25 % of
		 * the release, and the floor price on every order costed afterwards from
		 * 600,00 EUR to 428,57 EUR. An unreadable field must change nothing.
		 */
		$defaults = Costing::config();

		$times = array();
		foreach ( array_keys( Cost::OPERATIONS ) as $op ) {
			$times[ $op ] = self::int_in( $posted['times'][ $op ] ?? '', (int) $defaults['times_s'][ $op ], 0, 3600 );
		}

		/*
		 * ── THE SHEET, AND THE THREE FIELDS THAT DID NOT EXIST ───────────────
		 *
		 * Question 04's answer of 1 September 2026 put the shop on a sheet, and
		 * this form went on owning the ROLL: eight fields, none of which the
		 * sheet branch of `Cost::film()` reads, and no field at all for the
		 * 3,00 EUR the shop actually pays. The supplier raising his price by
		 * fifty centimes was a code change. Found by the adversarial pass.
		 *
		 * `billing_step_cm` is written FROM the sheet height rather than typed,
		 * because the two are one fact: a sheet is bought whole, so the packer
		 * has to bill whole sheets, and `Cost::film()` refuses a config where
		 * they differ. Offering both as fields would be offering an operator the
		 * chance to make the cost engine refuse, which is not a choice anybody
		 * wants.
		 */
		$billing = 'roll' === ( $posted['film']['billing'] ?? '' ) ? 'roll' : 'sheet';
		$height  = self::float_in( $posted['film']['max_length_cm'] ?? '', (float) $defaults['film']['max_length_cm'], 10.0 );

		$film = array(
			'billing'       => $billing,
			'sheet_ht'      => self::money_in( $posted['film']['sheet_ht'] ?? '', (int) $defaults['film']['sheet_ht'] ),
			'min_sheets'    => self::int_in( $posted['film']['min_sheets'] ?? '', (int) $defaults['film']['min_sheets'], 1, 100 ),
			'rate_fr_ht'    => self::money_in( $posted['film']['rate_fr_ht'] ?? '', (int) $defaults['film']['rate_fr_ht'] ),
			'rate_es_ht'    => self::money_in( $posted['film']['rate_es_ht'] ?? '', (int) $defaults['film']['rate_es_ht'] ),
			'width_cm'      => self::float_in( $posted['film']['width_cm'] ?? '', (float) $defaults['film']['width_cm'], 1.0 ),
			'delivery_ht'   => self::money_in( $posted['film']['delivery_ht'] ?? '', (int) $defaults['film']['delivery_ht'] ),
			'min_m'         => self::float_in( $posted['film']['min_m'] ?? '', (float) $defaults['film']['min_m'] ),
			'waste_rate'    => self::pct_in( $posted['film']['waste_rate'] ?? '', (float) $defaults['film']['waste_rate'] ),
			'gap_cm'        => self::float_in( $posted['film']['gap_cm'] ?? '', (float) $defaults['film']['gap_cm'] ),
			'max_length_cm' => $height,
			// Derived, never typed, on a sheet. See the note above.
			'billing_step_cm' => 'sheet' === $billing
				? $height
				/*
				 * ON A ROLL, TYPED, AND NEVER THE OLD SHEET'S HEIGHT (COU-07). The
				 * form posted no such field and the fallback was the value in force,
				 * so switching from sheet to roll kept a 46 cm step: every file was
				 * rounded up to 46 or 92 cm instead of 10, up to 84 % more film.
				 * From a sheet, the fallback is the 10 cm a roll is billed by.
				 */
				: self::float_in(
					$posted['film']['billing_step_cm'] ?? '',
					'sheet' === (string) ( $defaults['film']['billing'] ?? 'sheet' ) ? 10.0 : (float) $defaults['film']['billing_step_cm'],
					0.1
				),
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
				'ht'        => $cents,
				'source'    => sanitize_text_field( (string) ( $row['source'] ?? '' ) ),
				'on'        => self::iso_date( (string) ( $row['on'] ?? '' ) ),
				// Whether the figure typed is a CATALOGUE price, which the
				// chapter says to divide by 2 to 2,5 and cost at the prudent
				// end until the real tariff arrives.
				'catalogue' => ! empty( $row['catalogue'] ),
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

		/*
		 * UNSLASHED, like `couts` above and unlike `commissions` below it, which
		 * is an inconsistency this fixes on the way past. WordPress addslashes
		 * every superglobal: stored raw, "Réassort d'un client" becomes
		 * "Réassort d\'un client" after one save and grows another backslash on
		 * every save after that, and a commercial or client selector containing
		 * an apostrophe stops matching anything at all.
		 */
		/*
		 * ONLY WHEN THE FORM CARRIED THEM. A post with no `regles` key is a form
		 * that does not own the rules, and writing an empty list for it would
		 * delete every floor rule in the shop, silently. That is the same defect
		 * as the eight-key film array that deleted `billing_step_cm` and 291,94
		 * EUR of floor, one level up: a writer must not touch what it was not
		 * given. The screen always posts the key, because it always renders at
		 * least the empty trailing block, so deleting the last rule still works.
		 */
		if ( isset( $post['regles'] ) && is_array( $post['regles'] ) ) {
			self::persist_rules( $post['regles'] );
		}

		$com_defaults = Costing::commission_config();
		$posted_commissions = isset( $post['commissions'] ) && is_array( $post['commissions'] ) ? $post['commissions'] : array();
		$rates              = array();
		foreach ( array_keys( Commission::SALE_TYPES ) as $type ) {
			$rates[ $type ] = self::pct_in(
				$posted_commissions['rates'][ $type ] ?? '',
				(float) $com_defaults['rates'][ $type ]
			);
		}

		update_option(
			OPTION_COMMISSION,
			array(
				'rates'                 => $rates,
				'attribution_days'      => self::int_in( $posted_commissions['attribution_days'] ?? '', (int) $com_defaults['attribution_days'], 0, 3650 ),
				'definitive_after_days' => self::int_in( $posted_commissions['definitive_after_days'] ?? '', (int) $com_defaults['definitive_after_days'], 0, 365 ),
			)
		);
		/*
		 * THE PAIR CAN BE IMPOSSIBLE EVEN WHEN EACH HALF IS FINE.
		 *
		 * Keeping k of the price after paying away c of the margin has no
		 * solution once k ≥ 1 − c: 25 % kept while 80 % is commissioned cannot
		 * be reached at any price. `Margin::floor_price_rate` refuses it by
		 * throwing, which is right, and left an admin with a blank 500 on every
		 * order screen. Both values are already stored at this point, so the
		 * operator sees exactly what they typed and can correct one of them; the
		 * notice names the two numbers that fight.
		 */
		$flag  = 'enregistre';
		$saved = Cost::merge_config( is_array( get_option( OPTION_COSTING, array() ) ) ? get_option( OPTION_COSTING, array() ) : array() );
		$worst = 0.0;
		foreach ( $rates as $rate ) {
			$worst = max( $worst, (float) $rate );
		}
		if ( (float) $saved['min_contribution_rate'] >= 1 - $worst ) {
			$flag = 'insoluble';
		}

		return $flag;
	}

	/** Read the posted rules, mint ids for the new ones, and store them. */
	private static function persist_rules( array $posted ): void {
		$rules = array();
		foreach ( $posted as $row ) {
			if ( ! is_array( $row ) || ! empty( $row['delete'] ) ) {
				continue;
			}
			$rule = PriceRule::normalise( $row );
			if ( null === $rule ) {
				continue;
			}
			/*
			 * A STABLE ID, minted once and never reused. A frozen report names
			 * the rule that priced it, and a rule identified by its row index
			 * would make every historical report point at a different policy the
			 * first time somebody deletes a row above it.
			 */
			if ( '' === $rule['id'] ) {
				$rule['id'] = 'r' . substr( str_replace( '-', '', wp_generate_uuid4() ), 0, 12 );
			}
			$rules[] = $rule;
		}
		update_option( OPTION_PRICE_RULES, array_slice( $rules, 0, PriceRule::MAX_RULES ) );
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
		$flag = isset( $_GET['teeshoop'] ) ? sanitize_key( wp_unslash( (string) $_GET['teeshoop'] ) ) : '';
		if ( 'enregistre' === $flag ) {
			echo '<div class="notice notice-success is-dismissible"><p>'
				. esc_html__( 'Réglages enregistrés.', 'teeshoop' ) . '</p></div>';
		}
		if ( 'insoluble' === $flag ) {
			echo '<div class="notice notice-error"><p><strong>'
				. esc_html__( 'Enregistré, mais ces deux réglages se contredisent', 'teeshoop' ) . '</strong><br>'
				. esc_html(
					sprintf(
						/* translators: 1: the minimum contribution rate, 2: the highest commission rate. */
						__( 'Vous demandez de garder %1$s du prix de vente après avoir versé jusqu’à %2$s de la marge. Aucun prix, si élevé soit-il, ne peut satisfaire les deux : aucune commande ne pourra être chiffrée tant que l’un des deux ne baisse pas.', 'teeshoop' ),
						self::pct_out( (float) $config['min_contribution_rate'] ) . "\u{00A0}%",
						self::pct_out( max( array_map( 'floatval', (array) $commission['rates'] ) ) ) . "\u{00A0}%"
					)
				)
				. '</p></div>';
		}

		self::render_intro( $config );
		self::render_simulator( $config, $commission );

		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
		echo '<input type="hidden" name="action" value="' . esc_attr( self::ACTION_SAVE ) . '">';
		wp_nonce_field( self::ACTION_SAVE );

		/*
		 * The salespeople who really appear on orders. A rule selects a
		 * commercial by an exact (case-insensitive) name, and both sides are
		 * typed by hand: "Karim B" against "Karim B." never matches, for ever,
		 * with nothing on screen to say so. Offering the names that exist is what
		 * makes the typo visible at the moment of writing.
		 */
		echo '<datalist id="ts-commerciaux">';
		foreach ( self::known_sellers() as $seller ) {
			printf( '<option value="%s"></option>', esc_attr( $seller ) );
		}
		echo '</datalist>';

		self::render_margins( $config );
		self::render_rules( Costing::rules_table(), $config, $commission );
		self::render_labour( $config );
		self::render_film( $config );
		self::render_other( $config );
		self::render_garments( $config );
		self::render_commissions( $commission );

		submit_button( __( 'Enregistrer', 'teeshoop' ) );
		echo '</form></div>';
	}

	/**
	 * The salespeople who actually appear on orders.
	 *
	 * Read from the orders rather than from a roster, because there is no roster:
	 * the seller is a free-text field on the order panel. HPOS keeps order meta
	 * in its own table, so both stores are asked and neither is assumed.
	 */
	private static function known_sellers(): array {
		global $wpdb;

		$names = array();
		foreach ( array( $wpdb->prefix . 'wc_orders_meta', $wpdb->postmeta ) as $table ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery -- no API reads distinct meta values.
			$found = $wpdb->get_col(
				$wpdb->prepare(
					// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name from $wpdb.
					"SELECT DISTINCT meta_value FROM {$table} WHERE meta_key = %s AND meta_value <> '' LIMIT 100",
					Costing::META_SELLER
				)
			);
			if ( is_array( $found ) ) {
				foreach ( $found as $name ) {
					$names[ (string) $name ] = true;
				}
			}
		}

		$out = array_keys( $names );
		sort( $out );
		return $out;
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
		echo '</p><p>';
		esc_html_e(
			'Le contrôle du plancher se fait commande par commande, sur l’écran de la commande, et pas sur la grille publique. Ce n’est pas un oubli : le métrage de film dépend des visuels réellement imprimés, et une colonne de grille n’a pas de visuel à mesurer. Une commande, elle, en a.',
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
			'Le coût proposé par défaut est celui de l’exemple chiffré du chapitre 1 de votre document : une commande de 30 t-shirts à 250,00 EUR de coût direct. Changez un taux plus bas, enregistrez, et revenez : le plancher aura bougé. Ce simulateur applique les réglages GÉNÉRAUX : il ne sait pas de quelle famille ni de quel client il s’agit, donc il ne peut pas savoir quelle règle de périmètre s’appliquerait. Le plancher que chaque règle produit est affiché sous elle, plus bas.',
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
		/*
		 * LA LÉGENDE NOMME LA JAMBE QUI TIENT, et pas toujours la même.
		 *
		 * Le plancher est le maximum de deux contraintes depuis le 5 septembre
		 * 2026 (`Margin::plan`), et dans la configuration livrée c'est la marge
		 * brute minimale qui l'emporte. Cette ligne expliquait le chiffre par la
		 * contribution quel que soit le cas : l'opérateur lisait un nombre sous
		 * une raison qui ne le produisait pas, et baisser la contribution ne le
		 * faisait pas bouger. `floor_basis` sait laquelle a gagné : elle est lue.
		 */
		$basis = (string) ( $plan['floor_basis'] ?? '' );
		self::row(
			__( 'Prix plancher', 'teeshoop' ),
			Money::format( (int) $plan['floor_ht'] ),
			'marge_brute' === $basis
				? sprintf(
					/* translators: %s: a percentage of the selling price. */
					__( 'Le prix le plus bas qui garde %s du prix de vente au-dessus des coûts directs. En dessous, il faut une dérogation.', 'teeshoop' ),
					self::pct_out( (float) ( $config['min_margin_rate'] ?? 0 ) ) . "\u{00A0}%"
				)
				: sprintf(
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

	/** @param string[] $unknown the cost components nobody could price. */
	private static function verdict_sentence( ?array $verdict, array $unknown = array() ): string {
		/*
		 * A GUARD ON THE HELPER, not the fix. What actually stopped a green
		 * "Vendable sans validation" appearing under a red warning is that
		 * `render_report` returns before it draws a verdict when there is no
		 * plan; both callers therefore hand this a real verdict today. It stays
		 * because the helper is reachable from anywhere and `(array) null` is an
		 * empty array in which every `! empty()` below is false, which is the
		 * shape the defect had.
		 */
		if ( null === $verdict || array() === $verdict ) {
			return __( 'Aucun plancher n’est calculable pour cette commande : voir l’avertissement ci-dessus.', 'teeshoop' );
		}
		if ( ! empty( $verdict['below_cost'] ) ) {
			return __( 'Sous le coût direct : cette vente perd de l’argent avant même la commission.', 'teeshoop' );
		}
		if ( ! empty( $verdict['below_floor'] ) ) {
			return __( 'Sous le plancher : une dérogation motivée, validée et datée est nécessaire.', 'teeshoop' );
		}
		if ( ! empty( $verdict['needs_approval'] ) ) {
			return __( 'Au-dessus du plancher, mais la remise dépasse ce qu’un commercial peut accorder seul.', 'teeshoop' );
		}
		/*
		 * NOT ON A FLOOR BUILT WITHOUT THE GARMENT OR THE FILM (COU-04). An unknown
		 * component counts for zero, so the floor under it is too low by exactly
		 * the part nobody priced: thirty sweats with no known purchase price read
		 * « vendable » at 400 EUR against a real floor above 860. `Cost.php`
		 * promises that an incomplete cost authorises nothing; this is where it
		 * was said anyway.
		 */
		if ( array() !== array_intersect( array( 'textile', 'marquage' ), $unknown ) ) {
			return __( 'Plancher à confirmer : le coût du textile ou du film n’est pas connu et compte pour zéro, donc ce plancher est trop bas. Chiffrez-le avant de vendre sous le prix conseillé.', 'teeshoop' );
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
		$sheet = 'sheet' === (string) ( $film['billing'] ?? 'roll' );
		self::section(
			__( 'Le film', 'teeshoop' ),
			$sheet
				? __( 'Question 04. Le fournisseur vend des feuilles entières : ce qui décide de la facture est le prix d’une feuille et ses deux dimensions, occupée ou non. Le nombre de feuilles n’est pas saisi, il est mesuré en imbriquant les visuels réels de la commande. Les tarifs au rouleau ci-dessous ne sont lus par rien tant que ce mode est actif.', 'teeshoop' )
				: __( 'Question 04. Le tarif et la laize vont ensemble : un tarif au mètre linéaire DE une laize donnée est un seul tarif, et changer l’un sans l’autre chiffre le film sur un rouleau qui n’est pas le vôtre. Le métrage n’est pas saisi : il est mesuré en imbriquant les visuels réels de la commande.', 'teeshoop' )
		);
		echo '<table class="form-table" role="presentation"><tbody>';
		self::select_row(
			__( 'Comment le fournisseur facture', 'teeshoop' ),
			'couts[film][billing]',
			(string) ( $film['billing'] ?? 'sheet' ),
			array(
				'sheet' => __( 'À la feuille entière', 'teeshoop' ),
				'roll'  => __( 'Au mètre linéaire de rouleau', 'teeshoop' ),
			)
		);
		self::input_row( __( 'Prix d’une feuille', 'teeshoop' ), 'couts[film][sheet_ht]', Money::number( Money::to_eur( (int) $film['sheet_ht'] ), 2 ), 'EUR' );
		self::input_row( __( 'Feuilles minimum facturées', 'teeshoop' ), 'couts[film][min_sheets]', (string) (int) $film['min_sheets'], '' );
		self::input_row( $sheet ? __( 'Largeur de la feuille', 'teeshoop' ) : __( 'Laize du rouleau', 'teeshoop' ), 'couts[film][width_cm]', Money::number( (float) $film['width_cm'], 1 ), 'cm' );
		self::input_row( $sheet ? __( 'Hauteur de la feuille', 'teeshoop' ) : __( 'Longueur maximale d’un fichier', 'teeshoop' ), 'couts[film][max_length_cm]', Money::number( (float) $film['max_length_cm'], 1 ), 'cm' );
		self::input_row( __( 'Livraison du film, par commande', 'teeshoop' ), 'couts[film][delivery_ht]', Money::number( Money::to_eur( (int) $film['delivery_ht'] ), 2 ), 'EUR' );
		self::input_row( __( 'Provision de perte', 'teeshoop' ), 'couts[film][waste_rate]', self::pct_out( (float) $film['waste_rate'] ), '%' );
		self::input_row( __( 'Écart entre deux motifs', 'teeshoop' ), 'couts[film][gap_cm]', Money::number( (float) $film['gap_cm'], 2 ), 'cm' );
		self::input_row( __( 'Tarif rouleau France, par mètre linéaire', 'teeshoop' ), 'couts[film][rate_fr_ht]', Money::number( Money::to_eur( (int) $film['rate_fr_ht'] ), 2 ), 'EUR' );
		self::input_row( __( 'Tarif rouleau Espagne, par mètre linéaire', 'teeshoop' ), 'couts[film][rate_es_ht]', Money::number( Money::to_eur( (int) $film['rate_es_ht'] ), 2 ), 'EUR' );
		self::input_row( __( 'Métrage minimum facturé, au rouleau', 'teeshoop' ), 'couts[film][min_m]', Money::number( (float) $film['min_m'], 2 ), 'm' );
		// Au rouleau seulement : à la feuille, le pas EST la hauteur (voir `persist`).
		if ( ! $sheet ) {
			self::input_row( __( 'Pas de facturation d’un fichier, au rouleau', 'teeshoop' ), 'couts[film][billing_step_cm]', Money::number( (float) $film['billing_step_cm'], 1 ), 'cm' );
		}
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
		echo '<th scope="col">' . esc_html__( 'Nature', 'teeshoop' ) . '</th>';
		echo '<th scope="col">' . esc_html__( 'D’où vient ce prix', 'teeshoop' ) . '</th>';
		echo '<th scope="col">' . esc_html__( 'Valable au', 'teeshoop' ) . '</th>';
		echo '</tr></thead><tbody>';

		foreach ( array_keys( $garments ) as $key ) {
			$row = is_array( $supply[ $key ] ?? null ) ? $supply[ $key ] : array();
			echo '<tr>';
			echo '<th scope="row"><code>' . esc_html( (string) $key ) . '</code></th>';
			echo '<td>' . self::field( 'couts[garment][' . $key . '][ht]', isset( $row['ht'] ) ? Money::number( Money::to_eur( (int) $row['ht'] ), 2 ) : '', 'EUR' ) . '</td>';
			printf(
				'<td><label><input type="checkbox" name="couts[garment][%1$s][catalogue]" value="1"%2$s> %3$s</label></td>',
				esc_attr( (string) $key ),
				checked( ! empty( $row['catalogue'] ), true, false ),
				esc_html__( 'prix catalogue', 'teeshoop' )
			);
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
		echo '<p class="description" style="max-width:46em">' . esc_html__(
			'Videz le prix pour retirer la ligne. Un prix d’achat vide vaut « inconnu », jamais « gratuit ». Cochez « prix catalogue » quand le seul chiffre dont vous disposez est un tarif public : le chapitre 1 demande alors de le diviser par 2 à 2,5 et de retenir le scénario PRUDENT, donc la division par 2, jusqu’à réception du vrai tarif. La commande est alors chiffrée au coût le plus élevé des deux, et le rapport affiche aussi le plus favorable.',
			'teeshoop'
		) . '</p>';
	}

	/**
	 * The scoped floors, one stacked block per rule.
	 *
	 * BLOCKS AND NOT A TABLE ROW, and that is a money decision rather than a
	 * taste one. A rule is fifteen controls; the two repeatable tables already on
	 * these screens are three and five columns and both need a sideways scroll on
	 * a phone. At 375 px a fifteen-column row shows about a sixth of itself, so
	 * pairing a contribution rate with the label it belongs to means scrolling,
	 * and that pairing is exactly what decides whether a floor is 428,57 EUR or
	 * 251,05 EUR.
	 *
	 * EVERY BLOCK PRINTS THE FLOOR IT PRODUCES, on the page's own worked example
	 * and at the highest commission rate on the books. That single line is what
	 * makes the whole screen safe to use: a contribution typed "0,25" instead of
	 * "25" is 0,25 %, it round-trips looking exactly like what was typed, and the
	 * only thing that shows it is the floor beside it collapsing to 251,05 EUR.
	 * It also shows an insoluble rule, a rule with no criteria, and a rule that
	 * has expired, without anybody having to reason about any of them.
	 */
	private static function render_rules( array $rules, array $config, array $commission ): void {
		$worst = 0.0;
		foreach ( (array) $commission['rates'] as $rate ) {
			$worst = max( $worst, (float) $rate );
		}

		self::section(
			__( 'Planchers par périmètre', 'teeshoop' ),
			__( 'Le chapitre 1 demande de pouvoir définir un plancher par famille de produits, par technique, par commercial, par taille de commande, par type de client et par niveau d’urgence. Une règle remplace la marge cible, la contribution minimale, ou les deux ; ce qu’elle laisse vide garde le réglage général. Un critère vide vaut « toutes les commandes ».', 'teeshoop' )
		);

		echo '<p class="description" style="max-width:46em">' . esc_html(
			sprintf(
				/* translators: 1: a direct cost, 2: the highest commission rate. */
				__( 'Le plancher affiché sous chaque règle est celui qu’elle produirait sur l’exemple de cette page (%1$s de coût direct) au taux de commission le plus élevé que vous versez (%2$s). C’est là que se voit une erreur de saisie : « 0,25 » au lieu de « 25 » se relit « 0,25 » et ne se remarque que sur ce chiffre.', 'teeshoop' ),
				Money::format( self::EXAMPLE_COST_HT ),
				self::pct_out( $worst ) . "\u{00A0}%"
			)
		) . '</p>';

		$impossible = PriceRule::impossible( $rules, $config, $worst );
		if ( array() !== $impossible ) {
			echo '<div class="notice notice-error"><p><strong>'
				. esc_html__( 'Ces règles n’ont aucune solution', 'teeshoop' ) . '</strong><br>'
				. esc_html(
					sprintf(
						/* translators: 1: a list of rule names, 2: the highest commission rate. */
						__( '%1$s : la contribution minimale demandée ne peut pas rester après une commission de %2$s, à aucun prix. Les commandes qu’elles touchent n’auront pas de prix plancher du tout tant que ce n’est pas corrigé.', 'teeshoop' ),
						implode( ', ', array_map( 'strval', $impossible ) ),
						self::pct_out( $worst ) . "\u{00A0}%"
					)
				) . '</p></div>';
		}

		// One empty block at the end, so adding a rule needs no button and no
		// JavaScript: the form grows by being filled in. Same shape as the VAT
		// periods on the Facturation screen.
		$blocks = array_merge( $rules, array( null ) );
		foreach ( $blocks as $i => $rule ) {
			self::render_rule_block( (int) $i, $rule, $config, $worst );
		}

		if ( count( $rules ) >= PriceRule::MAX_RULES ) {
			echo '<div class="notice notice-warning inline"><p>' . esc_html(
				sprintf(
					/* translators: %d: the maximum number of rules. */
					__( 'La liste est pleine (%d règles). Une règle supplémentaire ne serait pas enregistrée : supprimez-en une d’abord.', 'teeshoop' ),
					PriceRule::MAX_RULES
				)
			) . '</p></div>';
		}
	}

	private static function render_rule_block( int $i, ?array $rule, array $config, float $worst ): void {
		$name  = static fn( string $field ): string => sprintf( 'regles[%d][%s]', $i, $field );
		$value = static fn( string $field, mixed $fallback = '' ): mixed => $rule[ $field ] ?? $fallback;
		$new   = null === $rule;

		echo '<fieldset style="border:1px solid #c3c4c7;padding:.8em 1em;margin:0 0 1em;max-width:52em">';
		echo '<legend style="padding:0 .4em;font-weight:600">' . esc_html(
			$new ? __( 'Nouvelle règle', 'teeshoop' ) : ( '' !== (string) $value( 'label' ) ? (string) $value( 'label' ) : __( 'Règle sans nom', 'teeshoop' ) )
		) . '</legend>';

		printf( '<input type="hidden" name="%s" value="%s">', esc_attr( $name( 'id' ) ), esc_attr( (string) $value( 'id' ) ) );

		if ( ! $new ) {
			self::render_rule_state( $rule, $config, $worst );
		}

		echo '<p style="display:flex;flex-wrap:wrap;gap:.8em 1.2em;align-items:flex-end;margin:.6em 0 0">';

		printf(
			'<label style="flex:1 1 18em">%s<br><input type="text" name="%s" value="%s" maxlength="80" style="width:100%%" placeholder="%s"></label>',
			esc_html__( 'Nom de la règle', 'teeshoop' ),
			esc_attr( $name( 'label' ) ),
			esc_attr( (string) $value( 'label' ) ),
			esc_attr__( 'Sweats à partir de 50 pièces', 'teeshoop' )
		);

		self::render_rule_select( $name( 'famille' ), __( 'Famille', 'teeshoop' ), PriceRule::FAMILIES, (string) $value( 'famille' ) );
		self::render_rule_select( $name( 'technique' ), __( 'Technique', 'teeshoop' ), PriceRule::TECHNIQUES, (string) $value( 'technique' ) );
		self::render_rule_select( $name( 'client' ), __( 'Type de client', 'teeshoop' ), PriceRule::CLIENTS, (string) $value( 'client' ) );
		self::render_rule_select( $name( 'urgence' ), __( 'Urgence', 'teeshoop' ), PriceRule::URGENCES, (string) $value( 'urgence' ) );

		printf(
			'<label>%s<br><input type="text" name="%s" value="%s" size="16" list="ts-commerciaux"></label>',
			esc_html__( 'Commercial', 'teeshoop' ),
			esc_attr( $name( 'commercial' ) ),
			esc_attr( (string) $value( 'commercial' ) )
		);

		printf(
			'<label>%s<br><input type="number" min="0" name="%s" value="%s" size="5"></label>',
			esc_html__( 'Quantité min.', 'teeshoop' ),
			esc_attr( $name( 'qty_min' ) ),
			esc_attr( (int) $value( 'qty_min', 0 ) > 0 ? (string) (int) $value( 'qty_min' ) : '' )
		);
		printf(
			'<label>%s<br><input type="number" min="0" name="%s" value="%s" size="5"></label>',
			esc_html__( 'Quantité max.', 'teeshoop' ),
			esc_attr( $name( 'qty_max' ) ),
			esc_attr( (int) $value( 'qty_max', 0 ) > 0 ? (string) (int) $value( 'qty_max' ) : '' )
		);

		printf(
			'<label>%s<br><input type="text" name="%s" value="%s" size="7" inputmode="decimal" placeholder="%s"> %%</label>',
			esc_html__( 'Marge cible', 'teeshoop' ),
			esc_attr( $name( 'target_margin_rate' ) ),
			esc_attr( null === $value( 'target_margin_rate', null ) ? '' : self::pct_out( (float) $value( 'target_margin_rate' ) ) ),
			esc_attr( self::pct_out( (float) $config['target_margin_rate'] ) )
		);
		printf(
			'<label>%s<br><input type="text" name="%s" value="%s" size="7" inputmode="decimal" placeholder="%s"> %%</label>',
			esc_html__( 'Contribution min.', 'teeshoop' ),
			esc_attr( $name( 'min_contribution_rate' ) ),
			esc_attr( null === $value( 'min_contribution_rate', null ) ? '' : self::pct_out( (float) $value( 'min_contribution_rate' ) ) ),
			esc_attr( self::pct_out( (float) $config['min_contribution_rate'] ) )
		);

		printf(
			'<label>%s<br><input type="text" name="%s" value="%s" size="7" inputmode="decimal" placeholder="%s"> %%</label>',
			esc_html__( 'Marge brute min.', 'teeshoop' ),
			esc_attr( $name( 'min_margin_rate' ) ),
			esc_attr( null === $value( 'min_margin_rate', null ) ? '' : self::pct_out( (float) $value( 'min_margin_rate' ) ) ),
			esc_attr( self::pct_out( (float) ( $config['min_margin_rate'] ?? 0 ) ) )
		);

		printf(
			'<label>%s<br><input type="date" name="%s" value="%s"></label>',
			esc_html__( 'À partir du', 'teeshoop' ),
			esc_attr( $name( 'from' ) ),
			esc_attr( (string) $value( 'from' ) )
		);
		printf(
			'<label>%s<br><input type="date" name="%s" value="%s"></label>',
			esc_html__( 'Jusqu’au', 'teeshoop' ),
			esc_attr( $name( 'to' ) ),
			esc_attr( (string) $value( 'to' ) )
		);
		printf(
			'<label>%s<br><input type="number" min="0" max="999" name="%s" value="%s" size="4"></label>',
			esc_html__( 'Priorité (le plus grand gagne)', 'teeshoop' ),
			esc_attr( $name( 'priority' ) ),
			esc_attr( (string) (int) $value( 'priority', 0 ) )
		);

		printf(
			'<label><input type="checkbox" name="%s" value="1"%s> %s</label>',
			esc_attr( $name( 'active' ) ),
			checked( ! empty( $value( 'active' ) ) || $new, true, false ),
			esc_html__( 'Active', 'teeshoop' )
		);

		if ( ! $new ) {
			/*
			 * AN EXPLICIT DELETE, because a rule has no natural key to blank.
			 * The VAT table on the other screen is deleted by emptying its date,
			 * which is the gesture this associate has been taught; applied here
			 * it would clear a rule's selectors and leave its contribution rate,
			 * turning a narrow rule into a shop-wide floor cut. Measured on the
			 * shipped figures, that is 428,57 EUR down to 300,00 EUR on every
			 * order in the shop.
			 */
			printf(
				'<label style="color:#b32d2e"><input type="checkbox" name="%s" value="1"> %s</label>',
				esc_attr( $name( 'delete' ) ),
				esc_html__( 'Supprimer', 'teeshoop' )
			);
		}

		echo '</p></fieldset>';
	}

	/** Why this rule does or does not price anything today, and what it produces. */
	private static function render_rule_state( array $rule, array $config, float $worst ): void {
		$today = Settings::today();
		$notes = array();
		$tone  = 'description';

		if ( empty( $rule['active'] ) ) {
			$notes[] = __( 'inactive', 'teeshoop' );
		} elseif ( '' !== (string) $rule['from'] && $today < (string) $rule['from'] ) {
			$notes[] = sprintf( __( 'commence le %s', 'teeshoop' ), (string) $rule['from'] );
		} elseif ( '' !== (string) $rule['to'] && $today > (string) $rule['to'] ) {
			$notes[] = sprintf( __( 'expirée le %s', 'teeshoop' ), (string) $rule['to'] );
		} else {
			$notes[] = __( 'active aujourd’hui', 'teeshoop' );
		}

		if ( ! PriceRule::decides( $rule ) ) {
			/*
			 * A rule with both rate fields blank changes no number, so it is
			 * skipped entirely rather than allowed to outrank a rule that does.
			 * The block has to say so, because a grey placeholder showing the
			 * shop's own rate is exactly what invites leaving them empty.
			 */
			$notes[] = __( 'AUCUN TAUX : cette règle ne change rien et n’est jamais appliquée', 'teeshoop' );
			$tone    = 'notice notice-warning inline';
		}

		if ( 0 === PriceRule::specificity( $rule ) ) {
			$notes[] = __( 'AUCUN CRITÈRE : s’applique à toutes les commandes', 'teeshoop' );
			$tone    = 'notice notice-warning inline';
		} elseif ( 1 === PriceRule::specificity( $rule ) && '' !== (string) $rule['technique'] ) {
			/*
			 * The shop produces one technique, so naming it narrows nothing:
			 * the rule reaches every printed order while the screen showed it
			 * as a criterion and warned about nothing. Measured on the worked
			 * example, a "DTF" rule at 40 % contribution floors a blank resale
			 * at 750,00 EUR instead of 428,57 EUR.
			 */
			$notes[] = __( 'La technique est le seul critère, et l’atelier n’en produit qu’une : cette règle s’applique à toutes les commandes imprimées', 'teeshoop' );
			$tone    = 'notice notice-warning inline';
		}

		$k = null === $rule['min_contribution_rate']
			? (float) $config['min_contribution_rate']
			: (float) $rule['min_contribution_rate'];

		if ( PriceRule::insoluble( $k, $worst ) ) {
			$notes[] = __( 'AUCUNE SOLUTION à ce taux de commission : les commandes touchées n’auront pas de plancher', 'teeshoop' );
			$tone    = 'notice notice-error inline';
		} else {
			/*
			 * BOTH CALLS GUARDED, and the second one is the reason this comment
			 * exists. The rule's own rate was checked and the SHOP's was not, so
			 * a shop whose general contribution had become insoluble killed this
			 * page with an uncaught exception the moment any rule existed: the
			 * one screen that could have shown the operator what was wrong,
			 * fatal on exactly that state.
			 */
			/*
			 * LES DEUX JAMBES, PARCE QUE LE PLANCHER EST LEUR MAXIMUM.
			 *
			 * Cet aperçu ne calculait que la contribution. Depuis que la marge
			 * brute minimale de 50 % est appliquée, c'est elle qui tient le
			 * plancher à tous les taux de commission que la boutique pratique :
			 * l'écran promettait donc un mouvement qui n'aurait pas lieu. Mesuré
			 * sur l'exemple à 250,00 EUR de coût direct et 40 % de commission,
			 * une règle à 15 % de contribution annonçait 297,62 EUR quand le
			 * plancher réel restait à 500,00 EUR.
			 *
			 * Le calcul passe par `Margin::plan`, la même fonction que
			 * `Costing::compute`, pour qu'il n'existe pas deux façons de dire où
			 * est le plancher.
			 */
			$shop  = (float) $config['min_contribution_rate'];
			$floor = static function ( float $contribution, ?float $margin ) use ( $config, $worst ): int {
				$plan = Margin::plan(
					self::EXAMPLE_COST_HT,
					array(
						'commission_rate'       => $worst,
						'min_contribution_rate' => $contribution,
						'min_margin_rate'       => null === $margin ? (float) ( $config['min_margin_rate'] ?? 0 ) : $margin,
						'target_margin_rate'    => (float) ( $config['target_margin_rate'] ?? 0 ),
						'max_discount_rate'     => (float) ( $config['max_discount_rate'] ?? 0 ),
					)
				);
				return (int) $plan['floor_ht'];
			};
			$rule_margin = null === $rule['min_margin_rate'] ? null : (float) $rule['min_margin_rate'];
			$notes[]     = sprintf(
				/* translators: 1: a floor price, 2: the shop's floor without any rule. */
				__( 'plancher sur l’exemple : %1$s (sans règle : %2$s)', 'teeshoop' ),
				Money::format( $floor( $k, $rule_margin ) ),
				PriceRule::insoluble( $shop, $worst )
					? __( 'aucun, les réglages généraux n’ont pas de solution', 'teeshoop' )
					: Money::format( $floor( $shop, null ) )
			);
		}

		if ( 'description' === $tone ) {
			echo '<p class="description" style="margin:.2em 0 0">' . esc_html( implode( ' · ', $notes ) ) . '</p>';
		} else {
			echo '<div class="' . esc_attr( $tone ) . '" style="margin:.2em 0 0"><p>' . esc_html( implode( ' · ', $notes ) ) . '</p></div>';
		}
	}

	private static function render_rule_select( string $name, string $label, array $options, string $current ): void {
		printf( '<label>%s<br><select name="%s">', esc_html( $label ), esc_attr( $name ) );
		printf( '<option value=""%s>%s</option>', selected( '', $current, false ), esc_html__( 'toutes', 'teeshoop' ) );
		foreach ( $options as $key => $text ) {
			printf( '<option value="%s"%s>%s</option>', esc_attr( (string) $key ), selected( (string) $key, $current, false ), esc_html( (string) $text ) );
		}
		echo '</select></label>';
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

	/**
	 * A closed choice, in the same shape as `input_row`.
	 *
	 * There is exactly one of these and it is the film's billing mode, which is
	 * not a number: a supplier sells sheets or he sells metres, and typing a word
	 * would let an operator invent a third answer the cost engine does not have.
	 *
	 * @param array<string,string> $choices value => label.
	 */
	private static function select_row( string $label, string $name, string $value, array $choices ): void {
		$id = 'ts-' . md5( $name );
		printf(
			'<tr><th scope="row"><label for="%s">%s</label></th><td><select id="%s" name="%s">',
			esc_attr( $id ),
			esc_html( $label ),
			esc_attr( $id ),
			esc_attr( $name )
		);
		foreach ( $choices as $key => $text ) {
			printf(
				'<option value="%s"%s>%s</option>',
				esc_attr( (string) $key ),
				selected( (string) $key, $value, false ),
				esc_html( (string) $text )
			);
		}
		echo '</select></td></tr>';
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

		/*
		 * The handlers redirect back to THIS screen, so their refusals have to be
		 * rendered here. A `wp_safe_redirect` carrying a flag nobody prints is a
		 * form that silently did nothing.
		 */
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- a display-only flag.
		$flag = isset( $_GET['teeshoop'] ) ? sanitize_key( wp_unslash( (string) $_GET['teeshoop'] ) ) : '';
		$said = array(
			'derogation-sans-plancher' => __( 'Aucune dérogation n’a été enregistrée : cette commande n’a pas de prix plancher calculable, donc il n’y a aucun écart à autoriser. Corrigez les taux, recalculez, puis réessayez.', 'teeshoop' ),
			'derogation-incomplete'    => __( 'Aucune dérogation n’a été enregistrée : il faut un motif, un valideur ET une date de validité. Trois sur quatre n’est pas une exception, c’est une note.', 'teeshoop' ),
			'derogation-duree'         => sprintf(
				/* translators: %d: the longest a derogation may last, in days. */
				__( 'Aucune dérogation n’a été enregistrée : sa date de fin doit tomber entre aujourd’hui et dans %d jours. Au-delà, renouvelez-la à son échéance.', 'teeshoop' ),
				Costing::DEROGATION_DAYS
			),
		);
		if ( isset( $said[ $flag ] ) ) {
			echo '<div class="notice notice-error inline"><p>' . esc_html( $said[ $flag ] ) . '</p></div>';
		}

		self::render_order_facts( $order );

		if ( null === $report ) {
			echo '<p>' . esc_html__( 'Cette commande n’a jamais été chiffrée. Le calcul interroge le service d’imbrication pour mesurer le film réellement nécessaire, ce qui prend quelques secondes.', 'teeshoop' ) . '</p>';
			self::render_refresh_button( $order, __( 'Chiffrer cette commande', 'teeshoop' ) );
			return;
		}

		$stale = Costing::staleness( $order, $report );
		if ( '' !== $stale ) {
			/*
			 * A STALE REPORT IS WORSE THAN NO REPORT, because it is believed.
			 * Everything below describes the order as it was when somebody last
			 * asked, and the derogation section is gated on that verdict: an
			 * order edited into being under its floor would show a green panel
			 * and no exception form at all.
			 *
			 * THREE SENTENCES, because they send the reader to three different
			 * places. "The order changed" is on the order. "The rules changed" is
			 * on the Coûts et marges screen, and it fires on orders nobody
			 * touched, which is the case an order-only check could never catch.
			 */
			$why = array(
				'commande'  => __( 'Cette commande a changé depuis le dernier chiffrage', 'teeshoop' ),
				'reglages'  => __( 'Les règles de plancher ou les taux ont changé depuis ce chiffrage', 'teeshoop' ),
				'version'   => __( 'Ce chiffrage est antérieur aux règles de plancher', 'teeshoop' ),
			);
			echo '<div class="notice notice-warning inline"><p><strong>'
				. esc_html( $why[ $stale ] ?? $why['commande'] ) . '</strong><br>'
				. esc_html__( 'Les montants ci-dessous décrivent la commande telle qu’elle était. Recalculez avant de vous en servir, et avant d’accorder une dérogation.', 'teeshoop' )
				. '</p></div>';
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

		/*
		 * The two facts a price rule can select on that nothing else records.
		 * SELECTS and not free text, from the same constants the rule editor
		 * offers, so the two ends cannot drift: a rule reading "professionnel"
		 * against an order reading "Professionnel " would match nothing, for
		 * ever, with nothing on either screen to say so.
		 */
		echo '<label>' . esc_html__( 'Type de client', 'teeshoop' ) . '<br><select name="type_client">';
		printf( '<option value=""%s>%s</option>', selected( '', Costing::client_type( $order ), false ), esc_html__( 'non renseigné', 'teeshoop' ) );
		foreach ( PriceRule::CLIENTS as $key => $label ) {
			printf( '<option value="%s"%s>%s</option>', esc_attr( $key ), selected( $key, Costing::client_type( $order ), false ), esc_html( $label ) );
		}
		echo '</select></label>';

		echo '<label>' . esc_html__( 'Urgence', 'teeshoop' ) . '<br><select name="urgence">';
		printf( '<option value=""%s>%s</option>', selected( '', Costing::urgence( $order ), false ), esc_html__( 'non renseigné', 'teeshoop' ) );
		foreach ( PriceRule::URGENCES as $key => $label ) {
			printf( '<option value="%s"%s>%s</option>', esc_attr( $key ), selected( $key, Costing::urgence( $order ), false ), esc_html( $label ) );
		}
		echo '</select></label>';

		submit_button( __( 'Enregistrer', 'teeshoop' ), 'secondary', '', false );
		echo '</p>';
		echo '<p class="description">' . esc_html__( 'Le type de vente décide du taux de commission ; la date de livraison ouvre le délai de contestation au bout duquel elle devient définitive ; le type de client, l’urgence et le commercial peuvent faire jouer une règle de plancher. Aucun de ces champs n’apparaît jamais sur un document client. Enregistrer recalcule le chiffrage.', 'teeshoop' ) . '</p>';
		echo '</form>';
	}

	private static function render_report( \WC_Order $order, array $report ): void {
		$cost    = (array) $report['cost'];
		// NOT cast to array. `(array) null` is `array()`, which reads as a plan
		// whose every field is zero and whose every verdict is false.
		$plan    = is_array( $report['plan'] ?? null ) ? $report['plan'] : null;
		$verdict = is_array( $report['verdict'] ?? null ) ? $report['verdict'] : null;

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
		/*
		 * The optimistic total, when there is one to show. An estimate is a
		 * range and the shop is costed at its prudent end; printing only that
		 * end makes an assumption look like a measurement.
		 */
		echo '<td>' . esc_html(
			(int) $cost['best_ht'] < (int) $cost['total_ht']
				? sprintf(
					/* translators: %s: the same cost under the optimistic reading of its estimates. */
					__( 'au mieux %s', 'teeshoop' ),
					Money::format( (int) $cost['best_ht'] )
				)
				: ''
		) . '</td>';
		echo '<td class="description">' . esc_html(
			$cost['complete']
				? __( 'Les dix postes sont renseignés.', 'teeshoop' )
				: sprintf(
					/* translators: %d: how many cost components are missing. */
					__( 'Incomplet : %d poste(s) sans valeur. Le coût réel est plus élevé.', 'teeshoop' ),
					count( (array) $cost['unknown'] ) + count( (array) $cost['absent'] )
				)
		) . '</td></tr>';
		echo '</tbody></table></div>';

		if ( null === $plan ) {
			/*
			 * No floor, so nothing that looks like a verdict. The cost above is
			 * still worth reading and still true; what cannot be said is what the
			 * order should have sold for.
			 */
			echo '<div class="notice notice-error inline"><p><strong>'
				. esc_html__( 'Pas de prix plancher pour cette commande', 'teeshoop' ) . '</strong><br>'
				. esc_html__( 'Les taux en vigueur n’ont pas de solution : aucun prix, si élevé soit-il, ne laisserait la contribution minimale demandée après la commission. Corrigez la règle ou les réglages, puis recalculez.', 'teeshoop' )
				. '</p></div>';
			self::render_applied_rule( $report );
			return;
		}

		echo '<h4 style="margin-bottom:.4em">' . esc_html__( 'Ce qu’elle rapporte', 'teeshoop' ) . '</h4>';
		echo '<div style="overflow-x:auto;max-width:100%"><table class="widefat striped"><tbody>';

		self::row( __( 'Vendue HT', 'teeshoop' ), Money::format( (int) $report['revenue']['total_ht'] ), self::verdict_sentence( $verdict, (array) ( $cost['unknown'] ?? array() ) ) );
		self::row(
			__( 'Prix conseillé', 'teeshoop' ),
			Money::format( (int) $plan['recommended_ht'] ),
			__( 'Ce que cette commande aurait dû être vendue au taux de marge cible.', 'teeshoop' )
		);
		self::row(
			$cost['complete'] ? __( 'Prix plancher', 'teeshoop' ) : __( 'Prix plancher minimum', 'teeshoop' ),
			Money::format( (int) $plan['floor_ht'] ),
			( $cost['complete']
				? __( 'En dessous, une dérogation est nécessaire.', 'teeshoop' )
				: __( 'Calculé sur un coût incomplet : le vrai plancher est au moins celui-là.', 'teeshoop' ) )
				. ' ' . self::rule_sentence( $report )
		);
		/*
		 * NET OF WHAT WAS GIVEN BACK (COU-06). The warning above says the margin
		 * and the commission are computed on what remains, and these two lines
		 * showed the margin before the refund: « Ce qui reste » was over by the
		 * whole refunded HT. The figure before the refund stays, in the note.
		 */
		$refunded_ht = (int) ( $report['refunded_ht'] ?? 0 );
		$net_margin  = (int) $verdict['margin_ht'] - $refunded_ht;
		self::row(
			__( 'Marge contributive', 'teeshoop' ),
			Money::format( $net_margin ),
			$refunded_ht > 0
				? sprintf(
					/* translators: 1: the margin before the refund, 2: the refunded amount excl. VAT. */
					__( 'Après remboursement : %1$s avant, moins %2$s HT rendus. C’est la base de la commission, jamais le chiffre d’affaires.', 'teeshoop' ),
					Money::format( (int) $verdict['margin_ht'] ),
					Money::format( $refunded_ht )
				)
				: sprintf(
					/* translators: %s: the margin as a percentage of the selling price. */
					__( '%s du prix de vente. C’est la base de la commission, jamais le chiffre d’affaires.', 'teeshoop' ),
					Money::number( (float) $verdict['margin_rate'] * 100, 1 ) . "\u{00A0}%"
				)
		);
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
		self::row( __( 'Ce qui reste à Teeshoop', 'teeshoop' ), Money::format( $net_margin - (int) $report['commission']['full_ht'] ), __( 'Marge contributive moins la commission, avant frais fixes.', 'teeshoop' ) );

		echo '</tbody></table></div>';

		echo '<p class="description">' . esc_html(
			sprintf(
				/* translators: 1: a date, 2: what the floor was decided on. */
				__( 'Chiffrée le %1$s. Les montants sont figés à cette date : recalculez après avoir changé un tarif. Périmètre retenu : %2$s.', 'teeshoop' ),
				(string) $report['computed_on'],
				self::facts_sentence( $report )
			)
		) . '</p>';

		if ( ! empty( $verdict['below_floor'] ) && Costing::current( $order, $report ) ) {
			self::render_derogation( $order, $report );
		}
	}

	/**
	 * Which rule set this order's floor, in one sentence.
	 *
	 * THREE ANSWERS AND NOT TWO. A report computed before the rule table existed
	 * never consulted one, and saying "aucune règle" of it would be a claim the
	 * shop cannot make: an operator would read it as "the table was consulted and
	 * nothing matched", see a rule that plainly should match, and go looking for
	 * a bug in the matching. `Costing::VERSION` tells them apart.
	 */
	private static function rule_sentence( array $report ): string {
		if ( (int) ( $report['version'] ?? 1 ) < Costing::VERSION ) {
			return __( 'Chiffrée avant les règles de plancher : recalculez pour savoir laquelle s’applique.', 'teeshoop' );
		}
		$rule = is_array( $report['rule'] ?? null ) ? $report['rule'] : null;
		if ( null === $rule ) {
			return __( 'Réglages généraux : aucune règle de plancher ne s’applique à cette commande.', 'teeshoop' );
		}
		return sprintf(
			/* translators: 1: the rule's name, 2: what it set, in French. */
			__( 'Règle « %1$s » : %2$s.', 'teeshoop' ),
			'' !== (string) $rule['label'] ? (string) $rule['label'] : (string) $rule['id'],
			self::rule_sets( $rule )
		);
	}

	/** What a rule actually changed, at the rates it was frozen with. */
	private static function rule_sets( array $rule ): string {
		$parts = array();
		if ( null !== ( $rule['min_contribution_rate'] ?? null ) ) {
			$parts[] = sprintf(
				/* translators: %s: a percentage. */
				__( 'contribution minimale %s', 'teeshoop' ),
				self::pct_out( (float) $rule['min_contribution_rate'] ) . "\u{00A0}%"
			);
		}
		if ( null !== ( $rule['min_margin_rate'] ?? null ) ) {
			$parts[] = sprintf(
				/* translators: %s: a percentage. */
				__( 'marge brute minimale %s', 'teeshoop' ),
				self::pct_out( (float) $rule['min_margin_rate'] ) . "\u{00A0}%"
			);
		}
		if ( null !== ( $rule['target_margin_rate'] ?? null ) ) {
			$parts[] = sprintf(
				/* translators: %s: a percentage. */
				__( 'marge cible %s', 'teeshoop' ),
				self::pct_out( (float) $rule['target_margin_rate'] ) . "\u{00A0}%"
			);
		}
		return array() === $parts ? __( 'elle ne change aucun taux', 'teeshoop' ) : implode( ', ', $parts );
	}

	/**
	 * What this order looked like to the rule table, in French.
	 *
	 * The facts are frozen into the report and were shown to nobody, so a rule
	 * that did not apply looked like a matching bug rather than a family read as
	 * something else. This is the line that answers "why not": if it says the
	 * family is unknown, the operator knows the basket spans two of them.
	 */
	private static function facts_sentence( array $report ): string {
		$facts = is_array( $report['facts'] ?? null ) ? $report['facts'] : array();
		if ( array() === $facts ) {
			return __( 'inconnu (chiffrage antérieur aux règles)', 'teeshoop' );
		}

		$named = static function ( string $value, array $vocabulary ): string {
			if ( '' === $value ) {
				return __( 'non renseigné', 'teeshoop' );
			}
			return (string) ( $vocabulary[ $value ] ?? $value );
		};

		return sprintf(
			/* translators: 1: family, 2: technique, 3: salesperson, 4: client type, 5: urgency, 6: a quantity. */
			__( 'famille %1$s, technique %2$s, commercial %3$s, client %4$s, urgence %5$s, %6$s pièces', 'teeshoop' ),
			'' === (string) ( $facts['famille'] ?? '' ) ? __( 'indéterminée (plusieurs familles)', 'teeshoop' ) : $named( (string) $facts['famille'], PriceRule::FAMILIES ),
			$named( (string) ( $facts['technique'] ?? '' ), PriceRule::TECHNIQUES ),
			'' === (string) ( $facts['commercial'] ?? '' ) ? __( 'non renseigné', 'teeshoop' ) : (string) $facts['commercial'],
			$named( (string) ( $facts['client'] ?? '' ), PriceRule::CLIENTS ),
			$named( (string) ( $facts['urgence'] ?? '' ), PriceRule::URGENCES ),
			Money::number( (float) ( $facts['quantite'] ?? 0 ), 0 )
		);
	}

	/** The applied rule on its own, for the states that print no price table. */
	private static function render_applied_rule( array $report ): void {
		echo '<p class="description">' . esc_html( self::rule_sentence( $report ) ) . '</p>';
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
			'<label>%1$s<br><input type="date" name="jusquau" required min="%2$s" max="%3$s" value="%3$s"></label>',
			esc_html__( 'Valable jusqu’au', 'teeshoop' ),
			esc_attr( Settings::today() ),
			esc_attr( Costing::derogation_last_day( Settings::today() ) )
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

		$client = sanitize_key( wp_unslash( (string) ( $_POST['type_client'] ?? '' ) ) );
		$order->update_meta_data( Costing::META_CLIENT, isset( PriceRule::CLIENTS[ $client ] ) ? $client : '' );

		$urgence = sanitize_key( wp_unslash( (string) ( $_POST['urgence'] ?? '' ) ) );
		$order->update_meta_data( Costing::META_URGENCE, isset( PriceRule::URGENCES[ $urgence ] ) ? $urgence : '' );
		// phpcs:enable
		$order->save();

		/*
		 * RECOMPUTED, because all three of these are inputs to the report.
		 *
		 * The kind of sale decides the commission rate, the commission rate is
		 * in the floor price (see `Costing::rules`), and the delivery date opens
		 * the contestation delay. Saving them without recomputing left the panel
		 * showing the floor, the verdict and the commission of the PREVIOUS
		 * rate, on the same screen as the new one, which is the worst of the
		 * three possible states: an operator switching an order from "commande
		 * autonome" to "première commande" saw a floor computed at 0 % of
		 * commission and a commission of 40 %, and nothing said they disagreed.
		 */
		if ( null !== Costing::stored( $order ) ) {
			Costing::refresh( wc_get_order( $order->get_id() ) );
		}

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
		 * SEVEN DAYS AT MOST, AND NOT IN THE PAST (COU-08, question 30). The
		 * form pre-filled seven days and accepted any date typed over it: an
		 * exception dated 2099 was a permanent discount, and one dated
		 * yesterday was recorded, noted on the order as authorised, then shown
		 * as « ne couvre plus » on the next screen.
		 */
		if ( $until < Settings::today() || $until > Costing::derogation_last_day( Settings::today() ) ) {
			self::back( $order, 'derogation-duree' );
		}

		/*
		 * RECOMPUTED, never read from the form. The impact and the floor are what
		 * makes the authorisation specific: a derogation granted on a 42,00 EUR
		 * shortfall does not authorise a 400,00 EUR one, and a browser must not
		 * be able to say which it was.
		 */
		$report = Costing::compute( $order );

		/*
		 * AND THERE MUST BE A FLOOR TO DEROGATE FROM. With no plan, reading the
		 * report's floor and price yields zeroes, and the exception would have
		 * been filed stating a 0,00 EUR floor and a 0,00 EUR impact: a signed
		 * authorisation for a shortfall nobody measured, which is worse than
		 * none, because it looks like one.
		 */
		if ( ! is_array( $report['plan'] ?? null ) || ! is_array( $report['verdict'] ?? null ) ) {
			self::back( $order, 'derogation-sans-plancher' );
		}

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
