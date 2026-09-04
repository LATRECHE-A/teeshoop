<?php
/**
 * WooCommerce integration test.
 *
 *   cd wp-local && docker compose run --rm wpcli eval-file \
 *     wp-content/plugins/teeshoop-core/tests/integration.php
 *
 * Deliberately NOT named test-*.php: tests/run.php globs that pattern and must
 * stay bootstrap-free. This one needs a live WordPress, a live WooCommerce and a
 * database, so it runs where those exist.
 *
 * It exists because the pure tests cannot see the bug that actually shipped
 * here: `recompute_prices` was skipping every calculate_totals after the first,
 * so a customer who changed the quantity on the cart page crossed a discount
 * threshold and kept the old price. Pricing::quote() was right the whole time.
 * The seam between correct code and WooCommerce is where the money is lost.
 *
 * NOTE: no `declare(strict_types=1)` here, unlike every other file in the
 * plugin. `wp eval-file` eval()s the contents, and a declare must be the very
 * first statement of a *script*: inside an eval it is a fatal error.
 *
 * @package Teeshoop\Core
 */

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

use Teeshoop\Core\Cart;
use Teeshoop\Core\Compat;
use Teeshoop\Core\Mail;
use Teeshoop\Core\Money;
use Teeshoop\Core\Pricing;
use Teeshoop\Core\Product;
use Teeshoop\Core\Settings;

if ( ! defined( 'TEESHOOP_ALLOW_UNVERIFIED_DESIGNS' ) ) {
	define( 'TEESHOOP_ALLOW_UNVERIFIED_DESIGNS', true );
}

/*
 * $GLOBALS explicitly, not `global $pass`.
 *
 * `wp eval-file` eval()s this file inside a method, so what looks like file
 * scope is really function scope: a plain `$pass = 0` here is a LOCAL, while
 * `global $pass` inside ts_it() binds the true global. They are two different
 * variables, and the harness happily printed nine green ticks under a
 * "0 passed" total, with `exit(1)` unreachable, so a genuine failure would
 * have exited 0 and read as success in CI.
 */
$GLOBALS['ts_pass'] = 0;
$GLOBALS['ts_fail'] = 0;

function ts_it( string $name, callable $body ): void {
	try {
		$body();
		++$GLOBALS['ts_pass'];
		echo "  \033[32m✓\033[0m {$name}\n";
	} catch ( \Throwable $e ) {
		++$GLOBALS['ts_fail'];
		echo "  \033[31m✗\033[0m {$name}\n      " . $e->getMessage() . "\n";
	}
}

function ts_assert( bool $condition, string $message ): void {
	if ( ! $condition ) {
		throw new \RuntimeException( $message );
	}
}

/**
 * Deux montants comparés EN CENTIMES, jamais en flottants.
 *
 * ── POURQUOI CETTE FONCTION EXISTE ──────────────────────────────────────────
 *
 * Les assertions d'argent de ce fichier s'écrivaient
 * `ts_eq( (float) $prix, $cents / 100 )`. Deux d'entre elles avaient oublié le
 * transtypage du côté attendu, ce qui marchait tant que le tarif portait des
 * centimes : `1450 / 100` vaut 14.5, un flottant. Le 4 septembre 2026 le tarif
 * est passé à 21,00 EUR, `2100 / 100` vaut 21, un ENTIER, et `21.0 !== 21` a
 * fait échouer deux tests sur un panier parfaitement juste.
 *
 * Le correctif n'est pas d'ajouter le transtypage manquant, c'est de ne plus
 * comparer d'argent en flottants du tout : `CLAUDE.md` section 2 l'interdit
 * partout ailleurs, et `Money::from_eur` est le lecteur que la boutique possède
 * déjà pour transformer la chaîne décimale de WooCommerce en centimes.
 */
function ts_eq_cents( string|float|int $actual_eur, int $expected_cents, string $what ): void {
	$actual = \Teeshoop\Core\Money::from_eur( (string) $actual_eur );
	if ( $actual !== $expected_cents ) {
		throw new \RuntimeException(
			"{$what}: attendu " . \Teeshoop\Core\Money::format( $expected_cents )
			. ', obtenu ' . \Teeshoop\Core\Money::format( $actual )
		);
	}
}

function ts_eq( mixed $actual, mixed $expected, string $what ): void {
	if ( $actual !== $expected ) {
		throw new \RuntimeException( "{$what}: expected " . var_export( $expected, true ) . ', got ' . var_export( $actual, true ) );
	}
}

// ---------------------------------------------------------------------------

include_once WC_ABSPATH . 'includes/wc-cart-functions.php';
include_once WC_ABSPATH . 'includes/class-wc-cart.php';
wc_load_cart();

