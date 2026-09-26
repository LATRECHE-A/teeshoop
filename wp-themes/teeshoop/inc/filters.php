<?php
/**
 * The facets: how several hundred references become a handful.
 *
 * Chapter 04 of the brief opens on this and everything else in it follows from
 * it: « le catalogue doit se comporter comme un moteur de recherche spécialisé,
 * pas comme une succession de centaines de pages ». It lists thirteen filters in
 * priority order, and it sets a budget: « moins d'une seconde sur les pages
 * courantes » with an explicit ban on heavy meta queries per click.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS BUILT, AND WHAT IS NOT, AND WHY
 *
 * Ten facets exist because ten have real data behind them. mistertee.fr offers
 * five (gamme, genre, col, manches, marque) and its colour facet renders no
 * options at all; tostadora.fr offers none, only category links and free text
 * (both checked 2026-08-19). Three of the chapter's thirteen are deliberately
 * absent and none of them is an oversight:
 *
 *   PRIX. The imported catalogue carries no selling price, because nobody has
 *   set `blank_margin_rate` (question 42). A price slider over 462 references
 *   that all cost nothing is a control that filters nothing. It appears the day
 *   a margin is set.
 *
 *   DISPONIBILITÉ. The only honest version of it is per-variation and per-hour:
 *   `Shelf::availability()` answers « Disponible » only when the reading is
 *   inside `Purchase::STOCK_TRUST_HOURS`, and a parent-level facet would have to
 *   join 26 399 variations on every click to know. Worse, the stock sweep is not
 *   installed anywhere until session 14, so today every article would answer
 *   « Délai à confirmer » and the facet would select the whole catalogue. The
 *   panel says so rather than leaving a gap.
 *
 *   DÉLAI, TECHNIQUE, SECTEUR. No data exists. There is no per-reference lead
 *   time, DTF is the only technique open online (question 12), and the usage
 *   collections the chapter asks for (restauration, BTP, sécurité…) are a second
 *   taxonomy nobody has built. Inventing any of the three would be inventing
 *   content, which is the one thing a catalogue may never do.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NOT WOOCOMMERCE'S OWN LAYERED NAV
 *
 * Because it cannot be driven by a form that works without JavaScript.
 * `WC_Query::get_layered_nav_chosen_attributes()` reads `filter_couleur` as a
 * COMMA-SEPARATED STRING and skips the value outright when it is not a string
 * (`if ( ! is_string( $value ) ) continue;`, class-wc-query.php:1063). A group of
 * checkboxes in HTML submits either `name[]=a&name[]=b`, which is an array and
 * is skipped, or the same scalar name twice, of which PHP keeps only the last.
 * So the native format needs a script to assemble it, and a catalogue whose
 * filters need a script is a catalogue that does not work on a bad connection.
 *
 * The clauses are therefore added through WooCommerce's own documented seams,
 * `woocommerce_product_query_tax_query` and `woocommerce_product_query_meta_query`,
 * so everything else about the archive (visibility, ordering, pagination,
 * counts) stays WooCommerce's. Nothing here re-implements a query WooCommerce
 * would otherwise run; it appends to the one it is already building.
 *
 * @package Teeshoop\Theme
 */

declare( strict_types = 1 );

namespace Teeshoop\Theme;

defined( 'ABSPATH' ) || exit;

/** Meta key holding the fabric weight, written by the catalogue importer. */
const WEIGHT_META = '_teeshoop_weight_gsm';

/**
 * The colour family facet, which is not a taxonomy.
 *
 * A family is not a term and never becomes one. It is the answer `Swatch`
 * derived from the colourway photographs, stored beside each colour term, and
 * the filter resolves it back to term ids at query time. Making it a taxonomy
 * would put a second, editable copy of a measured fact in the database, and the
 * day somebody moved « French Navy » into the greens by hand the swatch and the
 * heading above it would disagree for ever.
 */
const FAMILY_PARAM = 'f_famille';

/**
 * The attribute facets, in the order chapter 04 asks for them.
 *
 * A facet is offered only when its taxonomy exists AND has terms in use, so a
 * shop that has imported nothing shows no empty controls.
 *
 * @return array<string,string> taxonomy => the legend a buyer reads
 */
function facet_taxonomies(): array {
	return array(
		'pa_matiere'       => __( 'Matière', 'teeshoop' ),
		'pa_marque'        => __( 'Marque', 'teeshoop' ),
		'pa_taille'        => __( 'Taille', 'teeshoop' ),
		'pa_couleur'       => __( 'Coloris', 'teeshoop' ),
		'pa_public'        => __( 'Public', 'teeshoop' ),
		'pa_certification' => __( 'Certification', 'teeshoop' ),
		'pa_col'           => __( 'Col', 'teeshoop' ),
		'pa_manches'       => __( 'Manches', 'teeshoop' ),
	);
}

