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
 * first statement of a *script* — inside an eval it is a fatal error.
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
 * "0 passed" total — with `exit(1)` unreachable, so a genuine failure would
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

function ts_eq( mixed $actual, mixed $expected, string $what ): void {
	if ( $actual !== $expected ) {
		throw new \RuntimeException( "{$what}: expected " . var_export( $expected, true ) . ', got ' . var_export( $actual, true ) );
	}
}

// ---------------------------------------------------------------------------

include_once WC_ABSPATH . 'includes/wc-cart-functions.php';
include_once WC_ABSPATH . 'includes/class-wc-cart.php';
wc_load_cart();

/**
 * Disposable products to decorate.
 *
 * The garment is declared ON the product (Product.php) because it is a price
 * input: it decides the cost of the blank. A product that declares none is not
 * personalisable at all, which is why `$bare_id` exists.
 */
function ts_product( string $name, string $price, ?string $garment ): int {
	$product = new WC_Product_Simple();
	$product->set_name( $name );
	$product->set_regular_price( $price );
	$product->set_catalog_visibility( 'hidden' );
	if ( null !== $garment ) {
		$product->update_meta_data( Product::META, $garment );
	}
	$product->save();
	return $product->get_id();
}

$product_id = ts_product( 'Integration fixture', '14.50', 'tee' );
$hoodie_id  = ts_product( 'Integration hoodie', '39.00', 'hoodie' );
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
	ts_eq( (float) $item['data']->get_price(), (float) $hoodie['unit_ht'] / 100, 'unit price' );
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

	ts_eq( (float) $item['data']->get_price(), $want['unit_ht'] / 100, 'unit price' );
	ts_assert( (float) $item['data']->get_price() !== 14.50, 'the catalogue price leaked through' );
	ts_eq( (float) WC()->cart->get_subtotal(), $want['total_ht'] / 100, 'subtotal' );
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

	// The thresholds and the units either side of each — this is the case the
	// `did_action() > 1` guard silently broke.
	foreach ( array( 1, 9, 10, 11, 24, 25, 26, 49, 50, 51, 100 ) as $qty ) {
		WC()->cart->set_quantity( $key, $qty, true );
		WC()->cart->calculate_totals();
		$item = WC()->cart->get_cart_item( $key );
		$want = Pricing::quote( array( 'garment' => 'tee', 'qty' => $qty, 'sides' => $sides ), $config );
		ts_eq( (float) $item['data']->get_price(), $want['unit_ht'] / 100, "unit price at qty {$qty}" );
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
		ts_eq( (float) $item['data']->get_price(), $want['unit_ht'] / 100, 'line ' . $item['teeshoop']['design_id'] );
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
	ts_eq( (float) $order->get_subtotal(), (float) WC()->cart->get_subtotal(), 'order subtotal vs cart' );

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
		ts_eq( (float) $item['data']->get_price(), (float) ( $quote['unit_ht'] / 100 ), "cart unit price at {$qty}" );
		ts_eq( (float) WC()->cart->get_subtotal(), (float) ( $quote['total_ht'] / 100 ), "cart subtotal at {$qty}" );

		// And the order WooCommerce would create from it.
		$order = WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) );
		ts_assert( ! is_wp_error( $order ), "order creation failed at {$qty}" );
		$order = wc_get_order( $order );
		ts_eq( (float) $order->get_subtotal(), (float) ( $quote['total_ht'] / 100 ), "order subtotal at {$qty}" );
		ts_eq(
			(float) $order->get_total(),
			(float) ( $quote['total_ttc'] / 100 ),
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

// ---------------------------------------------------------------------------

WC()->cart->empty_cart();
foreach ( array( $product_id, $hoodie_id, $bare_id ) as $id ) {
	wp_delete_post( $id, true );
}

echo "\n";

// Nothing ran at all must never read as success — same precaution as
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
