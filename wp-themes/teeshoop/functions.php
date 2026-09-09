<?php
/**
 * The Teeshoop theme: setup, assets, and the narrow bridge to the plugin.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY OUR OWN THEME, AND NOT A CHILD OF WOODMART OR A BLOCK THEME
 *
 * teeshoop.com runs Woodmart, a paid classic theme, on top of a furniture demo.
 * Three strategies were on the table and the reasoning is written here because
 * the next person to ask will ask in eighteen months.
 *
 *   A CHILD OF WOODMART keeps a licence we do not control in the critical path.
 *   Woodmart ships its own copies of most WooCommerce templates, which is
 *   already why `Teeshoop\Core\Compat` exists: the plugin refuses to override a
 *   Woo template partly because it would be a priority war with a paid theme.
 *   A child theme inherits that war and adds an update we cannot review to it.
 *
 *   A BLOCK THEME puts the page structure in the DATABASE. The site editor can
 *   change a template and the repository never knows; this project's whole
 *   discipline is that a rule has one home and a check fails when two copies
 *   disagree, and a template that lives in `wp_template` posts cannot be
 *   checked. It also costs us the studio: WooCommerce's block product template
 *   runs the description through `wp_kses_post`, `iframe` is not an allowed tag
 *   there, and the editor renders as an empty `div` (measured, session 01, and
 *   `scripts/wp-e2e-verify.mjs` still refuses to run on one).
 *
 *   OUR OWN CLASSIC THEME has no upstream, so no update can break it, which is
 *   the trap the session brief names. It is also the cheapest thing to serve on
 *   shared hosting, and that claim is MEASURED rather than asserted:
 *   `scripts/theme-bench.mjs` renders the same shop page under this theme and
 *   under Twenty Twenty-Five and prints both numbers.
 *
 * WHAT THIS THEME MAY NOT DO. It computes no price, ever. Every figure on every
 * page comes from `Teeshoop\Core\Pricing`, `::Production` or `::Garments`
 * through the accessors below. A theme that did its own arithmetic would be the
 * second price engine this project has spent eight sessions not building.
 *
 * IT OVERRIDES NO WOOCOMMERCE TEMPLATE EITHER, for the reasons in `Compat.php`
 * and one more: every template copied here is a file that stops receiving
 * upstream fixes. The layout is done with the hooks WooCommerce fires, plus
 * `woocommerce.php`, which is a THEME template and not a Woo one.
 *
 * @package Teeshoop\Theme
 */

declare( strict_types = 1 );

namespace Teeshoop\Theme;

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/inc/parts.php';
require_once __DIR__ . '/inc/filters.php';

/** Bumped when an asset changes, so a cached stylesheet is not served over a new one. */
const VERSION = '1.0.0';

/** The plugin class the whole site's numbers come from. */
const CORE = '\\Teeshoop\\Core\\Pricing';

/* ────────────────────────────────────────────────────────────────── setup ── */

/**
 * What the theme supports.
 *
 * `woocommerce` is what stops WooCommerce wrapping every shop page in its own
 * fallback markup. The three gallery flags are opt-ins: without them a product
 * photo is a flat image with no zoom and no lightbox, which on a garment a
 * buyer is choosing a colour from is a real loss.
 */
function setup(): void {
	load_theme_textdomain( 'teeshoop', get_template_directory() . '/languages' );

	add_theme_support( 'title-tag' );
	add_theme_support( 'post-thumbnails' );
	add_theme_support( 'automatic-feed-links' );
	add_theme_support( 'responsive-embeds' );
	add_theme_support(
		'html5',
		array( 'search-form', 'gallery', 'caption', 'style', 'script', 'navigation-widgets' )
	);

	/*
	 * THE LOGO IS A SLOT, NOT A DRAWING.
	 *
	 * Question 31 is unanswered: the associate has not sent a vector logo. A
	 * logo cannot be defaulted honestly, so the theme registers the slot and
	 * renders the site's NAME as a wordmark until a file is uploaded. Dropping
	 * the real asset in is then a Customizer upload and not a redesign, which
	 * is exactly what the session brief asks for.
	 */
	add_theme_support(
		'custom-logo',
		array(
			'height'      => 40,
			'width'       => 160,
			'flex-height' => true,
			'flex-width'  => true,
		)
	);

	add_theme_support( 'woocommerce' );

	/*
	 * THE SLIDER, AND NOT THE ZOOM OR THE LIGHTBOX.
	 *
	 * 4 241 per-colour photographs are NOT in the media library: they live on the
	 * Worker and `Shelf::variation_json()` injects the URL into WooCommerce's
	 * variation image object, deliberately, at no disk cost. It sends
	 * `full_src_w` and `full_src_h` as `false`, because nobody has ever measured
	 * them, and `wc_set_variation_attr()` REMOVES an attribute whose value is
	 * exactly `false`. So the moment a buyer picks a colour, the gallery image
	 * loses `data-large_image_width`, which is what both the zoom and the
	 * lightbox read to decide what to show. They would break on exactly the
	 * photograph the buyer just asked for, which is worse than not offering them:
	 * a control that works until it is used properly.
	 *
	 * They come back the day the import stores those two numbers beside the URL.
	 */
	add_theme_support( 'wc-product-gallery-slider' );

	register_nav_menus(
		array(
			'primaire' => __( 'Navigation principale', 'teeshoop' ),
			'pied'     => __( 'Pied de page', 'teeshoop' ),
		)
	);
}
add_action( 'after_setup_theme', __NAMESPACE__ . '\\setup' );