/** The query parameter a facet reads, e.g. `pa_couleur` -> `f_couleur`. */
function facet_param( string $taxonomy ): string {
	return 'f_' . preg_replace( '/^pa_/', '', $taxonomy );
}

/**
 * What the visitor has currently selected, sanitised.
 *
 * Read once per request. Slugs only: a term that does not exist simply selects
 * nothing, so a hand-edited URL cannot produce an error page.
 *
 * @return array{terms:array<string,string[]>,weight:array{min:int,max:int}}
 */
function applied_filters(): array {
	static $applied = null;
	if ( null !== $applied ) {
		return $applied;
	}

	$terms = array();
	// phpcs:disable WordPress.Security.NonceVerification.Recommended -- a public, bookmarkable listing; nothing is written.
	foreach ( array_keys( facet_taxonomies() ) as $taxonomy ) {
		$raw = $_GET[ facet_param( $taxonomy ) ] ?? null;
		if ( ! is_array( $raw ) ) {
			continue;
		}

		/*
		 * EVERY ELEMENT IS FLATTENED TO A SCALAR FIRST, and that is not
		 * defensive programming, it is a fix.
		 *
		 * `?f_couleur[][]=x` puts an ARRAY inside the array, and PHP 8 makes
		 * `sanitize_title()` fatal on one: it takes a string. The result was
		 * HTTP 500 on EVERY page of the site, not only the listing, because
		 * `applied_filters()` is also reached from `filter_robots()` on
		 * `wp_robots` and from `body_class()`. One unauthenticated GET, any
		 * URL, the whole storefront down. Measured on the mirror before this
		 * was written: the homepage, the devis page, a product page and the
		 * shop all answered 500.
		 *
		 * A non-scalar value is DROPPED rather than stringified: there is no
		 * term slug it could have meant, and "" would select nothing anyway.
		 */
		$scalars = array_filter( wp_unslash( $raw ), static fn( $v ): bool => is_scalar( $v ) );
		$slugs   = array_values( array_unique( array_filter( array_map( 'sanitize_title', $scalars ) ) ) );
		if ( ! empty( $slugs ) ) {
			$terms[ $taxonomy ] = $slugs;
		}
	}

	/*
	 * The families, read exactly like a taxonomy facet and sanitised exactly
	 * like one, including the array-inside-an-array that took the whole site
	 * down: `?f_famille[][]=x` reaches this line too.
	 */
	$families = array();
	$raw      = $_GET[ FAMILY_PARAM ] ?? null;
	if ( is_array( $raw ) ) {
		$known    = array_keys( family_labels() );
		$scalars  = array_filter( wp_unslash( $raw ), static fn( $v ): bool => is_scalar( $v ) );
		$families = array_values(
			array_unique(
				array_filter(
					array_map( 'sanitize_key', $scalars ),
					static fn( string $slug ): bool => in_array( $slug, $known, true )
				)
			)
		);
	}

	// Same reason: `absint()` on an array is a fatal, and `?g_min[]=1` is one
	// character of typing. A non-scalar is no bound at all.
	$min = isset( $_GET['g_min'] ) && is_scalar( $_GET['g_min'] ) ? absint( wp_unslash( $_GET['g_min'] ) ) : 0;
	$max = isset( $_GET['g_max'] ) && is_scalar( $_GET['g_max'] ) ? absint( wp_unslash( $_GET['g_max'] ) ) : 0;
	// phpcs:enable WordPress.Security.NonceVerification.Recommended

	// A reversed range is a typo, not a query. Swapping is friendlier than
	// returning nothing and leaves the buyer's two numbers on screen.
	if ( $min > 0 && $max > 0 && $min > $max ) {
		list( $min, $max ) = array( $max, $min );
	}

	$applied = array(
		'terms'    => $terms,
		'families' => $families,
		'weight'   => array(
			'min' => $min,
			'max' => $max,
		),
	);
	return $applied;
}

/**
 * The eleven families and their French headings, or none at all.
 *
 * Empty when the plugin is not active, which makes every function below a
 * no-op rather than a fatal: the theme is allowed to run without it, and a
 * filter that cannot be resolved must disappear rather than half work.
 *
 * @return array<string,string>
 */
function family_labels(): array {
	return class_exists( '\\Teeshoop\\Core\\Swatch' ) ? \Teeshoop\Core\Swatch::families() : array();
}

/**
 * The colour term ids in one family.
 *
 * @return int[]
 */
function family_terms( string $family ): array {
	if ( ! class_exists( '\\Teeshoop\\Core\\Colours' ) ) {
		return array();
	}
	$map = \Teeshoop\Core\Colours::by_family();
	return array_map( 'intval', $map[ $family ] ?? array() );
}

