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
 * The fixture below is a RAW supplier product for reference 18001 (Fruit of the
 * Loom Heavy Cotton T), in the shape `tests/fixtures/supply-products.json` was
 * captured in, with the purchase prices the supplier actually published on
 * 2026-08-19: 3,37 EUR for the small sizes and 4,46 EUR for the 2XL. It is
 * deposited in `Supply::table()` the way `Supply::sync()` deposits one, and it
 * goes in through `Importer::one()`, so the variations these cases buy from are
 * written by the same code that writes the shop's 26 399 articles, with the
 * same article numbers, the same costs and the same stock.
 *
 * Until 9 September 2026 the fixture was the OUTPUT of `Supply::to_entry()`,
 * injected over HTTP. The mapping that turns a supplier payload into an article
 * number and a purchase price was therefore never exercised by this file, which
 * is the one file that buys things.
 *
 * ── AND THE SIZE GRID IS THE POINT ──────────────────────────────────────────
 *
 * A customer's line is « 12 M et 8 L », one product, one design, and since
 * 9 September 2026 it can also be « 12 M blancs et 8 M noirs » on ONE line: the
 * line carries a matrix, colour to size to quantity. The supplier sells one
 * article per colour and size. So a basket is where that matrix becomes article
 * numbers, and it is the only place in this system where getting a colour or a
 * size wrong is silent until a box arrives.
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
 * ── LE GABARIT EST UN PRODUIT BRUT, PAS UNE ENTRÉE FINIE ────────────────────
 *
 * Jusqu'au 9 septembre 2026 cette suite injectait directement la forme de
 * SORTIE de `Supply::to_entry()` : le gabarit rendait des `colourways`, des
 * `skus`, des prix en euros et un bloc `stock`, c'est-à-dire exactement ce que
 * la cartographie produit. Une erreur DANS cette cartographie était donc
 * invisible d'ici, alors que c'est elle qui décide du numéro d'article que
 * l'atelier achète et du prix auquel il est costé.
 *
 * Depuis, le gabarit est un produit du fournisseur tel qu'il le publie, déposé
 * dans la table de dépôt comme `Supply::sync()` le déposerait, et c'est le VRAI
 * `Supply::to_entry()` qui le transforme. La forme est copiée de
 * `tests/fixtures/supply-products.json`, qui est une capture réelle du service :
 * `variants[]` avec `variantReference`, `attributes` typées `color` / `sizes` /
 * `material`, `categories` bilingues, `grammage`, `netWeight`,
 * `countryOfOrigin`, et les titres en objet de langues.
 *
 * LES NUMÉROS RESTENT CEUX D'AVANT (référence 18001, articles 180010003 et
 * suivants) : `e2e-support.php` et `integration-lancement.php` les nomment, et
 * les renommer étendrait ce changement à des fichiers qui n'ont rien à y voir.
 * Les vraies références du nouveau fournisseur sont alphanumériques, et
 * `Catalogue::map` accepte les deux, donc une référence numérique reste valide.
 */

/**
 * Une déclinaison brute du fournisseur.
 *
 * @param string $code   Le numéro d'article (`variantReference`).
 * @param string $colour Le nom de coloris, qui devient le terme de la boutique.
 * @param string $hex    La teinte déclarée, ou '' quand il n'y en a pas.
 * @param string $size   Le nom de taille.
 */
function ts_ac_raw_variant( string $code, string $colour, string $hex, string $size ): array {
	$attributes = array(
		array( 'type' => 'sizes', 'value' => $size ),
		array(
			'type'      => 'color',
			'value'     => $colour,
			// `colorCode` est une FAMILLE chez ce fournisseur, jamais une
			// identité : il est ici parce qu'il est dans la capture, et
			// `Supply::colour_code()` ne le lit pas.
			'colorCode' => array( strtoupper( $colour ) ),
			'hex'       => $hex,
			'cmyk'      => '0 0 0 0',
		),
		array(
			'type'  => 'material',
			'value' => array(
				'fr' => '100% coton peigné pré-rétréci.',
				'en' => '100% pre-shrunk combed cotton.',
			),
		),
	);

	return array(
		'variantReference'  => $code,
		'underConstruction' => 0,
		'prepublication'    => false,
		'deletedAt'         => null,
		'createdAt'         => '2019-11-28 16:36:00',
		'updatedAt'         => '2026-08-19 08:03:55',
		'tags'              => array(),
		'title'             => array( 'fr' => 'Heavy Cotton T', 'en' => 'Heavy Cotton T' ),
		'longTitle'         => array( 'fr' => 'Tee-shirt homme col rond 195', 'en' => 'Men’s crew neck t-shirt 195' ),
		'certifications'    => array( 'certifications' => array( 'OEKO TEX' ) ),
		'attributes'        => $attributes,
		'netWeight'         => array( 'unit' => 'kg', 'value' => 0.19 ),
		'averageWeight'     => array( 'unit' => 'kg', 'value' => 0 ),
		'countryOfOrigin'   => array( 'Bangladesh' ),
		'grammage'          => array( 'unit' => 'g/m²', 'value' => 195 ),
		'eanUpcCode'        => '',
		'categories'        => array(
			array(
				'categories' => array( 'fr' => 'TEE-SHIRT', 'en' => '' ),
				'families'   => array( 'fr' => 'MANCHES COURTES', 'en' => '' ),
			),
		),
		/*
		 * AUCUNE IMAGE, comme les quatre cinquièmes de la capture réelle.
		 * Une URL ici ferait partir un vrai téléchargement depuis
		 * `Importer::images()`, donc un appel réseau sortant depuis une suite
		 * de tests, pour une photographie qu'aucun cas n'examine.
		 */
		'images'            => array(),
	);
}

/**
 * Le produit brut de la référence 18001, tel que le service le publierait.
 *
 * Deux coloris et quatre tailles feraient huit articles ; le fournisseur en
 * vend sept, parce que le noir n'existe pas en 2XL. Cette asymétrie est dans le
 * vrai catalogue (11,6 % du produit croisé n'existe pas) et elle est ici
 * exprès : c'est ce qu'un panier doit refuser plutôt qu'approcher.
 *
 * @param array $over Remplacements récursifs, pour un cas qui veut changer un
 *                    champ sans réécrire le produit entier.
 */
function ts_ac_raw( array $over = array() ): array {
	$product = array(
		'reference' => '18001',
		'createdAt' => '2019-11-27 11:50:50',
		'updatedAt' => '2026-08-19 08:03:55',
		'deletedAt' => null,
		'brands'    => array( 'name' => 'Fruit of the Loom' ),
		'variants'  => array(
			ts_ac_raw_variant( '180010003', 'White', '#ffffff', 'S' ),
			ts_ac_raw_variant( '180010004', 'White', '#ffffff', 'M' ),
			ts_ac_raw_variant( '180010005', 'White', '#ffffff', 'L' ),
			ts_ac_raw_variant( '180010007', 'White', '#ffffff', '2XL' ),
			ts_ac_raw_variant( '180011013', 'Black', '#101010', 'S' ),
			ts_ac_raw_variant( '180011014', 'Black', '#101010', 'M' ),
			ts_ac_raw_variant( '180011015', 'Black', '#101010', 'L' ),
		),
		'images'    => array(),
		'links'     => array(),
	);
	return array_replace_recursive( $product, $over );
}

