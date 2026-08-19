<?php
/**
 * The purchase basket's arithmetic, and the three things it must never do.
 *
 * The block to read first is « traçabilité » : it is the whole reason
 * `aggregate()` is a separate function. Ordering the wrong size or the wrong
 * colour is the most expensive mistake this system can make, because the film is
 * already printed when the blanks arrive, so every quantity in a basket has to
 * be provably the sum of order lines and never a total somebody carried across.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

/*
 * COMMAND LINE ONLY. `wp-content/plugins/` answers HTTP and this directory is
 * inside it; see the same block in run.php for what that cost before it was
 * there.
 */
if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

require_once __DIR__ . '/../includes/Money.php';
require_once __DIR__ . '/../includes/Cost.php';
require_once __DIR__ . '/../includes/Supply.php';
require_once __DIR__ . '/../includes/Purchase.php';

use Teeshoop\Core\Cost;
use Teeshoop\Core\Purchase;

/** One claim on one article, with everything `aggregate()` reads. */
function claim( string $sku, int $qty, ?int $unit, array $over ): array {
	return array_merge(
		array(
			'order_id'  => 1041,
			'order_ref' => '1041',
			'item_id'   => 7,
			'sku'       => $sku,
			'source'    => 'ws',
			'label'     => 'T-shirt',
			'colour'    => 'White',
			'size'      => 'M',
			'qty'       => $qty,
			'unit_ht'   => $unit,
			'stock'     => 400,
			'stock_at'  => '2026-05-19 16:00:00',
		),
		$over
	);
}

/** The shipped cost configuration, which is where the franco comes from. */
function purchase_config(): array {
	return Cost::default_config();
}

describe( 'Purchase::aggregate — traçabilité', function () {
	/*
	 * THE ASSERTION THIS FILE EXISTS FOR. Four order lines across three orders
	 * fold into two articles, and each article has to be able to say which line
	 * each of its pieces came from.
	 */
	$claims = array(
		claim( '180010004', 12, 337, array( 'order_id' => 1041, 'order_ref' => '1041', 'size' => 'M' ) ),
		claim( '180010004', 6, 337, array( 'order_id' => 1042, 'order_ref' => '1042', 'item_id' => 9, 'size' => 'M' ) ),
		claim( '180010005', 8, 349, array( 'order_id' => 1041, 'order_ref' => '1041', 'size' => 'L' ) ),
		claim( '180010005', 5, 349, array( 'order_id' => 1043, 'order_ref' => '1043', 'item_id' => 11, 'size' => 'L' ) ),
	);
	$basket = Purchase::aggregate( $claims, array(), purchase_config() );

	it( 'folds four order lines onto the two articles they name', function () use ( $basket ) {
		eq( count( $basket['rows'] ), 2 );
		eq( $basket['garments'], 31 );
	} );

	it( 'can say, for every piece, which order line asked for it', function () use ( $basket ) {
		foreach ( $basket['rows'] as $row ) {
			$sum = 0;
			foreach ( $row['from'] as $one ) {
				$sum += $one['qty'];
			}
			eq( $sum, $row['qty'], 'article ' . $row['sku'] );
		}
	} );

	it( 'produces the same document twice, because the rows are sorted', function () use ( $basket ) {
		eq( $basket['rows'][0]['sku'], '180010004' );
		eq( $basket['rows'][1]['sku'], '180010005' );
	} );

	it( 'costs each article once: 18 x 3,37 and 13 x 3,49', function () use ( $basket ) {
		eq( $basket['rows'][0]['amount_ht'], 6066 );
		eq( $basket['rows'][1]['amount_ht'], 4537 );
		eq( $basket['blanks_ht'], 10603 );
		eq( $basket['complete'], true );
	} );
} );

