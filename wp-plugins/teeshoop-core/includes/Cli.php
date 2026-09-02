<?php
/**
 * `wp teeshoop …`: provisioning and checks for the local mirror.
 *
 * WHY THIS EXISTS. The mirror's state lived only inside two docker volumes.
 * WooCommerce, the French store settings, the 20 % VAT row, the classic theme
 * and the demo product were all installed by hand, so `docker compose down -v`
 * destroyed a day's setup with nothing in the repository able to rebuild it,
 * and a new machine started from clicking. `wp teeshoop provisionner` is that
 * missing script: idempotent, quiet about what already exists, and loud about
 * what it changed.
 *
 * It is a DEVELOPMENT tool and it says so before it writes anything. It sets
 * shop-wide options, which on a production site is not a command anyone should
 * be able to run by accident, so it refuses unless the site looks like the
 * local mirror or `--forcer` is passed.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class Cli {

	/** Stable slug so the command can be run twice without piling up products. */
	private const DEMO_SLUG = 'teeshoop-demo-tee';

	public static function init(): void {
		if ( ! defined( 'WP_CLI' ) || ! \WP_CLI ) {
			return;
		}
		\WP_CLI::add_command( 'teeshoop provisionner', array( self::class, 'provision' ) );
		\WP_CLI::add_command( 'teeshoop verifier', array( self::class, 'check' ) );
		\WP_CLI::add_command( 'teeshoop catalogue importer', array( self::class, 'catalogue_import' ) );
		\WP_CLI::add_command( 'teeshoop catalogue etat', array( self::class, 'catalogue_state' ) );
		\WP_CLI::add_command( 'teeshoop catalogue purger', array( self::class, 'catalogue_purge' ) );
		\WP_CLI::add_command( 'teeshoop marge', array( self::class, 'margin_report' ) );
		\WP_CLI::add_command( 'teeshoop stock rafraichir', array( self::class, 'stock_refresh' ) );
		\WP_CLI::add_command( 'teeshoop couleurs mesurer', array( self::class, 'colours_measure' ) );
		\WP_CLI::add_command( 'teeshoop couleurs etat', array( self::class, 'colours_state' ) );
		\WP_CLI::add_command( 'teeshoop couleurs reclasser', array( self::class, 'colours_reclassify' ) );
		\WP_CLI::add_command( 'teeshoop couleurs oublier', array( self::class, 'colours_forget' ) );
		\WP_CLI::add_command( 'teeshoop juridique', array( self::class, 'legal_pages' ) );
		\WP_CLI::add_command( 'teeshoop migrer', array( self::class, 'migrate' ) );
		\WP_CLI::add_command( 'teeshoop lancement', array( self::class, 'launch' ) );
	}

	/**
	 * Refresh every imported article's stock from one supplier snapshot.
	 *
	 * ## WHY THIS IS NOT THE CATALOGUE IMPORT
	 *
	 * The import walks 459 references, writing titles, photos, attributes and
	 * prices, and takes half an hour. Chapter 04 of the brief asks for stock
	 * « plusieurs fois par jour si l'API le permet » and for purchase prices
	 * « quotidien ou selon changement », which are two different jobs. This is
	 * the fast one: ONE upstream call for the whole catalogue (the Worker holds
	 * the snapshot, MEASURED at 46 591 articles in 674 ms), then a handful of
	 * page requests to read it.
	 *
	 *     0 2,6,10,14,18,22 * * *  cd /home/xxx/public_html && wp teeshoop stock rafraichir --discret
	 *
	 * Six times a day, which is `Purchase::STOCK_REFRESH_HOURS`. Written out
	 * rather than as a step expression because a step expression contains the
	 * two characters that end a PHP comment, and this line lives in one.
	 *
	 * ## WHAT IT WRITES, AND WHAT IT REFUSES TO WRITE
	 *
	 * The quantity, through WooCommerce, only for the articles whose quantity
	 * actually moved. And the supplier's own snapshot timestamp on every article
	 * the snapshot mentioned, which is what lets a product page say « Disponible »
	 * rather than « Délai à confirmer ».
	 *
	 * AN ARTICLE THE SNAPSHOT DID NOT MENTION KEEPS ITS OLD DATE, and therefore
	 * goes stale by itself. That is the whole point: a sweep that stamped
	 * everything it did not see with today's date would turn a supplier who
	 * dropped an article into a shop that claims it is available.
	 *
	 * A PARTIAL SWEEP STAMPS ONLY WHAT IT SAW. If a page fails halfway, the
	 * articles already written carry a real observation and the rest carry their
	 * previous one; nothing is invented and nothing is rolled back, because a
	 * quantity that was true five minutes ago is not made false by the next page
	 * timing out.
	 *
	 * ## OPTIONS
	 *
	 * [--pages=<n>]
	 * : Stop after this many pages. 0 = walk to the end. Default 0.
	 *
	 * [--discret]
	 * : Print only the summary line, for a cron.
	 */
	public static function stock_refresh( array $args, array $assoc_args ): void {
		$quiet     = isset( $assoc_args['discret'] );
		$max_pages = max( 0, (int) ( $assoc_args['pages'] ?? 0 ) );

		$why = Supply::unconfigured();
		if ( '' !== $why ) {
			\WP_CLI::error( $why );
		}

		$started = microtime( true );
		$known   = self::supply_index();
		if ( array() === $known ) {
			\WP_CLI::error( 'Aucun article importé ne porte de référence fournisseur : il n’y a rien à rafraîchir. Lancez d’abord « wp teeshoop catalogue importer ».' );
		}
		if ( ! $quiet ) {
			\WP_CLI::log( sprintf( '%d articles importés à rafraîchir.', count( $known ) ) );
		}

		$current = self::stock_index( array_values( $known ) );

		$offset  = 0;
		$pages   = 0;
		$seen    = array();
		$moved   = 0;
		$latest  = '';
		$failure = '';

		while ( true ) {
			$page = Supply::stock_page( $offset );
			if ( ! $page['ok'] ) {
				$failure = (string) $page['error'];
				break;
			}
			++$pages;
			$latest = (string) $page['at'];

			foreach ( $page['rows'] as $row ) {
				if ( ! is_array( $row ) || count( $row ) < 2 ) {
					continue;
				}
				$sku = (string) $row[0];
				if ( ! isset( $known[ $sku ] ) ) {
					continue;
				}
				$id = (int) $known[ $sku ];
				/*
				 * THE SAME INDEX THE CATALOGUE SELLS AGAINST, by name rather than
				 * by a literal 0 here. Question 43 asks the supplier which of his
				 * three numbers is stock; the day the answer moves that index,
				 * this sweep has to move with it or the shop would sell against
				 * one number and buy against another.
				 */
				$qty = max( 0, (int) ( $row[ Catalogue::STOCK_INDEX + 1 ] ?? 0 ) );
				$seen[] = $id;
				if ( ( $current[ $id ] ?? null ) !== $qty ) {
					$product = wc_get_product( $id );
					if ( $product instanceof \WC_Product ) {
						wc_update_product_stock( $product, $qty, 'set' );
						++$moved;
					}
				}
			}

			if ( ! $quiet ) {
				\WP_CLI::log( sprintf( 'page %d : %d lignes, %d articles connus vus, %d quantités modifiées.', $pages, (int) $page['total'] > 0 ? count( $page['rows'] ) : 0, count( $seen ), $moved ) );
			}

			$next = $page['next'];
			if ( null === $next || ( $max_pages > 0 && $pages >= $max_pages ) ) {
				break;
			}
			$offset = (int) $next;
		}

		$stamped = '' !== $latest ? self::stamp_stock( array_unique( $seen ), $latest ) : 0;

		update_option(
			'teeshoop_stock_sweep',
			array(
				'at'      => $latest,
				'on'      => Settings::today(),
				'seen'    => count( array_unique( $seen ) ),
				'known'   => count( $known ),
				'moved'   => $moved,
				'pages'   => $pages,
				'error'   => $failure,
				'seconds' => round( microtime( true ) - $started, 1 ),
			),
			false
		);

		$summary = sprintf(
			'Stock : %d articles sur %d relevés au %s, %d quantités modifiées, %d dates écrites, %d page(s), %s s.',
			count( array_unique( $seen ) ),
			count( $known ),
			'' !== $latest ? $latest : '(sans date)',
			$moved,
			$stamped,
			$pages,
			Money::number( round( microtime( true ) - $started, 1 ), 1 )
		);

		if ( '' !== $failure ) {
			\WP_CLI::warning( $summary );
			\WP_CLI::error( 'Relevé interrompu : ' . $failure );
		}
		\WP_CLI::success( $summary );
	}

	/**
	 * Every imported article, by supplier article number.
	 *
	 * One query. `get_post_meta` per variation would be 26 399 round trips for a
	 * job whose whole point is to be cheap enough to run six times a day.
	 *
	 * @return array<string,int>
	 */
	private static function supply_index(): array {
		global $wpdb;
		$rows = $wpdb->get_results( // phpcs:ignore WordPress.DB.DirectDatabaseQuery -- one indexed read of our own meta; see the docblock.
			$wpdb->prepare( "SELECT post_id, meta_value FROM {$wpdb->postmeta} WHERE meta_key = %s", Catalogue::META_SUPPLY_SKU ),
			ARRAY_A
		);
		$out = array();
		foreach ( (array) $rows as $row ) {
			$sku = (string) ( $row['meta_value'] ?? '' );
			if ( '' !== $sku ) {
				$out[ $sku ] = (int) $row['post_id'];
			}
		}
		return $out;
	}

	/**
	 * The quantity each of those articles currently carries.
	 *
	 * Read straight from `_stock` rather than through `wc_get_product`, because
	 * the only thing this is for is deciding which articles need loading at all.
	 * Anything that WRITES goes through WooCommerce (`wc_update_product_stock`),
	 * which keeps the product lookup table and the transients in step.
	 *
	 * @param int[] $ids
	 * @return array<int,int>
	 */
	private static function stock_index( array $ids ): array {
		global $wpdb;
		$out = array();
		foreach ( array_chunk( $ids, 2000 ) as $chunk ) {
			$in   = implode( ',', array_map( 'intval', $chunk ) );
			$rows = $wpdb->get_results( // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL -- ids are cast to int on the line above.
				"SELECT post_id, meta_value FROM {$wpdb->postmeta} WHERE meta_key = '_stock' AND post_id IN ({$in})",
				ARRAY_A
			);
			foreach ( (array) $rows as $row ) {
				$out[ (int) $row['post_id'] ] = null === $row['meta_value'] || '' === $row['meta_value'] ? null : (int) $row['meta_value'];
			}
		}
		return $out;
	}

	/**
	 * Write the snapshot's timestamp onto every article it mentioned.
	 *
	 * ONE VALUE FOR ALL OF THEM, which is what makes this affordable: the whole
	 * sweep reads one snapshot, so 26 399 articles receive the same string and
	 * the write is a handful of `UPDATE … WHERE post_id IN (…)` rather than
	 * 26 399 calls. Rows that do not exist yet are inserted in the same chunks.
	 *
	 * DIRECT SQL, DELIBERATELY, and only on our own private meta: nothing else
	 * indexes it, no lookup table mirrors it, and no WooCommerce cache holds it.
	 * The quantity beside it is written through WooCommerce for exactly the
	 * opposite reasons.
	 *
	 * @param int[] $ids
	 * @return int How many rows now carry the date.
	 */
	private static function stamp_stock( array $ids, string $at ): int {
		global $wpdb;
		$key     = Catalogue::META_STOCK_AT;
		$written = 0;

		foreach ( array_chunk( array_map( 'intval', $ids ), 2000 ) as $chunk ) {
			$in = implode( ',', $chunk );
			$wpdb->query( // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL -- ids cast to int; the value is prepared.
				$wpdb->prepare(
					"UPDATE {$wpdb->postmeta} SET meta_value = %s WHERE meta_key = %s AND post_id IN ({$in})",
					$at,
					$key
				)
			);
			$missing = $wpdb->get_col( // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL
				$wpdb->prepare(
					"SELECT p.ID FROM {$wpdb->posts} p LEFT JOIN {$wpdb->postmeta} m ON m.post_id = p.ID AND m.meta_key = %s WHERE p.ID IN ({$in}) AND m.meta_id IS NULL",
					$key
				)
			);
			foreach ( (array) $missing as $id ) {
				add_post_meta( (int) $id, $key, $at, true );
			}
			$written += count( $chunk );
		}

		/*
		 * The meta cache holds what was read before the direct write. Leaving it
		 * would make the very next read on this process return yesterday's date,
		 * which on a cron matters not at all and in a test matters entirely.
		 */
		wp_cache_flush_group( 'post_meta' );
		return $written;
	}

	/**
	 * Import the supplier catalogue into WooCommerce.
	 *
	 * Idempotent and resumable. Re-running it when nothing has moved upstream
	 * writes nothing and says so. Interrupting it loses at most the reference in
	 * flight; the next run continues from the same place, which is what makes
	 * `--duree` a usable cron slot rather than a job somebody has to watch:
	 *
	 *     7 3 * * *  cd /home/xxx/public_html && wp teeshoop catalogue importer --duree=1800 --discret
	 *
	 * Needs `define( 'TEESHOOP_CATALOGUE_TOKEN', '…' );` in wp-config.php and a
	 * Worker URL in the plugin's settings. Without either it refuses, because
	 * an import that ran without prices looks exactly like one that worked.
	 *
	 * ## OPTIONS
	 *
	 * [--famille=<famille>]
	 * : printable (default), tee, polo, sweat, all.
	 *
	 * [--duree=<secondes>]
	 * : Stop cleanly after this many seconds and keep the place. 0 = no limit.
	 *
	 * [--max=<n>]
	 * : Only plan the first n references. For a smoke test, never for production.
	 *
	 * [--recommencer]
	 * : Throw away an unfinished run and re-list the catalogue.
	 *
	 * [--discret]
	 * : Only the summary, not one line per reference. What a cron wants.
	 *
	 * NOT --quiet, which is WP-CLI's OWN global flag and suppresses every
	 * WP_CLI::log in the process, summary included. The documented cron line
	 * carried it for one revision, so the nightly log would have recorded
	 * nothing at all: no counts, no failures, no reason to look.
	 *
	 * ## EXAMPLES
	 *
	 *     wp teeshoop catalogue importer --max=5
	 *     wp teeshoop catalogue importer --duree=1800 --discret
	 *
	 * @param array $args       Positional arguments.
	 * @param array $assoc_args Flags.
	 */
	public static function catalogue_import( array $args, array $assoc_args ): void {
		$why = Supply::unconfigured();
		if ( '' !== $why ) {
			\WP_CLI::error( $why );
		}

		$quiet   = ! empty( $assoc_args['discret'] );
		$famille = (string) ( $assoc_args['famille'] ?? 'printable' );
		$max     = (int) ( $assoc_args['max'] ?? 0 );

		$plan = Importer::plan( $famille, ! empty( $assoc_args['recommencer'] ), $max );
		if ( empty( $plan['ok'] ) ) {
			\WP_CLI::error( (string) ( $plan['error'] ?? 'La planification a échoué.' ) );
		}

		$run   = $plan['run'];
		$total = count( $run['refs'] );
		if ( 0 === $total ) {
			\WP_CLI::error( 'Le catalogue n’a renvoyé aucune référence. Rien n’a été importé.' );
		}

		if ( empty( $plan['resumed'] ) ) {
			$walk = $plan['walk'] ?? array();
			\WP_CLI::log(
				sprintf(
					'%d référence(s) à traiter (%s), listées en %s appel(s), %s s.',
					$total,
					$famille,
					(string) ( $walk['calls'] ?? '?' ),
					(string) ( $walk['seconds'] ?? '?' )
				)
			);
			if ( ! empty( $plan['warning'] ) ) {
				\WP_CLI::warning( (string) $plan['warning'] );
			}
			if ( empty( $run['complete'] ) ) {
				\WP_CLI::warning( 'La liste est incomplète : aucune référence ne sera retirée de la boutique sur la foi de cette passe.' );
			}
		} else {
			\WP_CLI::log( sprintf( 'Reprise à %d/%d.', (int) $run['at'], $total ) );
		}

		$started = microtime( true );
		$result  = Importer::run(
			(int) ( $assoc_args['duree'] ?? 0 ),
			$quiet
				? null
				: static function ( int $at, int $of, string $ref, array $outcome ): void {
					$note = empty( $outcome['problems'] ) ? '' : '  ! ' . implode( ' / ', $outcome['problems'] );
					$why  = empty( $outcome['why'] ) ? '' : '  (' . implode( ', ', $outcome['why'] ) . ')';
					\WP_CLI::log(
						sprintf(
							'  %4d/%-4d  %-6s  %-9s  %3d article(s)%s%s',
							$at,
							$of,
							$ref,
							(string) $outcome['outcome'],
							(int) ( $outcome['variations'] ?? 0 ),
							$why,
							$note
						)
					);
				}
		);

		if ( empty( $result['ok'] ) ) {
			\WP_CLI::error( (string) ( $result['error'] ?? 'L’import a échoué.' ) );
		}

		$run     = $result['run'];
		$stats   = $run['stats'];
		$seconds = round( microtime( true ) - $started, 1 );

		\WP_CLI::log( '' );
		\WP_CLI::log(
			sprintf(
				'%d créé(s), %d modifié(s), %d inchangé(s), %d sans article, %d en échec, %d dépublié(s). %d article(s) écrit(s), %d photo(s) copiée(s). %s s.',
				$stats['created'],
				$stats['updated'],
				$stats['unchanged'],
				$stats['skipped'] ?? 0,
				$stats['failed'],
				$stats['delisted'] ?? 0,
				$stats['variations'],
				$stats['images'],
				$seconds
			)
		);

		foreach ( $run['problems'] as $ref => $list ) {
			\WP_CLI::log( '  ' . $ref . ' : ' . implode( ' / ', (array) $list ) );
		}

		if ( 'budget' === $result['stopped'] ) {
			\WP_CLI::success(
				sprintf( 'Temps imparti atteint à %d/%d. Relancez la commande pour continuer.', (int) $run['at'], (int) $result['total'] )
			);
			return;
		}

		if ( $stats['failed'] > 0 ) {
			\WP_CLI::error( sprintf( 'Import terminé avec %d référence(s) en échec.', $stats['failed'] ) );
		}

		/*
		 * "Sans article" does NOT exit non-zero.
		 *
		 * Two references of the catalogue (50001 and 50101, verified) are listed
		 * by the supplier with zero coloris, zero articles and zero tailles.
		 * That will be just as true tomorrow, and a cron that mails a failure
		 * every night for a permanent condition is a cron whose mail nobody
		 * reads by the time it matters. It is reported and counted; it is not an
		 * error.
		 */
		if ( ( $stats['skipped'] ?? 0 ) > 0 ) {
			\WP_CLI::log(
				sprintf(
					'%d référence(s) listée(s) par le fournisseur sans aucun article vendable : rien à publier.',
					(int) $stats['skipped']
				)
			);
		}

		if ( 0 === $stats['created'] + $stats['updated'] ) {
			\WP_CLI::success( 'Rien n’a changé : la boutique était déjà à jour.' );
			return;
		}
		\WP_CLI::success( 'Catalogue à jour.' );
	}

	/**
	 * Where the last import got to.
	 *
	 * ## EXAMPLES
	 *
	 *     wp teeshoop catalogue etat
	 */
	public static function catalogue_state(): void {
		$state = Importer::status();
		$total = (int) $state['total'];

		if ( 0 === $total ) {
			\WP_CLI::log( 'Aucun import n’a encore été planifié.' );
			return;
		}

		\WP_CLI::log( sprintf( 'Famille          : %s', (string) $state['kind'] ) );
		\WP_CLI::log( sprintf( 'Avancement       : %d/%d', (int) $state['at'], $total ) );
		\WP_CLI::log( sprintf( 'Liste complète   : %s', empty( $state['complete'] ) ? 'non' : 'oui' ) );
		\WP_CLI::log( sprintf( 'Démarré          : %s', (string) $state['started'] ) );
		\WP_CLI::log( sprintf( 'Terminé          : %s', '' === (string) $state['finished'] ? 'en cours' : (string) $state['finished'] ) );
		foreach ( $state['stats'] as $key => $value ) {
			\WP_CLI::log( sprintf( '  %-14s %d', $key, (int) $value ) );
		}
		foreach ( $state['problems'] as $ref => $list ) {
			\WP_CLI::log( '  ' . $ref . ' : ' . implode( ' / ', (array) $list ) );
		}
	}

	/**
	 * Remove every imported reference. Development only.
	 *
	 * Refuses on anything that does not look like the local mirror, for the same
	 * reason `provisionner` does: this deletes products, and a product that has
	 * been ordered is referenced by an order.
	 *
	 * ## OPTIONS
	 *
	 * [--forcer]
	 * : Run even when the site does not look like the local mirror.
	 *
	 * ## EXAMPLES
	 *
	 *     wp teeshoop catalogue purger
	 *
	 * @param array $args       Positional arguments.
	 * @param array $assoc_args Flags.
	 */
	public static function catalogue_purge( array $args, array $assoc_args ): void {
		$home  = (string) get_option( 'home' );
		$local = (bool) preg_match( '#^https?://(localhost|127\.0\.0\.1|.*\.test|.*\.local)(:\d+)?#i', $home );
		if ( ! $local && empty( $assoc_args['forcer'] ) ) {
			\WP_CLI::error( "Ce site ne ressemble pas au miroir local ({$home}). Relancez avec --forcer si c’est bien voulu." );
		}

		global $wpdb;

		$ids = get_posts(
			array(
				'post_type'   => 'product',
				'post_status' => 'any',
				'numberposts' => -1,
				'fields'      => 'ids',
				'meta_key'    => Catalogue::META_REF, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
			)
		);
		if ( empty( $ids ) ) {
			Importer::forget_run();
			\WP_CLI::success( '0 référence(s) importée(s) supprimée(s).' );
			return;
		}

		/*
		 * BULK SQL, NOT `wp_delete_post` IN A LOOP, AND THAT IS THE POINT OF
		 * THIS COMMAND EXISTING AT ALL.
		 *
		 * A full catalogue is 26 399 variations, and deleting them one at a time
		 * through the CRUD costs well over half an hour: every single delete
		 * fires WooCommerce's hooks, clears the parent's transients and touches
		 * the lookup table. Measured by watching `npm run verify:wp-catalogue`
		 * spend thirty minutes in `purger` before it could assert anything, which
		 * is how a verification gate becomes a gate nobody runs.
		 *
		 * Bypassing the CRUD is safe HERE and nowhere else: this command already
		 * refuses to run on anything that does not look like the local mirror,
		 * it deletes only rows this importer created, and its whole purpose is to
		 * return a development database to a known state. Every table WooCommerce
		 * derives from these posts is cleaned below, and the product transients
		 * are flushed at the end, so nothing is left pointing at a row that is
		 * gone.
		 */
		$parents  = array_map( 'intval', $ids );
		$in       = implode( ',', $parents );
		$children = $wpdb->get_col( "SELECT ID FROM {$wpdb->posts} WHERE post_type='product_variation' AND post_parent IN ({$in})" ); // phpcs:ignore WordPress.DB
		$all      = array_merge( $parents, array_map( 'intval', $children ) );

		foreach ( array_chunk( $all, 2000 ) as $chunk ) {
			$list = implode( ',', $chunk );
			$wpdb->query( "DELETE FROM {$wpdb->postmeta} WHERE post_id IN ({$list})" ); // phpcs:ignore WordPress.DB
			$wpdb->query( "DELETE FROM {$wpdb->term_relationships} WHERE object_id IN ({$list})" ); // phpcs:ignore WordPress.DB
			$wpdb->query( "DELETE FROM {$wpdb->prefix}wc_product_meta_lookup WHERE product_id IN ({$list})" ); // phpcs:ignore WordPress.DB
			$wpdb->query( "DELETE FROM {$wpdb->posts} WHERE ID IN ({$list})" ); // phpcs:ignore WordPress.DB
		}

		// The term counts are now wrong for every attribute and category the
		// deleted products were in, and a stale count shows an empty archive as
		// though it had products.
		foreach ( get_taxonomies( array(), 'names' ) as $taxonomy ) {
			$terms = get_terms(
				array(
					'taxonomy'   => $taxonomy,
					'hide_empty' => false,
					'fields'     => 'ids',
				)
			);
			if ( ! is_wp_error( $terms ) && ! empty( $terms ) ) {
				wp_update_term_count_now( $terms, $taxonomy );
			}
		}
		wc_delete_product_transients();
		wp_cache_flush();

		Importer::forget_run();
		\WP_CLI::success(
			sprintf( '%d référence(s) et %d article(s) supprimé(s).', count( $parents ), count( $children ) )
		);
	}

	/**
	 * Set up a working shop and a working product page.
	 *
	 * ## OPTIONS
	 *
	 * [--forcer]
	 * : Run even when the site does not look like the local mirror.
	 *
	 * [--origine-studio=<url>]
	 * : Origin the studio iframe is loaded from.
	 *
	 * [--worker=<url>]
	 * : Base URL of the Cloudflare Worker that confirms a design exists.
	 *
	 * ## EXAMPLES
	 *
	 *     wp teeshoop provisionner
	 *     wp teeshoop provisionner --origine-studio=http://localhost:8788 --worker=http://host.docker.internal:8788
	 *
	 * @param array $args       Positional arguments.
	 * @param array $assoc_args Flags.
	 */
	public static function provision( array $args, array $assoc_args ): void {
		$home = (string) get_option( 'home' );
		$local = (bool) preg_match( '#^https?://(localhost|127\.0\.0\.1|.*\.test|.*\.local)(:\d+)?#i', $home );

		if ( ! $local && empty( $assoc_args['forcer'] ) ) {
			\WP_CLI::error(
				"Ce site ne ressemble pas au miroir local ({$home}).\n" .
				'La commande écrit des réglages boutique (devise, TVA, pays). Relancez avec --forcer si c’est bien voulu.'
			);
		}

		if ( ! class_exists( 'WooCommerce' ) ) {
			\WP_CLI::error( 'WooCommerce n’est pas actif. Installez-le d’abord : wp plugin install woocommerce --version=11.0.1 --activate' );
		}

		$changed = array();

		/*
		 * A French shop, because that is what is being mirrored.
		 *
		 * WooCommerce ships as a USD store and renders the number the plugin
		 * hands it with the STORE's symbol: a 384,25 EUR line came out as
		 * $384.25 all the way to the invoice. Same digits, wrong money.
		 */
		$options = array(
			'woocommerce_currency'            => 'EUR',
			'woocommerce_default_country'     => 'FR:IDF',
			'woocommerce_currency_pos'        => 'right_space',
			'woocommerce_price_decimal_sep'   => ',',
			'woocommerce_price_thousand_sep'  => ' ',
			/*
			 * The carriage grid is in GRAMS and the supplier's weights are in
			 * kilogrammes. WooCommerce ships as `lbs`, which is what this mirror
			 * was still set to on 18/08/2026: a 180 g t-shirt entered as 0,18
			 * weighed 82 g, four bracket steps down, and every parcel would have
			 * been quoted below cost with the difference coming out of the
			 * margin. `Compat::check` now says so too.
			 */
			'woocommerce_weight_unit'         => 'kg',
			// Follows the regime in force rather than being asserted: under the
			// franchise the correct WooCommerce state is taxes OFF, and a
			// provisioning script that forced them on would put the shop in the
			// exact state `Checkout::woo_tax_mismatch` refuses to sell in.
			'woocommerce_calc_taxes'          => Vat::FRANCHISE === ( Settings::vat()['regime'] ?? '' ) ? 'no' : 'yes',
			// Businesses read HT, so that is the basis prices are entered and
			// shown in; the templates print TTC beside every HT figure.
			'woocommerce_prices_include_tax'  => 'no',
			'woocommerce_tax_display_shop'    => 'excl',
			'woocommerce_tax_display_cart'    => 'excl',

			/*
			 * THE SHOP IS OPEN.
			 *
			 * WooCommerce ships new installs in "coming soon" mode, and with
			 * `store_pages_only` it replaces every product page with "Great
			 * things are on the horizon" for anyone not logged in. Nothing warns
			 * you: the page answers 200, the plugin's own CSS and JavaScript are
			 * still enqueued in the head, and only the body is gone. It cost a
			 * confused half hour here, and the browser assertions refused to
			 * report a pass because they had found nothing to assert about,
			 * which is the only reason it was noticed at all.
			 */
			'woocommerce_coming_soon'         => 'no',
		);
		foreach ( $options as $key => $value ) {
			if ( get_option( $key ) !== $value ) {
				update_option( $key, $value );
				$changed[] = $key;
			}
		}

		self::ensure_vat_row( $changed );
		self::ensure_shipping_zone( $changed );
		self::ensure_permalinks( $changed );
		self::ensure_classic_theme( $changed );
		self::ensure_no_demo_content( $changed );
		self::ensure_french_shop_pages( $changed );
		self::ensure_site_pages( $changed );
		self::ensure_settings( $assoc_args, $changed );

		$product_id = self::ensure_demo_product( $changed );
		self::flush_rewrites();

		\WP_CLI::log( '' );
		if ( empty( $changed ) ) {
			\WP_CLI::log( 'Rien à changer : la boutique était déjà configurée.' );
		} else {
			\WP_CLI::log( 'Modifié : ' . implode( ', ', $changed ) );
		}
		\WP_CLI::log( 'Fiche produit : ' . get_permalink( $product_id ) );
		if ( in_array( 'permaliens', $changed, true ) ) {
			// This process built its rewrite object before the structure changed,
			// so the URL above is the plain form. It works; the pretty one is
			// live from the next request, once WordPress has rebuilt the rules.
			\WP_CLI::log( 'Les permaliens viennent d’être activés : l’adresse ci-dessus fonctionne, la forme lisible l’est dès la requête suivante.' );
		}

		$compat = Compat::check();
		if ( ! $compat['ok'] ) {
			\WP_CLI::warning( 'Compatibilité WooCommerce : ' . implode( ' / ', $compat['problems'] ) );
		}

		\WP_CLI::success( 'Boutique prête.' );
	}

	/**
	 * Report whether WooCommerce still looks like the version this was written
	 * against, and exit non-zero when it does not.
	 *
	 * ## EXAMPLES
	 *
	 *     wp teeshoop verifier
	 */
	/**
	 * Print what one order really cost, and what it earned.
	 *
	 *   wp teeshoop marge 123
	 *   wp teeshoop marge 123 --recalculer
	 *
	 * The same report the order screen renders, from the same call, in a form
	 * that can be pasted into a review. It exists because a screenshot is not
	 * evidence and a screen cannot be diffed: this is how a claim about an
	 * order's economics gets checked by somebody who was not there.
	 *
	 * `--recalculer` asks the nesting service again and stores the answer;
	 * without it the stored report is printed, or computed once if there is none.
	 *
	 * ## OPTIONS
	 *
	 * <commande>
	 * : The WooCommerce order id.
	 *
	 * [--recalculer]
	 * : Recompute and store instead of reading what was stored.
	 */
	public static function margin_report( array $args, array $assoc_args ): void {
		$order = wc_get_order( (int) ( $args[0] ?? 0 ) );
		if ( ! $order instanceof \WC_Order ) {
			\WP_CLI::error( 'Commande introuvable.' );
		}

		$report = ! empty( $assoc_args['recalculer'] ) ? Costing::refresh( $order ) : ( Costing::stored( $order ) ?? Costing::refresh( $order ) );

		$money = static fn( int $cents ): string => str_pad( Money::format( $cents ), 14, ' ', STR_PAD_LEFT );

		\WP_CLI::log( '' );
		\WP_CLI::log(
			sprintf(
				'Commande %s, chiffrée le %s%s',
				$order->get_order_number(),
				(string) $report['computed_on'],
				self::stale_note( Costing::staleness( $order, $report ) )
			)
		);
		\WP_CLI::log( str_repeat( '-', 78 ) );

		\WP_CLI::log( 'COÛT DIRECT' );
		foreach ( (array) $report['cost']['lines'] as $line ) {
			\WP_CLI::log(
				sprintf(
					'  %-22s %s   %-8s %s',
					(string) $line['label'],
					Cost::UNKNOWN === $line['confidence'] ? str_pad( 'inconnu', 14, ' ', STR_PAD_LEFT ) : $money( (int) $line['amount_ht'] ),
					(string) $line['confidence'],
					(string) $line['source']
				)
			);
		}
		\WP_CLI::log(
			sprintf(
				'  %-22s %s   %s%s',
				'TOTAL CONNU',
				$money( (int) $report['cost']['total_ht'] ),
				$report['cost']['complete'] ? 'complet' : 'incomplet',
				(int) $report['cost']['best_ht'] < (int) $report['cost']['total_ht']
					? ', au mieux ' . Money::format( (int) $report['cost']['best_ht'] )
					: ''
			)
		);

		\WP_CLI::log( '' );
		\WP_CLI::log( 'PRIX' );
		\WP_CLI::log( sprintf( '  %-22s %s', 'Vendue HT', $money( (int) $report['revenue']['total_ht'] ) ) );

		/*
		 * NO PLAN, NO PRICE BLOCK. Reading a null plan's fields yields 0 and
		 * every verdict test yields false, so this printed a clean green report
		 * of five zeroes and the words VENDABLE SANS VALIDATION, while the
		 * warnings that explained it went to stderr. `> preuve.txt` captured the
		 * green half and dropped the red one. This command exists to be evidence.
		 */
		if ( ! is_array( $report['plan'] ?? null ) ) {
			\WP_CLI::log( '  ' . str_pad( 'AUCUN PRIX PLANCHER CALCULABLE', 24, ' ', STR_PAD_LEFT ) );
			foreach ( (array) $report['warnings'] as $warning ) {
				\WP_CLI::log( '  ' . (string) $warning );
			}
			\WP_CLI::log( '' );
			\WP_CLI::error( 'Les taux en vigueur n’ont pas de solution pour cette commande.' );
		}
		\WP_CLI::log( sprintf( '  %-22s %s', 'Prix conseillé', $money( (int) $report['plan']['recommended_ht'] ) ) );
		\WP_CLI::log( sprintf( '  %-22s %s   %s', 'Prix plancher', $money( (int) $report['plan']['floor_ht'] ), $report['cost']['complete'] ? '' : '(minimum : coût incomplet)' ) );
		\WP_CLI::log(
			sprintf(
				'  %-22s %s',
				'Règle appliquée',
				is_array( $report['rule'] ?? null )
					? ( '' !== (string) $report['rule']['label'] ? (string) $report['rule']['label'] : (string) $report['rule']['id'] )
					: ( (int) ( $report['version'] ?? 1 ) < Costing::VERSION ? 'chiffrage antérieur aux règles' : 'aucune, réglages généraux' )
			)
		);
		\WP_CLI::log( sprintf( '  %-22s %s', 'Marge contributive', $money( (int) $report['verdict']['margin_ht'] ) ) );
		\WP_CLI::log( sprintf( '  %-22s %s   %s (%s)', 'Commission', $money( (int) $report['commission']['earned_ht'] ), (string) $report['state']['state'], (string) $report['sale_type'] ) );
		\WP_CLI::log( sprintf( '  %-22s %s', 'Reste à Teeshoop', $money( (int) $report['verdict']['margin_ht'] - (int) $report['commission']['full_ht'] ) ) );

		$verdict = 'VENDABLE SANS VALIDATION';
		if ( ! empty( $report['verdict']['below_cost'] ) ) {
			$verdict = 'SOUS LE COÛT DIRECT';
		} elseif ( ! empty( $report['verdict']['below_floor'] ) ) {
			$verdict = empty( $report['covered'] ) ? 'SOUS LE PLANCHER, SANS DÉROGATION' : 'SOUS LE PLANCHER, SOUS DÉROGATION';
		} elseif ( ! empty( $report['verdict']['needs_approval'] ) ) {
			$verdict = 'REMISE AU-DELÀ DE CE QU’UN COMMERCIAL PEUT ACCORDER';
		}
		\WP_CLI::log( sprintf( '  %-22s %s', 'Verdict', str_pad( $verdict, 14, ' ', STR_PAD_LEFT ) ) );

		if ( is_array( $report['film'] ) ) {
			\WP_CLI::log( '' );
			/*
			 * A POOLED ORDER'S `billed_m` IS THE WHOLE RUN'S, not this order's.
			 * Printing it under this order's number read as a fifteen-metre order
			 * where the order needed two, and the transfer count beside it made it
			 * look like a measurement of this order. Say whose metres they are.
			 */
			/*
			 * IN THE UNIT THE SUPPLIER INVOICES. This printed metres whatever the
			 * tariff, and since question 04's answer the invoice counts 33 x 46 cm
			 * sheets: a line an operator holds against a real document has to name
			 * the thing the document counts. Found by the adversarial pass.
			 */
			$sheets = 'sheet' === (string) ( $report['film']['billing'] ?? 'roll' )
				&& null !== ( $report['film']['billed_sheets'] ?? null );
			$amount = $sheets
				? Money::number( (float) $report['film']['billed_sheets'], 0 ) . ' feuille(s)'
				: Money::number( (float) $report['film']['billed_m'], 2 ) . ' m';
			\WP_CLI::log(
				empty( $report['film']['pooled'] )
				? sprintf(
					'FILM  %s imbriqués, %d transferts%s',
					$amount,
					(int) $report['work']['transfers'],
					empty( $report['film']['bound'] ) ? '' : ' (borne haute, service indisponible)'
				)
				: sprintf(
					'FILM  part d’un lot de %d commandes imbriquées sur %s (lot n° %d), %d transferts pour celle-ci',
					(int) ( $report['film']['orders'] ?? 1 ),
					$amount,
					(int) ( $report['film']['lot_id'] ?? 0 ),
					(int) $report['work']['transfers']
				)
			);
		}

		foreach ( (array) $report['warnings'] as $warning ) {
			\WP_CLI::warning( (string) $warning );
		}
		\WP_CLI::log( '' );
	}

	/**
	 * Why a stored report no longer describes what it claims to, on one line.
	 *
	 * THREE REASONS AND NOT ONE. This printed "la commande a changé depuis" for
	 * all of them the day the check grew two more, so a report superseded by a
	 * rule table blamed an order nobody had touched, in writing, in the output
	 * this command exists to be evidence in.
	 */
	private static function stale_note( string $stale ): string {
		switch ( $stale ) {
			case 'commande':
				return '  [PÉRIMÉ : la commande a changé depuis]';
			case 'reglages':
				return '  [PÉRIMÉ : les règles de plancher ou les taux ont changé depuis]';
			case 'version':
				return '  [PÉRIMÉ : chiffrage antérieur aux règles de plancher]';
			default:
				return '';
		}
	}

	public static function check(): void {
		$result = Compat::check();

		foreach ( $result['problems'] as $problem ) {
			\WP_CLI::log( '  - ' . $problem );
		}

		if ( 0 === $result['checked'] ) {
			// "Nothing found" and "nothing looked" are different results.
			\WP_CLI::error( 'Le contrôle n’a rien vérifié du tout.' );
		}

		if ( ! $result['ok'] ) {
			\WP_CLI::error(
				sprintf(
					'%d problème(s) sur %d points vérifiés. Repères relevés sur WooCommerce %s, site en %s.',
					count( $result['problems'] ),
					$result['checked'],
					Compat::PINNED_AGAINST,
					defined( 'WC_VERSION' ) ? WC_VERSION : '?'
				)
			);
		}

		\WP_CLI::success( sprintf( '%d points vérifiés, tout concorde.', $result['checked'] ) );
	}

	/**
	 * A real VAT row, because every template prints a TTC figure.
	 *
	 * The mirror shipped with taxes enabled and zero rows, so the studio said
	 * 326,10 EUR TTC while the cart said 271,75 EUR with no tax: 54,35 EUR
	 * apart, on a caption the invoice would contradict.
	 *
	 * THE RATE IS READ, NOT WRITTEN. It used to be a percentage typed here as a
	 * string, which is the same number as `vat_rate` in the price config and
	 * would have stopped being the same number the day the rate is answered
	 * (question 17 of QUESTIONS-ASSOCIE.md, registered as H-Q17-TVA in
	 * docs/hypotheses.json). A WooCommerce tax row and
	 * a price authority that disagree is the exact shape of the 54,35 EUR bug
	 * this function exists to prevent.
	 */
	private static function ensure_vat_row( array &$changed ): void {
		global $wpdb;

		$regime = Settings::vat();

		$existing = $wpdb->get_var( // phpcs:ignore WordPress.DB.DirectDatabaseQuery -- no API exists to read the tax table.
			"SELECT tax_rate_id FROM {$wpdb->prefix}woocommerce_tax_rates WHERE tax_rate_name = 'TVA' AND tax_rate_country = 'FR' LIMIT 1"
		);

		/*
		 * UNDER THE FRANCHISE THE ROW IS REMOVED, not merely left unused.
		 * Taxes are switched off above, so a rate sitting in the table charges
		 * nothing today, and it charges 20 % the moment anybody turns taxes back
		 * on for an unrelated reason. A shop in franchise that invoices VAT
		 * becomes liable for it by the sole fact of having invoiced it.
		 */
		if ( Vat::FRANCHISE === ( $regime['regime'] ?? '' ) ) {
			if ( $existing ) {
				\WC_Tax::_delete_tax_rate( (int) $existing );
				$changed[] = 'TVA retirée (franchise en base)';
			}
			return;
		}

		if ( $existing ) {
			return;
		}

		$rate = (float) Settings::pricing()['vat_rate'];

		\WC_Tax::_insert_tax_rate(
			array(
				'tax_rate_country'  => 'FR',
				'tax_rate'          => number_format( $rate * 100, 4, '.', '' ),
				'tax_rate_name'     => 'TVA',
				'tax_rate_priority' => 1,
				'tax_rate_shipping' => 1,
				'tax_rate_class'    => '',
			)
		);
		// Two decimals and not none: `Money::number` defaults to zero decimals,
		// which reported a 5,5 % rate as "TVA 6 %" while writing 5.5000 to the
		// table. A number shown to an operator that is not the number written is
		// exactly what this whole session exists to stop.
		$changed[] = 'TVA ' . Money::number( $rate * 100, 2 ) . "\u{00A0}%";
	}

	/**
	 * One delivery zone, France, with our own method in it.
	 *
	 * A `WC_Shipping_Method` that is in no zone is a method WooCommerce never
	 * asks for a rate, so the checkout offers nothing and says nothing. That is
	 * a configuration step and not a code one, which is exactly why it belongs
	 * in the provisioning command rather than in a hook: the alternative is a
	 * plugin that silently rewrites a shop's delivery zones on activation.
	 */
	private static function ensure_shipping_zone( array &$changed ): void {
		foreach ( \WC_Shipping_Zones::get_zones() as $zone ) {
			foreach ( (array) ( $zone['shipping_methods'] ?? array() ) as $method ) {
				if ( Shipping::METHOD_ID === $method->id ) {
					return;
				}
			}
		}

		$zone = new \WC_Shipping_Zone();
		$zone->set_zone_name( 'France métropolitaine' );
		$zone->add_location( 'FR', 'country' );
		$zone->save();
		$zone->add_shipping_method( Shipping::METHOD_ID );
		$zone->save();

		\WC_Cache_Helper::get_transient_version( 'shipping', true );
		$changed[] = 'zone de livraison France métropolitaine';
	}

	/**
	 * Pretty permalinks.
	 *
	 * A fresh WordPress uses the plain structure, where `rest_url()` already
	 * carries a '?'. Every REST consumer here builds its URL with `URL` +
	 * `searchParams` for that reason, but the mirror should still look like
	 * production, where o2switch serves pretty permalinks.
	 */
	private static function ensure_permalinks( array &$changed ): void {
		if ( '' === (string) get_option( 'permalink_structure' ) ) {
			update_option( 'permalink_structure', '/%postname%/' );
			$changed[] = 'permaliens';
		}

		self::ensure_french_bases( $changed );
	}

	/**
	 * The two words WooCommerce puts in front of every product URL, in French.
	 *
	 * A shop that sells only in France (question 35) served
	 * `teeshoop.com/product-category/t-shirts/` and `teeshoop.com/product/…`.
	 * Chapter 04's SEO section asks for « URL courte » and the session brief asks
	 * for clean French URLs; neither word is French and `product-category` is the
	 * longest base WooCommerce ships.
	 *
	 * WHY IT IS SAFE TO CHANGE NOW AND NOT LATER, which is the whole argument.
	 * `Cli::ensure_french_shop_pages()` refuses to rename the SHOP PAGE for a
	 * documented reason: `wp_old_slug_redirect()` begins `if ( is_404() && '' !==
	 * get_query_var( 'name' ) )` and a PAGE is matched on `pagename`, so an old
	 * page slug 404s rather than redirecting, and teeshoop.com has been selling
	 * since 2024. That objection does not apply here. These bases address the
	 * 44 furniture demonstration products that question 20 asks us to delete, and
	 * a URL for a chair we do not sell is a URL we want to stop answering. Every
	 * catalogue URL that matters is created by an import that has never run on
	 * production. After launch the same change costs 463 redirects.
	 *
	 * A BASE SOMEBODY HAS ALREADY CHOSEN IS LEFT ALONE. Only WooCommerce's own
	 * English defaults are replaced, so an operator who picked something else
	 * keeps it, and running this twice changes nothing.
	 */
	private static function ensure_french_bases( array &$changed ): void {
		$stored = get_option( 'woocommerce_permalinks', array() );
		$stored = is_array( $stored ) ? $stored : array();

		$french = array(
			'product_base'  => array( 'product', 'produit' ),
			'category_base' => array( 'product-category', 'categorie' ),
			'tag_base'      => array( 'product-tag', 'etiquette' ),
		);

		$moved = false;
		foreach ( $french as $key => $pair ) {
			list( $english, $ours ) = $pair;
			$current = trim( (string) ( $stored[ $key ] ?? '' ), '/' );
			// Empty counts as the default: WooCommerce falls back to the English
			// word when the option has never been written.
			if ( '' !== $current && $english !== $current ) {
				continue;
			}
			$stored[ $key ] = $ours;
			$moved          = true;
		}

		if ( ! $moved ) {
			return;
		}

		update_option( 'woocommerce_permalinks', $stored );
		$changed[] = 'bases d’URL en français';
	}

	/**
	 * Rebuild the rewrite rules, once, after everything else is in place.
	 *
	 * Delegated on purpose. Doing it inline (`$wp_rewrite->init()` then
	 * `flush_rules()`) wrote 85 rules where a correct flush writes 187, and not
	 * one of the missing ones was WooCommerce's: `/shop/` answered 200 while
	 * every single product URL answered 404, so the mirror looked healthy from
	 * the front page and had no product pages at all. `wp rewrite flush` is code
	 * that already works, and running it beats re-implementing it slightly wrong.
	 *
	 * It runs LAST because the demo product must exist before the rules that
	 * address it are written, and the process then re-reads the structure so the
	 * URL this command prints is the URL the next session will open.
	 */
	private static function flush_rewrites(): void {
		global $wp_rewrite;

		/*
		 * Discard the cached rules rather than regenerate them here.
		 *
		 * Regenerating them in this process is what went wrong: `$wp_rewrite`
		 * was built before the structure changed, so `flush_rules()` wrote 85
		 * rules where a correct rebuild writes 187, and not one of the missing
		 * ones was WooCommerce's. `/shop/` answered 200 while every product URL
		 * answered 404, which is a mirror that looks healthy from the front page
		 * and has no product pages at all. Deleting the option makes WordPress
		 * rebuild them itself on the next request, from a process whose rewrite
		 * object is not stale.
		 */
		delete_option( 'rewrite_rules' );

		// And re-read the structure here, so the URL this command prints is the
		// URL the next session will actually open.
		if ( $wp_rewrite instanceof \WP_Rewrite ) {
			$wp_rewrite->init();
		}
	}

	/**
	 * A classic theme, because the studio cannot live under a block one.
	 *
	 * WooCommerce's BLOCK product template runs the description through
	 * `wp_kses_post` after expanding shortcodes, and `iframe` is not allowed
	 * there: on Twenty Twenty-Five the studio renders as an empty div, silently.
	 * Our own theme is classic, and so is Woodmart, which teeshoop.com still runs
	 * until session 14 deploys ours.
	 */
	private static function ensure_classic_theme( array &$changed ): void {
		if ( ! function_exists( 'wp_is_block_theme' ) || ! wp_is_block_theme() ) {
			return;
		}
		/*
		 * OUR OWN THEME FIRST. Since session 09 the shop has a classic theme it
		 * owns, `wp-themes/teeshoop`, and that is what production runs. Twenty
		 * Twenty-One stays as the fallback for a checkout of this repository
		 * that has not mounted the theme, because the point of this call is to
		 * get OFF a block theme: WooCommerce's block product template runs the
		 * description through `wp_kses_post`, `iframe` is not allowed there, and
		 * the studio renders as an empty div with no error.
		 */
		foreach ( array( 'teeshoop', 'twentytwentyone' ) as $slug ) {
			if ( wp_get_theme( $slug )->exists() ) {
				switch_theme( $slug );
				$changed[] = 'thème classique (' . $slug . ')';
				return;
			}
		}
		\WP_CLI::warning( 'Le thème actif est un thème de blocs et aucun thème classique n’est installé : le studio ne s’affichera pas. wp theme activate teeshoop' );
	}

	/**
	 * The pages the site's own navigation links to.
	 *
	 * WooCommerce creates its four (boutique, panier, commande, mon compte) on
	 * activation and remembers their ids in options. These two are ours, and
	 * they are found BY SLUG rather than by a stored id, which is the
	 * convention `Shelf::unpriced_notice` already uses: a page a shop manager
	 * deleted and recreated keeps working, and a theme that cannot find one
	 * simply does not print the link rather than sending a buyer to a 404.
	 *
	 * NO CONTENT IS WRITTEN INTO THEM. `page-devis.php` and
	 * `page-entreprises.php` in the theme supply everything, so the copy lives
	 * in the repository where it can be reviewed in a diff, and the page in the
	 * database is a stub carrying a slug and a title. Anything the associate
	 * types into the editor is printed above what the template renders.
	 *
	 * IDEMPOTENT: an existing page of that slug is left exactly as it is,
	 * including a draft one, because republishing a page somebody deliberately
	 * unpublished is not this command's business.
	 */
	/**
	 * WooCommerce's four pages, in French.
	 *
	 * They are created at activation from the locale WordPress had at the time,
	 * which on a fresh install is `en_US`: the mirror's catalogue answered under
	 * the heading « Shop » on a French shop, and « Cart », « Checkout » and
	 * « My account » with it. Installing the French language pack afterwards does
	 * not rename a page that is already a post.
	 *
	 * THE SLUG DOES NOT MOVE WITH IT, and that is a correction rather than an
	 * omission. WordPress's own `wp_old_slug_redirect()` begins
	 * `if ( is_404() && '' !== get_query_var( 'name' ) )`, and a PAGE is matched
	 * on `pagename`: an old page slug is never redirected, it 404s. Measured
	 * here by renaming `shop` to `boutique` and watching `/shop/` answer 404 with
	 * `_wp_old_slug` correctly written. teeshoop.com has been selling since 2024,
	 * so every link anybody holds to its catalogue would break for a French word
	 * in an address bar. A French heading on an English path is the smaller
	 * wrong.
	 *
	 * A page whose title somebody has already changed is left alone: this is a
	 * translation of WooCommerce's default, not a policy about naming.
	 */
	private static function ensure_french_shop_pages( array &$changed ): void {
		$known = array(
			'woocommerce_shop_page_id'      => array( 'Shop', 'Boutique' ),
			'woocommerce_cart_page_id'      => array( 'Cart', 'Panier' ),
			'woocommerce_checkout_page_id'  => array( 'Checkout', 'Commander' ),
			'woocommerce_myaccount_page_id' => array( 'My account', 'Mon compte' ),
		);

		foreach ( $known as $option => $names ) {
			list( $english, $french ) = $names;

			$id   = (int) get_option( $option );
			$page = $id > 0 ? get_post( $id ) : null;
			if ( ! $page instanceof \WP_Post || $english !== $page->post_title ) {
				continue;
			}

			wp_update_post(
				array(
					'ID'         => $id,
					'post_title' => $french,
				)
			);
			$changed[] = 'titre de la page ' . $page->post_name;
		}
	}

	/**
	 * WordPress's own two demonstration items, to the bin.
	 *
	 * « Sample Page » and « Hello world! » are published on every fresh install,
	 * they are linked from nothing, and they are in the sitemap: the shop was
	 * inviting Google to index a page whose content is "This is an example page"
	 * and a post whose content is "Welcome to WordPress". They also keep the
	 * `post` post type and the `category` taxonomy alive in the sitemap index,
	 * which is why two empty sections were being published.
	 *
	 * TRASHED, NOT DELETED, and only when they are still WordPress's own: the
	 * slug has to match AND the item has to be untouched since it was created.
	 * Somebody who wrote real content over the sample page keeps it.
	 */
	private static function ensure_no_demo_content( array &$changed ): void {
		foreach ( array( 'sample-page' => 'page', 'hello-world' => 'post' ) as $slug => $type ) {
			$post = get_page_by_path( $slug, OBJECT, $type );
			if ( ! $post instanceof \WP_Post || 'publish' !== $post->post_status ) {
				continue;
			}
			if ( $post->post_modified_gmt !== $post->post_date_gmt ) {
				\WP_CLI::warning(
					sprintf(
						/* translators: %s: the slug of a WordPress demonstration item somebody has edited. */
						__( '« %s » a été modifié depuis sa création : laissé en place. Supprimez-le à la main si ce n’est pas du contenu.', 'teeshoop' ),
						$slug
					)
				);
				continue;
			}
			wp_trash_post( $post->ID );
			$changed[] = 'corbeille : ' . $slug;
		}
	}

	private static function ensure_site_pages( array &$changed ): void {
		/*
		 * PUBLISHED ONLY UNDER OUR OWN THEME.
		 *
		 * These two pages are empty on purpose: everything they show comes from
		 * `page-devis.php` and `page-entreprises.php` in `wp-themes/teeshoop`.
		 * Under any other theme they are two blank pages with a title, and this
		 * command can be pointed at production with `--forcer`. So elsewhere
		 * they are created as DRAFTS: they exist, their slugs are reserved, the
		 * theme's own links stay hidden because `page_url()` only returns a
		 * published page, and publishing them is one click for whoever switches
		 * the theme over.
		 */
		$ours   = 'teeshoop' === get_template();
		$status = $ours ? 'publish' : 'draft';

		$pages = array(
			// NOT « Demander un devis »: the form the page renders carries that
			// heading itself, and the page would open on the same six words twice.
			'devis'       => __( 'Un devis pour votre projet', 'teeshoop' ),
			'entreprises' => __( 'Entreprises et associations', 'teeshoop' ),

			/*
			 * THE SECTOR PAGES, and the title here is not the heading.
			 *
			 * What WordPress stores is what an operator reads in a list of
			 * pages, so it is short. The `h1` a buyer and a crawler read comes
			 * from `Content::page()` and carries the words people actually
			 * search, which is a different string on purpose: « Associations »
			 * in the admin, « Des t-shirts et des sweats personnalisés pour
			 * votre association » on the page.
			 *
			 * THE SLUGS ARE SHORT RATHER THAN EXACT-MATCH. Both shapes are on
			 * the market: vetement-publicitaire.com runs 31 landing pages at
			 * `/t-shirt-personnalise/`-style slugs and mistertee.fr runs its
			 * sectors at `/professionnels/btp`. Words in a URL are a very small
			 * ranking factor and a slug is expensive to change once anything
			 * links to it, so these are the short ones. The query lives in the
			 * title and the heading, where it earns the click.
			 */
			'associations'        => __( 'Associations', 'teeshoop' ),
			'clubs-sportifs'      => __( 'Clubs sportifs', 'teeshoop' ),
			'evenementiel'        => __( 'Événementiel', 'teeshoop' ),
			'restauration'        => __( 'Restauration', 'teeshoop' ),
			'petites-series'      => __( 'Petites séries', 'teeshoop' ),
			'fichiers-impression' => __( 'Quel fichier envoyer', 'teeshoop' ),
		);

		foreach ( $pages as $slug => $title ) {
			if ( get_page_by_path( $slug ) instanceof \WP_Post ) {
				continue;
			}
			$id = wp_insert_post(
				array(
					'post_type'      => 'page',
					'post_status'    => $status,
					'post_title'     => $title,
					'post_name'      => $slug,
					'post_content'   => '',
					'comment_status' => 'closed',
					'ping_status'    => 'closed',
				),
				true
			);
			if ( is_wp_error( $id ) ) {
				\WP_CLI::warning( sprintf( 'Page « %s » non créée : %s', $slug, $id->get_error_message() ) );
				continue;
			}
			$changed[] = 'page ' . $slug . ( $ours ? '' : ' (brouillon)' );
		}

		if ( ! $ours && ! empty( $changed ) ) {
			\WP_CLI::warning(
				sprintf(
					/* translators: %s: the active theme's directory name. */
					__( 'Le thème actif est « %s » et non « teeshoop » : les pages devis et entreprises sont créées en brouillon, parce que leur contenu vient des gabarits du thème et qu’elles seraient vides sans lui.', 'teeshoop' ),
					get_template()
				)
			);
		}
	}

	/**
	 * Create the four legal pages and point WordPress at them.
	 *
	 * ## OPTIONS
	 *
	 * [--dry-run]
	 * : Say what would be created and change nothing.
	 *
	 * WHY IT IS NOT PART OF `teeshoop provisionner`. That command sets the
	 * shop's currency, its country, its tax calculation and its weight unit, and
	 * it creates a demonstration product. It refuses to run outside localhost
	 * without `--forcer`, and rightly. But the mentions légales and the
	 * conditions of sale have to exist ON THE REAL SHOP, and the only way to get
	 * them there must not be a command that also rewrites the tax settings. So
	 * this one does four things and nothing else, and it is safe to run in
	 * production.
	 *
	 * IT PUBLISHES UNDER ANY THEME, unlike `ensure_site_pages`. Those pages are
	 * empty shells whose content comes from theme templates, so under another
	 * theme they would be blank. These four are rendered by the PLUGIN, through
	 * `the_content`, precisely so that a theme change cannot leave a French shop
	 * without mentions légales.
	 *
	 * IT NEVER TOUCHES AN EXISTING PAGE, including a draft somebody unpublished
	 * on purpose. Same rule as `ensure_site_pages` and for the same reason: the
	 * decision to take a page down is not this command's to reverse.
	 *
	 * @param array $args       positional, unused.
	 * @param array $assoc_args --dry-run.
	 */
	/**
	 * Bring the database to the shape this copy of the code expects.
	 *
	 * ## WHY A COMMAND AND NOT A HOOK
	 *
	 * Both exist and they answer different needs. `Schema` runs its O(1) steps on
	 * every request, which is the guarantee the two lazy installers used to give:
	 * a site where the plugin is already active never runs an activation hook
	 * again, so a table added later would never exist there. What that shape
	 * cannot do is a step that walks rows: o2switch's web SAPI has a
	 * `max_execution_time` and a migration killed halfway through a page load
	 * would leave the version un-bumped and the work half done, on a request
	 * nobody was watching. Those steps are CLI-only and this is the CLI.
	 *
	 * It is also the step a deploy runs, and the reason its output is a list of
	 * what each step DID rather than a tick: a deploy log that says « ok » tells
	 * whoever reads it at 19h on a Friday nothing at all.
	 *
	 * ## OPTIONS
	 *
	 * [--a-blanc]
	 * : Say what would run and change nothing, not even the version.
	 *
	 * [--refaire]
	 * : Run every step again from the first, for repairing an install by hand.
	 *   Every step is idempotent, so this is safe; it is not the normal path.
	 *
	 * [--etat]
	 * : Print the version and what is outstanding, run nothing.
	 *
	 * [--porcelaine]
	 * : One line of JSON on stdout and nothing else, for a pipeline to read.
	 */
	public static function migrate( array $args, array $assoc_args = array() ): void {
		$json = isset( $assoc_args['porcelaine'] );

		if ( isset( $assoc_args['etat'] ) ) {
			$status = Schema::status();
			if ( $json ) {
				echo wp_json_encode( $status, JSON_UNESCAPED_UNICODE ), "\n";
				return;
			}
			\WP_CLI::log( sprintf( 'base en version %d, code en version %d.', (int) $status['current'], (int) $status['target'] ) );
			foreach ( $status['steps'] as $step ) {
				\WP_CLI::log( sprintf( '  étape %d %s %s', (int) $step['id'], $step['auto'] ? '(auto)  ' : '(ligne de commande)', $step['label'] ) );
			}
			if ( 0 === (int) $status['pending'] ) {
				\WP_CLI::success( 'rien en attente.' );
			}
			return;
		}

		$report = Schema::migrate(
			array(
				'dry'  => isset( $assoc_args['a-blanc'] ),
				'redo' => isset( $assoc_args['refaire'] ),
				'cli'  => true,
			)
		);

		if ( $json ) {
			echo wp_json_encode( $report, JSON_UNESCAPED_UNICODE ), "\n";
			if ( ! $report['ok'] ) {
				exit( 1 );
			}
			return;
		}

		foreach ( $report['ran'] as $step ) {
			\WP_CLI::log( sprintf( 'étape %d %s : %s', (int) $step['id'], $step['label'], $step['did'] ) );
		}
		foreach ( $report['skipped'] as $step ) {
			\WP_CLI::warning( sprintf( 'étape %d %s : non exécutée.', (int) $step['id'], $step['label'] ) );
		}
		if ( ! $report['ok'] ) {
			\WP_CLI::error( $report['error'] );
		}
		if ( $report['from'] === $report['to'] && array() === $report['ran'] ) {
			\WP_CLI::success( sprintf( 'base déjà en version %d, rien à faire.', (int) $report['to'] ) );
			return;
		}
		\WP_CLI::success(
			sprintf(
				'%sbase passée de la version %d à la version %d, %d étape(s).',
				$report['dry'] ? 'à blanc : ' : '',
				(int) $report['from'],
				(int) $report['to'],
				count( $report['ran'] )
			)
		);
	}

	/**
	 * The launch gate's shop half, so it can be asked from outside this machine.
	 *
	 * ## WHY THIS EXISTS
	 *
	 * `scripts/launch-gate.mjs` asked WordPress through one hard-coded
	 * `docker compose run wpcli eval` against the local mirror, so the three
	 * tracked documents telling session 14 to replay the gate against the REAL
	 * shop were asking for something the code could not do. The gate now speaks
	 * to a transport, and this is the far end of it: it prints the same
	 * marker-wrapped JSON the eval string used to, over SSH or over docker,
	 * without shipping a PHP program through two layers of shell quoting.
	 *
	 * The markers are not decoration. WP-CLI, WordPress notices, PHP deprecations
	 * and docker itself all write to these streams, and a parser that took the
	 * whole output would read a warning as an unreachable shop.
	 *
	 * ## OPTIONS
	 *
	 * [--porcelaine]
	 * : Print only the marker-wrapped JSON. This is the form the gate reads.
	 */
	public static function launch( array $args, array $assoc_args = array() ): void {
		$answer = array( 'ok' => true, 'blockers' => Launch::blockers() );
		if ( isset( $assoc_args['porcelaine'] ) ) {
			echo "\n<<<TEESHOOP-LAUNCH>>>", wp_json_encode( $answer, JSON_UNESCAPED_UNICODE ), "<<<END>>>\n";
			return;
		}
		$blockers = $answer['blockers'];
		if ( array() === $blockers ) {
			\WP_CLI::success( 'aucune condition de la boutique ne refuse.' );
			return;
		}
		foreach ( $blockers as $b ) {
			\WP_CLI::log( sprintf( '[%s] %s', (string) ( $b['cle'] ?? '?' ), (string) ( $b['pourquoi'] ?? '' ) ) );
		}
		\WP_CLI::warning( sprintf( '%d raison(s) de refuser.', count( $blockers ) ) );
	}

	public static function legal_pages( array $args, array $assoc_args = array() ): void {
		$dry     = isset( $assoc_args['dry-run'] );
		$changed = array();

		foreach ( Pages::all() as $slug => $title ) {
			$existing = get_page_by_path( $slug );
			if ( $existing instanceof \WP_Post ) {
				\WP_CLI::log(
					sprintf(
						'page %s : déjà là (%s), rien touché',
						$slug,
						$existing->post_status
					)
				);
				continue;
			}
			if ( $dry ) {
				$changed[] = 'page ' . $slug . ' (à créer)';
				continue;
			}
			$id = wp_insert_post(
				array(
					'post_type'      => 'page',
					'post_status'    => 'publish',
					'post_title'     => $title,
					'post_name'      => $slug,
					'post_content'   => '',
					'comment_status' => 'closed',
					'ping_status'    => 'closed',
				),
				true
			);
			if ( is_wp_error( $id ) ) {
				\WP_CLI::warning( sprintf( 'Page « %s » non créée : %s', $slug, $id->get_error_message() ) );
				continue;
			}
			$changed[] = 'page ' . $slug;
		}

		/*
		 * THE THREE POINTERS THAT WERE ANSWERING DIFFERENTLY.
		 *
		 * Measured on the mirror before this command existed:
		 * `wp_page_for_privacy_policy` was 3, WordPress's own English DRAFT
		 * « Privacy Policy », while the theme footer and the consent panel both
		 * looked up the slug `confidentialite`, which did not exist. And
		 * `woocommerce_terms_page_id` was empty, so WooCommerce's own terms
		 * checkbox could not be shown at all. Three mechanisms looking for two
		 * documents in three places. They are set together, here, or they drift
		 * again.
		 */
		$privacy = get_page_by_path( Pages::CONFIDENTIALITE );
		$terms   = get_page_by_path( Pages::CGV );

		if ( $privacy instanceof \WP_Post && (int) get_option( 'wp_page_for_privacy_policy' ) !== $privacy->ID ) {
			if ( ! $dry ) {
				update_option( 'wp_page_for_privacy_policy', $privacy->ID );
			}
			$changed[] = 'wp_page_for_privacy_policy -> ' . $privacy->ID;
		}
		if ( $terms instanceof \WP_Post && (int) get_option( 'woocommerce_terms_page_id' ) !== $terms->ID ) {
			if ( ! $dry ) {
				update_option( 'woocommerce_terms_page_id', $terms->ID );
			}
			$changed[] = 'woocommerce_terms_page_id -> ' . $terms->ID;
		}

		/*
		 * WordPress and WooCommerce both ship an English draft that nobody
		 * asked for: « Privacy Policy » and « Refund and Returns Policy ». They
		 * are sample legal text, in the wrong language, on a shop that sells only
		 * in France, one click from being published by mistake. Binned rather
		 * than deleted: a bin is reversible and a delete is not.
		 */
		foreach ( array( 'privacy-policy', 'refund_returns' ) as $slug ) {
			$post = get_page_by_path( $slug );
			if ( ! $post instanceof \WP_Post || 'trash' === $post->post_status ) {
				continue;
			}
			if ( $privacy instanceof \WP_Post && $post->ID === $privacy->ID ) {
				continue;
			}
			if ( ! $dry ) {
				wp_trash_post( $post->ID );
			}
			$changed[] = 'corbeille : ' . $slug . ' (gabarit anglais livré par défaut)';
		}

		if ( empty( $changed ) ) {
			\WP_CLI::success( 'Rien à faire : les quatre pages juridiques sont en place.' );
			return;
		}
		foreach ( $changed as $line ) {
			\WP_CLI::log( ( $dry ? 'À FAIRE : ' : 'fait : ' ) . $line );
		}

		$missing = array_merge(
			Legal::missing( Legal::identity(), '' ),
			Host::missing()
		);
		if ( ! empty( $missing ) ) {
			\WP_CLI::warning(
				sprintf(
					'Les pages existent mais elles sont incomplètes : %d mention(s) obligatoire(s) ne sont pas renseignées. Elles se saisissent dans WooCommerce > Facturation, et tant qu’elles manquent la page des mentions légales le dit à ses lecteurs.',
					count( $missing )
				)
			);
		}

		\WP_CLI::success( $dry ? 'Simulation terminée.' : 'Pages juridiques en place.' );
	}

	/** Studio origin and Worker URL, only when the caller supplied them. */
	private static function ensure_settings( array $assoc_args, array &$changed ): void {
		$stored = get_option( OPTION_SETTINGS, array() );
		$stored = is_array( $stored ) ? $stored : array();
		$before = $stored;

		if ( ! empty( $assoc_args['origine-studio'] ) ) {
			$stored['studio_origin'] = esc_url_raw( (string) $assoc_args['origine-studio'] );
			$stored['studio_path']   = $stored['studio_path'] ?? '/';
		}
		if ( ! empty( $assoc_args['worker'] ) ) {
			$stored['worker_url']         = esc_url_raw( (string) $assoc_args['worker'] );
			$stored['design_verify_path'] = $stored['design_verify_path'] ?? '/api/design/';
		}

		if ( $stored !== $before ) {
			update_option( OPTION_SETTINGS, $stored );
			$changed[] = 'réglages studio';
		}

		if ( '' === Settings::studio_origin() ) {
			\WP_CLI::warning( 'Aucune origine de studio n’est configurée : le bouton Personnaliser mènera à une page sans éditeur. Passez --origine-studio.' );
		}
	}

	/**
	 * The demo product, so the next session starts from a working page.
	 *
	 * Everything on it is real. The catalogue price is the blank's own
	 * contribution to a personalised line and is never charged, so it is READ
	 * from the price authority rather than typed here: it used to be the string
	 * '9.50', which is `garments.tee.base_ht` written a second time, in another
	 * unit, where nothing compared them (question 06, registered as
	 * H-Q06-TARIF-TEE). The brand reference is the one the studio's size chart
	 * is measured from. It
	 * carries NO matière and NO grammage, on purpose: this project holds neither
	 * for this reference, the page renders the honest empty state, and the admin
	 * note under it says where they will come from.
	 */
	private static function ensure_demo_product( array &$changed ): int {
		$existing = get_page_by_path( self::DEMO_SLUG, OBJECT, 'product' );
		$product  = $existing ? wc_get_product( $existing->ID ) : new \WC_Product_Simple();
		$is_new   = ! $existing;

		$product->set_name( 'T-shirt personnalisé, coton bio' );
		$product->set_slug( self::DEMO_SLUG );
		$product->set_status( 'publish' );
		$product->set_catalog_visibility( 'visible' );
		/*
		 * Read defensively, because `merge_config` replaces the whole `garments`
		 * map on purpose: an admin who overlays it without a `tee` key is doing
		 * something the price config explicitly allows, and a demo product is not
		 * a reason to fatal on their site. No key, no price written, and the
		 * product keeps whatever it had.
		 */
		$ts_blank = Settings::pricing()['garments']['tee']['base_ht'] ?? null;
		if ( null !== $ts_blank ) {
			$product->set_regular_price( number_format( Money::to_eur( (int) $ts_blank ), 2, '.', '' ) );
		}
		$product->set_short_description(
			'Un t-shirt à personnaliser avec votre logo, votre texte ou votre visuel. '
			. 'Imprimé à la demande, à partir d’une pièce.'
		);
		$product->set_description(
			'Ce t-shirt sert de base à vos marquages : devant, dos et manche. '
			. 'Le prix dépend du nombre de pièces et de la surface réellement imprimée, '
			. 'pas de la taille du fichier que vous nous envoyez.'
		);
		$product->update_meta_data( Product::META, 'tee' );
		$product->update_meta_data( Garments::META_BRAND_REF, 'STTU755' );
		$product->save();

		if ( $is_new ) {
			$changed[] = 'article de démonstration';
		}

		return (int) $product->get_id();
	}

	/**
	 * Measure a colour value for every colour name in the catalogue.
	 *
	 * ## WHY A COMMAND AND NOT AN IMPORT STEP
	 *
	 * Because it is answering a different question on a different clock. The
	 * catalogue import runs nightly and writes what the supplier says. This
	 * reads what the supplier's photographs SHOW, which changes only when a
	 * garment is re-shot, and re-running it on every import would fetch three
	 * thousand photographs a night to confirm that navy is still navy.
	 *
	 *     0 4 * * 0  cd /home/xxx/public_html && wp teeshoop couleurs mesurer --discret
	 *
	 * Once a week is generous. New colours arriving with new references are
	 * picked up because a colour already measured is skipped: the weekly run
	 * costs one sweep of the work list and a handful of fetches.
	 *
	 * ## WHAT IT WRITES, AND WHAT IT REFUSES TO WRITE
	 *
	 * A hexadecimal on the term, or a reason there is none. Never both. A
	 * colour is refused when its photographs cannot be segmented, when they
	 * disagree with each other, or when what they show contradicts the name the
	 * supplier gave. There is no fallback value: the filter shows an unmeasured
	 * colour as a name with no swatch, which is the truth.
	 *
	 * ## OPTIONS
	 *
	 * [--max=<n>]
	 * : Stop after this many colours. 0 = all of them. Default 0.
	 *
	 * [--photos=<n>]
	 * : How many photographs to measure per colour. Default 5.
	 *
	 * [--recommencer]
	 * : Measure colours that already carry a verdict, instead of skipping them.
	 *
	 * [--duree=<s>]
	 * : Stop after this many seconds. Whatever was measured is kept.
	 *
	 * [--discret]
	 * : Print only the summary, for a cron.
	 *
	 * ## EXAMPLES
	 *
	 *     wp teeshoop couleurs mesurer
	 *     wp teeshoop couleurs mesurer --recommencer
	 *     wp teeshoop couleurs mesurer --max=20 --photos=3
	 *
	 * @param array $args       Positional arguments.
	 * @param array $assoc_args Flags.
	 */
	public static function colours_measure( array $args, array $assoc_args ): void {
		$quiet = ! empty( $assoc_args['discret'] );

		if ( ! function_exists( 'imagecreatefromstring' ) ) {
			\WP_CLI::error( 'L’extension GD n’est pas installée : aucune photo ne peut être lue. Rien n’a été mesuré.' );
		}
		if ( '' === Shelf::photo_url( '/media/blank/picture/x.jpg' ) ) {
			\WP_CLI::error( 'L’adresse du Worker n’est pas réglée (réglage « worker_url ») : les photos ne sont pas joignables.' );
		}

		$work = Colours::work_list( (int) ( $assoc_args['photos'] ?? Colours::PHOTOS_PER_COLOUR ) );
		if ( empty( $work ) ) {
			\WP_CLI::error( 'Aucun article importé ne porte de pastille ni de photo de coloris : il n’y a rien à mesurer. Lancez d’abord « wp teeshoop catalogue importer ».' );
		}

		$started = microtime( true );
		$stats   = Colours::sweep(
			array(
				'max'      => (int) ( $assoc_args['max'] ?? 0 ),
				'photos'   => (int) ( $assoc_args['photos'] ?? Colours::PHOTOS_PER_COLOUR ),
				'again'    => ! empty( $assoc_args['recommencer'] ),
				'seconds'  => (int) ( $assoc_args['duree'] ?? 0 ),
				'progress' => $quiet ? null : static function ( \WP_Term $term, array $verdict ): void {
					\WP_CLI::log(
						sprintf(
							'  %-32s %s',
							mb_substr( (string) $term->name, 0, 32 ),
							empty( $verdict['ok'] )
								? 'refusé : ' . (string) $verdict['why']
								: implode( ' ', (array) $verdict['stops'] ) . '  ' . (string) $verdict['family']
								  . sprintf(
									  '  (%s, %d image%s%s)',
									  (string) ( $verdict['source'] ?? 'pastille' ),
									  (int) $verdict['photos'],
									  (int) $verdict['photos'] > 1 ? 's' : '',
									  isset( $verdict['photo_ecart'] ) ? sprintf( ', photo à %.3f', (float) $verdict['photo_ecart'] ) : ''
								  )
						)
					);
				},
			)
		);

		\WP_CLI::log(
			sprintf(
				'%d coloris traités sur %d (%d mesurés dont %d repliés sur la photo, %d refusés, %d déjà connus, %d injoignables), %d images, %.1f s.%s',
				(int) $stats['colours'],
				(int) $stats['total'],
				(int) $stats['measured'],
				(int) $stats['fallback'],
				(int) $stats['refused'],
				(int) $stats['skipped'],
				(int) $stats['injoignable'],
				(int) $stats['images'],
				microtime( true ) - $started,
				'' === $stats['stopped'] ? '' : ' Arrêt : ' . (string) $stats['stopped'] . '.'
			)
		);

		/*
		 * THE CROSS-CHECK REPORTS ITS COVERAGE, not only its failures. « 44
		 * photographs far from their chip » is unreadable without the
		 * denominator: it could be 44 of 44. It is 44 of 396, and one
		 * photograph in 397 could not be read at all.
		 */
		$checked = (int) $stats['photo_verifiee'] + (int) $stats['photo_illisible'];
		if ( $checked > 0 ) {
			\WP_CLI::log(
				sprintf(
					'Contrôle par la photo : %d sur %d ont donné un écart, dont %d au-delà de %.2f ; %d illisibles.',
					(int) $stats['photo_verifiee'],
					$checked,
					(int) $stats['photo_loin'],
					Colours::PHOTO_MAX,
					(int) $stats['photo_illisible']
				)
			);
			foreach ( (array) $stats['photo_raisons'] as $why => $n ) {
				\WP_CLI::log( sprintf( '  %-52s %d', mb_substr( (string) $why, 0, 52 ), (int) $n ) );
			}
		}

		if ( (int) $stats['injoignable'] > 0 ) {
			\WP_CLI::warning(
				sprintf(
					'%d coloris n’ont pas pu être récupérés et ont été laissés tels quels. Ce n’est pas un refus : relancez quand le Worker répond.',
					(int) $stats['injoignable']
				)
			);
		}

		if ( ! empty( $stats['reasons'] ) ) {
			\WP_CLI::log( '' );
			foreach ( (array) $stats['reasons'] as $why => $n ) {
				\WP_CLI::log( sprintf( '  %-52s %d', mb_substr( (string) $why, 0, 52 ), (int) $n ) );
			}
		}
	}

	/**
	 * Re-decide every family from what is already measured, with no fetch.
	 *
	 * ## EXAMPLES
	 *
	 *     wp teeshoop couleurs reclasser
	 *
	 * Run it whenever a boundary moves in `Swatch`. `couleurs mesurer
	 * --recommencer` would give the same answer and re-fetch about 1 900
	 * supplier images to do it, which is seventeen minutes and a boundary
	 * change that in practice never gets applied.
	 */
	public static function colours_reclassify(): void {
		$stats = Colours::reclassify();

		if ( 0 === (int) $stats['colours'] ) {
			\WP_CLI::error( 'Aucun coloris ne porte de mesure : il n’y a rien à reclasser. Lancez « wp teeshoop couleurs mesurer ».' );
		}

		\WP_CLI::log(
			sprintf(
				'%d coloris reclassés (%d publiés, %d refusés), %d changement(s). %d jamais mesurés et %d mesurés trop tôt pour être relus : tous intacts.',
				(int) $stats['colours'],
				(int) $stats['publiés'],
				(int) $stats['refusés'],
				(int) $stats['changés'],
				(int) $stats['sans_mesure'],
				(int) $stats['incomplet']
			)
		);
		if ( (int) $stats['incomplet'] > 0 ) {
			\WP_CLI::warning(
				sprintf(
					'%d coloris bicolores ne gardent qu’une seule mesure et ne peuvent pas être relus. « wp teeshoop couleurs mesurer --recommencer » les remet en état.',
					(int) $stats['incomplet']
				)
			);
		}
		foreach ( (array) $stats['mouvements'] as $move => $n ) {
			\WP_CLI::log( sprintf( '  %-32s %d', (string) $move, (int) $n ) );
		}
		\WP_CLI::success( 'Familles à jour. Pensez à « npm run couleurs:relever » pour mettre le relevé au même état.' );
	}

	/**
	 * What the shop knows about its colours, and what it does not.
	 *
	 * ## OPTIONS
	 *
	 * [--releve]
	 * : Print the reviewable record and NOTHING ELSE, so it can be redirected:
	 * `wp teeshoop couleurs etat --releve > docs/couleurs.json`. Not `--json`,
	 * which WP-CLI reads as its own `--format` and refuses. Written to
	 * standard output rather than to a path because the plugin runs from a
	 * bind mount in the mirror and from a shared host in production, and
	 * neither of them can see the repository this file belongs to.
	 *
	 * [--refus]
	 * : List every refused colour with its reason, one per line.
	 */
	public static function colours_state( array $args, array $assoc_args ): void {
		$ledger = Colours::ledger();
		if ( empty( $ledger ) ) {
			\WP_CLI::error( 'Aucun coloris n’existe dans cette boutique.' );
		}

		if ( ! empty( $assoc_args['releve'] ) ) {
			// Nothing else on stdout, or the redirect writes broken JSON.
			echo wp_json_encode( $ledger, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) . "\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- JSON on a command line.
			return;
		}

		$count = (array) $ledger['compte'];
		$total = array_sum( $count );
		\WP_CLI::log( sprintf( 'Coloris          : %d', $total ) );
		foreach ( $count as $label => $n ) {
			\WP_CLI::log(
				sprintf(
					'  %-14s %4d  %5.1f %%',
					$label,
					(int) $n,
					$total > 0 ? (int) $n / $total * 100 : 0.0
				)
			);
		}

		$families = array();
		$single   = 0;
		foreach ( (array) $ledger['couleurs'] as $row ) {
			if ( isset( $row['famille'] ) ) {
				$families[ $row['famille'] ] = ( $families[ $row['famille'] ] ?? 0 ) + 1;
				if ( 1 === (int) ( $row['images'] ?? 0 ) ) {
					++$single;
				}
			}
		}
		\WP_CLI::log( '' );
		foreach ( Swatch::families() as $slug => $label ) {
			\WP_CLI::log( sprintf( '  %-18s %4d', $label, (int) ( $families[ $slug ] ?? 0 ) ) );
		}
		\WP_CLI::log( '' );
		\WP_CLI::log( sprintf( 'Mesurés sur une seule photo : %d', $single ) );

		if ( ! empty( $assoc_args['refus'] ) ) {
			\WP_CLI::log( '' );
			foreach ( (array) $ledger['couleurs'] as $row ) {
				if ( isset( $row['refus'] ) ) {
					\WP_CLI::log( sprintf( '  %-32s %s', mb_substr( (string) $row['nom'], 0, 32 ), (string) $row['refus'] ) );
				}
			}
		}
	}

	/**
	 * Forget every colour measurement.
	 *
	 * The swatches disappear from the filter and the names stay, which is what
	 * the site looked like before any of this existed. Used when a threshold in
	 * `Swatch` moves and every verdict has to be taken again.
	 */
	public static function colours_forget(): void {
		$n = Colours::forget();
		\WP_CLI::success( sprintf( '%d coloris oublié(s).', $n ) );
	}

}
