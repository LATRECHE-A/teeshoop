<?php
/**
 * The migration runner against a real database.
 *
 * ── WHAT THIS ADDS TO tests/test-schema.php ──────────────────────────────────
 *
 * That file is pure and tests the DECISION: which steps run, in what order, and
 * where the run stops. It cannot test the one property the whole design rests
 * on, because that property is about MySQL: that every step is genuinely
 * idempotent, and not merely skipped the second time.
 *
 * The distinction is not academic. A shared host kills a web request at its
 * `max_execution_time`, so a step CAN be interrupted halfway and run again from
 * the top; and `wp teeshoop migrer --refaire` exists for repairing an install by
 * hand. Both replay steps against a database that already has their effect. So
 * the test here is not « does migrate() do nothing the second time », it is
 * « does running every step again against a populated database leave the data
 * alone », and it asserts that by putting a row in the sequence table first.
 *
 * ── WHAT IT PUTS BACK ────────────────────────────────────────────────────────
 *
 * The schema option and the sequence row it borrows. It never drops a table:
 * the mirror's other suites are using them.
 *
 * Run from integration.php, which owns the bootstrap.
 *
 * @package Teeshoop\Core
 */

/* COMMAND LINE ONLY. See run.php. */
if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

use Teeshoop\Core\Invoice;
use Teeshoop\Core\Mail;
use Teeshoop\Core\Schema;

function ts_schema_table_exists( string $table ): bool {
	global $wpdb;
	return (string) $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) ) === $table;
}

