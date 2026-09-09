<?php
/**
 * Ce qui décide si un article est achetable, testé sans réseau et sans base.
 *
 * TOUT CE QUI DÉCIDE EST PUR, et ce fichier est la raison pour laquelle. Le
 * moment de vérité de cette boutique (`assert_buyable`) est un appel réseau de
 * dix secondes suivi d'une décision ; si la décision n'était testable qu'avec un
 * fournisseur au bout du fil, elle ne serait jamais testée, et c'est celle qui
 * décide si un client peut payer pour un vêtement qui n'existe pas.
 *
 * LES QUATRE FAITS QUE CE FICHIER GARDE :
 *
 *   un prix passe en centimes par `round()` et jamais par une troncature ;
 *   « introuvable » ne vaut que pour les codes que le service a nommés ;
 *   une page de connexion HTML n'est pas un catalogue vide ;
 *   un lot ne dépasse jamais 150 codes, même quand on le lui demande.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

/*
 * LIGNE DE COMMANDE UNIQUEMENT. `wp-content/plugins/` répond en HTTP et ce
 * dossier est dedans ; voir le même bloc dans run.php pour ce que cela a coûté.
 */
if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

require_once __DIR__ . '/../includes/Disponibilite.php';

use Teeshoop\Core\Disponibilite;
use Teeshoop\Core\SupplyHttp;

/** Une réponse du service, forme `?products=CSV` : un objet indexé par code. */
function ts_dispo_body( array $rows, ?string $not_found = null ): array {
	$body = array( 'products' => $rows );
	if ( null !== $not_found ) {
		$body['products_not_found'] = $not_found;
	}
	return $body;
}

/** Une ligne telle que le service l'écrit : tout en chaînes. */
function ts_dispo_row( string $price, string $stock, string $maker = '0', string $box = '10' ): array {
	return array(
		'quantity_unit'  => '1',
		'quantity_box'   => $box,
		'price'          => $price,
		'price_box'      => $price,
		'stock'          => $stock,
		'stock_supplier' => $maker,
	);
}

describe( 'Disponibilite : un prix devient des centimes, exactement', function (): void {

	it(
		'lit 4,55 EUR comme 455 centimes et pas 454',
		function (): void {
			eq( Disponibilite::parse_price_cents( '4.55' ), 455 );
			truthy( 454 !== Disponibilite::parse_price_cents( '4.55' ) );
		}
	);

	it(
		'garde le centime que la troncature perd, sur les montants où elle le perd',
		function (): void {
			/*
			 * MESURE, PARCE QUE L'EXEMPLE DONNÉ NE PROUVAIT RIEN. Sur PHP 8.5,
			 * `4.55 * 100` tombe exactement sur 455,0 en double précision, donc
			 * `(int)` et `round()` rendent tous les deux 455 : le cas 4,55
			 * ci-dessus ne distingue PAS les deux écritures. Balayage des 2 000
			 * premiers montants à deux décimales, fait le 9 septembre 2026 :
			 * 137 d'entre eux (6,85 %) perdent un centime par troncature. Les
			 * trois ci-dessous en font partie, et ce sont eux qui prouvent que
			 * le `round()` de `parse_price_cents` porte quelque chose.
			 */
			foreach ( array( '0.29' => 29, '1.15' => 115, '2.01' => 201 ) as $eur => $cents ) {
				eq( Disponibilite::parse_price_cents( (string) $eur ), $cents, "prix {$eur}" );
				truthy(
					(int) ( ( (float) $eur ) * 100 ) !== $cents,
					"le montant {$eur} devait être un de ceux que la troncature abîme, sinon ce test ne prouve rien"
				);
			}
		}
	);

	it(
		'ne prend pas « 0 » pour un prix',
		function (): void {
			eq( Disponibilite::parse_price_cents( '0' ), null );
			eq( Disponibilite::parse_price_cents( '0.00' ), null );
			eq( Disponibilite::parse_price_cents( 0 ), null );
		}
	);

	it(
		'ne prend ni le vide, ni du texte, ni un négatif pour un prix',
		function (): void {
			eq( Disponibilite::parse_price_cents( '' ), null );
			eq( Disponibilite::parse_price_cents( '   ' ), null );
			eq( Disponibilite::parse_price_cents( 'sur demande' ), null );
			eq( Disponibilite::parse_price_cents( '-3.20' ), null );
			eq( Disponibilite::parse_price_cents( null ), null );
			eq( Disponibilite::parse_price_cents( array( '3.20' ) ), null );
		}
	);

	it(
		'refuse un montant que la colonne ne peut pas contenir plutôt que de le tronquer',
		function (): void {
			// INT UNSIGNED s'arrête à 4 294 967 295 centimes.
			eq( Disponibilite::parse_price_cents( '42949672.95' ), 4294967295 );
			eq( Disponibilite::parse_price_cents( '99999999.00' ), null );
		}
	);

	it(
		'accepte le nombre autant que la chaîne, parce que JSON rend les deux',
		function (): void {
			eq( Disponibilite::parse_price_cents( 3.45 ), 345 );
			eq( Disponibilite::parse_price_cents( 12 ), 1200 );
		}
	);
} );