/** True when at least one facet is narrowing the list. */
function has_filters(): bool {
	$applied = applied_filters();
	return ! empty( $applied['terms'] )
		|| ! empty( $applied['families'] )
		|| $applied['weight']['min'] > 0
		|| $applied['weight']['max'] > 0;
}

/**
 * Append the chosen terms to the archive's tax query.
 *
 * AND between facets and AND within a facet, which is WooCommerce's own default
 * (`woocommerce_layered_nav_default_query_type`). Two colours selected on one
 * reference is meaningful here: a variable product carries every colour it is
 * available in, so "Navy AND White" means "a reference that comes in both",
 * which is exactly what a buyer kitting out a two-tone team is asking for.
 *
 * @param array $tax_query WooCommerce's tax query so far.
 * @return array
 */
function filter_tax_query( $tax_query ): array {
	if ( ! is_array( $tax_query ) ) {
		$tax_query = array();
	}
	foreach ( applied_filters()['terms'] as $taxonomy => $slugs ) {
		$tax_query[] = array(
			'taxonomy'         => $taxonomy,
			'field'            => 'slug',
			'terms'            => $slugs,
			'operator'         => 'AND',
			'include_children' => false,
		);
	}
	foreach ( family_clauses() as $clause ) {
		$tax_query[] = $clause;
	}
	return $tax_query;
}
add_filter( 'woocommerce_product_query_tax_query', __NAMESPACE__ . '\\filter_tax_query', 10, 1 );

/**
 * One clause per chosen family, resolved to the colour terms it holds.
 *
 * IN inside a family and AND between families, which is the same grammar the
 * colour facet already uses one level down: « comes in some blue » AND « comes
 * in some red », not « comes in a colour that is both ».
 *
 * A FAMILY NOBODY HAS MEASURED SELECTS NOTHING, and that is deliberate. The
 * alternative, dropping the clause, would silently widen the query back to the
 * whole catalogue and show the buyer four hundred references under the heading
 * « Bleus ». An impossible term id is the clause that returns an empty list,
 * which is the truthful answer to « show me the blues » on a shop that has not
 * measured any.
 *
 * @return array<int,array>
 */
function family_clauses(): array {
	$out = array();
	foreach ( applied_filters()['families'] as $family ) {
		$ids   = family_terms( $family );
		$out[] = array(
			'taxonomy'         => 'pa_couleur',
			'field'            => 'term_id',
			'terms'            => empty( $ids ) ? array( 0 ) : $ids,
			'operator'         => 'IN',
			'include_children' => false,
		);
	}
	return $out;
}

/**
 * Append the fabric weight range.
 *
 * A meta query, and the one the chapter warns about. It is bounded: 462 parent
 * products carry `_teeshoop_weight_gsm`, not 26 399 variations, and the clause
 * is `BETWEEN` on a numeric cast of a single key. `scripts/shop-bench.mjs`
 * measures the page with and without it rather than assuming.
 *
 * @param array $meta_query WooCommerce's meta query so far.
 * @return array
 */
function filter_meta_query( $meta_query ): array {
	if ( ! is_array( $meta_query ) ) {
		$meta_query = array();
	}
	$weight = applied_filters()['weight'];
	if ( $weight['min'] <= 0 && $weight['max'] <= 0 ) {
		return $meta_query;
	}

	$clause = array(
		'key'  => WEIGHT_META,
		'type' => 'NUMERIC',
	);
	if ( $weight['min'] > 0 && $weight['max'] > 0 ) {
		$clause['value']   = array( $weight['min'], $weight['max'] );
		$clause['compare'] = 'BETWEEN';
	} elseif ( $weight['min'] > 0 ) {
		$clause['value']   = $weight['min'];
		$clause['compare'] = '>=';
	} else {
		$clause['value']   = $weight['max'];
		$clause['compare'] = '<=';
	}

	$meta_query[] = $clause;
	return $meta_query;
}
add_filter( 'woocommerce_product_query_meta_query', __NAMESPACE__ . '\\filter_meta_query', 10, 1 );

/**
 * A filtered listing is not a page to index.
 *
 * Chapter 04, SEO section: « filtres non indexables par défaut ». Every
 * combination of ten facets is a URL, and a crawler that finds them all indexes
 * a few million near-identical pages of the same 462 references. `follow` is
 * kept so the products themselves are still reached through it.
 *
 * @param array $robots The directives WordPress has assembled.
 * @return array
 */
function filter_robots( $robots ): array {
	if ( ! is_array( $robots ) || ! has_filters() ) {
		return is_array( $robots ) ? $robots : array();
	}
	$robots['noindex'] = true;
	$robots['follow']  = true;
	return $robots;
}
add_filter( 'wp_robots', __NAMESPACE__ . '\\filter_robots', 20, 1 );