/**
 * THE LOGO LINK ALWAYS HAS A NAME, whoever uploaded the file.
 *
 * `the_custom_logo()` builds `<a class="custom-logo-link"><img alt="…"></a>` and
 * takes the alt from the attachment's alt-text field. That field is empty on a
 * file that arrived by sideload, and an anchor whose only child is an image with
 * an empty alt has NO accessible name at all: a screen reader announces « lien »
 * and the first control on every page of the shop is unlabelled. WCAG 2.2 4.1.2.
 *
 * Found by `scripts/site-shots.mjs` the night the logo was put in, on the very
 * commit that put it in: 316 assertions green, one red, `a.custom-logo-link`.
 *
 * `scripts/visuels-associe.php` sets the alt text when it sideloads, so the
 * common path is already right. This is the net under it, because the next logo
 * will be uploaded by a person through the Customizer, and nothing in that
 * screen asks for alt text.
 *
 * The name is the site's, not « logo » : what the link DOES is go home, and
 * « Teeshoop » is what a person would say.
 *
 * @param string $html The markup WordPress assembled.
 * @return string
 */
function logo_has_a_name( $html ): string {
	$html = (string) $html;
	if ( '' === $html || ! str_contains( $html, 'alt=""' ) ) {
		return $html;
	}
	return str_replace( 'alt=""', 'alt="' . esc_attr( get_bloginfo( 'name' ) ) . '"', $html );
}
add_filter( 'get_custom_logo', __NAMESPACE__ . '\\logo_has_a_name' );

/**
 * How many columns WooCommerce believes the grid has.
 *
 * The stylesheet decides the real number per breakpoint; this is what Woo writes
 * into the `columns-N` class, and that class is what its own width rules key off.
 */
function loop_columns(): int {
	return 3;
}
add_filter( 'loop_shop_columns', __NAMESPACE__ . '\\loop_columns', 20 );

/**
 * How many products a listing shows before it paginates.
 *
 * Twenty-four rather than WooCommerce's sixteen because the grid is three wide
 * at 1440 px and four at the widest, so both fill exactly. It is a filter and
 * not a setting because a shop manager changing it in the Customizer would break
 * the grid without being told why.
 */
function loop_per_page(): int {
	return 24;
}
add_filter( 'loop_shop_per_page', __NAMESPACE__ . '\\loop_per_page', 20 );

/* ───────────────────────────────────────────────────────────────── assets ── */

/**
 * Styles and the one script.
 *
 * THE TOKENS AND THE SHARED COMPONENTS COME FROM THE PLUGIN, enqueued by handle
 * rather than by a hard
 * `deps` entry on our own stylesheet. `WP_Dependencies` DROPS an item whose
 * dependency was never registered, so naming `teeshoop-tokens` as a dep would
 * mean that deactivating the plugin silently removes the entire site
 * stylesheet: a shop that looks broken for a reason nobody is told. Enqueued
 * separately, a missing plugin costs the palette and nothing else, and
 * `plugin_notice()` below says so to the person who can fix it.
 */
function assets(): void {
	$dir = get_template_directory_uri();

	/*
	 * Urbanist and Lato, self-hosted, two weights each.
	 *
	 * QUESTION 31 IS ANSWERED and these are the associate's faces, measured off
	 * what teeshoop.com serves: Urbanist is `--wd-entities-title-font` at 700
	 * and `--wd-header-el-font` at 600, Lato is `--wd-alternative-font`. This
	 * used to be Inter, which nobody had chosen. Latin subset only, because the
	 * shop sells in metropolitan France (question 35). 70 764 octets for the
	 * four, measured, and the two on the critical path are preloaded above.
	 *
	 * No rule in this theme may ask for a weight that is not one of the four:
	 * the browser would synthesise a counterfeit and nothing would say so.
	 * `scripts/theme-fonts-check.mjs` is what makes that a rule and not a hope.
	 */
	wp_enqueue_style( 'teeshoop-fonts', $dir . '/assets/fonts.css', array(), VERSION );

	if ( wp_style_is( 'teeshoop-components', 'registered' ) ) {
		// Pulls `teeshoop-tokens` in with it, in the right order.
		wp_enqueue_style( 'teeshoop-components' );
	}

	wp_enqueue_style( 'teeshoop-site', get_stylesheet_uri(), array( 'teeshoop-fonts' ), VERSION );

	/*
	 * LE NUANCIER DE LA PAGE D'ACCUEIL, DANS L'EN-TÊTE ET PAS DANS LE CORPS.
	 *
	 * Une règle par coloris, engendrée depuis le nuancier MESURÉ du produit
	 * (voir `demo_css()` pour la raison pour laquelle CSS ne peut pas s'en
	 * passer). Elle est posée ici, pendant `wp_enqueue_scripts`, parce que
	 * `wp_add_inline_style()` n'a plus d'effet une fois `wp_head` passé et que
	 * le gabarit s'exécute après : une balise `<style>` écrite au milieu du
	 * corps aurait marché dans tous les navigateurs et ne serait conforme dans
	 * aucun. `demo_source()` garde son résultat pour la requête, donc la
	 * palette est lue une fois et pas deux.
	 */
	if ( is_front_page() ) {
		$demo_css = demo_css();
		if ( '' !== $demo_css ) {
			wp_add_inline_style( 'teeshoop-site', $demo_css );
		}
	}

	/*
	 * One script, no framework, in the footer.
	 *
	 * It collapses the navigation into a drawer, collapses the filters on a
	 * phone, and closes both on Escape. EVERYTHING IT DOES IS AN ENHANCEMENT:
	 * without it the navigation is a visible list and the filters are a visible
	 * form with a submit button, so a page whose script is blocked is a page
	 * that still sells. The `has-js` class set inline in `header.php` is what
	 * lets the stylesheet collapse them with no flash of an open menu.
	 */
	wp_enqueue_script( 'teeshoop-site', $dir . '/assets/site.js', array(), VERSION, true );

	/*
	 * THE QUOTE PAGE RENDERS A PLUGIN TEMPLATE, SO IT NEEDS THE PLUGIN'S SHEET.
	 *
	 * `.ts-devis`, `.ts-form__field` and the 16 px inputs that stop iOS zooming
	 * on focus all live in `assets/product.css`, which `ProductPage::take_over()`
	 * only enqueues on a product page. Without this the identical form renders on
	 * `/devis/` with browser defaults: measured at 185 px wide inside a 580 px
	 * column, with the textarea in a monospace face. Copying those rules into the
	 * theme was the alternative, and it is the one that ends with two forms that
	 * stop matching.
	 */
	if ( is_page( 'devis' ) && defined( 'TEESHOOP_CORE_URL' ) && class_exists( CORE ) ) {
		wp_enqueue_style(
			'teeshoop-product',
			TEESHOOP_CORE_URL . 'assets/product.css',
			array( 'teeshoop-components' ),
			\Teeshoop\Core\VERSION
		);
	}
}
/*
 * PRIORITY 20, AND THAT IS WHAT MAKES OURS THE LAST STYLESHEET.
 *
 * WooCommerce's own stylesheets stay. Dropping `woocommerce-general` would mean
 * styling the cart, the checkout, the account area, the variation form and every
 * notice ourselves this session, with the checkout session 04 built as the thing
 * that breaks. They are kept and overridden deliberately, and WooCommerce
 * enqueues at the default priority, so ours has to be queued after it.
 */
