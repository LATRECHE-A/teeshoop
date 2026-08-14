<?php
/**
 * The catalogue mapping, with no WordPress and no network.
 *
 * Everything asserted here is a decision that would otherwise only be visible
 * after 26 399 rows had been written into a shop. The fixtures are trimmed
 * copies of real payloads from the live webservice on 2026-08-14, including the
 * awkward ones: a grammage that differs by colour, a `g / m²` written with
 * spaces, and a SKU list that is not the cross product of colours and sizes.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

require_once __DIR__ . '/../includes/Money.php';
require_once __DIR__ . '/../includes/Catalogue.php';

/** A payload shaped exactly like one entry from the catalogue route. */
function ts_entry( array $overrides = array() ): array {
	$style = array(
		'styleNr'     => '18001',
		'brand'       => 'Fruit of the Loom',
		'supplierRef' => '61-212-0',
		'name'        => 'Heavy Cotton T',
		'nameEn'      => 'Heavy Cotton T',
		'description' => "·195 g/m² (White: 185 g/m²)\n·100% coton (Heather Grey: 97% coton, 3% polyester)\n·bord côte à l’encolure",
		'categories'  => array( 'Tee-shirts', 'MEILLEURES VENTES' ),
		'kind'        => 'tee',
		'sleeve'      => 'short',
		'gender'      => 'hommes, produits correspondants',
		'neckline'    => 'Crew Neck',
		'fabric'      => array( 'Coton' ),
		'certificates' => array( 'OEKO Tex Standard 100' ),
		'sizespecPdf' => 'http://example.invalid/sizespecs/180_01.pdf',
		'front'       => '/media/blank/picture/180_01_123_f.jpg',
		'back'        => '/media/blank/picture/180_01_123_b.jpg',
		'hasBack'     => true,
		'colourways'  => array(
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
		// Two colours and three sizes would be six; the supplier sells five.
		// Black does not exist in 2XL, and that is the whole point.
		'sizes'       => array( 'S', 'M', '2XL' ),
		'skus'        => array(
			ts_sku( '180010003', '000', 'S', 3 ),
			ts_sku( '180010004', '000', 'M', 4 ),
			ts_sku( '180010007', '000', '2XL', 7 ),
			ts_sku( '180011013', '101', 'S', 3 ),
			ts_sku( '180011014', '101', 'M', 4 ),
		),
		'exportedAt'  => '2026-08-13 07:54:06',
	);

	$entry = array(
		'style'       => array_merge( $style, $overrides['style'] ?? array() ),
		'prices'      => array(
			'currency' => 'EUR',
			'prices'   => array(
				'180010003' => array(
					'cost' => 3.37,
					'list' => 2.13,
				),
				'180010004' => array(
					'cost' => 3.37,
					'list' => 2.13,
				),
				'180010007' => array(
					'cost' => 4.95,
					'list' => 3.10,
				),
				'180011013' => array(
					'cost' => 3.37,
					'list' => 2.13,
				),
				'180011014' => array(
					'cost' => 3.37,
					'list' => 2.13,
				),
			),
		),
		'pricesError' => null,
		'stock'       => array(
			'at'    => '2026-08-14 11:46:25',
			'stock' => array(
				'180010003' => array( 447, 0, 648 ),
				'180010004' => array( 0, 12, 5000 ),
				'180010007' => array( 3, 0, 0 ),
				'180011013' => array( 91, 0, 0 ),
				'180011014' => array( 12, 0, 0 ),
			),
		),
		'stockError'  => null,
	);

	foreach ( $overrides as $key => $value ) {
		if ( 'style' !== $key ) {
			$entry[ $key ] = $value;
		}
	}
	return $entry;
}

function ts_sku( string $sku, string $colour, string $size, int $order ): array {
	return array(
		'sku'         => $sku,
		'colourCode'  => $colour,
		'sizeName'    => $size,
		'sizeOrder'   => $order,
		'ean'         => '4059106083819',
		'weightKg'    => 0.15,
		'coo'         => 'HN',
		'closeout'    => false,
		'isNew'       => false,
	);
}

/** The variation for one supplier article, or null. */
function ts_var( array $mapped, string $supply ): ?array {
	foreach ( $mapped['variations'] as $v ) {
		if ( $v['supply_sku'] === $supply ) {
			return $v;
		}
	}
	return null;
}

// ---------------------------------------------------------------------------

describe(
	'Catalogue — variations come from the SKU list',
	static function (): void {
		it(
			'creates one variation per article the supplier actually sells',
			static function (): void {
				$m = Catalogue::map( ts_entry() );
				truthy( $m['ok'], 'mapped' );
				// Two colours x three sizes would be six.
				eq( count( $m['variations'] ), 5, 'variations' );
			}
		);

		it(
			'never invents the colour/size combination the supplier omits',
			static function (): void {
				$m     = Catalogue::map( ts_entry() );
				$pairs = array_map( static fn( array $v ): string => $v['couleur'] . '/' . $v['taille'], $m['variations'] );
				truthy( ! in_array( 'Black/2XL', $pairs, true ), 'Black/2XL must not exist' );
			}
		);

		it(
			'drops a SKU whose colour is not in the colourway list',
			static function (): void {
				$entry = ts_entry();
				// A colour code with no colourway: the customer could pick a
				// colour that is not offered, or none at all.
				$entry['style']['skus'][] = ts_sku( '180019999', '999', 'M', 4 );
				$m                        = Catalogue::map( $entry );
				eq( count( $m['variations'] ), 5, 'variations' );
				eq( ts_var( $m, '180019999' ), null, 'orphan sku' );
			}
		);

		it(
			'keeps both articles when two size names reduce to the same reference',
			static function (): void {
				// "5/6 (110/116)" and "56 (110/116)" both strip to 56110116.
				// Dropping the second would lose a garment the supplier sells,
				// and WooCommerce refuses a duplicate SKU outright.
				$entry                    = ts_entry();
				$entry['style']['sizes']  = array( '5/6 (110/116)', '56 (110/116)' );
				$entry['style']['skus']   = array(
					ts_sku( '180010101', '000', '5/6 (110/116)', 1 ),
					ts_sku( '180010102', '000', '56 (110/116)', 2 ),
				);
				$m = Catalogue::map( $entry );
				eq( count( $m['variations'] ), 2, 'both kept' );
				$skus = array_column( $m['variations'], 'sku' );
				eq( count( array_unique( $skus ) ), 2, 'and their references differ' );
			}
		);

		it(
			'builds our own reference and keeps the supplier article separate',
			static function (): void {
				$m = Catalogue::map( ts_entry() );
				$v = ts_var( $m, '180010007' );
				eq( $v['sku'], '18001-000-2XL', 'our sku' );
				eq( $v['supply_sku'], '180010007', 'supplier article' );
			}
		);
	}
);

describe(
	'Catalogue — money and stock',
	static function (): void {
		it(
			'reads the supplier price into integer cents',
			static function (): void {
				$m = Catalogue::map( ts_entry() );
				eq( ts_var( $m, '180010003' )['supply_cents'], 337, 'cents' );
				eq( ts_var( $m, '180010007' )['supply_cents'], 495, 'cents' );
			}
		);

		it(
			'treats a missing price as null and never as free',
			static function (): void {
				$entry = ts_entry();
				unset( $entry['prices']['prices']['180010003'] );
				$entry['prices']['prices']['180010004']['cost'] = 0;
				$m = Catalogue::map( $entry );
				eq( ts_var( $m, '180010003' )['supply_cents'], null, 'absent' );
				eq( ts_var( $m, '180010004' )['supply_cents'], null, 'zero is not a price' );
			}
		);

		it(
			'counts only the first stock number',
			static function (): void {
				$m = Catalogue::map( ts_entry() );
				// 5000 in the third column is not stock we can sell.
				eq( ts_var( $m, '180010004' )['stock'], 0, 'green only' );
				eq( ts_var( $m, '180010003' )['stock'], 447, 'green' );
			}
		);

		it(
			'tells a missing stock line from a zero one',
			static function (): void {
				$entry = ts_entry();
				unset( $entry['stock']['stock']['180010003'] );
				$m = Catalogue::map( $entry );
				eq( ts_var( $m, '180010003' )['stock'], null, 'absent' );
			}
		);

		it(
			'treats an empty price list as a failure, not as a free garment',
			static function (): void {
				// The upstream CGI answers 200 with a body for everything,
				// including its own error pages, and the Worker caches the
				// parsed result for an hour. Zero rows means we failed to read,
				// and the importer must change nothing.
				$m = Catalogue::map( ts_entry( array( 'prices' => array( 'currency' => 'EUR', 'prices' => array() ) ) ) );
				truthy( ! $m['has_prices'], 'not usable' );
				truthy( str_contains( implode( ' ', $m['problems'] ), 'revenu vide' ), 'and says so' );
			}
		);

		it(
			'refuses prices that are not in euros rather than storing them as euro cents',
			static function (): void {
				$entry                        = ts_entry();
				$entry['prices']['currency']  = 'GBP';
				$m                            = Catalogue::map( $entry );
				truthy( ! $m['has_prices'], 'not usable' );
				truthy( str_contains( implode( ' ', $m['problems'] ), 'GBP' ), 'names the currency' );
			}
		);

		it(
			'distinguishes "the supplier has no prices" from "we could not ask"',
			static function (): void {
				$absent = Catalogue::map( ts_entry( array( 'prices' => null, 'pricesError' => 'not_found' ) ) );
				$broken = Catalogue::map( ts_entry( array( 'prices' => null, 'pricesError' => 'upstream' ) ) );
				truthy( ! $absent['has_prices'], 'no prices' );
				truthy( ! $broken['has_prices'], 'no prices' );
				truthy( str_contains( $absent['problems'][0], 'ne publie aucun tarif' ), 'says which' );
				truthy( str_contains( $broken['problems'][0], 'pas pu être lus' ), 'says which' );
			}
		);
	}
);

describe(
	'Catalogue — the supplier prose',
	static function (): void {
		it(
			'publishes the headline grammage and flags a colour exception',
			static function (): void {
				$one = Catalogue::grammage( '·195 g/m²' );
				eq( $one['gsm'], 195 );
				eq( $one['varies'], false );

				$two = Catalogue::grammage( '·195 g/m² (White: 185 g/m²)' );
				eq( $two['gsm'], 195, 'the headline wins' );
				eq( $two['varies'], true, 'and the exception is recorded' );

				$lines = Catalogue::grammage( "·203 g/m²\n·White: 193 g/m²" );
				eq( $lines['gsm'], 203 );
				eq( $lines['varies'], true );
			}
		);

		it(
			'reads a grammage written with spaces around the slash',
			static function (): void {
				// Style 50117 spells it this way, and the obvious regex misses it.
				eq( Catalogue::grammage( '·130 g / m²' )['gsm'], 130 );
			}
		);

		it(
			'says nothing rather than guessing when there is no grammage',
			static function (): void {
				eq( Catalogue::grammage( '·100% polyester' )['gsm'], 0 );
			}
		);

		it(
			'keeps the composition exception, because a buyer choosing that colour needs it',
			static function (): void {
				eq(
					Catalogue::composition( "·195 g/m²\n·100% coton (Heather Grey: 97% coton, 3% polyester)" ),
					'100% coton (Heather Grey: 97% coton, 3% polyester)'
				);
				eq( Catalogue::composition( '·bord côte à l’encolure' ), '' );
			}
		);
	}
);

describe(
	'Catalogue — sizes sort the way a human wears them',
	static function (): void {
		it(
			'orders the adult run',
			static function (): void {
				$sizes = array( '3XL', 'S', 'XS', 'M', '2XL', 'L', 'XL' );
				usort( $sizes, static fn( $a, $b ) => Catalogue::size_rank( $a ) <=> Catalogue::size_rank( $b ) );
				eq( implode( ' ', $sizes ), 'XS S M L XL 2XL 3XL' );
			}
		);

		it(
			'keeps children below adults instead of interleaving them',
			static function (): void {
				truthy( Catalogue::size_rank( '116 (5-6)' ) < Catalogue::size_rank( 'XS' ), 'child before adult' );
				truthy( Catalogue::size_rank( '164 (14-15)' ) < Catalogue::size_rank( 'XS' ), 'still before adult' );
			}
		);

		it(
			'reads the letter when the maker adds its own number after it',
			static function (): void {
				eq( Catalogue::size_rank( 'XL (16)' ), Catalogue::size_rank( 'XL' ) );
				eq( Catalogue::size_rank( 'S (10)' ), Catalogue::size_rank( 'S' ) );
			}
		);

		it(
			'sorts an unknown size last instead of dropping it',
			static function (): void {
				truthy( Catalogue::size_rank( 'One Size' ) > Catalogue::size_rank( '6XL' ), 'last' );
			}
		);
	}
);

describe(
	'Catalogue — the shop vocabulary',
	static function (): void {
		it(
			'files a short-sleeved tee under a French category path',
			static function (): void {
				$m = Catalogue::map( ts_entry() );
				eq( $m['categories'], array( 'T-shirts', 'Manches courtes' ) );
			}
		);

		it(
			'does not sub-divide sweats by sleeve, because they are all long',
			static function (): void {
				$m = Catalogue::map( ts_entry( array( 'style' => array( 'kind' => 'sweat', 'sleeve' => 'long' ) ) ) );
				eq( $m['categories'], array( 'Sweats' ) );
			}
		);

		it(
			'drops the supplier merchandising tag that is not an audience',
			static function (): void {
				$m = Catalogue::map( ts_entry() );
				eq( $m['attributes']['public'], array( 'Homme' ), '"produits correspondants" is not a public' );
			}
		);

		it(
			'translates the neckline and leaves an unknown one out',
			static function (): void {
				$m = Catalogue::map( ts_entry() );
				eq( $m['attributes']['col'], array( 'Col rond' ) );

				$odd = Catalogue::map( ts_entry( array( 'style' => array( 'neckline' => 'Boat Neck' ) ) ) );
				truthy( ! isset( $odd['attributes']['col'] ), 'unknown neckline is dropped, not printed in English' );
			}
		);

		it(
			'puts the brand in the title, because nobody searches for "Heavy Cotton T"',
			static function (): void {
				$m = Catalogue::map( ts_entry() );
				eq( $m['name'], 'Fruit of the Loom Heavy Cotton T' );
			}
		);

		it(
			'lists colours and sizes as attributes, sizes in wearing order',
			static function (): void {
				$m = Catalogue::map( ts_entry() );
				eq( $m['attributes']['couleur'], array( 'White', 'Black' ) );
				eq( $m['attributes']['taille'], array( 'S', 'M', '2XL' ) );
			}
		);
	}
);

describe(
	'Catalogue — refusals',
	static function (): void {
		it(
			'refuses a payload with no usable reference',
			static function (): void {
				$m = Catalogue::map( array( 'style' => array( 'styleNr' => 'abc' ) ) );
				truthy( ! $m['ok'] );
			}
		);

		it(
			'refuses a style with nothing sellable rather than publishing an empty product',
			static function (): void {
				$m = Catalogue::map( ts_entry( array( 'style' => array( 'skus' => array() ) ) ) );
				truthy( ! $m['ok'] );
				truthy( str_contains( implode( ' ', $m['problems'] ), 'Aucun article vendable' ) );
			}
		);

		it(
			'falls back to a colour photo when the style has no front shot',
			static function (): void {
				$m = Catalogue::map( ts_entry( array( 'style' => array( 'front' => '' ) ) ) );
				eq( $m['front'], '/media/blank/picture/180_01_000_f.jpg' );
			}
		);
	}
);