/**
 * The terms of one facet, with how many references each would leave.
 *
 * THE COUNT IGNORES THIS FACET'S OWN SELECTION and honours every other one,
 * which is the only arithmetic that makes a facet usable: counted with its own
 * selection applied, choosing "Blanc" would show "Blanc (37)" and every other
 * colour at zero, and the buyer could never add a second colour.
 *
 * One query per facet, over parent products only. `fields => ids` and
 * `no_found_rows` because nothing here needs pagination or a total.
 *
 * @return array<int,array{slug:string,name:string,count:int}>
 */
function facet_terms( string $taxonomy ): array {
	/*
	 * `hide_empty => false`, AND THAT IS A FIX, not a relaxation.
	 *
	 * `hide_empty => true` filters on `wp_term_taxonomy.count`, which WooCommerce
	 * maintains on product save and which a catalogue import leaves behind:
	 * `wc_defer_product_sync()` is on for the whole run and the recount that
	 * follows it does not cover attribute terms. MEASURED on the mirror after a
	 * full import: 442 colour terms exist, 383 are carried by a published
	 * product, and 25 have a non-zero stored count. The facet was therefore
	 * offering 25 colours out of 383, 2 brands out of 18 and 9 sizes out of 87,
	 * and every one of the missing ones was a reference a buyer could not reach.
	 *
	 * The stored count is a SECOND COPY of a number this file already computes
	 * live, and the two diverged. `facet_counts()` below is the one that
	 * decides, and it already drops a term nothing in the current context
	 * carries, so removing the stale filter removes the divergence rather than
	 * adding an empty option.
	 */
	$args = array(
		'taxonomy'   => $taxonomy,
		'hide_empty' => false,
		'orderby'    => 'name',
	);
	if ( 'pa_taille' === $taxonomy ) {
		/*
		 * Sizes sort by their rank, not by their name, or the list reads
		 * L, M, S, XL. The rank lives in the plain term meta key `order`,
		 * written by `Taxonomy::rank_size()`; the suffixed `order_pa_taille`
		 * that every tutorial names is read by nothing on WooCommerce 11.0.1.
		 */
		$args['orderby']  = 'meta_value_num';
		$args['meta_key'] = 'order'; // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
	}

	$terms = get_terms( $args );
	if ( ! is_array( $terms ) || empty( $terms ) ) {
		return array();
	}

	$counts = facet_counts( $taxonomy );

	$out = array();
	foreach ( $terms as $term ) {
		$n = $counts[ $term->slug ] ?? 0;
		// A term that nothing in the current context carries is dropped, not
		// shown at zero: a list of four hundred colours is only usable if it is
		// the colours this category actually comes in.
		if ( 0 === $n && ! in_array( $term->slug, applied_filters()['terms'][ $taxonomy ] ?? array(), true ) ) {
			continue;
		}
		$out[] = array(
			'id'    => (int) $term->term_id,
			'slug'  => $term->slug,
			'name'  => $term->name,
			'count' => $n,
		);
	}
	return $out;
}

/**
 * How many references each colour family would leave, in context.
 *
 * ONE QUERY FOR ELEVEN FAMILIES. The obvious version asks per family and runs
 * eleven; this joins the colour terms to their measured family and groups, so
 * the panel pays for one more query than it did before the families existed.
 *
 * `COUNT(DISTINCT)` and not `COUNT`, because a reference available in Navy and
 * in Royal is one reference in the blues, not two. Getting that wrong is how a
 * facet ends up promising more than the listing shows.
 *
 * @return array<string,int> family slug => references
 */
function family_counts(): array {
	static $counts = null;
	if ( null !== $counts ) {
		return $counts;
	}
	$counts = array();

	if ( ! class_exists( '\\Teeshoop\\Core\\Colours' ) ) {
		return $counts;
	}

	global $wpdb;
	$ids = context_ids( FAMILY_PARAM );
	if ( empty( $ids ) ) {
		return $counts;
	}

	$placeholders = implode( ',', array_fill( 0, count( $ids ), '%d' ) );

	// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $placeholders is built from a count and every value goes through prepare().
	$rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT m.meta_value AS famille, COUNT(DISTINCT tr.object_id) AS n
			 FROM {$wpdb->term_relationships} tr
			 INNER JOIN {$wpdb->term_taxonomy} tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = %s
			 INNER JOIN {$wpdb->termmeta} m ON m.term_id = tt.term_id AND m.meta_key = %s
			 WHERE tr.object_id IN ({$placeholders}) AND m.meta_value <> ''
			 GROUP BY m.meta_value",
			array_merge( array( 'pa_couleur', \Teeshoop\Core\Colours::META_FAMILY ), $ids )
		)
	);
	// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared

	foreach ( (array) $rows as $row ) {
		$counts[ (string) $row->famille ] = (int) $row->n;
	}
	return $counts;
}