describe( 'Purchase::aggregate — le total est la somme des lignes, calculé une fois', function () {
	$basket = Purchase::aggregate(
		array(
			claim( '180010004', 12, 337, array() ),
			claim( '180010005', 8, 349, array() ),
			claim( '180010006', 3, 1538, array() ),
		),
		array(),
		purchase_config()
	);
	it( 'assère le total au lieu de le recopier', function () use ( $basket ) {
		$sum = 0;
		foreach ( $basket['rows'] as $row ) {
			$sum += $row['amount_ht'];
		}
		eq( $sum, $basket['blanks_ht'] );
		eq( $basket['total_ht'], $basket['blanks_ht'] + $basket['freight_ht'] );
	} );
} );

describe( 'Purchase::aggregate — le port suit le franco du fournisseur', function () {
	$config = purchase_config();

	it( 'facture le port sous le franco', function () use ( $config ) {
		$small = Purchase::aggregate( array( claim( '180010004', 10, 337, array() ) ), array(), $config );
		eq( $small['freight_ht'], (int) $config['freight_ht'] );
	} );

	/*
	 * Over the franco, and the arithmetic is the point rather than the figure:
	 * 60 x 3,37 = 202,20 EUR, which is over 200,00, so the carriage disappears.
	 * A basket that pooled six orders is exactly how an order that would have
	 * paid carriage on its own stops paying any.
	 */
	it( 'ne le facture plus au-dessus', function () use ( $config ) {
		$big = Purchase::aggregate( array( claim( '180010004', 60, 337, array() ) ), array(), $config );
		eq( $big['blanks_ht'], 20220 );
		eq( $big['freight_ht'], 0 );
	} );
} );

describe( 'Purchase::aggregate — un article sans prix ne compte pas pour zéro', function () {
	$basket = Purchase::aggregate(
		array(
			claim( '180010004', 12, 337, array() ),
			claim( '180010005', 8, null, array() ),
		),
		array(),
		purchase_config()
	);
	it( 'laisse la ligne inconnue hors du total sans la valoriser à zéro', function () use ( $basket ) {
		eq( $basket['blanks_ht'], 4044 );
		eq( $basket['rows'][1]['amount_ht'], null );
	} );

	it( 'refuse de se déclarer complet, donc d’être envoyé', function () use ( $basket ) {
		eq( $basket['complete'], false );
		eq( $basket['garments'], 20, 'mais les vêtements sont comptés' );
	} );
} );

describe( 'Purchase::aggregate — une ligne refusée bloque le panier et garde sa quantité', function () {
	$basket = Purchase::aggregate(
		array( claim( '180010004', 12, 337, array() ) ),
		array(
			array(
				'order_id'  => 1044,
				'order_ref' => '1044',
				'item_id'   => 3,
				'label'     => 'Sweat',
				'garment'   => 'hoodie',
				'colour'    => 'navy',
				'size'      => '',
				'qty'       => 8,
				'why'       => 'Aucun textile nu n’est déclaré sur ce produit.',
			),
		),
		purchase_config()
	);
	it( 'bloque le panier et garde la quantité en attente sous les yeux', function () use ( $basket ) {
		eq( $basket['complete'], false );
		eq( count( $basket['unresolved'] ), 1 );
		eq( $basket['refused_qty'], 8 );
		eq( $basket['garments'], 12, 'sans la mélanger avec ce qui est achetable' );
	} );
} );

describe( 'Purchase::aggregate — un panier vide n’est pas un panier', function () {
	it( 'ne se déclare ni valide ni complet', function () {
		$basket = Purchase::aggregate( array(), array(), purchase_config() );
		eq( $basket['ok'], false );
		eq( $basket['complete'], false );
		eq( $basket['blanks_ht'], 0 );
	} );
} );

