<?php
/**
 * Buying the blanks, against a real WooCommerce.
 *
 * The pure tests prove the arithmetic of a basket. They cannot prove what
 * actually goes wrong here, which is the seam again: an order bought twice, a
 * colour that resolves to the wrong article, a size the supplier does not sell
 * bought anyway, a pooled carriage that never reaches the margin report, a lost
 * answer retried into a second delivery. Every one of those is invisible from a
 * pure test, and every one of them is either money or a scrapped run.
 *
 * ── THE CATALOGUE HERE IS REAL, AND IMPORTED BY THE SHIPPED IMPORTER ────────
 *
 * The fixture below is a trimmed copy of the live payload for reference 18001
 * (Fruit of the Loom Heavy Cotton T), with the purchase prices the supplier
 * actually published on 2026-08-19: 3,37 EUR for the small sizes and 4,46 EUR
 * for the 2XL. It goes in through `Importer::one()`, so the variations these
 * cases buy from are written by the same code that writes the shop's 26 399
 * articles, with the same article numbers, the same costs and the same stock.
 *
 * ── AND THE SIZE GRID IS THE POINT ──────────────────────────────────────────
 *
 * A customer's line is « 12 M et 8 L », one product, one design. The supplier
 * sells one article per size. So a basket is where a size grid becomes article
 * numbers, and it is the only place in this system where getting a size wrong
 * is silent until a box arrives.
 *
 * NO `declare(strict_types=1)`: required from integration.php, which is eval'd.
 *
 * @package Teeshoop\Core
 */

/*
 * NOT A PUBLIC URL. `wp-content/plugins/` is served by URL, and this file is
 * reachable at one. It is `require`d by `integration.php`, which carries the
 * same guard, and it was written assuming that was enough: it is not, because
 * the path to THIS file is just as guessable and PHP executes what it is asked
 * for. Answering 200 with an empty body today is luck (nothing runs at the top
 * level yet), not a design, and the day somebody adds a line outside a function
 * the suite starts reporting to the internet.
 *
 * PHP_SAPI rather than a WP_CLI check, for the reason `integration.php` gives:
 * `php tests/run.php` runs with no WordPress at all, while the integration
 * files run under wp-cli, which is also CLI.
 *
 * Found by `npm run verify:wp-e2e`, which reads the directory from disk rather
 * than a hard-coded list, and had been failing on these three files since the
 * session that added them.
 */
if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

use Teeshoop\Core\Bat;
use Teeshoop\Core\Cart;
use Teeshoop\Core\Catalogue;
use Teeshoop\Core\Cost;
use Teeshoop\Core\Costing;
use Teeshoop\Core\Importer;
use Teeshoop\Core\Product;
use Teeshoop\Core\Production;
use Teeshoop\Core\Purchase;
use Teeshoop\Core\Settings;
use Teeshoop\Core\Shelf;

/**
 * One article of the fixture, in the shape the catalogue route hands back.
 */
function ts_ac_sku( string $sku, string $colour, string $size ): array {
	return array(
		'sku'        => $sku,
		'colourCode' => $colour,
		'sizeName'   => $size,
		'ean'        => '',
		'weightKg'   => 0.19,
		'coo'        => 'BD',
		'closeout'   => false,
	);
}

/**
 * The supplier payload for reference 18001, trimmed.
 *
 * Two colours and four sizes would be eight articles; the supplier sells seven,
 * because Black does not exist in 2XL. That asymmetry is in the real catalogue
 * (11,6 % of the cross product does not exist) and it is here on purpose: it is
 * what a basket has to refuse rather than approximate.
 */
function ts_ac_entry( array $over = array() ): array {
	$entry = array(
		'style'       => array(
			'styleNr'      => '18001',
			'brand'        => 'Fruit of the Loom',
			'supplierRef'  => '61-212-0',
			'name'         => 'Heavy Cotton T',
			'nameEn'       => 'Heavy Cotton T',
			'description'  => '·195 g/m²' . "\n" . '·100% coton',
			'categories'   => array( 'Tee-shirts' ),
			'kind'         => 'tee',
			'sleeve'       => 'short',
			'gender'       => 'hommes',
			'neckline'     => 'Crew Neck',
			'fabric'       => array( 'Coton' ),
			'certificates' => array(),
			'sizespecPdf'  => '',
			'front'        => '/media/blank/picture/180_01_000_f.jpg',
			'back'         => '',
			'hasBack'      => false,
			'colourways'   => array(
				array(
					'code'   => '000',
					'name'   => 'White',
					'swatch' => '/media/blank/picto/180_01_000.jpg',
					'photo'  => '/media/blank/picture/180_01_000_f.jpg',
					'skus'   => array(),
				),
				array(
					'code'   => '101',
					'name'   => 'Black',
					'swatch' => '/media/blank/picto/180_01_101.jpg',
					'photo'  => '/media/blank/picture/180_01_101_f.jpg',
					'skus'   => array(),
				),
			),
			'sizes'        => array( 'S', 'M', 'L', '2XL' ),
			'skus'         => array(
				ts_ac_sku( '180010003', '000', 'S' ),
				ts_ac_sku( '180010004', '000', 'M' ),
				ts_ac_sku( '180010005', '000', 'L' ),
				ts_ac_sku( '180010007', '000', '2XL' ),
				ts_ac_sku( '180011013', '101', 'S' ),
				ts_ac_sku( '180011014', '101', 'M' ),
				ts_ac_sku( '180011015', '101', 'L' ),
			),
			'exportedAt'   => '2026-08-19 08:03:55',
		),
		// The real published costs, read from the live service on 2026-08-19.
		'prices'      => array(
			'currency' => 'EUR',
			'prices'   => array(
				'180010003' => array( 'cost' => 3.37, 'list' => 2.13 ),
				'180010004' => array( 'cost' => 3.37, 'list' => 2.13 ),
				'180010005' => array( 'cost' => 3.37, 'list' => 2.13 ),
				'180010007' => array( 'cost' => 4.46, 'list' => 2.95 ),
				'180011013' => array( 'cost' => 3.37, 'list' => 2.13 ),
				'180011014' => array( 'cost' => 3.37, 'list' => 2.13 ),
				'180011015' => array( 'cost' => 3.37, 'list' => 2.13 ),
			),
		),
		'pricesError' => null,
		'stock'       => array(
			// Question 43: three numbers, only the first is treated as stock.
			'at'    => ts_ac_stock_at(),
			'stock' => array(
				'180010003' => array( 444, 0, 576 ),
				'180010004' => array( 900, 0, 0 ),
				'180010005' => array( 900, 0, 0 ),
				// Deliberately short: eight in stock against a basket that wants more.
				'180010007' => array( 8, 0, 4000 ),
				'180011013' => array( 120, 0, 0 ),
				'180011014' => array( 120, 0, 0 ),
				'180011015' => array( 120, 0, 0 ),
			),
		),
		'stockError'  => null,
	);
	return array_replace_recursive( $entry, $over );
}

