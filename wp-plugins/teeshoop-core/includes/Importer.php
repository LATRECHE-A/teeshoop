<?php
/**
 * Writing the supplier catalogue into WooCommerce.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IDEMPOTENT BY COMPARISON, NOT BY HASH
 *
 * Every field is read back and compared before anything is written, and
 * `save()` is only called when something actually differs. The tempting
 * shortcut is a fingerprint of the payload stored on the product, and it was
 * rejected: a hash is only as honest as the list of fields that went into it,
 * and the day someone adds a field and forgets the hash, the importer reports
 * "nothing changed" for ever while the shop drifts. Comparison cannot lie about
 * what it covers, and it is what makes the second run's report mean something.
 *
 * It also matters for a reason that is not tidiness: `save()` moves
 * `post_modified`, which moves the sitemap, which tells Google 463 products
 * changed every night when none did.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESUMABLE BY CURSOR
 *
 * A run is a list of references plus an index into it, in one option. Killing
 * the process loses at most the style in flight; the next invocation starts at
 * the same index. That is what lets this be a cron slot with a time budget
 * rather than a job somebody has to sit and watch: `--duree=600` does ten
 * minutes of work and stops cleanly, and the next slot continues.
 *
 * A run only re-plans when the previous one finished. Re-planning on every
 * invocation would restart from the top for ever if the budget were smaller
 * than the catalogue, which is precisely the case this exists for.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT REFUSES TO DO
 *
 * DELIST ON AN INCOMPLETE WALK. A reference we did not see is only gone if we
 * saw the whole catalogue; otherwise it just means the walk stopped early, and
 * unpublishing 400 products because the Worker had a bad minute is not a
 * recoverable mistake on a live shop.
 *
 * WRITE A PRICE IT CANNOT DERIVE. No margin rate configured, or no supplier
 * price for a SKU, means no price on that variation. It is then browsable and
 * not purchasable, which is a true statement about a garment we do not know
 * what to charge for.
 *
 * PROMISE STOCK IT CANNOT SEE. A SKU the stock feed does not mention is created
 * out of stock, not unlimited.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE IS EXEMPTED IN scripts/php-guard.mjs (the needle `Margin::`)
 *
 * It calls the cost engine to turn a supplier price into a selling price. It is
 * server-only and never rendered, and the exemption names that one string, so
 * this file is still checked for supplier names and for printing a purchase
 * price like any other.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class Importer {

	/** The resumable run state. Not autoloaded: it carries ~460 references. */
	private const OPTION_RUN = 'teeshoop_catalogue_run';

	/** Attachment meta: which supplier file this image came from. */
	private const META_SOURCE = '_teeshoop_source';

	/** Advisory MySQL lock name; one importer per database. */
	private const LOCK = 'teeshoop_catalogue_import';

	/**
	 * Product: this draft was made by `delist()`, not by a human.
	 *
	 * It is what lets a returning reference be republished without the importer
	 * ever overruling a shop manager who drafted something deliberately.
	 */
	private const META_DELISTED = '_teeshoop_delisted';

	/** How many problems to keep in the run report before it stops being readable. */
	private const MAX_PROBLEMS = 60;

	public static function init(): void {
		Shelf::init();
	}

	// -----------------------------------------------------------------------
	// The run
	// -----------------------------------------------------------------------

	/**
	 * Start a run, or return the one already in progress.
	 *
	 * @param string $kind    Which families to carry: printable, tee, polo, sweat, all.
	 * @param bool   $restart Throw away an unfinished run and re-plan.
	 * @param int    $max     Cap the plan, for a smoke test. 0 means the whole catalogue.
	 */
	public static function plan( string $kind, bool $restart = false, int $max = 0 ): array {
		$run = self::run_state();

		if ( ! $restart && ! empty( $run['refs'] ) && '' === (string) ( $run['finished'] ?? '' ) ) {
			return array(
				'ok'      => true,
				'resumed' => true,
				'run'     => $run,
			);
		}

		$list = Supply::references( $kind, $max );
		if ( empty( $list['ok'] ) ) {
			return array(
				'ok'    => false,
				'error' => (string) ( $list['error'] ?? 'Le catalogue n’a pas pu être listé.' ),
			);
		}

		$refs = $list['refs'];
		if ( $max > 0 ) {
			$refs = array_slice( $refs, 0, $max );
		}

		$run = array(
			'kind'      => $kind,
			'refs'      => $refs,
			'at'        => 0,
			'complete'  => ! empty( $list['complete'] ) && 0 === $max,
			'started'   => gmdate( 'c' ),
			'finished'  => '',
			'stats'     => self::empty_stats(),
			'problems'  => array(),
		);
		self::save_run( $run );

		return array(
			'ok'      => true,
			'resumed' => false,
			'run'     => $run,
			'walk'    => $list,
			// A walk can succeed partially: it returns what it saw AND why it
			// stopped. Dropping that string left the operator with a short list
			// and no reason for it.
			'warning' => (string) ( $list['error'] ?? '' ),
		);
	}

	/**
	 * Import until the plan is done or the time budget runs out.
	 *
	 * `$report` is called after every reference with (index, total, ref, outcome)
	 * so a CLI can show progress. Nothing here writes to stdout: this has to be
	 * callable from cron, from WP-CLI and from a test.
	 *
	 * @param int           $seconds Wall-clock budget. 0 means no budget.
	 * @param callable|null $report  Progress callback.
	 */
	public static function run( int $seconds = 0, ?callable $report = null ): array {
		$run = self::run_state();
		if ( empty( $run['refs'] ) ) {
			return array(
				'ok'    => false,
				'error' => 'Aucun import planifié. Lancez la planification d’abord.',
			);
		}

		/*
		 * A RATE THAT IS SET AND UNREADABLE IS NOT THE SAME AS NO RATE, AND THE
		 * DIFFERENCE IS THE WHOLE CATALOGUE'S PRICES.
		 *
		 * `margin_rate()` returns null for both, which is right for the pricing
		 * decision and wrong for the operator: with no rate, writing no price is
		 * the shipped and intended refusal; with "0,45" mistyped as "45", it
		 * silently un-prices 26 399 articles overnight and the run still ends
		 * "Catalogue à jour." and exit 0, so nothing mails anybody. Refusing the
		 * run is the loud version of the same safety.
		 */
		$configured = Settings::pricing()['blank_margin_rate'] ?? null;
		if ( null !== $configured && '' !== $configured && null === self::margin_rate() ) {
			return array(
				'ok'    => false,
				'error' => 'Le taux de marge (blank_margin_rate) est réglé sur une valeur inutilisable : '
					. wp_json_encode( $configured )
					. '. Attendu : un nombre entre 0 et 1, virgule ou point. Rien n’a été importé, pour ne pas retirer les prix du catalogue.',
			);
		}

		Taxonomy::ensure_attributes();
		Taxonomy::register_now();

		global $wpdb;

		/*
		 * ONE IMPORTER AT A TIME.
		 *
		 * The documented way to run this is a cron slot with `--duree`, and the
		 * documented way to fix a problem is to run it by hand. Those two meet
		 * on a bad night, and they do not merely duplicate work: both processes
		 * resume from the same cursor, so they walk the SAME reference at the
		 * same moment, and neither transaction can see the other's uncommitted
		 * INSERT. `find()` returns 0 in both, both create a product for the
		 * reference, and the shop ends up with two products carrying the same
		 * supplier reference and the same SKU, one of which no future run will
		 * ever touch again because `find()` only ever returns the first.
		 *
		 * `GET_LOCK` rather than an option: it is held by the CONNECTION, so a
		 * process killed with SIGKILL releases it, where a transient would need
		 * a timeout long enough to be safe and therefore long enough to block
		 * the next real run.
		 */
		$lock = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, 0)', self::LOCK ) );
		if ( 1 !== $lock ) {
			return array(
				'ok'    => false,
				'error' => 'Un autre import est déjà en cours. Rien n’a été fait.',
			);
		}

		/*
		 * Count terms once at the end, not on every assignment.
		 *
		 * `wp_set_object_terms` recounts a term's posts each time it is used,
		 * and this run touches `pa_couleur` and `pa_taille` 26 399 times between
		 * them. WordPress ships the deferral for exactly this; the matching
		 * `false` call at the end is what performs the counts, so it has to run
		 * on every exit path. AFTER the lock, deliberately: turned on before it,
		 * a refused second importer returned with counting still deferred for
		 * the rest of that process.
		 */
		wp_defer_term_counting( true );

		/*
		 * ONE TRANSACTION PER REFERENCE.
		 *
		 * MEASURED against the local mirror, and honestly: style 18009 (366
		 * variations) took 140 s on WooCommerce's default autocommit, 0,38 s an
		 * article; style 01542 (299 variations) took 72,5 s inside one
		 * transaction, 0,24 s an article. Two different styles, so it is an
		 * order of magnitude and not a controlled A/B. The query count is
		 * identical either way (148 per variation, WooCommerce's own cost and
		 * not something this file can change), so what the transaction removes
		 * is the database committing 44 000 times instead of once.
		 *
		 * It also makes the cursor honest. `$run['at']` is written by
		 * `update_option`, INSIDE the same transaction, so a process killed
		 * halfway through a style rolls back the style AND the cursor together
		 * and the next run redoes it whole. Before, a kill could leave a
		 * half-written product the cursor had already stepped past.
		 *
		 * This assumes InnoDB, which is what WordPress and WooCommerce create
		 * and what o2switch runs. On a MyISAM table the rollback would be a
		 * no-op and the only loss is the consistency above, not correctness of a
		 * completed run.
		 */
		$wpdb->query( 'SET autocommit = 0' );

		$total    = count( $run['refs'] );
		$deadline = $seconds > 0 ? microtime( true ) + $seconds : 0.0;
		$stopped  = '';

		while ( $run['at'] < $total ) {
			if ( $deadline > 0.0 && microtime( true ) >= $deadline ) {
				$stopped = 'budget';
				break;
			}

			$ref = (string) $run['refs'][ $run['at'] ];
			try {
				$outcome = self::one( $ref );
			} catch ( \Throwable $e ) {
				// Leave nothing half-written, and keep going: one broken style
				// must not end a run over the other 462.
				$wpdb->query( 'ROLLBACK' );
				$outcome = array(
					'outcome'  => 'failed',
					'problems' => array( 'Erreur pendant l’écriture : ' . $e->getMessage() ),
				);
			}

			$key = (string) ( $outcome['outcome'] ?? 'failed' );
			if ( isset( $run['stats'][ $key ] ) ) {
				++$run['stats'][ $key ];
			}
			$run['stats']['variations'] += (int) ( $outcome['variations'] ?? 0 );
			$run['stats']['images']     += (int) ( $outcome['images'] ?? 0 );

			if ( ! empty( $outcome['problems'] ) && count( $run['problems'] ) < self::MAX_PROBLEMS ) {
				$run['problems'][ $ref ] = $outcome['problems'];
			}

			++$run['at'];
			self::save_run( $run );
			$wpdb->query( 'COMMIT' );

			if ( $report ) {
				$report( $run['at'], $total, $ref, $outcome );
			}
		}

		wp_defer_term_counting( false );

		if ( $run['at'] >= $total ) {
			$run['stats']['delisted'] = self::delist( $run );
			$run['finished']          = gmdate( 'c' );
			$stopped                  = 'complete';
			self::save_run( $run );
		}

		// The deferred term counts and the delisting above are still inside the
		// open transaction; commit before handing the connection back.
		$wpdb->query( 'COMMIT' );
		$wpdb->query( 'SET autocommit = 1' );
		$wpdb->query( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', self::LOCK ) );

		return array(
			'ok'      => true,
			'stopped' => $stopped,
			'run'     => $run,
			'total'   => $total,
		);
	}

	/**
	 * Unpublish references the supplier has stopped listing.
	 *
	 * THREE CONDITIONS, ALL REQUIRED, and each of them is a way this could go
	 * badly wrong on a live shop:
	 *
	 *   The walk must have reached the end of the catalogue. A listing pass that
	 *   stopped early did not fail to find these references, it failed to look,
	 *   and unpublishing 400 products because the Worker had a bad minute is not
	 *   something anybody undoes by hand.
	 *
	 *   Only the families the run actually walked are considered. A run asked
	 *   for `--famille=tee` meets no polos, and must not conclude from that
	 *   that the supplier has dropped every polo.
	 *
	 *   `draft`, never deleted, and never trashed. The product may be on an
	 *   order, it carries the purchase prices the workshop reorders against, and
	 *   the day the supplier lists it again the next run republishes it with its
	 *   history intact.
	 *
	 * @return int How many were unpublished.
	 */
	private static function delist( array $run ): int {
		if ( empty( $run['complete'] ) ) {
			return 0;
		}
		$families = Catalogue::families( (string) $run['kind'] );
		if ( empty( $families ) ) {
			return 0;
		}

		$seen  = array_flip( array_map( 'strval', (array) $run['refs'] ) );
		$stale = get_posts(
			array(
				'post_type'              => 'product',
				'post_status'            => 'publish',
				'numberposts'            => -1,
				'fields'                 => 'ids',
				'no_found_rows'          => true,
				'update_post_term_cache' => false,
				'meta_query'             => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
					array(
						'key'     => Catalogue::META_FAMILY,
						'value'   => $families,
						'compare' => 'IN',
					),
				),
			)
		);

		$count = 0;
		foreach ( $stale as $id ) {
			$ref = (string) get_post_meta( (int) $id, Catalogue::META_REF, true );
			if ( '' === $ref || isset( $seen[ $ref ] ) ) {
				continue;
			}
			$product = wc_get_product( (int) $id );
			if ( ! $product instanceof \WC_Product ) {
				continue;
			}
			$product->set_status( 'draft' );
			$product->update_meta_data( self::META_DELISTED, '1' );
			$product->save();
			++$count;
		}
		return $count;
	}

	/** The run state as it stands, for a status command. */
	public static function status(): array {
		$run             = self::run_state();
		$run['total']    = count( $run['refs'] ?? array() );
		unset( $run['refs'] );
		return $run;
	}

	// -----------------------------------------------------------------------
	// One reference
	// -----------------------------------------------------------------------

	/**
	 * Fetch, map and write one style.
	 *
	 * Returns ['outcome' => created|updated|unchanged|skipped|failed, 'problems' => [...]].
	 * `skipped` is a reference the supplier lists with nothing sellable under it:
	 * reported and counted, but not an error, because it will be just as true
	 * tomorrow.
	 */
	public static function one( string $ref ): array {
		$fetched = Supply::entry( $ref );
		if ( empty( $fetched['ok'] ) ) {
			return array(
				'outcome'  => 'failed',
				'problems' => array( (string) $fetched['error'] ),
			);
		}

		$mapped = Catalogue::map( $fetched['entry'] );
		if ( empty( $mapped['ok'] ) ) {
			// "The supplier lists this reference and sells nothing under it" is
			// a fact to report, not a run to fail. See Catalogue::map.
			return array(
				'outcome'  => 'empty' === ( $mapped['reason'] ?? '' ) ? 'skipped' : 'failed',
				'problems' => (array) ( $mapped['problems'] ?? array() ),
			);
		}

		return self::write( $mapped );
	}

	/**
	 * Write one mapped style. The only function in the plugin that creates a
	 * product, so the whole shape of an imported reference is visible here.
	 */
	private static function write( array $mapped ): array {
		$ref        = (string) $mapped['ref'];
		$product_id = self::find( $ref );
		$is_new     = 0 === $product_id;
		$changed    = false;
		$problems   = (array) $mapped['problems'];

		$product = $is_new ? new \WC_Product_Variable() : wc_get_product( $product_id );
		if ( ! $product instanceof \WC_Product_Variable ) {
			/*
			 * The reference exists as some other product type, most likely
			 * because a human changed it. Converting it silently would drop its
			 * variations; refusing says so and leaves the shop alone.
			 */
			return array(
				'outcome'  => 'failed',
				'problems' => array( 'La référence ' . $ref . ' existe déjà et n’est pas un produit variable.' ),
			);
		}

		/*
		 * WHAT moved, not just THAT something moved.
		 *
		 * A run that reports "463 modified" every night and cannot say which
		 * field is a run nobody can debug, and the first two causes found here
		 * were both invisible fields the compare could never satisfy. The list
		 * is carried into the report and printed by the CLI.
		 */
		$why = array();

		/*
		 * THE PUBLIC REFERENCE IS RESOLVED HERE, not in the mapper, because
		 * uniqueness is a question about the whole shop and the mapper is pure.
		 *
		 * It used to be the supplier's style number, printed verbatim as
		 * `<span class="sku">00142</span>` on 463 product pages and returned by
		 * the public Store API. That number is the first five digits of the
		 * article number `Shelf` seals, so the shop was publishing most of the
		 * key it was hiding. The maker's own code carries none of that.
		 */
		$public = self::unique_sku( (string) $mapped['public_ref'], $product_id );

		// --- the product itself --------------------------------------------
		if ( self::set_if(
			$product,
			array(
				'name'              => $mapped['name'],
				'sku'               => $public,
				'description'       => self::describe( $mapped ),
				'short_description' => self::excerpt( $mapped ),
			)
		) ) {
			$why[]   = 'fiche';
			$changed = true;
		}

		if ( $is_new ) {
			$product->set_status( apply_filters( 'teeshoop_catalogue_status', 'publish', $mapped ) );
			$product->set_catalog_visibility( 'visible' );
		} elseif ( 'draft' === $product->get_status() && '1' === (string) $product->get_meta( self::META_DELISTED, true ) ) {
			/*
			 * BACK FROM THE DEAD, on purpose.
			 *
			 * `delist()` drafts a reference the supplier has stopped listing.
			 * Suppliers un-drop things: a style out of stock for a season comes
			 * back with the same number. Without this the product stayed a draft
			 * for ever, because the status is only ever set on creation, and the
			 * nightly run would report it "unchanged" while it sat invisible.
			 *
			 * Only a product THIS code drafted is republished. A draft a human
			 * made is a human's decision and the importer does not overrule it,
			 * which is what the marker meta is for.
			 */
			$product->set_status( 'publish' );
			$product->delete_meta_data( self::META_DELISTED );
			$why[]   = 'remise en ligne';
			$changed = true;
		}

		if ( self::set_meta(
			$product,
			array(
				Catalogue::META_REF           => $ref,
				Catalogue::META_FAMILY        => (string) $mapped['kind'],
				Catalogue::META_SIZESPEC      => (string) $mapped['sizespec'],
				Catalogue::META_WEIGHT_VARIES => $mapped['weight_varies'] ? '1' : '',
				Garments::META_BRAND          => (string) $mapped['brand'],
				Garments::META_BRAND_REF      => (string) $mapped['brand_ref'],
				Garments::META_MATERIAL       => (string) $mapped['material'],
				// Absent rather than zero: the specification block renders an
				// honest empty state, and 0 g/m² is not a garment.
				Garments::META_WEIGHT         => $mapped['weight_gsm'] > 0 ? (string) $mapped['weight_gsm'] : '',
			)
		) ) {
			$why[]   = 'caractéristiques';
			$changed = true;
		}

		// --- attributes -----------------------------------------------------
		$terms = array();
		foreach ( $mapped['attributes'] as $slug => $names ) {
			$terms[ $slug ] = Taxonomy::terms( $slug, $names );
		}
		if ( self::set_attributes( $product, $terms ) ) {
			$why[]   = 'attributs';
			$changed = true;
		}

		if ( $changed || $is_new ) {
			$product->save();
		}
		$product_id = (int) $product->get_id();
		if ( $product_id <= 0 ) {
			return array(
				'outcome'  => 'failed',
				'problems' => array( 'WooCommerce a refusé d’enregistrer la référence ' . $ref . '.' ),
			);
		}

		// --- category -------------------------------------------------------
		$category = Taxonomy::category_id( $mapped['categories'] );
		if ( $category > 0 ) {
			$current = wp_get_object_terms( $product_id, 'product_cat', array( 'fields' => 'ids' ) );
			if ( ! is_wp_error( $current ) && array( $category ) !== array_map( 'intval', $current ) ) {
				wp_set_object_terms( $product_id, array( $category ), 'product_cat' );
				$why[]   = 'rayon';
				$changed = true;
			}
		}

		// --- images ---------------------------------------------------------
		$images = self::images( $product_id, $public, $mapped, $problems );
		if ( $images['changed'] ) {
			$why[]   = 'photos';
			$changed = true;
		}

		// --- variations -----------------------------------------------------
		$vars = self::variations( $product_id, $public, $mapped, $terms, $problems );
		if ( $vars['changed'] ) {
			$why[]   = 'articles';
			$changed = true;
		}

		if ( $changed ) {
			/*
			 * THE SUPPLIER'S EXPORT STAMP IS WRITTEN ONLY WHEN SOMETHING ELSE
			 * MOVED, and that is the difference between a date that means
			 * something and a date that ruins the report.
			 *
			 * The supplier re-exports every morning, so `exported_at` changes on
			 * a style whose content is identical. Comparing it like any other
			 * field made every reference "modified" every night: 463 rows with a
			 * fresh `post_modified`, a sitemap telling Google the whole
			 * catalogue changed daily, and a run report in which "nothing
			 * changed" could never be printed and therefore never be believed.
			 *
			 * Written here, it answers "the supplier's version we last WROTE",
			 * which is what a person reading the specification block wants.
			 * "When did we last look" is a different question and the run state
			 * already answers it (`teeshoop catalogue etat`).
			 */
			/*
			 * ONE KEY, NOT TWO. This wrote the same value under
			 * `_teeshoop_exported` as well, which was a second column holding
			 * the identical fact on 462 products and read by nothing. The
			 * product page already reads `Garments::META_SPECS_DATE`, so that is
			 * the key, and its meaning is stated above: the supplier's version
			 * we last wrote.
			 */
			$stamp = (string) $mapped['exported_at'];
			if ( '' !== $stamp ) {
				$product->update_meta_data( Garments::META_SPECS_DATE, $stamp );
				$product->save();
			}

			/*
			 * Rebuild the parent's price range, stock status and attribute
			 * summary from its children, then warm the price transient.
			 *
			 * The warming is the point: `get_variation_prices()` walks every
			 * variation, and on a 366-variation style that is the slow first
			 * page load. Doing it here means the cron pays it, not a customer.
			 */
			\WC_Product_Variable::sync( $product_id );
			wc_delete_product_transients( $product_id );
			$fresh = wc_get_product( $product_id );
			if ( $fresh instanceof \WC_Product_Variable ) {
				/*
				 * BOTH VARIANTS, because they are two different caches.
				 *
				 * `get_variation_prices()` keys its transient on a hash that
				 * includes `$for_display`, and a product page renders the range
				 * with `true` (prices run through `wc_get_price_to_display`, so
				 * the tax basis is part of the answer). Warming only `false`
				 * filled a cache no customer page reads and left the cold walk
				 * over 366 variations exactly where it was: on the first
				 * visitor.
				 */
				$fresh->get_variation_prices( false );
				$fresh->get_variation_prices( true );
			}
		}

		return array(
			'outcome'    => $is_new ? 'created' : ( $changed ? 'updated' : 'unchanged' ),
			'why'        => $why,
			'problems'   => $problems,
			'variations' => $vars['written'],
			'images'     => $images['written'],
			'product_id' => $product_id,
		);
	}

	// -----------------------------------------------------------------------
	// Variations
	// -----------------------------------------------------------------------

	/**
	 * Create, update and remove the children of one product.
	 *
	 * Existing children are indexed by the supplier's article number, which is
	 * the only stable identity: our own reference is built from the maker's code
	 * and the colour and size names, and any of those can be re-lettered.
	 *
	 * `$public` is the parent's resolved reference and is PASSED IN rather than
	 * recomputed, because uniqueness was settled against the database in
	 * `write()`. It was briefly read as a variable from the caller's scope,
	 * which PHP resolves to null in a different method: every variation was then
	 * offered the SKU "-WHITE-XS", identical across styles, and WooCommerce
	 * rejected 41 of the first 47 references with "Invalid or duplicated SKU".
	 */
	private static function variations( int $product_id, string $public, array $mapped, array $terms, array &$problems ): array {
		$children = self::children( $product_id );
		$rate     = self::margin_rate();
		$written  = 0;
		$changed  = false;
		$kept     = array();

		/*
		 * "THE SUPPLIER HAS NO PRICE" AND "WE COULD NOT READ THE PRICES" ARE
		 * DIFFERENT, AND ONLY ONE OF THEM MAY TOUCH WHAT IS ALREADY STORED.
		 *
		 * `Catalogue::map` carries the distinction as `has_prices`, and for one
		 * revision nothing read it. The consequence, traced end to end: the
		 * supplier's price CGI times out for one style, the Worker's
		 * `Promise.allSettled` correctly returns the detail with `prices: null`,
		 * every SKU maps to `supply_cents => null`, and the loop below writes ''
		 * (which `set_meta` turns into `delete_meta_data`). One slow minute
		 * upstream and the cost basis is gone from every variation of that
		 * style, `regular_price` is cleared with it so the product silently
		 * stops being purchasable, and the run exits 0.
		 *
		 * So when the payload as a whole is unusable, the price and the cost are
		 * simply not in the write set. A SKU missing from an otherwise good
		 * price list is the other case, and there clearing IS right: the
		 * supplier has stopped pricing that article.
		 */
		$prices_usable    = ! empty( $mapped['has_prices'] );
		$barcodes_refused = 0;

		$colour_tax = Taxonomy::taxonomy( 'couleur' );
		$size_tax   = Taxonomy::taxonomy( 'taille' );

		foreach ( $mapped['variations'] as $row ) {
			$supply = (string) $row['supply_sku'];
			$id     = $children[ $supply ] ?? 0;
			$is_new = 0 === $id;

			$variation = $is_new ? new \WC_Product_Variation() : wc_get_product( $id );
			if ( ! $variation instanceof \WC_Product_Variation ) {
				continue;
			}
			$kept[ $supply ] = true;

			if ( $is_new ) {
				$variation->set_parent_id( $product_id );
				$variation->set_status( 'publish' );
			}

			$colour_slug = $terms['couleur'][ $row['couleur'] ]['slug'] ?? '';
			$size_slug   = $terms['taille'][ $row['taille'] ]['slug'] ?? '';
			if ( '' === $colour_slug || '' === $size_slug ) {
				// Without both terms the variation cannot be chosen, and a
				// variation nobody can select is a variation that quietly makes
				// the whole product unpurchasable.
				$problems[] = 'Attribut manquant pour l’article ' . $row['supply_sku'] . '.';
				continue;
			}

			$props = array(
				// Unique by construction: the parent reference is unique across
				// the shop and the suffix is deduplicated within the style.
				'sku'    => '' === $public ? '' : $public . '-' . (string) $row['sku_suffix'],
				'weight' => $row['weight_kg'] > 0 ? (string) $row['weight_kg'] : '',
			);
			$meta  = array(
				Catalogue::META_SUPPLY_SKU   => $supply,
				Catalogue::META_COLOUR_PHOTO => (string) $row['photo'],
				Catalogue::META_ORIGIN       => (string) $row['origin'],
				Catalogue::META_CLOSEOUT     => $row['closeout'] ? '1' : '',
			);
			if ( $prices_usable ) {
				$props['regular_price']                = self::price_of( $row['supply_cents'], $rate );
				$meta[ Catalogue::META_SUPPLY_CENTS ] = null === $row['supply_cents'] ? '' : (string) $row['supply_cents'];
			}

			$touched = self::set_if( $variation, $props );

			$barcode = self::set_barcode( $variation, (string) $row['ean'] );
			if ( 1 === $barcode ) {
				$touched = true;
			} elseif ( -1 === $barcode ) {
				++$barcodes_refused;
			}

			$attributes = array(
				$colour_tax => $colour_slug,
				$size_tax   => $size_slug,
			);
			if ( $variation->get_attributes() !== $attributes ) {
				$variation->set_attributes( $attributes );
				$touched = true;
			}

			$touched = self::set_meta( $variation, $meta ) || $touched;

			$touched = self::set_stock( $variation, $row['stock'], $is_new ) || $touched;

			if ( $touched || $is_new ) {
				$variation->save();
				++$written;
				$changed = true;
			}
		}

		if ( $barcodes_refused > 0 ) {
			// One line, not one per article: style 12639 alone would print four.
			$problems[] = sprintf(
				'%d code(s)-barres refusé(s) par WooCommerce (déjà utilisés ailleurs). Les articles sont en ligne sans code-barres.',
				$barcodes_refused
			);
		}

		// --- gone from the supplier -----------------------------------------
		foreach ( $children as $supply => $id ) {
			if ( isset( $kept[ $supply ] ) ) {
				continue;
			}
			/*
			 * Trashed, not deleted. A variation can be on an order that has not
			 * shipped, and `wp_delete_post` on it makes that order line lose the
			 * thing it refers to. The shop sees it in the trash and a human
			 * decides.
			 */
			$gone = wc_get_product( (int) $id );
			if ( $gone instanceof \WC_Product_Variation ) {
				$gone->set_status( 'trash' );
				$gone->save();
				$changed = true;
			}
		}

		return array(
			'changed' => $changed,
			'written' => $written,
		);
	}

	/**
	 * A public reference nobody else is using.
	 *
	 * MEASURED across the catalogue: all 463 styles publish a maker's code, and
	 * exactly one brand-and-code pair is shared by two styles (Russell Athletic
	 * 0R599M0, on 59800 and 59900). One collision does not justify inventing a
	 * scheme, it justifies a suffix. A candidate is kept when the SKU is free or
	 * already ours, so a product never loses its reference to itself on a later
	 * run.
	 *
	 * Empty when the maker publishes no code, and empty is a valid answer:
	 * WooCommerce does not require a SKU, and a made-up one is worse than none.
	 */
	private static function unique_sku( string $wanted, int $own_id ): string {
		if ( '' === $wanted ) {
			return '';
		}
		$candidate = $wanted;
		for ( $n = 2; $n <= 20; $n++ ) {
			$taken = (int) wc_get_product_id_by_sku( $candidate );
			if ( 0 === $taken || $taken === $own_id ) {
				return $candidate;
			}
			$candidate = $wanted . '-' . $n;
		}
		return '';
	}

	/**
	 * The barcode on the garment's own label. It may never stop a garment being
	 * sold.
	 *
	 * MEASURED, AND IT COST THREE REFERENCES. WooCommerce 9.2 promoted
	 * `_global_unique_id` to a first-class property and made
	 * `set_global_unique_id()` THROW when the value is already carried by
	 * another product. The supplier's data contains such collisions: 4 of the
	 * 21 479 barcodes in this catalogue are used by more than one article, and
	 * one of them (4053840000000) is an obvious placeholder shared by four
	 * articles of style 12639. Setting the barcode inside `set_if` let that
	 * exception escape the whole reference, so the first full import lost
	 * 10154, 12154 and 12639 entirely: hundreds of sellable garments missing
	 * from the shop because two of them share a number nobody reads.
	 *
	 * So the barcode is written on its own, and a refusal costs the barcode
	 * rather than the garment. A SKU collision still fails the reference, and
	 * must: two products claiming one reference is a real conflict.
	 *
	 * It is also the reason this is a property and not meta. A promoted key
	 * becomes an INTERNAL meta key, so `get_meta()` returns '' while
	 * `update_meta_data()` writes happily, and the comparison never matched:
	 * the import could not report "nothing changed" even when nothing had.
	 *
	 * @return int 1 written, 0 unchanged or unsupported, -1 refused by WooCommerce.
	 */
	private static function set_barcode( \WC_Product_Variation $variation, string $ean ): int {
		if ( ! method_exists( $variation, 'set_global_unique_id' ) ) {
			return 0;
		}
		if ( (string) $variation->get_global_unique_id( 'edit' ) === $ean ) {
			return 0;
		}
		try {
			$variation->set_global_unique_id( $ean );
			return 1;
		} catch ( \Throwable $e ) {
			return -1;
		}
	}

	/**
	 * Existing children, indexed by the supplier's article number.
	 *
	 * The meta cache is primed in one query first: a 366-variation style would
	 * otherwise be 366 round trips to the database before a single write.
	 */
	private static function children( int $product_id ): array {
		$product = wc_get_product( $product_id );
		if ( ! $product instanceof \WC_Product_Variable ) {
			return array();
		}
		$ids = array_map( 'intval', $product->get_children() );
		if ( empty( $ids ) ) {
			return array();
		}
		_prime_post_caches( $ids, false, true );

		$out = array();
		foreach ( $ids as $id ) {
			$supply = (string) get_post_meta( $id, Catalogue::META_SUPPLY_SKU, true );
			if ( '' !== $supply ) {
				$out[ $supply ] = $id;
			}
		}
		return $out;
	}

	/**
	 * Stock, or an honest absence of it.
	 *
	 * `null` means the feed did not mention this article. A NEW variation in
	 * that state is created managed and empty, because an unmanaged variation
	 * is for sale in unlimited quantity and we would be promising a garment we
	 * cannot see. An EXISTING one keeps whatever it had: a feed that skipped a
	 * line is not a warehouse that emptied.
	 */
	private static function set_stock( \WC_Product_Variation $variation, ?int $quantity, bool $is_new ): bool {
		$changed = false;

		/*
		 * `null` is "the feed did not mention this article".
		 *
		 * A NEW variation in that state is created managed and empty, because an
		 * unmanaged variation is for sale in unlimited quantity and we would be
		 * promising a garment we cannot see. An EXISTING one KEEPS ITS QUANTITY:
		 * a feed that skipped a line is not a warehouse that emptied.
		 *
		 * But the rest is still asserted. Returning early here also skipped
		 * `manage_stock` and `backorders`, so a variation whose stock management
		 * had been switched off by hand, or by an import that ran before this
		 * code existed, would sell without limit for ever, and every future run
		 * would walk past it because the feed happened to be missing that row.
		 */
		if ( null === $quantity ) {
			if ( $is_new ) {
				$quantity = 0;
			} else {
				if ( true !== $variation->get_manage_stock() ) {
					$variation->set_manage_stock( true );
					$changed = true;
				}
				if ( 'no' !== $variation->get_backorders() ) {
					$variation->set_backorders( 'no' );
					$changed = true;
				}
				return $changed;
			}
		}

		if ( true !== $variation->get_manage_stock() ) {
			$variation->set_manage_stock( true );
			$changed = true;
		}
		if ( (int) $variation->get_stock_quantity() !== $quantity ) {
			$variation->set_stock_quantity( $quantity );
			$changed = true;
		}
		$status = $quantity > 0 ? 'instock' : 'outofstock';
		if ( $variation->get_stock_status() !== $status ) {
			$variation->set_stock_status( $status );
			$changed = true;
		}
		if ( 'no' !== $variation->get_backorders() ) {
			// Never. The supplier's stock is the only thing behind this number.
			$variation->set_backorders( 'no' );
			$changed = true;
		}
		return $changed;
	}

	// -----------------------------------------------------------------------
	// Price
	// -----------------------------------------------------------------------

	/**
	 * The target margin rate, or null when the shop has not been given one.
	 *
	 * Null is the shipped state and it is not an oversight: the rate is a
	 * business decision nobody at Teeshoop has made yet (question 42), and a
	 * catalogue priced on a rate this file invented would be 26 399 garments
	 * sold at a number nobody agreed to.
	 */
	private static function margin_rate(): ?float {
		$raw = Settings::pricing()['blank_margin_rate'] ?? null;
		if ( null === $raw || '' === $raw ) {
			return null;
		}
		/*
		 * "0,45" IS A NUMBER HERE.
		 *
		 * This is the same lesson `Money::from_eur` already carries: the person
		 * who sets this is French and will type a comma. `is_numeric( '0,45' )`
		 * is false, so the rate silently read as unset, so the next run wrote no
		 * price at all, and a catalogue that quietly stops being purchasable
		 * overnight looks exactly like a catalogue nobody has priced yet.
		 */
		if ( is_string( $raw ) ) {
			$raw = str_replace( ',', '.', trim( $raw ) );
		}
		if ( ! is_numeric( $raw ) ) {
			self::log( 'blank_margin_rate is not a number; no price will be written.' );
			return null;
		}
		$rate = (float) $raw;
		if ( $rate < 0 || $rate >= 1 ) {
			self::log( 'blank_margin_rate must be in [0, 1); no price will be written.' );
			return null;
		}
		return $rate;
	}

	/** Straight to the PHP log: this runs under cron, where nobody is reading a screen. */
	private static function log( string $message ): void {
		if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
			error_log( 'teeshoop catalogue: ' . $message ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		}
	}

	/**
	 * Supplier price plus the target margin, as WooCommerce wants it: euros in
	 * a string.
	 *
	 * `number_format` and not a plain cast. Casting a float to a string in PHP
	 * uses `precision` from php.ini, which is 14 by default and is not 14
	 * everywhere: o2switch is not this machine. A price that renders as
	 * "8.4299999999999997" on one host and "8.43" on another is the kind of
	 * difference that only shows up on the invoice.
	 */
	private static function price_of( ?int $supply_cents, ?float $rate ): string {
		if ( null === $rate || null === $supply_cents || $supply_cents <= 0 ) {
			return '';
		}
		return number_format( Money::to_eur( Margin::recommended_price( $supply_cents, $rate ) ), 2, '.', '' );
	}

	// -----------------------------------------------------------------------
	// Images
	// -----------------------------------------------------------------------

	/**
	 * The featured image and the back shot, copied into the media library once.
	 *
	 * Keyed by the supplier's file name, which is versioned by the supplier
	 * (`…-2019_01.jpg`) and therefore changes when the photo does. So a re-shoot
	 * downloads a new file and an unchanged photo downloads nothing, on every
	 * run, for ever.
	 */
	private static function images( int $product_id, string $public, array $mapped, array &$problems ): array {
		$changed = false;

		/*
		 * COPIED, not merely attached.
		 *
		 * This counter is printed as "photo(s) copiée(s)", and it used to count
		 * every attachment the run resolved, including the ones already in the
		 * media library, which cost nothing. A no-op pass therefore reported 97
		 * photographs copied while copying none, which is the kind of number
		 * somebody later uses to argue about bandwidth. `attachment()` reports
		 * whether it actually downloaded.
		 */
		$downloads = 0;
		/*
		 * THE FILE IS RENAMED ON THE WAY IN, and that is a leak fix, not tidiness.
		 *
		 * The supplier names its photographs `180_09_344_m-2023_01.jpg`: style
		 * 18009, colour 344. Sideloaded as-is they land in wp-content/uploads
		 * under a public URL, so every mirrored photograph published the same
		 * two fields the article number is built from, and the seal on
		 * `_teeshoop_supply_sku` was worth nothing against anyone who read an
		 * <img src>. The name we choose carries the maker's code instead, which
		 * is public information and is what a buyer recognises.
		 */
		$base      = '' !== $public ? $public : 'ref-' . $mapped['ref'];
		$front     = self::attachment( (string) $mapped['front'], $mapped['name'], $problems, $downloads, $base );
		$back      = self::attachment( (string) $mapped['back'], $mapped['name'] . ' (dos)', $problems, $downloads, $base . '-dos' );

		$product = wc_get_product( $product_id );
		if ( ! $product instanceof \WC_Product ) {
			return array(
				'changed' => false,
				'written' => 0,
			);
		}

		if ( $front > 0 && (int) $product->get_image_id() !== $front ) {
			$product->set_image_id( $front );
			$changed = true;
		}

		/*
		 * A FAILED DOWNLOAD IS NOT AN ABSENT PHOTO.
		 *
		 * `attachment()` returns 0 both when the supplier has no back shot and
		 * when the fetch failed, and the gallery used to be set from that 0
		 * unconditionally. So one 502 on one night removed the back photo the
		 * product already had, and the next night's run put it back: a product
		 * whose gallery flickered with the supplier's uptime, on a shop where
		 * nobody was watching. The mapping knows which case it is, so the
		 * gallery is only cleared when the supplier genuinely has no back.
		 */
		$has_back = '' !== (string) $mapped['back'];
		if ( $back > 0 || ! $has_back ) {
			$gallery = $back > 0 ? array( $back ) : array();
			if ( array_map( 'intval', $product->get_gallery_image_ids() ) !== $gallery ) {
				$product->set_gallery_image_ids( $gallery );
				$changed = true;
			}
		}
		if ( $changed ) {
			$product->save();
		}

		return array(
			'changed' => $changed,
			'written' => $downloads,
		);
	}

	/**
	 * An attachment for one supplier photo, downloading it only the first time.
	 *
	 * Returns the attachment id, 0 when there is no photo, and -1 is never
	 * returned: a download that fails is a problem on the report and a product
	 * with no picture, not a product that stops importing.
	 */
	private static function attachment( string $path, string $title, array &$problems, int &$downloads, string $as ): int {
		if ( '' === $path ) {
			return 0;
		}
		$file = basename( wp_parse_url( $path, PHP_URL_PATH ) ?? '' );
		if ( '' === $file ) {
			return 0;
		}

		$existing = get_posts(
			array(
				'post_type'              => 'attachment',
				'post_status'            => 'inherit',
				'numberposts'            => 1,
				'fields'                 => 'ids',
				'meta_key'               => self::META_SOURCE, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
				'meta_value'             => $file,             // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
				'no_found_rows'          => true,
				'update_post_term_cache' => false,
			)
		);
		if ( ! empty( $existing ) ) {
			return (int) $existing[0];
		}

		$url = Shelf::photo_url( $path );
		if ( '' === $url ) {
			return 0;
		}

		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';

		/*
		 * `wp_remote_get`, not `download_url`.
		 *
		 * `download_url` fetches through `wp_safe_remote_get`, whose whole job
		 * is to refuse a URL that resolves to a private address: the standard
		 * defence against being tricked into fetching something on the server's
		 * own network. That defence is for URLs an ATTACKER supplies. Here the
		 * host is the shop's own configured Worker and the path is one this
		 * plugin wrote, checked by `Shelf::photo_url` to start with /media/ and
		 * to contain no traversal.
		 *
		 * It is not a theoretical difference: the local mirror reaches the
		 * Worker at `host.docker.internal`, which resolves to 172.x, so every
		 * single photo was refused with "A valid URL was not provided" and the
		 * whole catalogue imported without a picture. Measured on the first run.
		 */
		$response = wp_remote_get(
			$url,
			array(
				'timeout'  => 60,
				'headers'  => array( 'accept' => 'image/*' ),
			)
		);
		if ( is_wp_error( $response ) ) {
			$problems[] = 'Photo non récupérée (' . $file . ') : ' . $response->get_error_message();
			return 0;
		}
		$code = (int) wp_remote_retrieve_response_code( $response );
		$body = (string) wp_remote_retrieve_body( $response );
		if ( 200 !== $code || '' === $body ) {
			$problems[] = 'Photo non récupérée (' . $file . ') : HTTP ' . $code . '.';
			return 0;
		}
		/*
		 * The bytes have to BE an image, not merely be labelled one. Without
		 * this the SPA fallback's HTML lands in the media library as a .jpg and
		 * every product carries a broken picture that looks imported. It is how
		 * the missing `run_worker_first` entry was found.
		 */
		if ( "\xFF\xD8\xFF" !== substr( $body, 0, 3 ) && "\x89PNG" !== substr( $body, 0, 4 ) ) {
			$problems[] = 'Photo non récupérée (' . $file . ') : la réponse n’est pas une image.';
			return 0;
		}

		$tmp = wp_tempnam( $file );
		if ( ! $tmp || false === file_put_contents( $tmp, $body ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- a temp file for media_handle_sideload, which wants a path.
			$problems[] = 'Photo non écrite (' . $file . ').';
			return 0;
		}

		// Our name, the supplier's extension. `$file` stays the identity key in
		// META_SOURCE below, so a re-shoot still downloads and an unchanged
		// photograph still does not.
		$ext      = strtolower( (string) pathinfo( $file, PATHINFO_EXTENSION ) );
		$our_name = sanitize_file_name( $as . ( '' !== $ext ? '.' . $ext : '.jpg' ) );

		$id = media_handle_sideload(
			array(
				'name'     => $our_name,
				'tmp_name' => $tmp,
			),
			0,
			$title
		);
		if ( is_wp_error( $id ) ) {
			wp_delete_file( $tmp );
			$problems[] = 'Photo refusée (' . $file . ') : ' . $id->get_error_message();
			return 0;
		}

		++$downloads;
		update_post_meta( (int) $id, self::META_SOURCE, $file );
		// Real alt text, from the product's own name. An empty alt on a
		// catalogue of 463 photographs is 463 accessibility failures.
		update_post_meta( (int) $id, '_wp_attachment_image_alt', $title );

		return (int) $id;
	}

	// -----------------------------------------------------------------------
	// Small helpers
	// -----------------------------------------------------------------------

	/** The product carrying this supplier reference, or 0. */
	public static function find( string $ref ): int {
		$found = get_posts(
			array(
				'post_type'              => 'product',
				'post_status'            => 'any',
				'numberposts'            => 1,
				'fields'                 => 'ids',
				'meta_key'               => Catalogue::META_REF, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
				'meta_value'             => $ref,                // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
				'no_found_rows'          => true,
				'update_post_term_cache' => false,
			)
		);
		return empty( $found ) ? 0 : (int) $found[0];
	}

	/**
	 * Set CRUD properties, and report whether any of them actually moved.
	 *
	 * The comparison is on the getter's own value, so WooCommerce's own
	 * normalisation (a price stored as '9.50', a weight as '0.15') is what gets
	 * compared and a run does not "change" a field into the same string.
	 */
	private static function set_if( \WC_Product $product, array $values ): bool {
		$changed = false;
		foreach ( $values as $prop => $value ) {
			$getter = 'get_' . $prop;
			$setter = 'set_' . $prop;
			if ( ! method_exists( $product, $getter ) || ! method_exists( $product, $setter ) ) {
				continue;
			}
			if ( (string) $product->{$getter}( 'edit' ) === (string) $value ) {
				continue;
			}
			$product->{$setter}( $value );
			$changed = true;
		}
		return $changed;
	}

	/** Same, for meta. An empty value deletes rather than storing ''. */
	private static function set_meta( \WC_Product $product, array $values ): bool {
		$changed = false;
		foreach ( $values as $key => $value ) {
			$current = (string) $product->get_meta( $key, true );
			if ( $current === (string) $value ) {
				continue;
			}
			if ( '' === (string) $value ) {
				$product->delete_meta_data( $key );
			} else {
				$product->update_meta_data( $key, (string) $value );
			}
			$changed = true;
		}
		return $changed;
	}

	/**
	 * The product's attribute set, built from term ids.
	 *
	 * Colour and size are marked `variation`; the rest are there to be filtered
	 * on. Compared by the same shape it writes, so an unchanged product does not
	 * rewrite eight taxonomies every night.
	 */
	private static function set_attributes( \WC_Product $product, array $terms ): bool {
		$position = 0;
		$wanted   = array();

		foreach ( Catalogue::ATTRIBUTES as $slug => $spec ) {
			if ( empty( $terms[ $slug ] ) ) {
				continue;
			}
			$taxonomy  = Taxonomy::taxonomy( $slug );
			$attribute = new \WC_Product_Attribute();
			$attribute->set_id( wc_attribute_taxonomy_id_by_name( $taxonomy ) );
			$attribute->set_name( $taxonomy );
			$attribute->set_options( array_column( $terms[ $slug ], 'id' ) );
			$attribute->set_position( $position++ );
			$attribute->set_visible( true );
			$attribute->set_variation( (bool) $spec['variation'] );
			$wanted[ $taxonomy ] = $attribute;
		}

		/*
		 * COMPARED AS SETS, NOT AS SEQUENCES, and that is not fussiness.
		 *
		 * A taxonomy attribute's options are written as an array of term ids in
		 * the order the supplier lists them, and read back by
		 * `WC_Product_Data_Store_CPT::read_attributes()` through
		 * `wc_get_object_terms()`, which returns them in WordPress's own order.
		 * The two are almost never the same sequence, so a sequence comparison
		 * found a difference on every single run: the product was re-saved, and
		 * a re-save with changed attributes makes WooCommerce regenerate the
		 * attribute summary of EVERY variation. On the 366-variation style that
		 * was 366 pointless writes a night, and the import could never report
		 * "nothing changed".
		 *
		 * Order carries no meaning here: WooCommerce renders attribute terms in
		 * the taxonomy's own `order_by`, which is alphabetical for colours and
		 * our size rank for sizes.
		 */
		$current = $product->get_attributes();
		if ( count( $current ) === count( $wanted ) ) {
			$same = true;
			foreach ( $wanted as $taxonomy => $attribute ) {
				$have = $current[ $taxonomy ] ?? null;
				if ( ! $have instanceof \WC_Product_Attribute || $have->get_variation() !== $attribute->get_variation() ) {
					$same = false;
					break;
				}
				$mine  = array_map( 'intval', $have->get_options() );
				$their = array_map( 'intval', $attribute->get_options() );
				sort( $mine );
				sort( $their );
				if ( $mine !== $their ) {
					$same = false;
					break;
				}
			}
			if ( $same ) {
				return false;
			}
		}

		$product->set_attributes( $wanted );
		return true;
	}

	/**
	 * The product description: the supplier's own bullet list, as a list.
	 *
	 * It arrives as lines prefixed with a middle dot. Rendering it verbatim
	 * gives a wall of dots, and running it through wpautop gives one paragraph
	 * with dots in it. A `<ul>` is what it always was.
	 */
	private static function describe( array $mapped ): string {
		$items = array();
		foreach ( preg_split( '/\R/u', (string) $mapped['description'] ) ?: array() as $line ) {
			$line = trim( ltrim( trim( $line ), "·-•\u{00B7}" ) );
			if ( '' !== $line ) {
				$items[] = '<li>' . esc_html( $line ) . '</li>';
			}
		}
		if ( empty( $items ) ) {
			return '';
		}
		return '<ul class="teeshoop-specs">' . implode( '', $items ) . '</ul>';
	}

	/** One line a buyer can read in a listing, built only from facts we hold. */
	private static function excerpt( array $mapped ): string {
		$bits = array();
		if ( '' !== (string) $mapped['material'] ) {
			$bits[] = (string) $mapped['material'];
		}
		if ( $mapped['weight_gsm'] > 0 ) {
			$bits[] = $mapped['weight_gsm'] . "\u{00A0}g/m²" . ( $mapped['weight_varies'] ? ' (selon le coloris)' : '' );
		}
		$colours = count( $mapped['attributes']['couleur'] ?? array() );
		if ( $colours > 1 ) {
			$bits[] = $colours . "\u{00A0}coloris";
		}
		return implode( ' · ', $bits );
	}

	// -----------------------------------------------------------------------
	// Run state
	// -----------------------------------------------------------------------

	private static function empty_stats(): array {
		return array(
			'created'    => 0,
			'updated'    => 0,
			'unchanged'  => 0,
			'skipped'    => 0,
			'failed'     => 0,
			'delisted'   => 0,
			'variations' => 0,
			'images'     => 0,
		);
	}

	private static function run_state(): array {
		$run = get_option( self::OPTION_RUN, array() );
		if ( ! is_array( $run ) ) {
			$run = array();
		}
		return array_merge(
			array(
				'kind'     => 'printable',
				'refs'     => array(),
				'at'       => 0,
				'complete' => false,
				'started'  => '',
				'finished' => '',
				'stats'    => self::empty_stats(),
				'problems' => array(),
			),
			$run
		);
	}

	private static function save_run( array $run ): void {
		update_option( self::OPTION_RUN, $run, false );
	}

	/** For the tests and for a clean restart. */
	public static function forget_run(): void {
		delete_option( self::OPTION_RUN );
	}
}
