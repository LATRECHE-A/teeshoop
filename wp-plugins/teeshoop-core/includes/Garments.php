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

	/** The shape of `garment-art.json`, bumped by hand for the same reason. */
	private const SCHEMA_ART = 1;

	/** @var array<string,mixed>|null Parsed once per request. */
	private static ?array $cache = null;

	/** @var array<string,mixed>|null The drawings, parsed only if asked for. */
	private static ?array $art_cache = null;

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
		self::$cache     = null;
		self::$art_cache = null;
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
	 * READ FROM `printableSides`, NOT COUNTED FROM `areas`, and the difference
	 * cost money. Counting the measurements conflated "we hold no dimensions for
	 * this garment" with "this garment has one face": `custom`, whose dimensions
	 * are the customer's own shirt and are therefore absent by design, was
	 * offered a one-face price while `Pricing` charged 12,00 EUR for the second
	 * side the page never showed a control for. The face count is a fact about
	 * the garment; the areas are a measurement of it.
	 *
	 * Falls back to 1 rather than 0 for a garment the file does not know at all:
	 * a grid with no rows would read as "we do not sell this".
	 */
	public static function printable_sides_count( string $garment ): int {
		$declared = self::get( $garment )['printableSides'] ?? null;
		if ( is_array( $declared ) && ! empty( $declared ) ) {
			return count( $declared );
		}
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

	/**
	 * Le dos est-il le MÊME rectangle que le devant, à cette taille.
	 *
	 * ─────────────────────────────────────────────────────────────────────────
	 * UN FAIT DE GÉOMÉTRIE, DONC IL VIT ICI ET PAS DANS UNE PHRASE.
	 *
	 * Trois blocs de la page d'accueil publient le rectangle du DEVANT, et
	 * chacun doit décider s'il a le droit d'ajouter « et le dos ». La question
	 * est la même partout et la réponse est une mesure, pas une tournure : elle
	 * est donc calculée une fois, ici, à côté des chiffres qu'elle compare.
	 *
	 * MESURÉ, et c'est pourquoi la question se pose :
	 *
	 *   tee    taille M : devant 30,5 x 40,6   dos 30,5 x 40,6   vrai
	 *   sweat  taille M : devant 30,5 x 30,5   dos 30,5 x 35,6   FAUX
	 *
	 * Le thème l'affirmait sans condition sous le rectangle du devant. Sur une
	 * boutique dont le premier produit personnalisable est un sweat, l'accueil
	 * annonçait donc un dos de 30,5 x 30,5 cm là où la presse en accepte 35,6 de
	 * haut, et un acheteur qui dimensionnait son marquage dessus perdait 14 % de
	 * la hauteur qu'il payait.
	 *
	 * FAUX QUAND ON N'A PAS PU MESURER. Une taille absente, un dos non publié
	 * ou un vêtement inconnu rendent `false` : « je n'ai pas pu regarder » n'est
	 * pas « c'est pareil », et se tromper dans ce sens ne fait que taire une
	 * promesse au lieu d'en inventer une.
	 */
	public static function same_back( string $garment, string $size ): bool {
		if ( '' === $garment || '' === $size ) {
			return false;
		}

		$front = self::area_by_size( $garment, 'front' );
		$back  = self::area_by_size( $garment, 'back' );
		if ( ! isset( $front[ $size ]['wCm'], $front[ $size ]['hCm'], $back[ $size ]['wCm'], $back[ $size ]['hCm'] ) ) {
			return false;
		}

		return (float) $back[ $size ]['wCm'] === (float) $front[ $size ]['wCm']
			&& (float) $back[ $size ]['hCm'] === (float) $front[ $size ]['hCm'];
	}

	/** Manufacturer and style the measurements are taken from, or ''. */
	public static function brand_ref( string $garment ): string {
		return (string) ( self::get( $garment )['brandRef'] ?? '' );
	}

	/** The stocked garment colours, French names, hex for the swatch. */
	public static function colors(): array {
		return self::all()['colors'];
	}

	/** A French centimetre: 30,5 cm. Never 30.5 cm. */
	public static function cm( float $value ): string {
		return Money::number( $value, 1 ) . "\u{00A0}cm";
	}

	// -----------------------------------------------------------------------
	// The illustration
	// -----------------------------------------------------------------------

	/**
	 * The drawing of one face of a garment, and the rectangle we print on it.
	 *
	 * ─────────────────────────────────────────────────────────────────────────
	 * A SECOND FILE, LOADED ONLY WHEN SOMEBODY ASKS FOR A PICTURE.
	 *
	 * `garments.json` is opened by every product page to answer "how many
	 * centimetres". These drawings are 52 kB of SVG path data wanted by the
	 * homepage. They are read lazily and cached for the request, so a shop
	 * whose visitor never lands on the homepage never decodes them.
	 *
	 * WHAT COMES BACK, AND WHY IT IS SHAPED LIKE THIS:
	 *
	 *   `body`         the SVG, carrying the literal `__COLOR__` where the
	 *                  cloth fill goes. The CALLER substitutes, because the
	 *                  caller is the only one that knows whether it wants a
	 *                  hexadecimal (one garment, one colour) or a CSS custom
	 *                  property (one garment the visitor recolours).
	 *   `printAreaPx`  the printable rectangle in the drawing's own 800 x 800
	 *                  coordinates. This is what lets a page draw the print
	 *                  zone ON the garment and be right: it is generated from
	 *                  `src/garments/*.ts`, the same definition the press is
	 *                  set from, so the drawing and the workshop cannot
	 *                  disagree the way two hand-typed rectangles would.
	 *   `pxPerInch`    turns that rectangle back into the centimetres
	 *                  `area_by_size()` publishes beside it.
	 *
	 * AN ABSENT OR BROKEN FILE RETURNS AN EMPTY ARRAY, and the homepage draws
	 * its no-drawing state. It never falls back to another garment's picture: a
	 * hoodie illustrated by a t-shirt is a garment the customer did not choose.
	 *
	 * @return array{body:string,printAreaPx:array{x:float,y:float,w:float,h:float},pxPerInch:float,widthIn:float}|array{}
	 */
	public static function art( string $garment, string $side = 'front' ): array {
		$one = self::art_all()['garments'][ $garment ] ?? null;
		return is_array( $one ) ? self::art_of( $one, $side ) : array();
	}

	/**
	 * The same answer, from a record already in hand, and this half is pure.
	 *
	 * Split out for the reason `Swatch` has no GD in it and
	 * `Disponibilite::parse_rows()` has no HTTP: the reading of a file cannot
	 * be exercised without a file, and the DECIDING is the half that has to be.
	 * Every refusal below is a state a deployed shop can really be in, and each
	 * one is asserted in `tests/test-garments.php` against a record built by
	 * hand, so proving them does not mean corrupting a file the repository
	 * ships.
	 *
	 * @param array<string,mixed> $one One garment's record from the drawings file.
	 * @return array{body:string,printAreaPx:array{x:float,y:float,w:float,h:float},pxPerInch:float,widthIn:float}|array{}
	 */
	public static function art_of( array $one, string $side ): array {
		$scale = (float) ( $one['pxPerInch'] ?? 0 );

		/*
		 * WITHOUT A SCALE THE DRAWING IS A PICTURE AND NOT A MEASUREMENT.
		 *
		 * `pxPerInch` is the only thing that turns the print rectangle back
		 * into centimetres. A caller that drew the rectangle anyway would put a
		 * box on a garment and caption it with a size nobody derived, which is
		 * the fabricated print size the brief refuses outright.
		 */
		if ( $scale <= 0 ) {
			return array();
		}

		foreach ( (array) ( $one['sides'] ?? array() ) as $row ) {
			if ( ! is_array( $row ) || ( $row['side'] ?? '' ) !== $side ) {
				continue;
			}

			$body = (string) ( $row['body'] ?? '' );
			$rect = is_array( $row['printAreaPx'] ?? null ) ? $row['printAreaPx'] : array();

			/*
			 * A DRAWING THAT CANNOT BE TINTED IS REFUSED.
			 *
			 * `scripts/gen-garment-data.mjs` already refuses to write one; this
			 * is the same check on the reading side, because the file on disk
			 * is what renders and it can be restored from an older deploy or
			 * truncated by a half-finished copy. Returning it anyway would
			 * paint every colour of the switcher identically, which reads as a
			 * broken control rather than as a missing file.
			 */
			if ( '' === $body || ! str_contains( $body, '__COLOR__' ) ) {
				return array();
			}

			$w = (float) ( $rect['w'] ?? 0 );
			$h = (float) ( $rect['h'] ?? 0 );
			if ( $w <= 0 || $h <= 0 ) {
				return array();
			}

			return array(
				'body'        => $body,
				'printAreaPx' => array(
					'x' => (float) ( $rect['x'] ?? 0 ),
					'y' => (float) ( $rect['y'] ?? 0 ),
					'w' => $w,
					'h' => $h,
				),
				'pxPerInch'   => $scale,
				'widthIn'     => (float) ( $one['widthIn'] ?? 0 ),
			);
		}

		return array();
	}

	/** The drawings document, parsed once per request. */
	private static function art_all(): array {
		if ( null !== self::$art_cache ) {
			return self::$art_cache;
		}

		$empty = array(
			'schema'   => 0,
			'garments' => array(),
		);

		$file = ( defined( 'TEESHOOP_CORE_DIR' ) ? TEESHOOP_CORE_DIR : __DIR__ . '/../' ) . 'data/garment-art.json';
		if ( ! is_readable( $file ) ) {
			self::$art_cache = $empty;
			return self::$art_cache;
		}

		$parsed = json_decode( (string) file_get_contents( $file ), true ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- a bundled file, not a remote fetch.
		if ( ! is_array( $parsed ) || (int) ( $parsed['schema'] ?? 0 ) !== self::SCHEMA_ART ) {
			self::$art_cache = $empty;
			return self::$art_cache;
		}

		self::$art_cache = array(
			'schema'   => self::SCHEMA_ART,
			'garments' => is_array( $parsed['garments'] ?? null ) ? $parsed['garments'] : array(),
		);
		return self::$art_cache;
	}
}
