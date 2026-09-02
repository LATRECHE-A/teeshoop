<?php
/**
 * PHP 8.1 GUARD: refuses a symbol the shop's own PHP does not have.
 *
 * WHY THIS EXISTS. o2switch serves teeshoop.com with PHP 8.1.34. This mirror runs
 * 8.3 because the official WordPress images stop shipping php8.1 at WordPress 6.8,
 * and `npm run test:php` runs on whatever the developer has, which is 8.5 today.
 * So until 02/09/2026 the plugin's PHP had never once executed on the version that
 * serves customers, and anything using a function added after 8.1 would pass every
 * gate in this repository and fatal on the live shop with a white page.
 *
 * CI now runs the lint and the whole PHP suite on `php:8.1-cli` (8.1.34, the same
 * patch), which is the strong half of the answer. This script is the other half,
 * and it exists because those two cannot see the same thing:
 *
 *   - `php -l` parses. It catches every SYNTAX added after 8.1 (readonly classes,
 *     typed constants, property hooks, attributes) and no function at all: a call
 *     to json_validate() is perfectly valid 8.1 syntax.
 *   - the suite EXECUTES, so it catches anything on a path a test walks. 550 tests
 *     is a lot and it is not every line: the admin screens, the twelve WP-CLI
 *     commands and the REST handlers are largely outside it.
 *
 * What is left over is exactly one shape, and it is the shape that gets shipped:
 * a function that does not exist on 8.1, on a line no test reaches.
 *
 * HOW THE LIST WAS BUILT. Not from a changelog and not from memory. Both tables
 * below are a measured difference between two real interpreters:
 *
 *   php -r '$f=get_defined_functions()["internal"]; ...'   # see scripts/php81-symbols.php
 *
 * run inside `php:8.1-cli`, inside `php:8.5-cli`, and over SSH on o2switch itself.
 * The production reading is why POST_8_1 is not the whole story: production's PHP
 * has 2264 internal functions where a bare 8.1 container has 1208 (imagick, ssh2,
 * oauth, http, pdf and the rest), so a container-only baseline would have flagged
 * a pile of functions the shop does have. It also found one function that a bare
 * 8.1 HAS and o2switch has NOT, which is a different fault with the same
 * consequence, so it gets its own table and its own sentence.
 *
 * REGENERATE after raising production's PHP, or when a newer PHP ships:
 *
 *   docker run --rm -i php:8.5-cli php < scripts/php81-symbols.php > /tmp/new.json
 *   docker run --rm -i php:8.1-cli php < scripts/php81-symbols.php > /tmp/81.json
 *   ssh teeshoop php                  < scripts/php81-symbols.php > /tmp/prod.json
 *
 * A STALE LIST UNDER-REPORTS, it never over-reports: every name here is a name
 * that measurably does not resolve on the shop. If PHP 9 adds a function tomorrow
 * this file will not know about it until somebody regenerates, and that is the
 * failure mode to prefer.
 *
 * IT READS TOKENS, NOT TEXT. token_get_all() means a needle inside a comment or a
 * string literal is not a hit, which matters here: the plugin's comments discuss
 * enums, `never` and first-class callables in English prose, and a grep-based
 * scanner reports all of them.
 *
 * Usage:  php scripts/php81-guard.php [--self-test]
 * Exit:   0 clean · 1 a symbol the shop does not have · 2 the scan is not
 *         trustworthy (nothing scanned, or the self-test did not fire).
 */

declare(strict_types=1);

/**
 * Introduced after PHP 8.1. Measured as php:8.5-cli minus php:8.1-cli, less
 * `exit`, `die` and `clone`, which are 8.1 language constructs that merely
 * BECAME functions later and are perfectly usable on the shop.
 */
const POST_8_1_FUNCTIONS = array(
		'array_all', 'array_any', 'array_find', 'array_find_key',
		'array_first', 'array_last', 'curl_multi_get_handles', 'curl_share_init_persistent',
		'curl_upkeep', 'dom\\import_simplexml', 'fpow', 'get_error_handler',
		'get_exception_handler', 'http_clear_last_response_headers', 'http_get_last_response_headers', 'ini_parse_quantity',
		'json_validate', 'libxml_get_external_entity_loader', 'mb_lcfirst', 'mb_ltrim',
		'mb_rtrim', 'mb_str_pad', 'mb_trim', 'mb_ucfirst',
		'memory_reset_peak_usage', 'opcache_is_script_cached_in_file_cache', 'opcache_jit_blacklist', 'openssl_cipher_key_length',
		'posix_eaccess', 'posix_fpathconf', 'posix_pathconf', 'posix_sysconf',
		'request_parse_body', 'sodium_crypto_stream_xchacha20_xor_ic', 'str_decrement', 'str_increment',
		'stream_context_set_options',);