describe( 'Disponibilite : une quantité, et le vide qui n’est pas zéro', function (): void {

	it(
		'distingue « il n’en reste pas » de « on n’a pas su lire »',
		function (): void {
			eq( Disponibilite::parse_count( '0' ), 0 );
			eq( Disponibilite::parse_count( '' ), null );
			eq( Disponibilite::parse_count( 'n/c' ), null );
			eq( Disponibilite::parse_count( null ), null );
		}
	);

	it(
		'ramène un stock négatif à zéro et arrondit un fractionnaire vers le bas',
		function (): void {
			eq( Disponibilite::parse_count( '-4' ), 0 );
			eq( Disponibilite::parse_count( '7.9' ), 7 );
			eq( Disponibilite::parse_count( '11706' ), 11706 );
		}
	);
} );

describe( 'Disponibilite : lire une réponse du service', function (): void {

	it(
		'lit la forme indexée par code',
		function (): void {
			$body = ts_dispo_body(
				array(
					'BC01BSML' => ts_dispo_row( '3.45', '42', '11706' ),
					'BC01BSMM' => ts_dispo_row( '3.45', '0' ),
				)
			);
			$read = Disponibilite::parse_rows( $body, array( 'BC01BSML', 'BC01BSMM' ) );

			truthy( $read['ok'] );
			eq( $read['rows']['BC01BSML']['cents'], 345 );
			eq( $read['rows']['BC01BSML']['stock'], 42 );
			eq( $read['rows']['BC01BSML']['stock_supplier'], 11706 );
			eq( $read['rows']['BC01BSML']['box_qty'], 10 );
			eq( $read['rows']['BC01BSMM']['stock'], 0 );
			eq( $read['unanswered'], array() );
			eq( $read['missing'], array() );
		}
	);

	it(
		'lit la forme en liste, où le code est un champ',
		function (): void {
			// C'est ce que rend `/price-stock/{reference}`, et le lecteur est le
			// même : deux lecteurs seraient deux occasions de diverger.
			$body = ts_dispo_body(
				array(
					array( 'code' => 'BC01BSML' ) + ts_dispo_row( '3.45', '42' ),
					array( 'code' => 'BC01BSMM' ) + ts_dispo_row( '3.60', '7' ),
				)
			);
			$read = Disponibilite::parse_rows( $body, array() );

			truthy( $read['ok'] );
			eq( count( $read['rows'] ), 2 );
			eq( $read['rows']['BC01BSMM']['cents'], 360 );
		}
	);

	it(
		'garde la ligne d’un article sans prix, avec son stock et sans prix',
		function (): void {
			// Sans prix mais en stock, l'article existe : c'est « invendable »
			// et pas « inconnu », et les deux ne mènent pas au même écran.
			$read = Disponibilite::parse_rows(
				ts_dispo_body( array( 'BC01BSML' => ts_dispo_row( '0', '42' ) ) ),
				array( 'BC01BSML' )
			);
			truthy( $read['ok'] );
			eq( $read['rows']['BC01BSML']['cents'], null );
			eq( $read['rows']['BC01BSML']['stock'], 42 );
		}
	);

	it(
		'marque introuvables exactement les codes que le service nomme',
		function (): void {
			$body = ts_dispo_body(
				array( 'BC01BSML' => ts_dispo_row( '3.45', '42' ) ),
				'Les references produit suivantes sont introuvables : BC01BSMM, BC01BSMX'
			);
			$read = Disponibilite::parse_rows( $body, array( 'BC01BSML', 'BC01BSMM', 'BC01BSMX' ) );

			truthy( $read['ok'] );
			eq( $read['missing'], array( 'BC01BSMM', 'BC01BSMX' ) );
			eq( array_keys( $read['rows'] ), array( 'BC01BSML' ) );
			eq( $read['unanswered'], array() );
		}
	);

	it(
		'ne marque JAMAIS un code qu’on n’a pas demandé',
		function (): void {
			$body = ts_dispo_body(
				array( 'BC01BSML' => ts_dispo_row( '3.45', '42' ) ),
				'Les references produit suivantes sont introuvables : GI64000BLKS'
			);
			$read = Disponibilite::parse_rows( $body, array( 'BC01BSML' ) );
			eq( $read['missing'], array(), 'un code absent de la demande ne peut pas être retiré du catalogue' );
		}
	);

	it(
		'ne prend pas « BC01B » dans la phrase pour « BC01BSML » dans le panier',
		function (): void {
			/*
			 * LE PIÈGE DE LA SOUS-CHAÎNE. La référence du grossiste est le
			 * PRÉFIXE de chacun de ses numéros d'article, donc un
			 * `str_contains` sur la phrase retirerait du catalogue les 228
			 * déclinaisons d'une référence dont une seule manque.
			 */
			$body = ts_dispo_body(
				array( 'BC01BSML' => ts_dispo_row( '3.45', '42' ) ),
				'Les references produit suivantes sont introuvables : BC01B'
			);
			$read = Disponibilite::parse_rows( $body, array( 'BC01BSML' ) );
			eq( $read['missing'], array() );
			eq( $read['rows']['BC01BSML']['stock'], 42 );
		}
	);

	it(
		'laisse tranquille un code qui n’est ni dans les lignes ni dans les absents',
		function (): void {
			$body = ts_dispo_body( array( 'BC01BSML' => ts_dispo_row( '3.45', '42' ) ) );
			$read = Disponibilite::parse_rows( $body, array( 'BC01BSML', 'BC01BSMM' ) );

			truthy( $read['ok'] );
			eq( $read['unanswered'], array( 'BC01BSMM' ), 'on n’a rien appris sur ce code, donc on n’écrit rien' );
			eq( $read['missing'], array(), 'et surtout on ne le déclare pas introuvable' );
		}
	);

	it(
		'refuse une page HTML au lieu de la lire comme un catalogue vide',
		function (): void {
			/*
			 * Un jeton faux rend 302 vers une page de connexion, jamais 401.
			 * `SupplyHttp::read()` ferme cette porte sur le type de contenu ;
			 * ici on ferme la seconde, celle d'un corps qui a décodé en tableau
			 * mais ne porte aucune liste d'articles.
			 */
			$read = Disponibilite::parse_rows( array( 'html' => '<!doctype html><title>Connexion</title>' ), array( 'BC01BSML' ) );

			truthy( ! $read['ok'], 'un corps sans liste d’articles doit être un refus' );
			eq( $read['rows'], array() );
			eq( $read['missing'], array(), 'et il ne doit surtout marquer personne introuvable' );
			eq( $read['unanswered'], array( 'BC01BSML' ) );
			truthy( '' !== $read['error'], 'le refus doit dire pourquoi' );
		}
	);

	it(
		'refuse une page HTML MÊME quand aucun code n’était attendu',
		function (): void {
			/*
			 * CE CAS-LÀ NE TIENT QU'À UNE SEULE GARDE, ET C'EST POUR ÇA QU'IL
			 * EST ÉCRIT. Le refus précédent est tenu par deux gardes
			 * indépendantes (« pas de liste d'articles » et « aucun des codes
			 * demandés »), donc en retirer une le laissait vert : mesuré en
			 * cassant la première exprès. Ici `asked` est vide, ce qui est le
			 * chemin de `for_reference()`, et la seconde garde ne peut rien.
			 * Sans la première, une page de connexion deviendrait « cette
			 * référence n'a aucune déclinaison ».
			 */
			$read = Disponibilite::parse_rows( array( 'html' => '<!doctype html><title>Connexion</title>' ), array() );
			truthy( ! $read['ok'], 'un corps sans liste d’articles est un refus, même sans code attendu' );
			eq( $read['rows'], array() );
		}
	);

	it(
		'refuse aussi une réponse JSON qui ne parle d’aucun des codes demandés',
		function (): void {
			$read = Disponibilite::parse_rows( ts_dispo_body( array() ), array( 'BC01BSML', 'BC01BSMM' ) );

			truthy( ! $read['ok'] );
			eq( $read['rows'], array() );
			eq( $read['missing'], array() );
			truthy( str_contains( $read['error'], '2' ), 'le refus doit dire combien d’articles restent sans réponse' );
		}
	);

	it(
		'accepte une réponse où TOUS les codes demandés sont introuvables',
		function (): void {
			// Zéro ligne, mais le service a répondu quelque chose sur chacun :
			// c'est une réponse, pas un silence, et elle doit pouvoir s'écrire.
			$body = ts_dispo_body(
				array(),
				'Les references produit suivantes sont introuvables : BC01BSML, BC01BSMM'
			);
			$read = Disponibilite::parse_rows( $body, array( 'BC01BSML', 'BC01BSMM' ) );

			truthy( $read['ok'] );
			eq( $read['missing'], array( 'BC01BSML', 'BC01BSMM' ) );
			eq( $read['unanswered'], array() );
		}
	);

	it(
		'retrouve la ligne quand le service change la casse du code',
		function (): void {
			$read = Disponibilite::parse_rows(
				ts_dispo_body( array( 'BC01BSML' => ts_dispo_row( '3.45', '42' ) ) ),
				array( 'bc01bsml' )
			);
			truthy( $read['ok'] );
			eq( array_keys( $read['rows'] ), array( 'bc01bsml' ), 'la clé rendue est la graphie de l’appelant' );
			eq( $read['unanswered'], array() );
		}
	);
} );

