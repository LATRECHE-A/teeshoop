<?php
/**
 * A single-purpose PDF writer, for invoices.
 *
 * WHY THIS EXISTS AT ALL, given that writing a PDF library is a bad idea. The
 * shop runs on shared hosting with no composer and no build step for PHP, so a
 * real PDF library would have to be vendored into the repository, reviewed, and
 * kept patched by two people. What an invoice actually needs is text in a fixed
 * position, two weights of one font, and horizontal rules. That is a page and a
 * half of the PDF specification, it is stable since 1993, and it is far less
 * risk than a megabyte of vendored code nobody here reads.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: images, colour spaces beyond grey, embedded
 * fonts, unicode beyond Windows-1252, automatic line breaking, tables. The
 * invoice lays itself out; this only puts glyphs where it is told.
 *
 * WHY HELVETICA. It is one of the fourteen fonts every PDF reader is required to
 * have, so nothing is embedded and nothing can fail to load. Its metrics are
 * public and fixed, which is what makes `width_mm()` able to right-align an
 * amount and truncate a label without guessing.
 *
 * ENCODING. PDF's WinAnsiEncoding is Windows-1252, so the French accents an
 * invoice needs are single bytes and no CID font is required. `encode()` maps
 * UTF-8 to it by code point rather than through iconv or mbstring, because
 * neither is guaranteed on o2switch and a missing extension must not silently
 * drop the accents off a legal document. Anything unmappable becomes '?' AND is
 * counted, so a caller can refuse to issue a document that lost a character.
 *
 * Pure: no WordPress function is called here.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

final class Pdf {

	/** One millimetre in PostScript points. */
	private const MM = 72 / 25.4;

	public const REGULAR = 'regular';
	public const BOLD    = 'bold';

	private float $width_pt;
	private float $height_pt;

	/** @var string[] One content stream per page, already in PDF operators. */
	private array $pages = array();

	private string $current = '';

	/** Characters that could not be written in Windows-1252, across the document. */
	private int $lost = 0;

	public function __construct( float $width_mm = 210.0, float $height_mm = 297.0 ) {
		$this->width_pt  = $width_mm * self::MM;
		$this->height_pt = $height_mm * self::MM;
	}

	/** Text with its LEFT edge at $x_mm, baseline at $y_mm from the top. */
	public function text( float $x_mm, float $y_mm, string $text, string $font = self::REGULAR, float $size = 9.5, float $grey = 0.0 ): void {
		$encoded = $this->encode( $text );
		if ( '' === $encoded ) {
			return;
		}
		$this->current .= sprintf(
			"q %s g BT /%s %s Tf %s %s Td (%s) Tj ET Q\n",
			$this->num( $grey ),
			self::BOLD === $font ? 'F2' : 'F1',
			$this->num( $size ),
			$this->num( $x_mm * self::MM ),
			$this->num( $this->height_pt - $y_mm * self::MM ),
			$this->escape( $encoded )
		);
	}

	/** Text with its RIGHT edge at $x_mm. Every amount on an invoice uses this. */
	public function text_right( float $x_mm, float $y_mm, string $text, string $font = self::REGULAR, float $size = 9.5, float $grey = 0.0 ): void {
		$this->text( $x_mm - self::width_mm( $text, $font, $size ), $y_mm, $text, $font, $size, $grey );
	}

	public function rule( float $x1_mm, float $y_mm, float $x2_mm, float $thickness_mm = 0.2, float $grey = 0.7 ): void {
		$this->current .= sprintf(
			"q %s G %s w %s %s m %s %s l S Q\n",
			$this->num( $grey ),
			$this->num( $thickness_mm * self::MM ),
			$this->num( $x1_mm * self::MM ),
			$this->num( $this->height_pt - $y_mm * self::MM ),
			$this->num( $x2_mm * self::MM ),
			$this->num( $this->height_pt - $y_mm * self::MM )
		);
	}

	public function fill( float $x_mm, float $y_mm, float $w_mm, float $h_mm, float $grey ): void {
		$this->current .= sprintf(
			"q %s g %s %s %s %s re f Q\n",
			$this->num( $grey ),
			$this->num( $x_mm * self::MM ),
			$this->num( $this->height_pt - ( $y_mm + $h_mm ) * self::MM ),
			$this->num( $w_mm * self::MM ),
			$this->num( $h_mm * self::MM )
		);
	}

	/**
	 * Text rotated 45 degrees across the page, in light grey, behind nothing.
	 *
	 * The one piece of decoration this writer has, and it is not decoration: a
	 * document that is not usable as an invoice has to say so in a way that
	 * survives being printed and photocopied. See Invoice::render.
	 */
	public function stamp( string $text, float $size = 34.0, float $grey = 0.82 ): void {
		$encoded = $this->encode( $text );
		if ( '' === $encoded ) {
			return;
		}
		$width = self::width_mm( $text, self::BOLD, $size ) * self::MM;
		// Centred on the page, then rotated about that centre.
		$cx = $this->width_pt / 2;
		$cy = $this->height_pt / 2;
		$c  = cos( M_PI / 4 );
		$s  = sin( M_PI / 4 );
		$this->current .= sprintf(
			"q %s g BT /F2 %s Tf %s %s %s %s %s %s Tm (%s) Tj ET Q\n",
			$this->num( $grey ),
			$this->num( $size ),
			$this->num( $c ),
			$this->num( $s ),
			$this->num( -$s ),
			$this->num( $c ),
			$this->num( $cx - ( $width / 2 ) * $c + ( $size * 0.35 ) * $s ),
			$this->num( $cy - ( $width / 2 ) * $s - ( $size * 0.35 ) * $c ),
			$this->escape( $encoded )
		);
	}

	public function page_break(): void {
		$this->pages[]  = $this->current;
		$this->current  = '';
	}

	/** How many characters this document could not represent. Must be 0 to issue. */
	public function lost(): int {
		return $this->lost;
	}

	/**
	 * The finished file.
	 *
	 * @param string $title    The document's title, for the reader's title bar.
	 * @param string $created  A PDF date string, e.g. D:20260818120000+02'00'.
	 *                         Passed in rather than taken from a clock, because
	 *                         this file calls nothing but arithmetic.
	 */
	public function render( string $title, string $created ): string {
		$pages = $this->pages;
		if ( '' !== $this->current || empty( $pages ) ) {
			$pages[] = $this->current;
		}

		$objects = array();

		// 1 catalog, 2 pages tree, 3 and 4 the fonts, 5 the info dictionary.
		$objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
		$objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
		$objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
		$objects[5] = '<< /Title (' . $this->escape( $this->encode( $title ) ) . ') /Producer (Teeshoop Core) /CreationDate (' . $this->escape( $created ) . ') >>';

		$next = 6;
		$kids = array();
		foreach ( $pages as $content ) {
			$page_obj    = $next++;
			$stream_obj  = $next++;
			$kids[]      = $page_obj . ' 0 R';
			$compressed  = gzcompress( $content, 6 );

			$objects[ $page_obj ] = sprintf(
				'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %s %s] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents %d 0 R >>',
				$this->num( $this->width_pt ),
				$this->num( $this->height_pt ),
				$stream_obj
			);
			$objects[ $stream_obj ] = sprintf(
				"<< /Length %d /Filter /FlateDecode >>\nstream\n%s\nendstream",
				strlen( $compressed ),
				$compressed
			);
		}

		$objects[2] = sprintf( '<< /Type /Pages /Kids [%s] /Count %d >>', implode( ' ', $kids ), count( $kids ) );

		ksort( $objects );

		$out     = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
		$offsets = array();
		foreach ( $objects as $id => $body ) {
			$offsets[ $id ] = strlen( $out );
			$out           .= $id . " 0 obj\n" . $body . "\nendobj\n";
		}

		$max        = max( array_keys( $objects ) );
		$xref_start = strlen( $out );
		$out       .= "xref\n0 " . ( $max + 1 ) . "\n";
		$out       .= "0000000000 65535 f \n";
		for ( $i = 1; $i <= $max; $i++ ) {
			// Every id from 1 to max is used by construction above; a hole would
			// still be a legal free entry rather than a corrupt file.
			$out .= isset( $offsets[ $i ] )
				? sprintf( "%010d 00000 n \n", $offsets[ $i ] )
				: "0000000000 65535 f \n";
		}
		$out .= sprintf(
			"trailer\n<< /Size %d /Root 1 0 R /Info 5 0 R >>\nstartxref\n%d\n%%%%EOF\n",
			$max + 1,
			$xref_start
		);

		return $out;
	}

	/** The width of a string, in millimetres, at a given size. */
	public static function width_mm( string $text, string $font, float $size ): float {
		$widths = self::widths( $font );
		$units  = 0;
		foreach ( self::code_points( $text ) as $cp ) {
			$byte   = self::to_win1252( $cp );
			$units += $widths[ $byte ] ?? $widths[ 63 ];
		}
		// AFM widths are thousandths of the point size.
		return ( $units * $size / 1000 ) / self::MM;
	}

	/**
	 * $text broken into lines that each fit $max_mm, on word boundaries.
	 *
	 * NOT `fit()`. The difference is legal rather than typographic: the
	 * professional mentions at the foot of an invoice are mandatory content
	 * (article L. 441-9 du code de commerce), and the first version of this
	 * document truncated two of them with an ellipsis, so the page announced a
	 * penalty rate as "au taux appliqué par la Banque centrale européenne à son
	 * opération de r…". A truncated mandatory mention is a non-conforming
	 * invoice. Labels in a table column may be cut; these may not.
	 *
	 * A single word longer than the line is left overflowing rather than broken:
	 * hyphenating an IBAN or a company name would be worse than a long line.
	 *
	 * @return string[]
	 */
	public static function wrap( string $text, float $max_mm, string $font, float $size ): array {
		$lines = array();
		$line  = '';
		foreach ( preg_split( '/\s+/u', trim( $text ) ) ?: array() as $word ) {
			if ( '' === $word ) {
				continue;
			}
			$candidate = '' === $line ? $word : $line . ' ' . $word;
			if ( '' !== $line && self::width_mm( $candidate, $font, $size ) > $max_mm ) {
				$lines[] = $line;
				$line    = $word;
				continue;
			}
			$line = $candidate;
		}
		if ( '' !== $line ) {
			$lines[] = $line;
		}
		return empty( $lines ) ? array( '' ) : $lines;
	}

	/** As much of $text as fits in $max_mm, with a trailing ellipsis when cut. */
	public static function fit( string $text, float $max_mm, string $font, float $size ): string {
		if ( self::width_mm( $text, $font, $size ) <= $max_mm ) {
			return $text;
		}
		$points = self::code_points( $text );
		$out    = '';
		foreach ( $points as $cp ) {
			$candidate = $out . self::from_code_point( $cp );
			if ( self::width_mm( $candidate . "\u{2026}", $font, $size ) > $max_mm ) {
				break;
			}
			$out = $candidate;
		}
		return $out . "\u{2026}";
	}

	// ─────────────────────────────────────────────────────────────────────────

	/** A number PDF will accept: a dot decimal, no exponent, no locale. */
	private function num( float $value ): string {
		return rtrim( rtrim( number_format( $value, 3, '.', '' ), '0' ), '.' ) ?: '0';
	}

	private function escape( string $win1252 ): string {
		return str_replace( array( '\\', '(', ')', "\r", "\n" ), array( '\\\\', '\\(', '\\)', '\\r', '\\n' ), $win1252 );
	}

	/** UTF-8 to Windows-1252, counting anything that will not fit. */
	private function encode( string $text ): string {
		$out = '';
		foreach ( self::code_points( $text ) as $cp ) {
			$byte = self::to_win1252( $cp );
			if ( 63 === $byte && 63 !== $cp ) {
				++$this->lost;
			}
			$out .= chr( $byte );
		}
		return $out;
	}

	/** @return int[] */
	private static function code_points( string $utf8 ): array {
		$out = array();
		$len = strlen( $utf8 );
		for ( $i = 0; $i < $len; $i++ ) {
			$c = ord( $utf8[ $i ] );
			if ( $c < 0x80 ) {
				$out[] = $c;
			} elseif ( $c >= 0xF0 && $i + 3 < $len ) {
				$out[] = ( ( $c & 0x07 ) << 18 ) | ( ( ord( $utf8[ $i + 1 ] ) & 0x3F ) << 12 ) | ( ( ord( $utf8[ $i + 2 ] ) & 0x3F ) << 6 ) | ( ord( $utf8[ $i + 3 ] ) & 0x3F );
				$i += 3;
			} elseif ( $c >= 0xE0 && $i + 2 < $len ) {
				$out[] = ( ( $c & 0x0F ) << 12 ) | ( ( ord( $utf8[ $i + 1 ] ) & 0x3F ) << 6 ) | ( ord( $utf8[ $i + 2 ] ) & 0x3F );
				$i += 2;
			} elseif ( $c >= 0xC0 && $i + 1 < $len ) {
				$out[] = ( ( $c & 0x1F ) << 6 ) | ( ord( $utf8[ $i + 1 ] ) & 0x3F );
				++$i;
			} else {
				$out[] = 0x3F;
			}
		}
		return $out;
	}

	private static function from_code_point( int $cp ): string {
		if ( $cp < 0x80 ) {
			return chr( $cp );
		}
		if ( $cp < 0x800 ) {
			return chr( 0xC0 | ( $cp >> 6 ) ) . chr( 0x80 | ( $cp & 0x3F ) );
		}
		if ( $cp < 0x10000 ) {
			return chr( 0xE0 | ( $cp >> 12 ) ) . chr( 0x80 | ( ( $cp >> 6 ) & 0x3F ) ) . chr( 0x80 | ( $cp & 0x3F ) );
		}
		return chr( 0xF0 | ( $cp >> 18 ) ) . chr( 0x80 | ( ( $cp >> 12 ) & 0x3F ) ) . chr( 0x80 | ( ( $cp >> 6 ) & 0x3F ) ) . chr( 0x80 | ( $cp & 0x3F ) );
	}

	/**
	 * One Unicode code point to one Windows-1252 byte, or 63 ('?').
	 *
	 * The 0x80..0x9F band is where Windows-1252 differs from Latin-1, and it
	 * holds every typographic character this shop writes: the euro sign, the
	 * apostrophe the French strings use, the quotation marks and the ellipsis.
	 * Without this table an invoice would print "l?extension" and a price of
	 * "14,50 ?".
	 *
	 * The two non-breaking spaces become an ordinary space, deliberately: a PDF
	 * line is positioned by us and never reflows, so there is nothing for a
	 * non-breaking space to protect, and WinAnsi leaves 0xA0 ambiguous.
	 */
	private static function to_win1252( int $cp ): int {
		static $special = array(
			0x20AC => 0x80, // euro
			0x201A => 0x82,
			0x0192 => 0x83,
			0x201E => 0x84,
			0x2026 => 0x85, // ellipsis
			0x2020 => 0x86,
			0x2021 => 0x87,
			0x02C6 => 0x88,
			0x2030 => 0x89,
			0x0160 => 0x8A,
			0x2039 => 0x8B,
			0x0152 => 0x8C, // OE
			0x017D => 0x8E,
			0x2018 => 0x91,
			0x2019 => 0x92, // the apostrophe every French string here uses
			0x201C => 0x93,
			0x201D => 0x94,
			0x2022 => 0x95,
			0x2013 => 0x96, // en dash
			0x2014 => 0x97, // em dash
			0x02DC => 0x98,
			0x2122 => 0x99,
			0x0161 => 0x9A,
			0x203A => 0x9B,
			0x0153 => 0x9C, // oe
			0x017E => 0x9E,
			0x0178 => 0x9F,
			0x00A0 => 0x20, // no-break space
			0x202F => 0x20, // narrow no-break space
			0x2009 => 0x20, // thin space
		);

		if ( $cp >= 0x20 && $cp <= 0x7E ) {
			return $cp;
		}
		if ( isset( $special[ $cp ] ) ) {
			return $special[ $cp ];
		}
		if ( $cp >= 0xA1 && $cp <= 0xFF ) {
			return $cp;
		}
		return 0x3F;
	}

	/**
	 * Helvetica's own metrics, in thousandths of the point size.
	 *
	 * From the Adobe Font Metrics of the base-14 fonts, which every conforming
	 * PDF reader implements identically: this is not a guess about how wide a
	 * glyph looks, it is the number the reader itself will advance by. Accented
	 * Latin-1 letters carry their base letter's width in these two faces, which
	 * is why they are expanded from the ASCII table rather than listed.
	 *
	 * @return array<int,int> byte value to width
	 */
	private static function widths( string $font ): array {
		static $cache = array();
		if ( isset( $cache[ $font ] ) ) {
			return $cache[ $font ];
		}

		$bold = self::BOLD === $font;

		// ASCII 32..126, in order.
		$ascii = $bold
			? array( 278, 333, 474, 556, 556, 889, 722, 278, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 278, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584 )
			: array( 278, 278, 355, 556, 556, 889, 667, 222, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 222, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584 );

		$w = array();
		foreach ( $ascii as $i => $width ) {
			$w[ 32 + $i ] = $width;
		}

		// The Windows-1252 band, then the Latin-1 letters.
		$w[ 0x80 ] = 556;                       // euro
		$w[ 0x82 ] = $bold ? 278 : 222;         // quotesinglbase
		$w[ 0x83 ] = 556;
		$w[ 0x84 ] = $bold ? 500 : 333;
		$w[ 0x85 ] = 1000;                      // ellipsis
		$w[ 0x86 ] = 556;
		$w[ 0x87 ] = 556;
		$w[ 0x88 ] = 333;
		$w[ 0x89 ] = $bold ? 1000 : 1000;
		$w[ 0x8A ] = $bold ? 667 : 667;
		$w[ 0x8B ] = 333;
		$w[ 0x8C ] = 1000;                      // OE
		$w[ 0x8E ] = 611;
		$w[ 0x91 ] = $bold ? 278 : 222;
		$w[ 0x92 ] = $bold ? 278 : 222;         // right single quote
		$w[ 0x93 ] = $bold ? 500 : 333;
		$w[ 0x94 ] = $bold ? 500 : 333;
		$w[ 0x95 ] = 350;
		$w[ 0x96 ] = 556;
		$w[ 0x97 ] = 1000;
		$w[ 0x98 ] = 333;
		$w[ 0x99 ] = 1000;
		$w[ 0x9A ] = 500;
		$w[ 0x9B ] = 333;
		$w[ 0x9C ] = $bold ? 611 : 500;         // oe
		$w[ 0x9E ] = 500;
		$w[ 0x9F ] = 667;

		$punctuation = array(
			0xA1 => $bold ? 333 : 333,
			0xA2 => 556,
			0xA3 => 556,
			0xA4 => 556,
			0xA5 => 556,
			0xA6 => $bold ? 280 : 260,
			0xA7 => 556,
			0xA8 => 333,
			0xA9 => 737,
			0xAA => $bold ? 370 : 370,
			0xAB => 556,
			0xAC => 584,
			0xAD => 333,
			0xAE => 737,
			0xAF => 333,
			0xB0 => 400,
			0xB1 => 584,
			0xB2 => 333,
			0xB3 => 333,
			0xB4 => 333,
			0xB5 => $bold ? 611 : 556,
			0xB6 => 556,
			0xB7 => 278,
			0xB8 => 333,
			0xB9 => 333,
			0xBA => $bold ? 365 : 365,
			0xBB => 556,
			0xBC => 834,
			0xBD => 834,
			0xBE => 834,
			0xBF => $bold ? 611 : 611,
			0xD7 => 584,
			0xF7 => 584,
		);
		foreach ( $punctuation as $byte => $width ) {
			$w[ $byte ] = $width;
		}

		/*
		 * Accented letters take their base letter's advance in Helvetica, so
		 * they are derived rather than listed: a hand-typed table of ninety
		 * numbers is ninety chances to right-align a total one millimetre off.
		 */
		$base = array(
			0xC0 => 'A', 0xC1 => 'A', 0xC2 => 'A', 0xC3 => 'A', 0xC4 => 'A', 0xC5 => 'A',
			0xC6 => null, 0xC7 => 'C', 0xC8 => 'E', 0xC9 => 'E', 0xCA => 'E', 0xCB => 'E',
			0xCC => 'I', 0xCD => 'I', 0xCE => 'I', 0xCF => 'I', 0xD0 => 'D', 0xD1 => 'N',
			0xD2 => 'O', 0xD3 => 'O', 0xD4 => 'O', 0xD5 => 'O', 0xD6 => 'O', 0xD8 => 'O',
			0xD9 => 'U', 0xDA => 'U', 0xDB => 'U', 0xDC => 'U', 0xDD => 'Y', 0xDE => 'P',
			0xDF => null,
			0xE0 => 'a', 0xE1 => 'a', 0xE2 => 'a', 0xE3 => 'a', 0xE4 => 'a', 0xE5 => 'a',
			0xE6 => null, 0xE7 => 'c', 0xE8 => 'e', 0xE9 => 'e', 0xEA => 'e', 0xEB => 'e',
			0xEC => 'i', 0xED => 'i', 0xEE => 'i', 0xEF => 'i', 0xF0 => 'o', 0xF1 => 'n',
			0xF2 => 'o', 0xF3 => 'o', 0xF4 => 'o', 0xF5 => 'o', 0xF6 => 'o', 0xF8 => 'o',
			0xF9 => 'u', 0xFA => 'u', 0xFB => 'u', 0xFC => 'u', 0xFD => 'y', 0xFE => 'p',
			0xFF => 'y',
		);
		foreach ( $base as $byte => $letter ) {
			$w[ $byte ] = null === $letter ? ( $bold ? 1000 : 1000 ) : $w[ ord( $letter ) ];
		}
		// AE, ae and germandbls are the three that are not a base letter's width.
		$w[ 0xC6 ] = 1000;
		$w[ 0xE6 ] = $bold ? 889 : 889;
		$w[ 0xDF ] = $bold ? 611 : 556;

		$cache[ $font ] = $w;
		return $w;
	}
}
