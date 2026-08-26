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
	 * Inter, self-hosted, two weights.
	 *
	 * Question 31's default is the type the site already uses. Two files rather
	 * than four: 400 for text and 600 for everything that announces something.
	 * 700 is deliberately absent, so no rule in this theme may ask for it and
	 * get a browser-synthesised fake. Latin subset only, because the shop sells
	 * in metropolitan France (question 35). 48 ko total, and the 400 is
	 * preloaded because it is on the critical path of every page.
	 */
	wp_enqueue_style( 'teeshoop-fonts', $dir . '/assets/fonts.css', array(), VERSION );

	if ( wp_style_is( 'teeshoop-components', 'registered' ) ) {
		// Pulls `teeshoop-tokens` in with it, in the right order.
		wp_enqueue_style( 'teeshoop-components' );
	}

	wp_enqueue_style( 'teeshoop-site', get_stylesheet_uri(), array( 'teeshoop-fonts' ), VERSION );

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

/** Preload the text weight; the browser cannot find it inside a stylesheet in time. */
function preload_font(): void {
	printf(
		'<link rel="preload" href="%s" as="font" type="font/woff2" crossorigin>' . "\n",
		esc_url( get_template_directory_uri() . '/assets/fonts/inter-latin-400.woff2' )
	);
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
	echo '<div class="notice notice-error"><p><strong>Thème Teeshoop</strong> — ';
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
 * @return array{qty:int,ht_cents:int}|null
 */
function minimum(): ?array {
	$config = pricing_config();
	if ( ! isset( $config['min_qty'], $config['min_ht'] ) ) {
		return null;
	}
	return array(
		'qty'      => (int) $config['min_qty'],
		'ht_cents' => (int) $config['min_ht'],
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
		if ( $product instanceof \WC_Product ) {
			$products[] = $product;
		}
	}
	return $products;
}

/**
 * The link that opens the editor on a product.
 *
 * `ProductPage::STUDIO_ARG` is the plugin's own flag, read rather than
 * repeated: the day it changes, every button on this site follows it.
 */
function studio_url( int $product_id ): string {
	if ( ! class_exists( '\\Teeshoop\\Core\\ProductPage' ) ) {
		return (string) get_permalink( $product_id );
	}
	return add_query_arg(
		\Teeshoop\Core\ProductPage::STUDIO_ARG,
		'1',
		(string) get_permalink( $product_id )
	);
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
 * The top-level product categories that actually have something in them.
 *
 * `hide_empty` is true on purpose. Session 03's taxonomy carries families the
 * catalogue has not filled yet ("Sweats" is empty on the mirror today), and a
 * navigation that offers a category leading to "aucun produit" is the shop
 * telling a buyer it is unfinished. When the import fills it, it appears.
 *
 * @return \WP_Term[]
 */
function top_categories(): array {
	$terms = get_terms(
		array(
			'taxonomy'   => 'product_cat',
			'parent'     => 0,
			'hide_empty' => true,
			'orderby'    => 'name',
			'exclude'    => array( (int) get_option( 'default_product_cat', 0 ) ),
		)
	);
	return is_array( $terms ) ? $terms : array();
}

/**
 * The navigation when nobody has built a menu in the admin.
 *
 * WordPress's own fallback is `wp_page_menu`, which on a fresh WooCommerce
 * lists "Panier", "Commander", "Mon compte" and "Page d'exemple" as if they
 * were the shop's departments. This one is built from what the shop actually
 * sells, so a site that has just been installed navigates correctly before
 * anyone has touched a menu screen.
 */
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

	$pro = page_url( 'entreprises' );
	if ( '' !== $pro ) {
		printf(
			'<li class="ts-nav__item"><a href="%s">%s</a></li>',
			esc_url( $pro ),
			esc_html__( 'Entreprises et associations', 'teeshoop' )
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
 * where WooCommerce puts it, because it belongs beside the results and not in
 * the filter column.
 */
function shop_loop_chrome(): void {
	add_filter( 'woocommerce_show_page_title', '__return_false' );
	remove_action( 'woocommerce_before_shop_loop', 'woocommerce_result_count', 20 );
}
add_action( 'wp', __NAMESPACE__ . '\\shop_loop_chrome' );

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
 * Say which page this is, in a class, so the stylesheet can dress the editor.
 *
 * `ProductPage::STUDIO_ARG` is read rather than repeated: the flag belongs to
 * the plugin and the theme follows it.
 */
function body_classes( array $classes ): array {
	if (
		class_exists( '\\Teeshoop\\Core\\ProductPage' )
		&& function_exists( 'is_product' ) && is_product()
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- reading the URL shape, exactly as ProductPage does.
		&& ! empty( $_GET[ \Teeshoop\Core\ProductPage::STUDIO_ARG ] )
	) {
		$classes[] = 'ts-editing';
	}
	if ( has_filters() ) {
		$classes[] = 'ts-filtered';
	}
	return $classes;
}
add_filter( 'body_class', __NAMESPACE__ . '\\body_classes' );