/*
 * THE SUITE DOES NOT INHERIT THE MIRROR'S WORKER ADDRESS.
 *
 * Almost every case here builds a cart, and `Cart::add` asks the Worker whether
 * the design exists, which is right and is what stops an unprintable order being
 * paid for. These designs were never uploaded, because the suite invents them,
 * so `TEESHOOP_ALLOW_UNVERIFIED_DESIGNS` carries them: it rescues an UNREACHABLE
 * Worker, not a reachable one answering an honest 404.
 *
 * So a mirror pointed at a REAL Worker failed 74 cases here, and the same mirror
 * pointed at an unreachable one passed all 182. Measured on 19/08/2026 after
 * `tests/demo-achat.php` left a live address behind. Whether a suite passes must
 * not depend on what somebody last typed into a settings option.
 *
 * PINNED TO AN UNREACHABLE ADDRESS AND NOT TO AN EMPTY ONE, which is the second
 * half of the same lesson: clearing it broke 34 other cases, because the print
 * lots refuse to exist without a nesting service configured at all and their
 * suite stubs the CALL rather than the setting. `.invalid` is reserved by RFC
 * 2606 and can never resolve, so `Design::verify` falls to the development
 * allowance and `Nest::configured()` is still true.
 */
/*
 * THE WATERMARK, so a run cleans up after itself.
 *
 * Every sub-suite here creates orders and print lots and none of them removed
 * any, so the mirror accumulated: measured on 27/08/2026, 754 orders and 788
 * lots, 104 and 94 of them from one afternoon. Past roughly fifteen runs
 * `Production::queue()` returns more than the assertion « lets a draft be undone »
 * expects and THREE assertions in the production suite go red for a reason that
 * is not the code. Session 12 measured that, wrote it down
 * (docs/seance-12-a-reprendre.md section 4.1) and left it; session 13 hit it on
 * its sixth run of the day and is fixing it, because a gate that goes red for a
 * reason that is not the code is a gate nobody reads.
 *
 * A WATERMARK RATHER THAN A LIST PER SUITE. Asking each sub-suite to delete what
 * it creates is the tidier design and it is also the one that misses something:
 * six files, several of them creating orders through WooCommerce indirectly, and
 * `concurrency.php` creating more from CHILD PROCESSES. Ids only ever go up, so
 * "everything above where we started" is the one description that cannot have a
 * hole in it.
 */
global $wpdb;
$ts_high_order = (int) $wpdb->get_var( "SELECT COALESCE(MAX(id), 0) FROM {$wpdb->prefix}wc_orders" );
$ts_high_post  = (int) $wpdb->get_var( "SELECT COALESCE(MAX(ID), 0) FROM {$wpdb->posts}" );
/*
 * THE FIXTURE PRODUCTS, SWEPT BY NAME, AND THE NAME IS THE POINT.
 *
 * `ts_product()` publishes three products on every run and nothing removed
 * them, so six runs of this suite left twelve personalisable products on sale
 * declaring no blank. `npm run verify:lancement` counts exactly that, by name,
 * so its verdict drifted from 7 refusals to 19 in one afternoon and the figure
 * written in `docs/MISE-EN-LIGNE.md` stopped being true.
 *
 * BY NAME AND NOT BY A HIGH-WATER MARK, after two attempts at the general
 * sweep failed and were measured failing: a product created here comes back
 * with an id above `MAX(ID)` in `wp_posts` and is not in the id list
 * `wc_get_products()` returns, so both the posts query and the product query
 * found nothing to delete and reported success. These three titles are created
 * nowhere else in the repository, which makes the narrow sweep provable where
 * the general one was not.
 */
$ts_fixture_names = array( 'Integration fixture', 'Integration hoodie', 'Integration undeclared' );
$ts_fixtures_left = static function () use ( $ts_fixture_names ): array {
	$out = array();
	foreach ( $ts_fixture_names as $ts_name ) {
		foreach ( (array) get_posts( array( 'post_type' => 'product', 'post_status' => 'any', 'numberposts' => -1, 'fields' => 'ids', 'title' => $ts_name ) ) as $ts_id ) {
			$out[] = (int) $ts_id;
		}
	}
	return $out;
};

$ts_settings_before = get_option( 'teeshoop_settings', array() );
update_option( 'teeshoop_settings', array_merge( (array) $ts_settings_before, array( 'worker_url' => 'https://worker.invalid' ) ) );

/**
 * Disposable products to decorate.
 *
 * The garment is declared ON the product (Product.php) because it is a price
 * input: it decides the cost of the blank. A product that declares none is not
 * personalisable at all, which is why `$bare_id` exists.
 */
function ts_product( string $name, string $price, ?string $garment, string $weight_kg = '' ): int {
	$product = new WC_Product_Simple();
	$product->set_name( $name );
	$product->set_regular_price( $price );
	$product->set_catalog_visibility( 'hidden' );
	if ( '' !== $weight_kg ) {
		$product->set_weight( $weight_kg );
	}
	if ( null !== $garment ) {
		$product->update_meta_data( Product::META, $garment );
	}
	$product->save();
	return $product->get_id();
}

/*
 * THE WEIGHTS ARE FIXTURE NUMBERS AND NOTHING ELSE READS THEM.
 *
 * A garment's real weight comes from the supplier feed, per SKU, and the
 * shipping module refuses to quote a line that has none rather than assuming
 * one. These two exist so the carriage cases have something to weigh; they are
 * not a claim about what a t-shirt weighs and they never reach a customer.
 */
$product_id = ts_product( 'Integration fixture', '14.50', 'tee', '0.18' );
$hoodie_id  = ts_product( 'Integration hoodie', '39.00', 'hoodie', '0.5' );
$bare_id    = ts_product( 'Integration undeclared', '14.50', null );