/**
 * Where a listing form submits: this listing, from its first page.
 *
 * Shared by the filters and the sort (THE-09): the sort posted to the current
 * URL, so « Les plus récents » chosen on page 3 opened page 3 of the new order.
 */
function listing_action(): string {
	$here = (string) strtok( (string) home_url( add_query_arg( array() ) ), '?' );
	return (string) preg_replace( '#/page/\d+/?$#', '/', $here );
}

/**
 * The colour facet, grouped into the eleven families and dressed with swatches.
 *
 * WHY THIS ONE FACET HAS ITS OWN FUNCTION. Every other facet is a handful of
 * words: eight materials, four sleeve lengths. Colour is four hundred and
 * forty-two manufacturer names, and the brief forbids merging « Navy »,
 * « French Navy » and « Deep Navy », which is right: they are three articles a
 * buyer re-orders by name. A flat list of 442 checkboxes is not a filter, so
 * the names stay and a MEASURED value groups them. `Swatch` derives the family
 * from the colourway photograph, never from the word, so « Fan Deep Royal »
 * lands under the blues without anybody teaching it that « fan » means nothing.
 *
 * The last group is the colours nothing could be measured for. They are shown,
 * not hidden: a colour missing from the filter is a reference a buyer cannot
 * reach, and that is a worse failure than a chip with no swatch on it.
 *
 * @return array<int,array{family:string,label:string,terms:array,strip:string[],open:bool}>
 */
function colour_groups(): array {
	$terms = facet_terms( 'pa_couleur' );
	if ( empty( $terms ) ) {
		return array();
	}

	$labels = family_labels();
	if ( empty( $labels ) || ! class_exists( '\\Teeshoop\\Core\\Colours' ) ) {
		// No plugin, no measurement: one group holding everything, which
		// renders exactly the flat list this facet had before.
		return array(
			array(
				'family' => '',
				'label'  => __( 'Tous les coloris', 'teeshoop' ),
				'terms'  => $terms,
				'strip'  => array(),
				'open'   => true,
			),
		);
	}

	// One query for every swatch on the page instead of one per colour.
	\Teeshoop\Core\Colours::prime( array_column( $terms, 'id' ) );

	$chosen = applied_filters()['terms']['pa_couleur'] ?? array();
	$groups = array();
	foreach ( $labels as $slug => $label ) {
		$groups[ $slug ] = array(
			'family' => $slug,
			'label'  => $label,
			'terms'  => array(),
			'strip'  => array(),
			'open'   => in_array( $slug, applied_filters()['families'], true ),
		);
	}
	/*
	 * TWO GROUPS THAT ARE NOT THE SAME THING, and the interface says so.
	 *
	 * « Non mesurés » is a colour whose photographs were looked at and did not
	 * agree, or contradicted its own name. It carries an explanation, because a
	 * buyer wondering why that one has no dot deserves one.
	 *
	 * « Tous les coloris » is a colour nobody has measured YET, which is what
	 * every colour is on a shop where the sweep has never run. It carries no
	 * explanation, because there is nothing to explain: it is the plain list
	 * this facet was before any of this existed.
	 */
	$groups['refuse'] = array(
		'family' => 'refuse',
		'label'  => __( 'Non mesurés', 'teeshoop' ),
		'terms'  => array(),
		'strip'  => array(),
		'open'   => false,
	);
	$groups[''] = array(
		'family' => '',
		'label'  => __( 'Tous les coloris', 'teeshoop' ),
		'terms'  => array(),
		'strip'  => array(),
		'open'   => false,
	);

	foreach ( $terms as $term ) {
		$read  = \Teeshoop\Core\Colours::read( (int) $term['id'] );
		$stops = array();
		$where = null === $read ? '' : 'refuse';
		$light = -1.0;
		if ( null !== $read && ! empty( $read['stops'] ) && isset( $groups[ $read['family'] ] ) ) {
			$stops = $read['stops'];
			$where = (string) $read['family'];
			$lab   = (string) get_term_meta( (int) $term['id'], \Teeshoop\Core\Colours::META_LAB, true );
			$light = '' === $lab ? -1.0 : (float) strtok( $lab, ',' );
		}

		$term['stops'] = $stops;
		$term['light'] = $light;
		$groups[ $where ]['terms'][] = $term;

		if ( in_array( $term['slug'], $chosen, true ) ) {
			$groups[ $where ]['open'] = true;
		}
	}

	$out    = array();
	$picked = applied_filters()['families'];
	foreach ( $groups as $group ) {
		/*
		 * A TICKED FAMILY KEEPS ITS GROUP, EMPTY OR NOT (THE-05). The template
		 * renders its checkbox at zero for exactly this reason, but the group
		 * was dropped here first: « Bleus » plus a brand with no blue left no
		 * « Bleus » in the form, and unticking the brand silently widened the
		 * search to every colour.
		 */
		if ( empty( $group['terms'] ) && ! in_array( $group['family'], $picked, true ) ) {
			continue;
		}
		// Light to dark inside a family, which is how a swatch grid is read.
		// The two groups with no swatches have no lightness, so they keep their
		// alphabetical order from `facet_terms()`.
		if ( '' !== $group['family'] && 'refuse' !== $group['family'] ) {
			usort(
				$group['terms'],
				static fn( array $a, array $b ): int => array( -$a['light'], $a['name'] ) <=> array( -$b['light'], $b['name'] )
			);
			/*
			 * SIX DOTS SAMPLED ACROSS THE FAMILY, NOT ITS FIRST SIX.
			 *
			 * The list is sorted light to dark, so taking the head gave « Bleus »
			 * six pale blues and never a navy, and « Gris », « Blancs et écrus »
			 * and « Beiges et bruns » six near-white dots each, which is the one
			 * thing the strip exists to prevent: it is there so a shut group
			 * says what is inside it.
			 */
			$all            = array_values(
				array_filter( array_map( static fn( array $t ): string => $t['stops'][0] ?? '', $group['terms'] ) )
			);
			$group['strip'] = spread_across( $all, 6 );
		}
		$out[] = $group;
	}
	return $out;
}