const POST_8_1_CLASSES = array(
		'AllowDynamicProperties', 'CurlSharePersistentHandle', 'DateError',
		'DateException', 'DateInvalidOperationException', 'DateInvalidTimeZoneException',
		'DateMalformedIntervalStringException', 'DateMalformedPeriodStringException', 'DateMalformedStringException',
		'DateObjectError', 'DateRangeError', 'DelayedTargetValidation',
		'Deprecated', 'Dom\\AdjacentPosition', 'Dom\\Attr',
		'Dom\\CDATASection', 'Dom\\CharacterData', 'Dom\\ChildNode',
		'Dom\\Comment', 'Dom\\Document', 'Dom\\DocumentFragment',
		'Dom\\DocumentType', 'Dom\\DtdNamedNodeMap', 'Dom\\Element',
		'Dom\\Entity', 'Dom\\EntityReference', 'Dom\\HTMLCollection',
		'Dom\\HTMLDocument', 'Dom\\HTMLElement', 'Dom\\Implementation',
		'Dom\\NamedNodeMap', 'Dom\\NamespaceInfo', 'Dom\\Node',
		'Dom\\NodeList', 'Dom\\Notation', 'Dom\\ParentNode',
		'Dom\\ProcessingInstruction', 'Dom\\Text', 'Dom\\TokenList',
		'Dom\\XMLDocument', 'Dom\\XPath', 'Filter\\FilterException',
		'Filter\\FilterFailedException', 'NoDiscard', 'Override',
		'Pdo\\Sqlite', 'PropertyHookType', 'Random\\BrokenRandomEngineError',
		'Random\\CryptoSafeEngine', 'Random\\Engine', 'Random\\Engine\\Mt19937',
		'Random\\Engine\\PcgOneseq128XslRr64', 'Random\\Engine\\Secure', 'Random\\Engine\\Xoshiro256StarStar',
		'Random\\IntervalBoundary', 'Random\\RandomError', 'Random\\RandomException',
		'Random\\Randomizer', 'ReflectionConstant', 'RequestParseBodyException',
		'RoundingMode', 'SQLite3Exception', 'SensitiveParameter',
		'SensitiveParameterValue', 'StreamBucket', 'Uri\\InvalidUriException',
		'Uri\\Rfc3986\\Uri', 'Uri\\UriComparisonMode', 'Uri\\UriError',
		'Uri\\UriException', 'Uri\\WhatWg\\InvalidUrlException', 'Uri\\WhatWg\\Url',
		'Uri\\WhatWg\\UrlValidationError', 'Uri\\WhatWg\\UrlValidationErrorType', 'dom\\domexception',);

/**
 * A different fault with the same consequence: present in a stock PHP 8.1, absent
 * from o2switch's. `disable_functions` is empty there, so this is not a policy,
 * it is simply not built into CloudLinux's alt-php81. Calling it would be a fatal
 * on the shop and green everywhere else, which is the whole point of this file.
 */
const ABSENT_FROM_PRODUCTION = array(
	'chroot',
);

// ─────────────────────────────────────────────────────────────────────────────

$root = dirname(__DIR__);
$selfTest = in_array('--self-test', $argv, true);

/** Every .php file a deploy would put on the server, plus the tests. */
function php_files(string ...$roots): array {
	$out = array();
	foreach ($roots as $root) {
		if (!is_dir($root)) continue;
		$it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
		foreach ($it as $f) {
			if ($f->isFile() && strtolower($f->getExtension()) === 'php') $out[] = $f->getPathname();
		}
	}
	sort($out);
	return $out;
}

/**
 * Names this source itself defines, so a plugin function called `array_find`
 * would be its own and not PHP's. Nothing does this today; leaving it out would
 * make the first person who does look guilty.
 */