$sides  = array( array( 'id' => 'front', 'area_sq_cm' => 400 ) );
$design = 'abcdefghijklmnop1234';
$config = Settings::pricing();

echo "\nTeeshoop ↔ WooCommerce\n";

ts_it( 'refuses a malformed design id', function () use ( $product_id, $sides ) {
	foreach ( array( '', 'short', '../../etc/passwd', str_repeat( 'a', 65 ), 'has spaces here!!' ) as $bad ) {
		$r = Cart::add(
			array(
				'product_id' => $product_id,
				'qty'        => 1,
				'garment'    => 'tee',
				'sides'      => $sides,
				'design_id'  => $bad,
			)
		);
		ts_assert( is_wp_error( $r ), 'accepted design id: ' . var_export( $bad, true ) );
	}
} );

ts_it( 'refuses a product that does not exist', function () use ( $sides, $design ) {
	$r = Cart::add(
		array(
			'product_id' => 999999,
			'qty'        => 1,
			'garment'    => 'tee',
			'sides'      => $sides,
			'design_id'  => $design,
		)
	);
	ts_assert( is_wp_error( $r ), 'a missing product was accepted' );
} );

ts_it( 'refuses a product that declares no garment', function () use ( $bare_id, $sides, $design ) {
	$r = Cart::add(
		array(
			'product_id' => $bare_id,
			'qty'        => 1,
			'garment'    => 'tee',
			'sides'      => $sides,
			'design_id'  => $design,
		)
	);
	ts_assert( is_wp_error( $r ), 'a product with no declared garment was personalised' );
	ts_eq( $r->get_error_code(), 'teeshoop_not_personalisable', 'refusal reason' );
} );

/*
 * THE MONEY HOLE THIS FILE EXISTS FOR, SECOND EDITION.
 *
 * `custom` means the customer ships their own garment, so its blank costs
 * 0,00 EUR. Until the garment was read from the product, a request could name
 * `custom` on a hoodie product and take a 27,00 EUR blank for nothing: the only
 * check was that the config knew the key. Pure tests cannot see it, because
 * Pricing::quote() answers exactly what it is asked.
 */
ts_it( 'refuses a request naming a garment the product does not sell', function () use ( $hoodie_id, $sides, $design ) {
	foreach ( array( 'custom', 'tee' ) as $claim ) {
		$r = Cart::add(
			array(
				'product_id' => $hoodie_id,
				'qty'        => 1,
				'garment'    => $claim,
				'sides'      => $sides,
				'design_id'  => $design,
			)
		);
		ts_assert( is_wp_error( $r ), "a hoodie product accepted a '{$claim}' line" );
		ts_eq( $r->get_error_code(), 'teeshoop_garment_mismatch', 'refusal reason' );
	}
} );

ts_it( 'prices from the product’s garment even when the request names none', function () use ( $hoodie_id, $sides, $design, $config ) {
	WC()->cart->empty_cart();
	$key = Cart::add(
		array(
			'product_id' => $hoodie_id,
			'qty'        => 3,
			'sides'      => $sides,
			'design_id'  => $design,
		)
	);
	ts_assert( ! is_wp_error( $key ), 'the hoodie line was refused' );

	WC()->cart->calculate_totals();
	$item = WC()->cart->get_cart_item( $key );
	ts_eq( $item['teeshoop']['garment'], 'hoodie', 'garment stored on the line' );

	$hoodie = Pricing::quote( array( 'garment' => 'hoodie', 'qty' => 3, 'sides' => $sides ), $config );
	$custom = Pricing::quote( array( 'garment' => 'custom', 'qty' => 3, 'sides' => $sides ), $config );
	// Both sides cast: PHP's `/` returns an int when the division is exact, and
	// ts_eq is strict, so 3200/100 is int(32) and the price is float(32.0).
	ts_eq_cents( $item['data']->get_price(), (int) $hoodie['unit_ht'], 'prix unitaire' );
	ts_assert( $hoodie['unit_ht'] !== $custom['unit_ht'], 'the fixture cannot tell the two apart' );
} );

ts_it( 'charges the server price, not the catalogue price', function () use ( $product_id, $sides, $design, $config ) {
	WC()->cart->empty_cart();
	$key = Cart::add(
		array(
			'product_id' => $product_id,
			'qty'        => 25,
			'garment'    => 'tee',
			'sides'      => $sides,
			'design_id'  => $design,
		)
	);
	ts_assert( ! is_wp_error( $key ), 'the line was refused' );

	WC()->cart->calculate_totals();
	$item = WC()->cart->get_cart_item( $key );
	$want = Pricing::quote( array( 'garment' => 'tee', 'qty' => 25, 'sides' => $sides ), $config );

	ts_eq_cents( $item['data']->get_price(), (int) $want['unit_ht'], 'prix unitaire' );
	ts_assert( (float) $item['data']->get_price() !== 14.50, 'the catalogue price leaked through' );
	ts_eq_cents( WC()->cart->get_subtotal(), (int) $want['total_ht'], 'sous-total' );
} );

