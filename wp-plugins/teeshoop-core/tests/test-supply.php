<?php
/**
 * L'adaptateur fournisseur, contre de VRAIES charges utiles.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI LES GABARITS SONT DES RÉPONSES RÉELLES ET NON DES EXEMPLES ÉCRITS
 *
 * `tests/fixtures/supply-products.json` et `supply-pricestock.json` sont des
 * réponses du service, capturées le 9 septembre 2026, réduites à huit coloris
 * par référence et non modifiées autrement. Cinq références choisies pour les
 * cas qui font mal, pas pour la moyenne :
 *
 *   BC01B  un t-shirt B&C : huit coloris sur huit portent une teinte déclarée ;
 *   1500KC un bonnet Flexfit : ZÉRO teinte déclarée, huit coloris sur huit ;
 *   BY004  un t-shirt : UN coloris sur huit porte une teinte, ce qui est le cas
 *          mixte, le seul où un jeu partiel peut passer pour un jeu complet ;
 *   BE3480 un t-shirt Bella + Canvas dont le prix d'achat varie de 4,90 à 6,95
 *          selon coloris ET taille ;
 *   BC042  un t-shirt dont le prix varie selon le COLORIS et pas la taille.
 *
 * Écrire des exemples à la main aurait donné cinq produits qui se ressemblent
 * et aucune de ces cinq formes. La mesure qui a servi à les choisir est dans
 * l'en-tête de `Supply.php`.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

/*
 * LIGNE DE COMMANDE UNIQUEMENT. `wp-content/plugins/` est servi par URL et ce
 * répertoire est dedans : sans cette ligne, un GET exécute la suite pour le
 * public, avec les figures de chaque assertion qui échoue.
 */
if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

require_once __DIR__ . '/../includes/Money.php';
require_once __DIR__ . '/../includes/Catalogue.php';
require_once __DIR__ . '/../includes/Supply.php';

/**
 * Les cinq produits capturés.
 *
 * @return array<string,array<string,mixed>>
 */
function ts_supply_products(): array {
	static $cache = null;
	if ( null === $cache ) {
		$cache = json_decode( (string) file_get_contents( __DIR__ . '/fixtures/supply-products.json' ), true );
	}
	return is_array( $cache ) ? $cache : array();
}

/**
 * Prix et stock en direct, tels que le service les a rendus, remis dans la
 * forme que `Disponibilite::for_reference()` produit.
 *
 * La conversion est faite ICI et pas dans un utilitaire partagé avec le code
 * de production : un gabarit qui passe par le convertisseur qu'il teste ne
 * prouve que la cohérence du convertisseur avec lui-même, ce qui est la raison
 * pour laquelle `scripts/dtf-verify.mjs` ouvre ses archives avec son propre
 * lecteur.
 *
 * @return array{ok:bool,rows:array<string,array<string,mixed>>,error:string}
 */
function ts_supply_live( string $ref ): array {
	static $cache = null;
	if ( null === $cache ) {
		$cache = json_decode( (string) file_get_contents( __DIR__ . '/fixtures/supply-pricestock.json' ), true );
	}
	$body = is_array( $cache ) ? ( $cache[ $ref ] ?? array() ) : array();
	$rows = array();
	foreach ( (array) ( $body['products'] ?? array() ) as $code => $row ) {
		$price = (float) ( $row['price'] ?? 0 );
		$rows[ (string) $code ] = array(
			'cents'          => $price > 0 ? (int) round( $price * 100 ) : null,
			'stock'          => isset( $row['stock'] ) ? (int) $row['stock'] : null,
			'stock_supplier' => isset( $row['stock_supplier'] ) ? (int) $row['stock_supplier'] : null,
		);
	}
	return array(
		'ok'    => array() !== $rows,
		'rows'  => $rows,
		'error' => '',
	);
}

// ---------------------------------------------------------------------------