function ts_schema_suite(): void {
	global $wpdb;

	$restore_option = get_option( Schema::OPTION, null );

	ts_it(
		'brings a database that has never migrated up to the version the code expects',
		function (): void {
			delete_option( Schema::OPTION );
			$report = Schema::migrate( array( 'cli' => true ) );
			ts_assert( $report['ok'], 'la migration a échoué : ' . $report['error'] );
			ts_eq( $report['from'], 0, 'partie d’une base neuve' );
			ts_eq( $report['to'], Schema::target(), 'arrivée à la version du code' );
			ts_eq( count( $report['ran'] ), Schema::target(), 'toutes les étapes ont tourné' );
			ts_eq( Schema::current(), Schema::target(), 'la version enregistrée' );
			ts_assert( ! Schema::pending(), 'rien ne doit rester en attente' );
		}
	);

	ts_it(
		'creates both tables and says which it had to create',
		function (): void {
			ts_assert( ts_schema_table_exists( Invoice::table() ), 'la table de séquence n’existe pas' );
			ts_assert( ts_schema_table_exists( Mail::table() ), 'la table du journal des messages n’existe pas' );
		}
	);

	ts_it(
		'does nothing at all on a second run',
		function (): void {
			$report = Schema::migrate( array( 'cli' => true ) );
			ts_assert( $report['ok'], 'la seconde exécution a échoué' );
			ts_eq( $report['ran'], array(), 'aucune étape ne doit tourner deux fois' );
			ts_eq( $report['from'], $report['to'], 'la version ne doit pas bouger' );
		}
	);

	ts_it(
		'REPLAYS every step without touching the data, which is the property « skipped » cannot give',
		function (): void {
			global $wpdb;
			$table = Invoice::table();
			$probe = 'TS-TEST-SCHEMA';
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$wpdb->query( $wpdb->prepare( "REPLACE INTO {$table} (series, next_number) VALUES (%s, %d)", $probe, 4242 ) );

			$before = (int) $wpdb->get_var( $wpdb->prepare( "SELECT next_number FROM {$table} WHERE series = %s", $probe ) );
			ts_eq( $before, 4242, 'la ligne témoin doit être posée avant de rejouer quoi que ce soit' );

			$version_before = Schema::current();
			$report         = Schema::migrate( array( 'cli' => true, 'redo' => true ) );
			ts_assert( $report['ok'], 'le rejeu a échoué : ' . $report['error'] );
			ts_eq( count( $report['ran'] ), Schema::target(), 'le rejeu doit repasser toutes les étapes, pas les sauter' );

			$after = (int) $wpdb->get_var( $wpdb->prepare( "SELECT next_number FROM {$table} WHERE series = %s", $probe ) );
			ts_eq( $after, 4242, 'rejouer la création de table a effacé une ligne : l’étape n’est pas idempotente' );
			ts_eq( Schema::current(), $version_before, 'un rejeu ne doit pas faire reculer la version' );

			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$wpdb->query( $wpdb->prepare( "DELETE FROM {$table} WHERE series = %s", $probe ) );
		}
	);

	ts_it(
		'removes the two legacy markers and leaves them removed',
		function (): void {
			// Put them back as an old install would have had them, then migrate.
			update_option( 'teeshoop_db_version', '1', false );
			update_option( 'teeshoop_mail_db', '1', false );
			Schema::migrate( array( 'cli' => true, 'redo' => true ) );
			ts_eq( get_option( 'teeshoop_db_version', 'absent' ), 'absent', 'teeshoop_db_version doit avoir été retirée' );
			ts_eq( get_option( 'teeshoop_mail_db', 'absent' ), 'absent', 'teeshoop_mail_db doit avoir été retirée' );
		}
	);

	ts_it(
		'writes nothing at all on a dry run, not even the version',
		function (): void {
			delete_option( Schema::OPTION );
			$report = Schema::migrate( array( 'cli' => true, 'dry' => true ) );
			ts_assert( $report['ok'], 'l’essai à blanc a échoué' );
			ts_eq( count( $report['ran'] ), Schema::target(), 'un essai à blanc doit dire tout ce qu’il ferait' );
			ts_eq( Schema::current(), 0, 'un essai à blanc a écrit la version' );
			ts_assert( false === get_transient( 'teeshoop_schema_lock' ), 'un essai à blanc a pris le verrou' );
			Schema::migrate( array( 'cli' => true ) );
			ts_eq( Schema::current(), Schema::target(), 'remise en état après l’essai à blanc' );
		}
	);

	ts_it(
		'REFUSES rather than racing when another migration holds the lock',
		function (): void {
			/*
			 * LE VERROU EST UNE OPTION, PAS UN TRANSIENT, ET CE TEST NE LE
			 * SAVAIT PLUS.
			 *
			 * `Schema::migrate` posait son verrou avec `get_transient` puis
			 * `set_transient`, deux opérations qui laissent une fenêtre entre
			 * elles ; il est passé à `add_option()`, un INSERT sur une colonne
			 * unique, qui est atomique. Ce test-ci est resté sur l'ancienne
			 * clé : il écrivait `_transient_teeshoop_schema_lock` pendant que le
			 * code lisait `teeshoop_schema_lock`. Deux noms, aucune rencontre.
			 *
			 * Il posait donc un verrou que rien ne tenait, et vérifiait qu'une
			 * migration s'y arrêtait. C'est la forme exacte de défaut que
			 * `CLAUDE.md` section 5 nomme : un contrôle qui ne peut rien voir.
			 * Trouvé le 4 septembre 2026, en faisant tourner `npm run test:wp`
			 * pour une raison sans rapport.
			 *
			 * Le verrou est posé comme le code le pose, avec l'autoload à faux,
			 * pour que ce soit la MÊME ligne de base de données.
			 */
			delete_option( Schema::OPTION );
			delete_option( 'teeshoop_schema_lock' );
			ts_assert(
				add_option( 'teeshoop_schema_lock', time(), '', false ),
				'le verrou de ce test n’a pas pu être posé : il ne prouverait rien'
			);
			$report = Schema::migrate( array( 'cli' => true ) );
			ts_assert( ! $report['ok'], 'une migration concurrente doit être refusée, pas doublée' );
			ts_eq( $report['ran'], array(), 'rien ne doit avoir tourné sous le verrou' );
			ts_eq( Schema::current(), 0, 'la version ne doit pas bouger sous le verrou' );
			ts_assert( str_contains( $report['error'], 'verrou' ), 'le refus doit dire pourquoi : ' . $report['error'] );
			delete_option( 'teeshoop_schema_lock' );
			Schema::migrate( array( 'cli' => true ) );
			ts_eq( Schema::current(), Schema::target(), 'le verrou levé, la migration repasse' );
		}
	);

	ts_it(
		'STOPS at a step that may not run in a web request instead of running past it',
		function (): void {
			/*
			 * Driven through plan() with a synthetic list rather than through
			 * migrate(), so that the stop is observed without running the real
			 * CLI-only steps, which write pages. The pure suite covers the same
			 * branch; this repeats it here so the integration run also reads as a
			 * statement about the shipped list and not only about a fixture.
			 */
			$synthetic = array_merge(
				Schema::steps(),
				array( array( 'id' => 9999, 'label' => 'un parcours de tous les articles', 'auto' => false, 'run' => static fn(): string => 'jamais' ) )
			);
			$plan = Schema::plan( $synthetic, Schema::target(), false );
			ts_eq( $plan['run'], array(), 'aucune étape auto ne reste, donc rien ne doit tourner' );
			ts_assert( is_array( $plan['stopped'] ), 'l’arrêt doit être signalé' );
			ts_eq( (int) $plan['stopped']['id'], 9999, 'et doit nommer l’étape qui bloque' );

			/*
			 * Les étapes réservées à la ligne de commande sont nommées, pour qu'une
			 * nouvelle ne le devienne pas par accident : 7 et 8 écrivent des pages
			 * et des menus, qui n'existent qu'après `init` (voir Schema::steps()).
			 */
			$cli_only = array_values( array_map( static fn( array $s ): int => (int) $s['id'], array_filter( Schema::steps(), static fn( array $s ): bool => empty( $s['auto'] ) ) ) );
			ts_eq( $cli_only, array( 7, 8, 9 ), 'seules les étapes qui écrivent des pages, des menus ou l’état des extensions attendent la ligne de commande' );
		}
	);

	ts_it(
		'fills only the empty fields of the legal identity, and never overwrites one',
		function (): void {
			$avant = get_option( 'teeshoop_legal', null );
			update_option( 'teeshoop_legal', array( 'raison_sociale' => 'Saisie opérateur', 'ville' => '' ) );
			$dit = Schema::step_identite();
			$lu  = get_option( 'teeshoop_legal' );
			ts_eq( $lu['raison_sociale'], 'Saisie opérateur', 'un champ rempli ne doit jamais être réécrit' );
			ts_eq( $lu['siret'], '93059298500012', 'un champ vide reçoit la valeur du registre' );
			ts_eq( $lu['hebergeur_nom'], 'o2switch', 'l’hébergeur fait partie de la même option' );
			ts_assert( ! str_contains( $dit, 'raison_sociale' ), 'le rapport ne doit pas annoncer un champ qu’il n’a pas posé : ' . $dit );
			ts_eq( Schema::step_identite(), 'identité déjà renseignée, rien de réécrit', 'la seconde passe ne doit rien changer' );
			null === $avant ? delete_option( 'teeshoop_legal' ) : update_option( 'teeshoop_legal', $avant );
		}
	);

	ts_it(
		'names the Paris time zone over a fixed offset, and leaves a chosen one alone',
		function (): void {
			// CMD-03 : la production tournait en UTC+1 fixe, sans heure d'été.
			$avant = (string) get_option( 'timezone_string', '' );
			update_option( 'timezone_string', '' );
			update_option( 'gmt_offset', 1 );
			ts_eq( Schema::step_fuseau(), 'Europe/Paris', 'le fuseau n’a pas été posé' );
			ts_eq( wp_timezone_string(), 'Europe/Paris', 'WordPress ne lit pas le fuseau posé' );
			update_option( 'timezone_string', 'Europe/Brussels' );
			Schema::step_fuseau();
			ts_eq( (string) get_option( 'timezone_string' ), 'Europe/Brussels', 'un fuseau choisi a été réécrit' );
			update_option( 'timezone_string', $avant );
		}
	);

	ts_it(
		'unpublishes an empty Elementor page and its menu entry, and leaves a written page alone',
		function (): void {
			$vide = wp_insert_post( array( 'post_type' => 'page', 'post_status' => 'publish', 'post_title' => 'Services', 'post_name' => 'services', 'post_content' => '' ) );
			update_post_meta( $vide, '_elementor_edit_mode', 'builder' );
			$ecrite = wp_insert_post( array( 'post_type' => 'page', 'post_status' => 'publish', 'post_title' => 'Contact', 'post_name' => 'contact', 'post_content' => str_repeat( 'Un vrai texte de page, écrit à la main. ', 8 ) ) );
			$menu   = wp_create_nav_menu( 'ts-test-menu-' . wp_generate_password( 6, false ) );
			$item   = wp_update_nav_menu_item( $menu, 0, array( 'menu-item-object-id' => $vide, 'menu-item-object' => 'page', 'menu-item-type' => 'post_type', 'menu-item-status' => 'publish' ) );
			ts_assert( ! is_wp_error( $item ) && $item > 0, 'l’entrée de menu témoin n’a pas pu être posée : ce test ne prouverait rien' );

			$dit = Schema::step_pages_vides();
			ts_eq( get_post_status( $vide ), 'draft', 'la page Elementor vide doit passer en brouillon : ' . $dit );
			ts_eq( get_post( $item ), null, 'son entrée de menu doit être supprimée' );
			ts_eq( get_post_status( $ecrite ), 'publish', 'une page qui a un vrai texte ne doit pas être touchée' );
			ts_eq( Schema::step_pages_vides(), 'aucune page vide à retirer', 'la seconde passe ne doit rien faire' );

			wp_delete_post( $vide, true );
			wp_delete_post( $ecrite, true );
			wp_delete_nav_menu( $menu );
		}
	);

	ts_it(
		'deactivates Rank Math by its name and unpublishes the three pages that contradict ours',
		function (): void {
			$dossier = WP_PLUGIN_DIR . '/ts-faux-rank-math';
			$fichier = 'ts-faux-rank-math/ts-faux-rank-math.php';
			wp_mkdir_p( $dossier );
			file_put_contents( WP_PLUGIN_DIR . '/' . $fichier, "<?php\n/**\n * Plugin Name: Rank Math SEO (témoin de test)\n */\n" );
			if ( ! function_exists( 'activate_plugin' ) ) {
				require_once ABSPATH . 'wp-admin/includes/plugin.php';
			}
			wp_clean_plugins_cache( false );
			ts_assert( null === activate_plugin( $fichier ) && is_plugin_active( $fichier ), 'l’extension témoin n’a pas pu être activée : ce test ne prouverait rien' );

			$ids = array();
			foreach ( array( 'remboursement', 'cookies', 'cartes-cadeaux' ) as $slug ) {
				$ids[ $slug ] = wp_insert_post( array( 'post_type' => 'page', 'post_status' => 'publish', 'post_title' => $slug, 'post_name' => $slug, 'post_content' => str_repeat( 'Texte hérité. ', 40 ) ) );
			}

			$dit = Schema::step_restes_ancienne_installation();
			ts_assert( ! is_plugin_active( $fichier ), 'une extension nommée « Rank Math » doit être désactivée : ' . $dit );
			foreach ( $ids as $slug => $id ) {
				ts_eq( get_post_status( $id ), 'draft', "la page {$slug} doit passer en brouillon" );
			}
			ts_eq( Schema::step_restes_ancienne_installation(), 'rien de l’ancienne installation à retirer', 'la seconde passe ne doit rien faire' );

			foreach ( $ids as $id ) {
				wp_delete_post( $id, true );
			}
			unlink( WP_PLUGIN_DIR . '/' . $fichier );
			rmdir( $dossier );
			wp_clean_plugins_cache( false );
		}
	);

	ts_it(
		'publishes the quote page the « Devis » buttons open',
		function (): void {
			$page = get_page_by_path( 'devis' );
			ts_assert( $page instanceof WP_Post, 'le miroir doit avoir une page devis pour que ce test prouve quelque chose' );
			$avant = $page->post_status;
			wp_update_post( array( 'ID' => $page->ID, 'post_status' => 'draft' ) );
			$dit = Schema::step_page_devis();
			ts_eq( get_post_status( $page->ID ), 'teeshoop' === get_template() ? 'publish' : 'draft', 'la page devis doit être publiée sous notre thème : ' . $dit );
			wp_update_post( array( 'ID' => $page->ID, 'post_status' => $avant ) );
		}
	);

	ts_it(
		'reports a version an administrator can read, and nothing outstanding',
		function (): void {
			$status = Schema::status();
			ts_eq( $status['current'], Schema::target(), 'la base est à jour' );
			ts_eq( $status['pending'], 0, 'rien en attente' );
			ts_eq( $status['cli_only'], 0, 'rien en attente de la ligne de commande' );
			ts_assert( count( $status['history'] ) === Schema::target(), 'chaque étape doit avoir laissé une date' );
		}
	);

	if ( null !== $restore_option ) {
		update_option( Schema::OPTION, $restore_option, true );
	}
}