ts_it( 'reprices at every quantity, including across discount thresholds', function () use ( $product_id, $sides, $design, $config ) {
	WC()->cart->empty_cart();
	$key = Cart::add(
		array(
			'product_id' => $product_id,
			'qty'        => 1,
			'garment'    => 'tee',
			'sides'      => $sides,
			'design_id'  => $design,
		)
	);

	// The thresholds and the units either side of each: this is the case the
	// `did_action() > 1` guard silently broke.
	foreach ( array( 1, 9, 10, 11, 24, 25, 26, 49, 50, 51, 100 ) as $qty ) {
		WC()->cart->set_quantity( $key, $qty, true );
		WC()->cart->calculate_totals();
		$item = WC()->cart->get_cart_item( $key );
		$want = Pricing::quote( array( 'garment' => 'tee', 'qty' => $qty, 'sides' => $sides ), $config );
		ts_eq_cents( $item['data']->get_price(), (int) $want['unit_ht'], "prix unitaire à {$qty}" );
	}
} );

ts_it( 'lets a size grid set the quantity, and drops junk sizes', function () use ( $product_id, $sides, $design ) {
	WC()->cart->empty_cart();
	$key = Cart::add(
		array(
			'product_id' => $product_id,
			'qty'        => 1,
			'garment'    => 'tee',
			'sides'      => $sides,
			'design_id'  => $design,
			'size_grid'  => array(
				'M'           => 10,
				'L'           => 15,
				'XL'          => 5,
				'empty'       => 0,
				'TOOLONGSIZE' => 3,
				'2XL'         => -4,
			),
		)
	);
	WC()->cart->calculate_totals();
	$item = WC()->cart->get_cart_item( $key );

	ts_eq( (int) $item['quantity'], 30, 'quantity from the grid' );
	ts_eq( $item['teeshoop']['size_grid'], array( 'M' => 10, 'L' => 15, 'XL' => 5 ), 'stored grid' );
} );

ts_it( 'keeps two different designs as two lines instead of merging them', function () use ( $product_id, $sides, $design ) {
	WC()->cart->empty_cart();
	$a = Cart::add(
		array(
			'product_id' => $product_id,
			'qty'        => 5,
			'garment'    => 'tee',
			'sides'      => $sides,
			'design_id'  => $design,
		)
	);
	$b = Cart::add(
		array(
			'product_id' => $product_id,
			'qty'        => 5,
			'garment'    => 'tee',
			'sides'      => array( array( 'id' => 'back', 'area_sq_cm' => 900 ) ),
			'design_id'  => 'zyxwvutsrqponmlk9876',
		)
	);

	ts_assert( ! is_wp_error( $a ) && ! is_wp_error( $b ), 'a line was refused' );
	ts_assert( $a !== $b, 'the two designs were merged into one line' );
	ts_eq( count( WC()->cart->get_cart() ), 2, 'cart line count' );
} );

ts_it( 'prices each line on its own inputs when several are in the cart', function () use ( $config ) {
	WC()->cart->calculate_totals();
	foreach ( WC()->cart->get_cart() as $item ) {
		$want = Pricing::quote(
			array(
				'garment' => $item['teeshoop']['garment'],
				'qty'     => (int) $item['quantity'],
				'sides'   => $item['teeshoop']['sides'],
			),
			$config
		);
		ts_eq_cents( $item['data']->get_price(), (int) $want['unit_ht'], 'ligne ' . $item['teeshoop']['design_id'] );
	}
} );

ts_it( 'refuses a size grid that sums past the shop’s cap, rather than clamping it', function () use ( $product_id, $sides, $design, $config ) {
	WC()->cart->empty_cart();
	$cap = (int) $config['max_qty'];
	$r = Cart::add(
		array(
			'product_id' => $product_id,
			'qty'        => 1,
			'garment'    => 'tee',
			'sides'      => $sides,
			'design_id'  => $design,
			'size_grid'  => array( 'M' => $cap, 'L' => 2000 ),
		)
	);
	// Clamping billed the cap and stored the whole grid: 2 000 garments made and
	// never invoiced, because the grid is the only record of which sizes to press.
	ts_assert( is_wp_error( $r ), 'an over-cap grid was accepted' );
	ts_eq( $r->get_error_code(), 'teeshoop_qty_too_high', 'refusal reason' );
	ts_eq( count( WC()->cart->get_cart() ), 0, 'cart line count' );
} );

ts_it( 'drops the size breakdown when the quantity stops matching it', function () use ( $product_id, $sides, $design ) {
	WC()->cart->empty_cart();
	$key = Cart::add(
		array(
			'product_id' => $product_id,
			'qty'        => 1,
			'garment'    => 'tee',
			'sides'      => $sides,
			'design_id'  => $design,
			'size_grid'  => array( 'M' => 10, 'L' => 15, 'XL' => 5 ),
		)
	);
	WC()->cart->calculate_totals();
	ts_eq( (int) WC()->cart->get_cart_item( $key )['quantity'], 30, 'quantity from the grid' );

	// The customer types 1 in the cart page's quantity box. Before this rule the
	// line was billed for 1 and the order still said "10 × M · 15 × L · 5 × XL",
	// so 29 garments would have been pressed and never invoiced.
	WC()->cart->set_quantity( $key, 1, true );
	WC()->cart->calculate_totals();
	$item = WC()->cart->get_cart_item( $key );
	ts_eq( (int) $item['quantity'], 1, 'quantity after the change' );
	ts_eq( $item['teeshoop']['size_grid'], array(), 'stale grid dropped' );
} );