describe(
	'Supply: le classement, qui décide d’un prix',
	static function (): void {

		it(
			'range les cinq références là où un acheteur les cherche',
			static function (): void {
				$attendu = array(
					'BC01B'  => array( 'tee', 'tshirt' ),
					'BC042'  => array( 'tee', 'tshirt' ),
					'BE3480' => array( 'tee', 'tshirt' ),
					'BY004'  => array( 'tee', 'tshirt' ),
					// Un bonnet n'est PAS un vêtement à imprimer : `kind` décide
					// du plancher de prix, et lui donner `tee` vendrait un bonnet
					// au tarif d'un t-shirt.
					'1500KC' => array( 'other', 'bonnet' ),
				);
				foreach ( ts_supply_products() as $ref => $product ) {
					$facts = Supply::classify( $product );
					eq( $facts['kind'], $attendu[ $ref ][0], $ref . ' : vêtement' );
					eq( $facts['shelf'], $attendu[ $ref ][1], $ref . ' : rayon' );
				}
			}
		);

		it(
			'normalise les accents et la ponctuation du vocabulaire fournisseur',
			static function (): void {
				/*
				 * Relevé sur le catalogue entier : « RECYCLÉ » et « RECYCLE »,
				 * « HAUTE VISIBILITE » et « HAUTE-VISIBILITÉ », « SWEAT ZIPPÉ
				 * CAPUCHE » et « SWEAT ZIPPE CAPUCHE » coexistent. Comparer les
				 * chaînes telles quelles range le même vêtement dans deux rayons
				 * selon la déclinaison qu'on regarde.
				 */
				eq( Supply::fold( 'SWEAT ZIPPÉ CAPUCHE' ), 'SWEAT ZIPPE CAPUCHE' );
				eq( Supply::fold( 'Haute-Visibilité' ), 'HAUTE VISIBILITE' );
				eq( Supply::fold( 'VESTE - BLOUSON' ), 'VESTE BLOUSON' );
				eq( Supply::fold( 'CRAVATE - NŒUD' ), 'CRAVATE NOEUD' );
			}
		);

		it(
			'ne classe pas un sac de sport comme un vêtement de sport',
			static function (): void {
				/*
				 * Le veto passe AVANT la table des vêtements. Un sac est rangé
				 * sous « SPORT » comme un t-shirt de sport, et sans veto il
				 * hériterait du `kind` d'un t-shirt, donc de son plancher.
				 */
				$sac = array(
					'variants' => array(
						array(
							'categories' => array(
								array(
									'categories' => array( 'fr' => 'SPORT' ),
									'families'   => array( 'fr' => 'SAC DE SPORT' ),
								),
							),
						),
					),
				);
				$facts = Supply::classify( $sac );
				eq( $facts['kind'], 'other', 'jamais un vêtement à imprimer' );
				eq( $facts['shelf'], 'sac', 'et il est quand même rangé' );
			}
		);

		it(
			'compare des mots entiers et pas des sous-chaînes',
			static function (): void {
				// « SAC » en sous-chaîne attraperait n'importe quel mot qui le
				// contient, et c'est ainsi qu'un classement se met à ranger au
				// hasard six mois après avoir été écrit.
				$faux = array(
					'variants' => array(
						array(
							'categories' => array(
								array(
									'categories' => array( 'fr' => 'TEE-SHIRT' ),
									'families'   => array( 'fr' => 'SACOCHE' ),
								),
							),
						),
					),
				);
				eq( Supply::classify( $faux )['kind'], 'tee', 'SACOCHE ne contient pas le mot SAC' );
			}
		);
	}
);

describe(
	'Supply: la teinte déclarée',
	static function (): void {

		it(
			'accepte les deux formes que le service publie, et rien d’autre',
			static function (): void {
				// Relevé : « #eb5d0f » sur certaines lignes et « FFFFFF » sur
				// d'autres, dans le même flux.
				eq( Supply::hex( '#eb5d0f' ), '#eb5d0f' );
				eq( Supply::hex( 'FFFFFF' ), '#ffffff' );
				eq( Supply::hex( '' ), '' );
				eq( Supply::hex( '19-4053 / 15-1157' ), '', 'un code Pantone n’est pas une teinte' );
				eq( Supply::hex( '0 74 99 0' ), '', 'du CMJN non plus' );
				eq( Supply::hex( '#fff' ), '', 'trois chiffres ne sont pas six' );
			}
		);

		it(
			'ne peint rien quand le fournisseur ne déclare pas de teinte',
			static function (): void {
				/*
				 * MESURÉ : sur 75 088 déclinaisons, 14 568 portent une teinte
				 * (19 %). Le bonnet 1500KC n'en a aucune sur ses huit coloris.
				 * Publier une pastille grise sous « BLACK » serait du contenu
				 * fabriqué ; `Product::blank_palette_of` laisse d'ailleurs
				 * tomber une pastille sans couleur mesurée. Le nuancier sort
				 * donc VIDE ici, et `Colours` mesure la photographie.
				 */
				$entry = Supply::to_entry( ts_supply_products()['1500KC'], ts_supply_live( '1500KC' ) );
				$avec  = 0;
				foreach ( $entry['style']['colourways'] as $cw ) {
					truthy( '' !== $cw['name'], 'chaque coloris garde son nom' );
					if ( '' !== $cw['swatch'] ) {
						++$avec;
					}
				}
				eq( $avec, 0, 'aucune teinte inventée sur une référence qui n’en publie pas' );
				truthy( count( $entry['style']['colourways'] ) >= 8, 'et les coloris sont tous là' );
			}
		);

		it(
			'garde la teinte de chaque coloris quand elle existe',
			static function (): void {
				$entry = Supply::to_entry( ts_supply_products()['BC01B'], ts_supply_live( 'BC01B' ) );
				foreach ( $entry['style']['colourways'] as $cw ) {
					eq( 1, preg_match( '/^#[0-9a-f]{6}$/', $cw['swatch'] ), $cw['name'] . ' porte une teinte normalisée' );
				}
			}
		);
	}
);

