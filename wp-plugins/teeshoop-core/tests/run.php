<?php
/**
 * Zero-dependency test runner for the pure classes.
 *
 *   php wp-plugins/teeshoop-core/tests/run.php
 *
 * No PHPUnit, no composer, no WordPress bootstrap — because the classes under
 * test call no WordPress function, and keeping it that way is the design rule
 * this runner enforces by construction: the day someone reaches for
 * get_option() inside Pricing, this stops working and says so.
 *
 * Exit code 0 = all green, 1 = a failure, 2 = the runner found no tests (which
 * must never read as success — see scripts/bundle-guard.mjs for the same
 * precaution).
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

/*
 * COMMAND LINE ONLY.
 *
 * `wp-content/plugins/` is served by URL and this directory is inside it.
 * Before this line, GET /wp-content/plugins/teeshoop-core/tests/run.php
 * answered 200 and ran the whole suite to the public internet: it names the
 * floor-price and commission rules, it prints the expected and actual figures
 * of any assertion that fails, and on shared hosting it burns the CPU of
 * whoever asks. The customer bundle is guarded against exactly this leak by
 * scripts/bundle-guard.mjs; the same material was reachable in PHP, and an
 * unguessable path is not an access control.
 *
 * PHP_SAPI rather than a WP_CLI check, because `php tests/run.php` runs with no
 * WordPress at all while the two integration files run under wp-cli, which is
 * also CLI. It must come after any `declare`, which has to be the first
 * statement of a script.
 */
if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

define( 'TEESHOOP_TEST', true );

const RED   = "\033[31m";
const GREEN = "\033[32m";
const DIM   = "\033[2m";
const OFF   = "\033[0m";

$GLOBALS['ts_pass']    = 0;
$GLOBALS['ts_fail']    = 0;
$GLOBALS['ts_failures'] = array();
$GLOBALS['ts_group']   = '';

function describe( string $name, callable $body ): void {
	$GLOBALS['ts_group'] = $name;
	echo DIM . $name . OFF . "\n";
	$body();
}

function it( string $name, callable $body ): void {
	try {
		$body();
		++$GLOBALS['ts_pass'];
		echo '  ' . GREEN . '✓' . OFF . ' ' . $name . "\n";
	} catch ( \Throwable $e ) {
		++$GLOBALS['ts_fail'];
		$GLOBALS['ts_failures'][] = $GLOBALS['ts_group'] . ' › ' . $name . "\n      " . $e->getMessage();
		echo '  ' . RED . '✗' . OFF . ' ' . $name . "\n";
	}
}

function fail( string $message ): void {
	throw new \RuntimeException( $message );
}

function eq( mixed $actual, mixed $expected, string $what = '' ): void {
	if ( $actual !== $expected ) {
		fail(
			( '' !== $what ? $what . ': ' : '' ) .
			'expected ' . var_export( $expected, true ) .
			', got ' . var_export( $actual, true )
		);
	}
}

function near( float $actual, float $expected, float $epsilon = 1e-9, string $what = '' ): void {
	if ( abs( $actual - $expected ) > $epsilon ) {
		fail( ( '' !== $what ? $what . ': ' : '' ) . "expected ~{$expected}, got {$actual}" );
	}
}

function truthy( mixed $value, string $what = '' ): void {
	if ( ! $value ) {
		fail( ( '' !== $what ? $what . ': ' : '' ) . 'expected truthy, got ' . var_export( $value, true ) );
	}
}

function throws( callable $body, string $what = '' ): void {
	try {
		$body();
	} catch ( \Throwable $e ) {
		return;
	}
	fail( ( '' !== $what ? $what . ': ' : '' ) . 'expected a throw, got none' );
}

// ---------------------------------------------------------------------------

$files = glob( __DIR__ . '/test-*.php' );
if ( empty( $files ) ) {
	fwrite( STDERR, RED . "No test files found — the runner scanned nothing.\n" . OFF );
	exit( 2 );
}

/*
 * A RUN THAT STOPS HALF WAY MAY NOT EXIT 0.
 *
 * Every file in includes/ guards itself with `defined('ABSPATH') || exit`, and
 * one of them was missing the TEESHOOP_TEST escape. A test that required it hit
 * that `exit` at load: PHP unwound, this file's remaining lines never ran, no
 * summary was printed, and the process ended with status 0. Sixty assertions had
 * passed, eight files had not been opened at all, and `npm run ci` went green.
 * That is the same failure the brief already records ("nine green ticks under
 * 0 passed"), arriving from the other direction.
 *
 * The sentinel makes it impossible: reaching the end of this file is now a fact
 * the shutdown handler can read, and anything else is exit 2, which is this
 * project's code for "the scan is not trustworthy".
 */
$GLOBALS['ts_reached_end'] = false;
register_shutdown_function(
	static function (): void {
		if ( true === ( $GLOBALS['ts_reached_end'] ?? false ) ) {
			return;
		}
		$done = ( $GLOBALS['ts_pass'] ?? 0 ) + ( $GLOBALS['ts_fail'] ?? 0 );
		fwrite(
			STDERR,
			RED . "\n  The run stopped before the end: {$done} assertion(s) ran and no summary was printed.\n"
			. "  A file required by a test called exit(), or PHP died. Do not read this as a pass.\n" . OFF
		);
		exit( 2 );
	}
);

foreach ( $files as $file ) {
	require $file;
}

echo "\n";
foreach ( $GLOBALS['ts_failures'] as $failure ) {
	echo RED . '  ✗ ' . OFF . $failure . "\n";
}

$total = $GLOBALS['ts_pass'] + $GLOBALS['ts_fail'];
if ( $GLOBALS['ts_fail'] > 0 ) {
	echo RED . "  {$GLOBALS['ts_fail']} failed" . OFF . ", {$GLOBALS['ts_pass']} passed ({$total} total)\n";
	$GLOBALS['ts_reached_end'] = true;
	exit( 1 );
}

echo GREEN . "  {$GLOBALS['ts_pass']} passed" . OFF . " ({$total} total)\n";
$GLOBALS['ts_reached_end'] = true;
exit( 0 );