describe( 'Disponibilite : le verdict, qui est le moment de vérité', function (): void {

	$row = static fn( ?int $cents, ?int $stock, int $maker = 0 ): array => array(
		'cents'          => $cents,
		'stock'          => $stock,
		'stock_supplier' => $maker,
		'box_qty'        => 10,
	);

	it(
		'laisse passer ce qui est en stock et a un prix',
		function () use ( $row ): void {
			$v = Disponibilite::verdict(
				array( 'BC01BSML' => 10 ),
				array( 'BC01BSML' => $row( 345, 42 ) ),
				array(),
				array()
			);
			truthy( $v['ok'] );
			eq( $v['reason'], '' );
			truthy( $v['lines']['BC01BSML']['ok'] );
			eq( $v['lines']['BC01BSML']['cents'], 345 );
		}
	);

	it(
		'refuse un stock court et dit combien il en reste',
		function () use ( $row ): void {
			$v = Disponibilite::verdict(
				array( 'BC01BSML' => 10 ),
				array( 'BC01BSML' => $row( 345, 3 ) ),
				array(),
				array()
			);
			truthy( ! $v['ok'] );
			eq( $v['reason'], 'short_stock' );
			eq( $v['lines']['BC01BSML']['why'], 'short_stock' );
			eq( $v['lines']['BC01BSML']['stock'], 3 );

			$message = $v['message'];
			truthy( str_contains( $message, 'Il reste 3 exemplaires' ), "le reste doit être dans la phrase, vue : {$message}" );
			truthy( str_contains( $message, 'BC01BSML' ), 'la phrase doit nommer l’article' );
			truthy( str_contains( $message, 'Ramenez la quantité à 3' ), 'la phrase doit dire quoi faire' );
			truthy( ! str_contains( $message, '!' ), 'pas de point d’exclamation dans une phrase client' );
		}
	);

	it(
		'accorde « exemplaire » au singulier quand il n’en reste qu’un',
		function () use ( $row ): void {
			$v = Disponibilite::verdict( array( 'BC01BSML' => 4 ), array( 'BC01BSML' => $row( 345, 1 ) ), array(), array() );
			truthy( str_contains( $v['message'], 'Il reste 1 exemplaire de' ), $v['message'] );
		}
	);

	it(
		'dit la rupture sans inventer de date, et signale le fabricant sans en faire une disponibilité',
		function () use ( $row ): void {
			$v = Disponibilite::verdict( array( 'BC01BSML' => 2 ), array( 'BC01BSML' => $row( 345, 0, 11706 ) ), array(), array() );

			truthy( ! $v['ok'] );
			eq( $v['reason'], 'short_stock' );
			truthy( str_contains( $v['message'], 'n’est plus en stock' ), $v['message'] );
			truthy( str_contains( $v['message'], 'réassort est donc possible' ), 'le stock du fabricant est un signal, et il est dit comme tel' );
			truthy(
				! str_contains( $v['message'], '11' ),
				'le stock du fabricant ne doit jamais être annoncé comme une quantité disponible'
			);
		}
	);

	it(
		'ne parle pas de réassort quand le fabricant n’a rien non plus',
		function () use ( $row ): void {
			$v = Disponibilite::verdict( array( 'BC01BSML' => 2 ), array( 'BC01BSML' => $row( 345, 0, 0 ) ), array(), array() );
			truthy( ! str_contains( $v['message'], 'réassort' ), $v['message'] );
		}
	);

	it(
		'refuse un article que le service déclare introuvable',
		function (): void {
			$v = Disponibilite::verdict( array( 'BC01BSMX' => 1 ), array(), array( 'BC01BSMX' ), array() );
			truthy( ! $v['ok'] );
			eq( $v['reason'], 'unknown_article' );
			truthy( str_contains( $v['message'], 'n’est plus référencé' ), $v['message'] );
		}
	);

	it(
		'refuse un lot injoignable, et ne le confond pas avec un article inconnu',
		function (): void {
			$v = Disponibilite::verdict( array( 'BC01BSML' => 1 ), array(), array(), array( 'BC01BSML' ) );
			truthy( ! $v['ok'] );
			eq( $v['reason'], 'unreachable' );
			truthy( str_contains( $v['message'], 'n’a pas pu être vérifiée' ), $v['message'] );
			truthy( ! str_contains( $v['message'], 'référencé' ), '« injoignable » ne doit pas se lire comme « supprimé »' );
		}
	);

	it(
		'refuse un article dont le service n’a pas parlé',
		function (): void {
			$v = Disponibilite::verdict( array( 'BC01BSML' => 1 ), array(), array(), array() );
			truthy( ! $v['ok'] );
			eq( $v['reason'], 'no_answer' );
		}
	);

	it(
		'refuse un article sans prix : on ne vend pas ce qu’on ne sait pas coûter',
		function () use ( $row ): void {
			$v = Disponibilite::verdict( array( 'BC01BSML' => 1 ), array( 'BC01BSML' => $row( null, 500 ) ), array(), array() );
			truthy( ! $v['ok'] );
			eq( $v['reason'], 'unpriced' );
			truthy( str_contains( $v['message'], 'pas de tarif' ), $v['message'] );
		}
	);

	it(
		'refuse un article dont le stock est illisible, sans le lire comme zéro',
		function () use ( $row ): void {
			$v = Disponibilite::verdict( array( 'BC01BSML' => 1 ), array( 'BC01BSML' => $row( 345, null ) ), array(), array() );
			truthy( ! $v['ok'] );
			eq( $v['lines']['BC01BSML']['why'], 'no_answer' );
			truthy( ! str_contains( $v['message'], 'plus en stock' ), 'un stock illisible n’est pas une rupture' );
		}
	);

	it(
		'annonce le motif le moins réparable quand plusieurs lignes échouent',
		function () use ( $row ): void {
			// L'ordre du panier ne doit rien changer : le stock court est ce que
			// le client peut corriger, l'injoignable ne l'est pas.
			$rows = array( 'A' => $row( 345, 1 ) );
			$un   = array( 'B' );

			$one = Disponibilite::verdict( array( 'A' => 5, 'B' => 1 ), $rows, array(), $un );
			$two = Disponibilite::verdict( array( 'B' => 1, 'A' => 5 ), $rows, array(), $un );

			eq( $one['reason'], 'unreachable' );
			eq( $two['reason'], 'unreachable', 'le motif ne doit pas dépendre de l’ordre du panier' );
			eq( count( array_filter( $one['lines'], static fn( array $l ): bool => ! $l['ok'] ) ), 2 );
			truthy( str_contains( $one['message'], '2 articles du panier' ), $one['message'] );
		}
	);

	it(
		'n’écrit jamais un montant dans une phrase que le client lit',
		function () use ( $row ): void {
			// `cents` est notre prix d'achat. Il circule dans `lines`, pour le
			// serveur, et il ne doit apparaître dans aucune des phrases.
			foreach ( array( 'short_stock', 'unpriced', 'unknown_article', 'unreachable', 'no_answer' ) as $why ) {
				$message = Disponibilite::line_message( 'BC01BSML', $why, 10, array( 'cents' => 345, 'stock' => 3, 'stock_supplier' => 0 ) );
				truthy( ! str_contains( $message, '345' ), "le motif {$why} laisse fuir un montant" );
				truthy( ! str_contains( $message, '3,45' ), "le motif {$why} laisse fuir un montant" );
			}
		}
	);

	it(
		'traite une quantité absurde comme une unité plutôt que de refuser tout le panier',
		function () use ( $row ): void {
			$v = Disponibilite::verdict( array( 'BC01BSML' => 0 ), array( 'BC01BSML' => $row( 345, 42 ) ), array(), array() );
			truthy( $v['ok'] );
			eq( $v['lines']['BC01BSML']['qty'], 1 );
		}
	);

	it(
		'TOTALISE deux lignes du même article au lieu de les vérifier séparément',
		function () use ( $row ): void {
			/*
			 * LA SURVENTE QU'UNE RELECTURE ADVERSE A TROUVÉE. Les recherches
			 * ignorent la casse parce que la clé primaire de la table l'ignore,
			 * donc « BC01BSML » et « bc01bsml » sont le MÊME article. Vérifiées
			 * séparément, deux demandes de 5 passaient toutes les deux devant un
			 * stock de 7, et le client repartait avec 10 exemplaires dont il en
			 * restait 7. Cette boutique vend du personnalisé : deux lignes du
			 * même textile avec deux visuels est le cas normal.
			 */
			$v = Disponibilite::verdict(
				array( 'BC01BSML' => 5, 'bc01bsml' => 5 ),
				array( 'BC01BSML' => $row( 345, 7 ) ),
				array(),
				array()
			);
			truthy( ! $v['ok'], '10 exemplaires demandés sur 7 en stock doivent être refusés' );
			eq( $v['reason'], 'short_stock' );
			eq( $v['lines']['BC01BSML']['qty'], 10, 'la quantité jugée est le total de l’article' );
			eq( $v['lines']['bc01bsml']['qty'], 10 );
			truthy( str_contains( $v['message'], 'vous en demandez 10' ), $v['message'] );
		}
	);

	it(
		'laisse passer deux lignes du même article quand le total tient',
		function () use ( $row ): void {
			$v = Disponibilite::verdict(
				array( 'BC01BSML' => 5, 'bc01bsml' => 2 ),
				array( 'BC01BSML' => $row( 345, 7 ) ),
				array(),
				array()
			);
			truthy( $v['ok'], 'sept exemplaires pour sept en stock, cela tient exactement' );
		}
	);

	it(
		'ne fait pas disparaître une ligne de panier dont la clé est illisible',
		function () use ( $row ): void {
			// Elle passait par `continue`, donc elle n'était ni vérifiée ni
			// visible : une ligne vendue sans avoir été regardée.
			$v = Disponibilite::verdict(
				array( '' => 3, 'BC01BSML' => 1 ),
				array( 'BC01BSML' => $row( 345, 42 ) ),
				array(),
				array()
			);
			truthy( ! $v['ok'], 'une ligne qu’on n’a pas pu vérifier doit refuser le panier' );
			eq( count( $v['lines'] ), 2, 'les deux lignes doivent être rendues' );
			eq( $v['lines']['']['why'], 'no_answer' );
		}
	);

	it(
		'ne dit jamais « tout va bien » sur zéro ligne vérifiée',
		function (): void {
			$v = Disponibilite::verdict( array(), array(), array(), array() );
			truthy( ! $v['ok'], '« rien trouvé » et « rien regardé » ne sont pas le même résultat' );
			eq( $v['reason'], 'empty' );
		}
	);

	it(
		'n’annonce pas une rupture à partir d’un stock qu’on n’a pas su lire',
		function (): void {
			// `line_message` est publique. Un appelant qui lui passe un motif de
			// stock court sans stock lisible ne doit pas recevoir « n'est plus
			// en stock » : une rupture est un fait, elle s'annonce mesurée.
			$sans = Disponibilite::line_message( 'BC01BSML', 'short_stock', 4, array( 'cents' => 345 ) );
			truthy( ! str_contains( $sans, 'plus en stock' ), $sans );

			$avec = Disponibilite::line_message( 'BC01BSML', 'short_stock', 4, array( 'cents' => 345, 'stock' => 0 ) );
			truthy( str_contains( $avec, 'plus en stock' ), 'un vrai zéro, lui, s’annonce : ' . $avec );
		}
	);
} );

