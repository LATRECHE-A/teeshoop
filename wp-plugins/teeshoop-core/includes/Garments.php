<?php
/**
 * What the shop knows about a garment, in centimetres.
 *
 * Print areas, the official flat measurements and the colour list. Every number
 * here was produced by the studio's own definitions and written to
 * `data/garments.json` by `scripts/gen-garment-data.mjs`; nothing in this file
 * computes a dimension and nothing in it may. A print size typed a second time
 * is a print size that diverges, and the customer discovers the divergence when
 * the workshop crops their logo.
 *
 * `src/content/garmentData.test.ts` fails when the JSON and the studio disagree,
 * so the file cannot go stale unnoticed.
 *
 * WHAT IS DELIBERATELY ABSENT: fabric composition and grammage. They exist
 * nowhere in this project for `tee` and `hoodie`: not in the studio, not in the
 * Bible, not in the supplier snapshot for these two references. They are read
 * from product meta when a real catalogue import has set them (session 03), and
 * when it has not, the page says nothing rather than inventing a number that a
 * buyer would order against.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

final class Garments {

	/**
	 * The shape this class understands.
	 *
	 * A file written by a newer generator is refused rather than half-read: a
	 * renamed key would render an empty specification block, which looks like a
	 * product nobody finished rather than like a bug.
	 */
	private const SCHEMA = 1;

	/** @var array<string,mixed>|null Parsed once per request. */
	private static ?array $cache = null;

	/** Product meta a catalogue import fills in. Absent is a valid state. */
	public const META_MATERIAL = '_teeshoop_material';
	public const META_WEIGHT   = '_teeshoop_weight_gsm';
	public const META_BRAND    = '_teeshoop_brand';
	public const META_BRAND_REF = '_teeshoop_brand_ref';
	public const META_SPECS_DATE = '_teeshoop_specs_updated';

	public static function path(): string {
		return ( defined( 'TEESHOOP_CORE_DIR' ) ? TEESHOOP_CORE_DIR : __DIR__ . '/../' ) . 'data/garments.json';
	}

	/**
	 * The whole document, or an empty one.
	 *
	 * Empty is a legible state everywhere it is used: the specification block
	 * renders nothing and the admin is told why. It is never a guess.
	 */
	public static function all(): array {
		if ( null !== self::$cache ) {
			return self::$cache;
		}

		$empty = array(
			'schema'   => 0,
			'garments' => array(),
			'colors'   => array(),
		);

		$file = self::path();
		if ( ! is_readable( $file ) ) {
			self::$cache = $empty;
			return self::$cache;
		}

		$parsed = json_decode( (string) file_get_contents( $file ), true ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- a bundled file, not a remote fetch.
		if ( ! is_array( $parsed ) || (int) ( $parsed['schema'] ?? 0 ) !== self::SCHEMA ) {
			self::$cache = $empty;
			return self::$cache;
		}

		self::$cache = array(
			'schema'   => self::SCHEMA,
			'garments' => is_array( $parsed['garments'] ?? null ) ? $parsed['garments'] : array(),
			'colors'   => is_array( $parsed['colors'] ?? null ) ? $parsed['colors'] : array(),
		);
		return self::$cache;
	}

	/** Only for the tests, which load several fixtures in one process. */
	public static function reset_cache(): void {
		self::$cache = null;
	}

	/** The presentation record for one garment key, or an empty array. */
	public static function get( string $garment ): array {
		$all = self::all();
		$one = $all['garments'][ $garment ] ?? null;
		return is_array( $one ) ? $one : array();
	}

	/** True when we can publish measurements for this garment. */
	public static function has( string $garment ): bool {
		return array() !== self::get( $garment );
	}

	/**
	 * The size every published print area is measured at.
	 *
	 * It is also the size the PRICE is computed at (PRICED_SIZE in
	 * src/lib/teeshoop/upload.ts), and the page says so out loud: one figure
	 * covers a run that may span S to 3XL, and a chest print grows about 23 %
	 * from M to 3XL. Question 37 of QUESTIONS-ASSOCIE.md.
	 */
	public static function priced_size( string $garment ): string {
		return (string) ( self::get( $garment )['pricedSize'] ?? 'M' );
	}

	/**
	 * Print areas at the priced size: [ ['side' => 'front', 'w' => 30.5, 'h' => 40.6], … ].
	 *
	 * A side whose area is not in the file is dropped, not defaulted. Artwork
	 * that cannot be measured is refused rather than published at a guess.
	 */
	public static function areas( string $garment ): array {
		$record = self::get( $garment );
		$size   = self::priced_size( $garment );
		$out    = array();

		foreach ( (array) ( $record['areas'] ?? array() ) as $area ) {
			$cell = $area['bySize'][ $size ] ?? null;
			if ( ! is_array( $cell ) || ! isset( $cell['wCm'], $cell['hCm'] ) ) {
				continue;
			}
			$out[] = array(
				'side'    => (string) ( $area['side'] ?? '' ),
				'w'       => (float) $cell['wCm'],
				'h'       => (float) $cell['hCm'],
				// Carried so the page can say how much the zone grows: artwork
				// is graded with the garment, so one pair of numbers describes
				// one size and misleads about the other five.
				'by_size' => is_array( $area['bySize'] ?? null ) ? $area['bySize'] : array(),
			);
		}
		return $out;
	}

	/**
	 * How many faces this garment can be printed on.
	 *
	 * The price grid's rows are 1 face, 2 faces, … up to this. Deriving the row
	 * count from the garment rather than fixing it means the table never offers
	 * a third face on something that has two, and never hides one.
	 *
	 * Falls back to 1 rather than to 0: a garment we hold no measurements for is
	 * still printable on its front, and a grid with no rows would read as "we do
	 * not sell this".
	 */
	public static function printable_sides_count( string $garment ): int {
		$n = count( self::areas( $garment ) );
		return $n > 0 ? $n : 1;
	}

	/** Every size's area for one side, for the "it grows with the garment" table. */
	public static function area_by_size( string $garment, string $side ): array {
		foreach ( (array) ( self::get( $garment )['areas'] ?? array() ) as $area ) {
			if ( (string) ( $area['side'] ?? '' ) === $side ) {
				return is_array( $area['bySize'] ?? null ) ? $area['bySize'] : array();
			}
		}
		return array();
	}

	/** The official flat measurements, in cm, one row per size. */
	public static function sizes( string $garment ): array {
		$rows = self::get( $garment )['sizes'] ?? array();
		return is_array( $rows ) ? $rows : array();
	}

	/** Manufacturer and style the measurements are taken from, or ''. */
	public static function brand_ref( string $garment ): string {
		return (string) ( self::get( $garment )['brandRef'] ?? '' );
	}

	/** The stocked garment colours, French names, hex for the swatch. */
	public static function colors(): array {
		return self::all()['colors'];
	}

	/**
	 * A French centimetre: 30,5 cm. Never 30.5 cm.
	 *
	 * `number_format_i18n` follows the site locale, which on a French shop is
	 * what we want and on an English one would print a point, so the separator
	 * is fixed here rather than inherited. A specification sheet with mixed
	 * separators reads as machine output.
	 */
	public static function cm( float $value ): string {
		return number_format( $value, 1, ',', "\u{202F}" ) . "\u{00A0}cm";
	}
}