/**
 * Dépose un produit brut dans la table de dépôt, comme `Supply::sync()` le fait.
 *
 * `Supply::store()` est privée, donc l'insertion est recopiée ici, colonne pour
 * colonne. Le classement passe par `Supply::classify()`, qui est publique et
 * qui est celle que la synchronisation appelle : la copie porte sur le SQL, pas
 * sur la règle, sinon ce gabarit rangerait le vêtement à sa façon.
 */
function ts_ac_seed_supply( array $product = array() ): void {
	global $wpdb;

	$product = array() === $product ? ts_ac_raw() : $product;
	$facts   = \Teeshoop\Core\Supply::classify( $product );
	$payload = gzcompress( (string) wp_json_encode( $product ), 6 );
	ts_assert( false !== $payload, 'le gabarit brut ne se compresse pas' );

	$wpdb->query(
		$wpdb->prepare(
			'INSERT INTO `' . \Teeshoop\Core\Supply::table() . '` (ref, kind, shelf, sleeve, updated_at, seen_at, gone, payload)
			 VALUES (%s, %s, %s, %s, %s, %s, %d, %s)
			 ON DUPLICATE KEY UPDATE kind = VALUES(kind), shelf = VALUES(shelf), sleeve = VALUES(sleeve),
			   updated_at = VALUES(updated_at), seen_at = VALUES(seen_at), gone = VALUES(gone), payload = VALUES(payload)',
			(string) $product['reference'],
			$facts['kind'],
			$facts['shelf'],
			$facts['sleeve'],
			gmdate( 'Y-m-d H:i:s', (int) strtotime( (string) $product['updatedAt'] ) ),
			gmdate( 'Y-m-d H:i:s' ),
			0,
			$payload
		)
	);
}

/**
 * Retire du miroir tout ce que ce gabarit y a déposé.
 *
 * LES DEUX TABLES, et pas seulement celle du catalogue : `Disponibilite` écrit
 * une ligne par code à CHAQUE lecture de prix ou de stock, y compris quand
 * c'est le panier qui demande. Sans ce nettoyage, une seconde exécution
 * trouverait sept lignes fraîches qu'elle n'a pas écrites, et « le relevé est
 * cru » passerait pour une mesure alors que ce serait un reste.
 *
 * Nommément, jamais en vidant la table : le miroir porte 3 241 produits et
 * 1 060 disponibilités réels, synchronisés depuis le service.
 */
function ts_ac_forget_supply(): void {
	global $wpdb;

	$wpdb->query(
		$wpdb->prepare( 'DELETE FROM `' . \Teeshoop\Core\Supply::table() . '` WHERE ref = %s', '18001' )
	);

	$codes = array_keys( ts_ac_live_default() );
	$wpdb->query(
		$wpdb->prepare(
			'DELETE FROM `' . \Teeshoop\Core\Disponibilite::table() . '` WHERE code IN ('
				. implode( ', ', array_fill( 0, count( $codes ), '%s' ) ) . ')',
			$codes
		)
	);
}

/**
 * Prix et stock en direct, dans la forme EXACTE où le service les publie.
 *
 * Tout est une CHAÎNE, y compris les nombres, parce que c'est ce que
 * `tests/fixtures/supply-pricestock.json` contient (« "price": "3.45" »,
 * « "stock": "510" »). Écrire des entiers ici rendrait `parse_price_cents()` et
 * `parse_count()` verts sur un cas qu'ils ne rencontrent jamais.
 *
 * Les montants sont ceux que le service publiait le 19 août 2026 sur cette
 * référence : 3,37 EUR sur les petites tailles, 4,46 EUR sur le 2XL.
 *
 * @return array<string,array<string,string>>
 */
function ts_ac_live_default(): array {
	$row = static fn( string $price, int $stock, int $maker ): array => array(
		'quantity_unit'  => '1',
		'quantity_box'   => '100',
		'price'          => $price,
		'price_box'      => $price,
		'stock'          => (string) $stock,
		// `stock_supplier` est ce que le FABRICANT a derrière le grossiste.
		// On ne vend jamais contre lui ; il est ici parce que la réponse le
		// porte et que `to_entry()` le range en troisième position.
		'stock_supplier' => (string) $maker,
	);

	return array(
		'180010003' => $row( '3.37', 444, 576 ),
		'180010004' => $row( '3.37', 900, 0 ),
		'180010005' => $row( '3.37', 900, 0 ),
		// Volontairement court : huit en stock contre un panier qui en veut vingt.
		'180010007' => $row( '4.46', 8, 4000 ),
		'180011013' => $row( '3.37', 120, 0 ),
		'180011014' => $row( '3.37', 120, 0 ),
		'180011015' => $row( '3.37', 120, 0 ),
	);
}

/** Ce que le service répondra, remplaçable par un cas. */
function ts_ac_live(): array {
	return $GLOBALS['ts_ac_live'] ?? ts_ac_live_default();
}

/** La valeur d'un paramètre de requête d'une URL, ou ''. */
function ts_ac_query( string $url, string $key ): string {
	$query = (string) wp_parse_url( $url, PHP_URL_QUERY );
	$args  = array();
	wp_parse_str( $query, $args );
	return (string) ( $args[ $key ] ?? '' );
}

/**
 * Answer every supplier and Worker call this suite makes.
 *
 * ── CE QUE LE GREFFON APPELLE VRAIMENT DEPUIS LE 9 SEPTEMBRE 2026 ───────────
 *
 * Les quatre routes de l'ancien service (`/catalogue/`, `/state`, `/order`,
 * `/deliveries`) n'existent plus. Il en reste trois chez le fournisseur :
 *
 *   GET  …/api/products/price-stock?products=CSV   un OBJET indexé par code
 *   GET  …/api/products/price-stock/{reference}    une LISTE portant « code »
 *   POST …/api/orders/create-order                 la commande
 *
 * Les deux premières n'ont pas la même forme, et ce n'est pas un détail :
 * `Disponibilite::parse_rows()` lit le code dans la ligne d'abord et dans la
 * clé ensuite, donc un gabarit qui ne rendrait qu'une seule des deux formes
 * laisserait la moitié de ce lecteur sans épreuve.
 *
 * Voir `$GLOBALS['ts_ac_order']` pour la réponse de la commande et
 * `$GLOBALS['ts_ac_live']` pour le prix et le stock.
 */