function declared_names(array $files): array {
	$fn = array(); $cl = array();
	foreach ($files as $path) {
		$t = @token_get_all((string) file_get_contents($path));
		if (!is_array($t)) continue;
		$n = count($t);
		for ($i = 0; $i < $n; $i++) {
			if (!is_array($t[$i])) continue;
			$id = $t[$i][0];
			if ($id !== T_FUNCTION && $id !== T_CLASS && $id !== T_INTERFACE && $id !== T_TRAIT) continue;
			/*
			 * UNE MÉTHODE N'EST PAS UNE FONCTION GLOBALE. Sans ce filtre, une
			 * méthode privée nommée `array_find` n'importe où dans l'extension
			 * faisait taire un VRAI appel à `array_find()` partout ailleurs : la
			 * liste est repo-wide et ne distingue pas les portées. Trouvé par une
			 * relecture adverse. `public/private/protected/static/abstract/final`
			 * juste avant `function`, c'est une méthode.
			 */
			if ($id === T_FUNCTION) {
				$avant = null;
				for ($k = $i - 1; $k >= 0; $k--) {
					if (is_array($t[$k]) && in_array($t[$k][0], array(T_WHITESPACE, T_COMMENT, T_DOC_COMMENT), true)) continue;
					$avant = $t[$k];
					break;
				}
				if (is_array($avant) && in_array($avant[0], array(T_PUBLIC, T_PRIVATE, T_PROTECTED, T_STATIC, T_ABSTRACT, T_FINAL), true)) continue;
			}
			for ($j = $i + 1; $j < $n; $j++) {
				if (is_array($t[$j]) && $t[$j][0] === T_WHITESPACE) continue;
				if (is_array($t[$j]) && $t[$j][0] === T_STRING) {
					if ($id === T_FUNCTION) $fn[strtolower($t[$j][1])] = true;
					else $cl[strtolower($t[$j][1])] = true;
				}
				break;
			}
		}
	}
	return array($fn, $cl);
}

/**
 * Referenced symbols, from tokens.
 *
 * A function name is a T_STRING followed by `(` and NOT preceded by `->`, `?->`,
 * `::`, `function`, `new`, `#[` or `$`. A class name is a T_STRING or
 * T_NAME_QUALIFIED / T_NAME_FULLY_QUALIFIED that follows `new`, `instanceof`,
 * `catch (`, `extends`, `implements`, or is followed by `::`, or sits in an
 * attribute. Type positions are covered by the `::` and `new` cases in practice
 * and by the lint for anything that is a syntax error on 8.1 anyway.
 */