add_action( 'wp_enqueue_scripts', __NAMESPACE__ . '\\assets', 20 );

/**
 * Take WordPress's emoji script off the front end.
 *
 * IT IS HERE FOR TWO REASONS AND EITHER WOULD BE ENOUGH.
 *
 * Article 82 of the loi Informatique et Libertés covers anything written to a
 * visitor's terminal, and `wp-emoji-release.min.js` writes
 * `sessionStorage['wpEmojiSettingsSupports']` on the first page load, before any
 * choice. Measured in Chromium on 26/08/2026: it was the only storage key on the
 * home page besides the trackers session 12 gated. It is a browser-capability
 * cache and a regulator would very probably read it as exempt, but the consent
 * banner two metres away says « Rien n'est enregistré sur votre appareil tant
 * que vous n'avez pas choisi », and a sentence that needs a footnote to stay
 * true is a sentence to stop needing.
 *
 * The settings blob it prints also names `https://s.w.org/images/core/emoji/…`
 * as its fallback host, so a browser that fell back would send this visitor's
 * IP address to wordpress.org from a page of a French shop, for a glyph.
 *
 * And the brief bans emoji outright in code, in the interface and in copy. A
 * shop that never prints one has nothing for this script to fix.
 */
function drop_emoji(): void {
	remove_action( 'wp_head', 'print_emoji_detection_script', 7 );
	remove_action( 'wp_print_styles', 'print_emoji_styles' );
	remove_action( 'admin_print_scripts', 'print_emoji_detection_script' );
	remove_action( 'admin_print_styles', 'print_emoji_styles' );
	remove_filter( 'the_content_feed', 'wp_staticize_emoji' );
	remove_filter( 'comment_text_rss', 'wp_staticize_emoji' );
	remove_filter( 'wp_mail', 'wp_staticize_emoji_for_email' );
	// The TinyMCE plugin list is filtered rather than removed: an editor that
	// loses the whole list loses every other plugin with it.
	add_filter(
		'tiny_mce_plugins',
		static fn( $plugins ): array => is_array( $plugins ) ? array_diff( $plugins, array( 'wpemoji' ) ) : array()
	);
	// The DNS hint survives the script removal and would otherwise still tell
	// the browser to resolve s.w.org.
	add_filter(
		'wp_resource_hints',
		static function ( $hints, $relation ) {
			if ( 'dns-prefetch' !== $relation || ! is_array( $hints ) ) {
				return $hints;
			}
			return array_values(
				array_filter(
					$hints,
					static fn( $h ): bool => ! is_string( $h ) || ! str_contains( $h, 's.w.org' )
				)
			);
		},
		10,
		2
	);
}
add_action( 'init', __NAMESPACE__ . '\\drop_emoji' );

/**
 * Preload the two faces the first paint needs; the browser cannot find them
 * inside a stylesheet in time.
 *
 * TWO AND NOT ONE, and not four. Lato 400 is every paragraph and Urbanist 700
 * is the heading above the fold on every page of this shop, so both are on the
 * critical path and both would otherwise swap in visibly. Urbanist 600
 * (navigation, labels) and Lato 700 (bold inside a paragraph) are not: they can
 * arrive with the stylesheet.
 *
 * THIS LIST IS CHECKED. It preloaded `inter-latin-400.woff2` for a day after
 * Inter was removed from the theme, which is a 404 fetched at high priority on
 * every page of the shop, in the one request the browser is told to hurry.
 * Nothing rendered differently and nothing logged. `scripts/theme-fonts-check.mjs`
 * now reads this array and fails when a name in it is not a file on disk.
 */
const PRELOAD = array( 'lato-latin-400.woff2', 'urbanist-latin-700.woff2' );

function preload_font(): void {
	foreach ( PRELOAD as $file ) {
		printf(
			'<link rel="preload" href="%s" as="font" type="font/woff2" crossorigin>' . "\n",
			esc_url( get_template_directory_uri() . '/assets/fonts/' . $file )
		);
	}
}
add_action( 'wp_head', __NAMESPACE__ . '\\preload_font', 1 );

/**
 * Say it where the person who can fix it will read it.
 *
 * Without the plugin there is no price authority, no add-to-cart bridge and no
 * design hand-off: the shop cannot sell. The theme still renders, because a
 * white screen tells nobody anything.
 */
function plugin_notice(): void {
	if ( ! current_user_can( 'manage_options' ) || class_exists( CORE ) ) {
		return;
	}
	echo '<div class="notice notice-error"><p><strong>Thème Teeshoop</strong> : ';
	esc_html_e(
		'l’extension Teeshoop Core n’est pas active. Le thème s’affiche sans sa palette, et la boutique ne peut ni calculer un prix ni accepter une personnalisation.',
		'teeshoop'
	);
	echo '</p></div>';
}
add_action( 'admin_notices', __NAMESPACE__ . '\\plugin_notice' );

/* ─────────────────────────────────────────── the numbers, from the plugin ── */

/**
 * The price config, or an empty array when the plugin is not there.
 *
 * Every accessor below goes through this one, so a page with no plugin renders
 * its empty state instead of fataling on an unknown class.
 *
 * @return array<string,mixed>
 */
