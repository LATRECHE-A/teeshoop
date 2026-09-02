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
			delete_option( Schema::OPTION );
			set_transient( 'teeshoop_schema_lock', time(), 900 );
			$report = Schema::migrate( array( 'cli' => true ) );
			ts_assert( ! $report['ok'], 'une migration concurrente doit être refusée, pas doublée' );
			ts_eq( $report['ran'], array(), 'rien ne doit avoir tourné sous le verrou' );
			ts_eq( Schema::current(), 0, 'la version ne doit pas bouger sous le verrou' );
			ts_assert( str_contains( $report['error'], 'verrou' ), 'le refus doit dire pourquoi : ' . $report['error'] );
			delete_transient( 'teeshoop_schema_lock' );
			Schema::migrate( array( 'cli' => true ) );
			ts_eq( Schema::current(), Schema::target(), 'le verrou levé, la migration repasse' );
		}
	);

	ts_it(
		'STOPS at a step that may not run in a web request instead of running past it',
		function (): void {
			/*
			 * Driven through plan() with a synthetic list rather than through
			 * migrate(), because the three real steps are all `auto` today and
			 * an assertion that cannot be exercised proves nothing. The pure
			 * suite covers the same branch; this repeats it here so that the day
			 * a real CLI-only step is added, the integration run reads as a
			 * statement about the shipped list and not about a fixture.
			 */
			$synthetic = array_merge(
				Schema::steps(),
				array( array( 'id' => 9999, 'label' => 'un parcours de tous les articles', 'auto' => false, 'run' => static fn(): string => 'jamais' ) )
			);
			$plan = Schema::plan( $synthetic, Schema::target(), false );
			ts_eq( $plan['run'], array(), 'aucune étape auto ne reste, donc rien ne doit tourner' );
			ts_assert( is_array( $plan['stopped'] ), 'l’arrêt doit être signalé' );
			ts_eq( (int) $plan['stopped']['id'], 9999, 'et doit nommer l’étape qui bloque' );

			$auto_only = array_filter( Schema::steps(), static fn( array $s ): bool => empty( $s['auto'] ) );
			ts_eq( count( $auto_only ), 0, 'les trois étapes livrées sont toutes O(1) et doivent le rester tant qu’aucune ne parcourt de lignes' );
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