describe( 'Purchase::fresh — trois réponses, pas deux', function () {
	// The trust window is the constant, so this test moves with it.
	$hours = Purchase::STOCK_TRUST_HOURS;
	$now   = '2026-05-19 12:00:00';

	/*
	 * Both ends of this test are written as wall-clock strings, never as offsets
	 * from `time()`, because `Purchase::fresh` reads a supplier's wall clock and
	 * a test that mixed the two would pass or fail by timezone.
	 */
	it( 'accepte un relevé dans la fenêtre, des deux côtés de la limite', function () use ( $hours, $now ) {
		eq( $hours, 24, 'la fenêtre est la constante, et ce test bouge avec elle' );
		truthy( Purchase::fresh( '2026-05-19 11:00:00', $now ), 'une heure' );
		truthy( Purchase::fresh( '2026-05-18 12:01:00', $now ), 'juste dedans' );
		eq( Purchase::fresh( '2026-05-18 11:59:00', $now ), false, 'juste dehors' );
	} );

	it( 'ne confond pas « pas de date » avec « à jour »', function () use ( $now ) {
		eq( Purchase::fresh( '', $now ), false );
		eq( Purchase::fresh( 'pas une date', $now ), false );
	} );

	/*
	 * A reading from the future means one of the two clocks is wrong, and « nous
	 * ne savons pas » is the only answer that is true whichever it is.
	 */
	it( 'refuse une lecture venue du futur', function () use ( $now ) {
		eq( Purchase::fresh( '2026-05-19 18:00:00', $now ), false );
	} );
} );

describe( 'Purchase::stock_verdict — ce qui manque, et ce qu’on ne sait plus', function () {
	/*
	 * `wp_date`-free and timezone-free: the verdict is asked with an explicit
	 * « now », so these two are wall-clock strings on either side of the window
	 * rather than offsets from a clock the test does not control.
	 */
	$now   = '2026-05-19 12:00:00';
	$fresh = '2026-05-19 11:00:00';
	$stale = '2026-05-17 11:00:00';

	$row = static fn( int $want, ?int $have, string $at ): array => array(
		array( 'sku' => '180010004', 'colour' => 'White', 'size' => 'M', 'qty' => $want, 'stock' => $have, 'stock_at' => $at ),
	);

	it( 'croit un relevé frais et suffisant', function () use ( $row, $fresh, $now ) {
		$ok = Purchase::stock_verdict( $row( 12, 400, $fresh ), $now );
		eq( $ok['trusted'], true );
		eq( $ok['short'], array() );
	} );

	it( 'nomme ce qui manque, avec le chiffre des deux côtés', function () use ( $row, $fresh, $now ) {
		$short = Purchase::stock_verdict( $row( 500, 400, $fresh ), $now );
		eq( count( $short['short'] ), 1 );
		eq( $short['short'][0]['have'], 400 );
		eq( $short['short'][0]['want'], 500 );
	} );

	it( 'ne transforme pas un relevé trop vieux en rupture, ni en disponibilité', function () use ( $row, $stale, $now ) {
		$old = Purchase::stock_verdict( $row( 12, 400, $stale ), $now );
		eq( $old['trusted'], false );
		eq( $old['short'], array() );
	} );

	it( 'traite l’absence de relevé comme une absence de relevé', function () use ( $row, $now ) {
		$unknown = Purchase::stock_verdict( $row( 12, null, '' ), $now );
		eq( $unknown['trusted'], false );
	} );
} );

describe( 'Cost::allocate — le port groupé se répartit sans perdre ni inventer un centime', function () {
	/*
	 * The same allocator the film uses, applied to one inbound carriage across
	 * six orders. Three equal shares of 800 rounded independently make 798 or
	 * 801; the largest-remainder rule hands the leftover cents out one at a time
	 * and preserves the total, which is what makes a supplier invoice reconcile
	 * against the sum of the orders it paid for.
	 */
	it( 'répartit un port de 8,00 EUR entre trois commandes sans perte', function () {
		$share = Cost::allocate( 800, array( '1041' => 6740, '1042' => 3370, '1043' => 1685 ) );
		eq( array_sum( $share ), 800 );
		truthy( $share['1041'] > $share['1042'], 'la plus grosse commande paie la plus grosse part' );
	} );

	it( 'garde le total sur un partage qui ne tombe pas juste', function () {
		$equal = Cost::allocate( 100, array( 'a' => 1, 'b' => 1, 'c' => 1 ) );
		eq( array_sum( $equal ), 100 );
	} );
} );