function pricing_config(): array {
	static $config = null;
	if ( null !== $config ) {
		return $config;
	}
	$config = class_exists( '\\Teeshoop\\Core\\Settings' ) ? \Teeshoop\Core\Settings::pricing() : array();
	return $config;
}

/**
 * The cheapest unit price for a garment, and the quantity that reaches it.
 *
 * `Pricing::headline()` reads BOTH its anchors out of the grid printed on the
 * product page, so the figure on the homepage is the figure a buyer will meet.
 *
 * @return array<string,mixed> Empty when the plugin or the garment is absent.
 */
function headline( string $garment ): array {
	if ( ! class_exists( CORE ) ) {
		return array();
	}
	$config = pricing_config();
	if ( ! isset( $config['garments'][ $garment ] ) ) {
		return array();
	}
	return \Teeshoop\Core\Pricing::headline( $garment, $config );
}

/**
 * The shop's minimum order: pieces and euros, as the cart enforces them.
 *
 * Read from the config rather than written here, because `Cart` refuses a
 * basket below them and a homepage that promised a different number would be
 * a promise the checkout breaks.
 *
 * NULL WHEN THERE IS NO CONFIG, NOT ZERO. With the plugin deactivated this
 * returned 0, and `eur( 0 )` returned the empty string, so every page of the
 * site advertised « Commande minimum : 0 pièces et  de commande » in the footer,
 * the homepage offered « à partir de 0 pièces », and all of it answered 200 with
 * nothing a visitor could see. A missing number is an omitted line.
 *
 * AND `has_ht`, WHICH IS THE SAME BUG THROUGH THE OTHER DOOR. Question 01's
 * answer of 1 September 2026 removed the 50,00 EUR HT floor and kept the five
 * pieces, so `min_ht` is now legitimately 0 and every one of the four templates
 * that printed it published « Commande minimum : 5 pièces et 0,00 € », in the
 * footer of every page of the site. A configured zero is not a small minimum,
 * it is the absence of one, and the sentence has to lose its second half rather
 * than fill it with nothing. Decided here once so the four callers cannot
 * disagree about it.
 *
 * @return array{qty:int,ht_cents:int,has_ht:bool}|null
 */
function minimum(): ?array {
	$config = pricing_config();
	if ( ! isset( $config['min_qty'], $config['min_ht'] ) ) {
		return null;
	}
	return array(
		'qty'      => (int) $config['min_qty'],
		'ht_cents' => (int) $config['min_ht'],
		'has_ht'   => (int) $config['min_ht'] > 0,
	);
}

/**
 * Working days from an approved proof to a parcel, per urgency.
 *
 * These are question 14's written defaults and the workshop's calendar already
 * says two of them cannot be held (session 07 measured six working days of
 * incompressible work inside a four-day urgent promise). So the site publishes
 * the STANDARD one only, and sends the other two to a human. Publishing a
 * delay we have measured ourselves as unachievable would be a commercial
 * practice the DGCCRF has a word for.
 *
 * @return array<string,int>
 */
function lead_days(): array {
	if ( ! class_exists( '\\Teeshoop\\Core\\Production' ) ) {
		return array();
	}
	$config = \Teeshoop\Core\Production::config();
	$days   = $config['lead_days'] ?? array();
	return is_array( $days ) ? $days : array();
}

/**
 * The products a visitor can actually design and buy today.
 *
 * A "personalisable" product is one that declares a studio garment
 * (`Product::META`). The catalogue's 459 imported references are NOT in this
 * list: they carry no margin rate, so they carry no price, so they are
 * consultable and not orderable (questions 41 and 42). Saying otherwise on a
 * homepage would send a buyer to a product page with no button.
 *
 * @return \WC_Product[]
 */
function personalisable_products( int $limit = 12 ): array {
	/*
	 * GARDÉ POUR LA REQUÊTE, PAR LIMITE.
	 *
	 * La page d'accueil pose la même question deux fois : une fois pendant
	 * `wp_enqueue_scripts`, pour engendrer le nuancier de la démonstration, et
	 * une fois dans le gabarit. Sans ce cache c'est deux `get_posts` avec une
	 * `meta_query` et une `tax_query`, plus un `wc_get_product` par ligne, pour
	 * une réponse identique dans la même requête HTTP.
	 */
	static $cache = array();
	if ( isset( $cache[ $limit ] ) ) {
		return $cache[ $limit ];
	}

	if ( ! function_exists( 'wc_get_products' ) || ! class_exists( '\\Teeshoop\\Core\\Product' ) ) {
		return array();
	}

	$args = array(
		'post_type'      => 'product',
		'post_status'    => 'publish',
		'posts_per_page' => $limit,
		'fields'         => 'ids',
		'orderby'        => 'menu_order title',
		'order'          => 'ASC',
		// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- a dozen rows, once per page, and there is no taxonomy for it.
		'meta_query'     => array(
			array(
				'key'     => \Teeshoop\Core\Product::META,
				'compare' => 'EXISTS',
			),
		),
	);

	/*
	 * HIDDEN FROM THE CATALOGUE MEANS HIDDEN HERE TOO.
	 *
	 * `[0]` of this list decides the homepage's published price, the garment its
	 * print zone is drawn for, and the whole tariff table on the entreprises
	 * page. Without this clause it was whatever sorted first INCLUDING products
	 * a manager had deliberately taken out of the catalogue: on this mirror the
	 * first three were test fixtures marked `exclude-from-catalog`, so the shop
	 * published a fixture's price list as its own while the listing correctly
	 * refused to show it.
	 */
	if ( function_exists( 'wc_get_product_visibility_term_ids' ) ) {
		$visibility = wc_get_product_visibility_term_ids();
		// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query -- one clause on an indexed taxonomy.
		$args['tax_query'] = array(
			array(
				'taxonomy' => 'product_visibility',
				'field'    => 'term_taxonomy_id',
				'terms'    => array_values( array_filter( array( $visibility['exclude-from-catalog'] ) ) ),
				'operator' => 'NOT IN',
			),
		);
	}

	$ids = get_posts( $args );

	$products = array();
	foreach ( $ids as $id ) {
		$product = wc_get_product( (int) $id );
		/*
		 * AND IT MUST HAVE A PHOTOGRAPH, which is a rule about the offer and not
		 * about tidiness.
		 *
		 * This list is « choisissez le vêtement que vous allez dessiner ». A
		 * buyer picks a garment by looking at it: nobody chooses the blank they
		 * are about to put their company's logo on, in quantity, from a name.
		 * An entry with no picture is not a weaker offer, it is not an offer.
		 *
		 * It is also what keeps the harness fixtures out of the homepage, the
		 * same way the `exclude-from-catalog` clause above does, and for a
		 * reason that survives them: measured 03/09/2026, the nine products
		 * carrying a garment on this mirror were all test fixtures (« Probe
		 * fixture 3 », « Tee de vérification »), none had a photograph, and the
		 * homepage drew a grey « Sans photo » tile as the shop's flagship.
		 *
		 * The section's empty state already says what to do about it, in words:
		 * a garment becomes personalisable when a product declares which studio
		 * model it is printed on. It now also has to be one somebody can see.
		 */
		if ( $product instanceof \WC_Product && (int) $product->get_image_id() > 0 ) {
			$products[] = $product;
		}
	}

	$cache[ $limit ] = $products;
	return $products;
}