function referenced(string $path): array {
	$src = (string) file_get_contents($path);
	$t = @token_get_all($src);
	if (!is_array($t)) return array(array(), array());
	$fn = array(); $cl = array();
	$n = count($t);

	/*
	 * LES ALIAS `use`, ET C'EST LE TROU QUI COMPTAIT.
	 *
	 * Personne n'écrit `new \Random\Randomizer()`. On écrit `use Random\Randomizer;`
	 * en tête de fichier puis `new Randomizer()`, et c'est la seule forme que ce
	 * dépôt emploie. Le jeton vu au point d'usage est alors `Randomizer`, qui
	 * n'est dans aucune table, et le contrôle laissait passer exactement la
	 * construction qu'il existe pour attraper. Trouvé par une relecture adverse.
	 *
	 * On lit donc les `use` du fichier et on note à quoi chaque nom court renvoie.
	 */
	$alias = array();
	for ($i = 0; $i < $n; $i++) {
		if (!is_array($t[$i]) || $t[$i][0] !== T_USE) continue;
		// Un `use` de trait est à l'intérieur d'une classe et suit un `{`; celui
		// qui nous intéresse est au niveau du fichier. Les deux se lisent pareil
		// pour ce qu'on en fait, et un faux positif ici ne fait que renommer un
		// trait, ce qui ne peut pas créer de fausse alerte : le nom résolu doit
		// encore figurer dans une table pour être signalé.
		$plein = '';
		$court = '';
		for ($j = $i + 1; $j < $n; $j++) {
			if ($t[$j] === ';' || $t[$j] === '{' || $t[$j] === '(') break;
			if (!is_array($t[$j])) continue;
			if (in_array($t[$j][0], array(T_STRING, T_NAME_QUALIFIED, T_NAME_FULLY_QUALIFIED), true)) {
				if ('' === $plein) { $plein = ltrim($t[$j][1], '\\'); $court = $plein; }
				else { $court = $t[$j][1]; }   // la partie après `as`
			}
		}
		if ('' === $plein) continue;
		if ($court === $plein) {
			$parts = explode('\\', $plein);
			$court = end($parts);
		}
		$alias[strtolower($court)] = $plein;
	}
	$prev = function (int $i) use ($t) {
		for ($j = $i - 1; $j >= 0; $j--) {
			if (is_array($t[$j]) && ($t[$j][0] === T_WHITESPACE || $t[$j][0] === T_COMMENT || $t[$j][0] === T_DOC_COMMENT)) continue;
			return $t[$j];
		}
		return null;
	};
	$next = function (int $i) use ($t, $n) {
		for ($j = $i + 1; $j < $n; $j++) {
			if (is_array($t[$j]) && ($t[$j][0] === T_WHITESPACE || $t[$j][0] === T_COMMENT || $t[$j][0] === T_DOC_COMMENT)) continue;
			return $t[$j];
		}
		return null;
	};
	$nameIds = array(T_STRING, T_NAME_QUALIFIED, T_NAME_FULLY_QUALIFIED);
	for ($i = 0; $i < $n; $i++) {
		if (!is_array($t[$i]) || !in_array($t[$i][0], $nameIds, true)) continue;
		$name = ltrim($t[$i][1], '\\');
		$line = $t[$i][2];
		$p = $prev($i);
		$q = $next($i);
		$pIsArrow = is_array($p) && in_array($p[0], array(T_OBJECT_OPERATOR, T_NULLSAFE_OBJECT_OPERATOR, T_DOUBLE_COLON), true);
		$pIsDecl  = is_array($p) && in_array($p[0], array(T_FUNCTION, T_CLASS, T_INTERFACE, T_TRAIT, T_CONST), true);
		// a call
		if ($q === '(' && !$pIsArrow && !$pIsDecl && !(is_array($p) && $p[0] === T_NEW)) {
			$fn[strtolower($name)][] = $line;
		}
		// a class
		$isClass = false;
		if (is_array($p) && in_array($p[0], array(T_NEW, T_INSTANCEOF, T_EXTENDS, T_IMPLEMENTS), true)) $isClass = true;
		/*
		 * `catch ( Foo $e )`. Le docblock au-dessus l'annonçait et le code ne le
		 * faisait pas : le jeton qui précède le nom est `(`, pas `T_CATCH`. Une
		 * relecture adverse a lu la promesse et le code, et ils ne disaient pas la
		 * même chose. On remonte donc d'un jeton de plus.
		 */
		if ($p === '(') {
			// Deux remontées, pas une : d'abord jusqu'à la parenthèse elle-même,
			// puis jusqu'au jeton d'avant. Partir de $i-2 tombait sur la
			// parenthèse et s'arrêtait là, ce que l'auto-test a dit tout de suite.
			$k = $i - 1;
			while ($k >= 0 && is_array($t[$k]) && in_array($t[$k][0], array(T_WHITESPACE, T_COMMENT, T_DOC_COMMENT), true)) $k--;
			if ($k >= 0 && $t[$k] === '(') {
				$k--;
				while ($k >= 0 && is_array($t[$k]) && in_array($t[$k][0], array(T_WHITESPACE, T_COMMENT, T_DOC_COMMENT), true)) $k--;
				if ($k >= 0 && is_array($t[$k]) && $t[$k][0] === T_CATCH) $isClass = true;
			}
		}
		if (is_array($q) && $q[0] === T_DOUBLE_COLON) $isClass = true;
		if (is_array($p) && $p[0] === T_ATTRIBUTE) $isClass = true;
		if ($isClass) {
			$court = strtolower($name);
			// Le nom résolu s'il vient d'un `use`, le nom écrit sinon.
			$resolu = isset($alias[$court]) ? strtolower($alias[$court]) : $court;
			$cl[$resolu][] = $line;
		}
	}
	return array($fn, $cl);
}

function scan(array $files): array {
	list($ownFn, $ownCl) = declared_names($files);
	$bad = array_change_key_case(array_flip(array_merge(POST_8_1_FUNCTIONS, ABSENT_FROM_PRODUCTION)), CASE_LOWER);
	$badCl = array_change_key_case(array_flip(POST_8_1_CLASSES), CASE_LOWER);
	$hits = array();
	foreach ($files as $path) {
		list($fn, $cl) = referenced($path);
		foreach ($fn as $name => $lines) {
			if (!isset($bad[$name]) || isset($ownFn[$name])) continue;
			$why = in_array($name, array_map('strtolower', ABSENT_FROM_PRODUCTION), true)
				? "absente du PHP d'o2switch (elle existe pourtant dans un 8.1 standard)"
				: 'introduite après PHP 8.1';
			foreach ($lines as $l) $hits[] = array($path, $l, $name . '()', $why);
		}
		foreach ($cl as $name => $lines) {
			if (!isset($badCl[$name]) || isset($ownCl[$name])) continue;
			foreach ($lines as $l) $hits[] = array($path, $l, $name, 'introduite après PHP 8.1');
		}
	}
	return $hits;
}