ts_it( 'writes the workshop hand-off onto the order line', function () use ( $product_id, $sides, $design ) {
	WC()->cart->empty_cart();
	Cart::add(
		array(
			'product_id' => $product_id,
			'qty'        => 12,
			'garment'    => 'tee',
			'sides'      => $sides,
			'design_id'  => $design,
			'size_grid'  => array( 'M' => 7, 'L' => 5 ),
		)
	);
	WC()->cart->calculate_totals();

	$order_id = WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) );
	ts_assert( ! is_wp_error( $order_id ) && $order_id > 0, 'the order was not created' );

	$order = wc_get_order( $order_id );
	$lines = $order->get_items();
	ts_eq( count( $lines ), 1, 'order line count' );

	$line = array_values( $lines )[0];
	ts_eq( $line->get_meta( '_teeshoop_design_id', true ), $design, 'design id on the order' );
	ts_eq( $line->get_meta( '_teeshoop_verified', true ), 'no', 'verification flag' );

	$stored = json_decode( (string) $line->get_meta( '_teeshoop_sides', true ), true );
	ts_eq( is_array( $stored ) ? count( $stored ) : 0, 1, 'printed sides on the order' );

	// As DATA, not only as the human-readable "7 × M · 5 × L" above. renderPieces
	// grades the transfer by size, and without a machine-readable grid it presses
	// every garment at the base size: a 3XL carrying an M-sized chest print.
	ts_eq(
		json_decode( (string) $line->get_meta( '_teeshoop_size_grid', true ), true ),
		array( 'M' => 7, 'L' => 5 ),
		'size grid on the order'
	);

	// The customer-visible label, and the price the order actually froze.
	ts_assert( '' !== $line->get_meta( 'Création', true ), 'no visible design meta' );
	ts_eq_cents( $order->get_subtotal(), \Teeshoop\Core\Money::from_eur( (string) WC()->cart->get_subtotal() ), 'sous-total commande contre panier' );

	$order->delete( true );
} );

/*
 * THE ONE THAT MATTERS TO A CUSTOMER: the number on the product page, the number
 * in the basket and the number on the invoice are the same number.
 *
 * The grid is the first thing a competitor screenshots and the first thing a
 * buyer compares against their checkout total; any disagreement is a support
 * ticket per visitor. It cannot be checked with pure tests, because the two
 * places it can break are both WooCommerce's: the cart's own rounding of a unit
 * price into a line total, and the order's copy of it.
 *
 * The quantities are the ones either side of every discount break, so a
 * boundary that moved by one would fail here rather than in an invoice.
 */
ts_it( 'the grid, the cart and the order agree at every quantity around a break', function () use ( $product_id, $sides, $design, $config ) {
	$qtys = array( 1, 9, 10, 24, 25, 49, 50, 100 );
	$grid = Pricing::grid( 'tee', $qtys, array( 1 ), $config );

	foreach ( $qtys as $index => $qty ) {
		WC()->cart->empty_cart();
		$key = Cart::add(
			array(
				'product_id' => $product_id,
				'qty'        => $qty,
				'garment'    => 'tee',
				'sides'      => $sides,
				'design_id'  => $design,
			)
		);
		ts_assert( ! is_wp_error( $key ), "qty {$qty} was refused" );

		WC()->cart->calculate_totals();
		$item  = WC()->cart->get_cart_item( $key );
		$quote = Pricing::quote( array( 'garment' => 'tee', 'qty' => $qty, 'sides' => $sides ), $config );

		// The grid is priced at the standard area tier, so its cell equals this
		// quote only when the design is in that tier too. It is: 400 cm².
		$cell = $grid[0]['cells'][ $index ];
		ts_eq( $cell['qty'], $qty, 'grid column' );
		ts_eq( $cell['unit_ht'], $quote['unit_ht'], "grid cell vs quote at {$qty}" );

		/*
		 * Both sides cast, every time. PHP's `/` returns an INT when the
		 * division happens to be exact, so 47100/100 is int(471) while
		 * `get_subtotal()` is float(471.0), and `ts_eq` is strict: the first
		 * version of this case failed at exactly one of the eight quantities,
		 * for a reason that has nothing to do with money.
		 */
		ts_eq_cents( $item['data']->get_price(), (int) $quote['unit_ht'], "prix unitaire au panier à {$qty}" );
		ts_eq_cents( WC()->cart->get_subtotal(), (int) $quote['total_ht'], "sous-total panier à {$qty}" );

		// And the order WooCommerce would create from it.
		$order = WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) );
		ts_assert( ! is_wp_error( $order ), "order creation failed at {$qty}" );
		$order = wc_get_order( $order );
		ts_eq_cents( $order->get_subtotal(), (int) $quote['total_ht'], "sous-total commande à {$qty}" );
		/*
		 * The carriage is deducted, and that is not a fudge: since session 04
		 * the order legitimately carries a delivery line and its tax, and this
		 * case is about the GOODS agreeing across the grid, the basket and the
		 * order. `integration-checkout.php` asserts the other half, that the
		 * goods plus the carriage plus the tax equal what the customer pays.
		 */
		$carriage = Money::from_eur( (string) $order->get_shipping_total() )
			+ Money::from_eur( (string) $order->get_shipping_tax() );
		// In CENTS, and that is the doctrine rather than a detail: subtracting
		// two euro floats produced 17.400000000000002 here on the first run.
		ts_eq(
			Money::from_eur( (string) $order->get_total() ) - $carriage,
			(int) $quote['total_ttc'],
			"order total incl. VAT at {$qty}"
		);
		$order->delete( true );
	}
} );