/**
 * Le lien qui ouvre l'éditeur sur un produit : la fiche produit elle-même.
 *
 * IL Y AVAIT UN DRAPEAU DANS L'ADRESSE, `?personnaliser=1`, qui échangeait la
 * page de vente contre une seconde page portant le studio encadré. L'éditeur
 * est maintenant DANS la fiche, dans la fente d'ajout au panier : il n'y a plus
 * de seconde page, donc plus de drapeau, et cette fonction reste parce que la
 * page d'accueil et les listes appellent toujours « le lien qui mène à
 * l'éditeur » sans avoir à savoir que c'est devenu le permalien.
 */
function studio_url( int $product_id ): string {
	/*
	 * DEPUIS LE 9 SEPTEMBRE 2026 IL Y A DE NOUVEAU UNE PAGE, ET C'EST VOULU.
	 *
	 * Le parcours va maintenant : fiche produit, bouton « Personnaliser »,
	 * puis `/personnaliser/{slug}/`, où le client dessine, valide, puis choisit
	 * ses quantités par coloris et par taille. `Atelier::url()` est le seul
	 * endroit qui sait fabriquer cette adresse (elle retombe sur un paramètre
	 * quand les permaliens sont en clair), donc on la lui demande au lieu de
	 * l'écrire une seconde fois ici.
	 *
	 * ON N'Y ENVOIE PERSONNE SI L'ATELIER NE SAIT PAS SERVIR CE PRODUIT.
	 * `etat()` répond « sans-vetement », « indisponible » ou « sans-paquet »
	 * quand la page ne peut pas s'ouvrir, et un bouton « Personnaliser » qui
	 * mène à un atelier vide est pire que pas de bouton : la fiche produit, elle,
	 * sait toujours quoi dire. Voir `Atelier::etat()`.
	 */
	if ( class_exists( '\\Teeshoop\\Core\\Atelier' ) && 'pret' === \Teeshoop\Core\Atelier::etat( $product_id ) ) {
		$atelier = \Teeshoop\Core\Atelier::url( $product_id );
		if ( '' !== $atelier ) {
			return $atelier;
		}
	}
	return (string) get_permalink( $product_id );
}

/**
 * The seller's legal identity, or an empty array.
 *
 * EMPTY IS THE SHIPPED DEFAULT and the footer renders the empty state rather
 * than a plausible address. Question 17 is unanswered; an invented SIRET on a
 * French commercial site is not a placeholder, it is a false statement.
 *
 * @return array<string,string>
 */
function legal_identity(): array {
	if ( ! class_exists( '\\Teeshoop\\Core\\Legal' ) ) {
		return array();
	}
	$identity = \Teeshoop\Core\Legal::identity();
	return is_array( $identity ) ? array_filter( $identity, static fn( $v ) => '' !== trim( (string) $v ) ) : array();
}

/**
 * A price, written the way this shop writes one.
 *
 * `Money::format` and nothing else. Not `wc_price`, which uses the STORE
 * currency rather than the price engine's, and not `number_format_i18n`, which
 * takes its separators from the WordPress locale: a stock WordPress is en_US,
 * so a four-figure number comes out with a comma where a French reader expects
 * a decimal point, and an area threshold on the product page therefore read as
 * a hundredth of itself. That defect shipped in August and is written up in
 * `Money::number`. There is one way of writing a number on this shop and it
 * lives there.
 */
function eur( int $cents ): string {
	if ( ! class_exists( '\\Teeshoop\\Core\\Money' ) ) {
		return '';
	}
	return \Teeshoop\Core\Money::format( $cents );
}

/** A plain number (a quantity, a count), with the shop's separators. */
function num( float $value, int $decimals = 0 ): string {
	if ( ! class_exists( '\\Teeshoop\\Core\\Money' ) ) {
		return (string) $value;
	}
	return \Teeshoop\Core\Money::number( $value, $decimals );
}

/**
 * Whether this shop prints one price or two, and which one leads.
 *
 * NEVER WRITE "HT" OR "TTC" INTO A TEMPLATE. Under the VAT franchise there is a
 * single number, and printing "14,50 EUR HT (14,50 EUR TTC)" states the same
 * amount twice; under an unrecorded regime the page must say nothing about tax
 * at all, because "we have not been told" is not "there is no tax". That
 * decision is made once, in `Settings::price_bases()`, and every page on this
 * site asks it rather than assuming.
 *
 * @return array{known:bool,two:bool,lead:string,mention:string}
 */
function price_bases(): array {
	if ( ! class_exists( '\\Teeshoop\\Core\\Settings' ) ) {
		return array(
			'known'   => false,
			'two'     => false,
			'lead'    => 'ht',
			'mention' => '',
		);
	}
	return \Teeshoop\Core\Settings::price_bases();
}

