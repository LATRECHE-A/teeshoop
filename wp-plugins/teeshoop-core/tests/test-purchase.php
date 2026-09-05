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

describe( 'Purchase::aggregate : traçabilité', function () {
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

describe( 'Purchase::aggregate : le total est la somme des lignes, calculé une fois', function () {
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

describe( 'Purchase::aggregate : le port suit le franco du fournisseur', function () {
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

describe( 'Purchase::aggregate : un article sans prix ne compte pas pour zéro', function () {
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

describe( 'Purchase::aggregate : une ligne refusée bloque le panier et garde sa quantité', function () {
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

describe( 'Purchase::aggregate : un panier vide n’est pas un panier', function () {
	it( 'ne se déclare ni valide ni complet', function () {
		$basket = Purchase::aggregate( array(), array(), purchase_config() );
		eq( $basket['ok'], false );
		eq( $basket['complete'], false );
		eq( $basket['blanks_ht'], 0 );
	} );
} );

describe( 'Purchase::fresh : trois réponses, pas deux', function () {
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

	/*
	 * Le mot compte autant que le refus. La première version n'avait que « frais »
	 * et « trop ancien », et l'écran de l'atelier a annoncé « trop ancien » sur un
	 * relevé de quatre minutes, sur une boutique dont WordPress tourne en UTC
	 * alors que le fournisseur écrit son heure murale.
	 */
	it( 'distingue les quatre réponses, parce que l’écran en dit quatre choses', function () use ( $now ) {
		eq( Purchase::freshness( '2026-05-19 11:00:00', $now ), 'fresh' );
		eq( Purchase::freshness( '2026-05-17 11:00:00', $now ), 'stale' );
		eq( Purchase::freshness( '2026-05-19 18:00:00', $now ), 'future' );
		eq( Purchase::freshness( 'pas une date', $now ), 'unknown' );
	} );

	/*
	 * ── LA PREMIÈRE HEURE DE CHAQUE NUIT ─────────────────────────────────────
	 *
	 * L'appelant réel passe une DATE (`basket()` prend `Settings::today()`), et
	 * une date nue était étendue à 23:59:59 pour que « ce relevé était-il frais le
	 * 3 septembre » se réponde sur la journée entière. Un âge, lui, se mesure
	 * contre un instant. Mesuré le 5 septembre 2026 à 00 h 06 : un relevé pris une
	 * heure plus tôt portait la date du 4, était comparé au 5 à 23 h 59, lu comme
	 * vieux de 24 h 53, et déclaré périmé. Entre minuit et une heure, la boutique
	 * annonçait « stock trop vieux pour être cru » sur un relevé d'une heure.
	 *
	 * Écrit contre l'horloge réelle et pas contre une date figée, parce que c'est
	 * l'heure du jour qui décidait, et qu'une date figée est justement ce qui
	 * cachait le défaut.
	 */
	it( 'répond pareil à un instant et à la date qui le contient', function () {
		/*
		 * L'invariant, écrit sans horloge figée : pour un relevé dans la fenêtre,
		 * « sommes-nous le 5 » et « sommes-nous le 5 à 00 h 06 » doivent donner le
		 * même verdict. Avant le plafond, la date nue était étendue à 23:59:59 et
		 * les deux divergeaient pendant vingt-trois heures sur vingt-quatre.
		 */
		$now = new \DateTimeImmutable( 'now', new \DateTimeZone( 'Europe/Paris' ) );
		foreach ( array( 1, 6, 12, 23, 26 ) as $ago ) {
			$at = $now->modify( '-' . $ago . ' hours' )->format( 'Y-m-d H:i:s' );
			eq(
				Purchase::freshness( $at, $now->format( 'Y-m-d' ) ),
				Purchase::freshness( $at, $now->format( 'Y-m-d H:i:s' ) ),
				'relevé de ' . $ago . ' h : la date et l’instant divergent'
			);
		}
		eq( Purchase::fresh( $now->modify( '-1 hour' )->format( 'Y-m-d H:i:s' ), $now->format( 'Y-m-d' ) ), true );
	} );

	it( 'garde la journée entière pour une date passée', function () {
		// Une date d'hier reste étendue à sa fin de journée : la question « ce
		// relevé était-il frais ce jour-là » ne doit pas changer de réponse.
		eq( Purchase::freshness( '2026-05-19 00:30:00', '2026-05-19' ), 'fresh', '23 h 29' );
		eq( Purchase::freshness( '2026-05-18 23:00:00', '2026-05-19' ), 'stale', '24 h 59' );
	} );

	/*
	 * L'horodatage est lu dans le fuseau du FOURNISSEUR et non dans celui du
	 * processus. Le contrôle est le même des deux côtés d'un changement de
	 * fuseau du système : c'est ce qui a cassé quand il lisait wp_timezone().
	 */
	it( 'lit l’heure du fournisseur indépendamment du fuseau du processus', function () use ( $now ) {
		$was = date_default_timezone_get();
		try {
			foreach ( array( 'UTC', 'America/Chicago', 'Asia/Tokyo' ) as $zone ) {
				date_default_timezone_set( $zone );
				eq( Purchase::freshness( '2026-05-19 11:00:00', $now ), 'fresh', 'sous ' . $zone );
				eq( Purchase::freshness( '2026-05-17 11:00:00', $now ), 'stale', 'sous ' . $zone );
			}
		} finally {
			date_default_timezone_set( $was );
		}
	} );
} );

describe( 'Purchase::stock_verdict : ce qui manque, et ce qu’on ne sait plus', function () {
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

describe( 'Cost::allocate : le port groupé se répartit sans perdre ni inventer un centime', function () {
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