$files = php_files($root . '/wp-plugins', $root . '/wp-themes');

if (count($files) === 0) {
	fwrite(STDERR, "php81-guard: aucun fichier PHP scanné. « Rien trouvé » et « rien regardé » sont deux résultats différents.\n");
	exit(2);
}

// ─────────────────────────────────────────────────────────────────────────────
// SELF-TEST. A gate nobody has seen fail is a gate nobody knows works. This
// writes a bait file carrying one of each shape, in a temp directory that is not
// the repository, scans it, and requires every planted shape to be found.
if ($selfTest) {
	$dir = sys_get_temp_dir() . '/php81-guard-' . getmypid();
	@mkdir($dir, 0700, true);
	$bait = $dir . '/bait.php';
	file_put_contents($bait, <<<'BAIT'
<?php
namespace Teeshoop\Core;

// LES DEUX FORMES QUE CE CONTRÔLE NE VOYAIT PAS AVANT LE 02/09/2026, plantées
// ici pour que l'auto-test refuse si jamais elles redevenaient invisibles.
use Random\Randomizer as Tirage;   // alias explicite
use Random\RandomException;        // alias implicite, le nom court

final class Appat {
	// Une MÉTHODE qui porte le nom d'une fonction de PHP 8.4. Elle ne doit pas
	// faire taire l'appel à la vraie fonction, plus bas.
	private function array_find(): void {}
}

function bait(): void {
	$t = new Tirage();                  // 8.2, par alias explicite
	$e = RandomException::class;        // 8.2, par alias implicite
	$ok = json_validate('{}');                 // 8.3
	$p  = mb_str_pad('x', 3);                  // 8.3
	$f  = array_find(array(), fn($v) => true); // 8.4
	$a  = array_any(array(), fn($v) => true);  // 8.4
	$t  = mb_trim(' x ');                      // 8.4
	$r  = new \Random\Randomizer();            // 8.2
	$m  = \Random\Engine\Mt19937::class;       // 8.2
	$c  = chroot('/tmp');                      // absent from o2switch
	try { $x = 1; } catch ( \Random\BrokenRandomEngineError $err ) { $x = 2; }  // 8.2, en catch
	// A comment naming json_validate() and Random\Randomizer must NOT be a hit.
	$s  = 'json_validate() inside a string must not be a hit either';
}
BAIT);
	$hits = scan(array($bait));
	$found = array();
	foreach ($hits as $h) $found[strtolower($h[2])] = true;
	$want = array('json_validate()', 'mb_str_pad()', 'array_find()', 'array_any()', 'mb_trim()', 'random\randomizer', 'random\engine\mt19937', 'chroot()', 'random\randomexception', 'random\brokenrandomengineerror');
	$missing = array();
	foreach ($want as $w) if (!isset($found[$w])) $missing[] = $w;
	// And the negative half: the comment and the string literal must not count.
	$countJson = 0;
	foreach ($hits as $h) if (strtolower($h[2]) === 'json_validate()') $countJson++;
	@unlink($bait); @rmdir($dir);
	if (count($missing) > 0) {
		fwrite(STDERR, 'php81-guard --self-test: ' . count($missing) . " forme(s) plantée(s) non détectée(s) : " . implode(', ', $missing) . ". Ce contrôle ne prouve rien.\n");
		exit(2);
	}
	if ($countJson !== 1) {
		fwrite(STDERR, "php81-guard --self-test: json_validate compté $countJson fois au lieu d'une. Le scanner lit du texte et pas des jetons : un commentaire ou une chaîne serait signalé.\n");
		exit(2);
	}
	echo 'php81-guard --self-test: les ' . count($want) . " formes plantées sont détectées, et ni le commentaire ni la chaîne ne comptent.\n";
	exit(0);
}

$hits = scan($files);
if (count($hits) === 0) {
	printf("php81-guard: %d fichiers PHP, aucun symbole absent du PHP 8.1.34 de la boutique.\n", count($files));
	exit(0);
}
fwrite(STDERR, sprintf("php81-guard: %d symbole(s) que le PHP de la boutique n'a pas.\n\n", count($hits)));
foreach ($hits as $h) {
	fwrite(STDERR, sprintf("  %s:%d  %s  (%s)\n", substr($h[0], strlen($root) + 1), $h[1], $h[2], $h[3]));
}
fwrite(STDERR, "\no2switch sert teeshoop.com en PHP 8.1.34. Chacune de ces lignes est une page blanche sur la boutique et un test vert ici.\n");
exit(1);
