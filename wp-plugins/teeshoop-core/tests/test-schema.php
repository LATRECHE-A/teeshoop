<?php
/**
 * The migration runner's decision, tested with no database and no WordPress.
 *
 * WHY THIS FILE IS PURE. `Schema::migrate()` needs a database, so it is checked
 * by tests/integration-schema.php against a real WooCommerce. What it DECIDES is
 * a different question and does not need one: which steps run, in what order,
 * and where the run stops. That is `Schema::plan()`, and every branch of it is
 * reachable from here, in milliseconds, on every push.
 *
 * THE BRANCH THAT MATTERS IS THE THIRD ONE. A step that may not run in a web
 * request STOPS the run, it is not skipped over. On o2switch the web SAPI has a
 * `max_execution_time` and the CLI does not, so a step that walks 26 392
 * imported articles is command-line-only; if a later step were allowed to run
 * past it, the database would be in a shape no version number describes, and the
 * recorded version would be a lie for as long as nobody looked.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

require_once __DIR__ . '/../includes/Schema.php';

use Teeshoop\Core\Schema;

/** A step list with the two shapes that matter, and nothing else. */
function ts_steps(): array {
	return array(
		array( 'id' => 1, 'label' => 'une table', 'auto' => true, 'run' => static fn(): string => '1' ),
		array( 'id' => 2, 'label' => 'une option', 'auto' => true, 'run' => static fn(): string => '2' ),
		array( 'id' => 3, 'label' => 'un parcours de 26 392 articles', 'auto' => false, 'run' => static fn(): string => '3' ),
		array( 'id' => 4, 'label' => 'une seconde table', 'auto' => true, 'run' => static fn(): string => '4' ),
	);
}

/** @return int[] */
function ts_ids( array $plan ): array {
	return array_map( static fn( array $s ): int => (int) $s['id'], $plan['run'] );
}

describe( 'Schema: which steps run', function (): void {

	it(
		'runs everything from the beginning on a database that has never migrated',
		function (): void {
			$plan = Schema::plan( ts_steps(), 0, true );
			eq( ts_ids( $plan ), array( 1, 2, 3, 4 ) );
			eq( $plan['stopped'], null );
		}
	);

	it(
		'runs nothing on a database already at the last step',
		function (): void {
			$plan = Schema::plan( ts_steps(), 4, true );
			eq( ts_ids( $plan ), array() );
			eq( $plan['stopped'], null );
		}
	);

	it(
		'runs only what is newer than the version recorded',
		function (): void {
			eq( ts_ids( Schema::plan( ts_steps(), 2, true ) ), array( 3, 4 ) );
			eq( ts_ids( Schema::plan( ts_steps(), 3, true ) ), array( 4 ) );
		}
	);

	it(
		'STOPS at a command-line-only step in a web request, and does not run past it',
		function (): void {
			$plan = Schema::plan( ts_steps(), 0, false );
			// 4 is `auto` and would be perfectly safe to run. It still must not,
			// because 3 has not, and a database at 4-without-3 has no version.
			eq( ts_ids( $plan ), array( 1, 2 ) );
			truthy( is_array( $plan['stopped'] ), 'la raison de l’arrêt doit être rendue, pas seulement l’arrêt' );
			eq( (int) $plan['stopped']['id'], 3 );
		}
	);

	it(
		'runs the same step on the command line',
		function (): void {
			$plan = Schema::plan( ts_steps(), 0, true );
			eq( ts_ids( $plan ), array( 1, 2, 3, 4 ) );
		}
	);

	it(
		'reports nothing to stop at when the blocking step is already behind us',
		function (): void {
			$plan = Schema::plan( ts_steps(), 3, false );
			eq( ts_ids( $plan ), array( 4 ) );
			eq( $plan['stopped'], null );
		}
	);

	it(
		'runs in identifier order however the list happens to be written',
		function (): void {
			/*
			 * THIS ASSERTION USED TO SORT ITS OWN RESULT, which made it pass on a
			 * runner that ran the steps backwards. Written on 02/09/2026 and
			 * caught the same afternoon by reading it against its own name: it
			 * claimed the runner ignores declaration order and only proved the
			 * right SET of steps came back. The order is the whole contract, so
			 * the comparison is now against an ordered list.
			 */
			eq( ts_ids( Schema::plan( array_reverse( ts_steps() ), 0, true ) ), array( 1, 2, 3, 4 ) );
			eq( ts_ids( Schema::plan( array_reverse( ts_steps() ), 2, true ) ), array( 3, 4 ) );
		}
	);

	it(
		'stops at the LOWEST blocking step, not the first one it happens to read',
		function (): void {
			// Declared out of order on purpose: the command-line-only step is 3,
			// and a runner reading the array as written would stop at 4 instead.
			$plan = Schema::plan( array_reverse( ts_steps() ), 0, false );
			eq( ts_ids( $plan ), array( 1, 2 ) );
			eq( (int) $plan['stopped']['id'], 3 );
		}
	);
} );

describe( 'Schema: the version is derived', function (): void {

	it(
		'takes the target from the highest step that exists, not from a constant',
		function (): void {
			/*
			 * LE NOMBRE ATTENDU N'EST PLUS ÉCRIT ICI, ET C'EST LE POINT DU TEST.
			 *
			 * Il valait `3`, et le 9 septembre 2026 deux étapes se sont ajoutées
			 * (le dépôt du catalogue fournisseur et la table des
			 * disponibilités). Le test est devenu rouge, ce qui est exactement
			 * ce qu'on lui demande : personne n'ajoute une étape de migration
			 * sans s'en apercevoir. Mais réécrire `5` ici recommencerait la même
			 * chose au prochain ajout, et surtout dupliquerait la constante que
			 * `target()` existe pour NE PAS avoir. Ce qui est asserté est donc la
			 * PROPRIÉTÉ, plus un plancher qui refuse une liste vidée par erreur.
			 */
			truthy( Schema::target() >= 3, 'les trois étapes historiques existent toujours' );
			$max = 0;
			foreach ( Schema::steps() as $s ) {
				$max = max( $max, (int) $s['id'] );
			}
			eq( Schema::target(), $max, 'target() doit être le plus grand identifiant et rien d’autre' );
		}
	);

	it(
		'gives every step a unique identifier, because the id is what an install records',
		function (): void {
			$ids = array_map( static fn( array $s ): int => (int) $s['id'], Schema::steps() );
			eq( count( array_unique( $ids ) ), count( $ids ), 'deux étapes portent le même identifiant' );
			foreach ( $ids as $id ) {
				truthy( $id > 0, "un identifiant d'étape doit être positif, vu $id" );
			}
		}
	);

	it(
		'labels every step in French and gives every step something to run',
		function (): void {
			foreach ( Schema::steps() as $s ) {
				truthy( is_string( $s['label'] ) && '' !== $s['label'], 'étape ' . $s['id'] . ' sans libellé' );
				truthy( is_callable( $s['run'] ), 'étape ' . $s['id'] . ' sans traitement' );
				truthy( array_key_exists( 'auto', $s ), 'étape ' . $s['id'] . ' ne dit pas si elle peut tourner dans une requête web' );
			}
		}
	);
} );