/*
 * Past the threshold the site stops pricing and a human starts.
 *
 * Enforced in the cart and not only on the product page: a rule the cart does
 * not apply is a rule the page merely decorates with, and the studio's basket
 * panel would happily post a run of four hundred.
 */
ts_it( 'accepts the largest self-serve run and refuses the next one', function () use ( $product_id, $sides, $design, $config ) {
	/*
	 * THE BOUNDARY IS ASKED FOR, NOT ASSUMED, and that distinction found a real
	 * defect in the page's copy.
	 *
	 * There are two triggers, a piece count and an amount, and with the shipped
	 * placeholder prices the AMOUNT binds first: a 400 cm² tee crosses
	 * 2 000 EUR HT at about 213 pieces, well before the 250-piece rule. The
	 * first version of this case wrote 250 in by hand, failed, and in failing
	 * showed that the buy box was announcing a 250-piece limit the cart would
	 * enforce at 213. The notice now names both limits.
	 *
	 * What must hold here is that Pricing and the cart agree on where the line
	 * is, whichever of the two draws it.
	 */
	$last = 0;
	for ( $qty = 1; $qty <= (int) $config['quote_from_qty'] + 1; $qty++ ) {
		$quote = Pricing::quote( array( 'garment' => 'tee', 'qty' => $qty, 'sides' => $sides ), $config );
		if ( ! empty( $quote['needs_quote'] ) ) {
			break;
		}
		$last = $qty;
	}
	ts_assert( $last > 1, 'no self-serve quantity at all is priced' );

	WC()->cart->empty_cart();
	$ok = Cart::add(
		array(
			'product_id' => $product_id,
			'qty'        => $last,
			'garment'    => 'tee',
			'sides'      => $sides,
			'design_id'  => $design,
		)
	);
	ts_assert( ! is_wp_error( $ok ), "the largest self-serve quantity {$last} was refused" );

	WC()->cart->empty_cart();
	$refused = Cart::add(
		array(
			'product_id' => $product_id,
			'qty'        => $last + 1,
			'garment'    => 'tee',
			'sides'      => $sides,
			'design_id'  => $design,
		)
	);
	ts_assert( is_wp_error( $refused ), 'one piece past the boundary was accepted' );
	ts_eq( $refused->get_error_code(), 'teeshoop_needs_quote', 'refusal reason' );
	ts_eq( WC()->cart->get_cart_contents_count(), 0, 'the cart was touched by a refused line' );

	// And the piece-count trigger fires on its own, on a run priced low enough
	// that the amount trigger cannot be what refused it.
	$only_qty                  = $config;
	$only_qty['quote_from_ht'] = 0;
	ts_assert(
		Pricing::needs_quote( (int) $config['quote_from_qty'] + 1, 1, $only_qty ),
		'the piece-count trigger never fires on its own'
	);
	ts_assert(
		! Pricing::needs_quote( (int) $config['quote_from_qty'], 1, $only_qty ),
		'the piece-count trigger fires one piece early'
	);
} );

/*
 * EVERY OTHER WAY INTO THE CART IS SHUT.
 *
 * `Cart::add` is not the only path WooCommerce offers: the classic form, the
 * `?add-to-cart=` URL, the AJAX loop button, the Store API the block cart uses
 * and "commander à nouveau" all reach `WC_Cart::add_to_cart` without a design.
 * None of them can produce something the workshop could print, and all of them
 * would charge the catalogue price of a blank.
 */
ts_it( 'refuses a plain add-to-cart on a personalisable product', function () use ( $product_id, $bare_id ) {
	WC()->cart->empty_cart();

	$passed = apply_filters( 'woocommerce_add_to_cart_validation', true, $product_id, 1 );
	ts_assert( false === $passed, 'a personalisable product accepted a plain add-to-cart' );

	// And the reorder path, which passes an empty item payload by default.
	$reorder = apply_filters( 'woocommerce_add_to_cart_validation', true, $product_id, 1, 0, array(), array() );
	ts_assert( false === $reorder, 'commander à nouveau accepted a personalisable line with no design' );

	// A product that is NOT personalisable is untouched.
	$plain = apply_filters( 'woocommerce_add_to_cart_validation', true, $bare_id, 1 );
	ts_assert( true === $plain, 'an ordinary product was blocked' );

	// And our own path, which carries the payload, is untouched.
	$ours = apply_filters(
		'woocommerce_add_to_cart_validation',
		true,
		$product_id,
		1,
		0,
		array(),
		array( 'teeshoop' => array( 'design_id' => 'abcdefghijklmnop1234' ) )
	);
	ts_assert( true === $ours, 'the studio’s own line was blocked by the guard meant for the others' );
} );