describe(
	'Supply: prix et stock, et la différence entre absent et illisible',
	static function (): void {

		it(
			'ne publie AUCUN prix quand le service n’a pas répondu',
			static function (): void {
				/*
				 * C'est la règle qui a déjà coûté le coût d'achat de 366
				 * déclinaisons une fois. `Catalogue::map()` lit `pricesError`
				 * pour décider s'il a le droit de toucher à ce qui est en base ;
				 * un tableau vide SANS motif lui ferait effacer.
				 */
				$muet  = array(
					'ok'    => false,
					'rows'  => array(),
					'error' => 'injoignable',
				);
				$entry = Supply::to_entry( ts_supply_products()['BC01B'], $muet );
				eq( $entry['prices'], null, 'pas de tarif' );
				eq( $entry['stock'], null, 'pas de stock' );
				eq( $entry['pricesError'], 'upstream', 'et le motif dit pourquoi' );
				eq( $entry['stockError'], 'upstream' );

				$mapped = Catalogue::map( $entry );
				truthy( $mapped['ok'], 'la référence reste importable' );
				truthy( ! $mapped['has_prices'], 'mais sans toucher aux prix' );
				truthy( ! $mapped['has_stock'], 'ni aux quantités' );
			}
		);

		it(
			'ne présente jamais le « publicPrice » du fournisseur comme un prix',
			static function (): void {
				/*
				 * MESURÉ : sur la référence 1500KC, `defaultPrice` vaut 4 et
				 * `publicPrice` vaut 3, donc SOUS notre prix d'achat. L'afficher
				 * comme prix barré serait un prix de référence fictif, interdit
				 * par l'article L. 112-1-1 du code de la consommation. Le champ
				 * `list` reste donc nul partout.
				 */
				foreach ( array_keys( ts_supply_products() ) as $ref ) {
					$entry = Supply::to_entry( ts_supply_products()[ $ref ], ts_supply_live( $ref ) );
					foreach ( (array) ( $entry['prices']['prices'] ?? array() ) as $code => $row ) {
						eq( $row['list'], null, $ref . ' / ' . $code . ' ne porte aucun prix conseillé' );
						truthy( $row['cost'] > 0, $ref . ' / ' . $code . ' porte un prix d’achat' );
					}
				}
			}
		);

		it(
			'ne vend que contre le stock du grossiste, pas celui du fabricant',
			static function (): void {
				/*
				 * Le service donne deux nombres et les NOMME, ce que l'ancien ne
				 * faisait pas : `stock` est ce que le grossiste a sur ses
				 * étagères, `stock_supplier` ce que le fabricant a derrière lui.
				 * Vendre contre le second prendrait des commandes qu'on ne peut
				 * pas honorer. `Catalogue::STOCK_INDEX` pointe sur le premier.
				 */
				$entry = Supply::to_entry( ts_supply_products()['BC01B'], ts_supply_live( 'BC01B' ) );
				$live  = ts_supply_live( 'BC01B' );
				$vus   = 0;
				foreach ( $entry['stock']['stock'] as $code => $triple ) {
					eq( $triple[ Catalogue::STOCK_INDEX ], (int) $live['rows'][ $code ]['stock'], $code );
					eq( $triple[2], (int) $live['rows'][ $code ]['stock_supplier'], $code . ' : le fabricant est gardé à part' );
					++$vus;
				}
				truthy( $vus > 0, 'au moins une ligne de stock a été comparée' );
			}
		);

		it(
			'horodate le stock à l’instant de la demande, pas à celui du flux',
			static function (): void {
				/*
				 * MESURÉ : le flux de stock en masse du service porte des dates
				 * vieilles de quatre mois en préproduction (dernière mise à jour
				 * le 29 avril 2026), alors que la route en direct répond au
				 * moment où on l'interroge. Reprendre le `updatedAt` du flux
				 * ferait passer pour fraîche une observation qui ne l'est pas.
				 */
				$entry = Supply::to_entry( ts_supply_products()['BC01B'], ts_supply_live( 'BC01B' ) );
				$at    = (string) $entry['stock']['at'];
				truthy( '' !== $at, 'il y a une date' );
				truthy( abs( time() - (int) strtotime( $at ) ) < 120, 'et c’est maintenant' );
			}
		);
	}
);