/**
 * An amount with its tax basis, exactly as the product page writes it.
 *
 * `Settings::price_pair()` is the one home for that decision AND for the way it
 * is written, so a figure on the homepage cannot say "HT" on a shop under the
 * franchise while the product page says nothing.
 *
 * @return array{lead:string,second:string}
 */
function price_pair( int $ht_cents, int $ttc_cents ): array {
	if ( ! class_exists( '\\Teeshoop\\Core\\Settings' ) ) {
		return array(
			'lead'   => '',
			'second' => '',
		);
	}
	return \Teeshoop\Core\Settings::price_pair( $ht_cents, $ttc_cents );
}

/**
 * The area every published headline price is actually for.
 *
 * `Pricing::headline()` prices each side at the CHEAPEST area tier, so
 * "impression comprise" holds up to that tier's ceiling and not beyond, while
 * the print zone published two tiles away is comfortably into the next one.
 * Printing the price and the zone without the bound between them publishes a
 * price the cart will not honour, and in France an announced price is an offer.
 * `Settings::area_note()` is the one home for the sentence, and the product page
 * prints the same one.
 */
function area_note(): string {
	if ( ! class_exists( '\\Teeshoop\\Core\\Settings' ) ) {
		return '';
	}
	return \Teeshoop\Core\Settings::area_note( pricing_config() );
}

/**
 * The sentence that says what a published figure includes, tax-wise.
 *
 * One home, so the homepage, the listing and the footer cannot drift apart on
 * the one line a professional buyer reads first.
 */
function tax_basis_note(): string {
	$bases = price_bases();
	if ( ! $bases['known'] ) {
		/*
		 * NOTHING. Not "prix hors taxes", which is a statement about the
		 * seller's tax position made on no evidence: `price_bases()` says
		 * `known` is false when nobody has recorded a VAT regime, and its own
		 * docblock records that reading that state as an answer once put "aucune
		 * taxe ne s'y ajoute" in front of every visitor. Callers omit the line
		 * when this is empty; the basket refuses the sale in that state anyway.
		 */
		return '';
	}
	if ( ! $bases['two'] ) {
		return __( 'Ce sont les montants à payer : aucune taxe ne s’y ajoute.', 'teeshoop' );
	}
	return 'ttc' === $bases['lead']
		? __( 'Prix toutes taxes comprises, hors taxes indiqué à côté.', 'teeshoop' )
		: __( 'Prix hors taxes, toutes taxes comprises indiqué à côté.', 'teeshoop' );
}

/* ───────────────────────────────────────────────────────────── navigation ── */

/**
 * A page this site relies on, by slug, or an empty string.
 *
 * The convention is the plugin's: `Shelf::unpriced_notice` already looks a
 * contact page up by path and says nothing at all when it is absent, rather
 * than sending a buyer to a URL that 404s. Every link built here degrades the
 * same way, because a nav item pointing at nothing is worse than one missing.
 */
function page_url( string $slug ): string {
	static $cache = array();
	if ( isset( $cache[ $slug ] ) ) {
		return $cache[ $slug ];
	}
	/*
	 * PUBLISHED, not merely present. `get_page_by_path()` returns a draft and a
	 * page in the bin as happily as a live one, so a devis page somebody
	 * unpublished would have left the « Devis » control in the masthead of every
	 * page of the site pointing at a 404 for every visitor while working
	 * perfectly for the logged-in editor looking at it.
	 */
	$page           = get_page_by_path( $slug );
	$live           = $page instanceof \WP_Post && 'publish' === $page->post_status;
	$cache[ $slug ] = $live ? (string) get_permalink( $page ) : '';
	return $cache[ $slug ];
}

/** Where "Devis" goes: the standalone request page, or the shop if it is missing. */
function quote_url(): string {
	$url = page_url( 'devis' );
	if ( '' !== $url ) {
		return $url;
	}
	return function_exists( 'wc_get_page_permalink' ) ? (string) wc_get_page_permalink( 'shop' ) : home_url( '/' );
}

/**
 * The top-level product categories that actually have something in them,
 * counting what is filed UNDER them and not only what is filed directly on them.
 *
 * `hide_empty` stays true, and for the reason it was written: a navigation that
 * offers a category leading to "aucun produit" is the shop telling a buyer it
 * is unfinished.
 *
 * WHAT WAS WRONG WITH IT. `get_terms( 'hide_empty' => true )` reads
 * `term_taxonomy.count`, which WooCommerce fills with the products filed on
 * THAT term exactly. The importer files a t-shirt under « T-shirts > Manches
 * courtes », so on 03/09/2026 the mirror measured:
 *
 *     T-shirts   count 0    child « Manches courtes » count 139
 *     Polos      count 2    children 88 + 14
 *     Sweats     count 168  no child
 *
 * and this function returned two families out of three. A shop with 184
 * t-shirts in it did not have « T-shirts » in its navigation, and nothing said
 * so: the category was not broken, it was invisible.
 *
 * The fix counts descendants. `get_term_children()` is cheap here (one cached
 * option-like read per taxonomy) and the whole result is memoised for the
 * request, because the masthead and the homepage both ask.
 *
 * @return \WP_Term[]
 */
function top_categories(): array {
	static $cache = null;
	if ( null !== $cache ) {
		return $cache;
	}

	$terms = get_terms(
		array(
			'taxonomy'   => 'product_cat',
			'parent'     => 0,
			'hide_empty' => false,
			'orderby'    => 'name',
			'exclude'    => array( (int) get_option( 'default_product_cat', 0 ) ),
		)
	);
	if ( ! is_array( $terms ) ) {
		return $cache = array();
	}

	$kept = array();
	foreach ( $terms as $term ) {
		if ( ! $term instanceof \WP_Term ) {
			continue;
		}
		$total = (int) $term->count;
		foreach ( (array) get_term_children( $term->term_id, 'product_cat' ) as $child_id ) {
			$child  = get_term( (int) $child_id, 'product_cat' );
			$total += $child instanceof \WP_Term ? (int) $child->count : 0;
		}
		if ( $total > 0 ) {
			// Carried on the term so the caller does not count twice; `count`
			// itself is left alone, because it is WooCommerce's field and a
			// theme writing to it would be a second bookkeeping.
			$term->ts_total = $total;
			$kept[]         = $term;
		}
	}
	return $cache = $kept;
}