ts_it( 'still recognises the WooCommerce it was written against', function () {
	$result = Compat::check();
	ts_assert( $result['checked'] > 0, 'the compatibility check verified nothing at all' );
	ts_assert( $result['ok'], 'WooCommerce moved: ' . implode( ' / ', $result['problems'] ) );
} );

/*
 * The second half: VAT, carriage, the minimum and the invoice.
 *
 * Required rather than inlined, and called rather than run on include, so this
 * file stays the single entry point with one pass count and one exit code, and
 * neither half becomes a thousand lines nobody reads.
 */
require_once __DIR__ . '/integration-checkout.php';
ts_checkout_suite( $product_id, $hoodie_id, $bare_id );

/*
 * The third half: what the order cost, what it must not have been sold below,
 * and what the salesperson earned. It runs AFTER the checkout suite because it
 * needs the shipping zone, the customer and the VAT regime that one sets up.
 */
require_once __DIR__ . '/integration-margin.php';
ts_margin_suite( $product_id );

// And the one thing a single process cannot check about itself.
require_once __DIR__ . '/integration-lifecycle.php';
ts_lifecycle_suite( $product_id, $bare_id );

/*
 * And the fourth: what a print run is. It runs after the lifecycle suite because
 * it needs a paid order with an approved proof, which is what that one sets up
 * the machinery for.
 */
require_once __DIR__ . '/integration-production.php';
ts_production_suite( $product_id );

/*
 * And the other half of a run: the blanks. It runs after the production suite
 * because it uses the same machinery (a paid order with an approved proof) and
 * because it imports a real catalogue reference, which it removes again.
 */
require_once __DIR__ . '/integration-purchase.php';
ts_purchase_suite( $product_id );

/*
 * And the fifth: what an erasure request actually reaches. It runs after the
 * lifecycle suite because it needs that suite's helpers (`ts_ck_fill`,
 * `ts_lc_sides`) and a shop configured to take an order, and it answers the
 * Worker itself through `pre_http_request`, so it never touches R2.
 */
require_once __DIR__ . '/integration-rgpd.php';
ts_rgpd_suite( $product_id );

/*
 * The listing shortcut, against a real variable product with real variations.
 * It owns and deletes its own two products: the suite is about what WooCommerce
 * answers for a reference with no price, and the shop's fixtures are simple
 * products with one.
 */
require_once __DIR__ . '/integration-listing.php';
ts_listing_suite();

/*
 * The launch gate's shop half, which had no test at all. Four of its five
 * conditions live in `Launch` rather than in `scripts/launch-gate.mjs`, and the
 * script's `--self-test` proves them against a fabricated shop object: that
 * shows the script reads a refusal, not that a real database produces one.
 * Placed last because it reads the state every suite above has finished leaving.
 */
require_once __DIR__ . '/integration-lancement.php';
ts_lancement_suite();

/*
 * The migration runner against a real database. Placed after the launch gate
 * because it deletes and rewrites the schema option several times and one of its
 * cases deliberately leaves the version at 0 for the length of an assertion: any
 * suite reading a table while that is true would be reading a state no deploy
 * ever produces. It puts the option back before it returns.
 */
require_once __DIR__ . '/integration-schema.php';
ts_schema_suite();

require_once __DIR__ . '/concurrency.php';
ts_concurrency_suite();

// ---------------------------------------------------------------------------

WC()->cart->empty_cart();
foreach ( array( $product_id, $hoodie_id, $bare_id ) as $id ) {
	wp_delete_post( $id, true );
}
update_option( 'teeshoop_settings', $ts_settings_before );

/*
 * And everything created above the watermark. See the comment where it is taken.
 * Orders go through `wc_get_order()->delete( true )` rather than SQL, because an
 * order under HPOS lives in four tables and the invoice, the waiver and the
 * design meta hang off it; deleting the row would leave the rest.
 */
$ts_removed = array( 'orders' => 0, 'posts' => 0, 'products' => 0, 'outbox' => 0 );
foreach ( (array) $wpdb->get_col( $wpdb->prepare( "SELECT id FROM {$wpdb->prefix}wc_orders WHERE id > %d", $ts_high_order ) ) as $ts_id ) {
	$ts_order = wc_get_order( (int) $ts_id );
	if ( $ts_order ) {
		$ts_order->delete( true );
		++$ts_removed['orders'];
	}
}

/*
 * AND THE OUTBOX ROWS THOSE ORDERS LEFT, which nothing took with them.
 *
 * `Mail` keeps its own table and deleting an order does not touch it, so every
 * confirmation, proof and dispatch notice this suite ever queued stayed behind
 * pointing at an order that no longer exists. Measured on 2 September 2026:
 * 86 084 rows, of which 85 698 were orphans, and `Mail::stuck()` answered 8 489
 * instead of a number a person could read. « sees a message nobody knows the
 * fate of » does arithmetic on that number and started failing by one, which is
 * how the pile was found.
 *
 * Orphans and not « rows this suite made »: a row whose order is gone can never
 * be acted on again, whoever wrote it.
 */