describe(
	'Supply: la charge utile traverse Catalogue::map sans perte',
	static function (): void {

		it(
			'produit un produit importable pour les cinq références réelles',
			static function (): void {
				foreach ( ts_supply_products() as $ref => $product ) {
					$entry  = Supply::to_entry( $product, ts_supply_live( $ref ) );
					$mapped = Catalogue::map( $entry );

					truthy( $mapped['ok'], $ref . ' : importable (' . implode( ' / ', $mapped['problems'] ?? array() ) . ')' );
					eq( $mapped['ref'], $ref, $ref . ' : la référence traverse' );
					truthy( '' !== $mapped['name'], $ref . ' : porte un nom' );
					truthy( '' !== $mapped['brand'], $ref . ' : porte une marque' );
					truthy( count( $mapped['variations'] ) > 0, $ref . ' : porte des articles' );
					truthy( $mapped['has_prices'], $ref . ' : porte des prix' );
					truthy( $mapped['has_stock'], $ref . ' : porte des quantités' );
				}
			}
		);

		it(
			'ne publie jamais la référence du grossiste comme référence publique',
			static function (): void {
				/*
				 * LA FUITE QUE CECI FERME, et elle a déjà eu lieu une fois avec
				 * l'ancien fournisseur : le numéro d'article est la référence
				 * produit SUIVIE du code coloris et de la taille (« BC01B » plus
				 * « SM » plus « L » font « BC01BSML »). Publier « BC01B » rend
				 * donc l'essentiel de la clé d'approvisionnement que
				 * `Shelf::SEALED` existe pour cacher.
				 *
				 * Ce qui est publié est le nom de modèle du FABRICANT, qui est
				 * ce qu'un acheteur cherche : B&C appelle ce t-shirt
				 * « #INSPIRE E150 ».
				 */
				foreach ( ts_supply_products() as $ref => $product ) {
					$mapped = Catalogue::map( Supply::to_entry( $product, ts_supply_live( $ref ) ) );
					$public = (string) $mapped['public_ref'];
					truthy( '' !== $public, $ref . ' : il y a une référence publique' );
					truthy(
						false === stripos( $public, $ref ),
						$ref . ' : « ' . $public . ' » ne contient pas la référence du grossiste'
					);
					foreach ( $mapped['variations'] as $v ) {
						truthy(
							false === stripos( (string) $v['sku_suffix'], $ref ),
							$ref . ' : le suffixe « ' . $v['sku_suffix'] . ' » non plus'
						);
					}
				}
			}
		);

		it(
			'garde le prix d’achat de chaque article, au centime',
			static function (): void {
				/*
				 * L'écart mesuré DANS une référence justifie de vérifier
				 * article par article et pas en moyenne : sur BE3480 le prix
				 * d'achat va de 4,90 à 6,95 EUR selon coloris et taille.
				 */
				$live   = ts_supply_live( 'BE3480' );
				$mapped = Catalogue::map( Supply::to_entry( ts_supply_products()['BE3480'], $live ) );
				$vus    = 0;
				$mini   = PHP_INT_MAX;
				$maxi   = 0;
				foreach ( $mapped['variations'] as $v ) {
					$attendu = $live['rows'][ $v['supply_sku'] ]['cents'] ?? null;
					eq( $v['supply_cents'], $attendu, $v['supply_sku'] );
					if ( null !== $attendu ) {
						$mini = min( $mini, $attendu );
						$maxi = max( $maxi, $attendu );
						++$vus;
					}
				}
				truthy( $vus > 0, 'au moins un prix comparé' );
				truthy(
					$maxi > $mini,
					'et cette référence a bien plusieurs prix d’achat (' . Money::format( $mini ) . ' à ' . Money::format( $maxi ) . ')'
				);
			}
		);

		it(
			'ne fabrique pas la combinaison coloris-taille que le fournisseur ne vend pas',
			static function (): void {
				foreach ( ts_supply_products() as $ref => $product ) {
					$entry = Supply::to_entry( $product, ts_supply_live( $ref ) );
					$vrais = array();
					foreach ( $product['variants'] as $v ) {
						if ( ! empty( $v['deletedAt'] ) || ! empty( $v['underConstruction'] ) ) {
							continue;
						}
						$vrais[ (string) $v['variantReference'] ] = true;
					}
					$mapped = Catalogue::map( $entry );
					foreach ( $mapped['variations'] as $v ) {
						truthy(
							isset( $vrais[ (string) $v['supply_sku'] ] ),
							$ref . ' : « ' . $v['supply_sku'] . ' » est un article que le fournisseur vend'
						);
					}
					eq( count( $mapped['variations'] ), count( $vrais ), $ref . ' : ni plus ni moins' );
				}
			}
		);

		it(
			'lit le grammage et la composition dans les champs, sans expression régulière sur de la prose',
			static function (): void {
				/*
				 * L'ancien fournisseur noyait les deux dans un paragraphe et
				 * `Catalogue::composition()` les en extrayait. Celui-ci les
				 * publie comme des champs : `grammage.value` vaut 145 sur BC01B
				 * et `material.fr` porte la composition complète. La description
				 * est donc ASSEMBLÉE pour l'extracteur, et le test vérifie que
				 * l'aller-retour ne perd rien.
				 */
				$mapped = Catalogue::map( Supply::to_entry( ts_supply_products()['BC01B'], ts_supply_live( 'BC01B' ) ) );
				eq( $mapped['weight_gsm'], 145, 'le grammage publié par le fabricant' );
				truthy( false !== stripos( (string) $mapped['material'], 'coton' ), 'la composition est lue : « ' . $mapped['material'] . ' »' );

				/*
				 * ET ELLE NE COMMENCE PAS PAR LE TITRE, ce qui était le défaut.
				 *
				 * `Catalogue::composition()` cherche la LIGNE qui porte un
				 * pourcentage. La description assemblée joignait ses faits par
				 * des espaces, donc tout tenait sur une ligne et le champ
				 * Matière de la fiche BC03T affichait « Tee-shirt homme col rond
				 * 190. 100% coton... ». Mesuré sur le miroir après un import
				 * réel, le 9 septembre 2026.
				 */
				foreach ( array_keys( ts_supply_products() ) as $ref ) {
					$m = Catalogue::map( Supply::to_entry( ts_supply_products()[ $ref ], ts_supply_live( $ref ) ) );
					$matiere = (string) $m['material'];
					if ( '' === $matiere ) {
						continue;
					}
					truthy(
						1 === preg_match( '/^\s*\d+\s*%/u', $matiere ),
						$ref . ' : la matière commence par un pourcentage, pas par le titre (« ' . $matiere . ' »)'
					);
					truthy(
						false === strpos( $matiere, "\n" ),
						$ref . ' : et elle tient sur une ligne'
					);
				}
			}
		);
	}
);

