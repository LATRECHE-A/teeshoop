<?php
/**
 * The invoice sequence, under real contention.
 *
 * WHY THIS EXISTS AS ITS OWN FILE AND ITS OWN PROCESSES. Two simultaneous orders
 * sharing an invoice number is an accounting problem that cannot be fixed
 * afterwards: an invoice is cancelled by an avoir, never renumbered, so a
 * collision has to be corrected by issuing documents that say a customer was
 * credited money they were not. A loop in one process proves nothing about it,
 * because one process has one database connection and never contends with
 * itself.
 *
 * So this spawns real children through `wp eval-file`, holds them at a barrier
 * so they all reach the table at once, and then checks the only two properties
 * that matter: no number was issued twice, and no number was skipped.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

/**
 * @param int $children How many processes race.
 * @param int $each     How many numbers each takes.
 */
function ts_concurrency_suite( int $children = 6, int $each = 25 ): void {
	global $wpdb;

	echo "\nLa séquence de facturation, en concurrence\n";

	// A series of its own, so a probe can never touch the shop's own counter.
	$series = 'PROBE' . getmypid();
	$table  = \Teeshoop\Core\Invoice::table();
	$binary = trim( (string) shell_exec( 'command -v wp 2>/dev/null' ) );

	if ( '' === $binary ) {
		/*
		 * A check that cannot run must never read as a check that passed. The
		 * suite fails rather than skipping, because the day this silently stops
		 * running is the day the sequence stops being tested.
		 */
		ts_it( 'races several processes for invoice numbers', function (): void {
			throw new \RuntimeException( 'wp-cli is not on PATH, so no child process could be started and nothing was raced' );
		} );
		return;
	}

	$start = microtime( true ) + 1.5;
	$procs = array();
	$pipes = array();

	for ( $i = 0; $i < $children; $i++ ) {
		$descriptors = array(
			1 => array( 'pipe', 'w' ),
			2 => array( 'pipe', 'w' ),
		);
		$command     = escapeshellarg( $binary ) . ' eval-file '
			. escapeshellarg( 'wp-content/plugins/teeshoop-core/tests/concurrency-child.php' )
			. ' --path=' . escapeshellarg( ABSPATH );

		$procs[ $i ] = proc_open(
			$command,
			$descriptors,
			$pipes[ $i ],
			ABSPATH,
			/*
			 * MERGED with the parent's environment, not replaced. Passing only
			 * our own three variables cost a run: wp-config.php reads
			 * WORDPRESS_DB_HOST and friends from the environment in this
			 * container, so every child came back with "Error establishing a
			 * database connection" and the race proved nothing.
			 */
			array_merge(
				getenv(),
				array(
					'TS_SERIES' => $series,
					'TS_COUNT'  => (string) $each,
					'TS_START'  => (string) $start,
					// wp-cli wants somewhere writable for its cache, and this
					// container runs as a user with no home.
					'HOME'      => '/tmp',
				)
			)
		);
	}

	$numbers = array();
	$failed  = array();
	foreach ( $procs as $i => $proc ) {
		if ( ! is_resource( $proc ) ) {
			$failed[] = $i;
			continue;
		}
		$out = (string) stream_get_contents( $pipes[ $i ][1] );
		$err = (string) stream_get_contents( $pipes[ $i ][2] );
		fclose( $pipes[ $i ][1] );
		fclose( $pipes[ $i ][2] );
		$code = proc_close( $proc );

		if ( 0 !== $code ) {
			$failed[] = $i . ': ' . trim( $err );
			continue;
		}
		foreach ( preg_split( '/\R/', trim( $out ) ) as $line ) {
			if ( '' !== trim( $line ) ) {
				$numbers[] = (int) trim( $line );
			}
		}
	}

	ts_it( "gives {$children} concurrent processes {$each} numbers each, all different", function () use ( $numbers, $children, $each, $failed ): void {
		ts_assert( empty( $failed ), 'a child process failed: ' . implode( ' | ', $failed ) );
		ts_eq( count( $numbers ), $children * $each, 'not every process got its numbers' );
		ts_eq( count( array_unique( $numbers ) ), count( $numbers ), 'two processes were handed the same invoice number' );
	} );

	ts_it( 'leaves no hole in the sequence, because an invoice number cannot be reused', function () use ( $numbers, $children, $each ): void {
		ts_assert( ! empty( $numbers ), 'no number came back at all, so there is no sequence to check' );
		sort( $numbers );
		ts_eq( $numbers[0], 1, 'the series did not start at 1' );
		ts_eq( $numbers[ count( $numbers ) - 1 ], $children * $each, 'the series did not end where it should' );
		for ( $i = 1; $i < count( $numbers ); $i++ ) {
			ts_eq( $numbers[ $i ], $numbers[ $i - 1 ] + 1, "a hole at position {$i}" );
		}
	} );

	ts_it( 'really did run several processes at once, or this proves nothing', function () use ( $procs, $children ): void {
		ts_eq( count( $procs ), $children, 'not enough processes were started' );
	} );

	$wpdb->query( $wpdb->prepare( "DELETE FROM {$table} WHERE series = %s", $series ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
}