describe( 'Disponibilite : le balayeur ne doit affamer aucune des deux files', function (): void {

	it(
		'partage sa place entre les jamais vus et les périmés',
		function (): void {
			/*
			 * « LES JAMAIS VUS D'ABORD » AFFAMAIT L'AUTRE FILE. 26 392
			 * déclinaisons importées sans ligne, 281 par passage : 94 passages,
			 * soit quatre jours de tâche horaire pendant lesquels aucune ligne
			 * existante n'aurait été rafraîchie.
			 */
			$split = Disponibilite::queue_split( 281 );
			eq( $split['unseen'] + $split['stale'], 281, 'la place ne doit pas se perdre en route' );
			truthy( $split['unseen'] > 0, 'l’amorçage doit avancer' );
			truthy( $split['stale'] > 0, 'le rafraîchissement aussi' );
			eq( $split, array( 'unseen' => 140, 'stale' => 141 ) );
		}
	);

	it(
		'donne encore une place à chaque file sur un budget minuscule',
		function (): void {
			eq( Disponibilite::queue_split( 1 ), array( 'unseen' => 1, 'stale' => 0 ) );
			eq( Disponibilite::queue_split( 2 ), array( 'unseen' => 1, 'stale' => 1 ) );
			eq( Disponibilite::queue_split( 0 ), array( 'unseen' => 0, 'stale' => 0 ) );
		}
	);
} );