/**
 * At most $k items of $all, evenly spaced, first and last always kept.
 *
 * @param string[] $all
 * @return string[]
 */
function spread_across( array $all, int $k ): array {
	$n = count( $all );
	if ( $n <= $k || $k < 2 ) {
		return $all;
	}
	$out = array();
	for ( $i = 0; $i < $k; $i++ ) {
		$out[] = $all[ (int) round( $i * ( $n - 1 ) / ( $k - 1 ) ) ];
	}
	return $out;
}

/**
 * How many references each term of one facet would leave, in context.
 *
 * Two steps, both indexed: WordPress resolves the product ids that match
 * everything except this facet, then one grouped query over the term
 * relationships counts them. The alternative, one query per term, is 442
 * queries on the colour facet alone.
 *
 * @return array<string,int> term slug => count
 */
function facet_counts( string $taxonomy ): array {
	global $wpdb;

	$ids = context_ids( $taxonomy );
	if ( empty( $ids ) ) {
		return array();
	}

	$placeholders = implode( ',', array_fill( 0, count( $ids ), '%d' ) );

	// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $placeholders is built from a count, and every value goes through prepare().
	$rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT t.slug AS slug, COUNT(*) AS n
			 FROM {$wpdb->term_relationships} tr
			 INNER JOIN {$wpdb->term_taxonomy} tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
			 INNER JOIN {$wpdb->terms} t ON t.term_id = tt.term_id
			 WHERE tt.taxonomy = %s AND tr.object_id IN ({$placeholders})
			 GROUP BY t.slug",
			array_merge( array( $taxonomy ), $ids )
		)
	);
	// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared

	$out = array();
	foreach ( (array) $rows as $row ) {
		$out[ (string) $row->slug ] = (int) $row->n;
	}
	return $out;
}

/**
 * The product ids the page would show if `$except` were not selected.
 *
 * Built from the archive's own context (the category being browsed, the search
 * term) plus every OTHER facet, so the counts describe the list the buyer is
 * actually looking at.
 *
 * @return int[]
 */
