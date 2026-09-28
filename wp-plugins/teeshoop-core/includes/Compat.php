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
		 * Every TTC figure on the product page comes from the regime in force;
		 * what a customer is actually charged comes from WooCommerce's own tax
		 * tables. Nothing reconciles them, and the mirror once shipped with
		 * taxes enabled and zero rows, so the studio said 326,10 EUR TTC and the
		 * cart said 271,75 EUR with no tax: 54,35 EUR apart, on a caption the
		 * invoice would contradict.
		 *
		 * The comparison itself lives in `Checkout::woo_tax_mismatch`, which is
		 * also what refuses the basket. This file used to hold a second copy of
		 * it, and a second copy of a money rule is how the notice and the gate
		 * end up disagreeing about whether the shop may sell.
		 */
		++$checked;
		$regime = Settings::vat();
		if ( ! $regime['known'] ) {
			$problems[] = __( 'Aucune période de TVA ne couvre la date du jour : la boutique ne peut pas dire si une vente porte de la TVA, et le panier refuse le paiement.', 'teeshoop' );
		} else {
			$vat = Checkout::woo_tax_mismatch( $regime );
			if ( '' !== $vat ) {
				$problems[] = $vat;
			}
		}

		/*
		 * The unit the shop weighs in, because the carriage grid is in grams and
		 * a shop manager types a number, not a unit. WooCommerce ships as `lbs`,
		 * which is what this mirror was still set to: a 180 g t-shirt entered as
		 * 0,18 became 82 g, four bracket steps down, and every parcel would have
		 * been under-quoted with the difference coming out of the margin.
		 */
		++$checked;
		$unit = get_option( 'woocommerce_weight_unit' );
		if ( 'kg' !== $unit && 'g' !== $unit ) {
			$problems[] = sprintf(
				/* translators: %s: the weight unit WooCommerce is configured with. */
				__( 'WooCommerce pèse en %s. La grille de livraison est en grammes et les poids fournisseurs sont en kilogrammes : réglez l’unité sur kg avant de vendre, sinon chaque colis part dans la mauvaise tranche.', 'teeshoop' ),
				(string) $unit
			);
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

		/*
		 * WooCommerce's own French, where it is missing or where it is wrong for
		 * a shop rather than for a catalogue.
		 *
		 * These are not translations we merely prefer: they are strings a French
		 * buyer meets in English on the buying path, measured by
		 * `npm run verify:a11y` (3.1.2, language of parts) in a document that
		 * declares `lang="fr-FR"` and carries no `lang="en"` anywhere.
		 */
		add_filter( 'gettext', array( self::class, 'translate' ), 20, 3 );
		/*
		 * AND THE SAME LIST AGAIN ON THE CONTENT, WHICH IS NOT A DUPLICATE.
		 *
		 * WooCommerce's installer BAKES the block cart's default markup into the
		 * page's `post_content` when it creates it, so the empty-cart heading is
		 * not a `gettext` call at render time: it is stored English in the
		 * database, and the filter above cannot see it. Measured with
		 * `wp post get 6 --field=post_content`.
		 *
		 * One map, two readers. The alternative was to rewrite the page's content
		 * in the database, which would put a translation somewhere no future
		 * reader would look for one, and would be undone by the next time
		 * WooCommerce touches that page.
		 */
		add_filter( 'the_content', array( self::class, 'translate_content' ), 5 );
		add_filter( 'woocommerce_breadcrumb_defaults', array( self::class, 'breadcrumb' ) );
		add_filter( 'woocommerce_product_add_to_cart_text', array( self::class, 'add_to_cart_text' ), 10, 2 );
		add_filter( 'woocommerce_product_add_to_cart_description', array( self::class, 'add_to_cart_description' ), 10, 2 );
		add_filter( 'woocommerce_catalog_orderby', array( self::class, 'orderby_labels' ) );

		/*
		 * Two filters and not one: WooCommerce queues this callback through
		 * `as_enqueue_async_action()` on a normal save and through
		 * `as_schedule_single_action()` when it is spreading the load.
		 */
		add_filter( 'pre_as_enqueue_async_action', array( self::class, 'refuse_dead_lookup' ), 10, 2 );
		add_filter( 'pre_as_schedule_single_action', array( self::class, 'refuse_dead_lookup_scheduled' ), 10, 3 );
	}

	/** Say it where the person who can fix it will read it. */
	/**
	 * The strings WooCommerce ships in English on this shop's own pages.
	 *
	 * A `gettext` filter and not a translation file, because a .po in the plugin
	 * would be a second place to look for a string and would be lost on the next
	 * `wp language plugin update`. Keyed on the ENGLISH source, so a WooCommerce
	 * release that changes the wording stops matching and the string reverts to
	 * English, which is visible, rather than to something that no longer means
	 * what the control does.
	 *
	 * @param string $translated what WordPress resolved.
	 * @param string $text       the original English.
	 * @param string $domain     which package asked.
	 */
	public static function translate( $translated, $text, $domain ) {
		if ( 'woocommerce' !== $domain ) {
			return $translated;
		}
		return self::english_strings()[ $text ] ?? $translated;
	}

	/**
	 * The English WooCommerce puts on this shop's own pages, and its French.
	 *
	 * @return array<string,string> the exact English source to the French
	 */
	private static function english_strings(): array {
		return array(
			// The block cart's empty state, measured in the served HTML of
			// /cart/. It also carried an exclamation mark, which this project
			// does not put in customer copy.
			'Your cart is currently empty!' => 'Votre panier est vide',
			'New in store'                  => 'Nouveautés',
			// Woo's own name for the sort control resolves to « Commande » in
			// French, which on a shop reads as a purchase order and sits three
			// inches from a « Panier » link. It is that select's accessible name.
			'Shop order'                    => 'Trier les articles',
		);
	}

	/**
	 * The same strings again, where they are stored content rather than a call.
	 *
	 * Scoped to the two pages WooCommerce generated, so nothing an editor wrote
	 * anywhere else is touched, and exact-match so a partial word cannot be
	 * rewritten inside another.
	 *
	 * @param string $content the page's own markup.
	 */
	public static function translate_content( $content ) {
		if ( ! is_string( $content ) || '' === $content ) {
			return $content;
		}
		if ( ! function_exists( 'is_cart' ) || ! ( is_cart() || is_checkout() ) ) {
			return $content;
		}
		foreach ( self::english_strings() as $english => $french ) {
			$content = str_replace( $english, $french, $content );
		}
		return $content;
	}

	/**
	 * The breadcrumb landmark's name, which was announced as « Breadcrumb ».
	 *
	 * @param array $defaults WooCommerce's own.
	 */
	public static function breadcrumb( $defaults ) {
		if ( is_array( $defaults ) ) {
			$defaults['wrap_before'] = str_replace(
				'aria-label="Breadcrumb"',
				'aria-label="' . esc_attr__( 'Fil d’Ariane', 'teeshoop' ) . '"',
				(string) ( $defaults['wrap_before'] ?? '' )
			);
		}
		return $defaults;
	}

	/**
	 * What a variable product's button says, so that its name contains it.
	 *
	 * WCAG 2.2's 2.5.3 asks that a control's accessible name contain its visible
	 * text, so that somebody driving the page by voice can operate what they can
	 * see. WooCommerce renders « Lire la suite » with
	 * `aria-label="Sélectionner les options pour “X”"`: twenty-four mismatches
	 * per listing page, and « clique sur Lire la suite » operates nothing.
	 *
	 * The VISIBLE text is changed rather than the label, because the label is the
	 * more informative of the two and because « Lire la suite » was telling a
	 * buyer they were about to read an article.
	 *
	 * @param string $text    WooCommerce's own.
	 * @param mixed  $product the product being rendered.
	 */
	public static function add_to_cart_text( $text, $product = null ) {
		if ( $product instanceof \WC_Product && $product->is_type( 'variable' ) ) {
			/*
			 * NOT « OPTIONS » ON A GARMENT THAT CANNOT BE BOUGHT. The catalogue is
			 * consultable without prices (question 41), so « Sélectionner les
			 * options » led to a page with no option that buys anything. What the
			 * button does there is show the garment.
			 */
			return self::sellable( $product )
				? __( 'Sélectionner les options', 'teeshoop' )
				: __( 'Voir le vêtement', 'teeshoop' );
		}
		return $text;
	}

	/**
	 * The button's accessible name, kept containing its visible text (WCAG 2.5.3).
	 *
	 * @param string $description WooCommerce's own.
	 * @param mixed  $product     the product being rendered.
	 */
	public static function add_to_cart_description( $description, $product = null ) {
		if ( $product instanceof \WC_Product && $product->is_type( 'variable' ) && ! self::sellable( $product ) ) {
			/* translators: %s: product name. */
			return sprintf( __( 'Voir le vêtement « %s »', 'teeshoop' ), wp_strip_all_tags( $product->get_name() ) );
		}
		return $description;
	}

	/** Whether any variation of this product can be put in a basket as it is. */
	private static function sellable( \WC_Product $product ): bool {
		return $product->is_purchasable() && '' !== (string) $product->get_price();
	}

	/**
	 * The sort control's options, in the words a buyer uses.
	 *
	 * `rating` is removed rather than renamed: this shop publishes no reviews, so
	 * sorting by a rating nobody has left orders the catalogue by nothing.
	 *
	 * @param array $options WooCommerce's own.
	 */
	public static function orderby_labels( $options ) {
		if ( ! is_array( $options ) ) {
			return $options;
		}
		$ours = array(
			'menu_order' => __( 'Tri par défaut', 'teeshoop' ),
			'popularity' => __( 'Les plus commandés', 'teeshoop' ),
			'date'       => __( 'Les plus récents', 'teeshoop' ),
			'price'      => __( 'Prix croissant', 'teeshoop' ),
			'price-desc' => __( 'Prix décroissant', 'teeshoop' ),
		);
		foreach ( $ours as $key => $label ) {
			if ( isset( $options[ $key ] ) ) {
				$options[ $key ] = $label;
			}
		}
		unset( $options['rating'] );
		return $options;
	}

	/**
	 * REFUSE TO QUEUE A JOB THAT FILLS A TABLE NOTHING READS.
	 *
	 * WHAT WAS MEASURED, on the mirror, 03/09/2026:
	 *
	 *     wp_actionscheduler_actions          96 259 en attente
	 *     dont ce seul crochet                96 241
	 *     wp_wc_product_attributes_lookup      0 ligne
	 *     woocommerce_attribute_lookup_enabled no
	 *     les deux tables d'Action Scheduler   70,9 Mo d'une base de 302,8
	 *
	 * Ninety-six thousand jobs queued to fill an empty table for a feature that
	 * is switched off. Purging them took four seconds and gave back 70,6 Mo.
	 *
	 * WHY THE SETTING DOES NOT STOP IT, which is the part worth writing down.
	 * `woocommerce_attribute_lookup_enabled` governs whether the FILTERING reads
	 * the table. The queuing is in `LookupDataStore::on_product_changed()`, whose
	 * only guard is `check_lookup_table_exists()`, and the table exists on every
	 * WooCommerce install because Woo creates it. So turning the feature off in
	 * the admin leaves the work being scheduled forever, invisibly, and it comes
	 * straight back: the queue was at 18 after the purge and at 1 828 twenty
	 * minutes into the next import.
	 *
	 * `on_product_changed` is not called through a hook (WC_Product::save() calls
	 * it on the container directly), so there is nothing to unhook. Action
	 * Scheduler's own `pre_as_*` filters are the supported way in, and they are
	 * where this sits.
	 *
	 * IT FAILS IN THE DIRECTION THAT KEEPS THE FEATURE WORKING. The moment
	 * somebody turns the setting on, this returns null and every job is queued
	 * again. A performance cache that is quietly never rebuilt would be a slow
	 * shop nobody can explain, which is a worse bug than the one being fixed.
	 *
	 * @param mixed  $pre  Null unless another filter already answered.
	 * @param string $hook The action being queued.
	 * @return mixed 0 to refuse, or whatever was passed in.
	 */
	public static function refuse_dead_lookup( $pre, $hook = '' ) {
		if ( null !== $pre ) {
			return $pre;
		}
		if ( 'woocommerce_run_product_attribute_lookup_update_callback' !== $hook ) {
			return $pre;
		}
		if ( 'yes' === get_option( 'woocommerce_attribute_lookup_enabled' ) ) {
			return $pre;
		}
		return 0;
	}

	/**
	 * The same refusal on the scheduled variant, where the hook is the third
	 * argument rather than the second.
	 *
	 * @param mixed  $pre       Null unless another filter already answered.
	 * @param int    $timestamp When it would have run.
	 * @param string $hook      The action being queued.
	 * @return mixed 0 to refuse, or whatever was passed in.
	 */
	public static function refuse_dead_lookup_scheduled( $pre, $timestamp = 0, $hook = '' ) {
		return self::refuse_dead_lookup( $pre, $hook );
	}

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
