<?php
/**
 * The supplier catalogue, mapped onto WooCommerce.
 *
 * This file holds the SHAPE of the shop's catalogue and none of the writing:
 * everything here is a pure function of one supplier payload, so it is tested
 * by `php tests/run.php` with no WordPress and no network. `Importer.php` does
 * the writing, `Supply.php` does the fetching.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MAPPING, AND WHY IT IS THIS ONE
 *
 * ONE STYLE IS ONE VARIABLE PRODUCT. Colour and size are its two variation
 * attributes. A buyer looking for a t-shirt to print wants to compare styles,
 * not colours: 49 near-identical cards for one Gildan reference is a worse shop
 * than one card with 49 colours behind it, and it also destroys every archive,
 * every sitemap and every search result the site will ever produce.
 *
 * VARIATIONS ARE BUILT FROM THE SUPPLIER'S SKU LIST, NEVER FROM COLOUR × SIZE.
 * Measured over the 463 printable styles on 2026-08-14: the SKU list holds
 * 26 399 entries while the cross product is 29 880. Those 3 481 extra
 * combinations do not exist. Building them would publish 13 % of the catalogue
 * as garments nobody can buy, and the shop would only find out when a customer
 * ordered one, paid for it, and the supplier had no such article. Style 15009
 * alone is 49 colours and 9 sizes but 334 real SKUs, not 441.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE 320-VARIATION PRODUCT: THE TRADE-OFF, ARGUED
 *
 * It is not hypothetical. Measured distribution of real SKUs per style:
 *
 *     p50  36      p90 134      p99 292      max 366   (18009, Gildan Heavy Cotton)
 *     80 styles over 100 variations · 256 over 30
 *
 * Three ways to deal with it, and why this one:
 *
 *   1. CAP THE COLOURS. Rejected. The variation is the only object that can
 *      carry the supplier article number, so a colour with no variation is a
 *      colour we cannot order even if a customer asks for it by name. A cap is
 *      silent lost revenue on exactly the best-selling references, because
 *      those are the ones with 50 colours.
 *
 *   2. ONE PRODUCT PER COLOURWAY. Rejected. It turns 463 products into ~4 200,
 *      makes every category page a wall of the same garment, and splits the
 *      reviews, the SEO and the "which size am I" question 49 ways.
 *
 *   3. ONE PRODUCT, EVERY SKU, AND PAY THE RENDERING COST. Chosen. The cost is
 *      real but it is bounded and it lands in one place: WooCommerce switches
 *      the add-to-cart form from inline JSON to AJAX above 30 variations
 *      (`woocommerce_ajax_variation_threshold`), which 256 of our 463 styles
 *      cross, so the heavy product pages are already on the lighter path. What
 *      remains is `get_variation_prices()`, which walks every child to build the
 *      "from" range and caches the result in a transient keyed by the product.
 *      That is the four-second page, and it is a COLD page, once per product per
 *      price change. `Importer` warms it at the end of every style it writes, so
 *      the cold hit lands on the cron and not on a customer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IMAGES: WHAT IS COPIED AND WHAT IS NOT
 *
 * Measured on the live catalogue, 2026-08-14: 439 style front photos, 277 back
 * photos, 4 241 per-colour photos, averaging 63 KB each (colour chips average
 * 3,9 KB).
 *
 *   COPIED INTO WORDPRESS: the front and the back. 716 attachments, ~45 MB of
 *   originals before WordPress generates its seven derived sizes. They have to
 *   be real attachments because the archive, the cart, the order e-mail and the
 *   structured data all address an image by attachment id, and there is no
 *   honest way to fake one.
 *
 *   NOT COPIED: the 4 241 per-colour photos. That is 267 MB of originals,
 *   roughly 650 MB and 34 000 files once WordPress has resized them, and one to
 *   three hours of sideloading on shared hosting, to change one picture when a
 *   customer picks a colour. They stay on the Worker, which serves them from
 *   Cloudflare's cache with a thirty-day immutable header, and the URL is stored
 *   on the variation. `Shelf` injects it into `woocommerce_available_variation`
 *   so the photo still swaps with the colour, with no attachment and no disk.
 *
 *   NOT USED AT ALL: the colour chips. The variation photo already shows the
 *   colour, on the garment, which is what a buyer of blanks is actually judging.
 *
 *   WHAT WOULD CHANGE THE DECISION: a supplier that starts re-shooting (a copied
 *   photo goes stale and nothing tells us; a proxied one cannot), or wanting the
 *   colour photos in Google Images, which needs attachments.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY NOT HERE
 *
 * A SELLING PRICE, unless the shop has been given a margin rate. The supplier's
 * price to us is a cost input; turning it into a price needs a target margin,
 * and the Bible names the formula but explicitly leaves the rate to be decided
 * ("fixer les premiers taux de marge"). So `Settings::pricing()['blank_margin_rate']`
 * is null out of the box, no price is written, and the product is browsable but
 * not purchasable. Set it and the same import prices every variation. Inventing
 * a rate here would put a number nobody agreed to on 26 399 garments.
 *
 * THE STUDIO GARMENT (`Product::META`). An imported reference is a blank on a
 * shelf, not a personalisable product: `Pricing` prices personalisation from a
 * per-garment `base_ht`, and a product that had both that and its own supplier
 * cost would have two blank prices that could disagree. Joining the catalogue to
 * the studio is the cost engine's job (session 05), and it wants exactly one of
 * the two to win.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

require_once __DIR__ . '/Money.php';

final class Catalogue {

	// -----------------------------------------------------------------------
	// Product and variation meta
	//
	// Underscore-prefixed, so WordPress treats them as protected and the
	// product editor's custom-field box never lists them. That is presentation,
	// not protection: the real seal on the purchase price is Shelf.php, which
	// strips it from every REST representation, from the CSV export and from
	// the variation JSON the browser gets.
	// -----------------------------------------------------------------------

	/** Product: the supplier's style number. THE identity key of an import. */
	public const META_REF = '_teeshoop_ref';

	/**
	 * Product: which family this reference was imported as (tee, polo, sweat…).
	 *
	 * Load-bearing for delisting, not documentation. A run asked for `tee` must
	 * not conclude that every polo has disappeared from the supplier because it
	 * did not meet one, so the sweep only ever considers products belonging to
	 * the families the run actually walked.
	 */
	public const META_FAMILY = '_teeshoop_family';

	/** Product: the supplier's own export timestamp for this style. */
	public const META_EXPORTED = '_teeshoop_exported';

	/** Variation: the supplier's article number. The procurement key. */
	public const META_SUPPLY_SKU = '_teeshoop_supply_sku';

	/**
	 * Variation: what the supplier charges us, integer cents excl. VAT.
	 *
	 * Never rendered, never in REST, never in an export. See `Shelf::SEALED`.
	 */
	public const META_SUPPLY_CENTS = '_teeshoop_supply_cents';

	/** Variation: the per-colour photo, on the Worker, never an attachment. */
	public const META_COLOUR_PHOTO = '_teeshoop_colour_photo';

	/** Variation: country of manufacture, ISO 3166-1 alpha-2 as the supplier gives it. */
	public const META_ORIGIN = '_teeshoop_origin';

	/** Variation: the supplier is running this article out. */
	public const META_CLOSEOUT = '_teeshoop_closeout';

	/** Product: the maker's own size specification, a PDF on the supplier's host. */
	public const META_SIZESPEC = '_teeshoop_sizespec';

	/**
	 * Product: set when the grammage differs by colour.
	 *
	 * The supplier writes "195 g/m² (White: 185 g/m²)". Publishing 195 alone
	 * would be wrong for one colour out of four, and refusing to publish
	 * anything would drop the figure from 95 of 463 styles. So the headline
	 * figure is published and this flag makes the page say the rest.
	 */
	public const META_WEIGHT_VARIES = '_teeshoop_weight_varies';

	// -----------------------------------------------------------------------
	// Taxonomy
	// -----------------------------------------------------------------------

	/**
	 * Categories a French buyer recognises, keyed by the classification the
	 * Worker already derives from the supplier's own sub-categories.
	 *
	 * NOT the supplier's families, which are a mix of product types and
	 * marketing tags: style 15009 is filed under "Tee-shirts", "SANS ÉTIQUETTE"
	 * and "MEILLEURES VENTES" at once, and two of those are campaigns.
	 *
	 * Vestes and Accessoires have no entry because nothing maps to them today:
	 * the studio prints upper-body garments, so the import asks for those, and
	 * a category with no products in it is a promise the shop cannot keep.
	 */
	private const CATEGORIES = array(
		'tee'   => 'T-shirts',
		'polo'  => 'Polos',
		'sweat' => 'Sweats',
		'shirt' => 'Chemises',
		'other' => 'Autres textiles',
	);

	/**
	 * Which product families a `--famille` argument covers.
	 *
	 * `printable` is the studio's three: the shop imports what it can decorate.
	 * An unknown argument covers nothing, so a typo imports nothing rather than
	 * everything.
	 */
	public static function families( string $kind ): array {
		if ( 'all' === $kind ) {
			return array_keys( self::CATEGORIES );
		}
		if ( 'printable' === $kind ) {
			return array( 'tee', 'polo', 'sweat' );
		}
		return isset( self::CATEGORIES[ $kind ] ) ? array( $kind ) : array();
	}

	/** Sub-category by sleeve, for the two families where the supplier fills it in. */
	private const SLEEVES = array(
		'short'      => 'Manches courtes',
		'long'       => 'Manches longues',
		'sleeveless' => 'Sans manches',
	);

	/**
	 * Global attributes, in the order they should appear on a product.
	 *
	 * `variation` marks the two that make a SKU; the rest exist to be filtered
	 * on, which is what session 09's navigation will hang off.
	 */
	public const ATTRIBUTES = array(
		'couleur'       => array(
			'label'     => 'Couleur',
			'variation' => true,
		),
		'taille'        => array(
			'label'     => 'Taille',
			'variation' => true,
		),
		'marque'        => array(
			'label'     => 'Marque',
			'variation' => false,
		),
		'matiere'       => array(
			'label'     => 'Matière',
			'variation' => false,
		),
		'manches'       => array(
			'label'     => 'Manches',
			'variation' => false,
		),
		'col'           => array(
			'label'     => 'Col',
			'variation' => false,
		),
		'public'        => array(
			'label'     => 'Public',
			'variation' => false,
		),
		'certification' => array(
			'label'     => 'Certification',
			'variation' => false,
		),
	);

	/**
	 * Neckline, translated. Four values in the whole catalogue and 283 of 463
	 * styles leave it empty, so this is a closed list and not a guess: anything
	 * outside it is dropped rather than published in English on a French shop.
	 */
	private const NECKLINES = array(
		'crew neck'  => 'Col rond',
		'v-neck'     => 'Col V',
		'scoop neck' => 'Col dégagé',
	);

	/**
	 * Audience, translated, from the supplier's own closed vocabulary
	 * (measured: bébés, enfants, femmes, gender-neutral, hommes, unisexe, plus
	 * "produits correspondants").
	 *
	 * "produits correspondants" means "there is a matching item in another
	 * range". It is a merchandising cross-reference, not an audience, and it
	 * appears on 150 styles: filed as a public it would tell a buyer nothing and
	 * would sit in the filter list looking like a mistake. Absent from this map
	 * on purpose, and absent means dropped.
	 */
	private const AUDIENCES = array(
		'hommes'          => 'Homme',
		'femmes'          => 'Femme',
		'unisexe'         => 'Unisexe',
		'gender-neutral'  => 'Unisexe',
		'enfants'         => 'Enfant',
		'bébés'           => 'Bébé',
	);

	/**
	 * Adult sizes in wearing order.
	 *
	 * IT CANNOT COME FROM THE SUPPLIER'S `sizeOrder`, which is per style and
	 * therefore not comparable: "S" is order 1 on one style, 2 on another and 3
	 * on a third, depending on whether the style starts at XS or 2XS. A global
	 * attribute needs a global order, so the eleven adult sizes get one here and
	 * everything else is ranked from the numbers in its own name (below).
	 */
	private const ADULT_SIZES = array(
		'4XS',
		'3XS',
		'2XS',
		'XXS',
		'XS',
		'S',
		'M',
		'L',
		'XL',
		'2XL',
		'3XL',
		'4XL',
		'5XL',
		'6XL',
	);

	// -----------------------------------------------------------------------
	// The mapping
	// -----------------------------------------------------------------------

	/**
	 * One supplier payload → everything the importer has to write.
	 *
	 * Returns `['ok' => false, 'problems' => [...]]` when the payload cannot
	 * make a product at all. `problems` is also filled on success: a style that
	 * imported with no prices is a product a human needs to know about, and a
	 * silent partial import is how a shop ends up selling at zero.
	 *
	 * @param array $entry Decoded catalogue payload: style, prices, stock and
	 *                     the two error fields that say which kind of absence
	 *                     an absence is.
	 */
	public static function map( array $entry ): array {
		$style = is_array( $entry['style'] ?? null ) ? $entry['style'] : array();
		$ref   = self::text( $style['styleNr'] ?? '' );

		if ( '' === $ref || ! preg_match( '/^\d{4,6}$/', $ref ) ) {
			return array(
				'ok'       => false,
				'reason'   => 'malformed',
				'ref'      => $ref,
				'problems' => array( 'La référence du fournisseur est absente ou mal formée.' ),
			);
		}

		$problems = array();

		/*
		 * "No price" and "could not ask" are different, and the difference
		 * decides whether the importer may touch what is already in the shop.
		 * A network failure that read as "this style costs nothing" would wipe
		 * the purchase price off every variation of it.
		 */
		$prices      = is_array( $entry['prices'] ?? null ) ? ( $entry['prices']['prices'] ?? array() ) : null;
		$price_error = self::text( $entry['pricesError'] ?? '' );
		$currency    = is_array( $entry['prices'] ?? null ) ? self::text( $entry['prices']['currency'] ?? '' ) : '';

		/*
		 * AN EMPTY PRICE LIST IS A FAILURE, NOT A FACT.
		 *
		 * The upstream CGI answers HTTP 200 with a body for everything,
		 * including its own error documents, and the Worker caches a parsed
		 * result for an hour. A maintenance page, a truncated CSV or a renamed
		 * column all arrive here as `prices: {}` with no error at all. Every
		 * style in this catalogue has prices, so zero rows means we failed to
		 * read them, and the importer must change nothing rather than write
		 * "this garment has no cost" across 366 variations.
		 */
		if ( is_array( $prices ) && empty( $prices ) ) {
			$prices     = null;
			$problems[] = 'Le tarif est revenu vide pour cette référence : rien n’a été modifié.';
		} elseif ( null === $prices ) {
			$problems[] = 'not_found' === $price_error
				? 'Le fournisseur ne publie aucun tarif pour cette référence.'
				: 'Les tarifs n’ont pas pu être lus (' . ( $price_error ?: 'raison inconnue' ) . ').';
		} elseif ( '' !== $currency && 'EUR' !== strtoupper( $currency ) ) {
			/*
			 * THE UNIT IS NOT DECORATION.
			 *
			 * The feed carries a currency column and the Worker reads it rather
			 * than assuming; the account has always answered EUR, but a number
			 * in another currency stored as euro cents is a cost basis that is
			 * wrong by the exchange rate, in the one meta the workshop reorders
			 * against, and once a margin rate is set it becomes a selling price
			 * that is wrong by the same factor. Refuse the prices, keep what is
			 * already stored, and say so.
			 */
			$prices     = null;
			$problems[] = 'Les tarifs sont libellés en ' . $currency . ' et non en euros : ils ont été ignorés.';
		}

		/*
		 * A PAYLOAD THAT PRICES NONE OF THIS STYLE'S ARTICLES IS NOT THIS
		 * STYLE'S PRICE LIST.
		 *
		 * The upstream parser keys the map on the CSV's first column and only
		 * requires six digits, so a reshuffled or renamed column would produce a
		 * map that is large, well formed, and about something else. Every SKU
		 * then looks unpriced, and "unpriced" is a state that CLEARS the cost
		 * basis and the selling price. Covering at least one article of this
		 * style is the weakest test that distinguishes the two, and it needs no
		 * threshold anybody has to justify. A map that covers SOME of them is
		 * the deliberate case: the supplier has stopped pricing those articles.
		 */
		if ( is_array( $prices ) && ! empty( $prices ) && ! self::prices_this_style( $style, $prices ) ) {
			$prices     = null;
			$problems[] = 'Le tarif reçu ne concerne aucun article de cette référence : il a été ignoré.';
		}

		/*
		 * THE SAME RULE FOR STOCK, and it was missing.
		 *
		 * An empty price list was treated as a failure while an empty stock list
		 * was treated as a fact, and the asymmetry was invisible because the
		 * consequence is quiet: every article maps to "no figure", every
		 * existing variation keeps the quantity it had, and the run reports the
		 * style unchanged with no problem recorded. A stock feed answering 200
		 * with a maintenance page therefore looked exactly like a healthy no-op,
		 * for a whole style at a time, for as long as it lasted. Freezing the
		 * quantity is still the right response; saying nothing about it is not.
		 */
		$stock       = is_array( $entry['stock'] ?? null ) ? ( $entry['stock']['stock'] ?? array() ) : null;
		$stock_error = self::text( $entry['stockError'] ?? '' );
		if ( null === $stock ) {
			$problems[] = 'not_found' === $stock_error
				? 'Le fournisseur ne publie aucun stock pour cette référence.'
				: 'Le stock n’a pas pu être lu (' . ( $stock_error ?: 'raison inconnue' ) . ').';
		} elseif ( ! self::covers_this_style( $style, $stock ) ) {
			$stock      = null;
			$problems[] = 'Le stock reçu ne concerne aucun article de cette référence : les quantités connues ont été conservées.';
		}

		$brand       = self::text( $style['brand'] ?? '' );
		$name        = self::text( $style['name'] ?? '' );
		$kind        = self::text( $style['kind'] ?? 'other' );
		$sleeve      = self::text( $style['sleeve'] ?? 'unknown' );
		$description = self::text( $style['description'] ?? '' );

		$variations = self::variations( $style, is_array( $prices ) ? $prices : array(), is_array( $stock ) ? $stock : array() );
		if ( empty( $variations ) ) {
			/*
			 * `empty`, NOT `malformed`, and the difference is whether a cron
			 * mails somebody every night for ever.
			 *
			 * Some styles are listed in the supplier's index and carry nothing:
			 * VERIFIED on 50001 and 50101 (Fruit of the Loom polos), which come
			 * back with zero colourways, zero articles, zero sizes and no price
			 * document at all. That is a stable fact about their catalogue, not
			 * a failure of ours, and it will be true again tomorrow. Counting it
			 * as a failure makes every nightly run exit non-zero, which trains
			 * everyone to ignore the one mail that will eventually matter.
			 */
			return array(
				'ok'       => false,
				'reason'   => 'empty',
				'ref'      => $ref,
				'problems' => array_merge( $problems, array( 'Aucun article vendable sur cette référence.' ) ),
			);
		}

		$grammage = self::grammage( $description );
		$colours  = array();
		$sizes    = array();
		foreach ( $variations as $v ) {
			$colours[ $v['couleur'] ] = true;
			$sizes[ $v['taille'] ]    = true;
		}
		$sizes = array_keys( $sizes );
		usort( $sizes, static fn( string $a, string $b ): int => self::size_rank( $a ) <=> self::size_rank( $b ) );

		return array(
			'ok'            => true,
			'ref'           => $ref,
			'problems'      => $problems,
			// The brand belongs in the title: "Heavy Cotton T" is not a thing a
			// buyer searches for, "Fruit of the Loom Heavy Cotton T" is.
			'name'          => trim( $brand . ' ' . $name ) ?: ( 'Référence ' . $ref ),
			'brand'         => $brand,
			'brand_ref'     => self::text( $style['supplierRef'] ?? '' ),
			'kind'          => $kind,
			'description'   => $description,
			'material'      => self::composition( $description ),
			'weight_gsm'    => $grammage['gsm'],
			'weight_varies' => $grammage['varies'],
			'categories'    => self::categories( $kind, $sleeve ),
			'attributes'    => self::attributes( $style, $colours, $sizes, $sleeve ),
			'front'         => self::text( $style['front'] ?? '' ) ?: self::first_colour_photo( $style ),
			'back'          => self::text( $style['back'] ?? '' ),
			'sizespec'      => self::text( $style['sizespecPdf'] ?? '' ),
			'variations'    => $variations,
			'exported_at'   => self::text( $style['exportedAt'] ?? '' ),
			// Carried so the importer can tell "the supplier sent no prices"
			// from "we could not reach the supplier" without re-deriving it.
			'has_prices'    => null !== $prices,
			'has_stock'     => null !== $stock,
		);
	}

	/** Does this map hold a usable price for at least one article of this style? */
	private static function prices_this_style( array $style, array $prices ): bool {
		foreach ( (array) ( $style['skus'] ?? array() ) as $sku ) {
			$cost = $prices[ self::text( $sku['sku'] ?? '' ) ]['cost'] ?? null;
			if ( is_numeric( $cost ) && (float) $cost > 0 ) {
				return true;
			}
		}
		return false;
	}

	/** Does this map mention at least one article of this style at all? */
	private static function covers_this_style( array $style, array $map ): bool {
		foreach ( (array) ( $style['skus'] ?? array() ) as $sku ) {
			if ( isset( $map[ self::text( $sku['sku'] ?? '' ) ] ) ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * One row per SKU the supplier actually sells.
	 *
	 * A SKU with no price is kept but carries `supply_cents => null`. Dropping
	 * it would make the product's size run look shorter than it is; pricing it
	 * at zero would sell it at nothing. Null is the third answer and the
	 * importer refuses to publish a price for it.
	 */
	private static function variations( array $style, array $prices, array $stock ): array {
		$colour_names  = array();
		$colour_photos = array();
		foreach ( (array) ( $style['colourways'] ?? array() ) as $cw ) {
			$code                   = self::text( $cw['code'] ?? '' );
			$colour_names[ $code ]  = self::text( $cw['name'] ?? '' );
			$colour_photos[ $code ] = self::text( $cw['photo'] ?? '' );
		}

		$ref  = self::text( $style['styleNr'] ?? '' );
		$out  = array();
		$seen = array();

		foreach ( (array) ( $style['skus'] ?? array() ) as $sku ) {
			$supply = self::text( $sku['sku'] ?? '' );
			$code   = self::text( $sku['colourCode'] ?? '' );
			$size   = self::text( $sku['sizeName'] ?? '' );
			if ( '' === $supply || '' === $size ) {
				continue;
			}
			$colour = $colour_names[ $code ] ?? '';
			if ( '' === $colour ) {
				// A SKU whose colour is not in the colourway list cannot be
				// offered: the customer would pick a colour that is not there.
				continue;
			}

			/*
			 * OUR reference, not the supplier's.
			 *
			 * The supplier's nine-digit article number is the procurement key
			 * and it stays in private meta: it is searchable, and a customer who
			 * pastes it into Google is one result away from knowing who supplies
			 * us. The style number, a colour code and a size are opaque and
			 * unique by construction, so no collision check is needed.
			 */
			$our_sku = $ref . '-' . $code . '-' . self::slug_fragment( $size );
			/*
			 * Two size names can reduce to the same fragment: "5/6 (110/116)"
			 * and "56 (110/116)" both give 56110116. Skipping the second would
			 * silently drop a garment the supplier sells, so it gets a suffix
			 * instead. WooCommerce refuses a duplicate SKU outright, which is
			 * why this cannot simply be left to collide.
			 */
			if ( isset( $seen[ $our_sku ] ) ) {
				$n = 2;
				while ( isset( $seen[ $our_sku . '-' . $n ] ) ) {
					++$n;
				}
				$our_sku .= '-' . $n;
			}
			$seen[ $our_sku ] = true;

			$cost = $prices[ $supply ]['cost'] ?? null;
			// A cost of exactly zero is not a free garment, it is a missing
			// figure: the CSV writes 0 when it has nothing, and `parseFloat`
			// upstream already turns an unparsable field into 0.
			$cents = ( is_numeric( $cost ) && (float) $cost > 0 ) ? Money::from_eur( (float) $cost ) : null;

			/*
			 * GREEN ONLY.
			 *
			 * The stock feed gives three numbers per SKU and names none of them.
			 * Measured across 26 300 rows: green totals 4,7 M, yellow 7 935 and
			 * blue 32,4 M. A "stock" thirty times larger than the warehouse's own
			 * available figure is an announcement, not a shelf. Selling against
			 * it would take orders we cannot fill, so only the first number is
			 * treated as stock and question 43 asks the supplier what the other
			 * two are.
			 */
			$row      = $stock[ $supply ] ?? null;
			$quantity = is_array( $row ) && isset( $row[0] ) ? max( 0, (int) $row[0] ) : null;

			$out[] = array(
				'sku'          => $our_sku,
				'supply_sku'   => $supply,
				'couleur'      => $colour,
				'taille'       => $size,
				'ean'          => self::text( $sku['ean'] ?? '' ),
				'weight_kg'    => is_numeric( $sku['weightKg'] ?? null ) ? (float) $sku['weightKg'] : 0.0,
				'origin'       => self::text( $sku['coo'] ?? '' ),
				'closeout'     => ! empty( $sku['closeout'] ),
				'supply_cents' => $cents,
				'stock'        => $quantity,
				'photo'        => $colour_photos[ $code ] ?? '',
			);
		}

		return $out;
	}

	/** Category path: family, then sleeve where the supplier states one. */
	private static function categories( string $kind, string $sleeve ): array {
		$family = self::CATEGORIES[ $kind ] ?? self::CATEGORIES['other'];
		$path   = array( $family );

		/*
		 * Only for t-shirts and polos. Every sweat in the catalogue is
		 * long-sleeved (measured: 167 of 168), so the sub-category would hold
		 * the whole family and tell a buyer nothing.
		 */
		if ( in_array( $kind, array( 'tee', 'polo' ), true ) && isset( self::SLEEVES[ $sleeve ] ) ) {
			$path[] = self::SLEEVES[ $sleeve ];
		}

		return $path;
	}

	/** Attribute name → term names, dropping every attribute with nothing in it. */
	private static function attributes( array $style, array $colours, array $sizes, string $sleeve ): array {
		$brand = self::text( $style['brand'] ?? '' );

		$audiences = array();
		foreach ( explode( ',', self::text( $style['gender'] ?? '' ) ) as $part ) {
			$key = mb_strtolower( trim( $part ) );
			if ( isset( self::AUDIENCES[ $key ] ) ) {
				$audiences[ self::AUDIENCES[ $key ] ] = true;
			}
		}

		$neck    = mb_strtolower( self::text( $style['neckline'] ?? '' ) );
		$fabrics = array();
		foreach ( (array) ( $style['fabric'] ?? array() ) as $f ) {
			$f = self::text( $f );
			if ( '' !== $f ) {
				$fabrics[] = $f;
			}
		}
		$certs = array();
		foreach ( (array) ( $style['certificates'] ?? array() ) as $c ) {
			$c = self::text( $c );
			if ( '' !== $c ) {
				$certs[] = $c;
			}
		}

		$out = array(
			'couleur'       => array_keys( $colours ),
			'taille'        => $sizes,
			'marque'        => '' !== $brand ? array( $brand ) : array(),
			'matiere'       => $fabrics,
			'manches'       => isset( self::SLEEVES[ $sleeve ] ) ? array( self::SLEEVES[ $sleeve ] ) : array(),
			'col'           => isset( self::NECKLINES[ $neck ] ) ? array( self::NECKLINES[ $neck ] ) : array(),
			'public'        => array_keys( $audiences ),
			'certification' => $certs,
		);

		return array_filter( $out, static fn( array $terms ): bool => ! empty( $terms ) );
	}

	// -----------------------------------------------------------------------
	// Reading the supplier's prose
	// -----------------------------------------------------------------------

	/**
	 * The style's grammage, from the description's first bullet.
	 *
	 * The supplier publishes it as free text and nowhere else: there is no
	 * weight field in the feed. Measured over 463 styles, 364 carry exactly one
	 * figure, 95 carry a headline plus a per-colour exception, and 4 carry none.
	 *
	 * The first figure is the headline; anything after it is an exception for
	 * one colour ("·195 g/m² (White: 185 g/m²)", or the same on the next line).
	 * So the first is published and `varies` records that it is not the whole
	 * story, which is what the specification block prints beside it. Publishing
	 * only the unambiguous ones would drop the figure from a fifth of the
	 * catalogue; publishing 195 with no caveat would be wrong for one colour.
	 *
	 * `g / m²` with spaces is a real spelling in this feed (style 50117), which
	 * is why the separator is not a literal slash.
	 */
	public static function grammage( string $description ): array {
		if ( ! preg_match_all( '/(\d{2,4})\s*g\s*\/\s*m/iu', $description, $matches ) ) {
			return array(
				'gsm'    => 0,
				'varies' => false,
			);
		}
		$values = array_map( 'intval', $matches[1] );
		return array(
			'gsm'    => $values[0],
			'varies' => count( array_unique( $values ) ) > 1,
		);
	}

	/**
	 * The fibre composition, from the first bullet that states a percentage.
	 *
	 * "·100% coton (Heather Grey: 97% coton, 3% polyester)" keeps its
	 * parenthesis: the exception is part of the fact, and a buyer choosing
	 * Heather Grey needs it. Returns '' when the supplier states none, and ''
	 * renders as nothing rather than as a guess.
	 */
	public static function composition( string $description ): string {
		foreach ( preg_split( '/\R/u', $description ) ?: array() as $line ) {
			$line = trim( ltrim( trim( $line ), "·-•\u{00B7}" ) );
			if ( '' !== $line && preg_match( '/\d+\s*%/u', $line ) ) {
				return $line;
			}
		}
		return '';
	}

	// -----------------------------------------------------------------------
	// Sizes
	// -----------------------------------------------------------------------

	/**
	 * Where a size sorts, globally.
	 *
	 * Adult letter sizes get their position in `ADULT_SIZES`. Everything else in
	 * this catalogue is a children's size that names its own measurement
	 * ("116 (5-6)", "5/6 (110/116)", "6-12"), so it is ranked by the first
	 * number in it, offset below the adult block: a 116 cm child is not a 116 of
	 * anything an adult wears, and the two must not interleave.
	 *
	 * A size that is neither sorts last, in the order the supplier gave it,
	 * rather than being dropped: "One Size" is a real size.
	 */
	public static function size_rank( string $size ): int {
		$key = mb_strtoupper( trim( $size ) );

		$exact = array_search( $key, self::ADULT_SIZES, true );
		if ( false !== $exact ) {
			// Adults occupy 1000..1999, so nothing else can land among them.
			return 1000 + (int) $exact;
		}

		// "XS (8)", "S (122/134)": an adult letter with the maker's own numeric
		// equivalent after it. The letter is what a buyer picks by.
		if ( preg_match( '/^([2-6]?X*[SML])\b/u', $key, $m ) ) {
			$at = array_search( $m[1], self::ADULT_SIZES, true );
			if ( false !== $at ) {
				return 1000 + (int) $at;
			}
		}

		if ( preg_match( '/(\d+)/u', $key, $m ) ) {
			return min( 999, (int) $m[1] );
		}

		return 2000;
	}

	/** A size name reduced to something safe inside our own SKU string. */
	public static function slug_fragment( string $value ): string {
		$slug = preg_replace( '/[^A-Za-z0-9]+/u', '', $value ) ?? '';
		return '' !== $slug ? mb_strtoupper( $slug ) : 'X';
	}

	// -----------------------------------------------------------------------

	/** The first colour photo, for the 24 styles with no style-level front shot. */
	private static function first_colour_photo( array $style ): string {
		foreach ( (array) ( $style['colourways'] ?? array() ) as $cw ) {
			$photo = self::text( $cw['photo'] ?? '' );
			if ( '' !== $photo ) {
				return $photo;
			}
		}
		return '';
	}

	/** Anything the payload offers, reduced to a trimmed string. */
	private static function text( mixed $value ): string {
		return is_scalar( $value ) ? trim( (string) $value ) : '';
	}
}