function context_ids( string $except = '' ): array {
	static $cache = array();

	/*
	 * WITH NOTHING SELECTED, EVERY FACET ASKS THE SAME QUESTION.
	 *
	 * `$except` only matters when that facet is actually narrowing the list, so
	 * on the common landing (a category, no filters yet) all eight facets share
	 * one answer. Keyed naively this was eight identical `WP_Query` runs per
	 * page; keyed like this it is one. Measured on the mirror, the facet block
	 * runs 25 SQL queries in total either way, because the eight it saves are
	 * the cheap ones and the rest are `get_terms` (two per facet) and the
	 * grouped count (one per facet), which no cache key can remove. What the
	 * shared key buys is the SCAN, not the round trip: at production scale that
	 * query walks the whole category rather than one eighth of it eight times.
	 */
	$narrowing = ! empty( applied_filters()['terms'] ) || ! empty( applied_filters()['families'] );
	$key       = $narrowing ? $except : '';
	if ( isset( $cache[ $key ] ) ) {
		return $cache[ $key ];
	}

	$tax_query = array( 'relation' => 'AND' );

	$term = is_tax( array( 'product_cat', 'product_tag' ) ) ? get_queried_object() : null;
	if ( $term instanceof \WP_Term ) {
		$tax_query[] = array(
			'taxonomy'         => $term->taxonomy,
			'field'            => 'term_id',
			'terms'            => array( $term->term_id ),
			'include_children' => true,
		);
	}

	foreach ( applied_filters()['terms'] as $taxonomy => $slugs ) {
		if ( $taxonomy === $except ) {
			continue;
		}
		$tax_query[] = array(
			'taxonomy'         => $taxonomy,
			'field'            => 'slug',
			'terms'            => $slugs,
			'operator'         => 'AND',
			'include_children' => false,
		);
	}

	/*
	 * THE FAMILY IS COUNTED AS ITS OWN FACET, not as part of the colours.
	 *
	 * Ticking « Bleus » narrows the population the colour counts are taken over
	 * to references that come in some blue. It does not shorten the colour list:
	 * every colour those references carry is still shown, a red among them if
	 * the reference also comes in red. The grouping is what makes 442 names
	 * navigable; the family filter is what narrows the shelf.
	 */
	if ( FAMILY_PARAM !== $except ) {
		foreach ( family_clauses() as $clause ) {
			$tax_query[] = $clause;
		}
	}

	/*
	 * THE SAME VISIBILITY RULES THE LISTING ITSELF OBEYS.
	 *
	 * Without this the count and the list disagree the moment a shop hides a
	 * product from its catalogue, or turns on "hide out of stock items": the
	 * facet would promise five references and the page would show four, which is
	 * precisely the failure `npm run verify:site` exists to catch.
	 *
	 * WRITTEN OUT RATHER THAN BORROWED, and that is the lesser of two evils.
	 * `WC_Query::get_tax_query()` builds this clause, but it ends by applying
	 * `woocommerce_product_query_tax_query`, which is where `filter_tax_query()`
	 * above lives: calling it here would re-add every facet including the one
	 * this count has to ignore. The term ids still come from WooCommerce
	 * (`wc_get_product_visibility_term_ids`) and the option is read, not
	 * assumed, so nothing about the RULE is duplicated, only the assembly.
	 */
	if ( function_exists( 'wc_get_product_visibility_term_ids' ) ) {
		$visibility = wc_get_product_visibility_term_ids();
		/*
		 * WHICH exclusion depends on the page, and WooCommerce switches too.
		 * `WC_Query::get_tax_query()` excludes `exclude-from-search` on a search
		 * results page and `exclude-from-catalog` everywhere else. This function
		 * adds the search term when `is_search()`, so it really is describing
		 * the search listing, and it was excluding the wrong term for it: a
		 * product hidden from the catalogue but findable by search was counted
		 * out of a panel sitting beside a listing that showed it.
		 */
		$hidden = array( is_search() ? $visibility['exclude-from-search'] : $visibility['exclude-from-catalog'] );
		if ( 'yes' === get_option( 'woocommerce_hide_out_of_stock_items' ) ) {
			$hidden[] = $visibility['outofstock'];
		}
		$tax_query[] = array(
			'taxonomy' => 'product_visibility',
			'field'    => 'term_taxonomy_id',
			'terms'    => array_values( array_filter( $hidden ) ),
			'operator' => 'NOT IN',
		);
	}

	$args = array(
		'post_type'              => 'product',
		'post_status'            => 'publish',
		'posts_per_page'         => -1,
		'fields'                 => 'ids',
		'no_found_rows'          => true,
		'ignore_sticky_posts'    => true,
		'update_post_meta_cache' => false,
		'update_post_term_cache' => false,
		'tax_query'              => $tax_query, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query
	);

	$weight = applied_filters()['weight'];
	if ( $weight['min'] > 0 || $weight['max'] > 0 ) {
		$args['meta_query'] = filter_meta_query( array() ); // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
	}

	/*
	 * THE RAW SEARCH TERM, NOT THE ESCAPED ONE.
	 *
	 * `get_search_query()` defaults to `$escaped = true` and runs the term
	 * through `esc_attr()`, which is right for printing it into an attribute and
	 * wrong for re-running the query. Any search containing `&`, `"`, `<`, `>`
	 * or `'` then gave the panel a different string from the one `WP_Query` used:
	 * measured on `?s=B%26C`, the listing said 5 references and the panel said
	 * B&C 3, and the two could never reconcile because ticking the brand filters
	 * on the raw term. B&C is this catalogue's largest brand, so the first
	 * ampersand a buyer types is the one that breaks it.
	 */
	$search = (string) get_query_var( 's' );
	if ( '' !== $search && ( is_search() || is_shop() ) ) {
		$args['s'] = $search;
	}

	$query         = new \WP_Query( $args );
	$cache[ $key ] = array_map( 'intval', (array) $query->posts );
	return $cache[ $key ];
}

/**
 * The URL of the current listing with one facet value removed.
 *
 * Used by the "applied filters" row, so every narrowing the buyer has done has
 * a visible way back out. Losing your way in a facet stack is the classic
 * catalogue dead end and it is why the chapter asks the list never to trap.
 */