/**
 * A stock timestamp inside the trust window, in the shop's own wall clock.
 *
 * `wp_date` and not `gmdate`: the supplier writes central European time and
 * `Purchase::fresh` reads it in the shop's timezone. A fixture stamped in UTC
 * would be two hours older than it looks in summer, which is exactly the bug
 * that function's docblock records.
 */
function ts_ac_stock_at(): string {
	return wp_date( 'Y-m-d H:i:s', time() - 3600 );
}

/** Answer every Worker call this suite makes. See `$GLOBALS['ts_ac_order']`. */
function ts_ac_stub(): void {
	remove_all_filters( 'pre_http_request' );
	add_filter(
		'pre_http_request',
		function ( $pre, $args, $url ) {
			$json = static fn( array $body, int $code = 200 ): array => array(
				'headers'  => array(),
				'body'     => wp_json_encode( $body ),
				'response' => array( 'code' => $code ),
				'cookies'  => array(),
				'filename' => null,
			);

			if ( str_contains( (string) $url, '/deliveries' ) ) {
				return $json(
					array(
						'at'    => '2026-08-19 08:00:00',
						'items' => array(
							// Two announcements for one article: the earlier wins.
							array( 'sku' => '180010007', 'date' => '2026-09-30', 'qty' => 300, 'freeToSell' => 300 ),
							array( 'sku' => '180010007', 'date' => '2026-09-08', 'qty' => 120, 'freeToSell' => 120 ),
						),
					)
				);
			}
			if ( str_contains( (string) $url, '/catalogue/' ) ) {
				return $json( $GLOBALS['ts_ac_entry'] ?? ts_ac_entry() );
			}
			if ( str_ends_with( (string) $url, '/state' ) ) {
				return $json(
					array(
						'mode'     => $GLOBALS['ts_ac_mode'] ?? 'test',
						'modeCode' => '1',
						'modeName' => 'test',
						'at'       => '2026-08-19 16:00:00',
					)
				);
			}
			if ( str_ends_with( (string) $url, '/order' ) ) {
				$answer = $GLOBALS['ts_ac_order'] ?? array( 'outcome' => 'accepted' );
				if ( isset( $answer['transport'] ) ) {
					return new \WP_Error( 'http_request_failed', 'cURL error 28: Operation timed out' );
				}
				$GLOBALS['ts_ac_sent'][] = json_decode( (string) ( $args['body'] ?? '{}' ), true );
				return $json(
					array_merge(
						array(
							'ok'      => 'accepted' === $answer['outcome'],
							'orderId' => 'accepted' === $answer['outcome'] ? '4412345' : '0',
							'message' => '',
							'lines'   => array(),
							'mode'    => array( 'mode' => 'test' ),
						),
						$answer
					),
					(int) ( $answer['status'] ?? 200 )
				);
			}
			if ( str_contains( (string) $url, '/api/design/' ) ) {
				return $json(
					array(
						'id'          => substr( (string) $url, strrpos( (string) $url, '/' ) + 1 ),
						'garment'     => 'tee',
						/*
						 * THE COLOUR COMES FROM THE MANIFEST, because that is where
						 * `Cart::add` reads it, and since session 08 the cart uses
						 * it to freeze which supplier colour the line is sold as.
						 * A stub that always said white froze white on every order
						 * whatever colour the case asked for.
						 */
						'color'       => (string) ( $GLOBALS['ts_ac_colour'] ?? 'white' ),
						'sides'       => $GLOBALS['ts_ac_sides'] ?? array(),
						'preview'     => '/r2/design/x/preview.png',
						'previews'    => array(),
						'print_file'  => '/r2/design/x/design.json',
						'app_version' => 'test',
					)
				);
			}
			if ( str_contains( (string) $url, '/api/nest' ) ) {
				/*
				 * The CEILING a browser-measured layout may not exceed, answered
				 * with the SHIPPED bound and not with arithmetic of its own.
				 *
				 * This computed `ceil(copies / 2) * 20,5 cm` under a comment
				 * saying « 20 x 20 cm transfers sit two to a row on a 56 cm
				 * roll ». They did, until question 04's answer of 1 September
				 * 2026 put the shop on a 33 cm sheet, where a 20 cm transfer
				 * sits ONE to a row. The stub then answered 3,08 m for thirty
				 * pieces that need 11,50, and refused a lot for being longer
				 * than a packing measured on somebody else's roll. Third copy of
				 * the geometry found in this session, and the last one.
				 *
				 * `Cost::prudent_length_cm` is the bound this plugin already
				 * proves is never SHORTER than a real packing, re-proved against
				 * the real packer by `scripts/nest-verify.mjs` on every run. It
				 * is loose, which is exactly right for a ceiling.
				 */
				$body   = json_decode( (string) ( $args['body'] ?? '{}' ), true );
				$pieces = array();
				$copies = 0;
				foreach ( (array) ( $body['pieces'] ?? array() ) as $piece ) {
					$copies  += max( 1, (int) ( $piece['qty'] ?? 1 ) );
					$pieces[] = array(
						'id'   => (string) ( $piece['id'] ?? '?' ),
						'w_cm' => (float) ( $piece['w_cm'] ?? 0 ),
						'h_cm' => (float) ( $piece['h_cm'] ?? 0 ),
						'qty'  => max( 1, (int) ( $piece['qty'] ?? 1 ) ),
					);
				}
				$bound = Cost::prudent_length_cm( $pieces, Costing::config() );
				return $json(
					array(
						'billed_m'    => 0 === $copies || ! $bound['ok'] ? 0.4 : (float) $bound['length_cm'] / 100,
						'sheets'      => 1,
						'unplaceable' => array(),
						'utilization' => 0.5,
					)
				);
			}
			return $pre;
		},
		10,
		3
	);
}

/** A paid order with an approved proof, carrying a size grid. */
function ts_ac_order( int $product_id, array $grid, string $colour, string $design ): \WC_Order {
	$sides                   = array( array( 'id' => 'front', 'area_sq_cm' => 400.0, 'pieces' => array( array( 'w_cm' => 20.0, 'h_cm' => 20.0 ) ) ) );
	$GLOBALS['ts_ac_sides']  = $sides;
	$GLOBALS['ts_ac_colour'] = $colour;
	ts_ac_stub();

	WC()->cart->empty_cart();
	$key = Cart::add(
		array(
			'product_id' => $product_id,
			'qty'        => array_sum( $grid ),
			'sides'      => $sides,
			'design_id'  => $design,
			'size_grid'  => $grid,
		)
	);
	if ( is_wp_error( $key ) ) {
		throw new \RuntimeException( 'panier refusé : ' . $key->get_error_message() );
	}
	WC()->cart->calculate_totals();

	$order = wc_get_order( WC()->checkout()->create_order( array( 'payment_method' => 'bacs' ) ) );
	$order->set_billing_email( 'atelier@example.test' );
	$order->set_billing_company( 'Client ' . $design );
	$order->save();
	$order->payment_complete( 'ts-ac-' . $order->get_id() );
	$order = wc_get_order( $order->get_id() );

	$issued = Bat::issue( $order );
	if ( empty( $issued['ok'] ) ) {
		throw new \RuntimeException( 'BAT refusé : ' . ( $issued['reason'] ?? '?' ) );
	}
	ts_lc_approve( $order, 1, (string) $issued['token'] );

	$GLOBALS['ts_ac_made'][] = $order->get_id();
	return wc_get_order( $order->get_id() );
}