/**
 * How many references a family holds, itself and everything under it.
 *
 * @param \WP_Term $term A product category.
 */
function family_count( \WP_Term $term ): int {
	return isset( $term->ts_total ) ? (int) $term->ts_total : (int) $term->count;
}

/**
 * The photograph attached to a product category, at the size a tile draws it.
 *
 * WHERE THESE COME FROM. Eleven photographs of people wearing marked garments
 * are attached to the terms on teeshoop.com and have been since May 2025.
 * `scripts/visuels-associe.mjs` copies them into an environment's media library
 * and re-attaches them by name. They are the associate's own product
 * photography and there is nothing to invent.
 *
 * THEY ARE 170 x 170, measured, and that is the whole reason the tile is the
 * size it is. The comment that used to sit above `.ts-families` said a category
 * « n'a pas de photographie honnête unique », which was simply not true; what is
 * true is that the honest photograph it has is small, so the tile is drawn at a
 * size the file can fill rather than blown up into a soft banner.
 *
 * Returns '' when the term has no photograph, and the caller decides what to
 * draw instead. It never substitutes another category's picture.
 *
 * @param \WP_Term $term A product category.
 */
function category_media( \WP_Term $term ): string {
	$id = (int) get_term_meta( $term->term_id, 'thumbnail_id', true );
	if ( $id <= 0 ) {
		return '';
	}
	return (string) wp_get_attachment_image(
		$id,
		'woocommerce_thumbnail',
		false,
		array(
			'class'   => 'ts-fams__img',
			'loading' => 'lazy',
			'decoding' => 'async',
			/*
			 * EMPTY ALT, DELIBERATELY. The link right beside it already says
			 * « T-Shirts, 184 références » in text. A screen reader that also
			 * read « photographie d'une personne portant un t-shirt marqué »
			 * would announce the same tile twice, and WCAG 1.1.1 calls an image
			 * whose information is already in adjacent text decorative.
			 */
			'alt'     => '',
		)
	);
}

/**
 * THE ASSOCIATE'S ORGANISATION, in the order he put it in.
 *
 * His answer 31 asks to keep « le menu et l'organisation déjà définis ». On
 * teeshoop.com that is the menu « Menu Principale teeshoop » (11 product
 * families, alphabetical) followed by the standing pages of « Avant menu
 * header » (Devis gratuit, Services, Suivi, À propos, Blog). Read from his site
 * on 03/09/2026 and reproduced here.
 *
 * WHY A FALLBACK AND NOT A MENU IN THE DATABASE. WordPress's own fallback is
 * `wp_page_menu`, which on a fresh WooCommerce lists "Panier", "Commander",
 * "Mon compte" and "Page d'exemple" as if they were the shop's departments.
 * This one is built from what the shop actually sells, so an installation that
 * has just been made navigates correctly before anyone has touched a menu
 * screen. An admin who builds a real menu in `primaire` overrides all of it.
 *
 * WHAT IT WILL NOT DO IS OFFER A DEPARTMENT THAT IS EMPTY. Eight of his eleven
 * families (Vestes, Débardeurs, Sport, Casquettes, Bonnets, Tabliers, Sacs,
 * Maison) have no product on his own shop either, and the supplier import does
 * not reach them: the studio prints upper-body garments and the importer asks
 * for those. Putting the other eight in the bar would be eleven links of which
 * eight lead to « aucun produit », which is the shop announcing it is
 * unfinished, eight times, on every page. His ORDER and his NAMES are kept;
 * what is not stocked is not advertised. See docs/decisions/.
 *
 * The standing pages are listed by slug and only the PUBLISHED ones render
 * (`page_url()` returns '' otherwise), so the day somebody creates « services »
 * the link appears with no code change.
 */
const STANDING_PAGES = array(
	'services'     => 'Services',
	'suivi'        => 'Suivi de commande',
	'entreprises'  => 'Entreprises et associations',
	'a-propos'     => 'À propos',
);

function default_nav(): void {
	echo '<ul class="ts-nav__list">';

	$shop = function_exists( 'wc_get_page_permalink' ) ? (string) wc_get_page_permalink( 'shop' ) : '';
	foreach ( top_categories() as $term ) {
		printf(
			'<li class="ts-nav__item"><a href="%s">%s</a></li>',
			esc_url( (string) get_term_link( $term ) ),
			esc_html( $term->name )
		);
	}

	if ( '' !== $shop ) {
		printf(
			'<li class="ts-nav__item"><a href="%s">%s</a></li>',
			esc_url( $shop ),
			esc_html__( 'Tout le catalogue', 'teeshoop' )
		);
	}

	foreach ( STANDING_PAGES as $slug => $label ) {
		$url = page_url( $slug );
		if ( '' === $url ) {
			continue;
		}
		printf(
			'<li class="ts-nav__item"><a href="%s">%s</a></li>',
			esc_url( $url ),
			esc_html( $label )
		);
	}

	echo '</ul>';
}

/* ────────────────────────────────────────────── WooCommerce, brought in line ── */

/**
 * The listing renders its own title and its own count, so Woo's are removed.
 *
 * Not restyled, removed: two headings saying the same thing is what makes a
 * shop page look assembled rather than designed. The ORDERING dropdown stays
 * beside the results and not in the filter column, but it is OURS now: see
 * `sort_control()` below.
 */
function shop_loop_chrome(): void {
	add_filter( 'woocommerce_show_page_title', '__return_false' );
	remove_action( 'woocommerce_before_shop_loop', 'woocommerce_result_count', 20 );
	remove_action( 'woocommerce_before_shop_loop', 'woocommerce_catalog_ordering', 30 );
	add_action( 'woocommerce_before_shop_loop', __NAMESPACE__ . '\\sort_control', 30 );
}
add_action( 'wp', __NAMESPACE__ . '\\shop_loop_chrome' );

