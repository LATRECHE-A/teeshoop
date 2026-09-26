<?php
/**
 * The shop's editorial copy, and the numbers it is not allowed to contain.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE WORDS ARE IN THE REPOSITORY AND NOT IN THE DATABASE
 *
 * The obvious home for a category's text is `wp_term_taxonomy.description`, and
 * for a landing page it is the post content. Both put a thousand words of
 * commercial promise somewhere no diff can review and no gate can check, which
 * is the same objection this project made to a block theme and to an SEO plugin.
 * The copy on these pages states a minimum order, a lead time, a print size and
 * what we can and cannot print. Every one of those is a promise some other file
 * has to keep, and the day one of them changes, a paragraph in a database is the
 * last place anybody looks.
 *
 * SO IT IS HERE, and the templates render it. Anything the associate types into
 * the WordPress editor still appears, above what the template draws, so the
 * admin screen is not a dead end; `Content::notice()` says so on screen to
 * whoever has the capability to be confused by it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOT ONE NUMBER IN THIS FILE IS A NUMBER
 *
 * Every figure is a SLOT: `{MINIMUM_PIECES}`, `{DELAI_STANDARD}`,
 * `{ZONE_TSHIRT}`. `fill()` resolves them at render time from the same
 * authorities the basket, the workshop calendar and the studio read, so a
 * landing page cannot promise five pieces while `Cart` refuses under eight, and
 * cannot print 30,5 cm while the press is set to something else. This is the
 * rule `front-page.php` already states for the homepage, applied to a body of
 * text large enough that nobody would notice it drifting.
 *
 * A SLOT THAT CANNOT BE RESOLVED REMOVES ITS SENTENCE. Not "renders as zero",
 * not "renders as `{DELAI_STANDARD}`". The shop already learned this when a
 * deactivated plugin made every page of the site advertise « Commande minimum :
 * 0 pièces » in the footer: a missing number is an omitted line.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class Content {

	/** Resolved slot values for this request, or null before the first look. */
	private static ?array $slots = null;

	/** Which slots were asked for and had no value. Read by `notice()`. */
	private static array $unresolved = array();

	public static function init(): void {
		add_action( 'admin_notices', array( self::class, 'notice' ) );
	}

	// -----------------------------------------------------------------------
	// Lookup
	// -----------------------------------------------------------------------

	/** Whether this page has copy of its own. */
	public static function has( string $key ): bool {
		return isset( self::pages()[ $key ] );
	}

	/**
	 * The title and description for a page, with the slots resolved.
	 *
	 * @return array{title:string,description:string}
	 */
	public static function meta( string $key ): array {
		$page = self::pages()[ $key ] ?? array();
		return array(
			'title'       => self::fill( (string) ( $page['title'] ?? '' ) ),
			'description' => self::fill( (string) ( $page['description'] ?? '' ) ),
		);
	}

	/**
	 * Everything a template draws for a page, slots resolved, gaps removed.
	 *
	 * A section whose every paragraph lost its slot disappears with them: a
	 * heading with nothing under it is worse than no heading, and this file's
	 * whole point is that the page degrades honestly rather than loudly.
	 *
	 * @return array{h1:string,intro:string[],sections:array,faq:array}
	 */
	public static function page( string $key ): array {
		$page = self::pages()[ $key ] ?? array();
		if ( empty( $page ) ) {
			return array(
				'h1'       => '',
				'intro'    => array(),
				'sections' => array(),
				'faq'      => array(),
			);
		}

		$sections = array();
		foreach ( (array) ( $page['sections'] ?? array() ) as $section ) {
			$paragraphs = self::fill_all( (array) ( $section['paragraphs'] ?? array() ) );
			$list       = self::fill_all( (array) ( $section['list'] ?? array() ) );
			$after      = self::fill_all( (array) ( $section['after'] ?? array() ) );
			if ( empty( $paragraphs ) && empty( $list ) && empty( $after ) ) {
				continue;
			}
			/*
			 * AND A SECTION WITH NO HEADING IS NOT A SECTION. A heading carrying
			 * a slot that will not resolve rendered as an empty `<h2>` with its
			 * paragraphs orphaned under it, which reads as a broken page rather
			 * than as one sentence fewer.
			 */
			$heading = self::fill( (string) ( $section['h2'] ?? '' ) );
			if ( '' === $heading ) {
				continue;
			}

			$sections[] = array(
				'h2'         => $heading,
				'paragraphs' => $paragraphs,
				'list'       => $list,
				// A sentence that comments on the list rather than introducing
				// it. Kept as its own key because the alternative was writing it
				// as the last paragraph, where it renders ABOVE the list it is
				// commenting on.
				'after'      => $after,
				'links'      => self::links( (array) ( $section['links'] ?? array() ) ),
			);
		}

		$faq = array();
		foreach ( (array) ( $page['faq'] ?? array() ) as $item ) {
			$question = self::fill( (string) ( $item['q'] ?? '' ) );
			$answer   = self::fill( (string) ( $item['a'] ?? '' ) );
			if ( '' !== $question && '' !== $answer ) {
				$faq[] = array(
					'q' => $question,
					'a' => $answer,
				);
			}
		}

		return array(
			'h1'       => self::fill( (string) ( $page['h1'] ?? '' ) ),
			'intro'    => self::fill_all( (array) ( $page['intro'] ?? array() ) ),
			'sections' => $sections,
			'faq'      => $faq,
		);
	}

	/**
	 * The internal links a section offers, minus the ones leading nowhere.
	 *
	 * Internal linking is most of what a body of category copy is FOR: the
	 * competitor whose category text ranks best carries 49 links out of one
	 * block. But a link is written here as a KEY, never as a URL, so a page that
	 * has not been created yet simply does not appear, exactly as
	 * `Theme\page_url()` already does for the masthead. A live link into a 404
	 * is worse than one fewer link.
	 *
	 * @param array<int,array<string,string>> $links
	 * @return array<int,array{label:string,url:string}>
	 */
	private static function links( array $links ): array {
		$out = array();
		foreach ( $links as $link ) {
			$url = self::url_for( (string) ( $link['key'] ?? '' ) );
			if ( '' === $url ) {
				continue;
			}
			$out[] = array(
				'label' => self::fill( (string) ( $link['label'] ?? '' ) ),
				'url'   => $url,
			);
		}
		return $out;
	}

	/**
	 * The content key of a product category: `categorie:{slug}` when the
	 * repository has text under its slug, else, for a top-level family, under
	 * its NAME.
	 *
	 * BY NAME BECAUSE THAT IS WHAT THE SHOP ALREADY IDENTIFIES A FAMILY BY
	 * (THE-03). The texts are keyed `categorie:t-shirts`, `categorie:polos`,
	 * `categorie:sweats`, which are the mirror's slugs; production's, inherited
	 * from the old site, are `t-shirts`, `blog-polos-personnalises` and
	 * `sweatshirts`. Measured: the Sweats page rendered its bare name with no
	 * introduction, text or FAQ, and the shop page lost two of its three family
	 * links. The names are « T-Shirts », « Polos », « Sweats » on both, and
	 * `Taxonomy::category_id()` files every import under a family BY THAT NAME,
	 * so a family renamed would stop receiving products before it stopped
	 * receiving text. Top level only: « Manches courtes » is the name of a
	 * child of two different families.
	 */
	public static function category_key( \WP_Term $term ): string {
		$by_slug = 'categorie:' . $term->slug;
		if ( self::has( $by_slug ) || 0 !== (int) $term->parent ) {
			return $by_slug;
		}
		$by_name = 'categorie:' . sanitize_title( $term->name );
		return self::has( $by_name ) ? $by_name : $by_slug;
	}

	/** The category a `categorie:` key names on this site, or null. See `category_key()`. */
	private static function category_for( string $key ): ?\WP_Term {
		$term = get_term_by( 'slug', substr( $key, 10 ), 'product_cat' );
		if ( $term instanceof \WP_Term ) {
			return $term;
		}
		$families = get_terms(
			array(
				'taxonomy'   => 'product_cat',
				'parent'     => 0,
				'hide_empty' => false,
			)
		);
		foreach ( is_array( $families ) ? $families : array() as $family ) {
			if ( $family instanceof \WP_Term && self::category_key( $family ) === $key ) {
				return $family;
			}
		}
		return null;
	}

	/** Where a content key lives on this site, or '' when it does not exist. */
	public static function url_for( string $key ): string {
		if ( str_starts_with( $key, 'categorie:' ) ) {
			$term = self::category_for( $key );
			if ( ! $term instanceof \WP_Term ) {
				return '';
			}
			$link = get_term_link( $term );
			return is_string( $link ) ? $link : '';
		}

		if ( str_starts_with( $key, 'page:' ) ) {
			$page = get_page_by_path( substr( $key, 5 ) );
			// Published only. A draft page linked from every category is a 404
			// for every visitor and a working link for the editor looking at it.
			if ( ! $page instanceof \WP_Post || 'publish' !== $page->post_status ) {
				return '';
			}
			return (string) get_permalink( $page );
		}

		if ( 'boutique' === $key ) {
			return function_exists( 'wc_get_page_permalink' ) ? (string) wc_get_page_permalink( 'shop' ) : '';
		}
		if ( 'accueil' === $key ) {
			return home_url( '/' );
		}

		return '';
	}

	// -----------------------------------------------------------------------
	// Slots
	// -----------------------------------------------------------------------

	/**
	 * Resolve `{SLOT}` occurrences, or refuse the string.
	 *
	 * Returns the empty string when any slot in it has no value, which is what
	 * makes the caller drop the sentence.
	 */
	public static function fill( string $text ): string {
		if ( '' === $text || ! str_contains( $text, '{' ) ) {
			return $text;
		}

		$slots = self::slots();
		$ok    = true;

		$filled = (string) preg_replace_callback(
			'/\{([A-Z0-9_]+)\}/',
			static function ( array $m ) use ( $slots, &$ok ): string {
				$name = $m[1];
				if ( ! isset( $slots[ $name ] ) || '' === $slots[ $name ] ) {
					$ok                      = false;
					self::$unresolved[ $name ] = true;
					return '';
				}
				return $slots[ $name ];
			},
			$text
		);

		return $ok ? $filled : '';
	}

	/**
	 * @param string[] $lines
	 * @return string[]
	 */
	private static function fill_all( array $lines ): array {
		$out = array();
		foreach ( $lines as $line ) {
			$filled = self::fill( (string) $line );
			if ( '' !== $filled ) {
				$out[] = $filled;
			}
		}
		return $out;
	}

	/**
	 * Every figure the copy is allowed to state, read from its one authority.
	 *
	 * Resolved once per request and only when a page asks for one. The counts
	 * are the expensive ones and they come from the SAME place the listing's own
	 * heading counts them, WooCommerce's maintained term counts, because a
	 * category page claiming 184 references over a grid that shows 181 is a
	 * page that reads as broken.
	 *
	 * @return array<string,string>
	 */
	public static function slots(): array {
		if ( null !== self::$slots ) {
			return self::$slots;
		}

		$slots = array();

		/*
		 * ZERO IS NOT A VALUE, IT IS AN ABSENCE, and the whole slot mechanism
		 * turned on that distinction and then got it wrong. `Money::number( 0 )`
		 * is the non-empty string "0", so a shop whose minimum had been cleared
		 * published « Nous imprimons à partir de 0 pièces, et le panier refuse en
		 * dessous » on the petites-series page, which is both false and absurd.
		 * The footer already learned this in August: a deactivated plugin
		 * advertised « Commande minimum : 0 pièces » on every page. A count that
		 * is zero removes its sentence, exactly like a count that is missing.
		 */
		$pricing = Settings::pricing();
		if ( (int) ( $pricing['min_qty'] ?? 0 ) > 0 ) {
			$slots['MINIMUM_PIECES'] = Money::number( (float) $pricing['min_qty'] );
		}
		if ( (int) ( $pricing['min_ht'] ?? 0 ) > 0 ) {
			$slots['MINIMUM_MONTANT'] = Money::format( (int) $pricing['min_ht'] );
		}
		/*
		 * BOTH ENDS OF THE QUOTE THRESHOLD, because `Pricing::needs_quote()`
		 * fires on either. A page that published the piece count alone would let
		 * a buyer plan a small run of heavily printed sweats, stay under the
		 * piece count, and meet the quote wall at the basket on the amount
		 * instead. On a page whose whole promise is "do the arithmetic before you
		 * order", half a rule is the same defect as a wrong one.
		 *
		 * Neither figure is written here, and the guard is why: it hunts the
		 * literals of every registered assumption across the repository, and it
		 * caught the first version of THIS COMMENT for naming one of them in
		 * prose. A number in a comment is a second copy that nothing updates.
		 */
		// Zero disables that half of the rule (`Pricing::needs_quote`), so it is
		// an absence here too and its sentence goes with it.
		if ( (int) ( $pricing['quote_from_qty'] ?? 0 ) > 0 ) {
			$slots['SEUIL_DEVIS'] = Money::number( (float) $pricing['quote_from_qty'] );
		}
		if ( (int) ( $pricing['quote_from_ht'] ?? 0 ) > 0 ) {
			$slots['SEUIL_DEVIS_MONTANT'] = Money::format( (int) $pricing['quote_from_ht'] );
		}

		$production = class_exists( '\\Teeshoop\\Core\\Production' ) ? Production::config() : array();
		$lead       = (int) ( $production['lead_days']['standard'] ?? 0 );
		if ( $lead > 0 ) {
			$slots['DELAI_STANDARD'] = Money::number( (float) $lead );
		}
		$ship = (int) ( $production['ship_days'] ?? 0 );
		if ( $ship > 0 ) {
			$slots['DELAI_TRANSPORT'] = Money::number( (float) $ship );
		}
		if ( $lead > 0 && $ship > 0 ) {
			$slots['DELAI_TOTAL'] = Money::number( (float) ( $lead + $ship ) );
		}

		foreach ( self::family_counts() as $name => $count ) {
			if ( $count > 0 ) {
				$slots[ $name ] = Money::number( (float) $count );
			}
		}

		$colours = wp_count_terms(
			array(
				'taxonomy'   => 'pa_couleur',
				'hide_empty' => false,
			)
		);
		if ( ! is_wp_error( $colours ) && (int) $colours > 0 ) {
			$slots['NB_COLORIS'] = Money::number( (float) (int) $colours );
		}

		if ( class_exists( '\\Teeshoop\\Core\\Swatch' ) ) {
			$families = Swatch::families();
			if ( ! empty( $families ) ) {
				$slots['NB_FAMILLES_COULEUR'] = Money::number( (float) count( $families ) );
			}
		}

		/*
		 * The print zone, from the studio's own definitions.
		 *
		 * `Garments::areas()` is generated by `scripts/gen-garment-data.mjs` and
		 * gated by `npm run verify:garments`, so the centimetres a landing page
		 * publishes are the centimetres the press is set to. This is the one
		 * figure neither competitor publishes at all, so it is also the one the
		 * copy leans on hardest, which makes it the one that must not be typed.
		 */
		if ( class_exists( '\\Teeshoop\\Core\\Garments' ) ) {
			$areas = Garments::areas( 'tee' );
			foreach ( $areas as $area ) {
				if ( 'front' === ( $area['side'] ?? '' ) ) {
					// `Garments::cm()` already carries the unit, so only the
					// second half gets one: written the obvious way this read
					// "30,5 cm × 40,6 cm cm" on every page that used it.
					$slots['ZONE_TSHIRT'] = Money::number( (float) $area['w'], 1 )
						. "\u{00A0}×\u{00A0}" . Garments::cm( (float) $area['h'] );
					break;
				}
			}
			$slots['TAILLE_MESUREE'] = Garments::priced_size( 'tee' );
		}

		self::$slots = array_filter( $slots, static fn( $v ): bool => '' !== (string) $v );
		return self::$slots;
	}

	/**
	 * How many references each published family holds.
	 *
	 * Counted from the top-level product categories, which is what the listing's
	 * own heading counts and what `Theme\catalogue_stats()` sums. A reference
	 * filed under two families is counted in both, deliberately: the number has
	 * to agree with the list a buyer checks it against.
	 *
	 * @return array<string,int>
	 */
	private static function family_counts(): array {
		static $counts = null;
		if ( null !== $counts ) {
			return $counts;
		}

		/*
		 * `hide_empty => false` and the count read below, for the reason
		 * `Theme\top_categories()` gives: `hide_empty` filters on the RAW count
		 * of products filed on the family itself, and an import files them one
		 * level down, so a family of 190 t-shirts can have a raw count of 0.
		 * The count WooCommerce puts on the term on the front end is the rolled
		 * up one, the number its own page prints.
		 */
		$counts = array();
		$terms  = get_terms(
			array(
				'taxonomy'   => 'product_cat',
				'parent'     => 0,
				'hide_empty' => false,
			)
		);
		if ( is_wp_error( $terms ) || ! is_array( $terms ) ) {
			return $counts;
		}

		/*
		 * WORDPRESS'S OWN DEFAULT CATEGORY IS NOT A FAMILY, and leaving it in the
		 * sum made a published sentence contradict itself: the restauration page
		 * printed « Au catalogue : 458 références, dont 104 polos, 184 t-shirts
		 * et 168 sweats », and the three named numbers add up to 456. The two
		 * missing ones are the shop's own fixtures, which land in
		 * « Uncategorized » because nothing else claims them. A buyer who adds
		 * the detail finds the gap. `Theme\top_categories()` already excludes it
		 * and `Seo::indexable_term()` refuses to index it; this is the third
		 * place that has to agree, and now does.
		 */
		$default = (int) get_option( 'default_product_cat', 0 );

		$total = 0;
		$by    = array(
			'categorie:t-shirts' => 'NB_TSHIRTS',
			'categorie:polos'    => 'NB_POLOS',
			'categorie:sweats'   => 'NB_SWEATS',
		);
		foreach ( $terms as $term ) {
			if ( ! $term instanceof \WP_Term || (int) $term->term_id === $default || (int) $term->count <= 0 ) {
				continue;
			}
			$total += (int) $term->count;
			$key    = self::category_key( $term );
			if ( isset( $by[ $key ] ) ) {
				$counts[ $by[ $key ] ] = (int) $term->count;
			}
		}
		$counts['NB_REFERENCES'] = $total;

		return $counts;
	}

	// -----------------------------------------------------------------------
	// Derived, per product
	// -----------------------------------------------------------------------

	/**
	 * What this reference is, in the words a buyer types.
	 *
	 * From the family the import recorded, then from the product's top-level
	 * category, then nothing. Never from the product's own name: "Tee Jays
	 * Luxury Stretch Shirt" is a polo, and a title built by pattern-matching the
	 * word "shirt" would have said t-shirt on 88 references.
	 */
	public static function family_noun( int $product_id ): string {
		$family = (string) get_post_meta( $product_id, Catalogue::META_FAMILY, true );

		$nouns = array(
			'tee'   => __( 't-shirt personnalisé', 'teeshoop' ),
			'polo'  => __( 'polo personnalisé', 'teeshoop' ),
			'sweat' => __( 'sweat personnalisé', 'teeshoop' ),
		);
		if ( isset( $nouns[ $family ] ) ) {
			return $nouns[ $family ];
		}

		$terms = get_the_terms( $product_id, 'product_cat' );
		if ( is_array( $terms ) ) {
			$slugs = array(
				't-shirts' => $nouns['tee'],
				'polos'    => $nouns['polo'],
				'sweats'   => $nouns['sweat'],
			);
			foreach ( $terms as $term ) {
				if ( $term instanceof \WP_Term && isset( $slugs[ $term->slug ] ) ) {
					return $slugs[ $term->slug ];
				}
			}
		}

		return '';
	}

	/**
	 * A description of one reference that no other reseller can publish.
	 *
	 * THE PROBLEM THIS SOLVES is the one chapter 04 names in its own SEO
	 * section: « Les descriptions fournisseurs identiques à des centaines de
	 * revendeurs sont faibles en différenciation ». The supplier's bullet list
	 * arrives verbatim on 459 references and is word for word what every other
	 * European reseller of the same B&C style publishes. Sorting that out with
	 * hand-written prose on 459 pages is not going to happen, so the difference
	 * has to be DERIVED: the material, the grammage, the colour count and the
	 * size run are facts we hold per reference, they differ from one reference
	 * to the next, and they are the four things a professional buyer compares.
	 *
	 * THE OVERLAP WITH `Importer::excerpt()` IS REAL AND IT IS NOT A SECOND
	 * IMPLEMENTATION OF ONE RULE, which is worth stating because it looks like
	 * one. That function assembles matière, grammage and coloris into the short
	 * description stored ON the product at import time, which is what a listing
	 * card prints. This one reads the same three metas back out and composes a
	 * different artefact under a different constraint: 160 characters, leading
	 * with the reference, ending on what a buyer can do about it. They are two
	 * renderings of the same facts rather than two sources of them, and the facts
	 * have one home, the meta keys. If a third caller appears, that is the moment
	 * to extract a formatter; two is not.
	 */
	public static function product_description( int $product_id ): string {
		$product = wc_get_product( $product_id );
		if ( ! $product instanceof \WC_Product ) {
			return '';
		}

		/*
		 * ASSEMBLED FROM THE STORED FIELDS, NOT FROM THE SUPPLIER'S SENTENCE.
		 *
		 * The first shape of this reused `Importer::excerpt()` verbatim, and
		 * that string leads with the full composition, which on the B&C E150 is
		 * "100% coton (peigné et ringspun, certifié biologique ou biologique en
		 * conversion)": 78 characters before the first fact a buyer compares. A
		 * 160-character description was therefore spent on the parenthesis and
		 * cut mid-phrase at "· 21". Reading the same fields separately puts the
		 * grammage, the colour count and the size run in the space available.
		 */
		$facts = array();

		/*
		 * THE FIBRES, ALL OF THEM, AND NOTHING ELSE.
		 *
		 * This cut the supplier's string at the first bracket OR COMMA, to lose
		 * the spinning process and the certifications behind it. The comma also
		 * separates fibres: measured on the mirror, 238 of the 456 references
		 * carrying a composition lost a percentage. « 50% polyester, 25% coton,
		 * 25% viscose » was published as « 50% polyester », and
		 * « 65% polyester, 35% coton ringspun piqué » as « 65% polyester », in
		 * the meta description AND in the Product node of the JSON-LD.
		 *
		 * A polycotton announced as polyester is not a shortened description, it
		 * is a false one: règlement (UE) 1007/2011 article 16 requires the full
		 * composition in a distance-selling description, and L.121-2 of the code
		 * de la consommation calls a wrong essential characteristic a misleading
		 * practice. So every « NN % fibre » fragment is KEPT and everything that
		 * is not one is dropped, and a string with no percentage in it publishes
		 * nothing rather than half of itself.
		 */
		$material = trim( (string) $product->get_meta( Garments::META_MATERIAL, true ) );
		preg_match_all( '/\d+\s*%\s*\p{L}[\p{L}\x{2019}\'\-]*/u', $material, $fibres );
		if ( ! empty( $fibres[0] ) ) {
			$facts[] = implode( ', ', $fibres[0] );
		}

		$gsm = (int) $product->get_meta( Garments::META_WEIGHT, true );
		if ( $gsm > 0 ) {
			$facts[] = Money::number( (float) $gsm ) . "\u{00A0}g/m²";
		}

		$colours = get_the_terms( $product_id, 'pa_couleur' );
		if ( is_array( $colours ) && count( $colours ) > 1 ) {
			$facts[] = sprintf(
				/* translators: %s: how many colourways the reference is made in. */
				__( '%s coloris', 'teeshoop' ),
				Money::number( (float) count( $colours ) )
			);
		}

		$sizes = self::size_run( $product );
		if ( '' !== $sizes ) {
			$facts[] = $sizes;
		}

		$noun = self::family_noun( $product_id );
		$head = '' !== $noun
			? sprintf(
				/* translators: 1: what it is, e.g. "polo personnalisé", 2: the reference's own name. */
				__( '%1$s %2$s', 'teeshoop' ),
				ucfirst( $noun ),
				$product->get_name()
			)
			: $product->get_name();

		$bits = array();
		$bits[] = empty( $facts )
			? $head . '.'
			: sprintf(
				/* translators: 1: the garment and its reference, 2: a comma-separated list of its characteristics. */
				__( '%1$s : %2$s.', 'teeshoop' ),
				$head,
				implode( ', ', $facts )
			);

		/*
		 * « IMPRESSION COMPRISE » NEEDS A PRINT, not merely a price.
		 *
		 * This asked `is_purchasable()`, which is true of any product a shop
		 * manager has priced, including a blank sold as a blank. The sentence
		 * would then have promised printing in a price that buys none, in a
		 * search result, which in France is an announced offer. The condition is
		 * the one the rest of the plugin uses to decide that a product is
		 * personalisable at all: it declares a studio garment.
		 */
		$slots = self::slots();
		$prints = class_exists( '\\Teeshoop\\Core\\Product' ) && '' !== Product::garment_of( $product_id );

		if ( $prints && $product->is_purchasable() && isset( $slots['MINIMUM_PIECES'] ) ) {
			$bits[] = sprintf(
				/* translators: %s: the minimum number of pieces. */
				__( 'Impression comprise, à partir de %s pièces.', 'teeshoop' ),
				$slots['MINIMUM_PIECES']
			);
		} elseif ( $product->is_purchasable() ) {
			$bits[] = __( 'Textile nu, sans marquage.', 'teeshoop' );
		} else {
			$bits[] = __( 'Tarif sur devis pour votre quantité et vos tailles.', 'teeshoop' );
		}

		return implode( ' ', $bits );
	}

	/**
	 * "Du XS au 5XL", when the attribute says so.
	 *
	 * From the size attribute's terms in their MENU ORDER, which `Taxonomy` sets
	 * from `Catalogue::size_rank()` for exactly this reason: alphabetically, 2XL
	 * comes before S and the sentence would read "du 2XL au XS".
	 */
	private static function size_run( \WC_Product $product ): string {
		$terms = get_the_terms( $product->get_id(), 'pa_taille' );
		if ( ! is_array( $terms ) || count( $terms ) < 2 ) {
			return '';
		}

		usort(
			$terms,
			static fn( \WP_Term $a, \WP_Term $b ): int =>
				(int) get_term_meta( $a->term_id, 'order', true ) <=> (int) get_term_meta( $b->term_id, 'order', true )
		);

		$first = reset( $terms );
		$last  = end( $terms );
		if ( ! $first instanceof \WP_Term || ! $last instanceof \WP_Term || $first->name === $last->name ) {
			return '';
		}

		return sprintf(
			/* translators: 1: the smallest size offered, 2: the largest. */
			__( 'du %1$s au %2$s', 'teeshoop' ),
			$first->name,
			$last->name
		);
	}

	// -----------------------------------------------------------------------
	// Saying it to the person who can be confused by it
	// -----------------------------------------------------------------------

	/**
	 * Tell an editor where the text they are looking at actually comes from.
	 *
	 * Somebody WILL open the T-shirts category in the admin, type a paragraph
	 * into the description field, save, look at the page and see nothing change.
	 * Silence there costs an afternoon and a certain amount of trust. Rendered
	 * only for somebody who can edit, on the screen where they are editing.
	 */
	public static function notice(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		if ( ! $screen instanceof \WP_Screen ) {
			return;
		}

		$key = '';
		if ( 'edit-product_cat' === $screen->id || 'term' === $screen->base ) {
			// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- reading which term is on screen.
			$term_id = isset( $_GET['tag_ID'] ) ? absint( wp_unslash( $_GET['tag_ID'] ) ) : 0;
			$term    = $term_id > 0 ? get_term( $term_id, 'product_cat' ) : null;
			if ( $term instanceof \WP_Term && self::has( self::category_key( $term ) ) ) {
				$key = self::category_key( $term );
			}
		} elseif ( 'page' === $screen->id && 'post' === $screen->base ) {
			$post = get_post();
			if ( $post instanceof \WP_Post && self::has( 'page:' . $post->post_name ) ) {
				$key = 'page:' . $post->post_name;
			}
		}

		/*
		 * AND SAY WHICH FIGURES WENT MISSING, if any did.
		 *
		 * `$unresolved` was written by `fill()` and read by nothing, so the one
		 * signal that a sentence had been silently removed did not exist. A
		 * paragraph that vanishes without a word is the failure mode this whole
		 * mechanism was built to avoid, and the person who can fix the setting is
		 * the person looking at this screen.
		 */
		if ( ! empty( self::$unresolved ) ) {
			echo '<div class="notice notice-warning"><p>';
			printf(
				/* translators: %s: comma-separated names of the figures that could not be resolved. */
				esc_html__( 'Des phrases ont été retirées de cette page parce que le chiffre qu’elles annoncent n’est réglé nulle part : %s. Renseignez-le dans les réglages, et les phrases réapparaissent.', 'teeshoop' ),
				esc_html( implode( ', ', array_keys( self::$unresolved ) ) )
			);
			echo '</p></div>';
		}

		if ( '' === $key ) {
			return;
		}

		echo '<div class="notice notice-info"><p>';
		printf(
			/* translators: %s: the identifier of the page's copy in the repository. */
			esc_html__( 'Le texte de cette page est écrit dans le dépôt (Content.php, entrée « %s ») et non ici : il doit rester d’accord avec le prix, le délai et les dimensions que le code calcule. Ce que vous saisirez dans cet écran s’affichera au-dessus, sans le remplacer.', 'teeshoop' ),
			esc_html( $key )
		);
		echo '</p></div>';
	}

	// -----------------------------------------------------------------------
	// The copy
	// -----------------------------------------------------------------------

	/**
	 * Every page that carries copy of its own.
	 *
	 * THE KEYS ARE THE SITE'S VOCABULARY, resolved by `Seo::content_key()`:
	 * `accueil`, `boutique`, `categorie:{slug}`, `page:{slug}`. A key with no
	 * entry is a page with no copy, which is a decision the indexing policy
	 * reads: `Seo` leaves a child category out of the index until somebody has
	 * written something for it, so a thin page never enters the index by
	 * default.
	 *
	 * @return array<string,array<string,mixed>>
	 */
	public static function pages(): array {
		static $pages = null;
		if ( null !== $pages ) {
			return $pages;
		}
		/*
		 * A MISSING OR BROKEN COPY FILE COSTS THE COPY, NOT THE SHOP.
		 *
		 * `require` on an absent file is a fatal, and this runs on `wp_head` of
		 * every page: a deploy that copied `includes/` and not `data/` would have
		 * taken the whole storefront down rather than dropped some paragraphs.
		 * `Hypotheses::rows()` already had this shape and for the same reason.
		 */
		$path = __DIR__ . '/../data/copy.php';
		if ( ! is_readable( $path ) ) {
			$pages = array();
			return $pages;
		}
		try {
			$pages = require $path;
		} catch ( \Throwable $e ) {
			$pages = array();
			return $pages;
		}
		$pages = is_array( $pages ) ? $pages : array();
		return $pages;
	}
}