describe( 'Disponibilite : les codes, les lots et le budget', function (): void {

	it(
		'refuse un code d’une forme qu’on ne peut ni envoyer ni stocker',
		function (): void {
			truthy( Disponibilite::valid_code( 'BC01BSML' ) );
			truthy( ! Disponibilite::valid_code( '' ) );
			truthy( ! Disponibilite::valid_code( 'BC01,BSML' ), 'une virgule couperait la liste CSV en deux' );
			truthy( ! Disponibilite::valid_code( 'BC01 BSML' ) );
			truthy( ! Disponibilite::valid_code( str_repeat( 'A', 65 ) ), 'la colonne s’arrête à 64 et tronquer donnerait la clé d’un autre article' );
			truthy( Disponibilite::valid_code( str_repeat( 'A', 64 ) ) );
		}
	);

	it(
		'dédoublonne sans tenir compte de la casse, et garde la graphie de l’appelant',
		function (): void {
			eq(
				Disponibilite::clean_codes( array( ' BC01BSML ', 'bc01bsml', 'BC01BSMM', '', 'BC01,X', null ) ),
				array( 'BC01BSML', 'BC01BSMM' )
			);
		}
	);

	it(
		'n’émet JAMAIS un lot de 151, même quand on le lui demande',
		function (): void {
			$codes = array();
			for ( $i = 0; $i < 151; $i++ ) {
				$codes[] = sprintf( 'CODE%03d', $i );
			}

			foreach ( array( null, 151, 1000, 150 ) as $ask ) {
				$lots = Disponibilite::batches( $codes, $ask );
				foreach ( $lots as $lot ) {
					truthy(
						count( $lot ) <= SupplyHttp::LIVE_BATCH_MAX,
						'un lot de ' . count( $lot ) . ' codes : le service rend 502 au-delà de ' . SupplyHttp::LIVE_BATCH_MAX
					);
				}
				eq( count( $lots ), 2, 'plafond demandé : ' . var_export( $ask, true ) );
				eq( count( $lots[0] ), 150 );
				eq( count( $lots[1] ), 1 );
			}
		}
	);

	it(
		'ne perd aucun code en découpant',
		function (): void {
			$codes = array();
			for ( $i = 0; $i < 431; $i++ ) {
				$codes[] = sprintf( 'CODE%03d', $i );
			}
			$flat = array();
			foreach ( Disponibilite::batches( $codes ) as $lot ) {
				$flat = array_merge( $flat, $lot );
			}
			eq( $flat, $codes );
		}
	);

	it(
		'ne fait aucun lot pour aucun code',
		function (): void {
			eq( Disponibilite::batches( array() ), array() );
		}
	);

	it(
		'chiffre un appel avec le modèle mesuré, socle compris',
		function (): void {
			near( Disponibilite::call_seconds( 1 ), 0.498, 1e-9, 'un code' );
			near( Disponibilite::call_seconds( 150 ), 10.63, 1e-9, 'un lot plein' );
			near( Disponibilite::call_seconds( 0 ), 0.43, 1e-9, 'le socle seul' );
		}
	);

	it(
		'paie le socle une fois par LOT et pas une fois pour toutes',
		function (): void {
			near( Disponibilite::plan_seconds( 150 ), 10.63, 1e-9 );
			// 151 codes, c'est deux appels, donc deux socles.
			near( Disponibilite::plan_seconds( 151 ), 11.128, 1e-9 );
			near( Disponibilite::plan_seconds( 0 ), 0.0, 1e-9 );
		}
	);

	it(
		'ne commence pas un lot qu’il ne peut pas finir',
		function (): void {
			eq( Disponibilite::codes_that_fit( 0.42 ), 0, 'même pas le socle' );
			eq( Disponibilite::codes_that_fit( 0.50 ), 1, 'un code, mesuré à 0,50 s' );
			eq( Disponibilite::codes_that_fit( 10.7 ), 150, 'un lot plein tient, et le plafond du service borne' );
			eq( Disponibilite::codes_that_fit( 3600.0 ), 150, 'le plafond du service borne quel que soit le temps' );
		}
	);

	it(
		'dérive le plus gros panier vérifiable du modèle, au lieu de l’écrire à la main',
		function (): void {
			$cap = Disponibilite::assert_cap( 20.0 );
			eq( $cap, 281 );
			truthy( Disponibilite::plan_seconds( $cap ) <= 20.0, 'le plafond doit tenir dans le budget' );
			truthy( Disponibilite::plan_seconds( $cap + 1 ) > 20.0, 'et un de plus doit le dépasser' );
			eq( Disponibilite::assert_cap( 0.4 ), 0, 'un budget sous le socle ne permet aucun article' );
		}
	);

	it(
		'donne à un appel un délai plus large que ce qu’il coûte, sans recopier de nombre',
		function (): void {
			truthy( Disponibilite::timeout_for( 150 ) > Disponibilite::call_seconds( 150 ) );
			eq( Disponibilite::timeout_for( 150 ), 21 );
			eq( Disponibilite::timeout_for( 1 ), 11 );
		}
	);
} );