/** Every article of the imported reference, by supplier article number. */
function ts_ac_variation( string $sku ): ?\WC_Product {
	$found = get_posts(
		array(
			'post_type'   => 'product_variation',
			'post_status' => 'any',
			'numberposts' => 1,
			'fields'      => 'ids',
			'meta_key'    => Catalogue::META_SUPPLY_SKU,
			'meta_value'  => $sku,
		)
	);
	if ( array() === $found ) {
		return null;
	}
	$product = wc_get_product( (int) $found[0] );
	return $product instanceof \WC_Product ? $product : null;
}

/** Remove the imported reference and every article under it. */
function ts_ac_forget_blank(): void {
	$blank = Importer::find( '18001' );
	if ( $blank <= 0 ) {
		return;
	}
	$parent = wc_get_product( $blank );
	if ( $parent instanceof \WC_Product_Variable ) {
		foreach ( $parent->get_children() as $child ) {
			wp_delete_post( (int) $child, true );
		}
	}
	wp_delete_post( $blank, true );
}

/**
 * The suite.
 *
 * @param int $product_id The studio tee: garment `tee`, purchasable, weighed.
 */
function ts_purchase_suite( int $product_id ): void {
	$saved_worker = Settings::get( 'worker_url' );
	$today        = Settings::today();
	$made         = array();
	$GLOBALS['ts_ac_made'] = array();

	add_filter( 'pre_wp_mail', '__return_true' );

	$settings                = (array) get_option( 'teeshoop_settings', array() );
	$settings['worker_url']  = 'https://worker.invalid';
	update_option( 'teeshoop_settings', $settings );
	if ( ! defined( 'TEESHOOP_CATALOGUE_TOKEN' ) ) {
		define( 'TEESHOOP_CATALOGUE_TOKEN', str_repeat( 'k', 32 ) );
	}
	// The money route needs its own secret, which the catalogue's does not open.
	if ( ! defined( 'TEESHOOP_ORDER_TOKEN' ) ) {
		define( 'TEESHOOP_ORDER_TOKEN', str_repeat( 'o', 32 ) );
	}

	ts_ac_stub();

	// ── the catalogue, imported by the shipped importer ──────────────────────

	/*
	 * CLEARED FIRST, because this suite asserts PRICES and the mirror may already
	 * carry this reference from `tests/demo-achat.php`, which imports it from the
	 * live service at the real tariff. Measured: a mirror seeded by that script
	 * then failed 74 cases here, because the articles this suite buys from had
	 * the supplier's own 4,15 EUR on them and the fixture says 3,37. A suite that
	 * only passes on a shop it happens to find empty is a suite that reports the
	 * mirror's history, not the code.
	 */
	ts_ac_forget_blank();

	$GLOBALS['ts_ac_entry'] = ts_ac_entry();
	$imported               = Importer::one( '18001' );
	ts_it( 'imports the blank the workshop will buy, through the real importer', function () use ( $imported ) {
		ts_assert( 'failed' !== ( $imported['outcome'] ?? 'failed' ), 'import refusé : ' . implode( ' / ', (array) ( $imported['problems'] ?? array() ) ) );
		ts_assert( null !== ts_ac_variation( '180010004' ), 'l’article 180010004 n’a pas été écrit' );
	} );

	ts_it( 'writes the supplier’s own stock date on every article it wrote', function () {
		$variation = ts_ac_variation( '180010004' );
		$at        = (string) $variation->get_meta( Catalogue::META_STOCK_AT, true );
		ts_assert( '' !== $at, 'aucune date de relevé n’a été enregistrée' );
		ts_assert( Purchase::fresh( $at ), 'la date enregistrée n’est pas lue comme fraîche' );
	} );

	ts_it( 'stamps the adapter an article came from, so a second source can join', function () {
		$variation = ts_ac_variation( '180010004' );
		ts_assert( '' !== (string) $variation->get_meta( Catalogue::META_SUPPLY_SOURCE, true ), 'aucun code de source' );
	} );

	// ── the blank declared on the sellable product ───────────────────────────

	update_post_meta( $product_id, Product::META_BLANK_REF, '18001' );
	update_post_meta( $product_id, Product::META_BLANK_COLOURS, wp_json_encode( array( 'white' => 'White', 'black' => 'Black' ) ) );

	$a = ts_ac_order( $product_id, array( 'M' => 12, 'L' => 8 ), 'white', 'aaaaaaaaaaaaaaaa1111' );
	$b = ts_ac_order( $product_id, array( 'M' => 6, 'S' => 4 ), 'black', 'bbbbbbbbbbbbbbbb2222' );
	$made = array( $a->get_id(), $b->get_id() );

	// Both reports exist before anything is bought, so a delta has a baseline.
	Costing::refresh( $a );
	Costing::refresh( $b );

	// ── the basket ───────────────────────────────────────────────────────────

	$basket = Purchase::basket( $made );

	ts_it( 'turns two size grids into the articles the supplier actually sells', function () use ( $basket ) {
		$by = array();
		foreach ( $basket['rows'] as $row ) {
			$by[ $row['sku'] ] = $row;
		}
		ts_assert( isset( $by['180010004'] ), 'le M blanc manque' );
		ts_assert( isset( $by['180010005'] ), 'le L blanc manque' );
		ts_assert( isset( $by['180011014'] ), 'le M noir manque' );
		ts_assert( isset( $by['180011013'] ), 'le S noir manque' );
		ts_assert( 12 === (int) $by['180010004']['qty'], 'le M blanc devrait être 12, il est ' . (int) $by['180010004']['qty'] );
		ts_assert( 8 === (int) $by['180010005']['qty'], 'le L blanc devrait être 8' );
	} );

	ts_it( 'can trace every garment back to an order line and a size', function () use ( $basket, $made ) {
		$total = 0;
		foreach ( $basket['rows'] as $row ) {
			$sum = 0;
			foreach ( $row['from'] as $one ) {
				ts_assert( in_array( (int) $one['order_id'], $made, true ), 'une pièce vient d’une commande qui n’est pas dans le panier' );
				ts_assert( (int) $one['item_id'] > 0, 'une pièce ne nomme aucune ligne de commande' );
				$sum += (int) $one['qty'];
			}
			ts_assert( $sum === (int) $row['qty'], 'l’article ' . $row['sku'] . ' répartit ' . $sum . ' pièces pour ' . $row['qty'] );
			$total += (int) $row['qty'];
		}
		ts_assert( 30 === $total, '30 vêtements commandés, ' . $total . ' au panier' );
	} );

	ts_it( 'costs them at the supplier’s own published price', function () use ( $basket ) {
		// 30 x 3,37 EUR: every size in this basket is a small size.
		ts_assert( 10110 === (int) $basket['blanks_ht'], 'attendu 101,10 EUR, obtenu ' . ( $basket['blanks_ht'] / 100 ) );
		ts_assert( $basket['complete'], 'le panier se dit incomplet : ' . wp_json_encode( $basket['unresolved'] ) );
	} );

	ts_it( 'reads the stock the supplier published, with the date it published it', function () use ( $basket ) {
		ts_assert( ! empty( $basket['stock']['trusted'] ), 'le relevé n’est pas cru alors qu’il vient d’être écrit' );
		ts_assert( array() === $basket['stock']['short'], 'une rupture est annoncée alors que tout est en stock' );
	} );

	/*
	 * ── THE FOUR WORDS A CUSTOMER READS ──────────────────────────────────────
	 *
	 * Question 48 lists exactly four mentions and no others, and until
	 * 2 September the shop had three: an article with a handful of pieces left
	 * said « Disponible » to somebody about to order fifty. `Shelf::availability`
	 * had no test at all, which is how three of the four survived unexamined
	 * through the answer that named them.
	 *
	 * Driven through a real WC_Product with real meta, because the whole point
	 * of the function is the three facts it reads off one.
	 */
	ts_it( 'says one of four things about a blank, and never a number', function () {
		$sku = get_posts(
			array(
				'post_type'   => 'product_variation',
				'numberposts' => 1,
				'fields'      => 'ids',
				'meta_key'    => Catalogue::META_SUPPLY_SKU, // phpcs:ignore WordPress.DB.SlowDBQuery
			)
		);
		ts_assert( ! empty( $sku ), 'aucune variation importée : ce test ne mesurerait rien' );
		$variation = wc_get_product( (int) $sku[0] );
		ts_assert( $variation instanceof \WC_Product, 'la variation importée est illisible' );

		/*
		 * PUT BACK WHAT THIS BORROWS. The variation is shared with the tests
		 * below, and the first version of this one left it holding 5 000 pieces
		 * with a fresh date, so « says how short the supplier is » stopped
		 * finding a shortage two tests later. The failure was in the other test,
		 * which is what makes this kind of leak expensive to find.
		 */
		$was_qty = $variation->get_stock_quantity();
		$was_at  = (string) $variation->get_meta( Catalogue::META_STOCK_AT, true );

		$blank = array( 'availability' => 'inchangé', 'class' => '' );
		$say   = static function ( $have, $at ) use ( $variation, $blank ) {
			$variation->set_stock_quantity( null === $have ? null : (int) $have );
			$variation->update_meta_data( Catalogue::META_STOCK_AT, $at );
			$variation->save();
			return Shelf::availability( $blank, wc_get_product( $variation->get_id() ) );
		};

		/*
		 * `Y-m-d H:i:s` IN THE SUPPLIER'S ZONE, which is what `Purchase::moment`
		 * parses and nothing else: an ISO string with a T and a Z comes back as
		 * null, the reading reads as illisible, and every case below would have
		 * answered « Délai à confirmer » while looking like it tested four
		 * states. An hour back, because a stamp ahead of our clock is
		 * deliberately not a fresh reading either.
		 */
		$zone = new \DateTimeZone( 'Europe/Paris' );
		$now  = ( new \DateTimeImmutable( '-1 hour', $zone ) )->format( 'Y-m-d H:i:s' );
		$old  = ( new \DateTimeImmutable( '-90 days', $zone ) )->format( 'Y-m-d H:i:s' );
		$thin = (int) Settings::pricing()['quote_from_qty'];

		ts_eq( $say( $thin, $now )['availability'], 'Disponible', 'exactement le seuil est encore disponible' );
		ts_eq( $say( $thin - 1, $now )['availability'], 'Stock limité, nous consulter', 'une pièce sous le seuil' );
		ts_eq( $say( 1, $now )['availability'], 'Stock limité, nous consulter', 'une seule pièce' );
		ts_eq( $say( 0, $now )['availability'], 'Rupture, nous consulter', 'plus rien' );
		ts_eq( $say( 5000, $old )['availability'], 'Délai à confirmer', 'un relevé trop vieux ne dit rien' );

		/*
		 * AND NEVER A FIGURE, which is the first line of his answer. Asserted on
		 * the four sentences together rather than on each, so a fifth added later
		 * is covered by the same rule.
		 */
		foreach ( array( $thin, $thin - 1, 0, 5000 ) as $have ) {
			$said = $say( $have, $now )['availability'];
			ts_assert(
				1 !== preg_match( '/\d/', $said ),
				'la mention « ' . $said . ' » publie un chiffre du stock fournisseur'
			);
		}

		$variation->set_stock_quantity( $was_qty );
		$variation->update_meta_data( Catalogue::META_STOCK_AT, $was_at );
		$variation->save();
		$back = wc_get_product( $variation->get_id() );
		ts_eq( $back->get_stock_quantity(), $was_qty, 'la variation partagée n’a pas été remise comme elle était' );
	} );

	// ── what a basket must refuse ────────────────────────────────────────────

	ts_it( 'refuses a colour nobody has mapped, instead of buying the nearest one', function () use ( $product_id ) {
		/*
		 * The mapping is removed BEFORE the sale, because the sale is what freezes
		 * which blank a line is bought as. Removing it afterwards changes nothing,
		 * deliberately: see « buys the blank that was SOLD » below.
		 */
		update_post_meta( $product_id, Product::META_BLANK_COLOURS, wp_json_encode( array( 'white' => 'White' ) ) );
		$order = ts_ac_order( $product_id, array( 'M' => 3 ), 'black', 'pppppppppppppppp1616' );
		update_post_meta( $product_id, Product::META_BLANK_COLOURS, wp_json_encode( array( 'white' => 'White', 'black' => 'Black' ) ) );

		$basket = Purchase::basket( array( $order->get_id() ) );
		ts_assert( ! $basket['complete'], 'un coloris non associé n’a pas bloqué le panier' );
		$why = '';
		foreach ( $basket['unresolved'] as $one ) {
			$why .= $one['why'];
		}
		ts_assert( str_contains( $why, 'coloris' ), 'le refus ne dit pas que c’est le coloris : ' . $why );
	} );

	ts_it( 'refuses a size the supplier does not sell in that colour', function () use ( $product_id ) {
		// Black exists in S, M and L. 2XL is white only, in the fixture and in
		// the real catalogue, where 11,6 % of colour x size does not exist.
		$order  = ts_ac_order( $product_id, array( '2XL' => 5 ), 'black', 'cccccccccccccccc3333' );
		$basket = Purchase::basket( array( $order->get_id() ) );
		ts_assert( ! $basket['complete'], 'une taille inexistante n’a pas bloqué le panier' );
		$why = '';
		foreach ( $basket['unresolved'] as $one ) {
			$why .= $one['why'];
		}
		ts_assert( str_contains( $why, '2XL' ), 'le refus ne nomme pas la taille : ' . $why );
	} );

	ts_it( 'refuses a product whose blank nobody declared', function () use ( $product_id ) {
		$saved = get_post_meta( $product_id, Product::META_BLANK_REF, true );
		delete_post_meta( $product_id, Product::META_BLANK_REF );
		$order  = ts_ac_order( $product_id, array( 'M' => 3 ), 'white', 'dddddddddddddddd4444' );
		$basket = Purchase::basket( array( $order->get_id() ) );
		ts_assert( ! $basket['complete'], 'un produit sans textile nu déclaré a produit un panier complet' );
		update_post_meta( $product_id, Product::META_BLANK_REF, $saved );
	} );

	ts_it( 'says how short the supplier is, rather than ordering anyway', function () use ( $product_id ) {
		// The fixture leaves eight 2XL white on the shelf; this asks for twenty.
		$order  = ts_ac_order( $product_id, array( '2XL' => 20 ), 'white', 'eeeeeeeeeeeeeeee5555' );
		$basket = Purchase::basket( array( $order->get_id() ) );
		ts_assert( 1 === count( $basket['stock']['short'] ), 'la rupture n’est pas signalée' );
		ts_assert( 8 === (int) $basket['stock']['short'][0]['have'], 'le stock annoncé n’est pas celui du fournisseur' );
		ts_assert( 20 === (int) $basket['stock']['short'][0]['want'], 'la quantité demandée n’est pas celle de la commande' );
		// And it is a warning, not a refusal: the supplier restocks.
		ts_assert( $basket['complete'], 'une rupture a bloqué un panier par ailleurs identifiable' );

		/*
		 * AND IT SAYS WHEN HE SAYS IT COMES BACK, which is the only forward date
		 * in this whole file: nobody has measured how long he takes to deliver
		 * (question 46), so the shop prints his announcement and computes none of
		 * its own. The EARLIER of his two announcements, because the workshop
		 * wants to know when it can press.
		 */
		ts_assert( '2026-09-08' === (string) $basket['stock']['short'][0]['back_on'], 'le réapprovisionnement annoncé est ' . (string) $basket['stock']['short'][0]['back_on'] );
		ts_assert( 120 === (int) $basket['stock']['short'][0]['back_qty'], 'la quantité annoncée ne suit pas sa date' );
	} );

	// ── from a print run to a basket ─────────────────────────────────────────

	ts_it( 'turns a print run into the blanks that run needs', function () use ( $made, $a, $b, $today ) {
		/*
		 * THE PATH THE OPERATOR ACTUALLY TAKES, and the one the rest of this file
		 * skips: the screen offers « Préparer la commande fournisseur » on a LOT,
		 * which is session 07's unit for buying film. Everything else here starts
		 * from a list of order ids, so the step that turns a run into that list
		 * was real code exercised only by a screen.
		 *
		 * The lot is built by the shipped `create_lot`, with the layout a studio
		 * would have posted. The poses are the two orders' real garment counts,
		 * 20 and 10, because that check is exact and refuses anything else.
		 *
		 * THE LENGTHS AND THE GEOMETRY ARE DERIVED, and they used to be typed:
		 * `pooled_m => 2.5`, `56.0` and a 10 cm billing step, with a comment
		 * saying the floor was « 12 000 cm2 d'encre sur une laize de 56 cm,
		 * 2,15 m ». Question 04's answer of 1 September 2026 moved the shop to a
		 * 33 x 46 cm sheet and the same ink needs 3,63 m of it, so the per-order
		 * floor refused this lot and this case failed for a reason that had
		 * nothing to do with what it tests. The floor is `minimum_length_m`, the
		 * ceiling is the same bound the HTTP stub answers the packer with, and
		 * taking both from the shipped config is what stops this going stale the
		 * next time a supplier changes.
		 */
		$ts_pu_cost   = Costing::config();
		$ts_pu_film   = (array) ( $ts_pu_cost['film'] ?? array() );
		$ts_pu_pieces = static fn( int $garments ): array => array(
			array( 'id' => 'front', 'w_cm' => 20.0, 'h_cm' => 20.0, 'qty' => $garments ),
		);
		$ts_pu_len = static function ( array $pieces ) use ( $ts_pu_cost ): float {
			$b = Cost::prudent_length_cm( $pieces, $ts_pu_cost );
			return $b['ok'] ? round( (float) $b['length_cm'] / 100, 2 ) : 0.0;
		};
		$ts_pu_pooled = $ts_pu_len(
			array(
				array( 'id' => 'front-a', 'w_cm' => 20.0, 'h_cm' => 20.0, 'qty' => 20 ),
				array( 'id' => 'front-b', 'w_cm' => 20.0, 'h_cm' => 20.0, 'qty' => 10 ),
			)
		);
		// The sheet count is derived for the same reason the lengths are.
		$ts_pu_max = (float) ( $ts_pu_film['max_length_cm'] ?? 0 );
		$layout    = array(
			'pooled_m'        => $ts_pu_pooled,
			'width_cm'        => (float) ( $ts_pu_film['width_cm'] ?? 0 ),
			'gap_cm'          => (float) ( $ts_pu_film['gap_cm'] ?? 0 ),
			'billing_step_cm' => (float) ( $ts_pu_film['billing_step_cm'] ?? 0 ),
			'sheets'          => $ts_pu_max > 0 ? max( 1, (int) ceil( $ts_pu_pooled * 100 / $ts_pu_max - 1e-9 ) ) : 1,
			'packer'          => 'trueshape',
			'interlock_cm'    => 2.0,
			'restarts'        => 12,
			'flip'            => false,
			'orders'          => array(),
		);
		foreach ( array( array( $a, 20 ), array( $b, 10 ) ) as [ $order, $garments ] ) {
			$layout['orders'][ (string) $order->get_id() ] = array(
				'solo_m'     => $ts_pu_len( $ts_pu_pieces( $garments ) ),
				'poses'      => $garments,
				'area_sq_cm' => 400.0 * $garments,
				'pieces'     => array(
					array( 'key' => 'front', 'w_cm' => 20.0, 'h_cm' => 20.0, 'qty' => $garments ),
				),
			);
		}

		$lot = Production::create_lot( $made, 'fr', $layout, $today );
		ts_assert( ! empty( $lot['ok'] ), 'le lot a été refusé : ' . ( $lot['reason'] ?? '' ) );

		$ids = array();
		foreach ( (array) $lot['lot']['members'] as $member ) {
			$ids[] = (int) $member['id'];
		}
		sort( $ids );
		$want = $made;
		sort( $want );
		ts_assert( $ids === $want, 'le lot ne nomme pas les commandes qu’on lui a données' );

		$basket = Purchase::basket( $ids );
		ts_assert( $basket['complete'], 'le panier du lot est incomplet : ' . wp_json_encode( $basket['unresolved'] ) );
		ts_assert( 30 === (int) $basket['garments'], '30 vêtements dans le lot, ' . $basket['garments'] . ' au panier' );
		// 30 x 3,37 EUR: the same figure the order-by-order basket above asserts,
		// reached through the run instead of through a list of ids.
		ts_assert( 10110 === (int) $basket['blanks_ht'], 'attendu 101,10 EUR de textile, obtenu ' . ( $basket['blanks_ht'] / 100 ) );

		// The film has been costed for these orders; the blanks have not.
		Production::discard_lot( (int) $lot['lot']['lot_id'] );
	} );

	// ── preparing, and what that pins ────────────────────────────────────────

	$prepared = Purchase::prepare( $made );
	ts_it( 'freezes a basket into a purchase nobody has sent', function () use ( $prepared ) {
		ts_assert( ! empty( $prepared['ok'] ), 'préparation refusée : ' . ( $prepared['reason'] ?? '' ) );
		ts_assert( Purchase::PREPARED === $prepared['purchase']['state'], 'un achat naît déjà envoyé' );
		ts_assert( 1 === preg_match( '/^TS-A\d+-[0-9A-F]{8}$/', (string) $prepared['purchase']['key'] ), 'la clé d’idempotence n’a pas la forme attendue : ' . $prepared['purchase']['key'] );
	} );

	$purchase_id = (int) $prepared['id'];

	ts_it( 'refuses to buy the same order’s blanks twice', function () use ( $made ) {
		$again = Purchase::prepare( $made );
		ts_assert( empty( $again['ok'] ), 'la même commande a été mise sur deux achats' );
		ts_assert( str_contains( (string) $again['reason'], 'déjà' ), 'le refus n’explique pas pourquoi : ' . $again['reason'] );
	} );

	ts_it( 'costs the blanks the product declares, which nothing could do before', function () use ( $a ) {
		/*
		 * Order A is 12 M and 8 L of white, all at 3,37 EUR: 67,40 EUR. Before
		 * the declaration on the product there was no purchase price for a studio
		 * garment at all, so the textile line came back UNKNOWN and the order had
		 * no floor price that could be stated.
		 */
		$report = Costing::refresh( wc_get_order( $a->get_id() ) );
		$textile = 0;
		$unknown = false;
		foreach ( $report['cost']['lines'] as $component ) {
			if ( 'textile' !== $component['type'] ) {
				continue;
			}
			if ( 'inconnu' === $component['confidence'] ) {
				$unknown = true;
			}
			$textile += (int) $component['amount_ht'];
		}
		ts_assert( ! $unknown, 'le textile est toujours inconnu alors que le produit déclare son textile nu' );
		ts_assert( 6740 === $textile, 'attendu 67,40 EUR de textile, obtenu ' . ( $textile / 100 ) );
	} );

	ts_it( 'changes no cost while nothing has been bought', function () use ( $a ) {
		$part = Purchase::part_of( wc_get_order( $a->get_id() ) );
		ts_assert( null !== $part, 'la commande ne porte pas sa part' );
		ts_assert( Purchase::PREPARED === $part['state'], 'la part d’une préparation se dit déjà achetée' );
		$report  = Costing::refresh( wc_get_order( $a->get_id() ) );
		$freight = 0;
		foreach ( $report['cost']['lines'] as $component ) {
			if ( 'transport_in' === $component['type'] ) {
				$freight += (int) $component['amount_ht'];
			}
		}
		ts_assert( 800 === $freight, 'une préparation a déjà fait baisser le port : ' . $freight );
	} );

	// ── sending, once ────────────────────────────────────────────────────────

	$GLOBALS['ts_ac_sent']  = array();
	$GLOBALS['ts_ac_order'] = array( 'outcome' => 'accepted' );
	$sent                   = Purchase::send( $purchase_id, 'test' );

	ts_it( 'sends the frozen document, with our key as the supplier’s reference', function () use ( $sent, $prepared ) {
		ts_assert( ! empty( $sent['ok'] ), 'envoi refusé : ' . ( $sent['reason'] ?? '' ) );
		ts_assert( 1 === count( $GLOBALS['ts_ac_sent'] ), 'le document n’est pas parti une fois et une seule' );
		$body = $GLOBALS['ts_ac_sent'][0];
		ts_assert( $body['idempotencyKey'] === $prepared['purchase']['key'], 'la clé envoyée n’est pas celle du dossier' );
		ts_assert( 'test' === $body['mode'], 'le mode confirmé n’a pas voyagé avec la commande' );
		$qty = 0;
		foreach ( $body['lines'] as $line ) {
			ts_assert( 1 === preg_match( '/^\d{9}$/', (string) $line['sku'] ), 'une ligne ne porte pas un article à neuf chiffres' );
			$qty += (int) $line['qty'];
		}
		ts_assert( 30 === $qty, '30 vêtements préparés, ' . $qty . ' envoyés' );
	} );

	ts_it( 'refuses to send it a second time', function () use ( $purchase_id ) {
		$before = count( $GLOBALS['ts_ac_sent'] );
		$again  = Purchase::send( $purchase_id, 'test' );
		ts_assert( empty( $again['ok'] ), 'un second envoi a été accepté' );
		ts_assert( count( $GLOBALS['ts_ac_sent'] ) === $before, 'un second document est parti' );
	} );

	ts_it( 'surfaces the gap between what the blanks cost and what was assumed', function () use ( $purchase_id ) {
		$purchase = Purchase::get( $purchase_id );
		foreach ( $purchase['orders'] as $row ) {
			ts_assert( null !== $row['assumed_ht'], 'la commande ' . $row['ref'] . ' n’a aucune hypothèse à comparer' );
			ts_assert( 0 === (int) $row['delta_ht'], 'un écart est annoncé alors que rien n’a bougé : ' . $row['delta_ht'] );
		}
	} );

	ts_it( 'splits one inbound carriage across the orders it bought for', function () use ( $made, $purchase_id ) {
		$purchase = Purchase::get( $purchase_id );
		$sum      = 0;
		foreach ( $purchase['orders'] as $row ) {
			$sum += (int) $row['freight_ht'];
		}
		ts_assert( $sum === (int) $purchase['freight_ht'], 'la somme des parts (' . $sum . ') n’est pas le port (' . $purchase['freight_ht'] . ')' );

		$solo = 0;
		foreach ( $purchase['orders'] as $row ) {
			$solo += (int) $row['solo_freight_ht'];
		}
		ts_assert( $solo > $sum, 'acheter ensemble n’a rien économisé : ' . $solo . ' contre ' . $sum );
	} );

	ts_it( 'makes that share the order’s real inbound carriage, and only once bought', function () use ( $a ) {
		$order  = wc_get_order( $a->get_id() );
		$report = Costing::refresh( $order );
		$freight = 0;
		foreach ( $report['cost']['lines'] as $component ) {
			if ( 'transport_in' === $component['type'] ) {
				$freight += (int) $component['amount_ht'];
			}
		}
		$part = Purchase::part_of( $order );
		ts_assert( $freight === (int) $part['freight_ht'], 'le rapport facture ' . $freight . ' alors que la part est ' . $part['freight_ht'] );
		ts_assert( $freight < 800, 'la commande paie toujours un port entier : ' . $freight );
	} );

	ts_it( 'marks a report stale when its blanks are bought, and not when they are received', function () use ( $a, $purchase_id ) {
		$order  = wc_get_order( $a->get_id() );
		$before = Costing::stamp( $order );
		Purchase::receive( $purchase_id );
		$after = Costing::stamp( wc_get_order( $a->get_id() ) );
		ts_assert( $before === $after, 'cocher « reçue » a périmé un rapport dont aucun coût n’a bougé' );
	} );

	// ── the two answers that are not a success ───────────────────────────────

	ts_it( 'records a lost answer as uncertain, and never retries it', function () use ( $product_id ) {
		$order    = ts_ac_order( $product_id, array( 'M' => 2 ), 'white', 'ffffffffffffffff6666' );
		$prepared = Purchase::prepare( array( $order->get_id() ) );
		ts_assert( ! empty( $prepared['ok'] ), 'préparation refusée : ' . ( $prepared['reason'] ?? '' ) );

		$GLOBALS['ts_ac_order'] = array( 'transport' => true );
		$done                   = Purchase::send( (int) $prepared['id'], 'test' );
		ts_assert( empty( $done['ok'] ), 'une réponse perdue a été rapportée comme un succès' );
		ts_assert( Purchase::UNCERTAIN === $done['state'], 'une réponse perdue a été classée ' . $done['state'] );
		ts_assert( str_contains( (string) $done['reason'], 'PEUT-ÊTRE' ), 'le message ne dit pas que la commande a peut-être été créée' );

		$GLOBALS['ts_ac_order'] = array( 'outcome' => 'accepted' );
		$retry                  = Purchase::send( (int) $prepared['id'], 'test' );
		ts_assert( empty( $retry['ok'] ), 'un envoi incertain a été renvoyé, donc livré deux fois' );

		// And the order stays pinned: its blanks may be on their way.
		ts_assert( null !== Purchase::part_of( wc_get_order( $order->get_id() ) ), 'la commande a été détachée d’un achat qui est peut-être parti' );
	} );

	ts_it( 'puts the orders back when the supplier refuses, because nothing exists', function () use ( $product_id ) {
		$order    = ts_ac_order( $product_id, array( 'M' => 2 ), 'white', 'gggggggggggggggg7777' );
		$prepared = Purchase::prepare( array( $order->get_id() ) );
		ts_assert( ! empty( $prepared['ok'] ), 'préparation refusée : ' . ( $prepared['reason'] ?? '' ) );

		$GLOBALS['ts_ac_order'] = array( 'outcome' => 'rejected', 'message' => 'Artno not found', 'lines' => array( array( 'sku' => '180010004', 'message' => 'Artno not found' ) ) );
		$done                   = Purchase::send( (int) $prepared['id'], 'test' );
		ts_assert( empty( $done['ok'] ), 'un refus a été rapporté comme un succès' );
		ts_assert( Purchase::REFUSED === $done['state'], 'un refus a été classé ' . $done['state'] );
		ts_assert( null === Purchase::part_of( wc_get_order( $order->get_id() ) ), 'la commande reste attachée à un achat qui n’existe pas' );

		// So it can be prepared again, which is the whole point of releasing it.
		$GLOBALS['ts_ac_order'] = array( 'outcome' => 'accepted' );
		$again                  = Purchase::prepare( array( $order->get_id() ) );
		ts_assert( ! empty( $again['ok'] ), 'la commande refusée ne peut plus être achetée : ' . ( $again['reason'] ?? '' ) );
	} );

	ts_it( 'buys the blank that was SOLD, not the one the product names today', function () use ( $product_id ) {
		/*
		 * THE SCRAP-PRINT CASE THE ADVERSARIAL PASS REPRODUCED ON THE MIRROR.
		 * A shop manager changes a discontinued reference on the product page.
		 * The basket used to read that reference live, days after the sale and
		 * often after the film was printed, so orders already sold were bought as
		 * a different garment. The colour name resolving on both styles is the
		 * ordinary case, not a contrived one: `pa_couleur` is one taxonomy shared
		 * by every imported style.
		 */
		$order  = ts_ac_order( $product_id, array( 'M' => 4 ), 'white', 'kkkkkkkkkkkkkkkk1212' );
		$before = Purchase::basket( array( $order->get_id() ) );
		ts_assert( $before['complete'], 'panier initial incomplet : ' . wp_json_encode( $before['unresolved'] ) );
		$sold = $before['rows'][0]['sku'];

		// The product now says something else entirely.
		update_post_meta( $product_id, Product::META_BLANK_REF, '99999' );
		$after = Purchase::basket( array( $order->get_id() ) );
		ts_assert( $after['complete'], 'le panier a suivi la fiche produit au lieu de la vente : ' . wp_json_encode( $after['unresolved'] ) );
		ts_assert( $after['rows'][0]['sku'] === $sold, 'l’article acheté a changé après la vente : ' . $after['rows'][0]['sku'] . ' au lieu de ' . $sold );

		update_post_meta( $product_id, Product::META_BLANK_REF, '18001' );
	} );

	ts_it( 'refuses when a colour and a size name two articles instead of one', function () use ( $product_id ) {
		/*
		 * Two articles of one style can carry the same colour NAME: the supplier
		 * publishes colour names that collide, and the attributes are the names.
		 * WooCommerce's own matcher returns the first, so the workshop bought a
		 * coin flip between two colourways. A second article is grafted onto the
		 * imported style here, which is exactly what the importer does when two
		 * of the supplier's colour names reduce to the same public suffix.
		 */
		$order = ts_ac_order( $product_id, array( 'M' => 3 ), 'white', 'llllllllllllllll1313' );

		$twin = ts_ac_variation( '180010004' );
		ts_assert( $twin instanceof \WC_Product, 'l’article de référence est introuvable' );
		$clone = new \WC_Product_Variation();
		$clone->set_parent_id( $twin->get_parent_id() );
		$clone->set_attributes( $twin->get_attributes() );
		$clone->set_status( 'publish' );
		$clone->save();
		$clone->update_meta_data( Catalogue::META_SUPPLY_SKU, '180019994' );
		$clone->save();

		$basket = Purchase::basket( array( $order->get_id() ) );
		$why    = '';
		foreach ( $basket['unresolved'] as $one ) {
			$why .= $one['why'];
		}
		ts_assert( ! $basket['complete'], 'un coloris ambigu a produit un panier complet, donc un achat à pile ou face' );
		ts_assert( str_contains( $why, 'plusieurs articles' ), 'le refus ne dit pas que le coloris est ambigu : ' . $why );

		wp_delete_post( $clone->get_id(), true );
	} );

	ts_it( 'never reports an order the supplier accepted with refused lines as fully ordered', function () use ( $product_id ) {
		$order    = ts_ac_order( $product_id, array( 'M' => 2, 'L' => 2 ), 'white', 'mmmmmmmmmmmmmmmm1414' );
		$prepared = Purchase::prepare( array( $order->get_id() ) );
		ts_assert( ! empty( $prepared['ok'] ), 'préparation refusée : ' . ( $prepared['reason'] ?? '' ) );

		// An order id AND a refused line: the run is short by exactly that line.
		$GLOBALS['ts_ac_order'] = array(
			'outcome' => 'partial',
			'orderId' => '4412346',
			'lines'   => array( array( 'sku' => '180010005', 'errorCode' => '30', 'message' => 'Artno not found' ) ),
		);
		$done = Purchase::send( (int) $prepared['id'], 'test' );
		ts_assert( empty( $done['ok'] ), 'une commande servie à moitié a été rapportée comme un succès' );
		ts_assert( Purchase::PARTIAL === $done['state'], 'état ' . $done['state'] . ' au lieu de ' . Purchase::PARTIAL );
		ts_assert( str_contains( (string) $done['reason'], 'incomplète' ), 'le message ne dit pas que la série sera incomplète' );

		// Money moved: the orders stay pinned and the carriage is still shared.
		ts_assert( null !== Purchase::part_of( wc_get_order( $order->get_id() ) ), 'une commande créée chez le fournisseur a été détachée' );
		$GLOBALS['ts_ac_order'] = array( 'outcome' => 'accepted' );
	} );

	ts_it( 'never unpins orders on an answer that names an order the supplier created', function () use ( $product_id ) {
		/*
		 * `orders_id 4412347` beside a global error code used to read as
		 * `rejected`, and a rejected purchase RELEASES its orders so they can be
		 * bought again. An order the supplier had created would have been created
		 * a second time, and the boxes arrive twice.
		 */
		$order    = ts_ac_order( $product_id, array( 'M' => 2 ), 'white', 'nnnnnnnnnnnnnnnn1515' );
		$prepared = Purchase::prepare( array( $order->get_id() ) );
		$GLOBALS['ts_ac_order'] = array( 'outcome' => 'unknown', 'orderId' => '4412347', 'message' => 'err 12' );
		$done = Purchase::send( (int) $prepared['id'], 'test' );
		ts_assert( Purchase::UNCERTAIN === $done['state'], 'état ' . $done['state'] . ' pour une réponse qui nomme une commande créée' );
		ts_assert( null !== Purchase::part_of( wc_get_order( $order->get_id() ) ), 'les commandes ont été libérées alors que le fournisseur en a peut-être créé une' );
		$GLOBALS['ts_ac_order'] = array( 'outcome' => 'accepted' );
	} );

	ts_it( 'never strands a purchase whose process died in the middle of sending', function () use ( $product_id ) {
		/*
		 * THE CASE THE ADVERSARIAL PASS REPRODUCED. `send()` writes SENDING and
		 * saves BEFORE it calls, so a process that dies holding the request
		 * leaves a trace. It left a trap: send(), discard() and receive() all
		 * refused that state, so the purchase could never move, its orders were
		 * pinned to it for ever and their blanks could never be bought, on a run
		 * whose film may already be ordered.
		 */
		$order    = ts_ac_order( $product_id, array( 'M' => 2 ), 'white', 'iiiiiiiiiiiiiiii9999' );
		$prepared = Purchase::prepare( array( $order->get_id() ) );
		ts_assert( ! empty( $prepared['ok'] ), 'préparation refusée : ' . ( $prepared['reason'] ?? '' ) );
		$id = (int) $prepared['id'];

		// The death: the request leaves and this process never comes back.
		ts_ac_stub();
		add_filter(
			'pre_http_request',
			function ( $pre, $args, $url ) {
				if ( str_ends_with( (string) $url, '/order' ) ) {
					throw new \RuntimeException( 'process tué en plein envoi' );
				}
				return $pre;
			},
			5,
			3
		);
		$died = false;
		try {
			Purchase::send( $id, 'test' );
		} catch ( \Throwable $e ) {
			$died = true;
		}
		ts_ac_stub();
		ts_assert( $died, 'le processus n’est pas mort là où le test le voulait' );

		$stuck = Purchase::get( $id );
		ts_assert( Purchase::SENDING === $stuck['state'], 'l’état juste après la mort devrait être ' . Purchase::SENDING );

		/*
		 * Age it past the deadline the way the clock would. `Supply::TIMEOUT` is
		 * forty seconds, so a request started five minutes ago is not in flight.
		 */
		$stuck['attempted_at'] = time() - 3600;
		update_post_meta( $id, Purchase::META_ORDER, wp_json_encode( $stuck ) );

		$resolved = Purchase::get( $id );
		ts_assert( Purchase::UNCERTAIN === $resolved['state'], 'un envoi mort reste bloqué à ' . $resolved['state'] );

		// And now there is exactly one way out, and it releases the orders.
		$out = Purchase::abandon( $id );
		ts_assert( ! empty( $out['ok'] ), 'impossible de déclarer l’envoi non reçu : ' . $out['reason'] );
		ts_assert( null === Purchase::part_of( wc_get_order( $order->get_id() ) ), 'la commande reste attachée à un achat déclaré inexistant' );

		$again = Purchase::prepare( array( $order->get_id() ) );
		ts_assert( ! empty( $again['ok'] ), 'la commande ne peut toujours pas être achetée : ' . ( $again['reason'] ?? '' ) );
		Purchase::discard( (int) $again['id'] );
	} );

	ts_it( 'refuses to declare a purchase unreceived when it was plainly accepted', function () use ( $product_id ) {
		// The way out is for a lost answer, not for undoing a real purchase.
		$order    = ts_ac_order( $product_id, array( 'M' => 2 ), 'white', 'jjjjjjjjjjjjjjjj0000' );
		$prepared = Purchase::prepare( array( $order->get_id() ) );
		$GLOBALS['ts_ac_order'] = array( 'outcome' => 'accepted' );
		Purchase::send( (int) $prepared['id'], 'test' );
		$out = Purchase::abandon( (int) $prepared['id'] );
		ts_assert( empty( $out['ok'] ), 'une commande acceptée a été déclarée non reçue' );
	} );

	ts_it( 'will not send against a mode nobody confirmed', function () use ( $product_id ) {
		$order    = ts_ac_order( $product_id, array( 'M' => 2 ), 'white', 'hhhhhhhhhhhhhhhh8888' );
		$prepared = Purchase::prepare( array( $order->get_id() ) );
		$before   = count( $GLOBALS['ts_ac_sent'] );
		$done     = Purchase::send( (int) $prepared['id'], '' );
		ts_assert( empty( $done['ok'] ), 'un envoi sans mode confirmé est passé' );
		ts_assert( count( $GLOBALS['ts_ac_sent'] ) === $before, 'un document est parti sans confirmation' );
		Purchase::discard( (int) $prepared['id'] );
	} );

	// ── cleaning up ──────────────────────────────────────────────────────────

	remove_all_filters( 'pre_http_request' );
	foreach ( $GLOBALS['ts_ac_made'] ?? array() as $id ) {
		$order = wc_get_order( $id );
		if ( $order instanceof \WC_Order ) {
			$order->delete( true );
		}
	}
	$GLOBALS['ts_ac_made'] = array();
	foreach ( get_posts( array( 'post_type' => Purchase::POST_TYPE, 'post_status' => 'any', 'numberposts' => 100, 'fields' => 'ids' ) ) as $id ) {
		wp_delete_post( (int) $id, true );
	}
	delete_post_meta( $product_id, Product::META_BLANK_REF );
	delete_post_meta( $product_id, Product::META_BLANK_COLOURS );

	ts_ac_forget_blank();

	$settings               = (array) get_option( 'teeshoop_settings', array() );
	$settings['worker_url'] = $saved_worker;
	update_option( 'teeshoop_settings', $settings );
}
