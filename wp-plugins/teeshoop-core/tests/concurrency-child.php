<?php
/**
 * One of several processes racing for invoice numbers.
 *
 * Spawned by `concurrency.php` through `wp eval-file`, so it runs in its own
 * PHP process with its own database connection: that is the whole point, and it
 * is why this cannot be a loop in the parent. Two customers paying in the same
 * second are two processes, and a read-then-write would hand both the same
 * number.
 *
 * Reads TS_SERIES, TS_COUNT and TS_START from the environment and prints the
 * numbers it was given, one per line. TS_START is a barrier: every child spins
 * until the same microsecond before touching the table, so the writes actually
 * collide instead of politely queueing behind process startup.
 *
 * @package Teeshoop\Core
 */

if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

$ts_series = (string) getenv( 'TS_SERIES' );
$ts_count  = max( 1, (int) getenv( 'TS_COUNT' ) );
$ts_start  = (float) getenv( 'TS_START' );

while ( microtime( true ) < $ts_start ) {
	usleep( 200 );
}

for ( $ts_i = 0; $ts_i < $ts_count; $ts_i++ ) {
	echo \Teeshoop\Core\Invoice::next_number( $ts_series ), "\n";
}
