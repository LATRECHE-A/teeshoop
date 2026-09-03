<?php
/**
 * What every page of this shop tells a search engine, decided in one place.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS OURS AND NOT A PLUGIN
 *
 * The obvious move is Yoast or Rank Math. Both are excellent and both are the
 * wrong shape here. They put the title, the description and the canonical of
 * every page in the DATABASE, one post meta row at a time, which is the same
 * objection this project already made to a block theme: a rule that lives in
 * `wp_postmeta` cannot be reviewed in a diff and cannot be checked by a gate.
 * With 463 products nobody is going to hand-write 463 descriptions, so what
 * actually ships is the plugin's default template, which is a second templating
 * engine we do not control, running on shared hosting, on every request.
 *
 * They are also large. Yoast is roughly 4 MB of PHP and adds its own admin
 * columns, its own indexable tables and its own cron. On o2switch that is a
 * performance and a security liability for a feature this file answers in one
 * class, and the session brief names the trap by hand.
 *
 * WHAT THIS OWNS. The title, the meta description, `rel=canonical`,
 * `rel=next`/`rel=prev`, the robots policy, the JSON-LD graph, the sitemap's
 * shape and `robots.txt`. Everything a crawler reads and a human does not.
 *
 * WHAT IT DOES NOT OWN. The words. Those are in `Content.php`, one home, so the
 * sentence a crawler reads in a `<meta>` and the sentence a buyer reads on the
 * page cannot drift apart. And the product's own facts, which come from the
 * catalogue import and from `Garments`, so a description cannot claim a
 * grammage the product page contradicts two blocks lower.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE RULE THAT IS EASY TO GET WRONG
 *
 * A `noindex` page MUST NOT carry a `rel=canonical` pointing anywhere else.
 * They are contradictory instructions: the canonical says "index that one
 * instead and merge the signals", the noindex says "index nothing here", and
 * Google's own documentation warns that the noindex can travel along the
 * canonical to the target. On this shop that would be catastrophic in a very
 * quiet way: every filtered listing is `noindex` and would have pointed at the
 * clean category page, so the category pages, which are the pages we actually
 * want to rank, could have been deindexed by the filters that lead to them.
 *
 * So this file does not decide who is `noindex` and then hope the two agree.
 * It OBSERVES the final `wp_robots` array at `PHP_INT_MAX`, after WordPress,
 * after WooCommerce, after `ProductPage::robots()` and after the theme's facet
 * rule have all had their say, and refuses to print a canonical when the answer
 * came back `noindex`. Whoever adds the next rule gets this behaviour for free.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class Seo {

	/**
	 * The final robots decision for this request, or null before it is taken.
	 *
	 * Written by `observe()` on the last `wp_robots` pass and read by `head()`.
	 * NULL and FALSE are different states on purpose: null means the filter has
	 * not run, which on a page that somehow prints no robots meta at all must
	 * not be read as "indexable, go ahead and canonicalise".
	 */
	private static ?bool $noindex = null;

	/** Separator between a page's own title and the site name. */
	private const SEP = '|';

	/**
	 * How long a description may be before search engines cut it.
	 *
	 * Google renders about 920 px on desktop, which is roughly 155 to 160 Latin
	 * characters; there is no character limit in the specification and the real
	 * one is pixels. 160 is the number every measurement of French SERPs lands
	 * near and it is the one used here, applied on WORDS rather than characters
	 * so a description never ends mid-word.
	 */
	private const DESC_MAX = 160;

	public static function init(): void {
		/*
		 * CORE'S CANONICAL IS REMOVED AND REPLACED, not supplemented.
		 *
		 * `rel_canonical()` only fires on `is_singular()`, so every archive on
		 * this shop had no canonical at all, and on a singular page it prints
		 * one even when the page is `noindex`, which is the contradiction
		 * described at the top of this file. Two partial implementations of one
		 * rule is exactly what this project does not do, so there is now one.
		 */
		remove_action( 'wp_head', 'rel_canonical' );

		// `wp_robots` runs at 1. Everything here reads its answer, so it runs after.
		add_action( 'wp_head', array( self::class, 'head' ), 2 );

		add_action( 'template_redirect', array( self::class, 'first_page' ), 5 );
		add_action( 'template_redirect', array( self::class, 'english_base' ), 6 );

		add_filter( 'wp_robots', array( self::class, 'robots' ), 20 );
		add_filter( 'wp_robots', array( self::class, 'observe' ), PHP_INT_MAX );

		add_filter( 'document_title_parts', array( self::class, 'title_parts' ) );
		add_filter( 'document_title_separator', static fn(): string => self::SEP );

		add_filter( 'robots_txt', array( self::class, 'robots_txt' ), 20, 2 );

		self::init_sitemap();

	}

	/**
	 * `/page/1/` is the same page as the listing, so it stops existing.
	 *
	 * `redirect_canonical()` does not catch it on an archive: measured on the
	 * mirror, `/product-category/t-shirts/page/1/` answered 200 with byte for
	 * byte the same 28 products as the category root, and `/shop/page/1/` the
	 * same. It is reachable rather than theoretical, because WooCommerce's own
	 * pagination writes the "previous" arrow on page 2 as a link to it. A
	 * canonical alone would declare the duplicate; a 301 removes it, and it is
	 * the answer every crawler and every human gets.
	 */
	public static function first_page(): void {
		if ( is_singular() || 1 !== (int) get_query_var( 'paged' ) ) {
			return;
		}

		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- reading the path of a public listing.
		$uri = (string) ( $_SERVER['REQUEST_URI'] ?? '' );

		/*
		 * THE PATH ONLY, never the whole request line.
		 *
		 * Tested against the full URI, `?paged=1&z=/page/1` matched: the query
		 * argument sets `paged` to 1 and the literal `/page/1` at the end of the
		 * string satisfied the pattern, so the rebuilt target was the requested
		 * URL and the shop answered 301 to itself forever. Measured with
		 * `curl -L --max-redirs 8`: eight hops, unchanged URL. Browsers cache a
		 * 301, so one such link in a backlink or a Search Console inspection is a
		 * permanent loop on the domain.
		 */
		$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
		if ( ! preg_match( '#/page/1/?$#', $path ) ) {
			return;
		}

		$target = self::canonical();
		if ( '' === $target ) {
			return;
		}

		// Query arguments survive: a sorted or filtered first page is still that
		// request, and dropping them here would answer a question nobody asked.
		$query = (string) wp_parse_url( $uri, PHP_URL_QUERY );
		if ( '' !== $query ) {
			$target .= ( str_contains( $target, '?' ) ? '&' : '?' ) . $query;
		}

		/*
		 * AND A REDIRECT TO ONESELF IS NOT A REDIRECT. The belt to the pattern's
		 * braces: whatever else changes above, this function may never answer
		 * with the URL it was asked for.
		 */
		if ( untrailingslashit( $target ) === untrailingslashit( home_url( $uri ) ) ) {
			return;
		}

		wp_safe_redirect( $target, 301 );
		exit;
	}

	/**
	 * The English bases WooCommerce used to serve, sent to the French ones.
	 *
	 * `Cli::ensure_french_bases()` moves `/product/` to `/produit/` and
	 * `/product-category/` to `/categorie/`, which is what a shop selling only in
	 * France should have addressed its catalogue with from the start. WordPress
	 * happens to redirect the PRODUCT base by itself, through
	 * `redirect_canonical()` matching on the post name; it does NOT redirect the
	 * category one, and `/product-category/tout/`, which is the single category
	 * teeshoop.com serves today, would simply have started answering 404.
	 *
	 * ONLY ON A 404, so a normal request never reaches this. And only when the
	 * shop is actually on the French base, read from the option rather than
	 * assumed: an operator who kept the English one must not be redirected off
	 * their own URLs.
	 *
	 * The target is not checked for existence. A prefix swap that lands on
	 * nothing gives a 404 one hop later, which is the same answer, and probing
	 * the target here would mean a second query on every missing page.
	 */
	public static function english_base(): void {
		if ( ! is_404() ) {
			return;
		}

		$bases = get_option( 'woocommerce_permalinks', array() );
		$bases = is_array( $bases ) ? $bases : array();

		$moves = array(
			'product-category' => trim( (string) ( $bases['category_base'] ?? '' ), '/' ),
			'product-tag'      => trim( (string) ( $bases['tag_base'] ?? '' ), '/' ),
			'product'          => trim( (string) ( $bases['product_base'] ?? '' ), '/' ),
		);

		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- reading the path of a request that already 404s.
		$uri  = (string) ( $_SERVER['REQUEST_URI'] ?? '' );
		$path = (string) wp_parse_url( $uri, PHP_URL_PATH );

		foreach ( $moves as $english => $ours ) {
			if ( '' === $ours || $ours === $english ) {
				continue;
			}
			$prefix = '/' . $english . '/';
			if ( ! str_starts_with( $path, $prefix ) ) {
				continue;
			}

			$target = home_url( '/' . $ours . '/' . substr( $path, strlen( $prefix ) ) );
			$query  = (string) wp_parse_url( $uri, PHP_URL_QUERY );
			if ( '' !== $query ) {
				$target .= '?' . $query;
			}

			wp_safe_redirect( $target, 301 );
			exit;
		}
	}

	// -----------------------------------------------------------------------
	// Robots
	// -----------------------------------------------------------------------

	/**
	 * The directives this file owns, added to whatever else has been decided.
	 *
	 * THE SPLIT WITH THE OTHER TWO PLACES IS DELIBERATE and worth stating, so
	 * nobody consolidates them into a fourth. `ProductPage::robots()` knows
	 * about the studio flag and the estimator's own query arguments, which are
	 * the plugin's product vocabulary. `Teeshoop\Theme\filter_robots()` knows
	 * about the ten catalogue facets, which are the theme's. Both are rules
	 * about a thing that file owns. This one is the rest of the site.
	 *
	 * `follow` accompanies every `noindex` here. A sorted listing is still the
	 * shortest path a crawler has to some of the references on it, and
	 * `noindex, nofollow` would cut them off for no gain.
	 *
	 * @param array $robots The directives assembled so far.
	 * @return array
	 */
	public static function robots( $robots ): array {
		if ( ! is_array( $robots ) ) {
			return array();
		}

		$noindex = false;

		/*
		 * A SORTED LISTING IS THE SAME LISTING.
		 *
		 * WooCommerce's ordering control is a GET form, so `?orderby=price`,
		 * `?orderby=popularity` and `?orderby=date` are three more URLs holding
		 * the same 184 references as the category page, and they were all
		 * indexable: measured on the mirror, `/product-category/t-shirts/` and
		 * `/product-category/t-shirts/?orderby=price` both answered with
		 * `max-image-preview:large` and nothing else. That is the classic way a
		 * WooCommerce catalogue quadruples its own indexed page count with
		 * duplicates.
		 */
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- reading the URL shape of a public listing; nothing is written.
		if ( isset( $_GET['orderby'] ) || isset( $_GET['product_orderby'] ) ) {
			$noindex = true;
		}

		/*
		 * THE CONSENT PANEL'S OWN FLAG, which is on a link in the footer of every
		 * page. `?cookies=1` renders the same document with the panel open, so
		 * without this every URL on the site had a crawlable twin, published from
		 * the one link that is guaranteed to be on every page. `Consent` needs the
		 * flag to be a plain link so that withdrawal works with no JavaScript;
		 * this is the other half of that decision.
		 */
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- reading a navigation flag.
		if ( isset( $_GET['cookies'] ) ) {
			$noindex = true;
		}

		/*
		 * AUTHOR ARCHIVES ARE NOT CONTENT AND THEY NAME A LOGIN.
		 *
		 * `/author/dev/` was in the sitemap, published by WordPress's own users
		 * provider. On a shop with no blog it is an empty page; worse, its slug
		 * is a WordPress username, which is half of a login. The sitemap entry
		 * is removed below; this is the other half, for anyone who reaches the
		 * URL by guessing it.
		 */
		if ( is_author() || is_date() || is_attachment() ) {
			$noindex = true;
		}

		/*
		 * A CHILD CATEGORY IS INDEXABLE ONLY ONCE SOMEBODY HAS WRITTEN FOR IT.
		 *
		 * Measured on the real catalogue: "Manches courtes" holds 139 of the 184
		 * references its parent "T-shirts" holds, and "Manches courtes" under
		 * Polos holds 88 of 104. Two pages listing three quarters of the same
		 * grid under two headings is the thin near-duplicate chapter 04 warns
		 * about, and it is what an imported taxonomy produces by default.
		 *
		 * The rule is not "hide the children", it is "a page enters the index
		 * when it has something of its own to say". Top-level families are the
		 * shop's structure and are always in; a child gets in the day its entry
		 * appears in `Content::pages()`. That makes indexation a consequence of
		 * an editorial decision rather than of an import.
		 */
		if ( is_tax( 'product_cat' ) && ! self::indexable_term( get_queried_object() ) ) {
			$noindex = true;
		}

		/*
		 * A PAGINATED ARCHIVE STAYS INDEXABLE, and that is a decision rather
		 * than an omission. `noindex` on page 2 and beyond is a common recipe
		 * and it is wrong for a catalogue: with 24 references to a page, T-shirts
		 * is 8 pages and Sweats is 7, so it would hide 87 % of the references
		 * from the index. They self-canonicalise and carry rel=prev/next instead.
		 */

		if ( $noindex ) {
			$robots['noindex'] = true;
			$robots['follow']  = true;
		}

		return $robots;
	}

	/**
	 * Record the final answer so `head()` can honour it. Changes nothing.
	 *
	 * @param array $robots The directives, after every filter.
	 * @return array
	 */
	public static function observe( $robots ): array {
		self::$noindex = is_array( $robots ) && ! empty( $robots['noindex'] );
		return is_array( $robots ) ? $robots : array();
	}

	/**
	 * Whether a product category is a page we want in the index.
	 *
	 * ONE HOME for that decision, because two places consume it: the robots meta
	 * above and the sitemap below. A category listed in the sitemap while the
	 * page itself says `noindex` is the shop submitting both instructions about
	 * the same URL in the same crawl, which is exactly the state the mirror was
	 * found in for WooCommerce's own basket and checkout pages.
	 *
	 * @param mixed $term The queried object, which is not always a term.
	 */
	public static function indexable_term( $term ): bool {
		if ( ! $term instanceof \WP_Term || 'product_cat' !== $term->taxonomy ) {
			return false;
		}
		// WordPress's own "Uncategorized", wherever a product lands by accident.
		if ( (int) $term->term_id === (int) get_option( 'default_product_cat', 0 ) ) {
			return false;
		}
		if ( 0 === (int) $term->parent ) {
			return true;
		}
		return Content::has( 'categorie:' . $term->slug );
	}

	/** Whether this request has been marked `noindex` by anyone at all. */
	public static function is_noindex(): bool {
		// Not yet decided is treated as "do not print a canonical", because the
		// safe direction when we cannot tell is silence, not a guess.
		return null === self::$noindex ? true : self::$noindex;
	}

	// -----------------------------------------------------------------------
	// The head
	// -----------------------------------------------------------------------

	/** Canonical, description, sharing card, pagination links and the JSON-LD graph. */
	public static function head(): void {
		$description = self::description();
		if ( '' !== $description ) {
			printf( '<meta name="description" content="%s">' . "\n", esc_attr( $description ) );
		}

		if ( ! self::is_noindex() ) {
			$canonical = self::canonical();
			if ( '' !== $canonical ) {
				printf( '<link rel="canonical" href="%s">' . "\n", esc_url( $canonical ) );
			}
			self::adjacent();
		}

		self::sharing( $description );
		self::graph();
	}

	/**
	 * THE CARD A LINK BECOMES WHEN SOMEBODY PASTES IT.
	 *
	 * Measured 03/09/2026: this shop published NO Open Graph at all. A link to it
	 * in WhatsApp, on LinkedIn, in Slack or in a Teams channel rendered a white
	 * rectangle with a black bar, for a company whose trade is putting a logo on
	 * things. Every quotation this shop sends contains a link to a product page.
	 *
	 * IT IS PRINTED EVEN ON A `noindex` PAGE, deliberately. `noindex` is an
	 * instruction to a search engine about its INDEX; it says nothing about a
	 * person forwarding an address to a colleague, which is exactly what happens
	 * to a filtered listing somebody wants a second opinion on. The URL in the
	 * card is the canonical one where there is one, so a link carrying eight
	 * facet parameters still shares as the clean page.
	 *
	 * THE IMAGE, IN ORDER OF WHAT IS TRUE:
	 *   1. on a product, that product's own photograph. Sharing a garment and
	 *      showing a generic banner would be the wrong picture, not a missing one;
	 *   2. otherwise the shop's own sharing image, shipped with the theme;
	 *   3. otherwise nothing at all. A card with no image beats a card with
	 *      somebody else's.
	 *
	 * WIDTH AND HEIGHT ARE SENT because several clients (LinkedIn among them)
	 * will not lay out a large card until they have fetched and measured the
	 * file, and some give up first. `og:image:alt` because a card is read aloud
	 * on a phone.
	 *
	 * @param string $description The same description the meta tag carries.
	 */
	private static function sharing( string $description ): void {
		$title = wp_get_document_title();
		$url   = self::canonical();
		if ( '' === $url ) {
			$url = home_url( add_query_arg( array() ) );
		}

		$type = is_singular( 'product' ) ? 'product' : ( is_singular( 'post' ) ? 'article' : 'website' );

		printf( '<meta property="og:type" content="%s">' . "\n", esc_attr( $type ) );
		printf( '<meta property="og:site_name" content="%s">' . "\n", esc_attr( get_bloginfo( 'name' ) ) );
		printf( '<meta property="og:locale" content="%s">' . "\n", esc_attr( str_replace( '-', '_', get_bloginfo( 'language' ) ) ) );
		printf( '<meta property="og:title" content="%s">' . "\n", esc_attr( $title ) );
		printf( '<meta property="og:url" content="%s">' . "\n", esc_url( $url ) );
		if ( '' !== $description ) {
			printf( '<meta property="og:description" content="%s">' . "\n", esc_attr( $description ) );
		}

		$image = self::sharing_image();
		if ( array() === $image ) {
			// No picture, so no large card: `summary` renders correctly without
			// one, `summary_large_image` renders as a bare line of text.
			print( '<meta name="twitter:card" content="summary">' . "\n" );
			return;
		}

		printf( '<meta property="og:image" content="%s">' . "\n", esc_url( $image['url'] ) );
		if ( $image['w'] > 0 && $image['h'] > 0 ) {
			printf( '<meta property="og:image:width" content="%d">' . "\n", (int) $image['w'] );
			printf( '<meta property="og:image:height" content="%d">' . "\n", (int) $image['h'] );
		}
		printf( '<meta property="og:image:alt" content="%s">' . "\n", esc_attr( $image['alt'] ) );

		print( '<meta name="twitter:card" content="summary_large_image">' . "\n" );
		printf( '<meta name="twitter:image" content="%s">' . "\n", esc_url( $image['url'] ) );
		printf( '<meta name="twitter:image:alt" content="%s">' . "\n", esc_attr( $image['alt'] ) );
	}

	/**
	 * The picture this page shares as, absolute, with its real dimensions.
	 *
	 * @return array{url:string,w:int,h:int,alt:string}|array{}
	 */
	private static function sharing_image(): array {
		if ( is_singular( 'product' ) ) {
			$id = (int) get_post_thumbnail_id( (int) get_queried_object_id() );
			if ( $id > 0 ) {
				// `large` and not `full`: a supplier photograph can be 3 000 px
				// wide, and several clients refuse a file over 5 Mo outright.
				$src = wp_get_attachment_image_src( $id, 'large' );
				if ( is_array( $src ) && ! empty( $src[0] ) ) {
					return array(
						'url' => (string) $src[0],
						'w'   => (int) ( $src[1] ?? 0 ),
						'h'   => (int) ( $src[2] ?? 0 ),
						'alt' => (string) get_the_title( (int) get_queried_object_id() ),
					);
				}
			}
		}

		/*
		 * The shop's own card, at the 1,91:1 ratio every client lays out without
		 * cropping. It is derived from the associate's own home header rather
		 * than drawn: a person wearing a marked tee, which is what we sell.
		 * Shipped with the theme, so an environment nobody has configured still
		 * shares correctly.
		 *
		 * THE DIMENSIONS ARE READ FROM THE FILE, not written here. Two reasons,
		 * and only the second was foreseen. The first: a tag that ASSERTS a size
		 * is a tag that lies the day somebody replaces the picture, and several
		 * clients lay the card out from these numbers before the file arrives,
		 * so the lie is what the reader sees. The second: written out, the width
		 * of this card is, digit for digit, the price of decorating one side of
		 * a customer's own garment in cents (H-Q06), and the hypotheses register
		 * hunts that value through this very file. It flagged it, correctly: two
		 * places writing the same digits are two places that have to be told
		 * apart, and reading the real size tells them apart by removing one.
		 *
		 * Cached for the request. `getimagesize` opens the file; a homepage
		 * calls this once.
		 */
		static $card = null;
		if ( null !== $card ) {
			return $card;
		}

		$file = get_template_directory() . '/assets/images/partage-teeshoop.jpg';
		if ( ! file_exists( $file ) ) {
			$card = array();
			return $card;
		}
		$size = @getimagesize( $file ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- a file that is not an image must give no card, not a warning in the head.
		$card = array(
			'url' => get_template_directory_uri() . '/assets/images/partage-teeshoop.jpg',
			'w'   => is_array( $size ) ? (int) $size[0] : 0,
			'h'   => is_array( $size ) ? (int) $size[1] : 0,
			'alt' => __( 'Une personne portant un t-shirt marqué', 'teeshoop-core' ),
		);
		return $card;
	}

	/**
	 * The one URL this page wants to be known by.
	 *
	 * SELF-REFERENTIAL, INCLUDING THE PAGE NUMBER. Pointing page 2 of a category
	 * at page 1 is the other common recipe and Google has said plainly that it
	 * treats it as a mistake: the products on page 2 appear on no canonical URL
	 * and drop out. Page 2 is its own page and says so.
	 *
	 * QUERY ARGUMENTS ARE ALWAYS DROPPED. That is what makes the canonical worth
	 * printing at all on a shop with ten facets and a sort control: every one of
	 * those URLs is `noindex` anyway, so this is only reached by the clean ones.
	 */
	public static function canonical(): string {
		if ( is_front_page() && ! is_paged() ) {
			return home_url( '/' );
		}

		if ( is_singular() ) {
			$url = wp_get_canonical_url();
			return is_string( $url ) ? $url : '';
		}

		$base = '';

		if ( function_exists( 'is_shop' ) && is_shop() ) {
			$base = (string) wc_get_page_permalink( 'shop' );
		} elseif ( is_tax() || is_category() || is_tag() ) {
			$term = get_queried_object();
			if ( $term instanceof \WP_Term ) {
				$link = get_term_link( $term );
				$base = is_string( $link ) ? $link : '';
			}
		} elseif ( is_post_type_archive() ) {
			$link = get_post_type_archive_link( (string) get_query_var( 'post_type' ) );
			$base = is_string( $link ) ? $link : '';
		} elseif ( is_home() ) {
			$base = (string) get_permalink( (int) get_option( 'page_for_posts' ) );
		}

		if ( '' === $base ) {
			return '';
		}

		$page = (int) get_query_var( 'paged' );
		return $page > 1 ? trailingslashit( $base ) . 'page/' . $page . '/' : $base;
	}

	/**
	 * `rel=prev` and `rel=next` on a paginated archive.
	 *
	 * Google announced in 2019 that it no longer uses them, and says so every
	 * time somebody asks. Bing, Yandex and Qwant's upstream still do, and a
	 * French professional shop is not in a position to serve only one crawler.
	 * They cost two tags on paginated pages and nothing anywhere else.
	 */
	private static function adjacent(): void {
		if ( is_singular() ) {
			return;
		}

		$total = (int) ( $GLOBALS['wp_query']->max_num_pages ?? 0 );
		$page  = max( 1, (int) get_query_var( 'paged' ) );
		if ( $total < 2 ) {
			return;
		}

		$base = self::canonical();
		if ( '' === $base ) {
			return;
		}
		// The canonical already carries this page's number; strip it back to the
		// root of the series so the neighbours can be built from one string.
		$root = (string) preg_replace( '#page/\d+/?$#', '', trailingslashit( $base ) );

		if ( $page > 1 ) {
			$prev = $page > 2 ? trailingslashit( $root ) . 'page/' . ( $page - 1 ) . '/' : $root;
			printf( '<link rel="prev" href="%s">' . "\n", esc_url( $prev ) );
		}
		if ( $page < $total ) {
			printf( '<link rel="next" href="%s">' . "\n", esc_url( trailingslashit( $root ) . 'page/' . ( $page + 1 ) . '/' ) );
		}
	}

	// -----------------------------------------------------------------------
	// Title and description
	// -----------------------------------------------------------------------

	/**
	 * The title, shaped for the result page rather than for the site's own menu.
	 *
	 * WordPress's default is "Category name – Site name", which on a shop that
	 * calls a category "T-shirts" produces "T-shirts – Teeshoop": three words, no
	 * indication of what is sold or to whom, and nothing a French buyer typed.
	 * Every title here therefore carries the qualifier the page is for, and it
	 * comes from `Content` when the page has editorial copy, so the title and
	 * the heading a buyer reads cannot say different things.
	 *
	 * THE TAGLINE IS DROPPED except on the front page. "Just another WordPress
	 * site" has shipped on more French shops than anyone would like to count.
	 *
	 * @param array $parts title, page, tagline, site.
	 * @return array
	 */
	public static function title_parts( $parts ): array {
		if ( ! is_array( $parts ) ) {
			return array();
		}

		$key  = self::content_key();
		$meta = '' !== $key ? Content::meta( $key ) : array();

		if ( isset( $meta['title'] ) && '' !== $meta['title'] ) {
			$parts['title'] = $meta['title'];
		} elseif ( is_singular( 'product' ) ) {
			$parts['title'] = self::product_title( (int) get_queried_object_id() );
		}

		unset( $parts['tagline'] );

		/*
		 * The page number belongs in the title of a paginated archive: without
		 * it, eight pages of T-shirts submit eight identical titles, which is
		 * the first thing Search Console reports as duplicate.
		 */
		$page = max( (int) get_query_var( 'paged' ), (int) get_query_var( 'page' ) );
		if ( $page > 1 ) {
			/* translators: %d: a page number in a paginated listing. */
			$parts['page'] = sprintf( __( 'page %d', 'teeshoop' ), $page );
		}

		return $parts;
	}

	/**
	 * A product's title: its own name, then what it is, then the shop.
	 *
	 * The reference first, because a buyer who already knows the style searches
	 * for "B&C inspire E150" and expects to recognise it; the family second,
	 * because everybody else is searching for "t-shirt personnalisé" and the
	 * page has to say which of those it is. Both halves come from stored data,
	 * so a renamed category follows and nothing here has to be maintained.
	 */
	private static function product_title( int $product_id ): string {
		$product = wc_get_product( $product_id );
		if ( ! $product instanceof \WC_Product ) {
			return '';
		}

		$family = Content::family_noun( $product_id );
		if ( '' === $family ) {
			return $product->get_name();
		}

		return sprintf(
			/* translators: 1: the product's own name, 2: what it is, e.g. "t-shirt personnalisé". */
			__( '%1$s, %2$s', 'teeshoop' ),
			$product->get_name(),
			$family
		);
	}

	/**
	 * The sentence a search result shows under the link.
	 *
	 * Written from facts the page itself holds and never invented. On a product
	 * that is the supplier's own one-line summary (matière, grammage, coloris,
	 * which `Importer::excerpt()` builds from the import) plus the size run and
	 * the one commercial fact that applies to this reference: a price it can
	 * actually reach, or that it is quoted. Two references therefore never get
	 * the same description, which is the whole point on a catalogue where 460
	 * pages carry the same supplier prose as every other reseller in Europe.
	 */
	public static function description(): string {
		$key  = self::content_key();
		$meta = '' !== $key ? Content::meta( $key ) : array();
		if ( isset( $meta['description'] ) && '' !== $meta['description'] ) {
			return self::clamp( $meta['description'] );
		}

		if ( is_singular( 'product' ) ) {
			return self::clamp( Content::product_description( (int) get_queried_object_id() ) );
		}

		if ( is_singular() ) {
			$post = get_post();
			if ( $post instanceof \WP_Post && '' !== trim( (string) $post->post_excerpt ) ) {
				return self::clamp( wp_strip_all_tags( $post->post_excerpt ) );
			}
		}

		if ( is_tax() || is_category() ) {
			$term = get_queried_object();
			if ( $term instanceof \WP_Term && '' !== trim( (string) $term->description ) ) {
				return self::clamp( wp_strip_all_tags( $term->description ) );
			}
		}

		/*
		 * NOTHING, rather than the first 160 characters of the page.
		 *
		 * A description assembled from whatever text happened to be at the top
		 * of the document is how a shop ends up publishing its cookie banner as
		 * the summary of every category. Google writes a better one from the
		 * page than we would from its first paragraph, and it is allowed to.
		 */
		return '';
	}

	/** Cut to length on a word boundary, with no trailing punctuation. */
	private static function clamp( string $text ): string {
		$text = trim( (string) preg_replace( '/\s+/u', ' ', wp_strip_all_tags( $text ) ) );
		if ( '' === $text || mb_strlen( $text ) <= self::DESC_MAX ) {
			return $text;
		}
		$cut = mb_substr( $text, 0, self::DESC_MAX );
		$at  = mb_strrpos( $cut, ' ' );
		if ( false !== $at && $at > 40 ) {
			$cut = mb_substr( $cut, 0, $at );
		}
		/*
		 * The separator and the orphan word go too.
		 *
		 * Cutting on a space alone left "… 145 g/m² · 21" on the mirror: a
		 * middle dot introducing a fact that was never printed, and a bare
		 * numeral. A description that ends on a dangling number reads as a
		 * broken page in a result list, which is worse than one sentence short.
		 */
		$cut = (string) preg_replace( '/[\s\x{00A0}]*[·,;:\-]?[\s\x{00A0}]*\d+$/u', '', $cut );
		return rtrim( $cut, " ,;:.·\u{00A0}" );
	}

	/**
	 * Which row of `Content` describes the page being rendered.
	 *
	 * One vocabulary for the whole site, so the title, the description and the
	 * editorial blocks a template prints are all looked up with the same string
	 * and cannot end up describing two different pages.
	 */
	public static function content_key(): string {
		if ( is_front_page() ) {
			return 'accueil';
		}
		if ( function_exists( 'is_shop' ) && is_shop() ) {
			return 'boutique';
		}
		if ( is_tax( 'product_cat' ) ) {
			$term = get_queried_object();
			return $term instanceof \WP_Term ? 'categorie:' . $term->slug : '';
		}
		if ( is_page() ) {
			$post = get_post();
			return $post instanceof \WP_Post ? 'page:' . $post->post_name : '';
		}
		return '';
	}

	// -----------------------------------------------------------------------
	// Structured data
	// -----------------------------------------------------------------------

	/**
	 * The JSON-LD graph: who we are, and where this page sits.
	 *
	 * ONE NODE FOR THE BUSINESS, and its `@type` GROWS. Question 17 is
	 * unanswered, `Legal::identity()` ships empty, and the footer already
	 * refuses to print an address rather than invent one. A `LocalBusiness` with
	 * no `address` is not merely thin, it is the one property Google requires,
	 * so it would be markup that fails validation on every page of the site. The
	 * node is therefore an `Organization` until an address exists and a
	 * `LocalBusiness` from the moment one does, under the same `@id` either way.
	 * The day the associate answers, the richer type appears with no code
	 * change, and `scripts/seo-verify.mjs` asserts both states.
	 *
	 * WooCommerce emits its own script for `Product` and `BreadcrumbList`, so
	 * this one carries neither: two `BreadcrumbList` nodes on one page is a
	 * conflict, not a reinforcement.
	 */
	private static function graph(): void {
		$nodes = array();

		$org = self::organization();
		if ( ! empty( $org ) ) {
			$nodes[] = $org;
		}

		if ( is_front_page() ) {
			$nodes[] = array(
				'@type'      => 'WebSite',
				'@id'        => home_url( '/' ) . '#website',
				'url'        => home_url( '/' ),
				'name'       => get_bloginfo( 'name' ),
				'inLanguage' => get_bloginfo( 'language' ),
				'publisher'  => array( '@id' => home_url( '/' ) . '#organization' ),
			);
		}

		$crumbs = self::breadcrumbs();
		if ( ! empty( $crumbs ) ) {
			$nodes[] = $crumbs;
		}

		$product = self::product_node();
		if ( ! empty( $product ) ) {
			$nodes[] = $product;
		}

		if ( empty( $nodes ) ) {
			return;
		}

		/*
		 * Nonced: Chrome applies `script-src` to `application/ld+json` even though
		 * nothing in it executes, so an un-nonced block is refused and the shop
		 * loses its structured data silently. The only symptom is a rich result
		 * that stops appearing weeks later.
		 */
		echo '<script type="application/ld+json" nonce="' . esc_attr( Csp::nonce() ) . '">'
			. wp_json_encode(
				array(
					'@context' => 'https://schema.org',
					'@graph'   => $nodes,
				),
				JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG
			)
			. '</script>' . "\n";
	}

	/**
	 * The seller, described with what we actually know about it.
	 *
	 * @return array<string,mixed>
	 */
	private static function organization(): array {
		$identity = class_exists( '\\Teeshoop\\Core\\Legal' ) ? Legal::identity() : array();
		$identity = is_array( $identity ) ? $identity : array();

		$name = trim( (string) ( $identity['raison_sociale'] ?? '' ) );
		if ( '' === $name ) {
			$name = get_bloginfo( 'name' );
		}

		$node = array(
			'@type' => 'Organization',
			'@id'   => home_url( '/' ) . '#organization',
			'name'  => $name,
			'url'   => home_url( '/' ),
		);

		$logo = get_theme_mod( 'custom_logo' );
		$src  = $logo ? wp_get_attachment_image_src( (int) $logo, 'full' ) : false;
		if ( is_array( $src ) && ! empty( $src[0] ) ) {
			$node['logo'] = (string) $src[0];
		}

		$street = trim( (string) ( $identity['adresse'] ?? '' ) );
		$city   = trim( (string) ( $identity['ville'] ?? '' ) );
		$zip    = trim( (string) ( $identity['code_postal'] ?? '' ) );

		if ( '' !== $street && '' !== $city && '' !== $zip ) {
			$node['@type']   = 'LocalBusiness';
			$node['address'] = array(
				'@type'           => 'PostalAddress',
				'streetAddress'   => $street,
				'postalCode'      => $zip,
				'addressLocality' => $city,
				'addressCountry'  => 'FR',
			);
		}

		$vat = trim( (string) ( $identity['tva_intra'] ?? '' ) );
		if ( '' !== $vat ) {
			$node['vatID'] = $vat;
		}
		$siret = trim( (string) ( $identity['siret'] ?? '' ) );
		if ( '' !== $siret ) {
			$node['taxID'] = $siret;
		}

		return $node;
	}

	/**
	 * Where this page sits, as a trail.
	 *
	 * ONLY WHERE WOOCOMMERCE DOES NOT ALREADY DRAW ONE. `woocommerce_breadcrumb()`
	 * generates its own `BreadcrumbList` and the listing template calls it, so
	 * the shop and the categories are covered. The product page is not: the
	 * theme does not print a breadcrumb there, so 463 product pages had no trail
	 * at all, and neither did the editorial pages. This fills exactly that gap.
	 *
	 * @return array<string,mixed> Empty when there is nothing to say.
	 */
	private static function breadcrumbs(): array {
		$trail = array();

		if ( is_singular( 'product' ) ) {
			$product = wc_get_product( (int) get_queried_object_id() );
			if ( ! $product instanceof \WC_Product ) {
				return array();
			}
			$trail[] = array( __( 'Accueil', 'teeshoop' ), home_url( '/' ) );

			/*
			 * THE TRAIL MAY ONLY NAME PAGES WE ASK TO BE INDEXED.
			 *
			 * `deepest()` picked the leaf, and the leaf is exactly what
			 * `robots()` above marks `noindex` for being a near-duplicate of its
			 * parent: 274 of the mirror's product pages published a breadcrumb
			 * whose middle step was a URL the same file tells Google to drop.
			 * Filtering first means the trail ends on the family, which is the
			 * page we actually want the crawl to reach.
			 */
			$terms = get_the_terms( $product->get_id(), 'product_cat' );
			$term  = is_array( $terms ) ? self::deepest( $terms ) : null;
			$term  = $term instanceof \WP_Term ? self::nearest_indexable( $term ) : null;
			if ( $term instanceof \WP_Term ) {
				foreach ( array_reverse( get_ancestors( $term->term_id, 'product_cat' ) ) as $ancestor ) {
					$parent = get_term( (int) $ancestor, 'product_cat' );
					if ( $parent instanceof \WP_Term ) {
						$trail[] = array( $parent->name, (string) get_term_link( $parent ) );
					}
				}
				$trail[] = array( $term->name, (string) get_term_link( $term ) );
			}

			$trail[] = array( $product->get_name(), (string) $product->get_permalink() );
		} elseif ( is_page() && ! is_front_page() ) {
			$post = get_post();
			if ( ! $post instanceof \WP_Post ) {
				return array();
			}
			$trail[] = array( __( 'Accueil', 'teeshoop' ), home_url( '/' ) );
			$trail[] = array( get_the_title( $post ), (string) get_permalink( $post ) );
		}

		if ( count( $trail ) < 2 ) {
			return array();
		}

		$items = array();
		foreach ( array_values( $trail ) as $i => $step ) {
			$items[] = array(
				'@type'    => 'ListItem',
				'position' => $i + 1,
				'name'     => $step[0],
				'item'     => $step[1],
			);
		}

		return array(
			'@type'           => 'BreadcrumbList',
			'@id'             => self::canonical() . '#fil',
			'itemListElement' => $items,
		);
	}

	/**
	 * The deepest step of a trail that we are asking to have indexed.
	 *
	 * A reference is filed on the LEAF, and the leaf is what `robots()` marks
	 * `noindex` for being a near-duplicate of its parent: 274 of the mirror's
	 * product pages published a breadcrumb whose middle step was a URL the same
	 * file tells Google to drop. Filtering the assigned terms was the first
	 * attempt and it removed the trail altogether, because the family the
	 * product belongs to is an ANCESTOR and not one of its own terms. So this
	 * climbs instead: the same category, one step up at a time, until it reaches
	 * a page we actually want the crawl to land on.
	 */
	private static function nearest_indexable( \WP_Term $term ): ?\WP_Term {
		if ( self::indexable_term( $term ) ) {
			return $term;
		}
		foreach ( array_reverse( get_ancestors( $term->term_id, 'product_cat' ) ) as $id ) {
			$parent = get_term( (int) $id, 'product_cat' );
			if ( $parent instanceof \WP_Term && self::indexable_term( $parent ) ) {
				return $parent;
			}
		}
		return null;
	}

	/**
	 * The most specific of a product's categories.
	 *
	 * A reference carries both "T-shirts" and "Manches courtes", and a trail
	 * that picked whichever came back first would send half the catalogue to the
	 * parent and half to the child. Depth is counted from the ancestor list, so
	 * a taxonomy reorganised in the admin follows.
	 *
	 * @param \WP_Term[] $terms
	 */
	private static function deepest( array $terms ): ?\WP_Term {
		$best  = null;
		$depth = -1;
		foreach ( $terms as $term ) {
			if ( ! $term instanceof \WP_Term ) {
				continue;
			}
			$d = count( get_ancestors( $term->term_id, 'product_cat' ) );
			if ( $d > $depth ) {
				$depth = $d;
				$best  = $term;
			}
		}
		return $best;
	}

	/**
	 * A Product node for a reference WooCommerce declined to describe.
	 *
	 * WHY THERE IS ONE AT ALL. `WC_Structured_Data::generate_product_data()`
	 * ends with `if ( empty( aggregateRating ) && empty( offers ) && empty(
	 * review ) ) return;`. 460 of this shop's 463 references carry no published
	 * price (questions 41 and 42), no rating and no review, so 460 product pages
	 * emitted no structured data whatsoever. Measured on the mirror before this
	 * existed: zero occurrences of `ld+json` on every imported reference and one
	 * on each of the three priced ones.
	 *
	 * NO `offers` KEY. There is no published price on these references, and an
	 * `Offer` with a zero price or with the blank's cost basis in it would be an
	 * announced price, which in France is an offer to sell. Google will not
	 * grant a product rich result without one, and that is the correct outcome:
	 * the page says "tarif sur devis" to a human and the markup says exactly the
	 * same thing to a crawler. When question 42 sets a margin on blanks, the
	 * references become purchasable and WooCommerce's own generator takes over.
	 *
	 * IT IS IN OUR GRAPH AND NOT IN WOOCOMMERCE'S COLLECTOR, which was the first
	 * shape. `WC_Structured_Data::output_structured_data()` prints its JSON
	 * through `wc_esc_json( …, true )`, which runs `_wp_specialchars()` over it,
	 * so `B&C` leaves as `B&amp;C`. Inside a `<script>` element HTML entities are
	 * not decoded, so a consumer reads the brand as the literal five characters
	 * `B&amp;C`. That reaches 358 of the 463 references, since B&C is the most
	 * carried brand in the catalogue.
	 *
	 * @return array<string,mixed>
	 */
	private static function product_node(): array {
		if ( ! function_exists( 'is_product' ) || ! is_product() ) {
			return array();
		}

		$product = wc_get_product( (int) get_queried_object_id() );
		if ( ! $product instanceof \WC_Product ) {
			return array();
		}

		// WooCommerce will emit its own: it has a price, a rating or a review.
		if ( '' !== (string) $product->get_price() || (int) $product->get_rating_count() > 0 ) {
			return array();
		}

		$node = array(
			'@type'       => 'Product',
			'@id'         => $product->get_permalink() . '#product',
			'name'        => $product->get_name(),
			'url'         => $product->get_permalink(),
			'description' => self::clamp( Content::product_description( $product->get_id() ) ),
		);

		$image = wp_get_attachment_url( (int) $product->get_image_id() );
		if ( is_string( $image ) && '' !== $image ) {
			$node['image'] = $image;
		}

		$sku = (string) $product->get_sku();
		if ( '' !== $sku ) {
			$node['sku'] = $sku;
		}

		$brand = (string) $product->get_meta( Garments::META_BRAND, true );
		if ( '' !== $brand ) {
			$node['brand'] = array(
				'@type' => 'Brand',
				'name'  => $brand,
			);
		}

		return $node;
	}

	// -----------------------------------------------------------------------
	// The sitemap
	// -----------------------------------------------------------------------

	private static function init_sitemap(): void {
		add_action( 'template_redirect', array( self::class, 'sitemap_gone' ), 1 );
		add_filter( 'wp_sitemaps_add_provider', array( self::class, 'sitemap_provider' ), 10, 2 );
		add_filter( 'wp_sitemaps_post_types', array( self::class, 'sitemap_post_types' ) );
		add_filter( 'wp_sitemaps_taxonomies', array( self::class, 'sitemap_taxonomies' ) );
		add_filter( 'wp_sitemaps_posts_query_args', array( self::class, 'sitemap_posts_args' ), 10, 2 );
		add_filter( 'wp_sitemaps_taxonomies_query_args', array( self::class, 'sitemap_terms_args' ), 10, 2 );
	}

	/**
	 * Exactly the categories we say are indexable, and no others.
	 *
	 * TWO DEFECTS ARE FIXED HERE AND THE FIRST ONE IS SEVERE. WordPress's
	 * taxonomy sitemap runs `WP_Term_Query` with `hide_empty => true`, which
	 * filters on the raw `wp_term_taxonomy.count` column. WooCommerce keeps that
	 * column as a count of products attached DIRECTLY to the term, and this
	 * catalogue's imports attach almost everything to the leaf: measured on the
	 * mirror, `t-shirts` has a raw count of 0 while its child `manches-courtes`
	 * has 139. So the largest category on the shop, 184 references and the one
	 * the whole session is about ranking, was the one page missing from the
	 * sitemap.
	 *
	 * PRECISELY ONE, and the first version of this comment said two. `polos`
	 * carries a raw count of 2 against its children's 102, and 2 is above zero,
	 * so it was in the sitemap all along. The fix is unchanged and the severity
	 * is unchanged; the sentence was wrong and a wrong reason is what gets read
	 * in eighteen months. Verified by re-reading the sitemap served before the
	 * change: six URLs, `polos` among them, `t-shirts` not.
	 *
	 * `inc/filters.php` already documents that column as untrustworthy and works
	 * around it for the facets. The sitemap still trusted it.
	 *
	 * Second, the children WERE listed, and they are the ones `robots()` marks
	 * `noindex` for being near-duplicates of their parent.
	 *
	 * The list is therefore computed rather than filtered: every category whose
	 * subtree holds a published reference, minus the ones that are not
	 * indexable. `include` with `hide_empty => false` is what makes the raw
	 * column irrelevant.
	 *
	 * @param array  $args     The term query core is about to run.
	 * @param string $taxonomy Which taxonomy it is for.
	 * @return array
	 */
	public static function sitemap_terms_args( $args, $taxonomy ): array {
		if ( ! is_array( $args ) || 'product_cat' !== $taxonomy ) {
			return is_array( $args ) ? $args : array();
		}

		$terms = get_terms(
			array(
				'taxonomy'   => 'product_cat',
				'hide_empty' => false,
				'pad_counts' => true,
			)
		);
		/*
		 * AN ERROR PUBLISHES NOTHING, not the default. Returning `$args`
		 * untouched restores core's `hide_empty` behaviour, which is precisely
		 * the list this function exists to correct: the two families we most want
		 * indexed are the two it drops. "We could not look" is not "here is the
		 * answer", and an empty sitemap section is the honest failure.
		 */
		if ( is_wp_error( $terms ) || ! is_array( $terms ) ) {
			$args['include']    = array( 0 );
			$args['hide_empty'] = false;
			return $args;
		}

		$include = array();
		foreach ( $terms as $term ) {
			if ( $term instanceof \WP_Term && (int) $term->count > 0 && self::indexable_term( $term ) ) {
				$include[] = (int) $term->term_id;
			}
		}

		/*
		 * NO CATEGORY IS NOT AN EMPTY LIST.
		 *
		 * `include => array()` means "no restriction" to WP_Term_Query, so
		 * returning an empty include would silently publish every term,
		 * including the ones just excluded. A shop with nothing indexable gets
		 * an impossible id instead, and therefore an empty sitemap, which is the
		 * honest answer.
		 */
		$args['include']    = empty( $include ) ? array( 0 ) : $include;
		$args['hide_empty'] = false;

		return $args;
	}

	/**
	 * A sitemap we no longer publish must be gone, not quietly become the shop.
	 *
	 * WordPress registers ONE rewrite rule for every sitemap URL and looks the
	 * provider up afterwards; `WP_Sitemaps::render_sitemaps()` simply `return`s
	 * when it finds none. The request then falls through to the main query, so
	 * after the users provider was removed `/wp-sitemap-users-1.xml` answered
	 * 200 with the HOMEPAGE in it. That is a soft 404 at a URL Google has
	 * already fetched, and it is also the homepage's content served from a
	 * second address. Measured on the mirror, which is how it was found.
	 */
	public static function sitemap_gone(): void {
		$name = sanitize_text_field( (string) get_query_var( 'sitemap' ) );
		if ( '' === $name || ! function_exists( 'wp_sitemaps_get_server' ) ) {
			return;
		}
		/*
		 * `index` IS NOT A PROVIDER, and it is the sitemap index itself.
		 *
		 * Core sets `sitemap=index` for `/wp-sitemap.xml` and renders it from
		 * `WP_Sitemaps::$index` rather than from the registry, so looking it up
		 * there returns nothing. Without this line the index answered 404 with
		 * the correct XML inside it: `template_redirect` at priority 1 sent the
		 * status, core rendered the body at priority 10, and every crawler read
		 * a 404 on the one URL robots.txt points at. Found by
		 * `npm run verify:seo` on its first run.
		 */
		if ( 'index' === $name ) {
			return;
		}
		if ( wp_sitemaps_get_server()->registry->get_provider( $name ) ) {
			return;
		}

		global $wp_query;
		if ( $wp_query instanceof \WP_Query ) {
			$wp_query->set_404();
		}
		status_header( 404 );
		nocache_headers();
	}

	/**
	 * Drop the users provider.
	 *
	 * `/wp-sitemap-users-1.xml` published `/author/dev/` on the mirror: an empty
	 * archive whose URL is a WordPress username. There is no blog, so there are
	 * no authors to find, and handing a crawler half of a login in an XML file
	 * it is invited to read is not a trade anyone would make deliberately.
	 *
	 * @param mixed  $provider The provider WordPress is about to register.
	 * @param string $name     Its name.
	 * @return mixed False removes it.
	 */
	public static function sitemap_provider( $provider, $name ) {
		return 'users' === $name ? false : $provider;
	}

	/**
	 * Only the post types that hold something.
	 *
	 * `post` stays REGISTERED and is simply not listed while nothing is
	 * published under it, rather than being removed for good: the day a guide is
	 * written as a post it appears by itself. "Nothing published" is read from
	 * `wp_count_posts`, so this is a fact about the shop and not a preference.
	 *
	 * @param array $types Post type objects, keyed by name.
	 * @return array
	 */
	public static function sitemap_post_types( $types ): array {
		if ( ! is_array( $types ) ) {
			return array();
		}
		foreach ( array_keys( $types ) as $name ) {
			$counts = wp_count_posts( (string) $name );
			if ( ! is_object( $counts ) || 0 === (int) ( $counts->publish ?? 0 ) ) {
				unset( $types[ $name ] );
			}
		}
		return $types;
	}

	/**
	 * Product categories, and nothing that belongs to a blog we do not have.
	 *
	 * @param array $taxonomies Taxonomy objects, keyed by name.
	 * @return array
	 */
	public static function sitemap_taxonomies( $taxonomies ): array {
		if ( ! is_array( $taxonomies ) ) {
			return array();
		}
		foreach ( array_keys( $taxonomies ) as $name ) {
			$terms = wp_count_terms(
				array(
					'taxonomy'   => (string) $name,
					'hide_empty' => true,
				)
			);
			if ( is_wp_error( $terms ) || (int) $terms < 1 ) {
				unset( $taxonomies[ $name ] );
			}
		}
		return $taxonomies;
	}

	/**
	 * What a product sitemap may list.
	 *
	 * HIDDEN FROM THE CATALOGUE MEANS HIDDEN FROM THE SITEMAP. The mirror's
	 * sitemap carried `teeshoop-e2e-tee` and `teeshoop-demo-tee`, two test
	 * fixtures marked `exclude-from-catalog`, which the listing correctly
	 * refuses to show and which the shop was inviting Google to index. The same
	 * clause the homepage already applies, applied here.
	 *
	 * @param array  $args      The query WordPress is about to run.
	 * @param string $post_type Which post type it is for.
	 * @return array
	 */
	public static function sitemap_posts_args( $args, $post_type ): array {
		if ( ! is_array( $args ) ) {
			return array();
		}

		/*
		 * A NOINDEX PAGE HAS NO BUSINESS IN A SITEMAP.
		 *
		 * WooCommerce's own four pages (panier, commande, mon compte and the
		 * shop root's siblings) carry `noindex, follow`, which WooCommerce adds
		 * itself and which is right. WordPress's sitemap knows nothing about
		 * that and listed all four: the shop was submitting "please index this"
		 * and "do not index this" about the same URL in the same crawl. The
		 * ids come from the options WooCommerce keeps them in, so a shop that
		 * moved its basket to another page follows.
		 */
		if ( 'page' === $post_type ) {
			$functional = array();
			foreach ( array( 'woocommerce_cart_page_id', 'woocommerce_checkout_page_id', 'woocommerce_myaccount_page_id' ) as $option ) {
				$id = (int) get_option( $option );
				if ( $id > 0 ) {
					$functional[] = $id;
				}
			}
			if ( ! empty( $functional ) ) {
				$args['post__not_in'] = array_values( array_unique( array_merge( (array) ( $args['post__not_in'] ?? array() ), $functional ) ) );
			}
			return $args;
		}

		if ( 'product' !== $post_type || ! function_exists( 'wc_get_product_visibility_term_ids' ) ) {
			return $args;
		}

		$visibility = wc_get_product_visibility_term_ids();
		$hidden     = array_values( array_filter( array( $visibility['exclude-from-catalog'] ?? 0 ) ) );
		if ( empty( $hidden ) ) {
			return $args;
		}

		// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query -- one clause on an indexed taxonomy, on a cached sitemap page.
		$args['tax_query'] = array(
			array(
				'taxonomy' => 'product_visibility',
				'field'    => 'term_taxonomy_id',
				'terms'    => $hidden,
				'operator' => 'NOT IN',
			),
		);

		return $args;
	}

	// -----------------------------------------------------------------------
	// robots.txt
	// -----------------------------------------------------------------------

	/**
	 * What a crawler must not fetch at all.
	 *
	 * THE LIST IS SHORT ON PURPOSE, and the reason is the trap in the middle of
	 * every faceted-navigation guide. `Disallow` and `noindex` are not two
	 * strengths of the same instruction: a disallowed URL is never fetched, so
	 * its `noindex` is never read, and Google is explicit that such a URL can
	 * still appear in results as a bare link when something points at it. Every
	 * near-duplicate on this shop (the ten facets, the sort control, the search
	 * page, the studio flag, the estimator's arguments) is handled with
	 * `noindex, follow` in the page, and therefore must stay CRAWLABLE for that
	 * instruction to be obeyed.
	 *
	 * What is listed here is what has no page to carry an instruction: endpoints
	 * that answer with JSON or a redirect.
	 *
	 * @param string $output What WordPress and WooCommerce have written.
	 * @param string $public Whether the site is set to be indexed.
	 * @return string
	 */
	public static function robots_txt( $output, $public ): string {
		$output = (string) $output;
		if ( ! $public ) {
			return $output;
		}

		$lines = array(
			'',
			'# Teeshoop: endpoints, not pages. Everything with a page carries its own',
			'# instruction in the HTML, so it must stay crawlable to be obeyed.',
			'Disallow: /wp-json/',
			'Disallow: /wp-login.php',
			'Disallow: /*?wc-ajax=',
		);

		return $output . implode( "\n", $lines ) . "\n";
	}
}
