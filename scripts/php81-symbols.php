<?php
/**
 * Reads one PHP interpreter and prints everything it can resolve, as JSON.
 *
 * This is the instrument behind the two tables in scripts/php81-guard.php. It is
 * kept as a file rather than a one-liner in a comment because the guard's whole
 * claim is that its list was MEASURED, and a measurement you cannot repeat is an
 * assertion. Run it against three interpreters and diff:
 *
 *   docker run --rm -i php:8.1-cli php < scripts/php81-symbols.php > 81.json
 *   docker run --rm -i php:8.5-cli php < scripts/php81-symbols.php > new.json
 *   ssh teeshoop php                   < scripts/php81-symbols.php > prod.json
 *
 * `php` with no file argument, not `php -`: o2switch's build answers
 * "Could not open input file: -" to the dash, and reads stdin happily without it.
 *
 * The production reading is not optional and not decoration. o2switch's PHP 8.1.34
 * answers 2264 internal functions where a stock php:8.1-cli answers 1208: imagick,
 * ssh2, oauth, http, pdf, memcached, redis and the rest of CloudLinux's build. A
 * table built from the container alone would refuse a pile of functions the shop
 * has. It also goes the other way, and that was worth finding: `chroot` exists in
 * a stock 8.1 and not on o2switch, with `disable_functions` empty, so it is simply
 * not built in. Same white page, different cause, and only the real host says so.
 *
 * POST_8_1_*  = newer container MINUS 8.1 container   (a version difference)
 * ABSENT_FROM_PRODUCTION = 8.1 container MINUS production   (a build difference)
 */

declare(strict_types=1);

$functions = get_defined_functions()['internal'];
sort($functions);

$classes = array();
$members = array();
foreach (array_merge(get_declared_classes(), get_declared_interfaces(), get_declared_traits()) as $name) {
	$r = new ReflectionClass($name);
	// Userland classes would make the diff depend on what happened to be loaded.
	if (!$r->isInternal()) continue;
	$classes[] = $name;
	foreach ($r->getMethods() as $m) $members[] = $m->class . '::' . $m->getName();
	foreach (array_keys($r->getConstants()) as $k) $members[] = $name . '::' . $k;
}
sort($classes);
$members = array_values(array_unique($members));
sort($members);

echo json_encode(array(
	'php'        => PHP_VERSION,
	'sapi'       => PHP_SAPI,
	'extensions' => get_loaded_extensions(),
	'functions'  => $functions,
	'classes'    => $classes,
	'members'    => $members,
), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), "\n";