function without_filter( string $taxonomy, string $slug ): string {
	$applied = applied_filters()['terms'];
	$left    = array_values( array_diff( $applied[ $taxonomy ] ?? array(), array( $slug ) ) );
	$param   = facet_param( $taxonomy );

	$url = remove_query_arg( array( $param, 'paged' ) );
	if ( ! empty( $left ) ) {
		$url = add_query_arg( array( $param => $left ), $url );
	}
	return $url;
}

/** The current listing with every facet cleared. */
function without_filters(): string {
	$params = array_map( __NAMESPACE__ . '\\facet_param', array_keys( facet_taxonomies() ) );
	return remove_query_arg( array_merge( $params, array( FAMILY_PARAM, 'g_min', 'g_max', 'paged' ) ) );
}

/** The same URL without one colour family, keeping the others. */
function without_family( string $family ): string {
	$left = array_values( array_diff( applied_filters()['families'], array( $family ) ) );
	$url  = remove_query_arg( array( FAMILY_PARAM, 'paged' ) );
	return empty( $left ) ? $url : add_query_arg( array( FAMILY_PARAM => $left ), $url );
}


/**
 * The lightest and the heaviest fabric the shop actually carries.
 *
 * Read from the catalogue rather than written down, so the placeholders in the
 * grammage boxes are a real range and not a guess: a shop that suggests
 * "120 – 400" over a catalogue running 145 to 320 invites two searches that
 * return nothing. Cached for an hour, because it changes only when the nightly
 * import changes it and it is read on every listing.
 *
 * @return array{min:int,max:int}|null null when nothing carries a weight.
 */
function weight_bounds(): ?array {
	$cached = get_transient( 'teeshoop_weight_bounds' );
	if ( is_array( $cached ) ) {
		return $cached['min'] > 0 ? $cached : null;
	}

	global $wpdb;
	$row = $wpdb->get_row(
		$wpdb->prepare(
			"SELECT MIN(CAST(pm.meta_value AS UNSIGNED)) AS lo, MAX(CAST(pm.meta_value AS UNSIGNED)) AS hi
			 FROM {$wpdb->postmeta} pm
			 INNER JOIN {$wpdb->posts} p ON p.ID = pm.post_id AND p.post_type = 'product' AND p.post_status = 'publish'
			 WHERE pm.meta_key = %s AND pm.meta_value <> ''",
			WEIGHT_META
		)
	);

	$bounds = array(
		'min' => $row ? (int) $row->lo : 0,
		'max' => $row ? (int) $row->hi : 0,
	);
	set_transient( 'teeshoop_weight_bounds', $bounds, HOUR_IN_SECONDS );

	return $bounds['min'] > 0 ? $bounds : null;
}

/**
 * Everything currently narrowing the list, each with a way to remove it.
 *
 * @return array<int,array{label:string,name:string,url:string}>
 */
function applied_chips(): array {
	$out     = array();
	$applied = applied_filters();

	$labels = family_labels();
	foreach ( $applied['families'] as $family ) {
		$out[] = array(
			'label' => __( 'Famille de coloris', 'teeshoop' ),
			'name'  => $labels[ $family ] ?? $family,
			'url'   => without_family( $family ),
		);
	}

	foreach ( $applied['terms'] as $taxonomy => $slugs ) {
		foreach ( $slugs as $slug ) {
			$term = get_term_by( 'slug', $slug, $taxonomy );
			if ( ! $term instanceof \WP_Term ) {
				continue;
			}
			$out[] = array(
				'label' => facet_taxonomies()[ $taxonomy ] ?? $taxonomy,
				'name'  => $term->name,
				'url'   => without_filter( $taxonomy, $slug ),
			);
		}
	}

	$weight = $applied['weight'];
	if ( $weight['min'] > 0 || $weight['max'] > 0 ) {
		if ( $weight['min'] > 0 && $weight['max'] > 0 ) {
			$name = sprintf(
				/* translators: 1: lowest weight, 2: highest weight, in g/m². */
				__( '%1$s à %2$s g/m²', 'teeshoop' ),
				num( (float) $weight['min'] ),
				num( (float) $weight['max'] )
			);
		} elseif ( $weight['min'] > 0 ) {
			/* translators: %s: a fabric weight in g/m². */
			$name = sprintf( __( '%s g/m² et plus', 'teeshoop' ), num( (float) $weight['min'] ) );
		} else {
			/* translators: %s: a fabric weight in g/m². */
			$name = sprintf( __( 'jusqu’à %s g/m²', 'teeshoop' ), num( (float) $weight['max'] ) );
		}
		$out[] = array(
			'label' => __( 'Grammage', 'teeshoop' ),
			'name'  => $name,
			'url'   => remove_query_arg( array( 'g_min', 'g_max', 'paged' ) ),
		);
	}

	return $out;
}