describe( 'Disponibilite : le vocabulaire des refus', function (): void {

	it(
		'donne une phrase distincte à chacun des motifs',
		function (): void {
			$seen = array();
			foreach ( array( 'unreachable', 'no_answer', 'unknown_article', 'unpriced', 'short_stock' ) as $why ) {
				$message = Disponibilite::line_message( 'BC01BSML', $why, 10, array( 'cents' => 345, 'stock' => 0, 'stock_supplier' => 0 ) );
				truthy( '' !== $message, "le motif {$why} n’a pas de phrase" );
				truthy( ! in_array( $message, $seen, true ), "le motif {$why} redit la phrase d’un autre motif" );
				truthy( ! str_contains( $message, '!' ), "le motif {$why} porte un point d’exclamation" );
				// Le tiret cadratin par son point de code, et pas en toutes
				// lettres : la règle de la maison est qu'il n'y en a AUCUN dans
				// le dépôt, y compris dans le test qui le cherche.
				truthy( ! str_contains( $message, "\u{2014}" ), "le motif {$why} porte un tiret cadratin" );
				$seen[] = $message;
			}
		}
	);

	it(
		'garde la liste des motifs et celle des phrases d’accord',
		function (): void {
			// Un motif que `verdict()` peut rendre et que `REASONS` ne nomme pas
			// est un motif qu'aucun appelant ne saura traiter.
			foreach ( array( 'unreachable', 'no_answer', 'unknown_article', 'unpriced', 'short_stock', 'empty', 'too_many' ) as $why ) {
				truthy( in_array( $why, Disponibilite::REASONS, true ), "le motif {$why} manque à REASONS" );
			}
		}
	);
} );
