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

		$ids = get_posts(
			array(
				'post_type'   => 'product',
				'post_status' => 'any',
				'numberposts' => -1,
				'fields'      => 'ids',
				'meta_key'    => Catalogue::META_REF, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
			)
		);

		$removed = 0;
		foreach ( $ids as $id ) {
			$product = wc_get_product( (int) $id );
			if ( $product instanceof \WC_Product_Variable ) {
				foreach ( $product->get_children() as $child ) {
					wp_delete_post( (int) $child, true );
				}
			}
			wp_delete_post( (int) $id, true );
			++$removed;
		}

		Importer::forget_run();
		\WP_CLI::success( sprintf( '%d référence(s) importée(s) supprimée(s).', $removed ) );
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
			'woocommerce_calc_taxes'          => 'yes',
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
		self::ensure_permalinks( $changed );
		self::ensure_classic_theme( $changed );
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
	 * A real 20 % rate, because every template prints a TTC figure.
	 *
	 * The mirror shipped with taxes enabled and zero rows, so the studio said
	 * 326,10 EUR TTC while the cart said 271,75 EUR with no tax: 54,35 EUR
	 * apart, on a caption the invoice would contradict.
	 */
	private static function ensure_vat_row( array &$changed ): void {
		global $wpdb;

		$existing = $wpdb->get_var( // phpcs:ignore WordPress.DB.DirectDatabaseQuery -- no API exists to read the tax table.
			"SELECT tax_rate_id FROM {$wpdb->prefix}woocommerce_tax_rates WHERE tax_rate_name = 'TVA' AND tax_rate_country = 'FR' LIMIT 1"
		);
		if ( $existing ) {
			return;
		}

		\WC_Tax::_insert_tax_rate(
			array(
				'tax_rate_country'  => 'FR',
				'tax_rate'          => '20.0000',
				'tax_rate_name'     => 'TVA',
				'tax_rate_priority' => 1,
				'tax_rate_shipping' => 1,
				'tax_rate_class'    => '',
			)
		);
		$changed[] = 'TVA 20 %';
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
		if ( '' !== (string) get_option( 'permalink_structure' ) ) {
			return;
		}

		update_option( 'permalink_structure', '/%postname%/' );
		$changed[] = 'permaliens';
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
	 * A classic theme, like production.
	 *
	 * WooCommerce's BLOCK product template runs the description through
	 * `wp_kses_post` after expanding shortcodes, and `iframe` is not allowed
	 * there: on Twenty Twenty-Five the studio renders as an empty div, silently.
	 * teeshoop.com runs Woodmart, which is classic.
	 */
	private static function ensure_classic_theme( array &$changed ): void {
		if ( ! function_exists( 'wp_is_block_theme' ) || ! wp_is_block_theme() ) {
			return;
		}
		$classic = wp_get_theme( 'twentytwentyone' );
		if ( ! $classic->exists() ) {
			\WP_CLI::warning( 'Le thème actif est un thème de blocs et twentytwentyone n’est pas installé : le studio ne s’affichera pas. wp theme install twentytwentyone --activate' );
			return;
		}
		switch_theme( 'twentytwentyone' );
		$changed[] = 'thème classique';
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
	 * Everything on it is real. The catalogue price is a blank's cost basis and
	 * is never charged, so it is set to something a leak would make obvious; the
	 * brand reference is the one the studio's size chart is measured from. It
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
		$product->set_regular_price( '9.50' );
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
}
