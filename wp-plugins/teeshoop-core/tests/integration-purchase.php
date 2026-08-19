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

use Teeshoop\Core\Bat;
use Teeshoop\Core\Cart;
use Teeshoop\Core\Catalogue;
use Teeshoop\Core\Costing;
use Teeshoop\Core\Importer;
use Teeshoop\Core\Product;
use Teeshoop\Core\Purchase;
use Teeshoop\Core\Settings;

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
						'color'       => 'white',
						'sides'       => $GLOBALS['ts_ac_sides'] ?? array(),
						'preview'     => '/r2/design/x/preview.png',
						'previews'    => array(),
						'print_file'  => '/r2/design/x/design.json',
						'app_version' => 'test',
					)
				);
			}
			if ( str_contains( (string) $url, '/api/nest' ) ) {
				return $json( array( 'billed_m' => 0.4, 'sheets' => 1, 'unplaceable' => array(), 'utilization' => 0.5 ) );
			}
			return $pre;
		},
		10,
		3
	);
}

/** A paid order with an approved proof, carrying a size grid. */
function ts_ac_order( int $product_id, array $grid, string $colour, string $design ): \WC_Order {
	$sides                  = array( array( 'id' => 'front', 'area_sq_cm' => 400.0, 'pieces' => array( array( 'w_cm' => 20.0, 'h_cm' => 20.0 ) ) ) );
	$GLOBALS['ts_ac_sides'] = $sides;
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

	/*
	 * The colour is what the customer chose in the studio, and the basket
	 * resolves it through the product's own map. The stub's manifest says
	 * `white`; a case that wants another colour writes it here, which is the
	 * same field `Cart::add` wrote.
	 */
	foreach ( $order->get_items() as $item ) {
		$item->update_meta_data( '_teeshoop_couleur', $colour );
		$item->save();
	}
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
	$made         = array();
	$GLOBALS['ts_ac_made'] = array();

	add_filter( 'pre_wp_mail', '__return_true' );

	$settings                = (array) get_option( 'teeshoop_settings', array() );
	$settings['worker_url']  = 'https://worker.invalid';
	update_option( 'teeshoop_settings', $settings );
	if ( ! defined( 'TEESHOOP_CATALOGUE_TOKEN' ) ) {
		define( 'TEESHOOP_CATALOGUE_TOKEN', str_repeat( 'k', 32 ) );
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

	// ── what a basket must refuse ────────────────────────────────────────────

	ts_it( 'refuses a colour nobody has mapped, instead of buying the nearest one', function () use ( $product_id, $made ) {
		update_post_meta( $product_id, Product::META_BLANK_COLOURS, wp_json_encode( array( 'white' => 'White' ) ) );
		$basket = Purchase::basket( $made );
		ts_assert( ! $basket['complete'], 'un coloris non associé n’a pas bloqué le panier' );
		$why = '';
		foreach ( $basket['unresolved'] as $one ) {
			$why .= $one['why'];
		}
		ts_assert( str_contains( $why, 'coloris' ), 'le refus ne dit pas que c’est le coloris : ' . $why );
		update_post_meta( $product_id, Product::META_BLANK_COLOURS, wp_json_encode( array( 'white' => 'White', 'black' => 'Black' ) ) );
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