/**
 * The sort control, with a button, because a select that navigates on change
 * fails 3.2.2.
 *
 * WooCommerce's own `orderby` form submits itself from a `change` event and
 * carries no submit control at all: measured, zero buttons in that form, and
 * the page navigates the moment the value moves. WCAG 2.2's 3.2.2 On Input
 * forbids a change of context on a selection unless the user was warned first,
 * and « the page you were reading is replaced » is a change of context. It is
 * also simply hostile with a keyboard, where arrowing through a select changes
 * the value at every step: five options, four navigations, and a reader who
 * wanted the fifth never gets there.
 *
 * IT ALSO WORKS WITH NO SCRIPT AT ALL, which Woo's did not: the filter form two
 * columns over already made that promise (`template-parts/filters.php`) and this
 * is the same shape. The button is not hidden when JavaScript is present: a
 * control that appears only for some visitors is a control the rest cannot be
 * told about.
 *
 * The hidden fields carry the rest of the query, so sorting a filtered listing
 * keeps the filters. Woo's own form did that too and it is the part worth
 * copying.
 */
function sort_control(): void {
	if ( ! function_exists( 'woocommerce_catalog_ordering' ) ) {
		return;
	}
	$options = apply_filters(
		'woocommerce_catalog_orderby',
		array(
			'menu_order' => __( 'Tri par défaut', 'teeshoop' ),
			'popularity' => __( 'Les plus commandés', 'teeshoop' ),
			'date'       => __( 'Les plus récents', 'teeshoop' ),
			'price'      => __( 'Prix croissant', 'teeshoop' ),
			'price-desc' => __( 'Prix décroissant', 'teeshoop' ),
		)
	);
	if ( ! is_array( $options ) || count( $options ) < 2 ) {
		return;
	}

	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- reading which sort a public listing was asked for.
	$current = isset( $_GET['orderby'] ) ? sanitize_text_field( wp_unslash( $_GET['orderby'] ) ) : '';
	if ( ! isset( $options[ $current ] ) ) {
		$current = (string) get_option( 'woocommerce_default_catalog_orderby', 'menu_order' );
	}

	echo '<form class="ts-sort" method="get">';
	printf(
		'<label class="ts-sort__label" for="ts-sort">%s</label>',
		esc_html__( 'Trier les articles', 'teeshoop' )
	);
	echo '<select class="ts-sort__select" name="orderby" id="ts-sort">';
	foreach ( $options as $value => $label ) {
		printf(
			'<option value="%s"%s>%s</option>',
			esc_attr( (string) $value ),
			selected( $current, (string) $value, false ),
			esc_html( (string) $label )
		);
	}
	echo '</select>';
	printf(
		'<button class="ts-sort__go" type="submit">%s</button>',
		esc_html__( 'Trier', 'teeshoop' )
	);
	/*
	 * Everything else that was in the URL, minus what this form owns and minus
	 * the page number: a new sort starts at page one, because page four of the
	 * old order is not page four of the new one.
	 */
	wc_query_string_form_fields( null, array( 'orderby', 'submit', 'paged', 'product-page' ) );
	echo '</form>';
}

/**
 * A product with no photograph says so, instead of showing a picture frame.
 *
 * WooCommerce's placeholder is a grey drawing of a mountain and a sun. On a
 * catalogue page it reads as a broken image, and on four cards in a row it
 * reads as a broken shop. The supplier import brings real photographs for the
 * references it carries; what has none is a product somebody added by hand, and
 * the honest thing to draw is a labelled empty tile.
 *
 * @param string $html The `<img>` WooCommerce was about to print.
 * @return string
 */
function placeholder_media( $html ): string {
	return '<span class="ts-nomedia" role="img" aria-label="'
		. esc_attr__( 'Aucune photo pour cet article', 'teeshoop' ) . '"><span aria-hidden="true">'
		. esc_html__( 'Sans photo', 'teeshoop' ) . '</span></span>';
}
/*
 * FRONT END ONLY, and registered late enough to know which side it is on.
 *
 * `woocommerce_placeholder_img` is global: it also reaches the thumbnail column
 * of the operator's Products list, which would read « Sans photo » in words
 * where a tile belongs, and `emails/email-order-items.php`, which would put the
 * span into a message where nothing has inlined the class and the surrounding
 * table expects an image of a known width.
 */
add_action(
	'wp',
	static function (): void {
		if ( is_admin() ) {
			return;
		}
		add_filter( 'woocommerce_placeholder_img', __NAMESPACE__ . '\\placeholder_media', 10, 1 );
			}
);

/**
 * The same tile on a product page, which does not go through the same function.
 *
 * `single-product/product-image.php` builds its own `<img>` from
 * `wc_placeholder_img_src()` rather than calling `wc_placeholder_img()`, so the
 * filter above never sees it: the listing said "Sans photo" while the product
 * page still showed WooCommerce's drawing of a mountain. Two code paths for one
 * missing photograph, and only one of them is filterable by the obvious name.
 *
 * @param string $html            The gallery figure WooCommerce assembled.
 * @param int    $post_thumbnail_id 0 when the product carries no image.
 * @return string
 */
function placeholder_gallery( $html, $post_thumbnail_id ): string {
	if ( (int) $post_thumbnail_id > 0 ) {
		return (string) $html;
	}
	return '<div class="woocommerce-product-gallery__image--placeholder">' . placeholder_media( '' ) . '</div>';
}
add_filter( 'woocommerce_single_product_image_thumbnail_html', __NAMESPACE__ . '\\placeholder_gallery', 10, 2 );

/**
 * Say which page this is, in a class, so the stylesheet can dress it.
 *
 * `ts-editing` a disparu avec `?personnaliser=1` : il n'y a plus de page
 * « en train d'éditer » distincte de la fiche produit, l'éditeur est dedans.
 */
function body_classes( array $classes ): array {
	if ( has_filters() ) {
		$classes[] = 'ts-filtered';
	}
	return $classes;
}
add_filter( 'body_class', __NAMESPACE__ . '\\body_classes' );