$ts_removed['outbox'] = (int) $wpdb->query(
	"DELETE o FROM " . Mail::table() . " o
	 WHERE o.order_id > 0
	   AND NOT EXISTS ( SELECT 1 FROM {$wpdb->prefix}wc_orders w WHERE w.id = o.order_id )"
);
foreach ( (array) $wpdb->get_col( $wpdb->prepare( "SELECT ID FROM {$wpdb->posts} WHERE ID > %d AND post_type IN ( 'ts_lot', 'shop_order_placehold' )", $ts_high_post ) ) as $ts_id ) {
	wp_delete_post( (int) $ts_id, true );
	++$ts_removed['posts'];
}

/*
 * AND THE PRODUCTS, WHICH THIS SWEEP DID NOT TOUCH.
 *
 * `ts_product()` publishes « Integration fixture » and « Integration hoodie » on
 * every run and nothing removed them, so six runs of this suite left twelve
 * personalisable products on sale declaring no blank. The launch gate counts
 * exactly that, by name, so its verdict drifted from 7 refusals to 19 in one
 * afternoon and the number in `docs/MISE-EN-LIGNE.md` stopped being true.
 *
 * Measured on 2 September 2026. Variations go with their parent, which is why
 * this deletes the parents and lets WooCommerce take the children.
 */
/*
 * FLUSHED FIRST, AND THIS IS THE THIRD THING THAT MADE THIS SWEEP LOOK CLEAN
 * WHILE DOING NOTHING. The mirror runs a persistent object cache, and a product
 * created earlier in THIS request is not returned by a query made later in it:
 * measured on 2 September 2026, the fixture came back with an id the sweep's own
 * query did not list, so the sweep removed the PREVIOUS run's products and
 * reported success while leaving its own behind. One run's worth of residue is
 * unbounded over a hundred runs.
 */
wp_cache_flush();

$ts_fixture_ids = array( 'tee' => $product_id, 'hoodie' => $hoodie_id, 'bare' => $bare_id );

foreach ( $ts_fixtures_left() as $ts_id ) {
	$ts_product = wc_get_product( $ts_id );
	if ( $ts_product ) {
		// `delete( true )` takes any variations with it, which `wp_delete_post`
		// would leave orphaned.
		$ts_product->delete( true );
		++$ts_removed['products'];
	}
}

/*
 * AND THE SWEEP IS ITSELF CHECKED. A cleanup nobody verifies is how the residue
 * came back the first time: it is the only line here whose failure is silent,
 * because everything it protects is in the NEXT run.
 */
ts_it(
	'leaves the mirror as it found it',
	function () use ( $ts_high_order, $ts_high_post, $ts_fixture_ids, $ts_removed ) {
		global $wpdb;
		$left_orders   = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$wpdb->prefix}wc_orders WHERE id > %d", $ts_high_order ) );
		$left_lots     = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$wpdb->posts} WHERE ID > %d AND post_type = 'ts_lot'", $ts_high_post ) );
		/*
		 * THE THREE IDS THIS RUN ACTUALLY CREATED, and not a count of what is
		 * left. « Nothing found » would be vacuous on a mirror that never had
		 * any; these three were made forty lines above and must be gone.
		 */
		$left_products = count( array_filter(
			array( $ts_fixture_ids['tee'], $ts_fixture_ids['hoodie'], $ts_fixture_ids['bare'] ),
			static fn( int $id ): bool => wc_get_product( $id ) instanceof WC_Product
		) );
		ts_eq( $left_orders, 0, "orders left behind (removed {$ts_removed['orders']})" );
		ts_eq( $left_lots, 0, "print lots left behind (removed {$ts_removed['posts']})" );
		ts_eq( $left_products, 0, "products left behind (removed {$ts_removed['products']})" );
		$left_outbox = (int) $wpdb->get_var(
			"SELECT COUNT(*) FROM " . Mail::table() . " o
			 WHERE o.order_id > 0
			   AND NOT EXISTS ( SELECT 1 FROM {$wpdb->prefix}wc_orders w WHERE w.id = o.order_id )"
		);
		ts_eq( $left_outbox, 0, "orphaned outbox rows left behind (removed {$ts_removed['outbox']})" );
		ts_assert( $ts_removed['orders'] > 0, 'the suite created no order at all, so this sweep proves nothing' );
		/*
		 * No « removed > 0 » for products, deliberately. The sweep legitimately
		 * removes nothing on a mirror the previous run left clean, and the
		 * assertion above is the one that cannot pass vacuously: it names three
		 * ids that certainly existed.
		 */
	}
);

echo "\n";

// Nothing ran at all must never read as success, same precaution as
// scripts/bundle-guard.mjs and tests/run.php.
if ( 0 === $GLOBALS['ts_pass'] + $GLOBALS['ts_fail'] ) {
	echo "\033[31m  no tests ran\033[0m\n";
	exit( 2 );
}

if ( $GLOBALS['ts_fail'] > 0 ) {
	echo "\033[31m  {$GLOBALS['ts_fail']} failed\033[0m, {$GLOBALS['ts_pass']} passed\n";
	exit( 1 );
}

echo "\033[32m  {$GLOBALS['ts_pass']} passed\033[0m\n";
