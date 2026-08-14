<?php
/**
 * The WooCommerce surface this plugin is built on, pinned.
 *
 * WE OVERRIDE NO WOOCOMMERCE TEMPLATE, and that is a decision, not an omission.
 * Three things argued against it, all of them measured on WooCommerce 11.0.1:
 *
 *   The templates a product page most wants to change are the ones that move.
 *   `single-product.php` has been @version 1.6.4 for years and
 *   `content-single-product.php` 3.6.0, but `add-to-cart/simple.php` is 10.2.0,
 *   `add-to-cart/variable.php` 10.9.0 and `variation-add-to-cart-button.php`
 *   10.5.2, three changes in the last handful of releases. An override there
 *   is a standing maintenance bill for two people.
 *
 *   `content-single-product.php` is not even reachable by the filter every
 *   tutorial names. It is loaded through `wc_get_template_part()`, which never
 *   calls `wc_locate_template()`, so a plugin hooking `woocommerce_locate_template`
 *   watches its copy be ignored. And an override installed through the other
 *   filter is invisible to WooCommerce's own outdated-template report, so the
 *   one drift detector Woo ships would not cover it.
 *
 *   Production runs Woodmart, which ships its own copies. Whoever filters last
 *   wins, and a priority war with a paid theme over a wrapper `<div>` is not a
 *   fight worth entering. Our callbacks run inside whatever markup the theme
 *   produces, because the theme still has to fire `do_action(
 *   'woocommerce_single_product_summary' )` or every Woo extension breaks.
 *
 * So the coupling is to HOOK NAMES AND PRIORITIES instead, and that is what is
 * pinned below. It is a smaller surface and a much older one, but it is not
 * zero: `ProductPage` removes Woo's own add-to-cart callback and puts its own
 * in the same slot. If Woo renames or re-prioritises that callback, the removal
 * silently does nothing and a product page grows a second, wrong purchase
 * button.
 *
 * That particular failure cannot cost money, because `ProductPage::refuse_plain_add`
 * refuses any add-to-cart for a personalisable product that carries no design,
 * whatever the page rendered, but it is still a broken page, and a broken page
 * that nobody is told about stays broken.
 *
 * WHERE IT IS CHECKED: an admin notice (for the day it happens in production
 * and nobody is looking), `wp teeshoop check` (for a deploy script), and
 * `tests/integration.php` (for us). It cannot live in `tests/run.php`: that
 * suite runs with no WordPress at all, which is the point of it.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class Compat {

	/** The WooCommerce these pins were read from, for the message only. */
	public const PINNED_AGAINST = '11.0.1';

	/**
	 * Callback name to priority, per action, as WooCommerce registers them.
	 *
	 * Dumped from `$wp_filter` on a real WooCommerce 11.0.1 with a classic
	 * theme, not copied from documentation. Only the entries this plugin
	 * actually depends on are listed: pinning the whole table would fire on
	 * every unrelated Woo change and train everyone to ignore the notice.
	 */
	private const PINNED = array(
		// We insert our own blocks around these, and replace the last one.
		'woocommerce_single_product_summary'      => array(
			'woocommerce_template_single_title'       => 5,
			'woocommerce_template_single_price'       => 10,
			'woocommerce_template_single_excerpt'     => 20,
			// THE LOAD-BEARING ONE. ProductPage removes it for personalisable
			// products and renders the Personnaliser path in its place.
			'woocommerce_template_single_add_to_cart' => 30,
		),
		// The price grid is wide, so it hangs below the summary column rather
		// than inside it, before the tabs.
		'woocommerce_after_single_product_summary' => array(
			'woocommerce_output_product_data_tabs' => 10,
		),
	);

	/**
	 * Actions that must be FIRED by the product template, whether or not anyone
	 * has registered a callback on them.
	 *
	 * `has_action()` cannot answer this, and the first version of the check found
	 * that out the hard way: `woocommerce_after_single_product` carries no core
	 * callbacks at all on 11.0.1, so `has_action` returned false and the check
	 * reported the emptiest, healthiest hook on the page as broken.
	 *
	 * So the template that fires them is read instead, resolved exactly the way
	 * WooCommerce resolves it. Reading it for the `do_action` calls we depend on
	 * beats hashing it: a hash moves when a translator edits a comment, and a
	 * check that cries wolf is a check everyone learns to ignore.
	 */
	private const FIRED_BY_TEMPLATE = array(
		'woocommerce_before_single_product',
		'woocommerce_single_product_summary',
		'woocommerce_after_single_product_summary',
	);

	/**
	 * Every template this plugin renders. All of them are ours.
	 *
	 * Listed so the check can prove they are on disk: a deploy that dropped
	 * `templates/` would otherwise produce a product page missing its price
	 * grid, with a PHP warning in a log nobody reads.
	 */
	private const OUR_TEMPLATES = array(
		'teeshoop/product-cta.php',
		'teeshoop/product-specs.php',
		'teeshoop/product-price-grid.php',
		'teeshoop/product-quote.php',
	);

	/**
	 * Run every check.
	 *
	 * @return array{ok:bool,checked:int,problems:string[]}
	 */
	public static function check(): array {
		$problems = array();
		$checked  = 0;

		$template = self::single_product_template();
		$source   = '' !== $template && is_readable( $template )
			? (string) file_get_contents( $template ) // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- a local template, not a remote fetch.
			: '';

		++$checked;
		if ( '' === $source ) {
			// Fail closed: "we could not look" is not "nothing is wrong".
			$problems[] = __( 'Le gabarit de fiche produit de WooCommerce est introuvable ou illisible : impossible de vérifier que les emplacements utilisés existent encore.', 'teeshoop' );
		} else {
			foreach ( self::FIRED_BY_TEMPLATE as $tag ) {
				++$checked;
				if ( ! str_contains( $source, "do_action( '" . $tag . "'" ) ) {
					$problems[] = sprintf(
						/* translators: 1: a WordPress action name, 2: the template file that should fire it. */
						__( 'L’emplacement %1$s n’est plus déclenché par %2$s. La fiche produit s’afficherait incomplète.', 'teeshoop' ),
						$tag,
						str_replace( ABSPATH, '', $template )
					);
				}
			}
		}

		/*
		 * "WE COULD NOT LOOK" IS NOT "IT IS BROKEN", and getting that wrong made
		 * this notice red on every healthy admin screen.
		 *
		 * WooCommerce loads `wc-template-hooks.php` from `frontend_includes()`,
		 * which it calls only for a frontend request, a REST request, or the post
		 * editor. On the Dashboard, the Plugins screen or the Products list none
		 * of these callbacks is registered at all, so the first version reported
		 * four failures about a WooCommerce that was perfectly intact. A gate that
		 * cries wolf is a gate everybody learns to close without reading.
		 *
		 * So: if NONE of the pinned callbacks is present, the table simply is not
		 * built here and the hook section is skipped. If SOME are present and
		 * others are not, that is real drift and it is reported.
		 */
		$registered = 0;
		foreach ( self::PINNED as $tag => $callbacks ) {
			foreach ( array_keys( $callbacks ) as $callback ) {
				if ( false !== has_action( $tag, $callback ) ) {
					++$registered;
				}
			}
		}

		foreach ( $registered > 0 ? self::PINNED : array() as $tag => $callbacks ) {
			foreach ( $callbacks as $callback => $priority ) {
				++$checked;
				$found = has_action( $tag, $callback );
				if ( false === $found ) {
					$problems[] = sprintf(
						/* translators: 1: callback name, 2: action name. */
						__( '%1$s n’est plus branché sur %2$s.', 'teeshoop' ),
						$callback,
						$tag
					);
					continue;
				}
				if ( (int) $found !== (int) $priority ) {
					$problems[] = sprintf(
						/* translators: 1: callback name, 2: action name, 3: expected priority, 4: actual priority. */
						__( '%1$s est branché sur %2$s en priorité %4$d au lieu de %3$d.', 'teeshoop' ),
						$callback,
						$tag,
						(int) $priority,
						(int) $found
					);
				}
			}
		}

		foreach ( self::OUR_TEMPLATES as $relative ) {
			++$checked;
			if ( ! is_readable( TEESHOOP_CORE_DIR . 'templates/' . $relative ) ) {
				$problems[] = sprintf(
					/* translators: %s: a template file path. */
					__( 'Le gabarit %s est absent de l’extension.', 'teeshoop' ),
					$relative
				);
			}
		}

		/*
		 * THE ONE NUMBER TWO ENGINES BOTH OWN.
		 *
		 * Every TTC figure on the product page comes from
		 * `teeshoop_pricing.vat_rate`; what a customer is actually charged comes
		 * from WooCommerce's own tax tables. Nothing reconciles them, and the
		 * mirror once shipped with taxes enabled and zero rows, so the studio
		 * said 326,10 EUR TTC and the cart said 271,75 EUR with no tax: 54,35 EUR
		 * apart, on a caption the invoice would contradict.
		 */
		++$checked;
		$vat = self::vat_problem();
		if ( '' !== $vat ) {
			$problems[] = $vat;
		}

		++$checked;
		if ( ! Garments::has( 'tee' ) ) {
			$problems[] = sprintf(
				/* translators: %s: a file path. */
				__( '%s est absent ou illisible : aucune zone d’impression ni aucun guide des tailles ne peut être affiché.', 'teeshoop' ),
				'data/garments.json'
			);
		}

		/*
		 * A check that scanned nothing must never read as a pass.
		 *
		 * The same precaution as tests/run.php and scripts/bundle-guard.mjs: an
		 * empty pin table would report "all green" for ever, which is the most
		 * expensive kind of green there is.
		 */
		if ( 0 === $checked ) {
			$problems[] = __( 'Le contrôle de compatibilité n’a rien vérifié du tout.', 'teeshoop' );
		}

		return array(
			'ok'       => empty( $problems ),
			'checked'  => $checked,
			'problems' => $problems,
		);
	}

	/**
	 * Whether WooCommerce charges the VAT the product page prints, or ''.
	 *
	 * Compared against the store's own base country, which is the rate the page
	 * quotes to a visitor who has not told us where they are.
	 */
	private static function vat_problem(): string {
		if ( ! class_exists( '\WC_Tax' ) || ! function_exists( 'wc_get_base_location' ) ) {
			return '';
		}

		$ours = (float) Settings::pricing()['vat_rate'];

		if ( 'yes' !== get_option( 'woocommerce_calc_taxes' ) ) {
			return $ours > 0
				? __( 'Les taxes sont désactivées dans WooCommerce alors que la fiche produit annonce un montant TTC. Le client paierait le montant hors taxes.', 'teeshoop' )
				: '';
		}

		$base  = wc_get_base_location();
		$rates = \WC_Tax::find_rates(
			array(
				'country' => $base['country'] ?? '',
				'state'   => $base['state'] ?? '',
			)
		);

		$charged = 0.0;
		foreach ( $rates as $rate ) {
			$charged += (float) $rate['rate'];
		}
		$charged /= 100;

		// A hundredth of a point of tolerance, because the tax table stores a
		// string percentage and the config stores a float.
		if ( abs( $charged - $ours ) < 0.0001 ) {
			return '';
		}

		return sprintf(
			/* translators: 1: the VAT rate the page prints, 2: the rate WooCommerce charges. */
			__( 'La fiche produit annonce une TVA de %1$s et WooCommerce en facture %2$s. Les deux chiffres doivent être le même, sinon la page et la facture ne diront pas la même chose.', 'teeshoop' ),
			Money::number( $ours * 100, 2 ) . "\u{00A0}%",
			Money::number( $charged * 100, 2 ) . "\u{00A0}%"
		);
	}

	/**
	 * The file that actually renders a single product, resolved the way
	 * WooCommerce resolves it.
	 *
	 * `content-single-product.php` is loaded through `wc_get_template_part()`,
	 * which never calls `wc_locate_template()`: it asks the theme through
	 * WordPress's own `locate_template`, falls back to WooCommerce's copy, and
	 * then applies its own filter. Checking WooCommerce's file instead of the
	 * resolved one would pass happily while a theme rendered something else,
	 * which is the case that matters on production (Woodmart ships its own
	 * copies of most Woo templates).
	 */
	private static function single_product_template(): string {
		if ( ! function_exists( 'WC' ) ) {
			return '';
		}

		$template = locate_template(
			array(
				trailingslashit( WC()->template_path() ) . 'content-single-product.php',
				'content-single-product.php',
			)
		);

		if ( ! $template ) {
			$fallback = WC()->plugin_path() . '/templates/content-single-product.php';
			$template = file_exists( $fallback ) ? $fallback : '';
		}

		return (string) apply_filters( 'wc_get_template_part', $template, 'content', 'single-product' );
	}

	public static function init(): void {
		add_action( 'admin_notices', array( self::class, 'notice' ) );
	}

	/** Say it where the person who can fix it will read it. */
	public static function notice(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}
		$result = self::check();
		if ( $result['ok'] ) {
			return;
		}

		echo '<div class="notice notice-error"><p><strong>Teeshoop Core</strong> : ';
		printf(
			/* translators: 1: WooCommerce version the plugin was pinned against, 2: current WooCommerce version. */
			esc_html__( 'WooCommerce a changé sous l’extension. Les repères ont été relevés sur la version %1$s, le site tourne en %2$s.', 'teeshoop' ),
			esc_html( self::PINNED_AGAINST ),
			esc_html( defined( 'WC_VERSION' ) ? WC_VERSION : '?' )
		);
		echo '</p><ul style="list-style:disc;margin-left:1.5em">';
		foreach ( $result['problems'] as $problem ) {
			echo '<li>' . esc_html( $problem ) . '</li>';
		}
		echo '</ul><p>';
		esc_html_e( 'La fiche produit peut afficher des contrôles en double ou incomplets. Aucune commande ne peut être passée sans création : le panier refuse toujours une ligne personnalisable sans création.', 'teeshoop' );
		echo '</p></div>';
	}
}