function ts_ac_stub(): void {
	remove_all_filters( 'pre_http_request' );
	add_filter(
		'pre_http_request',
		function ( $pre, $args, $url ) {
			$json = static fn( array $body, int $code = 200 ): array => array(
				/*
				 * LE TYPE DE CONTENU EST OBLIGATOIRE SUR CHAQUE RÉPONSE.
				 *
				 * `SupplyHttp::read()` refuse tout corps qui n'est pas annoncé
				 * JSON avant même d'essayer de le décoder, parce que le vrai
				 * service répond à un jeton faux par un 302 vers une page de
				 * connexion HTML : un client qui lit du HTML comme du JSON lit
				 * « aucun article » là où il faut lire « on nous a refusés ».
				 * Un gabarit qui oublie cet en-tête fait donc échouer CHAQUE
				 * appel avec le motif « parse », et on cherche le mauvais bogue.
				 */
				'headers'  => array( 'content-type' => 'application/json' ),
				'body'     => wp_json_encode( $body ),
				'response' => array( 'code' => $code ),
				'cookies'  => array(),
				'filename' => null,
			);

			$url  = (string) $url;
			$path = (string) wp_parse_url( $url, PHP_URL_PATH );

			// ── le fournisseur : prix et stock ──────────────────────────────
			if ( str_starts_with( $path, '/api/products/price-stock' ) ) {
				$live = ts_ac_live();
				$tail = trim( substr( $path, strlen( '/api/products/price-stock' ) ), '/' );

				if ( '' !== $tail ) {
					// PAR RÉFÉRENCE : une liste, chaque ligne portant son code.
					$rows = array();
					foreach ( $live as $code => $row ) {
						if ( str_starts_with( (string) $code, rawurldecode( $tail ) ) ) {
							$rows[] = array_merge( array( 'code' => (string) $code ), $row );
						}
					}
					return $json( array( 'products' => $rows ) );
				}

				/*
				 * PAR LOT : un objet indexé par code. Un code demandé qu'on ne
				 * connaît pas est annoncé introuvable dans la PHRASE que le
				 * service écrit, et pas passé sous silence : « il n'existe pas »
				 * et « je n'en ai pas parlé » n'écrivent pas la même chose dans
				 * la table des disponibilités.
				 */
				$asked   = array_filter( array_map( 'trim', explode( ',', ts_ac_query( $url, 'products' ) ) ) );
				$out     = array();
				$missing = array();
				foreach ( $asked as $code ) {
					if ( isset( $live[ $code ] ) ) {
						$out[ $code ] = $live[ $code ];
					} else {
						$missing[] = $code;
					}
				}
				$body = array( 'products' => $out );
				if ( array() !== $missing ) {
					$body['products_not_found'] = 'Les references produit suivantes sont introuvables : ' . implode( ', ', $missing );
				}
				return $json( $body );
			}

			// ── le fournisseur : la commande ────────────────────────────────
			if ( str_ends_with( $path, '/api/orders/create-order' ) ) {
				$answer = $GLOBALS['ts_ac_order'] ?? array( 'outcome' => 'accepted' );
				if ( isset( $answer['transport'] ) ) {
					return new \WP_Error( 'http_request_failed', 'cURL error 28: Operation timed out' );
				}
				$GLOBALS['ts_ac_sent'][] = json_decode( (string) ( $args['body'] ?? '{}' ), true );

				/*
				 * UN REFUS EST UN 422 PORTANT CHAMP VERS PHRASES, et jamais un
				 * 200 avec un drapeau : c'est la seule forme de refus que ce
				 * service publie, et `Supply::place_order()` la lit comme telle.
				 */
				if ( 'rejected' === ( $answer['outcome'] ?? '' ) ) {
					return $json(
						(array) ( $answer['errors'] ?? array( 'order_lines' => array( 'Artno not found' ) ) ),
						422
					);
				}
				/*
				 * UNE ACCEPTATION SANS NUMÉRO est ce que `place_order()` classe
				 * « incertain » : le fournisseur a peut-être créé la commande et
				 * rien ne permet de le savoir. Le gabarit le produit en
				 * n'écrivant pas `order_id`, ce qui est exactement ce qu'une
				 * réponse tronquée ferait.
				 */
				if ( 'unknown' === ( $answer['outcome'] ?? '' ) ) {
					return $json( array( 'message' => (string) ( $answer['message'] ?? '' ) ) );
				}
				return $json(
					array(
						'order_id' => (string) ( $answer['orderId'] ?? '4412345' ),
						'message'  => (string) ( $answer['message'] ?? '' ),
					),
					(int) ( $answer['status'] ?? 200 )
				);
			}

			// ── le Worker ───────────────────────────────────────────────────
			if ( str_contains( $url, '/api/design/' ) ) {
				return $json(
					array(
						'id'          => substr( $url, strrpos( $url, '/' ) + 1 ),
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
			if ( str_contains( $url, '/api/nest' ) ) {
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

			/*
			 * TOUTE AUTRE ROUTE DU FOURNISSEUR EST UN ÉCHEC BRUYANT.
			 *
			 * Rendre `$pre` ferait partir une VRAIE requête vers le service de
			 * préproduction depuis une suite de tests, avec les identifiants du
			 * miroir : lente, dépendante du réseau, et capable de créer une
			 * commande chez lui. Un refus nommé arrête net et dit lequel.
			 */
			if ( str_starts_with( $path, '/api/products/' ) || str_starts_with( $path, '/api/orders/' ) || str_starts_with( $path, '/oauth/' ) ) {
				return new \WP_Error( 'ts_ac_non_prevu', 'Appel fournisseur non prévu par le gabarit : ' . $path );
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

/**
 * Une commande payée dont la ligne porte une MATRICE coloris vers taille.
 *
 * ── POURQUOI CE SECOND CONSTRUCTEUR EXISTE ──────────────────────────────────
 *
 * `ts_ac_order()` construit une ligne à un coloris, qui est ce que la boutique
 * a vendu jusqu'au 9 septembre 2026 et ce que les lignes déjà en base portent.
 * La matrice est un autre chemin dans `Cart::add()` : le nuancier du produit
 * décide quels coloris sont acceptés, `size_grid` devient la SOMME par taille,
 * et `_teeshoop_blank_colours` gèle un terme fournisseur par coloris. Faire
 * passer les deux par une seule fonction à rallonge cacherait exactement ce qui
 * diffère.
 *
 * Le nuancier est posé ici parce que sans lui `Cart::normalise_matrix()` ne
 * garde que le coloris de la création : un identifiant que le produit n'offre
 * pas est ignoré plutôt que corrigé, et c'est la bonne règle.
 */
function ts_ac_order_matrix( int $product_id, array $matrix, string $design ): \WC_Order {
	$sides                   = array( array( 'id' => 'front', 'area_sq_cm' => 400.0, 'pieces' => array( array( 'w_cm' => 20.0, 'h_cm' => 20.0 ) ) ) );
	$GLOBALS['ts_ac_sides']  = $sides;
	$GLOBALS['ts_ac_colour'] = (string) array_key_first( $matrix );
	ts_ac_stub();

	$was_palette = get_post_meta( $product_id, Product::META_BLANK_PALETTE, true );
	update_post_meta(
		$product_id,
		Product::META_BLANK_PALETTE,
		wp_json_encode(
			array(
				array( 'id' => 'white', 'name' => 'Blanc', 'stops' => array( '#ffffff' ) ),
				array( 'id' => 'black', 'name' => 'Noir', 'stops' => array( '#101010' ) ),
			)
		)
	);

	try {
		WC()->cart->empty_cart();
		$key = Cart::add(
			array(
				'product_id' => $product_id,
				'qty'        => 1,
				'sides'      => $sides,
				'design_id'  => $design,
				'matrix'     => $matrix,
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
	} finally {
		if ( '' === (string) $was_palette ) {
			delete_post_meta( $product_id, Product::META_BLANK_PALETTE );
		} else {
			update_post_meta( $product_id, Product::META_BLANK_PALETTE, $was_palette );
		}
	}

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

	/*
	 * ── LA CONFIGURATION FOURNISSEUR, DÉCLARÉE ET VÉRIFIÉE ──────────────────
	 *
	 * Le miroir porte déjà ces constantes, avec de vrais identifiants de
	 * préproduction. Cette suite ne dépend PAS de leurs valeurs : tout part par
	 * `pre_http_request` et rien ne sort sur le réseau. Elle dépend seulement du
	 * fait qu'elles existent, parce que `SupplyHttp::unconfigured()` ferme avant
	 * d'appeler quoi que ce soit : sans elles, `Supply::entry()` refuserait, le
	 * gabarit ne serait jamais consulté, et la moitié de cette suite passerait à
	 * côté de ce qu'elle croit mesurer.
	 *
	 * Elles sont donc posées si elles manquent (une constante ne se redéfinit
	 * pas, donc c'est sans effet sur un miroir configuré) ET le cas ci-dessous
	 * échoue si le greffon se dit malgré tout mal réglé. « Rien trouvé » et
	 * « rien regardé » sont deux résultats différents, y compris ici.
	 */
	foreach ( array(
		'TEESHOOP_SUPPLY_BASE'          => 'https://fournisseur.invalid',
		'TEESHOOP_SUPPLY_TOKEN'         => 'Bearer ' . str_repeat( 'k', 32 ),
		'TEESHOOP_SUPPLY_V2_BASE'       => 'https://fournisseur.invalid',
		'TEESHOOP_SUPPLY_CLIENT_ID'     => str_repeat( 'c', 32 ),
		'TEESHOOP_SUPPLY_CLIENT_SECRET' => str_repeat( 's', 32 ),
		'TEESHOOP_SUPPLY_MEDIA_BASE'    => 'https://images.invalid',
		/*
		 * LE MODE NE S'IMPOSE PAS D'ICI, ET C'EST DÉLIBÉRÉ. `Supply::mode()`
		 * lit cette constante et rien d'autre : lui ajouter un filtre ou une
		 * statique modifiable donnerait à la production un moyen d'appeler
		 * « essai » un compte réel, ce qui est exactement ce que la
		 * déclaration existe pour empêcher. La suite la POSE quand elle
		 * manque, et ÉCHOUE quand le miroir en déclare une autre.
		 */
		'TEESHOOP_SUPPLY_MODE'          => 'test',
	) as $ts_ac_const => $ts_ac_value ) {
		if ( ! defined( $ts_ac_const ) ) {
			define( $ts_ac_const, $ts_ac_value );
		}
	}

	ts_it( 'runs against a shop the plugin considers configured, or not at all', function () {
		ts_eq( \Teeshoop\Core\Supply::unconfigured(), '', 'le greffon se dit mal réglé : les appels refuseraient avant d’atteindre le gabarit' );
		ts_eq( \Teeshoop\Core\Supply::mode()['mode'], 'test', 'le compte fournisseur déclaré par ce miroir n’est pas « test » : corrigez TEESHOOP_SUPPLY_MODE dans wp-config.php' );
	} );

	ts_it( 'copies a re-shot photograph, and says why a photograph was not copied', function () {
		/*
		 * FOU-10 : la pièce jointe était retrouvée par le seul nom de fichier,
		 * que le fournisseur garde d'une prise de vue à l'autre ; la fiche
		 * gardait l'ancienne photo pour toujours. FOU-09 : une photo refusée
		 * par la configuration rendait 0 sans rien écrire au rapport.
		 */
		$m = new \ReflectionMethod( \Teeshoop\Core\Importer::class, 'attachment' );
		$m->setAccessible( true );
		$fetched = array();
		$http    = static function ( $pre, $args, $url ) use ( &$fetched ) {
			$fetched[] = $url;
			return array(
				'headers'  => array(),
				'body'     => '',
				'response' => array( 'code' => 404, 'message' => 'Not Found' ),
				'cookies'  => array(),
				'filename' => null,
			);
		};
		add_filter( 'pre_http_request', $http, 10, 3 );

		$legacy = wp_insert_attachment( array( 'post_title' => 'ZZFOU10', 'post_mime_type' => 'image/jpeg', 'post_status' => 'inherit' ) );
		update_post_meta( $legacy, '_teeshoop_source', 'ZZFOU10_15_FRONT.jpg' );
		try {
			$problems  = array();
			$downloads = 0;
			$first     = $m->invokeArgs( null, array( 'https://fournisseur.invalid/media-produit/1/ZZFOU10_15_FRONT.jpg', 'ZZ', &$problems, &$downloads, 'zz' ) );
			ts_eq( $first, $legacy, 'la photographie déjà copiée doit être reprise, pas retéléchargée' );
			ts_eq( $fetched, array(), 'une photographie déjà copiée a été retéléchargée' );

			$problems = array();
			$reshoot  = $m->invokeArgs( null, array( 'https://fournisseur.invalid/media-produit/2/ZZFOU10_15_FRONT.jpg', 'ZZ', &$problems, &$downloads, 'zz' ) );
			ts_assert( $reshoot !== $legacy, 'une nouvelle prise de vue sous le même nom a gardé l’ancienne photographie' );
			ts_eq( count( $fetched ), 1, 'la nouvelle prise de vue n’a pas été demandée' );
			ts_assert( str_contains( implode( ' ', $problems ), 'HTTP 404' ), 'l’échec du téléchargement n’est pas au rapport' );

			$problems = array();
			$refused  = $m->invokeArgs( null, array( 'ftp://ailleurs.invalid/x/ZZFOU09.jpg', 'ZZ', &$problems, &$downloads, 'zz' ) );
			ts_eq( $refused, 0, 'une photographie hors de l’hôte configuré ne doit pas être copiée' );
			ts_assert( ! empty( $problems ), 'une photographie refusée par la configuration n’a rien laissé au rapport' );
		} finally {
			remove_filter( 'pre_http_request', $http, 10 );
			wp_delete_attachment( $legacy, true );
		}
	} );

	ts_ac_stub();

	ts_it( 'reads a photo address it may not fetch as « could not look », not as a colour', function () {
		/*
		 * IMG-03. Sans `reachable`, un refus de configuration passait pour une
		 * photo regardée : le balayage effaçait la pastille mesurée et ne
		 * re-mesurait plus jamais ce coloris.
		 */
		$verdict = \Teeshoop\Core\Colours::measure_photo( 'ftp://ailleurs.invalid/x/ZZIMG03.jpg' );
		ts_eq( $verdict['ok'] ?? null, false, 'une adresse refusée a été mesurée' );
		ts_assert( array_key_exists( 'reachable', $verdict ), 'le refus ne dit pas s’il a pu regarder' );
		ts_eq( $verdict['reachable'], false, 'un refus de configuration a été lu comme un verdict sur la couleur' );
	} );

	ts_it( 'never calls a walk complete over a row the table refused', function () {
		/*
		 * FOU-11. Une écriture refusée par MySQL n'était comptée ni comme
		 * produit ni comme échec : la marche finissait « complète », la
		 * référence gardait un vieux `seen_at` et `mark_gone` la retirait.
		 */
		global $wpdb;
		$page = static function ( $pre, $args, $url ) {
			if ( ! str_contains( (string) $url, '/api/products/products' ) ) {
				return $pre;
			}
			return array(
				'headers'  => array( 'content-type' => 'application/json' ),
				'body'     => wp_json_encode(
					array(
						'totalNumberPage' => 1,
						'products'        => array(
							ts_ac_raw( array( 'reference' => 'ZZFOU11A' ) ),
							ts_ac_raw( array( 'reference' => 'ZZFOU11B' ) ),
						),
					)
				),
				'response' => array( 'code' => 200 ),
				'cookies'  => array(),
				'filename' => null,
			);
		};
		$refuse = static function ( $query ) {
			return str_starts_with( ltrim( (string) $query ), 'INSERT' ) && str_contains( (string) $query, 'ZZFOU11B' )
				? 'INSERT INTO `ts_table_absente_fou11` VALUES (1)'
				: $query;
		};
		add_filter( 'pre_http_request', $page, 99, 3 );
		add_filter( 'query', $refuse );
		$suppress = $wpdb->suppress_errors( true );
		try {
			$lost = \Teeshoop\Core\Supply::sync( array( 'page' => 1, 'budget' => 30 ) );
			ts_assert( $lost['ok'], 'la marche bouchonnée a échoué : ' . (string) ( $lost['error'] ?? '' ) );
			ts_eq( (int) $lost['products'], 1, 'une ligne écrite' );
			ts_eq( (int) $lost['unwritten'], 1, 'la ligne refusée n’est pas comptée' );
			ts_assert( ! $lost['complete'], 'une marche qui a perdu une écriture se dit complète' );

			remove_filter( 'query', $refuse );
			$whole = \Teeshoop\Core\Supply::sync( array( 'page' => 1, 'budget' => 30 ) );
			ts_assert( $whole['complete'], 'la même marche sans perte doit être complète, sinon ce cas ne prouve rien' );
		} finally {
			remove_filter( 'query', $refuse );
			remove_filter( 'pre_http_request', $page, 99 );
			$wpdb->suppress_errors( $suppress );
			$wpdb->query( $wpdb->prepare( 'DELETE FROM `' . \Teeshoop\Core\Supply::table() . '` WHERE ref IN (%s, %s)', 'ZZFOU11A', 'ZZFOU11B' ) );
		}
	} );

	ts_it( 'declares a reference gone only when two complete walks in a row missed it', function () {
		/*
		 * FOU-11. La marche pagine par décalage sans ordre : une référence
		 * sautée par une seule marche complète était dépubliée jusqu'au
		 * lendemain. Dates de l'an 2000 : aucune vraie ligne du dépôt n'est
		 * aussi vieille, donc rien d'autre n'est touché.
		 */
		global $wpdb;
		$table  = \Teeshoop\Core\Supply::table();
		$before = get_option( \Teeshoop\Core\Supply::OPTION_LAST_COMPLETE, null );
		$put    = static function ( string $ref, string $seen ) use ( $wpdb, $table ): void {
			$wpdb->query(
				$wpdb->prepare(
					'INSERT INTO `' . $table . '` (ref, kind, shelf, sleeve, updated_at, seen_at, gone, payload) VALUES (%s, %s, %s, %s, NULL, %s, 0, %s)',
					$ref,
					'tee',
					'',
					'',
					$seen,
					gzcompress( '{}' )
				)
			);
		};
		$gone = static fn( string $ref ): int => (int) $wpdb->get_var( $wpdb->prepare( 'SELECT gone FROM `' . $table . '` WHERE ref = %s', $ref ) );

		delete_option( \Teeshoop\Core\Supply::OPTION_LAST_COMPLETE );
		$put( 'ZZFOU11OLD', '1999-12-01 00:00:00' );
		try {
			\Teeshoop\Core\Supply::mark_gone( '2000-01-01 00:00:00' );
			ts_eq( $gone( 'ZZFOU11OLD' ), 0, 'une seule marche complète a suffi à déclarer une référence disparue' );

			// Vue par la première marche, sautée par la seconde.
			$put( 'ZZFOU11SKIP', '2000-01-01 00:00:05' );
			\Teeshoop\Core\Supply::mark_gone( '2000-01-02 00:00:00' );
			ts_eq( $gone( 'ZZFOU11OLD' ), 1, 'absente de deux marches complètes, elle doit être déclarée disparue' );
			ts_eq( $gone( 'ZZFOU11SKIP' ), 0, 'sautée par une seule marche, elle a été déclarée disparue' );
		} finally {
			$wpdb->query( $wpdb->prepare( 'DELETE FROM `' . $table . '` WHERE ref IN (%s, %s)', 'ZZFOU11OLD', 'ZZFOU11SKIP' ) );
			null === $before ? delete_option( \Teeshoop\Core\Supply::OPTION_LAST_COMPLETE ) : update_option( \Teeshoop\Core\Supply::OPTION_LAST_COMPLETE, $before, false );
		}
	} );

	ts_it( 'reads a 422 on a catalogue read as a refusal, not as an empty page to ask again', function () {
		// FOU-03 : une date refusée (422) devenait une page vide, et la
		// commande redemandait la même page sans fin.
		$stub = static function ( $pre, $args, $url ) {
			if ( false === strpos( (string) $url, '/api/products/products' ) ) {
				return $pre;
			}
			return array(
				'headers'  => array( 'content-type' => 'application/json' ),
				'body'     => '{"errors":{"sinceUpdated":["Le format attendu est jj-mm-aaaa."]}}',
				'response' => array(
					'code'    => 422,
					'message' => 'Unprocessable Content',
				),
				'cookies'  => array(),
				'filename' => null,
			);
		};
		add_filter( 'pre_http_request', $stub, PHP_INT_MAX, 3 );
		$read = \Teeshoop\Core\SupplyHttp::get( '/api/products/products', array( 'page' => 1, 'sinceUpdated' => '31-02-2026' ) );
		$run  = \Teeshoop\Core\Supply::sync( array( 'since' => '31-02-2026', 'page' => 1, 'budget' => 30 ) );
		remove_filter( 'pre_http_request', $stub, PHP_INT_MAX );
		ts_eq( $read['ok'], false, 'un 422 sur une lecture a été pris pour une réponse' );
		ts_eq( $run['ok'], false, 'la marche a pris le refus pour une page vide à redemander' );
	} );

	ts_it( 'gives each stock row its own observation date, not the page’s', function () {
		// FOU-04 : chaque déclinaison recevait la date de la dernière page.
		global $wpdb;
		$table = \Teeshoop\Core\Disponibilite::table();
		$vieux = gmdate( 'Y-m-d H:i:s', time() - 5 * DAY_IN_SECONDS );
		$frais = gmdate( 'Y-m-d H:i:s', time() - 60 );
		foreach ( array( 'ZZFOU04AVIEUX' => $vieux, 'ZZFOU04BFRAIS' => $frais ) as $code => $quand ) {
			$wpdb->replace( $table, array( 'code' => $code, 'stock' => 7, 'stock_supplier' => 0, 'miss' => 0, 'checked_at' => $quand ) );
		}
		$dates = array();
		for ( $offset = 0; null !== $offset; ) {
			$page = \Teeshoop\Core\Disponibilite::stock_page( $offset, 20000 );
			foreach ( $page['rows'] as $row ) {
				$dates[ $row[0] ] = $row[4] ?? '';
			}
			$offset = $page['next'];
		}
		$wpdb->query( $wpdb->prepare( "DELETE FROM {$table} WHERE code IN (%s, %s)", 'ZZFOU04AVIEUX', 'ZZFOU04BFRAIS' ) );
		ts_eq( $dates['ZZFOU04AVIEUX'] ?? '', gmdate( 'c', strtotime( $vieux . ' UTC' ) ), 'l’observation ancienne a pris une autre date' );
		ts_eq( $dates['ZZFOU04BFRAIS'] ?? '', gmdate( 'c', strtotime( $frais . ' UTC' ) ), 'l’observation fraîche a pris la date de la plus ancienne' );
	} );

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
	ts_ac_forget_supply();

	/*
	 * LE PRODUIT BRUT EST DÉPOSÉ, PUIS L'IMPORT LE RELIT. `Importer::one()`
	 * appelle `Supply::entry()`, qui lit le dépôt et demande le prix et le stock
	 * au service ; le gabarit HTTP répond pour la seconde moitié seulement. La
	 * cartographie `Supply::to_entry()` est donc EXERCÉE ici, ce qui n'était pas
	 * le cas quand ce fichier injectait sa sortie.
	 */
	ts_ac_seed_supply();
	$imported = Importer::one( '18001' );
	ts_it( 'imports the blank the workshop will buy, through the real importer', function () use ( $imported ) {
		ts_assert( 'failed' !== ( $imported['outcome'] ?? 'failed' ), 'import refusé : ' . implode( ' / ', (array) ( $imported['problems'] ?? array() ) ) );
		ts_assert( null !== ts_ac_variation( '180010004' ), 'l’article 180010004 n’a pas été écrit' );
	} );

	ts_it( 'maps the supplier’s own payload into the article the workshop buys', function () {
		/*
		 * CE CAS N'EXISTAIT PAS, et il ne pouvait pas exister : le gabarit
		 * rendait la SORTIE de la cartographie, donc un défaut dedans était
		 * invisible. Les trois faits vérifiés sont ceux dont dépend de l'argent :
		 * le coloris (qui désigne l'article), la taille (idem) et le prix
		 * d'achat, qui est le plancher sous le prix de vente.
		 */
		$variation = ts_ac_variation( '180010004' );
		ts_assert( $variation instanceof \WC_Product, 'l’article 180010004 est illisible' );
		ts_eq( $variation->get_attribute( \Teeshoop\Core\Taxonomy::taxonomy( 'couleur' ) ), 'White', 'le coloris cartographié' );
		ts_eq( $variation->get_attribute( \Teeshoop\Core\Taxonomy::taxonomy( 'taille' ) ), 'M', 'la taille cartographiée' );
		ts_eq( (int) $variation->get_meta( Catalogue::META_SUPPLY_CENTS, true ), 337, 'le prix d’achat en centimes' );
		ts_eq( (int) $variation->get_stock_quantity(), 900, 'le stock écrit sur l’article' );

		// Et le 2XL, qui est le seul à un autre tarif : 4,46 EUR contre 3,37.
		$big = ts_ac_variation( '180010007' );
		ts_assert( $big instanceof \WC_Product, 'l’article 180010007 est illisible' );
		ts_eq( (int) $big->get_meta( Catalogue::META_SUPPLY_CENTS, true ), 446, 'le prix d’achat du 2XL' );
	} );

	ts_it( 'resolves a colour whose slug also exists in another taxonomy, and ignores a trashed twin', function () {
		/*
		 * FOU-05. « royal » existe dans `pa_couleur` et dans l'ancien `pa_color`
		 * de la production : la jointure par slug seul rendait deux lignes, la
		 * case était « ambiguë » et sortait de la vérification du panier. Une
		 * déclinaison à la corbeille faisait la même chose.
		 */
		$variation = ts_ac_variation( '180010004' );
		$blank     = (int) $variation->get_parent_id();
		// `get_post_meta` and not `get_meta`: WooCommerce keeps `attribute_*` as
		// internal keys of a variation and `get_meta` does not return them.
		$slug      = (string) get_post_meta( $variation->get_id(), 'attribute_' . \Teeshoop\Core\Taxonomy::taxonomy( 'couleur' ), true );
		$taille    = (string) get_post_meta( $variation->get_id(), 'attribute_' . \Teeshoop\Core\Taxonomy::taxonomy( 'taille' ), true );
		ts_assert( '' !== $slug && '' !== $taille, 'the fixture variation carries no attributes' );
		$homonyme  = wp_insert_term( 'Homonyme ' . $slug, 'product_tag', array( 'slug' => $slug ) );

		$jumeau = new \WC_Product_Variation();
		$jumeau->set_parent_id( $blank );
		$jumeau->save();
		update_post_meta( $jumeau->get_id(), 'attribute_' . \Teeshoop\Core\Taxonomy::taxonomy( 'couleur' ), $slug );
		update_post_meta( $jumeau->get_id(), 'attribute_' . \Teeshoop\Core\Taxonomy::taxonomy( 'taille' ), $taille );
		wp_trash_post( $jumeau->get_id() );

		$index = ( new \ReflectionMethod( Purchase::class, 'variation_index' ) )->invoke( null, $blank );
		wp_delete_post( $jumeau->get_id(), true );
		if ( ! is_wp_error( $homonyme ) ) {
			wp_delete_term( (int) $homonyme['term_id'], 'product_tag' );
		}
		$case = $index[ $slug . "\x00" . $taille ] ?? array();
		ts_eq( $case['ambigu'] ?? null, false, 'une case résolue par l’achat est marquée ambiguë et sort de la vérification' );
		ts_eq( $case['id'] ?? 0, $variation->get_id(), 'la case ne désigne pas la déclinaison vivante' );
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

	// ── une création, deux coloris, une seule ligne ──────────────────────────

	ts_it( 'buys both colours of one line, in the quantities each was sold in', function () use ( $product_id ) {
		/*
		 * ── LE CŒUR DU CHANGEMENT DU 9 SEPTEMBRE 2026, ET RIEN NE LE TESTAIT ─
		 *
		 * Une ligne portait un coloris. Depuis, elle porte une matrice, parce
		 * qu'un acheteur qui veut douze blancs et huit noirs de la MÊME création
		 * ne doit pas payer plus cher pour avoir choisi deux couleurs : la
		 * remise de quantité s'applique par ligne, et trois coloris en trois
		 * lignes ont été mesurés à 102,00 EUR de plus sur trente pièces.
		 *
		 * Ce que l'atelier doit acheter derrière est le point aveugle : le
		 * numéro d'article dépend du COLORIS autant que de la taille, et
		 * `_teeshoop_size_grid` seul dit « dix-sept M » sans dire lesquels sont
		 * noirs. Se tromper ici ne se voit pas avant l'ouverture du carton.
		 *
		 * Les trois articles attendus, lus dans le gabarit brut :
		 *   180010004  blanc M  12
		 *   180011014  noir  M   5
		 *   180011015  noir  L   3
		 */
		$order = ts_ac_order_matrix(
			$product_id,
			array(
				'white' => array( 'M' => 12 ),
				'black' => array( 'M' => 5, 'L' => 3 ),
			),
			'rrrrrrrrrrrrrrrr1818'
		);

		// La ligne porte bien les deux dimensions, et la grille en est la somme.
		$item = null;
		foreach ( $order->get_items() as $one ) {
			$item = $one;
			break;
		}
		ts_assert( $item instanceof \WC_Order_Item_Product, 'la commande ne porte aucune ligne' );
		ts_eq(
			json_decode( (string) $item->get_meta( '_teeshoop_matrix', true ), true ),
			array( 'white' => array( 'M' => 12 ), 'black' => array( 'M' => 5, 'L' => 3 ) ),
			'la matrice gelée sur la ligne'
		);
		ts_eq(
			json_decode( (string) $item->get_meta( '_teeshoop_size_grid', true ), true ),
			array( 'M' => 17, 'L' => 3 ),
			'la grille agrégée, que tout ce qui presse continue de lire'
		);

		$basket = Purchase::basket( array( $order->get_id() ) );
		ts_assert( $basket['complete'], 'le panier de deux coloris est incomplet : ' . wp_json_encode( $basket['unresolved'] ) );

		$by = array();
		foreach ( $basket['rows'] as $row ) {
			$by[ (string) $row['sku'] ] = (int) $row['qty'];
		}
		ts_eq( $by['180010004'] ?? 0, 12, 'les M blancs achetés' );
		ts_eq( $by['180011014'] ?? 0, 5, 'les M noirs achetés' );
		ts_eq( $by['180011015'] ?? 0, 3, 'les L noirs achetés' );
		ts_eq( count( $by ), 3, 'trois articles et pas un de plus : ' . wp_json_encode( array_keys( $by ) ) );
		ts_eq( (int) $basket['garments'], 20, 'vingt vêtements au panier' );

		// 20 x 3,37 EUR : les trois articles sont sur des petites tailles.
		ts_eq( (int) $basket['blanks_ht'], 6740, 'attendu 67,40 EUR de textile' );

		/*
		 * ET LES DEUX COLORIS PARTENT VRAIMENT CHEZ LE FOURNISSEUR. Le panier
		 * juste ne suffit pas : c'est le document transmis qui commande les
		 * cartons, et c'est lui qu'un opérateur ne relit pas.
		 */
		$prepared = Purchase::prepare( array( $order->get_id() ) );
		ts_assert( ! empty( $prepared['ok'] ), 'préparation refusée : ' . ( $prepared['reason'] ?? '' ) );
		$GLOBALS['ts_ac_sent']  = array();
		$GLOBALS['ts_ac_order'] = array( 'outcome' => 'accepted' );
		$done                   = Purchase::send( (int) $prepared['id'], 'test' );
		ts_assert( ! empty( $done['ok'] ), 'envoi refusé : ' . ( $done['reason'] ?? '' ) );

		$sent = array();
		foreach ( (array) ( $GLOBALS['ts_ac_sent'][0]['order_lines'] ?? array() ) as $line ) {
			$sent[ (string) $line['reference'] ] = (int) $line['quantity'];
		}
		ts_eq( $sent, array( '180010004' => 12, '180011014' => 5, '180011015' => 3 ), 'les lignes transmises au fournisseur' );

		Purchase::receive( (int) $prepared['id'] );
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
		/*
		 * ── VENDU QUAND IL EN AVAIT, ACHETÉ QUAND IL N'EN A PLUS ────────────
		 *
		 * Ce cas commandait vingt 2XL contre huit en rayon et laissait
		 * `Cart::add` passer, parce que le panier ne demandait rien au
		 * fournisseur. Depuis le 9 septembre 2026 il le demande, et il refuse :
		 * « Il reste 8 exemplaires, ramenez la quantité à 8 ». Une caisse qui
		 * refuse de vendre ce qui n'existe pas est le comportement voulu, donc
		 * l'ancienne mise en scène ne peut plus arriver.
		 *
		 * Celle-ci arrive tous les jours : le client a acheté quand le stock
		 * était plein, et le fournisseur s'est vidé entre la vente et l'achat du
		 * nu, qui a lieu APRÈS. C'est exactement le moment où l'atelier doit
		 * l'apprendre, et c'est ce que ce cas mesure maintenant.
		 *
		 * Les deux états passent par le chemin livré : le stock du service est
		 * remplacé, puis `Importer::one()` le réécrit sur l'article, comme un
		 * rafraîchissement quotidien le ferait. Rien n'est poussé à la main dans
		 * une méta, sinon le test prouverait ce qu'il a écrit lui-même.
		 */
		$plein = ts_ac_live_default();
		$plein['180010007']['stock'] = '500';
		$GLOBALS['ts_ac_live']       = $plein;

		$order = ts_ac_order( $product_id, array( '2XL' => 20 ), 'white', 'eeeeeeeeeeeeeeee5555' );

		unset( $GLOBALS['ts_ac_live'] );
		Importer::one( '18001' );
		ts_eq( (int) ts_ac_variation( '180010007' )->get_stock_quantity(), 8, 'le stock du fournisseur après réassort manqué' );

		$basket = Purchase::basket( array( $order->get_id() ) );
		ts_assert( 1 === count( $basket['stock']['short'] ), 'la rupture n’est pas signalée' );
		ts_assert( 8 === (int) $basket['stock']['short'][0]['have'], 'le stock annoncé n’est pas celui du fournisseur' );
		ts_assert( 20 === (int) $basket['stock']['short'][0]['want'], 'la quantité demandée n’est pas celle de la commande' );
		// And it is a warning, not a refusal: the supplier restocks.
		ts_assert( $basket['complete'], 'une rupture a bloqué un panier par ailleurs identifiable' );

		/*
		 * ── ET IL N'ANNONCE AUCUNE DATE, CE QUI EST LA RÉPONSE HONNÊTE ───────
		 *
		 * Ce cas exigeait « 2026-09-08 » et 120 pièces, lus sur une route de
		 * réapprovisionnement de l'ANCIEN service. Le nouveau n'en publie
		 * aucune : il donne `stock_supplier`, la quantité que le FABRICANT a
		 * derrière le grossiste, et rien sur la date à laquelle elle arriverait
		 * chez lui. `Supply::deliveries()` rend donc un tableau vide, exprès, et
		 * la question est posée au fournisseur dans `QUESTIONS-ASSOCIE.md`.
		 *
		 * L'assertion n'est pas retirée, elle est retournée : ce qui doit être
		 * vrai maintenant, c'est que la boutique n'INVENTE pas une date. Une
		 * promesse de délai faite à un client sur une donnée qui n'existe pas
		 * est plus chère qu'une absence de promesse, et ce cas échouera le jour
		 * où quelqu'un dérivera une date de `stock_supplier`.
		 */
		ts_eq( (string) $basket['stock']['short'][0]['back_on'], '', 'une date de réapprovisionnement est annoncée alors que le service n’en publie aucune' );
		ts_eq( (int) $basket['stock']['short'][0]['back_qty'], 0, 'une quantité de réapprovisionnement est annoncée sans date' );
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
				// What the studio measures on an honest order: the ink it was billed for.
				'measured_sides' => ts_measured_as_billed( $order ),
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

		/*
		 * NOTRE CLÉ VOYAGE, TRONQUÉE À CE QUE LE SERVICE ACCEPTE. Vingt
		 * caractères, imposés par son propre schéma : c'est comparé à
		 * `substr(clé, 0, 20)` et pas à la clé entière, parce qu'un identifiant
		 * d'achat à sept chiffres pousse la clé à vingt et un et que
		 * l'assertion doit décrire ce qui part, pas ce qu'on aurait aimé.
		 */
		ts_eq( (string) $body['reference_internal'], substr( (string) $prepared['purchase']['key'], 0, 20 ), 'la clé envoyée n’est pas celle du dossier' );

		/*
		 * L'ADRESSE DE LIVRAISON EST DANS LE DOCUMENT, et elle est la nôtre.
		 * Le nouveau service l'exige ligne par ligne ; sans elle, la commande
		 * est refusée chez lui. Le cinq champs sont vérifiés non vides plutôt
		 * que comparés à des littéraux : ils viennent de l'identité légale de
		 * la boutique, qu'un exploitant peut changer sans casser ce test.
		 */
		$ship = (array) ( $body['shipping_address'] ?? array() );
		foreach ( array( 'name', 'address', 'zip', 'city', 'country_code' ) as $field ) {
			ts_assert( '' !== trim( (string) ( $ship[ $field ] ?? '' ) ), 'l’adresse de livraison ne porte pas « ' . $field . ' »' );
		}

		$qty = 0;
		foreach ( (array) $body['order_lines'] as $line ) {
			ts_assert( 1 === preg_match( '/^\d{9}$/', (string) $line['reference'] ), 'une ligne ne porte pas un article à neuf chiffres' );
			$qty += (int) $line['quantity'];
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

		// UN REFUS EST UN 422 PORTANT CHAMP VERS PHRASES, la seule forme de refus
		// que ce service publie. Voir le gabarit, route `create-order`.
		$GLOBALS['ts_ac_order'] = array(
			'outcome' => 'rejected',
			'errors'  => array( 'order_lines.0.reference' => array( 'La référence 180010004 est introuvable.' ) ),
		);
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

	ts_it( 'never invents a partial acceptance the new service has never shown', function () use ( $product_id ) {
		/*
		 * ── LE SEUL CAS DE CE FICHIER QUI A CHANGÉ DE SUJET ─────────────────
		 *
		 * Il conduisait `Purchase::PARTIAL` avec une réponse de l'ANCIEN
		 * service : un numéro de commande À CÔTÉ d'une liste de lignes
		 * refusées. Le nouveau ne publie que deux formes de réponse à
		 * `create-order`, et les deux ont été mesurées : un 2xx portant
		 * `order_id`, ou un 422 portant champ vers phrases.
		 * `Supply::place_order()` n'a donc AUCUN chemin vers `partial`, et
		 * lui en fabriquer un demanderait de deviner à quoi ressemble une
		 * commande servie à moitié chez lui.
		 *
		 * Ce cas mesure donc ce qui peut l'être sans inventer : l'état existe
		 * toujours dans la machine (l'écran et le dossier savent l'exprimer),
		 * et AUCUNE des deux réponses connues ne le produit. Il échouera le
		 * jour où quelqu'un fera dire « partielle » à une réponse dont ce
		 * n'est pas ce qu'elle dit.
		 *
		 * La question « à quoi ressemble une commande partiellement servie »
		 * est posée dans `QUESTIONS-ASSOCIE.md`. Le jour où une vraie réponse
		 * est capturée, ce cas redevient celui qu'il était.
		 */
		ts_assert( isset( Purchase::states()[ Purchase::PARTIAL ] ), 'l’état « partielle » a disparu de la machine, donc plus rien ne saurait l’exprimer' );

		$order    = ts_ac_order( $product_id, array( 'M' => 2, 'L' => 2 ), 'white', 'mmmmmmmmmmmmmmmm1414' );
		$prepared = Purchase::prepare( array( $order->get_id() ) );
		ts_assert( ! empty( $prepared['ok'] ), 'préparation refusée : ' . ( $prepared['reason'] ?? '' ) );

		// Un 2xx qui nomme une commande : c'est une acceptation, entière.
		$GLOBALS['ts_ac_order'] = array( 'outcome' => 'accepted', 'orderId' => '4412346' );
		$done                   = Purchase::send( (int) $prepared['id'], 'test' );
		ts_assert( ! empty( $done['ok'] ), 'une commande acceptée a été rapportée comme un échec : ' . ( $done['reason'] ?? '' ) );
		ts_eq( $done['state'], Purchase::SENT, 'une réponse portant un numéro de commande' );
		ts_assert( null !== Purchase::part_of( wc_get_order( $order->get_id() ) ), 'une commande créée chez le fournisseur a été détachée' );

		Purchase::receive( (int) $prepared['id'] );
	} );

	ts_it( 'never unpins orders on an answer that may have created one', function () use ( $product_id ) {
		/*
		 * UNE ACCEPTATION SANS NUMÉRO, qui est ce qu'une réponse tronquée ou un
		 * changement de schéma produit. Elle ne peut pas être lue comme un
		 * refus : un refus RELÂCHE les commandes pour qu'on puisse les racheter,
		 * et une commande que le fournisseur a peut-être créée serait alors
		 * créée deux fois, donc les cartons arrivent deux fois.
		 *
		 * L'ancienne forme (« unknown » à côté d'un numéro de commande) n'existe
		 * plus : chez ce service, un numéro EST une acceptation. Ce qui reste
		 * incertain, c'est une réponse acceptée qui ne nomme rien.
		 */
		$order    = ts_ac_order( $product_id, array( 'M' => 2 ), 'white', 'nnnnnnnnnnnnnnnn1515' );
		$prepared = Purchase::prepare( array( $order->get_id() ) );
		$GLOBALS['ts_ac_order'] = array( 'outcome' => 'unknown', 'message' => 'err 12' );
		$done = Purchase::send( (int) $prepared['id'], 'test' );
		ts_assert( Purchase::UNCERTAIN === $done['state'], 'état ' . $done['state'] . ' pour une réponse qui ne nomme aucune commande' );
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
				if ( str_contains( (string) $url, '/api/orders/create-order' ) ) {
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

	ts_it( 'will not send against a mode that is not the one declared', function () use ( $product_id ) {
		/*
		 * ── CE QUI A REMPLACÉ « le mode a voyagé avec la commande » ──────────
		 *
		 * L'ancien service publiait son mode sur une route, et le document
		 * partait avec, ce que cette suite vérifiait en lisant le corps envoyé.
		 * Le nouveau n'a pas de route de ce genre : la préproduction et la
		 * production sont deux ADRESSES, et rien dans une réponse ne dit
		 * laquelle on interroge. Le mode est donc DÉCLARÉ dans
		 * `TEESHOOP_SUPPLY_MODE`, et ce qui protège l'argent n'est plus un champ
		 * dans le corps mais le refus de partir quand l'appelant croit autre
		 * chose que ce qui est déclaré.
		 *
		 * C'est une assertion plus forte que celle qu'elle remplace : elle
		 * mesure qu'AUCUN octet ne part, au lieu de mesurer ce qu'un octet
		 * contenait.
		 */
		$order    = ts_ac_order( $product_id, array( 'M' => 2 ), 'white', 'qqqqqqqqqqqqqqqq1717' );
		$prepared = Purchase::prepare( array( $order->get_id() ) );
		$before   = count( $GLOBALS['ts_ac_sent'] );
		$done     = Purchase::send( (int) $prepared['id'], 'live' );
		ts_assert( empty( $done['ok'] ), 'un envoi en « réel » est passé sur un compte déclaré « essai »' );
		ts_assert( count( $GLOBALS['ts_ac_sent'] ) === $before, 'un document est parti vers le mauvais compte' );
		ts_assert( str_contains( (string) $done['reason'], 'essai' ) || str_contains( (string) $done['reason'], 'test' ), 'le refus ne nomme pas le mode : ' . $done['reason'] );
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
	ts_ac_forget_supply();

	/*
	 * ET LE NETTOYAGE EST LUI-MÊME VÉRIFIÉ, comme la balayeuse d'`integration.php`.
	 *
	 * Les deux tables du fournisseur portent de vraies données sur ce miroir
	 * (3 241 produits, 1 060 disponibilités synchronisés depuis le service), donc
	 * la question n'est pas « sont-elles vides » mais « nos lignes sont-elles
	 * parties ». Une ligne de disponibilité laissée derrière est fraîche pendant
	 * six heures, et la prochaine exécution croirait un relevé qu'elle n'a pas
	 * fait : « le relevé est cru » passerait alors sans que rien ne l'ait écrit.
	 */
	ts_it( 'leaves neither a deposited product nor a stock row behind', function () {
		global $wpdb;
		$codes = array_keys( ts_ac_live_default() );
		ts_eq(
			(int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM `' . \Teeshoop\Core\Supply::table() . '` WHERE ref = %s', '18001' ) ),
			0,
			'le produit brut est resté dans le dépôt du catalogue'
		);
		ts_eq(
			(int) $wpdb->get_var(
				$wpdb->prepare(
					'SELECT COUNT(*) FROM `' . \Teeshoop\Core\Disponibilite::table() . '` WHERE code IN ('
						. implode( ', ', array_fill( 0, count( $codes ), '%s' ) ) . ')',
					$codes
				)
			),
			0,
			'des lignes de disponibilité de ce gabarit sont restées'
		);
	} );

	$settings               = (array) get_option( 'teeshoop_settings', array() );
	$settings['worker_url'] = $saved_worker;
	update_option( 'teeshoop_settings', $settings );
}