describe(
	'Supply: le mode du compte, qui autorise ou refuse une commande',
	static function (): void {

		it(
			'refuse toute commande quand le mode n’est pas déclaré',
			static function (): void {
				/*
				 * Le service n'a AUCUN point d'entrée qui dise s'il est en essai
				 * ou en production : ce sont deux adresses, et rien dans une
				 * réponse ne dit laquelle on interroge. Deviner à partir du nom
				 * d'hôte tiendrait jusqu'au jour où le fournisseur renomme son
				 * domaine, et ce jour-là enverrait une commande réelle en
				 * croyant faire un essai.
				 */
				truthy( ! defined( 'TEESHOOP_SUPPLY_MODE' ), 'le test tourne sans mode déclaré' );
				$mode = Supply::mode();
				eq( $mode['mode'], 'unknown' );
				truthy( '' !== $mode['error'], 'et il dit quoi faire' );

				$out = Supply::place_order(
					'CLE-1',
					'test',
					array(
						array(
							'sku'     => 'BC01BSML',
							'qty'     => 2,
							'lineRef' => 'L1',
						),
					),
					array(
						'name'         => 'Teeshoop',
						'address'      => '97 Av Edouard Castelnau',
						'zip'          => '93700',
						'city'         => 'Drancy',
						'country_code' => 'FR',
					)
				);
				truthy( ! $out['ok'], 'rien n’est transmis' );
				eq( $out['outcome'], 'rejected' );
				eq( $out['orderId'], '' );
			}
		);
	}
);
